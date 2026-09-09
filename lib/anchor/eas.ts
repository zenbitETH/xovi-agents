import { type Address, type Hex, createPublicClient, createWalletClient, http } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/**
 * The attestation contracts, on the one chain this milestone writes to.
 *
 * Ethereum Sepolia and nothing else. The chain is a guard rather than a setting:
 * a script that registers or anchors on whatever chain the environment happens to
 * point at is how a definition ends up somewhere nobody chose, and a testnet
 * mistake is only cheap until it is a mainnet one.
 */
export const ANCHOR_CHAIN_ID = sepolia.id;

export const EAS_ADDRESS = "0xC2679fBD37d54388Ce493F1DB75320D236e1815e" as const;
export const SCHEMA_REGISTRY_ADDRESS = "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0" as const;

/**
 * Selectors and topics, recomputed rather than copied.
 *
 * Recorded here because a subgraph manifest needs the topic and because the
 * deployed contract is version 0.26 rather than the current release, so an ABI from
 * a package's default branch can differ from what this chain emits. An ABI that
 * disagrees with the manifest's signature fails the build; an ABI and signature
 * that agree with each other and disagree with the chain do not, and that is the
 * case these recomputed topics exist to catch.
 */
export const TOPIC_TIMESTAMPED = "0x5aafceeb1c7ad58e4a84898bdee37c02c0fc46e7d24e6b60e8209449f183459f" as const;
export const TOPIC_ATTESTED = "0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35" as const;

export const EAS_ABI = [
  /** Declared so a rerun reports the contract's own refusal by name rather than as a
   *  bare selector. Without it viem says only that it could not decode 0x2e267946,
   *  which is the same information wearing a worse face. */
  { type: "error", name: "AlreadyTimestamped", inputs: [] },
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "getTimestamp",
    stateMutability: "view",
    inputs: [{ name: "data", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "timestamp",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
  /** Refused when the schema is not registered. Declared so the refusal arrives by
   *  name, which is what a fresh fork answers before the registration is replayed. */
  { type: "error", name: "InvalidSchema", inputs: [] },
  {
    type: "function",
    name: "attest",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const SCHEMA_REGISTRY_ABI = [
  {
    type: "function",
    name: "getSchema",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "schema", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export class WrongChain extends Error {}

/**
 * Chains the escape hatch does not open onto, whatever flag is passed.
 *
 * `--any-chain` exists for a fork, and a fork of Ethereum Sepolia reports 11155111
 * anyway. What it must never do is let a mistyped endpoint register a schema or
 * write an attestation on a mainnet, which is irreversible and is the one outcome
 * no amount of care further up prevents. Ethereum, Base, World Chain, Optimism and
 * Arbitrum, being the mainnets this project has endpoints for.
 */
export const NEVER_WRITE = [1, 8453, 480, 10, 42161];

export function publicClientFor(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl) });
}

export function walletClientFor(rpcUrl: string, account: PrivateKeyAccount) {
  return createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });
}

/**
 * Refuses any chain but the one this milestone anchors to.
 *
 * `allowAnyChain` exists for the fork, which reports the forked chain's id anyway,
 * and for nothing else. It is a named argument rather than an environment variable
 * so that using it is visible at the call site.
 */
export async function requireAnchorChain(
  client: ReturnType<typeof publicClientFor>,
  allowAnyChain = false,
): Promise<number> {
  const id = await client.getChainId();
  // Refused before the flag is even consulted. An override that can reach a mainnet
  // is not an override, it is the absence of a guard with a longer name.
  if (NEVER_WRITE.includes(id)) {
    throw new WrongChain(`chain ${id} is a mainnet and this never writes to one, flag or no flag`);
  }
  if (!allowAnyChain && id !== ANCHOR_CHAIN_ID) {
    throw new WrongChain(`connected to chain ${id}, and this writes only to ${ANCHOR_CHAIN_ID}`);
  }
  return id;
}

/** The domain version, from the contract. Never written down: it differs per chain
 *  and it is an input to the signature. */
export async function domainVersion(client: ReturnType<typeof publicClientFor>): Promise<string> {
  return client.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: "VERSION" });
}

