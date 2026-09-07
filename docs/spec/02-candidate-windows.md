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

**No window exceeds 120 seconds**, because a candidate window that cannot become a clip is not a candidate.

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

## What a caller may not infer

A window is a claim that something was worth a human's attention. It is not a claim that an animal was identified, that a behaviour occurred, or that the confidence corresponds to a probability of anything. The refusal is the product; a caller treating `candidates` as an identification is misreading it, and the endpoint should not be shaped to encourage that.
