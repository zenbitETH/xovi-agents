import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { GET as registrationGET, POST as registrationPOST } from "../app/api/agent/registration/route";
import { GET as windowsGET } from "../app/api/agent/windows/route";
import {
  type CredentialRow,
  type CredentialStore,
  MINT_PATH,
  NoCredentialKey,
  credentialFor,
  decryptCredential,
  encryptCredential,
  setCredentialStoreForTest,
  setMinterForTest,
} from "../lib/agent/credentials";
import { type NameRow, type NamesStore, setNamesStoreForTest } from "../lib/agent/names-store";
import { type RunStep, runOnce } from "../lib/agent/run";
import { setCapForTest } from "../lib/human/cap";
import { setClockForTest } from "../lib/human/clock";
import { MINT_BACKOFF_MS, resetMintBackoff } from "../lib/agent/credentials";
import { setRegistryForTest } from "../lib/human/registry";
import { enrollmentThrottle } from "../lib/human/throttle";
import { type Verifier, enrolmentMessage, setVerifierForTest, signalHashFor } from "../lib/human/worldid";
import { resetServerForTest } from "../lib/x402";
import { startFakeFacilitator } from "./facilitator";
import { HUMAN_A, fakeRegistry, fakeStore, fakeVerifications } from "./human";
import { startFakeIngest } from "./ingest";
import { startFakeMint } from "./mint";

type Check = (ok: boolean, label: string) => void;

/** Three wallets from scratch keys, and the one the environment's credential is
 *  said to belong to. AgentBook knows `REC` and nobody else. */
const KEYS = {
  a: privateKeyToAccount(`0x${"e1".repeat(32)}`),
  b: privateKeyToAccount(`0x${"e2".repeat(32)}`),
  c: privateKeyToAccount(`0x${"e3".repeat(32)}`),
  rec: privateKeyToAccount(`0x${"e4".repeat(32)}`),
};
const WALLET_A = KEYS.a.address;
const WALLET_B = KEYS.b.address;
const WALLET_C = KEYS.c.address;
const REC = KEYS.rec.address;
const ENV = {
  WORLD_RP_ID: "rp_0000000000000000",
  NEXT_PUBLIC_WORLD_APP_ID: "app_0000000000000000",
  NEXT_PUBLIC_WORLD_ACTION: "enrol-agent",
  NEXT_PUBLIC_WORLD_ENVIRONMENT: "staging",
  WORLD_SIGNING_KEY: `0x${"ab".repeat(32)}`,
  HUMAN_ID_KEY: "c".repeat(64),
  CREDENTIAL_KEY: "d".repeat(64),
  INGEST_MINT_SECRET: "mint-secret-for-the-checks",
};

function fakeCredentials() {
  const rows = new Map<string, CredentialRow>();
  const store: CredentialStore & { rows: Map<string, CredentialRow>; refuseNext: boolean } = {
    rows,
    refuseNext: false,
    byPayer: async payer => rows.get(payer) ?? null,
    put: async row => {
      if (store.refuseNext) {
        store.refuseNext = false;
        return false;
      }
      if (rows.has(row.payer)) return false;
      rows.set(row.payer, { ...row });
      return true;
    },
  };
  return store;
}

function fakeNames(rowsByPayer: Record<string, NameRow>): NamesStore {
  const unused = async (): Promise<never> => {
    throw new Error("not this check's job");
  };
  // `byLabel` arrived with the gateway, which reads a name the other way round.
  // These checks only ever ask by payer, so it answers rather than throwing: a fake
  // that threw here would fail a caller this check is not about.
  const byLabel = async (label: string): Promise<NameRow | null> => Object.values(rowsByPayer).find(r => r.label === label) ?? null;
  return { byPayer: async payer => rowsByPayer[payer] ?? null, byLabel, requestLabel: unused, release: unused, pending: unused, markIssued: unused };
}

