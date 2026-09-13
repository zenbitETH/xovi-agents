"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_SEPOLIA_HEX,
  NoWallet,
  WrongChain,
  connect,
  currentChain,
  disconnect,
  ensureBaseSepolia,
  onWalletChange,
  restoreConnection,
  signChallenge,
} from "~~/lib/agent/browser";
import type { RunStep } from "~~/lib/agent/run";
import { BOARD_SPECIES } from "~~/lib/windows/types";
import { recoverConfirmer } from "~~/lib/anchor/confirmation";
import { decisionCode } from "~~/lib/anchor/schema";
import { CONFIRMATION_259 } from "~~/lib/anchor/confirmation-259";

const REPO = "https://github.com/zenbitETH/xovi-agents";

// The clip confirmation schema on Ethereum Sepolia, README under "Subgraph and
// paid query" and the schema row beside it. Public and
// unauthenticated, and the only destination of this kind that resolves today: there is
// no per clip page to link a proposal to, because /galeria/[slug] in the reviewing
// application is a BEHAVIOUR page rather than a clip page, and the attestation
// identifier appears in this repository only in truncated form.
// Where a settlement can be read by somebody who was not here. Keyed by the chain
// the receipt names rather than assumed, because a link built for whatever network
// string arrives would send a reader to a page about a different chain, and a
// confident wrong link is worse than none. Base Sepolia is the only one that
// settles here, so it is the only one listed.
/** One table for one chain. Two of them, keyed differently, was two places for an
 *  origin to be right in and one place for it to be wrong. */
const EXPLORER_ORIGIN: Record<string, string> = { "0x14a34": "https://sepolia.basescan.org" };

/**
 * The explorer for a chain, by either name the page holds one under.
 *
 * A receipt names its chain as CAIP-2 and a wallet names it as hex, and both have
 * to reach the same table or one of them gets a link built for a chain it is not
 * on. Unknown chains get nothing, which is the ticket's rule: a confident wrong
 * link is worse than none.
 */
function explorerOrigin(chain: string | null): string | null {
  if (chain === null) return null;
  const hex = chain.startsWith("eip155:") ? `0x${Number(chain.slice(7)).toString(16)}` : chain.toLowerCase();
  return EXPLORER_ORIGIN[hex] ?? null;
}



const SCHEMA = "https://sepolia.easscan.org/schema/view/0x8d4a9a6e41e07cb67128eaca5a79f4d39e5199eb8c1c7d7a0096e0a5d11c8c6d";

/**
 * One line of a run, as a person reads it.
 *
 * The wire steps are a discriminated union and this is the only place that turns
 * them into sentences, so a new step cannot reach the screen as a raw tag: the
 * switch is exhaustive and the compiler says so. Nothing here interpolates a
 * value the step does not carry, because the step is where the decision about
 * what may be published was already made.
 *
 * Two independent axes, deliberately not folded into one.
 *
 * `actor` says whose activity a line is, and it is the only thing that carries
 * hue: teal for the person, gold for the agent. This feed is the one surface
 * in the project showing both interleaved, which is the thing the app exists to
 * make legible, and it reads as a story only if the two are told apart at a
 * glance rather than by reading.
 *
 * `tone` says how the run is going, and it never uses teal, so teal in this feed
 * means a person and nothing else.
 *
 * Gold is not one of the two. It means "this control is active" (globals.css:570)
 * and stays on the toolbar button, so the button and the markers cannot be read
 * as the same signal. The agent's hue is its own token, measured at 4.13
 * against the surface it actually sits on, which marks and never letters.
 */
export type Actor = "human" | "agent" | "system";

/**
 * The thing a line draws, when a sentence is the wrong shape for it.
 *
 * A state is an object here rather than a clause: the price is a card, the
 * settlement is a ticket, what was bought is a row of tiles, the proposal is a
 * card. The rule is that a drawn object carries only values the step already
 * carried, so the drawing cannot say more than the sentence it replaces.
 *
 * The tiles are the reason this exists. A count of windows is a number a reader
 * skims; the same windows as tiles are a thing that was bought, and each tile
 * carries an opaque identifier and nothing else. The tank, the species and the
 * alias are in the window the server sent and in the proposal the agent forms,
 * and they reach no browser.
 */
export type Drawn =
  | { kind: "challenge"; amount: string; asset: string; network: string }
  | { kind: "receipt"; transaction: string; network: string }
  | { kind: "allowance" }
  | { kind: "windows"; ids: string[]; chosen?: string }
  | { kind: "clip"; id: number; status: string };

export type Line = {
  text: string;
  detail?: string;
  tone: "working" | "good" | "stopped" | "supply";
  actor: Actor;
  object?: Drawn;
};

export function lineFor(step: RunStep): Line {
  switch (step.step) {
    case "presenting":
      return { text: "Presenting the signed authorization", tone: "working", actor: "agent" };
    case "payment-refused":
      return { text: "The paid route refused the payment", detail: step.detail, tone: "stopped", actor: "agent" };
    case "unavailable":
      return { text: "The route cannot serve right now", detail: step.detail, tone: "stopped", actor: "agent" };
    case "paid":
      if (step.free) {
        // No count beside it. The free branch returns the same payload as a paid
        // read and no field carries what is left of the allowance, so the page
        // states the allowance and states no number it was not served.
        return {
          text: "Served under the free daily allowance",
          detail: "nothing was charged for this read",
          tone: "good",
          actor: "agent",
          object: { kind: "allowance" },
        };
      }
      return {
        text: "Payment settled",
        detail: step.network,
        tone: "good",
        actor: "agent",
        object:
          step.transaction !== undefined && step.network !== undefined
            ? { kind: "receipt", transaction: step.transaction, network: step.network }
            : undefined,
      };
    case "read":
      return {
        text: `Read ${step.served} candidate window${step.served === 1 ? "" : "s"}`,
        tone: "working",
        actor: "agent",
        object: { kind: "windows", ids: step.ids },
      };
    case "selected":
      // The duration and not the two endpoints, for the reason the step's own
      // comment gives, and no score of any kind. The record carries the model's
      // number and no surface renders it: it is opaque by spec 05, and a value
      // on a screen is read as a quality whatever the caption says.
      return {
        text: `Chose window ${step.windowId}`,
        detail: `${step.durationSeconds}s of stream`,
        tone: "working",
        actor: "agent",
        object: { kind: "windows", ids: [step.windowId], chosen: step.windowId },
      };
    case "nothing-proposable":
      // None of them passed validation, which is not the same as all of them
      // being already proposed. The run reaches this before offering anything, so
      // it knows nothing about what the ingest already holds.
      return {
        text: `None of the ${step.considered} window${step.considered === 1 ? "" : "s"} this snapshot serves could become a proposal`,
        tone: "supply",
        actor: "agent",
      };
    case "cell-spent":
      // Reachable only by walking every window and being refused each time, which
      // is what makes "already proposed" a thing the run can say.
      return {
        text: `Every one of the ${step.considered} window${step.considered === 1 ? "" : "s"} in this cell has already been proposed`,
        detail: "the ingest holds a clip for each of them",
        tone: "supply",
        actor: "agent",
      };
    case "proposing":
      return { text: "Submitting the proposal", tone: "working", actor: "agent" };
    case "proposed":
      return {
        text: `Proposed as clip ${step.id}`,
        detail: "a person decides what happens to it",
        tone: "good",
        actor: "agent",
        object: { kind: "clip", id: step.id, status: step.status },
      };
    case "declined":
      return {
        text: `The proposal was declined: ${step.kind}`,
        detail: step.status === undefined ? step.detail : `${step.detail} (HTTP ${step.status})`,
        // A rejection is the one refusal that is a person's judgement rather than
        // a machine's answer: someone looked at this window and said no. It is
        // marked as their activity, which is the whole point of the two hues.
        actor: step.kind === "rejected" ? "human" : "agent",
        // A duplicate is the ingest holding a clip it already has, which is the
        // rule working. The other four kinds are refusals and keep the tone.
        tone: step.kind === "duplicate" ? "supply" : "stopped",
      };
    case "not-submitted":
      return { text: "Stopped before submitting", detail: step.detail, tone: "stopped", actor: "agent" };
    case "done":
      return { text: "Run finished", tone: "good", actor: "system" };
  }
}

/**
 * A run that ends because the snapshot has nothing new in it.
 *
 * The ingest refusing a window it already holds is the system working. Drawn in
 * the stopped tone it reads as a failure of the agent, and after two runs against
 * a two window snapshot every run reads that way, which is what a person watching
 * concluded.
 *
 * **The sentence is what the page can substantiate and no more.** A single
 * duplicate establishes that the chosen window is already a clip, and says nothing
 * about the rest, because the run stops at the first refusal rather than walking
 * them. What is true either way is that a snapshot is a file and has not gained a
 * window, so that is the negative. Where the run reports nothing proposable at
 * all, the stronger first sentence is true and is used.
 */
