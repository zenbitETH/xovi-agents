import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineFor } from "../app/app-shell";
import type { RunStep } from "../lib/agent/run";

type Check = (ok: boolean, label: string) => void;

/**
 * The rules the interface copy and the stylesheet are held to.
 *
 * This file used to bind page copy to README.md, because the page restated the
 * README: a status table, a description, a quoted note. That surface is gone.
 * The repository already carries README.md, DISCLOSURE.md, AI-USAGE.md and the
 * specs, a judged repository is read, and mirroring them onto the root was what
 * made it read as a report rather than an app. So checks 167 to 171, 174, 200
 * and 201 were removed with the surface they guarded rather than rewritten to
 * pass against nothing. What still carries the honesty is the run reporting
 * truthfully what it did, which is checks 191 and 192.
 *
 * The numbers of the survivors are unchanged, so the gaps are deliberate.
 */
export function pageChecks(check: Check) {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/app-shell.tsx"), "utf8");

  // Rule 2 of the writing conventions, over the copy a stranger reads.
  const dashes = /[–—]/;
  check(!dashes.test(ui), "172 · no em dash or en dash in the interface copy");
  check(dashes.test("—"), "173 · the dash check can see a dash (negative control)");

  /*
   * No backdrop-filter DECLARATION in the stylesheet.
   *
   * The specification asked for `grep -c backdrop-filter` to return 0. It
   * cannot: the file names the property three times in the header comment that
   * records why the page has none, so the only way to reach 0 is to delete the
   * documentation of the decision the check exists to protect.
   *
   * So the guard anchors on a declaration boundary instead, which is what was
   * actually meant. It must match the property at the start of a declaration
   * and not as a substring, because "-webkit-backdrop-filter: blur(16px)"
   * contains "backdrop-filter: blur(16px)"; a substring test would pass on
   * exactly the half-prefixed output that is the bug.
   */
  const declaration = /(^|[{;])\s*(-webkit-)?backdrop-filter\s*:/m;
  check(!declaration.test(css), "175 · the stylesheet declares no backdrop-filter, so there is no prefix pair to collapse");
  check(
    declaration.test("a{-webkit-backdrop-filter:blur(16px)}"),
    "176 · the guard sees a prefixed declaration, which a substring test would miss (negative control)",
  );

  // The interface asserts; it never proves. Attestation is a claim by a named
  // party, and the verb is the whole difference between that and a proof.
  const proving = /\b(prove[sdn]?|proof)\b/i;
  check(!proving.test(ui), "177 · the interface asserts and never proves");
  check(proving.test("this proves it"), "178 · the proving check can see the verb (negative control)");

  /*
   * Every step is attributed, and the two colours are held apart.
   *
   * The feed is the one surface showing a person and a machine acting in turn,
   * so a step that reaches the screen without an actor is a step drawn in the
   * neutral colour, which reads as neither and quietly breaks the story. The
   * mapping is exercised against the real function rather than inspected as
   * text, so a new step added to the union without a colour fails here.
   */
  const everyStep: RunStep[] = [
    { step: "presenting" },
    { step: "payment-refused", status: 402, detail: "x" },
    { step: "unavailable", status: 503, detail: "x" },
    { step: "paid", free: false, transaction: "0x1", network: "eip155:84532" },
    { step: "paid", free: true },
    { step: "read", served: 3 },
    { step: "selected", windowId: "w", durationSeconds: 100, confidence: 500 },
    { step: "nothing-proposable", considered: 3 },
    { step: "proposing", windowId: "w" },
    { step: "proposed", id: 1, clipHash: "0x", status: "pending" },
    { step: "declined", kind: "duplicate", detail: "x" },
    { step: "declined", kind: "rejected", detail: "x" },
    { step: "declined", kind: "throttled", detail: "x" },
    { step: "declined", kind: "refused", detail: "x", status: 403 },
    { step: "not-submitted", detail: "x" },
    { step: "done" },
  ];
  const unattributed = everyStep.filter(st => !["human", "agent", "system"].includes(lineFor(st).actor));
  check(unattributed.length === 0, `207 · every step is attributed to a person, the agent, or neither (${unattributed.length} were not)`);
  check(lineFor({ step: "declined", kind: "rejected", detail: "x" }).actor === "human",
    "208 · a window a person already refused is marked as their judgement, not the agent's");
  check(lineFor({ step: "declined", kind: "refused", detail: "x", status: 403 }).actor === "agent",
    "209 · while a route refusing the credential is the agent's (negative control for 208)");
  check(lineFor({ step: "proposed", id: 1, clipHash: "0x", status: "p" }).actor === "agent",
    "210 · and the work the agent did is the agent's");

  /*
   * Teal means a person, in this feed and nowhere else in it.
   *
   * The tone axis used the primary for its good state, which would have put teal
   * on agent rows and dissolved the distinction the marker exists to draw. The
   * marker carries the actor, the text carries the state, and neither reads the
   * other's colour.
   */
  const toneGood = css.slice(css.indexOf(".ag-tone-good {")).split("}")[0];
  check(!/var\(--color-primary\)/.test(toneGood), "211 · the good tone is not teal, so teal on a row means a person");
  const humanDot = css.slice(css.indexOf(".ag-actor-human .ag-feed-dot {")).split("}")[0];
  const agentDot = css.slice(css.indexOf(".ag-actor-agent .ag-feed-dot {")).split("}")[0];
  check(/var\(--color-primary\)/.test(humanDot) && /var\(--color-xv-agent\)/.test(agentDot),
    "212 · the person's marker is teal and the agent's is the agent colour");
  check(/--color-xv-agent:\s*#c58a5a/i.test(css) && !/#c58a5a/i.test(css.replace(/--color-xv-agent:\s*#c58a5a/i, "")),
    "212b · the agent colour is declared once as a token and appears nowhere as a literal");
  check(!/var\(--color-xv-gold\)/.test(agentDot),
    "212c · and gold is not the agent colour, so the toolbar button means something else (negative control)");
  const dotRule = css.slice(css.indexOf(".ag-feed-dot {")).split("}")[0];
  check(!/box-shadow|border:/.test(dotRule) && /width:\s*0\.375rem/.test(dotRule),
    "213 · and the marker has no shadow and no border, so a marker cannot read as the button");

  /*
   * The scrollless shell, guarded where it actually breaks.
   *
   * Xovi's home owns one viewport minus the header and does not scroll; the one
   * scrollable region scrolls inside itself. `min-height: 0` at every level of
   * the flex chain is what makes that work, because a flex child defaults to
   * refusing to shrink below its content, and without it the column overflows
   * the viewport instead. It is the usual way this layout is ported wrong, it
   * fails silently, and it fails only at a viewport small enough to matter.
   */
  const chain = ["ag-app", "ag-surface", "ag-app-body", "ag-app-scroll"];
  const ruleFor = (name: string) => css.slice(css.indexOf(`.${name} {`)).split("}")[0];
  const missing = chain.filter(name => !/min-height:\s*0/.test(ruleFor(name)));
  check(missing.length === 0, `202 · every level of the flex chain declares min-height 0 (${missing.join(", ")})`);
  check(/height:\s*calc\(100dvh - var\(--xv-header-h\)\)/.test(ruleFor("ag-app")),
    "203 · the app is exactly one viewport minus the header");
  check(/overflow:\s*hidden/.test(ruleFor("ag-app")), "204 · and it does not scroll");
  check(/overflow-y:\s*auto/.test(ruleFor("ag-app-scroll")), "205 · while the body scrolls inside itself");
  check(!/min-height:\s*0/.test(ruleFor("ag-app-top")), "206 · the chain check reads real rules (negative control)");
}
