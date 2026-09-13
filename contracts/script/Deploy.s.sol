// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {OffchainResolver} from "../src/OffchainResolver.sol";

/**
 * Deploys the offchain resolver for `xovi.eth` on Ethereum Sepolia and nowhere else.
 *
 *   ENS_RESOLVER_DEPLOYER_KEY_FILE=/absolute/path/to/deployer.key \
 *   ENS_GATEWAY_URL='https://<host>/api/ens/{sender}/{data}.json' \
 *   ENS_GATEWAY_SIGNER_ADDRESS=0x... \
 *   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC [--broadcast]
 *
 * DRY BY DEFAULT. Without `--broadcast` forge simulates the deployment and prints what
 * it would do, and nothing leaves the machine. The script says which mode it is in.
 *
 * THE KEY COMES FROM A FILE, NOT FROM THE ENVIRONMENT, and the file is named rather
 * than its contents pasted. A key in an environment variable travels into every child
 * process, into `ps` on a shared machine, and into whatever a crash reporter collects.
 * The path is the argument; the bytes are read once and never logged. A key found in
 * `ENS_RESOLVER_DEPLOYER_KEY` is refused outright, so the wrong habit fails rather
 * than working.
 *
 * WHICH KEY. The deployer becomes the contract's owner, the one address that can move
 * the gateway url or rotate the signer. It does not need to be, and should not be,
 * the key that owns `xovi.eth`: the name's owner sets the resolver once in the ENS
 * app, and after that the two keys have different jobs. Neither is the gateway's
 * signing key, which lives in the hosting environment and signs answers only.
 *
 * THE CHAIN GUARD refuses anything but 11155111. A script that writes to whatever
 * chain the rpc points at is how a contract lands on a mainnet nobody chose.
 */
contract Deploy is Script {
    uint256 internal constant SEPOLIA = 11155111;

    function run() external returns (OffchainResolver resolver) {
        require(block.chainid == SEPOLIA, "Deploy: chain 11155111 only");
        require(
            bytes(vm.envOr("ENS_RESOLVER_DEPLOYER_KEY", string(""))).length == 0,
            "Deploy: the key itself is in the environment; name a file in ENS_RESOLVER_DEPLOYER_KEY_FILE instead"
        );

        string memory url = vm.envString("ENS_GATEWAY_URL");
        address signer = vm.envAddress("ENS_GATEWAY_SIGNER_ADDRESS");
        require(signer != address(0), "Deploy: ENS_GATEWAY_SIGNER_ADDRESS is the zero address");
        require(startsWith(url, "https://"), "Deploy: ENS_GATEWAY_URL must be https");
        require(contains(url, "{sender}") && contains(url, "{data}"), "Deploy: ENS_GATEWAY_URL must carry {sender} and {data}");

        uint256 key = keyFromFile(vm.envString("ENS_RESOLVER_DEPLOYER_KEY_FILE"));
        address deployer = vm.addr(key);

        bool broadcasting = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast);
        console2.log(broadcasting ? "mode      BROADCAST" : "mode      dry run (pass --broadcast to send)");
        console2.log("chain    ", block.chainid);
        console2.log("deployer ", deployer);
        console2.log("url      ", url);
        console2.log("signer   ", signer);

        address[] memory signers = new address[](1);
        signers[0] = signer;

        vm.startBroadcast(key);
        resolver = new OffchainResolver(url, signers);
        vm.stopBroadcast();

        console2.log("resolver ", address(resolver));
        console2.log("");
        console2.log("Next, and only after the public deployment answers at the url above:");
        console2.log("set xovi.eth's resolver to this address in app.ens.dev. Before that switch");
        console2.log("every subname and the parent's x402:windows record would stop resolving at once.");
    }

    /// The file holds one hex key, with or without 0x, with or without a trailing newline.
    /// The value is never printed; a malformed file names its length and nothing else.
    function keyFromFile(string memory path) internal view returns (uint256) {
        bytes memory raw = bytes(vm.readFile(path));
        uint256 end = raw.length;
        while (end > 0 && (raw[end - 1] == "\n" || raw[end - 1] == "\r" || raw[end - 1] == " ")) end--;
        uint256 start = 0;
        if (end >= 2 && raw[0] == "0" && (raw[1] == "x" || raw[1] == "X")) start = 2;
        require(end - start == 64, "Deploy: the key file does not hold 32 bytes of hex");
        uint256 key = 0;
        for (uint256 i = start; i < end; i++) {
            key = (key << 4) | nibble(raw[i]);
        }
        require(key != 0, "Deploy: the key file holds zero");
        return key;
    }

    function nibble(bytes1 c) internal pure returns (uint256) {
        if (c >= "0" && c <= "9") return uint8(c) - 48;
        if (c >= "a" && c <= "f") return uint8(c) - 87;
        if (c >= "A" && c <= "F") return uint8(c) - 55;
        revert("Deploy: the key file is not hex");
    }

    function startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory p = bytes(prefix);
        if (a.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (a[i] != p[i]) return false;
        }
        return true;
    }

    function contains(string memory s, string memory needle) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory n = bytes(needle);
        if (n.length == 0 || a.length < n.length) return false;
        for (uint256 i = 0; i + n.length <= a.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (a[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
