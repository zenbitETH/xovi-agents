-- A free read leaves its authorization unspent on chain.
--
-- Nothing settles on the free path, so the nonce the token would have burned is
-- never burned: the same signed header could be presented again and again, and
-- whoever captured one could take a person's whole allowance with it. This table
-- is what makes a free read spend something. The receipts table already refuses a
-- settled nonce twice; this refuses a free one twice, and they are two tables
-- because they answer two questions.
--
-- The signer is the recovered one and never the address the body names, so a row
-- here records who actually signed. Purged on the same thirty day rule the usage
-- rows are, which is longer than any authorization's validity window, so a nonce
-- leaves only after it could no longer be replayed anyway.
CREATE TABLE IF NOT EXISTS free_read_nonces (
  nonce TEXT PRIMARY KEY,
  signer TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS free_read_nonces_taken_at ON free_read_nonces (taken_at);
