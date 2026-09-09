import { NextResponse } from "next/server";
import { serialiseSigned, storeFrom } from "~~/lib/anchor/store";

export const dynamic = "force-dynamic";

/**
 * The signed object, and nothing else.
 *
 * Unauthenticated, and that is a property to be maintained rather than a default
 * that happened. A record whose verification depends on asking Zenbit for
 * permission is not a public record, and an endpoint that quietly grows a gate is
 * how that property is lost. There is a check that goes red when one appears.
 *
 * Nothing else is served from here. No row, no note, no station, no alias, no
 * neighbouring clip and no list. A reader who wants more has the reviewing
 * application's own public list, which is a different surface with its own rules.
 */
export async function GET(_request: Request, context: { params: Promise<{ uid: string }> }) {
  const { uid } = await context.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(uid)) {
    return NextResponse.json({ error: "not an attestation identifier" }, { status: 400 });
  }

  const store = storeFrom();
  if (!store) {
    // No database, so nothing has been anchored and there is nothing to serve.
    // Distinguished from a missing record so an operator can tell the two apart.
    return NextResponse.json({ error: "no anchor store is configured" }, { status: 503 });
  }

  // A store that is configured and cannot answer is an outage, not a missing
  // record, and the two must not share a status. Production has a database and no
  // anchors table until the migration runs, so an uncaught read throws
  // `relation "anchors" does not exist` and the framework serves 500: an error page
  // where the contract says a record is unavailable.
  let row;
  try {
    row = await store.byUid(uid.toLowerCase());
  } catch (err) {
    console.error(`observations: the anchor store failed: ${err instanceof Error ? err.message : "unknown"}`);
    return NextResponse.json({ error: "the anchor store is unavailable" }, { status: 503 });
  }
  if (!row) return NextResponse.json({ error: "no such attestation" }, { status: 404 });

  // Built field by field rather than spread, so a column added to the table later
  // cannot arrive here by accident. The table holds the clip hash and the schema
  // identifier for lookup; the reader gets them inside the signed object or not at
  // all, because those are the copies a signature covers.
  return NextResponse.json(serialiseSigned(row.signed), {
    // The object under an identifier is immutable by construction: change any part
    // of it and it is a different identifier.
    headers: { "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
