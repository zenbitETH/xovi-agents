-- One row per wallet that has asked for a name under `xovi.eth`.
--
-- NUMBER 0006, and the sequence matters rather than the file name being pretty. The
-- repository is at 0001 to 0004; the World ID leg takes 0005 for `verifications` and
-- this takes the one after. Two branches both claiming a number is a collision that
-- only appears at merge, and the reviewing application already carries one where two
-- branches both claimed 0013 and the runner keyed on the filename.
--
-- TWO UNIQUE INDEXES, AND THEY GUARD DIFFERENT THINGS.
--
-- `payer` unique is the promise to a person: ask twice and you get the name you were
-- already assigned, never a second one. Without it a wallet that clicks twice burns
-- two labels and the second is issued to nobody.
--
-- `label` unique is the promise about the chain: a label is a subname of `xovi.eth`,
-- and issuing the same one to two wallets would set the same address record twice and
-- silently move the name from the first wallet to the second. The index is the
-- guarantee rather than the assignment code, because the assignment reads a maximum
-- and two requests can read it at the same instant; the loser of that race is refused
-- by the index and retries, which is a correct outcome rather than a rare bug.
--
-- REQUESTED AND ISSUED ARE SEPARATE COLUMNS ON PURPOSE. The resolver here admits no
-- approved operator, measured: `isApprovedForAll` and `isApprovedFor` both revert, so
-- nobody but the name's owner can write a record. The route therefore cannot issue;
-- it writes a requested row and stops. `bin/issue-names.ts`, run by the founder on his
-- own machine with the owner key, fills `issued_at` and `tx_hash`. A row with a
-- `requested_at` and no `tx_hash` is a real, honest state that a person can be shown,
-- not a half-finished write.
--
-- `tx_hash` is the marker for completion and `issued_at` is written with it. Neither
-- is the source of truth for the page: the page asks the chain and draws issued only
-- when the address record equals the payer. A row saying issued while the chain says
-- otherwise is a claim the chain does not support, and the read path never makes it.
CREATE TABLE IF NOT EXISTS names (
  id            bigserial   PRIMARY KEY,
  payer         text        NOT NULL,
  label         text        NOT NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  issued_at     timestamptz,
  tx_hash       text
);

CREATE UNIQUE INDEX IF NOT EXISTS names_payer_unq ON names (payer);
CREATE UNIQUE INDEX IF NOT EXISTS names_label_unq ON names (label);

-- THE LABEL COUNTER IS A SEQUENCE, AND IT IS NOT DERIVED FROM THE TABLE.
--
-- The obvious assignment is `max(label) + 1`, and it is wrong in a way a sequential
-- check does not show. Delete the newest row and the maximum drops, so the next
-- wallet is handed the label the deleted row had. If that label had already been
-- issued on chain, issuing it again sets the same subname's address record to a
-- different wallet and SILENTLY MOVES THE NAME off the person who had it.
--
-- A scan of the chain does not save it either, because the scan stops at the first
-- gap: with `agent1` and `agent3` issued and `agent2` never taken, a floor built by
-- walking up from one stops at one and `agent3` looks free.
--
-- A sequence cannot go backwards. `nextval` is atomic, never returns the same value
-- twice, and does not care what rows exist, which is exactly the property wanted: the
-- counter is a fact about what has ever been assigned, not about what is currently
-- stored. It also removes the read-then-insert race entirely, so the retry in the
-- route is a belt for the label index rather than the mechanism.
--
-- START WITH 2 because `agent1.xovi.eth` was issued by hand on 2026-09-11, before this
-- table existed, and the sequence has to begin after what the chain already holds.
CREATE SEQUENCE IF NOT EXISTS names_label_seq AS bigint START WITH 2 MINVALUE 2;
