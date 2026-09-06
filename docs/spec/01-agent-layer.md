# 01. The agent layer

Written 2026-09-06, before implementation.

## The loop

A person delegates to an agent identified by an ENS name. The agent pays USDC over x402 on Base Sepolia to read computer-vision candidate windows. It proposes a clip through a machine credential. A human operator confirms. The confirmation becomes an offchain EAS attestation; its hash is anchored on Ethereum Sepolia, indexed, and served through a paid query.

## Invariants

### I1. An agent may propose; no credential may confirm

- **Mechanism:** the capability vocabulary carried by machine credentials has no confirm member, and the confirmation route has no bearer-token branch. Inserts from the machine path set status explicitly to `proposed`.
- **What defeats it:** the capability column is untyped JSON, so the closed set is a language-level ceiling, not a database constraint. A direct database write bypasses it entirely. Therefore the honest claim is *"enforced by the credential's server-side allow-list"*, never *"structurally impossible."*
- **Test:** a credential holding every capability that exists is refused at the confirmation route. Seen to fail by adding a confirm member and watching it pass.

> **Note, 2026-09-06.** The test has not been run, because no machine path exists yet to run it against. By this file's own rule, I1 is specified and not proven until it has been seen to go red.

### I2. A machine may never claim human provenance

- **Mechanism:** the ingest route rejects a submitted source of `manual` or `user` with 403; provenance is derived server-side from the credential, never read from the request body.
- **What defeats it:** any new insert path that forgets to set status explicitly inherits a column default of `verified`, publishing machine output as trusted. The default is being dropped for exactly this reason.
- **Test:** a proposal claiming human provenance returns 403; an insert omitting status raises a not-null violation rather than succeeding.

> **Note, 2026-09-06.** Half proven. Migration `0024` dropped the default and is applied on the development database; an insert omitting `status` now raises `23502`, observed rather than assumed. The provenance column landed with it under a real CHECK constraint, so for `clips.source` the closed set genuinely is a database guarantee, unlike the capability list in I1. The 403 half is still unrun: the ingest route does not exist.

### I3. Identity binds to the credential, not to the address

- **Mechanism:** the credential carries both the agent's address and its holder's; every machine row stamps the credential that made it; the self-review guard compares the responsible human.
- **What defeats it:** resolving the human by wallet lookup returns null for a fresh delegated address, so a guard written that way evaluates false and **permits** the confirmation it was meant to block. This was the original design and it is wrong.
- **Test:** an operator holding the credential behind a proposal is refused at every confirmation site, and the refusal survives the agent rotating to a brand-new address.

> **Note, 2026-09-06.** Not built. Neither the credential columns nor the guard change exist, so the failing-open behaviour described above is the current live behaviour, not a hazard that has been closed.

### I4. Payment never becomes authorisation

- **Mechanism:** no capability resolver reads a balance; no tier confirms faster.
- **What defeats it:** a future "premium" path that shortcuts review.
- **Test:** a CI grep asserting that the authorisation module imports nothing from the payment module.

> **Note, 2026-09-06.** The grep does not exist, so I4 is presently a commitment and not a mechanism.

### I5. Names resolve to roles, not to subjects

An agent's ENS records may name a role and a payment endpoint. No record resolves to an individual animal or a registry of them. Note the enforcement honestly: name access control authorises *writers*, not *values*, so this is a commitment Zenbit keeps, not a property the resolver enforces.

## Surfaces

| Surface | Auth | Notes |
|---|---|---|
| `GET /api/agent/windows` | x402 payment | Candidate windows. Never public. Route handler, not middleware. `private, no-store`. Settles only when the handler succeeded |
| Clip proposal | machine credential | Bearer, then schema validation, then authorisation. Station-scoped from day one |
| Confirmation | human session | No bearer branch exists |
| Observation payload | none, and stays none | The anchor proves existence and time only; the payload it commits to must be free to fetch or the anchor proves nothing to anyone |
| MCP query | x402 payment | The 402 is a tool result, not an HTTP header |

> **Note, 2026-09-06.** Of these, only the clip proposal capability exists, and it shipped station-scoped as specified. Every other row is unbuilt.

## Refusals the ingest route owes, each with a test

1. No credential → 401
2. Credential without the proposal capability → 403
3. Provenance claimed as human → 403
4. Station outside the credential's scope → 403
5. Over either rate limit (per credential, per caller) → refused

## Wire details that cost time to learn

- x402 v2 uses **three** headers (challenge, payment, receipt) and the 402 body is empty. The v1 header name is silently ignored by a v2 server, which is the worst failure to debug.
- The anchoring call **reverts on a repeat**. Anchoring the same hash twice fails, and a batch fails wholly if one element is stale. Guard by reading the existing timestamp first and treating a hit as success. Do not rehearse a demo with the fixture you intend to use live.
- The attestation contract on this testnet reports an older version than the published one, and its registry event has a different signature. Take interface definitions from the deployment, not from the package's default branch.

## Explicitly out of scope

An onchain identity registry, batching, extra schemas, metering, and any paid tier over the read feeds that are free today.
