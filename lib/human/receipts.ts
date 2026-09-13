import type { Settlement } from "./store";

/**
 * Reading the ledger back out, for the one payer who is asking.
 *
 * Separate from `HumanStore` on purpose. That interface is the write path and the
 * cap, and its fakes exist so the checks can watch uniqueness; a read that the
 * dashboard needs has no business widening it. Keeping the reader apart also keeps
 * the projection apart, and the projection is the whole security property here.
 */
export type ReceiptReader = {
  /**
   * The settlements one payer made, newest first, at most `limit` of them.
   *
   * The address arrives canonical and is compared without case, because a payer is
   * written by whichever path settled it and casing is not identity. The rows come
   * back carrying the canonical form rather than whatever the column happens to
   * hold, so two spellings of one address cannot read as two payers.
   */
  byPayer(payer: string, limit: number): Promise<Settlement[]>;
};

/**
 * How many settlements one request may carry.
 *
 * A cap rather than a page, because the dashboard shows a wallet's own history and
 * a wallet that has settled more than this in a demonstration is not the case being
 * designed for. The number is here rather than in the route so the check can name it.
 */
export const RECEIPTS_SHOWN = 200;

/**
 * The reader, or null when no ledger is configured.
 *
 * Null is not an empty ledger and the route must not render it as one. With no
 * database there are no receipts to serve and also no basis for saying a wallet has
 * none, and those two are different sentences on the page.
 */
let injected: ReceiptReader | null | undefined;

/**
 * A seam, so the route's own behaviour can be exercised without a database.
 *
 * The same one `setStoreForTest` gives the anchor store, for the same reason:
 * without it the only reachable branch in a check is the one where nothing is
 * configured, and the two branches that matter, a payer with rows and a ledger that
 * throws, could not be reached at all.
 */
export function setReceiptReaderForTest(reader: ReceiptReader | null | undefined) {
  injected = reader;
}

export function receiptReaderFrom(env: Record<string, string | undefined> = process.env): ReceiptReader | null {
  if (injected !== undefined) return injected;
  if (!env.DATABASE_URL) return null;
  // Required lazily, for the reason `storeFrom` gives: the module has to import,
  // and the checks have to run, without the driver reaching for a connection
  // string that is not there.
  const { postgresReceipts } = require("./postgres") as typeof import("./postgres");
  return postgresReceipts(env.DATABASE_URL);
}
