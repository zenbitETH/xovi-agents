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
  /** Written with the row. Under the gateway a row is the issuance, so this is the
   *  time the row was written and there is no separate approval mark. Null only on
   *  rows written before that ruling. */
  issuedAt: string | null;
  /** The pre switch on chain path's marker: set by `bin/issue-names.ts` when it wrote
   *  the record on chain, and by nothing else. */
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

  /** The row for this label, or null. The gateway's question: the label arrives in
   *  the name asked, and the payer is the answer. */
  byLabel(label: string): Promise<NameRow | null>;

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

/*
 * `chainFloor`, `labelNumber` and `LABEL_RE` lived here and are gone.
 *
 * They belonged to the first design, where the next label was `max(label) + 1` with a
 * floor walked up from the chain. The sequence replaced that because a maximum goes
 * backwards when a row is deleted, and the walk-up floor was wrong for a second
 * reason of its own: it stops at the first gap, so with `agent1` and `agent3` issued
 * and `agent2` never taken it reports one and `agent3` reads as free.
 *
 * Nothing in production called them afterwards. What remained was a rejected
 * approach sitting in a library with two checks that existed only to demonstrate its
 * flaw, which is a worse thing to leave behind than the flaw: a later reader finds a
 * helper, an export and a passing check, and has no way to know none of it is used.
 *
 * The property those checks protected, that a label is judged by its ADDRESS RECORD
 * and never by its resolver, is now held where it belongs: through the real route,
 * which releases a label the chain already holds and takes the next number.
 */

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
