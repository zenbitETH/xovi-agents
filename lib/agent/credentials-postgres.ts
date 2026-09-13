import { neon } from "@neondatabase/serverless";
import type { CredentialRow, CredentialStore } from "./credentials";

/** The credentials, over the same driver. Two statements, both one round trip. */
export function postgresCredentials(connectionString: string): CredentialStore {
  const sql = neon(connectionString);
  return {
    byPayer: async payer => {
      const rows = await sql`
        SELECT payer, ciphertext, nonce, key_prefix, minted_at FROM credentials WHERE payer = ${payer}`;
      if (rows.length === 0) return null;
      const r = rows[0] as Record<string, unknown>;
      return {
        payer: String(r.payer),
        ciphertext: String(r.ciphertext),
        nonce: String(r.nonce),
        keyPrefix: String(r.key_prefix),
        mintedAt: new Date(r.minted_at as string),
      };
    },
    put: async (row: CredentialRow) => {
      const written = await sql`
        INSERT INTO credentials (payer, ciphertext, nonce, key_prefix, minted_at)
        VALUES (${row.payer}, ${row.ciphertext}, ${row.nonce}, ${row.keyPrefix}, ${row.mintedAt.toISOString()}::timestamptz)
        ON CONFLICT (payer) DO NOTHING
        RETURNING payer`;
      return written.length > 0;
    },
  };
}
