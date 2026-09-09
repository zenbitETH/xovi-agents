"use client";

import { useCallback, useRef, useState } from "react";
import { NoWallet, WrongChain, connect, ensureBaseSepolia, signChallenge } from "~~/lib/agent/browser";
import type { RunStep } from "~~/lib/agent/run";

const REPO = "https://github.com/zenbitETH/xovi-agents";

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
 * colour: teal for the person, gold for the agent. This feed is the one surface
 * in the project showing both interleaved, which is the thing the app exists to
 * make legible, and it reads as a story only if the two are told apart at a
 * glance rather than by reading.
 *
 * `tone` says how the run is going, and it never uses teal, so teal in this feed
 * means a person and nothing else.
 *
 * Gold is not one of the two. It means "this control is active" (globals.css:570)
 * and stays on the toolbar button, so the button and the markers cannot be read
 * as the same signal. The agent's colour is its own token, measured at 4.13
 * against the surface it actually sits on, which marks and never letters.
 */
export type Actor = "human" | "agent" | "system";
export type Line = { text: string; detail?: string; tone: "working" | "good" | "stopped"; actor: Actor };

export function lineFor(step: RunStep): Line {
  switch (step.step) {
    case "presenting":
      return { text: "Presenting the signed authorization", tone: "working", actor: "agent" };
    case "payment-refused":
      return { text: "The paid route refused the payment", detail: step.detail, tone: "stopped", actor: "agent" };
    case "unavailable":
      return { text: "The route cannot serve right now", detail: step.detail, tone: "stopped", actor: "agent" };
    case "paid":
      return step.free
        ? { text: "Served under the free daily allowance", detail: "nothing was charged for this read", tone: "good", actor: "agent" }
        : {
            text: "Payment settled",
            detail: step.transaction ? `${step.transaction} on ${step.network}` : "settled without a receipt",
            tone: "good",
            actor: "agent",
          };
    case "read":
      return { text: `Read ${step.served} candidate window${step.served === 1 ? "" : "s"}`, tone: "working", actor: "agent" };
    case "selected":
      return {
        text: `Chose window ${step.windowId}`,
        detail: `${step.durationSeconds}s of stream, confidence ${step.confidence}`,
        tone: "working",
        actor: "agent",
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
      return { text: `Proposed as clip ${step.id}`, detail: `status ${step.status}`, tone: "good", actor: "agent" };
    case "declined":
      return {
        text: `The proposal was declined: ${step.kind}`,
        detail: step.status === undefined ? step.detail : `${step.detail} (HTTP ${step.status})`,
        tone: "stopped",
        // A rejection is the one refusal that is a person's judgement rather than
        // a machine's answer: someone looked at this window and said no. It is
        // marked as their activity, which is the whole point of the two colours.
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

function Mark() {
  return (
    <svg viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
  const busy = useRef(false);
  const feedEnd = useRef<HTMLLIElement | null>(null);

  const say = useCallback((line: Line) => {
    setLines(prev => [...prev, line]);
    // The newest line is the one being watched, and the body is the only region
    // that scrolls, so it follows the run rather than making a reader chase it.
    queueMicrotask(() => feedEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
  }, []);

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
      const signed = await signChallenge(windowsUrl, address);
      say({ text: `The server asks ${signed.amount}`, detail: `to ${signed.payTo} on ${signed.network}`, tone: "working", actor: "agent" });
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
              {lines.length === 0 ? (
                <p className="xv-desc ag-empty">
                  You pay for one read from your own wallet and the agent does the rest. It reads the window it paid for,
                  chooses one, forms a proposal and submits it. You choose nothing that reaches the record: a signature,
                  and go. Every step it takes appears here as it happens.
                </p>
              ) : (
                <ol className="ag-feed">
                  {lines.map((line, i) => (
                    <li key={i} className={`ag-feed-row ag-tone-${line.tone} ag-actor-${line.actor}`}>
                      <span className="ag-feed-dot" aria-hidden="true" />
                      <span>
                        <span className="ag-feed-text">{line.text}</span>
                        {line.detail !== undefined && <span className="ag-feed-detail">{line.detail}</span>}
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