let nonceCount = 0;
function resultFor(wallet: string) {
  const nonce = `nonce-cred-${++nonceCount}`;
  return {
    protocol_version: "4.0",
    nonce,
    action: "enrol-agent",
    environment: "staging",
    responses: [{
      identifier: "proof_of_human",
      signal_hash: signalHashFor(wallet),
      proof: [1, 2, 3, 4, 5].map(i => keccak256(new TextEncoder().encode(`${nonce}:${i}`))),
      nullifier: `0x${"7e".repeat(32)}`,
      issuer_schema_id: 1,
      expires_at_min: 1756166400,
    }],
    user_presence_completed: false,
  };
}

/** The browser's half of a run: the live challenge signed by one wallet's key. */
async function signAt(url: string, key: `0x${string}`): Promise<string | undefined> {
  const core = new x402Client();
  registerExactEvmScheme(core, { signer: privateKeyToAccount(key) });
  const http = new x402HTTPClient(core);
  const challenge = await windowsGET(new Request(url));
  if (challenge.status !== 402) return undefined;
  const body = await challenge.json().catch(() => ({}));
  const required = http.getPaymentRequiredResponse(n => challenge.headers.get(n), body);
  const payload = await http.createPaymentPayload(required);
  return (http.encodePaymentSignatureHeader(payload) as Record<string, string>)["PAYMENT-SIGNATURE"];
}

const windowsFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return windowsGET(new Request(url, init));
};

async function collect(gen: AsyncGenerator<RunStep>): Promise<RunStep[]> {
  const steps: RunStep[] = [];
  for await (const s of gen) steps.push(s);
  return steps;
}

