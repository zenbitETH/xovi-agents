import { ATTEMPTS, BACKOFF_MS, spentAuthorization } from "../agent/pay";
import { receiptFrom } from "./server";

/**
 * A paid tool call that survives a flaky counterparty without ever paying twice.
 *
 * The library's automatic mode does the whole challenge, pay and call in one, which
 * is convenient and cannot be retried: retrying it signs again, and a fresh
 * signature carries a fresh nonce and is a second authorization. So the three steps
 * are written out, the payload is created ONCE, and only the send is repeated.
 *
 * That is safe for the same reason it is safe on the paid read, and it is a
 * property of the primitive rather than of this code: an authorization carries a
 * nonce the token refuses to reuse, so resending identical bytes is at most once
 * whatever this loop does. If the first attempt actually landed, the second is
 * refused by the contract.
 */
export type PaidCall = {
  result: unknown;
  attempts: number;
  /** Every attempt's outcome, so a flake is visible afterwards rather than smoothed away. */
  log: { attempt: number; outcome: string }[];
  receipt: { transaction?: string; network?: string } | null;
};

type MinimalClient = {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  callToolWithPayment(name: string, args: Record<string, unknown>, payload: unknown): Promise<unknown>;
  paymentClient: { createPaymentPayload(required: unknown): Promise<unknown> };
};

export class NotAChallenge extends Error {}

/** The challenge a refusal carries, from the result rather than from a header. */
export function challengeFrom(result: unknown): unknown {
  const r = (result ?? {}) as { structuredContent?: unknown; content?: { text?: string }[] };
  const structured = r.structuredContent as { accepts?: unknown[] } | undefined;
  if (structured?.accepts) return structured;
  try {
    const parsed = JSON.parse(r.content?.[0]?.text ?? "") as { accepts?: unknown[] };
    if (parsed?.accepts) return parsed;
  } catch {
    /* falls through to the raise below */
  }
  throw new NotAChallenge("the refusal carried no payment challenge this client could read");
}

export async function payAndCall(
  client: MinimalClient,
  name: string,
  args: Record<string, unknown>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<PaidCall> {
  const log: { attempt: number; outcome: string }[] = [];

  const free = await client.callTool(name, args);
  const receiptIfFree = receiptFrom(free);
  if (!(free as { isError?: boolean }).isError) {
    log.push({ attempt: 1, outcome: "no-payment-required" });
    return { result: free, attempts: 1, log, receipt: receiptIfFree };
  }

  // Created once, outside the loop. Moving this inside is the double spend.
  const payload = await client.paymentClient.createPaymentPayload(challengeFrom(free));
  const bytes = JSON.stringify(payload);

  let result: unknown;
  let n = 0;
  while (n < ATTEMPTS) {
    n++;
    if (JSON.stringify(payload) !== bytes) {
      throw new Error("the payment payload changed between attempts, which would be a second authorization");
    }
    result = await client.callToolWithPayment(name, args, payload);
    const receipt = receiptFrom(result);
    if (receipt) {
      log.push({ attempt: n, outcome: "settled" });
      return { result, attempts: n, log, receipt };
    }
    if (spentAuthorization(result)) {
      // The token saying the nonce is spent is the first attempt reporting success
      // through the only channel it has left.
      log.push({ attempt: n, outcome: "already-settled" });
      return { result, attempts: n, log, receipt: null };
    }
    log.push({ attempt: n, outcome: "settle_failed" });
    if (n < ATTEMPTS) await sleep(BACKOFF_MS * n);
  }
  return { result, attempts: n, log, receipt: null };
}
