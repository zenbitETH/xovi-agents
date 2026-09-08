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
 * Nothing is registered yet. The name that was assumed available turned out not
 * to be, so this path is unexercised: with AGENT_ENS_NAME unset the seam returns
 * the configured url and the resolution branch is never entered.
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
    throw new EndpointUnresolvable(
      `${name} has no ${WINDOWS_RECORD_KEY} record, and a name that resolves to nothing is not a reason to read from elsewhere`,
    );
  }
  return requireHttps(record, `the ${WINDOWS_RECORD_KEY} record on ${name}`);
}
