import { assertRecipient, buildPayer, payingFetch } from "../lib/agent/pay";

/**
 * The live probe. Run by hand, never in CI.
 *
 * The suite proves the route settles only for work that succeeded, and it proves
 * it against a facilitator that believes everything it is told. What it cannot
 * prove is that a real facilitator rejects a forged signature, or that any USDC
 * moves. That is what this does, and it is why it needs a funded key and
 * therefore cannot run unattended.
 *
 *   WINDOWS_URL=https://host/api/agent/windows AGENT_PRIVATE_KEY=0x... npm run probe
 *
 * It prints a transaction hash. Paste that and the payer address into the pull
 * request: an explorer link is the evidence, and this script's own exit code is not.
 */
const EXPLORER = "https://sepolia.basescan.org/tx/";

async function main() {
  const url = process.env.WINDOWS_URL;
  if (!url) throw new Error("WINDOWS_URL is not set");

  const payer = buildPayer();
  console.log(`  payer      ${payer.address}`);

  // The recipient is read from the live challenge rather than from this machine's
  // environment. Reading it locally would compare the payer against what the
  // operator believes the server charges to, and that belief is exactly the value
  // that is wrong on the day this check matters.
  const payTo = await assertRecipient(url, payer);
  console.log(`  payTo      ${payTo}`);

  const result = await payingFetch(url, payer);
  console.log(`  status     ${result.status}`);
  console.log(`  payment    ${result.paymentStatus}`);
  if (!result.settlement) {
    // The likeliest cause once the cap exists is not a fault. A registered human
    // with allowance left is served free, so this probe asks for the one thing the
    // cap is built to prevent, and saying so here is cheaper than rediscovering it.
    if (result.status === 200) {
      throw new Error(
        "200 without settlement: the payer is a registered human with allowance left. Produce the explorer evidence with HUMAN_FREE_READS_PER_DAY=0 on the endpoint, or from a payer the registry does not know",
      );
    }
    throw new Error(`nothing settled: ${JSON.stringify(result.body)}`);
  }
  console.log(`  network    ${result.settlement.network}`);
  console.log(`  tx         ${EXPLORER}${result.settlement.transaction}`);

  const windows = (result.body as { windows?: unknown[] })?.windows;
  console.log(`  windows    ${Array.isArray(windows) ? windows.length : "none"}`);
}

main().catch(err => {
  console.error("  probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
