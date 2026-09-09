// Copied from the private Xovi repository at origin/dev 2754a0eb (2026-09-08) for the public patch set.
// Not runnable on its own: it imports Xovi modules that are not included here.
import { NextResponse } from "next/server";
import { z } from "zod";
import { BEHAVIOR_TAGS } from "~~/lib/clips/behaviorCatalog";
import { MAX_CLIP_DURATION_SECONDS } from "~~/lib/clips/limits";
import { CLIP_SOURCES, toMillisecondQuantum } from "~~/lib/clips/sources";
import { bearerFrom, keyCan, keyCoversStation, resolveIngestKey } from "~~/lib/ingest/apiKey";
import { clientIpFrom, rateLimitAllow } from "~~/lib/rateLimit";
import { getSpecimenData, isValidClipTarget } from "~~/lib/specimens/fetchSpecimens";
import { SPECIES_CODES } from "~~/lib/specimens/types";
import { ClipDuplicateError, ClipRejectedError, createAgentClip } from "~~/services/database/repositories/clips";

export const dynamic = "force-dynamic";

const MAX_CLIP_SECONDS = 86_400; // 24h DVR ceiling, matching /api/clips
const PER_KEY_PER_HOUR = 240;
const PER_IP_PER_HOUR = 600;
// Charged only to callers who failed to authenticate, so a flood costs them their
// own bucket and costs a valid credential nothing.
const ANON_PER_HOUR = 120;
// Free: a header regex, no I/O at all. The agent ALWAYS sends a bearer, so a request
// with none is unambiguously not it, and can be shed before any database work. This
// is the doorway protection the original ordering wanted, without the lockout it
// caused, because it can never be reached by an authenticated caller.
const NO_BEARER_PER_HOUR = 60;

function tooMany() {
  return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429, headers: { "Retry-After": "3600" } });
}

/**
 * A machine proposes a clip. It cannot confirm one, and this route is not where
 * that is enforced: `IngestCapability` has no confirm member and /api/verify/[id]
 * has no bearer branch, so the refusal is structural to the credential rather
 * than a check written here. Stated precisely, because the difference matters:
 * `capabilities` is untyped jsonb, so the closed set is enforced by the
 * credential's server-side allow-list, not by a database constraint.
 *
 * Provenance is DERIVED, never read. `source` is 'cv' because the caller
 * authenticated with an ingest key, and `submitter_address` comes from the key's
 * agent_address rather than from the body. A machine that could name its own
 * submitter could attribute its work to a person, and submitter_address is part
 * of computeClipHash, so it would also be forging clip identity.
 */
const proposeSchema = z
  .object({
    channelId: z.string().min(1).max(32),
    videoId: z
      .string()
      .min(1)
      .max(16)
      .regex(/^[A-Za-z0-9_-]+$/, "videoId must be a YouTube id (alphanumeric, dash, underscore)"),
    startTime: z.number().min(0).max(MAX_CLIP_SECONDS).transform(toMillisecondQuantum),
    endTime: z.number().positive().max(MAX_CLIP_SECONDS).transform(toMillisecondQuantum),
    behaviorTag: z.enum(BEHAVIOR_TAGS),
    behaviorNote: z.string().trim().min(3).max(280).nullish(),
    speciesCode: z.enum(SPECIES_CODES),
    stationId: z.string().min(1).max(16),
    specimenAlias: z.string().min(1).max(64).nullish(),
    // Per-mille, matching clips.confidence. Required: a proposal with no stated
    // confidence is not a machine proposal, it is an assertion.
    // (redacted for the public patch set: a comparison with another schema)
    confidence: z.number().int().min(0).max(1000),
    // Accepted only so it can be REFUSED with a reason. Silently ignoring a
    // claimed source would let a caller believe it had been honoured. Typed as the
    // closed set rather than a bare string, so "banana" is a 400 naming the legal
    // values and "user" is the 403 below.
    source: z.enum(CLIP_SOURCES).optional(),
  })
  .refine(d => d.endTime > d.startTime, { message: "endTime debe ser mayor que startTime", path: ["endTime"] })
  .refine(d => d.endTime - d.startTime <= MAX_CLIP_DURATION_SECONDS, {
    message: `Los clips duran máximo ${MAX_CLIP_DURATION_SECONDS} segundos.`,
    path: ["endTime"],
  })
  // "Otro" without a description is unverifiable, and the note IS the behaviour.
  // /api/clips has refused this since it shipped; without the same rule here a
  // machine could fill the review queue with proposals no human can act on, which
  // is a denial of service against the reviewers rather than against the server.
  .refine(d => d.behaviorTag !== "other" || (d.behaviorNote?.trim().length ?? 0) >= 3, {
    message: "Describe el comportamiento en la nota.",
    path: ["behaviorNote"],
  });

