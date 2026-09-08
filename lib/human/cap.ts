import type { EnvLike } from "../agent/pay";
import { type HumanRegistry, humanBehind, registryFrom } from "./registry";
import { type HumanStore, type Receipt, freeReadsPerDay, storeFrom, utcDay } from "./store";

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
    // One call, because the comparison and the increment must not be separable.
    // Asking how many are left and then taking one is two operations, and two
    // requests from the same person at the limit minus one would both be told
    // there was one left. The limit travels into the statement instead.
    return await cap.store.tryTakeFreeRead(identifier.toString(), utcDay(now), cap.freePerDay);
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
