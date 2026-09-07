/**
 * Checks for the paid window read.
 *
 * Every check below has been seen to fail. That is the bar: a check that has only
 * ever been green proves the test ran, not that the behaviour holds. Where a
 * refusal is asserted, a negative control asserts that something is still
 * accepted, because a gate that refuses everything satisfies every refusal test
 * ever written.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GET } from "../app/api/agent/windows/route";
import { EndpointUnresolvable, resolveWindowsEndpoint } from "../lib/agent/ens";
import type { Ledger } from "../lib/agent/ledger";
import { loadLedger, unrefused } from "../lib/agent/ledger";
import { buildPayer, payingFetch } from "../lib/agent/pay";
import { PROPOSAL_KEYS, UnproposableWindow, propose, toProposal } from "../lib/agent/propose";
import { applyEmbargo, dropsForEmbargo, embargoedAliases } from "../lib/windows/embargo";
import { SnapshotUnavailable, loadSnapshot } from "../lib/windows/snapshot";
import { windowProblems } from "../lib/windows/types";
import { PaymentMisconfigured, buildServer, paymentHeaderFrom, resetServerForTest } from "../lib/x402";
import { startFakeFacilitator } from "./facilitator";
import { startFakeIngest } from "./ingest";

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
  const okFile = join(tmpdir(), `w-ok-${process.pid}.jsonl`);
  writeFileSync(okFile, JSON.stringify(good()) + "\n");
  check(loadSnapshot({ WINDOWS_SNAPSHOT: okFile }).length === 1, "20 · a valid snapshot loads (negative control)");
  const badFile = join(tmpdir(), `w-bad-${process.pid}.jsonl`);
  writeFileSync(badFile, JSON.stringify(good()) + "\n" + JSON.stringify({ ...good(), confidence: 2000 }) + "\n");
  try {
    loadSnapshot({ WINDOWS_SNAPSHOT: badFile });
    check(false, "21 · one bad row refuses the whole snapshot");
  } catch (e) {
    check(e instanceof SnapshotUnavailable, "21 · one bad row refuses the WHOLE snapshot, rather than serving the readable subset");
  }
  check(loadSnapshot({ WINDOWS_SNAPSHOT: "fixtures/windows.synthetic.jsonl" }).length === 3, "22 · the shipped synthetic fixture is itself valid");

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
  check(fac.hits.settle === 1, "47 · a failed settlement is not retried behind the caller's back");

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
  check(toProposal(win({ behaviorTag: "swim" }) as never).behaviorTag === "swim",
    "52 · a window that does carry a tag keeps it (negative control)");
  check(toProposal(win({ specimenAlias: null }) as never).specimenAlias === null,
    "53 · a null alias survives as a station only tag, because null is a real answer");
  check(toProposal(win({ specimenAlias: "Remo" }) as never).specimenAlias === "Remo",
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

  check(await resolveWindowsEndpoint({ WINDOWS_URL: "https://h/w" }) === "https://h/w",
    "69 · with no name configured the endpoint is the configured url");
  let noneSet = false;
  try { await resolveWindowsEndpoint({}); } catch (e) { noneSet = e instanceof EndpointUnresolvable; }
  check(noneSet, "70 · with neither set it refuses rather than guessing");

  // Comments are stripped first: this file names the route it is looking for, and
  // so does the module it checks, so a naive grep would find its own explanation.
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const agentSources = ["lib/agent/pay.ts", "lib/agent/propose.ts", "lib/agent/ledger.ts", "lib/agent/ens.ts", "bin/agent.ts", "bin/probe.ts"];
  const reaching = agentSources.filter(f => /\/api\/(verify|curate)/.test(strip(readFileSync(f, "utf8"))));
  check(reaching.length === 0,
    `71 · nothing the agent runs reaches a decision route (${reaching.join(", ") || "none"})`);
  // Payment cannot become authorisation on this side because the module that
  // proposes cannot see the module that pays: no proposal can be conditioned on
  // having paid, since it has no way to ask. The other half of that invariant is
  // enforced in the repository this one cannot change.
  const proposeSource = readFileSync("lib/agent/propose.ts", "utf8");
  check(!/from\s+"\.\/pay"/.test(proposeSource) && !/payingFetch|buildPayer/.test(strip(proposeSource)),
    "72 · the proposing module cannot see the paying one, so a proposal cannot be conditioned on payment");

  console.log(`\n  ${n - bad}/${n} passed\n`);
  process.exitCode = bad ? 1 : 0;
}
main().catch(e => {
  console.error("  suite failed:", e);
  process.exitCode = 1;
});
