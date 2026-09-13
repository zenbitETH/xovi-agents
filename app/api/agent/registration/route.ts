import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { credentialStoreFrom, ensureCredential } from "~~/lib/agent/credentials";
import { storeFrom as namesStoreFrom } from "~~/lib/agent/names-store";
import { capFrom, registrationOf } from "~~/lib/human/cap";
import { now } from "~~/lib/human/clock";
import { enrollmentThrottle } from "~~/lib/human/throttle";
import { verifyEnrollment } from "~~/lib/human/worldid";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Whether a person stands behind this wallet, from either source, and nothing else.
 *
 * **The nullifier never crosses this wire.** It is an anonymous identifier, not
 * an anonymous fact: it is deterministic on the identity, so it is the same value
 * for every agent one person registers, and publishing it would let anyone join
 * a person's agents to each other. Both sources answer with it, or with a digest
 * of it, and this route answers with a word.
 *
 * Three states and they are not two. Registered and not registered are answers
 * about the wallet; unread is an answer about the read, and drawing it as not
 * registered would tell a person to enrol when they already have. `source` says
 * which of the two sources answered, and a wallet in both answers AgentBook.
 *
 * `agentCredential` says whether the wallet holds the credential it proposes
 * with. A registered wallet without one is minted one here, on the first read
 * that finds it missing, which is how a wallet AgentBook knows gets its
 * credential without an enrolment in the page; the mint is once per wallet on
 * the other side, so a read that finds a row makes no call.
 */
export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  if (!payer) return refuse(400, "name a payer");
  if (!isAddress(payer)) return refuse(400, "that is not an address");

  const at = now();
  const answer = await registrationOf(payer, capFrom(), at);
  const agentCredential =
    answer.state === "registered"
      ? await ensureCredential(payer, { store: credentialStoreFrom(), names: namesStoreFrom(), at }).catch(() => "none" as const)
      : "none";
  return NextResponse.json({ state: answer.state, source: answer.source, credential: answer.credential, agentCredential }, { headers: NO_STORE });
}

/**
 * Enrol: a World ID result for this wallet, verified on the server and recorded.
 *
 * The body names the wallet, carries the result the widget returned, and the
 * wallet's signature over the sentence the request route answered. The wallet is
 * bound twice: the signature shows the caller holds it, and the result carries a
 * hash of the signal the person went through World ID with, which must be the
 * lowercased address named here. Naming somebody else's wallet is refused on the
 * first and never forwarded; a result made for another wallet is refused on the
 * second. Everything the verifier needs is forwarded as it came; everything this
 * stores is a digest.
 *
 * Capped per wallet, on the same counter as the request route, because a call
 * here reaches a third party's verifier.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "send a json body");
  }
  const payer = (body as { payer?: unknown })?.payer;
  if (typeof payer !== "string" || !payer) return refuse(400, "name a payer");
  if (!isAddress(payer)) return refuse(400, "that is not an address");
  const result = (body as { result?: unknown })?.result;
  if (result === undefined) return refuse(400, "send the result");
  // The wallet's signature over the sentence the request route answered. Shape
  // only here; who signed it is decided against the result's nonce below.
  const signature = (body as { signature?: unknown })?.signature;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return refuse(400, "send the wallet's signature");

  const at = now();
  const taken = enrollmentThrottle.take(payer.toLowerCase(), at);
  if (!taken.ok) return refuse(429, "too many requests for this wallet; wait a moment", { "Retry-After": String(taken.retryAfterSeconds) });

  const outcome = await verifyEnrollment({ payer, result, signature, store: capFrom().verifications, at });
  if (!outcome.ok) return refuse(outcome.status, outcome.error);
  // The credential, minted now that a person stands behind the wallet. A mint
  // that fails leaves the enrolment as it is; the read asks again next time.
  const agentCredential = await ensureCredential(payer, { store: credentialStoreFrom(), names: namesStoreFrom(), at }).catch(() => "none" as const);
  // Built field by field, for the reason the receipts route gives: what the
  // verifier answered is not what the wire gets, and a field grown on the way
  // reaches nobody until it is named here.
  const served = { state: "registered", source: "worldid", credential: outcome.credential, expiresAt: outcome.expiresAt.toISOString(), agentCredential };
  return NextResponse.json(served, { headers: NO_STORE });
}
