/**
 * The paid query, as an MCP server over stdio.
 *
 * One tool, on the same payment rail as the paid read. A client that calls it
 * without paying is refused with a JSON-RPC error carrying the payment required
 * code, pays, and calls again; the receipt comes back in the result's metadata.
 * None of those three things is an HTTP header, and a check that asserts on one is
 * testing a surface this protocol does not use.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TOOL_NAME, buildPaidTool } from "../lib/mcp/server";

async function main() {
  const { handler, price, network, payTo } = buildPaidTool();
  const server = new McpServer({ name: "xovi-agents", version: "0.1.0" });

  server.tool(
    TOOL_NAME,
    `Confirmed clip observations, with the reviewer's signature checked (${price} per call)`,
    { limit: z.number().int().min(1).max(50).optional() },
    handler as never,
  );

  // To stderr, because stdout is the protocol channel and anything written there
  // that is not a message corrupts the stream.
  console.error(`  ${TOOL_NAME}: ${price} on ${network} to ${payTo}`);

  await server.connect(new StdioServerTransport());
}

main().catch(err => {
  console.error("  mcp server failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
