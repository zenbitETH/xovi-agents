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

/**
 * The challenge, from where this client actually puts it.
 *
 * With automatic payment off, `callTool` does not return a refusal, it **throws**:
 * an Error carrying the payment-required code and the challenge on a
 * `paymentRequired` property. That is measured in the installed client, and it is
 * why an earlier version of this file read the challenge off a returned result and
 * could never pay at all.
 *
 * The package exports `extractPaymentRequiredFromError` and it is the wrong
 * accessor here: it reads `error.data`, and this throw sets `error.paymentRequired`
 * and never `data`, so it returns null on the exact error this path produces. Read
 * the property the code sets, not the one whose name matches.
 */
export function challengeFromError(error: unknown): unknown {
  const e = (error ?? {}) as { code?: number; paymentRequired?: { accepts?: unknown[] }; data?: { accepts?: unknown[] } };
  const carried = e.paymentRequired?.accepts ? e.paymentRequired : e.data?.accepts ? e.data : null;
  if (!carried) throw new NotAChallenge("the refusal carried no payment challenge this client could read");
  return carried;
}

export async function payAndCall(
  client: MinimalClient,
  name: string,
  args: Record<string, unknown>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<PaidCall> {
  const log: { attempt: number; outcome: string }[] = [];

  let challenge: unknown;
  try {
    const free = await client.callTool(name, args);
    log.push({ attempt: 1, outcome: "no-payment-required" });
    return { result: free, attempts: 1, log, receipt: receiptFrom(free) };
  } catch (err) {
    // Not an error path in any meaningful sense: with automatic payment off this is
    // how the challenge arrives. A throw that carries the thing you asked for.
    challenge = challengeFromError(err);
  }

  // Created once, outside the loop. Moving this inside is the double spend, and it
  // is the only thing between this and the rule.
  const payload = await client.paymentClient.createPaymentPayload(challenge);

  let result: unknown;
  let n = 0;
  while (n < ATTEMPTS) {
    n++;
    result = await client.callToolWithPayment(name, args, payload);
    const receipt = receiptFrom(result);
    if (receipt) {
      log.push({ attempt: n, outcome: "settled" });
      return { result, attempts: n, log, receipt };
    }
    if (spentAuthorization(result)) {
      // The token saying the nonce is spent is an earlier attempt reporting success
      // through the only channel it has left. Checked here rather than after the
      // loop, or a spent authorization on attempt two would still cost a pause and
      // a third send for an answer already in hand.
      log.push({ attempt: n, outcome: "already-settled" });
      return { result, attempts: n, log, receipt: null };
    }
    log.push({ attempt: n, outcome: "settle_failed" });
    if (n < ATTEMPTS) await sleep(BACKOFF_MS * n);
  }
  return { result, attempts: n, log, receipt: null };
}
