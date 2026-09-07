/**
 * The candidate window, v1, as agreed with the producer and frozen in
 * docs/spec/02-candidate-windows.md.
 *
 * This file exists so the endpoint cannot serve a shape the spec does not
 * describe. It is a runtime check rather than a TypeScript type alone, because
 * the snapshot is a file on disk that nothing in this repository produces: the
 * detector writes it, a person copies it here, and a type that only exists at
 * compile time would not notice if either step went wrong.
 */
export type CandidateWindow = {
  schema: "xovi/candidate-window/v1";
  windowId: string;
  channelId: string;
  videoId: string;
  startTime: number;
  endTime: number;
  stationId: string;
  speciesCode: "mexicanum" | "andersoni" | "dumerilii";
  specimenAlias: string | null;
  candidates: string[] | null;
  behaviorTag: string | null;
  truncatedByCap: boolean;
  continuesPrevious: boolean;
  confidence: number;
  reason: string;
  detector: string;
  producedAt: string;
};

const SPECIES = ["mexicanum", "andersoni", "dumerilii"];

/** Everything the consuming ingest route will refuse, refused here first. The
 *  numbers are not invented: they are the caps that route already enforces, so a
 *  window that fails here would have failed there with a 400 nobody could act on. */
export function windowProblems(w: unknown): string[] {
  const p: string[] = [];
  if (typeof w !== "object" || w === null) return ["not an object"];
  const o = w as Record<string, unknown>;
  const str = (k: string, max: number) => {
    const v = o[k];
    if (typeof v !== "string" || v.length === 0) p.push(`${k} missing`);
    else if (v.length > max) p.push(`${k} over ${max}`);
  };
  if (o.schema !== "xovi/candidate-window/v1") p.push(`schema is ${String(o.schema)}`);
  str("windowId", 64);
  str("channelId", 32);
  str("videoId", 16);
  str("stationId", 16);
  str("detector", 64);
  str("producedAt", 40);
  if (typeof o.reason !== "string" || o.reason.trim().length < 3) p.push("reason under 3 characters");
  else if (o.reason.length > 280) p.push(`reason over 280 (${o.reason.length})`);
  if (typeof o.speciesCode !== "string" || !SPECIES.includes(o.speciesCode)) p.push(`speciesCode ${String(o.speciesCode)}`);
  if (!Number.isInteger(o.confidence) || (o.confidence as number) < 0 || (o.confidence as number) > 1000) {
    p.push(`confidence ${String(o.confidence)} is not an integer per mille`);
  }
  for (const k of ["truncatedByCap", "continuesPrevious"]) {
    if (typeof o[k] !== "boolean") p.push(`${k} is not a boolean`);
  }
  const s = o.startTime,
    e = o.endTime;
  if (typeof s !== "number" || typeof e !== "number") p.push("times are not numbers");
  else {
    if (e <= s) p.push("endTime is not after startTime");
    // The producer guarantees whole milliseconds so that neither side's rounding
    // can move an instant. A window that arrives without that guarantee has been
    // through something that did not honour it, and the endpoint should not be
    // the place that quietly re-rounds.
    for (const [k, v] of [["startTime", s] as const, ["endTime", e] as const]) {
      if (Math.abs(Math.round(v * 1000) - v * 1000) > 1e-9) p.push(`${k} is not a whole millisecond`);
    }
    if (e - s > 100) p.push(`duration ${(e - s).toFixed(1)}s over the 100s cap`);
  }
  if (o.specimenAlias !== null && typeof o.specimenAlias !== "string") p.push("specimenAlias is neither string nor null");
  if (o.candidates !== null && !Array.isArray(o.candidates)) p.push("candidates is neither array nor null");
  if (o.behaviorTag !== null && typeof o.behaviorTag !== "string") p.push("behaviorTag is neither string nor null");
  return p;
}
