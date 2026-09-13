import type { HTTPPaymentStatus } from "@x402/core/client";
import { MAX_PER_PAYMENT } from "./spend";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

/** Same shape the server side uses, so tests never touch process.env. */
export type EnvLike = Record<string, string | undefined>;

export class PayerMisconfigured extends Error {}

/**
 * Why the payment is assembled here instead of wrapping fetch.
 *
 * The helper everybody reaches for is wrapFetchWithPayment, and it does not exist
 * at the version installed. It ships in x402-fetch, which is neither a dependency
 * of this package nor present in the lockfile; what is installed is @x402/core and
 * @x402/evm at 2.25.0. So the four steps are written out: read the challenge from
 * the header, sign a payload, put it in PAYMENT-SIGNATURE, and read the receipt.
 *
 * One trap worth naming, because the compiler will not catch it. There are two
 * functions called registerExactEvmScheme. The server one takes the resource
 * server alone and is used in lib/x402.ts. This is the client one and it takes a
 * signer as well. Same name, different module, different arity.
 */
function readConfig(env: EnvLike) {
  const key = (env.AGENT_PRIVATE_KEY ?? "").trim();
  // Fails closed. A missing key must not silently degrade into an unpaid GET that
  // gets a 402 and reports it as the endpoint being broken.
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new PayerMisconfigured("AGENT_PRIVATE_KEY is not a 32 byte hex key");
  }
  return {
    key: key as `0x${string}`,
    // Spend controls default to a dollar a payment. A window costs a cent, so the
    // default is not reached, but the cap is set explicitly anyway: the price comes
    // from the server in the challenge, and a client that will pay whatever it is
    // told is one typo away from paying it.
    maxAmountPerPayment: env.AGENT_MAX_PER_PAYMENT ?? MAX_PER_PAYMENT,
  };
}

export type Payer = {
  address: `0x${string}`;
  http: x402HTTPClient;
};

export function buildPayer(env: EnvLike = process.env): Payer {
  const cfg = readConfig(env);
  const account = privateKeyToAccount(cfg.key);
  const core = new x402Client();
  // Base Sepolia USDC is EIP-3009, so the account satisfies the signer contract
  // with address and signTypedData alone. No public client and no RPC URL are
  // needed here; a Permit2 token would need both.
  registerExactEvmScheme(core, { signer: account });
  core.setSpendControls({ maxAmountPerPayment: cfg.maxAmountPerPayment });
  return { address: account.address, http: new x402HTTPClient(core) };
}

/**
 * The recipient named in the live challenge, checked before paying it.
 *
 * Read from the challenge rather than from the environment, because reading it
 * locally compares the payer against what the operator believes the server charges
 * to, and that belief is exactly the value that is wrong on the day this matters.
 * An unreadable recipient raises rather than being skipped: the case where the two
 * addresses might silently be the same is the case where reading one of them failed.
 *
 * Shared by the probe and the agent instead of copied into both, which is how the
 * first version of this check came to exist in one of them and not the other.
 */
export async function assertRecipient(
  url: string,
  payer: Payer,
  fetchImpl: typeof fetch = fetch,
): Promise<`0x${string}`> {
  const challenge = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (challenge.status !== 402) throw new Error(`expected a 402 naming a recipient, got ${challenge.status}`);
  const body = await challenge.json().catch(() => ({}));
  const required = payer.http.getPaymentRequiredResponse(name => challenge.headers.get(name), body);
  const payTo = required.accepts[0]?.payTo;
  if (!payTo) throw new Error("the challenge names no recipient, so the payer cannot be compared against it");
  if (payTo.toLowerCase() === payer.address.toLowerCase()) {
    throw new Error("payer and payTo are the same address: a self payment settles and proves nothing");
  }
  return payTo as `0x${string}`;
}

export type PaidRead = {
  status: number;
  body: unknown;
  paymentStatus: HTTPPaymentStatus;
  /** Present when the payment settled. The transaction is resolvable on the explorer. */
  settlement?: { transaction: string; network: string; payer?: string };
};

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * GET a resource, paying for it if it answers 402.
 *
 * The payer is passed in rather than built from the environment, because the
 * caller needs its address anyway: it is what --agent stamps on the credential,
 * and it is the address that must differ from the recipient before a settlement
 * proves anything. Building it here would hide that.
 *
 * A 402 that carries no PAYMENT-REQUIRED header is not a challenge, it is a
 * refusal that happens to share the status code. This endpoint has one: a caller
 * sending the v1 X-PAYMENT header is told so rather than handed a challenge it
 * cannot use. Trying to parse that as a challenge would turn a clear message into
 * a parse error, so it is returned as it arrived.
 *
 * There is no field here saying whether the read was free. paymentStatus already
 * says it, and a boolean beside it would have to answer "was nothing owed" and
 * "was it refused before paying" with the same value.
 */
