import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as boardGET } from "../app/api/agent/board/route";
import { GET as windowsGET } from "../app/api/agent/windows/route";
import { GET as registrationGET } from "../app/api/agent/registration/route";
import { readFileSync } from "node:fs";
import { setRegistryForTest } from "../lib/human/registry";
import { onboardingFrom } from "../app/app-shell";
import { BOARD_SPECIES, boardFrom, cellOf, cellState, loadSnapshot } from "../lib/windows/snapshot";
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
  // A sidecar, because the detector's clock is not the recording's day.
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
  check(all.filter(w => w.day === "2026-09-03").length === 2, "269a · the day comes from producedAt where nothing else says");
  check(all.filter(w => w.day === "2026-09-05").length === 1, "269b · and from the sidecar where one does, which the detector's clock is not");

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
  check(Object.keys(unreadBody).sort().join(",") === "allowUnregistered,state", `278a · and answers with the state and the flag (${Object.keys(unreadBody).sort().join(",")})`);
  check(["registered", "not-registered", "unread"].includes(String(unreadBody.state)), `278b · which is one of the three states (${unreadBody.state})`);
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

  const page = readFileSync("app/app-shell.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  check(/REGISTRATION_LINE/.test(page), "279 · the gate draws AgentBook's answer as a sentence per state");
  // Read off the line the gate actually shows for unread. The substring was also
  // the Names section's sentence, so a wrong line here left it green.
  check(/unread: "AgentBook did not answer, so this says nothing about whether a person is behind this agent\."/.test(page),
    "279a · with unread saying nothing about the agent");
  check(!/identifies nobody|verified person|World App/.test(page),
    "279d · and the gate carries no sentence that is the legal lead's or names a third party's product");
  check(/No path\s+issues one from this page/.test(page.replace(/\s+/g, " ")), "279b · and the issue action written as a negative rather than drawn as a control");
  // A rung and not a button: the settings screen has the connect and the board
  // actions and no third that would do nothing.
  const settingsBlock = page.slice(page.indexOf("function Onboarding("), page.indexOf("function Board("));
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
  const dialogBlock = page.slice(page.indexOf('<dialog ref={runDialog}'), page.indexOf("</dialog>"));
  check(/<form method="dialog">/.test(dialogBlock), "284c · closing it is a dialog form and aborts nothing");
  check(!/\babort\b|reader\.cancel|AbortController/.test(page), "284d · and nothing on the page aborts the stream");
  // The action lives beside the cell it will read and nowhere else.
  const boardRun = page.slice(page.indexOf("ag-board-run"), page.indexOf("ag-board-run") + 500);
  check(/Pay and run/.test(boardRun), "284e · the action is on the board beside the chosen cell");
  // Over a copy with the comments stripped, for the reason 279e strips them: the
  // note explaining where the action lives names the action.
  const renderedPage = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const payControls = (renderedPage.match(/"Pay and run"/g) ?? []).length;
  check(payControls === 1, `284f · and exists exactly once on the page (${payControls})`);
  // The blur is on the page. The stylesheet's rule against backdrop-filter and
  // the check that holds it are untouched.
  check(/body:has\(\.ag-run-dialog\[open\]\)\s+\.ag-surface\s*\{[^}]*filter:\s*blur\([^)]+\)[^}]*\}/.test(css),
    "284g · the page behind is blurred rather than the backdrop, in one rule");
  check(!/backdrop-filter\s*:/.test(css), "284h · and no backdrop-filter is declared anywhere");
  // To the dialog, not to the end of main: the dialog lives inside main and its
  // Close button is not the bottom bar's.
  const actions = page.slice(page.indexOf('<div className="ag-actions">'), page.indexOf("<dialog ref={runDialog}"));
  check(!/<button/.test(actions), "284i · and the bottom bar carries nothing pressable");
  // 39: the thesis renders where the run happens, and nothing holds a run screen.
  check(/id="ag-run-thesis"/.test(dialogBlock) && /No credential in existence may confirm/.test(dialogBlock),
    "285a · the run's thesis is the dialog's heading");
  check(/aria-labelledby="ag-run-thesis"/.test(page), "285b · which names the dialog");
  check(/tabIndex=\{-1\}/.test(page) && /dialog\.focus\(\)/.test(page), "285c · and the dialog takes focus rather than its Close button");
  check(/aria-haspopup=\{s\.id === "run" \? "dialog"/.test(page), "285d · the strip's run item says it opens one");
  const heads = page.slice(page.indexOf("const HEADS"), page.indexOf("const HEADS") + 900);
  check(/settings:/.test(heads) && /board:/.test(heads), "285 · every screen but the run carries its own head line");


  /*
   * The onboarding, and the strip that does not exist until it is done.
   *
   * A new person could walk past every condition to a run that could not work.
   * Driven on the rule, which is pure, so every combination is reachable without
   * a browser and the preset case is one of them.
   */
  const ADDR = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
  const flow = (over: Partial<Parameters<typeof onboardingFrom>[0]>) =>
    onboardingFrom({
      address: ADDR,
      chain: "0x14a34",
      registration: "registered",
      name: "agent1.xovi.eth",
      acks: { person: false, name: false },
      allowUnregistered: false,
      ...over,
    });

  // The founder's preset wallet: registered and named, all three met on load.
  check(flow({}).done, "286 · a registered and named wallet passes all three on load");
  check(!flow({ address: null }).done, "286a · no wallet does not");
  check(!flow({ chain: "0x1" }).done, "286b · nor a wallet on another chain");
  check(flow({ chain: "0x1" }).at === "wallet", "286c · which is the step it stops on");

  /*
   * The registration step is hard by default, and the softer path is a flag.
   */
  check(!flow({ registration: "not-registered" }).done, "287 · an unregistered wallet never reaches the board");
  check(flow({ registration: "not-registered" }).steps[1].mark === "blocked", "287a · and its step says so rather than offering a way past");
  check(!flow({ registration: "not-registered", allowUnregistered: true }).done, "287b · with the flag set it is still not done unacknowledged");
  check(flow({ registration: "not-registered", allowUnregistered: true, acks: { person: true, name: false } }).done,
    "287c · and done once acknowledged (negative control for the flag)");
  check(!flow({ registration: "unread" }).done, "287d · an unread registry does not complete the step either");

  /*
   * The name completes two ways and neither of them records anything.
   */
  check(flow({ name: "agent1.xovi.eth" }).done, "288 · a name that resolves to the payer completes the step as issued");
  check(!flow({ name: null }).done, "288a · and no name does not complete it on its own");
  check(flow({ name: null, acks: { person: false, name: true } }).done, "288b · but an acknowledgement does");
  const nameCard = page.slice(page.indexOf('<h3 className="ag-panel-title">A name</h3>'), page.indexOf("function Board("));
  check(/acknowledged, no name issued/.test(nameCard) && !/requested/.test(nameCard),
    "288c · and the card says acknowledged and no name issued, never requested");

  // The strip does not exist until the third step is done.
  check(/\{onboarded && \(/.test(page), "289 · the strip is absent until the onboarding is done");
  check(/const onboarded = onboardingFrom\(/.test(page), "289a · and is derived from the reads rather than from a remembered yes");
  check(!/\{ id: "settings"/.test(page), "289b · settings is no longer a destination, since it is the way in");

  if (before === undefined) delete process.env.WINDOWS_SNAPSHOT;
  else process.env.WINDOWS_SNAPSHOT = before;
  if (payToBefore === undefined) delete process.env.X402_PAY_TO;
  else process.env.X402_PAY_TO = payToBefore;
  resetServerForTest();
}
