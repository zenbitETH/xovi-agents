import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeAbiParameters, encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GET as observationsGET } from "../app/api/observations/[uid]/route";
import { confirmationMessage, recoverConfirmer, signedBy } from "../lib/anchor/confirmation";
import { EAS_ADDRESS, NEVER_WRITE } from "../lib/anchor/eas";
import { OBSERVATION_ABI, encodeObservation, toObservation } from "../lib/anchor/observation";
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
import { type AnchorRow, type AnchorStore, nextAction, serialiseSigned, setStoreForTest } from "../lib/anchor/store";
import { sdkAccepts, sdkUid } from "./oracle";

type Check = (ok: boolean, label: string) => void;

const FIXTURE = () =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures/confirmation.259.json"), "utf8")) as Record<string, unknown>;

/** The identifier this repository predicts, pinned. A change to the frozen string
 *  changes this constant, which is the point: it cannot move quietly. */
const FROZEN_UID = "0x8d4a9a6e41e07cb67128eaca5a79f4d39e5199eb8c1c7d7a0096e0a5d11c8c6d";

/** The five keys the payload endpoint serves, and no sixth. */
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
  const domain = { name: OFFCHAIN_DOMAIN_NAME, version: "0.26", chainId: 11155111, verifyingContract: EAS_ADDRESS };
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

  // The instrument that is not us. Everything above this line is our code agreeing
  // with our code, which is exactly what cannot detect a wrong domain.
  check(sdkAccepts(signed), "135b · and the attestation library, as an independent oracle, accepts the object this repository produced");
  check(sdkUid(signed) === signed.uid, "135c · and computes the same identifier for it, byte for byte");

  // The failure this oracle exists for, in the shape it would have shipped in.
  // Signed under the contract's own domain name rather than the offchain one: it
  // still re-derives from itself, so our own invariant stays green, and the library
  // and every explorer that uses it reject it.
  const wrongDomain = await signObservation(account, { ...domain, name: "EAS" }, message);
  check(await verifyObservation(wrongDomain),
    "135d · an object signed under the contract's own domain still satisfies our own re-derivation (negative control, and the reason self-consistency is not evidence)");
  check(!sdkAccepts(wrongDomain),
    "135e · and the oracle rejects it, which is the only check here that would have caught it (seen to fail)");

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

  // Condition 8, enforced rather than remembered. The public row carries a station
  // and a species; neither may reach an attested field, and the way to know that is
  // to decode what was actually encoded rather than to trust the mapping above.
  const decoded = decodeAbiParameters(OBSERVATION_ABI, encodeObservation(o));
  check(decoded.length === 10 && OBSERVATION_ABI.length === 10,
    "142b · the attested data decodes to exactly the ten frozen fields and no eleventh");
  const asText = Buffer.from(encodeObservation(o).slice(2), "hex").toString("utf8");
  check(!asText.includes("AM 3") && !asText.includes("mexicanum"),
    "142c · and the station and the species are nowhere inside it, decoded rather than assumed");

  check(JSON.stringify(Object.keys(serialiseSigned(signed) as object)) === JSON.stringify(SIGNED_KEYS),
    "143 · the payload endpoint serves the five keys of the signed object and no sixth");

  const handler = readFileSync(join(process.cwd(), "app/api/observations/[uid]/route.ts"), "utf8");
  const gate = /getIronSession|cookies\(|authorization|Authorization|bearer|apiKey/.test(handler);
  check(!gate, "144 · and it is unauthenticated, by a check that goes red the moment a gate appears");

  const bad = await observationsGET(new Request("http://x/api/observations/nope"), {
    params: Promise.resolve({ uid: "nope" }),
  });
  check(bad.status === 400, "145 · something that is not an identifier is refused before any lookup");

  // The endpoint's real branches, reachable now that the store is a seam. Without
  // one, the only path a check could take was the unconfigured branch, which is the
  // branch that needed proving least.
  const uid = signed.uid.toLowerCase();
  const call = () => observationsGET(new Request(`http://x/api/observations/${uid}`), { params: Promise.resolve({ uid }) });

  setStoreForTest({
    async claim(r) { return { fresh: true, row: r }; },
    async byClipId() { return null; },
    async complete() {},
    async byUid() { throw new Error('relation "anchors" does not exist'); },
  });
  const broken = await call();
  check(broken.status === 503,
    "145b · a store that is configured and cannot answer is an outage, 503 and not the framework's 500 (seen to fail)");

  setStoreForTest({
    async claim(r) { return { fresh: true, row: r }; },
    async byClipId() { return null; },
    async complete() {},
    async byUid() {
      return { clipId: 259, uid: signed.uid, clipHash: o.clipHash, schemaUid: schemaUid(), attester: account.address, signed };
    },
  });
  const served = await call();
  check(served.status === 200, "145c · and a record is served to a caller carrying no credential at all");
  const body = (await served.json()) as Record<string, unknown>;
  check(JSON.stringify(Object.keys(body)) === JSON.stringify(SIGNED_KEYS),
    "145d · with exactly the five keys of the signed object, checked on the response and not on the helper");
  setStoreForTest(undefined);

  // A31's chain half, offline. This is the whole of what a stranger does after the
  // contract hands back the attested bytes, and it needs no network to check.
  const roundTrip = decodeAbiParameters(OBSERVATION_ABI, encodeObservation(o));
  check(
    await signedBy(
      { clipId: Number(roundTrip[0]), clipHash: roundTrip[1], decision: 1, verifierNonce: roundTrip[5], verifierChainId: Number(roundTrip[6]) },
      roundTrip[4],
      roundTrip[3],
    ),
    "148 · the attested bytes alone decode to a message that recovers the reviewer, which is what a query result buys",
  );

  // The High finding, as a decision that can be inspected without a chain.
  //
  // The old code asked the store "did I insert a row" and read the answer as "is
  // this clip finished". Those differ for exactly one state, and it is the state a
  // failed second leg leaves behind: a row with a timestamp and no attestation.
  // Every rerun read it as done and skipped the clip permanently.
  const halfDone: AnchorRow = {
    clipId: 259, uid: "0xaa", clipHash: "0xbb", schemaUid: "0xcc", attester: "0xdd",
    signed: signed, timestampTx: "0xtimestamp", timestampedAt: 1n,
  };
  check(nextAction(null) === "anchor-both", "160 · a clip with no row anchors both legs");
  check(nextAction(halfDone) === "resume-attest",
    "161 · a row with a timestamp and no attestation RESUMES, which the old boolean read as done (seen to fail)");
  check(nextAction({ ...halfDone, attestTx: "0xattest" }) === "resume-uid",
    "162 · a recorded attestation with no identifier resumes by READING the receipt, never by attesting again (seen to fail)");
  check(nextAction({ ...halfDone, attestTx: "0xattest", onchainUid: "0xonchain" }) === "done",
    "162b · and only both marks it finished");

  // The store contract the resume depends on: a second claim hands back the STORED
  // row, not the one the caller just built. Signing again makes a new salt and a new
  // identifier, so resuming against a fresh signature would anchor a second record
  // for one confirmation and orphan the first.
  const kept = new Map<number, AnchorRow>();
  const fake: Pick<AnchorStore, "claim" | "byClipId"> = {
    async claim(row) {
      const there = kept.get(row.clipId);
      if (there) return { fresh: false, row: there };
      kept.set(row.clipId, row);
      return { fresh: true, row };
    },
    async byClipId(id) {
      return kept.get(id) ?? null;
    },
  };
  const first = await fake.claim(halfDone);
  const second = await fake.claim({ ...halfDone, uid: "0xdifferent", signed: { ...signed, uid: "0xdifferent" } });
  check(first.fresh && !second.fresh, "163 · the second claim of one clip is not fresh");
  check(second.row.uid === "0xaa",
    "164 · and hands back the stored identifier, so a resume cannot anchor a second record under a new salt");

  check(NEVER_WRITE.includes(1) && NEVER_WRITE.includes(8453) && NEVER_WRITE.includes(480)
    && NEVER_WRITE.includes(10) && NEVER_WRITE.includes(42161),
    "165 · the escape hatch does not open onto Ethereum, Base, World Chain, Optimism or Arbitrum");
  check(!NEVER_WRITE.includes(11155111) && !NEVER_WRITE.includes(84532),
    "166 · and does not refuse the two testnets this actually uses (negative control)");

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
