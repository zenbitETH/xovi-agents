import { NextResponse } from "next/server";
import { http, createPublicClient, getAddress, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { ZERO_ADDRESS, matchesPayer, nameResolver } from "~~/lib/agent/name";

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

  const name = (process.env.AGENT_IDENTITY_NAME ?? "").trim();
  // No name configured is a real answer and not a failure: this deployment claims
  // no name, and the page states the negative.
  if (!name) return NextResponse.json({ name: null, address: null, matches: false }, { headers: NO_STORE });

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
  return NextResponse.json(
    {
      name,
      address: issued ? getAddress(address as string) : null,
      // Issued and issued to this payer are two questions, and only the second may
      // draw the positive. Replacing this with `issued` is the mutation the checks
      // are shaped to catch, because under a wildcard parent every name is issued.
      matches: matchesPayer(address, payer),
    },
    { headers: NO_STORE },
  );
}

