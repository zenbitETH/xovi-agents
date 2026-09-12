# 05. A confirmation becomes an attestation

Written 2026-09-09, before the code, against the signing path in the reviewing application and against the deployed contracts rather than against their documentation. Every constant below was read from the chain or computed twice by two tools that do not share an implementation, and the document says which.

## What is anchored, and what is not

A clip is proposed by a machine and confirmed by a person, and it is the confirmation that is anchored. The proposal is already durable, already attributed to a credential, and already worth nothing on its own: a machine saying a moment is interesting is an opinion. What has evidential value is that a named reviewer put a key behind a decision, and that record already exists as an EIP-191 signature over a readable message. This milestone does not create trust, it makes an existing signature reachable by somebody who was never given the database.

The input is the reviewing application's public list of confirmed clips. It is unauthenticated, takes no parameters, returns whole rows, and is read here rather than pushed from there, so nothing in the reviewing application changes for this milestone. Rows are filtered to those a machine proposed. **That list is the fifty most recent confirmed clips, ordered newest first, with no filter and no pagination, and there is no route for a single clip by its identifier.** So a confirmed machine proposal falls out of reach once fifty newer confirmations exist, and the anchor would then not see it at all rather than failing to fetch it. Twenty three confirmed rows exist as this is written, so the bound is not reached during this work, and it is recorded here because a limit that is comfortable today is the kind that is discovered the hard way later. Lifting it is a change to the reviewing application and is not made for this milestone. There is no hook, no event and no queue on confirmation, which is why this is a pull.

## The frozen artefact

The schema is frozen as of 2026-09-09 and registered once. The exact string, byte for byte, with no space after any comma:

```
uint32 clipId,bytes32 clipHash,uint8 decision,address verifier,bytes verifierSignature,bytes32 verifierNonce,uint32 verifierChainId,uint64 verifiedAt,address submitter,uint16 confidence
```

One hundred and eighty five characters, ten fields. **Spacing is part of the artefact.** The identifier of a schema is `keccak256(abi.encodePacked(schema, resolver, revocable))` over exactly those bytes, so a single space added anywhere is a different schema, a different identifier and a second registration against a definition nobody reviewed.

| Property | Value | Why |
|---|---|---|
| resolver | `0x0000000000000000000000000000000000000000` | no resolver contract, so nothing can gate or reject an attestation after the fact |
| revocable | `true` | a contested confirmation must be withdrawable without rewriting history |
| recipient | `0x0000000000000000000000000000000000000000` | the record is about a decision, not about a person, and naming a recipient would make an addressee out of somebody who never asked to be one |
| expirationTime | `0` | a confirmation does not expire, and an expiring record would misdescribe what it holds |
| schema name | none | not a field of the artefact and deliberately not registered anywhere |
| schema description | none | same |
| identifier | `0x8d4a9a6e41e07cb67128eaca5a79f4d39e5199eb8c1c7d7a0096e0a5d11c8c6d` | computed twice, below |

The identifier was computed two ways that share no code, `cast keccak` over the packed bytes assembled by hand and viem's `encodePacked` and `keccak256`, and both returned the same value. It was then read back from the registry on Ethereum Sepolia, which returned a zero identifier, a zero resolver, `false` and an empty string, so as of this writing the schema is not registered and this document predicts its identifier rather than reporting one.

`clipId` is `uint32`, which holds four billion two hundred and ninety four million rows. That ceiling is stated rather than assumed because the field is a database serial and a wider field would have cost nothing; `uint32` is chosen because it is already far past any plausible lifetime of the collection and a narrower encoding keeps the record small.

`decision` is `uint8` and its meaning is frozen here, not left to a reader: **`1` is the string `verified` and `0` is the string `rejected`.** The mapping has to be frozen because the reviewer did not sign a number, and `1` stands for the literal word `verified` exactly as it appears in the template below. They signed a message containing a word, the row carries a `status` column and no `decision` column at all, and a reader holding `decision = 1` who does not know which word it stands for cannot rebuild the bytes that were signed. Only `1` is ever anchored, because a rejection is a decision the reviewing application keeps and this milestone publishes confirmations.

