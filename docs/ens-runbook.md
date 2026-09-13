# Registering the name

The agent reads the endpoint it pays for out of a text record on a name, so that an operator can move the endpoint without shipping the agent again, and so that a reader can see what the agent is pointed at without being handed its configuration.

The name is **`xovi.eth`**. It is registered on Ethereum Sepolia and carries a resolver, `0xAe2084CB…`, measured through `bin/ens-verify.ts`, which reads three controls before it reads anything: two names that must resolve and an invented one that must not. The last is what shows a resolver belongs to the name asked rather than to an endpoint answering for everything. `x402:windows` resolves to `https://xovi-agents.vercel.app/api/agent/windows`, measured 2026-09-12 at exit 0.

**Every step is done, step 3 included.** The `http` value stood on the record for eighteen blocks on 2026-09-12, transaction `0xe2411b3dcb…` at block 11686365, and the verifier answered `REFUSED: the x402:windows record on xovi.eth must be https, got http` against the real name through the real adapter. Block 11686383 replaced it with the endpoint. **So the protocol guard is proven against a real record and is not owed.**

An earlier version of this paragraph said step 3 had been skipped, inferred from the record holding an `https` value with no `http` anywhere in state. A text record is **overwritten rather than appended**, so a completed step leaves nothing behind: *it is not there* and *it was never there* read identically, and only the resolver's event log separates them. Current state is not history.

The warning that outlived the wrong inference: an `http` record on a name the agent now reads would take the agent down for as long as it stood. That was true when step 3 was pending and it is still true. It is a reason to be careful about repeating step 3, not a reason to.

This is an ordinary Sepolia name with one text record, but there **is** a second version to evaluate and registering here lands on it. ENSv2 beta is live on Sepolia, and ENS documents the v1 contracts as still existing there but no longer in use, with the Universal Resolver and the Sepolia apps linked against v2. An earlier version of this document said there was no second version, and that sentence is what put a hardcoded v1 registry address in the verifier. Nothing in the agent changes: ENS states that an application which only reads ENS data needs no changes with a supported library, and the installed viem is 2.56.3 against a documented floor of 2.35.0.

## The order, and why it is not arbitrary

**`AGENT_ENS_NAME` is never set before the record it points at resolves.**

> **Corrected 2026-09-12: this said `is set last, after a verified read, and never before`.** *Last* was true of an ordering that has changed twice, and it contradicted the paragraph three lines below it in the same section. What survives both orderings is the dependency, not the position.

Setting it does not add a name alongside the configured url. It makes `WINDOWS_URL` **unused**, deliberately: a name that resolves to nothing is not permission to read from somewhere else, so the agent raises rather than falling back. That is the correct behaviour and it is why the order matters. Set the variable before the record resolves and the agent is not degraded, it is off.

So every step below is verified before the one after it, and the name is not set until the record it points at resolves. It is no longer the last thing that changes: step 6 sets `WINDOWS_URL` after step 7 has passed, for the recovery rather than for the read.

## Steps

**1. Register the name on Ethereum Sepolia, through `app.ens.dev`.** The app is named rather than left to the operator to find, because ENS's deployments page names that one and no other for Sepolia: the v1 Sepolia contracts *are no longer in use: the Universal Resolver and the ENS apps for Sepolia are linked against the ENSv2 deployment*. `sepolia.app.ens.domains` reaches the same v2 deployment, so this is the documented door rather than the only working one. The name is the operator's; nothing here holds a key that can register or change it.

**2. Set a resolver.** A name with an owner and no resolver answers `null` to every record lookup, which is indistinguishable from a name with no record.

**3. Set the record to an `http` url on purpose, and watch it be refused.** **On Sepolia only.** `xovi.eth` is registered on mainnet too, to the same owner, and the universal resolver sits at the same address on both chains. `lib/agent/ens.ts` reads whatever `AGENT_ENS_RPC_URL` points at and **checks no chain id**, unlike the verifier, so no `x402:windows` record should exist on the mainnet name while that is true: today both answer null and the agent fails closed, and the day a mainnet record exists a misconfigured rpc reads it and sends a bearer credential at whatever it names, silently and successfully. Tracked in #36.

```
AGENT_ENS_NAME=<the name> npm run ens:verify
```

Expect `REFUSED`, naming the protocol, and a non zero exit. This is the only cheap moment to prove that guard against the real name through the real adapter rather than against an injected value in the suite, and the wallet is already open. The guard exists because the record can be changed by anyone holding the name's write role, and the agent sends a bearer credential against whatever it names.

**4. Set the record to the real `https` endpoint** under the key `x402:windows`.

**5. Verify again, and read what it prints rather than its exit code alone.**

```
AGENT_ENS_NAME=<the name> npm run ens:verify
```

