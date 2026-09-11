import type { EnvLike } from "../agent/pay";
import { deriveIdentifier } from "./derive";
import { type HumanRegistry, humanBehind, registryFrom } from "./registry";
import { type HumanStore, type Receipt, assertNotFabricated, freeReadsPerDay, storeFrom, utcDay } from "./store";

/**
 * The allowance, and the one thing that makes it safe.
 *
 * The address this keys on comes out of the payment payload, where the client put
 * it. That is only trustworthy because the payment has already been verified: the
 * facilitator recovers the EIP-3009 signature against that same address, so a
 * caller who wrote somebody else's address there fails verification and never
 * reaches this code. Looking the human up before verifying would let anyone spend
 * anyone's free reads by naming them, which is why the order in the route is not
 * a matter of taste.
 */
/** Declared in the privacy notice, and enforced on the write path. */
export const RETENTION_DAYS = 30;

export type Cap = {
  registry: HumanRegistry;
  store: HumanStore | null;
  freePerDay: number;
};

let override: Cap | null = null;

/** The same seam the resource server uses, for the same reason: these paths are
 *  only interesting when something is wrong, and a chain and a database are poor
 *  ways to arrange that. */
export function setCapForTest(cap: Cap | null): void {
  override = cap;
}

export function capFrom(env: EnvLike = process.env): Cap {
  if (override) return override;
  return { registry: registryFrom(env), store: storeFrom(env), freePerDay: freeReadsPerDay(env) };
}

/** The authorization the client signed. Its shape is the exact scheme's, read from
 *  the implementation rather than assumed. */
export type Authorization = { from: string; to: string; value: string; nonce: string };

export function authorizationFrom(paymentPayload: { payload?: unknown }): Authorization | null {
  const inner = (paymentPayload.payload ?? {}) as { authorization?: Partial<Authorization> };
  const a = inner.authorization;
  // All four or nothing. Filling a missing field with an empty string would put a
  // receipt in the ledger recording a payment to nobody of no amount, which is
  // worse than the missing row: a wrong record is believed, an absent one is not.
  if (!a || typeof a.from !== "string" || typeof a.nonce !== "string") return null;
  if (typeof a.to !== "string" || typeof a.value !== "string") return null;
  return { from: a.from, to: a.to, value: a.value, nonce: a.nonce };
}

/**
 * Take one free read for the human behind this payer, or say no.
 *
 * Every way of saying no is the same answer to the caller, which is to settle:
 * no store configured, an address the registry does not know, a lookup that threw
 * or timed out, an allowance already spent, or a counter that would not write.
 * Distinguishing them would offer a decision nobody has to make, and each of them
 * means only that this read cannot be given away.
 */
export async function takeFreeRead(payer: string, env: EnvLike = process.env, now: Date = new Date()): Promise<boolean> {
  const cap = capFrom(env);
  if (!cap.store) return false;
  try {
    const identifier = await humanBehind(payer as `0x${string}`, cap.registry);
    if (identifier === null) return false;
    // Never the raw nullifier. What is stored is a keyed derivation of it, so a
    // copy of that table on its own cannot be matched against on chain
    // registrations. A missing key throws and lands in the catch below, which
    // settles: no key, no allowance, same direction as every other failure here.
    const stored = deriveIdentifier(identifier, env);

    // Retention runs before the take rather than after it, and on the request path
    // rather than on a schedule. Before, so a request that takes nothing still
    // purges; on the request path, so the declared period does not depend on a cron
    // somebody can switch off without anyone noticing. A day with no reads at all
    // purges on the next read there is.
    await cap.store.forgetOlderThan(RETENTION_DAYS, now);

    // One call, because the comparison and the increment must not be separable.
    // Asking how many are left and then taking one is two operations, and two
    // requests from the same person at the limit minus one would both be told
    // there was one left. The limit travels into the statement instead.
    return await cap.store.tryTakeFreeRead(stored, utcDay(now), cap.freePerDay);
  } catch {
    return false;
  }
}

/** Records a settlement, once. Nothing about the response depends on this: a
 *  receipt that cannot be written must not turn a paid read into a refusal. */
export async function recordSettlement(receipt: Receipt, env: EnvLike = process.env): Promise<void> {
  const cap = capFrom(env);
  if (!cap.store) return;
  try {
    // Before the store, so no implementation has to be trusted to carry the guard
    // and the fabricated one never becomes a query.
    assertNotFabricated(receipt);
    await cap.store.recordReceipt(receipt);
  } catch (err) {
    // Swallowed on purpose and never silently. The caller has been charged and
    // served, so failing their request over a bookkeeping write would be the
    // larger wrong, but a receipt that went missing has to be findable afterwards
    // or the ledger quietly disagrees with the chain and nobody knows when it
    // started.
    console.error(
      `receipt not recorded for settlement ${receipt.transactionHash}: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}
