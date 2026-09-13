import { NextResponse } from "next/server";
import { http, createPublicClient, getAddress, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { ZERO_ADDRESS, matchesPayer, nameResolver } from "~~/lib/agent/name";
import { PARENT, storeFrom } from "~~/lib/agent/names-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}


/**
 * Whether the name Zenbit issues resolves to the wallet that is asking.
 *
 * **The chain is asked what chain it is before anything is read from it.** That is
 * #38's lesson and it is here rather than in `lib/agent/ens.ts` on purpose: the
 * library still does not check, issue #36 is open against exactly that, and it is
 * deliberately after the event. A route added tonight that skipped the check would
 * widen the issue instead of leaving it where it was found.
 *
 * The check is not ceremony. Under a wildcard parent every subname resolves, so a
 * name reads as issued on any chain that answers, and `viem` names the chain in the
 * client's own configuration rather than in the endpoint's answer. A resolver client
 * pointed at the wrong endpoint therefore reports a confident answer about a
 * different chain, which is the failure this repository has already met once.
 */
export async function GET(request: Request) {
  const payer = new URL(request.url).searchParams.get("payer");
  if (!payer) return refuse(400, "name a payer");
  if (!isAddress(payer)) return refuse(400, "that is not an address");

  /*
   * The table first, the configured name second.
   *
   * A wallet that asked for a name has a label of its own, and answering with the
   * configured name for it would tell that person about somebody else's name. The
   * fallback exists for the wallet that never asked: the founder's recording wallet
   * matches `agent1.xovi.eth` from the chain alone, with no row in the table, and
   * that path is unchanged by any of this.
   */
  const store = storeFrom();
  const row = store ? await store.byPayer(getAddress(payer)).catch(() => null) : null;

  const configured = (process.env.AGENT_IDENTITY_NAME ?? "").trim();
  const name = row ? `${row.label}.${PARENT}` : configured;

  // No row and no name configured is a real answer and not a failure: this wallet
  // has asked for nothing and this deployment claims no name, and the page states
  // the negative.
  if (!name) {
    return NextResponse.json({ state: "none", name: null, address: null, matches: false }, { headers: NO_STORE });
  }

  const client = createPublicClient({ chain: sepolia, transport: http(process.env.AGENT_ENS_RPC_URL || undefined) });

  const answered = await client.getChainId().catch(() => null);
  if (answered !== sepolia.id) {
    return refuse(503, `the name endpoint answered chain ${answered ?? "nothing"} and this route reads ${sepolia.id}`);
  }

  let address: string | null;
  try {
    const seam = nameResolver();
    address = seam ? await seam(name) : await client.getEnsAddress({ name });
  } catch {
    return refuse(503, "the name could not be resolved");
  }

  // A missing record and the zero address are the same answer under a wildcard
  // parent, where every subname resolves and an unissued name looks exactly like a
  // typo. Both are reported as no name issued rather than as an error.
  const issued = address !== null && address !== ZERO_ADDRESS;
  const matches = matchesPayer(address, payer);
  /*
   * THE STATE COMES FROM THE CHAIN AND NEVER FROM THE ROW.
   *
   * `issued` is drawn only when the address record equals the wallet asking. A row
   * carrying a transaction hash is evidence that an issuance was attempted, not that
   * the chain holds the record: the hash could belong to a reverted transaction, or
   * the record could have been changed since. Drawing issued from the table alone is
   * the mutation the checks are shaped to catch.
   *
   * So a row without a match reads `requested`, which is exactly right while the
   * founder has not run the issuer yet, and it is what the card shows a person who
   * has clicked and is waiting.
   */
  const state = matches ? "issued" : row ? "requested" : "none";

  /*
   * A NAME THIS WALLET HAS NO CLAIM ON IS NOT SERVED TO IT.
   *
   * `name` falls back to the configured one for a wallet with no row, which is what
   * lets the recording wallet match from the chain alone. For every other wallet
   * that fallback answered with somebody else's name and the address it resolves
   * to, alongside `matches: false`. Nothing about it was a secret, and it was still
   * this route telling a stranger which name a deployment claims and which wallet
   * holds it, which is the thing this file's own comment says it must not do.
   *
   * A wallet with a row keeps its label whatever the chain says, because that name
   * is its own and waiting for it is the state the card draws.
   */
  const ownsTheName = row !== null || matches;

  return NextResponse.json(
    {
      state,
      label: row ? row.label : null,
      requestedAt: row ? row.requestedAt : null,
      name: ownsTheName ? name : null,
      address: ownsTheName && issued ? getAddress(address as string) : null,
      // Issued and issued to this payer are two questions, and only the second may
      // draw the positive. Replacing this with `issued` is the mutation the checks
      // are shaped to catch, because under a wildcard parent every name is issued.
      matches,
    },
    { headers: NO_STORE },
  );
}

