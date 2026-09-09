"use client";

import { useCallback, useRef, useState } from "react";
import { NoWallet, WrongChain, connect, ensureBaseSepolia, signChallenge } from "~~/lib/agent/browser";
import type { RunStep } from "~~/lib/agent/run";

/**
 * One line of a run, as a person reads it.
 *
 * The wire steps are a discriminated union and this is the only place that turns
 * them into sentences, so a new step cannot reach the screen as a raw tag: the
 * switch is exhaustive and the compiler says so.
 */
type Line = { text: string; detail?: string; tone: "working" | "good" | "stopped" };

function lineFor(step: RunStep): Line {
  switch (step.step) {
    case "presenting":
      return { text: "Presenting the signed authorization", tone: "working" };
    case "payment-refused":
      return { text: "The paid route refused the payment", detail: step.detail, tone: "stopped" };
    case "unavailable":
      return { text: "The route cannot serve right now", detail: step.detail, tone: "stopped" };
    case "paid":
      return step.free
        ? { text: "Served under the free daily allowance", detail: "nothing was charged for this read", tone: "good" }
        : {
            text: "Payment settled",
            detail: step.transaction ? `${step.transaction} on ${step.network}` : "settled without a receipt",
            tone: "good",
          };
    case "read":
      return { text: `Read ${step.served} candidate window${step.served === 1 ? "" : "s"}`, tone: "working" };
    case "selected":
      return {
        text: `Chose window ${step.windowId}`,
        detail: `${step.endTime - step.startTime}s of stream, confidence ${step.confidence}`,
        tone: "working",
      };
    case "nothing-proposable":
      return { text: "Nothing served could become a proposal", detail: step.reasons[0], tone: "stopped" };
    case "proposing":
      return { text: "Submitting the proposal", tone: "working" };
    case "proposed":
      return { text: `Proposed as clip ${step.id}`, detail: `status ${step.status}`, tone: "good" };
    case "declined":
      return { text: `The ingest route declined: ${step.kind}`, detail: step.detail, tone: "stopped" };
    case "not-submitted":
      return { text: "Stopped before submitting", detail: step.detail, tone: "stopped" };
    case "done":
      return { text: "Run finished", tone: "good" };
  }
}

type Phase = "idle" | "connecting" | "ready" | "signing" | "running" | "finished";

export function RunPanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const say = useCallback((line: Line) => setLines(prev => [...prev, line]), []);

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
      say({ text: "Reading the live payment challenge", tone: "working" });
      const signed = await signChallenge(windowsUrl, address);
      say({
        text: `The server asks ${signed.amount}`,
        detail: `to ${signed.payTo} on ${signed.network}`,
        tone: "working",
      });
      say({ text: "Authorization signed in your wallet", detail: "nothing has moved yet", tone: "good" });

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
    <section className="ag-section xv-clay ag-card">
      <h2>Run the agent</h2>
      <p className="xv-desc" style={{ fontSize: "0.875rem" }}>
        You pay for one read from your own wallet and the agent does the rest. It reads the window it paid for, chooses one,
        forms a proposal and submits it. You choose nothing that reaches the record: a signature, and go.
      </p>

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
        {address !== null && (
          <span className="ag-mono ag-addr" title={address}>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        )}
      </div>

      {error !== null && (
        <p className="xv-desc ag-error" role="alert">
          {error}
        </p>
      )}

      {lines.length > 0 && (
        <ol className="ag-feed">
          {lines.map((line, i) => (
            <li key={i} className={`ag-feed-row ag-tone-${line.tone}`}>
              <span className="ag-feed-dot" aria-hidden="true" />
              <span>
                <span className="ag-feed-text">{line.text}</span>
                {line.detail !== undefined && <span className="ag-feed-detail">{line.detail}</span>}
              </span>
            </li>
          ))}
          {running && (
            <li className="ag-feed-row ag-tone-working ag-feed-pending">
              <span className="ag-feed-dot" aria-hidden="true" />
              <span className="ag-feed-text">working</span>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
