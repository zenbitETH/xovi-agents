import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getAddress } from "viem";
import type { EnvLike } from "./pay";
import { PARENT, type NamesStore } from "./names-store";

/**
 * The agent credential an enrolled wallet proposes with.
 *
 * Enrolment used to end at a row; it ends at a credential now. Once a wallet has a
 * person behind it, by either source, this asks the reviewing application to mint
 * the machine credential bound to that address, and keeps what came back
 * encrypted. The run then proposes under the wallet's own credential, so the clip
 * the reviewing application records carries that wallet as its submitter and not
 * a key shared by everyone.
 *
 * THREE THINGS NEVER LEAVE THIS MODULE IN THE CLEAR. The mint secret is read from
 * `INGEST_MINT_SECRET` in one function and sent to one origin. The credential is
 * held between the mint's answer and the encryption, and again between the
 * decryption and the ingest header, and nowhere else: not in a row, not in an
 * answer to a browser, not in a log. The encryption key is read from
 * `CREDENTIAL_KEY` inside the two functions that use it.
 *
 * THE MINT IS ONCE. The reviewing application answers the credential on the call
 * that mints it and only its prefix afterwards, so a row that is lost after the
 * mint cannot be rebuilt from either side. The row is written the moment the
 * answer is decoded and before anything else; if that write fails the failure is
 * logged with the prefix and the wallet, which is enough for an operator to
 * re-mint on the other side and nothing an attacker could use.
 */
export const MINT_PATH = "/api/ingest/keys";

/** How the secret travels. A bearer, the way the ingest credential itself does;
 *  the reviewing application's route is the authority on this name. */
export const MINT_HEADER = "authorization";

/** Format published with the credential primitive: `xvi_<12 hex>_<secret>`. */
const CREDENTIAL = /^xvi_([0-9a-f]{12})_(.+)$/;

export type CredentialRow = {
  /** Lowercased. */
  payer: string;
  ciphertext: string;
  nonce: string;
  keyPrefix: string;
  mintedAt: Date;
};

export type CredentialStore = {
  byPayer(payer: string): Promise<CredentialRow | null>;
  /** Insert, once. False when a row was already there, so a second mint that
   *  somehow reached here is observable rather than an overwrite. */
  put(row: CredentialRow): Promise<boolean>;
};

let injectedStore: CredentialStore | null | undefined;

/** Test seam, the shape of the names store's: `undefined` restores the real
 *  lookup, `null` is a deployment with no database. */
export function setCredentialStoreForTest(store: CredentialStore | null | undefined): void {
  injectedStore = store;
}

export function credentialStoreFrom(env: EnvLike = process.env): CredentialStore | null {
  if (injectedStore !== undefined) return injectedStore;
  if (!env.DATABASE_URL) return null;
  const { postgresCredentials } = require("./credentials-postgres") as typeof import("./credentials-postgres");
  return postgresCredentials(env.DATABASE_URL);
}

export class NoCredentialKey extends Error {}

