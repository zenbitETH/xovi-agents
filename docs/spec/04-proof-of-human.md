# 04. One human, one cap

Written 2026-09-07, before the code, against the registry read rather than against the documentation.

## What a cap on an address is worth

Nothing. A limit tied to an address is defeated by generating addresses, and generating addresses is free. Moving the limit onto something that cannot be minted is the whole of this feature, and everything below follows from where that identifier comes from.

## The shape, and why the degraded path needs no code

A verified human's agents get a number of free reads per day. Past that number, and for anyone the registry does not know, every read settles exactly as it does today. So the cap is an allowance laid on top of a rail that already works, and the fallback is not a branch somebody has to remember to write: it is the behaviour that existed before this document. The route's existing no-payment-required arm is where a free read belongs, because that arm already means served without settlement.

The knobs are `HUMAN_FREE_READS_PER_DAY`, default 20, counted per UTC day, and the registry's address and rpc in `AGENTBOOK_ADDRESS` and `AGENTBOOK_RPC_URL`. The demo sets the free count to 3, so exhausting one agent's share and watching the second settle takes about a minute on camera.

## The order in the route, and no other

Verify the payment first, exactly as today. That is what authenticates the payer: the client signs a payment regardless, and the settled receipt names the address, so the identity this cap keys on arrives already proven rather than claimed.

Then read the registry for that payer, inside a try, with a timeout of about two seconds. A hanging rpc has to degrade inside the request rather than stall a read somebody is paying for.

A nonzero identifier with allowance left means serve and count the usage, and do not settle: the payment authorization simply expires unused. A zero identifier, a throw, a timeout, or an allowance already spent all mean settle as today and write the receipt.

Usage is written only when a read was served free. A receipt is written only when a settlement succeeded. Nothing writes both.

## What the registry actually says

Measured on 2026-09-07 against the deployment on Base Sepolia, not read from a summary. `lookupHuman(address)` returns `0` for an address that has never registered, and does not revert. A deliberately wrong selector on the same contract does revert, which is what makes those zeros evidence rather than an artefact of a contract that answers everything with zero.

The registration function puts the agent address and a nonce into the World ID *signal* and uses a contract wide constant as the external nullifier. A World ID nullifier is deterministic on the identity and the external nullifier, so one person produces the same value whichever agent they register, and the agent address changes the signal instead. There is no set of used nullifiers in the contract and nothing rejects a repeat. One human to many agents is therefore the construction rather than a hope, which is what makes a shared budget testable at all.

## Invariants

### P1. The cap keys on the registry's identifier, and no client field can claim one

- **Mechanism:** the identifier is read from the registry using the payer address out of the verified payment. Nothing in the request body reaches it. Counters and receipts store the identifier, never the address.
- **What defeats it:** keying the usage row on the payer address instead. Two agents of one person would then hold two budgets, which is the failure this feature exists to prevent, and it would look like it worked.
- **Test, seen to fail:** exhaust the allowance from one payer address and read from a second address the fake registry maps to the same identifier. The second read must settle. Keying on the address turns it green in the wrong direction, and the check goes red when the keying is changed back.

### P2. A settlement is counted once

- **Mechanism:** the receipt insert and the usage update are one statement, a common table expression that inserts the receipt with on conflict do nothing and updates the count only when the insert returned a row. Two unique indexes carry it: the authorization nonce and the settlement transaction hash.
- **What defeats it:** doing the two writes as separate statements over an http driver that offers no interactive transaction, where a crash between them counts a payment nobody received or receives one nobody counted.
- **Test, seen to fail:** replay the same settlement twice and observe one row and one increment. Splitting the statement makes it two.

### P3. A lookup that fails degrades to pay per request

- **Mechanism:** the read is wrapped and given a timeout, and every failure path falls into the settlement arm that predates this feature.
- **What defeats it:** treating an error as an allowance, which fails open to unlimited free reads, or treating it as a refusal, which fails closed and takes the paid endpoint down when an rpc has a bad afternoon. Both are worse than paying.
- **Test, seen to fail:** a fake registry that throws, and one that returns the unregistered value, both settle. A fake that hangs settles too, and takes about two seconds rather than the request's lifetime.

### P4. The registry is last writer wins, and the cap inherits that

- **Mechanism:** none, and that is the point of writing it down. `lookupHuman[agent] = nullifierHash` is an unconditional overwrite, so anyone able to produce a valid proof for the signal made of an agent address and its next nonce can rebind an agent that is not theirs. The nonce prevents replay, not rebinding.
- **What it does not defeat:** the cap. A person has one identifier, and registering more agents only divides the same allowance, which is what sybil resistance means here.
- **What it does enable:** griefing. Rebinding somebody's agent onto an exhausted identifier stops their reads being free.
- **Why that is survivable, and this is a property of the shape rather than a mitigation:** the fallback is pay per request, so a hostile rebinding costs the victim the ordinary price of a read and never their access. Nothing defends against this and nothing needs to.
- Noticed while reading and recorded so the next reader does not have to: the mapping is written before the proof is verified. A revert unwinds it, so it is harmless, and it is the ordering a reviewer will stop on.

## Privacy

The identifier is a World ID nullifier. It is anonymous in the sense that it names no person, and it is a stable link across every registration one human makes under this action, which is exactly what makes it useful here and exactly why it does not belong in public text. No real identifier goes into this repository, a pull request body, a comment, or this file. Fixtures use invented values. Logs print it truncated. The founder's is the founder's.

## Storage

Two tables in one database that belongs to this repository. `human_usage` keyed on the identifier and a window, holding the count of free reads served. `receipts` holding settlements, with unique indexes on the authorization nonce and on the settlement transaction hash, and with the payer, the recipient, the amount, the network, the time, and a `source` column that says where the row came from. The receipts table is the one the anchoring milestone reuses, which is why it carries those columns before anything needs them.