export async function credentialChecks(check: Check) {
  console.log("\n  the credential an enrolled wallet proposes with");

  const before: Record<string, string | undefined> = {};
  for (const k of [...Object.keys(ENV), "XOVI_INGEST_URL", "XOVI_INGEST_KEY", "XOVI_INGEST_KEY_PAYER", "X402_PAY_TO", "X402_NETWORK", "X402_FACILITATOR_URL", "X402_PRICE", "WINDOWS_SNAPSHOT"]) before[k] = process.env[k];
  Object.assign(process.env, ENV);

  /* The two pieces the module rests on, without a route around them. */
  const { ciphertext, nonce } = encryptCredential("xvi_0123456789ab_the-secret-part", ENV);
  check(decryptCredential({ ciphertext, nonce }, ENV) === "xvi_0123456789ab_the-secret-part", "390 · a credential encrypts and decrypts under the key");
  check(!ciphertext.includes("the-secret-part") && !Buffer.from(ciphertext, "hex").toString("utf8").includes("secret"), "390a · and the ciphertext does not carry the plaintext");
  check(/^[0-9a-f]{24}$/.test(nonce) && encryptCredential("x", ENV).nonce !== encryptCredential("x", ENV).nonce, "390b · the nonce is twelve fresh bytes per call");
  let wrongKey = false;
  try { decryptCredential({ ciphertext, nonce }, { CREDENTIAL_KEY: "e".repeat(64) }); } catch { wrongKey = true; }
  check(wrongKey, "390c · another key does not open it");
  let noKey = false;
  try { encryptCredential("x", {}); } catch (e) { noKey = e instanceof NoCredentialKey; }
  check(noKey, "390d · and no key refuses rather than encrypting under nothing");

  /* The routes, against every fake. */
  const mint = await startFakeMint(ENV.INGEST_MINT_SECRET);
  const ingest = await startFakeIngest();
  const fac = await startFakeFacilitator();
  process.env.XOVI_INGEST_URL = ingest.url;
  const credentials = fakeCredentials();
  setCredentialStoreForTest(credentials);
  setNamesStoreForTest(fakeNames({ [WALLET_B]: { payer: WALLET_B, label: "agent7", requestedAt: "2026-09-13T00:00:00Z", issuedAt: null, txHash: null } }));
  // One person per wallet: the nullifier follows the signal the result carries,
  // so the same wallet enrolling twice is the same person and two wallets are two.
  const verifier: Verifier = async (_url, init) => {
    const signal = String(((JSON.parse(init.body) as { responses?: { signal_hash?: string }[] }).responses ?? [])[0]?.signal_hash ?? "");
    return Response.json({ success: true, action: "enrol-agent", nullifier: keccak256(new TextEncoder().encode(`person:${signal}`)), results: [{ identifier: "proof_of_human", success: true }] });
  };
  setVerifierForTest(verifier);
  // The mint fake is its own server; the module derives the mint url from the
  // ingest url's origin, so the seam records what it derived and delivers to the fake.
  const mintedTo: string[] = [];
  setMinterForTest(async (url, init) => {
    mintedTo.push(url);
    return fetch(mint.url, init);
  });
  const table = fakeVerifications();
  const registry = fakeRegistry({ [REC]: HUMAN_A });
  setCapForTest({ registry: registry.read, store: fakeStore(), verifications: table, freePerDay: 2 });
  const T0 = new Date("2026-09-13T12:00:00Z");
  let clock = T0;
  setClockForTest(() => clock);
  enrollmentThrottle.reset();

  const logged: string[] = [];
  const real = { warn: console.warn, error: console.error };
  console.warn = (...parts: unknown[]) => void logged.push(parts.map(String).join(" "));
  console.error = console.warn;
  const wires: Response[] = [];
  const keep = async (r: Response) => {
    wires.push(r.clone());
    return r;
  };
  const enrol = async (key: (typeof KEYS)["a"]) => {
    const result = resultFor(key.address);
    // One person per wallet in the fake table: each wallet its own nullifier.
    const signature = await key.signMessage({ message: enrolmentMessage(result.nonce) });
    return keep(await registrationPOST(new Request("http://127.0.0.1/api/agent/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payer: key.address, result, signature }) })));
  };
  const read = async (payer: string) => (await (await keep(await registrationGET(new Request(`http://127.0.0.1/api/agent/registration?payer=${payer}`)))).json()) as Record<string, unknown>;

  const enrolled = await enrol(KEYS.a);
  const enrolledBody = (await enrolled.clone().json()) as Record<string, unknown>;
  check(enrolled.status === 200 && enrolledBody.agentCredential === "issued", `391 · an enrolment answers registered with the credential issued (${enrolled.status} ${JSON.stringify(enrolledBody)})`);
  check(mint.calls.length === 1, `391a · the mint was called once (${mint.calls.length})`);
  check(mint.calls[0]?.authorization === `Bearer ${ENV.INGEST_MINT_SECRET}` && mint.calls[0]?.contentType === "application/json", "391b · with the secret as a bearer, as json");
  check(mintedTo[0] === new URL(MINT_PATH, new URL(ingest.url).origin).toString(), `391i · at the mint path under the ingest url's origin (${mintedTo[0]})`);
  check(Object.keys(mint.calls[0]?.body ?? {}).sort().join(",") === "agentAddress,label", `391c · and a body of exactly the address and a label (${Object.keys(mint.calls[0]?.body ?? {}).sort().join(",")})`);
  check(mint.calls[0]?.body.agentAddress === getAddress(WALLET_A) && mint.calls[0]?.body.label === getAddress(WALLET_A), "391d · the address checksummed, and the label the address when the wallet has no name");
  const row = credentials.rows.get(WALLET_A.toLowerCase());
  const mintedForA = [...mint.keys.entries()].find(([, addr]) => addr === WALLET_A.toLowerCase())?.[0];
  check(row !== undefined && mintedForA !== undefined && row.keyPrefix === mintedForA.split("_")[1], "391e · one row, for the lowercased wallet, carrying the prefix the mint answered");
  // Wrapped: a row holding something that is not a ciphertext makes the decrypt
  // throw, and that regression must print one red line rather than abort the run.
  const opened = (() => { try { return row ? decryptCredential(row, ENV) : null; } catch { return null; } })();
  check(mintedForA !== undefined && opened === mintedForA, "391f · whose ciphertext decrypts to the credential the mint returned");
  const secretPart = mintedForA?.split("_")[2] ?? "";
  // Readable includes hex: a row holding the credential as hex is a row holding
  // the credential, so the ciphertext is decoded before it is searched.
  const rowText = JSON.stringify(row) + Buffer.from(row?.ciphertext ?? "", "hex").toString("utf8");
  check(secretPart.length > 0 && !rowText.includes(secretPart), "391g · and nothing readable of it sits in the row, decoded or not");
  check(row?.mintedAt.getTime() === T0.getTime(), "391h · minted at the clock's time");

  const again = await enrol(KEYS.a);
  check(again.status === 200 && ((await again.clone().json()) as { agentCredential: string }).agentCredential === "issued" && mint.calls.length === 1,
    `392 · a second enrolment of the same wallet mints nothing and still answers issued (${again.status}, ${mint.calls.length} calls)`);

  const named = await enrol(KEYS.b);
  check(named.status === 200 && mint.calls[1]?.body.label === "agent7.xovi.eth" && mint.calls[1]?.body.agentAddress === getAddress(WALLET_B),
    `393 · a wallet with a name in the table is minted under that name (${String(mint.calls[1]?.body.label)})`);

  // The AgentBook path: the first read that finds no row mints.
  const callsBeforeRead = mint.calls.length;
  const first = await read(REC);
  check(first.state === "registered" && first.source === "agentbook" && first.agentCredential === "issued" && mint.calls.length === callsBeforeRead + 1,
    `394 · a wallet AgentBook knows is minted a credential on the first read without one (${JSON.stringify(first)}, ${mint.calls.length - callsBeforeRead} calls)`);
  const second = await read(REC);
  check(second.agentCredential === "issued" && mint.calls.length === callsBeforeRead + 1, "394a · and the next read makes no call");
  const stranger = await read("0x9999999999999999999999999999999999999999");
  check(stranger.state === "not-registered" && stranger.agentCredential === "none" && mint.calls.length === callsBeforeRead + 1,
    `394b · a wallet in neither source is minted nothing (${JSON.stringify(stranger)})`);
  check(Object.keys(first).sort().join(",") === "agentCredential,credential,source,state", `394c · the read answers four names (${Object.keys(first).sort().join(",")})`);

  // Every way the mint can fail leaves the enrolment as it is.
  const callsBeforeFail = mint.calls.length;
  delete process.env.INGEST_MINT_SECRET;
  const unconfigured = await enrol(KEYS.c);
  check(unconfigured.status === 200 && ((await unconfigured.clone().json()) as { agentCredential: string }).agentCredential === "none" && mint.calls.length === callsBeforeFail,
    `395 · with no secret the enrolment stands and no credential is issued, no call made (${unconfigured.status})`);
  process.env.INGEST_MINT_SECRET = "the-wrong-secret";
  const refused = await read(WALLET_C);
  check(refused.state === "registered" && refused.agentCredential === "none" && mint.calls.length === callsBeforeFail + 1 && !credentials.rows.has(WALLET_C.toLowerCase()),
    `395a · a refused mint is none, with no row (${JSON.stringify(refused)})`);
  process.env.INGEST_MINT_SECRET = ENV.INGEST_MINT_SECRET;
  mint.prefixOnly = true;
  const prefixOnly = await read(WALLET_C);
  check(prefixOnly.agentCredential === "none" && !credentials.rows.has(WALLET_C.toLowerCase()), "395b · a prefix alone, the answer for a credential minted before, stores nothing and is none");
  mint.prefixOnly = false;
  /*
   * THE BACKOFF STANDS BETWEEN THE FAILURE AND THE NEXT ATTEMPT.
   *
   * A refused mint is remembered for this wallet, so the reads between here and
   * the end of that window are answered from memory rather than by calling a
   * service that has just said no. This check used to read again immediately; it
   * moves the clock past the window instead, which is the behaviour and not a
   * convenience.
   */
  const callsWhileBackingOff = mint.calls.length;
  check((await read(WALLET_C)).agentCredential === "none" && mint.calls.length === callsWhileBackingOff,
    "395c · a read inside the backoff window is answered without calling the mint again");
  clock = new Date(T0.getTime() + MINT_BACKOFF_MS + 1);
  check((await read(WALLET_C)).agentCredential === "issued" && credentials.rows.has(WALLET_C.toLowerCase()),
    "395c2 · and the first read past it gets a credential and stores it (negative control)");
  clock = T0;
  resetMintBackoff();
  // The one failure that loses a credential for good: minted, and the row would
  // not write. Logged with the wallet and the prefix so an operator can re-mint,
  // and with nothing an attacker could present.
  const lost = privateKeyToAccount(`0x${"e6".repeat(32)}`);
  credentials.refuseNext = true;
  const lostEnrol = await enrol(lost);
  const lostLine = logged.find(l => l.includes(lost.address.toLowerCase())) ?? "";
  const lostKey = [...mint.keys.entries()].find(([, addr]) => addr === lost.address.toLowerCase())?.[0] ?? "";
  check(lostEnrol.status === 200 && ((await lostEnrol.clone().json()) as { agentCredential: string }).agentCredential === "none" && !credentials.rows.has(lost.address.toLowerCase()),
    "395d · a row that would not write leaves the enrolment standing with no credential");
  check(lostKey !== "" && lostLine.includes(lostKey.split("_")[1]) && !lostLine.includes(lostKey.split("_")[2]) && /re-mint/.test(lostLine),
    `395e · and is logged with the prefix and the way out, never the credential (${lostLine.slice(0, 60)}…)`);

  /* The run, under the wallet's own credential. */
  process.env.X402_PAY_TO = "0x000000000000000000000000000000000000dEaD";
  process.env.X402_NETWORK = "eip155:84532";
  process.env.X402_FACILITATOR_URL = fac.url;
  process.env.X402_PRICE = "$0.01";
  process.env.WINDOWS_SNAPSHOT = "fixtures/windows.synthetic.jsonl";
  resetServerForTest();
  fac.reset();
  fac.transaction = `0x${"ab".repeat(32)}`;
  ingest.reset();
  const WINDOWS = "http://127.0.0.1/api/agent/windows";
  const own = (payer: string) => credentialFor(payer, credentials, ENV);
  const runAs = async (key: `0x${string}`, over: Record<string, unknown> = {}) =>
    collect(runOnce({ windowsUrl: WINDOWS, paymentHeader: await signAt(WINDOWS, key), windowsFetch, ingestUrl: ingest.url, credentialFor: own, ingestFetch: fetch, ...over }));

  const runA = await runAs(`0x${"e1".repeat(32)}`);
  check(runA.some(s => s.step === "proposed"), `396 · a run paid by an enrolled wallet proposes (${runA.map(s => s.step).join(", ")})`);
  check(ingest.presented.length === 1 && ingest.presented[0] === mintedForA, "396a · presenting that wallet's own credential to the ingest route");
  check(mint.keys.get(ingest.presented[0] ?? "") === WALLET_A.toLowerCase(), "396b · so the submitter the credential binds is the payer");
  check(!JSON.stringify(runA).includes(secretPart), "396c · and the credential appears nowhere in the streamed run");

  ingest.reset();
  const noneKey = privateKeyToAccount(`0x${"e5".repeat(32)}`);
  const runNone = await runAs(`0x${"e5".repeat(32)}`, { ingestKey: "k-env", ingestKeyPayer: REC });
  check(runNone.some(s => s.step === "not-submitted" && s.reason === "no-credential") && !runNone.some(s => s.step === "proposed") && ingest.hits === 0,
    `396d · a wallet with no credential stops at not submitted, for want of a credential, and nothing reaches the ingest (${noneKey.address.slice(0, 8)})`);
  ingest.reset();
  const runRec = await runAs(`0x${"e4".repeat(32)}`, { ingestKey: "k-env", ingestKeyPayer: REC, credentialFor: async () => null });
  check(runRec.some(s => s.step === "proposed") && ingest.presented[0] === "k-env", "396e · the environment's credential is presented for the one wallet it belongs to (negative control)");
  ingest.reset();
  const runOther = await runAs(`0x${"e5".repeat(32)}`, { ingestKey: "k-env" });
  check(!runOther.some(s => s.step === "proposed") && ingest.hits === 0, "396f · and for nobody when the wallet it belongs to is not named");
  ingest.reset();
  const runUnconfigured = await runAs(`0x${"e1".repeat(32)}`, { ingestUrl: undefined });
  check(runUnconfigured.some(s => s.step === "not-submitted" && s.reason === "unconfigured"), "396g · no ingest url is the other reason, told apart from a missing credential");

  /* The sweep: the secret and every credential reach nothing this serves. */
  const served: string[] = [];
  for (const r of wires) served.push(await r.text(), ...[...r.headers.entries()].map(([k, v]) => `${k}: ${v}`));
  const needles = [ENV.INGEST_MINT_SECRET, ...[...mint.keys.keys()].map(k => k.split("_")[2])];
  const hits = needles.filter(n => served.some(s => s.includes(n)) || logged.some(l => l.includes(n)) || JSON.stringify([runA, runNone, runRec]).includes(n));
  check(hits.length === 0 && needles.length >= 4, `397 · the mint secret and every minted credential appear in no answer, no log line and no run stream (${wires.length} answers, ${logged.length} lines, ${needles.length} needles)`);
  check(mint.calls.every(c => c.authorization === `Bearer ${ENV.INGEST_MINT_SECRET}` || c.authorization === "Bearer the-wrong-secret"), "397a · while the secret did travel to the mint and only there (control)");
  check(logged.some(l => /prefix/.test(l)) && !logged.some(l => /xvi_[0-9a-f]{12}_/.test(l)), "397b · a failed mint logs the wallet and the prefix, never a credential");

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const clientFiles = walk("app").filter(f => /^\s*"use client";/m.test(readFileSync(f, "utf8"))).concat(["lib/agent/browser.ts"]);
  const naming = clientFiles.filter(f => /INGEST_MINT_SECRET|CREDENTIAL_KEY/.test(readFileSync(f, "utf8")));
  check(clientFiles.length >= 2 && naming.length === 0, `398 · no client file names the mint secret or the credential key (${clientFiles.length} walked)`);
  check(/INGEST_MINT_SECRET/.test(readFileSync("lib/agent/credentials.ts", "utf8")) && /CREDENTIAL_KEY/.test(readFileSync("lib/agent/credentials.ts", "utf8")), "398a · while the server module names both (control)");

  const migration = "sql/0008_credentials.sql";
  const ddl = existsSync(migration) ? readFileSync(migration, "utf8").replace(/^\s*--.*$/gm, "") : "";
  const columns = [...(ddl.match(/CREATE TABLE IF NOT EXISTS credentials \(([\s\S]*?)\);/)?.[1] ?? "").matchAll(/^\s+([a-z_]+)\s/gm)].map(m => m[1]);
  check(columns.join(",") === "payer,ciphertext,nonce,key_prefix,minted_at", `399 · migration 0008 holds the wallet, the ciphertext, the nonce, the prefix and the time (${columns.join(",")})`);
  check(!/^\s+(key|credential|plaintext)\s/m.test(ddl) && /PRIMARY KEY/.test(ddl), "399a · no column for the credential itself, and the wallet is the key");
  const example = readFileSync(".env.example", "utf8");
  const missing = ["INGEST_MINT_SECRET", "CREDENTIAL_KEY", "XOVI_INGEST_KEY_PAYER"].filter(n => !new RegExp(`^${n}=`, "m").test(example));
  check(missing.length === 0, `399b · the example names the three variables (${missing.join(", ") || "none missing"})`);

  console.warn = real.warn;
  console.error = real.error;
  await mint.close();
  await ingest.close();
  await fac.close();
  setCredentialStoreForTest(undefined);
  setMinterForTest(undefined);
  setNamesStoreForTest(undefined);
  setVerifierForTest(undefined);
  setCapForTest(null);
  setRegistryForTest(undefined);
  setClockForTest(undefined);
  enrollmentThrottle.reset();
  resetServerForTest();
  for (const [k, v] of Object.entries(before)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
