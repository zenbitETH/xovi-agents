"use client";

/**
 * The name card: ask for a name, wait for it, have it.
 *
 * THREE STATES AND THEY ARE NOT TWO. Not requested, requested, issued. The middle one
 * is the whole reason this card changed: the resolver under `xovi.eth` admits no
 * approved operator, measured, so no server can write the record and a request cannot
 * become a name in the same breath. Collapsing requested into either neighbour would
 * lie in one direction or the other, telling somebody nothing has happened when their
 * row exists, or that they have a name when the chain holds nothing.
 *
 * ISSUED IS DRAWN FROM THE CHAIN AND NEVER FROM THE ROW. The `name` prop is non-null
 * only when the read route matched the address record against this wallet by equality.
 * Under a wildcard parent EVERY subname resolves, so "the name resolves" is true of
 * every label there will ever be and is worth nothing; only "it resolves to you" is a
 * fact about this person. A card that drew issued from a row carrying a transaction
 * hash would show a name for a reverted transaction, and that is the mutation the
 * checks are shaped to catch.
 *
 * NO VERIFIED BADGE, AND NO BADGE OF ANY KIND THAT ASSERTS A PERSON. The card says
 * what happened to a record, which is all it knows: a name was asked for, or a name
 * resolves here. It says nothing about who anybody is.
 *
 * NO SPINNER. While the request is in flight the control says what it is doing in
 * words, because a spinner is a claim that something is happening with nothing behind
 * it, and this repository already writes its run as a log with actors rather than as a
 * turning shape.
 *
 * WHO DOES WHAT IS SAID OUT LOUD. The person's step is the request; Zenbit's is the
 * issuance. The card says "issued by Zenbit" in words rather than leaving a reader to
 * wonder why the name has not appeared, because the wait is somebody else's work and
 * not a fault.
 *
 * The shell owns the list, its `cls` and its `pill`, so those arrive as props. This
 * file decides only what the card says and when.
 */
export type NameState = "none" | "requested" | "issued";

export function NameCard({
  state,
  name,
  label,
  pill,
  canRequest,
  requesting,
  error,
  onRequest,
  className,
  pillClassName,
}: {
  state: NameState;
  /** Non-null ONLY when the record resolves to this wallet. Never from the table. */
  name: string | null;
  /** The assigned label, known once a row exists, before the chain has anything. */
  label: string | null;
  /** The word in the pill. It comes from the checklist rather than from here: this
   *  card knows its own three states and not that the step before it is unfinished,
   *  and `waiting` is the honest word while a person has nothing to press yet. */
  pill: string;
  /** Whether a person stands behind this wallet, by either source. */
  canRequest: boolean;
  requesting: boolean;
  error: string | null;
  onRequest: () => void;
  className: string;
  pillClassName: string;
}) {
  return (
    <li className={className}>
      <h3 className="ag-panel-title">A name</h3>
      <span className={pillClassName}>{pill}</span>

      {state === "issued" && name !== null && (
        <>
          <p className="ag-setup-name">{name}</p>
          <p className="ag-account-address">resolves to this payer</p>
        </>
      )}

      {state === "requested" && (
        <>
          {label !== null && <p className="ag-setup-name">{label}.xovi.eth</p>}
          <p className="ag-sub">
            Requested. Zenbit issues the name from the parent it owns, and this card shows it once the
            record resolves to this payer.
          </p>
        </>
      )}

      {state === "none" && (
        <p className="ag-sub">
          {/* NOT "ask for one and Zenbit issues it". That reads as a promise that the
              request produces a name, and it does not: issuance is the founder running
              the script by hand, with his own key, when he chooses. The reviewer's
              wording is used verbatim rather than paraphrased, because the thing being
              corrected is exactly a paraphrase that drifted into a commitment. */}
          {canRequest
            ? "A name is issued into a parent Zenbit owns, from this request and resolved through Zenbit's gateway, without a transaction."
            : "A name is issued into a parent Zenbit owns, to a wallet with a person behind it."}
        </p>
      )}

      {/* ONE control, and it exists only where it can do something. A disabled button
          for a wallet that cannot ask is a dead end wearing the shape of an action. */}
      {state === "none" && canRequest && (
        <button type="button" className="btn xv-action ag-setup-do" onClick={onRequest} disabled={requesting}>
          {requesting ? "Asking Zenbit for a name" : "Get a name"}
        </button>
      )}

      {error !== null && <p className="ag-sub">{error}</p>}
    </li>
  );
}
