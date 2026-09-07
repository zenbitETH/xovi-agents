import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    // A ledger that cannot be read is treated as empty rather than as a reason to
    // stop. The consequence is a repeated 409, which the server answers correctly;
    // the alternative, refusing to run, would let a corrupt local file halt an
    // agent whose actual authority lives on the other side.
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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
      writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
    },
    size: () => Object.keys(entries).length,
  };
}

/** Windows this ledger has not already seen refused. Order is preserved. */
export function unrefused(windows: CandidateWindow[], ledger: Ledger): CandidateWindow[] {
  return windows.filter(w => !ledger.has(w.windowId));
}
