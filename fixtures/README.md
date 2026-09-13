# Fixtures

`windows.synthetic.jsonl` is invented data. It exists so the test suite can exercise the endpoint without a real span, and it is not footage: the video and channel ids are not real ids and no frame behind it exists.

A real snapshot is deliberately absent. The detector's output is copied here by hand once the frames behind a span have been looked at, because nothing in a window record says whether a person is in the frame. The span used to develop the window shape is a calibration span and contains an operator's hand in two of its windows, which is exactly why it is not committed here.

Point the endpoint at a snapshot with `WINDOWS_SNAPSHOT`. Unset, the route answers 503 rather than an empty list, because an empty list is a real answer meaning the detector found nothing and a missing path is a misconfiguration.

## `windows.v9pFMid2BOs.jsonl`, a clip neighbourhood, screened rather than clocked

Two windows produced by the detector over public footage of the mexicanum tank AM 3, video `v9pFMid2BOs`, from 03:27:55 to 03:30:45, inside one camera dwell. The span was chosen and then watched frame by frame by Zenbit before it became a fixture: no hands and no people in frame, one animal visible, the station badge reading AM 3 throughout. Both windows withhold the alias at confidence 500 because the tank has two occupants and the detector declines to identify, which is the refusal this endpoint exists to serve rather than an obstacle to it. The `reason` field is the detector's verbatim output and it is opaque by design: it says where to look, how many occupants the tank has and what the detector did, and nothing about how it decided. The earlier candidate span was rejected for containing an operator's hand, and the reason it was a good calibration span is the reason it is a bad fixture.

## `confirmation.259.json`, a real confirmation

The eleven public fields of one confirmed clip, copied verbatim from the reviewing application's unauthenticated list on 2026-09-09. It is the input the anchoring milestone attests, and it is a fixture rather than a live fetch so that the checks run in a runner with no network.

Nothing here is private. Every field is already served to anyone who asks that endpoint, and the two addresses are a reviewer acting in that role and the agent that proposed the clip, both of which appear on the chain already. What makes it worth committing is the signature: it is the only real one available, and the checks that matter are the ones that reproduce it and the ones that fail to. A synthetic signature would verify against a synthetic template and would prove that the code agrees with itself.

## The window files, and why every span sits before the museum opens

Each `windows.<videoId>.jsonl` is the detector's output over one span of one public
recording, screened by hand before it was committed. Beside each one is a
`<file>.day` sidecar holding the date the footage belongs to, because the detector
stamps `producedAt` with its own clock and a re-run months later would otherwise move
every window to a new day.

**Two kinds of file, and they are clean for different reasons.** A reader should know
which, because the guarantee is not the same and neither is what it would take to
break it.

The **pre-opening files** rest on the clock. Their spans sit in the hour before the
doors open, so a visitor cannot be in shot, and the human screen confirms rather than
searches. These are `windows.gJ5yOOCUj2Y.jsonl`, `windows.lcb0uLuIje8.jsonl`,
`windows.YRyCru3h9xY.jsonl` and `windows.1ldBS1CP2Cs.jsonl`.

The **clip-neighbourhood files** rest on the screen alone. Their spans sit three
minutes either side of a clip a reviewer already confirmed, which is where the animal
was demonstrably active, and every one of those clips was captured during opening
hours by a person watching. So a visitor or an operator is likely rather than
impossible in that footage, every window carries the full read, and anything
ambiguous was dropped rather than kept. The clip's own span is excluded from each:
that moment is a clip already, not a candidate, and one window of this kind was
dropped for overlapping it, so its recording produced two and ships one.

Two committed files are of this kind, `windows.v9pFMid2BOs.jsonl` and
`windows.lTuMxO5KEHU.jsonl`. Only committed files are named here: a README that
lists what is not in the tree is a reader's dead end rather than an index.

