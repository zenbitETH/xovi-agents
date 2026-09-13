// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {OffchainResolver} from "../src/OffchainResolver.sol";

/**
 * The deploy script's guards, driven in process.
 *
 * ONE TEST FUNCTION, ON PURPOSE. `setEnv` writes the process environment, and forge
 * runs test functions in parallel, so seven functions each setting the same
 * variables raced: the happy path read the key another scenario had planted in the
 * environment and refused. Sequential scenarios in one function cannot.
 *
 * The scratch key is the first account anvil prints on every start, public by
 * design and worth nothing.
 */
contract DeployTest is Test {
    string constant KEY_FILE = "test/tmp/deployer.key";
    string constant SCRATCH_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    address constant SCRATCH_ADDRESS = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant SIGNER = 0x1111111111111111111111111111111111111111;
    string constant URL = "https://xovi-agents.vercel.app/api/ens/{sender}/{data}.json";

    function configure(string memory key) internal {
        vm.createDir("test/tmp", true);
        vm.writeFile(KEY_FILE, string.concat(key, "\n"));
        vm.setEnv("ENS_RESOLVER_DEPLOYER_KEY_FILE", KEY_FILE);
        vm.setEnv("ENS_RESOLVER_DEPLOYER_KEY", "");
        vm.setEnv("ENS_GATEWAY_URL", URL);
        vm.setEnv("ENS_GATEWAY_SIGNER_ADDRESS", vm.toString(SIGNER));
        vm.chainId(11155111);
    }

    function test_theScriptInEveryScenario() public {
        Deploy script = new Deploy();

        // The happy path: Sepolia, the key from the file, the file's key is the owner.
        configure(SCRATCH_KEY);
        OffchainResolver resolver = script.run();
        assertEq(resolver.url(), URL);
        assertTrue(resolver.signers(SIGNER));
        assertEq(resolver.owner(), SCRATCH_ADDRESS, "the key in the file is the deployer and the owner");

        // Without the 0x prefix too.
        configure("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
        assertEq(script.run().owner(), SCRATCH_ADDRESS);

        // Every other chain is refused, before the key file is even read.
        configure(SCRATCH_KEY);
        vm.setEnv("ENS_RESOLVER_DEPLOYER_KEY_FILE", "test/tmp/does-not-exist.key");
        vm.chainId(1);
        vm.expectRevert(bytes("Deploy: chain 11155111 only"));
        script.run();
        vm.chainId(84532);
        vm.expectRevert(bytes("Deploy: chain 11155111 only"));
        script.run();

        // The key pasted into the environment is refused outright.
        configure(SCRATCH_KEY);
        vm.setEnv("ENS_RESOLVER_DEPLOYER_KEY", SCRATCH_KEY);
        vm.expectRevert(
            bytes("Deploy: the key itself is in the environment; name a file in ENS_RESOLVER_DEPLOYER_KEY_FILE instead")
        );
        script.run();

        // A malformed key file names its shape and nothing else.
        configure("0xabc");
        vm.expectRevert(bytes("Deploy: the key file does not hold 32 bytes of hex"));
        script.run();
        configure("0xzz0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
        vm.expectRevert(bytes("Deploy: the key file is not hex"));
        script.run();

        // The url must be https and must carry both template parameters.
        configure(SCRATCH_KEY);
        vm.setEnv("ENS_GATEWAY_URL", "http://xovi-agents.vercel.app/api/ens/{sender}/{data}.json");
        vm.expectRevert(bytes("Deploy: ENS_GATEWAY_URL must be https"));
        script.run();
        vm.setEnv("ENS_GATEWAY_URL", "https://xovi-agents.vercel.app/api/ens/");
        vm.expectRevert(bytes("Deploy: ENS_GATEWAY_URL must carry {sender} and {data}"));
        script.run();

        // The zero signer would deploy a resolver nobody can answer for.
        configure(SCRATCH_KEY);
        vm.setEnv("ENS_GATEWAY_SIGNER_ADDRESS", vm.toString(address(0)));
        vm.expectRevert(bytes("Deploy: ENS_GATEWAY_SIGNER_ADDRESS is the zero address"));
        script.run();

        // And after every refusal the happy path still deploys (negative control).
        configure(SCRATCH_KEY);
        assertEq(script.run().owner(), SCRATCH_ADDRESS);
    }
}
