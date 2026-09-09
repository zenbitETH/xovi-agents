-- Hand-authored (NOT drizzle-kit generate) — the custom runner db-migrate.ts reads
-- .sql files directly and tracks them in xovi_migrations, so meta/_journal +
-- snapshots are intentionally NOT updated (same as 0004-0026).
--
-- RE-RUN BEHAVIOUR: idempotent. ADD COLUMN IF NOT EXISTS and CREATE UNIQUE INDEX
-- IF NOT EXISTS only.
--
-- == What "a human confirmed this" is worth ===================================
-- Today the chain of custody for that sentence is a cookie. An iron-session
-- establishes a verifier, the route writes verified_by, and an attestation is
-- signed by a BACKEND key. So possession of that key, or of POSTGRES_URL, mints a
-- record byte-identical to a genuine one and anchored with equal weight. The
-- converse is just as bad: a genuine confirmation cannot be PROVED to a third
-- party either, because there is nothing to show them but a database row the
-- server wrote about itself.
--
-- The anchor makes this permanent. EAS timestamp() reverts on a repeat, so
-- whatever the confirmation record is at the moment of first anchoring is what the
-- chain attests to, forever. That is the deadline: not the end of the sprint, but
-- the first anchored confirmation.
--
-- So the operator signs. The columns below hold that signature, the nonce that
-- makes it single use, and when it was produced.
--
-- Scope note. This is the "sign everything" option, deliberately, over signing
-- only what gets anchored. Signing the anchored subset would leave membership of
-- the provable set decided by an unprovable process, and a signature cannot be
-- backfilled: every confirmation made before the change would stay unprovable for
-- good. A narrower version is not a smaller version of this, it is this with a
-- permanent hole and a start date.

-- `text`, not varchar(132). 132 characters is exactly one ECDSA signature, and the
-- login route already accepts contract signatures, so a 2-of-3 Safe holding an
-- allow-listed session would have been truncated or refused. Sizing a column to the
-- cheapest signer is how you discover the expensive one in production.
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "verifier_signature" text;
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "verifier_nonce" varchar(66);
--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "verifier_signed_at" timestamp;
--> statement-breakpoint
-- Without this the published record is unverifiable. /api/clips is a public,
-- unauthenticated read that returns whole rows, so the signature and nonce go out to
-- the world; the chain id is part of the signed message, so a third party who cannot
-- read it cannot reconstruct what was signed. Taken from the SIWE session, which
-- already validated it against an allow-list, never from the request body.
ALTER TABLE "clips" ADD COLUMN IF NOT EXISTS "verifier_chain_id" integer;
--> statement-breakpoint

-- Single use, enforced by the database rather than by the route remembering to
-- check. Partial because indexing thousands of nulls is waste, NOT because a plain
-- unique index would collapse them: PostgreSQL treats nulls as distinct in a unique
-- index by default, so unlimited nulls are already permitted. An earlier version of
-- this comment gave the wrong reason for the right decision.
CREATE UNIQUE INDEX IF NOT EXISTS "clips_verifier_nonce_unq"
  ON "clips" USING btree ("verifier_nonce") WHERE "verifier_nonce" IS NOT NULL;
--> statement-breakpoint

-- NOT backfilled and NOT made NOT NULL. Rows confirmed before this migration were
-- confirmed by a cookie and there is no honest way to say otherwise: a signature
-- cannot be produced after the fact for a decision someone already made. A null
-- signature on a decided clip means exactly "confirmed before signatures existed",
-- and any claim made about the archive has to say so.
COMMENT ON COLUMN "clips"."verifier_signature" IS
  'EIP-191 signature over the confirmation payload. NULL means the row was decided before 0027, by session alone.';
