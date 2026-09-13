# xovi-agents

A delegated agent pays for data, proposes a record, and cannot approve its own work.

## What this is

[Xovi](https://xovi.axolodao.org) is a conservation dApp built around a public axolotl livestream. People watch the stream, mark behaviours they see, and submit them as clips. Other people confirm or reject those clips. Confirmed observations accrue as a record.

This repository adds a machine to that loop, in the one position where a machine belongs. A person delegates to an agent. The agent pays USDC over x402 to read computer-vision candidate windows, which are segments the model thinks are worth a human's attention. It proposes a clip through a machine credential. Then it stops. A human operator confirms or rejects, exactly as they do for a clip a person submitted. The operator asserts that confirmation in an EAS attestation, which is designed to be anchored on Ethereum Sepolia and indexed by a subgraph so the result can be served through a paid query.

The agent never sees a water reading, never confirms anything, and earns no credit for what it proposes.

## The invariant

**An agent may propose. No credential in existence may confirm.**

That is inherited rather than built for a demo. The credential primitive it rests on shipped in Xovi before this event, and its capability list has no confirm member. A machine can create rows that are born `proposed`; reaching `confirmed` requires a human session, and no bearer token opens that door.

Stated precisely, because the distinction is the sort of thing a reviewer checks: the capability list is enforced by the credential's server side allow list. It is not a database constraint. The clip provenance column is a database constraint. Those are different strengths of claim and this repository will not blur them.

## Why an agent should have to pay

Computer vision produces candidates, not conclusions. Measured on 2026-08-28 against a fixed bank of 164 frames drawn from 13 verified clips: the model reads the station correctly 159 times and identifies 6 of the 13. At frame level it gets 50 right, 0 wrong, and refers 114 to a human. It declines to decide about seventy per cent of the time, and that refusal is the useful part.

The date and the bank size are part of the claim, not decoration. That bank grows as more footage is verified, so a later figure is a new measurement rather than a correction of this one, and a reader who finds a different number should be able to tell which.

So the thing worth selling is not the observation. Observations are public: confirmed water readings are rendered on a live overlay over a public stream, and the biological record is headed for open scientific archives under CC BY. What is scarce is derivation and provenance. The candidate windows are never public. The join between an onchain anchor and the human confirmation behind it cannot be reconstructed from a video frame. That join is the product.

## How it works

The design is in [`docs/spec/`](./docs/spec/), five documents: the agent layer and its invariants, the candidate window shape and the embargo rule, the proposal mapping, the proof of human allowance, and the anchor and paid query. [`01-agent-layer.md`](./docs/spec/01-agent-layer.md) lists each invariant with its mechanism, what defeats it, and the check that holds it.

Two rails, and they do not overlap. Payments settle on Base Sepolia (`eip155:84532`), in USDC, to `0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe`. That address is the recipient of settlements on this rail and is named here as nothing else. The endpoint already returns it in the 402 challenge to any unpaid request, so recording it lets a reader check a settlement against a value the service publishes rather than against one they were handed. Attestations anchor on Ethereum Sepolia (`11155111`). **Nothing here writes to a mainnet and nothing handles real funds.** One read is on one: the paid endpoint reads the World ID registry on World Chain (`480`), which moves nothing and needs no key. `xovi.eth` is also registered on Ethereum mainnet, and this code reads Sepolia only.

## Running it

`npm ci`, then `npm test` for the suite and `npm run check-types` for the types. Both run in CI on every pull request and need no network, no secrets and no funded wallet: the payment checks refuse at configuration time, and the route's end to end checks run against a facilitator faked on localhost.

Running the endpoint needs `X402_PAY_TO` and `WINDOWS_SNAPSHOT`; paying for a read needs `AGENT_PRIVATE_KEY`. Every variable is described in [`.env.example`](./.env.example). Unset, the endpoint answers 503 rather than serving for free, and a missing snapshot answers 503 rather than an empty list, because an empty list is a real answer meaning the detector found nothing.

## Track and disclosure

Built for ETHOnline 2026 on the Continuity track, which means it extends a project that existed before the event.

| Document | What it covers |
|---|---|
| [`DISCLOSURE.md`](./DISCLOSURE.md) | What existed before 2026-09-04 and what was built during the event |
| [`AI-USAGE.md`](./AI-USAGE.md) | Where AI tools were used, and which parts are not model output |
| [`docs/spec/`](./docs/spec/) | The specifications that directed the work. The first two were written before the code; the third records a mapping derived by reading the receiving route, and says so in its first line |

## Status

This repository was created on 2026-09-06 and is being built across the event window. Each leg lands as its own pull request, so the history shows the order things were actually built in, and every pull request since #12, which added the workflow, runs its checks in CI.

| Leg | State |
|---|---|
| Agent identity over ENS, ENSIP-10 and EIP-3668, its answers signed under EIP-191 | resolving: `xovi.eth` is registered on Ethereum Sepolia and its `x402:windows` record resolves to the windows endpoint, read 2026-09-12 through `resolveWindowsEndpoint` with no injected lookup, which is the function `bin/agent.ts` calls. Checkable in one command, `AGENT_ENS_NAME=xovi.eth npm run ens:verify`. The four refusal branches are proven against an injected resolver, and the protocol guard is proven against the real record: an `http` value stood on it for eighteen blocks on 2026-09-12 and was refused |
| Paid read over x402 version 2, settled with EIP-3009 | built, and settled repeatedly on Base Sepolia through the public testnet facilitator, most recently `0x4d609e7b…aa39`. The suite exercises the refusal against a fake; the settlements are real |
| Agent proposes a clip | built, and exercised twice over: against a fake of the ingest route in the suite, and live against the real route, which is where clip 259 came from |
| Proof of human over World ID version 4, per person caps | built: registry lookup, a keyed digest of the identifier kept for 30 days, and a per person daily allowance |
| Attestation and onchain anchor over EAS | **registered and anchored.** The schema is `0x8d4a9a6e…8c6d` on Ethereum Sepolia, registered in block 11680348; clip 259's confirmation is attested in transaction `0xd86c2902…5538` and its offchain identifier timestamped in transaction `0x236b7c7a…dfb3` |
| Subgraph on The Graph, and a paid query | **indexing the deployed anchor.** The subgraph returns clip 259's observation filtered on the schema identifier as `topic3`, and a paid query over MCP returns it after settling |
| A person's own surface | built: an onboarding that asks for a wallet on Base Sepolia, what AgentBook says about it and whether a name resolves to it, before anything else is reachable; a board of what is on offer per day and per species; the run drawn one card at a time; and the account's receipts, proposals and names. Every number on it comes from a served field or a merged document |
| A cell says what it is, and where the agent has been | built: a cell on offer carries the recording's public thumbnail and length, the span its windows cover and what a read costs, read from that cell's own payment challenge, and never how many windows it holds. A wallet's own runs are recorded and the cells it has read carry what came of the last one; a payer sees its own marks and no others, and a board asked without a payer carries none |
| Windows on offer | built from screened recordings of the museum's own livestream, each file carrying the day its footage belongs to. The board says on offer or none per day and per species and never how many, because the files are public and a count is the withheld set by subtraction |
| Receipts ledger and fee sink | receipts built and written by real settlements, recorded against the payer. **The fee sink is not started** |

## What the attestation asserts

<!-- SLOT, and this comment is meant to be consumed. When the schema is registered, the legal lead's first sentence goes here, ahead of the paragraph below, and nothing else changes:

A schema definition for clip confirmations is registered on a public testnet for interoperability testing, with no production monitoring system deployed against it.

It is held out until then because it states a registration as fact. Delete this comment once the sentence is in place. Do NOT delete the one below it.

NOTE 2026-09-12: the condition has been met. The schema is registered on Ethereum Sepolia at 0x8d4a9a6e...8c6d and the subgraph indexes an attestation under it. This slot is left unconsumed deliberately rather than by oversight: the sentence is the legal lead's text and it asserts that no production monitoring system is deployed against the schema, which is a claim about the product that nobody here has re-checked since she wrote it. Consuming it is hers or the founder's call and is one edit. -->

<!-- SWEEP RULE, and this comment is permanent. It is separate from the slot above precisely so that consuming the slot does not take it away, which is when it is needed most: at that point the word moves from an invisible comment into visible prose, so a sweep is more likely to fire and whoever runs it has less around it to explain why.

The word "production" in this file is a NEGATION inside the legal lead's own disclaimer, in the clause saying no production monitoring system is deployed. It is not a claim that anything is in production, it does not breach the rule against that word, and no session amends her text. A mechanical sweep reports it whether it sits in a comment or in prose. It is closed by reading it, not by deleting it. -->

The human operator confirms; the confirmation is attested. The attestation asserts who confirmed and when, and makes that verifiable by third parties. It certifies no identity, no reputation, no payment and no biological fact. The agent proposes; no credential of its own can confirm or attest.

## Privacy

ZENBIT S.A.S. de C.V. (Santiago de Querétaro, Mexico) is the data controller. For agents, the World ID identifier of the person who registered them is read to administer a free daily quota and to show operators, as true or false, whether a proposing agent was registered by a verified person; a keyed digest of it is kept for 30 days for the quota only. You may limit the use of your data, exercise your access, rectification, cancellation and objection rights, and revoke your consent at hola@zenbit.mx. Full privacy notice: https://zenbit.mx/en/privacy. Clip confirmations are collected in the Xovi confirmation interface, which carries its own notice.

Zenbit adds, outside that paragraph because it is Zenbit's own statement and not the controller's text: that identifier reaches Zenbit two ways, read from AgentBook for an agent registered there, or from a World ID proof the person submits in this page; the digest, the thirty days and the quota are the same either way.

## Licence

MIT. See `LICENSE`. Copyright (c) 2026 ZENBIT S.A.S. de C.V.

No patent rights are granted, expressly or by implication. The components covered by Zenbit's filed patent application are not included in this repository: the computer-vision stack, the water-quality validation logic, the specimen registry and the application database are not here and not in the attestation schema.

External contributions are accepted under the Developer Certificate of Origin 1.1 (see `CONTRIBUTING.md`); sign off each commit with `git commit -s`. Most commits from the repository owner's account carry no sign-off; three from 2026-09-08 do, `ff4ff23`, `87cac0e` and `b446f35`, which is visible in the log rather than asserted here. This sentence said *carry no sign-off* until 2026-09-12, which was true when written and was falsified by the author's own later commits.
