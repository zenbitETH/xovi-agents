import type { CandidateWindow } from "./types";

/** Only string lookups are needed, so the tests can pass a plain object
 *  instead of casting a partial to the full process environment. */
export type EnvLike = Record<string, string | undefined>;

/**
 * The embargo gate.
 *
 * The producer already gates on this list. This gate exists anyway, because a
 * defence that lives only in the producer is one refactor from gone, and this is
 * the last point before data leaves the building.
 *
 * The list is read from the environment and is never committed here. It is
 * specimen data: writing it into this repository would publish the thing it
 * protects. An operator sets EMBARGOED_ALIASES; nothing in git ever holds a name.
 */
export function embargoedAliases(env: EnvLike = process.env): Set<string> {
  const raw = env.EMBARGOED_ALIASES ?? "";
  return new Set(
    raw
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0),
  );
}

/**
 * A touched window is DROPPED WHOLE, never redacted.
 *
 * Redacting specimenAlias and pruning candidates is not enough and the reason is
 * not subtle: an omission is itself a signal to anyone who knows the roster, and
 * a window whose alias is missing where every neighbour has one names the
 * embargoed animal by silhouette. reason is free prose written by the detector
 * and is exactly how an embargo has leaked before, so it is searched too rather
 * than trusted.
 *
 * Serving nothing is a correct answer. A caller receiving fewer windows learns
 * only that fewer were available, which is true of any detector on any day.
 */
export function dropsForEmbargo(w: CandidateWindow, embargoed: Set<string>): boolean {
  if (embargoed.size === 0) return false;
  const hit = (s: string | null | undefined) => typeof s === "string" && embargoed.has(s.trim().toLowerCase());
  if (hit(w.specimenAlias)) return true;
  if (Array.isArray(w.candidates) && w.candidates.some(hit)) return true;
  // Substring rather than equality, because reason is a sentence and a name
  // inside it is still the name. Cheap, and the false positive costs one window.
  const reason = (w.reason ?? "").toLowerCase();
  for (const name of embargoed) if (reason.includes(name)) return true;
  return false;
}

// Generic, so what goes in comes out: the board's windows carry a day and a cast
// would have thrown that away at the one boundary that must not lose it.
export function applyEmbargo<T extends CandidateWindow>(windows: T[], env?: EnvLike) {
  const embargoed = embargoedAliases(env);
  const kept = windows.filter(w => !dropsForEmbargo(w, embargoed));
  return { kept, dropped: windows.length - kept.length };
}
