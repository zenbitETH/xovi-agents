import { buildPayer, payingFetch } from "../lib/agent/pay";

/**
 * The live probe. Run by hand, never in CI.
 *
 * The suite proves the route settles only for work that succeeded, and it proves
 * it against a facilitator that believes everything it is told. What it cannot
 * prove is that a real facilitator rejects a forged signature, or that any USDC
 * moves. That is what this does, and it is the reason it needs a funded key and
 * therefore cannot run unattended.
 *
 *   WINDOWS_URL=https://host/api/agent/windows AGENT_PRIVATE_KEY=0x... npm run probe
 *
 * It prints a transaction hash. Paste it, and the payer address, into the pull
 * request: an explorer link is the evidence, and this script's own output is not.
 */
const EXPLORER = "https://sepolia.basescan.org/tx/";

async function main() {
  const url = process.env.WINDOWS_URL;
  if (!url) throw new Error("WINDOWS_URL is not set");

  const payer = buildPayer();
  console.log(`  payer      ${payer.address}`);

  // The recipient is read from the live challenge rather than from this machine's
  // environment. Reading it from the env would compare the payer against what the
  // operator believes the server charges to, which is exactly the value that is
  // wrong when this check matters.
  const challenge = await fetch(url, { headers: { accept: "application/json" } });
  const required = challenge.headers.get("PAYMENT-REQUIRED");
  if (challenge.status !== 402 || !required) {
    throw new Error(`expected a 402 carrying PAYMENT-REQUIRED, got ${challenge.status}`);
  }
  const decoded = JSON.parse(Buffer.from(required, "base64").toString("utf8"));
  const payTo = String(decoded?.accepts?.[0]?.payTo ?? "");
  console.log(`  payTo      ${payTo || "(unreadable)"}`);
  if (payTo && payTo.toLowerCase() === payer.address.toLowerCase()) {
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
