import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnvLike } from "../agent/pay";

/**
 * What actually gets stored in place of the identifier.
 *
 * The registry's value is a World ID nullifier. It names nobody, and it is the same
 * value across every registration one person makes under this action, which is what
 * makes it useful for a per person cap and what makes it personal data rather than
 * anonymous data: a stable link is still a link.
 *
 * That it is readable by anyone on chain does not make storing it in the clear
 * harmless. What a keyed derivation reduces is the linkability of THIS database, not
 * the linkability of the contract: without the key, rows here cannot be matched
 * against on chain registrations, so a copy of this table on its own says only that
 * some person took some free reads on some day.
 *
 * The key lives in the environment and never in the repository. With no key there is
 * no derivation, so there is no allowance and every read settles, which is the same
 * direction everything else in this feature fails in.
 */
export class NoDerivationKey extends Error {}

export function deriveIdentifier(identifier: bigint, env: EnvLike = process.env): string {
  const key = (env.HUMAN_ID_KEY ?? "").trim();
  if (key.length < 32) {
    throw new NoDerivationKey("HUMAN_ID_KEY is missing or shorter than 32 characters");
  }
  return createHmac("sha256", key).update(identifier.toString()).digest("hex");
}

/** Exported so a check can assert the derivation is stable and key dependent
 *  without either value appearing in a comparison that leaks by timing. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