function keyFrom(env: EnvLike): Buffer {
  const hex = (env.CREDENTIAL_KEY ?? "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new NoCredentialKey("CREDENTIAL_KEY is not 32 bytes of hex");
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM with a fresh twelve byte nonce; the tag rides on the ciphertext. */
export function encryptCredential(plaintext: string, env: EnvLike = process.env): { ciphertext: string; nonce: string } {
  const key = keyFrom(env);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString("hex"), nonce: nonce.toString("hex") };
}

export function decryptCredential(row: { ciphertext: string; nonce: string }, env: EnvLike = process.env): string {
  const key = keyFrom(env);
  const bytes = Buffer.from(row.ciphertext, "hex");
  const body = bytes.subarray(0, bytes.length - 16);
  const tag = bytes.subarray(bytes.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.nonce, "hex"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** The mint call, behind a seam, for the reason the verifier is: the real one is
 *  a route on the reviewing application that needs a secret to answer. */
export type Minter = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<Response>;

let injectedMinter: Minter | undefined;

export function setMinterForTest(minter: Minter | undefined): void {
  injectedMinter = minter;
}

function minter(): Minter {
  return injectedMinter ?? ((url, init) => fetch(url, init));
}

/** The mint route, at the ingest url's origin and nowhere else. */
export function mintUrlFrom(env: EnvLike): string | null {
  const ingest = (env.XOVI_INGEST_URL ?? "").trim();
  if (!ingest) return null;
  try {
    return new URL(MINT_PATH, new URL(ingest).origin).toString();
  } catch {
    return null;
  }
}

export type CredentialState = "issued" | "none";

/**
 * Make sure this wallet holds a credential, minting one if it has none.
 *
 * `issued` when a row exists or one was written now; `none` for every other
 * outcome, and every one of them leaves the enrolment as it was: a mint that
 * is not configured, a reviewing application that refuses or cannot be reached,
 * an answer carrying only a prefix because the credential was minted before and
 * its row is gone, or a row that would not write. None of those is a reason to
 * refuse the person; the registration read asks again next time.
 *
 * The label is the wallet's name under the parent when the names table holds
 * one, else the checksummed address. It is a label on the other side and
 * authenticates nothing.
 */
export async function ensureCredential(
  payer: string,
  deps: { store: CredentialStore | null; names: NamesStore | null; env?: EnvLike; at: Date },
): Promise<CredentialState> {
  const env = deps.env ?? process.env;
  const wallet = payer.toLowerCase();
  if (!deps.store) return "none";
  if (await deps.store.byPayer(wallet)) return "issued";

  const url = mintUrlFrom(env);
  const secret = (env.INGEST_MINT_SECRET ?? "").trim();
  if (!url || !secret) return "none";
  // Refused before the call rather than after it: a credential this cannot store
  // is a credential the other side will never answer again.
  try {
    keyFrom(env);
  } catch {
    return "none";
  }

  let label: string = getAddress(payer);
  try {
    const name = deps.names ? await deps.names.byPayer(getAddress(payer)) : null;
    if (name) label = `${name.label}.${PARENT}`;
  } catch {
    // A name that could not be read is a label, not a credential. The address stands in.
  }

  let answer: Response;
  try {
    answer = await minter()(url, {
      method: "POST",
      headers: { "content-type": "application/json", [MINT_HEADER]: `Bearer ${secret}` },
      body: JSON.stringify({ agentAddress: getAddress(payer), label }),
    });
  } catch {
    console.warn(`credential: the mint could not be reached for ${wallet}`);
    return "none";
  }
  let body: Record<string, unknown>;
  try {
    body = (await answer.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!answer.ok) {
    // The status and nothing else: the body is the other side's prose.
    console.warn(`credential: the mint refused ${wallet} with ${answer.status}`);
    return "none";
  }
  const key = typeof body.key === "string" ? body.key : null;
  const parsed = key ? CREDENTIAL.exec(key) : null;
  if (!parsed) {
    // A prefix alone means minted before, with the credential answered to a row
    // this deployment no longer holds. Said with the prefix, which is public.
    console.warn(`credential: the mint answered ${wallet} with no credential (prefix ${String(body.prefix ?? "none")}), so it was minted before and its row is gone`);
    return "none";
  }
  const { ciphertext, nonce } = encryptCredential(parsed[0], env);
  const written = await deps.store.put({ payer: wallet, ciphertext, nonce, keyPrefix: parsed[1], mintedAt: deps.at }).catch(() => false);
  if (!written) {
    console.error(`credential: minted for ${wallet} with prefix ${parsed[1]} and the row would not write; re-mint on the reviewing application`);
    return "none";
  }
  return "issued";
}

/** The credential in the clear, for the ingest header and for nothing else. */
export async function credentialFor(payer: string, store: CredentialStore | null, env: EnvLike = process.env): Promise<string | null> {
  if (!store) return null;
  const row = await store.byPayer(payer.toLowerCase());
  if (!row) return null;
  try {
    return decryptCredential(row, env);
  } catch {
    // A row this key cannot open is a row under another key. Not a credential.
    return null;
  }
}
