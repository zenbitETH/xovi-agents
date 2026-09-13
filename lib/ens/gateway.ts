import {
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  decodeAbiParameters,
  encodeFunctionResult,
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  namehash,
  parseAbi,
  recoverAddress,
} from "viem";
import { sign } from "viem/accounts";
import { normalize } from "viem/ens";
import { WINDOWS_RECORD_KEY } from "../agent/ens";
import { ZERO_ADDRESS } from "../agent/name";
import { PARENT, type NamesStore } from "../agent/names-store";

/**
 * The CCIP Read gateway for `xovi.eth`, as a module the route and the checks share.
 *
 * Standards, and the reference this follows: ENSIP-10 (the request is
 * `resolve(bytes name, bytes data)` with a DNS encoded name), EIP-3668 (the client
 * arrives by GET at `{sender}/{data}.json` and expects `{ "data": "0x…" }`), EIP-191
 * version 0x00 for the signature (`0x19 0x00 ‖ target ‖ expires ‖ keccak(request) ‖
 * keccak(result)`, signed as a raw digest), and ensdomains/offchain-resolver at commit
 * 099b7e9827899efcf064e71b7125f7b4fc2e342f, whose `packages/gateway/src/server.ts` this
 * mirrors: the same three query handlers, the same normalisation and namehash checks,
 * the same digest. The deviations are the ones the host forces: a Next route rather
 * than the reference's Express app, the `names` table rather than its JSON zone file,
 * and a 65 byte `r ‖ s ‖ v` signature rather than the 64 byte compact form, because
 * the contract verifies with OpenZeppelin 5, which accepts 65 bytes and nothing else.
 *
 * WHAT IS ON THE WIRE, AND NOTHING ELSE: an address or a text value, an expiry and a
 * signature. No station, no alias, no count, no row beyond the payer of the one label
 * asked about. The signing key is read in one function, used for one signature and
 * returned nowhere.
 *
 * A ROW IN THE `names` TABLE IS THE ISSUANCE. The gateway answers the row's payer for
 * its label the moment the row exists; the request route already admits only wallets
 * with a person behind them, so the gate is at the request and there is no separate
 * approval mark. `agent1` was issued by hand on chain before the table existed, so it
 * is answered from a constant when the table holds no row for it.
 */
export const EXPIRY_SECONDS = 300;

/** The one label shape this gateway ever answers with an address. `agent` and a
 *  positive integer with no leading zero, which is exactly what the sequence
 *  produces, so a station, an alias or anything a person typed is not a label here
 *  and is answered with the zero address like any other unissued name. */
export const LABEL_RE = /^agent[1-9][0-9]*$/;

/** The founder's recording wallet, which `agent1.xovi.eth` was issued to by hand on
 *  2026-09-11. A row for `agent1` in the table wins over this. */
export const SEEDED: Readonly<Record<string, string>> = Object.freeze({
  agent1: "0xC0686ae97FDf62A37F081922c2a92537862E0B95",
});

export const ETH_COIN_TYPE = 60n;

export class BadRequest extends Error {}
export class NotThisZone extends Error {}
export class GatewayMisconfigured extends Error {}

/** `resolve(bytes,bytes)`: the ENSIP-10 entry point and, with the same signature, the
 *  reference's `IResolverService.resolve` the contract encodes into `callData`. */
const RESOLVE_ABI = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes)"]);

/** The three record calls the reference's gateway answers, minus contenthash, which
 *  no name under this parent carries. */
const ADDR_ABI = parseAbi(["function addr(bytes32 node) view returns (address)"]);
const ADDR_COIN_ABI = parseAbi(["function addr(bytes32 node, uint256 coinType) view returns (bytes)"]);
const TEXT_ABI = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
const RECORD_ABI = [...ADDR_ABI, ...ADDR_COIN_ABI, ...TEXT_ABI];

export type Query = {
  name: string;
  node: Hex;
  call: { fn: "addr"; coinType: bigint; form: "address" | "bytes" } | { fn: "text"; key: string };
};

