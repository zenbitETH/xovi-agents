import { neon } from "@neondatabase/serverless";
import { type NameRow, type NamesStore } from "./names-store";

/**
 * The names store, over HTTP.
 *
 * One statement per round trip and no interactive transaction, which is the same
 * discipline the human store works under: every guarantee here has to fit in a single
 * statement, and each one does.
 */
export function postgresNamesStore(connectionString: string): NamesStore {
  const sql = neon(connectionString);

  const row = (r: Record<string, unknown>): NameRow => ({
    payer: String(r.payer),
    label: String(r.label),
    requestedAt: new Date(r.requested_at as string).toISOString(),
    issuedAt: r.issued_at ? new Date(r.issued_at as string).toISOString() : null,
    txHash: r.tx_hash ? String(r.tx_hash) : null,
  });

  return {
    /**
     * Assign or return, in one statement.
     *
     * The next number comes from a SEQUENCE, not from the table's maximum, and that
     * is the correction that matters. `max(label) + 1` looks right and fails when a
     * row is deleted: the maximum drops and the next wallet is handed the deleted
     * label, which on an already issued name moves it off the person who had it. A
     * sequence cannot go backwards and does not care what rows exist.
     *
     * `floor` is therefore not an input to the assignment any more. The caller keeps
     * it as a CHECK: if the label the sequence produced already resolves on chain,
     * something was issued by hand outside this scheme and the caller asks again,
     * which advances the sequence past it.
     *
     * One consequence worth stating: a wallet that asks and is never issued burns a
     * number. That is the right trade. Numbers are free and names are not, and the
     * alternative is a counter that can hand the same subname to two people.
     *
     * `ON CONFLICT (payer) DO UPDATE SET payer = names.payer` is a deliberate no-op
     * whose only job is to make the existing row available to RETURNING. `DO NOTHING`
     * returns no rows, which would force a second query and a second chance for the
     * answer to change between them.
     */
    requestLabel: async payer => {
      // `issued_at` is written with the row. Under the gateway a row is the
      // issuance: the resolver answers this payer for this label the moment the
      // statement commits, so the time it was written is the time it was issued.
      const rows = await sql`
        INSERT INTO names (payer, label, issued_at)
        VALUES (${payer}, 'agent' || nextval('names_label_seq')::text, now())
        ON CONFLICT (payer) DO UPDATE SET payer = names.payer
        RETURNING payer, label, requested_at, issued_at, tx_hash`;
      return row(rows[0] as Record<string, unknown>);
    },

    /** `AND tx_hash IS NULL` so an issued row can never be dropped by this path. */
    release: async label => {
      await sql`DELETE FROM names WHERE label = ${label} AND tx_hash IS NULL`;
    },

    byPayer: async payer => {
      const rows = await sql`
        SELECT payer, label, requested_at, issued_at, tx_hash FROM names WHERE payer = ${payer}`;
      return rows.length ? row(rows[0] as Record<string, unknown>) : null;
    },

    byLabel: async label => {
      const rows = await sql`
        SELECT payer, label, requested_at, issued_at, tx_hash FROM names WHERE label = ${label}`;
      return rows.length ? row(rows[0] as Record<string, unknown>) : null;
    },

    /** Oldest first, so a run of the issuer works in the order people asked. */
    pending: async () => {
      const rows = await sql`
        SELECT payer, label, requested_at, issued_at, tx_hash FROM names
        WHERE tx_hash IS NULL ORDER BY requested_at ASC`;
      return (rows as Record<string, unknown>[]).map(row);
    },

    /**
     * Mark one label issued. `WHERE tx_hash IS NULL` makes the write idempotent: a
     * second run of the issuer over the same row changes nothing and returns false,
     * so a re-run is observable rather than quietly overwriting the hash of the
     * transaction that actually did the work.
     */
    markIssued: async (label, txHash, at) => {
      // The pre switch on chain path. `issued_at` is kept where the row already
      // carries it, since the row was the issuance; it is filled only for a row
      // written before that ruling.
      const rows = await sql`
        UPDATE names SET tx_hash = ${txHash}, issued_at = COALESCE(issued_at, ${at.toISOString()})
        WHERE label = ${label} AND tx_hash IS NULL
        RETURNING label`;
      return rows.length > 0;
    },
  };
}
