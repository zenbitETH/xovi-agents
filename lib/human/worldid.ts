import { createHash } from "node:crypto";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { signRequest } from "@worldcoin/idkit/signing";
import { recoverMessageAddress } from "viem";
import type { EnvLike } from "../agent/pay";
import { NoDerivationKey, derivationKeyPresent, deriveIdentifier } from "./derive";
import { type VerificationStore, expiryFrom } from "./verifications";

/**
 * Enrollment with World ID, the server's half.
 *
 * Two routes call in here. The request route asks for a signed context the
 * widget opens with, and the verify route hands over what the widget got back.
 * Everything that must be true of an enrollment is decided in this file, against
 * the installed package rather than its documentation, and three of those facts
 * were measured rather than read:
 *
 * **The signal is hashed as bytes when it looks like hex.** `hashSignal` from the
 * installed package treats a `0x` string of valid hex as raw bytes and any other
 * string as UTF-8, and the wasm the widget runs agrees: for the recording wallet
 * both give `0x00151c58…`, while hashing the 42 character string as text gives
 * `0x00a408b0…`. The documentation says a wallet address may be the signal and
 * that the backend should enforce the same value, and stops there. A server that
 * hashed the string as text would refuse every valid result. What World App
 * itself does with the raw address in a version 4 request is not measured until a
 * real result arrives, so this accepts either encoding of the lowercased payer.
 * Both are injective in the wallet, so a result for another wallet matches
 * neither, which is the property the comparison exists for.
 *
 * **`signRequest` answers `sig`, `createdAt` and `expiresAt`**, and the widget's
 * `RpContext` wants `signature`, `created_at` and `expires_at`. The remap is the
 * documentation's own and is done here so the route serves the widget's names.
 *
 * **The signing key never leaves this process.** It is read from
 * `WORLD_SIGNING_KEY` in exactly one function, used for one signature, and is not
 * part of anything returned. A check walks every client file for the name.
 */
export const VERIFY_ORIGIN = "https://developer.world.org";
export const SIGNATURE_TTL_SECONDS = 300;

export type WorldConfig = { rpId: string; action: string; environment: "staging" | "production" };

export class WorldUnconfigured extends Error {}

/** The three public facts a result is checked against. The signing key is not
 *  here on purpose: this object is safe to hold anywhere, and the key is not. */
export function worldConfigFrom(env: EnvLike = process.env): WorldConfig {
  const rpId = (env.WORLD_RP_ID ?? "").trim();
  const action = (env.NEXT_PUBLIC_WORLD_ACTION ?? "").trim();
  const environment = (env.NEXT_PUBLIC_WORLD_ENVIRONMENT ?? "").trim();
  if (!rpId.startsWith("rp_")) throw new WorldUnconfigured("WORLD_RP_ID is not set");
  if (!action) throw new WorldUnconfigured("NEXT_PUBLIC_WORLD_ACTION is not set");
  if (environment !== "staging" && environment !== "production") {
    throw new WorldUnconfigured("NEXT_PUBLIC_WORLD_ENVIRONMENT must be staging or production");
  }
  return { rpId, action, environment };
}

/**
 * The sentence the wallet signs, built from the request's nonce.
 *
 * A World ID result binds a wallet as its signal, and nothing in that proves the
 * person posting it holds the wallet: anyone can name any address as the signal
 * of their own result and enrol somebody else's wallet behind themselves, after
 * which the owner is refused as another person for thirty days. So the request
 * carries a signature from the wallet over this sentence, made with the wallet's
 * ordinary message signing, and the server recovers the signer before anything
 * is forwarded. The nonce is in the sentence so the signature is good for this
 * one request: the result's nonce is claimed once, and a signature over it is
 * spent with it.
 */
export const ENROLMENT_MESSAGE_PREFIX = "Xovi Agents enrolment ";

export function enrolmentMessage(nonce: string): string {
  return `${ENROLMENT_MESSAGE_PREFIX}${nonce}`;
}

/** What the widget opens with, the widget's five names, and the sentence the
 *  wallet signs beside them. The card strips `message` before handing the rest
 *  to the widget. */
export type RequestContext = { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string; message: string };

export function requestContext(env: EnvLike = process.env): RequestContext {
  const { rpId, action } = worldConfigFrom(env);
  const key = (env.WORLD_SIGNING_KEY ?? "").trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw new WorldUnconfigured("WORLD_SIGNING_KEY is not a 32 byte hex key");
  const signed = signRequest({ signingKeyHex: key, action, ttl: SIGNATURE_TTL_SECONDS });
  return {
    rp_id: rpId,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
    message: enrolmentMessage(signed.nonce),
  };
}

