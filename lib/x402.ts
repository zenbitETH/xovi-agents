import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

/** Only string lookups are needed, so the tests can pass a plain object
 *  instead of casting a partial to the full process environment. */
export type EnvLike = Record<string, string | undefined>;

export const WINDOWS_ROUTE = "GET /api/agent/windows";

export class PaymentMisconfigured extends Error {}

/**
 * Why this is a route handler and not middleware.ts.
 *
 * The published integration for this protocol is a Next middleware with a path
 * matcher. Two reasons not to take it. A matcher gates by pattern, so the set of
 * paid routes is stated somewhere other than the route itself and drifts from it
 * silently; a route that should be free and is caught by the pattern returns 402
 * to a caller who has no idea why. And middleware wraps the handler, which makes
 * "settle only if the handler succeeded" a property of the wrapper rather than
 * something visible where the work happens. Here the ordering is written out:
 * verify, run, and only then settle.
 */
function readConfig(env: EnvLike) {
  const payTo = (env.X402_PAY_TO ?? "").trim();
  // Fails closed, and the check is not cosmetic. An unset recipient with a
  // permissive server would serve the windows for nothing, which is the one
  // failure this endpoint must not have: it is the paid read.
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new PaymentMisconfigured("X402_PAY_TO is not a 20 byte address");
  }
  return {
    payTo: payTo as `0x${string}`,
    // CAIP-2. Base Sepolia by default; the facilitator cannot verify or settle on
    // a local chain, so there is no localhost option here on purpose.
    network: (env.X402_NETWORK ?? "eip155:84532") as `${string}:${string}`,
    facilitatorUrl: env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    price: env.X402_PRICE ?? "$0.01",
  };
}

let cached: Promise<x402HTTPResourceServer> | null = null;

export function resetServerForTest() {
  cached = null;
}

export function buildServer(env: EnvLike = process.env): Promise<x402HTTPResourceServer> {
  if (cached) return cached;
  cached = (async () => {
    const cfg = readConfig(env);
    const core = new x402ResourceServer(new HTTPFacilitatorClient({ url: cfg.facilitatorUrl }));
    registerExactEvmScheme(core);
    const http = new x402HTTPResourceServer(core, {
      [WINDOWS_ROUTE]: {
        accepts: [{ scheme: "exact", price: cfg.price, network: cfg.network, payTo: cfg.payTo }],
        description: "Candidate windows: spans of a public livestream where something moved and a person should look",
        mimeType: "application/json",
      },
    });
    // Validates that the declared scheme and network are ones the facilitator
    // actually supports. Doing it at startup turns a misconfiguration into a
    // refusal now rather than a 402 nobody can pay at demo time.
    await http.initialize();
    return http;
  })().catch(err => {
    cached = null; // so a transient facilitator outage does not poison the process
    throw err;
  });
  return cached;
}

/** The adapter the protocol server reads the request through. */
export function adapterFor(request: Request) {
  const url = new URL(request.url);
  return {
    getHeader: (name: string) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
    getQueryParam: (name: string) => url.searchParams.get(name) ?? undefined,
  };
}

/**
 * v2 sends the payment in PAYMENT-SIGNATURE. X-PAYMENT is the v1 header and a v2
 * server ignores it in silence, which is the worst thing to be debugging late, so
 * it is read here only to be able to say what happened.
 */
export function paymentHeaderFrom(request: Request) {
  const v2 = request.headers.get("PAYMENT-SIGNATURE") ?? undefined;
  const v1 = request.headers.get("X-PAYMENT") ?? undefined;
  return { header: v2, sentV1Only: !v2 && Boolean(v1) };
}