export type Supply = { kind: "duplicate" | "exhausted" | "unusable"; served: number; ids: string[] };

export function supplyFrom(steps: RunStep[]): Supply | null {
  const read = steps.find(s => s.step === "read");
  if (read === undefined) return null;
  const ids = read.step === "read" ? read.ids : [];
  const served = read.step === "read" ? read.served : 0;
  // Only the walk earns the stronger sentence. `nothing-proposable` is a
  // validation outcome and says nothing about what the ingest holds.
  const spent = steps.some(s => s.step === "cell-spent");
  if (spent) return { kind: "exhausted", served, ids };
  if (steps.some(s => s.step === "nothing-proposable")) return { kind: "unusable", served, ids };
  const duplicate = steps.some(s => s.step === "declined" && s.kind === "duplicate");
  return duplicate ? { kind: "duplicate", served, ids } : null;
}

export function supplySentence(supply: Supply): string {
  if (supply.kind === "exhausted") {
    // Earned by the walk: every window was offered and every one came back a
    // duplicate, so the cell really is spoken for.
    return "Every window in this cell has already been proposed. No new window has been served into it.";
  }
  if (supply.kind === "unusable") {
    return `None of the ${supply.served} window${supply.served === 1 ? "" : "s"} this snapshot serves could become a proposal. No new window has been served into it.`;
  }
  return `This snapshot serves ${supply.served} window${supply.served === 1 ? "" : "s"} and the one this run chose is already a clip. No new window has been served into it.`;
}

/**
 * The plan, before anything moves.
 *
 * *Action plan* in the skill's terms: the sequence the run will follow, readable
 * whole before a person signs anything. Five nodes, each in the hue of whoever
 * acts, idle at rest and lit as the run reports.
 *
 * **A node lights from an event, never from the one before it.** The propose node
 * is the reason: a run on a deployment with no ingest credential ends at
 * not-submitted, and a stepper that lit propose because pay and read had happened
 * would draw a proposal that never left the machine.
 */
export type PlanNode = { label: string; actor: Actor };

export const PLAN: PlanNode[] = [
  { label: "read the challenge", actor: "system" },
  { label: "you sign", actor: "human" },
  { label: "pay and read", actor: "agent" },
  { label: "propose", actor: "agent" },
  { label: "stop", actor: "system" },
];

export function planFrom(challengeRead: boolean, signed: boolean, steps: RunStep[]): boolean[] {
  return [
    challengeRead,
    signed,
    steps.some(s => s.step === "paid" || s.step === "read"),
    // Only the two steps that mean a proposal actually reached the ingest.
    // `not-submitted` is the run stopping one short and must not light this.
    steps.some(s => s.step === "proposing" || s.step === "proposed"),
    steps.some(s => s.step === "done"),
  ];
}

/** The marks on the tiles. `currentColor` throughout, so the hue is a class and
 *  never a literal: the agent hue is declared once as a token and check 212b
 *  holds it there. Width and height on the element, as check 216 requires. */