/** The DNS wire form, as the reference decodes it: length prefixed labels, a zero
 *  terminator. */
export function decodeDnsName(packet: Hex): string {
  const bytes = Buffer.from(packet.slice(2), "hex");
  const labels: string[] = [];
  let i = 0;
  for (;;) {
    if (i >= bytes.length) throw new BadRequest("the name is not DNS encoded: no terminator");
    const len = bytes[i];
    if (len === 0) break;
    if (i + 1 + len > bytes.length) throw new BadRequest("the name is not DNS encoded: a label runs past the end");
    labels.push(bytes.subarray(i + 1, i + 1 + len).toString("utf8"));
    i += 1 + len;
  }
  return labels.join(".");
}

/** Decodes the outer `resolve` call and the record call nested in it. Refuses, as
 *  the reference does, a name that is not normalised or whose namehash is not the
 *  node the inner call names. */
export function decodeQuery(callData: Hex): Query {
  let outer;
  try {
    outer = decodeFunctionData({ abi: RESOLVE_ABI, data: callData });
  } catch {
    throw new BadRequest("the call is not resolve(bytes,bytes)");
  }
  const [packet, inner] = outer.args as [Hex, Hex];
  const name = decodeDnsName(packet);
  if (!name) throw new BadRequest("the name is empty");
  let normalised: string;
  try {
    normalised = normalize(name);
  } catch {
    throw new BadRequest("the name is not normalisable");
  }
  if (normalised !== name) throw new BadRequest("the name must be normalised");

  let record;
  try {
    record = decodeFunctionData({ abi: RECORD_ABI, data: inner });
  } catch {
    throw new BadRequest("unsupported query function");
  }
  const node = record.args[0] as Hex;
  if (namehash(name) !== node) throw new BadRequest("the name does not match the node");

  if (record.functionName === "text") {
    return { name, node, call: { fn: "text", key: String(record.args[1]) } };
  }
  const coinType = record.args.length > 1 ? BigInt(record.args[1] as bigint) : ETH_COIN_TYPE;
  return { name, node, call: { fn: "addr", coinType, form: record.args.length > 1 ? "bytes" : "address" } };
}

export type EnvLike = Record<string, string | undefined>;

/**
 * The address a label answers, from the table or the seed, else zero.
 *
 * Shared with the name route, so "the gateway would answer this label" is the same
 * function there as here rather than a second reading of the same table.
 */
export async function addrForLabel(label: string, store: NamesStore | null): Promise<string> {
  if (!LABEL_RE.test(label)) return ZERO_ADDRESS;
  const row = store ? await store.byLabel(label) : null;
  if (row && isAddress(row.payer)) return getAddress(row.payer);
  const seeded = SEEDED[label];
  return seeded ? getAddress(seeded) : ZERO_ADDRESS;
}

/** The parent's own address, from the documented variable. Unset is a 503 rather
 *  than a signed zero, because a signed zero would un-resolve `xovi.eth` itself. */
function parentAddress(env: EnvLike): string {
  const value = (env.ENS_PARENT_ADDRESS ?? "").trim();
  if (!isAddress(value)) throw new GatewayMisconfigured("ENS_PARENT_ADDRESS is not set to an address");
  return getAddress(value);
}

/** The parent's `x402:windows` record, from the documented variable, for the same
 *  reason. Every other key is the empty string, the standard unset answer. */
function parentText(key: string, env: EnvLike): string {
  if (key !== WINDOWS_RECORD_KEY) return "";
  const value = (env.ENS_TEXT_X402_WINDOWS ?? "").trim();
  if (!value) throw new GatewayMisconfigured("ENS_TEXT_X402_WINDOWS is not set");
  return value;
}

/** Which name this is: the parent, one label under it, or something this gateway
 *  does not answer for. A deeper name under the parent is inside the zone and
 *  unissued, so it answers zero rather than refusing. */
