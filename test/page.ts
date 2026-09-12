import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORD, RUNGS, fabricated, lineFor, settled, totalOnBaseSepolia } from "../app/app-shell";
import { signedBy } from "../lib/anchor/confirmation";
import { CONFIRMATION_259 } from "../lib/anchor/confirmation-259";
import { FABRICATED_TX } from "../lib/human/store";
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
export async function pageChecks(check: Check) {
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
    { step: "read", served: 3, ids: ["a1", "b2", "c3"] },
    { step: "selected", windowId: "w", durationSeconds: 100 },
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
   * No score on any surface.
   *
   * The model's number is carried in the record and rendered nowhere. Spec 05
   * fixes no derivation for it, publishes no cutoff and no banding, and a bare
   * integer beside a chosen window is read as a quality whatever the caption
   * says. It reached the page as "confidence 500" and reached every browser
   * inside the run stream, which is a public route.
   *
   * Read off the mapping rather than off the file, so a value that arrives under
   * another name is still caught by the shape of what a line may carry.
   */
  const drawnLines = everyStep.map(lineFor);
  check(!/confidence/i.test(JSON.stringify(drawnLines)), "224 · no line carries a score");
  check(!/confidence/i.test(ui), "224a · and the word is absent from the interface");
  check(/confidence/i.test(JSON.stringify([{ detail: "confidence 500" }])), "224b · the score check can see one (negative control)");

  /*
   * Every number on the page came off the wire.
   *
   * A price written into the interface survives a change on the server and goes
   * on saying the old one. The card's three values are read from the challenge
   * the counterparty sent, and the check is that no literal shaped like money
   * exists in the file at all.
   */
  // A number next to a currency, not the currency alone. The Overview names USDC
  // as the unit of a total it computed from served rows, which is a label on a
  // measured number; "0.01 USDC" written into the file is the thing to catch.
  const money = /\$\s?\d|\b\d+\.\d+\s*(usdc|usd|eth)\b/i;
  check(!money.test(ui), "225 · no price is written into the interface");
  check(money.test("the server asks $0.01"), "225a · the price check can see a planted one (negative control)");
  check(money.test("it costs 0.01 USDC"), "225b · and one written without a currency sign");

  const card = ui.slice(ui.indexOf('object: { kind: "challenge"'));
  const cardLiteral = card.slice(0, card.indexOf("}"));
  check(
    /amount: challenge\.amount/.test(cardLiteral) &&
      /asset: challenge\.asset/.test(cardLiteral) &&
      /network: challenge\.network/.test(cardLiteral),
    "225c · and the card's three values are read off the served challenge",
  );

  /*
   * What the read bought, drawn as tiles carrying identifiers and nothing else.
   *
   * A window id is a truncated hash of the channel, the video, the two endpoints
   * and the station, so on its own it resolves to nothing. The tank, the species
   * and the alias are in the window the server sent and in the proposal the agent
   * forms, and neither reaches a browser. The object is asserted by its key set,
   * so a field added to it later fails here rather than shipping.
   */
  const readLine = lineFor({ step: "read", served: 2, ids: ["6fe45c795eb3049c", "74ad9a172b8e01aa"] });
  const tiles = readLine.object;
  check(tiles?.kind === "windows" && tiles.ids.length === 2, "226 · the read draws one tile per window");
  check(
    tiles !== undefined && Object.keys(tiles).sort().join(",") === "ids,kind",
    "226a · and the tiles carry the identifiers and nothing else",
  );
  const chosenLine = lineFor({ step: "selected", windowId: "6fe45c795eb3049c", durationSeconds: 16 });
  check(
    chosenLine.object?.kind === "windows" && chosenLine.object.chosen === "6fe45c795eb3049c",
    "226b · and the one the agent took is marked as taken",
  );

  /*
   * The record shows what a stranger can check, and names the rest as assertion.
   *
   * Spec 05 draws the trust boundary and the page has to draw the same one. The
   * seven are the material needed to rebuild the signed message and recover the
   * signer; `verifiedAt` and `submitter` are the operator's word; the model's
   * number is opaque and belongs to neither list and to no surface.
   */
  const SEVEN = ["clipId", "clipHash", "decision", "verifier", "verifierSignature", "verifierNonce", "verifierChainId"];
  const recordBlock = ui.slice(ui.indexOf("const RECORD = {"), ui.indexOf("const ASSERTED = {"));
  const shown = [...recordBlock.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  check(shown.sort().join(",") === [...SEVEN].sort().join(","), `231 · the record shows spec 05's seven checkable fields and no others (${shown.length})`);

  const assertedBlock = ui.slice(ui.indexOf("const ASSERTED = {"), ui.indexOf("/** The four links"));
  const asserted = [...assertedBlock.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  check(asserted.sort().join(",") === "submitter,verifiedAt", `231a · and names the two the operator asserts (${asserted.join(",")})`);
  check(!recordBlock.includes("confidence") && !assertedBlock.includes("confidence"), "231b · the model's number is on neither list");

  /*
   * The recovery is compared, not caught.
   *
   * Recovering over the wrong message does not raise. It answers with a different,
   * perfectly well formed address, so a caller reading the absence of an exception
   * as success accepts a message with one space missing. The page compares.
   */
  check(/recovered\.toLowerCase\(\) === RECORD\.verifier\.toLowerCase\(\)/.test(ui),
    "232 · the recovered address is compared with the verifier for equality");

  // Driven, not read. The record the page builds, through its own `decisionCode`
  // call, recovers to the verifier it names, so the button answers equal on the
  // screen somebody records rather than only in a file that describes it.
  check(await signedBy(RECORD, RECORD.verifierSignature, RECORD.verifier),
    "232c · and the record the page builds does recover to the verifier it names");
  check(!(await signedBy({ ...RECORD, clipId: RECORD.clipId + 1 }, RECORD.verifierSignature, RECORD.verifier)),
    "232d · while one field changed recovers somebody else, without raising (negative control)");

  // The call beside an identifier is the call for that identifier. getAttestation
  // asked for an offchain one answers with an empty struct, which is a badge with
  // nothing behind it, so the page names it only for the onchain identifier.
  const timestampAt = ui.indexOf("getTimestamp");
  const attestationAt = ui.indexOf("getAttestation");
  check(timestampAt > 0 && attestationAt > timestampAt, "232a · getTimestamp is named for the offchain identifier, before getAttestation");
  // Over a whitespace collapsed copy, because JSX wraps prose across lines and the
  // sentence being asserted is prose rather than markup.
  const flat = ui.replace(/\s+/g, " ");
  check(/getAttestation[^.]*onchain identifier/.test(flat.slice(flat.indexOf("getAttestation"))),
    "232b · and getAttestation is bound to the onchain one where it is named");

  /*
   * The check runs with the operator's site down.
   *
   * That is the whole reason it is a check rather than a request for reassurance,
   * so the component that runs it may not reach the network at all.
   */
  const records = ui.slice(ui.indexOf("function Records()"), ui.indexOf("/**\n * A drawn state"));
  check(records.length > 0 && !records.includes("fetch("), "233 · the record check fetches nothing, so it answers with the operator gone");
  check(ui.includes("fetch("), "233a · while the page does fetch elsewhere (negative control)");

  /*
   * The total is over one chain, and a row from anywhere else is counted and not
   * added.
   *
   * The ledger records a network and an atomic amount and no asset, so the unit
   * comes from a merged document, the README and the live challenge, which name
   * USDC on Base Sepolia. That makes the network filter load bearing: without it
   * the page would add quantities of unrelated tokens into one number. Driven on
   * a mixed fixture, because dropping the filter left the suite green while
   * nothing exercised the function.
   */
  const mixed = [
    { source: "route", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", nonce: "n1", txHash: "0xa", settledAt: "2026-09-11T05:00:00.000Z" },
    { source: "route", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", nonce: "n2", txHash: "0xb", settledAt: "2026-09-11T06:00:00.000Z" },
    { source: "route", payer: "0xp", payTo: "0xr", amount: "99999999", network: "eip155:11155111", nonce: "n3", txHash: "0xc", settledAt: "2026-09-11T07:00:00.000Z" },
    { source: "route", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", nonce: "n4", txHash: FABRICATED_TX, settledAt: "2026-09-11T08:00:00.000Z" },
  ];
  const totals = totalOnBaseSepolia(mixed);
  check(totals.total === "0.02", `234 · the total is over Base Sepolia rows alone (${totals.total})`);
  check(totals.counted === 2, `234a · counting two of them (${totals.counted})`);
  check(totals.elsewhere === 1, `234b · and the row on another chain is counted and not added (${totals.elsewhere})`);

  /*
   * The allowance card states the allowance and no count.
   *
   * The route serves no remaining count, so a number there would be one the page
   * made up. 225 catches shapes that look like money and would not catch a bare
   * integer, so the card is read directly: the panel that carries the allowance
   * sentence must carry no big number and no digit.
   */
  const freeCard = ui.slice(ui.indexOf("<h3 className=\"ag-panel-title\">Free reads</h3>"));
  const freeCardEnd = freeCard.indexOf("</div>");
  const freeCardText = freeCard.slice(0, freeCardEnd);
  check(freeCardText.length > 0, "235 · the free reads card is on the page");
  check(!freeCardText.includes("ag-panel-big"), "235a · and renders no figure where the other cards render one");
  // Over the text nodes, not the markup: `<h3>` is a digit and is not a count.
  const freeCardWords = freeCardText.replace(/<[^>]*>/g, " ");
  check(!/\d/.test(freeCardWords), `235b · nor any digit in its words (${freeCardWords.trim().slice(0, 40)})`);
  check(/\d/.test("Served under the free daily allowance, 3 left".replace(/<[^>]*>/g, " ")), "235c · the digit check reads the words (negative control)");

  /*
   * The opaque field does not reach the browser, and the property is structural.
   *
   * A JSON import arrives whole, so importing the fixture put the model's number
   * into the page's chunk even though nothing rendered it. 224a reads this file's
   * source and would never have seen it. The fix is that the page imports a module
   * of the nine values it shows, so there is no tenth to leak, and these checks
   * hold that shape without needing a build: CI runs types and checks and never
   * builds, so a grep over `.next` would be green because the directory is absent.
   */
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "fixtures/confirmation.259.json"), "utf8"));
  const trimmed = readFileSync(join(process.cwd(), "lib/anchor/confirmation-259.ts"), "utf8");
  check(!/from "[^"]*fixtures\//.test(ui), "237 · the page imports nothing from the fixtures directory");
  // The module may name the fixture in prose, and does, because that is where its
  // values came from. What it may not do is import it or carry the opaque field.
  check(!/from "[^"]*fixtures\//.test(trimmed), "237a · nor does the module it imports instead");
  check(!trimmed.includes("confidence"), "237a2 · which carries no opaque field of its own");
  const nine = Object.keys(CONFIRMATION_259).sort();
  check(nine.length === 9, `237b · which carries nine values (${nine.length})`);
  check(!nine.includes("confidence"), "237c · and no tenth");
  check("confidence" in fixture, "237d · while the fixture does carry it (negative control)");

  // The drift guard. A trimmed copy is a copy, and the fixture is the original.
  const drifted = [
    CONFIRMATION_259.clipId !== fixture.id,
    CONFIRMATION_259.clipHash !== fixture.clipHash,
    CONFIRMATION_259.status !== fixture.status,
    CONFIRMATION_259.verifier !== fixture.verifiedBy,
    CONFIRMATION_259.verifierSignature !== fixture.verifierSignature,
    CONFIRMATION_259.verifierNonce !== fixture.verifierNonce,
    CONFIRMATION_259.verifierChainId !== fixture.verifierChainId,
    CONFIRMATION_259.verifiedAt !== fixture.verifiedAt,
    CONFIRMATION_259.submitter !== fixture.submitterAddress,
  ].filter(Boolean);
  check(drifted.length === 0, `237e · every one of the nine equals the fixture it was trimmed from (${drifted.length} did not)`);

  /*
   * The record says what it is, in the present tense, and the absence is a
   * negative rather than a condition.
   */
  check(/not anchored/i.test(ui), "238 · the page states that this confirmation is not anchored");
  check(/fixture/i.test(ui), "238a · and that it is the fixture this repository carries");
  check(!/when this confirmation is anchored/i.test(ui), "238b · and states no conditional future about anchoring it");

  /*
   * An empty proposals section must not read as "you proposed nothing".
   *
   * The list this page reads serves confirmed rows only, so absence there is
   * absence of a confirmation and not absence of a proposal. The sentence is the
   * whole guard, and it is checked because it is the difference between a true
   * empty state and the page lying by omission.
   */
  const flatUi = ui.replace(/\s+/g, " ");
  check(flatUi.includes("Only confirmed proposals appear here. A proposal no person has confirmed is not public."),
    "245 · the proposals section says which proposals it can show");
  check(flatUi.includes("This deployment reads no public list"), "245a · and says so when it reads no list at all");

  /*
   * The name is claimed only on equality, and a name is issued rather than owned.
   */
  check(flatUi.includes("No name is issued for this payer."), "250 · the page carries the negative for an unissued name");
  check(flatUi.includes("resolves to this payer"), "250a · and the positive only as an equality with the payer");
  check(/answer !== null && answer\.matches \?/.test(ui), "250b · which is drawn on the match and not on the answer existing");
  check(flatUi.includes("A name is issued and is not owned"), "250c · and the section says a name is issued rather than owned");

  /*
   * The footer and the mainnet rung say the same thing.
   *
   * They did not. The footer read "Nothing touches mainnet" while the rung two
   * sections below it read "Nothing here writes to a mainnet; one read is on one",
   * so one page made a categorical claim and then contradicted it. The identity is
   * asserted rather than each sentence separately, because two copies of a claim
   * drift and the interesting failure is that they disagree.
   */
  const mainnetRung = RUNGS.find(r => r.rung === "a mainnet");
  const rungNegative = (mainnetRung?.sentences ?? "").split(/(?<=\.)\s+/)[1] ?? "";
  // Read over the footer alone. The first version tested the whole file, which the
  // rung's own copy of the sentence satisfies, so it stayed green with the footer
  // reverted: it could not tell the two places apart, which is the one thing it
  // exists to do.
  const footerAt = flatUi.indexOf("Payments settle on Base Sepolia");
  const footer = footerAt === -1 ? "" : flatUi.slice(footerAt, footerAt + 200);
  check(rungNegative.length > 0 && footer.includes(rungNegative), `253 · the footer states the mainnet claim the rung states (${rungNegative})`);
  check(!/Nothing touches mainnet/.test(ui), "253a · and not the categorical one it contradicted");

  /*
   * The fold is three verbs and one sentence each.
   *
   * At rest the page used to open with a paragraph and five definitions, which is
   * an explanation of the product before a reader has seen what it does. The tiles
   * are what a person can do here; the definitions are kept, because they are
   * merged text a judge may want, and folded away.
   */
  const verbs = [...ui.matchAll(/<h2 className="ag-verb-name">(\w+)<\/h2>/g)].map(m => m[1]);
  check(verbs.join(",") === "Own,Manage,Check", `254 · the fold carries three verbs (${verbs.join(",") || "none"})`);
  const verbLines = [...ui.matchAll(/className="ag-verb-line">\s*([^<]+?)\s*<\/p>/g)].map(m => m[1].replace(/\s+/g, " "));
  check(verbLines.length === 3, `254a · one line under each (${verbLines.length})`);
  const twoSentences = verbLines.filter(l => l.split(/(?<=\.)\s+/).filter(x => x.length > 0).length === 2);
  check(twoSentences.length === 3, `254b · each of them two sentences, as the rungs are (${twoSentences.length})`);
  const withFigure = verbLines.filter(l => /\b\d+\b/.test(l));
  check(withFigure.length === 0, `254c · and none carries a figure (${withFigure.length})`);

  // The definitions are kept and folded, not deleted. A native disclosure, so they
  // open with no script and are in the document for anything that reads it.
  check(/<details className="ag-more">/.test(ui), "255 · the five facts sit behind a disclosure");
  check(/<summary className="ag-more-summary">The facts<\/summary>/.test(ui), "255a · labelled for what it holds");
  check(/<dl className="ag-facts">/.test(ui), "255b · and the definitions are still on the page");
  check(!/You pay for one read from your own wallet and the agent does the rest/.test(ui),
    "255c · while the paragraph that explained the page before showing it is gone");

  /*
   * The ladder: each rung two present tense sentences, one merged fact and one
   * negative, and the unlock written as the negative rather than a condition.
   */
  check(RUNGS.length === 6, `236 · six rungs (${RUNGS.length})`);
  const sentencesOf = (t: string) => t.split(/(?<=\.)\s+/).filter(x => x.length > 0);
  const wrongCount = RUNGS.filter(r => sentencesOf(r.sentences).length !== 2);
  check(wrongCount.length === 0, `236a · each is exactly two sentences (${wrongCount.length} were not)`);
  const notNegative = RUNGS.filter(r => !/^(No|Nothing)\b/.test(sentencesOf(r.sentences)[1] ?? ""));
  check(notNegative.length === 0, `236b · and the second of each is a negative (${notNegative.length} were not)`);
  const figured = RUNGS.filter(r => /\b\d+\b/.test(r.sentences));
  check(figured.length === 0, `236c · no rung carries a figure (${figured.length} did)`);
  const promised = RUNGS.filter(r => /\b(will|soon|coming|unlocks?|when)\b/i.test(r.sentences));
  check(promised.length === 0, `236d · and none states a conditional future (${promised.length} did)`);
  check(/\b\d+\b/.test("a look costs 3"), "236e · the figure check can see one (negative control)");
  check(/\b(will|soon|coming|unlocks?|when)\b/i.test("Unlocks when the founder accepts"), "236f · and the promise check can see one (negative control)");
  // A digit inside a name is not a figure, which is why the test is on a word
  // boundary: the first rung names `agent1.xovi.eth` and must pass.
  check(!/\b\d+\b/.test("`agent1.xovi.eth` resolves to the agent's payer."), "236g · while a digit inside a name is not a figure (negative control)");

  /*
   * The fabricated settlement, which is in the production ledger and will be
   * served to this page.
   *
   * The page carries its own copy of the hash because importing the store into a
   * browser bundle would drag the database driver with it. A copy is a thing that
   * drifts, so the two are compared here: this is the check that makes the
   * duplication safe rather than a comment asking somebody to be careful.
   */
  const pageCopy = ui.match(/const FABRICATED_TX = `0x\$\{"(\d+)"\.repeat\((\d+)\)\}`/);
  check(pageCopy !== null, "230 · the page names the fake facilitator's hash");
  check(
    pageCopy !== null && `0x${pageCopy[1].repeat(Number(pageCopy[2]))}` === FABRICATED_TX,
    "230a · and it is the same hash the write path refuses, so the copy cannot drift",
  );

  const rows = [
    { source: "route", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", nonce: "n1", txHash: "0xreal1", settledAt: "2026-09-11T05:00:00.000Z" },
    { source: "route", payer: "0xp", payTo: "0xr", amount: "10000", network: "eip155:84532", nonce: "n2", txHash: FABRICATED_TX, settledAt: "2026-09-11T06:00:00.000Z" },
  ];
  check(settled(rows).length === 1 && fabricated(rows).length === 1, "230b · a row carrying it is separated from the settlements");
  check(settled(rows).every(r => r.txHash !== FABRICATED_TX), "230c · and no total is formed over it");

  /*
   * An agent surface carries no decision.
   *
   * Counting controls was the first version and it was wrong: it went red the day
   * a section rail arrived, which is navigation and not a decision, and it would
   * have stayed green on a third button labelled Confirm. So the assertion is over
   * what a control says rather than how many there are.
   *
   * Read over the button elements alone rather than the file, because confirm and
   * reject appear in the page's own copy as negatives, in the sentence saying no
   * credential of the agent's can confirm or attest.
   */
  const decision = /\b(confirm|approve|reject|accept|decide|attest)\w*\b/i;
  const controls = ui.split("<button").slice(1).map(chunk => chunk.slice(0, chunk.indexOf("</button>")));
  const deciding = controls.filter(c => decision.test(c));
  check(controls.length > 0, `227 · the interface has controls to read (${controls.length})`);
  check(deciding.length === 0, `227a · and not one of them is a decision about a clip (${deciding.length})`);
  check(decision.test("<button>Confirm this clip</button>"), "227b · the decision check can see one (negative control)");

  // A settlement is linked by the chain the receipt names rather than by a chain
  // the page assumes, so a receipt from anywhere else is drawn without a link
  // instead of with a confident wrong one.
  check(/EXPLORER\[object\.network\]/.test(ui), "228 · the explorer is chosen by the chain the receipt names");
  check(/"eip155:84532": "https:\/\/sepolia\.basescan\.org\/tx\/"/.test(ui), "228a · and Base Sepolia is the one that settles here");

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
