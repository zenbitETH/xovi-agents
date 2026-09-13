// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

// After the ENS reference, ensdomains/offchain-resolver at commit
// 099b7e9827899efcf064e71b7125f7b4fc2e342f, packages/contracts/contracts/OffchainResolver.sol.
// Standards: ENSIP-10 (wildcard resolution, `resolve(bytes,bytes)`), EIP-3668 (CCIP Read,
// the `OffchainLookup` revert and the `{sender}/{data}.json` url template), EIP-191
// version 0x00 for the gateway's signature, ERC-165.
//
// Three deviations from the reference, each marked where it happens:
//
//  1. `IExtendedResolver` is imported from ens-contracts v1.7.0, where ENS moved it, rather
//     than from a local copy. The interface is the same nine lines.
//  2. `SupportsInterface` from ens-contracts 0.0.8 no longer exists in the package. OpenZeppelin's
//     `ERC165` answers the same question the same way, and the reference's `super` chain is kept.
//  3. `setUrl` and `setSigners`, owner only, so the gateway can move and the signing key can
//     rotate without redeploying and pointing the name at a new address. The reference has
//     neither; `url` and `signers` are set once in its constructor. `Ownable` is OpenZeppelin's.
//
// Everything else is the reference: the storage, the events, the `OffchainLookup` layout,
// `makeSignatureHash`, `resolve`, `resolveWithProof` and its revert strings.

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@ensdomains/ens-contracts/contracts/resolvers/profiles/IExtendedResolver.sol";
import "./SignatureVerifier.sol";

interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data) external view returns(bytes memory result, uint64 expires, bytes memory sig);
}

/**
 * Implements an ENS resolver that directs all queries to a CCIP read gateway.
 * Callers must implement EIP 3668 and ENSIP 10.
 */
contract OffchainResolver is IExtendedResolver, ERC165, Ownable {
    string public url;
    mapping(address=>bool) public signers;

    event NewSigners(address[] signers);
    // Deviation 3: the two setters emit these. `NewSigners` is the reference's own event.
    event RemovedSigners(address[] signers);
    event NewUrl(string url);
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    // Deviation 3: the deployer owns the contract. Nothing else about the constructor changed.
    constructor(string memory _url, address[] memory _signers) Ownable(msg.sender) {
        url = _url;
        for(uint i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewSigners(_signers);
    }

    // Deviation 3. The url is where every client is sent, so only the owner moves it.
    function setUrl(string calldata _url) external onlyOwner {
        url = _url;
        emit NewUrl(_url);
    }

    // Deviation 3. Added first, removed second, so one call rotates a key.
    function setSigners(address[] calldata added, address[] calldata removed) external onlyOwner {
        for(uint i = 0; i < added.length; i++) {
            signers[added[i]] = true;
        }
        for(uint i = 0; i < removed.length; i++) {
            signers[removed[i]] = false;
        }
        if (added.length > 0) emit NewSigners(added);
        if (removed.length > 0) emit RemovedSigners(removed);
    }

    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result) external pure returns(bytes32) {
        return SignatureVerifier.makeSignatureHash(target, expires, request, result);
    }

    /**
     * Resolves a name, as specified by ENSIP 10.
     * @param name The DNS-encoded name to resolve.
     * @param data The ABI encoded data for the underlying resolution function (Eg, addr(bytes32), text(bytes32,string), etc).
     * @return The return data, ABI encoded identically to the underlying function.
     */
    function resolve(bytes calldata name, bytes calldata data) external override view returns(bytes memory) {
        bytes memory callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            OffchainResolver.resolveWithProof.selector,
            abi.encode(callData, address(this))
        );
    }

    /**
     * Callback used by CCIP read compatible clients to verify and parse the response.
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData) external view returns(bytes memory) {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);
        require(
            signers[signer],
            "SignatureVerifier: Invalid sigature");
        return result;
    }

    // Deviation 2: `view` rather than the reference's `pure`, because ERC165's own is `view` and
    // the reference's `super` call is kept. The answers are the same for every caller.
    function supportsInterface(bytes4 interfaceID) public view override returns(bool) {
        return interfaceID == type(IExtendedResolver).interfaceId || super.supportsInterface(interfaceID);
    }
}
