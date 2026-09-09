/**
 * The status rows, in one place because two surfaces state them.
 *
 * The table in README.md is the source. This file repeats it so the page can
 * render it, and test/page.ts asserts that every row here still appears there,
 * so the two cannot drift apart in silence. A landing page on a judged
 * repository that claims more than its own README is worse than the 404 it
 * replaced, and the failure mode is not that somebody lies: it is that a leg
 * lands, the README is updated, and the page is forgotten.
 *
 * A state string beginning with "built" is rendered as built. That is the whole
 * rule, so a new qualifier can be added to a state without touching the page.
 */
export type StatusRow = { leg: string; state: string };

export const STATUS_ROWS: StatusRow[] = [
  { leg: "Paid read over x402", state: "built, and exercised end to end against a faked facilitator" },
  { leg: "Agent proposes a clip", state: "built, and exercised against the ingest route faked from its own contract" },
  { leg: "Proof of human, per person caps", state: "not started" },
  { leg: "Attestation and onchain anchor", state: "not started" },
  { leg: "Subgraph and paid query", state: "not started" },
  { leg: "Receipts ledger and fee sink", state: "not started" },
];
