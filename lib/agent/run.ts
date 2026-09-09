import { memoryLedger } from "./ledger";
import { UnproposableWindow, propose, toProposal } from "./propose";
import type { CandidateWindow } from "../windows/types";
import { windowProblems } from "../windows/types";

/**
 * One delegated run, as a sequence of steps.
 *
 * A generator rather than a function returning a log, because the point of this
 * surface is that somebody watches it happen. A function that returns the whole
 * run has already finished by the time anything can be shown, and a run nobody
 * can watch is the same product as a run that printed nothing.
 *
 * Nothing here writes to a stream or knows what a stream is. The route turns
 * these into bytes and the checks consume the same generator directly, so what is
 * asserted is the sequence itself rather than a rendering of it.
 */
export type RunStep =
  /** The signed authorization is being presented to the paid route. */
  | { step: "presenting" }
  /** Payment refused before any work: no signature, a bad one, or a v1 header. */
  | { step: "payment-refused"; status: number; detail: string }
  /** The route could not serve at all: unconfigured, or no snapshot. */
  | { step: "unavailable"; status: number; detail: string }
  /** Settled on chain, or served under the free daily allowance. */
  | { step: "paid"; free: boolean; transaction?: string; network?: string }
  | { step: "read"; served: number }
  /**
   * The window the agent chose, named before it acts on it.
   *
   * The station is deliberately absent, and so are the species and the alias.
   * They are in the window the server read and in the proposal it forms, because
   * the ingest route is specified to receive them; they are not in anything a
   * stranger's browser is shown. A live feed is a published surface, and the
   * window id is opaque while a station is not.
   */
  | { step: "selected"; windowId: string; startTime: number; endTime: number; confidence: number }
  /** Every window served was unusable. The run stops here and pays nothing back. */
  | { step: "nothing-proposable"; reasons: string[] }
  | { step: "proposing"; windowId: string }
  | { step: "proposed"; id: number; clipHash: string; status: string }
  /** The ingest route answered, and the answer was not a new row. */
  | { step: "declined"; kind: string; detail: string }
  /** No ingest credential configured, so the run stops one step short on purpose. */
  | { step: "not-submitted"; detail: string }
  | { step: "done" };

export type RunConfig = {
  /** The absolute URL of the paid route, so the in process call names the same
   *  resource the browser signed a challenge for. */
  windowsUrl: string;
  /** The PAYMENT-SIGNATURE header the browser produced. */
  paymentHeader?: string;
  ingestUrl?: string;
  ingestKey?: string;
  /** The paid route's own handler, injected so the checks drive the real one. */
  windowsFetch: typeof fetch;
  ingestFetch?: typeof fetch;
};

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.error === "string") return o.error;
  }
  return fallback;
}

/**
 * The paid route's URL, derived from the request that asked for a run.
 *
 * Both halves must name the same resource: the browser reads its challenge from
 * this URL and the run presents the payment for it. Deriving it from the incoming
 * request rather than from an environment variable means there is no second place
 * to configure and nothing to drift, and a preview deployment works without being
 * told its own hostname.
 *
 * Worth being exact about what this does and does not buy, because it is easy to
 * assume more. It is NOT a security boundary. The EIP-3009 authorization signs the
 * token, the recipient, the amount, a validity window and a nonce; it does not
 * sign the path. Measured: a payment signed against one origin settles when it is
 * presented at another. What makes an authorization spendable once is the nonce
 * the token refuses to reuse, not the URL it was fetched from.
 */
export function windowsUrlFor(requestUrl: string): string {
  return new URL("/api/agent/windows", requestUrl).toString();
}

