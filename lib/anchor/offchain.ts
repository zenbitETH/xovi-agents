import { type Address, type Hex, encodePacked, keccak256, recoverTypedDataAddress, toHex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/**
 * The offchain attestation, and the three things about it that surprise a reader.
 *
 * It is signed and never sent to a chain, so it costs nothing and emits nothing.
 * The onchain legs exist so it can be found; this is the record itself.
 *
 * Every constant below is either read from the chain at run time or written down
 * here because it is not derivable. None of it is taken from a package README: two
 * of the three would produce a record that verifies against nothing while looking
 * entirely correct, and the third is the reason this module does not hardcode a
 * version.
 */
export const OFFCHAIN_VERSION = 2;

/**
 * NOT the deployed contract's own domain name, which is `EAS`, verified by
 * rebuilding its getDomainSeparator() and matching on that one alone. Offchain
 * attestations sign under a different domain with the same version, chain and
 * address. Confusing the two yields a signature that verifies against nothing.
 */
export const OFFCHAIN_DOMAIN_NAME = "EAS Attestation";

/** Domain versions this encoding is known to be correct for. The value is read from
 *  the contract, differs per chain, and is an input to the domain separator, so an
 *  unrecognised one is refused rather than signed under and hoped about. */
export const KNOWN_DOMAIN_VERSIONS = ["0.26", "1.0.0", "1.0.1", "1.0.2", "1.1.0", "1.2.0", "1.3.0", "1.4.0"];

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as const;

export const ATTEST_TYPES = {
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
} as const;

export type OffchainDomain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export type OffchainMessage = {
  version: number;
  schema: Hex;
  recipient: Address;
  time: bigint;
  expirationTime: bigint;
  revocable: boolean;
  refUID: Hex;
  data: Hex;
  salt: Hex;
};

export type SignedObservation = {
  uid: Hex;
  attester: Address;
  domain: OffchainDomain;
  message: OffchainMessage;
  signature: Hex;
};

export class UnknownDomainVersion extends Error {}

/**
 * The identifier, whose encoding hashes the schema as TEXT rather than as bytes.
 *
 * The schema identifier goes in as the UTF-8 characters of its hexadecimal string,
 * so `0x8d4a…` is hashed as sixty six bytes and not as thirty two, and letter case
 * is significant. It is lowercased here. This is inherited behaviour rather than a
 * choice, and it is the single most likely thing for a reimplementation to get
 * wrong, because getting it wrong produces a well formed identifier that simply
 * does not match the one anybody else computes.
 *
 * The zero address in the third position is where an attester would sit and is
 * always zero, and the trailing zero is a bump the encoding carries.
 */
export function offchainUid(m: OffchainMessage): Hex {
  return keccak256(
    encodePacked(
      ["uint16", "bytes", "address", "address", "uint64", "uint64", "bool", "bytes32", "bytes", "bytes32", "uint32"],
      [
        m.version,
        toHex(m.schema.toLowerCase()),
        m.recipient,
        ZERO_ADDRESS,
        m.time,
        m.expirationTime,
        m.revocable,
        m.refUID,
        m.data,
        m.salt,
        0,
      ],
    ),
  );
}

export function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, x => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Signs, and refuses a domain version this encoding has never been checked against. */
export async function signObservation(
  account: PrivateKeyAccount,
  domain: OffchainDomain,
  message: OffchainMessage,
): Promise<SignedObservation> {
  if (!KNOWN_DOMAIN_VERSIONS.includes(domain.version)) {
    throw new UnknownDomainVersion(
      `the contract reports domain version ${domain.version}, which this encoding has not been checked against`,
    );
  }
  const signature = await account.signTypedData({
    domain,
    types: ATTEST_TYPES,
    primaryType: "Attest",
    message,
  });
  return { uid: offchainUid(message), attester: account.address, domain, message, signature };
}

/**
 * Re-derives the identifier and recovers the attester, from the persisted object alone.
 *
 * Both halves matter and for different reasons. The identifier proves nothing was
 * lost in storage, which is what the salt makes possible and what dropping it makes
 * impossible. The recovery proves the object was signed by whom it says.
 */
export async function verifyObservation(o: SignedObservation): Promise<boolean> {
  if (offchainUid(o.message) !== o.uid) return false;
  const recovered = await recoverTypedDataAddress({
    domain: o.domain,
    types: ATTEST_TYPES,
    primaryType: "Attest",
    message: o.message,
    signature: o.signature,
  });
  return recovered.toLowerCase() === o.attester.toLowerCase();
}
