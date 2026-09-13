# The offchain resolver for `xovi.eth`

A resolver that answers no record itself. Every lookup under `xovi.eth` reverts with an `OffchainLookup` naming the gateway in the Next.js app, the client fetches the answer there, and the contract verifies the gateway's signature and expiry before handing the answer back. A name requested on the page resolves without a transaction per name, and no key on any server owns `xovi.eth` or can move it: the gateway key signs answers and nothing else.

**Nothing here is deployed.** The contract exists on no chain until the founder runs the script below, and `xovi.eth` keeps its per account resolver until the founder switches it, once, in the ENS app.

## Standards and the reference

| What | Where it is followed |
|---|---|
| ENSIP-10, wildcard resolution | `resolve(bytes name, bytes data)`, the name DNS encoded, interface id `0x9061b923` |
| EIP-3668, CCIP Read | the `OffchainLookup(sender, urls, callData, callbackFunction, extraData)` revert; the `{sender}/{data}.json` url template; the gateway's `{ "data": "0x…" }` answer and `{ "message": "…" }` refusal |
| EIP-191, version `0x00` | the gateway signs `keccak256(0x19 0x00 ‖ target ‖ expires ‖ keccak(request) ‖ keccak(result))` as a raw digest; `target` is the resolver |
| ERC-165 | `supportsInterface` for ENSIP-10 and for itself |
| the ENS reference | [`ensdomains/offchain-resolver`](https://github.com/ensdomains/offchain-resolver) at commit `099b7e9827899efcf064e71b7125f7b4fc2e342f`: `OffchainResolver.sol`, `SignatureVerifier.sol` and the gateway's `makeSignatureHash` layout |

`src/SignatureVerifier.sol` is the reference's file with a header added and nothing else changed. `src/OffchainResolver.sol` is the reference with three deviations, each marked in the source where it happens: `IExtendedResolver` comes from ens-contracts v1.7.0, where ENS moved it; ERC-165 comes from OpenZeppelin, because the `SupportsInterface` the reference imported no longer exists in ens-contracts; and two owner only setters, `setUrl` and `setSigners`, so the gateway can move and the key can rotate without redeploying. The reference sets both once in its constructor.

One wire detail worth knowing before reading either side: the reference's gateway sent the 64 byte compact signature form, which OpenZeppelin 4 accepted. This contract verifies with OpenZeppelin 5, which accepts the 65 byte `r ‖ s ‖ v` form only, so the gateway here signs 65 bytes and a test holds that the compact form is refused rather than misread.

## Dependencies

Three git submodules under `lib/`, pinned by commit in `foundry.lock`: forge-std v1.16.2, OpenZeppelin Contracts v5.7.0, ens-contracts v1.7.0. `git submodule update --init --recursive` after a fresh clone; CI checks them out the same way. The remappings in `foundry.toml` keep the reference's import paths byte for byte.

## Tests

```
forge test --root contracts
```

Fifteen tests. The round trip: a signed answer accepted, an answer expiring this second accepted, an expired one refused, an unknown signer refused, an answer signed for another resolver refused, a tampered result refused, the compact form refused. The digest: `makeSignatureHash` is the reference layout and a swapped field is a different value. The setters: `setUrl` and `setSigners` owner only, a rotated out key refused and a rotated in key accepted. The script: every guard, in one sequential test. And one fixture: `test/fixtures/gateway-answer.json` is an answer signed by the app's `lib/ens/gateway.ts`, regenerated with `npm run ens:fixture`, and the contract recovers its signer on chain, so the TypeScript digest and the Solidity digest are shown to be one value rather than assumed to be.

Each refusal test has been seen red: with the signer set unchecked, three refusals and the rotation test failed; with the expiry bound moved by one second, the expired test failed; with the digest's fields swapped, the layout test failed; with `setUrl` opened to anyone, its test failed.

## What the founder does, later, in this order

The order is the hazard: after the switch, every subname and the parent's `x402:windows` record resolve only through the gateway, so the deployment that serves the windows route is the same one that answers names, and a switch made before the gateway is live takes all of them down at once. `docs/ens-runbook.md`, section *Switching the resolver*, carries the same steps with the probe command.

1. **Set the three gateway variables in the hosting environment and redeploy.** `ENS_PARENT_ADDRESS`, `ENS_TEXT_X402_WINDOWS` and a fresh `ENS_GATEWAY_SIGNER_KEY`, described in `.env.example`. The signing key's address is the only thing about it that leaves the server.
2. **Probe the deployed gateway** with one GET for the parent's own address, and see `{"data":"0x…"}`.
3. **Deploy, dry first, from the founder's machine:**

   ```
   ENS_RESOLVER_DEPLOYER_KEY_FILE=/absolute/path/to/deployer.key \
   ENS_GATEWAY_URL='https://xovi-agents.vercel.app/api/ens/{sender}/{data}.json' \
   ENS_GATEWAY_SIGNER_ADDRESS=<the address of the key from step 1> \
   forge script script/Deploy.s.sol --root contracts --rpc-url <a Sepolia rpc>
   ```

   Without `--broadcast` the script simulates and sends nothing; it prints the chain, the deployer, the url and the signer first. It refuses any chain but 11155111, an `http` url, a template missing `{sender}` or `{data}`, the zero signer, and a key pasted into `ENS_RESOLVER_DEPLOYER_KEY` rather than named by file. The deployer key becomes the contract's owner; it should not be the key that owns `xovi.eth`, whose only job here is step 4.
4. **Switch, once, in `app.ens.dev`:** set `xovi.eth`'s resolver to the address the script printed.
5. **Verify through the agent's own path:** `AGENT_ENS_NAME=xovi.eth npm run ens:verify`, and `AGENT_IDENTITY_NAME=agent1.xovi.eth` on the same tool.

To undo: set the resolver back to `0xAe2084CBAB44C16F38f3E6656Ec20c959521813D` in the app. Its records were never touched.

## What a row means after the switch

A row in the app's `names` table is the issuance. The request route admits only wallets with a person behind them, so the gate is at the request; the gateway answers every row's payer for its label from the moment the row exists; `issued_at` is the time the row was written and there is no separate approval mark. `bin/issue-names.ts` stays as the pre switch on chain path and says so.
