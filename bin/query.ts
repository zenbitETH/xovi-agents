/**
 * The paying client for the query tool.
 *
 * Spawns the server over stdio, calls the tool, is refused, pays and calls again.
 * The refusal is a tool result carrying `isError` and an x402 challenge in its
 * content, and the receipt comes back in the result's metadata. This script prints
 * whether it saw a receipt, because "it worked" is not evidence about which surface
 * carried the payment.
 *
 * The refusal shape is measured by the suite. **The settled path is not:** paying
 * end to end needs a funded payer and the live facilitator, and that run has not
 * happened, so nothing here should be read as evidence that a receipt has ever
 * arrived.
 */
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { MCP_PAYMENT_RESPONSE_META_KEY, createx402MCPClient, extractPaymentResponseFromMeta } from "@x402/mcp";
import { privateKeyToAccount } from "viem/accounts";
import { TOOL_NAME } from "../lib/mcp/server";
import { readConfig } from "../lib/x402";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main() {
  const key = (process.env.AGENT_PRIVATE_KEY ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("AGENT_PRIVATE_KEY is not a 32 byte hex key");
  const account = privateKeyToAccount(key as `0x${string}`);
  const cfg = readConfig(process.env);
  // The same check the paid read makes, for the same reason: a self payment
  // settles without complaint and proves nothing, and puts two identical
  // addresses in the screenshot.
  if (account.address.toLowerCase() === cfg.payTo.toLowerCase()) {
    throw new Error("payer and payTo are the same address: a self payment settles and proves nothing");
  }

  const client = createx402MCPClient({
    name: "xovi-agents-query",
    version: "0.1.0",
    // The scheme's Network is a branded union the config takes as a string; the
    // cast is on that one field and nothing else.
    schemes: [{ network: cfg.network as never, client: new ExactEvmScheme(account) }],
    autoPayment: true,
    onPaymentRequested: async ({ paymentRequired }) => {
      const a = paymentRequired.accepts[0];
      console.log(`  challenged: ${a?.amount ?? "?"} to ${a?.payTo ?? "?"}`);
      return true;
    },
  });

  // Spawned rather than reached over a socket, so the demo needs no second
  // terminal and the server's stderr lands beside the client's output.
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "bin/mcp-server.ts"] });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`  tools offered: ${tools.tools.map(t => t.name).join(", ")}`);

  const result = await client.callTool(TOOL_NAME, { limit: Number(arg("--limit", "3")) });

  const receipt = extractPaymentResponseFromMeta(result);
  console.log(`\n  receipt in _meta["${MCP_PAYMENT_RESPONSE_META_KEY}"]: ${receipt ? "yes" : "no"}`);
  if (receipt) console.log(`  settlement: ${JSON.stringify(receipt)}`);
  for (const c of result.content ?? []) {
    if (c.type === "text" && typeof c.text === "string") console.log(`\n${c.text}`);
  }

  await client.close();
}

main().catch(err => {
  console.error("  query failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