Expect the resolved url and a zero exit. The script runs the same function `bin/agent.ts` runs, with no injected lookup, so what passes here is what the agent will execute.

**6. Set `AGENT_ENS_NAME` in the environment where the agent is run.** Only now, and read the sequencing note in step 8 before you do.

> **Corrected 2026-09-12: this step said to set the variable in the deployment environment and redeploy.** Nothing under `app/` calls `resolveWindowsEndpoint`. It has three callers, `bin/agent.ts`, `bin/ens-verify.ts` and the checks, and the deployed route builds its windows url with `windowsUrlFor(request.url)`, from the incoming request and on its own origin. So the variable in the hosting environment is **read by nobody**, and setting it there would have produced a green deploy, an app still working for the reason it already worked, and a ticked criterion claiming a resolution that never happens. It belongs where `bin/agent.ts` runs.

**Run step 7 with `WINDOWS_URL` absent, then set it.** Those two want opposite things and the order is the whole point. With the url absent, a windows endpoint appearing in the output can only have come from the record, which is what makes step 7 evidence rather than a green light. Once it has passed, **set `WINDOWS_URL` in that same environment**, which is what makes step 8 a one variable fix instead of two and a different message.

> This is an instruction rather than *leave it set*, which is how it read until 2026-09-12 and which assumed somebody already had. Checked on the machine the agent runs on: `.env.local` carries `AGENT_PRIVATE_KEY`, `DATABASE_URL`, `HUMAN_ID_KEY`, `XOVI_INGEST_KEY` and `XOVI_INGEST_URL`, and **`WINDOWS_URL` zero times**. Nothing broke while these steps pointed at a hosting environment, because the precondition was true there and nobody was following them here. Re-pointing step 6 at the real process is what made step 8's recovery depend on a variable that does not exist, without a word of step 8 changing.

Setting it weakens nothing in between: once a name is configured the module resolves through the name or raises, and it never falls back to the url. **That is deliberate and it is not a safety net.** If the name stops resolving the agent stops, and `WINDOWS_URL` sitting there prevents none of that.

**7. Confirm the agent reads through the name**, not merely that it ran.

```
AGENT_ENS_NAME=<the name> npm run agent -- --dry-run --limit 1
```

With `WINDOWS_URL` unset, the windows url it prints came from `x402:windows` and from nothing else. That is the confirmation; a successful run with the url still configured confirms only that the agent works, which it did before.

**This step costs a read.** `--dry-run` gates the proposal, not the fetch, so the agent still calls `payingFetch`: it spends one free allowance if the payer is a registered person with allowance left, and settles USDC on Base Sepolia otherwise. **Run it once, when establishing that the agent consumes the record.** It does not need re-running before each recording, and step 5 is the one to repeat, because step 5 proves the resolution for nothing and the resolution is the part that goes stale.

**8. If the agent starts failing after step 7, this is what it looks like and this is the fix.**

**What you see.** The run fails with `EndpointUnresolvable` and this message: *`<name>` resolved to no `x402:windows` record: either the name is not registered on this chain, or it is registered and carries no such record.* That message is byte identical for a name that never existed and for a registered name carrying no record, which is why it names both and why it cannot tell you which.

**What to run.** `AGENT_ENS_NAME=<name> npx tsx bin/ens-verify.ts`. **`NO RESOLVER` on a name that resolved yesterday is the reset.** It is distinguishable from a name that never existed only by the fact that it used to work, so the evidence is your memory of step 7 passing rather than anything the tool can print.

**The fix.** Unset `AGENT_ENS_NAME` for the run. Blanking it works as well as deleting it, since the module trims the value and an empty one takes the url branch. The agent reads `WINDOWS_URL` again and recovers. One variable, and no deployment is involved: nothing that is deployed reads either of them.

**This works only while `WINDOWS_URL` is still set**, which is what step 6 is for. With both empty the failure changes to `neither AGENT_ENS_NAME nor WINDOWS_URL is set`, a different message than the one that sent you here, and the recovery becomes two variables rather than one.

It is written down because the agent is fail closed by design: a configured name that resolves to nothing raises rather than reading from somewhere else, so a name that disappears takes the agent with it rather than degrading it. The most likely cause is not an error in this repository. `app.ens.dev` carries this banner, read 2026-09-11: *"ENS v2 is in active development. Registered names on Sepolia and state data may be reset periodically due to routine contract deployments. The most recent deployment was on July 30, 2026."* The date is the actionable part: a warning with no sense of how recently the thing happened tells an operator nothing about how much to weigh it. It is quoted with its source and the date it was read because it is a banner in an application rather than a documented page, which is evidence an operator can act on and is **not** evidence a guard can be justified by. The justification for the fail-closed behaviour above is the exposure itself, not this notice.

