import type { HumanRegistry } from "../lib/human/registry";
import type { HumanStore, Receipt } from "../lib/human/store";
import type { EnrollOutcome, Enrollment, VerificationStore } from "../lib/human/verifications";

/**
 * A registry and a store, faked, so the paths that only run when something is
 * wrong can be run.
 *
 * The identifiers below are invented. A real one is a World ID nullifier, which
 * links every registration one person makes under this action, so it belongs in a
 * database and never in a repository.
 */
export const HUMAN_A = 111111111111111111111111n;
export const HUMAN_B = 222222222222222222222222n;

/** Two of these belong to one person, which is the whole of criterion two. */
export const AGENT_ONE = "0x1111111111111111111111111111111111111111" as const;
export const AGENT_TWO = "0x2222222222222222222222222222222222222222" as const;
export const AGENT_OTHER = "0x3333333333333333333333333333333333333333" as const;
export const AGENT_UNREGISTERED = "0x4444444444444444444444444444444444444444" as const;

export type FakeRegistry = {
  read: HumanRegistry;
  hits: number;
  /** "ok" answers from the table; the others are the ways a lookup goes wrong. */
  mode: "ok" | "throws" | "hangs";
  reset(): void;
};

export function fakeRegistry(overrides?: Record<string, bigint>): FakeRegistry {
  const state = { hits: 0, mode: "ok" as FakeRegistry["mode"] };
  // The default table is two agents of one person and a third of another. A caller
  // can supply its own when the addresses have to be real ones derived from keys.
  const table: Record<string, bigint> = {
    [AGENT_ONE]: HUMAN_A,
    [AGENT_TWO]: HUMAN_A,
    [AGENT_OTHER]: HUMAN_B,
    ...(overrides ?? {}),
  };
  return {
    read: async agent => {
      state.hits++;
      if (state.mode === "throws") throw new Error("rpc said no");
      // Longer than the lookup's own patience, so the timeout is what ends it.
      if (state.mode === "hangs") return new Promise(() => {});
      return table[agent] ?? 0n;
    },
    get hits() {
      return state.hits;
    },
    get mode() {
      return state.mode;
    },
    set mode(v: FakeRegistry["mode"]) {
      state.mode = v;
    },
    reset() {
      state.hits = 0;
      state.mode = "ok";
    },
  };
}

export type FakeStore = HumanStore & {
  receipts: Receipt[];
  counted: number;
  reset(): void;
};

export function fakeStore(): FakeStore {
  // Uniqueness held here the way the database will hold it, so a replay is
  // observable in the checks rather than merely absent from them.
  let receipts: Receipt[] = [];
  const usage = new Map<string, number>();
  const key = (identifier: string, window: string) => `${identifier}:${window}`;
  return {
    // Check and increment in one step, with no await between them, so the fake is
    // not more forgiving than the statement it stands in for. Split these and two
    // takes racing at the limit both succeed, which is the bug this shape exists
    // to make impossible.
    tryTakeFreeRead: async (identifier, window, limit) => {
      const k = key(identifier, window);
      const used = usage.get(k) ?? 0;
      if (used >= limit) return false;
      usage.set(k, used + 1);
      return true;
    },
    forgetOlderThan: async (days, now) => {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      for (const k of [...usage.keys()]) if (k.split(":")[1] < cutoff) usage.delete(k);
    },
    recordReceipt: async receipt => {
      const clash = receipts.some(r => r.nonce === receipt.nonce || r.transactionHash === receipt.transactionHash);
      if (clash) return false;
      receipts.push(receipt);
      return true;
    },
    get receipts() {
      return receipts;
    },
    get counted() {
      return [...usage.values()].reduce((a, b) => a + b, 0);
    },
    reset() {
      receipts = [];
      usage.clear();
    },
  };
}

export type FakeVerifications = VerificationStore & {
  rows: Map<string, Enrollment>;
  claims: Map<string, string>;
  /** How many times each method was reached, so "the table was not consulted"
   *  is a count rather than a belief. */
  calls: { standingOf: number; claimResult: number; enroll: number };
  reset(): void;
};

/**
 * The enrollments, faked with the same two rules the statement carries, so a
 * check can plant a second wallet for one person or a second person for one
 * wallet and watch the refusal rather than assume it.
 */
export function fakeVerifications(): FakeVerifications {
  const rows = new Map<string, Enrollment>();
  const claims = new Map<string, string>();
  const calls = { standingOf: 0, claimResult: 0, enroll: 0 };
  return {
    rows,
    claims,
    calls,
    standingOf: async (payer, at) => {
      calls.standingOf++;
      const row = rows.get(payer);
      if (!row || row.expiresAt.getTime() <= at.getTime()) return null;
      return { nullifierDigest: row.nullifierDigest, credential: row.credential, expiresAt: row.expiresAt };
    },
    claimResult: async (nonce, proofDigest) => {
      calls.claimResult++;
      if (claims.has(nonce)) return false;
      if ([...claims.values()].includes(proofDigest)) return false;
      claims.set(nonce, proofDigest);
      return true;
    },
    releaseResult: async nonce => {
      claims.delete(nonce);
    },
    enroll: async (row): Promise<EnrollOutcome> => {
      calls.enroll++;
      const at = row.verifiedAt.getTime();
      for (const [payer, other] of rows) {
        if (payer !== row.payer && other.action === row.action && other.nullifierDigest === row.nullifierDigest && other.expiresAt.getTime() > at) {
          return "another-wallet";
        }
      }
      const held = rows.get(row.payer);
      if (held && held.nullifierDigest !== row.nullifierDigest && held.expiresAt.getTime() > at) return "another-person";
      rows.set(row.payer, { ...row });
      return "recorded";
    },
    forgetExpired: async at => {
      for (const [payer, row] of [...rows]) if (row.expiresAt.getTime() <= at.getTime()) rows.delete(payer);
    },
    reset() {
      rows.clear();
      claims.clear();
      calls.standingOf = 0;
      calls.claimResult = 0;
      calls.enroll = 0;
    },
  };
}
