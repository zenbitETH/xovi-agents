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
  // Deliberately open, on this route only, and the reasoning has to cover three
  // properties rather than two.
  //
  // Confidentiality and integrity: there is no cookie, no session and no ambient
  // credential of any kind, and every call carries its own signed payment or is
  // refused. A hostile page cannot spend a visitor's funds because it has no key to
  // sign with, and the worst it can do is pay for its own query.
  //
  // Availability, which is the one an open origin actually threatens. Opening this
  // to any origin is what makes it reachable from a page in a visitor's browser, so
  // any request that can be held open is an invocation a stranger's page can pin.
  // GET is refused below for exactly that reason: a stateless server rebuilt per
  // request can never send a message down a stream, so an accepted stream is an
  // invocation held open to do nothing. With GET refused immediately there is
  // nothing to hold, and the open origin is safe on all three counts.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

/**
 * Refused, and refused fast.
 *
 * The streamable transport offers a GET stream for server-initiated messages and a
 * DELETE to end a session. This server is stateless and rebuilt per request, so it
 * has no session to delete and can never send anything down a stream: accepting
 * either holds a function invocation open to do nothing at all. Answering 405 with
 * an Allow header is what the transport's own stateless examples do, and it is a
 * refusal a client understands rather than a hang it waits out.
 */
function refuseMethod() {
  return new Response(JSON.stringify({ error: "this server is stateless: only POST carries messages" }), {
    status: 405,
    headers: { ...CORS, Allow: "POST, OPTIONS", "content-type": "application/json" },
  });
}

export const GET = refuseMethod;
export const DELETE = refuseMethod;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
