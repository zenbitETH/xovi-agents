-- Settlements. One row per settlement, and the two unique indexes are the whole of
-- "counted once": the authorization nonce catches a replayed authorization, and the
-- transaction hash catches the same settlement arriving by another route. Neither
-- one covers both, which is why there are two.
--
-- The anchoring milestone writes here too, which is what `source` is for: the row
-- says where it came from rather than the table saying what it holds.
CREATE TABLE IF NOT EXISTS receipts (
  id          bigserial PRIMARY KEY,
  source      text        NOT NULL,
  payer       text        NOT NULL,
  pay_to      text        NOT NULL,
  amount      text        NOT NULL,
  network     text        NOT NULL,
  nonce       text        NOT NULL,
  tx_hash     text        NOT NULL,
  settled_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS receipts_nonce_unq   ON receipts (nonce);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_tx_hash_unq ON receipts (tx_hash);
