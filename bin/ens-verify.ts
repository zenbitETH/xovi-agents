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
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { WINDOWS_RECORD_KEY, resolveWindowsEndpoint } from "../lib/agent/ens";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Two names that certainly resolve on this chain, both read before anything else.
 *
 * Without a control a `null` is not evidence: it means the same as an endpoint that
 * never reached a resolver. Measured, the first probe of this work returned null for
 * three names AND for its own control, and only a positive control made it
 * information.
 *
 * Why two, stated as what was measured rather than as what it first looked like.
 * They do NOT reach different backends: both go through the same `0xeEeE` universal
 * resolver and the same v2 root and `eth` registries, so a dark v2 side fails both
 * and "one control would pass while v2 is down" is wrong. They diverge at the leaf.
 * `ens.eth` is answered by `0xae66c62A`, which ENS's deployments table lists in the
 * Sepolia v2 beta as `ENSV1Resolver`, the bridge that serves v1 records; and
 * `chijesus99.eth` by its own per-account v2 resolver. So the pair buys one positive
 * per leaf path, which is worth keeping because the operator's name may be registered
 * through either app.
 *
 * What the pair does NOT buy is wrong-chain detection, and the way that was learned
 * is the reason the chain id is now read separately. On `ethereum-rpc.publicnode.com`,
 * chain id 1, all three names resolve, `xoviagents.eth` included, because mainnet's
 * resolver walks up to the `eth` node for names that do not exist. An earlier probe
 * against `cloudflare-eth.com` saw all three throw and read that as the guard already
 * working. That endpoint answers `Internal error` to `eth_call` and `eth_getCode`
 * alike, for a contract another provider returns bytecode for, so it was broken for
 * the call rather than reporting anything about the network. A broken provider
 * returned a clean, reproducible result that read as a property of the chain.
 *
 * `chijesus99.eth` is not Zenbit's. It was harvested from a v2 registration log
 * because no name Zenbit controls exists on v2 yet. It may lapse or be transferred,
 * and if it stops resolving the fix is to harvest another, NOT to delete the control.
 * A control that lapses makes this refuse loudly, which is the safe direction; a
 * control that passes while proving the other version makes it lie, which is not.
 * Three replacements checked the same way, each with its own per-account resolver
 * and a live addr record: `wonderer.eth`, `keloidal.eth`, `carrioles.eth`.
 */
const CONTROLS = [
  { name: "ens.eth", leaf: "v1 records, via the ENSV1Resolver bridge" },
  { name: "chijesus99.eth", leaf: "a native v2 resolver" },
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name") ?? process.env.AGENT_ENS_NAME ?? "";
  const rpc = process.env.AGENT_ENS_RPC_URL;
  const client = createPublicClient({ chain: sepolia, transport: http(rpc || undefined) });

  /*
   * The instrument before the instrument.
   *
   * This line used to print `sepolia.id` out of the client's configuration, which is
   * an echo and not a reading: pointed at another network it announces the chain this
   * tool believes in while every answer under it comes from a different one. That is
   * the same class of object as the hardcoded registry address this file was rewritten
   * to delete, so it is read from the endpoint instead.
   *
   * The controls cannot stand in for it. They prove the endpoint answers about names,
   * not that it is the right endpoint to ask, and on one mainnet rpc all three names
   * resolve because mainnet's resolver walks up to the `eth` node for names that do
   * not exist. The run then enters the module and tells the operator to register a
   * name that is already registered, or set a record, on Sepolia.
   */
  const answered = await client.getChainId().catch(() => null);

  console.log(`\n  chain    ${sepolia.id} (${sepolia.name}), and the endpoint answered ${answered ?? "nothing"}`);
  console.log(`  rpc      ${rpc ?? "viem's default for this chain"}`);
  console.log(`  name     ${name || "(none set)"}`);
  console.log(`  record   ${WINDOWS_RECORD_KEY}\n`);

  if (!name) {
    console.error(`  AGENT_ENS_NAME is not set and no --name was given. Nothing to verify.`);
    process.exitCode = 1;
    return;
  }

  if (answered !== sepolia.id) {
    console.error(`  the rpc answered chain ${answered ?? "nothing"} and this tool reads ${sepolia.id}.`);
    console.error(`  Every answer below would describe a network you are not talking to. Check the rpc.`);
    process.exitCode = 1;
    return;
  }

  // The instrument, before the measurement, and both halves of it.
  for (const control of CONTROLS) {
    const resolved = await client.getEnsResolver({ name: control.name }).catch(() => null);
    if (!resolved || resolved === ZERO) {
      console.error(`  the control ${control.name} did not resolve, so this endpoint is not answering`);
      console.error(`  through ${control.leaf}. Every answer below would be meaningless. Check the rpc.`);
      process.exitCode = 1;
      return;
    }
    console.log(`  control  ${control.name} (${control.leaf}) resolves to ${resolved}`);
  }
  console.log();

  /*
   * The diagnosis the module refuses to spend a call on, read through the resolver
   * rather than through a registry.
   *
   * An earlier version read the owner out of the v1 registry at a hardcoded address
   * to separate "not registered" from "registered with no record". ENS documents
   * that registry as no longer in use on Sepolia, so a name registered on v2 would
   * have been reported NOT REGISTERED: the tool would deny the operator's own
   * registration and the obvious conclusion would be that registering had failed.
   *
   * Reading the v2 registry instead was tried and rejected on a measurement. Its
   * token id is the labelhash with the low four bytes cleared, not the labelhash:
   * `ownerOf(labelhash("chijesus99"))` answers zero for a name whose owner is
   * `0x6DC9B8d8...`, and only `ownerOf(labelhash & ~0xffffffff)` returns it. A zero
   * from a free name and a zero from the wrong id are the same zero, which is the
   * class of answer this file exists to refuse. That masking is an internal of the
   * v2 registry, ENS tells applications to look names up rather than hardcode
   * addresses, and viem declares no `ensRegistry` for this chain at all.
   *
   * So the existence test is the resolver, which viem reads through its configured
   * universal resolver and which works on both versions. What it cannot do is tell
   * an unregistered name from a registered one with no resolver, so it names both,
   * the same way the module names both causes of a null.
   */
  const resolver = await client.getEnsResolver({ name }).catch(() => null);
  console.log(`  resolver ${resolver ?? ZERO}`);
  if (!resolver || resolver === ZERO) {
    console.error(`\n  ${name} has NO RESOLVER on chain ${sepolia.id}: either it is not registered, or it is`);
    console.error(`  registered and no resolver is set. Register it, or set a resolver, then set the record.`);
    process.exitCode = 1;
    return;
  }

  // The path the agent runs. No injected lookup, and the name it resolves is the
  // name diagnosed above. Passing `process.env` straight in read `AGENT_ENS_NAME`
  // instead, so `--name X` diagnosed X and then certified whatever the environment
  // pointed at: with `WINDOWS_URL` set and `AGENT_ENS_NAME` unset the fallback url
  // was printed as X's record and exit was 0. That is a verifier certifying a name
  // it never read, and an operator who believed it would set the variable and turn
  // the agent off. It failed closed on a machine with no `WINDOWS_URL` and open on
  // every deployment that has one.
  try {
    const url = await resolveWindowsEndpoint({ ...process.env, AGENT_ENS_NAME: name });
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