function place(name: string): { kind: "parent" } | { kind: "label"; label: string } | { kind: "deeper" } {
  if (name === PARENT) return { kind: "parent" };
  if (!name.endsWith(`.${PARENT}`)) throw new NotThisZone(`this gateway answers for ${PARENT} and its labels`);
  const rest = name.slice(0, -(PARENT.length + 1));
  return rest.includes(".") ? { kind: "deeper" } : { kind: "label", label: rest };
}

/** The ABI encoded return of the record call, exactly as the on chain function
 *  would return it, which is what `resolve` promises to hand back. */
export async function answerQuery(query: Query, deps: { store: NamesStore | null; env: EnvLike }): Promise<Hex> {
  const where = place(query.name);

  if (query.call.fn === "text") {
    const value = where.kind === "parent" ? parentText(query.call.key, deps.env) : "";
    return encodeFunctionResult({ abi: TEXT_ABI, functionName: "text", result: value });
  }

  const address =
    where.kind === "parent"
      ? parentAddress(deps.env)
      : where.kind === "label"
        ? await addrForLabel(where.label, deps.store)
        : ZERO_ADDRESS;

  if (query.call.form === "address") {
    return encodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", result: address as Hex });
  }
  // addr(bytes32,uint256) returns bytes: the twenty address bytes for coin type 60,
  // and empty bytes for every other coin type, which is the unset answer for that form.
  const bytes: Hex = query.call.coinType === ETH_COIN_TYPE && address !== ZERO_ADDRESS ? (address as Hex) : "0x";
  return encodeFunctionResult({ abi: ADDR_COIN_ABI, functionName: "addr", result: bytes });
}

/** The reference's digest, field for field: `0x1900 ‖ target ‖ expires ‖
 *  keccak(request) ‖ keccak(result)`. `request` is the full `resolve` calldata the
 *  contract put in its `OffchainLookup`, and `target` is the contract. */
export function makeSignatureHash(target: string, expires: bigint, request: Hex, result: Hex): Hex {
  return keccak256(
    encodePacked(
      ["bytes", "address", "uint64", "bytes32", "bytes32"],
      ["0x1900", getAddress(target), expires, keccak256(request), keccak256(result)],
    ),
  );
}

const RESPONSE_TYPES = [{ type: "bytes" }, { type: "uint64" }, { type: "bytes" }] as const;

/**
 * The signed answer, `abi.encode(result, expires, sig)`, which is what the client
 * hands to `resolveWithProof` as `response`. The key is used here and nowhere else.
 */
export async function signAnswer(input: { sender: string; request: Hex; result: Hex; expires: bigint; key: Hex }): Promise<Hex> {
  const digest = makeSignatureHash(input.sender, input.expires, input.request, input.result);
  const sig = await sign({ hash: digest, privateKey: input.key, to: "hex" });
  return encodeAbiParameters(RESPONSE_TYPES, [input.result, input.expires, sig]);
}

/**
 * The contract's verification, mirrored in TypeScript so the round trip can be checked
 * without a chain: decode the response, rebuild the digest from the request, recover.
 * The expiry is compared here as the contract compares it, `expires >= now`.
 */
export async function verifyAnswer(input: {
  sender: string;
  request: Hex;
  response: Hex;
  now: bigint;
}): Promise<{ signer: string; result: Hex; expires: bigint }> {
  const [result, expires, sig] = decodeAbiParameters(RESPONSE_TYPES, input.response);
  if (expires < input.now) throw new Error("SignatureVerifier: Signature expired");
  const signer = await recoverAddress({ hash: makeSignatureHash(input.sender, expires, input.request, result), signature: sig });
  return { signer, result, expires };
}

/** Thirty two bytes as hex, read here and nowhere else. Null means the route
 *  answers 503, never a signature over nothing. The message never carries the
 *  value. */
export function signerKeyFrom(env: EnvLike): Hex | null {
  const raw = (env.ENS_GATEWAY_SIGNER_KEY ?? "").trim();
  if (!raw) return null;
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null;
}

/** The url template the contract carries, for the deploy step and the checks. */
export function gatewayUrlTemplate(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/ens/{sender}/{data}.json`;
}
