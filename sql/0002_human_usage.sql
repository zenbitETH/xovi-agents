-- Free reads taken, per person per UTC day.
--
-- `identifier` is a World ID nullifier: a person is not named by it, and every
-- registration one person makes under this action yields the same value, which is
-- what makes it useful here and why nothing else about the read is stored. There is
-- no record of which window was served, when within the day, or from which address.
-- The column holds a count and the table holds nothing else.
--
-- The column is `window_day` rather than `window`, which is reserved.
CREATE TABLE IF NOT EXISTS human_usage (
  identifier  text    NOT NULL,
  window_day  date    NOT NULL,
  used        integer NOT NULL,
  PRIMARY KEY (identifier, window_day)
);
