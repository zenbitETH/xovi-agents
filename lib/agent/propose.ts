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
    // The detector emits no behaviour tag and the route's enum is required, so the
    // proposal says "other" and puts the detector's reasoning in the note. That is
    // the honest shape: a window marks where something moved, and claiming a
    // behaviour would be claiming the thing this pipeline cannot do.
    behaviorTag: w.behaviorTag ?? "other",
    behaviorNote: note,
    speciesCode: w.speciesCode,
    stationId: w.stationId,
    // Null is a real answer meaning the station has no sole occupant and the
    // phenotype did not resolve one. The route accepts it as a station-only tag.
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
  | { kind: "refused"; status: number; error: string; hint?: string };

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
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status === 201) {
    return {
      kind: "proposed",
      id: Number(payload.id),
      clipHash: String(payload.clipHash),
      status: String(payload.status),
    };
  }

  if (response.status === 409) {
    const clipHash = String(payload.clipHash ?? "");
    // retryable is the whole of the difference between the two 409s, and reading
    // it as merely truthy would treat an absent field as retryable. An absent
    // field here means the response is not one this client understands, so the
    // safe reading is the one that stops.
    if (payload.retryable === true) return { kind: "duplicate", clipHash };
    cfg.ledger.remember(w.windowId, `rejected by a person: ${String(payload.error ?? "no reason given")}`);
    return { kind: "rejected", clipHash };
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
  return { kind: "refused", status: response.status, error, hint };
}
