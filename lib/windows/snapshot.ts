import { readFileSync } from "fs";
import { isAbsolute, resolve } from "path";
import { type CandidateWindow, windowProblems } from "./types";

/** Only string lookups are needed, so the tests can pass a plain object
 *  instead of casting a partial to the full process environment. */
export type EnvLike = Record<string, string | undefined>;

export class SnapshotUnavailable extends Error {}

/**
 * Load the window snapshot.
 *
 * The endpoint reads a COPY, never the detector's live output directory. That
 * directory is a write target: the producer's evaluator overwrites its result
 * file unconditionally and its frame harvester rewrites the manifest, so reading
 * it at request time would let a routine upgrade on the producer's side silently
 * change what a paid endpoint serves, and the first sign would be a caller
 * noticing before either side did.
 *
 * It also matters that the set is snapshotted rather than recomputed. The
 * detector's threshold is a percentile of each segment's own series, so the same
 * footage cut at different boundaries yields a different set of windows. Each
 * window is deterministic for a given cut, which is what makes a snapshot a
 * record rather than one arbitrary result frozen and sold repeatedly.
 */
export function loadSnapshot(env: EnvLike = process.env): CandidateWindow[] {
  const configured = env.WINDOWS_SNAPSHOT;
  if (!configured || configured.trim().length === 0) {
    // Deliberately NOT an empty list. An empty list means the detector found
    // nothing, which is a real and correct answer; an unset path means nobody
    // configured this endpoint. Conflating them would sell a misconfiguration as
    // a measurement.
    throw new SnapshotUnavailable("WINDOWS_SNAPSHOT is not set");
  }
  const path = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new SnapshotUnavailable(`snapshot not readable at ${configured}`);
  }

  const out: CandidateWindow[] = [];
  const rejected: string[] = [];
  raw.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      rejected.push(`line ${i + 1}: not JSON`);
      return;
    }
    const problems = windowProblems(parsed);
    if (problems.length > 0) rejected.push(`line ${i + 1}: ${problems.join("; ")}`);
    else out.push(parsed as CandidateWindow);
  });

  // A malformed snapshot is a refusal, not a filter. Serving the readable subset
  // would mean a caller pays for a set whose size depends on a parse error
  // nobody was told about, and the missing rows would look like a quiet day.
  if (rejected.length > 0) throw new SnapshotUnavailable(`snapshot has ${rejected.length} invalid window(s): ${rejected[0]}`);
  return out;
}
