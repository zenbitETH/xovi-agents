import { readFileSync, readdirSync, statSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { applyEmbargo } from "./embargo";
import { BOARD_SPECIES, type CandidateWindow, windowProblems } from "./types";

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
/**
 * The day a window's footage was recorded, which is not the day it was detected.
 *
 * `producedAt` is the detector's clock and a re run months later would move every
 * window to a new day, so a sidecar wins where one exists: a file beside the
 * snapshot with the same name and a `.day` suffix, holding one ISO date. The
 * fallback is `producedAt`'s date, which is right whenever the detector ran on the
 * recording, and is the only thing available for the fixture that predates this.
 */
export function dayOf(window: CandidateWindow, sidecar: string | null): string {
  if (sidecar !== null) return sidecar;
  return String(window.producedAt ?? "").slice(0, 10);
}

/** A window with the two facts the board sorts by, neither of them new: the day
 *  its footage belongs to and the species its station holds. */
export type BoardWindow = CandidateWindow & { day: string };

function readDaySidecar(file: string): string | null {
  try {
    const raw = readFileSync(`${file}.day`, "utf8").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Every file the setting names, as one set.
 *
 * A directory, a comma separated list, or a single file. A directory is read
 * shallow and only its `.jsonl` files are taken, so a README or a sidecar sitting
 * beside them is not parsed as windows and does not turn a good snapshot into a
 * refusal.
 */
/**
 * Invented data, which must never reach a board.
 *
 * The synthetic fixture exists so the paid path can be exercised with no real
 * footage, and it declares itself: its detector is `synthetic`, its channel and
 * its videos are placeholders. Pointing `WINDOWS_SNAPSHOT` at the fixtures
 * directory would sweep it up with the real files and put an invented day on the
 * board beside measured ones, which is the worst thing this page could publish.
 *
 * A directory read skips such a file whole. A path that names one explicitly is
 * served, because that is what the checks and the local demonstration do on
 * purpose, and naming it is a choice rather than an accident.
 */
export function isSynthetic(window: CandidateWindow): boolean {
  return (
    String(window.detector ?? "").startsWith("synthetic") ||
    String(window.channelId ?? "").includes("synthetic") ||
    String(window.videoId ?? "").startsWith("synth")
  );
}

function filesFrom(configured: string): string[] {
  const parts = configured
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
  const files: string[] = [];
  for (const part of parts) {
    const path = isAbsolute(part) ? part : resolve(process.cwd(), part);
    let directory = false;
    try {
      directory = statSync(path).isDirectory();
    } catch {
      throw new SnapshotUnavailable(`snapshot not readable at ${part}`);
    }
    if (!directory) {
      files.push(path);
      continue;
    }
    const inside = readdirSync(path)
      .filter(name => name.endsWith(".jsonl"))
      .sort()
      .map(name => join(path, name))
      // Skipped rather than refused: a directory holding the fixture beside real
      // files is the normal state of this repository, not a misconfiguration.
      .filter(file => !fileIsSynthetic(file));
    // An empty directory is a misconfiguration wearing the shape of a quiet day,
    // which is the distinction this function's caller exists to keep.
    if (inside.length === 0) throw new SnapshotUnavailable(`no .jsonl files in ${part}`);
    files.push(...inside);
  }
  return files;
}

/** Reads the first line only. A file is synthetic or it is not; the fixture does
 *  not mix invented windows with measured ones and neither should anything else. */
function fileIsSynthetic(file: string): boolean {
  try {
    const first = readFileSync(file, "utf8").split("\n").find(line => line.trim().length > 0);
    if (first === undefined) return false;
    return isSynthetic(JSON.parse(first) as CandidateWindow);
  } catch {
    return false;
  }
}

export function loadSnapshot(env: EnvLike = process.env): BoardWindow[] {
  const configured = env.WINDOWS_SNAPSHOT;
  if (!configured || configured.trim().length === 0) {
    // Deliberately NOT an empty list. An empty list means the detector found
    // nothing, which is a real and correct answer; an unset path means nobody
    // configured this endpoint. Conflating them would sell a misconfiguration as
    // a measurement.
    throw new SnapshotUnavailable("WINDOWS_SNAPSHOT is not set");
  }

  const out: BoardWindow[] = [];
  const rejected: string[] = [];
  for (const file of filesFrom(configured)) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      throw new SnapshotUnavailable(`snapshot not readable at ${file}`);
    }
    const sidecar = readDaySidecar(file);
    raw.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(t);
      } catch {
        rejected.push(`${file} line ${i + 1}: not JSON`);
        return;
      }
      const problems = windowProblems(parsed);
      if (problems.length > 0) rejected.push(`${file} line ${i + 1}: ${problems.join("; ")}`);
      else {
        const w = parsed as CandidateWindow;
        out.push({ ...w, day: dayOf(w, sidecar) });
      }
    });
  }

  // A malformed snapshot is a refusal, not a filter. Serving the readable subset
  // would mean a caller pays for a set whose size depends on a parse error
  // nobody was told about, and the missing rows would look like a quiet day.
  if (rejected.length > 0) throw new SnapshotUnavailable(`snapshot has ${rejected.length} invalid window(s): ${rejected[0]}`);
  return out;
}

export { BOARD_SPECIES } from "./types";

/**
 * What is on offer, per day and per species, and never how much.
 *
 * **No count while the files are public in this repository.** A count beside a
 * readable file is the embargo drop by subtraction: anyone can read the file,
 * count the rows, and take the difference as the number of windows withheld,
 * which is the one number the embargo exists to keep. On offer or none says what
 * a person needs to choose a cell and nothing else.
 */
export type BoardCell = { day: string; species: string; onOffer: boolean };

/** The windows of one cell, before the gate. */
export function cellOf(windows: BoardWindow[], day: string, species: string): BoardWindow[] {
  return windows.filter(w => w.day === day && w.speciesCode === species);
}

/**
 * A cell, as the gate leaves it.
 *
 * Three outcomes and they are not two. **A committed file that loses anything to
 * the gate is unserviceable, not smaller.** Screening happens before a file is
 * committed, so a drop here means the committed file was never screened against
 * the list now in force, and serving what is left would sell a subset while the
 * board said the cell was on offer: the person pays and receives fewer windows,
 * or none, and the difference is the withheld set by subtraction. So the cell
 * refuses, the board does not offer it, and the answer is to re-screen and
 * re-commit the file.
 */
export type CellState = { kind: "offer"; windows: BoardWindow[] } | { kind: "empty" } | { kind: "unscreened"; dropped: number };

export function cellState(windows: BoardWindow[], day: string, species: string, env?: EnvLike): CellState {
  const all = cellOf(windows, day, species);
  if (all.length === 0) return { kind: "empty" };
  const { kept, dropped } = applyEmbargo(all, env);
  if (dropped > 0) return { kind: "unscreened", dropped };
  return { kind: "offer", windows: kept };
}

/**
 * The board, derived from what the gate would leave rather than from the file.
 *
 * A cell is on offer only where every one of its windows survives the gate. A
 * board built from the raw file would say on offer for a cell that then answers
 * nothing, which is the shape this whole design exists to refuse.
 */
export function boardFrom(windows: BoardWindow[], env?: EnvLike): { days: string[]; cells: BoardCell[] } {
  const days = [...new Set(windows.map(w => w.day).filter(d => d.length > 0))].sort();
  const cells: BoardCell[] = [];
  for (const day of days) {
    for (const species of BOARD_SPECIES) {
      cells.push({ day, species, onOffer: cellState(windows, day, species, env).kind === "offer" });
    }
  }
  return { days, cells };
}
