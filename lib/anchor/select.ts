/**
 * Which rows of the public list an anchoring run takes up.
 *
 * A run that sends is limited to the clips it is told to send. Anchoring writes a
 * verifier's address to a public chain, and whether that may happen is decided clip by
 * clip, so a count ("the first seven") is not a decision a person made about any of
 * them. The dry run may look at everything; `--execute` may not.
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
 * The confirmed machine proposals of a list. With `clips`, exactly those, in the list's order, and a
 * named clip that is not one is an error rather than a skip: a clip somebody cleared and the run
 * silently passed over is a run that reports success on less than was asked. Without `clips`, the
 * first `limit`, which is only ever used to look.
 */
export function selectCandidates(rows: Row[], opts: { limit: number; clips: number[] | null }): Row[] {
  const proposals = rows.filter(r => r.source === "cv" && r.status === "verified");
  if (opts.clips === null) return proposals.slice(0, opts.limit);
  const missing = opts.clips.filter(id => !proposals.some(r => r.id === id));
  if (missing.length > 0) {
    throw new UnselectableClip(`clip ${missing.join(", ")} is not a confirmed machine proposal in this list`);
  }
  return proposals.filter(r => opts.clips!.includes(r.id as number));
}