export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers);

  // Authenticate FIRST, and bucket the anonymous caller on the failure path only.
  //
  // The first version of this route charged a shared per-IP bucket above the 401,
  // with a comment claiming it saved a database round trip. Both halves were wrong.
  // rateLimitAllow is an INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so it is a
  // WRITE, while resolveIngestKey is one indexed read on key_prefix: the route paid
  // a write to avoid a read. And a shared doorway bucket meant anonymous traffic
  // from the museum LAN, which is the agent's own egress, could exhaust the budget
  // the agent must also pass before its per-credential budget was touched at all.
  //
  // app/api/subscribe/route.ts made exactly this correction on the money surface and
  // states the principle: a credential being free to attempt is a reason to bucket
  // the attempt, not a reason to bucket the doorway.
  const bearer = bearerFrom(request);
  if (!bearer) {
    if (!(await rateLimitAllow(`ingest:clips:nobearer:${ip}`, NO_BEARER_PER_HOUR, 3600))) return tooMany();
    return NextResponse.json({ error: "Clave de ingesta inválida" }, { status: 401 });
  }

  const key = await resolveIngestKey(bearer);
  if (!key) {
    // ENFORCED, not merely counted. The first version of this awaited the call and
    // discarded its result, so ANON_PER_HOUR could take any value without changing a
    // single response: a counter that cannot refuse is a write amplifier on the one
    // path an attacker fully controls, and it removed the only load shedding the
    // unauthenticated path had.
    if (!(await rateLimitAllow(`ingest:clips:anon:${ip}`, ANON_PER_HOUR, 3600))) return tooMany();
    return NextResponse.json({ error: "Clave de ingesta inválida" }, { status: 401 });
  }
  if (!keyCan(key, "clips:propose")) {
    return NextResponse.json({ error: "La clave no puede proponer clips" }, { status: 403 });
  }
  if (!key.agentAddress) {
    // 0025 has a CHECK that makes this unreachable through normal issuance. It is
    // kept because a CHECK added later cannot retroactively fix a row written
    // before it, and because failing closed here costs nothing.
    return NextResponse.json({ error: "La clave no tiene dirección de agente" }, { status: 403 });
  }
  if (!(await rateLimitAllow(`ingest:clips:key:${key.id}`, PER_KEY_PER_HOUR, 3600))) return tooMany();
  // The per-IP ceiling still exists, but now only an authenticated caller can spend
  // it, so no anonymous traffic can lock a valid credential out of its own endpoint.
  if (!(await rateLimitAllow(`ingest:clips:ip:${ip}`, PER_IP_PER_HOUR, 3600))) return tooMany();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = proposeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  // A machine may never claim human provenance. That value is what "a person
  // answers for this" MEANS, and the whole provenance model rests on it not
  // being forgeable from a script. Refused rather than overwritten, so a caller
  // that tried learns that it tried.
  if (d.source !== undefined && d.source !== "cv") {
    return NextResponse.json(
      { error: "Una máquina no puede declarar procedencia humana: esa procedencia significa que alguien responde" },
      { status: 403 },
    );
  }
  if (!keyCoversStation(key, d.stationId)) {
    return NextResponse.json({ error: `La clave no cubre la estación ${d.stationId}` }, { status: 403 });
  }

  const specimenData = await getSpecimenData();
  const specimenAlias = d.specimenAlias ?? null;
  if (!isValidClipTarget(specimenData, d.speciesCode, d.stationId, specimenAlias)) {
    return NextResponse.json({ error: "El objetivo del clip no existe" }, { status: 422 });
  }

  try {
    const row = await createAgentClip(
      {
        channelId: d.channelId,
        videoId: d.videoId,
        startTime: d.startTime,
        endTime: d.endTime,
        behaviorTag: d.behaviorTag,
        // Force-null for catalog tags, matching /api/clips: a note smuggled
        // alongside a non-"other" tag is never persisted.
        behaviorNote: d.behaviorTag === "other" ? (d.behaviorNote ?? null) : null,
        behaviorMetric: null,
        participants: null,
        speciesCode: d.speciesCode,
        stationId: d.stationId,
        specimenAlias,
        submitterAddress: key.agentAddress,
      },
      { ingestKeyId: key.id, confidence: d.confidence },
    );
    return NextResponse.json(
      { id: row.id, clipHash: row.clipHash, status: row.status, source: row.source },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ClipRejectedError) {
      // Distinct from a duplicate on purpose. A duplicate is worth retrying later;
      // this is a person having looked at exactly this and said no, and an agent
      // should be built to stop rather than to back off.
      return NextResponse.json(
        { error: "Esta propuesta ya fue rechazada por una persona", clipHash: err.clipHash, retryable: false },
        { status: 409 },
      );
    }
    if (err instanceof ClipDuplicateError) {
      return NextResponse.json({ error: "Clip duplicado", clipHash: err.clipHash, retryable: true }, { status: 409 });
    }
    throw err;
  }
}
