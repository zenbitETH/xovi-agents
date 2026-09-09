import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { QueryMisconfigured, registerObservationsTool } from "~~/lib/mcp/server";
import { PaymentMisconfigured } from "~~/lib/x402";

export const dynamic = "force-dynamic";

/**
 * The paid query over the network, so a stranger can complete the flow unaided.
 *
 * The web standard transport rather than the Node one, because a route handler is
 * given a Request and returns a Response and the Node transport wants an
 * IncomingMessage and a ServerResponse it will never have here.
 *
 * **Stateless, and that is a mode rather than a workaround.** Omitting
 * `sessionIdGenerator` disables session management outright, and
 * `enableJsonResponse` answers with JSON instead of opening a stream. A serverless
 * function is not sticky, so anything remembered between requests would be
 * remembered on one machine and missing on the next; here nothing is remembered and
 * a fresh server is built per request.
 *
 * What a caller can do here: read windows, run this query, fetch a payload and
 * check a signature. What nobody can do over any network surface: propose a clip.
 * That needs a minted, scoped credential and stays gated.
 */
const CORS = {
  // Deliberately open, on this route only. There is no cookie, no session and no
  // ambient credential of any kind: every call carries its own signed payment or is
  // refused. So a hostile page cannot spend a visitor's funds, because it has no
  // key to sign with, and the worst it can do is pay for its own query. The reason
  // to open it is that a judge's client should simply work.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
} as const;

async function handle(request: Request): Promise<Response> {
  let server: McpServer;
  try {
    server = new McpServer({ name: "xovi-agents", version: "0.1.0" });
    registerObservationsTool(server as never);
  } catch (err) {
    // Fails closed and says which half is missing, the same as the paid read: a
    // query endpoint that cannot charge does not become free, and one that cannot
    // reach an index says so rather than answering an empty list.
    const why =
      err instanceof PaymentMisconfigured
        ? "el cobro no está configurado"
        : err instanceof QueryMisconfigured
          ? err.message
          : "unexpected";
    return NextResponse.json({ error: "la consulta no está configurada", detail: why }, { status: 503, headers: CORS });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    // No generator, so no sessions. See the note above.
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const response = await transport.handleRequest(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