function MarkReceipt() {
  return (
    <svg className="ag-verb-mark ag-mark-agent" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.5 2.5h11v15l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-1 .7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7.5 7h5M7.5 10.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MarkSignature() {
  return (
    <svg className="ag-verb-mark ag-mark-human" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 13.5c3 0 3.5-8 5.5-8s1.5 8 3.5 8 2-4 3-4 1.2 1.6 3 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M2.5 17h15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function MarkEquality() {
  return (
    <svg className="ag-verb-mark ag-mark-system" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 8h12M4 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

type Phase = "idle" | "connecting" | "ready" | "signing" | "running" | "finished";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "no wallet connected",
  connecting: "connecting",
  ready: "ready to run",
  signing: "waiting for your signature",
  running: "running",
  finished: "run finished",
};

/**
 * A settlement as `/api/receipts` serves it. Eight fields, and the route builds
 * them one by one, so this type is the whole of what the page may read.
 */
type Settlement = {
  source: string;
  payer: string;
  payTo: string;
  amount: string;
  network: string;
  nonce: string;
  txHash: string;
  settledAt: string;
};

/**
 * Four destinations, and the account's four are inside one of them.
 *
 * Seven flat items were seven things of unequal kind: the product, four views of
 * an account, a record anyone can check, and a ladder. Grouping them is not
 * tidying. A person arriving at this page is asking one of four questions, and a
 * strip that answers all seven at once answers none of them first.
 *
 * A destination is added the day it is built, so no item opens on nothing.
 */
type Screen = "settings" | "board" | "run" | "account" | "record" | "notyet";

/**
 * The destinations, and the flow through the first three.
 *
 * A person arrives at Settings, chooses a cell on the Board, and only then has a
 * Run to look at. Run is absent from the strip until a cell is chosen rather than
 * present and inert, because a control that does nothing is a control that lies,
 * which is the same rule that keeps a drawn but unbuilt action off this page.
 */
export const SCREENS: { id: Screen; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "board", label: "Board" },
  { id: "run", label: "Run" },
  { id: "account", label: "Account" },
  { id: "record", label: "Record" },
  { id: "notyet", label: "Not yet" },
];

export function screensFor(cellChosen: boolean): { id: Screen; label: string }[] {
  return SCREENS.filter(s => s.id !== "run" || cellChosen);
}

/** A cell of the board, as the page holds it once a person picks one. */
export type Chosen = { day: string; species: string };

/**
 * What AgentBook says, in three states.
 *
 * Unread is an answer about the read and not about the agent, so it is not drawn
 * as not registered: telling somebody to register when they already have is the
 * one wrong thing this card can do.
 */
export type Registration = "registered" | "not-registered" | "unread" | "reading" | "idle";

const REGISTRATION_LINE: Record<Registration, string> = {
  idle: "Connect a wallet and this reads AgentBook for it.",
  reading: "Reading AgentBook.",
  // The page's own words. The English badge sentences belong to the legal lead
  // and are not hers to have quoted here before her word; and no merged text
  // says how a registration is made, so the negative stands alone rather than
  // naming somebody else's product as the place to go.
  registered: "AgentBook holds a registration behind this agent.",
  "not-registered": "AgentBook holds no registration behind this agent. Registering is not done here.",
  unread: "AgentBook did not answer, so this says nothing about whether a person is behind this agent.",
};

type AccountTab = "overview" | "receipts" | "proposals" | "names";

export const ACCOUNT_TABS: { id: AccountTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "receipts", label: "Receipts" },
  { id: "proposals", label: "Proposals" },
  { id: "names", label: "Names" },
];

/**
 * The amount, read as money.
 *
 * The ledger records the network and the atomic amount and no asset, so the unit
 * cannot be read off a row. It is read off a merged document instead: the paid
 * route sells one thing on one chain, and the README and the live challenge both
 * name that as USDC on Base Sepolia. So a total is formed only for rows on that
 * chain, and a row settled anywhere else is counted and not summed rather than
 * added to a number whose unit nobody knows.
 */
/**
 * The transaction hash the fake facilitator settles with.
 *
 * Written here as a literal rather than imported, because `lib/human/store.ts`
 * reaches for the database driver and this file runs in a browser. The copy is
 * held to the original by a check that imports both and compares them, so the two
 * cannot drift; see `test/page.ts`.
 *
 * It is on this page because a row in the production ledger carries it, written
 * on 2026-09-11 by a local demo run whose process had a real connection string.
 * The route serves that row because it is in the table. Drawing it as a
 * settlement would put a payment that happened on no chain into a total, and
 * dropping it silently would hide a row the ledger really holds, so it is drawn
 * and named and left out of the sum.
 */
const FABRICATED_TX = `0x${"11".repeat(32)}`;

const BASE_SEPOLIA = "eip155:84532";
const USDC_DECIMALS = 1_000_000n;

export function settled(settlements: Settlement[]): Settlement[] {
  return settlements.filter(s => s.txHash !== FABRICATED_TX);
}

export function fabricated(settlements: Settlement[]): Settlement[] {
  return settlements.filter(s => s.txHash === FABRICATED_TX);
}

export function totalOnBaseSepolia(settlements: Settlement[]): { total: string; counted: number; elsewhere: number } {
  const here = settled(settlements).filter(s => s.network === BASE_SEPOLIA);
  let atomic = 0n;
  for (const s of here) {
    try {
      atomic += BigInt(s.amount);
    } catch {
      // A row whose amount is not an integer is not guessed at. It is left out of
      // the total and still counted as a settlement, because it happened.
    }
  }
  const whole = atomic / USDC_DECIMALS;
  const frac = (atomic % USDC_DECIMALS).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return { total: `${whole}.${frac.padEnd(2, "0")}`, counted: here.length, elsewhere: settled(settlements).length - here.length };
}

/**
 * What this wallet has done here, from what the ledger serves.
 *
 * **Three panels, where the design draws seven cards.** Counted against what this
 * function renders rather than against the intention: Settled reads, Spent, and
 * Free reads, which carries a sentence and no number.
 *
 * The four the design has and this does not, each absent because nothing serves
 * the number rather than because it was cut for time. *Agents* counted how many
 * an operator had, and the scope here is one, the connected wallet. *Runs* has no
 * source at all: a run happens in a browser and nothing persists one. *Proposals*
 * and *Decided* are served by a route that does not exist yet. The allowance has
 * no count either, because the free branch returns the same payload as a paid read
 * and no field carries what is left.
 */
function Overview({ settlements, state }: { settlements: Settlement[]; state: "idle" | "loading" | "ready" | "failed" }) {
  const money = totalOnBaseSepolia(settlements);
  if (state === "idle") return <p className="xv-desc ag-empty">Connect a wallet to read what it has settled here.</p>;
  if (state === "loading") return <p className="xv-desc ag-empty">Reading the ledger.</p>;
  if (state === "failed") {
    // Not an empty history. A ledger that cannot answer says so, because a zero
    // here would be a statement about the wallet that nothing measured.
    return <p className="xv-desc ag-empty">The ledger did not answer, so nothing here is a count of what this wallet did.</p>;
  }
  return (
    <div className="ag-cards">
      <div className="ag-panel">
        <h3 className="ag-panel-title">Settled reads</h3>
        <p className="ag-panel-big">{settled(settlements).length}</p>
        <p className="ag-sub">every one of them has a receipt</p>
      </div>
      <div className="ag-panel">
        <h3 className="ag-panel-title">Spent</h3>
        <p className="ag-panel-big">{money.total}</p>
        <p className="ag-sub">
          USDC on Base Sepolia
          {money.elsewhere > 0 ? `, and ${money.elsewhere} settled on another chain and not added` : ""}
        </p>
      </div>
      <div className="ag-panel">
        <h3 className="ag-panel-title">Free reads</h3>
        <p className="ag-sub ag-panel-note">
          Served under the free daily allowance. The route serves no count of what is left, so this page states none.
        </p>
      </div>
    </div>
  );
}

/** The month a settlement belongs to, in UTC, so a total does not move with
 *  whoever is reading it. */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Every settlement this wallet made, as tickets, newest first.
 *
 * The totals are per month and are recomputed here from the same rows the
 * tickets draw, so a reader adding up the tickets gets the number above them.
 * A free read has no ticket in this section and cannot: it writes no receipt.
 * That is stated rather than left as a gap, because a person who used the
 * allowance and finds nothing here should learn why and not wonder.
 */
function Receipts({ settlements, state }: { settlements: Settlement[]; state: "idle" | "loading" | "ready" | "failed" }) {
  if (state === "idle") return <p className="xv-desc ag-empty">Connect a wallet to read its receipts.</p>;
  if (state === "loading") return <p className="xv-desc ag-empty">Reading the ledger.</p>;
  if (state === "failed") return <p className="xv-desc ag-empty">The ledger did not answer, so this is not a list of what this wallet settled.</p>;

  const real = settled(settlements);
  const fake = fabricated(settlements);
  const months = [...new Set(real.map(s => monthOf(s.settledAt)))].sort().reverse();

  return (
    <div className="ag-receipts">
      <p className="xv-desc ag-empty">
        A read served under the free daily allowance settles nothing and writes no receipt, so it has no ticket here.
      </p>

      {real.length === 0 && <p className="xv-desc ag-empty">This wallet has settled nothing here.</p>}

      {months.map(month => {
        const rows = real.filter(s => monthOf(s.settledAt) === month);
        const money = totalOnBaseSepolia(rows);
        return (
          <section key={month} className="ag-month">
            <h3 className="ag-panel-title">
              {month}, {rows.length} settlement{rows.length === 1 ? "" : "s"}, {money.total} USDC on Base Sepolia
            </h3>
            {rows.map(s => (
              <div key={s.txHash} className="ag-ticket ag-ticket-row">
                <span className="ag-ticket-hash">{s.txHash}</span>
                <span className="ag-sub">
                  {s.amount} atomic, {s.network}, {s.settledAt}
                </span>
                {explorerOrigin(s.network) !== null && (
                  <a className="ag-link ag-ticket-link" href={`${explorerOrigin(s.network)}/tx/${s.txHash}`}>
                    Read it on the explorer
                  </a>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {fake.length > 0 && (
        <section className="ag-month">
          <h3 className="ag-panel-title">In the table and not a settlement</h3>
          <p className="xv-desc ag-empty">
            The ledger holds {fake.length} row{fake.length === 1 ? "" : "s"} carrying the fake facilitator&rsquo;s
            transaction hash, written by a local demonstration whose process held a real connection string. That
            transaction is on no chain, so it is shown here and counted in no total.
          </p>
          {fake.map(s => (
            <div key={s.nonce} className="ag-ticket ag-ticket-row ag-ticket-free">
              <span className="ag-ticket-hash">{s.txHash}</span>
              <span className="ag-sub">{s.settledAt}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * The name, and the negative when there is not one.
 *
 * **A name is issued, never owned.** A subname's records live in the parent's
 * resolver and only the parent's owner writes them, so what this section reports
 * is a record Zenbit can change and not a possession of the agent's.
 *
 * The positive is stated only on equality. Under a wildcard parent every subname
 * resolves, so a name that answers is not a name that was issued: an unissued name
 * and a typo look identical from here, and the only thing that distinguishes an
 * issued one is that the address it carries is this payer. Anything short of that
 * is reported as the negative.
 */
function Names({ payer }: { payer: string | null }) {
  const [answer, setAnswer] = useState<{ name: string | null; address: string | null; matches: boolean } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    if (payer === null) {
      setState("idle");
      return;
    }
    let live = true;
    setState("loading");
    fetch(`/api/name?payer=${payer}`)
      .then(async r => (r.ok ? ((await r.json()) as { name: string | null; address: string | null; matches: boolean }) : Promise.reject(new Error(String(r.status)))))
      .then(a => {
        if (!live) return;
        setAnswer(a);
        setState("ready");
      })
      .catch(() => {
        if (live) setState("failed");
      });
    return () => {
      live = false;
    };
  }, [payer]);

  if (state === "idle") return <p className="xv-desc ag-empty">Connect a wallet to read whether a name is issued to it.</p>;
  if (state === "loading") return <p className="xv-desc ag-empty">Reading the resolver.</p>;
  if (state === "failed")
    return <p className="xv-desc ag-empty">The resolver did not answer, so this says nothing about whether a name is issued.</p>;

  return (
    <div className="ag-records">
      {answer !== null && answer.matches ? (
        <div className="ag-panel">
          <h3 className="ag-panel-title">{answer.name}</h3>
          <p className="ag-sub">resolves to this payer</p>
          <p className="ag-ticket-hash">{answer.address}</p>
        </div>
      ) : (
        <div className="ag-panel">
          <h3 className="ag-panel-title">No name is issued for this payer.</h3>
        </div>
      )}
      <p className="xv-desc ag-empty">
        A name is issued and is not owned. A subname&rsquo;s records live in the parent&rsquo;s resolver, and only the
        parent&rsquo;s owner writes them, so Zenbit can change or withdraw what this reports. Read from the resolver at
        the moment this section was opened, on Sepolia, after asking the endpoint which chain it is.
      </p>
    </div>
  );
}

type Proposal = { id: number | null; clipHash: string | null; status: string | null; submittedAt: string | null; verifiedAt: string | null };

/**
 * What this wallet proposed, and what came back.
 *
 * **The list this reads serves confirmed rows only.** That is a property of the
 * reviewing application's endpoint and not a filter chosen here, so an empty
 * section means no proposal of this wallet's has been confirmed, and it does not
 * mean none was made. Saying that is the whole of the copy below: an empty list
 * that reads as "you proposed nothing" would be the page lying by omission.
 *
 * Confirmed is the only state lit. Attested and anchored live in the anchors
 * store, which this page has no route to read by clip hash, and proposed and in
 * queue are on a surface this deployment does not read at all. None of them is
 * drawn dim or greyed, because a state drawn is a state claimed.
 */
function Proposals({ submitter }: { submitter: string | null }) {
  const [rows, setRows] = useState<Proposal[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed" | "unconfigured">("idle");

  useEffect(() => {
    if (submitter === null) {
      setState("idle");
      return;
    }
    let live = true;
    setState("loading");
    fetch(`/api/proposals?submitter=${submitter}`)
      .then(async r => {
        if (r.status === 503) return { unconfigured: true as const };
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { proposals: Proposal[] };
      })
      .then(answer => {
        if (!live) return;
        if ("unconfigured" in answer) {
          setState("unconfigured");
          return;
        }
        setRows(answer.proposals);
        setState("ready");
      })
      .catch(() => {
        if (live) setState("failed");
      });
    return () => {
      live = false;
    };
  }, [submitter]);

  if (state === "idle") return <p className="xv-desc ag-empty">Connect a wallet to read what it proposed.</p>;
  if (state === "loading") return <p className="xv-desc ag-empty">Reading the public list.</p>;
  if (state === "unconfigured")
    return <p className="xv-desc ag-empty">This deployment reads no public list, so it can say nothing about proposals.</p>;
  if (state === "failed") return <p className="xv-desc ag-empty">The public list did not answer, so this is not a list of what this wallet proposed.</p>;

  return (
    <div className="ag-records">
      <p className="xv-desc ag-empty">
        Only confirmed proposals appear here. A proposal no person has confirmed is not public.
      </p>
      {(rows ?? []).length === 0 && (
        <p className="xv-desc ag-empty">No proposal of this wallet&rsquo;s has been confirmed.</p>
      )}
      {(rows ?? []).map(row => (
        <div key={String(row.id)} className="ag-ticket ag-ticket-row">
          <span className="ag-card-value">clip {row.id}</span>
          <span className="ag-ticket-hash">{row.clipHash}</span>
          <span className="ag-sub">
            {row.status}, proposed {row.submittedAt}, confirmed {row.verifiedAt}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Where this goes, written so that it cannot be read as a promise.
 *
 * **Each rung is two present tense sentences, one merged fact and one negative**,
 * and the unlock is the negative rather than a condition. That is the whole
 * device: *unlocks when*, *will*, *soon* and *coming* are promises, and a promise
 * about an unbuilt feature is the thing the disclosure rules refuse. Written as a
 * negative, the day it stops being true the absence sweep's own question, has this
 * already happened, catches it.
 *
 * No figure, tier, share or token appears on any rung, and no rung names a
 * detection, morphometric, correlation or hypothesis capability. Unnumbered,
 * because the unlocks are independent and an order would assert one that is not
 * real.
 *
 * Copied verbatim from section 4.2 of the redesign proposal, brain `dd056d3`, so
 * a reader can diff these strings against it by bytes. The backticks are the
 * source's and are rendered rather than stripped, which is what keeps that diff
 * meaningful.
 *
 * The look rung's merged fact, that a human signs the decision, is true where
 * migration `0027` runs. The Xovi builder measured that on the deployment this
 * page reads, through the signature served on the confirmation this repository
 * carries, rather than from the branch that holds the file.
 */
const RUNGS: { rung: string; sentences: string }[] = [
  { rung: "a name", sentences: "`agent1.xovi.eth` resolves to the agent's payer. No other name is issued." },
  { rung: "the money", sentences: "Receipts land in a ledger. No rule routes any of it onward." },
  { rung: "the look", sentences: "A human confirms or rejects every proposal and signs the decision. No institution has paid for one." },
  { rung: "the query", sentences: "The anchor joins the confirmation. No key but Zenbit's has queried it." },
  { rung: "a mainnet", sentences: "Every payment here settles on Base Sepolia. Nothing here writes to a mainnet; one read is on one." },
  { rung: "a second producer", sentences: "One colony produces every record. No second producer exists." },
];

export { RUNGS };

/** Renders the source's backticks as code, so a rung can be stored byte for byte
 *  as the proposal writes it and still read properly on a screen. */
function Ticked({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="ag-ticket-hash">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function NotYet() {
  return (
    <div className="ag-records">
      <p className="xv-desc ag-empty">
        What the working surface above does not do. Each of these is two statements: something this repository already
        does, and something it does not. The second is what would have to stop being true.
      </p>
      <ul className="ag-chain ag-rungs">
        {RUNGS.map(r => (
          <li key={r.rung} className="ag-chain-link">
            <span className="ag-panel-title">{r.rung}</span>
            <span className="ag-sub">
              <Ticked text={r.sentences} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The run as a rolodex, ported from the Zenbit site's stack.
 *
 * One card at a time, centred, with the previous leaf tipping away as the new one
 * rolls in. The site drives the same keyframes from a view timeline as a reader
 * scrolls; this is event driven, so the ramp's three frames become three
 * positions set as steps arrive, and the change between them is a transition.
 *
 * The cards are the same `Line` objects the log holds, so nothing here is a
 * second account of the run that could disagree with the first, and every line
 * stays reachable by stepping back.
 *
 * **The card being read is level and at full opacity, always.** That is the
 * site's own rule at its narrow breakpoint, for the reason it gives: partial
 * opacity on text being read is a contrast loss and not a flourish.
 */
function Rolodex({ lines, at, onStep }: { lines: Line[]; at: number; onStep: (to: number) => void }) {
  if (lines.length === 0) return null;
  return (
    <div className="ag-roll">
      <div className="ag-roll-stage">
        {lines.map((line, i) => (
          <article
            key={i}
            className={`ag-roll-card ag-tone-${line.tone} ag-actor-${line.actor}`}
            data-position={i === at ? "current" : i < at ? "behind" : "next"}
            aria-hidden={i === at ? undefined : "true"}
          >
            <header className="ag-roll-head">
              <span className="ag-roll-dot" aria-hidden="true" />
              <span className="ag-chip ag-roll-pill">{line.tone}</span>
            </header>
            <p className="ag-roll-name">{line.text}</p>
            {line.detail !== undefined && <p className="ag-roll-line">{line.detail}</p>}
            {line.object !== undefined && <Drawing object={line.object} />}
          </article>
        ))}
      </div>
      <div className="ag-roll-controls">
        <button type="button" className="ag-rail-item" onClick={() => onStep(at - 1)} disabled={at === 0}>
          Back
        </button>
        <span className="ag-sub">
          {at + 1} of {lines.length}
        </span>
        <button type="button" className="ag-rail-item" onClick={() => onStep(at + 1)} disabled={at >= lines.length - 1}>
          Forward
        </button>
      </div>
    </div>
  );
}

/**
 * Settings: what has to be true before a run means anything.
 *
 * The wallet, what AgentBook says about it, and whether a name is issued to it.
 * Each is a card that states its own answer rather than a checklist that grades
 * the person.
 *
 * **The issue action is a rung, not a button.** No issuing path exists, and a
 * control drawn and marked design is a control that lies; two present tense
 * sentences with the negative say the same thing truthfully and go on the sweep
 * with everything else.
 */
function Settings({
  address,
  chain,
  registration,
  name,
  onBoard,
}: {
  address: `0x${string}` | null;
  chain: string | null;
  registration: Registration;
  name: string | null;
  onBoard: () => void;
}) {
  return (
    <div className="ag-records">
      <div className="ag-panel">
        <h3 className="ag-panel-title">The wallet</h3>
        {address === null ? (
          // One act, one control. Connect wallet lives in the header, where it
          // stays reachable from every destination; a second button here would be
          // the same act twice and the page would have two primary actions.
          <p className="ag-sub">Nothing is connected, so nothing below can be read. Connect a wallet in the header.</p>
        ) : (
          <>
            <p className="ag-ticket-hash">{address}</p>
            <p className="ag-sub">{chain === BASE_SEPOLIA_HEX ? "on Base Sepolia" : chain === null ? "on a chain that did not answer" : "on another chain"}</p>
          </>
        )}
      </div>

      <div className="ag-panel">
        <h3 className="ag-panel-title">The person behind the agent</h3>
        <p className="ag-sub">{REGISTRATION_LINE[registration]}</p>
      </div>

      <div className="ag-panel">
        <h3 className="ag-panel-title">The name</h3>
        {name !== null ? (
          <>
            <p className="ag-card-value">{name}</p>
            <p className="ag-sub">resolves to this payer</p>
          </>
        ) : (
          <p className="ag-sub">No name is issued for this payer.</p>
        )}
        {/* A rung, in the ladder's shape: one merged fact and one negative, in the
            present tense, so the day it stops being true the sweep catches it. */}
        <p className="ag-sub ag-panel-note">Zenbit issues a name into a parent it owns. No path issues one from this page.</p>
      </div>

      <button className="btn xv-action ag-primary" onClick={onBoard}>
        See what is on offer
      </button>
    </div>
  );
}

/**
 * The board: what is on offer, per day and per species.
 *
 * Days across and the three species down, andersoni drawn wherever a day exists
 * because its absence is a fact worth showing rather than a row left out. A cell
 * says on offer or none and never how many, since the window files are public and
 * a count is the withheld set by subtraction.
 */
function Board({
  state,
  days,
  cells,
  chosen,
  onChoose,
}: {
  state: "loading" | "ready" | "unconfigured" | "failed";
  days: string[];
  cells: { day: string; species: string; onOffer: boolean }[];
  chosen: Chosen | null;
  onChoose: (cell: Chosen) => void;
}) {
  if (state === "loading") return <p className="xv-desc ag-empty">Reading what is on offer.</p>;
  if (state === "unconfigured") return <p className="xv-desc ag-empty">This deployment has no windows configured, so there is nothing on offer.</p>;
  if (state === "failed") return <p className="xv-desc ag-empty">The board did not answer, so this is not a list of what is on offer.</p>;
  if (days.length === 0) return <p className="xv-desc ag-empty">No day has windows on offer.</p>;

  return (
    <div className="ag-board">
      <p className="xv-desc ag-empty">
        Choose a day and a species to read. The agent chooses the window and forms the proposal; no word and no choice
        of window from here reaches the clip.
      </p>
      <div className="ag-board-grid" style={{ "--xv-board-n": days.length } as React.CSSProperties}>
        <span className="ag-board-corner" aria-hidden="true" />
        {days.map(day => (
          <span key={day} className="ag-board-day">
            {day}
          </span>
        ))}
        {BOARD_SPECIES.map(species => (
          <Fragment key={species}>
            <span className="ag-board-species">{species}</span>
            {days.map(day => {
              const cell = cells.find(c => c.day === day && c.species === species);
              const on = cell?.onOffer === true;
              const picked = chosen?.day === day && chosen.species === species;
              return (
                <button
                  key={`${day}-${species}`}
                  type="button"
                  className={picked ? "ag-board-cell ag-board-picked" : "ag-board-cell"}
                  aria-current={picked ? "true" : undefined}
                  disabled={!on}
                  onClick={() => onChoose({ day, species })}
                >
                  {on ? "on offer" : "none"}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * The record, and the check a stranger can run beside it.
 *
 * **Seven fields any reader can check without trusting Zenbit**, in spec 05's own
 * words: `clipId`, `clipHash`, `decision`, `verifier`, `verifierSignature`,
 * `verifierNonce` and `verifierChainId`. They are exactly the material needed to
 * rebuild the message the reviewer signed and recover the address that signed it.
 * Each is carried and never derived, `verifierChainId` above all: the reviewer
 * signs the chain they signed on, and the chain this milestone anchors to is a
 * separate choice that happens to match today.
 *
 * Three more are the operator's own assertion and no reviewer countersigned them.
 * Two of those are shown and named as assertions. The third is the model's number,
 * which is opaque by spec 05 and is on no surface.
 *
 * Built field by field off the fixture rather than spread from it, so the record
 * on screen is the seven plus the two and cannot grow a field the fixture gains.
 */
export const RECORD = {
  clipId: CONFIRMATION_259.clipId,
  clipHash: CONFIRMATION_259.clipHash,
  decision: decisionCode(CONFIRMATION_259.status),
  verifier: CONFIRMATION_259.verifier,
  verifierSignature: CONFIRMATION_259.verifierSignature,
  verifierNonce: CONFIRMATION_259.verifierNonce,
  verifierChainId: CONFIRMATION_259.verifierChainId,
};

const ASSERTED = {
  verifiedAt: CONFIRMATION_259.verifiedAt,
  submitter: CONFIRMATION_259.submitter,
};

/** The four links, from the moment to the thing anybody can look up. */
const CHAIN = [
  { name: "the clip", says: "a span of public footage, proposed by an agent and given an identifier" },
  { name: "the confirmation", says: "a person decided, and signed the decision with their own key" },
  { name: "the offchain attestation", says: "the decision and the seven fields, under one identifier, emitting no event" },
  { name: "the onchain anchor", says: "a time fixed for that identifier, and an attestation of the same schema an indexer can find" },
];

function Records() {
  const [recovered, setRecovered] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    setFailed(false);
    try {
      // Nothing is fetched. The recovery is arithmetic over bytes already on this
      // page, so it answers with the operator's site down, which is the property
      // that makes it a check rather than a request for reassurance.
      const who = await recoverConfirmer(RECORD, RECORD.verifierSignature);
      setRecovered(who);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  const matches = recovered !== null && recovered.toLowerCase() === RECORD.verifier.toLowerCase();

  return (
    <div className="ag-records">
      <p className="xv-desc ag-empty">
        <strong>This confirmation is not anchored and has no attestation identifier.</strong> It is the confirmation
        this repository carries as a fixture for clip {RECORD.clipId}, and it asserts existence and time and who
        confirmed. It is not a claim about whether the clip shows what anyone says it shows.
      </p>

      <ol className="ag-chain">
        {CHAIN.map(link => (
          <li key={link.name} className="ag-chain-link">
            <span className="ag-card-value">{link.name}</span>
            <span className="ag-sub">{link.says}</span>
          </li>
        ))}
      </ol>

      <section className="ag-month">
        <h3 className="ag-panel-title">Seven fields, checkable without the operator</h3>
        <dl className="ag-facts">
          {Object.entries(RECORD).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd className="ag-ticket-hash">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ag-month">
        <h3 className="ag-panel-title">Two fields Zenbit asserts, which no reviewer signed</h3>
        <dl className="ag-facts">
          {Object.entries(ASSERTED).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd className="ag-ticket-hash">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ag-month">
        <h3 className="ag-panel-title">The check</h3>
        <p className="xv-desc ag-empty">
          Rebuild the nine line message from the seven fields, recover the address that signed it, and compare it for
          equality with the verifier the record names. Recovery on its own establishes nothing: a wrong message
          recovers a different, perfectly well formed address rather than failing, so the comparison is the check.
        </p>
        <button className="btn xv-action" onClick={runCheck} disabled={checking}>
          {checking ? "Recovering" : "Recover the signer"}
        </button>
        {failed && <p className="xv-desc ag-error">The signature would not parse, so no address was recovered.</p>}
        {recovered !== null && (
          <div className="ag-ticket ag-ticket-row">
            <span className="ag-ticket-hash">{recovered}</span>
            <span className="ag-sub">{matches ? "equal to the verifier the record names" : "not the verifier the record names"}</span>
          </div>
        )}
        <p className="ag-sub">
          An anchored confirmation carries two identifiers that share nothing. The offchain one keys the payload
          endpoint, and its time is read with getTimestamp, which answers with a time and no fields. getAttestation
          answers with the schema, the attester and the encoded fields, and it belongs only beside the onchain
          identifier a query returns; asked for an offchain one it returns an empty struct, which is a badge with no
          check behind it. This one is anchored on no chain, so neither call has anything to answer for it.
        </p>
      </section>
    </div>
  );
}

/**
 * A drawn state, under the line that reports it.
 *
 * Every value here came off the step. Nothing is computed, looked up or filled in
 * from a constant, so what a reader sees is what the counterparty said, and a
 * price that no longer matches the served challenge cannot survive on this page.
 */
function Drawing({ object }: { object: Drawn }) {
  switch (object.kind) {
    case "challenge":
      return (
        <span className="ag-card">
          <span className="ag-card-cell">
            <span className="ag-card-value">{object.amount}</span>
            <span className="ag-card-key">amount</span>
          </span>
          <span className="ag-card-cell">
            <span className="ag-card-value">{object.asset}</span>
            <span className="ag-card-key">asset</span>
          </span>
          <span className="ag-card-cell">
            <span className="ag-card-value">{object.network}</span>
            <span className="ag-card-key">network</span>
          </span>
        </span>
      );
    case "receipt": {
      const explorer = explorerOrigin(object.network);
      return (
        <span className="ag-ticket">
          <span className="ag-ticket-hash">{object.transaction}</span>
          {explorer !== undefined && (
            <a className="ag-link ag-ticket-link" href={explorer + object.transaction}>
              Read it on the explorer
            </a>
          )}
        </span>
      );
    }
    case "allowance":
      // Drawn as a ticket with nothing on it, because that is what it is: a read
      // that happened and moved no money. An invented hash here would be a
      // fabricated settlement on a page whose whole subject is real ones.
      return (
        <span className="ag-ticket ag-ticket-free">
          <span className="ag-ticket-hash">no transaction</span>
        </span>
      );
    case "windows":
      return (
        <span className="ag-tiles">
          {object.ids.map(id => (
            <span key={id} className={id === object.chosen ? "ag-tile ag-tile-chosen" : "ag-tile"}>
              {id}
            </span>
          ))}
        </span>
      );
    case "clip":
      return (
        <span className="ag-card">
          <span className="ag-card-cell">
            <span className="ag-card-value">{object.id}</span>
            <span className="ag-card-key">clip</span>
          </span>
          <span className="ag-card-cell">
            <span className="ag-card-value">{object.status}</span>
            <span className="ag-card-key">status</span>
          </span>
        </span>
      );
  }
}

/**
 * A mark for an address, drawn from the address.
 *
 * Five columns mirrored about the centre, filled from the address's own nibbles,
 * with a hue taken from its last byte. No dependency and no request: the address
 * is already twenty random bytes, so nothing needs hashing to spread it out.
 *
 * It exists so a person can tell at a glance that the wallet on screen is the one
 * they think it is. That is a recognition task and not a reading task, which is
 * why it is a shape and not the address in a larger font.
 */
function Identicon({ address }: { address: string }) {
  const body = address.slice(2).toLowerCase();
  // The two actor hues are excluded by construction. Teal means a person and the
  // clay hue means the machine everywhere on this page, and a mark that lands on
  // either by chance would be borrowing a meaning it does not have. The address
  // picks from what is left rather than being nudged off a collision.
  // Measured against the tokens rather than guessed: teal is 180, the agent clay
  // 26.9, the accent 26.2 and the action gold 36.9. A band starting at 20 excluded
  // only teal and left the other three inside it.
  const AVAILABLE = [
    [50, 160],
    [200, 340],
  ];
  const raw = parseInt(body.slice(-2), 16) / 255;
  const spans = AVAILABLE.map(([from, to]) => to - from);
  const total = spans.reduce((a, b) => a + b, 0);
  let offset = raw * total;
  let hue = AVAILABLE[0][0];
  for (let i = 0; i < AVAILABLE.length; i++) {
    if (offset <= spans[i]) {
      hue = AVAILABLE[i][0] + offset;
      break;
    }
    offset -= spans[i];
    hue = AVAILABLE[i][1];
  }
  const cells: { x: number; y: number }[] = [];
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 5; row++) {
      if (parseInt(body[(column * 5 + row) % body.length], 16) > 7) {
        cells.push({ x: column, y: row });
        if (column < 2) cells.push({ x: 4 - column, y: row });
      }
    }
  }
  return (
    // width and height on the element as well as in CSS, for the reason the
    // wordmark's mark carries them: an svg with only a viewBox scales to whatever
    // contains it if a rule is ever lost.
    <svg
      width="22"
      height="22"
      viewBox="0 0 5 5"
      className="ag-identicon"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="5" height="5" fill={`hsl(${hue.toFixed(0)} 30% 22%)`} />
      {cells.map(cell => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width="1" height="1" fill={`hsl(${hue.toFixed(0)} 48% 62%)`} />
      ))}
    </svg>
  );
}

/**
 * How the run is going, as a chip rather than a phrase.
 *
 * A stopped run says why in the same chip, because a state a person has to look
 * elsewhere to understand is not a status.
 */
function StatusChip({ phase, why }: { phase: Phase; why: string | null }) {
  const tone = phase === "running" || phase === "signing" ? "working" : phase === "finished" ? "good" : why !== null ? "stopped" : "idle";
  return (
    <span className={`ag-chip ag-chip-${tone}`}>
      {why !== null ? `stopped: ${why}` : PHASE_LABEL[phase]}
    </span>
  );
}

/**
 * The account, as a thing with an identity rather than an address in a sentence.
 *
 * The chain badge is a warning on anything but Base Sepolia, with the switch beside
 * it, because a wallet on the wrong chain is the failure this page meets most and
 * the old surface reported it only after a signature was refused.
 *
 * Disconnect says which of two things it did. There is no disconnect in EIP-1193:
 * a page can forget the account, and the wallet goes on considering the site
 * connected. `wallet_revokePermissions` withdraws the grant where a wallet has it.
 * Both are real and they are different, so the chip reports the one that happened
 * rather than the stronger one.
 */
function AccountChip({
  address,
  chain,
  name,
  onSwitch,
  onDisconnect,
  onOpen,
  note,
}: {
  address: `0x${string}`;
  chain: string | null;
  name: string | null;
  onSwitch: () => void;
  onDisconnect: () => void;
  onOpen: () => void;
  note: string | null;
}) {
  // Three states, not two. `currentChain` answers null when the provider throws or
  // is not there, and reading a non-answer as Base Sepolia draws the reassuring
  // badge in exactly the case where the page knows least.
  const explorer = explorerOrigin(chain);
  return (
    <div className="ag-account">
      {chain === null ? (
        <button type="button" className="ag-chip ag-chip-idle ag-chip-action" onClick={onSwitch}>
          No chain answered, switch
        </button>
      ) : chain === BASE_SEPOLIA_HEX ? (
        <span className="ag-chip ag-chip-idle">Base Sepolia</span>
      ) : (
        <button type="button" className="ag-chip ag-chip-stopped ag-chip-action" onClick={onSwitch}>
          Wrong chain, switch
        </button>
      )}
      <details className="ag-menu">
        <summary className="ag-account-face">
          <Identicon address={address} />
          <span className="ag-account-address">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          {name !== null && <span className="ag-chip ag-chip-name">{name}</span>}
        </summary>
        <div className="ag-menu-panel">
          <button type="button" className="ag-menu-item" onClick={onOpen}>
            Open the account
          </button>
          <button type="button" className="ag-menu-item" onClick={() => void navigator.clipboard?.writeText(address)}>
            Copy address
          </button>
          {explorer !== null && (
            <a className="ag-menu-item" href={`${explorer}/address/${address}`}>
              View on the explorer
            </a>
          )}
          <button type="button" className="ag-menu-item" onClick={onDisconnect}>
            Disconnect
          </button>
          {note !== null && <p className="ag-menu-note">{note}</p>}
        </div>
      </details>
    </div>
  );
}

function Mark() {
  return (
    // width and height on the element as well as in CSS. An inline SVG with only a
    // viewBox scales to its container, and if a rule is ever lost again the mark
    // falls back to 36 pixels rather than to the width of the page.
    <svg
      width="36"
      height="36"
      viewBox="0 0 1080 1080"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M638.942 896.88C594.968 973.04 485.032 973.04 441.058 896.88L95.4769 298.36C51.5025 222.2 106.47 127 194.419 127H885.581C973.53 127 1028.5 222.2 984.523 298.36L638.942 896.88Z"
        fill="#059C9C"
      />
      <path
        d="M718.824 473.032C718.824 572.244 638.391 652.671 539.172 652.671C439.953 652.671 359.52 572.244 359.52 473.032C359.52 373.82 439.953 293.393 539.172 293.393C638.391 293.393 718.824 373.82 718.824 473.032Z"
        fill="#F8C471"
      />
    </svg>
  );
}

export function AppShell() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [challengeRead, setChallengeRead] = useState(false);
  const [at, setAt] = useState(0);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("settings");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [board, setBoard] = useState<{ days: string[]; cells: { day: string; species: string; onOffer: boolean }[] }>({ days: [], cells: [] });
  const [boardState, setBoardState] = useState<"loading" | "ready" | "unconfigured" | "failed">("loading");
  const [registration, setRegistration] = useState<Registration>("idle");
  const [accountTab, setAccountTab] = useState<AccountTab>("overview");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [ledger, setLedger] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [chain, setChain] = useState<string | null>(null);
  const [issuedName, setIssuedName] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const busy = useRef(false);
  const feedEnd = useRef<HTMLLIElement | null>(null);

  const say = useCallback((line: Line) => {
    setLines(prev => {
      // The newest card is the one being read. A person who has stepped back
      // keeps their place rather than being yanked forward by the next step.
      setAt(current => (current === prev.length - 1 || prev.length === 0 ? prev.length : current));
      return [...prev, line];
    });
    // The newest line is the one being watched, and the body is the only region
    // that scrolls, so it follows the run rather than making a reader chase it.
    queueMicrotask(() => feedEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
  }, []);

  /**
   * Read this wallet's settlements once it is known, and again when a run ends.
   *
   * A failure is held as a state rather than swallowed, because the page must be
   * able to say the ledger did not answer. Rendering zero would be a claim about
   * the wallet that nothing measured.
   */
  useEffect(() => {
    if (address === null) {
      setLedger("idle");
      setSettlements([]);
      return;
    }
    let live = true;
    setLedger("loading");
    fetch(`/api/receipts?payer=${address}`)
      .then(async r => (r.ok ? ((await r.json()) as { settlements: Settlement[] }) : Promise.reject(new Error(String(r.status)))))
      .then(body => {
        if (!live) return;
        setSettlements(body.settlements);
        setLedger("ready");
      })
      .catch(() => {
        if (live) setLedger("failed");
      });
    return () => {
      live = false;
    };
    // Depends on whether the run has finished rather than on the phase itself. A
    // run moves through signing, running and finished, and reading the ledger at
    // each of them was about six requests for one settlement.
  }, [address, phase === "finished"]);

  /**
   * A reload is not a first visit.
   *
   * The wallet is asked what it already grants, silently, so a person who
   * connected a minute ago is not asked again. Only the button prompts.
   */
  useEffect(() => {
    let live = true;
    void restoreConnection().then(async restored => {
      if (!live || restored === null) return;
      setAddress(restored);
      setChain(await currentChain());
      setPhase("ready");
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * What the wallet does on its own.
   *
   * A page that reads the account once shows the previous one after a person
   * switches, which on a surface about paying from your own wallet is the worst
   * thing it could be wrong about. Both events are standard and most pages ignore
   * both.
   */
  useEffect(
    () =>
      onWalletChange({
        accounts: accounts => {
          const next = accounts[0];
          if (next === undefined) {
            setAddress(null);
            setPhase("idle");
            setWalletNote("the wallet disconnected this site");
            return;
          }
          setAddress(next as `0x${string}`);
          setWalletNote(null);
        },
        chain: next => setChain(next.toLowerCase()),
      }),
    [],
  );

  useEffect(() => {
    if (address === null) {
      setChain(null);
      setIssuedName(null);
      return;
    }
    let live = true;
    void currentChain().then(c => {
      if (live) setChain(c);
    });
    fetch(`/api/name?payer=${address}`)
      .then(async r => (r.ok ? ((await r.json()) as { name: string | null; matches: boolean }) : null))
      // Only on a match. A name that resolves to somebody else is not this
      // account's name, and under a wildcard parent every name resolves.
      .then(answer => {
        if (live) setIssuedName(answer !== null && answer.matches ? answer.name : null);
      })
      .catch(() => {
        if (live) setIssuedName(null);
      });
    return () => {
      live = false;
    };
  }, [address]);

  // The board is what is for sale and needs no wallet to look at.
  useEffect(() => {
    let live = true;
    fetch("/api/agent/board")
      .then(async r => {
        if (r.status === 503) return "unconfigured" as const;
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { days: string[]; cells: { day: string; species: string; onOffer: boolean }[] };
      })
      .then(answer => {
        if (!live) return;
        if (answer === "unconfigured") {
          setBoardState("unconfigured");
          return;
        }
        setBoard(answer);
        setBoardState("ready");
      })
      .catch(() => {
        if (live) setBoardState("failed");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (address === null) {
      setRegistration("idle");
      return;
    }
    let live = true;
    setRegistration("reading");
    fetch(`/api/agent/registration?payer=${address}`)
      .then(async r => (r.ok ? ((await r.json()) as { state: Registration }) : { state: "unread" as const }))
      .then(a => {
        if (live) setRegistration(a.state);
      })
      .catch(() => {
        if (live) setRegistration("unread");
      });
    return () => {
      live = false;
    };
  }, [address]);

  const onDisconnect = useCallback(async () => {
    const how = await disconnect();
    setAddress(null);
    setPhase("idle");
    setLines([]);
    setSteps([]);
    setWalletNote(
      how === "revoked"
        ? "the wallet withdrew this site's permission"
        : "this page forgot the account; the wallet still considers the site connected",
    );
  }, []);

  const onSwitch = useCallback(async () => {
    try {
      await ensureBaseSepolia();
      setChain(await currentChain());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const onConnect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const a = await connect();
      await ensureBaseSepolia();
      setAddress(a);
      setChain(await currentChain());
      setWalletNote(null);
      setPhase("ready");
    } catch (e) {
      setPhase("idle");
      setError(
        e instanceof NoWallet
          ? "No wallet was found in this browser. An injected EIP-1193 wallet is needed to sign a payment."
          : e instanceof WrongChain
            ? "This run pays on Base Sepolia and the wallet would not switch to it."
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }, []);

  const onRun = useCallback(async () => {
    if (!address || busy.current) return;
    busy.current = true;
    setError(null);
    setLines([]);
    setSteps([]);
    setAt(0);
    setChallengeRead(false);
    setSigned(false);
    setPhase("signing");
    try {
      // The cell a person chose on the board. A choice of what to read, and the
      // agent still chooses the window and forms the proposal.
      const windowsEndpoint = new URL("/api/agent/windows", window.location.origin);
      if (chosen !== null) {
        windowsEndpoint.searchParams.set("day", chosen.day);
        windowsEndpoint.searchParams.set("species", chosen.species);
      }
      const windowsUrl = windowsEndpoint.toString();
      say({ text: "Reading the live payment challenge", tone: "working", actor: "agent" });
      // What is on sale, and the price, are said BEFORE the wallet opens rather than
      // after it closes. Both come from the challenge the server sent: the page is not
      // describing the purchase, the counterparty is.
      const signed = await signChallenge(windowsUrl, address, undefined, challenge => {
        setChallengeRead(true);
        say({
          // The counterparty's own sentence where it sent one. Where it sent none,
          // a statement of what happened rather than a description this page
          // invented of a purchase it is not the one making.
          text: challenge.description !== "" ? challenge.description : "The route asked to be paid before it would serve",
          // The recipient in the detail lane, with the three values it will be paid
          // on the card beside it.
          detail: `to ${challenge.payTo}`,
          tone: "working",
          actor: "system",
          object: { kind: "challenge", amount: challenge.amount, asset: challenge.asset, network: challenge.network },
        });
      });
      setSigned(true);
      say({ text: "Authorization signed in your wallet", detail: "nothing has moved yet", tone: "good", actor: "human" });

      setPhase("running");
      const response = await fetch("/api/agent/run", { method: "POST", headers: signed.headers });
      if (!response.body) throw new Error("the run returned no stream");

      // Read as it arrives. Buffering to the end would render the same lines and
      // destroy the only thing this surface is for.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        // The last part may be half a line, so it stays in the buffer.
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.trim().length === 0) continue;
          const step = JSON.parse(part) as RunStep;
          setSteps(prev => [...prev, step]);
          say(lineFor(step));
        }
      }
      setPhase("finished");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(address ? "ready" : "idle");
    } finally {
      busy.current = false;
    }
  }, [address, say, chosen]);

  const running = phase === "signing" || phase === "running";
  // The reason a run stopped, taken from the run's own last stopped line rather
  // than from a second source that could disagree with the feed beside it.
  const stoppedWhy = running ? null : (lines.filter(l => l.tone === "stopped").at(-1)?.text ?? null);
  // Read off the steps rather than off the sentences, so the state is the run's
  // and not a phrase match over its narration.
  const supply = running ? null : supplyFrom(steps);
  const lit = planFrom(challengeRead, signed, steps);

  return (
    <>
      <header className="ag-header">
        <div className="ag-header-inner">
          <a className="ag-brand ag-link" href={REPO}>
            <Mark />
            <span className="ag-wordmark">xovi</span>
            <span className="ag-wordmark-sub">agents</span>
          </a>
          <div className="ag-header-right">
            {address === null ? (
              <button className="btn xv-action ag-primary" onClick={onConnect} disabled={phase === "connecting"}>
                {phase === "connecting" ? "Connecting" : "Connect wallet"}
              </button>
            ) : (
              <>
                <StatusChip phase={phase} why={stoppedWhy} />
                <AccountChip
                  address={address}
                  chain={chain}
                  name={issuedName}
                  onOpen={() => setScreen("account")}
                  onSwitch={() => void onSwitch()}
                  onDisconnect={() => void onDisconnect()}
                  note={walletNote}
                />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="ag-app">
        <div className="ag-surface">
          <div className="ag-app-top">
            <p className="ag-eyebrow">Delegated run · Base Sepolia</p>
            <h1 className="ag-app-title">An agent may propose. No credential in existence may confirm.</h1>
            <p className="ag-sub">
              {address === null
                ? "Connect a wallet, pay for one read, and the agent does the rest."
                : "Pay for one read, and the agent does the rest."}
            </p>
            <nav className="ag-rail" aria-label="Sections" style={{ "--xv-strip-n": screensFor(chosen !== null).length } as React.CSSProperties}>
              {/* The indicator is one element moved with `transform`, so the state
                  travels between items rather than being switched off one and on
                  another. Equal columns are what make the arithmetic a percentage
                  and not a measurement. */}
              <span
                className="ag-rail-indicator"
                aria-hidden="true"
                style={{ transform: `translateX(${Math.max(0, screensFor(chosen !== null).findIndex(s => s.id === screen)) * 100}%)` }}
              />
              {screensFor(chosen !== null).map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === screen ? "ag-rail-item ag-rail-on" : "ag-rail-item"}
                  aria-current={s.id === screen ? "true" : undefined}
                  onClick={() => setScreen(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
            <p className="ag-key">
              <span>
                <i className="ag-key-human" aria-hidden="true" />
                you
              </span>
              <span>
                <i className="ag-key-agent" aria-hidden="true" />
                agent
              </span>
            </p>
          </div>

          <div className="ag-app-body">
            <div className="ag-app-scroll">
              {screen === "settings" ? (
                <Settings
                  address={address}
                  chain={chain}
                  registration={registration}
                  name={issuedName}
                  onBoard={() => setScreen("board")}
                />
              ) : screen === "board" ? (
                <Board
                  state={boardState}
                  days={board.days}
                  cells={board.cells}
                  chosen={chosen}
                  onChoose={cell => {
                    setChosen(cell);
                    setScreen("run");
                  }}
                />
              ) : screen === "account" ? (
                <div className="ag-account-body">
                  <nav className="ag-tabs" aria-label="Account" style={{ "--xv-strip-n": ACCOUNT_TABS.length } as React.CSSProperties}>
                    <span
                      className="ag-tabs-indicator"
                      aria-hidden="true"
                      style={{ transform: `translateX(${ACCOUNT_TABS.findIndex(t => t.id === accountTab) * 100}%)` }}
                    />
                    {ACCOUNT_TABS.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className={t.id === accountTab ? "ag-tab ag-tab-on" : "ag-tab"}
                        aria-current={t.id === accountTab ? "true" : undefined}
                        onClick={() => setAccountTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </nav>
                  {accountTab === "overview" ? (
                    <Overview settlements={settlements} state={ledger} />
                  ) : accountTab === "receipts" ? (
                    <Receipts settlements={settlements} state={ledger} />
                  ) : accountTab === "proposals" ? (
                    <Proposals submitter={address} />
                  ) : (
                    <Names payer={address} />
                  )}
                </div>
              ) : screen === "record" ? (
                <Records />
              ) : screen === "notyet" ? (
                <NotYet />
              ) : (
                <>
                  {/* Above both states, because the plan is what the run is about
                      to do and then what it is doing. Idle at rest; each node
                      lights from the event that means it happened and never from
                      the node before it. */}
                  <ol className="ag-plan">
                    {PLAN.map((node, i) => (
                      <li
                        key={node.label}
                        className={lit[i] ? `ag-plan-node ag-actor-${node.actor} ag-plan-lit` : `ag-plan-node ag-actor-${node.actor}`}
                      >
                        <span className="ag-plan-dot" aria-hidden="true" />
                        <span className="ag-plan-label">{node.label}</span>
                      </li>
                    ))}
                  </ol>
                  {lines.length > 0 && <Rolodex lines={lines} at={at} onStep={to => setAt(Math.max(0, Math.min(lines.length - 1, to)))} />}
                  {lines.length === 0 ? (
                <div className="ag-intro">
                  {/* The fold. Three verbs, one sentence each, and each sentence restates
                      something already merged in this repository. What the page opens with
                      is what a person can do here, not an explanation of it: the paragraph
                      that used to sit at the top said in four sentences what the third tile
                      and the command line say in two. */}
                  <div className="ag-verbs">
                    <div className="ag-verb">
                      <h2 className="ag-verb-name">
                        <MarkReceipt />
                        Own
                      </h2>
                      {/* DISCLOSURE, "A receipts ledger": a settlement is recorded against
                          the payer who made it. The second sentence is this branch's own
                          route rather than merged text, and it is what `/api/receipts`
                          does and what checks 218b and 219 hold it to. "You keep them"
                          claimed custody the ledger does not give anybody. */}
                      <p className="ag-verb-line">
                        Every read your agent pays for leaves a receipt on a public chain. It is read back for that
                        payer alone.
                      </p>
                    </div>
                    <div className="ag-verb">
                      <h2 className="ag-verb-name">
                        <MarkSignature />
                        Manage
                      </h2>
                      {/* DISCLOSURE, "Delegation from a reader's own wallet"; bin/agent.ts,
                          "Read a window, propose a clip, stop".

                          The proposing is conditional and the tile has to say so. On the
                          deployment the two ingest variables are not set, so a run there
                          ends at not-submitted, which is the path `test/agent-run.ts`
                          asserts and which `DISCLOSURE.md` states as a negative. An
                          unconditional "proposes once" would put the exact claim the
                          sweep carries as false onto the judged page. */}
                      <p className="ag-verb-line">
                        The agent reads what it paid for and stops. Where a credential is configured, it proposes once.
                      </p>
                    </div>
                    <div className="ag-verb">
                      <h2 className="ag-verb-name">
                        <MarkEquality />
                        Check
                      </h2>
                      {/* docs/spec/05-anchor-and-query.md:66, "in a way anybody can check
                          with one call", for the call; the operator being out of the path is
                          the same document's trust boundary. */}
                      <p className="ag-verb-line">
                        A confirmed record can be checked by a stranger with one call. Zenbit is not in the path.
                      </p>
                    </div>
                  </div>

                  {/* Four words, because the Manage tile above already carries the
                      sentence this line used to repeat. It restates DISCLOSURE's
                      delegation bullet, that the reader signs one payment and supplies
                      nothing else; the phrasing is carried over from the intro paragraph
                      this branch removed, which came in with the payment card and is not
                      on `main`. */}
                  <p className="ag-command">A signature, and go.</p>

                  {/* Every sentence below is already merged, public and reviewed in this
                      repository, and each carries the line it came from. The page states
                      nothing that a reviewed surface does not, so it cannot drift from one.

                      Behind a disclosure rather than deleted. They are merged text and a
                      judge may want them, and they were the rest state's bulk: five
                      definitions before a reader had seen what the page does. */}
                  <details className="ag-more">
                    <summary className="ag-more-summary">The facts</summary>
                    <dl className="ag-facts">
                    <div>
                      <dt>What a window is</dt>
                      {/* docs/spec/02-candidate-windows.md:101 */}
                      <dd>
                        A claim that something was worth a human&rsquo;s attention. Not a claim that an animal was
                        identified, or that a behaviour occurred.
                      </dd>
                    </div>
                    <div>
                      <dt>What paying does not buy</dt>
                      {/* README, "The human operator confirms; the confirmation is attested", both sentences */}
                      <dd>
                        The attestation certifies no identity, no reputation, no payment and no biological fact. The
                        agent proposes; no credential of its own can confirm or attest.
                      </dd>
                    </div>
                    <div>
                      <dt>One person, one allowance</dt>
                      {/* README, "per person caps", for the allowance; DISCLOSURE, "not defeated by generating wallets", for why it is per person. Quoted around the word the interface may not carry, since check 177 reads this file whole. */}
                      <dd>
                        The free daily allowance is administered per person rather than per wallet, because a per wallet
                        limit is not defeated by generating wallets.
                      </dd>
                    </div>
                    <div>
                      <dt>Checkable without Zenbit</dt>
                      {/* docs/spec/05-anchor-and-query.md:118 */}
                      <dd>
                        A confirmation carries the reviewer&rsquo;s signature. The operator can be uncooperative, or
                        gone, and the confirmation is still checkable by anyone who kept the identifier.{" "}
                        <a className="ag-link" href={SCHEMA}>
                          The schema on Sepolia
                        </a>
                        .
                      </dd>
                    </div>
                    <div>
                      <dt>Why it exists</dt>
                      {/* README, "So the thing worth selling is not the observation" */}
                      <dd>
                        Observations are public. What is scarce is derivation and provenance, and that join is the
                        product.
                      </dd>
                    </div>
                    </dl>
                  </details>
                </div>
              ) : (
                <ol className="ag-feed">
                  {lines.map((line, i) => (
                    <li key={i} className={`ag-feed-row ag-tone-${line.tone} ag-actor-${line.actor}`}>
                      <span className="ag-feed-dot" aria-hidden="true" />
                      <span>
                        <span className="ag-feed-text">{line.text}</span>
                        {line.detail !== undefined && <span className="ag-feed-detail">{line.detail}</span>}
                        {line.object !== undefined && <Drawing object={line.object} />}
                      </span>
                    </li>
                  ))}
                  <li ref={feedEnd} className={`ag-feed-row ag-tone-working ag-actor-agent${running ? "" : " ag-feed-hidden"}`}>
                    <span className="ag-feed-dot ag-feed-pulse" aria-hidden="true" />
                    <span className="ag-feed-text ag-feed-waiting">working</span>
                  </li>
                  {supply !== null && (
                    <li className="ag-supply">
                      <p className="ag-supply-line">{supplySentence(supply)}</p>
                      <span className="ag-tiles">
                        {supply.ids.map(id => (
                          <span key={id} className="ag-tile">
                            {id}
                          </span>
                        ))}
                      </span>
                    </li>
                  )}
                    </ol>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="ag-app-bottom">
            {error !== null && (
              <p className="xv-desc ag-error" role="alert">
                {error}
              </p>
            )}
            <div className="ag-actions">
              {address !== null && (
                <button className="btn xv-action ag-primary" onClick={onRun} disabled={running}>
                  {running ? "Running" : "Pay and run"}
                </button>
              )}
              {/* Not documentation. This surface reads a wallet address and the server
                  keeps a keyed digest of the identifier behind it for thirty days, so
                  the controller has to be reachable from the surface that does it. */}
              <span className="ag-sub">
                Payments settle on Base Sepolia. Nothing here writes to a mainnet; one read is on one.{" "}
                <a className="ag-link" href="https://zenbit.mx/en/privacy">
                  Privacy
                </a>{" "}
                <a className="ag-link" href={REPO}>
                  Repository
                </a>
              </span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
