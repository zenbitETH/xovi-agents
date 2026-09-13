/**
 * Issue every requested name. Run by the owner, on the owner's machine, never by a server.
 *
 *   NAMES_OWNER_KEY_FILE=~/.config/axolodao/xovi-eth-owner.key \
 *   DATABASE_URL=... AGENT_ENS_RPC_URL=... npx tsx bin/issue-names.ts [--execute]
 *
 * WHY THIS IS A SCRIPT AND NOT A ROUTE, and it is a measurement rather than a
 * preference. The per account resolver that answers for `xovi.eth` and every subname
 * implements NEITHER of ENS's approval mechanisms: `isApprovedForAll` and
 * `isApprovedFor` both revert on it, read on Sepolia on 2026-09-12. So there is no
 * operator the owner could approve and therefore no key a server could hold that
 * would be allowed to write. `setAddr(bytes32,address)` simulated from the owner
 * succeeds and from any other address reverts, which is the same fact from the other
 * side. A route that held a key able to do this would be holding the OWNER's key, and
 * that is the custody rule this file exists to keep: the owner key never reaches a
 * server.
 *
 * THE KEY COMES FROM A FILE, NOT FROM THE ENVIRONMENT, and the file is named rather
 * than its contents pasted. A key in an environment variable travels into every child
 * process, into `ps` on a shared machine, and into whatever a crash reporter collects.
 * The path is the argument; the bytes are read once and never logged.
 *
 * DRY BY DEFAULT. Without `--execute` this resolves, simulates each write and prints
 * what it would do, and sends nothing. The founder can see the whole plan before a
 * single transaction leaves his machine.
 *
 * WHAT IT WRITES, AND NOTHING ELSE. One `setAddr` per pending row, setting the address
 * record of `label.xovi.eth` to the wallet that asked. No transfer, no wrapper call,
 * no resolver change. The audit plan's row asks for the transaction decoded and this
 * is the only call it ever makes.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, namehash, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { PARENT, storeFrom } from "../lib/agent/names-store";

/** The per account resolver that answers for `xovi.eth` and every subname of it.
 *  Read from the chain rather than assumed: `getEnsResolver` returns this for the
 *  parent and for every label, issued or not, because the parent is a wildcard. */
const RESOLVER = "0xAe2084CBAB44C16F38f3E6656Ec20c959521813D" as const;

/** Taken from the implementation this resolver clones, `0xa136bee4…`, rather than
 *  from a shared PublicResolver ABI. Both forms exist on it and both are owner only;
 *  this is the one the ENS app uses for an address record, so the script does by call
 *  what the founder did by click on 11 September. */
const RESOLVER_ABI = parseAbi(["function setAddr(bytes32 node, address a)"]);

function keyFromFile(path: string): `0x${string}` {
  const expanded = path.startsWith("~") ? path.replace("~", homedir()) : path;
  const raw = readFileSync(expanded, "utf8").trim();
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // The message never carries the value, only its shape.
    throw new Error(`${expanded} does not hold a 32 byte hex key (read ${key.length} characters)`);
  }
  return key as `0x${string}`;
}

async function main(argv: string[]) {
  const execute = argv.includes("--execute");
  const store = storeFrom();
  if (!store) throw new Error("DATABASE_URL is needed to read what was requested");

  const keyFile = process.env.NAMES_OWNER_KEY_FILE;
  if (!keyFile) throw new Error("NAMES_OWNER_KEY_FILE must name the file holding the owner key");
  const account = privateKeyToAccount(keyFromFile(keyFile));

  const transport = http(process.env.AGENT_ENS_RPC_URL || undefined);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  // The chain says which chain it is before anything is written to it. On the wrong
  // chain this would either revert or, worse, succeed against a different registry.
  const answered = await publicClient.getChainId();
  if (answered !== sepolia.id) throw new Error(`the endpoint answered chain ${answered}, not ${sepolia.id}`);

  const pending = await store.pending();
  console.log(`\n  owner    ${account.address}`);
  console.log(`  resolver ${RESOLVER}`);
  console.log(`  pending  ${pending.length}${execute ? "" : "   (dry run; pass --execute to send)"}\n`);
  if (pending.length === 0) return 0;

  const wallet = createWalletClient({ account, chain: sepolia, transport });
  let sent = 0;

  for (const row of pending) {
    const name = `${row.label}.${PARENT}`;
    const node = namehash(name);

    // Simulated first, every time, including under --execute. A simulation that
    // reverts is the owner learning the write is not allowed BEFORE spending gas on
    // discovering it, and it is also how a wrong resolver or a wrong chain shows up.
    try {
      await publicClient.simulateContract({
        address: RESOLVER, abi: RESOLVER_ABI, functionName: "setAddr",
        args: [node, row.payer as `0x${string}`], account,
      });
    } catch (err) {
      console.log(`  REFUSED  ${name} -> ${row.payer}  ${err instanceof Error ? err.name : "error"}`);
      continue;
    }

    if (!execute) {
      console.log(`  would    setAddr ${name} -> ${row.payer}`);
      continue;
    }

    const hash = await wallet.writeContract({
      address: RESOLVER, abi: RESOLVER_ABI, functionName: "setAddr",
      args: [node, row.payer as `0x${string}`],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.log(`  FAILED   ${name}  ${hash}`);
      continue;
    }

    // Written back only after the receipt says success. A hash recorded for a
    // reverted transaction would make the row read issued while the chain holds
    // nothing, which is the one claim the read path must never be able to make.
    const marked = await store.markIssued(row.label, hash, new Date());
    console.log(`  issued   ${name} -> ${row.payer}  ${hash}${marked ? "" : "  (row already marked)"}`);
    sent++;
  }

  console.log(`\n  ${execute ? `${sent} issued` : "nothing sent"}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
