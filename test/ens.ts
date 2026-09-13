import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  encodePacked,
  getAddress,
  http,
  keccak256,
  namehash,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";
import { GET as gatewayGET, OPTIONS as gatewayOPTIONS } from "../app/api/ens/[sender]/[data]/route";
import { type NameRow, type NamesStore, setNamesStoreForTest } from "../lib/agent/names-store";
import {
  EXPIRY_SECONDS,
  LABEL_RE,
  SEEDED,
  addrForLabel,
  gatewayUrlTemplate,
  makeSignatureHash,
  signAnswer,
  signerKeyFrom,
  verifyAnswer,
} from "../lib/ens/gateway";
import { setClockForTest } from "../lib/human/clock";
import { ENS_GATEWAY_CALLS_PER_MINUTE, ENS_GATEWAY_WINDOW_MS, ensGatewayThrottle } from "../lib/human/throttle";
import { FIXTURE_PATH, buildFixture } from "./ens-fixture";

type Check = (ok: boolean, label: string) => void;

/** anvil's first two accounts, public by design. The first signs answers here, the
 *  second is the wrong signer every refusal is checked against. */
const SIGNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const STRANGER_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SIGNER = privateKeyToAccount(SIGNER_KEY).address;
const STRANGER = privateKeyToAccount(STRANGER_KEY).address;

const RECORDING_WALLET = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const OTHER = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const THIRD = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const RESOLVER = "0x4444444444444444444444444444444444444444";

/** The two values read from Ethereum Sepolia on 2026-09-12 through the universal
 *  resolver, which `.env.example` documents. Pinned here so the example cannot
 *  drift from what was measured without a check saying so. */
const PARENT_ADDRESS_ON_CHAIN = "0x04cc6b487566B1C821bEa04d7ac0d23CEDe05cC9";
const WINDOWS_RECORD_ON_CHAIN = "https://xovi-agents.vercel.app/api/agent/windows";

const RESOLVE_ABI = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes)"]);
const ADDR_ABI = parseAbi(["function addr(bytes32 node) view returns (address)"]);
const ADDR_COIN_ABI = parseAbi(["function addr(bytes32 node, uint256 coinType) view returns (bytes)"]);
const TEXT_ABI = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
const OFFCHAIN_LOOKUP_ABI = parseAbi([
  "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
]);
const PROOF_ABI = parseAbi(["function resolveWithProof(bytes response, bytes extraData) view returns (bytes)"]);

const addrCall = (name: string) => encodeFunctionData({ abi: ADDR_ABI, functionName: "addr", args: [namehash(name)] });
const addrCoinCall = (name: string, coin: bigint) =>
  encodeFunctionData({ abi: ADDR_COIN_ABI, functionName: "addr", args: [namehash(name), coin] });
const textCall = (name: string, key: string) => encodeFunctionData({ abi: TEXT_ABI, functionName: "text", args: [namehash(name), key] });
const resolveCall = (name: string, inner: Hex) =>
  encodeFunctionData({ abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name)), inner] });

/** A store the gateway reads by label, counting the reads so a check can say the
 *  cap arrived before the table was consulted. */
function fakeStore(rows: NameRow[]): NamesStore & { reads: number } {
  const store = {
    reads: 0,
    requestLabel: async () => {
      throw new Error("not this fake's job");
    },
    release: async () => undefined,
    byPayer: async (payer: string) => rows.find(r => r.payer === payer) ?? null,
    byLabel: async (label: string) => {
      store.reads++;
      return rows.find(r => r.label === label) ?? null;
    },
    pending: async () => rows,
    markIssued: async () => false,
  };
  return store;
}

const row = (label: string, payer: string): NameRow => ({ payer, label, requestedAt: "2026-09-12T00:00:00Z", issuedAt: "2026-09-12T00:00:00Z", txHash: null });

/** Drives the route as the client does: GET `/api/ens/{sender}/{data}.json`. */
function ask(callData: string, sender = RESOLVER, headers: Record<string, string> = {}) {
  const data = `${callData}.json`;
  return gatewayGET(new Request(`http://local/api/ens/${sender}/${data}`, { headers }), { params: Promise.resolve({ sender, data }) });
}

