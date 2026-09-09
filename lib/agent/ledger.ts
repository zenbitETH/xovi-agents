import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { CandidateWindow } from "../windows/types";

/**
 * The windows a person has already refused.
 *
 * A rejection on the Xovi side binds the window tuple, meaning the channel, the
 * video, the two times and the station, with no alias and no behaviour tag in the
 * key. So proposing a different candidate over the same span is not a new clip and
 * is refused again. An agent that walks its `candidates` array after a refusal
 * collects one refusal per candidate and learns nothing from any of them.
 *
 * `windowId` is a hash of exactly that tuple, which is why this keys on it alone.
 * Putting the alias or the tag in the key would let a roster refresh re-propose a
 * moment a person has already looked at and declined.
 *
 * This is a local cache of a decision the server owns. Losing the file costs a
 * wasted 409, never a wrong proposal: the server refuses again regardless. The
 * file exists so the agent stops asking, not so the rule is enforced here.
 */
export type Ledger = {
  has(windowId: string): boolean;
  /** Writes through to disk before returning, so a crash cannot lose a refusal. */
  remember(windowId: string, why: string): void;
  size(): number;
};

export const DEFAULT_LEDGER_PATH = ".agent-ledger.json";

function readFile(path: string): Record<string, string> {
  // No prototype. A window id is a hash and will not collide with __proto__ by
  // accident, but a plain object literal would silently drop that key instead of
  // storing it, and a ledger that silently drops a refusal is the one failure this
  // file exists to prevent.
  const empty = () => Object.create(null) as Record<string, string>;
  if (!existsSync(path)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    // A ledger that cannot be read is treated as empty rather than as a reason to
    // stop. The consequence is a repeated 409, which the server answers correctly;
    // the alternative, refusing to run, would let a corrupt local file halt an
    // agent whose actual authority lives on the other side.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return empty();
    return Object.assign(empty(), parsed);
  } catch {
    return empty();
  }
}

export function loadLedger(path: string = DEFAULT_LEDGER_PATH): Ledger {
  const entries = readFile(path);
  return {
    has: windowId => Object.prototype.hasOwnProperty.call(entries, windowId),
    remember: (windowId, why) => {
      entries[windowId] = why;
      // Written here rather than at the end of a run. A refusal recorded only in
      // memory is indistinguishable from one that was never issued the moment the
      // process stops, and the next run would propose the same window again.
      //
      // Through a temporary file and a rename, because the write is not append-only:
      // it rewrites the whole map every time, so a process dying mid-write would
      // truncate every refusal ever recorded rather than lose the newest one. A
      // rename within a directory is atomic, so a reader sees the old file or the
      // new one and never a half of either.
      const staging = `${path}.tmp`;
      writeFileSync(staging, `${JSON.stringify(entries, null, 2)}\n`);
      renameSync(staging, path);
    },
    size: () => Object.keys(entries).length,
  };
}

/** Windows this ledger has not already seen refused. Order is preserved. */
export function unrefused(windows: CandidateWindow[], ledger: Ledger): CandidateWindow[] {
  return windows.filter(w => !ledger.has(w.windowId));
}

/**
 * A ledger that forgets, for a run that has nowhere to write.
 *
 * The file backed ledger exists so an agent stops asking about a window a person
 * already refused. A serverless run has no writable disk and no continuity between
 * invocations, so it cannot hold that memory and must not pretend to. Starting
 * empty means a window refused earlier is proposed again and the ingest route
 * answers 409, which is the correct answer and is shown in the run rather than
 * hidden: the server owns the rule, this was only ever a cache of it.
 */
export function memoryLedger(): Ledger {
  const entries = new Map<string, string>();
  return {
    has: windowId => entries.has(windowId),
    remember: (windowId, why) => void entries.set(windowId, why),
    size: () => entries.size,
  };
}
