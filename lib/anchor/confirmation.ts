import { type Address, recoverMessageAddress } from "viem";
import { DECISION_WORD, type DecisionCode } from "./schema";

/**
 * The exact bytes a reviewer put their key behind.
 *
 * This is a protocol constant copied from the reviewing application, not prose and
 * not user-facing copy. **Do not normalise it.** The house rule against the dash as
 * punctuation would change the em dash in the heading, and the rule that this
 * repository writes in English would change the rest, and either edit invalidates
 * every confirmation ever signed, including the ones already recorded. The spec
 * publishes the same bytes with the padding counted, for the same reason.
 *
 * Values start at column twelve. Nine lines, joined with a single newline.
 */
export function confirmationMessage(c: {
  clipId: number;
  clipHash: string;
  decision: DecisionCode;
  verifierNonce: string;
  verifierChainId: number;
}): string {
  return [
    "Xovi — confirmación de revisión",
    "",
    "Al firmar, respondes por esta decisión con tu dirección.",
    "",
    `Clip:      ${c.clipId}`,
    `Hash:      ${c.clipHash}`,
    `Decisión:  ${DECISION_WORD[c.decision]}`,
    `Nonce:     ${c.verifierNonce}`,
    `Chain:     ${c.verifierChainId}`,
  ].join("\n");
}

/**
 * Who signed it, according to the signature alone.
 *
 * Recovery is not the check. It answers with an address for any message at all, so
 * a wrong template returns a different, perfectly well formed address rather than
 * raising: a caller that wraps this in a try and reads the absence of an exception
 * as success will accept a message with one space missing. Callers compare the
 * answer to the verifier the record claims, which is what `signedBy` does.
 */
export async function recoverConfirmer(
  c: Parameters<typeof confirmationMessage>[0],
  signature: string,
): Promise<Address> {
  return recoverMessageAddress({
    message: confirmationMessage(c),
    signature: signature as `0x${string}`,
  });
}

/** The criterion, stated once so nobody restates it more weakly. */
export async function signedBy(
  c: Parameters<typeof confirmationMessage>[0],
  signature: string,
  claimed: string,
): Promise<boolean> {
  const recovered = await recoverConfirmer(c, signature);
  return recovered.toLowerCase() === claimed.toLowerCase();
}
