import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { concatBytes, hexToBytes, isAddress, keccak256, recoverMessageAddress, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GET as registrationGET, POST as registrationPOST } from "../app/api/agent/registration/route";
import { GET as requestGET } from "../app/api/agent/registration/request/route";
import { setCapForTest } from "../lib/human/cap";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { setClockForTest } from "../lib/human/clock";
import { deriveIdentifier } from "../lib/human/derive";
import { setRegistryForTest } from "../lib/human/registry";
import { ENROLLMENT_CALLS_CEILING, ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS, enrollmentThrottle } from "../lib/human/throttle";
import {
  ALREADY_USED,
  ANOTHER_PERSON,
  ANOTHER_WALLET,
  ENROLMENT_MESSAGE_PREFIX,
  NOT_SIGNED,
  OTHER_WALLET,
  SIGNATURE_TTL_SECONDS,
  VERIFY_ORIGIN,
  type Verifier,
  enrolmentMessage,
  setVerifierForTest,
  signalHashFor,
} from "../lib/human/worldid";
import { HUMAN_A, fakeRegistry, fakeStore, fakeVerifications } from "./human";

type Check = (ok: boolean, label: string) => void;

/** The founder's recording wallet, which AgentBook knows and which must pass
 *  exactly as before and signs nothing here; and three wallets it does not,
 *  each from a scratch key so it can sign for itself. */
const RECORDING = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const KEYS = {
  a: privateKeyToAccount(`0x${"a1".repeat(32)}`),
  b: privateKeyToAccount(`0x${"b2".repeat(32)}`),
  c: privateKeyToAccount(`0x${"c3".repeat(32)}`),
  capped: privateKeyToAccount(`0x${"d4".repeat(32)}`),
};
const WALLET_A = KEYS.a.address;
const WALLET_B = KEYS.b.address;
const WALLET_C = KEYS.c.address;
const keyOf = (wallet: string) => Object.values(KEYS).find(k => k.address.toLowerCase() === wallet.toLowerCase());

/** Planted, of known bytes, so a sweep can look for it. Invented: a real one
 *  belongs to the person it identifies. */
const NULLIFIER = `0x${"5a".repeat(32)}`;
const NULLIFIER_2 = `0x${"6b".repeat(32)}`;

const SIGNING_KEY = `0x${"ab".repeat(32)}` as `0x${string}`;
const ENV = {
  WORLD_RP_ID: "rp_0000000000000000",
  NEXT_PUBLIC_WORLD_APP_ID: "app_0000000000000000",
  NEXT_PUBLIC_WORLD_ACTION: "enrol-agent",
  NEXT_PUBLIC_WORLD_ENVIRONMENT: "staging",
  WORLD_SIGNING_KEY: SIGNING_KEY,
  HUMAN_ID_KEY: "c".repeat(64),
};

/**
 * The message a relying party signs, built here from the published spec rather
 * than imported, so the route's signature is checked by something that shares no
 * code with it. The React package's `./signing` subpath declares `signRequest`
 * only; the message builder it ships at runtime is absent from its types, which
 * is one more reason not to lean on it here.
 */
function rpMessage(nonce: string, createdAt: number, expiresAt: number, action: string): Uint8Array {
  const u64 = (n: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n));
    return b;
  };
  const field = (BigInt(keccak256(toBytes(action))) >> 8n).toString(16).padStart(64, "0");
  return concatBytes([new Uint8Array([1]), toBytes(nonce as `0x${string}`), u64(createdAt), u64(expiresAt), toBytes(`0x${field}` as `0x${string}`)]);
}

/** A version 4 result shaped as the installed package declares it, bound to a
 *  wallet through the same hash the widget computes. */
