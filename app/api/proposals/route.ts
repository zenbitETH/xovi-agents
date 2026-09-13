import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * The five fields a proposal is re-served with.
 *
 * The reviewing application's list returns **whole rows**, and a proxy re-serves
 * whatever it does not drop, under a new host. So this is a keep list rather than
 * a drop list: a column added over there arrives here and stops, because it is not
 * named below, and nobody has to remember to add it to a list of the forbidden.
 *
 * What is left out and why it matters: `ingestKeyId` names a credential,
 * `confidence` is opaque by spec 05, `behaviorNote` and `behaviorMetric` are a
 * derivation and a threshold, `participants` is the other animals in the tank,
 * `specimenAlias`, `stationId` and `speciesCode` are the alias, the station and the
 * species, the verifier fields belong to a person, and `rejectReason` is prose
 * written for an operator. The dashboard needs none of them.
 */
const KEEP = ["id", "clipHash", "status", "submittedAt", "verifiedAt"] as const;

/**
 * This wallet's proposals, from the reviewing application's public list.
 *
 * **The list serves confirmed rows only**, which is a fact about that endpoint and
 * not a filter applied here: it selects on a confirmed status and returns the fifty
 * most recent. So this route can show a person their confirmed proposals and
 * nothing else, and the section says so rather than letting an empty list read as
 * "you proposed nothing". Asking that side to widen the status would publish
 * machine proposals no person has looked at, on a public route, which is a product
 * decision with an embargo behind it and not a query parameter.
 *
 * Read only by construction. This module exports one method, the call it makes is
 * a GET, and there is nothing here that could be handed a body. A check holds that
 * shape rather than a comment asking for it.
 */
export async function GET(request: Request) {
  const submitter = new URL(request.url).searchParams.get("submitter");
  if (!submitter) return refuse(400, "name a submitter");
  if (!isAddress(submitter)) return refuse(400, "that is not an address");

  const list = process.env.XOVI_PUBLIC_URL;
  if (!list) {
    // Fails closed rather than guessing an origin. A default here would be a
    // deployment reading somebody's production list because nobody chose it.
    return refuse(503, "no public list is configured");
  }

  let rows: unknown;
  try {
    const answer = await fetch(list, { method: "GET", headers: { accept: "application/json" } });
    if (!answer.ok) return refuse(502, "the public list did not answer");
    rows = await answer.json();
  } catch {
    // The upstream body is never passed through. It is written for an operator of
    // the other application, in its own language, and it interpolates the values it
    // is about.
    return refuse(502, "the public list could not be reached");
  }
  if (!Array.isArray(rows)) return refuse(502, "the public list did not answer with a list");

  const wanted = getAddress(submitter);
  const mine = rows.filter(row => {
    const claimed = (row as { submitterAddress?: unknown }).submitterAddress;
    return typeof claimed === "string" && isAddress(claimed) && getAddress(claimed) === wanted;
  });

  // Built key by key off the keep list, so a field the other side adds cannot
  // arrive here by being present.
  const proposals = mine.map(row => {
    const source = row as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const key of KEEP) kept[key] = source[key] ?? null;
    return kept;
  });

  return NextResponse.json({ proposals }, { headers: NO_STORE });
}
