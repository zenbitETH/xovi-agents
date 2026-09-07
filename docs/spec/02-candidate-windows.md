# 02. Candidate windows

Written 2026-09-07, before the endpoint. The shape below came from the detector side rather than from this repository, because the producer knows what it can honestly emit and the consumer does not. Field names match what the ingest route already calls them, so the agent renames nothing.

## The shape

```json
{
  "schema": "xovi/candidate-window/v1",
  "windowId": "<sha256 of channelId|videoId|startMs|endMs|stationId, first 16 hex>",
  "channelId": "UC…",
  "videoId": "…",
  "startTime": 11057.432,
  "endTime": 11064.262,
  "stationId": "AM 1",
  "speciesCode": "mexicanum",
  "specimenAlias": null,
  "candidates": ["…"],
  "behaviorTag": null,
  "truncatedByCap": false,
  "continuesPrevious": false,
  "confidence": 620,
  "reason": "sustained motion 3.4 s with floor occlusion; station by 8-frame vote (8/8); phenotype no signal, 5 candidates",
  "detector": "…@0.1.0",
  "producedAt": "2026-09-07T04:11:00Z"
}
```

Every departure from a naive shape exists for a reason that costs something if ignored.

**Times are seconds quantised to whole milliseconds, at the source.** `computeClipHash` takes `Math.round(t * 1000)`, so if the producer and the consumer round differently the same moment acquires two identities. Round once, where the number is made.

**`confidence` is an integer per mille, not a float.** The column is per mille under a CHECK constraint, so a float in the window means somebody rounds later, and two agents round `.5` differently.

**`reason` is capped at 280 characters.** It is not only the thing being sold. It is also the field that becomes `behaviorNote`, which the ingest route caps at 280 and requires at three or more whenever the tag is `other`. Capping at the source makes it usable verbatim.

**`behaviorTag` is nullable, and usually null.** The detector has no behaviour classifier, so the agent sends `other` plus the reason as the note, which is the path the route was written to permit. Where a tag can be justified the detector emits one, and note that doing so changes the clip hash.

**`specimenAlias` and `candidates` are both nullable.** The detector declines to identify roughly seventy per cent of the time, and a window with an unresolved specimen is still worth a human's attention. `candidates` is what makes that refusal legible rather than an error.

**No window exceeds 100 seconds.** The ingest route refuses anything over 120, so 120 is the wall, but 100 is the point at which a span may cross a camera rotation and mix two views of the same tank. On the human capture path a clip past 100 seconds is not refused, it is flagged, and a reviewer sees the warning while analytics can down weight the result. That flag is unavailable here: the ingest route writes `behaviorMetric` as null on the machine path, so an agent cannot carry it and a caution that the human path expresses as a flag has to be expressed as a cap. The detector emits at 100 for that reason.

**Times are exact multiples of one millisecond.** The ingest route quantises to whole milliseconds and the clip hash is computed from that quantised value, so a window carrying finer precision is silently moved before it is stored. Emitting times that are already exact removes the question of whose rounding wins, which matters because the producer rounds in Python and the consumer rounds in JavaScript and those two disagree on a half unless both are made to round half up.

**`stationId` is matched literally by the credential.** Two different comparisons run against this field. The clip target check ignores case and spaces; the credential's station scope does not. A window reading `AM 1` presented against a credential scoped to `AM1` is refused with a message about station coverage, which reads like a permissions problem and is a whitespace problem. The producer emits the canonical form with the space and the credential is issued with the identical string.

## What one rejection closes

A window can carry several candidates and the agent proposes one of them. The clip hash includes the specimen alias and the behaviour tag, so proposing a different candidate over the same span produces a different hash and looks like a new clip. It is not treated as one. When a person rejects a proposal the refusal binds to the window itself, meaning the channel, the video, the start and end times and the station, with no alias and no tag in the key.

The consequence is a rule for the agent and it is easy to get backwards. **A refusal on one candidate closes the window for every candidate and every tag.** The response says so by marking itself not retryable, and an agent that walks its `candidates` array after a refusal collects one refusal per candidate and learns nothing from any of them. A person looked at that span and said no, and the correct behaviour is to stop.

## A window can be a maintenance event

The detector finds where something moved, and some of what moves is an operator's hand and the cloud of sediment it stirs. The phenotype signal does not separate the two: a maintenance window reads the same colour as the animal does. This is measured rather than suspected and it is recorded here as a known limit rather than left to be discovered.

Two things follow. **A served window may contain a person.** It discloses nothing new, because a window is a time range in a livestream that is already public and anyone may watch it, but the possibility is stated here rather than implied. And the endpoint's description must not say the detector finds behaviour. It finds motion worth a human's attention, and everything past that is the reviewer's judgement.

