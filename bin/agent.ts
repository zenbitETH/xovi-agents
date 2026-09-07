import { resolveWindowsEndpoint } from "../lib/agent/ens";
import { DEFAULT_LEDGER_PATH, loadLedger, unrefused } from "../lib/agent/ledger";
import { buildPayer, payingFetch } from "../lib/agent/pay";
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
      case "refused":
        console.log(`  error      ${w.windowId}  ${result.status} ${result.error}`);
        if (result.hint) console.log(`             ${result.hint}`);
        break;
    }
  }
  console.log(`\n  ${sent} window(s) handled. Confirmation is a human action and this agent has no path to it.`);
}

main().catch(err => {
  console.error("  agent failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
