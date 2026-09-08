-- Hand-authored (NOT drizzle-kit generate) — the custom runner db-migrate.ts reads
-- .sql files directly and tracks them in xovi_migrations, so meta/_journal +
-- snapshots are intentionally NOT updated (same as 0004–0022).
--
-- NUMBERING: 0022 is the latest on dev. 0023 is RESERVED for PR #40's
-- 0023_attestation_anchor.sql by the rebase rule in docs/onchain/README.md, so this
-- takes 0024 even though it lands first. 0013–0015 remain contested by two unmerged
-- branches and are not reusable.
--
-- RE-RUN BEHAVIOUR: every statement below is genuinely idempotent — ADD COLUMN IF
-- NOT EXISTS, an UPDATE with a WHERE that matches nothing on a second pass, a
-- SET NOT NULL that is already true, DROP DEFAULT on a column with no default, and
-- constraints wrapped in DO blocks that swallow duplicate_object. This is stated
-- because 0022's header made the same claim about a DIFFERENT file's bare
-- CREATE TABLE, where it was false.
--
-- ── Why clips need provenance at all ─────────────────────────────────────────
-- `clips` has no provenance column. Every row looks like a human submission
-- because until now every row was one. The moment a machine can propose a clip,
-- "who observed this" stops being answerable, and an attestation over an
-- unanswerable row is worse than no attestation.
--
-- ADR-007 designed both of these columns and the implementation dropped them:
-- buildBehaviorMetric hardcodes `source: "user" as const`, so no code path in Xovi
-- can write cv provenance today. This restores what that ADR specified.

ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "source" varchar(24);
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "confidence" integer;
--> statement-breakpoint

-- Every pre-existing row IS a human submission — the only insert path that has
-- ever existed writes from a SIWE session. Backfilling 'user' is a statement of
-- fact, not a default.
UPDATE "clips" SET "source" = 'user' WHERE "source" IS NULL;
--> statement-breakpoint
ALTER TABLE "clips" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint

-- The closed set is a DATABASE constraint here, unlike ingest_keys.capabilities,
-- which is untyped jsonb and therefore only a TypeScript ceiling. Say the
-- difference out loud when describing either one.
DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_source_check" CHECK ("source" IN ('user', 'cv'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Per-mille 0–1000 (integer per mille; redacted for the public patch set: a comparison with another schema)
-- schema so an attestation encodes without a float round-trip.
DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_confidence_range_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- NULL confidence means "no model produced this", which is the truth for every
-- human row — pinning 1000 on a legacy row would assert a certainty it never
-- claimed. A cv row has no such excuse.
DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_cv_needs_confidence_check"
    CHECK ("source" <> 'cv' OR "confidence" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── H1 ───────────────────────────────────────────────────────────────────────
-- status DEFAULT 'verified' was deliberate grandfathering for rows that predate
-- open review. It is now a loaded gun: any insert path that forgets `status`
-- publishes its row as trusted, and the machine path is exactly such a path.
-- After this, omitting status raises NOT NULL instead.
--
-- Verified safe before dropping: all three existing insert paths set it —
-- repositories/clips.ts:110 ('pending'), scripts-js/seed-album-demo.ts,
-- scripts-js/reclassify-clip.ts (explicit column list).
ALTER TABLE "clips" ALTER COLUMN "status" DROP DEFAULT;
