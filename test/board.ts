import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as boardGET } from "../app/api/agent/board/route";
import { GET as windowsGET } from "../app/api/agent/windows/route";
import { GET as registrationGET } from "../app/api/agent/registration/route";
import { POST as namePOST } from "../app/api/agent/name/route";
import { setClockForTest } from "../lib/human/clock";
import { ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS, enrollmentThrottle } from "../lib/human/throttle";
import { readFileSync } from "node:fs";
import { setRegistryForTest } from "../lib/human/registry";
import { capFrom, setCapForTest, standingBehind, takeFreeRead } from "../lib/human/cap";
import { ensureCredential } from "../lib/agent/credentials";
import { enrolledSeam, setEnrolledForTest } from "../lib/agent/enrolled";
import { fakeStore, fakeVerifications } from "./human";
import { CREDENTIAL_REFUSED, newestRecording, NO_CREDENTIAL, enrolmentState, opensTheBoard, ROLL_DWELL_MS, SCREENS, credentialPill, identityChips, lineFor, namePill, registrationLine, registrationPill, rollPosition, screensFor } from "../app/app-shell";
import { BOARD_SPECIES, DayUnknown, boardFrom, cellOf, cellState, loadSnapshot } from "../lib/windows/snapshot";
import { NOT_SUBMITTED_SENTENCE } from "../lib/agent/run";
import { resetServerForTest } from "../lib/x402";

type Check = (ok: boolean, label: string) => void;

function window(videoId: string, species: string, produced: string, id: string) {
  return {
    schema: "xovi/candidate-window/v1",
    windowId: id,
    channelId: "UCchannel",
    videoId,
    startTime: 10.5,
    endTime: 24.5,
    stationId: species === "dumerilii" ? "AD" : "AM 1",
    speciesCode: species,
    specimenAlias: null,
    candidates: ["Alfa", "Beta"],
    behaviorTag: null,
    truncatedByCap: false,
    continuesPrevious: false,
    confidence: 500,
    reason: "a sentence long enough to pass the validator",
    detector: "t@0",
    producedAt: produced,
  };
}

