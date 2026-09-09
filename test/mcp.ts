import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_PAYMENT_META_KEY, MCP_PAYMENT_REQUIRED_CODE, MCP_PAYMENT_RESPONSE_META_KEY } from "@x402/mcp";
import { TOOL_NAME, atomicAmount } from "../lib/mcp/server";

type Check = (ok: boolean, label: string) => void;

/**
 * The refusal, observed rather than described.
 *
 * The server is spawned and actually called, because the shape of this refusal is
 * the one thing about this leg that reading the package could not settle. The
 * types say a payment-required error exists and the wrapper does not use it: an
 * unpaid call comes back as a tool RESULT carrying `isError` and an x402 payload,
 * with no metadata at all. Nothing about that is visible in a declaration file.
 *
 * Offline. No facilitator is contacted, because nothing pays.
 */
const ENV = {
  X402_PAY_TO: "0x2Be7e36bF7B1A99999999999999999999999999b",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  SUBGRAPH_URL: "http://127.0.0.1:9/none",
  ANCHOR_RPC_URL: "http://127.0.0.1:9/none",
};

export async function mcpChecks(check: Check) {
  // Each constant is asserted defined before anything is compared against it. A
  // renamed export is `undefined`, and `x[undefined]` returns undefined while
  // `code === undefined` compares false, so a negative assertion against a name
  // that no longer exists passes for the wrong reason.
  check(MCP_PAYMENT_REQUIRED_CODE === 402, "149 · the payment required code is defined and is 402");
  check(MCP_PAYMENT_META_KEY === "x402/payment", "150 · the request metadata key is defined");
  check(MCP_PAYMENT_RESPONSE_META_KEY === "x402/payment-response", "151 · the response metadata key is defined");
  check(atomicAmount("$0.01", 6) === "10000", "152 · a dollar price becomes the token's smallest unit");

  const client = new Client({ name: "suite", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "bin/mcp-server.ts"],
      env: { ...process.env, ...ENV } as Record<string, string>,
    }),
  );

  const tools = await client.listTools();
  check(tools.tools.some(t => t.name === TOOL_NAME), "153 · the tool is offered before anything is paid");

  const result = (await client.callTool({ name: TOOL_NAME, arguments: { limit: 1 } })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
    _meta?: Record<string, unknown>;
  };

  check(result.isError === true, "154 · an unpaid call is refused as a tool result, not as a thrown error");
  const text = result.content?.[0]?.text ?? "";
  let payload: { x402Version?: number; accepts?: { amount?: string; asset?: string; payTo?: string }[]; resource?: { url?: string } } = {};
  try {
    payload = JSON.parse(text);
  } catch {
    /* left empty, and the checks below fail on it */
  }
  check(payload.x402Version === 2, "155 · the refusal carries an x402 v2 challenge in its content");
  check(
    Boolean(payload.accepts?.[0]?.amount) && Boolean(payload.accepts?.[0]?.asset),
    "156 · with an amount and an asset, which a price shorthand would have left empty (seen to fail)",
  );
  check(payload.accepts?.[0]?.amount === "10000", "157 · the amount is the price in the token's smallest unit");
  check(payload.resource?.url === `mcp://tool/${TOOL_NAME}`, "158 · and the resource names this tool rather than a default");
  check(result._meta === undefined, "159 · the refusal carries no metadata, so a check reading it would find nothing and agree");

  await client.close();
}
