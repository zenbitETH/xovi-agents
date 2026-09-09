/**
 * Proves the anchor against a fork of the live chain, offline and for free.
 *
 * Not part of the suite, because the suite runs in CI with no network and no keys.
 * This is run by hand against `anvil --fork-url <sepolia rpc>` and its output goes
 * into the pull request body, the same way the live payment probe does.
 *
 * What it proves that a unit test cannot: the real contract at the real address
 * with the real revert. The idempotency guard is only interesting against a
 * contract that actually refuses a repeat, and the encoding is only interesting
 * against the deployment that will accept or reject it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  EAS_ABI,
  EAS_ADDRESS,
  SCHEMA_REGISTRY_ABI,
  SCHEMA_REGISTRY_ADDRESS,
  TOPIC_ATTESTED,
  anchorTimestamp,
  attestOnchain,
  domainVersion,
  publicClientFor,
  timestampOf,
  walletClientFor,
} from "../lib/anchor/eas";
import { encodeObservation, toObservation } from "../lib/anchor/observation";
import { OFFCHAIN_DOMAIN_NAME, ZERO_ADDRESS, ZERO_BYTES32, randomSalt, signObservation, verifyObservation } from "../lib/anchor/offchain";
import { RESOLVER, REVOCABLE, SCHEMA, schemaUid } from "../lib/anchor/schema";

const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545";
// Anvil's first account. A funded key that exists only on a fork is not a secret.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

let n = 0;
let bad = 0;
const check = (ok: boolean, label: string) => {
  n++;
  if (!ok) bad++;
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}`);
};

async function main() {
  const account = privateKeyToAccount(KEY);
  const pub = publicClientFor(RPC);
  const wallet = walletClientFor(RPC, account);
  const chainId = await pub.getChainId();
  const version = await domainVersion(pub);
  console.log(`\n  fork chain ${chainId}, EAS reports version ${version}\n`);

  const uid = schemaUid();
  const before = await pub.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "getSchema",
    args: [uid],
  });
  const fresh = before.uid === ZERO_BYTES32;
  check(fresh, "R1 · the predicted schema identifier is unregistered before this runs (restart anvil if this fails)");

  if (fresh) {
    const regHash = await wallet.writeContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: SCHEMA_REGISTRY_ABI,
      functionName: "register",
      args: [SCHEMA, RESOLVER, REVOCABLE],
      chain: null,
      account,
    });
    await pub.waitForTransactionReceipt({ hash: regHash });
  }
  const after = await pub.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: "getSchema",
    args: [uid],
  });
  check(after.uid === uid, "R2 · the registry gives the identifier this repository computed, so the prediction holds");
  check(after.schema === SCHEMA, "R3 · and the string it stored is the frozen one, byte for byte");
  check(after.resolver === RESOLVER && after.revocable === REVOCABLE, "R4 · with no resolver and revocable true");

  // A real confirmation, carried rather than derived. The signature is genuine and
  // the reviewer's chain is the row's own, not this fork's.
  const row = JSON.parse(readFileSync(join(process.cwd(), "fixtures/confirmation.259.json"), "utf8"));
  const o = toObservation(row);
  check(o.verifierChainId === 11155111 && chainId === 11155111,
    "R5 · the verifier's chain is carried from the row (it equals the anchor chain today, which is what would hide a derivation)");

  const message = {
    version: 2,
    schema: uid,
    recipient: ZERO_ADDRESS as `0x${string}`,
    time: o.verifiedAt,
    expirationTime: 0n,
    revocable: true,
    refUID: ZERO_BYTES32 as `0x${string}`,
    data: encodeObservation(o),
    salt: randomSalt(),
  };
  const domain = { name: OFFCHAIN_DOMAIN_NAME, version, chainId, verifyingContract: EAS_ADDRESS };
  const signed = await signObservation(account, domain, message);
  check(await verifyObservation(signed), "R6 · the offchain identifier re-derives and the attester recovers from the stored object");

  const noSalt = { ...signed, message: { ...signed.message, salt: ZERO_BYTES32 as `0x${string}` } };
  check(!(await verifyObservation(noSalt)), "R7 · and it does not, once the salt is dropped (seen to fail)");

  const first = await anchorTimestamp(pub, wallet, signed.uid);
  check(!first.alreadyAnchored && first.at > 0n, `A24a · the first anchor sends one transaction and fixes a time (${first.at})`);

  const second = await anchorTimestamp(pub, wallet, signed.uid);
  check(second.alreadyAnchored && second.at === first.at,
    "A24b · the second returns the same time and sends nothing, which is the guard");

  // The guard removed, which is the failure it exists to prevent.
  let reverted = "";
  try {
    await wallet.writeContract({
      address: EAS_ADDRESS,
      abi: EAS_ABI,
      functionName: "timestamp",
      args: [signed.uid],
      chain: null,
      account,
    });
  } catch (e) {
    reverted = e instanceof Error ? e.message : String(e);
  }
  check(/AlreadyTimestamped/.test(reverted),
    "A24c · without the guard the contract reverts AlreadyTimestamped, so a rehearsal would kill a live run (seen to fail)");

  const attestHash = await attestOnchain(pub, wallet, uid, message.data);
  const receipt = await pub.waitForTransactionReceipt({ hash: attestHash });
  const attested = receipt.logs.find(l => l.topics[0] === TOPIC_ATTESTED);
  check(!!attested, "Q1 · the onchain leg emits Attested, recomputed topic and not a copied one");
  check(attested?.topics[3] === uid,
    "Q2 · with the schema identifier in the fourth topic, which is what an indexer filters on natively");

  console.log(`\n  ${n - bad}/${n} passed\n`);
  process.exitCode = bad ? 1 : 0;
}

main().catch(e => {
  console.error("  fork proof failed:", e);
  process.exitCode = 1;
});
