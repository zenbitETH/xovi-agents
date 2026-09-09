-- The column holds a keyed derivation of the identifier, never the identifier.
-- Renamed so the schema says so on its own: a column called `identifier` holding a
-- digest is the kind of thing an auditor has to be told rather than shown, and the
-- table is under a ruling that treats the underlying value as personal data.
--
-- Free to do here because the table has never held a real row: the free path cannot
-- fire until a registered payer pays, and that has not happened.
ALTER TABLE human_usage RENAME COLUMN identifier TO identifier_digest;
