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
  /**
   * What the paid read returned, as a count and as opaque identifiers.
   *
   * The ids and nothing beside them. A window id is a truncated hash of the
   * channel, the video, the two endpoints and the station, so on its own it names
   * nothing a reader can resolve; the tank, the species and the alias are in the
   * window the server sent and reach no browser. The ids travel so the page can
   * draw what was bought as objects rather than as a number.
   */
  | { step: "read"; served: number; ids: string[] }
  /**
   * The window the agent chose, named before it acts on it.
   *
   * The station is deliberately absent, and so are the species and the alias.
   * They are in the window the server read and in the proposal it forms, because
   * the ingest route is specified to receive them; they are not in anything a
   * stranger's browser is shown.
   *
   * The duration is sent rather than the two endpoints, and that is not cosmetic.
   * A window id is sha256 of channelId|videoId|startMs|endMs|stationId truncated
   * to 16 hex. The channel and the video are public, so publishing both endpoints
   * beside the id leaves the station as the only unknown in the preimage: a
   * handful of stations is a handful of hash trials, and the id stops being
   * opaque. With the duration alone the two endpoints are not recoverable.
   */
  | { step: "selected"; windowId: string; durationSeconds: number }
  /**
   * Every window served was unusable, reported as a count.
   *
   * The reasons were strings from the validator and they name values: a species
   * code, a window id, a length. A count says the same thing to a watcher and
   * carries nothing. The reasons are logged server side for whoever is debugging.
   */
  | { step: "nothing-proposable"; considered: number }
  /**
   * Every window in the cell was already a clip.
   *
   * Distinct from `nothing-proposable`, which means none of them passed
   * validation, and reachable only by walking them all: a run that stops at its
   * first duplicate learns nothing about the rest, so the sentence "already
   * proposed" belongs to this step and to no other.
   */
  | { step: "cell-spent"; considered: number }
  | { step: "proposing"; windowId: string }
  | { step: "proposed"; id: number; clipHash: string; status: string }
  /**
   * The ingest route answered, and the answer was not a new row.
   *
   * `detail` is a fixed sentence chosen by `kind`, never the route's own text.
   * That text is written for an operator and interpolates the values it is about:
   * the real 403 reads "La clave no cubre la estación AM 1", naming the station
   * twice. Passing it through put on a public feed exactly what was removed from
   * the successful path, and the check that guards this read only successful runs,
   * so it stayed green. Numbers are safe to carry and are carried.
   */
  | { step: "declined"; kind: DeclineKind; detail: string; status?: number; retryAfterSeconds?: number }
  /**
   * The run stops one step short on purpose: no ingest url is configured, or
   * this wallet holds no credential. `reason` says which, so a page can draw a
   * deployment that cannot submit apart from a wallet that has not enrolled.
   */
  | { step: "not-submitted"; detail: string; reason?: NotSubmitted }
  | { step: "done" };

export type DeclineKind = "duplicate" | "rejected" | "throttled" | "refused" | "error";
export type NotSubmitted = "unconfigured" | "no-credential";

export const NOT_SUBMITTED_SENTENCE: Record<NotSubmitted, string> = {
  unconfigured: "no ingest route is configured on this deployment",
  "no-credential": "this wallet holds no credential, so nothing is proposed",
};

/** One sentence per kind, written here rather than forwarded from the route. */
export const DECLINE_SENTENCE: Record<DeclineKind, string> = {
  duplicate: "this window is already a clip, so there is nothing new to propose",
  rejected: "a person already looked at this window and said no",
  throttled: "the credential is rate limited",
  refused: "the ingest route refused the proposal",
  error: "the run stopped on an error",
};

