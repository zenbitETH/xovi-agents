-- Free reads taken, per person per UTC day.
--
-- The identifier column holds a KEYED DERIVATION of a World ID nullifier and never
-- the nullifier itself, so a copy of this table on its own cannot be matched against
-- on chain registrations. 0003 renames the column to say so.
--
-- The underlying value names no person and is the same across every registration one
-- person makes under this action, which is what makes it useful for a per person cap
-- and what makes it personal data rather than anonymous data: a stable link is still
-- a link. Nothing else about the read is stored. There is no record of which window
-- was served, when within the day, or from which address. The column holds a count
-- and the table holds nothing else.
--
-- The column is `window_day` rather than `window`, which is reserved.
CREATE TABLE IF NOT EXISTS human_usage (
  identifier  text    NOT NULL,
  window_day  date    NOT NULL,
  used        integer NOT NULL,
  PRIMARY KEY (identifier, window_day)
);
