// Excerpt of Xovi's machine-credential module at origin/dev 2754a0eb (2026-09-08),
// for the public patch set. What is shown: the token format and its parse, the key
// context the routes receive, the hashing of the secret, and the three checks the
// ingest route calls. What is left out: the database queries that resolve a token to
// a row, the minting function, and the list of capabilities issued to other
// credential classes. The closed capability set is enforced by the server-side
// allow-list on the credential row; the only capability relevant here is the one
// that lets a machine propose a clip, and no credential class has a confirm member.
import { createHash, timingSafeEqual } from "node:crypto";

/** The closed set is declared elsewhere; the clip capability is the one this patch set concerns. */
export type IngestCapability = string;
export const CLIPS_PROPOSE: IngestCapability = "clips:propose";

export type IngestKeyContext = {
  id: number;
  label: string;
  sourceClass: string;
  capabilities: string[];
  stationScope: string[] | null;
  /** The delegated agent's own address. Rows it writes are attributed here, and
   *  submitter_address is part of computeClipHash, so a clip proposer must have one. */
  agentAddress: `0x${string}` | null;
  /** The human who answers for this credential. The self-review guard compares THIS,
   *  not agentAddress: comparing the agent is exactly what delegation defeats. */
  holderAddress: `0x${string}` | null;
};

/** Token format: `xvi_<12 hex prefix>_<base64url secret>`. The prefix locates the row;
 *  only sha256(secret) is stored. Bounded regex rather than split on the underscore,
 *  because a base64url secret may itself contain one. */
export function parseToken(raw: string): { keyPrefix: string; secret: string } | null {
  const m = /^xvi_([0-9a-f]{12})_(.+)$/.exec(raw.trim());
  return m ? { keyPrefix: m[1], secret: m[2] } : null;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Constant-time compare of two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function bearerFrom(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export function keyCan(ctx: IngestKeyContext, capability: IngestCapability): boolean {
  return ctx.capabilities.includes(capability);
}

/** A scope of null means "any station"; otherwise the station must be listed, byte for byte. */
export function keyCoversStation(ctx: IngestKeyContext, stationId: string): boolean {
  return ctx.stationScope === null || ctx.stationScope.includes(stationId);
}
