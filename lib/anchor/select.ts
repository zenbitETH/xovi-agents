/**
 * Which rows of the public list an anchoring run takes up.
 *
 * A run that sends is limited to the clips it is told to send. Anchoring writes a
 * verifier's address to a public chain, and whether that may happen is decided clip by
 * clip, so a count ("the first seven") is not a decision a person made about any of
 * them. The dry run may look at everything; `--execute` may not.
 *
 * Some clips are never anchored, however they are named: one with a clinical tag, one that names an
 * animal (`specimenAlias`), one that lists other animals (`participants`). That is a standing rule, not
 * a choice made run by run, so it is a function of its own that both the selector and the observation
 * builder call.
 */

export class UnselectableClip extends Error {}

/** `279,321` into `[279, 321]`. A repeat, a blank or anything but a whole number is refused. */
export function parseClipIds(arg: string | undefined): number[] | null {
  if (arg === undefined) return null;
  const ids = arg.split(",").map(s => s.trim());
  const parsed = ids.map(s => (/^[1-9][0-9]*$/.test(s) ? Number(s) : NaN));
  if (parsed.length === 0 || parsed.some(n => !Number.isSafeInteger(n))) {
    throw new UnselectableClip(`--clip takes whole clip numbers separated by commas, got "${arg}"`);
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new UnselectableClip(`--clip names a clip twice: "${arg}"`);
  }
  return parsed;
}

/** A run that sends must say which clips. It is the whole guard, so it is a function of its own. */
export function assertMayExecute(execute: boolean, clips: number[] | null): void {
  if (execute && clips === null) {
    throw new UnselectableClip(
      "--execute needs --clip, naming each clip to send; a count does not say which clips a person cleared",
    );
  }
}

type Row = Record<string, unknown>;

/**
 * The tags a clip may carry and still be anchored: the Xovi catalog's tags outside its health category (Salud y bienestar). An allow-list,
 * so a tag this script does not list, a tag added to the catalog later and a missing tag are all refused. The reviewing application filters
 * by the same list and serves it with the clips; a list that differs from this one is refused (parseClipList).
 */
export const PUBLIC_TAGS: readonly string[] = [
  "feeding",
  "swim",
  "rest",
  "gill_flutter",
  "surface_breach",
  "other",
  "courtship",
  "buccal_pumping",
  "frontal_approach",
  "physical_contact",
  "dominance",
  "aggression",
  "pursuit",
  "tail_stroking_walk",
  "spermatophore",
  "female_following",
  "female_positioning",
  "oviposition",
  "capture_attempt",
  "food_rejection",
  "exploration",
  "perimeter",
  "hiding",
  "grooming",
  "yawn",
];

/**
 * Why a row may never be anchored, or null. The row has to PROVE it is anchorable: a public tag, `specimenAlias` and `participants` present
 * and null (a list that withholds them is refused, because an alias anchored once is recoverable forever from the onchain hash), and the
 * list's own statement that both addresses that will appear onchain have consented. Absent is never "fine".
 */
export function neverAnchor(row: Row): string | null {
  const tag = row.behaviorTag;
  if (typeof tag !== "string" || tag.length === 0) return "no behaviorTag to check";
  if (!PUBLIC_TAGS.includes(tag)) return `tag ${tag} is not a public tag`;
  if (row.specimenAlias !== null) return row.specimenAlias === undefined ? "specimenAlias is missing from the list" : "specimenAlias is set";
  if (row.participants !== null) return row.participants === undefined ? "participants is missing from the list" : "participants is set";
  const consent = row.consent as { verifier?: unknown; submitter?: unknown } | undefined;
  if (consent?.verifier !== true || consent?.submitter !== true) return "the list does not say both addresses have consented";
  return null;
}

/**
 * The clips of the list the reviewing application serves, `{ publicTags, clips }`. The list is refused if it is not that shape, or if the
 * tags it says it filters by are not exactly this script's: a drifted list is how a new health tag would reach a chain.
 */
export function parseClipList(body: unknown): Row[] {
  const b = body as { publicTags?: unknown; clips?: unknown } | null;
  if (b === null || typeof b !== "object" || Array.isArray(b) || !Array.isArray(b.publicTags) || !Array.isArray(b.clips)) {
    throw new UnselectableClip("the list is not { publicTags, clips }");
  }
  const theirs = [...(b.publicTags as unknown[])].map(String).sort().join(",");
  const ours = [...PUBLIC_TAGS].sort().join(",");
  if (theirs !== ours) throw new UnselectableClip("the list filters by a different set of public tags than this script");
  return b.clips as Row[];
}

/** The key goes only to an https address, or to this machine; it is never sent over plain http to another host. */
export function assertKeySafeUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UnselectableClip(`XOVI_CLIPS_URL is not an address: "${url}"`);
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new UnselectableClip("XOVI_CLIPS_URL must be https (plain http only for localhost): the key is sent to it");
  }
}

/**
 * The confirmed machine proposals of a list. With `clips`, exactly those, in the list's order, and a
 * named clip that is not one is an error rather than a skip: a clip somebody cleared and the run
 * silently passed over is a run that reports success on less than was asked. Without `clips`, the
 * first `limit`, which is only ever used to look.
 */
export function selectCandidates(rows: Row[], opts: { limit: number; clips: number[] | null }): Row[] {
  const proposals = rows.filter(r => r.source === "cv" && r.status === "verified");
  if (opts.clips === null) return proposals.filter(r => neverAnchor(r) === null).slice(0, opts.limit);
  const missing = opts.clips.filter(id => !proposals.some(r => r.id === id));
  if (missing.length > 0) {
    throw new UnselectableClip(`clip ${missing.join(", ")} is not a confirmed machine proposal in this list`);
  }
  const named = proposals.filter(r => opts.clips!.includes(r.id as number));
  const never = named.flatMap(r => {
    const why = neverAnchor(r);
    return why === null ? [] : [`clip ${r.id} is never anchored: ${why}`];
  });
  if (never.length > 0) throw new UnselectableClip(never.join("; "));
  return named;
}
