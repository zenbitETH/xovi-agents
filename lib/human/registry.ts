import { createPublicClient, http } from "viem";
import { worldchain } from "viem/chains";
import type { EnvLike } from "../agent/pay";

/**
 * Which human does this agent belong to.
 *
 * AgentBook stores one mapping from an agent address to an anonymous identifier
 * derived from World ID. Two facts about it decide this whole feature, and both
 * were measured against the deployed contract rather than read from documentation.
 *
 * **It is read on World Chain, and that is not where the payments are.** The
 * registration tool writes World Chain and only World Chain: the published 0.2.0
 * rejects a network flag outright, whatever its README on the main branch says.
 * The contract is deployed at the same address on Base Sepolia with byte identical
 * code and separate state, so reading the payment chain returns zero for an agent
 * that is registered, the cap fails closed, every read settles and the feature can
 * never fire. It looks exactly like nobody has registered.
 *
 * So this reads chain 480 while the payments settle on 84532. Two chains, and one
 * of them is a mainnet, which is worth saying out loud even though this call moves
 * nothing and needs no key.
 *
 * An address that has never registered returns zero and does not revert, so the
 * unregistered case is a value comparison rather than a caught exception.
 *
 * The registration call puts the agent address and a nonce into the World ID
 * SIGNAL and uses a contract wide constant as the external nullifier. A nullifier
 * is deterministic on the identity and the external nullifier, so one person
 * produces the same identifier whichever agent they register, and the agent
 * address moves the signal instead. Nothing in the contract tracks used
 * nullifiers. One human to many agents is therefore the construction, which is
 * what makes a shared budget testable rather than hoped for.
 */
/** Same address on both deployments, which is what makes the wrong one so quiet. */
export const AGENTBOOK_ADDRESS_WORLDCHAIN = "0xA23aB2712eA7BBa896930544C7d6636a96b944dA" as const;
export const AGENTBOOK_ABI = [
  {
    type: "function",
    name: "lookupHuman",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Zero is the unregistered answer, not an error. */
export const UNREGISTERED = 0n;

/** Injectable so the failing paths can be checked without a chain, which for a
 *  path whose whole job is to fail well is the difference between having it and
 *  claiming it. */
export type HumanRegistry = (agent: `0x${string}`) => Promise<bigint>;

export function registryFrom(env: EnvLike = process.env): HumanRegistry {
  const address = (env.AGENTBOOK_ADDRESS ?? AGENTBOOK_ADDRESS_WORLDCHAIN) as `0x${string}`;
  const client = createPublicClient({
    chain: worldchain,
    // The race below gives up after the timeout, but the request underneath it
    // would keep going: viem defaults to three retries over a ten second
    // transport timeout, so an abandoned lookup would still be in flight long
    // after the read it was holding up had been served. These make the fetch
    // stop when the race does.
    transport: http(env.AGENTBOOK_RPC_URL || undefined, { timeout: LOOKUP_TIMEOUT_MS, retryCount: 0 }),
  });
  return agent =>
    client.readContract({
      address,
      abi: AGENTBOOK_ABI,
      functionName: "lookupHuman",
      args: [agent],
    });
}

/** How long a lookup may take before the read it is holding up gives up on it. A
 *  hanging rpc must degrade inside the request rather than stall a read somebody
 *  is paying for. */
export const LOOKUP_TIMEOUT_MS = 2_000;

/**
 * The identifier, or null for every reason there might not be one.
 *
 * Unregistered, a throw, and a timeout collapse to the same answer on purpose:
 * each of them means this read cannot be given away, and the caller has exactly
 * one thing to do about all three.
 */
export async function humanBehind(
  agent: `0x${string}`,
  registry: HumanRegistry,
  timeoutMs: number = LOOKUP_TIMEOUT_MS,
): Promise<bigint | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const identifier = await Promise.race([
      registry(agent),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("registry lookup timed out")), timeoutMs);
      }),
    ]);
    return identifier === UNREGISTERED ? null : identifier;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
