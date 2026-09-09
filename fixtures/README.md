# Fixtures

`windows.synthetic.jsonl` is invented data. It exists so the test suite can exercise the endpoint without a real span, and it is not footage: the video and channel ids are not real ids and no frame behind it exists.

A real snapshot is deliberately absent. The detector's output is copied here by hand once the frames behind a span have been looked at, because nothing in a window record says whether a person is in the frame. The span used to develop the window shape is a calibration span and contains an operator's hand in two of its windows, which is exactly why it is not committed here.

Point the endpoint at a snapshot with `WINDOWS_SNAPSHOT`. Unset, the route answers 503 rather than an empty list, because an empty list is a real answer meaning the detector found nothing and a missing path is a misconfiguration.

## `windows.v9pFMid2BOs.jsonl`, the real span

Two windows produced by the detector over public footage of the mexicanum tank AM 3, video `v9pFMid2BOs`, from 03:27:55 to 03:30:45, inside one camera dwell. The span was chosen and then watched frame by frame by Zenbit before it became a fixture: no hands and no people in frame, one animal visible, the station badge reading AM 3 throughout. Both windows withhold the alias at confidence 500 because the tank has two occupants and the detector declines to identify, which is the refusal this endpoint exists to serve rather than an obstacle to it. The `reason` field is the detector's verbatim output and it is opaque by design: it says where to look, how many occupants the tank has and what the detector did, and nothing about how it decided. The earlier candidate span was rejected for containing an operator's hand, and the reason it was a good calibration span is the reason it is a bad fixture.

## `confirmation.259.json`, a real confirmation

The eleven public fields of one confirmed clip, copied verbatim from the reviewing application's unauthenticated list on 2026-09-09. It is the input the anchoring milestone attests, and it is a fixture rather than a live fetch so that the checks run in a runner with no network.

Nothing here is private. Every field is already served to anyone who asks that endpoint, and the two addresses are a reviewer acting in that role and the agent that proposed the clip, both of which appear on the chain already. What makes it worth committing is the signature: it is the only real one available, and the checks that matter are the ones that reproduce it and the ones that fail to. A synthetic signature would verify against a synthetic template and would prove that the code agrees with itself.
