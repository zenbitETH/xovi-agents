/**
 * Where a requested name lives between the click and the issuance.
 *
 * An interface rather than a client, for the same reason the human store is one: the
 * checks need a store whose uniqueness they can watch, and the assignment rule is the
 * thing most worth watching here.
 */
export type NameRow = {
  payer: string;
  label: string;
  requestedAt: string;
  issuedAt: string | null;
  txHash: string | null;
};

export type NamesStore = {
  /**
   * Assign this payer the next free label, or return the one it already has.
   *
   * **One statement, and that is the point.** Reading the highest label and then
   * inserting is two operations, and two wallets arriving together read the same
   * maximum, compute the same label and both try to take it. In a sequential check
   * that never shows; under two clicks it hands one subname to two wallets, and
   * issuing it would set the same address record twice and silently move the name
   * from the first wallet to the second.
   *
   * So the assignment is one statement and the unique index on `label` is the
   * guarantee. The loser of a genuine race is refused by the index rather than by a
   * comparison, and the caller retries: a refusal is the correct outcome, not a bug.
   *
   * The number comes from a sequence rather than from the table's maximum, because a
   * maximum goes backwards when a row is deleted and would then hand a used label to
   * the next wallet. The caller checks the result against the chain and asks again if
   * the label is already taken there, which advances the sequence past anything issued
   * by hand outside this scheme.
   *
   * Asking twice returns the existing row rather than a second label, which is the
   * promise `payer` unique makes to a person who clicks twice.
   */
  requestLabel(payer: string): Promise<NameRow>;

  /**
   * Give a label back, unissued.
   *
   * Used when the sequence produced a label that the chain already holds, issued by
   * hand outside this scheme. The row is removed so the payer can take the next
   * number; the sequence is NOT rewound, because rewinding is the thing that hands one
   * subname to two people. The number is abandoned, which costs nothing.
   *
   * Refuses to remove a row that carries a transaction, so this can never delete an
   * issued name's record of itself.
   */
  release(label: string): Promise<void>;

  /** The row for this payer, or null. The read path's first question. */
  byPayer(payer: string): Promise<NameRow | null>;

  /** Every row with no transaction yet, oldest first. What the issuer works through. */
  pending(): Promise<NameRow[]>;

  /**
   * Record that a label was issued, with the transaction that did it.
   *
   * Keyed on `label` rather than on `payer` because the issuer works from labels and
   * because the label is what the transaction actually wrote. Returns false when the
   * row was already marked, so a second run of the issuer is observable rather than
   * merely harmless.
   */
  markIssued(label: string, txHash: string, at: Date): Promise<boolean>;
};

/**
 * The parent every issued label hangs under.
 *
 * Here rather than in the route because a Next route module may export only its
 * handlers, which is the same reason the resolver seam lives in `name.ts`. One place,
 * so the floor scan, the request route, the read route and the issuer cannot disagree
 * about which parent they mean; disagreeing would assign a label under one name and
 * issue it under another.
 */
export const PARENT = "xovi.eth";

/** A label is `agent` and a positive integer, and nothing else may be assigned. */
export const LABEL_RE = /^agent([1-9][0-9]*)$/;

export function labelNumber(label: string): number | null {
  const m = LABEL_RE.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * The first label number that is free on chain.
 *
 * Walks up from 1 and stops at the first label whose address record is empty. It
 * keys on the ADDRESS RECORD and never on the resolver, and that is not a detail:
 * the parent's resolver is a wildcard, measured, so every subname of `xovi.eth`
 * returns a resolver whether or not it has ever been issued. Asking "does this name
 * have a resolver" answers yes for every label there will ever be, so a floor built
 * on it would never advance and every name would look taken.
 *
 * The walk stops at the first gap rather than scanning for the highest, because a gap
 * means nothing was issued past it by this scheme; the table's own maximum covers
 * anything requested but not yet on chain.
 */
export async function chainFloor(
  resolve: (name: string) => Promise<string | null>,
  parent: string,
  zero: string,
  max = 64,
): Promise<number> {
  for (let n = 1; n <= max; n++) {
    const addr = await resolve(`agent${n}.${parent}`);
    if (addr === null || addr === zero) return n - 1;
  }
  return max;
}

let injected: NamesStore | null | undefined;

/**
 * Test seam, the same shape as the registry's.
 *
 * `undefined` restores the real lookup; `null` is a deliberate value meaning "there
 * is no store", which is the state a deployment without a database is in and which
 * the request route must refuse rather than pretend to satisfy. Those two are
 * different and collapsing them would make the no-database case unreachable from a
 * check.
 */
export function setNamesStoreForTest(store: NamesStore | null | undefined) {
  injected = store;
}

export function storeFrom(env: Record<string, string | undefined> = process.env): NamesStore | null {
  if (injected !== undefined) return injected;
  if (!env.DATABASE_URL) return null;
  // Required lazily so this module can be imported, and the checks run, without the
  // driver reaching for a connection string that is not there.
  const { postgresNamesStore } = require("./names-postgres") as typeof import("./names-postgres");
  return postgresNamesStore(env.DATABASE_URL);
}
