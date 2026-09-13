import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as boardGET } from "../app/api/agent/board/route";
import { GET as windowsGET } from "../app/api/agent/windows/route";
import { GET as registrationGET } from "../app/api/agent/registration/route";
import { POST as runPOST } from "../app/api/agent/run/route";
import { type RunMark, type RunRow, recordRun, runsStoreFrom, setRunsStoreForTest } from "../lib/agent/runs-store";
import { type RunOutcome, type RunStep, runOutcome } from "../lib/agent/run";
import { POST as namePOST } from "../app/api/agent/name/route";
import { setClockForTest } from "../lib/human/clock";
import { ENROLLMENT_CALLS_PER_MINUTE, ENROLLMENT_WINDOW_MS, enrollmentThrottle } from "../lib/human/throttle";
import { readFileSync } from "node:fs";
import { AGENTBOOK_ADDRESS_WORLDCHAIN, setRegistryForTest } from "../lib/human/registry";
import { capFrom, setCapForTest, standingBehind, takeFreeRead } from "../lib/human/cap";
import { ensureCredential } from "../lib/agent/credentials";
import { enrolledSeam, setEnrolledForTest } from "../lib/agent/enrolled";
import { fakeStore, fakeVerifications } from "./human";
import { CREDENTIAL_REFUSED, PROCESS, clearSkipped, readSkipped, writeSkipped, newestRecording, NO_CREDENTIAL, enrolmentState, opensTheBoard, ROLL_DWELL_MS, SCREENS, credentialPill, identityChips, lineFor, namePill, registrationLine, registrationPill, screensFor } from "../app/app-shell";
import { BOARD_SPECIES, DayUnknown, boardFrom, cellOf, cellRecording, cellState, loadSnapshot, servedCell } from "../lib/windows/snapshot";
import { UNKNOWN_REFUSAL } from "../lib/agent/refusal";
import { NOT_SUBMITTED_SENTENCE, environmentCredentialCovers, namesACell, windowsUrlFor as runWindowsUrlFor } from "../lib/agent/run";
import { AUTHORIZATION_TYPES, PAYMENT_TOKEN, ruledValue } from "../lib/human/free-read";
import { setNonceStoreForTest } from "../lib/human/nonces";
import { getAddress, hashDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENTBOOK_ON_WORLD_CHAIN, ENS_APP, LIFECYCLE, NEXT_STEP, NODE_NAMES, NODE_NAME_MAX, failedAt, stepState, NOT_SEEN_REASON, WORLDSCAN_ADDRESS, WORLD_ID_PAGE, reasonForStage, registrationHref, registrationHrefTitle, type BoardCellView, cellMetaLine, lifecycleLine, lifecycleOf, readableLength, stopReason, windowsUrlFor } from "../app/app-shell";
import { type AnchorRow, nextAction, setStoreForTest } from "../lib/anchor/store";
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

  const served = (await (await boardGET(new Request("http://127.0.0.1/api/agent/board"))).json()) as { days: string[]; cells: Record<string, unknown>[] };
  const keys = [...new Set(served.cells.flatMap(c => Object.keys(c)))].sort();
  /*
   * A CLOSED LIST OF FIELDS, AND NOT ONE OF THEM IS A COUNT.
   *
   * This asserted three fields and no digit outside a date, which held while a
   * cell was a word and a pill. A cell carries its recording's length and the
   * range of its windows now, so the blunt rule is gone and the two properties
   * underneath it are checked directly: nothing may be served that is not on the
   * list, and nothing served may depend on how many windows a cell holds.
   *
   * The second is the one that matters. The window files are public, so a count
   * served here is the embargo drop by subtraction: the rows in a file minus the
   * rows offered is the number withheld, which is the one number the gate exists
   * to keep. A range is two of the numbers already in that public file and says
   * nothing about how many lie between them.
   */
  const ALLOWED_CELL_KEYS = ["day", "onOffer", "recordingSeconds", "species", "thumbnail", "videoId", "windowSeconds"];
  const stray = keys.filter(k => !ALLOWED_CELL_KEYS.includes(k));
  check(stray.length === 0 && keys.includes("day") && keys.includes("species") && keys.includes("onOffer"),
    `271 · a cell carries the three it must and nothing off the list (${stray.join(", ") || keys.join(",")})`);
  const body = JSON.stringify(served);
  check(!/count|total|withheld|dropped|offered/i.test(body), "271a · with no field named for a quantity of windows");
  /*
   * Driven rather than read: the same durations and the same recording, twice the
   * windows. A cell's served facts must come back identical, which no count and
   * no sum can do.
   */
  const one = window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "w1");
  const two = { ...window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "w2"), startTime: one.startTime, endTime: one.endTime };
  const three = { ...window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "w3"), startTime: one.startTime, endTime: one.endTime };
  const asTwo = cellRecording([{ ...one, day: "2026-09-03" }, { ...two, day: "2026-09-03" }] as never);
  const asFour = cellRecording([one, two, three, { ...one, windowId: "w4" }].map(w => ({ ...w, day: "2026-09-03" })) as never);
  check(JSON.stringify(asTwo) === JSON.stringify(asFour),
    `271c · and a cell's facts do not move when the number of windows does (${JSON.stringify(asTwo)} against ${JSON.stringify(asFour)})`);
  const wider = cellRecording([{ ...one, day: "2026-09-03" }, { ...two, endTime: two.endTime + 9, day: "2026-09-03" }] as never);
  check(JSON.stringify(wider) !== JSON.stringify(asTwo), "271d · while a different duration does (negative control)");
  /*
   * THE WIRE'S OWN MAPPING, DRIVEN WITH MORE THAN IT MAY CARRY.
   *
   * Every guard above reads the cells this fixture happens to produce, so none of
   * them could see the route publishing a field the fixture never has. Driven
   * with a cell carrying a count, which is the field that must never cross.
   */
  const overfull = servedCell({ day: "2026-09-03", species: "mexicanum", onOffer: true, videoId: "vidA", offered: 7, station: "AM 1" } as never);
  check(!("offered" in overfull) && !("station" in overfull),
    `271e · the wire drops what is not on its list (${Object.keys(overfull).join(",")})`);
  check("videoId" in overfull && overfull.day === "2026-09-03", "271f · and keeps what is (negative control)");
  /*
   * A cell fed by two recordings claims neither, and a cell with nothing to sell
   * carries no invitation. Neither case exists in the committed fixtures, so both
   * are planted.
   */
  const split = cellRecording([
    { ...window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "s1"), day: "2026-09-03" },
    { ...window("vidB", "mexicanum", "2026-09-03T00:00:00Z", "s2"), day: "2026-09-03" },
  ] as never);
  check(split.videoId === undefined && split.thumbnail === undefined && split.recordingSeconds === undefined,
    `271g · a cell drawing on two recordings names neither (${JSON.stringify(split)})`);
  check(split.windowSeconds !== undefined, "271h · while the range, which is true of all of them, stays (negative control)");
  const mixed = boardFrom([
    { ...window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "o1"), day: "2026-09-03", meta: { durationSeconds: 99, thumbnail: "https://i.ytimg.com/vi/vidA/mqdefault.jpg" } },
  ] as never);
  const offered = mixed.cells.filter(c => c.onOffer);
  const idle = mixed.cells.filter(c => !c.onOffer);
  check(offered.length > 0 && offered.every(c => c.recordingSeconds === 99), "271i · an on offer cell carries its recording");
  check(idle.length > 0 && idle.every(c => c.recordingSeconds === undefined && c.thumbnail === undefined && c.videoId === undefined),
    `271j · and a cell with nothing to sell carries no thumbnail and no length (${idle.length} such cells)`);
  /*
   * The cell that separates the two, and without it 271j proves nothing.
   *
   * Every cell that is not on offer in the fixture above is EMPTY, so deriving the
   * facts from the raw file rather than from what the gate leaves changes nothing
   * and 271j stays green through a mutation it exists to catch. An UNSCREENED cell
   * has windows and is still not on offer, which is the only shape where the two
   * readings differ.
   */
  const unscreenedBoard = boardFrom(
    [{ ...window("vidA", "mexicanum", "2026-09-03T00:00:00Z", "u1"), day: "2026-09-03", meta: { durationSeconds: 99, thumbnail: "https://i.ytimg.com/vi/vidA/mqdefault.jpg" } }] as never,
    { EMBARGOED_ALIASES: "Alfa" },
  );
  const held = unscreenedBoard.cells.filter(c => c.day === "2026-09-03" && c.species === "mexicanum");
  check(held.length === 1 && held[0].onOffer === false, `271k · a cell the gate holds back is not on offer (${JSON.stringify(held[0])})`);
  check(held[0].videoId === undefined && held[0].thumbnail === undefined && held[0].recordingSeconds === undefined && held[0].windowSeconds === undefined,
    "271l · and carries none of its recording, though the file behind it has one");
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
  /*
   * 312 to 312e are retired with the window of three they measured.
   *
   * They drove `rollPosition`, which put the state being read in the middle with
   * one faded neighbour above and one below. The founder could not read either
   * neighbour, and the sequence they were there to show is on the line beside the
   * card, where every node now carries its own title. The card area holds one
   * card, `rollPosition` is gone with the three slots it named, and what the
   * stage draws is held by 312j below.
   */
  check(ROLL_DWELL_MS >= 600 && ROLL_DWELL_MS <= 1500, `312f · each state holds the middle long enough to read (${ROLL_DWELL_MS}ms)`);
  // The pager still moves it, and the dwell stops while a person is holding one.
  check(/if \(pinned !== null\) return;/.test(page) && /setCursor\(c => c \+ 1\), ROLL_DWELL_MS\)/.test(page),
    "312g · the wheel turns on that timer and stops while a card is pinned");
  const roll = page.slice(page.indexOf("function Rolodex("), page.indexOf("function Enrol("));
  /*
   * 312h and 312i are retired with the neighbours they described: the two faded
   * cards are gone, so there is nothing to hide from a screen reader or to hold to
   * a title alone. What replaces them is the card area holding one card.
   */
  check(roll.length > 0, `312j0 · the wheel is found (negative control for the read, ${roll.length})`);
  check(/i !== at \? null : \(/.test(roll), "312j · the card area draws the state being read and nothing else");
  check(!/ag-roll-title/.test(page) && !/ag-roll-title/.test(css),
    "312k · with no faded title left above or below it, and no rule for one");
  check(!/data-position/.test(page), "312l · nor a position on a card that can only be in one place");
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
  check(/data-state=\{stepState\(i, at, failed\)\}/.test(roll),
    "324c · a node's state is the wheel's own arithmetic and not a second count");
  /*
   * A FAILURE READS AS ONE, ON THE LINE AND NOT ONLY ON A PILL.
   *
   * The node the run stopped on keeps its mark whatever the wheel is showing, and
   * what follows it has not happened: drawing those as ahead of a cursor would say
   * the run is on its way to them. A duplicate is supply rather than a stop, which
   * is the distinction the tone carries everywhere else on this page.
   */
  const failedLines = [lineFor({ step: "presenting" }), lineFor({ step: "payment-refused", status: 402, detail: "insufficient_funds" })];
  check(failedAt(failedLines) === 1, `324h · the line the run stopped on is where the stop is (${failedAt(failedLines)})`);
  check(failedAt([lineFor({ step: "presenting" }), lineFor({ step: "done" })]) === null,
    "324h2 · and a run that did not stop has none (negative control)");
  check(failedAt([lineFor({ step: "declined", kind: "duplicate", detail: "x" })]) === null,
    "324h3 · nor does a duplicate, which is supply rather than a stop");
  check(stepState(1, 1, 1) === "failed" && stepState(1, 0, 1) === "failed",
    "324i · the node that failed keeps its mark whatever the wheel is showing");
  check(stepState(2, 2, 1) === "ahead" && stepState(2, 3, 1) === "ahead",
    "324j · and nothing after it is ever drawn as reached");
  check(stepState(0, 1, 1) === "done" && stepState(0, 0, null) === "at" && stepState(2, 0, null) === "ahead",
    "324k · while a run with no stop reads exactly as it did (negative control)");
  const crossRules = [...sheetRoll.matchAll(/\.ag-steps-item\[data-state="failed"\][^{]*\{([^}]*)\}/g)].map(m => m[1]);
  check(crossRules.length >= 3, `324l · the failed node has rules of its own (negative control for the read, ${crossRules.length})`);
  const strokes = crossRules.filter(b => /rotate\((-?45)deg\)/.test(b));
  check(strokes.length === 2, `324m · drawn as two strokes, the way the mark beside it is (${strokes.length})`);
  const crossInk = crossRules.join(" ");
  check(/var\(--color-error\)/.test(crossInk), "324n · in the semantic error hue");
  const wrongInk = ["--color-xv-agent", "--color-xv-gold", "--color-primary", "--color-accent"].filter(t => crossInk.includes(t));
  check(wrongInk.length === 0, `324o · and never the agent hue, the gold, the primary or the accent (${wrongInk.join(", ") || "none"})`);
  /*
   * And the card says what would change it, from one map, in the present tense.
   */
  const refusedLine = lineFor({ step: "payment-refused", status: 402, detail: "insufficient_funds" });
  check(refusedLine.detail === "this wallet holds no USDC on Base Sepolia",
    `324p · a refused payment names the facilitator's reason as a sentence (${refusedLine.detail})`);
  const unmet = lineFor({ step: "payment-refused", status: 402, detail: "some_code_nobody_has_seen" });
  check(unmet.detail === UNKNOWN_REFUSAL,
    `324p2 · while a code this deployment has not met becomes one sentence of Zenbit's own (${unmet.detail})`);
  check(!/some_code_nobody_has_seen/.test(unmet.detail ?? ""),
    "324p3 · and never the code itself, which is text a third party wrote on Zenbit's surface");
  check(/not accepted/.test(UNKNOWN_REFUSAL) && !/\bwill\b|\bsoon\b/i.test(UNKNOWN_REFUSAL),
    `324p4 · saying the payment was not accepted and promising nothing (${UNKNOWN_REFUSAL})`);
  check(refusedLine.next !== undefined && /Fund this wallet/.test(refusedLine.next),
    `324q · and the card says what would change it (${refusedLine.next})`);
  const nexts = Object.values(NEXT_STEP);
  const promised = nexts.filter(l => /\b(will|soon|coming|shortly|shall)\b/i.test(l));
  check(promised.length === 0, `324r · with no conditional future in any of them (${promised.join(" | ") || "none"})`);
  check(nexts.every(l => l.trim().length > 0), `324s · and every stop the map names has a sentence (${nexts.length})`);
  check(lineFor({ step: "done" }).next === undefined, "324t · while a run that finished says nothing about what would change it");
  // And the card draws it. 324q holds that the line carries the sentence, which a
  // card that never renders it satisfies: removing the element left every check
  // green, which is how this one came to exist.
  check(/\{line\.next !== undefined && <p className="ag-roll-next">\{line\.next\}<\/p>\}/.test(roll),
    "324t2 · and the card being read draws that sentence rather than only carrying it");
  check(/\.ag-roll-next\s*\{[^}]*font-size/.test(sheetRoll), "324t3 · with a rule of its own, so it is drawn as a line and not as a paragraph like the reason");
  const secondCopy = (page.match(/this wallet holds no USDC on Base Sepolia/g) ?? []).length;
  check(secondCopy === 0, `324u · the reason is the run's own constant and is not typed again on the card (${secondCopy})`);
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
  /*
   * A DAY CAN CARRY MORE THAN ONE RECORDING, AND THE TIE IS A RULE.
   *
   * The days are cut per species, so the snapshot this deployment serves holds two
   * for 2026-09-09. The reduce takes a strictly later day, so the earliest cell of
   * the newest day survives every comparison, which is the first species in the
   * board's own row order that has one. Driven on a fixture with the tie in it,
   * because a fixture with one recording per day cannot tell the rule from an
   * accident, and `>=` in that reduce passes such a fixture.
   */
  const tied = [
    { day: "2026-09-04", onOffer: true, videoId: "older" },
    { day: "2026-09-09", onOffer: true, videoId: "firstOfTheDay" },
    { day: "2026-09-09", onOffer: true, videoId: "secondOfTheDay" },
  ];
  check(newestRecording(tied)?.videoId === "firstOfTheDay",
    `325e2 · a tie goes to the first cell in the board's row order (${newestRecording(tied)?.videoId ?? "none"})`);
  check(newestRecording([...tied].reverse())?.videoId === "secondOfTheDay",
    `325e3 · which is the cell order and not a property of the ids (negative control, ${newestRecording([...tied].reverse())?.videoId ?? "none"})`);
  /*
   * And the caption says so. "The recording of that day" is a claim the board
   * contradicts one screen later, where the same day carries another.
   */
  const captions = [...home.matchAll(/recording of \{newest\.day\}|recording of \$\{newest\.day\}/gi)].length;
  check(captions === 2, `325e4 · the day is named twice on the home, in the frame's title and in the line under it (${captions})`);
  check(!/[Tt]he recording of \{newest\.day\}/.test(home) && !/[Tt]he recording of \$\{newest\.day\}/.test(home),
    "325e5 · and neither calls it the recording of that day, where the board serves two");
  check(/[Tt]he recording of \$\{newest\.day\}/.test("title={`The recording of ${newest.day}`}"),
    "325e6 · the caption check can see the definite article (negative control)");
  const cards = (home.match(/ag-process-card/g) ?? []).length;
  /*
   * The array itself, imported rather than read out of the file.
   *
   * Counting `title:` across the page found nine, none of them these, so the read
   * was narrowed to the array's own source; then the reasons the copy is worded
   * as it is were written above two of the cards and 325h went red on the word
   * "issued" in a comment. 325f0, the control for that read, is retired with it:
   * an imported array that is empty fails 325f on its own.
   */
  check(PROCESS.length >= 3 && PROCESS.length <= 5, `325f · the process is three to five cards (${PROCESS.length})`);
  check(cards === 1 && /PROCESS\.map/.test(home), "325g · drawn from one card of one kind");
  /*
   * No state on any of them, meaning no state of the person reading: these cards
   * know nothing about a wallet. A cell being on offer is the board's own
   * vocabulary rather than a state of anybody, so it is not among these.
   */
  const stateWords = PROCESS.flatMap(c => [c.title, c.line]).join(" ").match(/\b(not yet|waiting|done|registered|issued|requested|skipped|enrolled)\b/gi) ?? [];
  check(stateWords.length === 0, `325h · and says nothing about the reader's state (${stateWords.join(", ") || "none"})`);
  check(/\bnot yet\b/i.test("a card saying not yet"), "325i · the state check can see one (negative control)");
  /*
   * THE DESCRIPTIONS WENT UP, AND A TITLE IS LARGER THAN WHAT IT INTRODUCES.
   *
   * This pass first took every description a step down, to 0.75rem, and the
   * founder read the result as small. The page's own scale steps by 0.0625rem and
   * the descriptions now sit a step above where this interface started, at
   * 0.875rem. A title under that has to be larger than the words it introduces,
   * which `.ag-panel-title` was not: it is an uppercase label at label size, and a
   * description a step larger left the heading smaller than its own paragraph.
   *
   * Read as numbers rather than as patterns, so the relationship is what is held
   * and either can move as long as the gap survives.
   */
  const STEP = 0.0625;
  const sizeOf = (rule: string) => Number(/font-size:\s*([0-9.]+)rem/.exec(rule)?.[1] ?? NaN);
  const subRule = /\.ag-sub\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  const titleRule = /\.ag-process-title\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(sizeOf(subRule) === 0.875, `325j · a description is one step above where this interface started (${sizeOf(subRule)}rem)`);
  check(Number.isFinite(sizeOf(titleRule)), `325j2 · the home's card title has a size of its own (negative control for the read, ${sizeOf(titleRule)})`);
  check(sizeOf(titleRule) >= sizeOf(subRule) + 2 * STEP,
    `325k · and a card title is at least two steps above its description (${sizeOf(titleRule)}rem over ${sizeOf(subRule)}rem)`);
  check(!(0.75 >= 0.875 + 2 * STEP), "325k2 · the ratio check can see a title that is not (negative control)");
  check(/<h3 className="ag-process-title">\{step\.title\}<\/h3>/.test(home),
    "325k3 · which is the class the home's cards actually carry, not one measured beside them");
  /*
   * Three rows, so a neighbour cannot sit on the state being read.
   *
   * They shared one cell and the projection put them over it. The rows are the
   * mechanism rather than the translate distances, which is why this reads the
   * template and the row each neighbour is placed in.
   */
  /*
   * 324f and 324g are retired with the three rows they counted. The stage held the
   * state being read between its two neighbours; the neighbours are gone and the
   * stage is one row, which 313a holds.
   */
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
  /*
   * And the card area takes the room the dialog has rather than a height in rem.
   *
   * It was a fixed height because three cards had to sit in a frame that did not
   * jump between states. One card, and the dialog's own min and max above still
   * hold the frame still, so a number here would be a box drawn around nothing and
   * would leave the rail beside it stopping short of the frame.
   */
  // `min-height: 0` contains the word, so the fixed height is matched at the start
  // of its own declaration rather than anywhere the six letters appear.
  check(!/(^|[;{]\s*)height:\s*[0-9]/.test(stageRule) && /grid-template-rows:\s*minmax\(0, 1fr\)/.test(stageRule),
    `313a · and the card area takes the height the dialog gives it (${stageRule.replace(/\s+/g, " ").trim().slice(0, 70)})`);

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
   * AND THE CARD CANNOT CONTRADICT THE RUN.
   *
   * The run proposes under the wallet's own credential, or under the
   * environment's for the one wallet it belongs to. The read only asked about the
   * wallet's own, so that wallet was told it had none while the run proposed for
   * it under exactly that credential, and on the deployment that carries one it is
   * the wallet a person is most likely to be looking at. Both read this rule now.
   */
  const OWNER = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
  const OTHER = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
  check(environmentCredentialCovers(OWNER, "ingest-key", OWNER), "316d · the environment's credential covers the wallet it belongs to");
  check(!environmentCredentialCovers(OTHER, "ingest-key", OWNER), "316e · and covers no other wallet (negative control)");
  check(!environmentCredentialCovers(OWNER, "", OWNER) && !environmentCredentialCovers(OWNER, "ingest-key", ""),
    "316f · and covers nobody where either half is unset");
  check(environmentCredentialCovers(OWNER.toLowerCase(), "ingest-key", OWNER.toUpperCase().replace("0X", "0x")),
    "316g · comparing the two addresses as addresses rather than as text");
  check(/environmentCredentialCovers\(payer, process\.env\.XOVI_INGEST_KEY, process\.env\.XOVI_INGEST_KEY_PAYER\)/.test(readFileSync("app/api/agent/registration/route.ts", "utf8")),
    "316h · and the registration read answers through it rather than through a second copy of the rule");

  /*
   * A run that stops before proposing says why, in the run's own sentence.
   */
  /*
   * Read off the run's own map rather than off literals supplied here.
   *
   * The first version handed `lineFor` two sentences it had written itself and
   * compared the rendering with them, so both entries of the map could have become
   * one sentence and the pair would have stayed green: they held the drawing and
   * not the thing being drawn.
   */
  const unconfigured = lineFor({ step: "not-submitted", detail: NOT_SUBMITTED_SENTENCE.unconfigured, reason: "unconfigured" });
  const noCredential = lineFor({ step: "not-submitted", detail: NOT_SUBMITTED_SENTENCE["no-credential"], reason: "no-credential" });
  check(unconfigured.text === NOT_SUBMITTED_SENTENCE.unconfigured && noCredential.text === NOT_SUBMITTED_SENTENCE["no-credential"],
    `317 · the stop card carries the reason's own sentence (${noCredential.text})`);
  check(NOT_SUBMITTED_SENTENCE.unconfigured !== NOT_SUBMITTED_SENTENCE["no-credential"],
    "317a · and the run gives the two reasons two sentences rather than one");
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
  const headerChips = page.slice(headerStart, headerEnd);
  const accountChips = page.slice(accountStart, accountStart + 500);
  check(/<IdentityChips\b/.test(headerChips), "311a · the header carries them on every destination");
  check(/<IdentityChips\b/.test(accountChips), "311b · and the account body opens with them too");
  /*
   * THE CREDENTIAL IS NOT ONE OF THE HEADER'S.
   *
   * Three chips over every destination was one thing too many, and the credential
   * is the one a person acts on least: its state is unchanged and is on the
   * enrolment card and in the account, which is where somebody goes to read it.
   */
  check(/credential=\{false\}/.test(headerChips), "311g · and the credential is not among them");
  check(/\bcredential\b(?!=\{false\})/.test(accountChips), "311h · while the account draws it (negative control)");
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

  /*
   * THE TWO CHIPS THAT MAKE A CLAIM CAN BE CHECKED, EACH WHERE ITS CLAIM LIVES.
   *
   * A registration answered by AgentBook is a row on World Chain; one made in this
   * page is a verification against World's own credential, and World publishes no
   * page about a particular wallet, so that link's title says which of the two it
   * opens rather than letting a reader take it for their own record. The name goes
   * to the app the runbook administers it in. Same tab, as every explorer link on
   * this surface already is, and nothing is fetched: these are hrefs, so the page
   * loads no origin it does not serve.
   */
  check(registrationHref("agentbook") === `${WORLDSCAN_ADDRESS}${AGENTBOOK_ON_WORLD_CHAIN}`,
    `413g · a registration AgentBook answered links to that registry on World Chain (${registrationHref("agentbook")})`);
  check(registrationHref("worldid") === WORLD_ID_PAGE,
    `413h · one made in this page links to World's own page about the credential (${registrationHref("worldid")})`);
  check(registrationHref(null) === null, "413i · and a wallet no source answered for links nowhere (negative control)");
  check(/not a record of this wallet/.test(registrationHrefTitle("worldid") ?? ""),
    `413j · with that link saying it is about World ID and not about this wallet (${registrationHrefTitle("worldid")})`);
  check(/registry on World Chain/.test(registrationHrefTitle("agentbook") ?? ""),
    `413k · while the registry link says it holds the registration (negative control, ${registrationHrefTitle("agentbook")})`);
  check(AGENTBOOK_ON_WORLD_CHAIN === AGENTBOOK_ADDRESS_WORLDCHAIN,
    `413l · the registry linked is the one the lookup reads (${AGENTBOOK_ON_WORLD_CHAIN} against ${AGENTBOOK_ADDRESS_WORLDCHAIN})`);
  const chipAnchors = [...page.matchAll(/<a className="ag-chip[^"]*" href=\{([^}]*)\}/g)].map(m => m[1]);
  check(chipAnchors.length === 2, `413m · the two chips are anchors and the third is not (${chipAnchors.join(" | ") || "none"})`);
  check(!/ag-chip[^>]*target=/.test(page), "413n · opening in the same tab, as the explorer links on this surface do");
  /*
   * AND NOTHING LOADS FROM THEM, WHICH IS MORE WAYS THAN A FETCH.
   *
   * This searched the shell for a `fetch` naming one of the three, so a preconnect
   * in the layout and an image from the registry host on the chip both stayed
   * green: a link element and an `src` load an origin exactly as a fetch does, and
   * a preconnect reaches the host before anybody clicks anything. Read over every
   * file under `app`, since the layout is where a link tag would live and this
   * check only ever looked at the shell.
   */
  // The hosts and the names the page holds them under. Matching the literal alone
  // left an `img` whose src was built from the exported constant green, which is
  // the same hole one level up: what matters is that the browser reaches the host,
  // however the string was spelled at the call site.
  const HOSTS = ["worldscan.org", "world.org", "app.ens.dev", "WORLDSCAN_ADDRESS", "WORLD_ID_PAGE", "ENS_APP"];
  const appFiles = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : /\.(tsx?|css)$/.test(entry.name) ? [join(dir, entry.name)] : [],
    );
  })("app");
  check(appFiles.length > 3, `413o0 · the app's own files are walked (negative control, ${appFiles.length})`);
  const LOADERS = /(?:\bsrc\s*=|<iframe|rel=["'](?:preconnect|dns-prefetch|prefetch|preload)["']|@import|url\()/;
  const loading: string[] = [];
  for (const file of appFiles) {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!HOSTS.some(h => line.includes(h))) continue;
      // An href on an anchor is a destination a person chooses. Anything that
      // makes the browser reach the host on its own is a load.
      if (LOADERS.test(line) || /rel=\{?["']?(?:preconnect|dns-prefetch|prefetch|preload)/.test(line)) loading.push(`${file}: ${line.slice(0, 60)}`);
    }
  }
  check(loading.length === 0, `413o · and nothing under app loads any of the three, by any tag (${loading.join(" | ") || "none"})`);
  check(LOADERS.test('<link rel="preconnect" href="https://worldscan.org" />') && LOADERS.test('<img src="https://worldscan.org/x.png" />'),
    "413o2 · the loader check can see a preconnect and an image (negative control)");
  check(!LOADERS.test('<a href="https://worldscan.org/address/0x00">chip</a>'),
    "413o3 · while an anchor a person chooses to follow is not a load (negative control)");
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
  // Driven rather than read: one builder makes the url the price is read from and
  // the url the run pays for, so a cell cannot be priced from one request and read
  // from another.
  const cellUrl = windowsUrlFor("https://example.test", { day: "2026-09-04", species: "mexicanum" });
  check(cellUrl === "https://example.test/api/agent/windows?day=2026-09-04&species=mexicanum",
    `280a · the chosen cell is what the run reads (${cellUrl})`);
  check(windowsUrlFor("https://example.test", null) === "https://example.test/api/agent/windows",
    "280a2 · and no cell asks for the whole snapshot (negative control)");
  const builders = (page.match(/new URL\("\/api\/agent\/windows"/g) ?? []).length;
  check(builders === 1, `280a3 · with one place building that url (${builders})`);

  /*
   * THE CELL'S TWO TIMES, THE WORDS THAT LEFT THEM, AND THE NUMBER IT NEVER
   * CARRIES.
   *
   * How long the recording runs and the span its windows cover, in that order, and
   * each left out where it is not known rather than guessed. The labels are gone
   * and the units carry the difference, since a recording runs in minutes or hours
   * and a window in seconds; the price left this line for a ribbon of its own,
   * because it is the thing being decided about rather than a fact about the
   * footage.
   */
  const full: BoardCellView = { day: "2026-09-04", species: "mexicanum", onOffer: true, videoId: "vidA", thumbnail: "https://i.ytimg.com/vi/vidA/mqdefault.jpg", recordingSeconds: 10013, windowSeconds: { min: 12, max: 36 } };
  const line = cellMetaLine(full);
  check(line === "2 h 47 min · 12 to 36 s", `318 · a cell says how long the recording runs and the span its windows cover (${line})`);
  check(!/\b5\b/.test(line), `318a · and never how many windows it holds (${line})`);
  check(!/recording|windows/i.test(line), `318a2 · with neither word read out loud beside its own value (${line})`);
  check(/recording|windows/i.test("recording 2 h 47 min · windows 12 to 36 s"), "318a3 · the label check can see them (negative control)");
  const bare = cellMetaLine({ day: "2026-09-04", species: "mexicanum", onOffer: true });
  check(bare === "", `318b · a cell with nothing known says nothing rather than guessing (${bare || "empty"})`);
  check(!/USDC|\$/.test(line), `318c · and no price, which is a ribbon on the cell rather than a third fact in this line (${line})`);
  const single = cellMetaLine({ ...full, windowSeconds: { min: 94, max: 94 } });
  check(/94 s/.test(single) && !/94 to 94/.test(single), `318d · one span is said once rather than as a range of itself (${single})`);
  check(readableLength(10013) === "2 h 47 min" && readableLength(600) === "10 min", `318e · a recording's length reads as hours and minutes (${readableLength(10013)})`);

  /*
   * The thumbnail is the recording's own, and its alt text names the day and the
   * species and nothing else: a station or an alias there would put on a public
   * surface exactly what the gate keeps off the wire.
   */
  const boardJsx = page.slice(page.indexOf("function Board("), page.indexOf("function Records("));
  // The alt text itself, extracted and read, rather than the line it sits on: a
  // field name in it is one way to leak a station and a literal is another, and a
  // check that only refuses the field names would never see the literal.
  const alts = [...boardJsx.matchAll(/alt=\{`([^`]*)`\}|alt="([^"]*)"/g)].map(m => m[1] ?? m[2]);
  check(alts.length === 1 && alts[0] === "The recording for ${day}, ${species}",
    `319 · the thumbnail names the day and the species in its alt text (${alts.join(" | ") || "none found"})`);
  const leaky = alts.filter(a => /stationId|specimenAlias|candidates|detector|\bAM ?[0-9]|\bAD\b/i.test(a));
  check(leaky.length === 0, `319a · and nothing the gate keeps off the wire (${leaky.join(" | ") || "none"})`);
  check(/\bAM ?[0-9]/i.test("The recording for AM 1"), "319a2 · the station check can see one (negative control)");
  // Anchored on the condition itself. Reading the block for `on &&` matched the
  // meta line's own guard, so dropping it from the thumbnail left the check green.
  check(/\{on && cell\?\.thumbnail !== undefined && \(/.test(boardJsx),
    "319b · drawn only for a cell on offer that has one");
  /*
   * WHAT A PAID READ RETURNS, COUNTED.
   *
   * The cell reached the challenge and never the read: a person chose one cell,
   * signed for it, and the run was served the whole snapshot, five days for the
   * price of one cell. Driven through the same handler the run calls, with the
   * cell's own count as the measure and the whole snapshot as the control, so a
   * url that quietly stops carrying the cell is a number that changes here.
   */
  const wholeSnapshot = loadSnapshot();
  const oneCell = cellOf(wholeSnapshot, "2026-09-03", "mexicanum");
  check(oneCell.length > 0 && oneCell.length < wholeSnapshot.length,
    `320 · a cell is a part of the snapshot and not all of it (${oneCell.length} of ${wholeSnapshot.length})`);
  const runUrl = runWindowsUrlFor("http://127.0.0.1/api/agent/run?day=2026-09-03&species=mexicanum");
  check(runUrl.endsWith("?day=2026-09-03&species=mexicanum"),
    `320a · the url the run builds carries the cell it was paid for (${runUrl})`);
  // Past the cell check, which is what says the run asked for that cell. Whether
  // the payment path then answers 402 or 503 is the facilitator's and is asserted
  // elsewhere, which is the standard 272c holds this to.
  const cellAnswer = await windowsGET(new Request(runUrl));
  check(cellAnswer.status !== 404 && cellAnswer.status !== 400,
    `320b · and that cell is one the route serves (${cellAnswer.status})`);
  // The url a run with no cell would have asked for, which is the whole snapshot,
  // and the route answers it: that is the behaviour the refusal now stands in front
  // of, kept here as the measure of what was being given away.
  const snapshotUrl = runWindowsUrlFor("http://127.0.0.1/api/agent/run");
  check(snapshotUrl === "http://127.0.0.1/api/agent/windows" && !namesACell("http://127.0.0.1/api/agent/run"),
    `320c · a run naming no cell asks for the whole snapshot, which is why the route refuses one (${snapshotUrl})`);
  const bodyForCell = JSON.stringify(await cellAnswer.json());
  check(!/"windowId"/.test(bodyForCell), "320d · and nothing is served before it is paid for (negative control)");
  // The refusal itself, driven through the route rather than through the rule it
  // calls: a run that names no cell is turned away instead of being handed the
  // snapshot, which is what it used to be handed.
  const cellless = await runPOST(new Request("http://127.0.0.1/api/agent/run", { method: "POST" }));
  check(cellless.status === 400, `320e · a run naming no cell is refused (${cellless.status})`);
  const halfCell = await runPOST(new Request("http://127.0.0.1/api/agent/run?day=2026-09-03", { method: "POST" }));
  check(halfCell.status === 400, `320f · and so is one naming half of one (${halfCell.status})`);
  const withCell = await runPOST(new Request("http://127.0.0.1/api/agent/run?day=2026-09-03&species=mexicanum", { method: "POST" }));
  check(withCell.status !== 400, `320g · while a run naming a cell is not (negative control, ${withCell.status})`);
  await withCell.body?.cancel();
  /*
   * And the page's own half, which is the half a browser runs.
   *
   * The route refuses a run with no cell and the url builder carries one, and both
   * are beside the point if the page never sends it: removing the cell from the
   * post left every check above green, because none of them is the browser.
   */
  const postStart = page.indexOf('new URL("/api/agent/run"');
  const postEnd = page.indexOf("if (!response.body)", postStart);
  check(postStart > 0 && postEnd > postStart, "320h · the page's run request is found (negative control for the slice)");
  const runPost = page.slice(postStart, postEnd);
  check(/searchParams\.set\("day", chosen\.day\)/.test(runPost) && /searchParams\.set\("species", chosen\.species\)/.test(runPost),
    "320i · and the page sends the chosen cell with the run it pays for");
  check(/fetch\(runUrl\.toString\(\), \{ method: "POST"/.test(runPost),
    "320j · posting that url rather than a second one built beside it");

  /*
   * WHERE THIS WALLET'S OWN AGENT HAS BEEN, AND NOBODY ELSE'S.
   *
   * The row is thin on purpose: a cell, a payer, how it was paid for, what came of
   * it and when. No window, no station, no alias, because the windows are the thing
   * being sold and the thing the gate screens, and a table that remembered which
   * ones a person received would put exactly that behind an address the board reads
   * from. And no count of anything, for the reason the board serves none.
   */
  const MINE = "0x1111111111111111111111111111111111111aaa";
  const THEIRS = "0x1111111111111111111111111111111111111bbb";
  const rows: RunRow[] = [];
  const asked: string[] = [];
  setRunsStoreForTest({
    record: async row => {
      rows.push({ ...row, ranAt: row.ranAt.toISOString() });
    },
    marksFor: async payer => {
      asked.push(String(payer));
      const seen = new Map<string, RunMark>();
      for (const r of rows) {
        if (r.payer.toLowerCase() !== payer.toLowerCase()) continue;
        const key = `${r.day}|${r.species}`;
        const kept = seen.get(key);
        if (kept === undefined || kept.ranAt < r.ranAt) seen.set(key, { day: r.day, species: r.species, outcome: r.outcome, clipId: r.clipId, ranAt: r.ranAt });
      }
      return [...seen.values()];
    },
  });

  const paidStep: RunStep = { step: "paid", free: false, transaction: "0xabc", network: "eip155:84532" };
  const proposedRun = runOutcome([paidStep, { step: "proposed", id: 261, clipHash: "0xhash", status: "proposed" }]);
  check(proposedRun?.outcome === "proposed" && proposedRun.clipId === 261 && proposedRun.free === false && proposedRun.txHash === "0xabc",
    `321 · a run that proposed is recorded as proposed, with its clip (${JSON.stringify(proposedRun)})`);
  const duplicateRun = runOutcome([{ step: "paid", free: true }, { step: "declined", kind: "duplicate", detail: "" }]);
  check(duplicateRun?.outcome === "declined:duplicate" && duplicateRun.free === true && duplicateRun.txHash === null && duplicateRun.clipId === null,
    `321a · a declined run keeps its kind, and a free read carries no transaction (${JSON.stringify(duplicateRun)})`);
  check(runOutcome([{ step: "presenting" }, { step: "payment-refused", status: 402, detail: "" }]) === null,
    "321b · a run the route never served leaves no row, because it read nothing");
  check(runOutcome([{ step: "paid", free: false }]) === null,
    "321c · and a settled read with no transaction is not recorded as free (negative control)");
  const rowKeys = Object.keys(proposedRun ?? {}).sort().join(",");
  check(rowKeys === "clipId,free,outcome,txHash", `321d · a row carries those four facts and nothing about a window (${rowKeys})`);

  const record = async (payer: string, day: string, species: string, outcome: RunOutcome, at: string) => {
    const store = runsStoreFrom();
    await store?.record({ payer, day, species, ...outcome, ranAt: new Date(at) });
  };
  await record(MINE, "2026-09-03", "mexicanum", { free: true, txHash: null, outcome: "proposed", clipId: 261 }, "2026-09-13T05:12:00Z");
  await record(THEIRS, "2026-09-03", "dumerilii", { free: true, txHash: null, outcome: "proposed", clipId: 999 }, "2026-09-13T05:20:00Z");
  check(rows.length === 2, `321e · two runs recorded leave two rows (${rows.length})`);
  /*
   * ONE SERVED RUN WRITES ONE ROW, COUNTED.
   *
   * Counting rows after two calls proves that two calls made two rows and nothing
   * about how many a run makes: a second write in the finalizer would have left it
   * green. The write is its own function for that reason, since a route handler is
   * somewhere a check cannot reach, and here the calls are counted.
   */
  const servedRun: RunStep[] = [{ step: "paid", free: true }, { step: "proposed", id: 262, clipHash: "0xh", status: "proposed" }];
  const writesBefore = rows.length;
  await recordRun({ outcome: runOutcome(servedRun), payer: MINE, day: "2026-09-05", species: "mexicanum", store: runsStoreFrom(), at: new Date("2026-09-13T06:00:00Z") });
  check(rows.length === writesBefore + 1, `321f · one served run writes exactly one row (${rows.length - writesBefore})`);
  await recordRun({ outcome: runOutcome([{ step: "presenting" }]), payer: MINE, day: "2026-09-05", species: "mexicanum", store: runsStoreFrom(), at: new Date() });
  check(rows.length === writesBefore + 1, "321g · a run the route never served writes none (negative control)");
  await recordRun({ outcome: runOutcome(servedRun), payer: null, day: "2026-09-05", species: "mexicanum", store: runsStoreFrom(), at: new Date() });
  check(rows.length === writesBefore + 1, "321h · nor one whose header named no payer");
  await recordRun({ outcome: runOutcome(servedRun), payer: MINE, day: "2026-09-05", species: "mexicanum", store: null, at: new Date() });
  check(rows.length === writesBefore + 1, "321i · and no store configured writes nothing and throws nothing");
  const finalizer = readFileSync("app/api/agent/run/route.ts", "utf8");
  const calls = (finalizer.match(/recordRun\(/g) ?? []).length;
  check(calls === 1, `321j · the route calls it once (${calls})`);
  rows.length = writesBefore;

  const mineBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const myMarks = mineBoard.cells.filter(c => c.read !== undefined);
  check(myMarks.length === 1 && (myMarks[0] as { day: string }).day === "2026-09-03" && (myMarks[0] as { species: string }).species === "mexicanum",
    `322 · the board marks the cell this payer read (${JSON.stringify(myMarks)})`);
  check(!JSON.stringify(mineBoard).includes("999"), "322a · and carries nothing of another payer's runs (negative control)");
  const theirsBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${THEIRS}`))).json()) as { cells: Record<string, unknown>[] };
  check(theirsBoard.cells.filter(c => c.read !== undefined).length === 1 && JSON.stringify(theirsBoard).includes("999"),
    "322b · while that payer sees its own (negative control)");
  const anonymous = (await (await boardGET(new Request("http://127.0.0.1/api/agent/board"))).json()) as { cells: Record<string, unknown>[] };
  check(anonymous.cells.every(c => c.read === undefined), "322c · a board asked without a payer carries no marks at all");
  // And the table is not asked at all, which is the property the guard carries: a
  // store asked about nobody answers nothing either way, so the absence of marks
  // alone cannot tell whether the guard is there.
  const askedBefore = asked.length;
  await boardGET(new Request("http://127.0.0.1/api/agent/board"));
  check(asked.length === askedBefore, `322c2 · and the table is never asked (${asked.length - askedBefore} asks)`);
  await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`));
  check(asked.length === askedBefore + 1, "322c3 · while a board naming a payer asks once (negative control)");
  const markKeys = [...new Set(myMarks.flatMap(c => Object.keys(c.read as object)))].sort().join(",");
  check(markKeys === "clipId,outcome,ranAt", `322d · a mark carries what came of the run and when, and nothing else (${markKeys})`);
  const planted = servedCell({ day: "2026-09-03", species: "mexicanum", onOffer: true, read: { outcome: "proposed", clipId: 1, ranAt: "2026-09-13T05:12:00Z", stationId: "AM 1", specimenAlias: "Alfa" } } as never);
  check(!JSON.stringify(planted).includes("AM 1") && !JSON.stringify(planted).includes("Alfa"),
    `322e · and a station or an alias planted in a row is refused by the shape (${JSON.stringify(planted.read)})`);

  /*
   * WHETHER THAT CLIP IS ANCHORED, ASKED OF THE ANCHOR STORE AND NEVER INFERRED.
   *
   * The board's fourth stage is a separate event with a separate store, so it is
   * read rather than derived from the proposal existing. Only the clips this
   * payer's own runs produced are looked up, which are the ids already on this
   * payer's own marks, so no identifier that was not going to be served is asked
   * about. And a half finished anchor is not done: a row written before the first
   * transaction and never completed is the state the High finding on `claim` was
   * about, and reading it as anchored is that confusion again.
   */
  const lookedUp: number[] = [];
  const anchorRows = new Map<number, AnchorRow>();
  const signedStub = { clipId: 0 } as never;
  anchorRows.set(261, { clipId: 261, uid: "0xu", clipHash: "0xh", schemaUid: "0xs", attester: "0xa", signed: signedStub, attestTx: "0xt", onchainUid: "0xo" });
  setStoreForTest({
    claim: async () => ({ fresh: false, row: anchorRows.get(261) as AnchorRow }),
    byClipId: async clipId => {
      lookedUp.push(clipId);
      return anchorRows.get(clipId) ?? null;
    },
    complete: async () => undefined,
    byUid: async () => null,
  });
  const anchoredBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const anchoredMark = anchoredBoard.cells.find(c => c.read !== undefined)?.read as { attested?: boolean } | undefined;
  check(anchoredMark?.attested === true, `410 · a clip the anchor store has finished rides on the mark as attested (${JSON.stringify(anchoredMark)})`);
  check(lookedUp.join(",") === "261", `410a · asked only about the clip this payer's own run produced (${lookedUp.join(", ") || "none"})`);
  check(!lookedUp.includes(999), "410a2 · and never about another payer's (negative control)");

  // A row with no attestation transaction is a half anchor. `nextAction` decides
  // it, the same function the anchoring run decides on, rather than a second rule.
  anchorRows.set(261, { clipId: 261, uid: "0xu", clipHash: "0xh", schemaUid: "0xs", attester: "0xa", signed: signedStub, timestampTx: "0xtt" });
  const halfBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const halfMark = halfBoard.cells.find(c => c.read !== undefined)?.read as { attested?: boolean } | undefined;
  check(halfMark?.attested === false, `410b · a half finished anchor is carried as not attested rather than as anchored (${JSON.stringify(halfMark)})`);
  check(nextAction(anchorRows.get(261) as AnchorRow) !== "done", "410b2 · which is the anchoring run's own reading of that row (negative control)");

  /*
   * A STORE THAT ANSWERS NOTHING AND A STORE THAT CANNOT ANSWER ARE TWO THINGS.
   *
   * No row for a clip is an answer: nothing has been anchored for it, which is
   * what `nextAction` says of a null row, so the mark carries not attested. A read
   * that threw is not an answer and leaves the key off, and the bar reads an
   * absent key as not seen rather than as no.
   */
  anchorRows.delete(261);
  const unknownBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const unknownMark = unknownBoard.cells.find(c => c.read !== undefined)?.read as { attested?: boolean } | undefined;
  check(unknownMark?.attested === false, `410c · a clip the store has no row for is not attested, because the store answered (${JSON.stringify(unknownMark)})`);
  check(nextAction(null) !== "done", "410c2 · which is the anchoring run's own reading of no row (negative control)");

  setStoreForTest({
    claim: async () => ({ fresh: false, row: signedStub }),
    byClipId: async () => {
      throw new Error("the anchor store is unavailable");
    },
    complete: async () => undefined,
    byUid: async () => null,
  });
  const brokenBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const brokenMark = brokenBoard.cells.find(c => c.read !== undefined)?.read as Record<string, unknown> | undefined;
  check(brokenMark !== undefined && !("attested" in brokenMark),
    `410c3 · while a store that threw leaves the key off, which is not an answer (${JSON.stringify(brokenMark)})`);

  setStoreForTest(null);
  const noStoreBoard = (await (await boardGET(new Request(`http://127.0.0.1/api/agent/board?payer=${MINE}`))).json()) as { cells: Record<string, unknown>[] };
  const noStoreMark = noStoreBoard.cells.find(c => c.read !== undefined)?.read as Record<string, unknown> | undefined;
  check(noStoreMark !== undefined && !("attested" in noStoreMark), `410d · and no store configured serves the mark without it rather than failing the board (${JSON.stringify(noStoreMark)})`);
  setStoreForTest(undefined);

  const plantedAnchor = servedCell({ day: "2026-09-03", species: "mexicanum", onOffer: true, read: { outcome: "proposed", clipId: 1, ranAt: "2026-09-13T05:12:00Z", attested: true } } as never);
  check((plantedAnchor.read as { attested?: boolean })?.attested === true, "410e · the served shape carries the answer through rather than dropping it");
  setRunsStoreForTest(undefined);

  /*
   * HOW FAR A CELL GOT, AS FOUR EVENTS AND NOT AS ONE WORD.
   *
   * Four sources: the runs table, the run's own outcome, Zenbit's public list and
   * the anchor store. None is inferred from the one before it, which is the whole
   * reason the bar has four segments; driven here on the same read with three
   * different answers from the last two, so a stage that filled itself forward
   * from the one before shows.
   */
  const proposedRead = { outcome: "proposed", clipId: 261, ranAt: "2026-09-13T05:12:00Z" };
  check(LIFECYCLE.join(",") === "read,proposed,confirmed,attested", `323 · four events in order (${LIFECYCLE.join(", ")})`);
  const waiting = lifecycleOf(proposedRead, new Set<number>());
  check(waiting.join(",") === "done,done,not seen,not seen", `323a · a proposal the public list does not carry is read and proposed and no further (${waiting.join(", ")})`);
  const listUnread = lifecycleOf(proposedRead, null);
  check(listUnread.join(",") === waiting.join(","), `323a2 · and a list nobody could read leaves it exactly there rather than further or worse (${listUnread.join(", ")})`);
  const confirmedOnly = lifecycleOf(proposedRead, new Set([261]));
  check(confirmedOnly.join(",") === "done,done,done,not seen", `323b · a clip the list carries is confirmed and not yet attested (${confirmedOnly.join(", ")})`);
  const anchoredToo = lifecycleOf({ ...proposedRead, attested: true }, new Set([261]));
  check(anchoredToo.join(",") === "done,done,done,done", `323b2 · and the anchor's own answer is what fills the fourth (${anchoredToo.join(", ")})`);
  /*
   * AND THE ANCHOR ANSWERS FOR BOTH OF THE LAST TWO.
   *
   * An attestation is of a confirmation: Zenbit anchors the reviewer's own signed
   * decision, so a clip this deployment has anchored was confirmed by a person
   * whatever the public list carries. This check said the opposite, and the state
   * it got wrong is real: the list returns the fifty most recent, so a clip that
   * falls out of the fifty was drawn as not seen for both stages while Zenbit held
   * its own record of the confirmation.
   */
  const attestedAlone = lifecycleOf({ ...proposedRead, attested: true }, new Set<number>());
  check(attestedAlone.join(",") === "done,done,done,done",
    `323b3 · a clip the chain carries is confirmed and attested however old it is, since the list keeps only fifty (${attestedAlone.join(", ")})`);
  const attestedUnread = lifecycleOf({ ...proposedRead, attested: true }, null);
  check(attestedUnread.join(",") === "done,done,done,done",
    `323b3b · and a list nobody could read takes nothing away from what the chain says (${attestedUnread.join(", ")})`);
  check(confirmedOnly.join(",") === "done,done,done,not seen",
    `323b3c · while the list is still the source for a confirmed clip that is not anchored (negative control, ${confirmedOnly.join(", ")})`);
  /*
   * And nothing reaches past a stop, whatever the two later sources say.
   *
   * The wire cannot produce this today: a mark carries an anchor answer only where
   * it carries a clip id, and a clip id only where the run proposed. It is held
   * anyway, because the guard is one line and removing it changed no check: a bar
   * drawing confirmed and attested under a run that stopped is exactly the chain
   * that has not happened.
   */
  const stoppedYetAnchored = lifecycleOf({ outcome: "declined:duplicate", clipId: null, attested: true }, new Set([261]));
  check(stoppedYetAnchored.join(",") === "done,stopped,not reached,not reached",
    `323b3d · a run that stopped reaches nothing past the stop, whatever the chain and the list carry (${stoppedYetAnchored.join(", ")})`);
  const readYetAnchored = lifecycleOf({ outcome: "read", clipId: null, attested: true }, new Set([261]));
  check(readYetAnchored.join(",") === "done,not seen,not reached,not reached",
    `323b3e · and nor does one that only read (negative control, ${readYetAnchored.join(", ")})`);
  /*
   * NOT REACHED IS NOT NOT SEEN, AND IT CARRIES NO REASON.
   *
   * A run that never proposed has no clip for the list to carry or the chain to
   * anchor, so saying those two did not see it suggests they looked. The reason
   * explains the list, and there is nothing about the list to explain here.
   */
  const stoppedStages = lifecycleOf({ outcome: "not-submitted", clipId: null }, new Set<number>());
  check(stoppedStages.slice(2).every(x => x === "not reached"),
    `319g · a stopped run's later stages are not reached rather than not seen (${stoppedStages.join(", ")})`);
  check(stoppedStages.every((_, i) => reasonForStage(stoppedStages, i) === undefined),
    "319h · and not one of them carries the list's reason");
  /*
   * And for a proposal the list does not carry, the reason is said once, on the
   * only stage the list could have filled. The anchor stage being unseen is the
   * anchor store's silence, not the list's.
   */
  const unconfirmedStages = lifecycleOf(proposedRead, new Set<number>());
  const withReason = unconfirmedStages.map((_, i) => reasonForStage(unconfirmedStages, i)).filter(x => x !== undefined);
  check(withReason.length === 1, `319i · a proposal the list does not carry says why once (${withReason.length} stages)`);
  check(reasonForStage(unconfirmedStages, LIFECYCLE.indexOf("confirmed")) === NOT_SEEN_REASON,
    "319j · on the confirmed stage, which is the one the list could have filled");
  check(reasonForStage(unconfirmedStages, LIFECYCLE.indexOf("attested")) === undefined,
    "319k · and not on the anchor's, whose silence is the anchor store's and not the list's");
  const confirmedStages = lifecycleOf(proposedRead, new Set([261]));
  check(confirmedStages.map((_, i) => reasonForStage(confirmedStages, i)).filter(x => x !== undefined).length === 0,
    `319l · while a confirmed clip carries it nowhere (negative control, ${confirmedStages.join(", ")})`);
  const otherClip = lifecycleOf(proposedRead, new Set([260]));
  check(otherClip[2] === "not seen", `323b4 · and the list is matched on this clip rather than on carrying any (${otherClip.join(", ")})`);

  /*
   * NOT SEEN IS NEVER REJECTED, ANYWHERE.
   *
   * The list serves confirmed rows only and returns the fifty most recent, so a
   * proposal missing from it is waiting on a person, refused by one, or older than
   * fifty, and nothing here holds those apart. Over every outcome the run can
   * write plus one it cannot, because the branch nobody drives is the branch
   * nobody guards, and a count planted in a fallback stayed green once already.
   */
  const everyOutcome = ["proposed", "declined:duplicate", "declined:refused", "declined:rejected", "cell-spent", "nothing-proposable", "not-submitted", "read", "something-new"];
  const everyLine = everyOutcome.map(outcome => lifecycleLine({ outcome, clipId: outcome === "proposed" ? 261 : null, ranAt: "2026-09-13T05:12:00Z" }, lifecycleOf({ outcome, clipId: outcome === "proposed" ? 261 : null }, new Set<number>())));
  const judged = everyLine.filter(l => /\breject|\brefused\b|\bturned down\b/i.test(l));
  check(judged.length === 0, `323c · no sentence turns an absence from the list into a decision (${judged.join(" | ") || "none"})`);
  check(/\breject/i.test("your agent proposed clip 261, rejected"), "323c2 · the decision check can see one (negative control)");
  const counted = everyLine.filter(l => /\d+\s*(windows|reads|clips)\b/.test(l));
  check(counted.length === 0, `323c3 · and no branch counts anything (${counted.join(" | ") || "none"})`);
  check(/\d+\s*windows\b/.test("your agent read it, 5 windows · 05:12 UTC"), "323c4 · the count check can see one (negative control)");
  check(everyLine.every(l => /05:12 UTC$/.test(l) && l.startsWith("your agent")), `323d · and every branch says whose agent and when (${everyLine.length} branches)`);
  check(lifecycleLine(proposedRead, waiting) === "your agent proposed clip 261, not seen in the public list · 05:12 UTC",
    `323d2 · a proposal the list does not carry says not seen (${lifecycleLine(proposedRead, waiting)})`);
  check(lifecycleLine(proposedRead, anchoredToo) === "your agent proposed clip 261, a person confirmed it, and it is attested · 05:12 UTC",
    `323d3 · and one the chain carries says so (${lifecycleLine(proposedRead, anchoredToo)})`);

  /*
   * A run that stopped says why, in the run's own vocabulary rather than in a
   * second one grown on the board.
   */
  const duplicateStages = lifecycleOf({ outcome: "declined:duplicate", clipId: null }, null);
  check(duplicateStages[1] === "stopped", `323e · a run that ended before proposing is drawn as stopped, not as unseen (${duplicateStages.join(", ")})`);
  check(lifecycleOf({ outcome: "read", clipId: null }, null)[1] === "not seen",
    "323e2 · while a run the board has no stop for says nothing about why (negative control)");
  check(stopReason("declined:duplicate") === "already a clip" && stopReason("cell-spent") === "already a clip",
    `323e3 · a window already made into a clip says so either way it is reported (${stopReason("declined:duplicate")})`);
  check(stopReason("declined:anything") === "declined" && stopReason("proposed") === null,
    `323e4 · a refusal says declined and a proposal is not a stop (${stopReason("declined:anything")})`);

  /*
   * THE BOARD CARRIES NO PROSE OF ITS OWN, AND NOTHING IT SAID IS LOST.
   *
   * It carried an instruction, which is the interface read out loud over a grid
   * of days and species with a control in every cell, and two claims. The claim
   * the grid cannot make, that the agent picks the window, is the board's own
   * head line and was already there. The other, why an unseen mark is not a
   * decision, moved onto the stage that needs it, so it is read by somebody
   * looking at an unseen cell rather than by everybody arriving.
   */
  check(!/Choose a day and a species/i.test(boardJsx), "405 · the board no longer tells a person to choose a cell from a grid of cells");
  // Every paragraph of this kind in the board is an early return for a state that
  // has no grid to draw, so counting them against the returns says that none
  // stands over the grid itself, without naming the four states here.
  const boardParagraphs = (boardJsx.match(/<p className="xv-desc ag-empty">/g) ?? []).length;
  const emptyReturns = (boardJsx.match(/return <p className="xv-desc ag-empty">/g) ?? []).length;
  check(boardParagraphs > 0 && boardParagraphs === emptyReturns,
    `405a · and every paragraph it has is an empty state, so none stands over the grid (${boardParagraphs} of ${emptyReturns})`);
  const headsAt = page.indexOf("const HEADS");
  const headsBlock = headsAt === -1 ? "" : page.slice(headsAt, page.indexOf("};", headsAt));
  const boardHead = /board: \{[^}]*sub: "([^"]*)"/.exec(headsBlock)?.[1] ?? "";
  check(boardHead.length > 0, `405b0 · the board's head line is found (negative control for the read, ${boardHead})`);
  check(/The agent chooses the window and forms the proposal/.test(boardHead),
    `405b · while the claim the grid cannot make stays, in the board's own head (${boardHead})`);
  /*
   * The reason is one constant, and both the pointer and the screen reader are
   * given that same constant rather than two copies of one sentence.
   */
  check(/confirmed clips only, and the fifty most recent/.test(NOT_SEEN_REASON),
    `405c · the reason says the list holds confirmed clips only and fifty of them (${NOT_SEEN_REASON})`);
  const reasonCopies = (page.match(/confirmed clips only, and the fifty most recent/g) ?? []).length;
  check(reasonCopies === 1, `405d · written once in the page and read from there twice (${reasonCopies})`);
  check(/title=\{reasonForStage\(stages, i\)\}/.test(boardJsx),
    "405e · a pointer gets it as the stage's own title, from the one rule that decides which stage carries it");
  check(/reasonForStage\(stages, i\) === undefined \? "" : `\. \$\{NOT_SEEN_REASON\}`/.test(boardJsx),
    "405f · and a screen reader gets the same constant through the same rule, in the words the cell carries");
  /*
   * Counted over the words the cell would actually say, so the sentence is heard
   * once rather than once per unseen stage.
   */
  const saidFor = (stages: ReturnType<typeof lifecycleOf>) =>
    LIFECYCLE.map((stage, i) => `${stage}: ${stages[i]}${reasonForStage(stages, i) === undefined ? "" : `. ${NOT_SEEN_REASON}`}`).join(" ");
  const unseenSaid = saidFor(lifecycleOf(proposedRead, new Set<number>()));
  check((unseenSaid.match(/confirmed clips only, and the fifty most recent/g) ?? []).length === 1,
    `405f2 · the cell says the reason once in its own name (${(unseenSaid.match(/confirmed clips only/g) ?? []).length})`);
  const stoppedSaid = saidFor(lifecycleOf({ outcome: "not-submitted", clipId: null }, new Set<number>()));
  check(!/confirmed clips only/.test(stoppedSaid), `405f3 · and a stopped run's name carries it nowhere (${stoppedSaid})`);
  const hiddenRule = /\.ag-said\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(hiddenRule.length > 0 && /clip-path:\s*inset\(50%\)/.test(hiddenRule) && /position:\s*absolute/.test(hiddenRule),
    `405g · those words are clipped rather than hidden, so they are said and not drawn (${hiddenRule.replace(/\s+/g, " ").trim().slice(0, 60)})`);
  check(/\.ag-board-cell:focus-visible \.ag-life-seg\[data-state="not seen"\]::after\s*\{[^}]*content:\s*attr\(title\)/.test(css),
    "405h · and a keyboard is shown the same attribute, since no browser shows a title on focus");

  /*
   * The legend is gone with it. Two hues named over every screen, where a person
   * meets both on the cards themselves and the run's own rail names its actors.
   */
  check(!/ag-key/.test(page), "405i · and the hue legend no longer stands over every screen");
  check(!/ag-key/.test(css), "405j · with no rule left for it either");

  /*
   * THE PRICE IS A RIBBON ON THE CELL, NOT A THIRD FACT ABOUT THE FOOTAGE.
   *
   * It is the thing a person is deciding about, and it read as a third property of
   * the recording at the end of a line of two. Positioned on the cell, which is
   * why the cell is the positioned element and the ribbon is not in its column.
   */
  check(/<span className="ag-board-price">\{priceForCell\}<\/span>/.test(boardJsx),
    "406 · the price is drawn as its own element rather than inside the cell's line");
  const priceRule = /\.ag-board-price\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(priceRule.length > 0, `406a · and it has a rule (negative control for the read, ${priceRule.length})`);
  check(/position:\s*absolute/.test(priceRule) && /top:/.test(priceRule) && /right:/.test(priceRule),
    `406b · placed on the cell's upper right (${/top:[^;]*/.exec(priceRule)?.[0] ?? "none"}, ${/right:[^;]*/.exec(priceRule)?.[0] ?? "none"})`);
  const cellRule = /\.ag-board-cell\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(/position:\s*relative/.test(cellRule), "406c · against the cell it prices, which is the positioned element");

  /*
   * THE TWO TIMES SIT WITH THE SPECIES AND THE PILL, ON ONE ROW.
   *
   * They were a caption under the cell's name and its state, which read as a
   * second thing about a first. Held on the markup rather than on the rule, since
   * a row that carries the three is what the order is.
   */
  /*
   * Bounded by the row's own closing tag, found by its indentation.
   *
   * The first version stopped at the first `</span>`, which belongs to the species
   * nested inside, and gave a row of one. The second ran to the bar after it,
   * which meant moving the times out of the row and under it left them inside the
   * slice: the check could not see its own mutation, which is the whole thing it
   * exists to catch. JSX in this file closes at the indentation it opened at, and
   * the two controls below hold that the block is the row and stops at it.
   */
  const rowAt = boardJsx.indexOf('<span className="ag-board-row">');
  const rowIndent = rowAt === -1 ? 0 : rowAt - (boardJsx.lastIndexOf("\n", rowAt) + 1);
  const rowEnd = rowAt === -1 ? -1 : boardJsx.indexOf(`\n${" ".repeat(rowIndent)}</span>`, rowAt);
  const rowBlock = rowAt === -1 || rowEnd === -1 ? "" : boardJsx.slice(rowAt, rowEnd);
  check(rowBlock.length > 0 && rowBlock.length < boardJsx.length / 4, `407 · the cell's row is found and is a row (negative control for the read, ${rowBlock.length})`);
  check(!/ag-life|ag-board-read|ag-board-thumb/.test(rowBlock),
    "407a0 · and stops at the row, so what follows it is outside this read (negative control)");
  const order = ["ag-board-name", "ag-chip", "ag-board-meta"].map(c => rowBlock.indexOf(c));
  check(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
    `407a · carrying the species, then the pill, then the times (${order.join(", ")})`);
  const rowRule = /\.ag-board-row\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(/display:\s*flex/.test(rowRule) && /flex-wrap:\s*wrap/.test(rowRule),
    `407b · laid out as one row that wraps rather than as a column (${rowRule.replace(/\s+/g, " ").trim().slice(0, 60)})`);
  const metaRule = /\.ag-board-meta\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(!/margin-top/.test(metaRule), `407c · and the times no longer push themselves onto a line of their own (${metaRule.replace(/\s+/g, " ").trim().slice(0, 60)})`);

  /*
   * THE MARK IS A BAR OF FOUR EVENTS, AND THE BAR CARRIES NO WORDS.
   *
   * A colour cannot say why a run stopped and must not be asked to, so the bar is
   * four states and the sentence under it is the run's own. Hidden from assistive
   * technology, because the sentence says everything it says and a screen reader
   * hearing four unlabelled segments hears nothing.
   */
  const barAt = boardJsx.indexOf('<span className="ag-life">');
  const bar = barAt === -1 ? "" : boardJsx.slice(barAt, boardJsx.indexOf("ag-board-read", barAt));
  check(bar.length > 0 && bar.length < boardJsx.length / 4, `408 · the bar is found and is the bar (negative control for the read, ${bar.length})`);
  check(!/aria-hidden/.test(bar), "408a0 · and is not hidden from a screen reader, since its stages are how far the run got");
  check(/LIFECYCLE\.map/.test(bar) && /data-state=\{stages\[i\]\}/.test(bar),
    "408a · one segment per event, read off the array and the states rather than written out");
  const segRules = [...css.matchAll(/\.ag-life-seg(\[data-state="([^"]+)"\])?\s*\{([^}]*)\}/g)];
  const stated = segRules.map(m => m[2] ?? "base");
  check(stated.includes("base") && stated.includes("done") && stated.includes("stopped"),
    `408b · with a rule for the base, for done and for stopped (${stated.join(", ")})`);
  check(!stated.includes("not seen"), "408c · and none for not seen, which is the absence of a state rather than one of its own");
  check(/<span className="ag-board-read">\{lifecycleLine\(cell\.read, stages\)\}<\/span>/.test(boardJsx),
    "408d · the sentence under it is built from the same stages the bar draws, so the two cannot disagree");

  /*
   * THE BORDER SAYS WHICH OF TWO THINGS HAPPENED, AND STOPS WHEN ONE DID.
   *
   * Gold while the agent's proposal waits on a person and teal once one decided,
   * and the motion stops there: a border still breathing after a decision would
   * say something is still happening. Only `opacity` moves, on a pseudo element,
   * because animating a box shadow is a paint on every frame.
   */
  const lifeAttr = /data-life=\{([^\n]*)\}/.exec(boardJsx)?.[1] ?? "";
  check(lifeAttr.length > 0, `409 · the cell reports its own lifecycle to the stylesheet (negative control for the read, ${lifeAttr})`);
  check(/stages\[2\] === "done" \? "confirmed"/.test(lifeAttr) && /stages\[1\] === "done" \? "proposed"/.test(lifeAttr),
    `409a · confirmed where a person decided and proposed where one has not (${lifeAttr})`);
  check(/stages === null \? undefined/.test(lifeAttr), "409b · and nothing at all on a cell nobody has read");
  const glow = /\.ag-board-cell\[data-life\]::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const decided = /\.ag-board-cell\[data-life="confirmed"\]::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(glow.length > 0 && decided.length > 0, `409c · the border's two rules are found (negative control for the reads, ${glow.length}/${decided.length})`);
  check(/var\(--color-xv-agent\)/.test(glow) && /var\(--color-primary\)/.test(decided),
    "409d · the agent's own hue while it waits and teal once a person decided, from the tokens rather than as literals");
  /*
   * AND IT DOES NOT MOVE, IN ANY STATE.
   *
   * It breathed while a proposal waited. A board of cells breathing at a reader is
   * motion reporting nothing that is happening: the proposal is not moving, it is
   * waiting, and the founder read the pulse as the page working. Read over every
   * rule that mentions the cell rather than over the two above, so a third state
   * cannot arrive with an animation on it.
   */
  const cellRules = [...css.matchAll(/([^{}]*\.ag-board-cell[^{}]*)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].replace(/\s+/g, " ").trim(), body: m[2] }));
  check(cellRules.length > 0, `409e0 · the cell's rules are found (negative control for the read, ${cellRules.length})`);
  const moving = cellRules.filter(r => /animation\s*:/.test(r.body));
  check(moving.length === 0, `409e · and none of them animates anything (${moving.map(r => r.sel).join(" | ") || "none"})`);
  check(!/@keyframes xvCellWait/.test(css), "409f · with the frames it used gone rather than left unreferenced");
  check([{ sel: ".x", body: "animation: a 1s linear;" }].filter(r => /animation\s*:/.test(r.body)).length === 1,
    "409g · the animation check can see one (negative control)");

  const lookups = [...boardJsx.matchAll(/prices\[([^\]]*)\]/g)].map(m => m[1]);
  check(lookups.length === 1 && lookups[0] === "`${day}|${species}`",
    `319c · with one lookup, so each card shows the price its own cell was quoted (${lookups.join(" | ") || "none"})`);

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
  /*
   * Over the chip's own source, which this check could not read before.
   *
   * Its slice ran from AccountChip to "function Mark(", and the first function
   * whose name began that way was MarkReceipt, four hundred lines above the
   * chip: the slice was empty every time and the sentence was found on the page
   * at large by the disjunct beside it. The marks are gone, so the anchor now
   * lands on the brand mark below the chip, and the check reads the region it
   * names. A control proves the slice is not empty again.
   */
  const chipRegion = page.slice(page.indexOf("function AccountChip("), page.indexOf("function Mark()"));
  check(chipRegion.length > 0 && chipRegion.length < page.length, `288a0 · the chip's own source is found (negative control for the slice, ${chipRegion.length} characters)`);
  check(/Wrong chain, switch/.test(chipRegion) && /onClick=\{onSwitch\}/.test(chipRegion),
    "288a · and the header's chip warns and offers the switch");
  check(!/const walletDone/.test(page), "288b · with no card left restating what the chip says");

  /*
   * The refusal is the browser's and nobody else's.
   */
  check(/globalThis\.localStorage\?\.setItem\(skipKey/.test(page) && /globalThis\.localStorage\?\.getItem\(skipKey/.test(page),
    "288c · a wallet's refusal is remembered in the browser alone");
  const skipRegion = page.slice(page.indexOf("const SKIPPED ="), page.indexOf("export function identityChips"));
  check(skipRegion.length > 0 && !/fetch\(|body:|headers:/.test(skipRegion), "288c2 · and no request carries it");
  const skipReaders = skipRegion.match(/globalThis\.localStorage\?\./g) ?? [];
  check(skipReaders.length === 3, `288c3 · read, written and cleared, and nothing else touches the key (${skipReaders.length})`);
  check((skipRegion.match(/try \{/g) ?? []).length === skipReaders.length,
    `288c4 · each of the three guarded, since a browser may refuse storage (${(skipRegion.match(/try \{/g) ?? []).length})`);

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

  /*
   * A DECLINE IS A DECISION, NOT A DOOR CLOSING.
   *
   * Driven as the sequence the ruling names rather than as three separate facts:
   * one wallet declines, enrols from the account, and reaches the free read it
   * had been refused. Each leg runs through the mechanism that decides it, the
   * browser's own storage for the refusal and the cap for the allowance, and the
   * same wallet carries through all three, so a leg that passed by accident on a
   * fresh address cannot.
   *
   * `localStorage` is stood up here because node has none, which is also why
   * every read of it in the page is guarded: without this the two halves would
   * silently do nothing and the sequence would prove nothing.
   */
  const RETURNING = "0x3333333333333333333333333333333333333334";
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const cells = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => void cells.set(k, v),
      removeItem: (k: string) => void cells.delete(k),
    },
  });

  writeSkipped(RETURNING);
  check(readSkipped(RETURNING), "400 · a wallet's decline is remembered for that wallet");
  check(!readSkipped(DECLINED), "400a · and for no other (negative control)");
  check(enrolmentState({ address: RETURNING, registration: "not-registered", skipped: true }) === "skipped",
    "400b · so the page draws it as a wallet that went on without");

  const returningTable = fakeVerifications();
  const returningAt = new Date("2026-09-13T01:00:00Z");
  const returningEnv = { HUMAN_ID_KEY: "k".repeat(40) } as never;
  setClockForTest(() => returningAt);
  setRegistryForTest(async () => 0n);
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: returningTable, freePerDay: 2 });
  check((await takeFreeRead(RETURNING, returningEnv, returningAt)) === false, "400c · and the allowance is closed to it, which is what declining costs");

  // It enrols, from the account. This is the row the page's own route writes.
  returningTable.rows.set(RETURNING.toLowerCase(), {
    payer: RETURNING.toLowerCase(),
    action: "enrol-agent",
    nullifierDigest: "b".repeat(64),
    credential: "proof_of_human",
    verifiedAt: returningAt,
    expiresAt: new Date(returningAt.getTime() + 86_400_000),
  });
  const nowStanding = await standingBehind(RETURNING, capFrom(), returningEnv, returningAt);
  check(nowStanding !== null, `401 · once it enrols, somebody stands behind it (${JSON.stringify(nowStanding)})`);
  clearSkipped(RETURNING);
  check(!readSkipped(RETURNING), "401a · the decline is forgotten, so it is remembered only until the wallet enrols");
  check(enrolmentState({ address: RETURNING, registration: "registered", skipped: true }) === "enrolled",
    "401b · and a registration outranks a stored refusal even before the browser catches up");
  check((await takeFreeRead(RETURNING, returningEnv, returningAt)) === true, "401c · so it reaches the free read it was refused");
  /*
   * And the page runs that clear, rather than the check having been the only
   * caller. Read over the two effects that own the stored refusal, since
   * `clearSkipped` appears in its own declaration as well.
   */
  const skipEffectsAt = page.indexOf("useEffect(() => setSkipped(readSkipped(address))");
  const skipEffects = skipEffectsAt === -1 ? "" : page.slice(skipEffectsAt, skipEffectsAt + 700);
  check(skipEffects.length > 0, "401d · the effects that own the refusal are found (negative control for the read)");
  check(/registration !== "registered"/.test(skipEffects) && /clearSkipped\(address\)/.test(skipEffects) && /setSkipped\(false\)/.test(skipEffects),
    "401e · and the page clears it on the registration answering registered, not only this check");
  setCapForTest(null);
  setClockForTest(undefined);
  setRegistryForTest(undefined);
  if (priorStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else Object.defineProperty(globalThis, "localStorage", priorStorage);

  /*
   * The way back is drawn where having declined costs something, and twice.
   *
   * The account, where the allowance is counted, and the name dialog, where a
   * request has nothing to stand on. Not on the board: there it would be the
   * step the person declined, asked again on the surface they declined it to
   * reach, and each site is behind the declined state so a wallet still being
   * asked on the enrolment step is not asked a second time beside it.
   */
  const wayBackSites = (page.match(/<WayBack /g) ?? []).length;
  const guardedSites = (page.match(/enrolment === "skipped" && <WayBack /g) ?? []).length;
  check(wayBackSites === 2, `402 · the way back is drawn in two places (${wayBackSites})`);
  check(guardedSites === wayBackSites, `402a · each behind the declined state and not one behind anything looser (${guardedSites})`);
  // The account's own body, not the first IdentityChips on the page: the header
  // draws the same chips above every screen, and anchoring on them found that one.
  const accountAt = page.indexOf('className="ag-account-body"');
  check(accountAt > 0 && /<WayBack /.test(page.slice(accountAt, accountAt + 500)), "402b · one of them in the account, under the chips it explains");
  const nameDialogAt = page.indexOf('className="ag-run-dialog ag-name-dialog"');
  check(nameDialogAt > 0 && /<WayBack /.test(page.slice(nameDialogAt, nameDialogAt + 800)), "402c · and one in the name dialog, where the request is refused for want of it");
  const wayBackBody = page.slice(page.indexOf("function WayBack("), page.indexOf("function Board("));
  check(wayBackBody.length > 0 && /<WorldIdCard payer=\{address\} onRegistered=\{onRegistered\} \/>/.test(wayBackBody),
    "402d · and it draws the enrolment's own card rather than a second implementation of the widget");
  const widgets = (page.match(/<WorldIdCard /g) ?? []).length;
  check(widgets === 2, `402e · which the file holds twice, on the enrolment step and in this one component (${widgets})`);

  /*
   * THE RUN DIALOG HOLDS ONE THING, AND IT IS THE WHEEL.
   *
   * A disclosure headed "The whole sequence" stood under the wheel with the same
   * run written out as a list, so the dialog carried the run twice and the wheel
   * shared the frame with a control most people never open. The wheel and its rail
   * take the height now, which is what a dialog with one subject should do.
   */
  const dialogAt = page.indexOf('<dialog ref={runDialog}');
  const dialogBody = dialogAt === -1 ? "" : page.slice(dialogAt, page.indexOf("</dialog>", dialogAt));
  check(dialogBody.length > 0 && dialogBody.length < page.length / 4,
    `411 · the run dialog is found and is the dialog (negative control for the read, ${dialogBody.length})`);
  check(!/<details/.test(dialogBody), "411a · and carries no disclosure of any kind");
  check(!/whole sequence/i.test(page), "411b · with the log's own heading gone from the page");
  check(!/ag-feed/.test(page) && !/ag-feed/.test(css),
    "411c · and the feed it drew rendered by nothing and styled by nothing");
  check(/<Rolodex /.test(dialogBody), "411d · what is left is the wheel");
  const openRule = /\.ag-run-dialog\[open\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(/display:\s*flex/.test(openRule) && /flex-direction:\s*column/.test(openRule),
    `411e · which takes the frame's height, from a rule bound to the open state (${openRule.replace(/\s+/g, " ").trim().slice(0, 60)})`);
  // On `[open]` and not on the element: an author `display` beats the user agent's
  // `dialog:not([open]) { display: none }` whatever the specificity, so a bare rule
  // would stand the closed dialog on the page.
  const bareDialog = /(?<![\w\]-])\.ag-run-dialog\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(bareDialog.length > 0 && !/display\s*:/.test(bareDialog),
    `411f · and never from the element's own rule, which would stand the closed dialog on the page (${/display:[^;]*/.exec(bareDialog)?.[0] ?? "none"})`);

  /*
   * The surfaces a person works in carry more room than the ones they read.
   * Measured as a step up this file's own spacing scale rather than as a value.
   */
  const paddingOf = (rule: string) => Number(/padding:\s*([0-9.]+)rem/.exec(rule)?.[1] ?? NaN);
  const boardRule = /\.ag-board\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  const cardRule = /\.ag-roll-card\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  const cellPad = /padding:\s*([0-9.]+)rem\s+([0-9.]+)rem/.exec(cellRule);
  check(paddingOf(boardRule) === 0.375, `412 · the board carries a step more room than it did (${paddingOf(boardRule)}rem)`);
  check(cellPad !== null && Number(cellPad[1]) === 0.75 && Number(cellPad[2]) === 0.625,
    `412a · and so does every cell in it (${cellPad?.[0] ?? "none"})`);
  check(paddingOf(cardRule) === 1.25, `412b · as does the card the run draws itself on (${paddingOf(cardRule)}rem)`);

  /*
   * THE README'S CELL ROW COUNTS ITS OWN LIST, AND NAMES WHAT THE CODE READS.
   *
   * It said four events from three sources and then named four, because the run's
   * outcome was listed beside the runs table when it is a column of that table's
   * own row. A reviewer found that by reading; putting the number back left every
   * check green, which is how this one came to exist.
   *
   * Two bindings rather than a pattern over a sentence: the prose must count as
   * many sources as it names, and the names must be the stores the board actually
   * reads, so neither the sentence nor the list can drift alone.
   */
  const readme = readFileSync("README.md", "utf8");
  const cellRow = readme.split("\n").find(l => l.startsWith("| A cell says what it is")) ?? "";
  check(cellRow.length > 0, `413 · the README's cell row is found (negative control for the read, ${cellRow.length})`);
  const SOURCES = ["the runs table", "Zenbit's public list", "the anchor store"];
  const namedSources = SOURCES.filter(x => cellRow.includes(x));
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
  const claimedCount = WORDS[/from (\w+) sources/.exec(cellRow)?.[1] ?? ""] ?? NaN;
  check(namedSources.length === SOURCES.length,
    `413a · naming each source the board reads (${namedSources.length} of ${SOURCES.length})`);
  /*
   * Counted over the items the row actually lists, not over the names this check
   * knows.
   *
   * The first version matched the three known names, so putting "the run's own
   * outcome" back beside the runs table left it green: the defect is a fourth item
   * in a list of three, and a check that only looks for three cannot see a fourth.
   * The clause is split where a list is split, on its commas and its and.
   */
  const listed = /from \w+ sources,\s*([^.]*?),\s*none of them/.exec(cellRow)?.[1] ?? "";
  const items = listed.split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(x => x.length > 0);
  check(items.length > 0, `413b0 · the row's own list is found (negative control for the read, ${items.join(" | ") || "none"})`);
  check(claimedCount === items.length,
    `413b · and the row counts as many sources as it lists (${claimedCount} claimed, ${items.length} listed: ${items.join(" | ")})`);
  const countOf = (row: string) => {
    const clause = /from \w+ sources,\s*([^.]*?),\s*none of them/.exec(row)?.[1] ?? "";
    return { claimed: WORDS[/from (\w+) sources/.exec(row)?.[1] ?? ""] ?? NaN, listed: clause.split(/,\s*|\s+and\s+/).filter(x => x.trim().length > 0).length };
  };
  const plantedRow = "four events from three sources, the runs table, the run's own outcome, Zenbit's public list and the anchor store, none of them derived.";
  check(countOf(plantedRow).claimed !== countOf(plantedRow).listed,
    `413c · the count check can see a row that lists more than it claims (negative control, ${JSON.stringify(countOf(plantedRow))})`);
  const goodRow = "four events from three sources, the runs table with the outcome it recorded, Zenbit's public list and the anchor store, none of them derived.";
  check(countOf(goodRow).claimed === countOf(goodRow).listed,
    `413c2 · and one that agrees (negative control, ${JSON.stringify(countOf(goodRow))})`);
  /*
   * And the three are the three the board asks. The outcome is not among them
   * because it arrives on the mark the runs table returns, which is why listing it
   * beside that table was a fourth source that does not exist.
   */
  const boardRoute = readFileSync("app/api/agent/board/route.ts", "utf8");
  check(/runsStoreFrom\(\)/.test(boardRoute) && /anchorStoreFrom\(\)/.test(boardRoute),
    "413d · the route reads the runs table and the anchor store, and no third of its own");
  check(/fetch\(`\/api\/proposals\?submitter=/.test(page), "413e · while the page reads the public list for the third");
  check(/outcome: mark\.outcome/.test(boardRoute),
    "413f · and the outcome comes off the mark the runs table returned, which is why it is not a source beside it");

  /*
   * THE WAY OUT, AND THERE IS ONLY ONE OF IT.
   *
   * A modal dialog closes on Escape by itself, so a disabled button alone would
   * have left one way out open while the page called the dialog held. The cancel
   * event is prevented for exactly the window the button is disabled for, and both
   * read the same value, so the two cannot disagree.
   */
  const footAt = page.indexOf('<div className="ag-run-dialog-foot">');
  const foot = footAt === -1 ? "" : page.slice(footAt, page.indexOf("</div>", footAt) + 6);
  check(foot.length > 0, `414 · the dialog's foot is found (negative control for the read, ${foot.length})`);
  check(/disabled=\{runInProgress\}/.test(foot), "414a · the way out is inactive while the run is");
  check(/aria-label=\{runInProgress \? CLOSE_WHEN : undefined\}/.test(foot),
    "414b · and says when it will be available rather than only refusing to be pressed");
  /*
   * Visibly, and not only in its name. A disabled button takes no focus, so the
   * accessible name reached a screen reader already on the button and nobody else;
   * a keyboard could not Tab to it to hear it at all.
   */
  check(/\{runInProgress && <p className="ag-sub ag-run-close-when">\{CLOSE_WHEN\}<\/p>\}/.test(foot),
    "414b2 · and a line beside it says the same thing to everybody else");
  const closeWhenCopies = (page.match(/Close, available when the run ends/g) ?? []).length;
  check(closeWhenCopies === 1, `414b3 · from one constant, not two sentences that can drift (${closeWhenCopies})`);
  check(/className=\{runInProgress \? "btn xv-action ag-run-close" : "btn xv-action ag-run-close ag-run-close-ready"\}/.test(foot),
    "414c · taking its active class from the same value, so the look and the state cannot disagree");
  check(/addEventListener\("cancel", hold\)/.test(page) && /if \(runInProgress\) event\.preventDefault\(\);/.test(page),
    "414d · and Escape is held for that same window, since a modal closes on it without asking");
  check(/removeEventListener\("cancel", hold\)/.test(page), "414d2 · released when the run ends rather than for the page's life");
  const footRule = /\.ag-run-dialog-foot\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/align-items:\s*center/.test(footRule), `414e · drawn at the centre of the foot (${footRule.replace(/\s+/g, " ").trim()})`);
  const readyRule = /\.ag-run-close-ready\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/xvCloseReady\s+220ms/.test(readyRule), `414f · arriving into its active state in one pass under 300ms (${readyRule.replace(/\s+/g, " ").trim().slice(0, 70)})`);
  check(/xvClosePulse/.test(readyRule), "414g · and breathing after it, so the eye finds it");
  const closeFrames = [...sheetRoll.matchAll(/@keyframes (xvCloseReady|xvClosePulse)\s*\{([\s\S]*?)\n\}/g)].map(m => m[2]);
  check(closeFrames.length === 2, `414h · both its frames are found (negative control for the read, ${closeFrames.length})`);
  const closeMoves = [...new Set(closeFrames.join(" ").match(/^\s*([a-z-]+):/gm)?.map(x => x.trim().replace(":", "")) ?? [])];
  check(closeMoves.length > 0 && closeMoves.every(prop => prop === "opacity" || prop === "transform"),
    `414i · which move transform and opacity and nothing that paints (${closeMoves.join(", ") || "none"})`);
  const reducedClose = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ag-run-close-ready\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/animation:\s*none/.test(reducedClose) && /opacity:\s*1/.test(reducedClose),
    `414j · and under reduced motion it is in its active state and does not breathe (${reducedClose.replace(/\s+/g, " ").trim()})`);

  /*
   * The line runs the height the card beside it runs, with the cap gone. It was
   * capped and scrolled, so on a tall dialog it stopped short of the card and a
   * long run hid its own first states behind a scroll nobody saw.
   */
  // At the start of its own line, so the phone rule inside a media query, which is
  // indented, is not read as the base one: it declares `height: auto` and took
  // these two red the moment the column was added.
  const stepsRule = /\n\.ag-steps\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(stepsRule.length > 0, `414k · the line's own rule is found (negative control for the read, ${stepsRule.length})`);
  check(/height:\s*100%/.test(stepsRule) && !/max-height/.test(stepsRule),
    `414l · it takes the height it is given and is capped at nothing (${stepsRule.replace(/\s+/g, " ").trim().slice(0, 80)})`);
  check(!/overflow-y:\s*auto/.test(stepsRule), "414m · so no run hides its own first states behind a scroll");
  check(/grid-auto-rows:\s*1fr/.test(stepsRule), "414n · and its nodes spread over that height rather than sitting at the top");
  // The base rule, anchored at the start of its own line: the failed node's label
  // rule is written above it and a bare match read that one's `opacity: 1`.
  const labelRule = /\n\.ag-steps-label\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/opacity:\s*0\.[1-9]/.test(labelRule), `414o · every node carries its title rather than one at a time (${/opacity:[^;]*/.exec(labelRule)?.[0] ?? "none"})`);

  /*
   * THE FREE READ IS PROVED LOCALLY AND ASKS THE FACILITATOR NOTHING.
   *
   * The defect: the route verified every payment with the facilitator before it
   * consulted the allowance, and the facilitator refuses an authorization the
   * wallet cannot fund. A registered person with an empty wallet was answered 402
   * on every read, never reached the free reads their allowance grants, and left
   * no row behind, so the board's marks looked hardcoded because nothing had ever
   * persisted.
   *
   * Driven through the real route with a real signature, and the facilitator is a
   * counter: what is being held is that a free read does not touch it.
   */
  const freeAt = new Date("2026-09-13T12:00:00Z");
  const FREE_KEY = `0x${"a7".repeat(32)}` as const;
  const freeAccount = privateKeyToAccount(FREE_KEY);
  const PAY_TO = "0x1111111111111111111111111111111111111111";
  let facilitatorCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    facilitatorCalls += 1;
    return new Response(JSON.stringify({ isValid: false, invalidReason: "insufficient_funds" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const signAuthorization = async (over: { to: string; value: string; validAfter: string; validBefore: string; nonce: string }, account = freeAccount) =>
    account.signTypedData({
      domain: {
        name: PAYMENT_TOKEN.name,
        version: PAYMENT_TOKEN.version,
        chainId: PAYMENT_TOKEN.chainId,
        verifyingContract: getAddress(PAYMENT_TOKEN.address),
      },
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(freeAccount.address),
        to: getAddress(over.to),
        value: BigInt(over.value),
        validAfter: BigInt(over.validAfter),
        validBefore: BigInt(over.validBefore),
        nonce: over.nonce as `0x${string}`,
      },
    });

  const headerFor = async (over: Partial<{ to: string; value: string; validAfter: string; validBefore: string; nonce: string }> = {}, signer = freeAccount) => {
    // The fixture clock, the same one the route reads, so a validity window is
    // driven rather than raced against the wall clock.
    const at = Math.floor(freeAt.getTime() / 1000);
    const a = {
      to: over.to ?? PAY_TO,
      value: over.value ?? ruledValue("$0.01"),
      validAfter: over.validAfter ?? String(at - 60),
      validBefore: over.validBefore ?? String(at + 600),
      nonce: over.nonce ?? `0x${"b".repeat(64)}`,
    };
    const signature = await signAuthorization(a, signer);
    const body = { x402Version: 2, scheme: "exact", network: "eip155:84532", payload: { signature, authorization: { from: freeAccount.address, ...a } } };
    return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
  };

  const freeStore = fakeStore();
  const freeTable = fakeVerifications();
  freeTable.rows.set(freeAccount.address.toLowerCase(), {
    payer: freeAccount.address.toLowerCase(),
    action: "enrol-agent",
    nullifierDigest: "f".repeat(64),
    credential: "proof_of_human",
    verifiedAt: freeAt,
    expiresAt: new Date(freeAt.getTime() + 86_400_000),
  });
  const spent = new Map<string, string>();
  setNonceStoreForTest({
    take: async (nonce, signer) => (spent.has(nonce) ? false : (spent.set(nonce, signer), true)),
    forgetOlderThan: async () => undefined,
  });
  setClockForTest(() => freeAt);
  setRegistryForTest(async () => 0n);
  setCapForTest({ registry: async () => 0n, store: freeStore, verifications: freeTable, freePerDay: 1 });
  const priceBefore = process.env.X402_PRICE;
  const payToBefore2 = process.env.X402_PAY_TO;
  process.env.X402_PRICE = "$0.01";
  process.env.X402_PAY_TO = PAY_TO;
  process.env.HUMAN_ID_KEY = "k".repeat(40);
  resetServerForTest();

  const askFree = async (header: string) =>
    windowsGET(new Request("http://127.0.0.1/api/agent/windows", { headers: { "PAYMENT-SIGNATURE": header } }));

  const callsBefore = facilitatorCalls;
  const firstFree = await askFree(await headerFor());
  check(firstFree.status === 200, `416 · an unfunded wallet its allowance covers is served (${firstFree.status})`);
  check(facilitatorCalls === callsBefore, `416a · with no facilitator call at all (${facilitatorCalls - callsBefore})`);
  check(spent.size === 1 && [...spent.values()][0] === freeAccount.address,
    `416b · and the nonce recorded against the recovered signer (${[...spent.values()].join(", ") || "none"})`);

  /*
   * The same header again, with the allowance refilled first.
   *
   * Without the refill this passed on the allowance rather than on the nonce: one
   * free read a day, spent by the request above, so the replay was refused by the
   * counter and the replay guard was never reached. Replacing the take with `true`
   * left it green, which is how that was found. Refilled, a second serving of the
   * same header can only be refused by the nonce.
   */
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: freeTable, freePerDay: 2 });
  const replayed = await askFree(await headerFor());
  check(replayed.status !== 200, `416c · the same header served free twice is refused the second time (${replayed.status})`);
  // And the control: with that same refilled allowance, a fresh nonce is served,
  // so the refusal above is the nonce and not the allowance after all.
  const freshNonce = await askFree(await headerFor({ nonce: `0x${"8e".repeat(32)}` }));
  check(freshNonce.status === 200, `416c2 · while a fresh nonce on the same allowance is served (negative control, ${freshNonce.status})`);
  setCapForTest({ registry: async () => 0n, store: freeStore, verifications: freeTable, freePerDay: 1 });

  // The allowance is spent now, so the same wallet with a fresh nonce goes to the
  // facilitator like any other read, and the facilitator is what refuses it.
  const callsBeforeSettle = facilitatorCalls;
  const afterAllowance = await askFree(await headerFor({ nonce: `0x${"c".repeat(64)}` }));
  check(afterAllowance.status !== 200, `416d · a wallet whose allowance is spent is answered through the facilitator (${afterAllowance.status})`);
  check(facilitatorCalls > callsBeforeSettle, `416e · which is asked, unlike on the free path (${facilitatorCalls - callsBeforeSettle} calls)`);

  /*
   * An authorization signed by another key is refused before the allowance and
   * before any call. Recovery over the wrong key does not raise: it answers with a
   * different valid address, so this is a comparison and never a catch.
   */
  const otherKey = privateKeyToAccount(`0x${"c3".repeat(32)}`);
  const strangerHeader = await headerFor({ nonce: `0x${"d".repeat(64)}` }, otherKey);
  const forged = await askFree(strangerHeader);
  check(forged.status !== 200, `416f · an authorization another key signed is refused (${forged.status})`);
  check(!spent.has(`0x${"d".repeat(64)}`), "416g · its nonce is never taken, so the allowance is never reached");

  /*
   * EVERY REQUIREMENT DRIVEN WITH A HEADER THAT BREAKS IT, ONE AT A TIME.
   *
   * A fixture that only ever sends a correct authorization cannot tell a route
   * that checks the price from one that does not: removing each of these checks
   * left the suite green, which is how these cases came to exist. The allowance is
   * refilled before each so that a refusal is the check refusing and not the
   * allowance being spent, and each is given its own nonce so a refusal is never
   * the replay guard answering instead.
   */
  const refuses = async (what: string, over: Partial<{ to: string; value: string; validAfter: string; validBefore: string; nonce: string }>) => {
    setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: freeTable, freePerDay: 1 });
    const before = facilitatorCalls;
    const answer = await askFree(await headerFor(over));
    return { status: answer.status, asked: facilitatorCalls - before, what };
  };
  const wrongPayee = await refuses("payee", { to: "0x2222222222222222222222222222222222222222", nonce: `0x${"1e".repeat(32)}` });
  check(wrongPayee.status !== 200, `416h · an authorization payable to somebody else is not served free (${wrongPayee.status})`);
  const wrongPrice = await refuses("price", { value: "1", nonce: `0x${"2e".repeat(32)}` });
  check(wrongPrice.status !== 200, `416i · nor one signed for a cent against the ruled price (${wrongPrice.status})`);
  const expiredAt = Math.floor(freeAt.getTime() / 1000);
  const expired = await refuses("expired", { validBefore: String(expiredAt - 1), validAfter: String(expiredAt - 600), nonce: `0x${"3e".repeat(32)}` });
  check(expired.status !== 200, `416j · nor one whose validity window has closed (${expired.status})`);
  const early = await refuses("early", { validAfter: String(expiredAt + 600), validBefore: String(expiredAt + 1200), nonce: `0x${"4e".repeat(32)}` });
  check(early.status !== 200, `416k · nor one that is not valid yet (${early.status})`);
  // And the control: with the allowance refilled and nothing else changed, the
  // same shape of request is served, so the four refusals above are the four
  // checks and not the fixture having run out of something.
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: freeTable, freePerDay: 1 });
  const good = await askFree(await headerFor({ nonce: `0x${"5e".repeat(32)}` }));
  check(good.status === 200, `416l · while the same request with none of those faults is served (negative control, ${good.status})`);

  /*
   * THE PINNED DOMAIN IS THE TOKEN'S OWN, AND THE WRONG ONE IS NOT.
   *
   * A wrong domain does not raise: it recovers a different, perfectly well formed
   * address, so the pin is what makes the recovery mean anything. The separator
   * below was read from the token on Base Sepolia on 2026-09-13 with
   * `DOMAIN_SEPARATOR()`, and version "1" computes a different one, which is why
   * the version is pinned rather than assumed.
   */
  const SEPARATOR_ON_CHAIN_2026_09_13 = "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818";
  const EIP712_DOMAIN = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ] as const;
  const separatorFor = (version: string) =>
    hashDomain({
      domain: { name: PAYMENT_TOKEN.name, version, chainId: BigInt(PAYMENT_TOKEN.chainId), verifyingContract: getAddress(PAYMENT_TOKEN.address) },
      types: { EIP712Domain: [...EIP712_DOMAIN] },
    });
  check(separatorFor(PAYMENT_TOKEN.version) === SEPARATOR_ON_CHAIN_2026_09_13,
    `416m · the pinned domain computes the separator the token answers with (${separatorFor(PAYMENT_TOKEN.version)})`);
  check(separatorFor("1") !== SEPARATOR_ON_CHAIN_2026_09_13,
    "416n · while another version computes a different one, which is why it is pinned (negative control)");
  check(PAYMENT_TOKEN.chainId === 84532 && /^0x[0-9a-fA-F]{40}$/.test(PAYMENT_TOKEN.address),
    `416o · on the chain the payments settle on (${PAYMENT_TOKEN.chainId})`);
  /*
   * And a deployment configured for another chain gets no free reads at all.
   *
   * The domain is one token's on one chain. Recovered against it, a payment signed
   * for another chain answers with a valid address that signed nothing here, so
   * the signature would prove nothing and the read would be given to whoever
   * asked. The first version of this guard compared the pinned address with
   * itself, which no fixture could ever break.
   */
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: freeTable, freePerDay: 1 });
  process.env.X402_NETWORK = "eip155:11155111";
  resetServerForTest();
  const otherChain = await askFree(await headerFor({ nonce: `0x${"6e".repeat(32)}` }));
  check(otherChain.status !== 200, `416p · a deployment settling on another chain serves no free read (${otherChain.status})`);
  delete process.env.X402_NETWORK;
  resetServerForTest();
  setCapForTest({ registry: async () => 0n, store: fakeStore(), verifications: freeTable, freePerDay: 1 });
  const backOnBase = await askFree(await headerFor({ nonce: `0x${"7e".repeat(32)}` }));
  check(backOnBase.status === 200, `416q · while the chain it is pinned for does (negative control, ${backOnBase.status})`);

  process.env.X402_PRICE = priceBefore === undefined ? "" : priceBefore;
  if (priceBefore === undefined) delete process.env.X402_PRICE;
  if (payToBefore2 === undefined) delete process.env.X402_PAY_TO;
  else process.env.X402_PAY_TO = payToBefore2;
  globalThis.fetch = realFetch;
  setNonceStoreForTest(undefined);
  setCapForTest(null);
  setClockForTest(undefined);
  setRegistryForTest(undefined);
  resetServerForTest();

  /*
   * THE LINE CARRIES NAMES, AND THE CARD CARRIES THE SENTENCE.
   *
   * The rail drew each state's full text, absolutely positioned and so out of the
   * layout entirely: nothing measured it, nothing stopped it, and on a long
   * sentence it ran under the card beside it. The founder read it on the
   * deployment. Names now, from one fixed list, with the sentence left on the card
   * where somebody is reading it.
   */
  const everyStepKind: RunStep[] = [
    { step: "presenting" },
    { step: "payment-refused", status: 402, detail: "insufficient_funds" },
    { step: "unavailable", status: 503, detail: "x" },
    { step: "paid", free: true },
    { step: "read", served: 2, ids: ["a", "b"] },
    { step: "selected", windowId: "a", durationSeconds: 16 },
    { step: "nothing-proposable", considered: 2 },
    { step: "cell-spent", considered: 2 },
    { step: "proposing", windowId: "a" },
    { step: "proposed", id: 1, clipHash: "0x", status: "proposed" },
    { step: "declined", kind: "duplicate", detail: "x" },
    { step: "not-submitted", detail: "x" },
    { step: "done" },
  ];
  const namesGiven = everyStepKind.map(st => lineFor(st).node);
  const offList = namesGiven.filter(n => !(NODE_NAMES as readonly string[]).includes(n));
  check(namesGiven.length === everyStepKind.length, `417 · every kind of step the run reports is named (${namesGiven.length})`);
  check(offList.length === 0, `417a · each from the fixed list and nothing invented (${offList.join(", ") || "none"})`);
  const tooLong = NODE_NAMES.filter(n => n.length > NODE_NAME_MAX);
  check(tooLong.length === 0, `417b · and every name is within the bound the column is sized for (${tooLong.join(", ") || "none"}, max ${NODE_NAME_MAX})`);
  check(NODE_NAME_MAX <= 24, `417b2 · which is short rather than nominal (${NODE_NAME_MAX})`);
  const sentences = everyStepKind.map(st => lineFor(st)).filter(l => l.node === l.text);
  check(sentences.length === 0, `417c · and no node is drawn as its own sentence (${sentences.length})`);
  check(lineFor({ step: "payment-refused", status: 402, detail: "insufficient_funds" }).node === "failed",
    "417d · a run that stopped is named failed by the step that stopped it");
  check(lineFor({ step: "proposed", id: 1, clipHash: "0x", status: "proposed" }).node === "propose" && lineFor({ step: "done" }).node === "stop",
    "417e · while a run that proposed and finished carries those two (negative control)");
  check(/<span className="ag-steps-label">\{line\.node\}<\/span>/.test(roll),
    "417f · the rail draws the name rather than the text");
  check(!/ag-plan\b/.test(page), "417g · with the plan list retired, so the dialog does not draw the stepper twice");

  /*
   * AND THE LINE HAS A COLUMN OF ITS OWN, SO AN OVERLAP IS NOT POSSIBLE.
   *
   * A narrower label would have been a smaller version of the same bug. The column
   * has a width, the labels are in flow inside it, and the card area begins where
   * the column ends, whatever any name says.
   */
  const rollRule = /\n\.ag-roll\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(rollRule.length > 0, `418 · the wheel's own rule is found (negative control for the read, ${rollRule.length})`);
  const column = /--ag-steps-col:\s*([0-9.]+)rem/.exec(rollRule)?.[1] ?? "";
  check(column !== "", `418a · the line's column has a width of its own (${column || "none"}rem)`);
  check(/grid-template-columns:\s*var\(--ag-steps-col\)\s+minmax\(0, 1fr\)/.test(rollRule),
    `418b · and the card area begins after it (${/grid-template-columns:[^;]*/.exec(rollRule)?.[0] ?? "none"})`);
  check(!/grid-template-columns:\s*auto/.test(rollRule),
    "418c · never sized from its own longest label, which is what let the labels out");
  const labelRuleNow = /\n\.ag-steps-label\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/position:\s*static/.test(labelRuleNow), `418d · the names are in the layout rather than out of it (${/position:[^;]*/.exec(labelRuleNow)?.[0] ?? "none"})`);
  const stacked = /@media \(max-width: 30rem\)\s*\{\s*\.ag-roll\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/grid-template-columns:\s*minmax\(0, 1fr\)/.test(stacked),
    `418e · and on a phone the column stacks above the card rather than sharing the width (${stacked.replace(/\s+/g, " ").trim()})`);
  const dialogWidth = /\n\.ag-run-dialog\s*\{([^}]*)\}/.exec(sheetRoll)?.[1] ?? "";
  check(/width:\s*min\(64rem,\s*90vw\)/.test(dialogWidth), `418f · with a dialog wide enough for both (${/width:[^;]*/.exec(dialogWidth)?.[0] ?? "none"})`);
  check(/min-height:/.test(dialogWidth) && /max-height:/.test(dialogWidth), "418g · and its height rule unchanged");

  check(/\{onboarded && \(/.test(page), "289 · the strip is absent until the onboarding is done");
  check(/const enrolment = enrolmentState\(\{ address, registration, skipped \}\);/.test(page) &&
    /const onboarded = opensTheBoard\(enrolment\);/.test(page),
    "289a · and is derived from the reads rather than from a remembered yes");
  check(!/\{ id: "settings"/.test(page), "289b · settings is no longer a destination, since it is the way in");

  /*
   * The home's cards carry what the fold carried, and no claim this deployment
   * does not meet.
   *
   * The fold stood in the body's last arm, and nothing sets that state, so its
   * three tiles and the one condition under them were drawn for nobody while the
   * first surface a visitor does read said the agent proposes one clip flatly.
   *
   * The condition is the wallet's, not the deployment's. It first read "where a
   * credential is configured", which was true of a deployment that held no ingest
   * target and stopped being the live condition at `d614a37`, where DISCLOSURE
   * began stating that the deployment holds one and mints a credential for a
   * wallet when it enrols. What a particular run still turns on is whether
   * somebody stands behind the wallet paying for it.
   *
   * Read off the array rather than off the file, because the reason the
   * condition exists is written above the card in a comment using the same
   * words, and a source read would pass on the comment alone.
   */
  const proposingCards = PROCESS.filter(c => /\bproposes\b/.test(c.line));
  check(proposingCards.length > 0, `327 · a home card says the agent proposes (${proposingCards.length})`);
  const unconditioned = proposingCards.filter(c => !/for a wallet somebody stands behind/i.test(c.line));
  check(unconditioned.length === 0, `327a · and none says it without the condition (${unconditioned.map(c => c.title).join(", ") || "none"})`);
  check(["The agent reads the windows it was paid for and proposes one clip."].filter(l => !/for a wallet somebody stands behind/i.test(l)).length === 1,
    "327b · the condition check can see a sentence without it (negative control)");
  // And not the condition it replaced, which names a deployment variable that is
  // set here: a card saying "where a credential is configured" describes a stop
  // this deployment does not have and would read as one it does.
  const stale = proposingCards.filter(c => /credential is configured/i.test(c.line));
  check(stale.length === 0, `327b2 · nor the deployment condition that stopped being the live one (${stale.map(c => c.title).join(", ") || "none"})`);
  /*
   * A name is issued by Zenbit on a request, not conferred by registering, so
   * the card that offers one says which of the two it is. Sentence by sentence,
   * because the one that offers it also carries the allowance, which is earned.
   */
  const nameSentences = PROCESS.flatMap(c => c.line.split(/(?<=\.)\s+/)).filter(l => /\bname\b/.test(l));
  check(nameSentences.length > 0, `327c · a home card says a name is on offer (${nameSentences.length})`);
  const conferred = nameSentences.filter(l => !/\bask for a name\b/.test(l));
  check(conferred.length === 0, `327d · and each says it is asked for rather than handed over (${conferred.join(" ") || "none"})`);
  check(["It earns the free reads of the day and a name under xovi.eth."].filter(l => !/\bask for a name\b/.test(l)).length === 1,
    "327e · the check can see the sentence that conferred one (negative control)");

  /*
   * The body draws a surface for every destination and for nothing else.
   *
   * 266b holds one direction of that. The other was open, and an arm for a state
   * the page cannot be in is exactly where the fold lived: `openRun` shows a
   * dialog and nothing sets a run screen, so the chain's last arm was drawn for
   * nobody. `Screen` is now the four the body draws, the strip's own type adds
   * the run to them, and the arm no screen takes is `exhausted(screen)`, which
   * the type checker refuses the day a fifth screen arrives without a surface.
   */
  const arms = [...page.matchAll(/screen === "(\w+)"/g)].map(m => m[1]);
  const reachable: string[] = SCREENS.filter(d => d.id !== "run").map(d => d.id);
  const orphanArms = arms.filter(a => !reachable.includes(a));
  check(arms.length > 0, `328 · the body branches on the screen (${arms.length} arms)`);
  check(orphanArms.length === 0, `328a · and on no screen the strip cannot reach (${[...new Set(orphanArms)].join(", ") || "none"})`);
  check(/\) : \(\s*exhausted\(screen\)/.test(page), "328b · the branch no screen takes draws nothing");
  check(/function exhausted\(screen: never\)/.test(page),
    "328c · and is uninhabitable by its parameter rather than by a comment, so a fifth screen without a surface stops compiling");

  /*
   * The recording waits for a person.
   *
   * The src is the host and the id and nothing after it. An autoplay parameter
   * would start the museum's own stream talking at somebody who has read no word
   * of the page, and what was asked for is a player that works rather than
   * motion on arrival.
   */
  const embedSrc = /className="ag-stream-frame"[\s\S]*?src=\{`([^`]*)`\}/.exec(home)?.[1] ?? "";
  check(embedSrc.endsWith("${newest.videoId}"), `329 · the embed src ends at the recording's id (${embedSrc || "none"})`);
  check(!embedSrc.includes("?"), `329a · so it carries no parameter and nothing plays on arrival (${embedSrc || "none"})`);
  check("https://www.youtube-nocookie.com/embed/x?autoplay=1".includes("?"), "329b · the parameter check can see one (negative control)");

  if (before === undefined) delete process.env.WINDOWS_SNAPSHOT;
  else process.env.WINDOWS_SNAPSHOT = before;
  if (payToBefore === undefined) delete process.env.X402_PAY_TO;
  else process.env.X402_PAY_TO = payToBefore;
  resetServerForTest();
}
