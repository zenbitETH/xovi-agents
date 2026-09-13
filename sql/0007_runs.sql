-- One row per run that was served, so a person can see which cells their own agent
-- has already read.
--
-- NUMBER 0007, and it lands after 0008 by date rather than by number. 0008 is the
-- credential leg's and merged first; both are additive under IF NOT EXISTS and the
-- runner keys on the whole filename, so the order they are applied in changes
-- nothing and a gap in the numbering means nothing.
--
-- WHAT IS NOT HERE IS THE POINT. No window id, no station, no alias, no candidate,
-- no confidence. A run reads windows and this table says only that a cell was read,
-- by whom, what came of it and when. The windows themselves are the thing being
-- sold and the thing the gate screens; a table that remembered which ones a person
-- received would put that behind a wallet address, and the board draws from here.
--
-- NO COUNT OF ANYTHING, for the same reason the board serves none: the window files
-- are public, so a number of windows read is the withheld set by subtraction.
--
-- `outcome` is the run's own step name rather than a word invented here, so what the
-- board says a run did and what the run said it did cannot drift into two
-- vocabularies. `declined` carries its kind after a colon, because a refusal and a
-- rejection are different facts to the person who paid.
--
-- FREE AND PAID ARE HELD TOGETHER BY THE TABLE. A free read has no transaction and a
-- settled one has exactly one, and the check constraint is what makes that true
-- rather than a rule in the code that two callers could disagree about.
CREATE TABLE IF NOT EXISTS runs (
  id           bigserial   PRIMARY KEY,
  payer        text        NOT NULL,
  day          text        NOT NULL,
  species      text        NOT NULL,
  free         boolean     NOT NULL,
  tx_hash      text,
  outcome      text        NOT NULL,
  clip_id      integer,
  ran_at       timestamptz NOT NULL,
  CONSTRAINT runs_settlement_agrees CHECK ((free AND tx_hash IS NULL) OR (NOT free AND tx_hash IS NOT NULL))
);

-- The board's own question, asked per wallet: the most recent run per cell. Ordered
-- so the newest row for a cell is the first one read.
CREATE INDEX IF NOT EXISTS runs_by_payer_cell ON runs (payer, day, species, ran_at DESC);
