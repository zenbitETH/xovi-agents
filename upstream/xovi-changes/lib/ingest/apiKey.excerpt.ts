// Excerpt of Xovi's machine-credential module at origin/dev 2754a0eb (2026-09-08),
// for the public patch set.
//
// It is the source file with four things removed and four redacted, and nothing else
// changed. This header is itself an addition and is not in the source.
//
// REMOVED, all of them the minting path, which no published file imports:
// `generateIngestKey`, its two constants `PREFIX_BYTES` and `SECRET_BYTES`, the
// `randomBytes` import they need, and `__parseTokenForTest`, a test-only seam whose
// comment carries the same operational figure redacted below.
//
// REDACTED, each marked in place: the closed capability union, which names two
// capabilities issued to other credential classes; the same capability where the
// module comment and the parse comment name it; and one sentence carrying a measured
// share of issued credentials, an operational figure about the product rather than
// about this work.
//
// Everything a published file imports is here, with its comments: `resolveIngestKey`
// and `holderOfKey` are carried because the ingest route and the review-route patch
// import them, and `asAddress` with `ADDRESS_RE` because `holderOfKey` returns
// through it. An exhibit that publishes a caller and withholds the callee it depends
// on publishes a mechanism without the warning attached to it.
//
// The file imports Xovi modules that are not in this directory and does not run on
// its own, which is true of every file here.

import { createHash, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "~~/services/database/config/postgresClient";
import { ingestKeys } from "~~/services/database/config/schema";

/**
 * Bearer credentials for machines (0022) — the reader on the NUC, and nothing else yet.
 *
 * Format: `xvi_<prefix>_<secret>`. The prefix is stored in the clear and is what
 * locates the row; the secret is never stored at all, only its sha256. A leaked
 * database therefore yields no usable key.
 *
 * Capabilities are an ALLOW-LIST and they are where the red line is enforced. The
 * (redacted for the public patch set: a capability issued to another credential
 * class, and the reader it is issued to) is incapable of confirming a reading, so
 * "ningún modelo es su propia verdad" holds
 * even if the client asks nicely, because the route checks what the key may reach
 * rather than what the caller claims to be.
 */
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

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Parse a token, or null.
 *
 * Bounded regex, NOT split("_"). The secret is `randomBytes(32).toString("base64url")`
 * and the base64url alphabet contains `_`, so splitting on it produced four or more
 * parts whenever the secret happened to contain one and the length check then
 * rejected the token. (redacted for the public patch set: a measured share of the
 * credentials this system had issued) were unparseable and authenticated as a bare 401,
 * indistinguishable from a wrong secret. A coin flip at issuance, and silent.
 *
 * The prefix is fixed-width hex so the boundary is unambiguous; the secret is
 * whatever follows and is never split again.
 */
function parseToken(raw: string): { keyPrefix: string; secret: string } | null {
  const m = /^xvi_([0-9a-f]{12})_(.+)$/.exec(raw.trim());
  return m ? { keyPrefix: m[1], secret: m[2] } : null;
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

/** The only address format check in the system. Exported so the CLI that mints keys
 *  and the server that reads them agree by construction rather than by coincidence. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Narrow a stored string to an address, or null.
 *
 * `agent_address` and `holder_address` are `varchar(42)` and 0025 constrains only
 * that a clip proposer HAS one, never its shape. So `0x${string}` is a claim no
 * layer of the system makes, and asserting it with `as` told the ingest route it
 * did not need to check: `key.agentAddress` flows into `createAgentClip`, which
 * calls viem's `getAddress`, which THROWS on a malformed value. An unhandled 500
 * where a 403 belongs, produced by the type system saying yes on the database's
 * behalf. One `as`, immediately behind the test that earns it.
 */
export function asAddress(v: string | null | undefined): `0x${string}` | null {
  return typeof v === "string" && ADDRESS_RE.test(v) ? (v as `0x${string}`) : null;
}

export function bearerFrom(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * Resolve a bearer token to its key, or null.
 *
 * Null covers every failure — absent, malformed, unknown prefix, wrong secret,
 * revoked — on purpose: distinguishing them in the return value invites a caller
 * to report which, and "unknown key" vs "wrong secret" is an oracle for probing
 * valid prefixes.
 */
export async function resolveIngestKey(token: string | null): Promise<IngestKeyContext | null> {
  if (!token) return null;
  const parsed = parseToken(token);
  if (!parsed) return null;

  const row = await db.query.ingestKeys.findFirst({
    where: eq(ingestKeys.keyPrefix, parsed.keyPrefix),
  });
  if (!row || row.revokedAt) return null;
  if (!hashesEqual(row.keyHash, sha256Hex(parsed.secret))) return null;

  const capabilities = Array.isArray(row.capabilities) ? (row.capabilities as string[]) : [];
  const stationScope = Array.isArray(row.stationScope) ? (row.stationScope as string[]) : null;

  // Best-effort audit stamp. A failure here must never cost a valid request: the
  // key IS valid, and refusing it because a bookkeeping write failed would take
  // the reader offline for no integrity gain.
  void db
    .update(ingestKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(ingestKeys.id, row.id))
    .catch(() => {});

  return {
    id: row.id,
    label: row.label,
    sourceClass: row.sourceClass,
    capabilities,
    stationScope,
    agentAddress: asAddress(row.agentAddress),
    holderAddress: asAddress(row.holderAddress),
  };
}

/**
 * The human who answers for a credential, by key id. Returns null when the key is
 * gone or carries no holder.
 *
 * Callers MUST treat null as a refusal, never as "no conflict". That inversion is
 * the entire bug this exists to prevent: the obvious way to write the guard is to
 * look the human up and compare, which evaluates false on a null and PERMITS the
 * confirmation it was written to block. A guard that fails open is worse than no
 * guard, because it also produces the belief that the hole is closed.
 */
export async function holderOfKey(id: number): Promise<`0x${string}` | null> {
  const row = await db.query.ingestKeys.findFirst({ where: eq(ingestKeys.id, id) });
  return asAddress(row?.holderAddress);
}

export function keyCan(ctx: IngestKeyContext, capability: IngestCapability): boolean {
  return ctx.capabilities.includes(capability);
}

/** A scope of null means "any station"; otherwise the station must be listed. */
export function keyCoversStation(ctx: IngestKeyContext, stationId: string): boolean {
  return ctx.stationScope === null || ctx.stationScope.includes(stationId);
}