/** The two hashes a result bound to this wallet may carry, both lowercase. */
export function signalHashesFor(payer: string): string[] {
  const lower = payer.toLowerCase();
  return [hashSignal(lower).toLowerCase(), hashSignal(new TextEncoder().encode(lower)).toLowerCase()];
}

/**
 * The verifier, behind a seam.
 *
 * The real one is a POST to World's developer portal and needs a registered
 * relying party to answer anything but a refusal, so the checks stand a fake here
 * that records the exact body it received and answers as configured. That is
 * what makes "forwarded unmodified" and "refused before the forward" claims
 * about calls rather than about intent.
 */
export type Verifier = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<Response>;

let injectedVerifier: Verifier | undefined;

export function setVerifierForTest(verifier: Verifier | undefined): void {
  injectedVerifier = verifier;
}

function verifier(): Verifier {
  return injectedVerifier ?? ((url, init) => fetch(url, init));
}

/** The shape this file relies on, and no more. Everything else in the result is
 *  forwarded as it came and never read. */
type ResultShape = {
  nonce: string;
  action: string;
  environment: string;
  responses: { identifier: string; signal_hash: string; proof: unknown }[];
};

function shapeOf(result: unknown): ResultShape | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  // Version 4 only. A 3.0 result carries a different nullifier for the same
  // person, so admitting both would let one person enrol two wallets, one under
  // each; the widget asks for no legacy fallback and the server holds the line.
  if (r.protocol_version !== "4.0") return null;
  if (typeof r.nonce !== "string" || !r.nonce) return null;
  // A session result carries `session_id` and no action, and its nullifier is
  // scoped to the session rather than to the action this table is keyed on.
  if (typeof r.action !== "string" || !r.action) return null;
  if (typeof r.environment !== "string") return null;
  if (!Array.isArray(r.responses) || r.responses.length === 0) return null;
  const responses: ResultShape["responses"] = [];
  for (const item of r.responses) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    if (typeof p.identifier !== "string" || typeof p.signal_hash !== "string") return null;
    if (!("proof" in p)) return null;
    responses.push({ identifier: p.identifier, signal_hash: p.signal_hash, proof: p.proof });
  }
  return { nonce: r.nonce, action: r.action, environment: r.environment, responses };
}

/** A digest of the proof bytes, so the same proof under an edited nonce is still
 *  the same proof. */
function proofDigestOf(shape: ResultShape): string {
  return createHash("sha256").update(JSON.stringify(shape.responses.map(p => p.proof))).digest("hex");
}

/** Fixed sentences, so a check can hold them and a person can search for them. */
export const ANOTHER_WALLET = "This person already stands behind another wallet. One wallet per person.";
export const ANOTHER_PERSON = "This wallet is enrolled behind another person until that enrollment lapses.";
export const ALREADY_USED = "This result was already used. Verify again for a fresh one.";
export const OTHER_WALLET = "This result is bound to another wallet.";
export const NOT_SIGNED = "This wallet did not sign this request.";

/**
 * The verifier's refusal codes this passes through, and no other.
 *
 * Two were measured against the staging relying party, `all_verifications_failed`
 * for a result it could not verify and `app_not_migrated` for a relying party it
 * does not know; the rest are the ones its documentation names. A code outside
 * the list is answered with a fixed sentence, so the answer never carries a
 * string somebody else wrote.
 */
export const VERIFIER_CODES = [
  "all_verifications_failed",
  "app_not_migrated",
  "invalid_proof",
  "verification_failed",
  "verification_error",
  "not_registered",
] as const;

export type Refusal = { ok: false; status: number; error: string };
export type Enrolled = { ok: true; credential: string; expiresAt: Date };

/**
 * Verify one result and record the enrollment, or say why not.
 *
 * The order is the argument. Shape, action, environment and the wallet binding
 * are checked first because they cost nothing and refuse without a call. The
 * replay claim is next and BEFORE the forward, so a result posted twice reaches
 * the verifier once. Only then is the result forwarded, exactly as it arrived,
 * and only a verifier that could not be reached gives the claim back.
 *
 * The nullifier exists in this function between the verifier's answer and the
 * derivation and nowhere else: it is not returned, not logged and not compared.
 */
