import { Address } from "@graphprotocol/graph-ts";
import { Attested, Timestamped } from "../generated/EAS/EAS";
import { Observation, TimeAnchor } from "../generated/schema";

/**
 * The account that anchors. A timestamp log carries only a hash and a block time,
 * with no schema and no attester, so the sender is the only thing that attributes
 * one, and anybody may timestamp anything. Without this check the index would
 * collect every timestamp on the chain and present them as this project's.
 */
const ANCHOR = Address.fromString("0x51F1D0074793E7Fa336f538299ad7D3e439e2b09");

/**
 * The primary leg, filtered at the node by the schema in the fourth topic.
 *
 * The filter is in the manifest rather than here on purpose: a handler that runs
 * for every attestation on the chain and returns early is correct and wasteful, and
 * on a chain with this much traffic the difference is the timed sync criterion.
 * The schema is written to the entity anyway, so a reader can check the filter did
 * what the manifest says instead of trusting it.
 */
export function handleAttested(event: Attested): void {
  const o = new Observation(event.params.uid);
  o.attester = event.params.attester;
  o.schemaUID = event.params.schemaUID;
  o.attestedAt = event.block.timestamp;
  o.tx = event.transaction.hash;
  o.block = event.block.number;
  o.save();
}

/**
 * The secondary leg, filtered here because there is nothing to filter on at the node.
 *
 * Note what this entity is NOT: it is not the same identifier as the attestation
 * above, and nothing here tries to join them. An offchain identifier is a hash of
 * the signed object and an onchain one is assigned by the contract, so one
 * confirmation yields two, and a handler that looked one up by the other would
 * silently record nothing while appearing to work.
 */
export function handleTimestamped(event: Timestamped): void {
  if (event.transaction.from != ANCHOR) return;
  const a = new TimeAnchor(event.params.data);
  // Already a BigInt in the generated types; converting it again is the kind of
  // mistake the compiler reports by crashing rather than by naming a line.
  a.timestampedAt = event.params.timestamp;
  a.sender = event.transaction.from;
  a.tx = event.transaction.hash;
  a.block = event.block.number;
  a.save();
}
