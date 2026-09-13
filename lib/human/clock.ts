/**
 * The time, as one function the routes call and the checks can move.
 *
 * Two things here depend on the clock and neither takes it as a parameter from
 * the wire: when an enrollment was made and so when it lapses, and whether a
 * caller has asked too often. A route handler has no argument to pass a fake
 * clock through, so the seam is here, the same shape as `setCapForTest`. It is
 * the only way the thirty day boundary and the request cap can be seen red
 * without waiting thirty days.
 */
let injected: (() => Date) | undefined;

export function setClockForTest(clock: (() => Date) | undefined): void {
  injected = clock;
}

export function now(): Date {
  return injected ? injected() : new Date();
}
