/**
 * The paying client for the query tool.
 *
 * Spawns the server over stdio, calls the tool, is refused, pays and calls again.
 * The refusal is a tool result carrying `isError` and an x402 challenge in its
 * content, and the receipt comes back in the result's metadata. This script prints
 * whether it saw a receipt, because "it worked" is not evidence about which surface
 * carried the payment.
 *
 * The refusal shape is measured by the suite. The settled path is not, and for a
 * while nothing had exercised it: this script could not run at all, because the
 * server it spawns was given six environment variables and needs nine.
 *
 * It has now run, on 2026-09-11: 0.01 USDC on Base Sepolia settled at
 * `0xff77ba0a9000f495af74325c37f37c8c407c1ce0a3af9f780ff75a5e9d9e61e2`, returning
 * the indexed observation for clip 259. One run against a live facilitator is not
 * a guarantee about the next one, and the suite still measures only the refusal.
 */
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createx402MCPClient } from "@x402/mcp";
import { privateKeyToAccount } from "viem/accounts";
import { TOOL_NAME } from "../lib/mcp/server";
import { payAndCall } from "../lib/mcp/pay";
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
    // Off, because the payment is built once here and resent unchanged on a retry.
    autoPayment: false,
    onPaymentRequested: async ({ paymentRequired }) => {
      const a = paymentRequired.accepts[0];
      console.log(`  challenged: ${a?.amount ?? "?"} to ${a?.payTo ?? "?"}`);
      return true;
    },
  });

  // Two transports, one client. `--url` reaches a deployed route, which is the path
  // a judge takes; with no url the server is spawned here, so the local demo needs
  // no second terminal and the server's stderr lands beside the client's output.
  // The payment is identical either way: it is signed by this key and settled by
  // the facilitator, and a transport moves bytes.
  const url = process.argv.includes("--url") ? arg("--url", "") : "";
  if (url) console.log(`  over http: ${url}`);
  // The spawned server needs its own configuration and does NOT inherit this
  // process's environment. `StdioClientTransport` with no `env` uses the SDK's
  // `getDefaultEnvironment()`, which passes exactly HOME, LOGNAME, PATH, SHELL, TERM
  // and USER, measured against the installed package rather than read from its docs.
  // So `X402_PAY_TO`, `SUBGRAPH_URL` and `ANCHOR_RPC_URL` all arrived unset and the
  // server died on the first of them before the client had sent anything. It failed
  // loudly, which is the only reason this was ever found.
  //
  // Named rather than spreading the whole environment: the payer key is read HERE
  // and the server never needs it, so handing it over gives a child a credential
  // for no purpose.
  //
  // **The list comes from the import graph, not from what throws.** The first
  // version of it was derived by asking which variables make the server fail, which
  // found six and missed `DATABASE_URL`. That one is read by `recordSettlement`
  // through `storeFrom`, which returns quietly when it is absent, so a paid query
  // would have settled real testnet USDC and written no receipt, silently, while
  // the deployed server wrote one. **A variable that throws when missing announces
  // itself. A variable that is merely read does not, and that is the kind worth
  // hunting.** The cap's own variables are not here because this path never calls
  // it; add them the day it does.
  const SERVER_ENV = [
    "SUBGRAPH_URL",
    "ANCHOR_RPC_URL",
    "X402_PAY_TO",
    "X402_PRICE",
    "X402_NETWORK",
    "X402_FACILITATOR_URL",
    "DATABASE_URL",
  ] as const;
  const childEnv: Record<string, string> = { ...getDefaultEnvironment() };
  for (const k of SERVER_ENV) if (process.env[k]) childEnv[k] = process.env[k] as string;

  const transport = url
    ? new StreamableHTTPClientTransport(new URL(url))
    : new StdioClientTransport({ command: "npx", args: ["tsx", "bin/mcp-server.ts"], env: childEnv });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`  tools offered: ${tools.tools.map(t => t.name).join(", ")}`);

  // The three steps written out rather than the library's automatic mode, so a
  // counterparty that flakes can be retried with the SAME authorization. Automatic
  // mode cannot be retried: retrying it signs again, and that is a second payment.
  const call = await payAndCall(client as never, TOOL_NAME, { limit: Number(arg("--limit", "3")) });
  const result = call.result as { content?: { type: string; text?: string }[] };

  for (const a of call.log) console.log(`  attempt ${a.attempt}: ${a.outcome}`);
  const receipt = call.receipt;
  console.log(`\n  settled: ${receipt ? "yes" : call.log.at(-1)?.outcome === "already-settled" ? "yes, on an earlier attempt" : "no"}`);
  if (receipt) console.log(`  transaction: ${receipt.transaction} on ${receipt.network}`);
  for (const c of result.content ?? []) {
    if (c.type === "text" && typeof c.text === "string") console.log(`\n${c.text}`);
  }

  await client.close();
}

main().catch(err => {
  console.error("  query failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
