-- The agent credential minted for an enrolled wallet, encrypted at rest.
--
-- NUMBER 0008, one past the name leg's 0006 with 0007 left to the shell's own
-- work, because a number claimed twice appears only at merge and the runner keys
-- on the filename.
--
-- One row per wallet. `payer` is the lowercased address and is public. `ciphertext`
-- is AES-256-GCM over the credential under the key in `CREDENTIAL_KEY`, with the
-- authentication tag appended and the twelve byte `nonce` beside it, both as hex;
-- the plaintext has no column and is never written. `key_prefix` is the part of
-- the credential the reviewing application itself stores in the clear, so it may
-- be shown and joined; it authenticates nothing on its own. `minted_at` is when
-- the reviewing application answered with the credential, which it does once:
-- a row lost after that cannot be rebuilt from either side, and says so.
CREATE TABLE IF NOT EXISTS credentials (
  payer       text        PRIMARY KEY,
  ciphertext  text        NOT NULL,
  nonce       text        NOT NULL,
  key_prefix  text        NOT NULL,
  minted_at   timestamptz NOT NULL
);
