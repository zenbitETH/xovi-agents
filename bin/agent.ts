import { resolveWindowsEndpoint } from "../lib/agent/ens";
import { DEFAULT_LEDGER_PATH, loadLedger, unrefused } from "../lib/agent/ledger";
import { assertRecipient, buildPayer, payingFetch } from "../lib/agent/pay";
import { UnproposableWindow, propose } from "../lib/agent/propose";
import { windowProblems } from "../lib/windows/types";
import type { CandidateWindow } from "../lib/windows/types";

/**
 * Read a window, propose a clip, stop.
 *
 * The stopping is the point. There is no confirmation step here and there is no
 * way to add one: the credential's capability set has no confirm member, and the
 * route that decides a clip has no bearer branch at all, so a machine cannot reach
 * it with any credential that exists. That is inherited from the ingest design
 * rather than asserted here, which is a stronger thing to be able to say.
 *
 *   WINDOWS_URL=... AGENT_PRIVATE_KEY=0x... XOVI_INGEST_URL=... XOVI_INGEST_KEY=xvi_... npm run agent
 *   npm run agent -- --dry-run       print what would be sent, send nothing
 *   npm run agent -- --limit 1       propose at most one window
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag === -1 ? Infinity : Number(process.argv[limitFlag + 1]);
  if (!Number.isFinite(limit) && limitFlag !== -1) throw new Error("--limit needs a number");

  const ledgerPath = process.env.AGENT_LEDGER ?? DEFAULT_LEDGER_PATH;
  const ledger = loadLedger(ledgerPath);
  const windowsUrl = await resolveWindowsEndpoint();

  const payer = buildPayer();
  console.log(`  payer      ${payer.address}`);
  console.log(`  windows    ${windowsUrl}`);
  console.log(`  ledger     ${ledgerPath} (${ledger.size()} refused)`);

  // Checked before paying, and this endpoint may have come from a record anyone
  // with the name's write role can change, so the recipient is not something this
  // process can assume it already knows.
  const payTo = await assertRecipient(windowsUrl, payer);
  console.log(`  payTo      ${payTo}`);

  const read = await payingFetch(windowsUrl, payer);
  if (read.status !== 200) throw new Error(`the paid read returned ${read.status}: ${JSON.stringify(read.body)}`);
  if (read.settlement) console.log(`  paid       ${read.settlement.transaction}`);

  const raw = (read.body as { windows?: unknown[] })?.windows ?? [];
  // Validated on arrival even though this agent paid for it. Nothing here produced
  // these records, and a window that does not hold its shape is a producer bug
  // that should stop at the boundary rather than become a malformed proposal.
  const bad = raw.map(w => windowProblems(w)).filter(p => p.length > 0);
  if (bad.length > 0) throw new Error(`the endpoint served ${bad.length} malformed window(s): ${bad[0].join("; ")}`);
  const windows = raw as CandidateWindow[];

  const fresh = unrefused(windows, ledger);
  console.log(`  served     ${windows.length}, ${windows.length - fresh.length} already refused\n`);

  const url = process.env.XOVI_INGEST_URL;
  const key = process.env.XOVI_INGEST_KEY;
  if (!dryRun && (!url || !key)) throw new Error("XOVI_INGEST_URL and XOVI_INGEST_KEY are needed to propose");

  let sent = 0;
  let refusals = 0;
  let stopped = "";
  for (const w of fresh) {
    if (sent >= limit) break;
    if (dryRun) {
      console.log(`  would propose ${w.windowId}  ${w.stationId}  ${w.startTime} to ${w.endTime}`);
      sent++;
      continue;
    }
    let result;
    try {
      result = await propose(w, { url: url as string, key: key as string, ledger });
    } catch (err) {
      if (err instanceof UnproposableWindow) {
        console.log(`  skipped    ${w.windowId}  ${err.message}`);
        continue;
      }
      throw err;
    }
    sent++;
    switch (result.kind) {
      case "proposed":
        console.log(`  proposed   ${w.windowId}  clip ${result.id}  ${result.status}`);
        break;
      case "duplicate":
        console.log(`  already in ${w.windowId}  ${result.clipHash}`);
        break;
      case "rejected":
        // Recorded by propose() before it returned, so a crash on the next line
        // cannot lose the refusal and make the next run ask again.
        console.log(`  refused    ${w.windowId}  a person said no, and this window is now closed`);
        break;
      case "throttled":
        // Belongs to the credential, not to this window, so walking on would spend
        // the rest of the snapshot earning the same answer.
        refusals++;
        stopped = `rate limited, retry after ${result.retryAfterSeconds}s`;
        break;
      case "refused":
        refusals++;
        console.log(`  error      ${w.windowId}  ${result.status} ${result.error}`);
        if (result.hint) console.log(`             ${result.hint}`);
        if (result.issues) console.log(`             ${JSON.stringify(result.issues)}`);
        // 401 is the credential, and a 403 that is not about station coverage is
        // the credential too: a revoked or under-scoped key answers every window
        // the same way, so the next attempt is not new information. A 400, a 422
        // or the station 403 are about this window, and the run walks on.
        if (result.status === 401 || (result.status === 403 && !result.hint)) {
          stopped = `the credential was refused: ${result.error}`;
        }
        break;
    }
    if (stopped) break;
  }
  if (stopped) console.log(`\n  stopped early: ${stopped}`);
  console.log(`\n  ${sent} window(s) handled, ${refusals} refused. Confirmation is a human action and this agent has no path to it.`);

  // A run in which nothing was proposed is not a success, and neither is one where
  // every proposal was refused. A rotated credential answers 401 to everything, and
  // exiting zero would make that indistinguishable to whatever schedules this from
  // a night on which the detector simply found nothing.
  if (stopped || refusals > 0) process.exitCode = 1;
  else if (sent === 0) {
    console.log("  nothing was proposed, which is a result and not a success");
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("  agent failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
