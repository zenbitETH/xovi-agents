# Continuity disclosure

Zenbit is a research and development lab building open source public infrastructure on Ethereum, based in Querétaro, Mexico. Xovi is one of its products, and it is the project this submission extends.

ETHOnline 2026 requires a Continuity submission to state plainly what existed before the event and what was built during it. This is Zenbit's statement. It is written as the work happens and corrected when it turns out to be wrong, rather than assembled at the end.

**Event window: 2026-09-04 onward.**

---

## What existed before 2026-09-04

**Xovi** is a production conservation dApp at [xovi.axolodao.org](https://xovi.axolodao.org), built by Zenbit and first committed on 2026-05-10, with **268 commits** before the event window opened. Its repository is private; the deployed site is public, and so is the livestream it is built around, which runs twelve hours a day with recordings kept available.

What was already working, none of which is claimed as event work:

- A **clip pipeline**: viewers mark behaviours on a live axolotl stream, submit them, and human reviewers confirm or reject them. Confirmed clips accrue contribution records.
- A **water-quality pipeline**: an operator's readings are proposed, confirmed by a second person, and rendered on a live overlay over the public broadcast.
- A **machine-credential primitive** with a server-side capability allow-list, shipped as the twenty-second database migration. It already carried the property this project depends on: a credential can create rows that are born `proposed`, and no capability grants confirmation.
- An **EAS seam**: schema definitions and a client for offchain attestation, deployed to no network and wired to nothing. Inert on a branch.
- A **fiat rail** (subscriptions), **wallet identity**, and **40 API routes** across 20 database migrations.

**Nothing about paying for data, and nothing about a machine contributor, existed.** There was no x402 anywhere in the codebase, no agent identity, no receipts ledger, no subgraph, no MCP server, and no path by which software could propose a clip.

## What is being built during the event

Everything in **this repository**, which was created on 2026-09-06 and had no code in it before that date.

- An **x402-gated read endpoint** serving computer-vision candidate windows, priced per call and settled on Base Sepolia.
- An **agent client** that resolves an ENS name to a role and a payment endpoint, pays for a window, and proposes a clip.
- **Proof-of-human caps** so that a per-wallet limit is not defeated by generating wallets.
- An **anchor**: the human confirmation becomes an offchain EAS attestation, and its hash is timestamped on Ethereum Sepolia.
- A **subgraph** over that anchor, and an **MCP server** that charges per query.
- A **receipts ledger** and a fee sink on Base Sepolia.

### Changes made to the pre-existing project during the event

These are in the Xovi repository rather than this one, and they are disclosed here because they were written during the event window and the agent layer depends on them:

- **Done.** Two **provenance columns** on the clip record, the source of a clip and a confidence value. They restore a design specified earlier and lost in implementation. The same change removed a column default that would have published machine output as trusted.
- **Done.** A clip-proposal capability, scoped to a single station, added to the existing credential vocabulary.
- **WIP.** A clip ingestion endpoint for machine credentials.
- **WIP.** A fix to the self-review guard so that it compares the responsible human rather than the submitting address, which a delegated agent trivially defeats.
- **Done.** Rate limiting on two payment-adjacent endpoints, and a probe that goes red when either limiter is removed.

The last item predates the agent layer conceptually and was outstanding work on the existing project; it is listed because it was written inside the event window, not because it is claimed as a new feature.

These changes are published in this repository under `upstream/xovi-changes/`, copied from the private repository at the commit named in that directory's README, with two kinds of comment redacted and marked. During the event window Zenbit also added to Xovi a migration for anchoring water-quality summaries, inert and with no callers; it remains private because it belongs to the water-quality monitoring layer and not to the agents rail, and it is declared here rather than published for that reason.

## What is deliberately not here

Cut before the event, and named so the scope is legible: an onchain agent-identity registry, weekly Merkle batching of attestations, additional attestation schemas, usage metering, and any paid tier over the six read feeds that are currently free and are staying free.
