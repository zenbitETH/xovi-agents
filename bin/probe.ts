import { buildPayer, payingFetch } from "../lib/agent/pay";

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
  const challenge = await fetch(url, { headers: { accept: "application/json" } });
  if (challenge.status !== 402) throw new Error(`expected a 402, got ${challenge.status}`);
  const challengeBody = await challenge.json().catch(() => ({}));

  // Decoded by the client, not by hand. The encoding is plain base64 today, so a
  // hand decode is not wrong, it is a second copy of a rule that lives in the
  // dependency, and the copy is where the next version quietly diverges.
  const required = payer.http.getPaymentRequiredResponse(name => challenge.headers.get(name), challengeBody);
  const payTo = required.accepts[0]?.payTo;

  // An unreadable recipient is a refusal, never a shrug. The first version of this
  // printed "(unreadable)" and paid anyway, which skipped the comparison on exactly
  // the input the comparison exists for.
  if (!payTo) throw new Error("the challenge names no recipient, so the payer cannot be compared against it");
  console.log(`  payTo      ${payTo}`);
  if (payTo.toLowerCase() === payer.address.toLowerCase()) {
    throw new Error("payer and payTo are the same address: a self payment settles and proves nothing");
  }

  const result = await payingFetch(url, payer);
  console.log(`  status     ${result.status}`);
  console.log(`  payment    ${result.paymentStatus}`);
  if (!result.settlement) throw new Error(`nothing settled: ${JSON.stringify(result.body)}`);
  console.log(`  network    ${result.settlement.network}`);
  console.log(`  tx         ${EXPLORER}${result.settlement.transaction}`);

  const windows = (result.body as { windows?: unknown[] })?.windows;
  console.log(`  windows    ${Array.isArray(windows) ? windows.length : "none"}`);
}

main().catch(err => {
  console.error("  probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
