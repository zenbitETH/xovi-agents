# Registering the agent's name

The agent reads the endpoint it pays for out of a text record on a name, so that an operator can move the endpoint without shipping the agent again, and so that a reader can see what the agent is pointed at without being handed its configuration.

The name is **`xovi.eth`**. It is registered on Ethereum Sepolia and carries a resolver, `0xAe2084CB…`, measured 2026-09-11 through `bin/ens-verify.ts` with both controls resolving and with an invented name as a negative control, which answers a zero resolver on the same run and so shows the reading is the name's own rather than a wildcard. `x402:windows` is null, so **steps 1 and 2 are done and the next action is step 3**.

This is an ordinary Sepolia name with one text record, but there **is** a second version to evaluate and registering here lands on it. ENSv2 beta is live on Sepolia, and ENS documents the v1 contracts as still existing there but no longer in use, with the Universal Resolver and the Sepolia apps linked against v2. An earlier version of this document said there was no second version, and that sentence is what put a hardcoded v1 registry address in the verifier. Nothing in the agent changes: ENS states that an application which only reads ENS data needs no changes with a supported library, and the installed viem is 2.56.3 against a documented floor of 2.35.0.

## The order, and why it is not arbitrary

**`AGENT_ENS_NAME` is set last, after a verified read, and never before.**

Setting it does not add a name alongside the configured url. It makes `WINDOWS_URL` **unused**, deliberately: a name that resolves to nothing is not permission to read from somewhere else, so the agent raises rather than falling back. That is the correct behaviour and it is why the order matters. Set the variable before the record resolves and the agent is not degraded, it is off.

So every step below is verified before the one after it, and the variable is the last thing that changes.

## Steps

**1. Register the name on Ethereum Sepolia, through `app.ens.dev`.** The app is named rather than left to the operator, because the obvious search lands on `sepolia.app.ens.domains`, which is the **v1** app: ENS's deployments page says the v1 Sepolia contracts *are no longer in use: the Universal Resolver and the ENS apps for Sepolia are linked against the ENSv2 deployment*, and names the ENS App at `app.ens.dev` as the way to interact with it. Registering through the other door puts the name on the registry this repository's verifier was rewritten to stop reading. The name is the operator's; nothing here holds a key that can register or change it.

**2. Set a resolver.** A name with an owner and no resolver answers `null` to every record lookup, which is indistinguishable from a name with no record.

**3. Set the record to an `http` url on purpose, and watch it be refused.**

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

**6. Set `AGENT_ENS_NAME` in the deployment environment and redeploy.** Only now, and read the sequencing note in step 8 before you do. **Leave `WINDOWS_URL` set.** It will not be read: once a name is configured the module resolves through the name or raises, and it never falls back to the url. **That is deliberate and it is not a safety net.** If the name stops resolving the agent stops, and leaving `WINDOWS_URL` in place prevents none of that. What it does is make the recovery in step 8 a one variable change rather than two.

**7. Confirm the deployed agent reads through the name**, not merely that the deployment succeeded.

**8. If the deployed agent starts failing after step 7, this is what it looks like and this is the fix.**

**What you see.** The run fails with `EndpointUnresolvable` and this message: *`<name>` resolved to no `x402:windows` record: either the name is not registered on this chain, or it is registered and carries no such record.* That message is byte identical for a name that never existed and for a registered name carrying no record, which is why it names both and why it cannot tell you which.

**What to run.** `AGENT_ENS_NAME=<name> npx tsx bin/ens-verify.ts`. **`NO RESOLVER` on a name that resolved yesterday is the reset.** It is distinguishable from a name that never existed only by the fact that it used to work, so the evidence is your memory of step 7 passing rather than anything the tool can print.

**The fix.** Unset `AGENT_ENS_NAME` and redeploy. Blanking it works as well as deleting it, since the module trims the value and an empty one takes the url branch. The agent reads `WINDOWS_URL` again and the run recovers. One variable.

**This works only while `WINDOWS_URL` is still set**, which is what step 6 is for. With both empty the failure changes to `neither AGENT_ENS_NAME nor WINDOWS_URL is set`, a different message than the one that sent you here, and the recovery becomes two variables rather than one.

It is written down because the agent is fail closed by design: a configured name that resolves to nothing raises rather than reading from somewhere else, so a name that disappears takes the agent with it rather than degrading it. The most likely cause is not an error in this repository. `app.ens.dev` carries this banner, read 2026-09-11: *"ENS v2 is in active development. Registered names on Sepolia and state data may be reset periodically due to routine contract deployments."* It is quoted with its source and the date it was read because it is a banner in an application rather than a documented page, which is evidence an operator can act on and is **not** evidence a guard can be justified by. The justification for the fail-closed behaviour above is the exposure itself, not this notice.

**Sequencing, which is the cheap half of this.** Set `AGENT_ENS_NAME` after the video is recorded and verified, never before. The recording is the artefact that cannot be redone in an hour, while the deployed endpoint is repaired with one variable. A reset before recording then costs nothing, because the name is not wired yet, and a reset after costs a redeploy.

It does not remove the exposure and nothing here claims it does. Judging continues after submission, so the window extends past anything an operator controls. What the sequencing buys is that the failure is one variable deep and that the variable is named here, which is the difference between a recoverable outage and a dead demo nobody can explain.

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
