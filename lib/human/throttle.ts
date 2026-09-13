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
 *  loop. A check holds it under `ENROLLMENT_CALLS_CEILING`, because the cap is
 *  per wallet and wallets are free, so the number is what bounds how often one
 *  fresh address can have a result forwarded to the verifier. */
export const ENROLLMENT_CALLS_PER_MINUTE = 10;
export const ENROLLMENT_CALLS_CEILING = 20;
export const ENROLLMENT_WINDOW_MS = 60_000;

/** One instance for both routes, so a caller cannot spend the request route's
 *  allowance and the verify route's allowance separately. */
export const enrollmentThrottle = throttleFrom(ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS);

/** Per client per minute on the ENS gateway. A record lookup is one GET per record
 *  through the universal resolver's batch, and a page asks for two or three, so
 *  sixty covers a reader and not a loop. Keyed on the client, since the sender in
 *  the url is the resolver and the same for everyone. */
export const ENS_GATEWAY_CALLS_PER_MINUTE = 60;
export const ENS_GATEWAY_WINDOW_MS = 60_000;
export const ensGatewayThrottle = throttleFrom(ENS_GATEWAY_CALLS_PER_MINUTE, ENS_GATEWAY_WINDOW_MS);
