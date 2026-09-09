import type { HumanRegistry } from "../lib/human/registry";
import type { HumanStore, Receipt } from "../lib/human/store";

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
