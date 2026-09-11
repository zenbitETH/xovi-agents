// Excerpt of Xovi's machine-credential module at origin/dev 2754a0eb (2026-09-08),
// for the public patch set. What is shown: the token format and its parse, the key
// context the routes receive, the hashing of the secret, and the three checks the
// ingest route calls. What is left out: the database queries that resolve a token to
// a row, the minting function, and the list of capabilities issued to other
// credential classes. The closed capability set is enforced by the server-side
// allow-list on the credential row; the only capability relevant here is the one
// that lets a machine propose a clip, and no credential class has a confirm member.
//
// What DIFFERS from the source at that commit, since an excerpt that claims to be a
// copy has to account for every difference and this header previously accounted only
// for omissions. This comment block is itself an addition and is not in the source.
// `randomBytes` is dropped from the import below because the minting function it
// serves is omitted. `IngestCapability` is widened from a closed union of three
// literals to `string`, marked in place, because the other two name capabilities
// issued to credential classes outside this patch set, and a `CLIPS_PROPOSE` constant
// that the source does not have has been removed rather than declared. One sentence of the parse
// comment is redacted in place: it carries a measured share of issued credentials,
// which is an operational figure about the product rather than about this work.
// Nothing else differs. The comparison is mechanical: every other line here appears
// verbatim in the source.
import { createHash, timingSafeEqual } from "crypto";

/**
 * The allow-list. Note what this union is and is not: `capabilities` is untyped
 * `jsonb`, so this closed set is a TypeScript ceiling enforced by the server, NOT a
 * database constraint. The honest phrasing is "enforced by the credential's
 * server-side allow-list" — never "structurally impossible".
 *
 * `clips:propose` is the ETH Online agent surface. It carries a station scope from
 * day one (`keyCoversStation`), matching (redacted for the public patch set: a
 * capability issued to another credential class): a credential that
 * can propose everywhere is a tenancy boundary that does not exist. There is no
 * confirm member here and there is not meant to be one.
 */
// (redacted for the public patch set: a closed union of three literals, two of them
// naming capabilities issued to other credential classes)
export type IngestCapability = string;

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

/**
 * Parse a token, or null.
 *
 * Bounded regex, NOT split("_"). The secret is `randomBytes(32).toString("base64url")`
 * and the base64url alphabet contains `_`, so splitting on it produced four or more
 * parts whenever the secret happened to contain one and the length check then
 * rejected the token. (redacted for the public patch set: a measured share of the
 * credentials this system had issued) were unparseable and authenticated as a bare
 * 401, indistinguishable from a wrong secret. A coin flip at issuance, and silent.
 *
 * The prefix is fixed-width hex so the boundary is unambiguous; the secret is
 * whatever follows and is never split again.
 */
function parseToken(raw: string): { keyPrefix: string; secret: string } | null {
  const m = /^xvi_([0-9a-f]{12})_(.+)$/.exec(raw.trim());
  return m ? { keyPrefix: m[1], secret: m[2] } : null;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Constant-time compare of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  // timingSafeEqual throws on length mismatch, which would itself leak; both are
  // sha256 hex here, so a mismatch means malformed input — reject it outright.
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export function bearerFrom(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export function keyCan(ctx: IngestKeyContext, capability: IngestCapability): boolean {
  return ctx.capabilities.includes(capability);
}

/** A scope of null means "any station"; otherwise the station must be listed. */
export function keyCoversStation(ctx: IngestKeyContext, stationId: string): boolean {
  return ctx.stationScope === null || ctx.stationScope.includes(stationId);
}
