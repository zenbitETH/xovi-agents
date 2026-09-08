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
   * Free reads already served to this identifier in this window.
   * The identifier is a World ID nullifier: it is stored, never logged whole.
   */
  freeReadsUsed(identifier: string, window: string): Promise<number>;
  /** Records one free read. Called only when a read was served without settling. */
  countFreeRead(identifier: string, window: string): Promise<void>;
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
  return null;
}