export async function timestampOf(client: ReturnType<typeof publicClientFor>, uid: Hex): Promise<bigint> {
  return client.readContract({ address: EAS_ADDRESS, abi: EAS_ABI, functionName: "getTimestamp", args: [uid] });
}

/**
 * Anchors a time for the identifier, or returns the one already there.
 *
 * The guard is the whole of this function. The contract refuses a repeat outright
 * rather than ignoring it, so a rehearsal followed by a live run is exactly the
 * shape that reverts in front of an audience. Asking first turns that into a
 * success that sends nothing. The batch form is deliberately not used anywhere:
 * it fails in whole on a single already-anchored element.
 */
export async function anchorTimestamp(
  publicClient: ReturnType<typeof publicClientFor>,
  wallet: ReturnType<typeof walletClientFor>,
  uid: Hex,
): Promise<{ alreadyAnchored: boolean; at: bigint; txHash?: Hex }> {
  const existing = await timestampOf(publicClient, uid);
  if (existing > 0n) return { alreadyAnchored: true, at: existing };

  const txHash = await wallet.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: "timestamp",
    args: [uid],
    chain: null,
    account: wallet.account as PrivateKeyAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { alreadyAnchored: false, at: await timestampOf(publicClient, uid), txHash };
}

/**
 * Sends the attestation and returns as soon as the hash is known.
 *
 * Split from the receipt wait on purpose. The caller records this hash before
 * waiting, because the window between a transaction being accepted and being
 * recorded is a window in which a death makes the next run attest a second time.
 * The earlier fix closed the case where a leg fails; this is the case where a leg
 * succeeds and the process dies before anything remembers that it did.
 */
export async function sendAttest(
  wallet: ReturnType<typeof walletClientFor>,
  schema: Hex,
  data: Hex,
  recipient: Address = "0x0000000000000000000000000000000000000000",
): Promise<Hex> {
  return wallet.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: "attest",
    args: [
      {
        schema,
        data: { recipient, expirationTime: 0n, revocable: true, refUID: `0x${"00".repeat(32)}`, data, value: 0n },
      },
    ],
    chain: null,
    account: wallet.account as PrivateKeyAccount,
  });
}

/**
 * The identifier the contract assigned, read from the receipt of a sent attestation.
 *
 * Separate from sending so it can be redone. A run that recorded the hash and died
 * before reading the receipt resumes here rather than by attesting again, which is
 * the whole point of recording the hash first.
 */
export async function attestedUid(
  publicClient: ReturnType<typeof publicClientFor>,
  txHash: Hex,
): Promise<Hex> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const log = receipt.logs.find(l => l.topics[0] === TOPIC_ATTESTED);
  if (!log) throw new Error("the attestation emitted no Attested log, which should be impossible");
  return log.data as Hex;
}

/** Send and read in one call. For the fork proof, where nothing can die between them. */
export async function attestOnchain(
  publicClient: ReturnType<typeof publicClientFor>,
  wallet: ReturnType<typeof walletClientFor>,
  schema: Hex,
  data: Hex,
  recipient: Address = "0x0000000000000000000000000000000000000000",
): Promise<{ txHash: Hex; uid: Hex }> {
  const txHash = await sendAttest(wallet, schema, data, recipient);
  return { txHash, uid: await attestedUid(publicClient, txHash) };
}

/**
 * What a stranger can read, holding nothing but an identifier from an index.
 *
 * This is the reachability path and it deliberately touches nothing of Zenbit's:
 * a public endpoint for the chain, a contract call, and the frozen field list. The
 * payload endpoint is a convenience on top of it and never a dependency, which is
 * the property worth having rather than the endpoint.
 */
export async function attestationData(
  client: ReturnType<typeof publicClientFor>,
  uid: Hex,
): Promise<{ schema: Hex; attester: Address; data: Hex }> {
  const a = await client.readContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: "getAttestation",
    args: [uid],
  });
  return { schema: a.schema, attester: a.attester, data: a.data };
}
