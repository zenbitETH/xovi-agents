import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import type { EnvLike } from "./pay";

/**
 * Where the agent reads its windows from.
 *
 * The point of putting the endpoint in a name record rather than a constant is
 * that the operator can move the endpoint without shipping the agent again, and
 * that a reader can see what the agent is pointed at without being handed its
 * configuration. The record names a role and a payment endpoint. No record names
 * a subject, and that is a commitment rather than something a resolver enforces:
 * access control on a name authorises writers, not values.
 *
 * The fallback is deliberately not a fallback. If a name is configured and does
 * not resolve, this throws rather than quietly using the environment variable,
 * because the failure that matters is a typo in the name resolving to nothing
 * while the agent carries on reading from somewhere else entirely.
 *
 * As of 2026-09-12 this path runs: `xovi.eth` is registered on Sepolia and its
 * `x402:windows` record resolves to the windows endpoint. With AGENT_ENS_NAME unset
 * the seam still returns the configured url and the branch is not entered, so which
 * of the two happens is a property of the environment rather than of this file.
 *
 * This paragraph is dated because it asserts the state of something outside the
 * repository, which changes without anything here changing. It said `Nothing is
 * registered yet` until the name was registered, and nothing in a build would have
 * caught that.
 */
export const WINDOWS_RECORD_KEY = "x402:windows";

export class EndpointUnresolvable extends Error {}

/** The lookup, injectable so the branch that must raise can be checked without a
 *  chain. Built inline it had no test, which for a fail-closed path is the same as
 *  not having the path. */
export type TextResolver = (name: string, key: string, env: EnvLike) => Promise<string | null>;

const viemResolver: TextResolver = (name, key, env) =>
  createPublicClient({ chain: sepolia, transport: http(env.AGENT_ENS_RPC_URL || undefined) }).getEnsText({
    name,
    key,
  });

/** https only, and parsed rather than pattern matched. The endpoint may come from a
 *  record anyone with the name's write role can change, and a bearer credential is
 *  sent against whatever it names. */
