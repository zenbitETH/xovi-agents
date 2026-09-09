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
  -- The identifier the CONTRACT assigned to the onchain leg, which is not the
  -- offchain one: an offchain attestation is a hash of its own signed contents and
  -- an onchain one is assigned from the attester, the schema and a bump. An index
  -- returns this one, the payload endpoint is keyed by the other, and without this
  -- column a reader arriving from a query could not be answered at all.
  onchain_uid    text,
  timestamp_tx   text,
  timestamped_at bigint,
  attest_tx      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS anchors_clip_id_unq ON anchors (clip_id);
CREATE UNIQUE INDEX IF NOT EXISTS anchors_uid_unq     ON anchors (uid);
CREATE INDEX IF NOT EXISTS anchors_clip_hash_idx      ON anchors (clip_hash);
-- Partial, because the column is null until the onchain leg lands, and two rows
-- waiting for it are not a conflict.
CREATE UNIQUE INDEX IF NOT EXISTS anchors_onchain_uid_unq ON anchors (onchain_uid) WHERE onchain_uid IS NOT NULL;
