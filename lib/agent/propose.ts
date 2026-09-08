import type { CandidateWindow } from "../windows/types";
import type { Ledger } from "./ledger";

/**
 * A window becomes a proposal.
 *
 * Ten fields go and seven are dropped. The names match what the ingest route
 * already calls them, so nothing is renamed on the way. What is dropped has no
 * destination: the schema version, the window id, the candidate roster, the
 * detector version, the time it was produced, and the two truncation booleans are
 * all things the producer knows and the clip record does not model.
 *
 * Two fields are never sent at all, which is different from being dropped.
 * `source` is accepted by the route only so it can be refused, and `submitterAddress`
 * is derived from the credential and folded into the clip hash, so a machine that
 * could name its own submitter could attribute its work to a person. Omitting them
 * is the correct behaviour, and the checks assert absence rather than a value.
 */
export type Proposal = {
  channelId: string;
  videoId: string;
  startTime: number;
  endTime: number;
  behaviorTag: string;
  behaviorNote: string;
  speciesCode: string;
  stationId: string;
  specimenAlias: string | null;
  confidence: number;
};

/** Exactly the keys a proposal may carry. Asserted, not assumed: zod strips unknown
 *  keys in silence, so a field added here by accident would never be reported. */
export const PROPOSAL_KEYS = [
  "channelId",
  "videoId",
  "startTime",
  "endTime",
  "behaviorTag",
  "behaviorNote",
  "speciesCode",
  "stationId",
  "specimenAlias",
  "confidence",
] as const;

const MAX_DURATION_SECONDS = 120;
const NOTE_MIN = 3;
const NOTE_MAX = 280;

export class UnproposableWindow extends Error {}

export function toProposal(w: CandidateWindow): Proposal {
  const note = w.reason.trim();
  // Refused here rather than sent and refused there. The route requires a note of
  // three characters or more whenever the tag is "other", and the tag is always
  // "other", so a window with no usable reason cannot become a proposal at all.
  if (note.length < NOTE_MIN || note.length > NOTE_MAX) {
    throw new UnproposableWindow(`reason must be ${NOTE_MIN} to ${NOTE_MAX} characters, got ${note.length}`);
  }
  if (w.endTime - w.startTime > MAX_DURATION_SECONDS) {
    throw new UnproposableWindow(`a clip is at most ${MAX_DURATION_SECONDS} seconds`);
  }
  return {
    channelId: w.channelId,
    videoId: w.videoId,
    startTime: w.startTime,
    endTime: w.endTime,
    // Always "other", and a tag the producer supplies is deliberately not
    // forwarded. The enum belongs to the receiving route and the detector cannot
    // classify behaviour, so forwarding a value it invented would put a word from
    // one vocabulary into a field governed by another. A window marks where
    // something moved; claiming a behaviour would be claiming the thing this
    // pipeline cannot do. It also keeps the note always required and always
    // persisted, because that route force-nulls the note for catalog tags.
    behaviorTag: "other",
    behaviorNote: note,
    speciesCode: w.speciesCode,
    stationId: w.stationId,
    // Null is a real answer meaning the station has no sole occupant and the
    // appearance signal did not resolve one. The route accepts it as a station
    // only tag.
    specimenAlias: w.specimenAlias,
    confidence: w.confidence,
  };
}

export type ProposeResult =
  | { kind: "proposed"; id: number; clipHash: string; status: string }
  /** The row already exists. Not an error, and worth retrying later. */
  | { kind: "duplicate"; clipHash: string }
  /** A person looked at this window and said no. Stop, do not back off. */
  | { kind: "rejected"; clipHash: string }
  /** Rate limited, or the limiter itself failed closed. Belongs to the credential
   *  rather than to this window, so a caller should stop rather than walk on. */
  | { kind: "throttled"; retryAfterSeconds: number }
  | { kind: "refused"; status: number; error: string; hint?: string; issues?: unknown };

export type ProposeConfig = {
  url: string;
  key: string;
  ledger: Ledger;
  fetchImpl?: typeof fetch;
};

export async function propose(w: CandidateWindow, cfg: ProposeConfig): Promise<ProposeResult> {
  const body = toProposal(w);
  const doFetch = cfg.fetchImpl ?? fetch;
  const response = await doFetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
    // A scheduled run that hangs is worse than one that fails, because nothing
    // reports it.
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 201) {
    // A 201 that does not carry these is not this route answering, whatever sent
    // it. Reporting "proposed" on the strength of a status line would record a
    // clip id of NaN and a status of "undefined" as a success.
    if (payload.id === undefined || payload.clipHash === undefined || payload.status === undefined) {
      return { kind: "refused", status: 201, error: "a created response arrived without an id, a hash or a status" };
    }
    return {
      kind: "proposed",
      id: Number(payload.id),
      clipHash: String(payload.clipHash),
      status: String(payload.status),
    };
  }

  if (response.status === 429) {
    const header = Number(response.headers.get("retry-after"));
    return { kind: "throttled", retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : 3600 };
  }

  if (response.status === 409) {
    const clipHash = String(payload.clipHash ?? "");
    // The flag is the whole of the difference between the two 409s, and each value
    // is required to be literally present. Reading "not true" as a rejection would
    // let any 409 from anywhere become a permanent bar: a proxy, a gateway or a
    // firewall answering 409 with a body this client cannot parse would close a
    // window no reviewer ever saw, and the ledger would record that a person
    // decided it. Stopping is still right; claiming a human decision is not.
    if (payload.retryable === true) return { kind: "duplicate", clipHash };
    if (payload.retryable === false) {
      cfg.ledger.remember(w.windowId, `rejected by a person: ${String(payload.error ?? "no reason given")}`);
      return { kind: "rejected", clipHash };
    }
    return {
      kind: "refused",
      status: 409,
      error: "a 409 arrived without the flag that says whether it can be retried, so no decision is recorded for it",
    };
  }

  const error = String(payload.error ?? `HTTP ${response.status}`);
  // The station refusal reads like a permissions problem and is a spelling one.
  // The credential's scope is compared byte for byte while the clip target check
  // ignores case and spaces, so a key minted "AM3" against a window emitting
  // "AM 3" is refused with a message about coverage.
  const hint =
    response.status === 403 && error.includes("no cubre la estación")
      ? `the credential's station scope is matched literally: it must be the string the detector emits, "${w.stationId}", spaces included`
      : undefined;
  // Carried through so an operator sees which field, rather than a bare
  // "validación fallida" that names nothing.
  const issues = response.status === 400 ? payload.issues : undefined;
  return { kind: "refused", status: response.status, error, hint, issues };
}
