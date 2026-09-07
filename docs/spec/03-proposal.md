# 03. A window becomes a proposal

Written 2026-09-07, after the client existed, which is the wrong order and is said plainly rather than hidden. The two documents before this one were written first and the code followed. This one records a mapping that was derived by reading the receiving route, so it is a specification of what was built rather than a specification the build followed.

## The mapping

Ten fields go. The names match what the ingest route already calls them, so nothing is renamed on the way.

| window | proposal | note |
|---|---|---|
| `channelId`, `videoId`, `startTime`, `endTime`, `stationId`, `speciesCode`, `specimenAlias`, `confidence` | the same | unchanged, including a null alias, which is a real answer meaning the station has no sole occupant and the phenotype did not resolve one |
| `behaviorTag` (always null) | `"other"` | the route's enum is required and the detector has no behaviour classifier, so the honest tag is the one that claims nothing |
| `reason` | `behaviorNote` | required at three characters or more precisely because the tag is `other`, and capped at 280 on both sides |

Seven fields are dropped because the clip record does not model them: the schema version, the window id, the candidate roster, the detector version, the time it was produced, and the two truncation booleans. The window id is not sent and is not lost: it is the key the local refusal ledger uses, and the reason it can be that key is below.

Two fields are never sent, which is a different thing from being dropped. `source` is accepted by the route only so that it can be refused, and a machine claiming human provenance is refused rather than silently overwritten so that a caller which tried finds out that it tried. `submitterAddress` is derived from the credential and folded into the clip hash, so a machine able to name its own submitter could attribute its work to a person and forge clip identity at the same time.

Absence is asserted where the request lands rather than where it is built. A field can be added anywhere between the two, and the receiving schema strips unknown keys in silence, so a mistake there would never produce an error. The checks read the body the faked route actually received and compare its key set against the ten.

## The four answers, and what each one means

A **201** carries the row id, the clip hash, and a status of `pending` that came from the server rather than from the client. That is the whole of a successful proposal.

A **409 marked retryable** means the row already exists. It is not an error and it is not written to the ledger.

A **409 marked not retryable** means a person looked at that window and said no. The correct behaviour is to stop, not to back off. The flag is read as strictly true rather than as merely truthy, because an absent flag means the response is not one this client understands and the safe reading of an unknown answer is the one that stops.

A **422** means the target does not exist. A **403** naming station coverage is the trap worth writing down: the credential's station scope is compared byte for byte while the clip target check ignores case and spaces, so a credential issued for `AM3` against a window emitting `AM 3` is refused with a message about permissions when the problem is a space. The client attaches that explanation to the refusal rather than leaving the next reader to find it.

## Why the ledger keys on the window id alone

A rejection binds the window tuple: the channel, the video, the two times and the station, with no alias and no behaviour tag in the key. So proposing a different candidate over the same span is not a new clip, and an agent that walks its candidate roster after a refusal collects one refusal per candidate and learns nothing from any of them. One rejection closes the window for every candidate and every tag.

The window id is a hash of exactly that tuple, which is why it is the right key and why putting the alias or the tag into the key would be wrong: a roster refresh would then re-propose a moment a person had already declined.

The write happens before the call returns. A refusal held only in memory is indistinguishable from one that was never issued the moment the process stops, and the next run would ask again. Seen to fail by removing that write and watching three checks go red.

This is a local cache of a decision the server owns. Losing the file costs a wasted 409 and never a wrong proposal, because the server refuses again regardless. The file exists so that the agent stops asking, not so that the rule is enforced here.

## What is not built

The endpoint can come from a name record instead of a variable, and that seam exists and is unexercised: with no name configured it returns the configured url, and with a name configured that does not resolve it raises rather than falling back, because a typo resolving to nothing while the agent reads from somewhere else is the failure that matters. Nothing is registered. The name that had been assumed available turned out not to be.
