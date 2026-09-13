import { neon } from "@neondatabase/serverless";

/**
 * The nonces free reads have spent.
 *
 * A free read settles nothing, so the token never burns the nonce the
 * authorization carries and the same signed header stays presentable for as long
 * as it is valid. Without this, whoever captured one header could spend a
 * person's whole allowance with it, one read at a time. Taking the nonce is what
 * makes a free read cost something.
 *
 * **One statement, and the insert is the take.** Asking whether a nonce is
 * present and then recording it is two operations, and two requests carrying the
 * same header would both be told it was free. `ON CONFLICT DO NOTHING` with the
 * row count as the answer is one round trip that cannot be raced, which is the
 * same shape the allowance counter uses for the same reason.
 */
export type NonceStore = {
  /** True where this nonce had not been spent and now is. False where it had. */
  take(nonce: string, signer: string, at: Date): Promise<boolean>;
  /** Purged on the request path rather than on a schedule, as the usage rows are:
   *  a declared retention that depends on a cron somebody can switch off is not a
   *  retention. */
  forgetOlderThan(days: number, now: Date): Promise<void>;
};

let injected: NonceStore | null | undefined;

export function setNonceStoreForTest(store: NonceStore | null | undefined): void {
  injected = store;
}

export function nonceStoreFrom(env: Record<string, string | undefined> = process.env): NonceStore | null {
  if (injected !== undefined) return injected;
  const url = env.DATABASE_URL;
  return url ? postgresNonceStore(url) : null;
}

export function postgresNonceStore(connectionString: string): NonceStore {
  const sql = neon(connectionString);
  return {
    async take(nonce: string, signer: string, at: Date): Promise<boolean> {
      const rows = (await sql`
        INSERT INTO free_read_nonces (nonce, signer, taken_at)
        VALUES (${nonce.toLowerCase()}, ${signer.toLowerCase()}, ${at.toISOString()})
        ON CONFLICT (nonce) DO NOTHING
        RETURNING nonce
      `) as unknown[];
      return rows.length === 1;
    },

    async forgetOlderThan(days: number, now: Date): Promise<void> {
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      await sql`DELETE FROM free_read_nonces WHERE taken_at < ${cutoff.toISOString()}`;
    },
  };
}
