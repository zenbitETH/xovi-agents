# CLAUDE.md

This repository is public. Nothing private goes into it: no key, no internal path, no private repository's text, and no personal data.

## What this is

A delegated agent pays for data over x402, proposes a clip, and cannot approve its own work. `README.md` states the invariant and the state of each leg, `DISCLOSURE.md` what existed before the event, and `AI-USAGE.md` where model assistance was used. Read them before changing behaviour.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | install from the lockfile |
| `npm test` | the whole suite; needs no network, no secret and no funded wallet |
| `npm run check-types` | the type check |
| `npm run local` | a full loop against a fake facilitator and a fake ingest, with the network off |
| `npm run anchor -- --clip 279 --execute` | sends; refuses without `--clip`; a dry run is the same command without `--execute` |

The runbook for the stand is `docs/booth-runbook.md`.

## Rules that hold

- **An agent may propose; no credential may confirm.** No change adds a confirm path for a machine credential.
- **Test networks only.** Nothing here writes to a mainnet, and a screen that shows a payment, an attestation or an identity check says it is a test network (`red de prueba`).
- **A check is seen red before it is trusted.** Every acceptance row has the mutation that breaks exactly it, planted in the source under test, and a check over a derived list first shows the list is not empty.
- **Carry a value, never derive one.** A chain id, a clip id or a signed template is copied from its source row, because a derived value yields a plausible answer where an error would have been useful.
- **A stated absence has an expiry date.** A sentence saying something has not happened carries the date it was read.
- **Every file with code has a row in `AI-USAGE.md`**, and the suite fails when one does not.

## Writing

Zenbit is written in the third person. No dash as punctuation: use a comma, a colon, a semicolon, parentheses or a second sentence. A hyphen inside a word stays. One paragraph is one line. Commit and pull request titles read `tag: what the change does`, and a pull request body is at most ten lines.

Assistance is declared in `AI-USAGE.md`, never in a commit: no trailer of any kind, and no link to a session.
