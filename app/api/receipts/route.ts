import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { RECEIPTS_SHOWN, receiptReaderFrom } from "~~/lib/human/receipts";

export const dynamic = "force-dynamic";

/** One payer's own history, so no shared cache may hold it and hand it to the
 *  next caller. Applied to the refusals too, so a 400 telling somebody their
 *  address is malformed is not cached against the address that is not. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * What one wallet has settled here.
 *
 * The route answers for a payer or it answers 400. There is no form of this
 * request that returns the table, and that is a property to keep rather than a
 * consequence of the current query: a missing parameter is the shape most likely
 * to be read as "everything", so it is the shape that is refused first.
 *
 * The rows are public in the sense that every one of them names a settlement that
 * is already on Base Sepolia, where anyone may read it without asking Zenbit. What
 * is not public is the count and the cap: `human_usage` holds a keyed derivation of
 * a World ID nullifier, and nothing from that table is served from here or from
 * anywhere else. The two live in separate tables for that reason and the projection
 * keeps them separate on the wire.
 */
export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  if (!payer) return refuse(400, "name a payer");
  // Strict by default in viem, which is the behaviour wanted: an all lowercase
  // address is accepted because casing is not identity, and a mixed case address
  // whose checksum does not match is refused because that one is a typo.
  if (!isAddress(payer)) return refuse(400, "that is not an address");

  const reader = receiptReaderFrom();
  if (!reader) {
    // No ledger configured is not an empty ledger, and the page must not draw it as
    // one. A wallet with no receipts and a deployment with no database are
    // different sentences, and only one of them is about the wallet.
    return refuse(503, "no ledger is configured");
  }

  let settlements;
  try {
    settlements = await reader.byPayer(getAddress(payer), RECEIPTS_SHOWN);
  } catch (err) {
    // A ledger that is configured and cannot answer is an outage, not an empty
    // history. Production has a database and had no receipts table until the
    // migration ran, so an uncaught read throws and the framework serves 500: an
    // error page where the contract says the ledger is unavailable.
    console.error(`receipts: the ledger failed: ${err instanceof Error ? err.message : "unknown"}`);
    return refuse(503, "the ledger is unavailable");
  }

  // Built field by field rather than handed straight out, for the reason the
  // observations route gives: the reader's type is the projection the driver was
  // asked for, and this is the projection the wire gets. Two lists rather than one
  // means widening either the table or the reader still serves nothing new here
  // until somebody writes the field a third time, in this object.
  const served = settlements.map(settlement => ({
    source: settlement.source,
    payer: settlement.payer,
    payTo: settlement.payTo,
    amount: settlement.amount,
    network: settlement.network,
    nonce: settlement.nonce,
    txHash: settlement.txHash,
    settledAt: settlement.settledAt,
  }));

  return NextResponse.json({ settlements: served }, { headers: NO_STORE });
}
