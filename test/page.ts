import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATUS_ROWS } from "../app/status";

type Check = (ok: boolean, label: string) => void;

/**
 * The page cannot claim more than the README.
 *
 * These are source checks rather than render checks, and deliberately so: what
 * has to hold is a property of the text, and rendering React to assert on a
 * string would add a dependency to prove something a read already proves. Each
 * one has been seen to fail: the row check by editing a state string on one
 * side only, the note check by shortening the quote, the dash check by pasting
 * an em dash into a paragraph.
 *
 * Numbered from 167. This branch's base ends at 127, so the naive next number
 * is 128, which is exactly where the anchor and MCP legs start: they occupy 128
 * to 166 on their own branch and would collide on merge. Starting above both is
 * safe whichever lands first, and it happens to be contiguous rather than
 * leaving a gap.
 */
export function pageChecks(check: Check) {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  const route = readFileSync(join(process.cwd(), "app/api/agent/windows/route.ts"), "utf8");
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  /*
   * Matched as a whole table row rather than as two independent substrings.
   *
   * Testing `readme.includes(state)` over the whole file passes on any state
   * string that appears anywhere in the README, including its prose: setting a
   * leg to "shipped" was accepted, because the invariant section says the
   * credential primitive "shipped in Xovi before this event". A row match binds
   * the leg to its own state and cannot be satisfied by an unrelated sentence.
   */
  const missing = STATUS_ROWS.filter(r => !readme.includes(`| ${r.leg} | ${r.state} |`));
  check(missing.length === 0, `167 · every status row on the page is still a row of the README table (${missing.map(m => m.leg).join(", ")})`);
  check(STATUS_ROWS.length === 6, "168 · and there are six of them, so a leg cannot be dropped from the page quietly");
  check(readme.includes("| Leg | State |"), "169 · the README table the rows are checked against is still there (negative control)");

  const note =
    "A window marks where something moved and a person should look. It is not a claim that a behaviour occurred, that an animal was identified, or that confidence is a probability.";
  check(page.includes(note), "170 · the sentence the page quotes is quoted in full");
  check(route.includes(note), "171 · and the route still serves it, so the page is not quoting something withdrawn");

  // Rule 2 of the writing conventions, over the copy a stranger reads.
  const dashes = /[–—]/;
  check(!dashes.test(page), "172 · no em dash or en dash in the page copy");
  check(dashes.test("—"), "173 · the dash check can see a dash (negative control)");

  /*
   * Condition 7, over the one sentence on the page that describes anchoring.
   *
   * Asserted positively as well as negatively. A single negative substring only
   * rules out the one passive phrasing it names: rewording to "the confirmation
   * is recorded as an EAS attestation" drops the operator and still passes,
   * because it is a different string. Requiring the operator sentence to be
   * present is what actually holds the subject in place.
   *
   * The render is asserted alongside the sentence, and that is not belt and
   * braces. The sentence lives in the STEPS constant, so deleting the grid's
   * JSX while leaving the constant in place left the suite green: measured, 604
   * bytes of JSX removed, 213 of 213 still passing. A source read cannot tell a
   * rendered string from a dead one, so it has to be told that the constant
   * reaches the page.
   *
   * What this guarantees, stated exactly: the sentence is in the source, it
   * keeps the operator as its subject, and the constant holding it is mapped
   * into JSX. Removing the page's only description of anchoring now fails,
   * which is the point; it should be a decision someone makes rather than one a
   * green suite absorbs.
   */
  check(
    page.includes("The operator asserts") && !/becomes an EAS attestation/.test(page) && page.includes("{STEPS.map("),
    "174 · the anchoring sentence is rendered and keeps the operator as its subject",
  );

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
   * exactly the half-prefixed output that is the bug. The optional prefix is
   * therefore part of the pattern rather than something the pattern tolerates.
   */
  const declaration = /(^|[{;])\s*(-webkit-)?backdrop-filter\s*:/m;
  check(!declaration.test(css), "175 · the stylesheet declares no backdrop-filter, so there is no prefix pair to collapse");
  check(
    declaration.test("a{-webkit-backdrop-filter:blur(16px)}"),
    "176 · the guard sees a prefixed declaration, which a substring test would miss (negative control)",
  );
  // The page asserts; it never proves. Attestation is a claim by a named party,
  // and the verb is the whole difference between that and a proof.
  const proving = /\b(prove[sdn]?|proof)\b/i;
  check(!proving.test(page), "177 · the page asserts and never proves");
  check(proving.test("this proves it"), "178 · the proving check can see the verb (negative control)");
}
