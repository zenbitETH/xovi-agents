import { getAddress, isAddress } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * A seam over the address lookup, so the answer can be somebody else's address.
 *
 * It lives here rather than in the route because a Next route module may export
 * only its handlers, which is the same reason `setStoreForTest` lives beside the
 * anchor store. The chain id read stays on the real client in the route, since the
 * ordering it proves is the point of that guard.
 *
 * What could not be reached without this is the case that matters most: a name
 * that resolves, to a wallet that is not the one asking. Under a wildcard parent
 * that is not an exotic failure, it is what every subname of the parent does for
 * every wallet but one.
 *
 * The real lookup behind this seam is `getEnsAddress` on a client with CCIP Read
 * on, which is viem's default. Once `xovi.eth`'s resolver is the offchain one under
 * `contracts/`, that lookup follows the `OffchainLookup` to the gateway route and
 * verifies its answer on chain before returning, so the chain's answer and the
 * gateway's become one path and the route's `source` reads `chain`.
 */
export type NameResolver = (name: string) => Promise<string | null>;

let injected: NameResolver | undefined;

export function setNameResolverForTest(resolver: NameResolver | undefined) {
  injected = resolver;
}

export function nameResolver(): NameResolver | undefined {
  return injected;
}

/**
 * Whether a resolved address is this payer.
 *
 * Pure and called rather than inlined, so the rule is exercised without a chain as
 * well as through the route with one. A missing record and the zero address are the
 * same answer: under a wildcard parent every subname resolves, so an unissued name
 * and a typo are indistinguishable from here, and neither is a match.
 *
 * **Issued and issued to this payer are two questions**, and only the second may
 * draw the positive on the page.
 */
export function matchesPayer(address: string | null, payer: string): boolean {
  if (address === null || address === ZERO_ADDRESS) return false;
  if (!isAddress(address) || !isAddress(payer)) return false;
  return getAddress(address) === getAddress(payer);
}
