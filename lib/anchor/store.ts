import type { SignedObservation } from "./offchain";

/**
 * Where an anchored confirmation is remembered.
 *
 * An interface rather than a client, for the same reason the cap has one: the
 * checks need a store whose uniqueness they can watch without a database.
 *
 * The row is written BEFORE the first transaction and completed after EACH leg, not
 * after both. A row therefore means the clip has been started here, never that it
 * finished, and `attest_tx` is the completion marker because it is written last.
 * Reading existence as completion is what stranded a half anchored clip: the second
 * leg threw, the row survived, and every rerun skipped it.
 */
export type AnchorRow = {
  clipId: number;
  uid: string;
  clipHash: string;
  schemaUid: string;
  attester: string;
  signed: SignedObservation;
  timestampTx?: string;
  timestampedAt?: bigint;
  attestTx?: string;
  /** Assigned by the contract, and not the same value as `uid`. */
  onchainUid?: string;
};

/**
 * What a claim found, and why it is not a boolean.
 *
 * A boolean was the High finding. `claim` answered "did I insert a row", the caller
 * read that as "is this clip done", and the two differ for exactly the window that
 * matters: a row written before the first transaction and never completed, because
 * the second leg threw. Every rerun then read the surviving row as already anchored
 * and skipped the clip forever. Returning the row makes the caller decide from what
 * is actually recorded rather than from whether it was the one who recorded it.
 */
export type Claim = { fresh: boolean; row: AnchorRow };

/** What still has to happen for a clip, derived from the row alone. */
export type NextAction = "done" | "resume-uid" | "resume-attest" | "anchor-both";

/**
 * The decision the High finding got wrong, in one place that can be tested.
 *
 * `attest_tx` is the completion marker rather than the row's existence, because it
 * is written last. A row with a timestamp and no attestation is a half finished
 * anchor and is resumable; the timestamp leg is idempotent at the contract, so
 * redoing it sends nothing.
 */
export function nextAction(row: AnchorRow | null): NextAction {
  if (!row) return "anchor-both";
  // The transaction hash is recorded the moment it is known, before the receipt is
  // waited on, because the gap between an attestation being accepted by the chain
  // and being remembered here is a gap in which a death makes the next run attest a
  // second time. So a row can hold a hash and not yet the identifier the contract
  // assigned, and that state resumes by reading the receipt rather than by sending
  // anything. Recording the hash later would be simpler and would reintroduce the
  // double attestation this ordering exists to prevent.
  if (!row.attestTx) return "resume-attest";
  return row.onchainUid ? "done" : "resume-uid";
}

export type AnchorStore = {
  /** Inserts, or returns the row that was already there. Never a bare boolean. */
  claim(row: AnchorRow): Promise<Claim>;
  byClipId(clipId: number): Promise<AnchorRow | null>;
  complete(
    uid: string,
    tx: { timestampTx?: string; timestampedAt?: bigint; attestTx?: string; onchainUid?: string },
  ): Promise<void>;
  /**
   * Resolves EITHER identifier, which is the whole reason this method is not called
   * byOffchainUid. A reader arriving from an index holds the onchain one and a
   * reader arriving from the object holds the offchain one, and refusing the first
   * would make the query and the verification two demonstrations that never meet.
   */
  byUid(uid: string): Promise<AnchorRow | null>;
};

/**
 * Bigints do not survive JSON, and the message carries three of them.
 *
 * Written as decimal strings and read back as bigints, so what is persisted is
 * lossless and what is re-derived from it hashes identically. A silent conversion
 * to number would be correct for every value this milestone will ever hold and
 * wrong in the way that only shows up once.
 */
export function serialiseSigned(s: SignedObservation): unknown {
  return {
    ...s,
    message: {
      ...s.message,
      time: s.message.time.toString(),
      expirationTime: s.message.expirationTime.toString(),
    },
  };
}

export function deserialiseSigned(v: any): SignedObservation {
  return {
    ...v,
    message: {
      ...v.message,
      time: BigInt(v.message.time),
      expirationTime: BigInt(v.message.expirationTime),
    },
  };
}

/**
 * A seam, so the endpoint's own behaviour can be exercised without a database.
 *
 * Named for what it is. Without it the only reachable path in a check is the one
 * where nothing is configured, which is the branch that needs proving least, and
 * the outage branch that the audit found serving 500 could not be reached at all.
 */
let injected: AnchorStore | null | undefined;

export function setStoreForTest(store: AnchorStore | null | undefined) {
  injected = store;
}

export function storeFrom(env: Record<string, string | undefined> = process.env): AnchorStore | null {
  if (injected !== undefined) return injected;
  if (!env.DATABASE_URL) return null;
  const { postgresAnchorStore } = require("./postgres") as typeof import("./postgres");
  return postgresAnchorStore(env.DATABASE_URL);
}
