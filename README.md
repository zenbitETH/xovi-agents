# xovi-agents

A delegated agent pays for data, proposes a record, and cannot approve its own work.

## What this is

[Xovi](https://xovi.axolodao.org) is a conservation dApp built around a public axolotl livestream. People watch the stream, mark behaviours they see, and submit them as clips. Other people confirm or reject those clips. Confirmed observations accrue as a record.

This repository adds a machine to that loop, in the one position where a machine belongs. A person delegates to an agent identified by an ENS name. The agent pays USDC over x402 to read computer-vision candidate windows, which are segments the model thinks are worth a human's attention. It proposes a clip through a machine credential. Then it stops. A human operator confirms or rejects, exactly as they do for a clip a person submitted. That confirmation becomes an EAS attestation, its hash is anchored on Ethereum Sepolia, and a subgraph indexes the anchor so the result can be served through a paid query.

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

**WIP.** The detailed architecture, the wire formats, and the endpoint contracts are not written here yet. The design that governs them is in [`docs/spec/01-agent-layer.md`](./docs/spec/01-agent-layer.md), which lists each invariant with its mechanism, what defeats it, and the test that proves it.

Two rails, and they do not overlap. Payments settle on Base Sepolia (`eip155:84532`). Attestations anchor on Ethereum Sepolia (`11155111`). Nothing touches mainnet and nothing handles real funds.

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
| Paid read over x402 | built, and exercised end to end against a faked facilitator |
| Agent proposes a clip | built, and exercised against the ingest route faked from its own contract |
| Proof of human, per person caps | not started |
| Attestation and onchain anchor | not started |
| Subgraph and paid query | not started |
| Receipts ledger and fee sink | not started |

## Licence

MIT. See `LICENSE`. Copyright (c) 2026 ZENBIT S.A.S. de C.V.

No patent rights are granted, expressly or by implication. The components covered by Zenbit's filed patent application are not included in this repository: the computer-vision stack, the water-quality validation logic, the specimen registry and the application database are not here and not in the attestation schema.

Contributions are accepted under the Developer Certificate of Origin 1.1 (see `CONTRIBUTING.md`). Sign off every commit with `git commit -s`.