It has happened at least once. ENS's Beta announcement says of the redeployed registry: *"This creates a clean testing environment for the updated architecture, which means names registered during earlier Alpha phases won't appear in the Beta registry"*, and that *"If you participated in previous App or Explorer testing, you should expect to start fresh in Beta"* (`ens.domains/blog/post/ensv2-beta-public-testing`, read 2026-09-12). So the banner describes something with a precedent rather than a possibility.

**Sequencing, and it points the other way now.** Set `AGENT_ENS_NAME` **for the recording**, not after it. The recording is the demonstration, so a video made with the endpoint supplied directly demonstrates an endpoint being supplied directly; what is worth showing is the agent taking it from the record.

> **Corrected 2026-09-12: this said `Set AGENT_ENS_NAME after the video is recorded and verified, never before`.** That was written when the variable was believed to live in a deployment, where *not wired yet* named a real state worth protecting. Once it became a per invocation variable there is no unwired state, so the justification did not merely become false, **its subject stopped existing**, and the sentence went on parsing and sounding prudent while being advice about nothing.

**Re-run step 5 immediately before recording, and again immediately before submitting.** One command, it costs nothing, and it is the only thing separating a working demonstration from a recording of one.

> **Corrected 2026-09-12: this said re-run step 7.** Step 7 spends a read each time, so that sentence commissioned two purchases to learn what step 5 answers for free. The reasoning for not doing that was already written a commit earlier, against running the agent here, and it did not transfer because the cost had moved from the writer to the reader. **A step that tells somebody to run something has to be priced as though you were about to run it yourself.**

**The residual is a judgement rather than a fix, and this step will not pretend otherwise.** A recording cannot break, so the exposure is no longer a dead demo. It is that a reset after recording leaves a video showing something the repository can no longer do. If the verifier fails at that point there are two moves: re-register the name and re-record, or submit with the video as it stands and the repository unable to reproduce it. Both are defensible and they cost different things, one is time that may not exist and the other is a claim a judge cannot check. **Nothing here decides that, and no step should imply a fix exists where a choice does.**

The exposure is not removed by any of this and nothing here claims it is. Judging continues after submission, so the window extends past anything an operator controls. What the ordering buys is that the failure is one variable deep, that the variable is named here, and that whoever meets it knows they are choosing rather than repairing.

## What the verifier tells you that the agent cannot

A text lookup answers `null` for a name that does not exist and for a registered name carrying no record, identically. The agent's own error names both causes and stops there, because distinguishing them costs a second call on every run to improve an error string, and its behaviour is already right: it fails closed.

The verifier spends that call. It reads the name's resolver, which viem looks up through the universal resolver rather than through any registry, so an operator who mistyped the name is told the name has no resolver at all rather than being sent to set a record on it. It stops there instead of saying which of the two it is, because separating them needs a registry address: the v1 one is the registry ENS says is no longer in use, and the v2 one keys on the labelhash with its low four bytes cleared, so reading it with the plain labelhash answers zero for names that are registered.

It reads the chain id from the endpoint before anything else and refuses if it is not Sepolia's, because the chain printed at the top was otherwise an echo of this tool's configuration rather than a reading of the network. Then it reads two control names, and refuses to interpret anything if either does not resolve. Without a control, an endpoint that is not answering about names produces the same `null` as a name with no record, and the first probe of this work returned exactly that for three names and its own control. Two rather than one, though not for the reason first written here: both controls go through the same universal resolver and the same v2 registries, so a dark v2 side fails both. They diverge at the leaf, `ens.eth` through the `ENSV1Resolver` bridge that serves v1 records and `chijesus99.eth` through its own v2 resolver, so the pair buys one positive per leaf path and the operator's name may be registered through either app.

## What each cause prints

Five have been seen. Four of them exit inside the verifier's own diagnostics and never reach `resolveWindowsEndpoint`, so what they prove is the script, not the module the agent runs. The fifth goes through that module with no injected lookup. The two still marked expected need a record to exist, and they are marked rather than dropped because an operator meets each at a known step and needs to know what that step should print.

| Cause | What it prints | Exit | Seen |
|---|---|---|---|
| no name configured | nothing to verify | 1 | observed, in the script |
| rpc not answering about names | the control did not resolve, naming its leaf path | 1 | observed, in the script |
| rpc on the wrong chain | both chain ids, the one answered and the one expected | 1 | observed, in the script |
| not registered, or registered with no resolver | NO RESOLVER, naming both causes | 1 | observed, in the script |
| registered with a resolver, no record | REFUSED, naming both causes | 1 | observed, through the module |
| record is not https | REFUSED, naming the protocol | 1 | expected, at step 3 |
| record resolves | the url, and that the variable may be set | 0 | expected, at step 5 |