/** The answer, verified as the contract verifies it, then decoded as the caller would. */
async function answered(res: Response, request: Hex, sender = RESOLVER) {
  const body = (await res.json()) as { data?: Hex; message?: string };
  if (!body.data) throw new Error(`no data: ${res.status} ${body.message}`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { ...(await verifyAnswer({ sender, request, response: body.data, now })), body, headers: res.headers };
}

/** The gateway on a real port, so viem's own fetch is what reaches it. */
async function startGateway() {
  const server = createServer((req, res) => {
    void (async () => {
      const m = /^\/api\/ens\/([^/]+)\/([^/]+)$/.exec(req.url ?? "");
      if (!m) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "not the gateway path" }));
        return;
      }
      const [, sender, data] = m;
      const out = await gatewayGET(new Request(`http://local${req.url}`, { headers: req.headers as Record<string, string> }), {
        params: Promise.resolve({ sender, data }),
      });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(await out.text());
    })();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => void server.close(() => r())) };
}

export async function ensChecks(check: Check) {
  console.log("\n  the ENS gateway");

  const prev = {
    key: process.env.ENS_GATEWAY_SIGNER_KEY,
    parent: process.env.ENS_PARENT_ADDRESS,
    windows: process.env.ENS_TEXT_X402_WINDOWS,
  };
  process.env.ENS_GATEWAY_SIGNER_KEY = SIGNER_KEY;
  process.env.ENS_PARENT_ADDRESS = PARENT_ADDRESS_ON_CHAIN;
  process.env.ENS_TEXT_X402_WINDOWS = WINDOWS_RECORD_ON_CHAIN;
  ensGatewayThrottle.reset();

  const name2 = "agent2.xovi.eth";
  const request2 = resolveCall(name2, addrCall(name2));
  const result2 = encodeAbiParameters([{ type: "address" }], [OTHER]);

  /*
   * The digest and the round trip, with no route and no chain.
   */
  const expires = 1_800_000_300n;
  const byHand = keccak256(
    encodePacked(["bytes", "address", "uint64", "bytes32", "bytes32"], ["0x1900", RESOLVER, expires, keccak256(request2), keccak256(result2)]),
  );
  check(makeSignatureHash(RESOLVER, expires, request2, result2) === byHand, "370 · the digest is the reference layout, 0x1900 then target, expiry, keccak(request), keccak(result)");
  const swapped = keccak256(
    encodePacked(["bytes", "address", "uint64", "bytes32", "bytes32"], ["0x1900", RESOLVER, expires, keccak256(result2), keccak256(request2)]),
  );
  check(swapped !== byHand, "370a · and a swapped field is a different digest, so the layout is load bearing (control)");

  const good = await signAnswer({ sender: RESOLVER, request: request2, result: result2, expires, key: SIGNER_KEY });
  const roundTrip = await verifyAnswer({ sender: RESOLVER, request: request2, response: good, now: expires - 1n });
  check(roundTrip.signer === SIGNER && roundTrip.result === result2, "371 · a signed answer recovers to the signer and carries the result");
  let expired = false;
  try {
    await verifyAnswer({ sender: RESOLVER, request: request2, response: good, now: expires + 1n });
  } catch (e) {
    expired = e instanceof Error && /expired/.test(e.message);
  }
  check(expired, "371a · an answer past its expiry is refused");
  const boundary = await verifyAnswer({ sender: RESOLVER, request: request2, response: good, now: expires }).then(() => true, () => false);
  check(boundary, "371b · while one expiring this second is accepted, as the contract's bound is >= (negative control)");
  const bad = await signAnswer({ sender: RESOLVER, request: request2, result: result2, expires, key: STRANGER_KEY });
  const wrong = await verifyAnswer({ sender: RESOLVER, request: request2, response: bad, now: expires - 1n });
  check(wrong.signer === STRANGER && wrong.signer !== SIGNER, "371c · another key recovers to another address, which the signer set refuses");
  const elsewhere = await verifyAnswer({ sender: THIRD, request: request2, response: good, now: expires - 1n });
  check(elsewhere.signer !== SIGNER, "371d · and the same answer read for another target recovers to a stranger, since the target is in the digest");
  const [, , sig] = decodeAbiParameters([{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }], good);
  check((sig.length - 2) / 2 === 65, `371e · the signature is the 65 byte form OpenZeppelin 5 accepts (${(sig.length - 2) / 2} bytes)`);

  /*
   * The route's four answers.
   */
  // Two rows a hand could plant and the sequence never produces, so the pattern is
  // load bearing: without it the gateway would answer them. The first version of
  // 374 had no such rows, and removing the pattern turned nothing red, because an
  // unknown label answers zero from the table alone whether or not it is checked.
  const store = fakeStore([row("agent2", OTHER), row("agent12", THIRD), row("patito", THIRD), row("am-3", THIRD)]);
  setNamesStoreForTest(store);

  const forRow = await answered(await ask(request2), request2);
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: forRow.result }) === OTHER, "372 · addr for a label in the table answers the row's payer");
  check(forRow.signer === SIGNER, "372a · signed by the configured key");
  check(forRow.expires > BigInt(Math.floor(Date.now() / 1000)) && forRow.expires <= BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
    `372b · with an expiry ${EXPIRY_SECONDS} seconds out`);

  const name7 = "agent7.xovi.eth";
  const request7 = resolveCall(name7, addrCall(name7));
  const unknown = await answered(await ask(request7), request7);
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: unknown.result }) === ZERO, "372c · an unknown label answers the zero address, the standard unset answer, not an error");

  const name1 = "agent1.xovi.eth";
  const request1 = resolveCall(name1, addrCall(name1));
  const seeded = await answered(await ask(request1), request1);
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: seeded.result }) === RECORDING_WALLET,
    "372d · agent1 with no row answers the recording wallet 0xC0686ae9… from the seed");
  setNamesStoreForTest(fakeStore([row("agent1", THIRD)]));
  const overridden = await answered(await ask(request1), request1);
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: overridden.result }) === THIRD, "372e · and a row for agent1 wins over the seed");
  setNamesStoreForTest(store);

  const coin = resolveCall(name2, addrCoinCall(name2, 60n));
  const asBytes = await answered(await ask(coin), coin);
  check(decodeFunctionResult({ abi: ADDR_COIN_ABI, functionName: "addr", data: asBytes.result }).toLowerCase() === OTHER.toLowerCase(),
    "372f · addr(bytes32,uint256) for coin type 60 answers the twenty address bytes");
  const otherCoin = resolveCall(name2, addrCoinCall(name2, 0n));
  const empty = await answered(await ask(otherCoin), otherCoin);
  check(decodeFunctionResult({ abi: ADDR_COIN_ABI, functionName: "addr", data: empty.result }) === "0x", "372g · and empty bytes for any other coin type");

  const parentAddr = resolveCall("xovi.eth", addrCall("xovi.eth"));
  const parent = await answered(await ask(parentAddr), parentAddr);
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: parent.result }) === PARENT_ADDRESS_ON_CHAIN,
    "373 · the parent's addr is the documented ENS_PARENT_ADDRESS");
  const parentText = resolveCall("xovi.eth", textCall("xovi.eth", "x402:windows"));
  const windows = await answered(await ask(parentText), parentText);
  check(decodeFunctionResult({ abi: TEXT_ABI, functionName: "text", data: windows.result }) === WINDOWS_RECORD_ON_CHAIN,
    "373a · the parent's x402:windows text is the documented ENS_TEXT_X402_WINDOWS");
  const otherKey = resolveCall("xovi.eth", textCall("xovi.eth", "links"));
  const links = await answered(await ask(otherKey), otherKey);
  check(decodeFunctionResult({ abi: TEXT_ABI, functionName: "text", data: links.result }) === "", "373b · every other text key on the parent is empty");
  const labelText = resolveCall(name2, textCall(name2, "x402:windows"));
  const onLabel = await answered(await ask(labelText), labelText);
  check(decodeFunctionResult({ abi: TEXT_ABI, functionName: "text", data: onLabel.result }) === "", "373c · and a label carries no text record: the endpoint stays on the parent");

  delete process.env.ENS_PARENT_ADDRESS;
  check((await ask(parentAddr)).status === 503, "373d · with the parent's address unset the route answers 503 rather than a signed zero");
  process.env.ENS_PARENT_ADDRESS = PARENT_ADDRESS_ON_CHAIN;
  delete process.env.ENS_TEXT_X402_WINDOWS;
  check((await ask(parentText)).status === 503, "373e · and with the windows record unset, 503 rather than a signed empty string");
  process.env.ENS_TEXT_X402_WINDOWS = WINDOWS_RECORD_ON_CHAIN;
  check(readFileSync(".env.example", "utf8").includes(`ENS_PARENT_ADDRESS=${PARENT_ADDRESS_ON_CHAIN}`) &&
    readFileSync(".env.example", "utf8").includes(`ENS_TEXT_X402_WINDOWS=${WINDOWS_RECORD_ON_CHAIN}`),
    "373f · the example carries the two values as read from the chain on 2026-09-12");

  /*
   * The label pattern: a station, an alias or anything a person typed is not a label.
   */
  const notLabels = ["am-3", "remo", "patito", "agent0", "agent01", "agent", "agentx", "alfa"];
  const zeros: string[] = [];
  for (const label of notLabels) {
    const n = `${label}.xovi.eth`;
    const r = resolveCall(n, addrCall(n));
    const a = await answered(await ask(r), r);
    if (decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: a.result }) === ZERO) zeros.push(label);
  }
  check(zeros.length === notLabels.length, `374 · a station, an alias and every malformed label answer zero, two of them with a row planted in the table (${zeros.length} of ${notLabels.length})`);
  check((await store.byLabel("patito")) !== null && (await store.byLabel("am-3")) !== null, "374f · and the two planted rows exist, so the zero above is the pattern's doing (control)");
  const twelve = resolveCall("agent12.xovi.eth", addrCall("agent12.xovi.eth"));
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: (await answered(await ask(twelve), twelve)).result }) === THIRD,
    "374a · while agent12 answers its row (negative control)");
  check(!LABEL_RE.test("am-3") && !LABEL_RE.test("patito") && LABEL_RE.test("agent12") && !LABEL_RE.test("agent012"),
    "374b · the pattern itself is agent and a positive integer with no leading zero");
  const deeper = resolveCall("x.agent2.xovi.eth", addrCall("x.agent2.xovi.eth"));
  check(decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: (await answered(await ask(deeper), deeper)).result }) === ZERO,
    "374c · a deeper name under the parent is inside the zone and unissued, so zero");
  const outside = resolveCall("agent2.other.eth", addrCall("agent2.other.eth"));
  check((await ask(outside)).status === 404, "374d · a name outside xovi.eth is refused, since this gateway does not answer for it");
  check(await addrForLabel("agent2", store) === OTHER && await addrForLabel("remo", store) === ZERO && await addrForLabel("agent1", null) === getAddress(SEEDED.agent1),
    "374e · the shared function the name route asks agrees with the route on all three kinds");

  /*
   * The key on no wire and in no client file.
   */
  const bare = SIGNER_KEY.slice(2);
  const text = JSON.stringify(forRow.body) + [...forRow.headers.values()].join("\n");
  check(!text.includes(bare) && !text.toLowerCase().includes(bare.toLowerCase()), "375 · the signing key is in no part of an answer, body or headers");
  check(text.includes(forRow.body.data as string), "375a · while the answer was read (control)");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const clientFiles = walk("app").filter(f => /^\s*"use client";/m.test(readFileSync(f, "utf8"))).concat(["lib/agent/browser.ts"]);
  const naming = clientFiles.filter(f => readFileSync(f, "utf8").includes("ENS_GATEWAY_SIGNER_KEY"));
  check(clientFiles.length >= 2 && naming.length === 0, `375b · no client file names the signing key's variable (${clientFiles.length} walked)`);
  check(readFileSync("lib/ens/gateway.ts", "utf8").includes("ENS_GATEWAY_SIGNER_KEY"), "375c · while the gateway module does (positive control)");
  const importingGateway = clientFiles.filter(f => /lib\/ens\/gateway/.test(readFileSync(f, "utf8")));
  check(importingGateway.length === 0, "375d · and no client file imports the gateway module");
  check(signerKeyFrom({ ENS_GATEWAY_SIGNER_KEY: bare }) === SIGNER_KEY && signerKeyFrom({ ENS_GATEWAY_SIGNER_KEY: "0xabc" }) === null && signerKeyFrom({}) === null,
    "375e · the key reader takes 32 bytes with or without the prefix and nothing else");
  delete process.env.ENS_GATEWAY_SIGNER_KEY;
  check((await ask(request2)).status === 503, "375f · with no key the route answers 503 rather than signing with nothing");
  process.env.ENS_GATEWAY_SIGNER_KEY = SIGNER_KEY;

  /*
   * Refusals, each a 4xx with a message and no data.
   */
  check((await ask(request2, "nonsense")).status === 400, "376 · a sender that is not an address is refused");
  const noSuffix = gatewayGET(new Request(`http://local/api/ens/${RESOLVER}/${request2}`), { params: Promise.resolve({ sender: RESOLVER, data: request2 }) });
  check((await noSuffix).status === 400, "376a · data without .json is refused, since the template is the reference's");
  check((await ask("0xzz")).status === 400, "376b · data that is not hex is refused");
  check((await ask(addrCall(name2))).status === 400, "376c · a call that is not resolve(bytes,bytes) is refused");
  const mismatched = encodeFunctionData({ abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name2)), addrCall(name7)] });
  check((await ask(mismatched)).status === 400, "376d · a name whose namehash is not the node asked is refused");
  const shouting = resolveCall("AGENT2.xovi.eth", addrCall("AGENT2.xovi.eth"));
  check((await ask(shouting)).status === 400, "376e · a name that is not normalised is refused, as the reference refuses it");
  const refused = await ask(outside);
  const refusedBody = (await refused.json()) as { message?: string; data?: string };
  check(typeof refusedBody.message === "string" && refusedBody.data === undefined, "376f · a refusal carries a message and no data, per EIP-3668");

  /*
   * The cap, seen red on the clock, and before the table is read.
   */
  ensGatewayThrottle.reset();
  const t0 = new Date("2026-09-12T12:00:00Z");
  let clock = t0;
  setClockForTest(() => clock);
  const from = (ip: string) => ask(request2, RESOLVER, { "x-forwarded-for": ip });
  let last = new Response(null);
  for (let i = 0; i < ENS_GATEWAY_CALLS_PER_MINUTE; i++) last = await from("203.0.113.5");
  check(last.status === 200, `377 · the ${ENS_GATEWAY_CALLS_PER_MINUTE}th request in a minute from one client is answered`);
  const readsAtCap = store.reads;
  const over = await from("203.0.113.5");
  check(over.status === 429 && Number(over.headers.get("retry-after")) >= 1, `377a · the next is 429 with a retry-after (${over.status})`);
  check(store.reads === readsAtCap, "377b · and the table was not read for it, so the cap sits before the work");
  check((await from("203.0.113.6")).status === 200, "377c · another client was never held (negative control)");
  clock = new Date(t0.getTime() + ENS_GATEWAY_WINDOW_MS + 1);
  check((await from("203.0.113.5")).status === 200, "377d · a minute later the same client is answered again (negative control)");
  check(ENS_GATEWAY_CALLS_PER_MINUTE >= 10 && ENS_GATEWAY_CALLS_PER_MINUTE <= 120, `377e · the cap is bounded (${ENS_GATEWAY_CALLS_PER_MINUTE} a minute)`);
  setClockForTest(undefined);
  ensGatewayThrottle.reset();

  /*
   * CORS on this route and on no other but the MCP one.
   */
  check(forRow.headers.get("access-control-allow-origin") === "*", "378 · the gateway answers any origin, since a CCIP Read client fetches from anywhere");
  check(gatewayOPTIONS().status === 204 && gatewayOPTIONS().headers.get("access-control-allow-origin") === "*", "378a · and answers the preflight");
  check(forRow.headers.get("cache-control") === "no-store" && forRow.headers.get("content-type")?.startsWith("application/json") === true,
    "378b · as JSON, and not stored, so a name just requested shows at once");
  const routes = walk("app/api").filter(f => f.endsWith("route.ts"));
  const open = routes.filter(f => readFileSync(f, "utf8").includes("Access-Control-Allow-Origin"));
  const allowed = new Set(["app/api/mcp/route.ts", "app/api/ens/[sender]/[data]/route.ts"]);
  check(open.length === 2 && open.every(f => allowed.has(f)), `378c · exactly two routes open their origin, each with its reason beside it (${open.join(", ")})`);
  check(routes.length >= 10, `378d · and the walk read the routes (${routes.length})`);

  /*
   * The committed fixture is what this code signs today.
   */
  const fixture = await buildFixture();
  const committed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as typeof fixture;
  check(committed.response === fixture.response && committed.request === fixture.request && committed.signer === fixture.signer,
    "379 · the fixture the contract test verifies is byte for byte what the gateway signs now");
  const fixtureSigner = await verifyAnswer({ sender: fixture.sender, request: fixture.request, response: fixture.response, now: BigInt(fixture.expires) - 1n });
  check(fixtureSigner.signer === fixture.signer && decodeAbiParameters([{ type: "address" }], fixtureSigner.result)[0] === fixture.payer,
    "379a · and it recovers here to the signer it names, over the payer it names");

  /*
   * viem follows the lookup, through its own fetch, against a fake chain whose
   * callback verifies as the contract does. The fake counts what reached it.
   */
  const gateway = await startGateway();
  const template = gatewayUrlTemplate(gateway.origin);
  const fetched: string[] = [];
  const chain = await startFakeChain({ template, expectSigner: SIGNER, onCallback: () => fetched.push("callback") });
  const client = createPublicClient({ chain: sepolia, transport: http(chain.url) });
  const viaViem = await client.readContract({
    address: RESOLVER,
    abi: RESOLVE_ABI,
    functionName: "resolve",
    args: [toHex(packetToBytes(name2)), addrCall(name2)],
  }).catch(e => (e instanceof Error ? e : new Error(String(e))));
  check(!(viaViem instanceof Error) && decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: viaViem as Hex }) === OTHER,
    `380 · viem follows the OffchainLookup to the gateway and returns the payer through resolveWithProof (${viaViem instanceof Error ? viaViem.message.split("\n")[0] : "ok"})`);
  check(chain.calls.some(c => c.startsWith("0xf4d4d2f8")) && fetched.length === 1, "380a · the callback was called exactly once, with the gateway's signed answer");
  check(chain.gets.length === 1 && chain.gets[0] === `/api/ens/${RESOLVER.toLowerCase()}/${request2}.json`,
    `380b · by GET at the reference template, sender lowercased and data substituted (${chain.gets[0] ?? "none"})`);
  // The control: the same lookup against a chain that lists another signer refuses.
  const other = await startFakeChain({ template, expectSigner: STRANGER, onCallback: () => undefined });
  const refusedByChain = await createPublicClient({ chain: sepolia, transport: http(other.url) })
    .readContract({ address: RESOLVER, abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name2)), addrCall(name2)] })
    .then(() => false, () => true);
  check(refusedByChain, "380c · while a resolver listing another signer refuses the same answer (negative control)");
  await other.close();
  await chain.close();

  /*
   * The strongest proof, when anvil is on this machine: the real contract, deployed,
   * verifying the real route's answer through viem's real CCIP Read.
   */
  await anvilProof(check, gateway.origin, template);
  await gateway.close();

  /*
   * The runbook and the script say what the founder does, in the order it is safe.
   */
  const runbook = readFileSync("docs/ens-runbook.md", "utf8");
  const switchAt = runbook.indexOf("## Switching the resolver");
  check(switchAt > 0, "381 · the runbook has the switch section");
  const section = runbook.slice(switchAt);
  const probeAt = section.search(/curl .*\/api\/ens\//);
  const appAt = section.indexOf("app.ens.dev");
  check(probeAt > 0 && appAt > probeAt, "381a · which probes the deployed gateway before it names the app the switch is made in");
  check(/at once/.test(section), "381b · and says every subname and the parent's record break together if the order is reversed");
  const script = readFileSync("contracts/script/Deploy.s.sol", "utf8");
  check(/block\.chainid == SEPOLIA/.test(script) && /11155111/.test(script), "381c · the deploy script guards the chain");
  check(/ENS_RESOLVER_DEPLOYER_KEY_FILE/.test(script) && !/envUint\("ENS_RESOLVER_DEPLOYER_KEY"/.test(script), "381d · and reads the key from the file the variable names, never the key itself");
  const issuer = readFileSync("bin/issue-names.ts", "utf8");
  check(/pre switch/i.test(issuer.slice(0, issuer.indexOf("import "))), "381e · the on chain issuer's header says it is the pre switch path");

  setNamesStoreForTest(undefined);
  if (prev.key === undefined) delete process.env.ENS_GATEWAY_SIGNER_KEY;
  else process.env.ENS_GATEWAY_SIGNER_KEY = prev.key;
  if (prev.parent === undefined) delete process.env.ENS_PARENT_ADDRESS;
  else process.env.ENS_PARENT_ADDRESS = prev.parent;
  if (prev.windows === undefined) delete process.env.ENS_TEXT_X402_WINDOWS;
  else process.env.ENS_TEXT_X402_WINDOWS = prev.windows;
}

/**
 * A JSON-RPC endpoint standing in for a chain whose resolver is the offchain one.
 *
 * `eth_call` to `resolve` reverts with the `OffchainLookup` the contract would
 * revert with; `eth_call` to `resolveWithProof` verifies the response exactly as
 * `SignatureVerifier.verify` does and refuses a signer outside the set. It records
 * every call and every GET path viem's fetch used, because "viem followed the
 * lookup" is a claim about what reached the two endpoints.
 */
async function startFakeChain(opts: { template: string; expectSigner: string; onCallback: () => void }) {
  const calls: string[] = [];
  const gets: string[] = [];
  const origin = new URL(opts.template).origin;
  // A wrapper in front of the gateway records the path viem asked for.
  const template = opts.template.replace(origin, "PLACEHOLDER");
  const recorder = createServer((req, res) => {
    gets.push(req.url ?? "");
    void fetch(`${origin}${req.url}`).then(async r => {
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(await r.text());
    });
  });
  await new Promise<void>(r => recorder.listen(0, "127.0.0.1", r));
  const recorderOrigin = `http://127.0.0.1:${(recorder.address() as { port: number }).port}`;
  const urls = [template.replace("PLACEHOLDER", recorderOrigin)];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      void (async () => {
        const call = JSON.parse(body || "{}") as { id?: number; method?: string; params?: [{ to?: string; data?: Hex }] };
        const reply = (result: unknown) => res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
        const revert = (data: Hex, message: string) =>
          res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: 3, message: `execution reverted: ${message}`, data } }));
        res.writeHead(200, { "content-type": "application/json" });
        if (call.method === "eth_chainId") return reply("0xaa36a7");
        if (call.method !== "eth_call") return reply(null);
        const to = getAddress(call.params?.[0]?.to ?? ZERO);
        const data = call.params?.[0]?.data ?? "0x";
        calls.push(data);
        if (data.startsWith("0x9061b923")) {
          return revert(
            encodeErrorResult({
              abi: OFFCHAIN_LOOKUP_ABI,
              errorName: "OffchainLookup",
              args: [to, urls, data, "0xf4d4d2f8", encodeAbiParameters([{ type: "bytes" }, { type: "address" }], [data, to])],
            }),
            "OffchainLookup",
          );
        }
        if (data.startsWith("0xf4d4d2f8")) {
          opts.onCallback();
          const { args } = decodeFunctionData({ abi: PROOF_ABI, data });
          const [response, extraData] = args as [Hex, Hex];
          const [request, sender] = decodeAbiParameters([{ type: "bytes" }, { type: "address" }], extraData);
          try {
            const verified = await verifyAnswer({ sender, request, response, now: BigInt(Math.floor(Date.now() / 1000)) });
            if (verified.signer !== opts.expectSigner) return revert("0x", "SignatureVerifier: Invalid sigature");
            return reply(encodeAbiParameters([{ type: "bytes" }], [verified.result]));
          } catch (e) {
            return revert("0x", e instanceof Error ? e.message : "refused");
          }
        }
        return revert("0x", "not this fake's job");
      })();
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    calls,
    gets,
    close: async () => {
      await new Promise<void>(r => void server.close(() => r()));
      await new Promise<void>(r => void recorder.close(() => r()));
    },
  };
}

