# 04. One human, one cap

Written 2026-09-07, before the code, against the registry read rather than against the documentation.

## What a cap on an address is worth

Nothing. A limit tied to an address is defeated by generating addresses, and generating addresses is free. Moving the limit onto something that cannot be minted is the whole of this feature, and everything below follows from where that identifier comes from.

## The shape, and why the degraded path needs no code

A registered person's agents get a number of free reads per day. Past that number, and for anyone the registry does not know, every read settles exactly as it does today. So the cap is an allowance laid on top of a rail that already works, and the fallback is not a branch somebody has to remember to write: it is the behaviour that existed before this document. A free read returns the same response as the no-payment-required arm, because that is what it is: served, with nothing owed and nothing settled.

The knobs are `HUMAN_FREE_READS_PER_DAY`, default 20, counted per UTC day, and the registry's address and rpc in `AGENTBOOK_ADDRESS` and `AGENTBOOK_RPC_URL`. The demo sets the free count to 3, so exhausting one agent's share and watching the second settle takes about a minute on camera.

## The order in the route, and no other

Verify the payment first, exactly as today. That is what authenticates the payer: the client signs a payment regardless, and the settled receipt names the address, so the identity this cap keys on arrives already proven rather than claimed.

Then read the registry for that payer, inside a try, with a timeout of about two seconds. A hanging rpc has to degrade inside the request rather than stall a read somebody is paying for.

A nonzero identifier with allowance left means serve and count the usage, and do not settle: the payment authorization simply expires unused. A zero identifier, a throw, a timeout, or an allowance already spent all mean settle as today and write the receipt.

Usage is written only when a read was served free. A receipt is written only when a settlement succeeded. Nothing writes both.

## The second source, added 2026-09-13

The identifier reaches this system two ways now. AgentBook holds registrations made outside this page, and a World ID verification made in the page holds its own in a `verifications` table. Both answer the one question the cap asks, whether a person stands behind this wallet, and the route that answers it names which source did.

**The two are not one person's one identifier.** AgentBook keeps the nullifier of the registration tool's own action and the table keeps a digest of the nullifier World scopes to this relying party and this action, so the two cannot be joined and a person holding both holds two digests and therefore two allowances. That is a property of the identifiers rather than of this code, and it is why the table refuses a second wallet for one person on its own key: the sybil bound the table can enforce is the one it enforces, and the bound across both sources is the weaker claim.

Everything else in this document holds unchanged: the identifier is never stored, the derivation is keyed, the retention is thirty days on the request path, and every failure still collapses to paying.

## What the registry actually says

Measured against the deployment rather than read from a summary. `lookupHuman(address)` returns `0` for an address that has never registered, and does not revert. A deliberately wrong selector on the same contract does revert, which is what makes those zeros evidence rather than an artefact of a contract that answers everything with zero.

**The chain it is read on is not the chain the payments settle on, and getting that wrong is silent.** The registration tool writes World Chain, chain 480, and only that: the published version rejects a network flag outright. The contract sits at the same address on Base Sepolia with byte identical code, verified by hashing the deployed bytecode on both, and separate state. So a lookup pointed at the payment chain returns zero for an agent that is registered, the cap fails closed, every read settles, and the feature can never fire while looking exactly like a world in which nobody has registered. The first measurements in this document were taken on Base Sepolia, which is why they were all zeros and why the zeros were not the whole story.

The consequence is worth stating plainly rather than leaving in a config file. **This system now touches two chains and one of them is a mainnet:** payments settle on Base Sepolia, and the identity read happens on World Chain. The read moves nothing, holds nothing and needs no key, but a reviewer counting chains should find that written down rather than discover it.

The registration function puts the agent address and a nonce into the World ID *signal* and uses a contract wide constant as the external nullifier. A World ID nullifier is deterministic on the identity and the external nullifier, so one person produces the same value whichever agent they register, and the agent address changes the signal instead. There is no set of used nullifiers in the contract and nothing rejects a repeat. One human to many agents is therefore the construction rather than a hope, which is what makes a shared budget testable at all.

## Invariants

### P1. The cap keys on the registry's identifier, and no client field can claim one

- **Mechanism:** the identifier is read from the registry using the payer address out of the verified payment. Nothing in the request body reaches it. Counters and receipts store the identifier, never the address.
- **What defeats it:** keying the usage row on the payer address instead. Two agents of one person would then hold two budgets, which is the failure this feature exists to prevent, and it would look like it worked. It is also defeated by asking how many reads are left and then taking one, because two requests from a person at the limit minus one both read the same number and both go free. The count and the limit therefore travel into a single statement, whose where clause carries the limit and which returns nothing when there was nothing to take.
- **Test for the second half, seen to fail:** two takes raced at the last free read yield exactly one. Putting a single await between the read and the write in the store makes both succeed, which is a cap that holds in every sequential test and gives way the moment somebody uses it properly.
- **Test, seen to fail:** exhaust the allowance from one payer address and read from a second address the fake registry maps to the same identifier. The second read must settle. Keying on the address turns it green in the wrong direction, and the check goes red when the keying is changed back.

### P2. A settlement is counted once

- **Mechanism:** the receipt insert alone, on conflict do nothing, returning the row. Two unique indexes carry it, the authorization nonce and the settlement transaction hash, and counted once means one row: the call reports whether the row was new rather than whether a write happened.
- **What defeats it:** dropping either index. The nonce catches a replayed authorization and the transaction hash catches the same settlement arriving by another route, and neither one covers both.
- **Test, seen to fail:** record the same settlement twice and observe one row, then again under a different nonce and observe the transaction hash still catching it. Removing the uniqueness makes each attempt a row.
- **An earlier draft of this said the insert also updates a count, in one statement.** It does not, and it cannot: a receipt is written on settlement and usage on a free read, and nothing writes both, so there was no count for that insert to update. The single statement that idea was reaching for belongs in P1, where the comparison and the increment genuinely must not be separable.

