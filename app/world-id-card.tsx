"use client";

import { useCallback, useState } from "react";
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { signEnrolment } from "~~/lib/agent/browser";

/**
 * Enrol with World ID, from the page.
 *
 * The person's wallet is the signal, and the wallet signs for itself first. The
 * request route answers a sentence built from the request's nonce; the wallet
 * signs it, which is what shows the person posting holds the address and not
 * only names it. The widget then asks World ID for a result bound to the
 * lowercased address, `handleVerify` posts the result and the signature to this
 * deployment, and the server recovers the signer, forwards the result to World's
 * verifier, checks the binding and records a keyed digest of the identifier the
 * verifier answers with. This component decides only what to say at each step;
 * nothing here verifies anything and nothing here sees the identifier.
 *
 * FIVE STATES, IN WORDS RATHER THAN A SPINNER: idle, opening, verifying,
 * registered, refused. Refused carries the server's own sentence, since the
 * server is the party that knows why, and the sentences are fixed so a person
 * can search for them.
 *
 * NO LEGACY RESULTS. `allow_legacy_proofs` is false so the widget asks only for a
 * version 4 result, and the server refuses a 3.0 one anyway: a 3.0 nullifier is a
 * different value for the same person, and admitting both would let one person
 * enrol two wallets.
 *
 * THE THREE PUBLIC VALUES ARE READ HERE AND ON THE SERVER, from the same three
 * variables, so the action the server signs is the action the widget sends and
 * the environment the widget opens in is the one a result is checked against.
 * The signing key is not among them and this file does not name it.
 *
 * The shell owns the card, its title and its pill; this renders the sentence, the
 * one control and the widget, and calls `onRegistered` once the server has said
 * yes so the shell can read the registration again.
 */
export type WorldIdState = "idle" | "opening" | "verifying" | "registered" | "refused";

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "";
const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "";
const ENVIRONMENT = process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT ?? "";

/** What the page keeps, said before the person acts and in the same words every time. */
export const KEEPS_SENTENCE =
  "What Zenbit keeps is a keyed digest of your World ID identifier, for thirty days, to count free reads; never the identifier.";

function configured(): { app_id: `app_${string}`; action: string; environment: "staging" | "production" } | null {
  if (!APP_ID.startsWith("app_") || !ACTION) return null;
  if (ENVIRONMENT !== "staging" && ENVIRONMENT !== "production") return null;
  return { app_id: APP_ID as `app_${string}`, action: ACTION, environment: ENVIRONMENT };
}

export function WorldIdCard({ payer, onRegistered }: { payer: `0x${string}` | null; onRegistered: () => void }) {
  const [state, setState] = useState<WorldIdState>("idle");
  const [why, setWhy] = useState<string | null>(null);
  const [context, setContext] = useState<RpContext | null>(null);
  const [signature, setSignature] = useState<`0x${string}` | null>(null);
  const [open, setOpen] = useState(false);
  const config = configured();

  const refuse = useCallback((sentence: string) => {
    setState("refused");
    setWhy(sentence);
    setOpen(false);
  }, []);

  /** Ask this deployment for the signed context, have the wallet sign the
   *  sentence that came with it, then open the widget with the rest. */
  const begin = useCallback(async () => {
    if (payer === null || !config) return;
    setState("opening");
    setWhy(null);
    let answer: Response;
    try {
      answer = await fetch(`/api/agent/registration/request?payer=${payer}`);
    } catch {
      refuse("This deployment did not answer.");
      return;
    }
    if (answer.status === 429) {
      refuse("Too many attempts from this wallet. Wait a minute and try again.");
      return;
    }
    if (answer.status === 503) {
      refuse("Enrollment is not configured on this deployment.");
      return;
    }
    if (!answer.ok) {
      refuse("This deployment refused to open a request.");
      return;
    }
    const { message, ...rpContext } = (await answer.json()) as RpContext & { message: string };
    let signed: `0x${string}`;
    try {
      signed = await signEnrolment(payer, message);
    } catch {
      refuse("The wallet did not sign. Nothing was sent.");
      return;
    }
    setSignature(signed);
    setContext(rpContext);
    setOpen(true);
  }, [payer, config, refuse]);

  /** The result goes to this deployment and nowhere else. A refusal here is the
   *  server's sentence, thrown so the widget shows its error state too. */
  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      setState("verifying");
      const answer = await fetch("/api/agent/registration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payer, result, signature }),
      });
      if (!answer.ok) {
        const sentence = ((await answer.json().catch(() => ({}))) as { error?: string }).error ?? "This deployment refused the result.";
        refuse(sentence);
        throw new Error(sentence);
      }
    },
    [payer, signature, refuse],
  );

  const sentence =
    payer === null
      ? "Connect a wallet first. The result is bound to its address."
      : !config
        ? "Enrollment is not configured on this deployment."
        : state === "idle"
          ? `Verify with World ID from this page. ${KEEPS_SENTENCE}`
          : state === "opening"
            ? "Sign with the wallet, then World ID opens."
            : state === "verifying"
              ? "Checking the result with World's verifier."
              : state === "registered"
                ? "Registered by World ID. Free reads count against the person behind it, not against the wallet, so a second wallet does not get a second allowance."
                : (why ?? "Refused.");

  return (
    <>
      <p className="ag-sub">{sentence}</p>

      {/* ONE control, only where it can do something: a wallet, a configured
          deployment, and a state a person can act from. */}
      {payer !== null && config && (state === "idle" || state === "refused") && (
        <button type="button" className="btn xv-action ag-setup-do" onClick={() => void begin()}>
          {state === "refused" ? "Try again with World ID" : "Verify with World ID"}
        </button>
      )}

      {payer !== null && config && context !== null && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={next => {
            setOpen(next);
            // Closed without a result: back to the start rather than stuck on opening.
            if (!next && state === "opening") setState("idle");
          }}
          app_id={config.app_id}
          action={config.action}
          rp_context={context}
          environment={config.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: payer.toLowerCase() })}
          handleVerify={handleVerify}
          onSuccess={() => {
            setState("registered");
            setWhy(null);
            onRegistered();
          }}
          onError={code => {
            // `failed_by_host_app` is the server's refusal, already worded above.
            if (code === "failed_by_host_app") return;
            refuse(code === "cancelled" ? "Cancelled." : `World ID did not complete (${code}).`);
          }}
        />
      )}
    </>
  );
}
