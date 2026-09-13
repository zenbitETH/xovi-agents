/**
 * How often one caller may hit a route, held in this process.
 *
 * A fixed window per key: so many calls in a window, then 429 with the seconds
 * left. In memory, so on a platform that runs several instances the count is
 * per instance and the ceiling is that many times higher. That is stated rather
 * than hidden because the routes this guards call a third party's verifier, and
 * a limit that looks like ten and is really ten times the instance count is the
 * kind of number a reviewer should meet here and not in a bill.
 *
 * It bounds abuse of a public route; it does not authenticate anyone. What
 * authenticates an enrollment is the result the verifier accepts, and what
 * authenticates a read is the payment.
 */
export type Throttle = {
  take(key: string, at: Date): { ok: true } | { ok: false; retryAfterSeconds: number };
  reset(): void;
};

export function throttleFrom(limit: number, windowMs: number): Throttle {
  const windows = new Map<string, { start: number; used: number }>();
  return {
    take(key, at) {
      const t = at.getTime();
      const w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        windows.set(key, { start: t, used: 1 });
        return { ok: true };
      }
      if (w.used < limit) {
        w.used++;
        return { ok: true };
      }
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
    },
    reset() {
      windows.clear();
    },
  };
}

/** Per wallet per minute, on the two enrollment routes. Ten covers a person who
 *  opens the widget, cancels, and tries again a few times; it does not cover a
 *  loop. */
export const ENROLLMENT_CALLS_PER_MINUTE = 10;
export const ENROLLMENT_WINDOW_MS = 60_000;

/** One instance for both routes, so a caller cannot spend the request route's
 *  allowance and the verify route's allowance separately. */
export const enrollmentThrottle = throttleFrom(ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS);