export type RunConfig = {
  /** The absolute URL of the paid route, so the in process call names the same
   *  resource the browser signed a challenge for. */
  windowsUrl: string;
  /** The PAYMENT-SIGNATURE header the browser produced. */
  paymentHeader?: string;
  ingestUrl?: string;
  /**
   * The credential kept in the environment, and the one wallet it belongs to.
   * Every other wallet proposes with its own credential from `credentialFor` or
   * not at all: a shared key would make every clip the same submitter's, which
   * is the thing the enrolment exists to end. Both unset, the environment holds
   * no credential for anyone.
   */
  ingestKey?: string;
  ingestKeyPayer?: string;
  /** This wallet's own credential, from the store, or null. */
  credentialFor?: (payer: string) => Promise<string | null>;
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
 *
 * **THE CELL TRAVELS WITH IT, AND IT DID NOT.** This dropped the query, and a check
 * asserted that it did, so a person who chose one cell on the board signed a
 * challenge for that cell and the run then read the whole snapshot: measured on the
 * committed fixtures, nineteen windows over five days for the price of one cell of
 * five. The board says a person chooses a day and a species to read, and that was
 * true of the price and false of the read. The day and the species are carried
 * through now, so the price shown, the challenge signed and the windows read are
 * one resource.
 */
export function windowsUrlFor(requestUrl: string): string {
  const asked = new URL(requestUrl);
  const windows = new URL("/api/agent/windows", requestUrl);
  for (const key of ["day", "species"]) {
    const value = asked.searchParams.get(key);
    if (value !== null) windows.searchParams.set(key, value);
  }
  return windows.toString();
}

/** Whether a request names a cell at all. A run without one is refused rather than
 *  served the whole snapshot, which is what it used to get. */
export function namesACell(requestUrl: string): boolean {
  const asked = new URL(requestUrl);
  return (asked.searchParams.get("day") ?? "") !== "" && (asked.searchParams.get("species") ?? "") !== "";
}

/**
 * The wallet that signed the payment, read off the header the browser sent.
 *
 * Client supplied bytes, and trustworthy only after the paid route has served:
 * the facilitator recovers the EIP-3009 signature against this same address, so
 * a header naming somebody else's wallet never gets past the read. The run reads
 * it AFTER the paid step for that reason, and uses it for one thing, which
 * credential to propose with.
 *
 * Base64 of JSON with the authorization under `payload`, measured against the
 * running route rather than read from the protocol documentation, and decoded
 * with atob so this module carries no Node only API.
 */
export function payerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(atob(header)) as { payload?: { authorization?: { from?: unknown } } };
    const from = decoded.payload?.authorization?.from;
    return typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from) ? from.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Whether the environment's own credential covers this payer.
 *
 * One rule with two readers. The run proposes under it and the registration read
 * says whether a wallet has a credential, and those answered differently: the
 * wallet the environment credential belongs to was told it had none while the run
 * proposed for it under exactly that credential, so the card contradicted the run
 * for the one wallet where it mattered most. Whatever this returns, both say it.
 */
export function environmentCredentialCovers(payer: string | null, ingestKey?: string, ingestKeyPayer?: string): boolean {
  const key = (ingestKey ?? "").trim();
  const owner = (ingestKeyPayer ?? "").trim().toLowerCase();
  return key !== "" && owner !== "" && payer !== null && payer.toLowerCase() === owner;
}

/** Which credential this run proposes with, or null for none. The wallet's own
 *  first; the environment's only for the wallet it was minted for. */
async function credentialToUse(cfg: RunConfig, payer: string | null): Promise<string | null> {
  if (payer && cfg.credentialFor) {
    const own = await cfg.credentialFor(payer);
    if (own) return own;
  }
  if (environmentCredentialCovers(payer, cfg.ingestKey, cfg.ingestKeyPayer)) return cfg.ingestKey ?? null;
  return null;
}

/**
 * What one run came to, read off the steps it yielded.
 *
 * Pure, and exported so the board's mark and the row behind it are decided by
 * something a check can drive without a database or a chain.
 *
 * **A run that was never served is not a read**, so it leaves no row: the mark on
 * the board says this cell was read by your agent, and a payment the route refused
 * did not read anything. The outcomes are the run's own step names rather than a
 * second vocabulary invented for the table, so what the board says a run did and
 * what the run said it did cannot drift; `declined` keeps its kind, because a
 * refusal and a rejection are different facts to the person who paid.
 */
export type RunOutcome = { free: boolean; txHash: string | null; outcome: string; clipId: number | null };

