// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {OffchainResolver} from "../src/OffchainResolver.sol";

/**
 * An answer the gateway's TypeScript signed, verified by the contract.
 *
 * Every other test here signs with `vm.sign` against the contract's own
 * `makeSignatureHash`, which proves the contract agrees with itself. This one reads
 * `test/fixtures/gateway-answer.json`, written by `test/ens-fixture.ts` in the app,
 * and recovers its signature on chain: if the TypeScript digest differed from the
 * Solidity one by a byte, the signer would recover to a stranger and the resolver
 * would refuse. The two digests are one, or this is red.
 */
contract FixtureTest is Test {
    string constant URL = "https://gateway.example/api/ens/{sender}/{data}.json";

    function test_theGatewaySignedAnswerVerifies() public {
        string memory json = vm.readFile("test/fixtures/gateway-answer.json");
        address sender = vm.parseJsonAddress(json, ".sender");
        address signer = vm.parseJsonAddress(json, ".signer");
        address payer = vm.parseJsonAddress(json, ".payer");
        uint256 expires = vm.parseJsonUint(json, ".expires");
        bytes memory request = vm.parseJsonBytes(json, ".request");
        bytes memory response = vm.parseJsonBytes(json, ".response");

        address[] memory signers = new address[](1);
        signers[0] = signer;
        OffchainResolver resolver = new OffchainResolver(URL, signers);

        vm.warp(expires - 1);
        bytes memory out = resolver.resolveWithProof(response, abi.encode(request, sender));
        assertEq(abi.decode(out, (address)), payer, "the gateway's answer decodes to the payer it signed");

        // Controls: the same bytes past their expiry, and the same bytes for another
        // target, are both refused, so the pass above is the signature and not luck.
        vm.warp(expires + 1);
        vm.expectRevert(bytes("SignatureVerifier: Signature expired"));
        resolver.resolveWithProof(response, abi.encode(request, sender));

        vm.warp(expires - 1);
        vm.expectRevert(bytes("SignatureVerifier: Invalid sigature"));
        resolver.resolveWithProof(response, abi.encode(request, address(0x2222222222222222222222222222222222222222)));
    }
}
