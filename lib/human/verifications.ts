/**
 * Where an enrollment made from the page lives.
 *
 * An interface, for the reason `HumanStore` is one: the checks need a store whose
 * uniqueness they can watch, and the real one talks over HTTP to a database the
 * suite must not need. The Postgres form is beside the other one in `postgres.ts`.
 *
 * What a row holds is decided in `sql/0005_verifications.sql` and repeated here so
 * a reader of either sees the same six things: the wallet, the action, a keyed
 * digest of the nullifier, the credential's name, and two times. The raw nullifier
 * is not in this type and cannot be handed to this store.
 */
export type Enrollment = {
  /** Lowercased. An address is public, so it is stored as it is. */
  payer: string;
  action: string;
  /** `deriveIdentifier` of the nullifier, never the nullifier. */
  nullifierDigest: string;
  /** The credential the verifier named, `proof_of_human` today. */
  credential: string;
  verifiedAt: Date;
  expiresAt: Date;
};

/** What the cap and the registration route read back: enough to count and to
 *  say which credential, and nothing that could be joined to anything. */
export type Standing = { nullifierDigest: string; credential: string; expiresAt: Date };

/**
 * How `enroll` can end. `recorded` covers an insert and a refresh of the same
 * wallet by the same person; the two refusals are the two ways one person and one
 * wallet can fail to be one row, and they are answered with different sentences
 * because a person who meets one needs to know which.
 */
export type EnrollOutcome = "recorded" | "another-wallet" | "another-person";

export type VerificationStore = {
  /** The standing of a wallet whose enrollment has not lapsed at `at`, or null. */
  standingOf(payer: string, at: Date): Promise<Standing | null>;
  /**
   * Mark a result as used, or refuse because it was. **Before the forward**, in
   * one statement, so two posts of one result racing cannot both reach the
   * verifier. Either key repeating is a replay.
   */
  claimResult(nonce: string, proofDigest: string, at: Date): Promise<boolean>;
  /** Give a claim back. Only for a forward that never reached the verifier, so a
   *  network failure does not burn a result the verifier never saw. */
  releaseResult(nonce: string): Promise<void>;
  /**
   * Write or refresh the row, in one statement that carries both rules: the
   * person may hold no other wallet, and the wallet may not be taken from a
   * person whose enrollment has not lapsed.
   */
  enroll(row: Enrollment): Promise<EnrollOutcome>;
  /** Delete enrollments past their expiry, and the replay rows with them. On the
   *  request path rather than on a schedule, for the reason `forgetOlderThan`
   *  gives: a declared period must not depend on a job somebody can switch off. */
  forgetExpired(at: Date): Promise<void>;
};

/**
 * How long an enrollment stands. The same thirty days the privacy notice declares
 * for the digest in `human_usage`, and a check holds the two numbers equal: a row
 * here carries the same digest, so it may not outlive the period the notice names.
 */
export const ENROLLMENT_DAYS = 30;

export function expiryFrom(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + ENROLLMENT_DAYS * 86_400_000);
}

/** The store, or null when no database is configured, in which case nobody can
 *  enrol from the page and the registration route says so. */
export function verificationStoreFrom(env: Record<string, string | undefined> = process.env): VerificationStore | null {
  if (!env.DATABASE_URL) return null;
  // Required lazily, for the reason `storeFrom` gives.
  const { postgresVerifications } = require("./postgres") as typeof import("./postgres");
  return postgresVerifications(env.DATABASE_URL);
}