export function runOutcome(steps: RunStep[]): RunOutcome | null {
  const paid = steps.find(s => s.step === "paid");
  if (paid === undefined) return null;
  const free = paid.free;
  const txHash = free ? null : (paid.transaction ?? null);
  // A settled read with no transaction is not a settlement this can record, and
  // the table refuses the pair anyway. Recorded as free would be a lie about money.
  if (!free && txHash === null) return null;

  const proposed = steps.find(s => s.step === "proposed");
  if (proposed !== undefined) return { free, txHash, outcome: "proposed", clipId: proposed.id };
  const declined = steps.find(s => s.step === "declined");
  if (declined !== undefined) return { free, txHash, outcome: `declined:${declined.kind}`, clipId: null };
  const spent = steps.find(s => s.step === "cell-spent");
  if (spent !== undefined) return { free, txHash, outcome: "cell-spent", clipId: null };
  const nothing = steps.find(s => s.step === "nothing-proposable");
  if (nothing !== undefined) return { free, txHash, outcome: "nothing-proposable", clipId: null };
  const unsubmitted = steps.find(s => s.step === "not-submitted");
  if (unsubmitted !== undefined) return { free, txHash, outcome: "not-submitted", clipId: null };
  return { free, txHash, outcome: "read", clipId: null };
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
  yield {
    step: "read",
    served: raw.length,
    // Read off the served windows rather than off the validated ones, because this
    // reports what was bought and the validation has not run yet.
    ids: raw.map(w => String((w as { windowId?: unknown }).windowId ?? "")).filter(id => id !== ""),
  };

  const ledger = memoryLedger();
  // Kept out of the stream and logged, because each one names a value.
  const reasons: string[] = [];
  // Every proposable window, not the first. The run walks them, because a cell is
  // spent only when each one has been offered and refused, and a run that stopped
  // at the first duplicate could never say so.
  const proposable: CandidateWindow[] = [];
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
      // Evaluated before it is offered, not after. A window that cannot become a
      // proposal is not a candidate, and offering it only to fail would show the
      // agent picking something it cannot use.
      toProposal(w);
      proposable.push(w);
    } catch (err) {
      reasons.push(err instanceof UnproposableWindow ? `${w.windowId}: ${err.message}` : String(err));
    }
  }
  const chosen = proposable[0] ?? null;

  if (!chosen) {
    if (reasons.length > 0) console.warn("[run] nothing proposable:", reasons.join(" | "));
    yield { step: "nothing-proposable", considered: raw.length };
    yield { step: "done" };
    return;
  }

  // Read after the paid step, which is what makes it the verified payer: see
  // payerFromHeader. Decrypted here and held for the ingest header only.
  const key = cfg.ingestUrl ? await credentialToUse(cfg, payerFromHeader(cfg.paymentHeader)) : null;
  if (!cfg.ingestUrl || !key) {
    yield {
      step: "selected",
      windowId: chosen.windowId,
      durationSeconds: Math.round(chosen.endTime - chosen.startTime),
    };
    // Stops one step short rather than inventing a success. The run is still worth
    // watching to here, and saying so is better than a green "proposed" that never
    // reached anything.
    const reason: NotSubmitted = cfg.ingestUrl ? "no-credential" : "unconfigured";
    yield { step: "not-submitted", detail: NOT_SUBMITTED_SENTENCE[reason], reason };
    yield { step: "done" };
    return;
  }

  let duplicates = 0;
  // One proposal at most. A duplicate is the only answer that continues the walk,
  // because it is the only one that says this window is spoken for while leaving
  // the next one an open question.
  for (const window of proposable) {
    yield {
      step: "selected",
      windowId: window.windowId,
      durationSeconds: Math.round(window.endTime - window.startTime),
    };
    yield { step: "proposing", windowId: window.windowId };
    const result = await propose(window, {
      url: cfg.ingestUrl,
      key,
      ledger,
      fetchImpl: cfg.ingestFetch,
    });

    if (result.kind === "proposed") {
      yield { step: "proposed", id: result.id, clipHash: result.clipHash, status: result.status };
      yield { step: "done" };
      return;
    }
    if (result.kind === "duplicate") {
      duplicates += 1;
      // Recorded per window. Which runner remembers depends on the ledger it was
      // given: `bin/agent.ts` keeps a file, so its next run starts where this one
      // left off, while the run route builds a memory ledger per invocation, so a
      // browser run walks from the first window every time and pays one ingest
      // request per window already proposed. The refusal is still worth recording
      // here, because it is what makes this run's own walk terminate.
      ledger.remember(window.windowId, "the ingest already holds this clip");
      yield { step: "declined", kind: "duplicate", detail: DECLINE_SENTENCE.duplicate };
      continue;
    }
    yield* refusal(result);
    yield { step: "done" };
    return;
  }

  if (duplicates === proposable.length) yield { step: "cell-spent", considered: duplicates };
  yield { step: "done" };
}

/** The three refusals that stop a walk, kept out of the loop so the loop reads as
 *  the walk rather than as a switch. */
type Refusal = Exclude<Awaited<ReturnType<typeof propose>>, { kind: "proposed" } | { kind: "duplicate" }>;

async function* refusal(result: Refusal): AsyncGenerator<RunStep> {
  if (result.kind === "rejected") {
    yield { step: "declined", kind: "rejected", detail: DECLINE_SENTENCE.rejected };
  } else if (result.kind === "throttled") {
    yield {
      step: "declined",
      kind: "throttled",
      detail: DECLINE_SENTENCE.throttled,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  } else {
    // The route's own error and hint are written for an operator and name the
    // values they are about. They go to the log, never to the stream.
    console.warn(`[run] ingest refused ${result.status}:`, result.hint ? `${result.error} (${result.hint})` : result.error);
    yield { step: "declined", kind: "refused", detail: DECLINE_SENTENCE.refused, status: result.status };
  }
}
