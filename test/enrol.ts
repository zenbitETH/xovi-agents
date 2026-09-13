import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { concatBytes, keccak256, recoverMessageAddress, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GET as registrationGET, POST as registrationPOST } from "../app/api/agent/registration/route";
import { GET as requestGET } from "../app/api/agent/registration/request/route";
import { setCapForTest } from "../lib/human/cap";
import { setClockForTest } from "../lib/human/clock";
import { deriveIdentifier } from "../lib/human/derive";
import { setRegistryForTest } from "../lib/human/registry";
import { ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS, enrollmentThrottle } from "../lib/human/throttle";
import {
  ALREADY_USED,
  ANOTHER_PERSON,
  ANOTHER_WALLET,
  OTHER_WALLET,
  SIGNATURE_TTL_SECONDS,
  VERIFY_ORIGIN,
  type Verifier,
  setVerifierForTest,
  signalHashesFor,
  verifyEnrollment,
} from "../lib/human/worldid";
import { HUMAN_A, fakeRegistry, fakeStore, fakeVerifications } from "./human";

type Check = (ok: boolean, label: string) => void;

/** The founder's recording wallet, which AgentBook knows and which must pass
 *  exactly as before, and two wallets it does not. */
const RECORDING = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const WALLET_A = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const WALLET_B = "0xeCB4C1245665e8A1F43826355aaB0Dd6bF336e05";
const WALLET_C = "0x1111111111111111111111111111111111111111";

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
        signal_hash: signalHashesFor(wallet)[0],
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
  };
  const verifier: Verifier = async (url, init) => {
    if (state.mode === "throw") throw new Error("connection refused");
    state.calls.push({ url, headers: init.headers, body: init.body });
    if (state.mode === "outage") return new Response("bad gateway", { status: 502 });
    if (state.mode === "refuse") {
      return Response.json({ success: false, code: "all_verifications_failed", detail: "All proof verifications failed." }, { status: 400 });
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

  const post = (body: unknown) =>
    registrationPOST(new Request("http://127.0.0.1/api/agent/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
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
  check((await keep(await ask(""))).status === 400, "300 · the request route names a payer or refuses");
  check((await keep(await ask("?payer=nonsense"))).status === 400, "300a · and refuses one that is not an address");
  const ctx = await keep(await ask(`?payer=${WALLET_A}`));
  const ctxBody = (await ctx.clone().json()) as Record<string, unknown>;
  check(ctx.status === 200 && Object.keys(ctxBody).sort().join(",") === "created_at,expires_at,nonce,rp_id,signature",
    `301 · the context carries the widget's five names and nothing else (${Object.keys(ctxBody).sort().join(",")})`);
  // The signature is checked rather than believed: recovered over the message the
  // installed package builds from these fields and the configured action.
  // The builder itself against the published vector first, so 301a rests on it.
  check(
    toHex(rpMessage("0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd", 1700000000, 1700000300, "test-action")) ===
      "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a",
    "301d · the independent message builder reproduces the published 81 byte vector",
  );
  const message = rpMessage(String(ctxBody.nonce), Number(ctxBody.created_at), Number(ctxBody.expires_at), "enrol-agent");
  const signer = await recoverMessageAddress({ message: { raw: message }, signature: String(ctxBody.signature) as `0x${string}` }).catch(() => null);
  check(signer === privateKeyToAccount(SIGNING_KEY).address, "301a · and the signature recovers to the signing key, over the action the widget will send");
  const wrongAction = rpMessage(String(ctxBody.nonce), Number(ctxBody.created_at), Number(ctxBody.expires_at), "other-action");
  const wrongSigner = await recoverMessageAddress({ message: { raw: wrongAction }, signature: String(ctxBody.signature) as `0x${string}` }).catch(() => null);
  check(wrongSigner !== signer, "301b · while another action recovers to somebody else (negative control)");
  check(Number(ctxBody.expires_at) - Number(ctxBody.created_at) === SIGNATURE_TTL_SECONDS, `301c · and it lasts ${SIGNATURE_TTL_SECONDS} seconds`);
  check(!JSON.stringify(ctxBody).includes(SIGNING_KEY.slice(2)) && ![...ctx.headers.values()].some(v => v.includes(SIGNING_KEY.slice(2))),
    "302 · the signing key is in no part of the answer");
  check(ctx.headers.get("cache-control") === "private, no-store", "302a · and the context is not cacheable");

  delete process.env.WORLD_SIGNING_KEY;
  check((await keep(await ask(`?payer=${WALLET_A}`))).status === 503, "303 · with no signing key the route answers 503 rather than signing with nothing");
  process.env.WORLD_SIGNING_KEY = SIGNING_KEY;

  // Every file that could reach a browser, and the one server file that may hold
  // the name. Walked rather than listed, so a client file added later is covered.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const clientFiles = walk("app").filter(f => /^\s*"use client";/m.test(readFileSync(f, "utf8"))).concat(["lib/agent/browser.ts"]);
  const naming = clientFiles.filter(f => readFileSync(f, "utf8").includes("WORLD_SIGNING_KEY"));
  check(clientFiles.length >= 2 && naming.length === 0, `304 · no client file names the signing key's variable (${clientFiles.length} walked, ${naming.join(", ") || "none"})`);
  check(readFileSync("lib/human/worldid.ts", "utf8").includes("WORLD_SIGNING_KEY"), "304a · while the server module does (positive control)");

  /*
   * The verify route: bound to the wallet, forwarded unmodified, recorded once.
   */
  check((await keep(await post({ payer: "nonsense", result: resultFor(WALLET_A) }))).status === 400, "305 · a payer that is not an address is refused");
  check((await keep(await post({ payer: WALLET_A }))).status === 400, "305a · and so is a body with no result");
  check(state.calls.length === 0, "305b · neither reached the verifier");

  const planted = resultFor(WALLET_A);
  const accepted = await keep(await post({ payer: WALLET_A, result: planted }));
  const acceptedBody = (await accepted.clone().json()) as Record<string, unknown>;
  check(accepted.status === 200 && acceptedBody.state === "registered" && acceptedBody.source === "worldid",
    `306 · a result bound to the wallet named is accepted as registered by World ID (${accepted.status} ${JSON.stringify(acceptedBody)})`);
  check(acceptedBody.credential === "proof_of_human", "306a · and names the credential the verifier answered with");
  check(state.calls.length === 1, "306b · through exactly one call to the verifier");
  check(state.calls[0]?.url === `${VERIFY_ORIGIN}/api/v4/verify/${ENV.WORLD_RP_ID}`, `306c · at the version 4 path under the relying party (${state.calls[0]?.url})`);
  check(state.calls[0]?.headers["content-type"] === "application/json", "306d · as json");
  check(JSON.stringify(JSON.parse(state.calls[0]?.body ?? "{}")) === JSON.stringify(planted),
    "306e · and the body it received is the result as posted, no field added, dropped or rewritten");
  check(table.rows.size === 1 && table.rows.get(WALLET_A.toLowerCase())?.credential === "proof_of_human", "306f · one row, for the lowercased wallet");
  const row = table.rows.get(WALLET_A.toLowerCase());
  check(row?.nullifierDigest === deriveIdentifier(BigInt(NULLIFIER), ENV), "306g · holding the keyed digest of the nullifier, the derivation the cap already uses");
  check(row?.expiresAt.getTime() === T0.getTime() + 30 * 86_400_000, "306h · and lapsing thirty days after it was made, the period the notice declares");
  check(accepted.headers.get("cache-control") === "private, no-store", "306i · not cacheable");

  // The same result, posted under another wallet. Refused before the forward:
  // the fake's count is the evidence.
  const other = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_A, {}, "nonce-b") }));
  check(other.status === 403 && ((await other.clone().json()) as { error: string }).error === OTHER_WALLET,
    `307 · a result bound to another wallet is refused (${other.status})`);
  check(state.calls.length === 1, "307a · and never forwarded");
  check(table.rows.size === 1, "307b · and writes no row");
  const unbound = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_B, { responses: [{ ...resultFor(WALLET_B).responses[0], signal_hash: undefined }] }, "nonce-c") }));
  check(unbound.status === 400 && state.calls.length === 1, `307c · a result carrying no signal at all is refused too (${unbound.status})`);
  // A `signal` field in the body is not consulted: the binding is the address.
  const smuggled = await keep(await post({ payer: WALLET_B, result: resultFor(WALLET_A, { signal: WALLET_B.toLowerCase() }, "nonce-d") }));
  check(smuggled.status === 403 && state.calls.length === 1, "307d · a body naming its own signal does not move the binding");
  const textForm = resultFor(WALLET_B, { responses: [{ ...resultFor(WALLET_B, {}, "nonce-e").responses[0], signal_hash: signalHashesFor(WALLET_B)[1] }] }, "nonce-e");
  state.nullifier = NULLIFIER_2;
  const asText = await keep(await post({ payer: WALLET_B, result: textForm }));
  check(asText.status === 200 && state.calls.length === 2,
    `307e · the wallet hashed as text is the same binding, until a real result says which encoding World App uses (negative control, ${asText.status} ${await asText.clone().text()})`);
  state.nullifier = NULLIFIER;
  check(signalHashesFor(RECORDING)[0] === "0x00151c582efed6bc3f5dc56e31c4bf48c758c6b35a6dcba3dd6abf2d825e1527",
    "307f · the bytes hash of the recording wallet is the value the widget's wasm was measured producing");
  check(signalHashesFor(RECORDING)[0] !== signalHashesFor(RECORDING)[1] && signalHashesFor(RECORDING)[0] !== signalHashesFor(WALLET_A)[0],
    "307g · the two encodings differ from each other and from another wallet's (negative control)");

  // Replay. The same result twice, then the same proof under a fresh nonce.
  const callsBefore = state.calls.length;
  const replay = await keep(await post({ payer: WALLET_A, result: planted }));
  check(replay.status === 409 && ((await replay.clone().json()) as { error: string }).error === ALREADY_USED, `308 · the same result posted twice is refused the second time (${replay.status})`);
  check(state.calls.length === callsBefore, `308a · with the verifier's count unmoved (${state.calls.length})`);
  const editedNonce = await keep(await post({ payer: WALLET_A, result: { ...planted, nonce: "nonce-edited" } }));
  check(editedNonce.status === 409 && state.calls.length === callsBefore, "308b · and the same proof under an edited nonce is the same replay");
  const fresh = resultFor(WALLET_A, { responses: [{ ...planted.responses[0], proof: planted.responses[0].proof.map((p: string) => p.replace("11", "99")) }] }, "nonce-fresh");
  clock = new Date(T0.getTime() + 3_600_000);
  const rowsBefore = table.rows.size;
  const again = await keep(await post({ payer: WALLET_A, result: fresh }));
  check(again.status === 200 && table.rows.size === rowsBefore, `309 · a fresh result for the same wallet is accepted and adds no row (${again.status}, ${table.rows.size} rows)`);
  check(table.rows.get(WALLET_A.toLowerCase())?.verifiedAt.getTime() === clock.getTime(), "309a · with the times moved to the new result");
  clock = T0;

  // One wallet per person, and one person per wallet.
  const second = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-second") }));
  check(second.status === 409 && ((await second.clone().json()) as { error: string }).error === ANOTHER_WALLET,
    `310 · a second wallet from the same person is refused with the fixed sentence (${second.status})`);
  check(table.rows.size === 2 && !table.rows.has(WALLET_C.toLowerCase()), "310a · and gets no row");
  // A third person, who holds no wallet yet, so only the second rule can fire.
  state.nullifier = `0x${"9e".repeat(32)}`;
  const taken = await keep(await post({ payer: WALLET_A, result: resultFor(WALLET_A, {}, "nonce-taken") }));
  check(taken.status === 409 && ((await taken.clone().json()) as { error: string }).error === ANOTHER_PERSON,
    `310b · a wallet enrolled behind one person is not handed to another while it stands (${taken.status})`);
  state.nullifier = NULLIFIER;

  // The verifier saying no, and the verifier not answering.
  state.mode = "refuse";
  const refused = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-refused") }));
  check(refused.status === 400 && /refused: all_verifications_failed/.test(((await refused.clone().json()) as { error: string }).error),
    `311 · a result the verifier refuses is refused with its code word (${refused.status})`);
  const refusedAgain = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-refused") }));
  check(refusedAgain.status === 409, "311a · and stays used: the same result is not forwarded a second time");
  state.mode = "throw";
  const down = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }));
  check(down.status === 503, `311b · a verifier that cannot be reached is 503 (${down.status})`);
  state.mode = "outage";
  check((await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }))).status === 503, "311c · and so is one answering 5xx");
  state.mode = "accept";
  state.nullifier = `0x${"7c".repeat(32)}`;
  check((await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, {}, "nonce-down") }))).status === 200,
    "311d · while the result it never saw can be posted again once it answers (negative control for 311a)");
  state.nullifier = NULLIFIER;
  const wrongAction2 = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { action: "other-action" }, "nonce-action") }));
  const wrongEnv = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { environment: "production" }, "nonce-env") }));
  check(wrongAction2.status === 400 && wrongEnv.status === 400, "311e · another action or the other environment is refused before the forward");
  const callsAtLegacy = state.calls.length;
  const legacy = await keep(await post({ payer: WALLET_C, result: resultFor(WALLET_C, { protocol_version: "3.0" }, "nonce-legacy") }));
  check(legacy.status === 400 && state.calls.length === callsAtLegacy, `311f · a version 3 result is refused too, since its nullifier is another value for the same person (${legacy.status})`);

  /*
   * The registration read, four combinations, and the source named.
   */
  const bodyOf = async (payer: string) => (await (await keep(await read(payer))).json()) as Record<string, unknown>;
  const fromTable = await bodyOf(WALLET_A);
  check(fromTable.state === "registered" && fromTable.source === "worldid" && fromTable.credential === "proof_of_human",
    `312 · a wallet AgentBook does not know and the table does is registered by World ID (${JSON.stringify(fromTable)})`);
  const unknown = await bodyOf("0x9999999999999999999999999999999999999999");
  check(unknown.state === "not-registered" && unknown.source === null && unknown.credential === null, `312a · in neither is not registered (${JSON.stringify(unknown)})`);
  const onChain = await bodyOf(RECORDING);
  check(onChain.state === "registered" && onChain.source === "agentbook", `312b · the recording wallet is registered by AgentBook (${JSON.stringify(onChain)})`);
  registry.mode = "throws";
  check((await bodyOf(WALLET_A)).source === "worldid", "312c · a chain that does not answer does not hide a row the table holds");
  check((await bodyOf("0x9999999999999999999999999999999999999999")).state === "unread", "312d · and with no row either it is unread, not not registered");
  registry.reset();
  // A wallet in both answers AgentBook, stated: enrol the recording wallet too.
  state.nullifier = `0x${"8d".repeat(32)}`;
  await keep(await post({ payer: RECORDING, result: resultFor(RECORDING, {}, "nonce-recording") }));
  state.nullifier = NULLIFIER;
  check((await bodyOf(RECORDING)).source === "agentbook", "312e · a wallet in both sources answers AgentBook");
  table.rows.delete(RECORDING.toLowerCase());

  /*
   * Both routes capped, on one counter, seen red with the clock.
   */
  enrollmentThrottle.reset();
  const CAPPED = "0x4444444444444444444444444444444444444444";
  let last: Response = new Response(null);
  for (let i = 0; i < ENROLLMENT_CALLS_PER_MINUTE; i++) last = await keep(await ask(`?payer=${CAPPED}`));
  check(last.status === 200, `316 · the ${ENROLLMENT_CALLS_PER_MINUTE}th request in a minute is answered`);
  const over = await keep(await ask(`?payer=${CAPPED}`));
  check(over.status === 429 && Number(over.headers.get("retry-after")) >= 1, `316a · the next is 429 with a retry-after (${over.status}, ${over.headers.get("retry-after")})`);
  const callsAtCap = state.calls.length;
  const overPost = await keep(await post({ payer: CAPPED, result: resultFor(CAPPED, {}, "nonce-capped") }));
  check(overPost.status === 429 && state.calls.length === callsAtCap, "316b · and the verify route shares the counter, so it is 429 too and nothing is forwarded");
  clock = new Date(T0.getTime() + ENROLLMENT_WINDOW_MS + 1);
  check((await keep(await ask(`?payer=${CAPPED}`))).status === 200, "316c · a minute later the same wallet is answered again (negative control)");
  check((await keep(await ask(`?payer=${WALLET_B}`))).status === 200, "316d · and another wallet was never held (negative control)");
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
  check(leaks.length === 0, `317 · the nullifier, its decimal form and its unkeyed keccak appear in no response body or header (${wires.length} responses, ${leaks.length} hits)`);
  const inLogs = needles.filter(n => logged.some(l => l.toLowerCase().includes(n.toLowerCase())));
  check(inLogs.length === 0, `317a · nor in anything the routes logged (${logged.length} lines)`);
  const storedRows = JSON.stringify([...table.rows.values()]);
  const inRows = needles.filter(n => storedRows.toLowerCase().includes(n.toLowerCase()));
  check(inRows.length === 0 && table.rows.size > 0, `317b · nor in any stored row (${table.rows.size} rows, ${inRows.length} hits)`);
  check(state.calls.some(c => c.body.includes(NULLIFIER)), "317c · while it did travel on the one wire the protocol requires, the verify call (control)");
  check(served.some(s => s.includes(WALLET_A.toLowerCase())) || served.some(s => s.includes("registered")), "317d · and the sweep read real answers, not an empty list (control)");

  const example = readFileSync(".env.example", "utf8");
  const names = ["NEXT_PUBLIC_WORLD_APP_ID", "WORLD_RP_ID", "NEXT_PUBLIC_WORLD_ACTION", "NEXT_PUBLIC_WORLD_ENVIRONMENT", "WORLD_SIGNING_KEY"];
  const missing = names.filter(n => !new RegExp(`^${n}=`, "m").test(example));
  check(missing.length === 0, `319 · the example names the five World variables (${missing.join(", ") || "none missing"})`);
  check(!/ONBOARDING_ALLOW_UNREGISTERED/.test(example) && !/ONBOARDING_ALLOW_UNREGISTERED/.test(readFileSync("app/api/agent/registration/route.ts", "utf8")),
    "319a · and the flag the enrollment replaces is read by nothing and named nowhere");

  // The wording of what the routes serve, held to the rule the audit plan states.
  const servedText = served.join("\n");
  check(!/verified person|verified human|World verified|identifies nobody/i.test(servedText), "319b · nothing served predicates verified of the person");

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
