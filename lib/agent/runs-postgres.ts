import { neon } from "@neondatabase/serverless";
import { type RunMark, type RunRow, type RunsStore } from "./runs-store";

/**
 * The runs store, over HTTP.
 *
 * One statement per round trip, as the other stores here work.
 */
export function postgresRunsStore(connectionString: string): RunsStore {
  const sql = neon(connectionString);

  return {
    async record(row: Omit<RunRow, "ranAt"> & { ranAt: Date }): Promise<void> {
      await sql`
        INSERT INTO runs (payer, day, species, free, tx_hash, outcome, clip_id, ran_at)
        VALUES (${row.payer.toLowerCase()}, ${row.day}, ${row.species}, ${row.free}, ${row.txHash}, ${row.outcome}, ${row.clipId}, ${row.ranAt.toISOString()})
      `;
    },

    /**
     * The most recent run per cell, for this payer alone.
     *
     * `DISTINCT ON` with the same ordering the index carries, so one row per cell
     * comes back and it is the newest. The payer is a parameter and never a
     * concatenation, and no other payer's rows are reachable through this call at
     * all: the board asks for one wallet's marks and gets one wallet's marks.
     */
    async marksFor(payer: string): Promise<RunMark[]> {
      const rows = (await sql`
        SELECT DISTINCT ON (day, species) day, species, outcome, clip_id, ran_at
        FROM runs
        WHERE payer = ${payer.toLowerCase()}
        ORDER BY day, species, ran_at DESC
      `) as Record<string, unknown>[];
      return rows.map(r => ({
        day: String(r.day),
        species: String(r.species),
        outcome: String(r.outcome),
        clipId: r.clip_id === null || r.clip_id === undefined ? null : Number(r.clip_id),
        ranAt: new Date(r.ran_at as string).toISOString(),
      }));
    },
  };
}
