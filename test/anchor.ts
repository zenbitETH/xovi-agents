import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GET as observationsGET } from "../app/api/observations/[uid]/route";
import { confirmationMessage, recoverConfirmer, signedBy } from "../lib/anchor/confirmation";
import { encodeObservation, toObservation } from "../lib/anchor/observation";
import {
  OFFCHAIN_DOMAIN_NAME,
  UnknownDomainVersion,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  offchainUid,
  randomSalt,
  signObservation,
  verifyObservation,
} from "../lib/anchor/offchain";
import { SCHEMA, UnanchorableClip, decisionCode, schemaUid } from "../lib/anchor/schema";
import { serialiseSigned } from "../lib/anchor/store";

type Check = (ok: boolean, label: string) => void;

const FIXTURE = () =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures/confirmation.259.json"), "utf8")) as Record<string, unknown>;

/** The identifier this repository predicts, pinned. A change to the frozen string
 *  changes this constant, which is the point: it cannot move quietly. */
const FROZEN_UID = "0x8d4a9a6e41e07cb67128eaca5a79f4d39e5199eb8c1c7d7a0096e0a5d11c8c6d";

/** The nine keys the payload endpoint serves, and no tenth. */
const SIGNED_KEYS = ["uid", "attester", "domain", "message", "signature"];

export async function anchorChecks(check: Check) {
  check(schemaUid() === FROZEN_UID, "128 · the schema identifier is the frozen one, computed from the string alone");
  check(schemaUid(SCHEMA.replace("uint32 clipId,", "uint32 clipId, ")) !== FROZEN_UID,
    "129 · and one space added to the string is a different schema entirely (seen to fail)");

  const row = FIXTURE();
  const o = toObservation(row);
  const payload = {
    clipId: o.clipId,
    clipHash: o.clipHash,
    decision: 1 as const,
    verifierNonce: o.verifierNonce,
    verifierChainId: o.verifierChainId,
  };

  check(await signedBy(payload, o.verifierSignature, o.verifier),
    "130 · a real confirmation recovers to the attested verifier from the attested fields alone");

  // Three wrong templates. The result that matters is that none of them raises:
  // each returns a different, perfectly well formed address, so a checker that only
  // catches exceptions accepts all three.
  const exact = confirmationMessage(payload);
  const wrong = async (label: string, msg: string) => {
    let threw = false;
    let addr = "";
    try {
      addr = await (await import("viem")).recoverMessageAddress({
        message: msg,
        signature: o.verifierSignature as `0x${string}`,
      });
    } catch {
      threw = true;
    }
    check(!threw && addr.toLowerCase() !== o.verifier.toLowerCase(), label);
  };
  await wrong("131 · one space out of the padding recovers a different address and does not raise",
    exact.replace("Decisión:  ", "Decisión: "));
  await wrong("132 · the em dash written as a plain ASCII dash recovers a different address and does not raise",
    exact.replace("—", "-"));
  await wrong("133 · the decision as an integer recovers a different address and does not raise",
    exact.replace("Decisión:  verified", "Decisión:  1"));
  check(Buffer.from(exact, "utf8").length === 308, "134 · the message is 308 bytes, so the padding and the accents are intact");

  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const domain = { name: OFFCHAIN_DOMAIN_NAME, version: "0.26", chainId: 11155111, verifyingContract: ZERO_ADDRESS };
  const message = {
    version: 2,
    schema: schemaUid(),
    recipient: ZERO_ADDRESS as `0x${string}`,
    time: o.verifiedAt,
    expirationTime: 0n,
    revocable: true,
    refUID: ZERO_BYTES32 as `0x${string}`,
    data: encodeObservation(o),
    salt: randomSalt(),
  };
  const signed = await signObservation(account, domain, message);
  check(await verifyObservation(signed), "135 · the offchain identifier re-derives and the attester recovers from the stored object");
  check(offchainUid({ ...message, salt: ZERO_BYTES32 }) !== signed.uid,
    "136 · dropping the salt changes the identifier, which is why the whole object is persisted (seen to fail)");
  // The schema goes into the identifier as the sixty six UTF-8 characters of its
  // hexadecimal string, not as thirty two bytes. Hashing it the way its type reads
  // is the reimplementation mistake this pins, and it produces a well formed
  // identifier that simply is not the one anybody else computes. The encoding
  // lowercases first, so case on the way in cannot change the answer.
  const asBytes32 = keccak256(
    encodePacked(
      ["uint16", "bytes32", "address", "address", "uint64", "uint64", "bool", "bytes32", "bytes", "bytes32", "uint32"],
      [2, message.schema, message.recipient, ZERO_ADDRESS, message.time, message.expirationTime,
       message.revocable, message.refUID, message.data, message.salt, 0],
    ),
  );
  check(asBytes32 !== signed.uid,
    "137 · hashing the schema as bytes rather than as text gives a different identifier (seen to fail)");
  check(offchainUid({ ...message, schema: message.schema.toUpperCase() as `0x${string}` }) === signed.uid,
    "137b · and the encoding lowercases first, so the case it arrives in cannot change the answer");

  let refusedVersion = false;
  try {
    await signObservation(account, { ...domain, version: "9.9.9" }, message);
  } catch (e) {
    refusedVersion = e instanceof UnknownDomainVersion;
  }
  check(refusedVersion, "138 · a domain version this encoding has not been checked against is refused, not signed under");

  const refuses = async (label: string, mutate: Record<string, unknown>) => {
    let refused = false;
    try {
      toObservation({ ...row, ...mutate });
    } catch (e) {
      refused = e instanceof UnanchorableClip;
    }
    check(refused, label);
  };
  await refuses("139 · a clip nobody confirmed is refused before anything is signed", { status: "pending" });
  await refuses("140 · a clip a person submitted is refused, since this milestone anchors machine proposals", { source: "user" });
  await refuses("141 · a confirmation with no signature is refused rather than attested without one", { verifierSignature: "" });
  check(toObservation(row).verifierChainId === (row.verifierChainId as number),
    "142 · the verifier's chain is carried from the row and not from anywhere else");

  check(JSON.stringify(Object.keys(serialiseSigned(signed) as object)) === JSON.stringify(SIGNED_KEYS),
    "143 · the payload endpoint serves the five keys of the signed object and no sixth");

  const handler = readFileSync(join(process.cwd(), "app/api/observations/[uid]/route.ts"), "utf8");
  const gate = /getIronSession|cookies\(|authorization|Authorization|bearer|apiKey/.test(handler);
  check(!gate, "144 · and it is unauthenticated, by a check that goes red the moment a gate appears");

  const bad = await observationsGET(new Request("http://x/api/observations/nope"), {
    params: Promise.resolve({ uid: "nope" }),
  });
  check(bad.status === 400, "145 · something that is not an identifier is refused before any lookup");

  check(decisionCode("verified") === 1 && decisionCode("rejected") === 0,
    "146 · the decision mapping is frozen in both directions");
  let badWord = false;
  try {
    decisionCode("approved");
  } catch (e) {
    badWord = e instanceof UnanchorableClip;
  }
  check(badWord, "147 · and any other word is refused rather than guessed at");
}
