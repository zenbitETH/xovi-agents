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
   * Every step is attributed, and the two hues are held apart.
   *
   * The feed is the one surface showing a person and a machine acting in turn,
   * so a step that reaches the screen without an actor is a step drawn in the
   * neutral hue, which reads as neither and quietly breaks the story. The
   * mapping is exercised against the real function rather than inspected as
   * text, so a new step added to the union without a hue fails here.
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
   * other's hue.
   */
  const toneGood = css.slice(css.indexOf(".ag-tone-good {")).split("}")[0];
  check(!/var\(--color-primary\)/.test(toneGood), "211 · the good tone is not teal, so teal on a row means a person");
  const humanDot = css.slice(css.indexOf(".ag-actor-human .ag-feed-dot {")).split("}")[0];
  const agentDot = css.slice(css.indexOf(".ag-actor-agent .ag-feed-dot {")).split("}")[0];
  check(/var\(--color-primary\)/.test(humanDot) && /var\(--color-xv-agent\)/.test(agentDot),
    "212 · the person's marker is teal and the agent's is the agent hue");
  check(/--color-xv-agent:\s*#c58a5a/i.test(css) && !/#c58a5a/i.test(css.replace(/--color-xv-agent:\s*#c58a5a/i, "")),
    "212b · the agent hue is declared once as a token and appears nowhere as a literal");
  check(!/var\(--color-xv-gold\)/.test(agentDot),
    "212c · and gold is not the agent hue, so the toolbar button means something else (negative control)");
  const dotRule = css.slice(css.indexOf(".ag-feed-dot {")).split("}")[0];
  check(!/box-shadow|border:/.test(dotRule) && /width:\s*0\.375rem/.test(dotRule),
    "213 · and the marker has no shadow and no border, so a marker cannot read as the button");

  /*
   * Every class the interface renders has a rule, and every inline mark has a size.
   *
   * These exist because the flex-chain guard below passed while the page was
   * unusable. A rewrite of the layout block replaced the whole page-layout
   * section and took the header rules with it, so `.ag-header`, `.ag-brand` and
   * `.ag-brand svg` rendered against nothing. An inline SVG carrying only a
   * viewBox scales to its container, so the mark grew to the full width of the
   * header and pushed the app past the fold.
   *
   * The chain guard could not see it, and no version of it could: it asserts the
   * container is well formed, and an unconstrained child breaks a container from
   * the inside. A structural check and a rendering are different instruments, and
   * two people read this markup without noticing a missing attribute while one
   * screenshot showed it immediately. These two are the cheap half of what the
   * screenshot did.
   */
  /*
   * Parsed as rules rather than matched as substrings, because the first version
   * of this was green on three variants of the defect it was written for.
   *
   * An emptied `.ag-header {}` passed, a rule commented out passed, and a new
   * interpolated family rendered with no rule at all passed. Each was seen. So
   * comments are stripped before anything is matched, a rule counts only if it
   * declares something, and a class family this check does not know how to expand
   * is a failure rather than a silent skip.
   */
  const live = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Innermost rules only, which is what the media queries leave behind.
  const rules = [...live.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1], body: m[2] }));
  const styled = (name: string) =>
    rules.some(r => new RegExp(`\\.${name}(?![a-z0-9-])`).test(r.selector) && /[a-z-]+\s*:/.test(r.body));

  const tokens = ui.match(/\bag-[a-z0-9-]+/g) ?? [];
  // A trailing hyphen is the left half of `ag-tone-${...}`. Each such family has
  // to be expanded by hand below, so an unknown one is unasserted, not absent.
  const FAMILIES: Record<string, string[]> = { "ag-tone-": ["good", "working", "stopped"], "ag-actor-": ["human", "agent", "system"] };
  const renderedClasses = new Set(tokens.filter(t => !t.endsWith("-")));
  for (const [prefix, values] of Object.entries(FAMILIES)) for (const v of values) renderedClasses.add(`${prefix}${v}`);
  const unstyled = [...renderedClasses].filter(c => !styled(c));
  check(unstyled.length === 0, `214 · every class the interface renders has a rule that declares something (${unstyled.join(", ")})`);
  const unexpanded = [...new Set(tokens.filter(t => t.endsWith("-")))].filter(t => !(t in FAMILIES));
  check(unexpanded.length === 0, `214b · every interpolated class family is one this check expands (${unexpanded.join(", ")})`);
  check(!styled("ag-not-a-real-class"), "215 · the rule check can miss a class that has none (negative control)");

  // The header's height is the token the app subtracts. If it is ever unset the
  // two disagree and the viewport arithmetic is wrong while everything still
  // looks well formed, which is how the last one of these got through.
  const headerRule = rules.find(r => /\.ag-header(?![a-z0-9-])/.test(r.selector));
  check(/height:\s*var\(--xv-header-h\)/.test(headerRule?.body ?? ""),
    "214c · and the header declares the same height the app subtracts");

  /*
   * Every custom property that is used is also declared.
   *
   * The fourth depth of one defect. The flex chain passed with every header rule
   * deleted; 214 passed with the rule empty, commented, or a new family; 214c
   * passed with only the declaration of `--xv-header-h` removed. Each layer was
   * green for a reason unrelated to what it guarded, and this is the last door:
   * with the token itself undefined, `var()` invalidates the header's height and
   * the app's calc together, so the two agree about nothing and 214c, which
   * exists to catch them disagreeing, goes green.
   *
   * Written for every token rather than for this one, because the hole is the
   * class and not the instance. A token is declared if any rule declares it,
   * which covers the ones that live on `:root` and the ones a media query
   * overrides.
   */
  // Comments stripped first. The prose above the fonts contains the literal text
  // "<html>", and matching the raw file found that instead of the JSX: the needle
  // was right and the haystack was a sentence about the needle.
  const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const declared = new Set([...live.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  /*
   * The two typeface tokens are declared by next/font rather than by the
   * stylesheet: layout.tsx names them in `variable:` and puts them on <html>.
   * Read out of layout.tsx rather than allowlisted, so renaming one there and
   * not here is caught. Nothing else would catch it: every font-family
   * declaration names a fallback stack, so a broken token degrades to the system
   * face and the page still renders, in the wrong typeface, silently.
   */
  /*
   * Read as owner and token together, because declaring a font variable and
   * applying it are two things and only one of them was being checked.
   *
   * The fifth depth. With `${display.variable}` removed from <html> the tokens
   * are still named in layout.tsx, so this set was still complete and the suite
   * still passed, while the property was set on no element at all and every
   * font-family fell to its stack. That is not a plausible typo; it is a
   * plausible refactor, and this interface is about to be redesigned.
   */
  const fonts = [...layout.matchAll(/const\s+(\w+)\s*=\s*\w+\(\{[^}]*variable:\s*"(--[a-z0-9-]+)"/g)];
  for (const [, , token] of fonts) declared.add(token);
  const htmlTag = layout.match(/<html[^>]*>/)?.[0] ?? "";
  const unapplied = fonts.filter(([, owner]) => !htmlTag.includes(`\${${owner}.variable}`)).map(([, , token]) => token);
  check(fonts.length > 0 && unapplied.length === 0,
    `214g · every font variable declared is also applied to the html element (${unapplied.join(", ")})`);
  const used = new Set([...live.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
  const undeclared = [...used].filter(t => !declared.has(t));
  check(undeclared.length === 0, `214d · every custom property the stylesheet uses is declared, here or by next/font (${undeclared.join(", ")})`);
  check(!declared.has("--not-a-real-token"), "214e · the declaration set is real (negative control)");

  /*
   * And the responsive override specifically, because losing it is silent.
   *
   * The header is one height below 1024px and another above it, and the app
   * subtracts whichever is current. If the override alone disappears the page
   * still works, still passes everything above, and is simply wrong by half a
   * rem on wide screens, which is the kind of thing nobody reports.
   */
  const declaresHeader = rules.filter(r => /--xv-header-h\s*:/.test(r.body));
  check(declaresHeader.length >= 2,
    `214f · the header height is declared at the root and overridden for wide viewports (${declaresHeader.length} declarations)`);

  const marks = ui.match(/<svg[\s\S]*?>/g) ?? [];
  const unsized = marks.filter(m => !/\swidth=/.test(m) || !/\sheight=/.test(m));
  check(marks.length > 0 && unsized.length === 0,
    `216 · every inline svg carries width and height, so it cannot scale to its container (${unsized.length} did not)`);
  const brandRule = css.slice(css.indexOf(".ag-brand svg {")).split("}")[0];
  check(/width:/.test(brandRule) && /height:/.test(brandRule),
    "217 · and the mark is bounded in the stylesheet as well as on the element");

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
