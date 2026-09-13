import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_TABS,
  CHAIN,
  PLAN,
  planFrom,
  screensFor,
  RECORD,
  SCREENS,
  fabricated,
  lineFor,
  settled,
  supplyFrom,
  supplySentence,
  totalOnBaseSepolia,
} from "../app/app-shell";
import { signedBy } from "../lib/anchor/confirmation";
import { BASE_SEPOLIA_HEX, disconnect, restoreConnection } from "../lib/agent/browser";
import { ANCHOR_259, CONFIRMATION_259 } from "../lib/anchor/confirmation-259";
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
  // Each object delimited by its own closing brace rather than by whatever is
  // declared next: the end anchor used to be the comment above the four links,
  // and rewording that comment ran the slice to the end of the file, which swept
  // seven component props into the list of fields Zenbit asserts.
  const recordAt = ui.indexOf("const RECORD = {");
  const recordBlock = ui.slice(recordAt, ui.indexOf("};", recordAt));
  const shown = [...recordBlock.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
  check(shown.sort().join(",") === [...SEVEN].sort().join(","), `231 · the record shows spec 05's seven checkable fields and no others (${shown.length})`);

  const assertedAt = ui.indexOf("const ASSERTED = {");
  const assertedBlock = ui.slice(assertedAt, ui.indexOf("};", assertedAt));
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
  // Each call bound to the identifier it answers for, in whichever order the copy
  // names them, since the page now leads with the onchain one it can show.
  const flatRecord = ui.replace(/\s+/g, " ");
  check(/onchain one, which a query returns and which getAttestation answers/.test(flatRecord), "232a · getAttestation is bound to the onchain identifier");
  check(/offchain[^.]*getTimestamp/.test(flatRecord), "232b · and getTimestamp to the offchain one");
  check(/getAttestation asked for an offchain identifier returns an empty struct/.test(flatRecord),
    "232e · with the wrong call beside the wrong identifier named as the badge it would be");

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
  /*
   * Inverted, because the page said the opposite of the chain: it claimed this
   * confirmation was not anchored, which was true of the fixture and false of
   * Ethereum Sepolia, where it has been anchored since 2026-09-11. An absence
   * asserted from a file's silence is not an absence measured.
   */
  check(/anchored on Ethereum Sepolia/.test(flatRecord), "238 · the page states that this confirmation is anchored");
  check(!/not anchored/i.test(ui), "238a · and never the opposite, which is the copy this replaced");
  check(/"onchain identifier": ANCHOR_259\.onchainUid/.test(ui), "238b · rendering the onchain identifier from the constant");
  /*
   * Pinned literally, all of them. A check that pins the time alone lets an
   * identifier, an attester or a transaction hash drift by a digit and stay
   * green, which the reviewer measured on 2026-09-12. These values were read
   * from EAS 0xC2679fBD3ee79CBE1Ed3a5ED5E5C0a5e4E7D5E815e on chain 11155111
   * with getAttestation, getTimestamp and the two receipts on 2026-09-12.
   */
  const CHAIN_READ_2026_09_12 = {
    chainId: 11155111,
    onchainUid: "0xf3e3edf3c8bf0051bc2d70848592846b0604f89bd0b9439c4ba06bccf0232044",
    attester: "0x51F1D0074793E7Fa336f538299ad7D3e439e2b09",
    attestedAt: 1789110516,
    attestTx: "0xd86c2902aaf8cb0cebf529e4171f64bdd1b4235aa6f5e2eb419c1e044fca5538",
    offchainUid: "0x3252123f3ac9e0521296847836c61f757c939e54b8892743fdf2f9f068b7a775",
    timestampedAt: 1789110504,
    timestampTx: "0x236b7c7a944d7e2354da9e9f80a2cfa97c8e7ea70ef1d65cceed3f7502fadfb3",
  } as const;
  check(
    ANCHOR_259.chainId === CHAIN_READ_2026_09_12.chainId &&
      ANCHOR_259.onchainUid === CHAIN_READ_2026_09_12.onchainUid &&
      ANCHOR_259.attester === CHAIN_READ_2026_09_12.attester &&
      ANCHOR_259.attestedAt === CHAIN_READ_2026_09_12.attestedAt &&
      ANCHOR_259.attestTx === CHAIN_READ_2026_09_12.attestTx,
    "238e · the onchain identifier, attester, time and transaction equal what getAttestation and the receipt returned from EAS on 11155111 on 2026-09-12",
  );
  check(
    ANCHOR_259.offchainUid === CHAIN_READ_2026_09_12.offchainUid &&
      ANCHOR_259.timestampedAt === CHAIN_READ_2026_09_12.timestampedAt &&
      ANCHOR_259.timestampTx === CHAIN_READ_2026_09_12.timestampTx,
    "238d · and the offchain identifier, its getTimestamp time and its transaction likewise",
  );
  check(/"offchain identifier": ANCHOR_259\.offchainUid/.test(ui) && /"timestamped at": ANCHOR_259\.timestampedAt/.test(ui),
    "238f · and the offchain identifier with the time getTimestamp returns");
  // Structural, so the four above cannot be satisfied by a value typed in beside
  // the constant they name. Every hexadecimal on this surface is interpolated.
  const literals = records.match(/0x[0-9a-f]{20,}/gi) ?? [];
  check(literals.length === 0, `238i · and no value the record draws is written as a literal (${literals.join(", ") || "none"})`);
  check((/0x[0-9a-f]{20,}/gi.test("0x3252123f3ac9e0521296847836c61f757c939e54")), "238j · the literal check can see one (negative control)");
  check(String(ANCHOR_259.offchainUid) !== String(ANCHOR_259.onchainUid) && ANCHOR_259.timestampedAt === 1789110504,
    "238g · the two identifiers share nothing, which is why each has its own call");
  check(/sepolia\.etherscan\.io\/tx\/\$\{ANCHOR_259\.attestTx\}/.test(ui), "238c · and linking the transaction that carries it");
  check(/sepolia\.etherscan\.io\/tx\/\$\{ANCHOR_259\.timestampTx\}/.test(ui), "238h · and the timestamp's own transaction beside the offchain identifier, never the attestation's");

  /*
   * The record is four tabs, one object each.
   *
   * It was a stack: a paragraph, four links as a list, seven fields, two more, a
   * check, five anchor values, one column. A reader asking what the attestation
   * is read everything above and below it to find out, and the anchor section was
   * nested inside the check's, which is not where it belongs.
   *
   * The tabs are the links, so the four sentences that say what each object is
   * cannot drift from the four panels, and the arm no tab takes is uninhabitable
   * by its parameter: a fifth link without a panel stops compiling rather than
   * drawing nothing.
   */
  const recordsBody = records;
  const panelless = CHAIN.filter(l => !new RegExp(`tab === "${l.id}"`).test(recordsBody));
  check(CHAIN.length === 4, `403 · the record is four links (${CHAIN.length})`);
  check(panelless.length === 0, `403a · and each of them has a panel of its own (${panelless.map(l => l.id).join(", ") || "none"})`);
  check(/\) : \(\s*exhausted\(tab\)\s*\)\}/.test(recordsBody),
    "403b · with the arm no tab takes uninhabitable, so a fifth link without a panel stops compiling");
  check(/<p className="ag-sub">\{link\.says\}<\/p>/.test(recordsBody),
    "403c · and a panel's first line is its link's own sentence, read off the array rather than written twice");

  /*
   * Each panel carries its own object and no other's. The hazard this is against
   * is the one 232e names: an identifier under the call that does not answer for
   * it, which is a badge with nothing behind it.
   */
  const panelOf = (id: string): string => {
    const from = recordsBody.indexOf(`tab === "${id}"`);
    if (from === -1) return "";
    const rest = recordsBody.slice(from + 1);
    const nexts = CHAIN.map(l => rest.indexOf(`tab === "${l.id}"`)).filter(i => i > 0);
    const end = nexts.length > 0 ? Math.min(...nexts) : rest.indexOf("exhausted(tab)");
    return end > 0 ? rest.slice(0, end) : rest;
  };
  const panels = CHAIN.map(l => ({ id: l.id, body: panelOf(l.id) }));
  const empty = panels.filter(p => p.body.length < 80);
  check(empty.length === 0, `403d · the four panels are found (negative control for the slices, ${empty.map(p => p.id).join(", ") || "none"})`);
  const [clipPanel, confirmationPanel, attestationPanel, anchorPanel] = panels.map(p => p.body);
  check(/Seven fields/.test(confirmationPanel) && /Zenbit asserts/.test(confirmationPanel) &&
    />The check</.test(confirmationPanel) && /Recover the signer/.test(confirmationPanel),
    "403e · the seven, the two Zenbit asserts and the check are under the confirmation");
  const strays = panels.filter(p => p.id !== "confirmation" && /Seven fields|Zenbit asserts|>The check<|Recover the signer/.test(p.body));
  check(strays.length === 0, `403f · and under nothing else (${strays.map(p => p.id).join(", ") || "none"})`);
  check(/offchainUid/.test(attestationPanel) && !/onchainUid/.test(attestationPanel),
    "404 · the attestation panel carries the offchain identifier and not the onchain one");
  check(/onchainUid/.test(anchorPanel) && !/offchainUid/.test(anchorPanel),
    "404a · and the anchor panel the onchain one and not the offchain, since the two share nothing");
  check(/RECORD\.clipHash/.test(clipPanel) && !/ANCHOR_259/.test(clipPanel),
    "404b · while the clip panel carries the clip and no identifier from the chain");

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
  // Out of DISCLOSURE.md rather than out of a constant. The ladder that used to
  // carry this sentence is gone, and a new constant in this file would be a third
  // copy for the other two to agree with instead of the document they are about.
  const disclosure = readFileSync(join(process.cwd(), "DISCLOSURE.md"), "utf8");
  const rungNegative = (disclosure.match(/Nothing here writes to a mainnet[^.]*\./) ?? [])[0] ?? "";
  check(rungNegative.length > 0, `253b · DISCLOSURE states the mainnet claim (negative control for the read, ${rungNegative || "none"})`);
  // Read over the footer alone. The first version tested the whole file, which the
  // rung's own copy of the sentence satisfies, so it stayed green with the footer
  // reverted: it could not tell the two places apart, which is the one thing it
  // exists to do.
  const footerAt = flatUi.indexOf("Payments settle on Base Sepolia");
  const footer = footerAt === -1 ? "" : flatUi.slice(footerAt, footerAt + 200);
  // The length guard is not redundant with 253b. A sentence the document stops
  // carrying reads as the empty string here, which every footer contains, so
  // without it this check goes green on the document losing the claim entirely.
  check(rungNegative.length > 0 && footer.includes(rungNegative),
    `253 · the footer states the mainnet claim DISCLOSURE states, word for word (${rungNegative || "none"})`);
  check(!/Nothing touches mainnet/.test(ui), "253a · and not the categorical one it contradicted");

  /*
   * The ladder's five still-true pairs, where they went.
   *
   * They were a tab. Each is two present tense statements, one merged fact and
   * one negative, and the negative is the device: the day it stops being true the
   * absence sweep's own question, has this already happened, catches it. Read out
   * of the section they were moved into, so moving them again without the section
   * is a red rather than a silence.
   */
  const designedAt = disclosure.indexOf("### Designed and not running");
  const designed = designedAt === -1 ? "" : disclosure.slice(designedAt, disclosure.indexOf("### The surface this opens", designedAt));
  check(designed.length > 0 && designed.length < disclosure.length, `253c · the section is found and is a section (${designed.length} characters)`);
  /*
   * Whole pairs, not the negative halves.
   *
   * Bound as fragments, the merged fact each negative qualifies was held by
   * nothing: "Receipts land in a ledger" could become any sentence at all and the
   * check would pass on "No rule routes any of it onward" alone. The array the
   * page carried is gone, so these are pinned here, the way the anchor's seven
   * values are: a copy that is the check rather than a second source that has to
   * be kept in agreement with a third.
   */
  const moved = [
    "Every payment here settles on Base Sepolia. Nothing here writes to a mainnet; one read is on one.",
    "Receipts land in a ledger. No rule routes any of it onward.",
    "A human confirms or rejects every proposal and signs the decision. No institution has paid for one.",
    "The anchor joins the confirmation. No key but Zenbit's has queried it.",
    "One colony produces every record. No second producer exists.",
  ];
  const notMoved = moved.filter(x => !designed.includes(x));
  check(notMoved.length === 0, `253d · and carries every pair the ladder carried but one, whole (${notMoved.join(" | ") || "none"})`);
  /*
   * And the shape survives the move, which is what 236a and 236b measured on the
   * array: two present tense sentences, the second a negative. Read off the
   * bullets rather than off the list above, so a sixth pair added to the document
   * is held to the same rule without being named here.
   */
  const bullets = [...designed.matchAll(/^- \*\*[^*]+\.\*\* (.+)$/gm)].map(m => m[1]);
  check(bullets.length === moved.length, `253d2 · the section's pairs are found and are as many as were moved (${bullets.length})`);
  const misshapen = bullets.filter(b => {
    const parts = b.split(/(?<=\.)\s+/).filter(x => x.length > 0);
    return parts.length !== 2 || !/^(No|Nothing)\b/.test(parts[1]);
  });
  check(misshapen.length === 0, `253d3 · each two sentences with the negative second (${misshapen.join(" | ") || "none"})`);
  /*
   * The sixth is the gateway key's, and it is not a thing that has not happened:
   * it is a property of a deployment that is running, falsified by a key on a
   * server rather than by an issuance, so it is beside the gateway it is about.
   */
  const running = disclosure.slice(disclosure.indexOf("### Built and running"), designedAt);
  check(/the gateway key signs answers and nothing else/.test(running) && /No key on a server owns `xovi\.eth` or can move it/.test(running),
    "253e · while the gateway key negative is kept in the section about what runs");

  /*
   * What the page loads at rest, and what DISCLOSURE says it loads.
   *
   * The sentence named the livestream, whose embed draws a dead player whenever
   * the museum is not broadcasting. The home has drawn the newest recording on
   * offer since it was built, so the document described a page that had stopped
   * existing, and a reader following its falsification instruction would have
   * found something else. Bound to the home rather than stated alone, so the day
   * one of the two moves the other is what goes red.
   */
  const restSentence = (disclosure.match(/At rest it loads one: [^.]*\./) ?? [])[0] ?? "";
  check(restSentence.length > 0, `253f · DISCLOSURE says what the page loads at rest (${restSentence || "none"})`);
  check(!/livestream|live channel|live_stream/.test(restSentence) && /recording/.test(restSentence),
    `253g · naming a recording rather than the live channel (${restSentence})`);
  const homeBlock = ui.slice(ui.indexOf("function Home("), ui.indexOf("function Enrol("));
  const restFrames = (homeBlock.match(/<iframe/g) ?? []).length;
  check(homeBlock.length > 0 && restFrames === 1, `253h · and the home embeds exactly the one it names (${restFrames})`);

  /*
   * 254 to 257b are retired with the fold they held.
   *
   * They read three verb tiles, a command line, the condition under the verb
   * "proposes" and five definitions behind a disclosure, all of which stood in
   * the body's last arm. Nothing sets that state: `openRun` shows a dialog and
   * the strip's other items set the four screens `HEADS` carries, so the arm was
   * unreachable and the page it drew was read by nobody. The rest state is the
   * board, which is the recording and the grid.
   *
   * What the condition became is check 327 over the home's fourth card, which is
   * where a person now reads that the agent proposes; the tiles and the command
   * line are gone rather than moved, and the definitions live in DISCLOSURE.md
   * and the specs they were quoted from.
   */


  /*
   * Disconnect says which of two things it did.
   *
   * There is no disconnect in EIP-1193. A page can forget the account, and the
   * wallet goes on considering the site connected, which is why the control on
   * most dapps is a lie the size of a button. `wallet_revokePermissions` withdraws
   * the grant where a wallet implements it. Driven against both kinds of wallet,
   * because the failure to catch is the page claiming the stronger one.
   */
  /*
   * A reload is not a first visit.
   *
   * `eth_accounts` reads a grant that exists; `eth_requestAccounts` asks for one
   * and opens the wallet. A page that only knows the second re-prompts on every
   * reload, which teaches a person the button does nothing they can rely on.
   * Driven against a provider that records what it was asked.
   */
  const savedProvider = (globalThis as { ethereum?: unknown }).ethereum;
  const asked: string[] = [];
  (globalThis as { ethereum?: unknown }).ethereum = {
    request: async ({ method }: { method: string }) => {
      asked.push(method);
      return method === "eth_accounts" ? ["0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe"] : [];
    },
  };
  const restored = await restoreConnection();
  check(restored === "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe", `277 · a wallet that already grants an account is restored (${restored})`);
  check(asked.includes("eth_accounts"), "277a · by reading the grant");
  check(!asked.includes("eth_requestAccounts"), `277b · and never by asking for one, which is what opens the wallet (${asked.join(", ")})`);
  check(/restoreConnection\(\)/.test(ui), "277c · and the page does that read on load");

  (globalThis as { ethereum?: unknown }).ethereum = { request: async () => [] };
  check((await restoreConnection()) === null, "277d · a wallet that grants nothing restores nothing (negative control)");


  (globalThis as { ethereum?: unknown }).ethereum = {
    request: async ({ method }: { method: string }) => {
      if (method === "wallet_revokePermissions") throw new Error("this wallet does not implement it");
      return [];
    },
  };
  check((await disconnect()) === "forgotten", "258 · a wallet without revoke is reported as forgotten, not revoked");

  (globalThis as { ethereum?: unknown }).ethereum = { request: async () => null };
  check((await disconnect()) === "revoked", "258a · and a wallet that revokes is reported as revoked (negative control)");

  delete (globalThis as { ethereum?: unknown }).ethereum;
  check((await disconnect()) === "forgotten", "258b · with no wallet at all, nothing is claimed");
  (globalThis as { ethereum?: unknown }).ethereum = savedProvider;

  // The two sentences the page shows for those two outcomes are different, and
  // only one of them says the wallet did anything.
  check(/this page forgot the account; the wallet still considers the site connected/.test(ui),
    "258c · the page says so when only it forgot");
  check(/the wallet withdrew this site's permission/.test(ui), "258d · and says so when the wallet withdrew");

  /*
   * The chain badge is a comparison, and the name is an equality.
   *
   * The badge reads the wallet's own chainId rather than the client's
   * configuration, which is the mistake #38 was written about, and the chip shows
   * a name only where the name route reported a match, because under a wildcard
   * parent every subname resolves for every wallet.
   */
  check(new RegExp(`chain === ${"BASE_SEPOLIA_HEX"}`).test(ui), "259 · the badge compares the wallet's chain against Base Sepolia");
  check(/Wrong chain, switch/.test(ui), "259a · and offers the switch on any other chain");
  check(/answer !== null && answer\.matches \? answer\.name : null/.test(ui),
    "259b · the chip takes a name only on the name route's match");
  check(BASE_SEPOLIA_HEX === "0x14a34", `259c · and Base Sepolia is the chain it compares against (${BASE_SEPOLIA_HEX})`);

  /*
   * Four destinations, and the chain badge's three states.
   *
   * Seven flat items were the account's four views sitting beside the product, a
   * record and a ladder as though the six were the same kind of thing. Grouping
   * them is the finding; the checks hold the grouping and hold every item to
   * opening on something.
   */
  // 260 enumerated four ids by name and asserted four, which stayed green after
  // the flow made six; it is folded into 266, which reads the array itself.
  check(/translateX\(\$\{Math\.max\(0, screensFor/.test(ui), "261 · the rail indicator is moved with transform");
  check(/translateX\(\$\{ACCOUNT_TABS\.findIndex/.test(ui), "261a · and so is the account's");

  // Finding 15. `currentChain` answers null when the provider throws or is not
  // there, and reading that as Base Sepolia draws the reassuring badge exactly
  // where the page knows least.
  check(/chain === null \?/.test(ui), "262 · a chain that did not answer is its own state");
  check(/No chain answered, switch/.test(ui), "262a · and says so rather than claiming a chain");
  check(!/chain === null \|\| chain === BASE_SEPOLIA_HEX/.test(ui), "262b · and is not folded into the Base Sepolia badge");

  /*
   * The motion rule, over the stylesheet rather than over a description of it.
   *
   * Only `transform` and `opacity` move; a state fill may transition a hue; every
   * transition names its properties, none of them is `all`, and nothing runs
   * longer than 300ms. Read off the declarations, so a rule added later is held to
   * it without anybody remembering.
   */
  // Comments stripped first, for the reason the rule parser strips them: a rule
  // described in prose is not a rule, and a prose example of a bad one is not a bug.
  const cssLive = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const MOVABLE = new Set(["transform", "opacity", "background-color", "border-color", "color"]);
  const transitions = [...cssLive.matchAll(/transition:\s*([^;}]+)[;}]/g)].map(m => m[1].replace(/\s+/g, " ").trim());
  const usesAll = transitions.filter(t => /\ball\b/.test(t));
  check(usesAll.length === 0, `263 · no transition animates everything (${usesAll.length})`);
  const animated = transitions
    .flatMap(t => t.split(",").map(part => part.trim().split(" ")[0]))
    // `none` switches a transition off, which is what reduced motion does with the
    // indicator, and switching one off is not animating a property.
    .filter(prop => prop !== "none");
  const unmovable = [...new Set(animated)].filter(prop => !MOVABLE.has(prop));
  check(unmovable.length === 0, `263a · and only transform, opacity and a hue are animated (${unmovable.join(", ") || "none"})`);

  const transitionMs = transitions.flatMap(t => [...t.matchAll(/(\d+)ms/g)].map(m => Number(m[1])));
  const slow = transitionMs.filter(d => d > 300);
  check(transitionMs.length > 0 && slow.length === 0, `263b · and no transition runs past 300ms (${slow.join(", ") || "none"} of ${transitionMs.length})`);

  /*
   * Animations are held by name rather than by duration.
   *
   * Four are inherited: the app card's 320ms entrance and the ambient layers Xovi
   * drifts behind everything. One is this repository's own and is a decision
   * rather than an inheritance: a cell whose proposal is waiting on a person
   * breathes at 2400ms, because it reports a state that lasts and a fast one would
   * read as loading. Naming them keeps the bound live, because a new animation
   * past 300ms carries a new name and fails until somebody writes down why it is
   * there.
   */
  const INHERITED_LONG = ["xvFadeUp", "xvAurora", "xvRays", "xvPulse"];
  const DECIDED_LONG = ["xvCellWait"];
  const longAnimations = [...cssLive.matchAll(/animation:\s*([a-zA-Z][\w-]*)\s+([\d.]+)(m?s)/g)]
    .map(m => ({ name: m[1], ms: m[3] === "s" ? Number(m[2]) * 1000 : Number(m[2]) }))
    .filter(a => a.ms > 300);
  const unnamed = longAnimations.filter(a => ![...INHERITED_LONG, ...DECIDED_LONG].includes(a.name));
  check(unnamed.length === 0, `263d · every animation past 300ms is inherited or named as a decision (${unnamed.map(a => a.name).join(", ") || "none"})`);
  /*
   * And the one decision survives the reduced motion clamp as something rather
   * than as nothing. The clamp at the top of the file runs every animation once at
   * 0.01ms, so what a reader sees is the element's own declared state, and a
   * border whose only opacity lived in keyframes would vanish for exactly the
   * people the clamp is for.
   */
  const glowBase = /\.ag-board-cell\[data-life\]::after\s*\{([^}]*)\}/.exec(cssLive)?.[1] ?? "";
  check(glowBase.length > 0, `263f · the lifecycle border's own rule is found (negative control for the read, ${glowBase.length})`);
  check(/opacity:\s*0?\.[1-9]/.test(glowBase), `263g · and it declares an opacity of its own, so reduced motion leaves it gentler rather than gone (${/opacity:[^;]*/.exec(glowBase)?.[0] ?? "none"})`);
  check(longAnimations.length > 0, `263e · and those inherited ones are still there (${longAnimations.length}, negative control)`);
  check(["all 200ms ease"].filter(t => /\ball\b/.test(t)).length === 1, "263c · the all check can see one (negative control)");

  /*
   * A snapshot with nothing new in it is supply, not a failure of the run.
   *
   * The ingest refusing a clip it already holds is the rule working. Drawn in the
   * stopped hue it read as the agent failing, and against a two window snapshot
   * every run after the second read that way, which is what a person watching
   * concluded. Driven off the steps rather than off the sentences.
   */
  check(lineFor({ step: "declined", kind: "duplicate", detail: "x" }).tone === "supply",
    "264 · a duplicate is drawn as supply");
  check(lineFor({ step: "nothing-proposable", considered: 2 }).tone === "supply",
    "264a · and so is a snapshot with nothing proposable in it");
  check(lineFor({ step: "declined", kind: "refused", detail: "x", status: 403 }).tone === "stopped",
    "264b · while a route refusing the credential keeps the stopped tone (negative control)");
  check(lineFor({ step: "declined", kind: "rejected", detail: "x" }).tone === "stopped",
    "264c · as does a person's rejection");

  const duplicateRun: RunStep[] = [
    { step: "paid", free: false, transaction: "0x1", network: "eip155:84532" },
    { step: "read", served: 2, ids: ["a1", "b2"] },
    { step: "selected", windowId: "a1", durationSeconds: 16 },
    { step: "declined", kind: "duplicate", detail: "x" },
    { step: "done" },
  ];
  const drawnSupply = supplyFrom(duplicateRun);
  check(drawnSupply?.kind === "duplicate" && drawnSupply.ids.length === 2, "265 · the supply state carries the windows the run considered");
  check(supplyFrom([{ step: "read", served: 2, ids: ["a1"] }, { step: "proposed", id: 1, clipHash: "0x", status: "pending" }]) === null,
    "265a · a run that proposed draws no supply state (negative control)");
  const sentence = drawnSupply === null ? "" : supplySentence(drawnSupply);
  check(/already a clip/.test(sentence) && !/Every window/.test(sentence),
    `265b · and its sentence claims only the window the run chose (${sentence.slice(0, 48)})`);
  /*
   * "Already proposed" is earned by the walk and by nothing else.
   *
   * `nothing-proposable` is a validation outcome: the run reaches it before
   * offering anything, so it knows nothing about what the ingest holds, and it
   * drew the stronger sentence with the wrong meaning. `cell-spent` is reachable
   * only by offering every window and being refused each time.
   */
  const unusable = supplyFrom([{ step: "read", served: 2, ids: ["a1", "b2"] }, { step: "nothing-proposable", considered: 2 }]);
  check(unusable?.kind === "unusable", `265c · a run that could validate none of them says so (${unusable?.kind})`);
  check(unusable !== null && /could become a proposal/.test(supplySentence(unusable)) && !/already been proposed/.test(supplySentence(unusable)),
    "265d · and never claims they were already proposed");
  const spent = supplyFrom([{ step: "read", served: 2, ids: ["a1", "b2"] }, { step: "cell-spent", considered: 2 }]);
  check(spent?.kind === "exhausted" && /already been proposed/.test(supplySentence(spent)),
    "265e · while the walk that offered every one of them does claim it");

  /*
   * The strips are driven by their arrays, in both directions.
   *
   * Matching the four ids by name passed a fifth destination with no screen, and
   * the indicator's column count was written into the stylesheet where nobody
   * edits it at the same time as the array.
   */
  /*
   * Four destinations, and Run is not one of them until there is a run.
   *
   * Run present and inert would be a control that does nothing, which is the rule
   * that keeps a drawn but unbuilt action off this page. Not yet was the fifth: a
   * tab of what this repository does not do, drawn at a reader who had not yet
   * seen the working surface it is about. It is in `DISCLOSURE.md` now.
   */
  check(SCREENS.length === 4, `266 · four destinations in the array (${SCREENS.length})`);
  check(SCREENS[0].id === "board", `266f · beginning with the board, since the onboarding is the way in and not a destination (${SCREENS[0].id})`);
  check(!screensFor(false).some(d => d.id === "run"), "266g · and Run is absent when no run is in progress");
  check(screensFor(true).some(d => d.id === "run"), "266h · and present while one is (negative control)");
  check(ACCOUNT_TABS.length === 4, `266a · and four account tabs (${ACCOUNT_TABS.length})`);
  const withoutBranch = SCREENS.filter(d => d.id !== "run" && !new RegExp(`screen === "${d.id}"`).test(ui));
  check(withoutBranch.length === 0, `266b · every destination but the default has a branch (${withoutBranch.map(d => d.id).join(", ") || "none"})`);
  const withoutTab = ACCOUNT_TABS.filter(t => t.id !== "names" && !new RegExp(`accountTab === "${t.id}"`).test(ui));
  check(withoutTab.length === 0, `266c · and every tab but the default has one (${withoutTab.map(t => t.id).join(", ") || "none"})`);
  check(/var\(--xv-strip-n, 4\)/.test(css) && /"--xv-strip-n": screensFor\(/.test(ui),
    "266d · the indicator's columns come from the array rather than from a constant in the stylesheet");
  check(!/\/ 4\)/.test(css), "266e · and no strip arithmetic hard-codes four");

  /*
   * The plan is five nodes, and a node lights from its own event.
   *
   * The propose node is the reason the rule is written that way. A run on a
   * deployment with no ingest credential ends at not-submitted, and a stepper
   * that lit propose because pay and read had happened would draw a proposal that
   * never left the machine, on the deployment where that is exactly what happens.
   */
  check(PLAN.length === 5, `267 · the plan is five nodes (${PLAN.length})`);
  const atRest = planFrom(false, false, []);
  check(atRest.every(x => !x), "267a · and none of them is lit at rest");

  const notSubmitted: RunStep[] = [
    { step: "presenting" },
    { step: "paid", free: false, transaction: "0x1", network: "eip155:84532" },
    { step: "read", served: 2, ids: ["a1", "b2"] },
    { step: "selected", windowId: "a1", durationSeconds: 16 },
    { step: "not-submitted", detail: "no ingest credential is configured on this deployment" },
    { step: "done" },
  ];
  const litOnDeployment = planFrom(true, true, notSubmitted);
  check(litOnDeployment[2], "267b · a run that paid and read lights that node");
  check(!litOnDeployment[3], "267c · and a run that stopped before submitting never lights propose");
  const proposed: RunStep[] = [...notSubmitted.slice(0, 4), { step: "proposing", windowId: "a1" }, { step: "done" }];
  check(planFrom(true, true, proposed)[3], "267d · while a run that did submit lights it (negative control)");

  /*
   * 268 to 268c are retired with the marks they counted.
   *
   * They read the three svgs above the fold's verb tiles. The tiles are gone and
   * so are the marks, and a corpus of none makes the three filters below the
   * count pass by having nothing to look at. What still holds the rules over the
   * svgs the page does draw is check 216 for width and height and 212b for the
   * agent hue being a token and never a literal.
   */

  /*
   * The rolodex: the leaf being read is level and at full opacity, always.
   *
   * The site's own rule at its narrow breakpoint and the reviewer's: partial
   * opacity on text being read is a contrast loss, not a flourish. Read off the
   * rules rather than the markup, because the three positions are what carry it.
   */
  // Its own parse, because the shared one is declared further down this file.
  const rollLive = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rollRules = [...rollLive.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1], body: m[2] }));
  const positionRule = (name: string) =>
    rollRules.find(r => new RegExp(`\\.ag-roll-card\\[data-position="${name}"\\]`).test(r.selector) && /transform:/.test(r.body));
  const current = positionRule("current");
  check(current !== undefined && /opacity:\s*1/.test(current.body), "281 · the card being read is at full opacity");
  check(current !== undefined && /rotateX\(0deg\)/.test(current.body), "281a · and level");
  // The slot the leaf tips into is named `previous` now, because it is drawn
  // rather than hidden: a wheel shows its neighbours, so the card just read stays
  // on screen faded above and the next waits faded below.
  const previous = positionRule("previous");
  const next = positionRule("next");
  const away = positionRule("away");
  check(previous !== undefined && /rotateX\(-42deg\)/.test(previous.body), "281b · the leaf that tipped away carries the site's own angle");
  check(next !== undefined && /rotateX\(42deg\)/.test(next.body), "281c · and the one waiting carries its opposite");
  check(previous !== undefined && /transition-duration:\s*160ms/.test(previous.body), "281d · with the exit faster than the entrance");
  const faded = (body: string | undefined) => /opacity:\s*0?\.3[0-9]/.test(body ?? "");
  check(faded(previous?.body) && faded(next?.body), "281e · both neighbours are drawn faded rather than hidden");
  // Drawn nowhere is `display: none` now rather than a transparent card: a
  // neighbour is a title in its own row, and a fourth card in that row would take
  // the space whether or not anybody could see it.
  const awayRule = rollRules.find(r => /\.ag-roll-card\[data-position="away"\]/.test(r.selector));
  check(awayRule !== undefined && /display:\s*none/.test(awayRule.body), "281f · while every other state is drawn nowhere (negative control)");

  // The projected box is wider than the card, so the region clips rather than
  // hides: hidden would make it a scroll container.
  const stage = rollRules.find(r => /\.ag-roll-stage/.test(r.selector));
  check(stage !== undefined && /overflow-x:\s*clip/.test(stage.body), "282 · the stage clips the projection");
  check(stage !== undefined && !/overflow-x:\s*hidden/.test(stage.body), "282a · and never hides it");

  // Reduced motion drops the tip entirely rather than shortening it.
  const reduced = rollLive.slice(rollLive.indexOf("@media (prefers-reduced-motion: reduce), (max-width: 30rem)"));
  check(/transform:\s*none/.test(reduced.slice(0, 600)), "282b · reduced motion and a narrow screen drop the tip");

  // Every line is a card, so the log and the stack cannot disagree.
  // Read the Rolodex block, as 279c reads the Settings one. Off the whole file
  // the feed's own map satisfied it, so cards built from a slice stayed green.
  // Anchored on the next declaration by name, and asserted non empty, because the
  // last anchor was a function that got renamed and the slice silently became the
  // rest of the file.
  const rolodexStart = ui.indexOf("function Rolodex(");
  const rolodexEnd = ui.indexOf("function Enrol(");
  const rolodexBlock = rolodexStart >= 0 && rolodexEnd > rolodexStart ? ui.slice(rolodexStart, rolodexEnd) : "";
  check(rolodexBlock.length > 0 && rolodexBlock.length < ui.length / 2, `283c · the rolodex block is found and is a block (${rolodexBlock.length})`);
  const maps = (rolodexBlock.match(/lines\.map\(\(line, i\) =>/g) ?? []).length;
  check(maps === 2 && /data-position=/.test(rolodexBlock), `283 · every line the log holds is a card and a node on the rail (${maps} maps over the lines)`);
  check(!/lines\.slice/.test(rolodexBlock), "283b · and none of them is dropped before either is built");
  /*
   * Reachable by the rail rather than by a pager.
   *
   * This asserted a Back and a Forward, which said where a person was in a number
   * and gave them no way to see what the run had done. Each state has its own node
   * now and the node steps to its own index, which is a stronger claim than two
   * arrows: a pager reaches every line by walking, a rail reaches each one at once.
   */
  check(/onClick=\{\(\) => onStep\(i\)\}/.test(rolodexBlock), "283a · and every one of them is reachable from its own node");
  check(!/onStep\(at - 1\)|onStep\(at \+ 1\)/.test(ui), "283d · with no pager left to walk them one at a time");

  /*
   * 236 to 236d are retired with the ladder they measured.
   *
   * They held six rungs to two present tense sentences each, a negative second,
   * no figure and no conditional future. The tab is gone: it was drawn at a
   * reader who had not yet seen the working surface it is about, and the page
   * now states what it does while `DISCLOSURE.md` states what it does not. The
   * five still-true pairs are under "Designed and not running" there, word for
   * word, and the gateway key negative is kept in "Built and running" beside the
   * gateway it is about. What still binds the page to one of them is check 253,
   * which reads the mainnet sentence out of that document and requires the
   * footer to state the same one.
   */
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
   *
   * And over what a control says rather than what it carries. A board cell reports
   * its own lifecycle in a data attribute whose value is a state name, and reading
   * the raw chunk counted `data-life="confirmed"` as a control offering to confirm
   * a clip. Attribute values go, except the handful a person actually reads, which
   * are exactly where a Confirm label could hide from a check that dropped them
   * all.
   */
  const decision = /\b(confirm|approve|reject|accept|decide|attest)\w*\b/i;
  const READABLE = /^(aria-label|title|alt|placeholder|value)$/;
  const saidBy = (control: string) =>
    control
      .replace(/([a-zA-Z-]+)=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/g, (whole, name: string) => (READABLE.test(name) ? whole : " "))
      // Comments too: a note above an attribute saying why a border turns teal is
      // neither a label nor an attribute, and it matched before this line existed.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/<\/?[a-zA-Z][^\s/>]*/g, " ");
  const controls = ui.split("<button").slice(1).map(chunk => chunk.slice(0, chunk.indexOf("</button>")));
  const deciding = controls.filter(c => decision.test(saidBy(c)));
  check(controls.length > 0, `227 · the interface has controls to read (${controls.length})`);
  check(deciding.length === 0, `227a · and not one of them is a decision about a clip (${deciding.length})`);
  check(decision.test(saidBy(' type="button" onClick={() => go()}>Confirm this clip</button>')),
    "227b · the check reads a label that decides (negative control)");
  check(decision.test(saidBy(' aria-label="Reject it" onClick={() => go()}>Go</button>')),
    "227c · including one carried where only a screen reader hears it (negative control)");
  check(!decision.test(saidBy(' data-life={x ? "confirmed" : "proposed"}>2026-09-04</button>')),
    "227d · while a state a control reports about itself is not a decision it offers");
  check(!decision.test(saidBy(' /* teal once one has decided */ type="button">2026-09-04</button>')),
    "227e · nor prose in a comment about why the control looks as it does");

  // A settlement is linked by the chain the receipt names rather than by a chain
  // the page assumes, so a receipt from anywhere else is drawn without a link
  // instead of with a confident wrong one.
  check(/explorerOrigin\(object\.network\)/.test(ui), "228 · the explorer is chosen by the chain the receipt names");
  check(/"0x14a34": "https:\/\/sepolia\.basescan\.org"/.test(ui), "228a · and Base Sepolia is the one that settles here");
  // One table for one chain. Two of them, keyed by hex and by CAIP-2, was two
  // places for an origin to be right in and one for it to be wrong.
  const origins = [...ui.matchAll(/https:\/\/[a-z.]*basescan\.org/g)].map(m => m[0]);
  check(new Set(origins).size === 1 && origins.length === 1, `228b · named once and in one table (${origins.length})`);

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
  const FAMILIES: Record<string, string[]> = {
    "ag-tone-": ["good", "working", "stopped", "supply"],
    "ag-actor-": ["human", "agent", "system"],
    // The status chip's four, from `StatusChip`. `ag-chip-name` and
    // `ag-chip-action` are written whole where they are used and arrive as tokens.
    "ag-chip-": ["idle", "working", "good", "stopped"],
  };
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
