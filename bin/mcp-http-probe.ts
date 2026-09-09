/**
 * The 402 shape, measured over the network instead of over stdio.
 *
 * Everything the suite knows about the refusal was measured through a pipe. The
 * payment wrapper builds its refusal at the tool callback layer and never touches a
 * transport, so it should serialise identically, and a structural reading is not a
 * run. This is the run.
 *
 * Needs a server: `npm run dev` with the query configured, then this against it.
 * Not part of the suite, which is offline.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MAX_LIMIT, TOOL_NAME } from "../lib/mcp/server";

const URL_ = process.env.MCP_URL ?? "http://127.0.0.1:3000/api/mcp";

let n = 0;
let bad = 0;
const check = (ok: boolean, label: string) => {
  n++;
  if (!ok) bad++;
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}`);
};

async function main() {
  console.log(`\n  against ${URL_}\n`);
  const client = new Client({ name: "http-probe", version: "0" });

  // The risk worth measuring first: the client may want a session or a stream that
  // a stateless server does not give it.
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));
  check(true, "H1 · a stateless server accepts the real streamable client's connect");

  const tools = await client.listTools();
  check(tools.tools.some(t => t.name === TOOL_NAME), "H2 · the tool is listed over the network");
  check(
    tools.tools.find(t => t.name === TOOL_NAME)?.description?.includes(String(MAX_LIMIT)) === true,
    `H3 · and advertises the same cap as the local path (${MAX_LIMIT})`,
  );

  const result = (await client.callTool({ name: TOOL_NAME, arguments: { limit: 1 } })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
    _meta?: Record<string, unknown>;
  };

  check(result.isError === true, "H4 · an unpaid call is refused as a tool result, exactly as over stdio");
  let payload: { x402Version?: number; accepts?: { amount?: string; asset?: string }[]; resource?: { url?: string } } = {};
  try {
    payload = JSON.parse(result.content?.[0]?.text ?? "");
  } catch {
    /* the checks below fail on it */
  }
  check(payload.x402Version === 2, "H5 · carrying an x402 v2 challenge in its content");
  check(Boolean(payload.accepts?.[0]?.amount) && Boolean(payload.accepts?.[0]?.asset),
    "H6 · with an amount and an asset");
  check(payload.resource?.url === `mcp://tool/${TOOL_NAME}`, "H7 · and the resource naming this tool");
  check(result._meta === undefined, "H8 · and no metadata on the refusal, as over stdio");

  await client.close();
  console.log(`\n  ${n - bad}/${n} passed\n`);
  process.exitCode = bad ? 1 : 0;
}

main().catch(e => {
  console.error("  http probe failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