export async function* runOnce(cfg: RunConfig): AsyncGenerator<RunStep> {
  yield { step: "presenting" };

  const headers: Record<string, string> = { accept: "application/json" };
  // Forwarded rather than re-signed. The authorization carries a nonce the token
  // refuses to reuse, so these exact bytes are at most once by the primitive; a
  // fresh signature here would be a second authorization and a real double spend.
  if (cfg.paymentHeader) headers["PAYMENT-SIGNATURE"] = cfg.paymentHeader;

  const response = await cfg.windowsFetch(cfg.windowsUrl, { headers });
  const body = await response.json().catch(() => ({}));

  if (response.status === 503) {
    yield { step: "unavailable", status: 503, detail: detailOf(body, "the route cannot serve") };
    yield { step: "done" };
    return;
  }
  if (response.status !== 200) {
    // 402 with or without a challenge, and anything else the route refuses with.
    yield { step: "payment-refused", status: response.status, detail: detailOf(body, `HTTP ${response.status}`) };
    yield { step: "done" };
    return;
  }

  // A settled read carries the receipt in PAYMENT-RESPONSE. A free read under the
  // daily allowance carries none, and that difference is shown rather than
  // flattened: "paid" and "did not have to pay" are different things to watch.
  //
  // Base64 of JSON, measured against the running route rather than read from the
  // protocol docs: {"success":true,"transaction":"0x…","network":"eip155:84532"}.
  // Decoded with atob rather than Buffer so this module carries no Node only API.
  const receipt = response.headers.get("PAYMENT-RESPONSE");
  let transaction: string | undefined;
  let network: string | undefined;
  if (receipt) {
    try {
      const decoded = JSON.parse(atob(receipt)) as Record<string, unknown>;
      if (typeof decoded.transaction === "string") transaction = decoded.transaction;
      if (typeof decoded.network === "string") network = decoded.network;
    } catch {
      // A receipt that will not decode is not a failure of the payment: the money
      // moved or the route would not have served. Reported as paid without a
      // transaction rather than as an error.
    }
  }
  yield { step: "paid", free: !receipt, transaction, network };

  const raw = (body as { windows?: unknown[] }).windows ?? [];
  yield { step: "read", served: raw.length };

  const ledger = memoryLedger();
  const reasons: string[] = [];
  let chosen: CandidateWindow | null = null;
  for (const candidate of raw) {
    const problems = windowProblems(candidate);
    if (problems.length > 0) {
      reasons.push(problems.join("; "));
      continue;
    }
    const w = candidate as CandidateWindow;
    if (ledger.has(w.windowId)) {
      reasons.push(`${w.windowId} was already refused in this run`);
      continue;
    }
    try {
      // Evaluated before it is chosen, not after. A window that cannot become a
      // proposal is not a candidate, and selecting it only to fail would show the
      // agent picking something it cannot use.
      toProposal(w);
      chosen = w;
      break;
    } catch (err) {
      reasons.push(err instanceof UnproposableWindow ? `${w.windowId}: ${err.message}` : String(err));
    }
  }

  if (!chosen) {
    yield { step: "nothing-proposable", reasons };
    yield { step: "done" };
    return;
  }

  yield {
    step: "selected",
    windowId: chosen.windowId,
    startTime: chosen.startTime,
    endTime: chosen.endTime,
    confidence: chosen.confidence,
  };

  if (!cfg.ingestUrl || !cfg.ingestKey) {
    // Stops one step short rather than inventing a success. The run is still worth
    // watching to here, and saying so is better than a green "proposed" that never
    // reached anything.
    yield { step: "not-submitted", detail: "no ingest credential is configured on this deployment" };
    yield { step: "done" };
    return;
  }

  yield { step: "proposing", windowId: chosen.windowId };
  const result = await propose(chosen, {
    url: cfg.ingestUrl,
    key: cfg.ingestKey,
    ledger,
    fetchImpl: cfg.ingestFetch,
  });

  if (result.kind === "proposed") {
    yield { step: "proposed", id: result.id, clipHash: result.clipHash, status: result.status };
  } else if (result.kind === "duplicate") {
    yield { step: "declined", kind: "duplicate", detail: `this window is already a clip, ${result.clipHash}` };
  } else if (result.kind === "rejected") {
    yield { step: "declined", kind: "rejected", detail: "a person already looked at this window and said no" };
  } else if (result.kind === "throttled") {
    yield { step: "declined", kind: "throttled", detail: `rate limited for ${result.retryAfterSeconds} seconds` };
  } else {
    yield { step: "declined", kind: "refused", detail: result.hint ? `${result.error} (${result.hint})` : result.error };
  }
  yield { step: "done" };
}
