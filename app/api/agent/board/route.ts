import { NextResponse } from "next/server";
import { SnapshotUnavailable, boardFrom, loadSnapshot } from "~~/lib/windows/snapshot";

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
export async function GET() {
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
  return NextResponse.json(
    {
      days,
      // Built field by field, so a field added to a window never reaches the board
      // by being present on the object it was derived from.
      cells: cells.map(cell => ({ day: cell.day, species: cell.species, onOffer: cell.onOffer })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