function requireHttps(url: string, where: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EndpointUnresolvable(`${where} is not a url: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new EndpointUnresolvable(`${where} must be https, got ${parsed.protocol.replace(":", "")}`);
  }
  return parsed.toString();
}

export async function resolveWindowsEndpoint(
  env: EnvLike = process.env,
  resolver: TextResolver = viemResolver,
): Promise<string> {
  const name = (env.AGENT_ENS_NAME ?? "").trim();
  if (!name) {
    const url = (env.WINDOWS_URL ?? "").trim();
    if (!url) throw new EndpointUnresolvable("neither AGENT_ENS_NAME nor WINDOWS_URL is set");
    return url;
  }

  let record: string | null;
  try {
    record = await resolver(name, WINDOWS_RECORD_KEY, env);
  } catch (err) {
    throw new EndpointUnresolvable(`${name} could not be resolved: ${err instanceof Error ? err.message : "unknown"}`);
  }
  if (!record) {
    // Both causes, because this cannot tell them apart and must not pretend to.
    // A text lookup answers `null` for a name that does not exist and for a
    // registered name with no record, identically. An earlier message named only
    // the second, so an operator who mistyped the name was told the record was
    // missing; they would then set a record on the name they meant, verify it, and
    // still be broken, pointed at a different name that also has no record.
    //
    // Distinguishing them means reading the registry, which is a second call on
    // every agent run to improve an error string. The behaviour here is already
    // right, it fails closed; what was wrong was claiming to know why. The
    // diagnosis lives in `bin/ens-verify.ts`, which is where somebody debugging is.
    throw new EndpointUnresolvable(
      `${name} resolved to no ${WINDOWS_RECORD_KEY} record: either the name is not registered on this chain, or it is registered and carries no such record. Run bin/ens-verify.ts to find out which. A name that resolves to nothing is not a reason to read from elsewhere`,
    );
  }
  return requireHttps(record, `the ${WINDOWS_RECORD_KEY} record on ${name}`);
}

/**
 * The name Zenbit issues to an agent, and the check that it names the key this agent
 * pays from.
 *
 * **Zenbit issues the name; the agent does not own it.** A subname's records live in
 * the parent's resolver and only the parent's owner can write them, so Zenbit can
 * overwrite or remove any of these at will. An issued name is an attestation by the
 * issuer about which key it recognises, which is a smaller and truer thing than
 * ownership, and nothing here should be written as though the agent held it.
 *
 * Separate from `AGENT_ENS_NAME`, which despite its generic name holds the endpoint
 * record and belongs to the service. The distinction is identity against endpoint,
 * not one ENS name against another, which is why the variables do not share a prefix.
 *
 * The endpoint deliberately stays on the parent rather than being copied onto each
 * subname issued to each agent: one write moves it for every agent, and that is the property the
 * record exists to provide.
 *
 * **The instrument here is `addr`, and it has to be, because `resolver` is blind.**
 * Wildcard resolution is live under the parent, so every subname returns the parent's
 * resolver whether or not anybody issued it, an invented one included. Measured
 * 2026-09-12: `agent1.xovi.eth` and `zzq7-invented-4417.xovi.eth` both resolve to
 * `0xAe2084CB`, and only the address record tells them apart, zero against the payer.
 * A control that discriminates on the resolver would pass here while proving nothing.
 *
 * One thing that looks alarming and is not, recorded so nobody re-derives it as a
 * finding: the resolver also accepts writes for nodes under names Zenbit does not
 * control, and `agent1.chijesus99.eth` simulates fine against it. Harmless, because
 * that name routes through a different resolver and nobody reads ours for it.
 * Authorisation here is "this is my resolver"; routing is what makes a record mean
 * anything.
 */
export class IdentityMismatch extends Error {}

/** Injectable for the same reason the text lookup is: a branch that must raise needs
 *  to be checkable without a chain. */
export type AddressResolver = (name: string, env: EnvLike) => Promise<string | null>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const viemAddressResolver: AddressResolver = (name, env) =>
  createPublicClient({ chain: sepolia, transport: http(env.AGENT_ENS_RPC_URL || undefined) }).getEnsAddress({ name });

/**
 * Returns the issued name once it is confirmed to point at this payer, or null when
 * no name is configured. Raises when a name is configured and does not check out.
 *
 * Optional, and asymmetric on purpose. Unset means the agent claims no name and runs
 * as it always did. Set means the claim has to be true, because the agent is about to
 * write proposals attributed to that identity: a false claim does not sit in the
 * configuration where an operator might notice it, it lands in records other people
 * read. That is the same shape as the endpoint rule one function above, which is why
 * both raise rather than carrying on: a name that resolves to nothing is not
 * permission to read from elsewhere, and a name that resolves to somebody else is not
 * permission to claim it.
 */
export async function assertIssuedIdentity(
  payer: string,
  env: EnvLike = process.env,
  resolver: AddressResolver = viemAddressResolver,
): Promise<string | null> {
  const name = (env.AGENT_IDENTITY_NAME ?? "").trim();
  if (!name) return null;

  let addr: string | null;
  try {
    addr = await resolver(name, env);
  } catch (err) {
    throw new IdentityMismatch(`${name} could not be resolved: ${err instanceof Error ? err.message : "unknown"}`);
  }
  if (!addr || addr === ZERO_ADDRESS) {
    throw new IdentityMismatch(
      `${name} has no address record, so Zenbit has not issued it to this agent. Under a wildcard parent every subname resolves, so a missing record is what an unissued name looks like and a typo looks identical. Issue it or unset AGENT_IDENTITY_NAME`,
    );
  }
  if (addr.toLowerCase() !== payer.toLowerCase()) {
    throw new IdentityMismatch(
      `${name} is issued to ${addr}, and this agent pays from ${payer}. Refusing to run under a name that names somebody else: the proposals would carry an identity this key cannot substantiate`,
    );
  }
  return name;
}