## The message the reviewer signed, published in full

The field string alone does not make an attestation checkable, because the reviewer did not sign the fields. They signed a text template, and a reader who does not have that template byte for byte cannot rebuild what was signed. Publishing it is therefore part of the frozen artefact, exactly as the comma spacing of the schema string is.

Nine lines joined with a single newline, encoded as UTF-8, with the second and fourth lines empty:

```
Xovi — confirmación de revisión

Al firmar, respondes por esta decisión con tu dirección.

Clip:      <clipId>
Hash:      <clipHash>
Decisión:  <decision>
Nonce:     <verifierNonce>
Chain:     <verifierChainId>
```

The padding was counted rather than eyeballed and every value begins at column twelve: `Clip:` and `Hash:` are followed by six spaces, `Decisión:` by two, `Nonce:` and `Chain:` by five. Two non-ASCII characters appear, an em dash in the heading and an accented vowel in four words. For a real confirmation the message is three hundred and eight bytes.

**This string is a protocol constant and not prose, and two of Zenbit's own writing rules would break it.** The house rule against the dash as punctuation, applied here, changes the heading and invalidates every signature ever produced against this template, including confirmations already recorded. The rule that this repository writes in English does not reach it either, for the same reason: these bytes are what a key was put behind. Anyone running a vocabulary or punctuation sweep over this file should skip the block above, and the block says so here so that the instruction travels with the string rather than living in somebody's memory.

**The verification criterion is address equality, and never that recovery succeeded.** Signature recovery over a wrong message does not raise: it returns a different, perfectly well formed address. Three wrong templates were tried against a real confirmation, removing one space from the padding, writing the em dash as a plain ASCII dash, and substituting the integer for the word, and all three recovered a valid address that simply was not the reviewer. So a checker that wraps recovery in a try and treats the absence of an exception as proof will accept every one of them. The check is that the recovered address equals the attested `verifier`, and nothing weaker is a check at all.


## Two records, and why both

**The offchain attestation is the record.** It is signed by the attestation key over EIP-712 typed data and never sent to a chain. It carries the whole of the ten fields, it costs nothing, and it is what the payload endpoint serves.

**The onchain leg exists so the record can be found.** An offchain attestation emits no event, so nothing indexes it. Two things are therefore written to Ethereum Sepolia: an `attest()` of the same schema, whose `Attested` event carries the schema identifier as its fourth topic and is therefore filterable natively by an indexer, and a `timestamp()` of the offchain identifier, which fixes a time for the offchain record in a way anybody can check with one call.

**The two legs do not share an identifier, and a reader will assume they do.** An offchain attestation is identified by a hash of its own signed contents. An onchain one is identified by the contract, from the attester, the schema and a counter. So one confirmation produces two identifiers, measured rather than reasoned about, and nothing in either log relates them. They are not two halves of one record: they are a primary and a secondary way to find the same confirmation, which is why dropping one still leaves the other whole. Anywhere this document says an identifier without saying which, read it as the offchain one, because that is the one the payload endpoint is keyed by; the onchain one is named explicitly every time it appears. When a registration is reported, both are reported, labelled, with one line saying why a confirmation has two.

If the schedule runs out, the onchain `attest()` is the leg to drop, and the query is then served by filtering timestamp events on the sender. That is a worse answer and the specification says so rather than presenting the fallback as equivalent: filtering on a sender trusts an address, filtering on an indexed schema trusts the contract.

## The offchain encoding, which is not what a reader expects

Three things about this encoding are surprising, and each one produces an identifier that nobody can verify while looking entirely correct.

**The signing domain is not the contract's own domain.** The deployed contract reports a domain built from the name `EAS`, verified here by rebuilding its `getDomainSeparator()` from candidate names and matching only on that one. Offchain attestations use a different domain, named `EAS Attestation`, with the same version, chain and address. The two are not interchangeable and confusing them yields a signature that verifies against nothing.