The one that goes through the module was read against `ens.eth` and again against `chijesus99.eth`, a v2 name, so both versions have been driven into the module. A name that is registered and carries a resolver is what the probe needs, because anything short of that returns at the resolver check above and the module is never entered. It is the positive control again, used to drive a path rather than to validate a null.

## Switching the resolver

Written 2026-09-13, when the offchain resolver under `contracts/` landed. It changes what a name under `xovi.eth` is: a row in the `names` table becomes the issuance, answered by the gateway at `/api/ens/{sender}/{data}.json` and verified on chain by the resolver's signer set, with no transaction per name and no key on any server that owns `xovi.eth` or can move it. The gateway key signs answers and nothing else. **Nothing is deployed until the founder runs the script**, and the name's resolver stays the per account one until the founder switches it in the app.

**The order is the whole hazard, so it is stated once here and once more in the script's own output.** After the switch, `agent1.xovi.eth`, every other label and the parent's own `x402:windows` record resolve only through the gateway. So the deployment that serves the windows route is the same one that answers names, and a gateway that is not yet live at the moment of the switch takes every subname and the parent's record down at once. The switch is therefore the last step, after the public deployment answers a probe.

**1. Set the three gateway variables in the hosting environment and redeploy.** `ENS_PARENT_ADDRESS` and `ENS_TEXT_X402_WINDOWS` carry the values the parent answers today, documented in `.env.example` as read from the chain on 2026-09-12; `ENS_GATEWAY_SIGNER_KEY` is thirty two fresh bytes, generated for this and held nowhere else. Its address is the only thing about it that leaves the server, and it is the next step's input.

**2. Probe the deployed gateway before anything on chain changes.** The url is the reference template with the deployment's origin, and the cheapest request is the parent's own address, which needs no table. The calldata is `resolve(bytes,bytes)` over the DNS encoded name and the inner `addr(bytes32)`; `cast` builds it:

```
INNER=$(cast calldata "addr(bytes32)" $(cast namehash xovi.eth))
DATA=$(cast calldata "resolve(bytes,bytes)" 0x04786f76690365746800 $INNER)
curl -s "https://xovi-agents.vercel.app/api/ens/0x0000000000000000000000000000000000000000/$DATA.json"
```

`0x04786f76690365746800` is `xovi.eth` DNS encoded, one length byte before each label and a zero at the end. Expect `{"data":"0x…"}` and a 200. A `503` naming `ENS_PARENT_ADDRESS`, `ENS_TEXT_X402_WINDOWS` or the signing key is step 1 unfinished. The suite drives the same route with the same calldata in process; what the curl adds is the deployment, which is the thing the switch depends on.

**3. Deploy the resolver, dry first.** On the founder's machine, with the deployer key in a file and never in the environment:

```
ENS_RESOLVER_DEPLOYER_KEY_FILE=/absolute/path/to/deployer.key \
ENS_GATEWAY_URL='https://xovi-agents.vercel.app/api/ens/{sender}/{data}.json' \
ENS_GATEWAY_SIGNER_ADDRESS=<the address of the key set in step 1> \
forge script script/Deploy.s.sol --root contracts --rpc-url <a Sepolia rpc>
```

It prints the chain, the deployer, the url and the signer, simulates, and sends nothing. Add `--broadcast` to send. It refuses any chain but 11155111, an `http` url, a template without both parameters, and a key pasted into `ENS_RESOLVER_DEPLOYER_KEY`. The deployer becomes the contract's owner, the one address that can later move the url or rotate the signer; it need not be, and should not be, the key that owns `xovi.eth`.

**4. Switch, once, in `app.ens.dev`.** Set `xovi.eth`'s resolver to the address the script printed. This is the owner's transaction and the only one the switch needs. From this block on, the per account resolver's records, `agent1`'s address and the parent's `x402:windows` among them, are no longer read by anyone; the gateway answers them from `SEEDED`, the table and the two variables.

**5. Verify through the agent's own path.** `AGENT_ENS_NAME=xovi.eth npm run ens:verify` reads `x402:windows` through the universal resolver, which now follows the `OffchainLookup` to the gateway and verifies the signature on chain. Expect the same url as before the switch and a zero exit. Then `AGENT_IDENTITY_NAME=agent1.xovi.eth` on the same tool: expect the recording wallet, from the seed.

**If it goes wrong.** The one variable recovery is the ENS app: set the resolver back to `0xAe2084CB…`, whose records were never touched, and every name reads as it did before. Nothing in the table is lost by that; the rows wait for the next switch.

**Rotating the signer.** A new `ENS_GATEWAY_SIGNER_KEY` in the hosting environment, then one owner transaction on the resolver, `setSigners([new], [old])`. Answers signed by the old key stop verifying at that block, so redeploy first and rotate second, or the gateway signs with a key the contract has not yet admitted.
