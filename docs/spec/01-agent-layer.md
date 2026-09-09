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

> **Note, 2026-09-07.** The machine path now exists, and the client half is proven. A check enumerates the agent's files by walking its two directories, rather than from a list that would stop covering whatever is added next, strips comments so it cannot match its own explanation, and fails if any of them names a decision route. Seen to fail by adding a call with no comment around it. That is a second mechanism rather than the one above: it proves the agent never asks, where the original proves the server never answers. The server half still cannot be run from here, because it needs an issued credential and a route in a repository this one does not contain. Saying which half is proven is the point of writing both.

### I2. A machine may never claim human provenance

- **Mechanism:** the ingest route rejects a submitted source of `manual` or `user` with 403; provenance is derived server-side from the credential, never read from the request body.
- **What defeats it:** any new insert path that forgets to set status explicitly inherits a column default of `verified`, publishing machine output as trusted. The default is being dropped for exactly this reason.
- **Test:** a proposal claiming human provenance returns 403; an insert omitting status raises a not-null violation rather than succeeding.

> **Note, 2026-09-06.** Half proven. Migration `0024` dropped the default and is applied on the development database; an insert omitting `status` now raises `23502`, observed rather than assumed. The provenance column landed with it under a real CHECK constraint, so for `clips.source` the closed set genuinely is a database guarantee, unlike the capability list in I1. The 403 half is still unrun: the ingest route does not exist.

> **Note, 2026-09-07.** The route exists now, and the client side is stronger than the invariant asks for: the proposal never sends a source at all, so there is nothing for the route to refuse. Absence is asserted where the request lands rather than where it is built, because a field can be added anywhere between the two. Seen to fail by adding a source to the payload and watching four checks go red. The real 403 remains unrun here; it needs an issued credential.

### I3. Identity binds to the credential, not to the address

- **Mechanism:** the credential carries both the agent's address and its holder's; every machine row stamps the credential that made it; the self-review guard compares the responsible human.
- **What defeats it:** resolving the human by wallet lookup returns null for a fresh delegated address, so a guard written that way evaluates false and **permits** the confirmation it was meant to block. This was the original design and it is wrong.
- **Test:** an operator holding the credential behind a proposal is refused at every confirmation site, and the refusal survives the agent rotating to a brand-new address.

> **Note, 2026-09-06.** Not built. Neither the credential columns nor the guard change exist, so the failing-open behaviour described above is the current live behaviour, not a hazard that has been closed.

> **Note, 2026-09-07.** Superseded. The credential columns and the guard both exist, and the guard resolves the responsible human through the credential rather than through a wallet lookup, so the failing-open behaviour described above is no longer live. The test still has to be run against an issued credential, which does not exist yet.

### I4. Payment never becomes authorisation

- **Mechanism:** no capability resolver reads a balance; no tier confirms faster.
- **What defeats it:** a future "premium" path that shortcuts review.
- **Test:** a CI grep asserting that the authorisation module imports nothing from the payment module.

> **Note, 2026-09-06.** The grep does not exist, so I4 is presently a commitment and not a mechanism.

> **Note, 2026-09-07.** The agent half now has a mechanism. The module that builds a proposal cannot reach the module that pays by any import path: the check follows the specifiers out of the proposing module and through everything they lead to, rather than grepping one file, because an indirect import through a third module would satisfy a grep and still leave the payer one call away. So no proposal can be conditioned on having paid, because it has no way to ask. Seen to fail by adding the import.
>
> *What defeats it:* a specifier the check cannot see. It reads text, so a dynamic import, a path assembled at runtime, or a value passed in from a caller would all pass. That bounds the claim to static imports, which is what it should say rather than implying more.
>
> The half this does not reach is the server's, where a capability resolver could read a balance, and that code is in a repository this one does not contain. The invariant is therefore half mechanism and half commitment, and the commitment half is the one worth naming out loud.

### I5. Names resolve to roles, not to subjects

An agent's ENS records may name a role and a payment endpoint. No record resolves to an individual animal or a registry of them. Note the enforcement honestly: name access control authorises *writers*, not *values*, so this is a commitment Zenbit keeps, not a property the resolver enforces.

### I6. A payment settles only for work that succeeded

Added 2026-09-07. The property was stated in the surfaces table below from the first day and was never an invariant, which meant it had no named mechanism and no test. It has two mechanisms, and the second was found rather than designed.

- **Mechanism A, the call order.** Verification and settlement are two separate calls on the resource server, with the work between them, so a handler that throws returns before settlement is reached. Written in the route rather than in a wrapper, which is the reason this is a route handler and not middleware.
- **What defeats A:** moving the paid set into a request wrapper, where settlement becomes a property of the wrapper and the ordering is no longer visible where the work happens. Next 16 renames middleware to proxy, so a check that knows only one name passes by accident on the day of the upgrade.
- **Test for A, seen to fail:** a fake facilitator on an ephemeral port counts hits per path. With a valid snapshot the paid read verifies once and settles once. With the snapshot unset the route answers 503, verify is 1 and **settle is 0**. Moving the settlement call above the work turns that check red, reading *the handler failed, so NOTHING settled, and the caller keeps their money*.
- **Mechanism B, the type system.** The result of processing the request is a discriminated union on `result.type`, and `paymentPayload` exists only on the verified branch. Settlement cannot be written above the narrowing that produces it.
- **What defeats B:** a cast, or widening the union so the field is always present. Note that the union belongs to the dependency and not to this repository, so a version bump can widen it without a line changing here. That is why the counted-hits check is the mechanism that survives and B is a second line rather than the first.
- **Test for B, seen to fail:** performing the same reordering raises two compiler errors before any test runs. Mechanism B was discovered while proving mechanism A, by observing that the deliberate defect would not typecheck.

A property the compiler refuses and the suite catches is a stronger claim than either alone. It is worth stating that neither mechanism proves a real facilitator rejects a forged signature, or that any value moves. The fake believes what it is told.

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
- The proof of human registry is deployed at **the same address on two chains**, with byte identical code and separate state, and the registration tool writes only one of them. Reading the other returns zero for every agent, which is indistinguishable from nobody having registered: the feature fails closed and stays silent. The tool's README on its main branch documents a network flag that the published version rejects, so the README is not evidence about the version installed. Hash the deployed bytecode on both chains if the addresses being equal seems too convenient to be true.
- A settlement reply must carry a transaction and a network **even when it reports failure**. The schema requires both fields in both cases, so a facilitator refusal that omits them is rejected as malformed and the caller sees a parse error instead of the refusal it was handed. Anything standing in for a facilitator has to honour that or it tests the wrong failure.
- There is no fetch wrapper in the installed packages. The helper most integrations use ships in a separate package that is not a dependency here, so a paying client is assembled from the HTTP client directly. Note also that the scheme registration function has the same name on the client and the server and takes a different number of arguments in each; nothing catches the confusion.

## Explicitly out of scope

An onchain identity registry, batching, extra schemas, metering, and any paid tier over the read feeds that are free today.