### P3. A lookup that fails degrades to pay per request

- **Mechanism:** the read is wrapped and given a timeout, and every failure path falls into the settlement arm that predates this feature.
- **What defeats it:** treating an error as an allowance, which fails open to unlimited free reads, or treating it as a refusal, which fails closed and takes the paid endpoint down when an rpc has a bad afternoon. Both are worse than paying.
- **Test, seen to fail:** a fake registry that throws, and one that returns the unregistered value, both settle. A fake that hangs settles too, and takes about two seconds rather than the request's lifetime.

### P3b. What "counted once" guarantees, stated as a guarantee rather than as a hope

- **At most once, for every receipt that was written.** Two unique indexes carry it, the authorization nonce and the settlement transaction hash, and P2 is the check.
- **At least once is best effort.** A receipt write that fails is logged and not retried, and the request still succeeds, because the caller has been charged and served and failing them over a bookkeeping write would be the larger wrong.
- **What that can lose, precisely.** Bookkeeping, and only bookkeeping. Never money and never a served read. The authorization nonce is consumed on chain when the settlement goes through, so the settlement itself cannot be replayed whatever this database remembers; a lost receipt is a row missing from a ledger, not a payment that can happen twice.
- **What it costs.** A ledger that disagrees with the chain, with no record of when it started disagreeing, which is why the failure is logged rather than swallowed in silence.

### P4. The registry is last writer wins, and the cap inherits that

- **This is documented behaviour of a third party system, not a defect in it.** The registry works as its authors built it; what follows is what this design inherits from it, written so the next reader does not have to derive it.
- **Mechanism:** none, and that is the point of writing it down. `lookupHuman[agent] = nullifierHash` is an unconditional overwrite, so anyone able to produce a valid proof for the signal made of an agent address and its next nonce can rebind an agent that is not theirs. The nonce prevents replay, not rebinding.
- **What it does not defeat:** the cap. A person has one identifier, and registering more agents only divides the same allowance, which is what sybil resistance means here.
- **What it does enable:** griefing. Rebinding somebody's agent onto an exhausted identifier stops their reads being free.
- **Why that is survivable, and this is a property of the shape rather than a mitigation:** the fallback is pay per request, so a hostile rebinding costs the victim the ordinary price of a read and never their access. Nothing defends against this and nothing needs to.
- Noticed while reading and recorded so the next reader does not have to: the mapping is written before the proof is verified. A revert unwinds it, so it is harmless, and it is the ordering a reviewer will stop on.

## The order the demonstration has to run in

The free path and the evidence for the paid read contradict each other on purpose, and the contradiction has to be scheduled rather than discovered. Once the operator's payer is a registered human and the database exists, that payer's reads are free, so the probe that produces a settlement transaction for the paid read finds a 200 with no receipt and reports that nothing settled. The endpoint is working; the probe is asking for the one thing this feature exists to prevent.

So the explorer evidence is produced first, either before the payer is registered or with the free count set to zero, which `HUMAN_FREE_READS_PER_DAY=0` does because zero is a valid count rather than a missing one. The cap is turned on afterwards, for the demonstration that shows a free read and a second agent settling. The probe says so in its own failure message, so somebody meeting this at three in the morning is told the cause rather than left to find it.

## Privacy

The identifier is a World ID nullifier. It names no person, and it is the same value across every registration one human makes under this action, which is what makes it useful for a per person cap and what makes it **personal data rather than anonymous data**: a stable link is still a link. An audit ruled it pseudonymised personal data under Mexican federal law, and the rest of this section is what that ruling requires.

**The declared purpose is one thing: administering a daily free quota per registered person.** Any other use needs its own basis. Nothing is stored about which window was served, at what time within the day, or from which address.

**What is stored is never the identifier.** It is an HMAC-SHA256 derivation under a server secret that lives outside this repository, written as fixed width lowercase hex so its length says nothing either. That the underlying value is readable by anyone on chain does not make storing it in the clear harmless: what the derivation reduces is the linkability of **this** database, not of the contract, so a copy of the usage table on its own says only that some person took some free reads on some day. With no key there is no derivation, so there is no allowance and every read settles, which is the direction everything else here fails in.

**Retention is thirty days, and it is a delete on the request path rather than a schedule.** One extra statement before each take, so a period declared in a privacy notice does not depend on a cron somebody can switch off without anyone noticing, and a day with no reads at all is purged by the next read there is.

**The identifier never appears in a log, not truncated and not whole.** The code has always complied; this sentence used to say truncated, which promised less than the code delivered, and a document that misdescribes its own code in either direction is the thing an audit exists to catch.

No real identifier goes into this repository, a pull request body, a comment, or this file. Fixtures use invented values. A real one belongs to the person it identifies and stays with them.

## Storage

**The free path is unreachable in production until the schema lands.** With no database configured there is no allowance, so every read settles and the endpoint behaves exactly as it did before this feature. That is the correct degradation rather than a stub, and it has one consequence worth planning around: a demonstration of a free read needs the database to exist before the recording, not before the submission.

Two tables in one database that belongs to this repository. `human_usage` keyed on the **derived** identifier and a UTC day, holding the count of free reads served, with rows past the retention period deleted before each take. `receipts` holding settlements, with unique indexes on the authorization nonce and on the settlement transaction hash, and with the payer, the recipient, the amount, the network, the time, and a `source` column that says where the row came from. The receipts table is the one the anchoring milestone reuses, which is why it carries those columns before anything needs them.
