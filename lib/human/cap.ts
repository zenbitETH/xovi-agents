import type { EnvLike } from "../agent/pay";
import { deriveIdentifier } from "./derive";
import { type HumanRegistry, UNREGISTERED, humanBehind, registryFrom } from "./registry";
import { FabricatedReceipt, type HumanStore, type Receipt, assertNotFabricated, freeReadsPerDay, storeFrom, utcDay } from "./store";
import { type Standing, type VerificationStore, verificationStoreFrom } from "./verifications";

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
  /** The second source of a person behind a wallet: enrollments made from the
   *  page. Null when there is no database, in which case AgentBook is the only
   *  source, which is what this was before the enrollment existed. */
  verifications: VerificationStore | null;
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
  return { registry: registryFrom(env), store: storeFrom(env), verifications: verificationStoreFrom(env), freePerDay: freeReadsPerDay(env) };
}

/**
 * Who stands behind a wallet, from either source, as the digest the counter is
 * keyed on.
 *
 * AgentBook first and the table second, and a wallet in both answers AgentBook.
 * The two sources hold different values for one person: AgentBook keeps the
 * nullifier of the registration tool's own action, and the table keeps a digest
 * of the nullifier World scopes to this relying party and action, so the two
 * cannot be joined and a person holding both a registration and an enrollment
 * holds two digests. That is a limit of the identifiers rather than of this code,
 * and it is why the table refuses a second wallet per person on its own key.
 *
 * For the AgentBook source the digest is derived here; for the table it is the
 * stored value, read back and never derived again, since the derivation already
 * happened when the row was written and doing it twice would be two places to
 * get it wrong.
 */
export type StandingBehind = { digest: string; source: "agentbook" | "worldid"; credential: string | null };

export async function standingBehind(payer: string, cap: Cap, env: EnvLike, at: Date): Promise<StandingBehind | null> {
  const identifier = await humanBehind(payer as `0x${string}`, cap.registry);
  if (identifier !== null) return { digest: deriveIdentifier(identifier, env), source: "agentbook", credential: null };
  if (!cap.verifications) return null;
  const standing = await tableStanding(cap.verifications, payer, at);
  return standing ? { digest: standing.nullifierDigest, source: "worldid", credential: standing.credential } : null;
}

/**
 * The table, asked. Lapsed rows are deleted before the read, every time the
 * table is consulted and not only when a row is found: a wallet whose enrollment
 * lapsed and who reads again is the request that must delete its own row, or the
 * declared thirty days hold only while somebody else keeps enrolling. It runs
 * here rather than in the callers so the AgentBook path, which never reaches the
 * table, never writes to it either.
 */
async function tableStanding(table: VerificationStore, payer: string, at: Date): Promise<Standing | null> {
  await table.forgetExpired(at);
  return table.standingOf(payer.toLowerCase(), at);
}

/**
 * What the registration route answers, in three states and with the source named.
 *
 * Unread is kept apart from not registered, as before: it is an answer about a
 * read and not about the wallet. It is answered only when NO source could say
 * yes and at least one could not be asked; a table that holds a row answers
 * registered whatever the chain did, because the row is the fact.
 */
export type Registration = {
  state: "registered" | "not-registered" | "unread";
  source: "agentbook" | "worldid" | null;
  credential: string | null;
};

export async function registrationOf(payer: string, cap: Cap, at: Date): Promise<Registration> {
  let onChain: bigint | "unread";
  try {
    onChain = await cap.registry(payer as `0x${string}`);
  } catch {
    onChain = "unread";
  }
  if (onChain !== "unread" && onChain !== UNREGISTERED) return { state: "registered", source: "agentbook", credential: null };

  let inTable: Standing | null | "unread" = null;
  if (cap.verifications) {
    try {
      inTable = await tableStanding(cap.verifications, payer, at);
    } catch {
      inTable = "unread";
    }
  }
  if (inTable !== null && inTable !== "unread") return { state: "registered", source: "worldid", credential: inTable.credential };
  if (onChain === "unread" || inTable === "unread") return { state: "unread", source: null, credential: null };
  return { state: "not-registered", source: null, credential: null };
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
    // Never the raw nullifier. What is keyed on is a keyed derivation of it, so a
    // copy of that table on its own cannot be matched against on chain
    // registrations. A missing key throws and lands in the catch below, which
    // settles: no key, no allowance, same direction as every other failure here.
    // The allowance is the configured number for either source: version 4 of
    // World ID offers no credential below proof of human, so there is no lower
    // tier to give fewer reads to.
    const standing = await standingBehind(payer, cap, env, now);
    if (standing === null) return false;
    const stored = standing.digest;

    // Retention runs before the take rather than after it, and on the request path
    // rather than on a schedule. Before, so a request that takes nothing still
    // purges; on the request path, so the declared period does not depend on a cron
    // somebody can switch off without anyone noticing. A day with no reads at all
    // purges on the next read there is. Lapsed enrollments are purged the same
    // way, inside `standingBehind`, whenever the table is asked.
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
    if (err instanceof FabricatedReceipt) {
      // A refusal, not a failure, and it must not borrow the failure's sentence.
      // Every run against the fake facilitator reaches this line, so wording it as a
      // bookkeeping error trains a reader to skim the one line they must not skim on
      // the day it appears in production, where it means a demo process is pointed at
      // the real ledger.
      console.warn(`ledger guard: refused a fabricated settlement ${receipt.transactionHash} and wrote no row. In production this means a demo run is pointed at a real database.`);
      return;
    }
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
