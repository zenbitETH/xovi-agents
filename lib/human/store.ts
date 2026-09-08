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
  /** Where the row came from. The anchoring milestone writes to this table too. */
  source: "route" | "chain";
};

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
