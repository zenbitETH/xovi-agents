-- Enrollments made from the page with World ID, one row per wallet.
--
-- `payer` is the wallet address, lowercased, stored plain: an address is public
-- and is the thing the cap and the page look a row up by, so hashing it would
-- join to nothing. `nullifier_digest` holds a KEYED DERIVATION of the World ID
-- nullifier and never the nullifier itself, the same derivation `human_usage`
-- stores and for the same reason: a copy of this table on its own cannot be
-- matched against anything. `credential` is the word the verifier answered with
-- (`proof_of_human`). The two times are when the enrollment was made and when it
-- lapses, thirty days later; rows past `expires_at` are deleted on the request
-- path, so "kept for thirty days" is a property of the code and not of a job.
--
-- The unique index on (action, nullifier_digest) is one enrolled wallet per
-- person: the nullifier is the same value for every result one person produces
-- under one action, so a second wallet from the same person collides here and is
-- refused. Nothing else about the person, the result or the read is stored.
CREATE TABLE IF NOT EXISTS verifications (
  payer            text        PRIMARY KEY,
  action           text        NOT NULL,
  nullifier_digest text        NOT NULL,
  credential       text        NOT NULL,
  verified_at      timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS verifications_person_unq ON verifications (action, nullifier_digest);

-- Results already used, so the same result cannot be posted twice.
--
-- A result carries a nonce and the proof bytes, and either one repeating is a
-- replay: the nonce catches the same result sent again, the digest of the proof
-- catches the same proof under a nonce somebody edited. Two indexes because
-- neither covers both, which is the shape `receipts` already has. The row is
-- written BEFORE the result is forwarded to the verifier, so two posts racing
-- cannot both reach it, and is deleted again only when the verifier could not be
-- reached at all, which is the one case where a retry is honest.
--
-- Nothing personal is here: the nonce is random and the proof digest is a hash of
-- a zero knowledge proof. Rows are purged with the enrollments.
CREATE TABLE IF NOT EXISTS verification_replays (
  nonce        text        PRIMARY KEY,
  proof_digest text        NOT NULL,
  seen_at      timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_replays_proof_unq ON verification_replays (proof_digest);