**The domain version is read from the chain, never written down.** Ethereum Sepolia reports `0.26`. It is not the current release, the value differs per chain, and it is an input to the domain separator, so a version taken from a package README rather than from `VERSION()` produces an unverifiable record. The implementation calls the contract and refuses to sign if the answer is not a version the encoding knows.

**The schema identifier is hashed as text, not as bytes.** In the offchain identifier the schema is encoded as the UTF-8 characters of its hexadecimal string, so the sixty six characters `0x8d4a…` are hashed as sixty six bytes rather than as thirty two. Letter case is therefore significant, and the implementation lowercases before hashing. This is inherited behaviour rather than a choice, and it is written down because it is the single most likely thing for a reimplementation to get wrong.

The identifier is `keccak256` over the packed encoding of the version as `uint16`, the schema text as `bytes`, the recipient, a zero address in the position an attester would occupy, the time and expiration as `uint64`, revocability as `bool`, the reference as `bytes32`, the encoded data as `bytes`, the salt as `bytes32`, and a trailing `uint32` zero. The salt is thirty two random bytes and it is what makes two attestations of identical content distinct.

## The instrument, and why this repository carries a second implementation it does not ship

Every check written here before this section was this repository's code agreeing with this repository's code, and that cannot be evidence about an encoding somebody else defined. The failure it misses is specific and it is the expensive one: an object signed under the wrong domain still re-derives its own identifier, so the invariant that says the record re-derives passes, the suite is green, and an explorer rejects the record on the one screen a reader will actually use.

So the attestation library is a development dependency, pinned, used by one check that asks it to accept an object this repository produced and to compute its identifier independently. It is never in the shipped path: the runtime is viem and no attestation library at all, which is the whole reason a second chain library's weight never reaches a deployment. The negative control signs under the contract's own domain name and asserts both halves at once, that this repository's own re-derivation still passes and that the library rejects it. That pair is the argument for having an oracle, written as a check rather than as a paragraph.

An oracle that can change underneath a green check is not an oracle, which is why the version is exact rather than a range.

## The trust boundary, which the record must not invite a reader to cross

An attestation here holds two kinds of statement and they are not equally strong. Reading them as one is the misuse this section exists to prevent.

**Seven fields any reader can check without trusting Zenbit.** `clipId`, `clipHash`, `decision`, `verifier`, `verifierSignature`, `verifierNonce` and `verifierChainId` are exactly the material needed to rebuild the message the reviewer signed and recover the address that signed it. A reader who does that has verified the confirmation against the reviewer's key and has needed nothing from the operator but the bytes.

**A checkable field is carried, never derived.** Every one of those seven is copied from the row and none is reconstructed from context, and `verifierChainId` is the field that makes the rule concrete. The reviewer signs the chain they signed on, and the chain this milestone anchors to is a separate choice. They happen to be the same chain today, which is precisely what would hide the mistake: code that derives the attested chain from the anchor chain, or writes it in as a constant, is right on every confirmation that currently exists and becomes wrong the first time a reviewer signs somewhere else. The failure would not be an error, it would be a signature that no longer recovers, which is the same silent shape as omitting the clip identifier. Deriving a value that is meant to be checked produces a plausible answer where an error would have been useful, so anything inside the signed message is carried across verbatim.

**Three fields are the operator's own assertion and no reviewer countersigned them.** `verifiedAt`, `submitter` and `confidence` are copied out of the row. They are not inside the signed message, so a reader takes them on the operator's word or not at all. Zenbit is the operator and asserts them; that is the correct verb and the record makes no stronger claim.

The consequence for anyone quoting this material is direct. An attestation asserts that a reviewer signed a decision about a clip. It does not prove the clip depicts what a note says it depicts, it does not prove the operator copied the surrounding fields faithfully, and it does not make the machine's opinion true. Everything it establishes rests on one reviewer's key.

