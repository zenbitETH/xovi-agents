-- One row per anchored confirmation, and the two unique indexes are the guard.
--
-- Keyed on the clip identifier and NOT on the clip hash, which is the correction
-- that matters here. The reviewing application's uniqueness on the hash is
-- deliberately partial and excludes rejected rows, so that somebody whose clip was
-- declined can correct it and submit the same moment again. One hash can therefore
-- belong to a rejected row and to a later confirmed one, with different identifiers,
-- different nonces and different signatures, and so with two legitimately different
-- attestations. Keying on the hash would refuse the second and report it as already
-- anchored, which is a wrong answer wearing the shape of a right one.
--
-- The second index is on the attestation identifier, so one record cannot be
-- written twice under two clip identifiers either. The hash is stored and indexed
-- for lookup, never for uniqueness.
--
-- `signed` holds the whole signed object verbatim, including the salt and the
-- domain it was signed under. Anything less makes the identifier unreproducible:
-- the salt is random per attestation and irrecoverable, and the domain version is
-- read from the chain rather than fixed, so neither can be rebuilt later.
CREATE TABLE IF NOT EXISTS anchors (
  id             bigserial PRIMARY KEY,
  clip_id        integer     NOT NULL,
  uid            text        NOT NULL,
  clip_hash      text        NOT NULL,
  schema_uid     text        NOT NULL,
  attester       text        NOT NULL,
  signed         jsonb       NOT NULL,
  timestamp_tx   text,
  timestamped_at bigint,
  attest_tx      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS anchors_clip_id_unq ON anchors (clip_id);
CREATE UNIQUE INDEX IF NOT EXISTS anchors_uid_unq     ON anchors (uid);
CREATE INDEX IF NOT EXISTS anchors_clip_hash_idx      ON anchors (clip_hash);
