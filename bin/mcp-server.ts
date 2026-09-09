/**
 * The paid query, as an MCP server over stdio.
 *
 * One tool, on the same payment rail as the paid read. A client that calls it
 * without paying gets a tool RESULT carrying `isError` and an x402 challenge in its
 * content, with no metadata; it pays and calls again, and the receipt comes back in
 * the result's metadata. Not a thrown error and not a header, which the suite pins
 * because reading the declarations suggested otherwise and running it settled it.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOL_NAME, buildPaidTool, registerObservationsTool } from "../lib/mcp/server";

async function main() {
  const { price, network, payTo } = buildPaidTool();
  const server = new McpServer({ name: "xovi-agents", version: "0.1.0" });

  // The same registration the networked route uses. Defining the tool twice is how
  // the offline checks would stop being evidence about the deployed one.
  registerObservationsTool(server as never);

  // To stderr, because stdout is the protocol channel and anything written there
  // that is not a message corrupts the stream.
  console.error(`  ${TOOL_NAME}: ${price} on ${network} to ${payTo}`);

  await server.connect(new StdioServerTransport());
}

main().catch(err => {
  console.error("  mcp server failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