export async function verifyEnrollment(input: {
  payer: string;
  result: unknown;
  /** The wallet's signature over `enrolmentMessage(result.nonce)`. */
  signature: string;
  store: VerificationStore | null;
  at: Date;
  env?: EnvLike;
}): Promise<Enrolled | Refusal> {
  const env = input.env ?? process.env;
  const payer = input.payer.toLowerCase();
  if (!input.store) return { ok: false, status: 503, error: "no store is configured, so an enrollment cannot be recorded" };

  let config: WorldConfig;
  try {
    config = worldConfigFrom(env);
  } catch {
    return { ok: false, status: 503, error: "enrollment is not configured" };
  }
  // Refused before the forward rather than after it: with no key there is
  // nothing to store, so there is no reason to spend a verification.
  if (!derivationKeyPresent(env)) {
    return { ok: false, status: 503, error: "no derivation key is configured, so nothing can be recorded" };
  }

  const shape = shapeOf(input.result);
  if (!shape) return { ok: false, status: 400, error: "that is not a World ID result" };
  if (shape.action !== config.action) return { ok: false, status: 400, error: "the result is for another action" };
  if (shape.environment !== config.environment) return { ok: false, status: 400, error: "the result is from the other environment" };

  // Control of the wallet, before the binding and before any call: the signer of
  // the sentence built from this result's nonce must be the wallet named. A
  // signature by any other key, over any other nonce, or not a signature at all,
  // is the same refusal.
  let signer: string | null;
  try {
    signer = await recoverMessageAddress({ message: enrolmentMessage(shape.nonce), signature: input.signature as `0x${string}` });
  } catch {
    signer = null;
  }
  if (signer === null || signer.toLowerCase() !== payer) return { ok: false, status: 403, error: NOT_SIGNED };

  // The binding. Derived from the address the server holds, never read from the
  // body: a `signal` field in the body, were there one, would not be consulted.
  const allowed = signalHashesFor(payer);
  if (!shape.responses.every(p => allowed.includes(p.signal_hash.toLowerCase()))) {
    return { ok: false, status: 403, error: OTHER_WALLET };
  }

  const proofDigest = proofDigestOf(shape);
  if (!(await input.store.claimResult(shape.nonce, proofDigest, input.at))) {
    return { ok: false, status: 409, error: ALREADY_USED };
  }

  let answer: Response;
  try {
    answer = await verifier()(`${VERIFY_ORIGIN}/api/v4/verify/${config.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The result as it arrived. Parsed once to read the fields above and
      // serialised again here; no field is added, dropped or rewritten.
      body: JSON.stringify(input.result),
    });
  } catch {
    await input.store.releaseResult(shape.nonce);
    return { ok: false, status: 503, error: "the verifier did not answer" };
  }
  if (answer.status >= 500) {
    await input.store.releaseResult(shape.nonce);
    return { ok: false, status: 503, error: "the verifier did not answer" };
  }

  let body: Record<string, unknown>;
  try {
    body = (await answer.json()) as Record<string, unknown>;
  } catch {
    await input.store.releaseResult(shape.nonce);
    return { ok: false, status: 503, error: "the verifier did not answer" };
  }
  if (!answer.ok || body.success !== true) {
    // A known code word and nothing else. `detail` is the verifier's prose and is
    // not read, and a code outside the list is not repeated, so nothing the
    // verifier wrote reaches a body or a log.
    const known = (VERIFIER_CODES as readonly string[]).includes(String(body.code));
    return { ok: false, status: 400, error: known ? `the verifier refused: ${String(body.code)}` : "the verifier refused" };
  }

  const results = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
  const passed = results.find(r => r.success === true);
  const raw = typeof body.nullifier === "string" ? body.nullifier : typeof passed?.nullifier === "string" ? passed.nullifier : null;
  if (raw === null || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    return { ok: false, status: 502, error: "the verifier answered without an identifier" };
  }
  const credentialWord = typeof passed?.identifier === "string" ? passed.identifier : shape.responses[0].identifier;
  const credential = /^[a-z_]+$/.test(credentialWord) ? credentialWord : "unknown";

  let digest: string;
  try {
    digest = deriveIdentifier(BigInt(raw), env);
  } catch (err) {
    if (err instanceof NoDerivationKey) return { ok: false, status: 503, error: "no derivation key is configured, so nothing can be recorded" };
    throw err;
  }

  await input.store.forgetExpired(input.at);
  const outcome = await input.store.enroll({
    payer,
    action: config.action,
    nullifierDigest: digest,
    credential,
    verifiedAt: input.at,
    expiresAt: expiryFrom(input.at),
  });
  if (outcome === "another-wallet") return { ok: false, status: 409, error: ANOTHER_WALLET };
  if (outcome === "another-person") return { ok: false, status: 409, error: ANOTHER_PERSON };
  return { ok: true, credential, expiresAt: expiryFrom(input.at) };
}
