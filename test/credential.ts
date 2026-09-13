import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GET as registrationGET, POST as registrationPOST } from "../app/api/agent/registration/route";
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
import { setCapForTest } from "../lib/human/cap";
import { setClockForTest } from "../lib/human/clock";
import { setRegistryForTest } from "../lib/human/registry";
import { enrollmentThrottle } from "../lib/human/throttle";
import { type Verifier, enrolmentMessage, setVerifierForTest, signalHashFor } from "../lib/human/worldid";
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
  return { byPayer: async payer => rowsByPayer[payer] ?? null, requestLabel: unused, release: unused, pending: unused, markIssued: unused };
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

export async function credentialChecks(check: Check) {
  console.log("\n  the credential an enrolled wallet proposes with");

  const before: Record<string, string | undefined> = {};
  for (const k of [...Object.keys(ENV), "XOVI_INGEST_URL"]) before[k] = process.env[k];
  Object.assign(process.env, ENV);

  /* The two pieces the module rests on, without a route around them. */
  const { ciphertext, nonce } = encryptCredential("xvi_0123456789ab_the-secret-part", ENV);
  check(decryptCredential({ ciphertext, nonce }, ENV) === "xvi_0123456789ab_the-secret-part", "360 · a credential encrypts and decrypts under the key");
  check(!ciphertext.includes("the-secret-part") && !Buffer.from(ciphertext, "hex").toString("utf8").includes("secret"), "360a · and the ciphertext does not carry the plaintext");
  check(/^[0-9a-f]{24}$/.test(nonce) && encryptCredential("x", ENV).nonce !== encryptCredential("x", ENV).nonce, "360b · the nonce is twelve fresh bytes per call");
  let wrongKey = false;
  try { decryptCredential({ ciphertext, nonce }, { CREDENTIAL_KEY: "e".repeat(64) }); } catch { wrongKey = true; }
  check(wrongKey, "360c · another key does not open it");
  let noKey = false;
  try { encryptCredential("x", {}); } catch (e) { noKey = e instanceof NoCredentialKey; }
  check(noKey, "360d · and no key refuses rather than encrypting under nothing");

  /* The routes, against every fake. */
  const mint = await startFakeMint(ENV.INGEST_MINT_SECRET);
  const ingest = await startFakeIngest();
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
  setClockForTest(() => T0);
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
  check(enrolled.status === 200 && enrolledBody.agentCredential === "issued", `361 · an enrolment answers registered with the credential issued (${enrolled.status} ${JSON.stringify(enrolledBody)})`);
  check(mint.calls.length === 1, `361a · the mint was called once (${mint.calls.length})`);
  check(mint.calls[0]?.authorization === `Bearer ${ENV.INGEST_MINT_SECRET}` && mint.calls[0]?.contentType === "application/json", "361b · with the secret as a bearer, as json");
  check(mintedTo[0] === new URL(MINT_PATH, new URL(ingest.url).origin).toString(), `361i · at the mint path under the ingest url's origin (${mintedTo[0]})`);
  check(Object.keys(mint.calls[0]?.body ?? {}).sort().join(",") === "agentAddress,label", `361c · and a body of exactly the address and a label (${Object.keys(mint.calls[0]?.body ?? {}).sort().join(",")})`);
  check(mint.calls[0]?.body.agentAddress === getAddress(WALLET_A) && mint.calls[0]?.body.label === getAddress(WALLET_A), "361d · the address checksummed, and the label the address when the wallet has no name");
  const row = credentials.rows.get(WALLET_A.toLowerCase());
  const mintedForA = [...mint.keys.entries()].find(([, addr]) => addr === WALLET_A.toLowerCase())?.[0];
  check(row !== undefined && mintedForA !== undefined && row.keyPrefix === mintedForA.split("_")[1], "361e · one row, for the lowercased wallet, carrying the prefix the mint answered");
  // Wrapped: a row holding something that is not a ciphertext makes the decrypt
  // throw, and that regression must print one red line rather than abort the run.
  const opened = (() => { try { return row ? decryptCredential(row, ENV) : null; } catch { return null; } })();
  check(mintedForA !== undefined && opened === mintedForA, "361f · whose ciphertext decrypts to the credential the mint returned");
  const secretPart = mintedForA?.split("_")[2] ?? "";
  // Readable includes hex: a row holding the credential as hex is a row holding
  // the credential, so the ciphertext is decoded before it is searched.
  const rowText = JSON.stringify(row) + Buffer.from(row?.ciphertext ?? "", "hex").toString("utf8");
  check(secretPart.length > 0 && !rowText.includes(secretPart), "361g · and nothing readable of it sits in the row, decoded or not");
  check(row?.mintedAt.getTime() === T0.getTime(), "361h · minted at the clock's time");

  const again = await enrol(KEYS.a);
  check(again.status === 200 && ((await again.clone().json()) as { agentCredential: string }).agentCredential === "issued" && mint.calls.length === 1,
    `362 · a second enrolment of the same wallet mints nothing and still answers issued (${again.status}, ${mint.calls.length} calls)`);

  const named = await enrol(KEYS.b);
  check(named.status === 200 && mint.calls[1]?.body.label === "agent7.xovi.eth" && mint.calls[1]?.body.agentAddress === getAddress(WALLET_B),
    `363 · a wallet with a name in the table is minted under that name (${String(mint.calls[1]?.body.label)})`);

  // The AgentBook path: the first read that finds no row mints.
  const callsBeforeRead = mint.calls.length;
  const first = await read(REC);
  check(first.state === "registered" && first.source === "agentbook" && first.agentCredential === "issued" && mint.calls.length === callsBeforeRead + 1,
    `364 · a wallet AgentBook knows is minted a credential on the first read without one (${JSON.stringify(first)}, ${mint.calls.length - callsBeforeRead} calls)`);
  const second = await read(REC);
  check(second.agentCredential === "issued" && mint.calls.length === callsBeforeRead + 1, "364a · and the next read makes no call");
  const stranger = await read("0x9999999999999999999999999999999999999999");
  check(stranger.state === "not-registered" && stranger.agentCredential === "none" && mint.calls.length === callsBeforeRead + 1,
    `364b · a wallet in neither source is minted nothing (${JSON.stringify(stranger)})`);
  check(Object.keys(first).sort().join(",") === "agentCredential,credential,source,state", `364c · the read answers four names (${Object.keys(first).sort().join(",")})`);

  // Every way the mint can fail leaves the enrolment as it is.
  const callsBeforeFail = mint.calls.length;
  delete process.env.INGEST_MINT_SECRET;
  const unconfigured = await enrol(KEYS.c);
  check(unconfigured.status === 200 && ((await unconfigured.clone().json()) as { agentCredential: string }).agentCredential === "none" && mint.calls.length === callsBeforeFail,
    `365 · with no secret the enrolment stands and no credential is issued, no call made (${unconfigured.status})`);
  process.env.INGEST_MINT_SECRET = "the-wrong-secret";
  const refused = await read(WALLET_C);
  check(refused.state === "registered" && refused.agentCredential === "none" && mint.calls.length === callsBeforeFail + 1 && !credentials.rows.has(WALLET_C.toLowerCase()),
    `365a · a refused mint is none, with no row (${JSON.stringify(refused)})`);
  process.env.INGEST_MINT_SECRET = ENV.INGEST_MINT_SECRET;
  mint.prefixOnly = true;
  const prefixOnly = await read(WALLET_C);
  check(prefixOnly.agentCredential === "none" && !credentials.rows.has(WALLET_C.toLowerCase()), "365b · a prefix alone, the answer for a credential minted before, stores nothing and is none");
  mint.prefixOnly = false;
  check((await read(WALLET_C)).agentCredential === "issued" && credentials.rows.has(WALLET_C.toLowerCase()), "365c · and the next read that gets a credential stores it (negative control)");
  // The one failure that loses a credential for good: minted, and the row would
  // not write. Logged with the wallet and the prefix so an operator can re-mint,
  // and with nothing an attacker could present.
  const lost = privateKeyToAccount(`0x${"e6".repeat(32)}`);
  credentials.refuseNext = true;
  const lostEnrol = await enrol(lost);
  const lostLine = logged.find(l => l.includes(lost.address.toLowerCase())) ?? "";
  const lostKey = [...mint.keys.entries()].find(([, addr]) => addr === lost.address.toLowerCase())?.[0] ?? "";
  check(lostEnrol.status === 200 && ((await lostEnrol.clone().json()) as { agentCredential: string }).agentCredential === "none" && !credentials.rows.has(lost.address.toLowerCase()),
    "365d · a row that would not write leaves the enrolment standing with no credential");
  check(lostKey !== "" && lostLine.includes(lostKey.split("_")[1]) && !lostLine.includes(lostKey.split("_")[2]) && /re-mint/.test(lostLine),
    `365e · and is logged with the prefix and the way out, never the credential (${lostLine.slice(0, 60)}…)`);

  /* The sweep: the secret and every credential reach nothing this serves. */
  const served: string[] = [];
  for (const r of wires) served.push(await r.text(), ...[...r.headers.entries()].map(([k, v]) => `${k}: ${v}`));
  const needles = [ENV.INGEST_MINT_SECRET, ...[...mint.keys.keys()].map(k => k.split("_")[2])];
  const hits = needles.filter(n => served.some(s => s.includes(n)) || logged.some(l => l.includes(n)) || false);
  check(hits.length === 0 && needles.length >= 4, `367 · the mint secret and every minted credential appear in no answer, no log line and no run stream (${wires.length} answers, ${logged.length} lines, ${needles.length} needles)`);
  check(mint.calls.every(c => c.authorization === `Bearer ${ENV.INGEST_MINT_SECRET}` || c.authorization === "Bearer the-wrong-secret"), "367a · while the secret did travel to the mint and only there (control)");
  check(logged.some(l => /prefix/.test(l)) && !logged.some(l => /xvi_[0-9a-f]{12}_/.test(l)), "367b · a failed mint logs the wallet and the prefix, never a credential");

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const clientFiles = walk("app").filter(f => /^\s*"use client";/m.test(readFileSync(f, "utf8"))).concat(["lib/agent/browser.ts"]);
  const naming = clientFiles.filter(f => /INGEST_MINT_SECRET|CREDENTIAL_KEY/.test(readFileSync(f, "utf8")));
  check(clientFiles.length >= 2 && naming.length === 0, `368 · no client file names the mint secret or the credential key (${clientFiles.length} walked)`);
  check(/INGEST_MINT_SECRET/.test(readFileSync("lib/agent/credentials.ts", "utf8")) && /CREDENTIAL_KEY/.test(readFileSync("lib/agent/credentials.ts", "utf8")), "368a · while the server module names both (control)");

  const migration = "sql/0008_credentials.sql";
  const ddl = existsSync(migration) ? readFileSync(migration, "utf8").replace(/^\s*--.*$/gm, "") : "";
  const columns = [...(ddl.match(/CREATE TABLE IF NOT EXISTS credentials \(([\s\S]*?)\);/)?.[1] ?? "").matchAll(/^\s+([a-z_]+)\s/gm)].map(m => m[1]);
  check(columns.join(",") === "payer,ciphertext,nonce,key_prefix,minted_at", `369 · migration 0008 holds the wallet, the ciphertext, the nonce, the prefix and the time (${columns.join(",")})`);
  check(!/^\s+(key|credential|plaintext)\s/m.test(ddl) && /PRIMARY KEY/.test(ddl), "369a · no column for the credential itself, and the wallet is the key");
  const example = readFileSync(".env.example", "utf8");
  const missing = ["INGEST_MINT_SECRET", "CREDENTIAL_KEY"].filter(n => !new RegExp(`^${n}=`, "m").test(example));
  check(missing.length === 0, `369b · the example names the two variables (${missing.join(", ") || "none missing"})`);

  console.warn = real.warn;
  console.error = real.error;
  await mint.close();
  await ingest.close();
  setCredentialStoreForTest(undefined);
  setMinterForTest(undefined);
  setNamesStoreForTest(undefined);
  setVerifierForTest(undefined);
  setCapForTest(null);
  setRegistryForTest(undefined);
  setClockForTest(undefined);
  enrollmentThrottle.reset();
  for (const [k, v] of Object.entries(before)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
