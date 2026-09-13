// SPDX-License-Identifier: MIT

// Taken verbatim from the ENS reference, ensdomains/offchain-resolver at commit
// 099b7e9827899efcf064e71b7125f7b4fc2e342f, packages/contracts/contracts/SignatureVerifier.sol.
// The only change is this header. The hash layout is the one the gateway signs:
// EIP-191 version 0x00, `0x19 0x00 ‖ target ‖ expires ‖ keccak(request) ‖ keccak(result)`,
// with `target` the resolver the answer is for.
//
// ECDSA is OpenZeppelin Contracts v5.7.0, where `recover(bytes32, bytes)` accepts the
// 65 byte `r ‖ s ‖ v` form and nothing else. The reference gateway sent the 64 byte
// compact form against OpenZeppelin 4, which also accepted it; the gateway here signs
// 65 bytes, and a 64 byte answer is refused by this library rather than misread.

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

library SignatureVerifier {
    /**
     * @dev Generates a hash for signing/verifying.
     * @param target: The address the signature is for.
     * @param request: The original request that was sent.
     * @param result: The `result` field of the response (not including the signature part).
     */
    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result) internal pure returns(bytes32) {
        return keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)));
    }

    /**
     * @dev Verifies a signed message returned from a callback.
     * @param request: The original request that was sent.
     * @param response: An ABI encoded tuple of `(bytes result, uint64 expires, bytes sig)`, where `result` is the data to return
     *        to the caller, and `sig` is the (r,s,v) encoded message signature.
     * @return signer: The address that signed this message.
     * @return result: The `result` decoded from `response`.
     */
    function verify(bytes calldata request, bytes calldata response) internal view returns(address, bytes memory) {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        (bytes memory extraData, address sender) = abi.decode(request, (bytes, address));
        address signer = ECDSA.recover(makeSignatureHash(sender, expires, extraData, result), sig);
        require(
            expires >= block.timestamp,
            "SignatureVerifier: Signature expired");
        return (signer, result);
    }
}
