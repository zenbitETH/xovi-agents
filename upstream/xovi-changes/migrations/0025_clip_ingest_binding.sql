-- Hand-authored (NOT drizzle-kit generate) — the custom runner db-migrate.ts reads
-- .sql files directly and tracks them in xovi_migrations, so meta/_journal +
-- snapshots are intentionally NOT updated (same as 0004-0024).
--
-- NUMBERING: 0024 is the latest on dev. 0023 stays reserved for PR #40's
-- 0023_attestation_anchor.sql. 0013-0015 remain contested and are not reusable.
--
-- RE-RUN BEHAVIOUR: idempotent. ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, and constraints in DO blocks that swallow duplicate_object.
--
-- == Why a clip needs to name the credential that made it ======================
-- 0024 recorded WHAT produced a row (source = user | cv). It did not record WHICH
-- credential, and that gap is load bearing.
--
-- The self-review guard compares clips.submitter_address against the confirming
-- operator, which works while every submitter is a person. It stops working the
-- moment a person can delegate: the operator holds the credential, the credential
-- has its own fresh address, the two addresses do not match, and the guard permits
-- the operator to confirm their own agent's proposal.
--
-- Resolving the human by wallet lookup does NOT fix it. A delegated agent's
-- address is in neither `users` nor `linked_wallets`, so the lookup returns null,
-- the natural guard evaluates false, and it PERMITS. Shipping that would convert
-- an open hole into a hole plus a false belief that it was closed.
--
-- So the credential carries both addresses and every machine row names its
-- credential. The guard then compares the responsible human, which is a question
-- the database can actually answer.

ALTER TABLE "ingest_keys" ADD COLUMN IF NOT EXISTS "agent_address" varchar(42);
--> statement-breakpoint
ALTER TABLE "ingest_keys" ADD COLUMN IF NOT EXISTS "holder_address" varchar(42);
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "ingest_key_id" integer;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_ingest_key_id_fk"
    FOREIGN KEY ("ingest_key_id") REFERENCES "ingest_keys"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clips_ingest_key_idx" ON "clips" USING btree ("ingest_key_id");
--> statement-breakpoint

-- Machine provenance and a named credential are the same fact, so the database
-- refuses to hold one without the other. A cv row with no credential would be
-- unattributable; a credentialled row claiming human provenance would be a lie
-- with a receipt attached.
DO $$ BEGIN
  ALTER TABLE "clips" ADD CONSTRAINT "clips_cv_names_its_credential_check"
    CHECK (("source" = 'cv') = ("ingest_key_id" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- `capabilities` is jsonb and its closed set really is only a TypeScript ceiling,
-- as 0022 and apiKey.ts both say. This does not change that. It enforces one
-- narrower thing the database CAN check: a key allowed to propose clips must
-- carry the address those clips will be attributed to, because submitter_address
-- is part of computeClipHash and a machine has no session to derive one from.
-- The jsonb `?` operator tests membership in a jsonb array.
DO $$ BEGIN
  ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_clip_proposer_has_agent_address_check"
    CHECK (NOT ("capabilities" ? 'clips:propose') OR "agent_address" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
