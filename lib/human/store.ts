/**
 * Where the count and the receipts live.
 *
 * An interface rather than a client, because the checks need a store whose
 * uniqueness they can watch, and because the real one talks over http to a
 * database that does not exist yet.
 */
export type Receipt = {
  /** From the payment authorization. Unique: a replayed authorization is one payment. */
  nonce: string;
  /** From the settlement. Unique for the same reason, by a different route. */
  transactionHash: string;
  payer: string;
  payTo: string;
  amount: string;
  network: string;
  /** Which surface earned it: the paid read, the paid query, or a chain sweep.
   *  Named rather than inferred, because two rails settle to one recipient and a
   *  ledger that cannot tell them apart cannot answer which demo produced a row. */
  source: "route" | "chain" | "mcp";
};

/**
 * The transaction hash the fake facilitator settles with.
 *
 * It lives here rather than in `test/facilitator.ts` because the party that must
 * recognise it is the write path, not the fake. A local demo run settles against
 * that facilitator and is handed this hash; if the process serving that run holds
 * a real `DATABASE_URL`, the receipt is written to the real ledger and the ledger
 * then carries a settlement that never happened.
 *
 * That is not hypothetical. A row in the production ledger carries it, written on
 * 2026-09-11 by a local demo run, because `next start` loads `.env.local` itself
 * and so gains the database after `bin/local.ts` has finished deciding what the
 * child may have. While this constant lived in the test tree the fake was the only
 * party that knew what a fabricated settlement looks like, and the ledger had no
 * way to refuse one.
 */
export const FABRICATED_TX = `0x${"11".repeat(32)}`;

export class FabricatedReceipt extends Error {}

/**
 * Refuses a receipt whose settlement never happened.
 *
 * A property of the data rather than of the environment, which is the point. The
 * row that reached production got there because a demo process held a real
 * connection string, and every attempt to keep the demo away from the database is
 * a thing somebody can plumb wrong once. This cannot be plumbed wrong: the hash
 * itself is the evidence, and it is the same hash whichever database is on the
 * other end.
 *
 * It throws rather than returning false because `recordReceipt` already answers
 * false for "this receipt was already here", and a fabricated settlement is not a
 * replay. Reporting one as the other would file the loudest thing in the ledger's
 * life under its quietest.
 */
export function assertNotFabricated(receipt: Receipt): void {
  if (receipt.transactionHash === FABRICATED_TX) {
    throw new FabricatedReceipt(
      `refusing a receipt carrying the fake facilitator's transaction hash ${FABRICATED_TX}: that settlement happened on no chain, so a demo run is writing to a real ledger`,
    );
  }
}

export type HumanStore = {
  /**
   * Take one free read, or refuse. **One operation, and that is the point.**
   *
   * Reading the count and then incrementing it is two operations, and two requests
   * from one person arriving at the limit minus one both read the same number,
   * both pass the comparison and both go free. The cap would then hold in every
   * sequential test and fail exactly when somebody uses it properly.
   *
   * The database form is one statement whose WHERE clause carries the limit, so
   * the comparison and the increment cannot be separated by anything. The identifier
   * is a World ID nullifier: it is stored, never logged whole.
   */
  tryTakeFreeRead(identifier: string, window: string, limit: number): Promise<boolean>;

  /**
   * Delete usage rows older than the retention period.
   *
   * On the write path rather than on a schedule, because a schedule is a thing that
   * can be switched off without anybody noticing and this one is a declared period
   * in a privacy notice. A row is per person per day and is useless the moment its
   * day has passed, so the period is an outer bound rather than a need.
   */
  forgetOlderThan(days: number, now: Date): Promise<void>;
  /**
   * Records a settlement, once. Returns false when the receipt was already there,
   * which is what makes a replay observable rather than merely harmless.
   */
  recordReceipt(receipt: Receipt): Promise<boolean>;
};

/** The window a count belongs to. UTC so it does not move with whoever is watching. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function freeReadsPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.HUMAN_FREE_READS_PER_DAY);
  return Number.isInteger(raw) && raw >= 0 ? raw : 20;
}

/**
 * The store, or null when none is configured.
 *
 * Null is not a failure and not a stub: with no database there is no allowance, so
 * every read settles, which is exactly what this endpoint did before the cap
 * existed. The Postgres backed implementation lands with the schema.
 */
export function storeFrom(env: Record<string, string | undefined> = process.env): HumanStore | null {
  if (!env.DATABASE_URL) return null;
  // Required lazily so the module can be imported, and the checks run, without the
  // driver reaching for a connection string that is not there.
  const { postgresStore } = require("./postgres") as typeof import("./postgres");
  return postgresStore(env.DATABASE_URL);
}