export async function boardChecks(check: Check) {
  console.log("\n  the board, per day and per species");

  const dir = mkdtempSync(join(tmpdir(), "board-"));
  writeFileSync(join(dir, "windows.aaa.jsonl"), `${JSON.stringify(window("aaa", "mexicanum", "2026-09-03T10:00:00Z", "m1"))}\n${JSON.stringify(window("aaa", "mexicanum", "2026-09-03T11:00:00Z", "m2"))}\n`);
  writeFileSync(join(dir, "windows.bbb.jsonl"), `${JSON.stringify(window("bbb", "dumerilii", "2026-09-04T10:00:00Z", "d1"))}\n`);
  // A README beside them, which a directory read must not try to parse.
  writeFileSync(join(dir, "README.md"), "not a window\n");
  // Every file says which day it is; there is no fallback to fall back to.
  writeFileSync(join(dir, "windows.aaa.jsonl.day"), "2026-09-03\n");
  writeFileSync(join(dir, "windows.bbb.jsonl.day"), "2026-09-05\n");

  const before = process.env.WINDOWS_SNAPSHOT;
  const payToBefore = process.env.X402_PAY_TO;
  process.env.WINDOWS_SNAPSHOT = dir;
  // Configured, so a filled cell answers 402 rather than the unconfigured 503.
  // Both are past the cell check, and only one of them proves what 272c claims.
  process.env.X402_PAY_TO = "0x000000000000000000000000000000000000dEaD";
  resetServerForTest();

  const all = loadSnapshot();
  check(all.length === 3, `269 · a directory loads every file in it (${all.length})`);
  check(all.filter(w => w.day === "2026-09-03").length === 2, "269a · every file says which day its footage belongs to");
  check(all.filter(w => w.day === "2026-09-05").length === 1, "269b · and from the sidecar where one does, which the detector's clock is not");

  /*
   * A file read as part of a set says which day it is, or the set refuses.
   *
   * The fallback is wrong in one direction and silent about it: `producedAt` is
   * when the detector ran, so footage processed later than it was recorded is
   * filed too late, plausibly. It happened, seven weeks late, and nothing in the
   * answer showed it. A named file still needs no sidecar, because the checks and
   * the local demonstration name theirs and the day is not what they are for.
   */
  writeFileSync(join(dir, "windows.ccc.jsonl"), `${JSON.stringify(window("ccc", "mexicanum", "2026-09-06T10:00:00Z", "c1"))}\n`);
  let undatedRefusal: unknown = null;
  try {
    loadSnapshot();
  } catch (err) {
    undatedRefusal = err;
  }
  check(undatedRefusal instanceof DayUnknown, "269c · a file with no sidecar refuses the whole set");
  check(String((undatedRefusal as Error)?.message ?? "").includes("windows.ccc.jsonl"), "269d · naming the file rather than a count");
  writeFileSync(join(dir, "windows.ccc.jsonl.day"), "2026-09-06\n");
  check(loadSnapshot().length === 4, "269e · and is read once it says which day (negative control)");

  const board = boardFrom(all);
  check(board.days.join(",") === "2026-09-03,2026-09-05", `270 · the board's days are the days the files carry (${board.days.join(",")})`);
  check(board.cells.length === board.days.length * 3, `270a · three species on every day (${board.cells.length})`);
  check(board.cells.some(c => c.species === "andersoni" && !c.onOffer), "270b · andersoni is drawn where no stream exists, as its negative");
  check(BOARD_SPECIES.length === 3, "270c · and the board draws three species");

  const served = (await (await boardGET()).json()) as { days: string[]; cells: Record<string, unknown>[] };
  const keys = [...new Set(served.cells.flatMap(c => Object.keys(c)))].sort();
  check(keys.join(",") === "day,onOffer,species", `271 · a cell carries three fields (${keys.join(",")})`);
  /*
   * No count, and no field a count could be read out of.
   *
   * The files are public in this repository, so a count served here is the
   * embargo drop by subtraction: the rows in the file minus the rows offered is
   * the number withheld, which is the one number the embargo exists to keep.
   */
  const body = JSON.stringify(served);
  check(!/\d+/.test(body.replace(/2026-\d\d-\d\d/g, "")), "271a · and no number outside a date reaches the board");
  check(!/station|alias|AM 1|AD\b/.test(body), "271b · nor any station or alias");

  /*
   * An empty or unknown cell is answered before the payment, so nobody pays for
   * nothing. Asserted by the status: a 402 here would mean the caller was asked
   * for a cent before being told the cell is empty.
   */
  const empty = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=2026-09-03&species=dumerilii"));
  check(empty.status === 404, `272 · an empty cell is 404 and not a 402 (${empty.status})`);
  const unknownDay = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=1999-01-01&species=mexicanum"));
  check(unknownDay.status === 404, `272a · and so is a day with nothing on it (${unknownDay.status})`);
  const badSpecies = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=2026-09-03&species=notaspecies"));
  check(badSpecies.status === 400, `272b · a species the board does not draw is refused (${badSpecies.status})`);
  // The control asserts what it can see without a facilitator running: a filled
  // cell is not answered by the cell check at all. Whether the payment path then
  // answers 402 or 503 is about the facilitator and is asserted elsewhere; what
  // matters here is that the early refusal did not fire.
  const filled = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=2026-09-03&species=mexicanum"));
  const filledBody = JSON.stringify(await filled.json());
  check(filled.status !== 404 && filled.status !== 400, `272c · while a cell with windows in it passes the cell check (negative control, ${filled.status})`);
  check(!filledBody.includes("on offer"), "272d · and is never told its cell is empty");

  /*
   * Serving drops nothing. The screening happens before a file is committed, so a
   * cell's served set is the file's set; anything else makes a board that says
   * none the withheld set by subtraction.
   */
  const cell = cellOf(all, "2026-09-03", "mexicanum");
  check(cell.length === 2, `273 · the cell holds what the file holds (${cell.length})`);
  const { applyEmbargo } = (await import("../lib/windows/embargo")) as typeof import("../lib/windows/embargo");
  const gated = applyEmbargo(cell);
  check(gated.kept.length === cell.length && gated.dropped === 0,
    `273a · and the runtime gate removes none of it (${gated.dropped} dropped)`);

  /*
   * The gate runs in front of the payment, and a cell that loses anything to it
   * refuses rather than shrinking.
   *
   * 273a was true in CI by construction, because no embargo list is set there. A
   * list naming a candidate the file carries is the probe: without this, a
   * deployment that sets one would serve an empty set after the 402 while the
   * board still said the cell was on offer, which is the person paying for
   * nothing and the withheld set by subtraction in the same answer.
   */
  const embargoBefore = process.env.EMBARGOED_ALIASES;
  process.env.EMBARGOED_ALIASES = "Alfa";

  const gatedState = cellState(all, "2026-09-03", "mexicanum");
  check(gatedState.kind === "unscreened", `274 · a cell the list touches is unscreened, not smaller (${gatedState.kind})`);
  const gatedBoard = boardFrom(all);
  check(!gatedBoard.cells.some(c => c.day === "2026-09-03" && c.species === "mexicanum" && c.onOffer),
    "274a · and the board does not offer it");
  /*
   * The status alone proves nothing here.
   *
   * This environment has no facilitator, so the resource server answers 503 to
   * any request it reaches, and a check on the status stays green with the gate
   * taken out of the route entirely. The sentence is the gate's own, so the body
   * is what distinguishes the two.
   */
  const GATE_SENTENCE = "not screened against the embargo list in force";
  const refused = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=2026-09-03&species=mexicanum"));
  const refusedBody = JSON.stringify(await refused.json());
  check(refused.status === 503 && refusedBody.includes(GATE_SENTENCE), `274b · the cell is refused by the gate and says so (${refused.status})`);
  check(!/\d+/.test(refusedBody.replace(/2026-\d\d-\d\d/g, "")), "274c · and says nothing of how many it would have dropped");

  process.env.EMBARGOED_ALIASES = "";
  const ungated = cellState(all, "2026-09-03", "mexicanum");
  check(ungated.kind === "offer", `274d · with no list in force the same cell is on offer (negative control, ${ungated.kind})`);
  // And the same request no longer carries the gate's sentence, so the 503 this
  // environment gives for want of a facilitator is told apart from the gate's.
  const ungatedAnswer = await windowsGET(new Request("http://127.0.0.1/api/agent/windows?day=2026-09-03&species=mexicanum"));
  check(!JSON.stringify(await ungatedAnswer.json()).includes(GATE_SENTENCE),
    "274e · and the route's answer stops carrying the gate's sentence (negative control)");
  if (embargoBefore === undefined) delete process.env.EMBARGOED_ALIASES;
  else process.env.EMBARGOED_ALIASES = embargoBefore;

  /*
   * The gate's three reads, and the one value that may not cross a wire.
   *
   * AgentBook answers with a nullifier, which is deterministic on the identity
   * and therefore the same for every agent one person registers: publishing it
   * would let anyone join a person's agents to each other. The route answers with
   * a word. Unread is an answer about the read and is kept apart from not
   * registered, because telling somebody to register when they already have is
   * the one wrong thing that card can do.
   */
  const noPayer = await registrationGET(new Request("http://127.0.0.1/api/agent/registration"));
  check(noPayer.status === 400, `278 · the registration read names a payer or refuses (${noPayer.status})`);
  const unread = await registrationGET(new Request("http://127.0.0.1/api/agent/registration?payer=0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe"));
  const unreadBody = (await unread.json()) as Record<string, unknown>;
  check(Object.keys(unreadBody).sort().join(",") === "agentCredential,credential,source,state", `278a · and answers with the state, the source, the credential and whether the agent's own is issued (${Object.keys(unreadBody).sort().join(",")})`);
  check(["registered", "not-registered", "unread"].includes(String(unreadBody.state)), `278b · which is one of the three states (${unreadBody.state})`);
  check([null, "agentbook", "worldid"].includes(unreadBody.source as never), `278g · and a source that is one of two words or none (${unreadBody.source})`);
  /*
   * The branch that actually holds a nullifier.
   *
   * With no registry configured every request took the unread branch, so the one
   * answer that has a nullifier in hand was never exercised and the check that
   * says none reaches the wire was reading the branch where none exists. A seam
   * drives a real one.
   */
  setRegistryForTest(async () => 88888888888888888888n);
  const registered = await registrationGET(new Request("http://127.0.0.1/api/agent/registration?payer=0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe"));
  const registeredBody = JSON.stringify(await registered.json());
  check(registeredBody.includes("registered"), `278c · a registered agent is answered as registered (${registeredBody})`);
  check(!/\d/.test(registeredBody), "278d · and the nullifier it held reaches no part of the body");
  setRegistryForTest(async () => 0n);
  const none = JSON.stringify(await (await registrationGET(new Request("http://127.0.0.1/api/agent/registration?payer=0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe"))).json());
  check(none.includes("not-registered"), `278e · and an unregistered one as not registered (negative control, ${none})`);
  setRegistryForTest(undefined);
  check(/\d/.test(JSON.stringify({ state: 12345n.toString() })), "278f · the digit check can see one (negative control)");

  /*
   * THE NAME REQUEST SHARES THE ENROLMENT'S COUNTER.
   *
   * It was unauthenticated and uncapped: every new address cost a registry read and
   * two chain reads before its refusal, which is work a stranger could ask for as
   * fast as they could open connections. One limiter for the three routes that
   * answer questions about a wallet, so a caller cannot spend each one's allowance
   * separately.
   *
   * Driven on a fake clock, and the cap is asserted to bite BEFORE the store is
   * consulted: with no database configured the route answers 503, so a 429 arriving
   * instead is the only evidence that nothing downstream was reached.
   */
  const CAPPED_NAME = "0x1111111111111111111111111111111111111122";
  const OTHER_NAME = "0x1111111111111111111111111111111111111133";
  const askName = (payer: string) =>
    namePOST(new Request("http://127.0.0.1/api/agent/name", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payer }) }));
  const T0 = new Date("2026-09-12T22:00:00Z");
  let nameClock = T0;
  setClockForTest(() => nameClock);
  enrollmentThrottle.reset();
  let lastName = await askName(CAPPED_NAME);
  for (let i = 1; i < ENROLLMENT_CALLS_PER_MINUTE; i++) lastName = await askName(CAPPED_NAME);
  check(lastName.status !== 429, `298 · the name request is answered up to the shared limit (${lastName.status})`);
  const overName = await askName(CAPPED_NAME);
  check(overName.status === 429 && Number(overName.headers.get("retry-after")) >= 1,
    `298a · and the next one is refused with a retry-after (${overName.status}, ${overName.headers.get("retry-after")})`);
  check(!JSON.stringify(await overName.json()).includes("store"),
    "298b · with the refusal taken before the store, whose own answer would have named it");
  check((await askName(OTHER_NAME)).status !== 429, "298c · another wallet was never held (negative control)");
  nameClock = new Date(T0.getTime() + ENROLLMENT_WINDOW_MS + 1);
  check((await askName(CAPPED_NAME)).status !== 429, "298d · and a minute later the same wallet is answered again (negative control)");
  enrollmentThrottle.reset();
  setClockForTest(undefined);

  /*
   * THE SEAM'S OWN DEFAULT, WHICH NO INJECTED FAKE CAN REACH.
   *
   * `enrolledSeam` answers whether a person stands behind a wallet, and the name
   * route asks it for every wallet AgentBook does not know. Every other check in
   * the suite injects that seam, so the default the deployment actually runs was
   * exercised by nothing: replacing it with `async () => false`, which is what it
   * was before the enrolment existed, left the whole suite green. That default
   * refuses a name to exactly the people the enrolment was built for.
   *
   * Driven with nothing injected, through a cap whose two sources are fakes, so
   * the answer comes from the real function.
   */
  setEnrolledForTest(undefined);
  const seamTable = fakeVerifications();
  const ENROLLED_HERE = "0x5555555555555555555555555555555555555551";
  const KNOWN_TO_NEITHER = "0x5555555555555555555555555555555555555552";
  const seamAt = new Date("2026-09-12T22:00:00Z");
  seamTable.rows.set(ENROLLED_HERE.toLowerCase(), {
    payer: ENROLLED_HERE.toLowerCase(),
    action: "enrol-agent",
    nullifierDigest: "a".repeat(64),
    credential: "proof_of_human",
    verifiedAt: seamAt,
    expiresAt: new Date(seamAt.getTime() + 86_400_000),
  });
  setClockForTest(() => seamAt);
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: seamTable, freePerDay: 1 });
  check(await enrolledSeam()(ENROLLED_HERE), "299 · a wallet the page enrolled stands behind a person, where AgentBook says it does not");
  check(!(await enrolledSeam()(KNOWN_TO_NEITHER)), "299a · and a wallet neither source knows does not (negative control)");
  setCapForTest({ registry: async () => 12345n, store: fakeStore(), verifications: seamTable, freePerDay: 1 });
  check(await enrolledSeam()(KNOWN_TO_NEITHER), "299b · while AgentBook alone is still enough (negative control)");
  setCapForTest(null);
  setClockForTest(undefined);

  const page = readFileSync("app/app-shell.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  check(/registrationLine\(/.test(page), "279 · the gate draws the registry's answer as a sentence per state");
  // Driven through the function rather than read off the file, so the sentence is
  // checked where it is decided and the check survives the copy moving.
  check(registrationLine("unread", null) === "The registry did not answer, so this says nothing about whether a person is behind this agent.",
    "279a · with unread saying nothing about the agent");
  check(!/identifies nobody|verified person|World App/.test(page),
    "279d · and the gate carries no sentence that is the legal lead's or names a third party's product");
  /*
   * Both sentences inverted, and for the same reason: they were true of a page
   * that could not enrol anybody.
   *
   * `Registering is not done here` stopped being true the moment this page could
   * do it, and `No path issues one from this page` stopped being true when a
   * request route existed. Each is now refused by name, with the sentence that
   * replaced it required beside it, so neither can come back quietly.
   */
  /*
   * Swept over every file the interface is built from, not over the shell alone.
   *
   * The copy moved into two card components when they landed, and a check anchored
   * on the shell would have gone quiet rather than gone red. It went red, which is
   * how this was found; the fix is to sweep the directory the page is assembled
   * from, with the corpus counted so an empty read cannot pass for a clean one.
   */
  const uiFiles = readdirSync("app").filter(f => f.endsWith(".tsx"));
  const ui = uiFiles.map(f => readFileSync(join("app", f), "utf8")).join("\n");
  check(uiFiles.length >= 3, `279b0 · the interface sweep reads every file the page is built from (${uiFiles.length})`);
  check(!/Registering is not done here/.test(ui), "279b · and neither sentence the enrolment falsified is left in any of them");
  check(!/No path\s+issues one from this page/.test(ui.replace(/\s+/g, " ")), "279b2 · including the one about issuing a name");
  check(/resolved through Zenbit's gateway, without a transaction/.test(ui),
    "279b3 · which says instead how a name is issued (negative control)");
  // The sentence it replaced said a person signs a transaction for every name, which
  // stopped being true when a row became the issuance.
  check(!/by hand from its own key/.test(ui), "279b4 · and no longer says a key is what issues one");

  /*
   * TWO SOURCES ANSWER ONE QUESTION, AND THE PAGE SAYS WHICH.
   *
   * AgentBook holds registrations made outside this page and a World ID
   * verification made in it holds its own. `registered` without a source is two
   * different facts wearing one word, and a reader who wants to check the claim
   * has to know which of them to read.
   *
   * **A source the route did not name is not filled in here.** That is the one
   * that matters: the page already drew a positive from a non answer once, on a
   * chain badge that read Base Sepolia when no chain had answered, and this is the
   * same shape one card along. Null credits nobody.
   */
  check(registrationPill("done", "agentbook") === "registered in AgentBook", "294 · the pill credits AgentBook where AgentBook answered");
  check(registrationPill("done", "worldid") === "registered by World ID", "294a · and World ID where the page enrolled the wallet");
  check(registrationPill("done", null) === "registered", "294b · and names no source at all where the answer named none");
  check(registrationPill("todo", "worldid") === "not yet" && registrationPill("waiting", "agentbook") === "waiting",
    "294c · a step not done credits nothing whatever a source says (negative control)");

  const lineNamed = registrationLine("registered", "worldid");
  const lineUnnamed = registrationLine("registered", null);
  check(lineUnnamed === "A registration stands behind this agent.", "295 · the sentence for a source the route did not name claims no source");
  check(lineNamed !== lineUnnamed && /World ID/.test(lineNamed), "295a · and a named source changes it (negative control)");
  check(!/AgentBook/.test(lineUnnamed) && !/World ID/.test(lineUnnamed), "295b · with neither source named in the unnamed sentence");

  /*
   * What the verification keeps, on the card that offers it.
   *
   * The retention and the purpose are the ruling's conditions and they are stated
   * where the person decides, not only in a document they will not open. The
   * clause about the digest is the one that must not drift: what is kept is a
   * keyed derivation and never the identifier.
   */
  const worldCard = readFileSync("app/world-id-card.tsx", "utf8");
  const declared = /export const KEEPS_SENTENCE\s*=\s*\n?\s*"([^"]+)";/.exec(worldCard);
  check(declared !== null, "296 · the sentence saying what verifying keeps is declared once, as a constant (negative control for the read)");
  const kept = (declared?.[1] ?? "").replace(/\s+/g, " ");
  check(/keyed digest of your World ID identifier/.test(kept) && /thirty days/.test(kept) && /count free reads/.test(kept) && /never the identifier/.test(kept),
    `296a · and says what is kept, for how long, what for, and what is never kept (${kept || "nothing read"})`);
  // Drawn from the constant rather than retyped beside it, so the copy on the screen
  // and the sentence a document quotes cannot drift into disagreeing.
  check(/\$\{KEEPS_SENTENCE\}/.test(worldCard), "296c · and the card draws that constant rather than a second copy of it");
  const uiRendered = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(!/\bnullifier\b/i.test(uiRendered), "296b · with the value itself named nowhere the interface renders");
  check(/\bnullifier\b/i.test("the nullifier"), "296d · the value check can see the word (negative control)");
  /*
   * WHAT THE ALLOWANCE IS COUNTED AGAINST, SAID AS THE COUNTER KEYS IT.
   *
   * `takeFreeRead` keys on the digest of the identifier, which is the person, and
   * the card said the reads counted against the wallet. Those differ in the one
   * direction that matters: the whole feature exists because a limit on an address
   * is defeated by making addresses, so a sentence promising a per wallet count
   * describes the thing this was built to prevent.
   */
  const registeredLine = /"Registered by World ID\.([^"]*)"/.exec(worldCard)?.[1] ?? "";
  check(registeredLine.length > 0, "296e · the card's registered sentence is found (negative control for the read)");
  // The refusal is on the affirmative form only. A first version banned the phrase
  // "against the wallet" outright and turned red on the corrected sentence, which
  // says the reads are NOT counted against it: a negative and a claim share their
  // words and only the verb tells them apart.
  const countsWallet = /counts? against (this|the) wallet/;
  check(/counts? against the person/.test(registeredLine) && !countsWallet.test(registeredLine),
    `296f · and it counts the free reads against the person rather than the wallet (${registeredLine.trim() || "nothing read"})`);
  check(countsWallet.test("Free reads count against this wallet from now."),
    "296g · the wallet claim the card used to make is one this check refuses (negative control)");

  /*
   * The two components mount in slots, and the slots take the wallet.
   *
   * Each leg delivers its own card; this file owns their place in the checklist.
   * A slot that took no payer would be a card that could not act on the account in
   * front of it, which is worth catching before the component lands rather than
   * after.
   */
  check(/<WorldIdCard\s+payer=\{address\}\s+onRegistered=\{onRetry\}\s*\/>/.test(page),
    "297 · the World ID card is mounted with the connected wallet and re-reads the registration when it succeeds");
  // The name card moved out of the checklist and behind the header's own chip:
  // it is offered, never required, which is the founder's ruling.
  check(/<NameCard\b/.test(page) && /onRequest=\{\(\) => void onRequestName\(\)\}/.test(page),
    "297a · and the name card is mounted with the request the shell sends");
  // The word in the name card's pill is the checklist's, because only the checklist
  // knows the step before it is unfinished; `waiting` exists in no other vocabulary.
  check(/pill=\{namePill\(nameState, "todo"\)\}/.test(page), "297b · with the checklist's own word in its pill");
  check(/onName=\{\(\) => nameDialog\.current\?\.showModal\(\)\}/.test(page) && /no name · get one/.test(page),
    "297c · and the header offers it rather than the board requiring it");
  /*
   * A STEP ALREADY DONE DRAWS NO CONTROL FOR DOING IT.
   *
   * A registered wallet was shown a Verify with World ID button under a card that
   * already said it was registered, which is a control that can only tell somebody
   * they were wrong about where they are.
   */
  const enrolBlock = page.slice(page.indexOf("function Enrol("), page.indexOf("/**\n * The board: what is on offer"));
  check(enrolBlock.length > 0, "297d · the enrolment card is found (negative control for the slice)");
  check(/\{registration !== "registered" && <WorldIdCard/.test(enrolBlock),
    "297e · the verification is offered only to a wallet that has not made one");
  const enrolControls = [...enrolBlock.matchAll(/<button[\s\S]{0,200}?onClick=\{([^}]*)\}/g)].map(m => m[1]);
  check(enrolControls.length >= 2 && enrolControls.every(c => /onRetry|onSkip/.test(c)),
    `297f · and the card's own controls are the read again and the refusal (${enrolControls.join(" | ") || "none"})`);

  /*
   * EVERY CONTROL ON THE THREE CARDS LOOKS LIKE ONE.
   *
   * They carried the section strip's class, which is transparent, borderless and
   * at 0.65 opacity: correct for a strip and, on a card, a control that renders as
   * a sentence. A person on the served page saw Verify with World ID and Check
   * again as text and had nothing to press, which is the same defect as a control
   * that does nothing, arrived at from the other side.
   *
   * Read across all three cards, two of which are their own files, with the count
   * of controls compared against the count this read could classify so a button
   * with no class is a red line rather than a silent omission.
   */
  const onboardingStart = page.indexOf("function Enrol(");
  const onboardingEnd = page.indexOf("function Board(");
  check(onboardingStart > 0 && onboardingEnd > onboardingStart, "309 · the onboarding block is found in the shell (negative control for the slice)");
  const cardSources = [page.slice(onboardingStart, onboardingEnd), readFileSync("app/world-id-card.tsx", "utf8"), readFileSync("app/name-card.tsx", "utf8")];
  const controls = cardSources.reduce((total, src) => total + (src.match(/<button\b/g) ?? []).length, 0);
  const classes = cardSources.flatMap(src => [...src.matchAll(/<button\b[\s\S]{0,400}?className="([^"]*)"/g)].map(m => m[1]));
  check(controls >= 3 && classes.length === controls, `309a · every control on the cards was read with its classes (${classes.length} of ${controls})`);
  const notButtons = classes.filter(c => !/\bbtn\b/.test(c) || !/\bxv-action(-outline)?\b/.test(c));
  check(notButtons.length === 0, `309b · and each carries the page's own button, filled or outlined (${notButtons.join(" | ") || "all do"})`);
  const linkish = classes.filter(c => /\bag-link\b|\bag-rail-item\b|\bag-tab\b/.test(c));
  check(linkish.length === 0, `309c · and none of them is styled as a link or a strip item (${linkish.join(" | ") || "none"})`);
  check(/\bag-rail-item\b/.test('className="ag-rail-item ag-setup-do"'), "309d · the strip class this refuses is one it can see (negative control)");
  // The press, which is the half a class cannot carry: the filled and outlined
  // forms give the hue and the focus ring, and the card's own rule gives the
  // feedback that the control heard the person, dropped where movement is refused.
  const sheet = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const press = /\.ag-setup-do:active\s*\{[^}]*transform:\s*scale\(0?\.9[0-9]\)/.test(sheet);
  const stillUnderReduced = /prefers-reduced-motion[^{]*\{[\s\S]*?\.ag-setup-do:active\s*\{[^}]*transform:\s*none/.test(sheet);
  check(press && stillUnderReduced, `309e · the controls press and stop pressing where movement is refused (${press}, ${stillUnderReduced})`);

  /*
   * THE WHEEL: EVERY STATE IS A CARD, AND THREE OF THEM ARE ON SCREEN.
   *
   * The steps arrive in a burst, so of ten states two or three were seen and the
   * rest passed unrendered. Every one is still its own card and the wheel walks
   * them one at a time; what this counts is that a burst of ten leaves ten cards
   * with exactly one in the middle and one neighbour on each side.
   */
  const burst = 10;
  const slotsAt = (at: number) => Array.from({ length: burst }, (_, i) => rollPosition(i, at));
  const middle = slotsAt(3);
  check(middle.length === burst, `312 · a burst of ten states leaves ten cards (${middle.length})`);
  check(middle.filter(p => p === "current").length === 1, "312a · with exactly one of them in the middle");
  check(middle.filter(p => p === "previous").length === 1 && middle.filter(p => p === "next").length === 1,
    "312b · and one neighbour above and one below");
  check(middle.filter(p => p === "away").length === burst - 3, `312c · every other state drawn nowhere (${middle.filter(p => p === "away").length})`);
  check(slotsAt(0).filter(p => p === "previous").length === 0 && slotsAt(0).filter(p => p === "next").length === 1,
    "312d · at the first state nothing is above it");
  check(slotsAt(burst - 1).filter(p => p === "next").length === 0 && slotsAt(burst - 1).filter(p => p === "previous").length === 1,
    "312e · and at the last nothing is below it");
  check(ROLL_DWELL_MS >= 600 && ROLL_DWELL_MS <= 1500, `312f · each state holds the middle long enough to read (${ROLL_DWELL_MS}ms)`);
  // The pager still moves it, and the dwell stops while a person is holding one.
  check(/if \(pinned !== null\) return;/.test(page) && /setCursor\(c => c \+ 1\), ROLL_DWELL_MS\)/.test(page),
    "312g · the wheel turns on that timer and stops while a card is pinned");
  const roll = page.slice(page.indexOf("function Rolodex("), page.indexOf("function Enrol("));
  check(roll.length > 0 && /aria-hidden=\{current \? undefined : "true"\}/.test(roll) && /inert=\{!current\}/.test(roll),
    "312h · the neighbours are scenery: read by no screen reader and reachable by no keyboard");
  // And they carry a title and nothing else. Drawn whole they overlapped the state
  // being read, which is what the three rows and this branch fix together.
  check(/\{current \? \(/.test(roll) && /<p className="ag-roll-title">\{line\.text\}<\/p>/.test(roll),
    "312i · a neighbour is the state's title alone, never its content");
  /*
   * THE LINE OF STATES, AND WHAT EACH NODE SAYS.
   *
   * One node per state, a mark on every state already read, the one being read
   * marked apart, and the label on it. Ported from the site's own section rail
   * rather than invented: the same spine, dot, label and 300ms transitions.
   */
  const sheetRoll = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  check(/\.ag-steps-spine\s*\{[^}]*width:\s*2px/.test(sheetRoll), "324 · the rail carries the site's own spine");
  // Read as rules rather than as selectors: two selectors naming the pseudo
  // elements can sit above a block that draws nothing, which is what a first
  // version of this check could not tell apart.
  const doneStrokes = [...sheetRoll.matchAll(/\.ag-steps-item\[data-state="done"\] \.ag-steps-dot::(before|after)[^{]*\{([^}]*)\}/g)].map(m => m[2]);
  // Both halves, because either alone draws nothing: a pseudo element with no
  // `content` is not rendered at all, and two rendered boxes with no rotation are
  // a cross rather than a mark.
  const withContent = doneStrokes.filter(b => /content:\s*""/.test(b)).length;
  const rotated = doneStrokes.filter(b => /transform:\s*rotate\(/.test(b)).length;
  check(doneStrokes.length >= 2 && withContent >= 1 && rotated >= 2,
    `324a · a state already read is drawn as a mark, in two strokes rather than a glyph (${doneStrokes.length} rules, ${withContent} with content, ${rotated} rotated)`);
  check(/\.ag-steps-item\[data-state="at"\] \.ag-steps-dot\s*\{[^}]*transform:\s*scale\(1\.45\)/.test(sheetRoll),
    "324b · and the one being read is marked apart by the site's own scale");
  check(/data-state=\{i < at \? "done" : i === at \? "at" : "ahead"\}/.test(roll),
    "324c · the three states are the wheel's own arithmetic and not a second count");
  check(/aria-current=\{i === at \? "step" : undefined\}/.test(roll), "324d · with the one being read named to a screen reader");

  /*
   * THE DEFAULT HOME, BEFORE A WALLET.
   *
   * The onboarding's cards are about a wallet, and a checklist a person cannot act
   * on is a wall with steps painted on it, so at rest the page carries a recording
   * that plays and five cards saying what this is. The live channel is gone: its
   * embed draws a dead player whenever the museum is not broadcasting, and a page
   * whose first element is broken says something about the rest of it.
   */
  const homeStart = page.indexOf("function Home(");
  const homeEnd = page.indexOf("function Enrol(");
  check(homeStart > 0 && homeEnd > homeStart, "325 · the home is found (negative control for the slice)");
  const home = page.slice(homeStart, homeEnd);
  /*
   * The condition tied to the element rather than found somewhere on the page.
   *
   * `address === null` occurs more than once, so a first version matched another
   * branch entirely and stayed green while the home was rendered by nothing.
   */
  const homeAt = page.indexOf("<Home newest={newestRecording(board.cells)} />");
  check(homeAt > 0, "325a0 · the home is rendered (negative control for the read)");
  check(/address === null \? \($/.test(page.slice(Math.max(0, homeAt - 400), homeAt).replace(/[\s\S]*?(address === null \? \()/, "$1").split("\n")[0]) ||
    /address === null \? \(/.test(page.slice(Math.max(0, homeAt - 400), homeAt)),
    "325a · drawn when no wallet is connected, and its recording read off the board");
  check(!/live_stream/.test(page), "325b · with the live channel embedded nowhere");
  check(/youtube-nocookie\.com\/embed\/\$\{newest\.videoId\}/.test(home), "325c · and the recording on the host that sets no cookie");
  const newest = newestRecording([
    { day: "2026-09-04", onOffer: true, videoId: "older" },
    { day: "2026-09-09", onOffer: true, videoId: "newest" },
    { day: "2026-09-12", onOffer: false, videoId: "notOnOffer" },
  ]);
  check(newest?.videoId === "newest" && newest.day === "2026-09-09", `325d · the newest recording on offer is the one embedded (${JSON.stringify(newest)})`);
  check(newestRecording([{ day: "2026-09-04", onOffer: true }]) === null,
    "325e · and a board that serves no recording embeds none rather than guessing one");
  const cards = (home.match(/ag-process-card/g) ?? []).length;
  // The array itself, not the file around it: counting `title:` across the page
  // found nine, none of them these, and reading to the next function swept in a
  // comment whose own prose used the words this refuses.
  const processArray = /const PROCESS: \{ title: string; line: string \}\[\] = \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? "";
  check(processArray.length > 0, "325f0 · the process array is found (negative control for the read)");
  const titles = (processArray.match(/title: "/g) ?? []).length;
  check(titles >= 3 && titles <= 5, `325f · the process is three to five cards (${titles})`);
  check(cards === 1 && /PROCESS\.map/.test(home), "325g · drawn from one card of one kind");
  /*
   * No state on any of them, meaning no state of the person reading: these cards
   * know nothing about a wallet. A cell being on offer is the board's own
   * vocabulary rather than a state of anybody, so it is not among these.
   */
  const stateWords = processArray.match(/\b(not yet|waiting|done|registered|issued|requested|skipped|enrolled)\b/gi) ?? [];
  check(stateWords.length === 0, `325h · and says nothing about the reader's state (${stateWords.join(", ") || "none"})`);
  check(/\bnot yet\b/i.test("a card saying not yet"), "325i · the state check can see one (negative control)");
  const subRule = /\.ag-sub\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/font-size:\s*0\.75rem/.test(subRule), `325j · the descriptions are one step down the page's own scale (${/font-size:[^;]*/.exec(subRule)?.[0] ?? "none"})`);
  /*
   * Three rows, so a neighbour cannot sit on the state being read.
   *
   * They shared one cell and the projection put them over it. The rows are the
   * mechanism rather than the translate distances, which is why this reads the
   * template and the row each neighbour is placed in.
   */
  const stageBody = /\.ag-roll-stage\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  const rows = /grid-template-rows:([^;]*);/.exec(stageBody)?.[1]?.trim() ?? "";
  check(rows.split(/\s+(?![^(]*\))/).length === 3, `324f · the stage is three rows (${rows || "none read"})`);
  const rowOf = (name: string) => {
    const body = new RegExp(`\\.ag-roll-card\\[data-position="${name}"\\]\\s*\\{([^}]*)\\}`).exec(sheetRoll)?.[1] ?? "";
    return /grid-row:\s*(\d)/.exec(body)?.[1] ?? null;
  };
  check(rowOf("previous") === "1" && rowOf("current") === "2" && rowOf("next") === "3",
    `324g · with the state being read between its two neighbours (${rowOf("previous")}, ${rowOf("current")}, ${rowOf("next")})`);
  const stepTransitions = [...sheetRoll.matchAll(/\.ag-steps[^{]*\{([^}]*)\}/g)].map(m => m[1]).filter(b => /transition:/.test(b));
  const badSteps = stepTransitions.filter(b => !/transition:\s*(transform|opacity)/.test(b) || /\ball\b/.test(b));
  check(stepTransitions.length >= 2 && badSteps.length === 0,
    `324e · the rail moves on transform and opacity alone (${stepTransitions.length} rules, ${badSteps.length} otherwise)`);

  /*
   * One height, whatever state is in the middle. The dialog changed height from
   * card to card and the frame jumped under somebody reading it.
   */
  const sheetLive = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const dialogRule = /\.ag-run-dialog\s*\{[^}]*\}/.exec(sheetLive)?.[0] ?? "";
  check(/min-height:/.test(dialogRule) && /max-height:/.test(dialogRule), `313 · the dialog declares one height for every state (${dialogRule ? "found" : "no rule read"})`);
  const stageRule = /\.ag-roll-stage\s*\{[^}]*\}/.exec(sheetLive)?.[0] ?? "";
  check(/height:\s*[0-9]/.test(stageRule) && !/min-height/.test(stageRule), `313a · and the card area is a fixed height rather than a floor (${stageRule ? "found" : "no rule read"})`);

  /*
   * Run is a destination only while there is a run.
   */
  check(!screensFor(false).some(d => d.id === "run"), "314 · the strip carries no Run at rest or after one has finished");
  check(screensFor(true).some(d => d.id === "run"), "314a · and carries it while one is in progress (negative control)");
  check(/const runInProgress = phase === "signing" \|\| phase === "running";/.test(page),
    "314b · with a run lasting from the signature to its last step");
  check(!/screensFor\(chosen !== null\)/.test(page), "314c · and no longer standing on whether a cell was chosen");
  /*
   * And never from the dialog being open, which under the suite is never true, so
   * a strip reading the dialog's state would have stayed green forever.
   */
  // The declaration is not a call site: it matched the same pattern and made four.
  const callsites = [...page.matchAll(/(?<!function )screensFor\(([^)]*)\)/g)].map(m => m[1]).filter(a => !a.includes(":"));
  check(callsites.length === 3 && callsites.every(a => a === "runInProgress"),
    `314d · the three call sites pass the run and nothing else (${callsites.join(" | ") || "none found"})`);
  const stripRegion = page.slice(page.indexOf('<nav className="ag-rail"'), page.indexOf("</nav>", page.indexOf('<nav className="ag-rail"')));
  check(stripRegion.length > 0 && !/\.open\b/.test(stripRegion) && !/runDialog\.current/.test(stripRegion),
    "314e · and no read of the dialog's own state feeds it");

  /*
   * The credential is a third fact and not a restatement of the second: a person
   * stands behind the wallet, and Xovi holds a credential for it, are read from
   * two places and either can be true without the other.
   */
  check(credentialPill("issued") === "credential issued by Xovi", "316 · the credential pill says what Xovi holds");
  check(credentialPill("none") === "no credential issued", "316a · and says so plainly when it holds none");
  check(!/\byet\b/.test(credentialPill("none")) && !/\byet\b/.test(NO_CREDENTIAL),
    `316b · with no promise about when in either sentence (${credentialPill("none")})`);
  check(/credential: input\.registration === "registered" \? credentialPill\(input\.agentCredential\) : null/.test(page),
    "316c · drawn beside the registration wherever the identity is drawn");

  /*
   * A run that stops before proposing says why, in the run's own sentence.
   */
  const unconfigured = lineFor({ step: "not-submitted", detail: "no ingest route is configured on this deployment", reason: "unconfigured" });
  const noCredential = lineFor({ step: "not-submitted", detail: "this wallet holds no credential, so nothing is proposed", reason: "no-credential" });
  check(unconfigured.text === "no ingest route is configured on this deployment" && noCredential.text === "this wallet holds no credential, so nothing is proposed",
    `317 · the stop card carries the reason's own sentence (${noCredential.text})`);
  check(unconfigured.text !== noCredential.text, "317a · and the two reasons are not one sentence (negative control)");
  check(noCredential.detail === "no-credential" && noCredential.tone === "stopped", "317b · with the machine's word for it in the detail lane");

  /*
   * The one refusal a person can do nothing about, said in words rather than as a
   * word. It is said for the status that means it and for no other, because
   * `refused` is the catch all for everything that is not a duplicate or a
   * throttle.
   */
  const credential = lineFor({ step: "declined", kind: "refused", detail: "the ingest route refused the proposal", status: CREDENTIAL_REFUSED });
  check(credential.text === NO_CREDENTIAL, `315 · the credential refusal says what happened (${credential.text})`);
  check(/paid and served/.test(NO_CREDENTIAL) && /no credential for this agent/.test(NO_CREDENTIAL), "315a · naming the read as paid and the credential as missing");
  const other = lineFor({ step: "declined", kind: "refused", detail: "the ingest route refused the proposal", status: 500 });
  check(other.text !== NO_CREDENTIAL, `315b · while another status is not explained by that cause (negative control, ${other.text})`);
  check(credential.tone === "stopped" && other.tone === "stopped", "315c · both stop the run");

  /*
   * WHO THE AGENT IS, AFTER THE CARDS THAT SET IT UP HAVE GONE.
   *
   * The onboarding disappears when it completes and took with it everything that
   * said who the agent was, so a person on the board saw a wallet and nothing
   * about the name they had just asked for or the registration they had just made.
   * Both are derived on every render from the two routes rather than remembered,
   * which is what makes a lapsed verification or a name that stops resolving take
   * its chip with it.
   */
  const enrolled = identityChips({ agentCredential: "none", registration: "registered", source: "worldid", nameState: "issued", name: "agent2.xovi.eth" });
  check(enrolled.registration === "registered by World ID" && enrolled.name === "agent2.xovi.eth · issued",
    `310 · an enrolled wallet carries its registration and its name with its state (${enrolled.registration}, ${enrolled.name})`);
  const requested = identityChips({ agentCredential: "none", registration: "registered", source: "agentbook", nameState: "requested", name: "agent2.xovi.eth" });
  check(requested.name === "agent2.xovi.eth · requested" && requested.registration === "registered in AgentBook",
    `310a · a requested name says requested and never issued, and AgentBook is named as the source (${requested.name}, ${requested.registration})`);
  const stranger = identityChips({ agentCredential: "none", registration: "not-registered", source: null, nameState: "none", name: null });
  check(stranger.name === null && stranger.registration === null,
    "310b · a wallet that is not enrolled carries neither, rather than a chip saying no");
  const unreadChips = identityChips({ agentCredential: "none", registration: "unread", source: null, nameState: "none", name: null });
  check(unreadChips.registration === null, "310c · and an unread registry draws no registration either (negative control)");
  const noName = identityChips({ agentCredential: "none", registration: "registered", source: "worldid", nameState: "issued", name: null });
  check(noName.name === null && noName.registration !== null,
    "310d · a registered wallet the name route told nothing gets the pill and no name chip");

  // Both places, each block found before it is read.
  const headerStart = page.indexOf('<header className="ag-header"');
  // Searched from the header's own start: `</header>` occurs earlier in the file
  // than the element does, so an unanchored search put the end before the
  // beginning and the slice was empty. The guard below is what showed it.
  const headerEnd = page.indexOf("</header>", headerStart);
  const accountStart = page.indexOf('<div className="ag-account-body">');
  check(headerStart > 0 && headerEnd > headerStart && accountStart > 0, "311 · the header and the account body are found (negative control for the slices)");
  check(/<IdentityChips chips=\{identity\} onName=/.test(page.slice(headerStart, headerEnd)), "311a · the header carries them on every destination");
  check(/<IdentityChips chips=\{identity\} onName=/.test(page.slice(accountStart, accountStart + 400)), "311b · and the account body opens with the same two");
  /*
   * Derived, not remembered, which was a claim in a comment and held by nothing.
   * Driven twice with one input changed, and the same call site read for the
   * memo that would freeze it: with empty dependencies the chips would be
   * whatever they were on the first render and an enrolment made in the page
   * would not reach the header until a reload.
   */
  const chipsBefore = identityChips({ agentCredential: "none", registration: "not-registered", source: null, nameState: "none", name: null });
  const chipsAfter = identityChips({ agentCredential: "none", registration: "registered", source: "worldid", nameState: "requested", name: "agent3.xovi.eth" });
  check(chipsBefore.registration === null && chipsAfter.registration === "registered by World ID" && chipsBefore.name === null && chipsAfter.name === "agent3.xovi.eth · requested",
    "311c · the same rule answers differently the moment its inputs change");
  check(/const identity = identityChips\(\{ registration, source, agentCredential, nameState, name: routeName \}\);/.test(page),
    "311d · and the page computes it in the render rather than holding a remembered copy");
  // `[^)]*` could never reach the call: `useMemo(() => ...` closes a parenthesis
  // in its first three characters, so the pattern stopped before the name it was
  // hunting and the check could not have gone red for any memo ever written.
  const memoed = /useMemo\([\s\S]{0,120}?identityChips/;
  check(!memoed.test(page), "311e · with no memo standing between the reads and the chips");
  check(memoed.test("const identity = useMemo(() => identityChips({}), []);"), "311f · and the memo check can see one (negative control)");
  // A rung and not a button: the settings screen has the connect and the board
  // actions and no third that would do nothing.
  const settingsBlock = page.slice(page.indexOf("function Enrol("), page.indexOf("function Board("));
  /*
   * Settings is a checklist now, so it carries the way to meet each condition.
   * The invariant is not how many, it is that each one acts and that none of them
   * is Connect wallet, which is the header's and is not repeated.
   */
  const buttons = (settingsBlock.match(/<button/g) ?? []).length;
  check(buttons >= 2, `279c · settings carries the ways to meet its conditions (${buttons})`);
  check(!/Connect wallet/.test(settingsBlock), "279f · and none of them is the header's connect action");
  const settingsLabels = [...settingsBlock.matchAll(/<button[\s\S]{0,220}?>\s*([^<>{][^<>]*?)\s*</g)].map(m => m[1].trim());
  const deciding = settingsLabels.filter(l => /\b(confirm|approve|reject|accept|decide|attest)\w*\b/i.test(l));
  check(deciding.length === 0, `279g · and not one of them is a decision about a clip (${deciding.join(", ") || "none"})`);
  // One act, one control: Connect wallet is the header's and is not repeated.
  // Comments stripped first, because a comment is not the interface and the note
  // explaining this rule contains the words the rule is about.
  const rendered = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const connectControls = (rendered.match(/"Connect wallet"/g) ?? []).length;
  check(connectControls === 1, `279e · and Connect wallet exists once on the page (${connectControls})`);

  // The board never says how many, and the chosen cell travels as day and species.
  const boardBlock = page.slice(page.indexOf("function Board("), page.indexOf("function Records("));
  check(/on offer/.test(boardBlock) && !/\{cell\?\.count|length\}/.test(boardBlock), "280 · a cell says on offer or none and never how many");
  check(/searchParams\.set\("day", chosen\.day\)/.test(page) && /searchParams\.set\("species", chosen\.species\)/.test(page),
    "280a · and the chosen cell is what the run reads");

  /*
   * A run lands the viewer on the screen the run is on.
   *
   * The action stood in the bottom bar on every destination with no guard, and
   * `onRun` never changed screen, so pressing it on Settings ran the whole thing
   * on a Run screen nobody was looking at: a run with no feedback, which is worse
   * on camera than the rows it replaced.
   */
  const runBlock = page.slice(page.indexOf("const onRun = useCallback"), page.indexOf("const running ="));
  check(/openRun\(\)/.test(runBlock), "284 · starting a run opens the dialog it happens in");
  check(runBlock.indexOf("openRun()") < runBlock.indexOf('setPhase("signing")'), "284a · before the first line can arrive");
  check(/dialog\.showModal\(\)/.test(page), "284b · with showModal, so focus is trapped and the page behind is inert");
  // Closing is a form method, which ends the dialog and touches no run state, so
  // a person who closes it mid run loses nothing.
  // Searched from the run dialog's own start: the name dialog closes before this
  // one opens, so an unanchored search for the closing tag put the end before the
  // beginning and the slice was empty. The same bug the header slice had.
  const dialogStart = page.indexOf("<dialog ref={runDialog}");
  const dialogBlock = page.slice(dialogStart, page.indexOf("</dialog>", dialogStart));
  check(/<form method="dialog">/.test(dialogBlock), "284c · closing it is a dialog form and aborts nothing");
  check(!/\babort\b|reader\.cancel|AbortController/.test(page), "284d · and nothing on the page aborts the stream");
  // The action lives beside the cell it will read and nowhere else.
  const boardRun = page.slice(page.indexOf("ag-board-run"), page.indexOf("ag-board-run") + 500);
  check(/Pay and run/.test(boardRun), "284e · the action is on the board beside the chosen cell");
  // Over a copy with the comments stripped, for the reason 279e strips them: the
  // note explaining where the action lives names the action.
  const renderedPage = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  /*
   * One CONTROL, counted as a control rather than as a string.
   *
   * The home's process card names the step the button performs, which is the same
   * name on purpose: an action keeps its name through the flow, and a card that
   * called it something else would teach a person two words for one thing. What
   * must be unique is the thing that acts, so this counts the label inside a
   * button rather than every occurrence of the words.
   */
  const payControls = (renderedPage.match(/<button[\s\S]{0,400}?>[^<]*Pay and run/g) ?? []).length;
  check(payControls === 1, `284f · and exists exactly once as a control (${payControls})`);
  check((renderedPage.match(/Pay and run/g) ?? []).length > payControls,
    "284f2 · while the step it performs is named elsewhere without being a second one (negative control)");
  // The blur is on the page. The stylesheet's rule against backdrop-filter and
  // the check that holds it are untouched.
  check(/body:has\(\.ag-run-dialog\[open\]\)\s+\.ag-surface\s*\{[^}]*filter:\s*blur\([^)]+\)[^}]*\}/.test(css),
    "284g · the page behind is blurred rather than the backdrop, in one rule");
  check(!/backdrop-filter\s*:/.test(css), "284h · and no backdrop-filter is declared anywhere");
  // To the dialog, not to the end of main: the dialog lives inside main and its
  // Close button is not the bottom bar's.
  const actions = page.slice(page.indexOf('<div className="ag-actions">'), page.indexOf('<dialog ref={nameDialog}'));
  check(!/<button/.test(actions), "284i · and the bottom bar carries nothing pressable");
  // 39: the thesis renders where the run happens, and nothing holds a run screen.
  check(/id="ag-run-thesis"/.test(dialogBlock) && /No credential in existence may confirm/.test(dialogBlock),
    "285a · the run's thesis is the dialog's heading");
  check(/aria-labelledby="ag-run-thesis"/.test(page), "285b · which names the dialog");
  check(/tabIndex=\{-1\}/.test(page) && /dialog\.focus\(\)/.test(page), "285c · and the dialog takes focus rather than its Close button");
  check(/aria-haspopup=\{s\.id === "run" \? "dialog"/.test(page), "285d · the strip's run item says it opens one");
  const heads = page.slice(page.indexOf("const HEADS"), page.indexOf("const HEADS") + 900);
  // Every destination the strip offers, read off SCREENS rather than named, and
  // settings is not among them: the onboarding is the way in and has its own head.
  const headless = SCREENS.filter(d => d.id !== "run" && !new RegExp(`\\b${d.id}:`).test(heads));
  check(headless.length === 0, `285 · every destination carries its own head line (${headless.map(d => d.id).join(", ") || "none"})`);
  check(!/settings:/.test(heads), "285e · and settings is not one, since it is the way in");
  check(/Before a run/.test(page), "285f · while the onboarding has a head of its own");

  /*
   * The retry controls re-read, and the embed sets no cookie.
   *
   * Both were fixed and neither was held: taking the retry state out of the
   * read's dependencies left the suite green, which is the fix being real and
   * unguarded, and nothing stopped the embed host going back to the one that sets
   * three cookies on a plain fetch.
   *
   * The dependency is read off the effect that does the reading, found by the
   * call it makes rather than by a line number, so a rename does not blind it.
   */
  const readEffect = page.slice(page.indexOf("/api/agent/registration?payer="));
  const readDeps = readEffect.slice(0, readEffect.indexOf("\n\n"));
  check(/\}, \[address, readAgain\]\);/.test(readDeps), "292 · the retry state is a dependency of the registration read");
  check(/setReadAgain\(n => n \+ 1\)/.test(page), "292a · and the controls are what change it");
  check(!/\}, \[address\]\);/.test(readDeps), "292b · so the read cannot be left depending on the address alone");

  // To the self closing bracket: the element has no closing tag, so anchoring on
  // one gave an empty slice that satisfied nothing and failed loudly rather than
  // quietly, which is the only reason it was caught here.
  const embedStart = page.indexOf("<iframe");
  const embed = page.slice(embedStart, page.indexOf("/>", embedStart) + 2);
  check(/youtube-nocookie\.com/.test(embed), "293 · the stream loads from the host that sets no cookie");
  check(!/\/\/www\.youtube\.com/.test(page), "293a · and the one that sets three appears nowhere");
  check(/\/\/www\.youtube\.com/.test("https://www.youtube.com/embed"), "293b · the host check can see it (negative control)");


  /*
   * THE ONE STEP, AND IT IS OPTIONAL.
   *
   * This drove a three step rule: a wallet card, a registration and a name, all
   * three required. Two of them were wrong. The wallet card restated the header's
   * own chip, and the name held a person at a step Zenbit performs, so a wallet
   * that had enrolled and not asked for a name landed on a checklist instead of
   * the board. The rule is now connected and either enrolled or skipped, and the
   * checks that held the other two are retired with it rather than rewritten to
   * pass against nothing: 286 to 286c, 287a, 288 to 288c2 went with the cards they
   * described.
   */
  const ADDR = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
  const gate = (over: Partial<Parameters<typeof enrolmentState>[0]>) =>
    enrolmentState({ address: ADDR, registration: "registered", skipped: false, ...over });

  check(opensTheBoard(gate({})), "286 · an enrolled wallet reaches the board");
  check(gate({}) === "enrolled", "286a · and is told which of the two opened it");
  // The founder's own case: enrolled, no name asked for, and it must not be held.
  check(opensTheBoard(gate({ registration: "registered" })), "286b · with no name of any kind asked of it");
  check(!opensTheBoard(gate({ address: null })), "286c · no wallet does not reach it (negative control)");

  check(!opensTheBoard(gate({ registration: "not-registered" })), "287 · a wallet nobody stands behind does not, until it answers");
  check(gate({ registration: "not-registered" }) === "needed", "287a · and is asked, once");
  check(opensTheBoard(gate({ registration: "not-registered", skipped: true })), "287b · a wallet that declined reaches the board");
  check(gate({ registration: "not-registered", skipped: true }) === "skipped", "287b2 · and is told it went without");
  /*
   * An answer that has not arrived is not a demand. Drawing the step while the
   * registry is still being read asks a returning wallet to enrol on every load,
   * which is the nagging the founder's ruling exists to stop.
   */
  check(gate({ registration: "reading" }) === "reading" && gate({ registration: "idle" }) === "reading",
    "287c · a registry still being read asks nothing");
  check(!opensTheBoard(gate({ registration: "reading" })), "287d · and does not open the board on its own either");
  check(gate({ registration: "unread" }) === "needed", "287e · while a registry that answered nothing does ask");

  /*
   * The chain is guarded where it is used rather than by a card that asks somebody
   * to read one. Both guards survive the card's removal.
   */
  check(/await ensureBaseSepolia\(\);/.test(page), "288 · the chain is ensured before the payment is signed");
  check(/Wrong chain, switch/.test(page) || /ensureBaseSepolia/.test(page.slice(page.indexOf("function AccountChip("), page.indexOf("function Mark("))),
    "288a · and the header's chip warns and offers the switch");
  check(!/const walletDone/.test(page), "288b · with no card left restating what the chip says");

  /*
   * The refusal is the browser's and nobody else's.
   */
  check(/globalThis\.localStorage\?\.setItem\(skipKey/.test(page) && /globalThis\.localStorage\?\.getItem\(skipKey/.test(page),
    "288c · a wallet's refusal is remembered in the browser alone");
  const skipRegion = page.slice(page.indexOf("const SKIPPED ="), page.indexOf("export function identityChips"));
  check(skipRegion.length > 0 && !/fetch\(|body:|headers:/.test(skipRegion), "288c2 · and no request carries it");
  check((skipRegion.match(/try \{/g) ?? []).length >= 2, "288c3 · with both halves guarded, since a browser may refuse storage");

  /*
   * WHAT DECLINING COSTS, MEASURED RATHER THAN PROMISED.
   *
   * The card says a wallet that goes on without World ID pays for every read,
   * earns no allowance and cannot propose. Each of those is a different mechanism
   * and none of them is this page, so each is driven where it lives: the cap, the
   * credential and the run.
   */
  const DECLINED = "0x3333333333333333333333333333333333333333";
  setRegistryForTest(async () => 0n);
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: null, freePerDay: 2 });
  const standing = await standingBehind(DECLINED, capFrom(), { HUMAN_ID_KEY: "k".repeat(40) } as never, new Date());
  check(standing === null, `326 · nobody stands behind a wallet that declined (${JSON.stringify(standing)})`);
  check((await takeFreeRead(DECLINED)) === false, "326a · so it takes no free read, whatever the allowance is set to");
  const mintedFor = await ensureCredential(DECLINED, { store: null, names: null, at: new Date() });
  check(mintedFor === "none", "326b · and no credential is minted for it");
  // The run's own sentence for the stop, which is the state a declined wallet
  // reaches: it pays and reads, and the step that would change it is named.
  check(/no credential/.test(NOT_SUBMITTED_SENTENCE["no-credential"]) && NOT_SUBMITTED_SENTENCE["no-credential"] !== NOT_SUBMITTED_SENTENCE.unconfigured,
    `326c · its run stops for want of a credential, which is its own reason (${NOT_SUBMITTED_SENTENCE["no-credential"]})`);
  check(lineFor({ step: "not-submitted", detail: NOT_SUBMITTED_SENTENCE["no-credential"], reason: "no-credential" }).text === NOT_SUBMITTED_SENTENCE["no-credential"],
    "326d · saying which step would change it");
  // The control: the same three mechanisms answer differently for a wallet the
  // registry does know, so none of the four above is true by construction.
  setCapForTest({ registry: async () => 88888888888888888888n, store: fakeStore(), verifications: null, freePerDay: 2 });
  const known = await standingBehind("0x4444444444444444444444444444444444444444", capFrom(), { HUMAN_ID_KEY: "k".repeat(40) } as never, new Date());
  check(known !== null && known.source === "agentbook", `326e · while a wallet AgentBook knows does stand behind one (negative control, ${JSON.stringify(known)})`);
  setCapForTest(null);
  setRegistryForTest(undefined);

  check(/\{onboarded && \(/.test(page), "289 · the strip is absent until the onboarding is done");
  check(/const onboarded = opensTheBoard\(enrolmentState\(/.test(page),
    "289a · and is derived from the reads rather than from a remembered yes");
  check(!/\{ id: "settings"/.test(page), "289b · settings is no longer a destination, since it is the way in");

  if (before === undefined) delete process.env.WINDOWS_SNAPSHOT;
  else process.env.WINDOWS_SNAPSHOT = before;
  if (payToBefore === undefined) delete process.env.X402_PAY_TO;
  else process.env.X402_PAY_TO = payToBefore;
  resetServerForTest();
}