A maintenance window that reaches the review queue is rejected by a person like any other, which closes that span permanently under the rule above. That is the intended outcome and not a defect.

## Embargo: the endpoint drops the window, it does not redact the field

Some specimens are under embargo and must not be named outside the organisation. The producer maintains that list and gates on it. **This endpoint gates independently, because a defence that exists only in the producer is one refactor from gone**, and this is the last point before data leaves the building.

Three decisions, and the second is the one that matters.

**The list never lives in this repository.** It is specimen data, it belongs to the private side, and committing it here would publish exactly what it protects. The endpoint reads it at runtime.

**An embargoed window is dropped whole, not filtered.** Redacting `specimenAlias` and pruning `candidates` is insufficient: an omission is itself a signal to anyone who knows the roster, and free prose is precisely how an embargo has leaked before. If a window's station or candidate set touches the embargo, the window is not served at all.

**Serving nothing is a correct answer.** A paying caller receiving fewer windows learns only that fewer were available, which is true of any detector on any day.

## The evaluation bank is a write target, so snapshot it

The detector's evaluation output lives in a directory the detector's own harness rewrites: the evaluator overwrites its result file unconditionally and the frame harvester rewrites its manifest. Growing that bank is a planned and cheap improvement, so it will happen.

**The endpoint must not read that file at request time.** Copy it into this repository's own fixture directory and read the copy, or a routine upgrade on the producer side silently changes what the paid endpoint serves, and the first sign would be a caller noticing before either side did.

The same applies to any figure quoted in public documentation here: pin it to the date and the bank size it was measured on, so a later recount reads as a new measurement rather than a contradiction.

**The same cut is fully deterministic, and that is what makes a snapshot worth taking.** Re-running the detector over an identical span on a different machine reproduces the windows byte for byte, `windowId` included, verified on 2026-09-07 by regenerating a four window sample from a clean checkout. Instability lives at the boundaries of the cut, not inside it. The distinction matters because a snapshot of a producer that was nondeterministic within one cut would not be a record of anything; it would be one arbitrary result frozen and then sold repeatedly.

**A window cut short by the cap says so, in a field and in the prose.** The cap is 100 seconds, so an event that ran longer arrives as two windows. Left unmarked, the first reports a duration that measures the cap rather than the animal, and the second reads as an independent event when it is a tail. `truncatedByCap` and `continuesPrevious` carry both facts, and `reason` states them again in words, ahead of the measurement detail so that anything lost to the 280 character limit is detail rather than warning.

**Both, rather than either.** The sentence is what a reviewer needs at the moment they are looking, and they read it in their own language. The booleans exist because a caller that aggregates cannot depend on recognising a phrase without coupling to its exact wording, and that coupling breaks the first time somebody rewrites the sentence. A fact that lives only in prose is one rewrite from gone, which is the same reason the embargo gate is not a matter of wording either. `truncatedByCap` follows the name the clip schema already uses for this idea on the human path.

**The split is forced, not a defect, and a reader will assume otherwise.** Two halves of one event cannot be merged back into a single clip, because their combined span exceeds the 120 second refusal the ingest route applies. Proposing them separately is the only representation available. Anyone reading the pair as a detector fault and setting out to join them will be writing code against a wall.

**What the booleans buy beyond not overcounting.** They are what lets a review queue group the two halves and offer the tail when a person rejects the head. At the data layer the two remain separate windows and a refusal on the first does not close the second, which is correct: rejecting the head of an event is not a judgement about its tail. But the interface can turn the second refusal into one click rather than a second discovery, and prose cannot do that.

**The window set is not stable across differently cut runs.** The detection threshold is a percentile of each segment's own series rather than a global constant, so the same footage divided at different boundaries can yield a different set of windows. Each window's identifier is stable for that window; the collection is not. The endpoint therefore serves a stored snapshot rather than recomputing per request, because a caller who pays twice is entitled to a coherent answer.

Rate, recorded as a calibration and not as an operating figure: 20 to 26 windows per hour of footage, measured on 2026-09-07 across two calibrated spans. Two spans is not a curve. The number is here so the endpoint can be shaped around the right order of magnitude, and it should be restated the moment a third span exists.

## What a caller may not infer

A window is a claim that something was worth a human's attention. It is not a claim that an animal was identified, that a behaviour occurred, or that the confidence corresponds to a probability of anything. The refusal is the product; a caller treating `candidates` as an identification is misreading it, and the endpoint should not be shaped to encourage that.
