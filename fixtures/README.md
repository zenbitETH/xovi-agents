# Fixtures

`windows.synthetic.jsonl` is invented data. It exists so the test suite can exercise the endpoint without a real span, and it is not footage: the video and channel ids are not real ids and no frame behind it exists.

A real snapshot is deliberately absent. The detector's output is copied here by hand once the frames behind a span have been looked at, because nothing in a window record says whether a person is in the frame. The span used to develop the window shape is a calibration span and contains an operator's hand in two of its windows, which is exactly why it is not committed here.

Point the endpoint at a snapshot with `WINDOWS_SNAPSHOT`. Unset, the route answers 503 rather than an empty list, because an empty list is a real answer meaning the detector found nothing and a missing path is a misconfiguration.
