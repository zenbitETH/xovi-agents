// Copied verbatim from the private Xovi repository at origin/dev 2754a0eb (2026-09-08).
import { type Address, type Client, getAddress, recoverMessageAddress } from "viem";
import { verifyMessage } from "viem/actions";

/**
 * What a reviewer signs when they decide a clip.
 *
 * The point of this file is that "a human confirmed this" stops being a claim the
 * server makes about itself and becomes something a third party can check. Before
 * it, the whole chain of custody was an iron-session cookie, a `verified_by`
 * column, and an attestation signed by a backend key: possession of that key, or
 * of the database URL, produced a record indistinguishable from a genuine one.
 *
 * The message is deliberately readable rather than a hash. A reviewer is about to
 * put their key behind a decision, and a wallet prompt showing 32 opaque bytes
 * teaches them to approve without reading, which is the habit every signature
 * phishing attack depends on. They should be able to see the clip, the decision
 * and the hash in the prompt and recognise all three.
 */
export type ConfirmationPayload = {
  clipId: number;
  clipHash: `0x${string}`;
  decision: "verified" | "rejected";
  nonce: `0x${string}`;
  chainId: number;
};

/** 32 bytes, lowercase hex. Shared so the client cannot mint a shape the server
 *  refuses, and so nothing wider than the column ever reaches the database. */
export const NONCE_RE = /^0x[0-9a-f]{64}$/;

/**
 * A fresh nonce.
 *
 * `crypto.getRandomValues`, NOT `crypto.randomUUID`. randomUUID is gated on a secure
 * context, so it is undefined over plain HTTP, and this project reviews from bench
 * machines on a LAN where that is exactly the case: the call would throw a TypeError
 * out of an async click handler and the button would simply do nothing. It also
 * yields 16 bytes, which is ample entropy but is not the bytes32 that the column
 * width, the type and the wallet prompt all claim it is.
 */
export function newNonce(): `0x${string}` {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, x => x.toString(16).padStart(2, "0")).join("")}`;
}

/** The exact bytes both sides sign and verify. Any drift here is a silent
 *  authentication failure, so there is one function and both sides call it. */
export function confirmationMessage(p: ConfirmationPayload): string {
  return [
    "Xovi — confirmación de revisión",
    "",
    "Al firmar, respondes por esta decisión con tu dirección.",
    "",
    `Clip:      ${p.clipId}`,
    `Hash:      ${p.clipHash}`,
    `Decisión:  ${p.decision}`,
    `Nonce:     ${p.nonce}`,
    `Chain:     ${p.chainId}`,
  ].join("\n");
}

export type ConfirmationCheck =
  | { ok: true; signer: Address; via: "ecdsa" | "contract" }
  | { ok: false; reason: "malformed" | "wrong-signer" | "verifier-unavailable" };

/**
 * Verify the signature belongs to the session that is acting.
 *
 * Two paths, cheapest first. An EOA is settled locally with no network call. Only
 * when local recovery fails to match do we spend an eth_call on ERC-6492 and
 * ERC-1271, which is what a Safe or any other contract account needs.
 *
 * That second path is not optional, and its absence was a real hole. The login
 * route accepts contract signatures, so a Safe can hold a session that isVerifier()
 * approves. An ECDSA-only check here would have let such an account log in, pass
 * authorisation, and then be unable to confirm anything at all, with no fallback
 * once unsigned confirmations are refused. The login boundary and this boundary
 * have to admit the same signers, or the allow-list means two different things
 * depending on which one you ask.
 *
 * Note what `wrong-signer` covers. Recovery over an altered message yields a
 * different address, so a tampered payload and a signature from somebody else are
 * indistinguishable here and both land in that branch. Both are refusals and the
 * distinction has no operational value, but do not read the label as proof that a
 * third party was involved.
 *
 * `verifier-unavailable` is separate and FAILS CLOSED. An RPC outage must never
 * approve a signature, and it must not be reported as a rejection either: an
 * operator needs to tell an outage from an attack.
 *
 * Carried caveat, and it qualifies this file's own premise. A contract signature is
 * chain-state dependent: rotate a Safe's owners and a signature that verified
 * yesterday stops verifying. That is why the chain id is persisted alongside it, and
 * why a record's provability is only ever as durable as the account that made it.
 */
export async function checkConfirmationSignature(
  payload: ConfirmationPayload,
  signature: string,
  expectedSigner: string,
  client: Client,
): Promise<ConfirmationCheck> {
  // A loose upper bound rather than exactly 65 bytes. A 2-of-3 Safe returns roughly
  // 130 bytes, and pinning the length to one ECDSA signature rejected every
  // multi-owner account as "malformed" before recovery was even attempted.
  if (!/^0x[0-9a-fA-F]{130,4096}$/.test(signature)) return { ok: false, reason: "malformed" };
  const sig = signature as `0x${string}`;
  const message = confirmationMessage(payload);
  const expected = getAddress(expectedSigner);

  try {
    const recovered = await recoverMessageAddress({ message, signature: sig });
    if (getAddress(recovered) === expected) return { ok: true, signer: expected, via: "ecdsa" };
  } catch {
    // Not recoverable as ECDSA, which is the expected shape for a contract
    // signature. Fall through rather than refusing here.
  }

  try {
    const valid = await verifyMessage(client, { address: expected, message, signature: sig });
    return valid ? { ok: true, signer: expected, via: "contract" } : { ok: false, reason: "wrong-signer" };
  } catch {
    return { ok: false, reason: "verifier-unavailable" };
  }
}
