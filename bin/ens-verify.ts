/**
 * Reads the agent's endpoint out of a name, through the path the agent uses.
 *
 * The module that resolves the endpoint takes an injectable lookup, and every
 * check of it passes a fake one, so the four refusal branches are proven and the
 * viem adapter underneath them has never run. This runs it. It calls
 * `resolveWindowsEndpoint` with **no resolver argument**, so what is exercised here
 * is what `bin/agent.ts` executes and not a parallel path that resembles it.
 *
 * It also diagnoses, which the module deliberately does not. A text lookup answers
 * `null` for a name that does not exist and for a registered name carrying no
 * record, identically, so the module names both causes and stops there rather than
 * spending a second call on every agent run to improve an error string. Here the
 * extra call is worth it, because this is where somebody debugging is.
 */
import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { WINDOWS_RECORD_KEY, resolveWindowsEndpoint } from "../lib/agent/ens";

const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const REGISTRY_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * A name that certainly resolves on this chain, read before anything else.
 *
 * Without it a `null` is not evidence. It means the same as an adapter that never
 * reached a resolver. Measured: the first probe of this work returned null for
 * three names AND for its control, and only a positive control turned that into
 * information.
 *
 * What it was measured to do, precisely, on an rpc pointed at the wrong chain: the
 * registry read throws `returned no data ("0x")`, and the control converts that
 * into a sentence naming the rpc. So on that case it buys clarity rather than
 * correctness, and saying so is the point. The case it would buy correctness on is
 * an endpoint that answers with zeros instead of reverting, where every lookup
 * below would read as "not registered" and be believed. That one is the reason it
 * is here and it has not been observed.
 */
const CONTROL = "ens.eth";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name") ?? process.env.AGENT_ENS_NAME ?? "";
  const rpc = process.env.AGENT_ENS_RPC_URL;
  const client = createPublicClient({ chain: sepolia, transport: http(rpc || undefined) });

  console.log(`\n  chain    ${sepolia.id} (${sepolia.name})`);
  console.log(`  rpc      ${rpc ?? "viem's default for this chain"}`);
  console.log(`  name     ${name || "(none set)"}`);
  console.log(`  record   ${WINDOWS_RECORD_KEY}\n`);

  if (!name) {
    console.error(`  AGENT_ENS_NAME is not set and no --name was given. Nothing to verify.`);
    process.exitCode = 1;
    return;
  }

  // The instrument, before the measurement.
  const controlResolver = await client.getEnsResolver({ name: CONTROL }).catch(() => null);
  if (!controlResolver || controlResolver === ZERO) {
    console.error(`  the control name ${CONTROL} did not resolve, so this endpoint is not answering`);
    console.error(`  about names at all. Every answer below would be meaningless. Check the rpc.`);
    process.exitCode = 1;
    return;
  }
  console.log(`  control  ${CONTROL} resolves to ${controlResolver}, so the chain path works\n`);

  // The diagnosis the module refuses to spend a call on.
  const owner = await client.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "owner", args: [namehash(name)] });
  const resolver = await client.getEnsResolver({ name }).catch(() => null);
  console.log(`  owner    ${owner}`);
  console.log(`  resolver ${resolver ?? ZERO}`);
  if (owner === ZERO) {
    console.error(`\n  ${name} is NOT REGISTERED on chain ${sepolia.id}. Register it before setting a record.`);
    process.exitCode = 1;
    return;
  }
  if (!resolver || resolver === ZERO) {
    console.error(`\n  ${name} is registered and has NO RESOLVER set. Set one, then set the record.`);
    process.exitCode = 1;
    return;
  }

  // The path the agent runs. No injected lookup.
  try {
    const url = await resolveWindowsEndpoint(process.env);
    console.log(`\n  ${WINDOWS_RECORD_KEY} resolves to ${url}`);
    console.log(`  verified. AGENT_ENS_NAME may be set to ${name} and the deployment refreshed.\n`);
  } catch (err) {
    console.error(`\n  REFUSED: ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("  ens-verify failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