/** Three attempts in all, which is two retries. Enough to ride out a flake and few
 *  enough that a demo does not stall behind a counterparty that is simply down. */
export const ATTEMPTS = 3;
export const BACKOFF_MS = 1200;

/**
 * Does this refusal mean the authorization was already spent?
 *
 * Matched on the token's own vocabulary rather than on a facilitator's error code,
 * because the code is the counterparty's to change and the revert string belongs to
 * the contract. Deliberately narrow: anything it does not recognise stays a failure.
 */
export function spentAuthorization(body: unknown): boolean {
  return /authorization is used|already used|used or canceled|nonce already/i.test(JSON.stringify(body ?? ""));
}

export async function payingFetch(
  url: string,
  payer: Payer,
  fetchImpl: typeof fetch = fetch,
  onAttempt?: (a: { attempt: number; outcome: string }) => void,
): Promise<PaidRead> {
  const first = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (first.status !== 402) {
    return { status: first.status, body: await readBody(first), paymentStatus: "none" };
  }

  const body = await readBody(first);
  if (!first.headers.get("PAYMENT-REQUIRED")) {
    return { status: 402, body, paymentStatus: "none" };
  }

  const { http } = payer;
  const required = http.getPaymentRequiredResponse(name => first.headers.get(name), body);
  // Signed ONCE, outside the retry. This is the whole safety argument: an
  // authorization carries a nonce the token refuses to reuse, so resending these
  // exact bytes is at most once by the primitive rather than by care taken here. Signing
  // again would mint a fresh nonce and a second authorization, which is a real
  // double spend and is what the original no-retry rule was protecting against.
  const payload = await http.createPaymentPayload(required);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);
  // Nothing here compares the headers to themselves between attempts. A guard that
  // re-serialises the same object it is guarding can never fire, and it reads as
  // evidence while providing none. The evidence that no second authorization is
  // signed is the counterparty's own record of the bytes it received, which is
  // check 47b, and the signature counter on the query client.

  let result = await attempt();
  let attempts = 1;
  for (let n = 2; n <= ATTEMPTS && result.paymentStatus === "settle_failed"; n++) {
    // The counterparty failed to land a valid authorization. Observed on the live
    // testnet facilitator, where the transfer simulated successfully from the
    // facilitator's own address, so the payment was good and the settlement was
    // not. That is the only failure worth retrying and it is why the distinction
    // was worth measuring before this was written.
    onAttempt?.({ attempt: n - 1, outcome: "settle_failed" });
    await new Promise(r => setTimeout(r, BACKOFF_MS * (n - 1)));
    result = await attempt();
    attempts = n;
  }
  // The real index. This logged `Math.min(ATTEMPTS, 1)`, which is the constant 1,
  // so every run reported its outcome against attempt one however many it took, and
  // a flake ridden out on the third looked identical to one that never happened.
  onAttempt?.({ attempt: attempts, outcome: result.paymentStatus });

  // A refusal saying the authorization is spent is the token reporting that the FIRST
  // attempt landed. It is the retry's own success arriving as an error, and reading
  // it as a failure would report a payment that happened as one that did not, which
  // is the same wrong direction as printing "no receipt" over a settled call.
  if (result.paymentStatus === "settle_failed" && spentAuthorization(result.body)) {
    return { status: result.status, body: result.body, paymentStatus: "settled" };
  }

  async function attempt() {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", ...paymentHeaders },
    });
    return http.processResponse(response);
  }

  const settled =
    result.paymentStatus === "settled" && result.header && "transaction" in result.header
      ? {
          transaction: String(result.header.transaction),
          network: String(result.header.network),
          payer: result.header.payer ? String(result.header.payer) : undefined,
        }
      : undefined;

  return {
    status: result.status,
    body: result.body,
    paymentStatus: result.paymentStatus,
    settlement: settled,
  };
}
