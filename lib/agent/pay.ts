import type { HTTPPaymentStatus } from "@x402/core/client";
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
    maxAmountPerPayment: env.AGENT_MAX_PER_PAYMENT ?? "$0.05",
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
export async function payingFetch(
  url: string,
  payer: Payer,
  fetchImpl: typeof fetch = fetch,
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
  const payload = await http.createPaymentPayload(required);
  const paymentHeaders = http.encodePaymentSignatureHeader(payload);

  const second = await fetchImpl(url, {
    headers: { accept: "application/json", ...paymentHeaders },
  });
  const result = await http.processResponse(second);

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