## Idempotency, and the key it is really on

Anchoring is a job that will be rerun, after an error, after a redeploy, and in front of an audience. Rerunning must be free of consequence.

The onchain timestamp is guarded by asking the contract for the existing time first and treating a nonzero answer as success. Without that guard a second call reverts, because the contract refuses a repeat outright, and a batch call fails in whole on a single already-anchored element. A rehearsal followed by a live run is therefore the exact shape that breaks, which is why the guard is at the call site and why the batch form is not used at all.

The durable guard is a row, written before the first transaction and completed after **each** leg rather than after both, with the attestation transaction as the completion marker because it is written last. Existence therefore means started and never means finished, and that distinction is not a nicety: an earlier version completed the row only once both legs had returned, so a failure in the second left a row with no transaction that every rerun read as already anchored, stranding the clip permanently. The timestamp leg is idempotent at the contract, so resuming redoes it for free; the attestation is not, and it is the one a resume must not repeat. **That row is unique on the clip identifier, not on the clip hash, and the difference is load bearing.** The reviewing application's uniqueness on the hash is deliberately partial, excluding rejected rows, so that a person whose clip was declined can correct it and submit the same moment again. One hash can therefore belong to a rejected row and to a later confirmed one, with different identifiers, different nonces and different signatures, and so with two legitimately different attestations. Keying the guard on the hash would refuse the second and report it as already anchored, which is a wrong answer wearing the shape of a right one. A second uniqueness holds on the attestation identifier, so a record cannot be written twice under two clip identifiers either.

**Not yet exercised by a check, and saying so is the point of writing it here.** The keying is argued from the reviewing application's index definition, which was read rather than assumed, and from the migration that replaced a total uniqueness with the partial one. Nothing in the suite drives a rejected clip through a resubmission and a second confirmation, because that needs a database and two decisions by a person. The check belongs with the storage work and is owed.

## Reaching the record from a query, which is the demonstration

A reader meets this system through a query, and a query answers with the onchain identifier. If that identifier led nowhere, the index and the verification would be two demonstrations that never meet, and the only thing joining them would be a row in Zenbit's own database, where nobody outside can look. So the reachability is stated as a requirement rather than left to follow from the parts: **from a query result alone, a stranger must be able to reach the record and recover the reviewer.**

It is met on the chain, without Zenbit. Holding only the identifier a query returned and a public endpoint for the chain, a reader calls the contract for that attestation, receives the schema it was made under and the encoded data, decodes the ten frozen fields, rebuilds the message from the published template and recovers the reviewer's address. Nothing in that path touches anything of Zenbit's, which is the property worth having: the operator can be uncooperative, or gone, and the confirmation is still checkable by anyone who kept the identifier.

The payload endpoint is a convenience on top of that and never a dependency. It resolves either identifier, so a reader arriving from a query is answered as readily as one arriving from the object, and what it adds is the salt and the operator's own signature, which the chain does not carry. A reader who only wants to check the reviewer does not need it at all.

## The payload endpoint

`GET /api/observations/[uid]` returns the persisted signed object and nothing else: the ten fields, the salt, the signature, the domain it was signed under, and the identifier. It is unauthenticated, and that is a property to be maintained rather than a default that happened. A record whose verification depends on asking the operator for permission is not a public record, and an endpoint that quietly grows a gate is the way that property is lost. A check fails when one appears.

Nothing else is served from it. No row, no note, no station, no alias, no neighbouring clip, and no list. A reader who wants more has the public list of the reviewing application, which is a different surface with its own rules.

## What is deliberately not attested

No alias, no species and no station enters an attested field. They are in the reviewing application's own public list and they are not put on a chain, because a chain is not deletable and the material describes living animals in a collection.

`confidence` is a `uint16` produced by the model that proposed the clip. **It is opaque.** This document fixes no derivation for it, publishes no cutoff and no banding, and gives no rule connecting a value to a conclusion. It is carried so that a record is not silently missing a field the row had, and a reader who wants to know what it means is told here that the answer is not public.

