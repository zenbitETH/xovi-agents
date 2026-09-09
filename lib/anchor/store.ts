import type { SignedObservation } from "./offchain";

/**
 * Where an anchored confirmation is remembered.
 *
 * An interface rather than a client, for the same reason the cap has one: the
 * checks need a store whose uniqueness they can watch without a database.
 *
 * The row is written BEFORE the transaction is sent and completed after it returns.
 * A record whose transaction was sent and never recorded is the failure worth
 * planning for, because the chain would hold an anchor that this side would try to
 * make again; the contract refuses a repeat, so the guard catches it, but the row
 * is what stops the attempt from being made at all.
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

export type AnchorStore = {
  /** Returns false when this clip is already anchored, which is not an error. */
  claim(row: AnchorRow): Promise<boolean>;
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

export function storeFrom(env: Record<string, string | undefined> = process.env): AnchorStore | null {
  if (!env.DATABASE_URL) return null;
  const { postgresAnchorStore } = require("./postgres") as typeof import("./postgres");
  return postgresAnchorStore(env.DATABASE_URL);
}
