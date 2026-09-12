"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NoWallet, WrongChain, connect, ensureBaseSepolia, signChallenge } from "~~/lib/agent/browser";
import type { RunStep } from "~~/lib/agent/run";

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
const EXPLORER: Record<string, string> = { "eip155:84532": "https://sepolia.basescan.org/tx/" };

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
  tone: "working" | "good" | "stopped";
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
      return {
        text: "Nothing served could become a proposal",
        detail: `${step.considered} window${step.considered === 1 ? "" : "s"} considered`,
        tone: "stopped",
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
        tone: "stopped",
        // A rejection is the one refusal that is a person's judgement rather than
        // a machine's answer: someone looked at this window and said no. It is
        // marked as their activity, which is the whole point of the two hues.
        actor: step.kind === "rejected" ? "human" : "agent",
      };
    case "not-submitted":
      return { text: "Stopped before submitting", detail: step.detail, tone: "stopped", actor: "agent" };
    case "done":
      return { text: "Run finished", tone: "good", actor: "system" };
  }
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
 * The screens that exist. A screen is added here the day it is built, so a rail
 * item never leads anywhere empty: the cut removes a section from the page rather
 * than hiding it behind a tab that opens on nothing.
 */
type Screen = "runs" | "overview" | "receipts";

const SCREENS: { id: Screen; label: string }[] = [
  { id: "runs", label: "Runs" },
  { id: "overview", label: "Overview" },
  { id: "receipts", label: "Receipts" },
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

function totalOnBaseSepolia(settlements: Settlement[]): { total: string; counted: number; elsewhere: number } {
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
 * Six cards and not the design's seven: the seventh counted agents, and the scope
 * is one agent, the connected wallet. Three of the design's numbers are absent
 * rather than estimated. A free read writes no receipt and the route serves no
 * allowance count, so that card carries the sentence and no number. Proposals and
 * what people decided about them are served by a route that is not built yet, so
 * those cards are not on the page at all.
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
                {EXPLORER[s.network] !== undefined && (
                  <a className="ag-link ag-ticket-link" href={EXPLORER[s.network] + s.txHash}>
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
      const explorer = EXPLORER[object.network];
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
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("runs");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [ledger, setLedger] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const busy = useRef(false);
  const feedEnd = useRef<HTMLLIElement | null>(null);

  const say = useCallback((line: Line) => {
    setLines(prev => [...prev, line]);
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
  }, [address, phase]);

  const onConnect = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      const a = await connect();
      await ensureBaseSepolia();
      setAddress(a);
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
    setPhase("signing");
    try {
      const windowsUrl = new URL("/api/agent/windows", window.location.origin).toString();
      say({ text: "Reading the live payment challenge", tone: "working", actor: "agent" });
      // What is on sale, and the price, are said BEFORE the wallet opens rather than
      // after it closes. Both come from the challenge the server sent: the page is not
      // describing the purchase, the counterparty is.
      const signed = await signChallenge(windowsUrl, address, undefined, challenge => {
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
          say(lineFor(JSON.parse(part) as RunStep));
        }
      }
      setPhase("finished");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase(address ? "ready" : "idle");
    } finally {
      busy.current = false;
    }
  }, [address, say]);

  const running = phase === "signing" || phase === "running";

  return (
    <>
      <header className="ag-header">
        <div className="ag-header-inner">
          <a className="ag-brand ag-link" href={REPO}>
            <Mark />
            <span className="ag-wordmark">xovi</span>
            <span className="ag-wordmark-sub">agents</span>
          </a>
          <a className="ag-link ag-sub" href={REPO}>
            Repository
          </a>
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
                : `${address.slice(0, 6)}…${address.slice(-4)} · ${PHASE_LABEL[phase]}`}
            </p>
            <nav className="ag-rail" aria-label="Sections">
              {SCREENS.map(s => (
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
              {screen === "overview" ? (
                <Overview settlements={settlements} state={ledger} />
              ) : screen === "receipts" ? (
                <Receipts settlements={settlements} state={ledger} />
              ) : lines.length === 0 ? (
                <div className="ag-intro">
                  <p className="xv-desc ag-empty">
                    You pay for one read from your own wallet and the agent does the rest. It reads the window it paid
                    for, chooses one, forms a proposal and submits it. You choose nothing that reaches the record: a
                    signature, and go. Every step it takes appears here as it happens.
                  </p>

                  {/* Every sentence below is already merged, public and reviewed in this
                      repository, and each carries the line it came from. The page states
                      nothing that a reviewed surface does not, so it cannot drift from one. */}
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
                </ol>
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
              {address === null ? (
                <button className="btn xv-action" onClick={onConnect} disabled={phase === "connecting"}>
                  {phase === "connecting" ? "Connecting" : "Connect wallet"}
                </button>
              ) : (
                <button className="btn xv-action" onClick={onRun} disabled={running}>
                  {running ? "Running" : "Pay and run"}
                </button>
              )}
              {/* Not documentation. This surface reads a wallet address and the server
                  keeps a keyed digest of the identifier behind it for thirty days, so
                  the controller has to be reachable from the surface that does it. */}
              <span className="ag-sub">
                Payments settle on Base Sepolia. Nothing touches mainnet.{" "}
                <a className="ag-link" href="https://zenbit.mx/en/privacy">
                  Privacy
                </a>
              </span>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