No behaviour note, no metric and no participant list is attested. They are annotation, they are not identity, and the clip hash does not cover them either.

## The query, and why a proposed clip cannot appear in it

Only confirmed clips are ever anchored, so a clip that a machine proposed and no person confirmed has no attestation, no timestamp and no indexed event, and is absent from every query by construction rather than by a filter somebody remembered to write. That is the property worth demonstrating, and it is demonstrated by trying to anchor a pending row and watching the attempt refuse.

## The cap does not apply to the query

**The MCP query is always paid and the cap does not apply to it.** The free daily allowance exists to make one person's budget real on the window read, where the thing being limited is how much a single human can take without paying. Extending it here would make the receipt optional, and the receipt is the entire artefact this leg exists to produce: a query that answered for free would demonstrate nothing a reader could check on an explorer.

Settling without recording is a defect and was one, fixed by writing the receipt from the settlement hook under its own source so that two rails settling to one recipient leave rows that can be told apart. A free tier here is not the fix for that and would have hidden it.

## Invariants

### A24. Anchoring twice sends one transaction

- **Mechanism:** the call site asks the contract for the existing timestamp of the identifier and returns success without sending anything when the answer is nonzero. The batch form is not used anywhere.
- **What defeats it:** using the batch form, which fails in whole on one already-anchored element, so a rehearsal poisons the live run. Also defeated by treating the guard as advisory and sending anyway, since the contract reverts rather than ignoring the repeat.
- **Test, seen to fail:** anchor the same identifier twice against a fork of the live chain and observe one transaction and one success. Removing the guard turns the second call into a revert carrying the contract's own already-anchored error.

### A25. The attestation identifier re-derives from what was persisted

- **Mechanism:** the whole signed object is stored verbatim, including the salt and the domain, and the identifier is recomputed from the stored object rather than trusted.
- **What defeats it:** dropping the salt, which is random per attestation and irrecoverable, so the record becomes an identifier nobody can reproduce. Also defeated by storing a checksummed schema identifier where the encoding hashes text, and by writing the domain version into the code instead of reading it from the chain.
- **Test, seen to fail:** re-derive from the stored object and compare. Removing the salt from storage, and separately uppercasing the schema text, each produce a different identifier and turn the check red.

### A26. The signature in the record verifies against the reviewer's address

- **Mechanism:** the message is rebuilt from the published template using the attested clip identifier, hash, decision word, nonce and chain, the address is recovered, and it is **compared for equality with the attested verifier**. Equality is the criterion. Recovery not raising is not the criterion and cannot be, because recovery over a wrong message returns a different valid address rather than an error.
- **What defeats it:** omitting the clip identifier, which the reviewer signs as the first value of the message, so the bytes cannot be rebuilt and the signature becomes sixty five bytes nobody can check while the record still looks complete. Also defeated by not publishing the template at all, by normalising the em dash or the accents under a writing rule, by deriving the attested chain from the chain the anchor is written to, which is correct on every row that exists today, and by wrapping recovery in a try and reading the absence of an exception as success.
- **Test, seen to fail:** recover from a real confirmation using the attested fields alone and require the recovered address to equal the attested verifier. Three negative controls each recover a different valid address and none of them raises: removing one space from the padding, writing the em dash as a plain ASCII dash, and substituting the integer for the decision word. The first is the one to keep in front of a reviewer, because a single space is the smallest edit anybody would make without thinking.

### A27. The payload endpoint is open, and stays open

- **Mechanism:** a check requests a known identifier with no credential of any kind and requires a success, and a second asserts the handler references no session, cookie or authorization header.
- **What defeats it:** adding a gate for an unrelated reason, which is how a public record quietly stops being one.
- **Test, seen to fail:** the check goes red when a gate is added to the route.

### A28. Nothing outside the ten fields leaves the payload endpoint

