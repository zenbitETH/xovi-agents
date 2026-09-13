import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetaInvalid, loadSnapshot } from "../lib/windows/snapshot";

type Check = (ok: boolean, label: string) => void;

function window(videoId: string, species: string, produced: string, id: string) {
  return {
    schema: "xovi/candidate-window/v1",
    windowId: id,
    channelId: "UCchannel",
    videoId,
    startTime: 10.5,
    endTime: 24.5,
    stationId: species === "dumerilii" ? "AD" : "AM 1",
    speciesCode: species,
    specimenAlias: null,
    candidates: ["Alfa", "Beta"],
    behaviorTag: null,
    truncatedByCap: false,
    continuesPrevious: false,
    confidence: 500,
    reason: "a sentence long enough to pass the validator",
    detector: "t@0",
    producedAt: produced,
  };
}

const GOOD = { durationSeconds: 42896, thumbnail: "https://i.ytimg.com/vi/aaa/mqdefault.jpg" };

/** Builds a snapshot directory with one dated windows file and whatever meta is given. */
function snapshotWith(meta: unknown | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "meta-"));
  writeFileSync(join(dir, "windows.aaa.jsonl"), `${JSON.stringify(window("aaa", "mexicanum", "2026-09-03T10:00:00Z", "m1"))}\n`);
  writeFileSync(join(dir, "windows.aaa.jsonl.day"), "2026-09-03\n");
  if (meta !== undefined) writeFileSync(join(dir, "windows.aaa.jsonl.meta.json"), `${JSON.stringify(meta)}\n`);
  return dir;
}

function refused(dir: string): string | null {
  const before = process.env.WINDOWS_SNAPSHOT;
  process.env.WINDOWS_SNAPSHOT = dir;
  try {
    loadSnapshot();
    return null;
  } catch (err) {
    return err instanceof MetaInvalid ? err.message : `not a MetaInvalid: ${err instanceof Error ? err.name : "unknown"}`;
  } finally {
    process.env.WINDOWS_SNAPSHOT = before;
  }
}

