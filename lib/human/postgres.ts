import { neon } from "@neondatabase/serverless";
import type { ReceiptReader } from "./receipts";
import { type HumanStore, type Receipt, type Settlement, assertNotFabricated } from "./store";

/**
 * The store, over HTTP.
 *
 * The driver gives one statement per round trip and no interactive transaction,
 * which is not a limitation here so much as a discipline: every guarantee this
 * file makes has to fit in a single statement, and both of them do.
 */
export function postgresStore(connectionString: string): HumanStore {
  const sql = neon(connectionString);

  return {
    /**
     * Take one free read, or refuse, in one statement.
     *
     * The limit travels into the statement rather than being compared before it,
     * so two requests arriving together cannot both be told there is one left.
     *
     * The `WHERE $3 > 0` on the insert is not redundant and the obvious version of
     * this statement is wrong without it. `ON CONFLICT ... WHERE` guards the update
     * and says nothing about the insert, so with a limit of zero and no row yet the
     * insert would succeed, return, and hand out a free read against a cap that
     * forbids all of them. Zero is the switch that forces settlement for the paid
     * demonstration, so it is the one value that must not misbehave.
     */
    tryTakeFreeRead: async (identifier, window, limit) => {
      const rows = await sql`
        INSERT INTO human_usage (identifier_digest, window_day, used)
        SELECT ${identifier}, ${window}::date, 1 WHERE ${limit}::int > 0
        ON CONFLICT (identifier_digest, window_day) DO UPDATE SET used = human_usage.used + 1
        WHERE human_usage.used < ${limit}::int
        RETURNING used`;
      return rows.length > 0;
    },

    /**
     * Forget usage rows past the declared period. One extra statement per request
     * and no scheduler, so the retention is a property of the code path rather than
     * of infrastructure somebody has to remember to set up.
     */
    forgetOlderThan: async (days: number) => {
      await sql`DELETE FROM human_usage WHERE window_day < current_date - ${days}::int`;
    },

    /**
     * Record a settlement, once. The insert alone: nothing else is written on this
     * path, so there is no second write for it to be atomic with. Returning the row
     * is what makes a replay observable rather than merely harmless, and either
     * unique index can be the one that catches it.
     */
    recordReceipt: async (receipt: Receipt) => {
      // Again here, and deliberately not only in `recordSettlement`: this is the
      // function that reaches the real ledger, and it has callers that are not
      // that one, `bin/db-probe.ts` among them.
      assertNotFabricated(receipt);
      const rows = await sql`
        INSERT INTO receipts (source, payer, pay_to, amount, network, nonce, tx_hash)
        VALUES (${receipt.source}, ${receipt.payer}, ${receipt.payTo}, ${receipt.amount},
                ${receipt.network}, ${receipt.nonce}, ${receipt.transactionHash})
        ON CONFLICT DO NOTHING
        RETURNING id`;
      return rows.length > 0;
    },
  };
}

/**
 * The ledger, read back for one payer.
 *
 * A second function rather than a method on the store, because this is the only
 * read of the receipts table and it has one caller. Widening `HumanStore` would
 * make every fake in the checks implement a read they do not use.
 *
 * The projection is the point. Every field is named in the SELECT and named again
 * when the object is built, so a column added to `receipts` later reaches neither
 * the driver nor the wire until somebody writes it here twice. `payer` is
 * deliberately not selected: the row matched on it, so its value is known to be the
 * address that was asked for, and serving the caller's canonical spelling means two
 * casings of one address cannot come back looking like two payers.
 */
export function postgresReceipts(connectionString: string): ReceiptReader {
  const sql = neon(connectionString);

  return {
    byPayer: async (payer: string, limit: number): Promise<Settlement[]> => {
      // Compared without case because a payer is written by whichever path settled
      // it. `lower()` on the column rather than on a stored normal form, since the
      // table has no index to lose and correctness here beats a plan on a table
      // that holds a demonstration's worth of rows.
      const rows = await sql`
        SELECT source, pay_to, amount, network, nonce, tx_hash, settled_at
        FROM receipts
        WHERE lower(payer) = lower(${payer})
        ORDER BY settled_at DESC
        LIMIT ${limit}::int`;
      return rows.map(row => ({
        source: String(row.source),
        payer,
        payTo: String(row.pay_to),
        amount: String(row.amount),
        network: String(row.network),
        nonce: String(row.nonce),
        txHash: String(row.tx_hash),
        settledAt: new Date(row.settled_at as string).toISOString(),
      }));
    },
  };
}