function resultFor(wallet: string, over: Record<string, unknown> = {}, nonce = "nonce-a") {
  // The proof bytes follow the nonce, so two results with two nonces are two
  // proofs, the way two real requests would be. The replay checks reuse one
  // object, or edit its nonce and keep its proof, on purpose.
  const proof = [1, 2, 3, 4, 5].map(i => keccak256(new TextEncoder().encode(`${nonce}:${i}`)));
  return {
    protocol_version: "4.0",
    nonce,
    action: "enrol-agent",
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: signalHashFor(wallet),
        proof,
        nullifier: NULLIFIER,
        issuer_schema_id: 1,
        expires_at_min: 1756166400,
      },
    ],
    user_presence_completed: false,
    ...over,
  };
}

/**
 * A fake of the verifier that records the exact body it received and answers
 * as configured. The nullifier it answers is the planted one, so the leak sweep
 * has a value to look for that entered through the only wire allowed to carry it.
 */
function fakeVerifier() {
  const state = {
    calls: [] as { url: string; headers: Record<string, string>; body: string }[],
    mode: "accept" as "accept" | "refuse" | "throw" | "outage",
    nullifier: NULLIFIER,
    code: "all_verifications_failed",
  };
  const verifier: Verifier = async (url, init) => {
    if (state.mode === "throw") throw new Error("connection refused");
    state.calls.push({ url, headers: init.headers, body: init.body });
    if (state.mode === "outage") return new Response("bad gateway", { status: 502 });
    if (state.mode === "refuse") {
      return Response.json({ success: false, code: state.code, detail: "All proof verifications failed." }, { status: 400 });
    }
    return Response.json({
      success: true,
      action: "enrol-agent",
      nullifier: state.nullifier,
      environment: "staging",
      results: [{ identifier: "proof_of_human", success: true, nullifier: state.nullifier }],
    });
  };
  return { verifier, state };
}

