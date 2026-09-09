import { encodePacked, keccak256 } from "viem";

/**
 * The frozen artefact.
 *
 * Registered once, on one chain, and never edited. The identifier of a schema is a
 * hash of the string itself, so this constant is not a description of the schema:
 * it IS the schema, and a single space added anywhere makes a different one with a
 * different identifier that nothing already anchored belongs to.
 *
 * No space after any comma, matching the convention the sibling product froze its
 * own schemas under, so the two read as one family.
 */
export const SCHEMA =
  "uint32 clipId,bytes32 clipHash,uint8 decision,address verifier,bytes verifierSignature,bytes32 verifierNonce,uint32 verifierChainId,uint64 verifiedAt,address submitter,uint16 confidence";

/** No resolver. Nothing can gate or reject an attestation after the fact. */
export const RESOLVER = "0x0000000000000000000000000000000000000000" as const;

/** A contested confirmation must be withdrawable without rewriting history. */
export const REVOCABLE = true;

/**
 * The identifier the registry will give this schema, computable before it exists.
 *
 * Same formula the registry uses, so this predicts rather than guesses, and the
 * registration script prints it next to what the registry answers.
 */
export function schemaUid(schema: string = SCHEMA): `0x${string}` {
  return keccak256(encodePacked(["string", "address", "bool"], [schema, RESOLVER, REVOCABLE]));
}

/**
 * What the reviewer's decision is worth as a number, and the word it stands for.
 *
 * Both directions are frozen because the reviewer signed a WORD. The row carries a
 * `status` column and no `decision` column at all, so a reader holding `1` who does
 * not know it means the literal string `verified` cannot rebuild the bytes that
 * were signed, and a signature over the wrong word recovers a valid address that
 * simply is not theirs.
 */
export const DECISION_WORD = { 1: "verified", 0: "rejected" } as const;
export type DecisionCode = keyof typeof DECISION_WORD;
export type DecisionWord = (typeof DECISION_WORD)[DecisionCode];

export function decisionCode(word: string): DecisionCode {
  if (word === "verified") return 1;
  if (word === "rejected") return 0;
  throw new UnanchorableClip(`decision is neither verified nor rejected: ${word}`);
}

/** Only a confirmation is ever anchored. A rejection is a decision the reviewing
 *  application keeps, and this milestone publishes confirmations. */
export const ANCHORED_DECISION: DecisionCode = 1;

export class UnanchorableClip extends Error {}
