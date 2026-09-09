import { neon } from "@neondatabase/serverless";
import { type AnchorRow, type AnchorStore, deserialiseSigned, serialiseSigned } from "./store";

export function postgresAnchorStore(url: string): AnchorStore {
  const sql = neon(url);
  return {
    async claim(row: AnchorRow): Promise<boolean> {
      // ON CONFLICT DO NOTHING against the clip identifier, so a second attempt at
      // the same confirmation reports that it was already claimed rather than
      // raising. Returning the row is what makes the difference observable.
      const got = await sql`
        INSERT INTO anchors (clip_id, uid, clip_hash, schema_uid, attester, signed)
        VALUES (${row.clipId}, ${row.uid}, ${row.clipHash}, ${row.schemaUid}, ${row.attester},
                ${JSON.stringify(serialiseSigned(row.signed))}::jsonb)
        ON CONFLICT (clip_id) DO NOTHING
        RETURNING id`;
      return got.length > 0;
    },
    async complete(uid, tx) {
      await sql`
        UPDATE anchors
           SET timestamp_tx   = COALESCE(${tx.timestampTx ?? null}, timestamp_tx),
               timestamped_at = COALESCE(${tx.timestampedAt?.toString() ?? null}::bigint, timestamped_at),
               attest_tx      = COALESCE(${tx.attestTx ?? null}, attest_tx)
         WHERE uid = ${uid}`;
    },
    async byUid(uid) {
      const rows = await sql`
        SELECT clip_id, uid, clip_hash, schema_uid, attester, signed, timestamp_tx,
               timestamped_at::text AS timestamped_at, attest_tx
          FROM anchors WHERE uid = ${uid} LIMIT 1`;
      const r = rows[0];
      if (!r) return null;
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
      };
    },
  };
}
