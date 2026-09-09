import { neon } from "@neondatabase/serverless";
import { type AnchorRow, type AnchorStore, type Claim, deserialiseSigned, serialiseSigned } from "./store";

export function postgresAnchorStore(url: string): AnchorStore {
  const sql = neon(url);
  return {
    async claim(row: AnchorRow): Promise<Claim> {
      // ON CONFLICT DO NOTHING, then read back what is actually there. The read back
      // is the fix: losing the insert race and finding a half finished row are the
      // same answer here, and both need the stored row rather than the one this
      // caller just built. Signing again produces a new salt and therefore a new
      // identifier, so resuming against a freshly signed object would anchor a
      // second record for one confirmation.
      const got = await sql`
        INSERT INTO anchors (clip_id, uid, clip_hash, schema_uid, attester, signed)
        VALUES (${row.clipId}, ${row.uid}, ${row.clipHash}, ${row.schemaUid}, ${row.attester},
                ${JSON.stringify(serialiseSigned(row.signed))}::jsonb)
        ON CONFLICT (clip_id) DO NOTHING
        RETURNING id`;
      if (got.length > 0) return { fresh: true, row };
      const existing = await this.byClipId(row.clipId);
      if (!existing) throw new Error(`clip ${row.clipId}: the insert conflicted and no row was found`);
      return { fresh: false, row: existing };
    },
    async byClipId(clipId: number) {
      const rows = await sql`
        SELECT clip_id, uid, clip_hash, schema_uid, attester, signed, timestamp_tx,
               timestamped_at::text AS timestamped_at, attest_tx, onchain_uid
          FROM anchors WHERE clip_id = ${clipId} LIMIT 1`;
      return rows[0] ? hydrate(rows[0]) : null;
    },
    async complete(uid, tx) {
      await sql`
        UPDATE anchors
           SET timestamp_tx   = COALESCE(${tx.timestampTx ?? null}, timestamp_tx),
               timestamped_at = COALESCE(${tx.timestampedAt?.toString() ?? null}::bigint, timestamped_at),
               attest_tx      = COALESCE(${tx.attestTx ?? null}, attest_tx),
               onchain_uid    = COALESCE(${tx.onchainUid ?? null}, onchain_uid)
         WHERE uid = ${uid}`;
    },
    async byUid(uid) {
      const rows = await sql`
        SELECT clip_id, uid, clip_hash, schema_uid, attester, signed, timestamp_tx,
               timestamped_at::text AS timestamped_at, attest_tx, onchain_uid
          FROM anchors WHERE uid = ${uid} OR onchain_uid = ${uid} LIMIT 1`;
      const r = rows[0];
      if (!r) return null;
      return hydrate(r);
    },
  };
}

/** Shared so the two readers cannot drift into returning different shapes. */
function hydrate(r: Record<string, unknown>): AnchorRow {
  return {
        clipId: Number(r.clip_id),
        uid: String(r.uid),
        clipHash: String(r.clip_hash),
        schemaUid: String(r.schema_uid),
        attester: String(r.attester),
        signed: deserialiseSigned(r.signed),
        timestampTx: r.timestamp_tx ? String(r.timestamp_tx) : undefined,
        // Read as text and converted here. A bigint through a driver is the shape
        // that has already cost this project a false reading once.
        timestampedAt: r.timestamped_at ? BigInt(String(r.timestamped_at)) : undefined,
        attestTx: r.attest_tx ? String(r.attest_tx) : undefined,
    onchainUid: r.onchain_uid ? String(r.onchain_uid) : undefined,
  };
}
