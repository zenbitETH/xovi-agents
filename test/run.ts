/**
 * Checks for the paid window read.
 *
 * Every check below has been seen to fail. That is the bar: a check that has only
 * ever been green proves the test ran, not that the behaviour holds. Where a
 * refusal is asserted, a negative control asserts that something is still
 * accepted, because a gate that refuses everything satisfies every refusal test
 * ever written.
 */
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyEmbargo, dropsForEmbargo, embargoedAliases } from "../lib/windows/embargo";
import { SnapshotUnavailable, loadSnapshot } from "../lib/windows/snapshot";
import { windowProblems } from "../lib/windows/types";
import { PaymentMisconfigured, buildServer, paymentHeaderFrom, resetServerForTest } from "../lib/x402";

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

  console.log(`\n  ${n - bad}/${n} passed\n`);
  process.exitCode = bad ? 1 : 0;
}
main().catch(e => {
  console.error("  suite failed:", e);
  process.exitCode = 1;
});
