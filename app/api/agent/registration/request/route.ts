import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { now } from "~~/lib/human/clock";
import { enrollmentThrottle } from "~~/lib/human/throttle";
import { WorldUnconfigured, requestContext } from "~~/lib/human/worldid";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * The signed context the widget opens with.
 *
 * Signed here and nowhere else: the signing key authenticates this relying party
 * to World, so a key in the page would let anyone open requests in Zenbit's name.
 * The route answers the five fields the widget's `rp_context` takes and nothing
 * else; the key is read inside `requestContext` and is not part of its answer.
 *
 * Capped per wallet because it is public and each call signs. The payer is
 * required for that reason and for no other: the signature does not bind the
 * wallet, the signal does, and that is checked on the verify route.
 */
export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  if (!payer) return refuse(400, "name a payer");
  if (!isAddress(payer)) return refuse(400, "that is not an address");

  const taken = enrollmentThrottle.take(payer.toLowerCase(), now());
  if (!taken.ok) return refuse(429, "too many requests for this wallet; wait a moment", { "Retry-After": String(taken.retryAfterSeconds) });

  try {
    return NextResponse.json(requestContext(), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof WorldUnconfigured) return refuse(503, "enrollment is not configured");
    throw err;
  }
}
