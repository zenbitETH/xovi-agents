import { NextResponse } from "next/server";
import { isAddress } from "viem";
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
    marked = cells.map(cell => {
      const mark = byCell.get(`${cell.day}|${cell.species}`);
      return mark === undefined ? cell : { ...cell, read: { outcome: mark.outcome, clipId: mark.clipId, ranAt: mark.ranAt } };
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