/**
 * The real contract on a local anvil, verifying the real route's answer.
 *
 * Runs only where `anvil` is on the path and the artifact can be built; CI has
 * neither, so the block prints that it was skipped rather than passing quietly.
 * Nothing here is a check unless it ran.
 */
async function anvilProof(check: Check, gatewayOrigin: string, template: string) {
  const artifactPath = "contracts/out/OffchainResolver.sol/OffchainResolver.json";
  const have = (bin: string) => spawnSync("which", [bin]).status === 0;
  if (!have("anvil") || !have("forge")) {
    console.log("    skip  anvil proof: anvil or forge is not on this machine");
    return;
  }
  if (!existsSync(artifactPath)) spawnSync("forge", ["build"], { cwd: "contracts", stdio: "ignore" });
  if (!existsSync(artifactPath)) {
    console.log("    skip  anvil proof: the contract did not build");
    return;
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: readonly unknown[]; bytecode: { object: Hex } };
  const port = 40000 + Math.floor(Math.random() * 10000);
  const anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ chain: foundry, transport: http(url) });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    up = await client.getChainId().then(id => id === foundry.id, () => false);
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  try {
    if (!up) {
      console.log("    skip  anvil proof: anvil did not answer");
      return;
    }
    const deployer = privateKeyToAccount(SIGNER_KEY);
    const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(url) });
    const abi = artifact.abi as never;
    const hash = await wallet.deployContract({ abi, bytecode: artifact.bytecode.object, args: [template, [SIGNER]] });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress as Hex;
    const name2 = "agent2.xovi.eth";

    const resolved = await client
      .readContract({ address, abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name2)), addrCall(name2)] })
      .catch(e => (e instanceof Error ? e : new Error(String(e))));
    check(!(resolved instanceof Error) && decodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", data: resolved as Hex }) === OTHER,
      `382 · anvil: the deployed contract verifies the route's answer through viem's CCIP Read and returns the payer (${resolved instanceof Error ? resolved.message.split("\n")[0] : "ok"})`);

    const parentText = await client
      .readContract({ address, abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes("xovi.eth")), textCall("xovi.eth", "x402:windows")] })
      .catch(() => null);
    check(parentText !== null && decodeFunctionResult({ abi: TEXT_ABI, functionName: "text", data: parentText }) === WINDOWS_RECORD_ON_CHAIN,
      "382a · and the parent's x402:windows record reaches the caller through the same path");

    // Another signer, on chain: rotate the set to the stranger, and the route's answer is refused.
    const rotate = await wallet.writeContract({ address, abi, functionName: "setSigners", args: [[STRANGER], [SIGNER]] });
    await client.waitForTransactionReceipt({ hash: rotate });
    const refused = await client
      .readContract({ address, abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name2)), addrCall(name2)] })
      .then(() => false, () => true);
    check(refused, "382b · with the signer rotated out on chain the contract refuses the route's answer (negative control)");
    const back = await wallet.writeContract({ address, abi, functionName: "setSigners", args: [[SIGNER], [STRANGER]] });
    await client.waitForTransactionReceipt({ hash: back });

    // Expiry, on chain: move the chain past the answer's five minutes.
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [EXPIRY_SECONDS + 60] }) });
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }) });
    const expired = await client
      .readContract({ address, abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(name2)), addrCall(name2)] })
      .then(() => false, () => true);
    check(expired, "382c · and an answer signed now is refused by a chain whose clock is past its expiry");
    console.log(`    ran   anvil proof against ${address} on ${url}, gateway at ${gatewayOrigin}`);
  } finally {
    anvil.kill();
  }
}
