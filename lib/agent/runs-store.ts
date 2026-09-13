/**
 * What a wallet's own agent has already read, and nothing else.
 *
 * An interface rather than a client, like the other stores here, so the checks can
 * watch the shape the board is served from without a database.
 *
 * **The row is deliberately thin.** A cell, a payer, how it was paid for, what came
 * of it and when. No window id, no station, no alias: the windows are the thing
 * being sold and the thing the gate screens, and a table that remembered which ones
 * a person received would put exactly that behind an address the board reads from.
 */
export type RunRow = {
  payer: string;
  day: string;
  species: string;
  free: boolean;
  txHash: string | null;
  /** The run's own step name, `declined` carrying its kind after a colon. */
  outcome: string;
  clipId: number | null;
  ranAt: string;
};

/** The most recent run for one cell, which is all the board draws. */
export type RunMark = { day: string; species: string; outcome: string; clipId: number | null; ranAt: string };

export type RunsStore = {
  /** Record one served run. Nothing about the answer depends on this write. */
  record(row: Omit<RunRow, "ranAt"> & { ranAt: Date }): Promise<void>;
  /** The most recent run per cell for this payer, and for no other payer. */
  marksFor(payer: string): Promise<RunMark[]>;
};

let injected: RunsStore | null | undefined;

export function setRunsStoreForTest(store: RunsStore | null | undefined): void {
  injected = store;
}

export function runsStoreFrom(env: Record<string, string | undefined> = process.env): RunsStore | null {
  if (injected !== undefined) return injected;
  if (!env.DATABASE_URL) return null;
  // Required lazily for the same reason the other stores do it, so this module can
  // be imported, and the checks run, with no connection string in reach.
  const { postgresRunsStore } = require("./runs-postgres") as typeof import("./runs-postgres");
  return postgresRunsStore(env.DATABASE_URL);
}
