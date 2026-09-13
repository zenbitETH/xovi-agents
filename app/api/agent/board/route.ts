import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { nextAction, storeFrom as anchorStoreFrom } from "~~/lib/anchor/store";
import { runsStoreFrom } from "~~/lib/agent/runs-store";
import { SnapshotUnavailable, boardFrom, loadSnapshot, servedCell } from "~~/lib/windows/snapshot";

export const dynamic = "force-dynamic";

/**
 * What is on offer, per day and per species.
 *
 * The menu rather than the meal, so it is not behind the 402: a person has to see
 * what there is before deciding to buy any of it, and the thing being sold is the
 * derivation in a window, not the knowledge that a day exists.
 *
 * **No count, and that is not a simplification.** The window files are public in
 * this repository, so anyone can read one and count its rows; a count served here
 * would be the embargo drop by subtraction, since the difference between the rows
 * in the file and the number offered is exactly the number withheld, which is the
 * one number the embargo exists to keep. On offer or none is what choosing a cell
 * needs. If the files ever leave the repository the count can come.
 *
 * Day and species are what a window already carries under frozen spec 02. No
 * station and no alias crosses this route, because neither is needed to choose.
 */
export async function GET(request: Request) {
  let windows;
  try {
    windows = loadSnapshot();
  } catch (err) {
    if (err instanceof SnapshotUnavailable) {
      // Unconfigured and empty are different answers and only one of them is
      // about the collection.
      return NextResponse.json({ error: "no window snapshot is configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    throw err;
  }

  const { days, cells } = boardFrom(windows);

  /*
   * WHAT THIS WALLET'S OWN AGENT HAS ALREADY READ, AND NOBODY ELSE'S.
   *
   * The payer is a parameter and the store is asked for that payer alone, so there
   * is no request that returns another wallet's marks: a person sees where their
   * own agent has been and nothing about anyone else's. Without a payer the board
   * carries no marks at all, which is what a stranger and a signed out page get.
   *
   * Read on every request rather than remembered, so a run that has just finished
   * shows on the next load and a table that cannot answer simply leaves the marks
   * off rather than failing the board.
   */
  const payer = new URL(request.url).searchParams.get("payer");
  let marked = cells;
  if (payer !== null && isAddress(payer)) {
    const store = runsStoreFrom();
    const marks = store === null ? [] : await store.marksFor(payer).catch(() => []);
    const byCell = new Map(marks.map(m => [`${m.day}|${m.species}`, m]));
    /*
     * AND WHETHER THAT CLIP IS ANCHORED, ASKED OF THE ANCHOR STORE ITSELF.
     *
     * Never inferred from the proposal existing. A clip can be proposed, confirmed
     * by a person and not yet anchored, and the three are separate events with
     * separate stores; drawing one from another would put a chain on the board that
     * has not happened. Only clips this payer's own runs produced are asked about,
     * which are the clip ids already on this payer's own marks, so no identifier
     * that was not going to be served is looked up.
     *
     * `nextAction` rather than the row existing, for the reason the High finding
     * exists: a row written before the first transaction and never completed is a
     * half anchor, and reading it as done is exactly the confusion that one names.
     * A store that cannot answer leaves the key off, which is not false.
     */
    const anchors = anchorStoreFrom();
    const anchored = new Map<number, boolean>();
    if (anchors !== null) {
      // One lookup per mark and no guard against a repeat, because a mark is the
      // latest run of one cell and a clip belongs to one window: two cells cannot
      // carry the same clip id. A dedupe here was code no fixture could reach,
      // which a mutation showed by removing it and changing nothing.
      for (const mark of marks) {
        if (mark.clipId === null) continue;
        const row = await anchors.byClipId(mark.clipId).catch(() => undefined);
        // A read that threw is not an answer and leaves the key off the mark. A
        // null row is an answer: nothing has been anchored for that clip.
        if (row === undefined) continue;
        anchored.set(mark.clipId, nextAction(row) === "done");
      }
    }
    marked = cells.map(cell => {
      const mark = byCell.get(`${cell.day}|${cell.species}`);
      if (mark === undefined) return cell;
      const attested = mark.clipId === null ? undefined : anchored.get(mark.clipId);
      return {
        ...cell,
        read: {
          outcome: mark.outcome,
          clipId: mark.clipId,
          ranAt: mark.ranAt,
          ...(attested === undefined ? {} : { attested }),
        },
      };
    });
  }
  return NextResponse.json(
    {
      days,
      // Built key by key by a mapping that lives beside the board, so a check can
      // drive it with a cell carrying more than it should and watch the extra go.
      cells: marked.map(servedCell),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
