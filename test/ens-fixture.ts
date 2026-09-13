/**
 * One answer signed by the gateway's own code, committed so the contract test can
 * verify it: the TypeScript digest and the Solidity digest are shown to be one
 * value by a signature made on one side and recovered on the other.
 *
 *   npx tsx test/ens-fixture.ts --write
 *
 * Deterministic on purpose. The key is anvil's second account, public by design;
 * the expiry is fixed at 2100-01-01; the signature is RFC 6979, so the same inputs
 * always produce the same bytes. A check rebuilds it in memory and compares with
 * the committed file, so a change to the signing turns that check red rather than
 * quietly drifting away from what the contract test verifies.
 *
 * `sender` is not a deployed address. The contract reads the target out of the
 * `extraData` the client hands back, which the contract itself built, so the test
 * passes this one in explicitly; what the fixture proves is the digest, not routing.
 */
import { writeFileSync } from "node:fs";
import { encodeFunctionData, encodeFunctionResult, namehash, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { packetToBytes } from "viem/ens";
import { signAnswer } from "../lib/ens/gateway";

export const FIXTURE_PATH = "contracts/test/fixtures/gateway-answer.json";

/** anvil account #1. Public, funded on no real chain, worth nothing. */
const SCRATCH_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SENDER = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const NAME = "agent2.xovi.eth";
const EXPIRES = 4102444800n; // 2100-01-01T00:00:00Z

const RESOLVE_ABI = parseAbi(["function resolve(bytes name, bytes data) view returns (bytes)"]);
const ADDR_ABI = parseAbi(["function addr(bytes32 node) view returns (address)"]);

export async function buildFixture() {
  const inner = encodeFunctionData({ abi: ADDR_ABI, functionName: "addr", args: [namehash(NAME)] });
  const request = encodeFunctionData({ abi: RESOLVE_ABI, functionName: "resolve", args: [toHex(packetToBytes(NAME)), inner] });
  const result = encodeFunctionResult({ abi: ADDR_ABI, functionName: "addr", result: PAYER });
  const response = await signAnswer({ sender: SENDER, request, result, expires: EXPIRES, key: SCRATCH_KEY });
  return {
    what: "an answer signed by lib/ens/gateway.ts, verified by contracts/test/Fixture.t.sol; regenerate with npx tsx test/ens-fixture.ts --write",
    standard: "EIP-191 version 0x00 over 0x1900 || sender || expires || keccak(request) || keccak(result), as ensdomains/offchain-resolver 099b7e9",
    key: "anvil account #1, public",
    signer: privateKeyToAccount(SCRATCH_KEY).address,
    sender: SENDER,
    name: NAME,
    payer: PAYER,
    expires: Number(EXPIRES),
    request,
    result,
    response,
  };
}

if (process.argv.includes("--write")) {
  buildFixture().then(fixture => {
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`  wrote ${FIXTURE_PATH} signed by ${fixture.signer}`);
  });
}
