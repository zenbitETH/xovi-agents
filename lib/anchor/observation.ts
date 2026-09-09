import { encodeAbiParameters } from "viem";
import { UnanchorableClip, decisionCode } from "./schema";

/**
 * The ten fields, in the order the schema fixes them.
 *
 * Seven of these are inside the message the reviewer signed and three are the
 * operator's own assertion copied out of the row. Nothing here is derived: a value
 * a reader is meant to check against a signature has to be carried across, because
 * deriving it yields a plausible answer where an error would have been useful.
 * `verifierChainId` is the one that makes that concrete, since the chain a reviewer
 * signed on and the chain this anchors to are independent choices that happen to
 * be the same chain today.
 */
export type Observation = {
  clipId: number;
  clipHash: `0x${string}`;
  decision: number;
  verifier: `0x${string}`;
  verifierSignature: `0x${string}`;
  verifierNonce: `0x${string}`;
  verifierChainId: number;
  verifiedAt: bigint;
  submitter: `0x${string}`;
  confidence: number;
};

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The ABI shape the schema string describes, kept beside it so the two move together. */
export const OBSERVATION_ABI = [
  { name: "clipId", type: "uint32" },
  { name: "clipHash", type: "bytes32" },
  { name: "decision", type: "uint8" },
  { name: "verifier", type: "address" },
  { name: "verifierSignature", type: "bytes" },
  { name: "verifierNonce", type: "bytes32" },
  { name: "verifierChainId", type: "uint32" },
  { name: "verifiedAt", type: "uint64" },
  { name: "submitter", type: "address" },
  { name: "confidence", type: "uint16" },
] as const;

export function encodeObservation(o: Observation): `0x${string}` {
  return encodeAbiParameters(OBSERVATION_ABI, [
    o.clipId,
    o.clipHash,
    o.decision,
    o.verifier,
    o.verifierSignature,
    o.verifierNonce,
    o.verifierChainId,
    BigInt(o.verifiedAt),
    o.submitter,
    o.confidence,
  ]);
}

/**
 * A confirmed row from the reviewing application's public list, as an observation.
 *
 * Refuses rather than coerces. A row that reached here without a signature, or with
 * a status nobody confirmed, is a row this milestone must not attest, and turning
 * either into a default would produce a record about a decision that was never made.
 */
export function toObservation(row: Record<string, unknown>): Observation {
  const need = (k: string): string => {
    const v = row[k];
    if (typeof v !== "string" || v.length === 0) throw new UnanchorableClip(`clip ${row.id}: ${k} is missing`);
    return v;
  };
  if (row.status !== "verified") throw new UnanchorableClip(`clip ${row.id}: status is ${row.status}, not verified`);
  if (row.source !== "cv") throw new UnanchorableClip(`clip ${row.id}: source is ${row.source}, not a machine proposal`);

  const clipHash = need("clipHash");
  const nonce = need("verifierNonce");
  const verifier = need("verifiedBy");
  const submitter = need("submitterAddress");
  if (!HEX32.test(clipHash)) throw new UnanchorableClip(`clip ${row.id}: clipHash is not 32 bytes`);
  if (!HEX32.test(nonce)) throw new UnanchorableClip(`clip ${row.id}: verifierNonce is not 32 bytes`);
  if (!ADDRESS.test(verifier)) throw new UnanchorableClip(`clip ${row.id}: verifiedBy is not an address`);
  if (!ADDRESS.test(submitter)) throw new UnanchorableClip(`clip ${row.id}: submitterAddress is not an address`);

  const chainId = row.verifierChainId;
  if (typeof chainId !== "number") throw new UnanchorableClip(`clip ${row.id}: verifierChainId is missing`);
  const confidence = row.confidence;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 65535) {
    throw new UnanchorableClip(`clip ${row.id}: confidence is not a uint16`);
  }
  const verifiedAt = Date.parse(String(row.verifiedAt));
  if (!Number.isFinite(verifiedAt)) throw new UnanchorableClip(`clip ${row.id}: verifiedAt is not a time`);

  return {
    clipId: Number(row.id),
    clipHash: clipHash as `0x${string}`,
    decision: decisionCode("verified"),
    verifier: verifier as `0x${string}`,
    verifierSignature: need("verifierSignature") as `0x${string}`,
    verifierNonce: nonce as `0x${string}`,
    verifierChainId: chainId,
    verifiedAt: BigInt(Math.floor(verifiedAt / 1000)),
    submitter: submitter as `0x${string}`,
    confidence,
  };
}
