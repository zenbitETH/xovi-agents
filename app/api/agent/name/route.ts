import { NextResponse } from "next/server";
import { http, createPublicClient, getAddress, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { ZERO_ADDRESS, nameResolver } from "~~/lib/agent/name";
import { PARENT, storeFrom } from "~~/lib/agent/names-store";
import { enrolledSeam } from "~~/lib/agent/enrolled";
import { UNREGISTERED, registryFrom } from "~~/lib/human/registry";
import { now } from "~~/lib/human/clock";
import { enrollmentThrottle } from "~~/lib/human/throttle";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Ask for a name. This route NEVER issues one.
 *
 * **It cannot, and that is a measurement rather than a policy.** The per account
 * resolver that answers for `xovi.eth` and every subname implements neither of ENS's
 * approval mechanisms: `isApprovedForAll` and `isApprovedFor` both revert on it. So
 * there is nobody the owner could approve and no key a server could legitimately
 * hold. `setAddr` simulated from the owner succeeds and from any other address
 * reverts. Issuance is therefore the owner's own transaction, made by
 * `bin/issue-names.ts` on the founder's machine, and this route writes a row and
 * stops.
 *
 * That shape is also what keeps a judge moving. The person's step is the request and
 * Zenbit's is the issuance, so the card completes when the row is written rather than
 * when the chain catches up, and nobody is held at a step only Zenbit can clear.
 *
 * A REGISTRATION IS REQUIRED AND EITHER SOURCE COUNTS. AgentBook is one; an
 * enrolment made through the page is the other. Both answer the same question, which
 * is whether a person stands behind this wallet, and the route asks that question
 * rather than asking how it was answered.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "send a json body");
  }
  const payer = (body as { payer?: unknown })?.payer;
  if (typeof payer !== "string" || !payer) return refuse(400, "name a payer");
  if (!isAddress(payer)) return refuse(400, "that is not an address");
  const wallet = getAddress(payer);

  /*
   * The same per wallet cap the two registration routes take.
   *
   * This route was unauthenticated and uncapped: a new address cost a registry read
   * and two chain reads before its refusal, which is work a stranger could ask for
   * as fast as they could open connections. It shares the enrolment's limiter rather
   * than keeping its own, so one wallet has one budget across the three routes that
   * answer questions about it.
   */
  const taken = enrollmentThrottle.take(wallet.toLowerCase(), now());
  if (!taken.ok) return refuse(429, "too many requests for this wallet; wait a moment", { "Retry-After": String(taken.retryAfterSeconds) });

  const store = storeFrom();
  // No database is not a quiet no-op here. A request that cannot be recorded is a
  // request nobody will ever act on, and answering as though it were taken would
  // promise a name that no issuer will ever see.
  if (!store) return refuse(503, "no store is configured, so a request cannot be recorded");

  // Already asked. Answered before any chain read, so clicking twice costs nothing
  // and always returns the same label.
  const existing = await store.byPayer(wallet);
  if (existing) {
    return NextResponse.json(
      { state: existing.txHash ? "issued" : "requested", label: existing.label, name: `${existing.label}.${PARENT}` },
      { headers: NO_STORE },
    );
  }

  /*
   * The gate. Registered with AgentBook, or enrolled through the page. `unread` is
   * neither: the chain failing to answer is a fact about the read, and refusing on it
   * would tell somebody to go and register when they already have.
   */
  let registered = false;
  try {
    registered = (await registryFrom()(wallet)) !== UNREGISTERED;
  } catch {
    return refuse(503, "the registry did not answer, so this is not a decision about the wallet");
  }
  if (!registered) {
    registered = await enrolledSeam()(wallet);
  }
  if (!registered) return refuse(403, "a name is issued to a wallet with a person behind it");

  const client = createPublicClient({ chain: sepolia, transport: http(process.env.AGENT_ENS_RPC_URL || undefined) });
  // The chain says which chain it is before anything is read from it, for the reason
  // the read route gives: under a wildcard parent every name resolves, so a client
  // pointed at the wrong endpoint reports a confident answer about another chain.
  const answered = await client.getChainId().catch(() => null);
  if (answered !== sepolia.id) {
    return refuse(503, `the name endpoint answered chain ${answered ?? "nothing"} and this route reads ${sepolia.id}`);
  }

  const seam = nameResolver();
  const resolve = seam ?? ((name: string) => client.getEnsAddress({ name }));

  /*
   * Assign, then CHECK THE ASSIGNMENT AGAINST THE CHAIN.
   *
   * The sequence guarantees the number was never handed out by this scheme, which is
   * not the same as the name being free: `agent1` was issued by hand before this table
   * existed and another could be. So each candidate is resolved, and a label that
   * already holds an address record is abandoned and the next one taken. Abandoning
   * costs a number and nothing else; issuing over a record that exists would move
   * somebody's name.
   *
   * The check keys on the ADDRESS RECORD, never on the resolver: under this wildcard
   * parent every subname has a resolver, so a resolver-shaped test would find every
   * label taken and this loop would never terminate.
   *
   * Bounded, because a loop that retries for ever turns a contended insert into a hung
   * request. The unique index on `label` is the backstop under the sequence.
   */
  for (let attempt = 0; attempt < 4; attempt++) {
    let assigned;
    try {
      assigned = await store.requestLabel(wallet);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!/names_label_unq|unique/i.test(message)) throw err;
      continue;
    }

    let taken: string | null;
    try {
      taken = await resolve(`${assigned.label}.${PARENT}`);
    } catch {
      return refuse(503, "the parent could not be read, so the label could not be checked");
    }
    if (taken !== null && taken !== ZERO_ADDRESS && taken.toLowerCase() !== wallet.toLowerCase()) {
      // Issued by hand to somebody else. Take the next number rather than this one.
      await store.release(assigned.label).catch(() => undefined);
      continue;
    }

    return NextResponse.json(
      { state: "requested", label: assigned.label, name: `${assigned.label}.${PARENT}` },
      { headers: NO_STORE },
    );
  }
  return refuse(503, "the next free label could not be settled; ask again");
}
