# Booth runbook, InnovaFest Guadalajara 2026

For the stand on Friday 23 October 2026, set up on Thursday 22 October. Written 2026-10-07 and corrected as steps are measured. Every sentence either restates something this repository holds or is a negative, and a step that has not been run says so.

Nothing here writes to a mainnet and nothing handles real funds. Every screen at the stand that shows an identity check, a payment or a chain says **red de prueba**.

## 1. What the stand may show

These are conditions, and each has the check that holds it. A row that cannot be checked on the day is not shown.

| # | Condition | Check |
|---|---|---|
| 1 | The loop runs public code at a published commit, with no private source on screen | The commit hash is written on the stand card before the doors open and equals `git rev-parse HEAD` on the laptop; the terminal and the editor are closed, and only the browser page is on screen |
| 2 | Everything is a test network and says so | Each screen that shows a payment, an attestation or an identity check carries **red de prueba**; the World ID view is labelled the same way |
| 3 | Only the founder confirms clips | The run stops at the proposal; the confirmation screen is opened only by the founder's own session, and a visitor is never handed the keyboard or a wallet prompt |
| 4 | Visitors watch and never sign or confirm | No wallet prompt is left open on the stand's browser, and the stand wallet's key stays in a file on the founder's machine |
| 5 | The screen shows only what the public page shows | No detector internals, no values a model produces about a recording beyond what the page prints, and no signal named after how an animal looks |
| 6 | No specimen is named and no status is stated | The board shows a station and a species, and an alias only when it is not embargoed; a window dropped for an embargo is not counted |
| 7 | The loop has no capability beyond this repository | The credential in use can create a proposal and nothing else, and `git status` on the laptop is clean at the published commit |
| 8 | The stand works with no network | `npm run local` completes a full loop with Wi-Fi off, against the fake facilitator and the fake ingest it ships with; it exercises neither a name lookup nor a settlement on a chain |

The production environment checklist is **not** applied before the event. The real loop runs from the founder's laptop with its own `.env.local`, after `git pull` (the checkout on that laptop was four commits behind on 2026-10-07).

## 2. The endpoint: `WINDOWS_URL`, with no name

`xovi.eth` and its subnames stopped resolving when Sepolia's ENSv2 state was reset on 2026-09-16 ([issue 48](https://github.com/zenbitETH/xovi-agents/issues/48)). On 2026-10-07 `AGENT_ENS_NAME=xovi.eth npm run ens:verify` stops on its own control, a v2 name that no longer resolves either, so no endpoint can be read from a name today.

The stand therefore sets `WINDOWS_URL` and leaves `AGENT_ENS_NAME` unset. `WINDOWS_URL` is read only when `AGENT_ENS_NAME` is unset, and a configured name that does not resolve is refused with `EndpointUnresolvable` rather than replaced by it, so setting both is a mistake that fails loudly and never reads from the wrong place. No nested name is used anywhere on the stand.

If a new parent name is registered and resolves before the event, `npm run ens:verify` with that name must exit 0 on 2026-10-21 and on the morning of 2026-10-22 before the stand switches to it. Until that has been run twice, the stand uses `WINDOWS_URL`.

## 3. Anchoring the seven signed clips

Clips 279, 321, 322, 323, 325, 333 and 334 are confirmed machine proposals on the list at `https://testxovi.axolodao.org/api/clips`, each carrying the reviewer's signature. Clip 259 is already anchored (see `README.md`).

Anchoring writes a verifier's address to a public chain, so it is cleared **clip by clip**. A clip is anchored only when all of these are true, and the person doing it writes the three answers down before running anything:

| Clip | Consent of the verifier address, in writing | Consent of the person who operates the submitting agent, if one does | The simplified notice is visible | Cleared |
|---|---|---|---|---|
| 279 | pending | pending | pending | no |
| 321 | pending | pending | pending | no |
| 322 | pending | pending | pending | no |
| 323 | pending | pending | pending | no |
| 325 | pending | pending | pending | no |
| 333 | pending | pending | pending | no |
| 334 | pending | pending | pending | no |

The addresses are in the dry run's output on the founder's machine and are not written into this public table. On 2026-10-07 the seven clips named one verifier address and three submitting addresses. The `confidence` carried in each record is an opaque per mille score with no derivation: it is documented here as that and is not shown on any stand screen.

**Dry run.** It reads the list and the chain, checks that each reviewer signature recovers to the verifier written in the row, and sends nothing. It needs no key:

```
ANCHOR_RPC_URL=<a Sepolia endpoint> XOVI_CLIPS_URL=https://testxovi.axolodao.org/api/clips DATABASE_URL=<any value, unused by a dry run> npx tsx bin/anchor.ts --limit 7
```

Run on 2026-10-07 it printed `38 rows, 7 to anchor, chain 11155111, domain version 0.26` and `would anchor clip N ... signature checks out` for 334, 333, 325, 323, 322, 321 and 279. A dry run says nothing about consent: it would list all seven whatever the table above says.

**Execute.** Only the founder, on his own machine, with the attester key read from a file and never typed or printed, after the legal lead's written OK and only for cleared clips:

```
npm run anchor -- --clip 279,321 --execute
```

`--execute` refuses to run without `--clip`, and `--clip` refuses a clip that is not a confirmed machine proposal in the list, so a count can no longer stand in for a decision. A run is repeatable: the store keeps a row per clip from before the first transaction, and a clip already anchored is skipped.

| Check after an execute | Pass |
|---|---|
| A Studio query `{ observations(first: 50) { id } }` returns one observation for clip 259 plus one for each clip anchored, and `_meta.hasIndexingErrors` is `false` | all seven cleared gives 8 |
| `npm run query` (the paid MCP read) returns `signatureMatchesVerifier` true for every row | a row whose `verifierSignature` is altered in a fixture returns false |
| The dry run, repeated, still prints `signature checks out` for each anchored clip | |

## 4. Rehearsal, 2026-10-21

1. `git pull`, then `npm ci`, `npm test` and `npm run check-types`.
2. `npm run local` with Wi-Fi off, to the end of a loop.
3. The same loop on the network, from the founder's laptop with `WINDOWS_URL` set: the paid read, the proposal, the founder's confirmation, and the anchor count.
4. Read the conditions in section 1 against the screen, one row at a time.

A sixty to ninety second silent, subtitled capture of the loop is made on the same day: the paid read, the proposal, the signed confirmation, the anchor and the subgraph count. It shows only what the public page shows.

## 5. What is not claimed

No clip other than 259 is anchored as of 2026-10-07. No new parent name exists in this repository. No consent in section 3 is recorded here; the table says `pending` and stays that way until the person holding the consent writes otherwise.
