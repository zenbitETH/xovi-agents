import { convertToTokenAmount, parseMoney, safeBase64Decode } from "@x402/core/utils";
import { getAddress, recoverTypedDataAddress } from "viem";

/**
 * Proving who signed an authorization without spending anything, so a wallet with
 * no money can still be given a read its allowance grants.
 *
 * **The defect this exists for.** The paid route verified every payment with the
 * facilitator before it consulted the allowance, and the facilitator refuses an
 * authorization the wallet cannot fund. So a registered person with an empty
 * wallet was answered 402 on every read, never reached the free reads the
 * allowance grants them, and left no row behind: measured on the deployment with
 * a wallet holding 0.0 USDC, which had no settlements and no recorded runs.
 *
 * The allowance sat after verification for a reason that still holds: the payer
 * address is client supplied and is trustworthy only once something has proved
 * the signer owns it, or anyone could spend anyone else's free reads by naming
 * them. Verification was that proof. This is the same proof done locally: recover
 * the signer of the exact scheme's own typed data and compare it with the address
 * the authorization names. Nothing is spent, nothing is asked of the facilitator,
 * and the guarantee is the one the ordering always depended on.
 */

/**
 * The token the ruled price settles in, and its EIP-712 domain.
 *
 * Pinned rather than read per request: a domain fetched on the free path would
 * put a network call back where the whole point is that there is none. The pin is
 * held against the token's own `DOMAIN_SEPARATOR` by the suite rather than at
 * runtime, and the suite also shows that version "1" computes a different
 * separator, which is what makes the comparison a check and not a formality: a
 * wrong domain recovers another perfectly valid address rather than throwing.
 */
export const PAYMENT_TOKEN = {
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  name: "USDC",
  version: "2",
  chainId: 84532,
} as const;

/** The exact scheme's own typed data, copied from `@x402/evm/exact/client` in the
 *  installed package rather than from a specification, so what is recovered here
 *  is what the browser signed. */
export const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type SignedAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
};

/**
 * The signed authorization, or nothing.
 *
 * All seven fields or none, for the reason `authorizationFrom` takes four or none:
 * a field filled in with an empty string would be recovered against and would
 * answer with some address, and an address recovered from an authorization the
 * caller did not write is worse than no answer at all.
 */
/**
 * The payment header as JSON, decoded with the package's own decoder.
 *
 * The free path runs before the resource server sees the request, so the header
 * is decoded here rather than handed over already parsed. `safeBase64Decode` is
 * the function the server itself decodes with, imported rather than rewritten: a
 * second decoder is a second answer about what the caller sent.
 */
export function decodePaymentHeader(header: string): { payload?: unknown } {
  try {
    const decoded: unknown = JSON.parse(safeBase64Decode(header));
    return decoded && typeof decoded === "object" ? (decoded as { payload?: unknown }) : {};
  } catch {
    // Not a header this path can read. The facilitator path below answers it, and
    // answering it here would be this module deciding what a malformed payment is.
    return {};
  }
}

export function signedAuthorizationFrom(paymentPayload: { payload?: unknown }): SignedAuthorization | null {
  const inner = (paymentPayload.payload ?? {}) as { authorization?: Record<string, unknown>; signature?: unknown };
  const a = inner.authorization;
  if (!a || typeof inner.signature !== "string") return null;
  const fields = ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const;
  if (fields.some(f => typeof a[f] !== "string")) return null;
  return {
    from: a.from as string,
    to: a.to as string,
    value: a.value as string,
    validAfter: a.validAfter as string,
    validBefore: a.validBefore as string,
    nonce: a.nonce as string,
    signature: inner.signature,
  };
}

/**
 * Who signed it, recovered locally against the pinned domain.
 *
 * Returns the address or null, and the caller compares. **Recovery is never a
 * catch**: over the wrong message or the wrong domain it does not raise, it
 * answers with a different, perfectly well formed address, so reading the absence
 * of an exception as success accepts an authorization signed by anybody.
 */
export async function signerOf(a: SignedAuthorization): Promise<string | null> {
  try {
    return await recoverTypedDataAddress({
      domain: {
        name: PAYMENT_TOKEN.name,
        version: PAYMENT_TOKEN.version,
        chainId: PAYMENT_TOKEN.chainId,
        verifyingContract: getAddress(PAYMENT_TOKEN.address),
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(a.from),
        to: getAddress(a.to),
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce as `0x${string}`,
      },
      signature: a.signature as `0x${string}`,
    });
  } catch {
    // A signature that will not parse and an address that is not one land here.
    // Null is not "somebody else signed it"; it is "this is not an authorization",
    // and both answers refuse the free read.
    return null;
  }
}

/** Two addresses compared as addresses rather than as text. */
export function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

/** What the route requires of a payment, as the free path has to check it: no
 *  facilitator sees a free read, so every one of these is checked here or by
 *  nobody. */
export type Requirements = { payTo: string; network: string; value: string };

/** The token's decimals, pinned with the rest of its domain. */
export const PAYMENT_TOKEN_DECIMALS = 6;

/**
 * The ruled price as the client signs it, through the package's own converters.
 *
 * `parseMoney` and `convertToTokenAmount` are the functions the challenge is built
 * with, imported rather than reimplemented, so the atomic value compared here is
 * the atomic value the browser was asked for. A second implementation of this
 * arithmetic is a second answer waiting to disagree with the first.
 */
export function ruledValue(price: string): string {
  return convertToTokenAmount(parseMoney(price).amount, PAYMENT_TOKEN_DECIMALS);
}

/**
 * Why this authorization may not be served free, or nothing.
 *
 * A header signed for a cent is not a free read against the ruled price, and one
 * payable to somebody else or in another token is not this route's at all. The
 * validity window is checked here because the facilitator, which would otherwise
 * check it, is not called: an expired authorization served free would be a read
 * given away on a signature that no longer authorizes anything.
 */
export function freeReadRefusal(a: SignedAuthorization, want: Requirements, now: Date): string | null {
  // The network first, and this is the one guard that is about the deployment
  // rather than the caller. The domain recovered against is one token's on one
  // chain, pinned; a route configured to charge on another chain would have its
  // payments recovered here against the wrong domain, which answers with a valid
  // address rather than failing, so the signature would prove nothing and the free
  // read would be given to whoever asked. Compared against the pin rather than
  // assumed to match it: the first version compared the pinned address with itself.
  if (want.network !== `eip155:${PAYMENT_TOKEN.chainId}`) return "this route settles on a chain this path cannot prove a signer for";
  if (!sameAddress(a.to, want.payTo)) return "the authorization pays somebody else";
  if (a.value !== want.value) return "the authorization is not for the ruled price";
  const at = Math.floor(now.getTime() / 1000);
  if (Number(a.validAfter) > at) return "the authorization is not valid yet";
  if (Number(a.validBefore) <= at) return "the authorization has expired";
  return null;
}
