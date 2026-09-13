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
export function dayOf(sidecar: string): string {
  return sidecar;
}

/**
 * A file read as part of a set must say which day it is.
 *
 * The fallback is not merely imprecise, it is wrong in one direction and silent
 * about it: `producedAt` is when the detector ran, so any footage processed later
 * than it was recorded is filed too late, plausibly and with nothing in the answer
 * to show the substitution. It happened: the July fixture sat on the board under
 * 8 September, seven weeks late, because it had no sidecar and nobody had to say
 * so.
 *
 * So every file says which day it is and there is no fallback to fall back to.
 * The one exception is invented data, which has no recording day to state: the
 * synthetic fixture is skipped by a directory read anyway and is named explicitly
 * only by the checks and the local demonstration.
 *
 * A directory read names every file it refused rather than serving the rest as
 * though the set were complete, which is the same rule the malformed line follows
 * and for the same reason.
 */
export class DayUnknown extends Error {}

/** A window with the two facts the board sorts by, neither of them new: the day
 *  its footage belongs to and the species its station holds. */
export type BoardWindow = CandidateWindow & { day: string; meta?: RecordingMeta };

/**
 * What the board may say about the recording behind a cell, and nothing more.
 *
 * TWO FIELDS, AND THE LIST IS CLOSED. A recording's metadata is a rich object and
 * almost all of it is exactly what this repository spends its checks keeping off a
 * public surface: the title carries the species and the date, and a description or a
 * tag list can carry a station or an alias. So the sidecar is not "the metadata", it
 * is these two values, and a file carrying a third key is REFUSED rather than read
 * past. Refusing is the point: a loader that ignored unknown keys would let a title
 * sit in a committed file, unread today and read by whatever wants it tomorrow.
 */
export type RecordingMeta = { durationSeconds: number; thumbnail: string };

/** A meta sidecar that exists and is wrong. Refused rather than dropped: a file
 *  sitting beside the windows saying there should be a thumbnail, while the board
 *  serves none, is a misconfiguration nobody would see. */
export class MetaInvalid extends SnapshotUnavailable {}

/** The one host a thumbnail may come from. A URL is a request the browser makes on
 *  behalf of whoever opens the board, so the host is pinned rather than trusted. */
const THUMBNAIL_HOST = "i.ytimg.com";
const META_KEYS = ["durationSeconds", "thumbnail"];

/**
 * The recording's two facts, or null when there is no meta file.
 *
 * Absent is fine and is not an error: meta is optional and a windows file without one
 * is served without one. Present and wrong is an error, for the reason above.
 */
function readMetaSidecar(file: string): RecordingMeta | null {
  const path = `${file}.meta.json`;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MetaInvalid(`${path} is not JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MetaInvalid(`${path} is not an object`);
  }

  const keys = Object.keys(parsed as Record<string, unknown>).sort();
  const extra = keys.filter(k => !META_KEYS.includes(k));
  if (extra.length > 0) throw new MetaInvalid(`${path} carries ${extra.join(", ")}; only ${META_KEYS.join(" and ")} may be served`);
  const missing = META_KEYS.filter(k => !keys.includes(k));
  if (missing.length > 0) throw new MetaInvalid(`${path} is missing ${missing.join(", ")}`);

  const { durationSeconds, thumbnail } = parsed as Record<string, unknown>;
  // Integer, because it is read from the recording rather than estimated, and a
  // fractional second would be a sign it was computed from something else.
  if (typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new MetaInvalid(`${path}: durationSeconds must be a positive whole number of seconds`);
  }
  if (typeof thumbnail !== "string") throw new MetaInvalid(`${path}: thumbnail must be a url`);
  let url: URL;
  try {
    url = new URL(thumbnail);
  } catch {
    throw new MetaInvalid(`${path}: thumbnail is not a url`);
  }
  if (url.protocol !== "https:" || url.hostname !== THUMBNAIL_HOST) {
    throw new MetaInvalid(`${path}: thumbnail must be https on ${THUMBNAIL_HOST}, got ${url.protocol}//${url.hostname}`);
  }

  return { durationSeconds, thumbnail };
}

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

function filesFrom(configured: string): { files: string[]; fromDirectory: boolean } {
  const parts = configured
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
  const files: string[] = [];
  let fromDirectory = false;
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
    fromDirectory = true;
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
  return { files, fromDirectory };
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
  const undated: string[] = [];
  const { files } = filesFrom(configured);
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      throw new SnapshotUnavailable(`snapshot not readable at ${file}`);
    }
    const sidecar = readDaySidecar(file);
    // Read before any window is parsed, so a wrong meta file refuses the snapshot
    // rather than half of it.
    const meta = readMetaSidecar(file);
    // Invented data has no recording day to state, and it is named explicitly or
    // not read at all. It is served with no day, so it draws no cell: `boardFrom`
    // keeps only the days that exist.
    const synthetic = sidecar === null && fileIsSynthetic(file);
    if (sidecar === null && !synthetic) {
      undated.push(file);
      continue;
    }
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
        out.push({
          ...w,
          day: sidecar === null ? "" : dayOf(sidecar),
          // Spread only when there is one, so a window without meta has no key at
          // all rather than an undefined one that serialises into the wire shape.
          ...(meta === null ? {} : { meta }),
        });
      }
    });
  }

  // A malformed snapshot is a refusal, not a filter. Serving the readable subset
  // would mean a caller pays for a set whose size depends on a parse error
  // nobody was told about, and the missing rows would look like a quiet day.
  // Named, all of them, rather than one and a count: a set served short is a set
  // whose missing days nobody was told about.
  if (undated.length > 0) {
    throw new DayUnknown(
      `no .day sidecar for ${undated.join(", ")}. The detector's clock is not the recording's date, so each file says which day its footage belongs to`,
    );
  }
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
