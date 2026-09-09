/**
 * Anchors confirmed machine proposals, one attestation each.
 *
 * Pulls from the reviewing application's public list, so nothing on that side
 * changes and nothing here needs a credential to read it. Filters to confirmed
 * rows a machine proposed, refuses anything else, and writes two records per clip:
 * an offchain attestation that is the record, and an onchain pair so it can be
 * found.
 *
 * Dry run by default. `--execute` is what sends.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  EAS_ADDRESS,
  anchorTimestamp,
  attestOnchain,
  domainVersion,
  publicClientFor,
  requireAnchorChain,
  walletClientFor,
} from "../lib/anchor/eas";
import { signedBy } from "../lib/anchor/confirmation";
import { encodeObservation, toObservation } from "../lib/anchor/observation";
import { OFFCHAIN_DOMAIN_NAME, ZERO_ADDRESS, ZERO_BYTES32, randomSalt, signObservation } from "../lib/anchor/offchain";
import { UnanchorableClip, schemaUid } from "../lib/anchor/schema";
import { storeFrom } from "../lib/anchor/store";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const anyChain = process.argv.includes("--any-chain");
  const limit = Number(arg("--limit", "1"));
  const rpc = process.env.ANCHOR_RPC_URL;
  const clipsUrl = process.env.XOVI_CLIPS_URL;
  if (!rpc) throw new Error("ANCHOR_RPC_URL is not set");
  if (!clipsUrl) throw new Error("XOVI_CLIPS_URL is not set");

  const store = storeFrom();
  if (!store) throw new Error("DATABASE_URL is not set, and the row is the guard that stops a repeat being attempted");

  const pub = publicClientFor(rpc);
  const chainId = await requireAnchorChain(pub, anyChain);
  const version = await domainVersion(pub);
  const schema = schemaUid();

  const res = await fetch(clipsUrl);
  if (!res.ok) throw new Error(`the clips list answered ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  const candidates = rows.filter(r => r.source === "cv" && r.status === "verified").slice(0, limit);
  console.log(`\n  ${rows.length} rows, ${candidates.length} to anchor, chain ${chainId}, domain version ${version}\n`);

  for (const row of candidates) {
    let o;
    try {
      o = toObservation(row);
    } catch (e) {
      console.log(`  skip  clip ${row.id}: ${e instanceof UnanchorableClip ? e.message : e}`);
      continue;
    }

    // The reviewer's signature is checked before anything is signed over it.
    // Attesting a confirmation whose signature does not recover would publish a
    // claim that reads as strong and is not, which is the one failure this whole
    // milestone would otherwise make harder to notice rather than easier.
    const ok = await signedBy(
      {
        clipId: o.clipId,
        clipHash: o.clipHash,
        decision: 1,
        verifierNonce: o.verifierNonce,
        verifierChainId: o.verifierChainId,
      },
      o.verifierSignature,
      o.verifier,
    );
    if (!ok) {
      console.log(`  skip  clip ${o.clipId}: the signature does not recover to ${o.verifier}`);
      continue;
    }

    const account = execute ? privateKeyToAccount(process.env.ATTESTATION_PRIVATE_KEY as `0x${string}`) : null;
    if (!account) {
      console.log(`  would anchor clip ${o.clipId}, verifier ${o.verifier}, signature checks out`);
      continue;
    }

    const message = {
      version: 2,
      schema,
      recipient: ZERO_ADDRESS as `0x${string}`,
      time: o.verifiedAt,
      expirationTime: 0n,
      revocable: true,
      refUID: ZERO_BYTES32 as `0x${string}`,
      data: encodeObservation(o),
      salt: randomSalt(),
    };
    const signed = await signObservation(account, {
      name: OFFCHAIN_DOMAIN_NAME,
      version,
      chainId,
      verifyingContract: EAS_ADDRESS,
    }, message);

    // Claimed before anything is sent. A row that exists means this clip has been
    // through here, whatever the chain says.
    const claimed = await store.claim({
      clipId: o.clipId,
      uid: signed.uid,
      clipHash: o.clipHash,
      schemaUid: schema,
      attester: account.address,
      signed,
    });
    if (!claimed) {
      console.log(`  skip  clip ${o.clipId}: already anchored`);
      continue;
    }

    const wallet = walletClientFor(rpc, account);
    const anchored = await anchorTimestamp(pub, wallet, signed.uid);
    const attestTx = await attestOnchain(pub, wallet, schema, message.data);
    await store.complete(signed.uid, {
      timestampTx: anchored.txHash,
      timestampedAt: anchored.at,
      attestTx,
    });
    console.log(`  clip ${o.clipId}  uid ${signed.uid}`);
    console.log(`    timestamp ${anchored.alreadyAnchored ? "already at" : "at"} ${anchored.at}${anchored.txHash ? `, tx ${anchored.txHash}` : ""}`);
    console.log(`    attest    tx ${attestTx}`);
  }
  console.log("");
}

main().catch(err => {
  console.error("  anchor failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
