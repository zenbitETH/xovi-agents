import { Offchain, OffchainAttestationVersion } from "@ethereum-attestation-service/eas-sdk";
import { parseSignature } from "viem";
import type { SignedObservation } from "../lib/anchor/offchain";

/**
 * An instrument that is not us.
 *
 * Everything else in this suite is this repository's code agreeing with this
 * repository's code, and that is not evidence about an encoding somebody else
 * defined. An object signed under the wrong domain still re-derives its own
 * identifier and still satisfies the invariant that says so, which means the check
 * that matters most is the one nothing here could have failed.
 *
 * The attestation library is a devDependency for exactly this and is never in the
 * shipped path: the runtime is viem with no eas library at all, which is why the
 * weight of a second chain library never reaches a deployment. It is pinned rather
 * than floated, because an oracle that can change underneath a green check is not
 * an oracle.
 */
export function sdkOffchain(chainId: number, version: string, verifyingContract: string) {
  // The third argument is only read when the library is asked to verify against a
  // chain, which nothing here does, so an oracle that needs no network can be built
  // from a stub. This is the one place a cast like that is the honest option.
  return new Offchain({ address: verifyingContract, version, chainId: BigInt(chainId) }, OffchainAttestationVersion.Version2, {} as never);
}

/** Our object in the shape the library expects, with the signature split into its parts. */
export function asSdkAttestation(o: SignedObservation, primaryType = "Attest") {
  const { r, s, v } = parseSignature(o.signature);
  return {
    version: OffchainAttestationVersion.Version2,
    uid: o.uid,
    domain: {
      name: o.domain.name,
      version: o.domain.version,
      chainId: BigInt(o.domain.chainId),
      verifyingContract: o.domain.verifyingContract,
    },
    primaryType,
    types: {
      Attest: [
        { name: "version", type: "uint16" },
        { name: "schema", type: "bytes32" },
        { name: "recipient", type: "address" },
        { name: "time", type: "uint64" },
        { name: "expirationTime", type: "uint64" },
        { name: "revocable", type: "bool" },
        { name: "refUID", type: "bytes32" },
        { name: "data", type: "bytes" },
        { name: "salt", type: "bytes32" },
      ],
    },
    // `version` is already the first field of our message, which is what the
    // encoding requires, so it is not added again here.
    message: { ...o.message },
    signature: { r, s, v: Number(v) },
  } as never;
}

/** What the library says about an object this repository produced. */
export function sdkAccepts(o: SignedObservation): boolean {
  const offchain = sdkOffchain(o.domain.chainId, o.domain.version, o.domain.verifyingContract);
  try {
    return offchain.verifyOffchainAttestationSignature(o.attester, asSdkAttestation(o));
  } catch {
    // A rejection by exception is still a rejection, and the caller only ever asks
    // whether the library accepted it.
    return false;
  }
}

/** The identifier the library computes for the same inputs. */
export function sdkUid(o: SignedObservation): string {
  return Offchain.getOffchainUID(
    OffchainAttestationVersion.Version2,
    o.message.schema,
    o.message.recipient,
    o.message.time,
    o.message.expirationTime,
    o.message.revocable,
    o.message.refUID,
    o.message.data,
    o.message.salt,
  );
}
