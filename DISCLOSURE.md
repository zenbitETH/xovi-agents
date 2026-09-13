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
- **The free daily allowance is a configured number of reads a day for an enrolled wallet, by either source**, AgentBook or a World ID verification made in this page; every read after that settles, and one proposal at most comes of a read. The two sources hold different identifiers for one person, so a person holding both a registration and an enrolment holds two allowances, which is a limit of the identifiers rather than of this code and is why the table refuses a second wallet per person on its own key. An unregistered wallet settles every read and does not pass the onboarding. It is a set value rather than an absence: unset, the code serves twenty a day. A reader can falsify this by making one read more than the configured number with an enrolled wallet and finding it free.
- **The page reaches three third party origins, and which of them depends on what a person is doing.** At rest it loads one: the livestream, embedded from the host that sets no cookie, chosen over the ordinary one, which sets three on a plain fetch. On the board it also loads `i.ytimg.com`, for each on offer cell's recording thumbnail. On the World ID step it reaches World's own origins, `developer.world.org` and, under a staging configuration, World's simulator. Nothing else on the page reaches an origin Zenbit does not serve, and a reader can falsify each of the three by opening the page at rest, on the board and at that step and reading the requests the browser makes.
- **After the switch, `agent1.xovi.eth` and the parent's `x402:windows` record resolve only through Zenbit's own gateway**, on the deployment that serves the windows route, so a name and the endpoint it points at depend on that deployment answering. Before it, both were records held on Ethereum Sepolia and read from the chain alone. A reader can falsify this by resolving either while the gateway is down and finding an answer.
- **A payment authorizes an amount and not a cell.** It names the token, the recipient, the amount, a validity window and a nonce, and never the path, so a payment signed for one cell reads another if the payer elects to present it that way. Nothing is gained by it: every cell is the same price, the read is one cell either way, and what makes an authorization spendable once is the nonce the token refuses to reuse. A reader can falsify the first half by reading the EIP-3009 payload the page sends.
- **A payment above one dollar is refused before it is signed.** The ceiling is one constant read by both payers, above the ruled price and low enough to catch a price with a zero too many; it is a guard against a typo and never a limit on the product.
- **A run on the deployed page proposes, and each enrolled wallet proposes under its own credential.** The deployment holds an ingest target, and a credential is minted for a wallet when it enrols, so the proposal a run makes is attributed to that wallet and not to Zenbit's own agent. The stop that remains is the honest one: a wallet whose mint did not answer holds no credential, and its run pays, reads, chooses a window and ends at not-submitted saying so. A reader can falsify either half by running the deployed page with an enrolled wallet and watching where the run ends.
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