Two recordings were held out, and the reasons are worth keeping. The 24 July
recording is off the board because every frame carries a media player's control bar
and its playback position reads 15:40:59 against a recording of 11.9 hours, so the
footage may be a replay and the day cannot be explained; the validator refuses a
file from it rather than letting one pass quietly. The 23 July recording is clean
footage held out for a different reason: the station gate destroyed one of its spans,
six windows of six, on footage where the camera never left the tank and a quarter of
the frames do not read. That one is recoverable rather than bad, and the fix is
measured and waits, because every file here was made by one rule and changing the
rule tonight would mean the files were not.

What follows is about the first kind.

The spans are not sampled across the day. Every one of them sits in the hour before
the museum opens, and that is the whole method rather than a convenience. The museum
opens at 10:00 Monday to Friday and 11:00 at weekends; these recordings start at
08:55. So a span taken in the first hour cannot contain a visitor, and "no person in
shot" becomes a property of the clock instead of something a reader has to hunt for
in a sheet of frames. The screen still happens, and it still gates the commit, but it
is a confirmation rather than a search.

Measured from each recording's published start time:

| recording | day | runs | opens | clear span |
|---|---|---|---|---|
| `YRyCru3h9xY` | Wed 09 | 08:55 to 20:50 | 10:00 | 64 min |
| `1ldBS1CP2Cs` | Wed 09 | 08:55 to 20:50 | 10:00 | 64 min |
| `lcb0uLuIje8` | Tue 08 | 08:59 to 20:54 | 10:00 | 60 min |
| `T64sGf8rj1A` | Tue 08 | 08:55 to 20:50 | 10:00 | 64 min |
| `AGibGHIeqQU` | Mon 07 | 08:55 to 16:27 | 10:00 | 64 min |
| `gJ5yOOCUj2Y` | Fri 04 | 08:55 to 11:42 | 10:00 | 64 min |
| `nWTNnk9n9eE` | Fri 04 | 08:55 to 11:42 | 10:00 | 64 min |
| `ZQJzIJctNcM` | Thu 03 | 08:55 to 20:50 | 10:00 | 64 min |
| `u-Xem1NawqQ` | Thu 03 | 08:55 to 20:50 | 10:00 | 64 min |
| `kc__H--teP0` | Sat 05 | 08:55 to 20:50 | 11:00 | 124 min |
| `nlsyscWhYMM` | Sun 06 | 08:55 to 20:50 | 11:00 | 124 min |
| `Yc5D3wHnxuw` | Mon 07 | 14:32 to 21:01 | 10:00 | none |

**Three dumerilii mornings produced no windows at all, and that is a fact about the
animal rather than a gap.** On 8, 7 and 4 September the detector read the tank
correctly, built one segment across the whole span, and found nothing above the
motion floor. Sampling nine frames across eight minutes of one of them shows why: the
achoque is not in shot in any of them, having spent the pre-opening hour inside or
behind its pot. The hour that guarantees no visitor is also the quietest hour of the
animal's day, and a tank with one occupant has nobody else to move. The mexicanum
tanks hold up better because they have three and five. Those days draw dumerilii as
its honest negative, and the species is represented instead by the clip-neighbourhood
files above.

`Yc5D3wHnxuw` is the exception worth stating rather than quietly omitting: it starts
after the doors are open, so no span of it can be made clean by the clock, and
anything taken from it would rest on the screen alone.

The last hour of a recording is the opposite of the first and was rejected for it.
These end at 20:50 against a 21:00 close, which is the busiest footage of the day.

**Nothing here was dropped quietly.** A window whose alias or candidates touch the
embargo list leaves the file before it is committed, never at serving time: these
files are public, so a count served from a shorter list than the file holds would
publish the size of the withholding by subtraction. For the same reason the counts of
what was dropped, for embargo and for a person in frame, are reported to the people
who sign the files off rather than written next to them.

**The resolution is a measurement, not a default.** The detector reads the station
badge and the roster chips by OCR, and it was checked at the resolution these spans
were fetched at before any of them were run: the badge reads and both roster chips
come back, identical to the higher-resolution read. A third of that resolution fails
outright, and, in the case that matters most, an upscale back from it recovers the
badge while silently losing a roster chip, which would have left the contradiction
check weaker with nothing on the surface to show it.
