import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { UNREGISTERED, registryFrom } from "~~/lib/human/registry";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Whether AgentBook knows a person behind this agent, and nothing else.
 *
 * **The nullifier never crosses this wire.** It is an anonymous identifier, not
 * an anonymous fact: it is deterministic on the identity, so it is the same value
 * for every agent one person registers, and publishing it would let anyone join
 * a person's agents to each other. The registry answers with it and this route
 * answers with a word.
 *
 * Three states and they are not two. Registered and not registered are answers
 * about the agent; unread is an answer about the read, and drawing it as not
 * registered would tell a person to go and register when they already have.
 */
export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  if (!payer) return NextResponse.json({ error: "name a payer" }, { status: 400, headers: NO_STORE });
  if (!isAddress(payer)) return NextResponse.json({ error: "that is not an address" }, { status: 400, headers: NO_STORE });

  try {
    const nullifier = await registryFrom()(payer);
    return NextResponse.json({ state: nullifier === UNREGISTERED ? "not-registered" : "registered" }, { headers: NO_STORE });
  } catch {
    // The chain did not answer. Not a fact about the agent, so it is not dressed
    // as one, and the log keeps whatever the provider said.
    return NextResponse.json({ state: "unread" }, { headers: NO_STORE });
  }
}
