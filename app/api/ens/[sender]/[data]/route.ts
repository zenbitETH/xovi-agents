import { NextResponse } from "next/server";
import { isAddress, isHex } from "viem";
import { storeFrom } from "~~/lib/agent/names-store";
import {
  BadRequest,
  EXPIRY_SECONDS,
  GatewayMisconfigured,
  NotThisZone,
  answerQuery,
  decodeQuery,
  signAnswer,
  signerKeyFrom,
} from "~~/lib/ens/gateway";
import { now } from "~~/lib/human/clock";
import { ensGatewayThrottle } from "~~/lib/human/throttle";

export const dynamic = "force-dynamic";

/**
 * The CCIP Read gateway for `xovi.eth`: GET `/api/ens/{sender}/{data}.json`.
 *
 * Standards: EIP-3668 (CCIP Read: the GET form of the gateway interface, `{sender}`
 * and `{data}` substituted by the client, the answer as `{ "data": "0x…" }`, a
 * refusal as `{ "message": "…" }` with a 4xx or 5xx), ENSIP-10 (the calldata is
 * `resolve(bytes name, bytes data)`), EIP-191 version 0x00 for the signature. The
 * shape is ensdomains/offchain-resolver at commit 099b7e9827899efcf064e71b7125f7b4fc2e342f,
 * `packages/gateway`, with the Express handler replaced by this route and the JSON
 * zone by the `names` table; the wire is the reference's.
 *
 * `{data}` ARRIVES WITH `.json` ON THE END. Next's dynamic segment takes the whole
 * path segment, so the second parameter is `0x….json` and the suffix is stripped
 * here. The template stays the reference's `{sender}/{data}.json`.
 *
 * OPEN TO EVERY ORIGIN, ON THIS ROUTE ONLY, AND HERE IS WHY. A CCIP Read client is
 * whatever follows the `OffchainLookup`: a wallet, a page on any domain, a library on
 * a server. The answer is a signed public record, the same bytes for every caller;
 * there is no cookie, no session and nothing per caller in it, so an origin gains
 * nothing by reading it that it could not read from anywhere. What an open origin
 * threatens is availability, which the cap below bounds. Every other route in this
 * repository, the MCP one aside for its own stated reason, sends no such header, and
 * a check holds that.
 *
 * NOTHING BUT THE ADDRESS, THE TEXT AND THE EXPIRY ON THE WIRE. No station, no alias,
 * no count, no row but the payer of the one label asked about, and the signing key is
 * read in one function and never returned or logged.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

// Public data, signed for five minutes; a shared cache serving it would be fine,
// but a name just requested must show at once, so nothing is stored.
const HEADERS = { ...CORS, "Cache-Control": "no-store" } as const;

function refuse(status: number, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ message }, { status, headers: { ...HEADERS, ...headers } });
}

/** The first hop of x-forwarded-for, which the host sets, else one shared bucket. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request, context: { params: Promise<{ sender: string; data: string }> }) {
  // The cap first, before any decoding, since decoding is the work a stranger could
  // ask for as fast as they can open connections. Keyed on the client rather than
  // the sender: the sender is the resolver and is the same for every request.
  const taken = ensGatewayThrottle.take(clientKey(request), now());
  if (!taken.ok) return refuse(429, "too many requests; wait a moment", { "Retry-After": String(taken.retryAfterSeconds) });

  const { sender, data } = await context.params;
  if (!isAddress(sender)) return refuse(400, "sender is not an address");
  if (!data.endsWith(".json")) return refuse(400, "data must end in .json");
  const callData = data.slice(0, -".json".length);
  if (!isHex(callData)) return refuse(400, "data is not hex");

  const key = signerKeyFrom(process.env);
  if (key === null) return refuse(503, "the gateway has no signing key configured");

  let result;
  try {
    const query = decodeQuery(callData);
    result = await answerQuery(query, { store: storeFrom(), env: process.env });
  } catch (err) {
    if (err instanceof BadRequest) return refuse(400, err.message);
    if (err instanceof NotThisZone) return refuse(404, err.message);
    if (err instanceof GatewayMisconfigured) return refuse(503, err.message);
    return refuse(503, "the record could not be read");
  }

  const expires = BigInt(Math.floor(now().getTime() / 1000) + EXPIRY_SECONDS);
  const response = await signAnswer({ sender, request: callData, result, expires, key });
  return NextResponse.json({ data: response }, { headers: HEADERS });
}