- **Mechanism:** the response is built from the stored signed object alone and its key set is asserted against the frozen list.
- **What defeats it:** serving the database row, which carries the alias, the station and the species, none of which belong on this surface.
- **Test, seen to fail:** compare the served key set to the frozen list. Returning the row instead turns it red.

### A29. A clip no person confirmed is absent from every query

- **Mechanism:** the job reads only confirmed rows and refuses any other status before signing, so an unconfirmed clip never acquires a record to find.
- **What defeats it:** relaxing the status check, or anchoring from a local fixture that was never confirmed.
- **Test, seen to fail:** offer a pending row to the job and require a refusal, then query for it and require nothing back. Removing the status check produces an attestation for a clip nobody reviewed, which is the failure this whole milestone would otherwise quietly permit.

### A31. A query result is enough to reach the record and recover the reviewer

- **Mechanism:** the identifier an index returns is the one the contract assigned, and the contract serves the attestation under it, including the encoded ten fields. The reviewer is recovered from those fields and the published template. Separately, the payload endpoint resolves either identifier, so the same reader can also obtain the salt and the operator's signature.
- **What defeats it:** keying the payload endpoint on the offchain identifier alone, which answers nothing to a reader arriving from a query, and leaves the two identifiers joined only inside Zenbit's database. Also defeated by attesting a digest rather than the fields, which would make the chain a pointer to the operator instead of a record.
- **Test, seen to fail:** from the identifier a query returns, and a public endpoint for the chain, read the attestation, decode it, recover the reviewer and require the address to equal the attested verifier. Removing the fields from the attested data, or pointing the reader at the offchain identifier the contract has never heard of, each break it at the first call.

### A30. The schema is registered once, on one chain, deliberately

- **Mechanism:** the registration script refuses any chain but Ethereum Sepolia unless an explicit flag is passed, prints the string, the resolver, the revocability and the predicted identifier, and does nothing at all unless told to execute. It reads the registry first and exits successfully when the schema is already there.
- **What defeats it:** a script that registers on whatever chain the environment happens to point at, which is how a definition ends up on a chain nobody chose. Also defeated by claiming idempotency without reading the registry first.
- **Test, seen to fail:** run against a fork with the chain guard removed and observe a registration on the wrong chain, then run twice with the guard in place and observe one registration and one clean exit.

### A32. The index reads the events the chain actually emits

- **Mechanism:** the interface definition the manifest ships was not taken from a package's default branch. Both event topics were recomputed from their signatures, and the primary one was then matched against a log the deployed contract emitted on a fork of the live chain. The manifest filters on the schema identifier in the fourth topic, and the built output was read to confirm the filter survived compilation rather than being assumed to.
- **What defeats it:** an interface that disagrees with the chain. **The original form of this invariant said that swapping in a default branch definition stops the handler firing with no error anywhere, and that is wrong**, which was found by doing it: the build fails, because the event signature in the manifest and the interface have to agree with each other. As written the invariant could never have been satisfied, so it is restated here rather than left as a check nobody could run.
- **What genuinely cannot be caught by a build:** an interface and a signature that agree with each other and both disagree with the chain. Nothing local can see that, because everything local is consistent. The only thing that discriminates is the recomputed topic checked against a real emitted log, which is why that step is the defence and not a formality.
- **Test, seen to fail:** swap the indexing to the shape a default branch definition has and rebuild. The build fails rather than passing quietly, which is a better outcome than the one first recorded and a worse test, because it proves the smaller half.

## What is not built

No fee contract. Payments settle to an address held by a person, and a contract that collects them is a later question with its own review.

No revocation path. The schema is revocable, which preserves the ability, and no code exercises it; a contested confirmation today is handled by the reviewing application, which owns the decision.

No mainnet write. The schema is registered on Ethereum Sepolia, payments settle on Base Sepolia, and the identity read that the paid endpoint performs happens on a third chain that is not a testnet. That last one is stated wherever it is relevant rather than left for a reviewer to discover by counting.
