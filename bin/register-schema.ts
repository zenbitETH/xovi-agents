/**
 * Registers the frozen schema, once, on one chain.
 *
 * Dry run by default. Nothing is sent without `--execute`, and the chain is a
 * guard rather than a setting: a script that registers on whatever chain the
 * environment happens to point at is how a definition ends up somewhere nobody
 * chose. `--any-chain` exists for a fork and says so at the call site.
 *
 * Idempotent, and it earns the word by reading the registry first rather than by
 * claiming it. A schema already there is a success that sends nothing.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  ANCHOR_CHAIN_ID,
  SCHEMA_REGISTRY_ABI,
  SCHEMA_REGISTRY_ADDRESS,
  publicClientFor,
  requireAnchorChain,
  walletClientFor,
} from "../lib/anchor/eas";
import { RESOLVER, REVOCABLE, SCHEMA, schemaUid } from "../lib/anchor/schema";

const ZERO32 = `0x${"00".repeat(32)}`;

async function main() {
  const execute = process.argv.includes("--execute");
  const anyChain = process.argv.includes("--any-chain");
  const rpc = process.env.ANCHOR_RPC_URL;
  if (!rpc) throw new Error("ANCHOR_RPC_URL is not set");

  const uid = schemaUid();
  console.log("\n  schema     ", SCHEMA);
  console.log("  resolver   ", RESOLVER);
  console.log("  revocable  ", REVOCABLE);
  console.log("  identifier ", uid, "(predicted from the string alone)");

  const pub = publicClientFor(rpc);
  const chainId = await requireAnchorChain(pub, anyChain);
  console.log("  chain      ", chainId, anyChain && chainId !== ANCHOR_CHAIN_ID ? "(guard overridden)" : "");

  const existing = await pub.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "getSchema",
    args: [uid],
  });
  if (existing.uid !== ZERO32) {
    const same = existing.schema === SCHEMA && existing.resolver === RESOLVER && existing.revocable === REVOCABLE;
    console.log(`\n  already registered, and the stored triple ${same ? "matches" : "DOES NOT MATCH"} the frozen one\n`);
    process.exitCode = same ? 0 : 1;
    return;
  }

  if (!execute) {
    console.log("\n  dry run. Nothing was sent. Pass --execute to register.\n");
    return;
  }

  const key = process.env.ATTESTATION_PRIVATE_KEY;
  if (!key) throw new Error("ATTESTATION_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = walletClientFor(rpc, account);
  console.log("  registrar  ", account.address);

  const hash = await wallet.writeContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "register",
    args: [SCHEMA, RESOLVER, REVOCABLE],
    chain: null,
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const stored = await pub.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "getSchema",
    args: [uid],
  });
  console.log(`\n  registered in block ${receipt.blockNumber}, tx ${hash}`);
  console.log(`  the registry answers ${stored.uid}`);
  console.log(`  ${stored.uid === uid ? "which is the identifier predicted above" : "WHICH IS NOT WHAT WAS PREDICTED"}\n`);
  process.exitCode = stored.uid === uid ? 0 : 1;
}

main().catch(err => {
  console.error("  registration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
