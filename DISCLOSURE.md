# Continuity disclosure

Zenbit is a research and development lab building open source public infrastructure on Ethereum, based in Querétaro, Mexico. Xovi is one of its products, and it is the project this submission extends.

ETHOnline 2026 requires a Continuity submission to state plainly what existed before the event and what was built during it. This is Zenbit's statement. It is written as the work happens and corrected when it turns out to be wrong, rather than assembled at the end.

**Event window: 2026-09-04 onward.**

---

## What existed before 2026-09-04

**Xovi** is a live conservation dApp at [xovi.axolodao.org](https://xovi.axolodao.org), built by Zenbit and first committed on 2026-05-10, with **268 commits** before the event window opened. Its repository is private; the deployed site is public, and so is the livestream it is built around, which runs twelve hours a day with recordings kept available.

What was already working, none of which is claimed as event work:

- A **clip pipeline**: viewers mark behaviours on a live axolotl stream, submit them, and human reviewers confirm or reject them. Confirmed clips accrue contribution records.
- A **water-quality pipeline**: an operator's readings are proposed, confirmed by a second person, and rendered on a live overlay over the public broadcast.
- A **machine-credential primitive** with a server-side capability allow-list, shipped as the twenty-second database migration. It already carried the property this project depends on: a credential can create rows that are born `proposed`, and no capability grants confirmation.
- An **EAS seam**: schema definitions and a client for offchain attestation, deployed to no network and wired to nothing. Inert on a branch.
- A **fiat rail** (subscriptions), **wallet identity**, and **40 API routes** across 20 database migrations.

**Nothing about paying for data, and nothing about a machine contributor, existed.** There was no x402 anywhere in the codebase, no agent identity, no receipts ledger, no subgraph, no MCP server, and no path by which software could propose a clip.

## What is being built during the event

Everything in **this repository**, which was created on 2026-09-06 and had no code in it before that date.

### Built and running

Each of these is exercised by the checks in this repository. `npm run local` drives the **paid read** and the **delegated run** from a clean checkout, against a fake facilitator and a fake ingest; it does not run the agent client, and it hands the child an empty `DATABASE_URL` so Next's own env loader cannot give it the production one, so it exercises neither ENS resolution nor the caps and has no ledger to write to.

- An **x402-gated read endpoint** serving computer-vision candidate windows, priced per call and settled on Base Sepolia against a facilitator used for development and testnet workflows.
- An **agent client** that pays for a window and proposes a clip, and takes the endpoint it pays from an ENS record. **`xovi.eth` is registered on Ethereum Sepolia and its `x402:windows` record resolves to `https://xovi-agents.vercel.app/api/agent/windows`**, read 2026-09-12 through `resolveWindowsEndpoint` with no injected lookup, which is the same function `bin/agent.ts` calls. This sentence stops being true if that record is removed or the name lapses, which is a thing the reader can check in one command: `AGENT_ENS_NAME=xovi.eth npm run ens:verify`.
- **Delegation from a reader's own wallet**: the reader connects a browser wallet, signs one payment, and the agent's run is streamed back step by step as it happens. The reader supplies a signature and nothing else; the proposal is formed on the server from a window the server already holds.
- **A dashboard over one wallet's own record**: the run drawn as objects rather than sentences, the settlements it made with their explorer links, the confirmation this repository carries with the recovery a stranger can run beside it, the confirmed proposals that wallet submitted, and whether a name resolves to it. Every number on it comes from a served field or a merged document, and the sections that would need a number nobody serves carry a sentence instead.
- **The free daily allowance is zero on the deployment.** The allowance is a configured number and it is not set there, so every read on that page settles rather than being served free, which is what makes the payment the thing a visitor sees.
- **The page loads one thing from a third party.** The livestream is embedded from the host that sets no cookie, chosen over the ordinary one, which sets three on a plain fetch. Nothing else on the page reaches an origin Zenbit does not serve.
- **A payment above one dollar is refused before it is signed.** The ceiling is one constant read by both payers, above the ruled price and low enough to catch a price with a zero too many; it is a guard against a typo and never a limit on the product.
- **A run on the deployed page stops before proposing.** It pays, reads, chooses a window and ends at not-submitted, saying that no ingest credential is configured on this deployment, because `XOVI_INGEST_URL` and `XOVI_INGEST_KEY` are not set there. That is the path `test/agent-run.ts` asserts, and a reader can falsify it by running the deployed page and watching where the run ends.
- **Proof-of-human caps**, so a per-wallet limit is not defeated by generating wallets.
- An **offchain attestation**: the human operator confirms, and the operator asserts that confirmation in an EAS attestation whose schema identifier, signed object and signer recovery are all exercised.
- A **subgraph** and an **MCP server** that charges per query.
- A **receipts ledger**: a settlement is recorded against the payer who made it, and read back for that payer alone through `/api/receipts`.
- The **attestation schema is registered** on Ethereum Sepolia, `0x8d4a9a6e…8c6d`, and one confirmation is anchored: attested at `0xd86c2902…5538` and its offchain identifier timestamped at `0x236b7c7a…dfb3`. The subgraph indexes that anchor and a paid query returns it.

### Designed and not running

Named here rather than implied by the list above, because the difference is what a Continuity submission turns on.

- The **fee sink** is not started.
- The **subscription tier** that would lift the per-person cap, **agent rewards** for proposing particular behaviours, and the **reconciliation** between what agents pay for the read and what subscribers pay for the product are designed and are not built.

### The surface this opens, stated rather than left to be found

The machine ingest surface carries **40 findings from an internal audit dated 2026-09-06 that have not been triaged**. This work does not widen that surface: a reader supplies a payment and nothing else, no field they control reaches the ingest route, and the proposal is built server side by the code that already built it. What changes is how often the surface is reached, which is what the per-person cap governs. Triage is work for after the event and is not claimed as done.

### Changes made to the pre-existing project during the event

These are in the Xovi repository rather than this one, and they are disclosed here because they were written during the event window and the agent layer depends on them:

- **Done.** Two **provenance columns** on the clip record, the source of a clip and a confidence value. They restore a design specified earlier and lost in implementation. The same change removed a column default that would have published machine output as trusted.
- **Done.** A clip-proposal capability, scoped to a single station, added to the existing credential vocabulary.
- **Done.** A clip ingestion endpoint for machine credentials.
- **Done.** A fix to the self-review guard so that it compares the responsible human rather than the submitting address, which a delegated agent trivially defeats.
- **Done.** **Operator-signed confirmations.** The reviewer signs a readable EIP-191 message over the clip id, its hash, the decision, a single-use nonce and the chain id, and the row keeps the signature, the nonce and the chain id. Before it, "a human confirmed this" rested on a session cookie and an attestation signed by a backend key, so possession of that key or of the database url produced a record indistinguishable from a genuine one, and a genuine one could not be shown to a third party either. Rows decided earlier are not backfilled and a null signature means exactly that.
- **Done.** Rate limiting on two payment-adjacent endpoints, and a probe that goes red when either limiter is removed.

The last item predates the agent layer conceptually and was outstanding work on the existing project; it is listed because it was written inside the event window, not because it is claimed as a new feature.

Five of these six are published in this repository under `upstream/xovi-changes/`, taken from the private repository at the commit named in that directory's README. Each published file carries a provenance header that is an **addition** rather than part of the copy, and three kinds of text are redacted and marked in place: comments comparing the clip route or its columns to other ingestion paths, the capabilities issued to credential classes other than the clip proposer, and one operational figure about the product. The credential excerpt omits the minting path only. It carries everything the published files import, because an exhibit that publishes a caller and withholds the callee it depends on publishes a mechanism without the warning attached to it; its own header lists what was removed and what was redacted. The **rate limiting is declared rather than published**: the limiter is a shared Xovi module that the published ingest route calls into, and the two payment-adjacent endpoints it protects and the probe that watches it are Xovi's own rather than part of the agents rail, so publishing them would mean publishing that layer. During the event window Zenbit also added to Xovi a migration for anchoring water-quality summaries, inert and with no callers; it remains private because it belongs to the water-quality monitoring layer and not to the agents rail, and it is declared here rather than published for that reason.

### Where this repository is first person, and why

Documentation here is written in the third person as Zenbit. Three places are not, each on purpose.

`CONTRIBUTING.md` carries the Developer Certificate of Origin, which is a statement a contributor makes in their own voice and is not Zenbit's to rewrite. Two comments, in `lib/anchor/store.ts` and `test/anchor.ts`, quote a question the code asks about itself: `claim` answered *did I insert a row* while the caller read it as *is this clip done*, and the two differ for exactly the state a failed second leg leaves behind. The first person there is the finding rather than the style, because the defect was the code confusing its own action with the state of the world, and a third person subject would describe that confusion instead of showing it. The remaining occurrences are inside `upstream/xovi-changes/`, which is a copy rather than Zenbit's prose, and editing it would make it a different artefact than the one this document claims.

## What is deliberately not here

Cut before the event, and named so the scope is legible: an onchain agent-identity registry, weekly Merkle batching of attestations, additional attestation schemas, usage metering, and any paid tier over the six read feeds that are currently free and are staying free.