export async function enrolChecks(check: Check) {
  console.log("\n  enrolment with World ID, the server leg");

  const envBefore: Record<string, string | undefined> = {};
  for (const k of Object.keys(ENV)) envBefore[k] = process.env[k];
  Object.assign(process.env, ENV);

  /** Posts as the card does: the wallet's key signs the sentence built from the
   *  result's nonce, unless the caller supplies a signature of its own or asks
   *  for none. The recording wallet has no key here and never signs. */
  const post = async (body: { payer: string; result?: { nonce?: string }; signature?: string | null }) => {
    const key = keyOf(body.payer);
    const signature =
      body.signature === null ? undefined
      : body.signature !== undefined ? body.signature
      : key && body.result?.nonce ? await key.signMessage({ message: enrolmentMessage(body.result.nonce) })
      : undefined;
    const { signature: _drop, ...rest } = body;
    void _drop;
    return registrationPOST(new Request("http://127.0.0.1/api/agent/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signature === undefined ? rest : { ...rest, signature }) }));
  };
  const read = (payer: string) => registrationGET(new Request(`http://127.0.0.1/api/agent/registration?payer=${payer}`));
  const ask = (query: string) => requestGET(new Request(`http://127.0.0.1/api/agent/registration/request${query}`));

  /* Console captured for the whole block: the sweep below reads it. */
  const logged: string[] = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  console.warn = capture;
  console.error = capture;

  const { verifier, state } = fakeVerifier();
  setVerifierForTest(verifier);
  const table = fakeVerifications();
  const usage = fakeStore();
  const registry = fakeRegistry({ [RECORDING]: HUMAN_A });
  setCapForTest({ registry: registry.read, store: usage, verifications: table, freePerDay: 2 });
  const T0 = new Date("2026-09-13T12:00:00Z");
  let clock = T0;
  setClockForTest(() => clock);
  enrollmentThrottle.reset();

  /* Everything the routes answer is collected, so the sweep reads every wire. */
  const wires: Response[] = [];
  const keep = async (r: Response) => {
    wires.push(r.clone());
    return r;
  };

  /*
   * The request route: a signed context, and the key it was signed with kept out.
   */
  check((await keep(await ask(""))).status === 400, "330 · the request route names a payer or refuses");
  check((await keep(await ask("?payer=nonsense"))).status === 400, "330a · and refuses one that is not an address");
  const ctx = await keep(await ask(`?payer=${WALLET_A}`));
  const ctxBody = (await ctx.clone().json()) as Record<string, unknown>;
  check(ctx.status === 200 && Object.keys(ctxBody).sort().join(",") === "created_at,expires_at,message,nonce,rp_id,signature",
    `331 · the context carries the widget's five names and the sentence to sign, nothing else (${Object.keys(ctxBody).sort().join(",")})`);
  check(ctxBody.message === `${ENROLMENT_MESSAGE_PREFIX}${ctxBody.nonce}` && ctxBody.message === enrolmentMessage(String(ctxBody.nonce)),
    "331e · the sentence is one server function of the nonce, the same one the verify route rebuilds");
  // The signature is checked rather than believed: recovered over the message the
  // installed package builds from these fields and the configured action.
  // The builder itself against the published vector first, so 331a rests on it.
  check(
    toHex(rpMessage("0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd", 1700000000, 1700000300, "test-action")) ===
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a",
    "331d · the independent message builder reproduces the published 81 byte vector",
  );
  const message = rpMessage(String(ctxBody.nonce), Number(ctxBody.created_at), Number(ctxBody.expires_at), "enrol-agent");
  const signer = await recoverMessageAddress({ message: { raw: message }, signature: String(ctxBody.signature) as `0x${string}` }).catch(() => null);
  check(signer === privateKeyToAccount(SIGNING_KEY).address, "331a · and the signature recovers to the signing key, over the action the widget will send");
  const wrongAction = rpMessage(String(ctxBody.nonce), Number(ctxBody.created_at), Number(ctxBody.expires_at), "other-action");
  const wrongSigner = await recoverMessageAddress({ message: { raw: wrongAction }, signature: String(ctxBody.signature) as `0x${string}` }).catch(() => null);
  check(wrongSigner !== signer, "331b · while another action recovers to somebody else (negative control)");
  check(Number(ctxBody.expires_at) - Number(ctxBody.created_at) === SIGNATURE_TTL_SECONDS, `331c · and it lasts ${SIGNATURE_TTL_SECONDS} seconds`);
  check(!JSON.stringify(ctxBody).includes(SIGNING_KEY.slice(2)) && ![...ctx.headers.values()].some(v => v.includes(SIGNING_KEY.slice(2))),
    "332 · the signing key is in no part of the answer");
  check(ctx.headers.get("cache-control") === "private, no-store", "332a · and the context is not cacheable");

  delete process.env.WORLD_SIGNING_KEY;
  check((await keep(await ask(`?payer=${WALLET_A}`))).status === 503, "333 · with no signing key the route answers 503 rather than signing with nothing");
  process.env.WORLD_SIGNING_KEY = SIGNING_KEY;

  // Every file that could reach a browser, and the one server file that may hold
  // the name. Walked rather than listed, so a client file added later is covered.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const clientFiles = walk("app").filter(f => /^\s*"use client";/m.test(readFileSync(f, "utf8"))).concat(["lib/agent/browser.ts"]);
  const naming = clientFiles.filter(f => readFileSync(f, "utf8").includes("WORLD_SIGNING_KEY"));
  check(clientFiles.length >= 2 && naming.length === 0, `334 · no client file names the signing key's variable (${clientFiles.length} walked, ${naming.join(", ") || "none"})`);
  check(readFileSync("lib/human/worldid.ts", "utf8").includes("WORLD_SIGNING_KEY"), "334a · while the server module does (positive control)");

  /*
   * The verify route: bound to the wallet, forwarded unmodified, recorded once.
   */
  check((await keep(await post({ payer: "nonsense", result: resultFor(WALLET_A) }))).status === 400, "335 · a payer that is not an address is refused");
  check((await keep(await post({ payer: WALLET_A }))).status === 400, "335a · and so is a body with no result");
  check(state.calls.length === 0, "335b · neither reached the verifier");

  const planted = resultFor(WALLET_A);
  const accepted = await keep(await post({ payer: WALLET_A, result: planted }));
  const acceptedBody = (await accepted.clone().json()) as Record<string, unknown>;
  check(accepted.status === 200 && acceptedBody.state === "registered" && acceptedBody.source === "worldid",
    `336 · a result bound to the wallet named is accepted as registered by World ID (${accepted.status} ${JSON.stringify(acceptedBody)})`);
  check(acceptedBody.credential === "proof_of_human", "336a · and names the credential the verifier answered with");
  check(state.calls.length === 1, "336b · through exactly one call to the verifier");
  check(state.calls[0]?.url === `${VERIFY_ORIGIN}/api/v4/verify/${ENV.WORLD_RP_ID}`, `336c · at the version 4 path under the relying party (${state.calls[0]?.url})`);
  check(state.calls[0]?.headers["content-type"] === "application/json", "336d · as json");
  check(JSON.stringify(JSON.parse(state.calls[0]?.body ?? "{}")) === JSON.stringify(planted),
    "336e · and the body it received is the result as posted, no field added, dropped or rewritten");
  check(table.rows.size === 1 && table.rows.get(WALLET_A.toLowerCase())?.credential === "proof_of_human", "336f · one row, for the lowercased wallet");
  const row = table.rows.get(WALLET_A.toLowerCase());
  check(row?.nullifierDigest === deriveIdentifier(BigInt(NULLIFIER), ENV), "336g · holding the keyed digest of the nullifier, the derivation the cap already uses");
  check(row?.expiresAt.getTime() === T0.getTime() + 30 * 86_400_000, "336h · and lapsing thirty days after it was made, the period the notice declares");
  check(accepted.headers.get("cache-control") === "private, no-store", "336i · not cacheable");
  check(Object.keys(acceptedBody).sort().join(",") === "credential,expiresAt,source,state",
    `351 · the answer carries four named fields and nothing the verifier said (${Object.keys(acceptedBody).sort().join(",")})`);
  const acceptedText = (await accepted.clone().text()) + [...accepted.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  check(!acceptedText.includes(NULLIFIER) && !acceptedText.includes(NULLIFIER.slice(2)) && !acceptedText.includes(BigInt(NULLIFIER).toString()),
    "351a · and the nullifier the verifier answered with is in no part of it");

  // The same result, posted under another wallet. Refused before the forward:
  // the fake's count is the evidence.
  const other = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_A, {}, "nonce-b") }));
  check(other.status === 403 && ((await other.clone().json()) as { error: string }).error === OTHER_WALLET,
    `337 · a result bound to another wallet is refused (${other.status})`);
  check(state.calls.length === 1, "337a · and never forwarded");
  check(table.rows.size === 1, "337b · and writes no row");
  const unbound = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_B, { responses: [{ ...resultFor(WALLET_B).responses[0], signal_hash: undefined }] }, "nonce-c") }));
  check(unbound.status === 400 && state.calls.length === 1, `337c · a result carrying no signal at all is refused too (${unbound.status})`);
  // A `signal` field in the body is not consulted: the binding is the address.
  const smuggled = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_A, { signal: WALLET_B.toLowerCase() }, "nonce-d") }));
  check(smuggled.status === 403 && state.calls.length === 1, "337d · a body naming its own signal does not move the binding");
  /*
   * ONE ENCODING, NOW THAT A REAL RESULT HAS BEEN SEEN.
   *
   * This accepted the address hashed as text as well, because no result from a real
   * World App had arrived and refusing the wrong one of the two would have refused
   * every enrolment. One arrived on 2026-09-13, and the widget's wasm was measured
   * producing the bytes form, so the text form is refused and nothing is forwarded
   * for it.
   */
  const textHash = hashSignal(new TextEncoder().encode(WALLET_B.toLowerCase())).toLowerCase();
  const textForm = resultFor(WALLET_B, { responses: [{ ...resultFor(WALLET_B, {}, "nonce-e").responses[0], signal_hash: textHash }] }, "nonce-e");
  const callsBeforeText = state.calls.length;
  const asText = await keep(await post({ payer: WALLET_B, result: textForm }));
  check(asText.status === 403 && state.calls.length === callsBeforeText,
    `337e · the wallet hashed as text is refused and never forwarded (${asText.status}, ${state.calls.length - callsBeforeText} calls)`);
  const bytesForm = resultFor(WALLET_B, { responses: [{ ...resultFor(WALLET_B, {}, "nonce-e2").responses[0], signal_hash: signalHashFor(WALLET_B) }] }, "nonce-e2");
  state.nullifier = NULLIFIER_2;
  const asBytes = await keep(await post({ payer: WALLET_B, result: bytesForm }));
  check(asBytes.status === 200 && state.calls.length === callsBeforeText + 1,
    `337e2 · while the same result hashed as bytes is accepted (negative control, ${asBytes.status})`);
  state.nullifier = NULLIFIER;
  check(signalHashFor(RECORDING) === "0x00151c582efed6bc3f5dc56e31c4bf48c758c6b35a6dcba3dd6abf2d825e1527",
    "337f · the bytes hash of the recording wallet is the value the widget's wasm was measured producing");
  check(signalHashFor(RECORDING) === hashSignal(hexToBytes(RECORDING.toLowerCase() as `0x${string}`)).toLowerCase(),
    "337g · and the string the server hashes is read as its twenty bytes, not as its characters");
  check(signalHashFor(RECORDING) !== textHash && signalHashFor(RECORDING) !== signalHashFor(WALLET_A),
    "337h · the two encodings differ from each other and from another wallet's (negative control)");

  /*
   * Control of the wallet. A result names a wallet as its signal and proves
   * nothing about who is posting it; the signature over the served sentence is
   * what does. Every refusal here is before the forward: the count holds it.
   */
  const callsAtSign = state.calls.length;
  const forA = resultFor(WALLET_A, {}, "nonce-sign");
  const byB = await KEYS.b.signMessage({ message: enrolmentMessage("nonce-sign") });
  const otherKey = await keep(await post({ payer: WALLET_A, result: forA, signature: byB }));
  check(otherKey.status === 403 && ((await otherKey.clone().json()) as { error: string }).error === NOT_SIGNED,
    `350 · a signature by another key is refused with the fixed sentence (${otherKey.status})`);
  check(state.calls.length === callsAtSign, "350a · before any call to the verifier");
  // The control for "compares, never catches": that signature recovers to a
  // valid address, B's, so the refusal came from the comparison and not from a
  // throw. A recovery wrapped so that only a throw refuses would pass it.
  const recoveredOther = await recoverMessageAddress({ message: enrolmentMessage("nonce-sign"), signature: byB }).catch(() => null);
  check(recoveredOther !== null && isAddress(recoveredOther) && recoveredOther.toLowerCase() === WALLET_B.toLowerCase(),
    "350b · while that signature recovers to a valid other address, so the refusal is the comparison (control)");
  const otherNonce = await KEYS.a.signMessage({ message: enrolmentMessage("nonce-elsewhere") });
  check((await keep(await post({ payer: WALLET_A, result: forA, signature: otherNonce }))).status === 403 && state.calls.length === callsAtSign,
    "350c · the payer's key over another nonce's sentence is refused, so a signature is good for one request");
  const unsigned = await keep(await post({ payer: WALLET_A, result: forA, signature: null }));
  const short = await keep(await post({ payer: WALLET_A, result: forA, signature: `0x${"ab".repeat(60)}` }));
  const badV = await keep(await post({ payer: WALLET_A, result: forA, signature: `${byB.slice(0, -2)}00` }));
  check([unsigned.status, short.status, badV.status].every(st => st === 400 || st === 403) && state.calls.length === callsAtSign,
    `350d · no signature, a 60 byte one and a 65 byte one with a bad recovery id are 400 or 403, never 500, and nothing is forwarded (${unsigned.status}, ${short.status}, ${badV.status})`);
  const ownText = "Xovi Agents enrolment nonce-sign but written by the client";
  const overOwnText = await KEYS.a.signMessage({ message: ownText });
  // Planted in both places a client could put it, beside the result and inside it.
  const withOwnText = await keep(await post({ payer: WALLET_A, result: { ...forA, message: ownText }, signature: overOwnText, message: ownText } as never));
  check(withOwnText.status === 403 && state.calls.length === callsAtSign,
    `350e · a body supplying its own sentence, signed by the payer, does not move the binding (${withOwnText.status})`);
  const signedRight = await keep(await post({ payer: WALLET_A, result: forA }));
  check(signedRight.status === 200 && state.calls.length === callsAtSign + 1,
    `350f · the payer's own signature over the served sentence enrols, with one verifier call (negative control, ${signedRight.status})`);

  // Replay. The same result twice, then the same proof under a fresh nonce.
  const callsBefore = state.calls.length;
  const replay = await keep(await post({ payer: WALLET_A, result: planted }));
  check(replay.status === 409 && ((await replay.clone().json()) as { error: string }).error === ALREADY_USED, `338 · the same result posted twice is refused the second time (${replay.status})`);
  check(state.calls.length === callsBefore, `338a · with the verifier's count unmoved (${state.calls.length})`);
  const editedNonce = await keep(await post({ payer: WALLET_A, result: { ...planted, nonce: "nonce-edited" } }));
  check(editedNonce.status === 409 && state.calls.length === callsBefore, "338b · and the same proof under an edited nonce is the same replay");
  const fresh = resultFor(WALLET_A, { responses: [{ ...planted.responses[0], proof: planted.responses[0].proof.map((p: string) => p.replace("11", "99")) }] }, "nonce-fresh");
  clock = new Date(T0.getTime() + 3_600_000);
  const rowsBefore = table.rows.size;
  const again = await keep(await post({ payer: WALLET_A, result: fresh }));
  check(again.status === 200 && table.rows.size === rowsBefore, `339 · a fresh result for the same wallet is accepted and adds no row (${again.status}, ${table.rows.size} rows)`);
  check(table.rows.get(WALLET_A.toLowerCase())?.verifiedAt.getTime() === clock.getTime(), "339a · with the times moved to the new result");
  clock = T0;

  // One wallet per person, and one person per wallet.
  const second = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-second") }));
  check(second.status === 409 && ((await second.clone().json()) as { error: string }).error === ANOTHER_WALLET,
    `340 · a second wallet from the same person is refused with the fixed sentence (${second.status})`);
  check(table.rows.size === 2 && !table.rows.has(WALLET_C.toLowerCase()), "340a · and gets no row");
  // A third person, who holds no wallet yet, so only the second rule can fire.
  state.nullifier = `0x${"9e".repeat(32)}`;
  const taken = await keep(await post({ payer: WALLET_A, result: resultFor(WALLET_A, {}, "nonce-taken") }));
  check(taken.status === 409 && ((await taken.clone().json()) as { error: string }).error === ANOTHER_PERSON,
    `340b · a wallet enrolled behind one person is not handed to another while it stands (${taken.status})`);
  state.nullifier = NULLIFIER;

  // The verifier saying no, and the verifier not answering.
  state.mode = "refuse";
  const refused = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-refused") }));
  check(refused.status === 400 && /refused: all_verifications_failed/.test(((await refused.clone().json()) as { error: string }).error),
    `341 · a result the verifier refuses is refused with its code word (${refused.status})`);
  state.code = "<b onload=x>fetch</b>";
  const markup = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-markup") }));
  const markupBody = ((await markup.clone().json()) as { error: string }).error;
  check(markup.status === 400 && markupBody === "the verifier refused" && !markupBody.includes("<"),
    `353 · a code outside the known list is answered with the fixed sentence and never repeated (${JSON.stringify(markupBody)})`);
  state.code = "all_verifications_failed";
  const refusedAgain = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-refused") }));
  check(refusedAgain.status === 409, "341a · and stays used: the same result is not forwarded a second time");
  state.mode = "throw";
  const down = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }));
  check(down.status === 503, `341b · a verifier that cannot be reached is 503 (${down.status})`);
  state.mode = "outage";
  check((await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }))).status === 503, "341c · and so is one answering 5xx");
  state.mode = "accept";
  state.nullifier = `0x${"7c".repeat(32)}`;
  check((await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }))).status === 200,
    "341d · while the result it never saw can be posted again once it answers (negative control for 341a)");
  state.nullifier = NULLIFIER;
  const wrongAction2 = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { action: "other-action" }, "nonce-action") }));
  const wrongEnv = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { environment: "production" }, "nonce-env") }));
  check(wrongAction2.status === 400 && wrongEnv.status === 400, "341e · another action or the other environment is refused before the forward");
  const callsAtLegacy = state.calls.length;
  const legacy = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { protocol_version: "3.0" }, "nonce-legacy") }));
  check(legacy.status === 400 && state.calls.length === callsAtLegacy, `341f · a version 3 result is refused too, since its nullifier is another value for the same person (${legacy.status})`);

  /*
   * The registration read, four combinations, and the source named.
   */
  const bodyOf = async (payer: string) => (await (await keep(await read(payer))).json()) as Record<string, unknown>;
  const fromTable = await bodyOf(WALLET_A);
  check(fromTable.state === "registered" && fromTable.source === "worldid" && fromTable.credential === "proof_of_human",
    `342 · a wallet AgentBook does not know and the table does is registered by World ID (${JSON.stringify(fromTable)})`);
  const unknown = await bodyOf("0x9999999999999999999999999999999999999999");
  check(unknown.state === "not-registered" && unknown.source === null && unknown.credential === null, `342a · in neither is not registered (${JSON.stringify(unknown)})`);
  const onChain = await bodyOf(RECORDING);
  check(onChain.state === "registered" && onChain.source === "agentbook", `342b · the recording wallet is registered by AgentBook (${JSON.stringify(onChain)})`);
  registry.mode = "throws";
  check((await bodyOf(WALLET_A)).source === "worldid", "342c · a chain that does not answer does not hide a row the table holds");
  check((await bodyOf("0x9999999999999999999999999999999999999999")).state === "unread", "342d · and with no row either it is unread, not not registered");
  registry.reset();
  // A wallet in both answers AgentBook, stated: a row planted for the recording
  // wallet, which has no key here and signs nothing.
  table.rows.set(RECORDING.toLowerCase(), { payer: RECORDING.toLowerCase(), action: "enrol-agent", nullifierDigest: "planted", credential: "proof_of_human", verifiedAt: T0, expiresAt: new Date(T0.getTime() + 30 * 86_400_000) });
  check((await bodyOf(RECORDING)).source === "agentbook", "342e · a wallet in both sources answers AgentBook");
  table.rows.delete(RECORDING.toLowerCase());

  /*
   * Both routes capped, on one counter, seen red with the clock.
   */
  enrollmentThrottle.reset();
  const CAPPED = KEYS.capped.address;
  let last: Response = new Response(null);
  for (let i = 0; i < ENROLLMENT_CALLS_PER_MINUTE; i++) last = await keep(await ask(`?payer=${CAPPED}`));
  check(last.status === 200, `346 · the ${ENROLLMENT_CALLS_PER_MINUTE}th request in a minute is answered`);
  const over = await keep(await ask(`?payer=${CAPPED}`));
  check(over.status === 429 && Number(over.headers.get("retry-after")) >= 1, `346a · the next is 429 with a retry-after (${over.status}, ${over.headers.get("retry-after")})`);
  const callsAtCap = state.calls.length;
  const overPost = await keep(await post({ payer: CAPPED, result: resultFor(CAPPED, {}, "nonce-capped") }));
  check(overPost.status === 429 && state.calls.length === callsAtCap, "346b · and the verify route shares the counter, so it is 429 too and nothing is forwarded");
  clock = new Date(T0.getTime() + ENROLLMENT_WINDOW_MS + 1);
  check((await keep(await ask(`?payer=${CAPPED}`))).status === 200, "346c · a minute later the same wallet is answered again (negative control)");
  check((await keep(await ask(`?payer=${WALLET_B}`))).status === 200, "346d · and another wallet was never held (negative control)");
  check(ENROLLMENT_CALLS_PER_MINUTE >= 3 && ENROLLMENT_CALLS_PER_MINUTE <= ENROLLMENT_CALLS_CEILING && ENROLLMENT_CALLS_CEILING <= 20,
    `352 · the per wallet limit is bounded, since wallets are free and each fresh one can have a result forwarded that many times a minute (${ENROLLMENT_CALLS_PER_MINUTE} of ${ENROLLMENT_CALLS_CEILING})`);
  clock = T0;

  /*
   * The sweep: the planted nullifier reaches no wire this service serves.
   */
  const decimal = BigInt(NULLIFIER).toString();
  const unkeyed = [keccak256(NULLIFIER as `0x${string}`), keccak256(toHex(new TextEncoder().encode(NULLIFIER)))];
  const needles = [NULLIFIER, NULLIFIER.slice(2), decimal, ...unkeyed, ...unkeyed.map(h => h.slice(2))];
  const served: string[] = [];
  for (const r of wires) served.push(await r.text(), ...[...r.headers.entries()].map(([k, v]) => `${k}: ${v}`));
  const leaks = needles.filter(n => served.some(s => s.toLowerCase().includes(n.toLowerCase())));
  check(leaks.length === 0, `347 · the nullifier, its decimal form and its unkeyed keccak appear in no response body or header (${wires.length} responses, ${leaks.length} hits)`);
  const inLogs = needles.filter(n => logged.some(l => l.toLowerCase().includes(n.toLowerCase())));
  check(inLogs.length === 0, `347a · nor in anything the routes logged (${logged.length} lines)`);
  const storedRows = JSON.stringify([...table.rows.values()]);
  const inRows = needles.filter(n => storedRows.toLowerCase().includes(n.toLowerCase()));
  check(inRows.length === 0 && table.rows.size > 0, `347b · nor in any stored row (${table.rows.size} rows, ${inRows.length} hits)`);
  check(state.calls.some(c => c.body.includes(NULLIFIER)), "347c · while it did travel on the one wire the protocol requires, the verify call (control)");
  check(served.some(s => s.includes(WALLET_A.toLowerCase())) || served.some(s => s.includes("registered")), "347d · and the sweep read real answers, not an empty list (control)");

  const example = readFileSync(".env.example", "utf8");
  const names = ["NEXT_PUBLIC_WORLD_APP_ID", "WORLD_RP_ID", "NEXT_PUBLIC_WORLD_ACTION", "NEXT_PUBLIC_WORLD_ENVIRONMENT", "WORLD_SIGNING_KEY"];
  const missing = names.filter(n => !new RegExp(`^${n}=`, "m").test(example));
  check(missing.length === 0, `349 · the example names the five World variables (${missing.join(", ") || "none missing"})`);
  check(!/ONBOARDING_ALLOW_UNREGISTERED/.test(example) && !/ONBOARDING_ALLOW_UNREGISTERED/.test(readFileSync("app/api/agent/registration/route.ts", "utf8")),
    "349a · and the flag the enrollment replaces is read by nothing and named nowhere");

  // The wording of what the routes serve, held to the rule the audit plan states.
  const servedText = served.join("\n");
  check(!/verified person|verified human|World verified|identifies nobody/i.test(servedText), "349b · nothing served predicates verified of the person");

  console.warn = real.warn;
  console.error = real.error;
  setVerifierForTest(undefined);
  setClockForTest(undefined);
  setCapForTest(null);
  setRegistryForTest(undefined);
  enrollmentThrottle.reset();
  for (const k of Object.keys(ENV)) {
    if (envBefore[k] === undefined) delete process.env[k];
    else process.env[k] = envBefore[k];
  }
}
