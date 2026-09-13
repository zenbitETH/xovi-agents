/**
 * Checks for the paid window read.
 *
 * Every check below has been seen to fail. That is the bar: a check that has only
 * ever been green proves the test ran, not that the behaviour holds. Where a
 * refusal is asserted, a negative control asserts that something is still
 * accepted, because a gate that refuses everything satisfies every refusal test
 * ever written.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GET } from "../app/api/agent/windows/route";
import { EndpointUnresolvable, IdentityMismatch, assertIssuedIdentity, resolveWindowsEndpoint } from "../lib/agent/ens";
import type { Ledger } from "../lib/agent/ledger";
import { loadLedger, unrefused } from "../lib/agent/ledger";
import { ATTEMPTS, buildPayer, payingFetch } from "../lib/agent/pay";
import { PROPOSAL_KEYS, UnproposableWindow, propose, toProposal } from "../lib/agent/propose";
import { humanBehind } from "../lib/human/registry";
import { FABRICATED_TX, FabricatedReceipt, assertNotFabricated, freeReadsPerDay, utcDay } from "../lib/human/store";
import { applyEmbargo, dropsForEmbargo, embargoedAliases } from "../lib/windows/embargo";
import { SnapshotUnavailable, loadSnapshot } from "../lib/windows/snapshot";
import { windowProblems } from "../lib/windows/types";
import { PaymentMisconfigured, buildServer, paymentHeaderFrom, resetServerForTest } from "../lib/x402";
import { startFakeFacilitator } from "./facilitator";
import { startFakeIngest } from "./ingest";
import { AGENT_ONE, AGENT_OTHER, AGENT_TWO, AGENT_UNREGISTERED, HUMAN_A, fakeRegistry, fakeStore } from "./human";
import { RETENTION_DAYS, recordSettlement, setCapForTest, takeFreeRead } from "../lib/human/cap";
import { MAX_PER_PAYMENT } from "../lib/agent/spend";
import { postgresStore } from "../lib/human/postgres";
import { NoDerivationKey, deriveIdentifier } from "../lib/human/derive";
import { anchorChecks } from "./anchor";
import { mcpChecks } from "./mcp";
import { pageChecks } from "./page";
import { agentRunChecks } from "./agent-run";
import { boardChecks } from "./board";
import { nameChecks } from "./name";
import { namesChecks } from "./names";
import { proposalsChecks } from "./proposals";
import { receiptsChecks } from "./receipts";

let n = 0;
let bad = 0;
const check = (ok: boolean, label: string) => {
  n++;
  if (!ok) bad++;
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}`);
};

const good = () => ({
  schema: "xovi/candidate-window/v1",
  windowId: "abc123",
  channelId: "UCchannel",
  videoId: "vid0000001",
  startTime: 10.5,
  endTime: 24.5,
  stationId: "AM 1",
  speciesCode: "mexicanum",
  specimenAlias: null,
  candidates: ["Alfa"],
  behaviorTag: null,
  truncatedByCap: false,
  continuesPrevious: false,
  confidence: 500,
  reason: "a sentence long enough to pass",
  detector: "t@0",
  producedAt: "2026-09-07T00:00:00Z",
});

async function main() {
  console.log("\n  Paid window read\n");

  console.log("  shape\n");
  check(windowProblems(good()).length === 0, "1 · a well formed window has no problems (negative control)");
  check(windowProblems({ ...good(), confidence: 0.5 }).some(p => p.includes("per mille")), "2 · a float confidence is refused");
  check(windowProblems({ ...good(), confidence: 1001 }).length > 0, "3 · confidence over 1000 is refused");
  check(windowProblems({ ...good(), endTime: 10.5001 }).some(p => p.includes("whole millisecond")), "4 · a time finer than a millisecond is refused");
  check(windowProblems({ ...good(), startTime: 0, endTime: 101 }).some(p => p.includes("100s cap")), "5 · a window over the 100 s cap is refused");
  check(windowProblems({ ...good(), startTime: 0, endTime: 100 }).length === 0, "6 · and exactly 100 s is accepted (the cap binds, it does not exclude)");
  check(windowProblems({ ...good(), reason: "x".repeat(281) }).some(p => p.includes("reason over 280")), "7 · a reason past the note cap is refused");
  check(windowProblems({ ...good(), truncatedByCap: "yes" }).some(p => p.includes("truncatedByCap")), "8 · a non boolean truncatedByCap is refused");
  check(windowProblems({ ...good(), schema: "xovi/candidate-window/v2" }).some(p => p.includes("schema")), "9 · a shape from another version is refused");
  check(windowProblems({ ...good(), endTime: 10.5 }).some(p => p.includes("after startTime")), "10 · a zero length window is refused");

  console.log("\n  embargo\n");
  const w = good();
  const none = embargoedAliases({});
  check(none.size === 0 && !dropsForEmbargo(w as never, none), "11 · with no list configured nothing is dropped (negative control)");
  const list = embargoedAliases({ EMBARGOED_ALIASES: "Delta, Alfa " });
  check(list.size === 2, "12 · the list is parsed and trimmed");
  check(dropsForEmbargo({ ...w, candidates: ["Alfa"] } as never, list), "13 · a window is dropped when a CANDIDATE is embargoed, not only the alias");
  check(dropsForEmbargo({ ...w, specimenAlias: "delta", candidates: null } as never, list), "14 · matching ignores case");
  check(
    dropsForEmbargo({ ...w, specimenAlias: null, candidates: null, reason: "movement near Delta today" } as never, list),
    "15 · a name that appears only in the free prose still drops the window",
  );
  check(!dropsForEmbargo({ ...w, specimenAlias: "Zeta", candidates: ["Zeta"], reason: "nothing here" } as never, list), "16 · an unlisted animal is served (negative control)");
  // Both entries must differ in EVERY field the gate reads. The first version of
  // this check left the shared candidates: ["Alfa"] in place, so the intended
  // survivor was dropped on the candidate rule and the check failed for the right
  // reason: the gate was working and the fixture was wrong.
  const mixed = applyEmbargo(
    [
      { ...w, specimenAlias: "Alfa", candidates: ["Alfa"], reason: "one" },
      { ...w, specimenAlias: "Zeta", candidates: ["Zeta"], reason: "two" },
    ] as never,
    { EMBARGOED_ALIASES: "Alfa" },
  );
  check(mixed.kept.length === 1 && mixed.dropped === 1, "17 · the window is dropped WHOLE, and the survivor is untouched");
  check(JSON.stringify(mixed.kept[0]).includes("Zeta"), "18 · and the survivor keeps its alias rather than being redacted too");

  console.log("\n  snapshot\n");
  try {
    loadSnapshot({});
    check(false, "19 · an unset snapshot path refuses");
  } catch (e) {
    check(e instanceof SnapshotUnavailable, "19 · an unset snapshot path refuses rather than serving an empty list");
  }
  // Every snapshot file says which day its footage belongs to, so these do too.
  const okFile = join(tmpdir(), `w-ok-${process.pid}.jsonl`);
  writeFileSync(`${okFile}.day`, "2026-09-07\n");
  writeFileSync(okFile, JSON.stringify(good()) + "\n");
  check(loadSnapshot({ WINDOWS_SNAPSHOT: okFile }).length === 1, "20 · a valid snapshot loads (negative control)");
  const badFile = join(tmpdir(), `w-bad-${process.pid}.jsonl`);
  writeFileSync(`${badFile}.day`, "2026-09-07\n");
  writeFileSync(badFile, JSON.stringify(good()) + "\n" + JSON.stringify({ ...good(), confidence: 2000 }) + "\n");
  try {
    loadSnapshot({ WINDOWS_SNAPSHOT: badFile });
    check(false, "21 · one bad row refuses the whole snapshot");
  } catch (e) {
    check(e instanceof SnapshotUnavailable, "21 · one bad row refuses the WHOLE snapshot, rather than serving the readable subset");
  }
  // Wrapped: a fixture that stops loading would abort the harness here and skip
  // every check after it, which is a crash hiding the suite rather than one red line.
  const shipped = (() => {
    try {
      return loadSnapshot({ WINDOWS_SNAPSHOT: "fixtures/windows.synthetic.jsonl" }).length;
    } catch {
      return -1;
    }
  })();
  check(shipped === 3, `22 · the shipped synthetic fixture is itself valid (${shipped})`);

  console.log("\n  payment\n");
  resetServerForTest();
  try {
    await buildServer({});
    check(false, "23 · an unset payTo refuses");
  } catch (e) {
    check(e instanceof PaymentMisconfigured, "23 · an unset payTo refuses to build, so the paid route can never serve for free");
  }
  resetServerForTest();
  try {
    await buildServer({ X402_PAY_TO: "0xnot-an-address" });
    check(false, "24 · a malformed payTo refuses");
  } catch (e) {
    check(e instanceof PaymentMisconfigured, "24 · a malformed payTo refuses too");
  }
  resetServerForTest();

  const v2 = paymentHeaderFrom(new Request("https://x/y", { headers: { "PAYMENT-SIGNATURE": "sig" } }));
  check(v2.header === "sig" && !v2.sentV1Only, "25 · the v2 payment is read from PAYMENT-SIGNATURE");
  const v1 = paymentHeaderFrom(new Request("https://x/y", { headers: { "X-PAYMENT": "old" } }));
  check(v1.header === undefined && v1.sentV1Only, "26 · a v1 X-PAYMENT is detected so it can be answered, not ignored in silence");
  const neither = paymentHeaderFrom(new Request("https://x/y"));
  check(neither.header === undefined && !neither.sentV1Only, "27 · no payment header is not mistaken for a v1 client (negative control)");

  console.log("\n  the route, end to end\n");

  // A key that exists to sign and hold nothing. EIP-3009 signing touches no chain,
  // so this never needs funding and never sees an RPC.
  const KEY = `0x${"ab".repeat(32)}` as const;
  const PAY_TO = "0x000000000000000000000000000000000000dEaD";
  const payer = buildPayer({ AGENT_PRIVATE_KEY: KEY });
  check(
    payer.address.toLowerCase() !== PAY_TO.toLowerCase(),
    "28 · the payer is not the recipient, so a settlement is a payment and not a loop",
  );

  const fac = await startFakeFacilitator();
  const ROUTE_URL = "http://127.0.0.1/api/agent/windows";
  const seen: Response[] = [];
  // The route handler is called directly rather than through a server. It is the
  // real exported GET, so this is the first time it runs at all: the 27 checks
  // above cover the modules it imports and never the handler itself.
  const routeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const res = await GET(new Request(url, init));
    seen.push(res.clone());
    return res;
  };
  const arrange = (snapshot: string | undefined) => {
    process.env.X402_PAY_TO = PAY_TO;
    process.env.X402_NETWORK = "eip155:84532";
    process.env.X402_FACILITATOR_URL = fac.url;
    process.env.X402_PRICE = "$0.01";
    if (snapshot === undefined) delete process.env.WINDOWS_SNAPSHOT;
    else process.env.WINDOWS_SNAPSHOT = snapshot;
    // buildServer memoizes at module scope, so without this every case after the
    // first would run against the first case's configuration and pass for the
    // wrong reason.
    resetServerForTest();
    fac.reset();
    seen.length = 0;
  };
  const last = () => seen[seen.length - 1];

  arrange("fixtures/windows.synthetic.jsonl");
  const challenge = await GET(new Request(ROUTE_URL));
  const challengeBody = (await challenge.text()).trim();
  check(challenge.status === 402, "29 · an unpaid read is refused with 402");
  check(Boolean(challenge.headers.get("PAYMENT-REQUIRED")), "30 · the requirements travel in PAYMENT-REQUIRED");
  check(challengeBody === "{}", "31 · the 402 body is empty, because v2 puts the requirements in the header");
  check(challenge.headers.get("cache-control") === "private, no-store", "32 · the 402 is not cacheable either");
  check(fac.hits.verify === 0, "33 · an unpaid call never reaches the facilitator");

  const paid = await payingFetch(ROUTE_URL, payer, routeFetch);
  check(paid.status === 200, "34 · the same read, paid for, returns the windows");
  check(paid.paymentStatus === "settled", "35 · and the receipt says it settled");
  check(Boolean(paid.settlement?.transaction), "36 · the receipt carries a transaction");
  check(last()?.headers.get("cache-control") === "private, no-store", "37 · the paid response is private and not stored");
  check(
    fac.hits.verify === 1 && fac.hits.settle === 1,
    "38 · a handler that succeeded verifies once and settles once (negative control for 42)",
  );
  const served = (paid.body as { windows?: unknown[] })?.windows;
  check(Array.isArray(served) && served.length === 3, "39 · the body is the snapshot, all three windows");

  arrange(undefined);
  const unavailable = await payingFetch(ROUTE_URL, payer, routeFetch);
  check(unavailable.status === 503, "40 · a missing snapshot refuses rather than serving an empty list");
  check(fac.hits.verify === 1, "41 · the payment was verified before the work was attempted");
  check(fac.hits.settle === 0, "42 · the handler failed, so NOTHING settled, and the caller keeps their money");
  check(last()?.headers.get("cache-control") === "private, no-store", "43 · the 503 is not cacheable");

  arrange("fixtures/windows.synthetic.jsonl");
  fac.settleSucceeds = false;
  const refused = await payingFetch(ROUTE_URL, payer, routeFetch);
  check(refused.status === 402, "44 · a settlement that fails withholds the content it was for");
  check(
    String((refused.body as { error?: string })?.error ?? "").includes("no se liquidó"),
    "45 · and says so, rather than returning an empty success",
  );
  check(
    refused.paymentStatus === "settle_failed",
    "46 · the refusal carries the receipt, so the caller learns what happened and not merely that it did not work",
  );
  // The rule this check used to assert has been overturned, and the reason is worth
  // keeping rather than replacing silently. It said a failed settlement is never
  // retried, which was protecting against paying twice. Resending the SAME signed
  // authorization cannot pay twice: it carries a nonce the token refuses to reuse,
  // so at most once is a property of the primitive. Signing again is the thing that
  // would double spend, and that is still forbidden. So the old rule was right about
  // re-signing and wrong about resending.
  check(fac.hits.settle === ATTEMPTS,
    `47 · a counterparty that keeps failing is retried to a bound and no further (${ATTEMPTS} attempts)`);
  const bodies = fac.settleBodies.slice(-ATTEMPTS);
  check(bodies.length === ATTEMPTS && new Set(bodies).size === 1,
    "47b · and every attempt sends byte identical bytes, so no second authorization is ever signed (seen to fail)");

  // A counterparty that flakes once and then lands the same authorization, which is
  // what the live testnet facilitator was measured doing.
  arrange("fixtures/windows.synthetic.jsonl");
  fac.reset();
  fac.settleFailuresRemaining = 1;
  const flaked = await payingFetch(ROUTE_URL, payer, routeFetch);
  check(flaked.paymentStatus === "settled", "47c · a single flake is ridden out and the read succeeds");
  check(fac.hits.settle === 2, "47d · in exactly two attempts, not three");
  check(new Set(fac.settleBodies).size === 1, "47e · both of them the same authorization");

  arrange("fixtures/windows.synthetic.jsonl");
  fac.reset();
  fac.settleSucceeds = false;

  await fac.close();

  // Next 16 renames middleware to proxy, so checking one name would pass by
  // accident the day the framework is upgraded.
  const wrappers = ["middleware.ts", "src/middleware.ts", "proxy.ts", "src/proxy.ts"];
  const found = wrappers.filter(p => existsSync(p));
  check(found.length === 0, `48 · no request wrapper exists, so settlement stays visible in the route (${found.join(", ") || "none"})`);

  console.log("\n  window to proposal\n");

  const win = (over: Record<string, unknown> = {}) => ({ ...good(), ...over });
  const mapped = toProposal(win() as never);
  check(
    JSON.stringify(Object.keys(mapped).sort()) === JSON.stringify([...PROPOSAL_KEYS].sort()),
    "49 · a proposal carries exactly the ten keys the route accepts",
  );
  check(!("source" in mapped) && !("submitterAddress" in mapped), "50 · and never source or submitterAddress");
  check(mapped.behaviorTag === "other" && mapped.behaviorNote === good().reason,
    "51 · no behaviour tag becomes other, with the detector's reason as the note");
  check(toProposal(win({ behaviorTag: "swim" }) as never).behaviorTag === "other",
    "52 · a tag the producer invented is NOT forwarded, because the enum is the route's");
  check(toProposal(win({ specimenAlias: null }) as never).specimenAlias === null,
    "53 · a null alias survives as a station only tag, because null is a real answer");
  check(toProposal(win({ specimenAlias: "Gamma" }) as never).specimenAlias === "Gamma",
    "54 · and a named one survives too (negative control)");
  let tooShort = false;
  try { toProposal(win({ reason: "ab" }) as never); } catch (e) { tooShort = e instanceof UnproposableWindow; }
  check(tooShort, "55 · a reason too short to be a note is refused here, not sent to earn a 400");
  let tooLong = false;
  try { toProposal(win({ startTime: 0, endTime: 121 }) as never); } catch (e) { tooLong = e instanceof UnproposableWindow; }
  check(tooLong, "56 · a span over the route's cap is refused here too");

  console.log("\n  proposing, against the ingest route faked\n");

  const ing = await startFakeIngest();
  // Removed first, and this is not tidiness. The ledger is a file that survives the
  // process, so a run that leaves it behind makes the next run start with the
  // refusal already recorded: check 61 passed on a clean machine and failed on the
  // second run, which is the shape of a check that is green in CI forever.
  const ledgerPath = join(tmpdir(), "xovi-agent-ledger-checks.json");
  if (existsSync(ledgerPath)) rmSync(ledgerPath);
  const ledgerPath2 = join(tmpdir(), "xovi-agent-ledger-checks-2.json");
  if (existsSync(ledgerPath2)) rmSync(ledgerPath2);
  const stub: Ledger = { has: () => false, remember: () => {}, size: () => 0 };
  const cfg = (l = stub) => ({ url: ing.url, key: "xvi_000000000000_secret", ledger: l });

  ing.reset();
  const created = await propose(win() as never, cfg());
  check(created.kind === "proposed" && created.status === "pending",
    "57 · a proposal lands pending, and the status came from the server rather than the client");
  const sentBody = ing.bodies[0] ?? {};
  check(!("source" in sentBody) && !("submitterAddress" in sentBody),
    "58 · neither field arrived at the route, asserted where the request lands");
  check(JSON.stringify(Object.keys(sentBody).sort()) === JSON.stringify([...PROPOSAL_KEYS].sort()),
    "59 · and exactly the ten keys did, because zod strips extras in silence");

  ing.reset(); ing.outcome = "duplicate";
  const ledgerA = loadLedger(ledgerPath);
  const dup = await propose(win() as never, cfg(ledgerA));
  check(dup.kind === "duplicate", "60 · a retryable 409 is a duplicate, not an error");
  check(!ledgerA.has(good().windowId), "61 · and is not written to the ledger (negative control for 63)");

  ing.reset(); ing.outcome = "rejected";
  const rejected = await propose(win() as never, cfg(ledgerA));
  check(rejected.kind === "rejected", "62 · a 409 marked not retryable is a person saying no");
  check(ledgerA.has(good().windowId), "63 · written to the ledger before the call returned");
  const hitsAfterRefusal = ing.hits;
  for (const again of unrefused([win() as never], ledgerA)) await propose(again, cfg(ledgerA));
  check(ing.hits === hitsAfterRefusal, "64 · a second run over the same snapshot proposes nothing for that window");
  check(loadLedger(ledgerPath).has(good().windowId), "65 · and the refusal survives a reload, so a restart does not re-ask");

  ing.reset(); ing.outcome = "noTarget";
  const noTarget = await propose(win() as never, cfg());
  check(noTarget.kind === "refused" && noTarget.status === 422, "66 · a target that does not exist is a 422");

  ing.reset(); ing.outcome = "badStation";
  const badStation = await propose(win() as never, cfg());
  check(badStation.kind === "refused" && badStation.status === 403 && Boolean(badStation.hint),
    "67 · the station refusal carries the hint, because it reads like permissions and is spelling");
  check(badStation.kind === "refused" && String(badStation.hint).includes(good().stationId),
    "68 · and the hint names the literal string the detector emits, spaces included");

  await ing.close();

  console.log("\n  the endpoint, and the way in\n");

  /* Wrapped because `resolveWindowsEndpoint` is designed to raise, so a regression on a
   * success path aborts the harness rather than printing a red line, and an aborted run
   * sends the next reader to debug the harness instead of the finding. The criterion is
   * the callee, not the check: calls to the in-memory fakes below return rather than
   * throw, so a bare one there fails as a comparison. Two in this file matched, both to
   * this function, and the identity checks are wrapped the same way for the same reason. */
  const endpointResult = async (...args: Parameters<typeof resolveWindowsEndpoint>) => {
    try { return await resolveWindowsEndpoint(...args); }
    catch (e) { return `RAISED ${e instanceof Error ? e.constructor.name : "unknown"}`; }
  };

  check(await endpointResult({ WINDOWS_URL: "https://h/w" }) === "https://h/w",
    "69 · with no name configured the endpoint is the configured url");
  let noneSet = false;
  try { await resolveWindowsEndpoint({}); } catch (e) { noneSet = e instanceof EndpointUnresolvable; }
  check(noneSet, "70 · with neither set it refuses rather than guessing");

  // Comments are stripped first: this file names the routes it looks for, and so do
  // the modules it checks, so a naive grep would find its own explanation.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Walked rather than listed. A hand written list of six files silently stops
  // covering the seventh, and the seventh is the one somebody adds in a hurry.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );
  const agentSources = [...walk("lib/agent"), ...walk("bin")];
  check(agentSources.length >= 6, `71 · the walk found the agent's files, so this is not a list that stops covering new ones (${agentSources.length})`);
  const reaching = agentSources.filter(f => /\/api\/(verify|curate|confirm)/.test(strip(readFileSync(f, "utf8"))));
  check(reaching.length === 0,
    `72 · nothing the agent runs reaches a decision route (${reaching.join(", ") || "none"})`);

  // Asserted on the module graph rather than on one file's text, because an
  // indirect import through a third module would satisfy a grep and still put the
  // payer one call away.
  const specifiers = (file: string) =>
    [...strip(readFileSync(file, "utf8")).matchAll(/from\s+"([^"]+)"/g)].map(m => m[1]);
  const reachable = (entry: string) => {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of specifiers(file)) {
        if (!spec.startsWith(".")) continue;
        const target = `${join(file, "..", spec)}.ts`;
        if (existsSync(target)) queue.push(target);
      }
    }
    return seen;
  };
  const graph = reachable("lib/agent/propose.ts");
  check(!graph.has("lib/agent/pay.ts"),
    `73 · the payer is not reachable from the proposing module by any import path (${[...graph].join(", ")})`);


  console.log("\n  the answers nobody planned for\n");

  const ing2 = await startFakeIngest();
  const cfg2 = (l = stub) => ({ url: ing2.url, key: "xvi_000000000000_secret", ledger: l });
  const ledgerB = loadLedger(ledgerPath2);

  ing2.reset(); ing2.outcome = "oddConflict";
  const odd = await propose(win() as never, cfg2(ledgerB));
  check(odd.kind === "refused" && odd.status === 409,
    "74 · a 409 with no retryable flag is refused, not read as a person's decision");
  check(ledgerB.size() === 0,
    "75 · and nothing is written, so a proxy cannot permanently close a window no reviewer saw");

  ing2.reset(); ing2.outcome = "throttled";
  const throttled = await propose(win() as never, cfg2(ledgerB));
  check(throttled.kind === "throttled" && throttled.retryAfterSeconds === 3600,
    "76 · a 429 is its own answer, carrying how long to wait");
  check(ledgerB.size() === 0, "77 · and belongs to the credential, so no window is marked by it");

  for (const [outcome, label] of [["created", "a 201"], ["noTarget", "a 422"], ["badStation", "a station 403"]] as const) {
    ing2.reset(); ing2.outcome = outcome;
    await propose(win() as never, cfg2(ledgerB));
  }
  check(ledgerB.size() === 0, "78 · a 201, a 422 and a station 403 all leave the ledger untouched (negative controls)");

  ing2.reset(); ing2.outcome = "rejected";
  await propose(win() as never, cfg2(ledgerB));
  check(ledgerB.size() === 1, "79 · and only the flagged rejection writes to it (positive control for 78)");
  await ing2.close();

  console.log("\n  the name, when there is one\n");

  const raises = async (fn: () => Promise<unknown>) => {
    try { await fn(); return false; } catch (e) { return e instanceof EndpointUnresolvable; }
  };
  const named = { AGENT_ENS_NAME: "agent.example.eth", WINDOWS_URL: "https://fallback/never" };
  check(await raises(() => resolveWindowsEndpoint(named, async () => { throw new Error("no rpc"); })),
    "80 · a name that will not resolve raises, and the url is NOT used as a fallback");
  check(await raises(() => resolveWindowsEndpoint(named, async () => null)),
    "81 · a name with no record raises too, because resolving to nothing is not permission to read elsewhere");
  const bothCauses = await resolveWindowsEndpoint(named, async () => null).catch(e => String(e.message));
  check(/not registered/.test(bothCauses) && /carries no such record/.test(bothCauses),
    "81b · and the message names BOTH causes, since a text lookup answers null for each identically (seen to fail)");
  check(await raises(() => resolveWindowsEndpoint(named, async () => "http://plain/windows")),
    "82 · a record naming http is refused, because a bearer credential travels against it");
  check(await endpointResult(named, async () => "https://named/windows") === "https://named/windows",
    "83 · and a record that does resolve is used (negative control for 80 to 82)");

  // The name Zenbit issues, and the check that it names the key this agent pays from.
  // The instrument is
  // `addr` rather than the resolver, because wildcard resolution under the parent
  // makes every subname answer the same resolver whether or not anybody issued it.
  const PAYER = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
  const ISSUED = "agent1.xovi.eth";
  const idRaises = async (env: Record<string, string>, addr: string | null) => {
    try { await assertIssuedIdentity(PAYER, env as never, async () => addr); return false; }
    catch (e) { return e instanceof IdentityMismatch; }
  };
  // Every call wrapped, including the ones expected to succeed. A bare call here makes
  // a regression abort the harness rather than print a red line, and an aborted run
  // sends the next person to debug the harness instead of reading the finding.
  const idResult = async (payer: string, env: Record<string, string>, resolve: () => Promise<string | null>) => {
    try { return await assertIssuedIdentity(payer, env as never, resolve as never); }
    catch (e) { return `RAISED ${e instanceof Error ? e.constructor.name : "unknown"}`; }
  };

  // Counted rather than asserted. "Does not reach the chain" is a claim about calls,
  // and until something counts them the label is true of nothing.
  let idLookups = 0;
  const countingResolver = async () => { idLookups++; return PAYER; };
  check(await idResult(PAYER, {}, countingResolver) === null && idLookups === 0,
    "83b · no configured name claims nothing, and never reaches the chain to say so");
  check(await idResult(PAYER, { AGENT_IDENTITY_NAME: ISSUED }, countingResolver) === ISSUED && idLookups === 1,
    "83c · a name issued to the payer is returned, and that one did reach the resolver (positive control for 83b)");
  check(await idRaises({ AGENT_IDENTITY_NAME: ISSUED }, null),
    "83d · a name with no address record raises, because an unissued subname resolves like an issued one");
  check(await idRaises({ AGENT_IDENTITY_NAME: ISSUED }, "0x0000000000000000000000000000000000000000"),
    "83e · and a zero address raises too, which is what the parent answers for a name nobody issued");
  check(await idRaises({ AGENT_IDENTITY_NAME: ISSUED }, "0x51F1D0074793E7Fa336f538299ad7D3e439e2b09"),
    "83f · a name issued to a DIFFERENT address raises, rather than proposing under a name issued to somebody else");
  check(await idResult(PAYER.toLowerCase(), { AGENT_IDENTITY_NAME: ISSUED }, async () => PAYER.toUpperCase().replace("0X", "0x")) === ISSUED,
    "83g · and checksum casing is not a mismatch, so a correct name is never refused for its spelling");

  console.log("\n  what the route would refuse, refused here first\n");

  check(windowProblems(win({ startTime: -1, endTime: 5 })).length > 0, "84 · a negative start time");
  check(windowProblems(win({ startTime: 86395, endTime: 86500 })).length > 0, "85 · a time past the recording ceiling");
  check(windowProblems(win({ specimenAlias: "" })).length > 0, "86 · an empty alias, which is not the same as none");
  check(windowProblems(win({ videoId: "has spaces" })).length > 0, "87 · a video id outside the character set");
  check(windowProblems(win({ specimenAlias: null })).length === 0, "88 · while a null alias is still fine (negative control)");


  console.log("\n  the human behind the agent\n");

  // What these check, and what they do not. The fake models a property of the real
  // registry that was established by reading the deployed contract: the agent
  // address sits in the World ID signal while the external nullifier is a contract
  // wide constant, so one person yields one identifier across every agent they
  // register. Check 90 proves the fake models that and the code relies on it. It is
  // not evidence about World, and the spec says where that evidence came from.
  const reg = fakeRegistry();
  check(await humanBehind(AGENT_ONE, reg.read) === HUMAN_A, "89 · a registered agent resolves to its human");
  check(await humanBehind(AGENT_TWO, reg.read) === HUMAN_A,
    "90 · and a SECOND agent of the same person resolves to the SAME identifier, which is what a shared budget rests on");
  check(await humanBehind(AGENT_OTHER, reg.read) !== HUMAN_A,
    "91 · while a different person's agent does not (negative control)");
  check(await humanBehind(AGENT_UNREGISTERED, reg.read) === null,
    "92 · an unregistered agent is null, because the registry answers zero rather than reverting");

  reg.mode = "throws";
  check(await humanBehind(AGENT_ONE, reg.read) === null, "93 · a lookup that throws is null, never an allowance");
  reg.mode = "hangs";
  const before = Date.now();
  const hung = await humanBehind(AGENT_ONE, reg.read, 50);
  check(hung === null && Date.now() - before < 1000,
    "94 · and one that hangs gives up on its own, inside the request rather than at the end of it");
  reg.reset();
  check(await humanBehind(AGENT_ONE, reg.read) === HUMAN_A, "95 · then answers again (negative control for 93 and 94)");

  const store = fakeStore();
  check(await store.tryTakeFreeRead("h", "2026-09-07", 2) === true, "95b · a free read is taken");
  check(await store.tryTakeFreeRead("h", "2026-09-07", 2) === true, "95c · and a second, under the limit");
  check(await store.tryTakeFreeRead("h", "2026-09-07", 2) === false, "95d · the third is refused at the limit");
  check(store.counted === 2, "95e · and the refused one did not move the count");
  // Zero is the switch that forces settlement so the paid read can be demonstrated
  // by a payer who is registered, so it is the one limit that must not misbehave.
  // The obvious database statement gets this wrong: ON CONFLICT ... WHERE guards the
  // update and says nothing about the insert, so the first take against an empty row
  // would succeed against a cap that forbids every read.
  const atZero = fakeStore();
  check(await atZero.tryTakeFreeRead("h", "d", 0) === false && atZero.counted === 0,
    "95g · a limit of zero takes nothing, including the first one");
  // The comparison and the increment are one step, so two takes arriving together
  // at the limit minus one cannot both be told there is one left. Split them in the
  // fake and this goes green in the wrong direction, which is the whole reason the
  // interface takes the limit rather than answering how many are left.
  const raced = fakeStore();
  const both = await Promise.all([raced.tryTakeFreeRead("h", "d", 1), raced.tryTakeFreeRead("h", "d", 1)]);
  check(both.filter(Boolean).length === 1 && raced.counted === 1,
    "95f · two takes racing at the last free read yield exactly one");

  const receipt = { nonce: "0xnonce", transactionHash: "0xtx", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", source: "route" as const };
  check(await store.recordReceipt(receipt) === true, "96 · a settlement is recorded");
  check(await store.recordReceipt(receipt) === false, "97 · and the same one again is not, so a replay is counted once");
  check(await store.recordReceipt({ ...receipt, nonce: "0xother" }) === false,
    "98 · a replay under a different nonce is still caught by the transaction hash");
  check(await store.recordReceipt({ ...receipt, nonce: "0xother", transactionHash: "0xother" }) === true,
    "99 · while a genuinely different settlement is recorded (negative control)");
  check(store.receipts.length === 2, "100 · so two rows exist after four attempts");

  // A settlement the ledger cannot believe. The fake facilitator answers with one
  // hash for every settle, and a demo process holding a real connection string
  // wrote it to production on 2026-09-11. The guard is on the data rather than on
  // the plumbing, so it holds whichever database is on the other end.
  const fabricated = { ...receipt, transactionHash: FABRICATED_TX };
  /* The guard announces itself on every refusal, which earns its place in production
   * and earns nothing here, where the refusal is already asserted. Captured rather
   * than silenced, and then checked: a guard that quietly stops announcing itself is
   * one nobody hears from on the day it fires for real. */
  const capturingWarn = async <T>(fn: () => Promise<T>): Promise<{ value: T; warned: string[] }> => {
    const real = console.warn;
    const warned: string[] = [];
    console.warn = (...parts: unknown[]) => void warned.push(parts.map(String).join(" "));
    try { return { value: await fn(), warned }; } finally { console.warn = real; }
  };

  const refuses = (r: typeof receipt) => { try { assertNotFabricated(r); return false; } catch (e) { return e instanceof FabricatedReceipt; } };
  check(refuses(fabricated),
    "100a · a receipt carrying the fake facilitator's hash is refused (seen to fail)");
  check(!refuses(receipt),
    "100b · and an ordinary settlement is not (negative control)");

  // Counted rather than inspected: "it never reaches the store" is a claim about
  // calls, and only a counter can hold it.
  let asked = 0;
  const counting = { ...store, recordReceipt: async () => { asked++; return true; } };
  setCapForTest({ registry: null as never, store: counting as never, freePerDay: 0 });
  const refusal = await capturingWarn(() => recordSettlement(fabricated));
  check(asked === 0, "100c · and recordSettlement never reaches the store with it");
  check(refusal.warned.length === 1 && /ledger guard/.test(refusal.warned[0]) && refusal.warned[0].includes(FABRICATED_TX),
    "100g · while saying so once, naming the hash, so production hears it");
  await recordSettlement({ ...receipt, transactionHash: "0xreal" });
  check(asked === 1, "100d · while a real one does reach it (positive control for 100c)");
  setCapForTest(null);

  // The Postgres copy of the guard, asserted so that nobody removes it later as dead
  // code. The connection string is well formed and unreachable: `neon()` validates
  // the format eagerly, so a malformed one never reaches the guard at all.
  const DEAD = "postgresql://u:p@localhost:1/db";
  const pg = async (r: typeof receipt) =>
    postgresStore(DEAD).recordReceipt(r).then(() => "recorded", e => (e instanceof FabricatedReceipt ? "guard" : "network"));
  check(await pg(fabricated) === "guard",
    "100e · the Postgres store refuses it too, before it opens a connection");
  check(await pg(receipt) === "network",
    "100f · while an ordinary one passes the guard and fails at the connection (negative control for 100e)");

  check(utcDay(new Date("2026-09-07T23:59:59Z")) === "2026-09-07" && utcDay(new Date("2026-09-08T00:00:01Z")) === "2026-09-08",
    "101 · the window turns over at UTC midnight, not at whoever is watching");
  check(freeReadsPerDay({}) === 20 && freeReadsPerDay({ HUMAN_FREE_READS_PER_DAY: "3" }) === 3,
    "102 · the free count has a default and can be turned down for a demo");
  check(freeReadsPerDay({ HUMAN_FREE_READS_PER_DAY: "banana" }) === 20 && freeReadsPerDay({ HUMAN_FREE_READS_PER_DAY: "-1" }) === 20,
    "103 · and a value that is not a count falls back rather than becoming one");


  console.log("\n  one human, one cap, through the route\n");

  const fac2 = await startFakeFacilitator();
  const seen2: Response[] = [];
  const routeFetch2: typeof fetch = async (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const res = await GET(new Request(u, init));
    seen2.push(res.clone());
    return res;
  };
  process.env.X402_PAY_TO = PAY_TO;
  process.env.X402_NETWORK = "eip155:84532";
  process.env.X402_FACILITATOR_URL = fac2.url;
  process.env.X402_PRICE = "$0.01";
  process.env.WINDOWS_SNAPSHOT = "fixtures/windows.synthetic.jsonl";
  // Obviously not a real key. Without one there is no derivation, so there is no
  // allowance and every read settles, which is checked separately below.
  process.env.HUMAN_ID_KEY = "0".repeat(64);
  resetServerForTest();
  fac2.reset();

  // Two payers, two keys, both belonging to one person in the registry. That is
  // the whole of criterion two and it cannot be checked with one keypair.
  const payerA = buildPayer({ AGENT_PRIVATE_KEY: `0x${"a1".repeat(32)}` });
  const payerB = buildPayer({ AGENT_PRIVATE_KEY: `0x${"b2".repeat(32)}` });
  check(payerA.address !== payerB.address, "104 · the two agents are different addresses (negative control)");
  const capStore = fakeStore();
  setCapForTest({
    registry: fakeRegistry({ [payerA.address]: HUMAN_A, [payerB.address]: HUMAN_A }).read,
    store: capStore,
    freePerDay: 2,
  });

  const free1 = await payingFetch(ROUTE_URL, payerA, routeFetch2);
  const free2 = await payingFetch(ROUTE_URL, payerA, routeFetch2);
  check(free1.status === 200 && free2.status === 200, "105 · a verified human's reads are served");
  check(fac2.hits.settle === 0, "106 · and nothing settled, so the allowance really is free");
  check(capStore.counted === 2, "107 · two free reads are counted against the human, not the address");

  // A plausible hash, because the facilitator's default is the one the ledger
  // refuses and this check is about a settlement that is supposed to be recorded.
  fac2.transaction = `0x${"ab".repeat(32)}`;
  const third = await payingFetch(ROUTE_URL, payerB, routeFetch2);
  check(third.status === 200, "108 · the second agent is still served");
  check(
    fac2.hits.settle === 1,
    "109 · but it SETTLES, because the budget belongs to the human and the first agent already spent it",
  );
  check(capStore.receipts.length === 1 && capStore.receipts[0].source === "route",
    "110 · and the settlement leaves exactly one receipt");

  // The production incident, end to end and through the route rather than at the
  // function. The facilitator's default is the hash a local demo run produces, so a
  // settling read under it must leave the ledger exactly as it was.
  fac2.transaction = FABRICATED_TX;
  const fabricated2 = await capturingWarn(() => payingFetch(ROUTE_URL, payerB, routeFetch2));
  const fabricatedRead = fabricated2.value;
  check(fabricated2.warned.length === 1, "110c · the route's refusal announces itself exactly once");
  check(fabricatedRead.status === 200 && fac2.hits.settle === 2,
    "110a · a further read settles as well, so the write path was reached");
  check(capStore.receipts.length === 1,
    "110b · and yet the fabricated settlement leaves NO new row (the production incident)");
  // Back to a recordable hash. Checks below here settle too, and leaving the
  // unrecordable one in place would run them in a state this suite never had.
  fac2.transaction = `0x${"cd".repeat(32)}`;
  check(capStore.counted === 2, "111 · a paid read adds nothing to the free count (negative control for 107)");

  // A payer the registry does not know pays like anyone else.
  const stranger = buildPayer({ AGENT_PRIVATE_KEY: `0x${"c3".repeat(32)}` });
  const before2 = fac2.hits.settle;
  const strangerRead = await payingFetch(ROUTE_URL, stranger, routeFetch2);
  check(strangerRead.status === 200 && fac2.hits.settle === before2 + 1,
    "112 · an agent nobody has registered settles every time, which is the rail this was laid on");
  // The restoration above is a guard, and until this line nothing asserted it: delete
  // it and the suite stayed green while every settle below ran under the unrecordable
  // hash, announcing it only through a warning established to be one nobody reads. This
  // depends on the stranger's settlement having been RECORDED, so it goes red instead.
  check(capStore.receipts.length === 2,
    "112b · and it is recorded, which is what makes the restored hash above load-bearing");

  setCapForTest(null);
  await fac2.close();
  void seen2;


  console.log("\n  what the table is allowed to hold\n");

  const DKEY = { HUMAN_ID_KEY: "a".repeat(64) };
  const raw = 111111111111111111111111n;
  const digest = deriveIdentifier(raw, DKEY);
  check(digest !== raw.toString(), "119 · what is stored is not the identifier");
  check(!raw.toString().startsWith(digest) && !digest.startsWith(raw.toString()),
    "120 · and is not a prefix of it either, so it cannot be matched by truncation");
  check(/^[0-9a-f]{64}$/.test(digest), "121 · it is a fixed width lowercase hex digest, so its length says nothing");
  check(deriveIdentifier(raw, DKEY) === digest,
    "122 · the derivation is deterministic, which is what keeps two agents of one person on one row");
  check(deriveIdentifier(raw, { HUMAN_ID_KEY: "b".repeat(64) }) !== digest,
    "123 · and it is keyed, so the same person derives differently under a different key");
  let noKey = false;
  try { deriveIdentifier(raw, {}); } catch (e) { noKey = e instanceof NoDerivationKey; }
  check(noKey, "124 · a missing key throws rather than falling back to storing the identifier");
  check(await takeFreeRead("0x1", { HUMAN_ID_KEY: "" }, new Date()) === false,
    "125 · and with no key nothing is taken, so every read settles");

  const kept = fakeStore();
  const today = new Date("2026-09-08T12:00:00Z");
  await kept.tryTakeFreeRead("d", "2026-09-08", 5);
  await kept.tryTakeFreeRead("d", "2026-07-01", 5);
  check(kept.counted === 2, "126 · two days of usage exist (negative control)");
  await kept.forgetOlderThan(RETENTION_DAYS, today);
  check(kept.counted === 1, `127 · and the one past ${RETENTION_DAYS} days is forgotten, without a scheduler`);

  /*
   * The spend ceiling must not refuse the ruled price.
   *
   * It was $0.05 while the ruled price is $0.50, so the payer rejected the
   * challenge before signing it and a run ended with nothing settled. A ceiling
   * below the price is a refusal of the product rather than a guard on it, and
   * the guard is for a price that arrives with a zero too many.
   */
  const cents = (money: string) => Math.round(Number(money.replace("$", "")) * 1e6);
  check(cents(MAX_PER_PAYMENT) >= 500_000, `290 · the ceiling admits the ruled price of 0.50 (${MAX_PER_PAYMENT})`);
  check(cents("$0.05") < 500_000, "290a · while the ceiling it replaced refused it (negative control)");
  check(cents(MAX_PER_PAYMENT) < 10_000_000, "290b · and still catches a price with a zero too many");
  const exampleEnv = readFileSync(join(process.cwd(), ".env.example"), "utf8");
  // `$0` is expanded by the env loader, so an unescaped example loads as `.50`
  // and the paid route answers 500 naming a format nobody wrote.
  const unescaped = [...exampleEnv.matchAll(/^[A-Z0-9_]+=\$\d/gm)].map(m => m[0]);
  check(unescaped.length === 0, `291 · no example value starts with an unescaped dollar zero (${unescaped.join(", ") || "none"})`);
  check(/^[A-Z0-9_]+=\$\d/m.test("X402_PRICE=$0.50"), "291a · the escape check can see an unescaped one (negative control)");

  await anchorChecks(check);
  await mcpChecks(check);
  await agentRunChecks(check);
  await receiptsChecks(check);
  await proposalsChecks(check);
  await nameChecks(check);
  await namesChecks(check);
  await boardChecks(check);

  await pageChecks(check);

  console.log(`\n  ${n - bad}/${n} passed\n`);
  process.exitCode = bad ? 1 : 0;
}
main().catch(e => {
  console.error("  suite failed:", e);
  process.exitCode = 1;
});