export async function metaChecks(check: Check) {
  console.log("\n  the recording's two facts beside a windows file");

  // ── 360 · a good meta file reaches the window, and only its two fields ────────
  {
    const before = process.env.WINDOWS_SNAPSHOT;
    process.env.WINDOWS_SNAPSHOT = snapshotWith(GOOD);
    const all = loadSnapshot();
    process.env.WINDOWS_SNAPSHOT = before;
    check(all.length === 1, `360 · the snapshot loads with a meta file beside it (got ${all.length})`);
    check(all[0].meta?.durationSeconds === 42896, "360a · the duration reaches the window");
    check(all[0].meta?.thumbnail === GOOD.thumbnail, "360b · and the thumbnail does");
    check(
      JSON.stringify(Object.keys(all[0].meta ?? {}).sort()) === JSON.stringify(["durationSeconds", "thumbnail"]),
      `360c · and nothing else came with them (${Object.keys(all[0].meta ?? {}).sort().join(",")})`,
    );
  }

  // ── 361 · meta is optional ───────────────────────────────────────────────────
  {
    const before = process.env.WINDOWS_SNAPSHOT;
    process.env.WINDOWS_SNAPSHOT = snapshotWith(undefined);
    const all = loadSnapshot();
    process.env.WINDOWS_SNAPSHOT = before;
    check(all.length === 1, `361 · a windows file with no meta still loads (got ${all.length})`);
    check(!("meta" in all[0]), "361a · and carries no meta key at all, rather than an undefined one");
  }

  // ── 362 · an extra key is refused, which is the finding this exists for ──────
  //
  // A recording's metadata carries a title, and the title carries the species and
  // the date; a description or a tag list can carry a station or an alias. Reading
  // past unknown keys would let any of that sit in a committed file, unread today
  // and read by whatever wants it tomorrow. So the list is closed and a third key
  // refuses the snapshot rather than being ignored.
  {
    const why = refused(snapshotWith({ ...GOOD, title: "Ajolote Ambystoma Mexicanum (9 de Septiembre)" }));
    check(why !== null && why.includes("title"), `362 · a meta file carrying a title is refused, and the message names it (${why ?? "accepted"})`);
    const alias = refused(snapshotWith({ ...GOOD, specimenAlias: "Remo" }));
    check(alias !== null && alias.includes("specimenAlias"), `362a · so is one carrying an alias (${alias ?? "accepted"})`);
    const station = refused(snapshotWith({ ...GOOD, stationId: "AD" }));
    check(station !== null, `362b · and one carrying a station (${station ?? "accepted"})`);
  }

  // ── 363 · the two fields must be what they claim ─────────────────────────────
  {
    check(refused(snapshotWith({ thumbnail: GOOD.thumbnail })) !== null, "363 · a meta file missing the duration is refused");
    check(refused(snapshotWith({ durationSeconds: 42896 })) !== null, "363a · and one missing the thumbnail");
    check(refused(snapshotWith({ ...GOOD, durationSeconds: 42896.5 })) !== null, "363b · a fractional duration is refused, since it is read and not estimated");
    check(refused(snapshotWith({ ...GOOD, durationSeconds: 0 })) !== null, "363c · and a zero one");
    check(refused(snapshotWith({ ...GOOD, durationSeconds: "42896" })) !== null, "363d · and a string that looks like one");
    check(
      refused(snapshotWith({ ...GOOD, thumbnail: "http://i.ytimg.com/vi/aaa/mqdefault.jpg" })) !== null,
      "363e · a thumbnail over http is refused",
    );
    check(
      refused(snapshotWith({ ...GOOD, thumbnail: "https://example.invalid/vi/aaa/mqdefault.jpg" })) !== null,
      "363f · and one on another host, because the url is a request the reader's browser makes",
    );
    check(refused(snapshotWith("not an object")) !== null, "363g · a meta file that is not an object is refused");
  }

  // ── 364 · the committed fixtures, read as they stand ─────────────────────────
  //
  // The checks above drive temporary files, which proves the loader and says nothing
  // about what is in the repository. This reads the real ones.
  {
    const dir = join(__dirname, "..", "fixtures");
    const windowFiles = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    const withMeta = windowFiles.filter(f => readdirSync(dir).includes(`${f}.meta.json`));
    check(windowFiles.length > 0, `364 · the fixtures directory holds windows files (${windowFiles.length}) (control)`);
    check(
      withMeta.length === windowFiles.length - 1,
      `364a · every windows file has a meta file except one (${withMeta.length} of ${windowFiles.length})`,
    );
    check(
      !readdirSync(dir).includes("windows.synthetic.jsonl.meta.json"),
      "364b · and the one without is the synthetic file, which has no recording behind it",
    );
    /*
     * A DISTINCT ID PER ASSERTION, not per kind of assertion.
     *
     * The first version reused `364c`, `364d` and `364e` inside this loop, so six
     * files produced eighteen checks under three ids. Check 354 caught it on the
     * first run. A shared id is not cosmetic: a check cannot be cited, counted or
     * inverted if two different assertions answer to the same name, which is exactly
     * the pre-existing defect the reviewer noted elsewhere in this suite.
     */
    const letters = "cdefghijklmnopqrstuvwxyz";
    let next = 0;
    const id = () => `364${letters[next++]}`;
    for (const f of withMeta.sort()) {
      const raw = JSON.parse(readFileSync(join(dir, `${f}.meta.json`), "utf8")) as Record<string, unknown>;
      const keys = Object.keys(raw).sort().join(",");
      const vid = f.replace(/^windows\./, "").replace(/\.jsonl$/, "");
      check(keys === "durationSeconds,thumbnail", `${id()} · ${f} carries only the two fields (${keys})`);
      check(
        raw.thumbnail === `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
        `${id()} · ${f} names its own recording's thumbnail`,
      );
      check(
        Number.isInteger(raw.durationSeconds) && (raw.durationSeconds as number) > 0,
        `${id()} · ${f} holds a whole number of seconds`,
      );
    }
  }
}
