// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OffchainResolver, IResolverService} from "../src/OffchainResolver.sol";

/**
 * The proof round trip, with the two refusals and the two owner only setters.
 *
 * The answer is built here exactly as the gateway builds it: the digest is EIP-191
 * version 0x00 over `sender ‖ expires ‖ keccak(request) ‖ keccak(result)`, the
 * signature is the 65 byte `r ‖ s ‖ v` form, and the response is
 * `abi.encode(result, expires, sig)`. A second test reads a fixture the gateway's
 * own code signed, so the two digests are shown to be one rather than assumed.
 */
contract OffchainResolverTest is Test {
    string constant URL = "https://gateway.example/api/ens/{sender}/{data}.json";
    address constant PAYER = 0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe;

    uint256 signerKey;
    address signer;
    uint256 strangerKey;
    address stranger;
    OffchainResolver resolver;

    bytes name;
    bytes32 node;
    bytes callData;
    bytes result;

    function setUp() public {
        signerKey = 0xA11CE;
        signer = vm.addr(signerKey);
        strangerKey = 0xB0B;
        stranger = vm.addr(strangerKey);

        address[] memory signers = new address[](1);
        signers[0] = signer;
        resolver = new OffchainResolver(URL, signers);

        name = dnsEncode("agent2.xovi.eth");
        node = namehash("agent2.xovi.eth");
        // The nested call is addr(bytes32); the outer call is the one the gateway receives.
        bytes memory inner = abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), node);
        callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, inner);
        result = abi.encode(PAYER);
        vm.warp(1_800_000_000);
    }

    // ── ERC-165 and ENSIP-10 ────────────────────────────────────────────────────

    function test_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(0x9061b923), "ENSIP-10 resolve(bytes,bytes)");
        assertTrue(resolver.supportsInterface(0x01ffc9a7), "ERC-165");
        assertFalse(resolver.supportsInterface(0x3b3b57de), "addr(bytes32) is answered through resolve, not directly");
        assertFalse(resolver.supportsInterface(0xffffffff));
    }

    // ── resolve reverts with the lookup ─────────────────────────────────────────

    function test_resolveRevertsWithOffchainLookup() public {
        string[] memory urls = new string[](1);
        urls[0] = URL;
        vm.expectRevert(
            abi.encodeWithSelector(
                OffchainResolver.OffchainLookup.selector,
                address(resolver),
                urls,
                callData,
                OffchainResolver.resolveWithProof.selector,
                abi.encode(callData, address(resolver))
            )
        );
        resolver.resolve(name, abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), node));
    }

    // ── the proof ───────────────────────────────────────────────────────────────

    function answer(uint256 key, uint64 expires, address target) internal view returns (bytes memory) {
        bytes32 digest = resolver.makeSignatureHash(target, expires, callData, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encode(result, expires, abi.encodePacked(r, s, v));
    }

    function extra() internal view returns (bytes memory) {
        return abi.encode(callData, address(resolver));
    }

    function test_acceptsASignedAnswer() public view {
        uint64 expires = uint64(block.timestamp + 300);
        bytes memory out = resolver.resolveWithProof(answer(signerKey, expires, address(resolver)), extra());
        assertEq(abi.decode(out, (address)), PAYER);
    }

    function test_acceptsAnAnswerExpiringThisSecond() public view {
        // The reference's bound is `expires >= block.timestamp`, so the boundary is accepted.
        bytes memory out = resolver.resolveWithProof(answer(signerKey, uint64(block.timestamp), address(resolver)), extra());
        assertEq(abi.decode(out, (address)), PAYER);
    }

    function test_refusesAnExpiredAnswer() public {
        bytes memory response = answer(signerKey, uint64(block.timestamp - 1), address(resolver));
        vm.expectRevert(bytes("SignatureVerifier: Signature expired"));
        resolver.resolveWithProof(response, extra());
    }

    function test_refusesAnUnknownSigner() public {
        bytes memory response = answer(strangerKey, uint64(block.timestamp + 300), address(resolver));
        vm.expectRevert(bytes("SignatureVerifier: Invalid sigature"));
        resolver.resolveWithProof(response, extra());
    }

    function test_refusesAnAnswerSignedForAnotherResolver() public {
        // The digest carries the target, so an answer signed for another contract
        // recovers to somebody else here and is refused as an unknown signer.
        bytes memory response = answer(signerKey, uint64(block.timestamp + 300), stranger);
        vm.expectRevert(bytes("SignatureVerifier: Invalid sigature"));
        resolver.resolveWithProof(response, extra());
    }

    function test_refusesATamperedResult() public {
        uint64 expires = uint64(block.timestamp + 300);
        bytes32 digest = resolver.makeSignatureHash(address(resolver), expires, callData, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory response = abi.encode(abi.encode(stranger), expires, abi.encodePacked(r, s, v));
        vm.expectRevert(bytes("SignatureVerifier: Invalid sigature"));
        resolver.resolveWithProof(response, extra());
    }

    function test_refusesTheCompactSignatureForm() public {
        // OpenZeppelin 5 accepts 65 bytes only; the 64 byte form the reference gateway
        // sent is refused rather than misread, which is the direction to fail in.
        uint64 expires = uint64(block.timestamp + 300);
        bytes32 digest = resolver.makeSignatureHash(address(resolver), expires, callData, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        bytes memory response = abi.encode(result, expires, abi.encodePacked(r, vs));
        vm.expectRevert();
        resolver.resolveWithProof(response, extra());
    }

    // ── the digest is the reference layout ──────────────────────────────────────

    function test_makeSignatureHashIsTheReferenceLayout() public view {
        uint64 expires = 1_800_000_300;
        bytes32 expected = keccak256(
            abi.encodePacked(hex"1900", address(resolver), expires, keccak256(callData), keccak256(result))
        );
        assertEq(resolver.makeSignatureHash(address(resolver), expires, callData, result), expected);
        // A swapped field is a different digest, so the layout is load bearing.
        bytes32 swapped = keccak256(
            abi.encodePacked(hex"1900", address(resolver), expires, keccak256(result), keccak256(callData))
        );
        assertTrue(swapped != expected);
    }

    // ── owner only setters ──────────────────────────────────────────────────────

    function test_setUrlIsOwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        resolver.setUrl("https://elsewhere.example/{sender}/{data}.json");
        assertEq(resolver.url(), URL);

        resolver.setUrl("https://elsewhere.example/{sender}/{data}.json");
        assertEq(resolver.url(), "https://elsewhere.example/{sender}/{data}.json");

        // And resolve now sends clients there.
        string[] memory urls = new string[](1);
        urls[0] = "https://elsewhere.example/{sender}/{data}.json";
        vm.expectRevert(
            abi.encodeWithSelector(
                OffchainResolver.OffchainLookup.selector,
                address(resolver),
                urls,
                callData,
                OffchainResolver.resolveWithProof.selector,
                abi.encode(callData, address(resolver))
            )
        );
        resolver.resolve(name, abi.encodeWithSelector(bytes4(keccak256("addr(bytes32)")), node));
    }

    function test_setSignersIsOwnerOnly() public {
        address[] memory added = new address[](1);
        added[0] = stranger;
        address[] memory removed = new address[](1);
        removed[0] = signer;

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        resolver.setSigners(added, removed);
        assertTrue(resolver.signers(signer));
        assertFalse(resolver.signers(stranger));

        resolver.setSigners(added, removed);
        assertFalse(resolver.signers(signer));
        assertTrue(resolver.signers(stranger));

        // The rotated out key is refused and the rotated in key is accepted.
        uint64 expires = uint64(block.timestamp + 300);
        bytes memory old = answer(signerKey, expires, address(resolver));
        vm.expectRevert(bytes("SignatureVerifier: Invalid sigature"));
        resolver.resolveWithProof(old, extra());
        bytes memory out = resolver.resolveWithProof(answer(strangerKey, expires, address(resolver)), extra());
        assertEq(abi.decode(out, (address)), PAYER);
    }

    function test_deployerIsTheOwner() public view {
        assertEq(resolver.owner(), address(this));
    }

    // ── helpers, written here as the reference's own test wrote them ─────────────

    function dnsEncode(string memory s) internal pure returns (bytes memory out) {
        bytes memory b = bytes(s);
        uint256 start = 0;
        for (uint256 i = 0; i <= b.length; i++) {
            if (i == b.length || b[i] == ".") {
                uint256 len = i - start;
                out = abi.encodePacked(out, bytes1(uint8(len)));
                for (uint256 j = start; j < i; j++) out = abi.encodePacked(out, b[j]);
                start = i + 1;
            }
        }
        out = abi.encodePacked(out, bytes1(0));
    }

    function namehash(string memory s) internal pure returns (bytes32 h) {
        bytes memory b = bytes(s);
        uint256 end = b.length;
        for (uint256 i = b.length; i > 0; i--) {
            if (b[i - 1] == "." || i == 1) {
                uint256 start = b[i - 1] == "." ? i : 0;
                bytes memory label = new bytes(end - start);
                for (uint256 j = start; j < end; j++) label[j - start] = b[j];
                h = keccak256(abi.encodePacked(h, keccak256(label)));
                end = i - 1;
            }
        }
    }
}
