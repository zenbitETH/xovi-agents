import { createServer } from "node:http";
import { POST as requestPOST } from "../app/api/agent/name/route";
import { GET as nameGET } from "../app/api/name/route";
import { setEnrolledForTest } from "../lib/agent/enrolled";
import { setNameResolverForTest } from "../lib/agent/name";
import { type NameRow, type NamesStore, chainFloor, setNamesStoreForTest } from "../lib/agent/names-store";
import { setRegistryForTest } from "../lib/human/registry";

type Check = (ok: boolean, label: string) => void;

/** The founder's recording wallet: the agent's payer, which `agent1.xovi.eth`
 *  resolves to. Named rather than written inline, because "the founder's wallet" has
 *  already been ambiguous once in this work and the fallback check is about this
 *  address specifically. */
const RECORDING_WALLET = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const OTHER = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const THIRD = "0x3333333333333333333333333333333333333333";

/**
 * A store that holds uniqueness the way the two indexes will hold it.
 *
 * The fake is not allowed to be more forgiving than the database. `payer` unique and
 * `label` unique are the guarantees the schema makes, so the fake refuses the same
 * way, and the assignment is computed and inserted with no await between them for the
 * same reason the human fake takes and counts in one step: split them and two racing
 * requests both succeed, which is precisely the bug the single statement exists to
 * make impossible.
 */
function fakeNamesStore(): NamesStore & { rows: NameRow[]; assigned: string[] } {
  const rows: NameRow[] = [];
  const assigned: string[] = [];
  // Starts at 2 exactly as the migration's sequence does, because `agent1` was issued
  // by hand before the table existed.
  let next = 2;
  return {
    rows,
    assigned,
    requestLabel: async payer => {
      const existing = rows.find(r => r.payer === payer);
      if (existing) return existing;
      // A sequence, modelled as one: it only ever goes up, and deleting a row does
      // not move it. Modelling it as `max(rows) + 1` would make the fake kinder than
      // the schema and hide the exact bug the schema was changed to prevent.
      const label = `agent${next++}`;
      if (rows.some(r => r.label === label)) throw new Error("names_label_unq");
      const row: NameRow = { payer, label, requestedAt: new Date().toISOString(), issuedAt: null, txHash: null };
      rows.push(row);
      assigned.push(label);
      return row;
    },
    release: async label => {
      const i = rows.findIndex(r => r.label === label && r.txHash === null);
      if (i >= 0) rows.splice(i, 1);
    },
    byPayer: async payer => rows.find(r => r.payer === payer) ?? null,
    pending: async () => rows.filter(r => r.txHash === null),
    markIssued: async (label, txHash, at) => {
      const row = rows.find(r => r.label === label && r.txHash === null);
      if (!row) return false;
      row.txHash = txHash;
      row.issuedAt = at.toISOString();
      return true;
    },
  };
}

/** A chain id endpoint, so the routes' ordering guard has something real to ask. */
async function startFakeRpc() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const call = JSON.parse(body || "{}") as { id?: number; method?: string };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: "0xaa36a7" })); // 11155111
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const ask = (payer: unknown) =>
  requestPOST(new Request("http://local/api/agent/name", { method: "POST", body: JSON.stringify({ payer }) }));
const read = (payer: string) => nameGET(new Request(`http://local/api/name?payer=${payer}`));

export async function namesChecks(check: Check) {
  const rpc = await startFakeRpc();
  const prevRpc = process.env.AGENT_ENS_RPC_URL;
  const prevName = process.env.AGENT_IDENTITY_NAME;
  process.env.AGENT_ENS_RPC_URL = rpc.url;
  process.env.AGENT_IDENTITY_NAME = "agent1.xovi.eth";

  /*
   * The wildcard, which is the control the whole name leg hangs on. The parent's
   * resolver answers for EVERY subname, so a fake that returned an address for every
   * name would be the honest model of the chain; what distinguishes an issued name is
   * the ADDRESS RECORD, and only `agent1` has one here.
   */
  const onChain = new Map<string, string>([["agent1.xovi.eth", RECORDING_WALLET]]);
  setNameResolverForTest(async name => onChain.get(name) ?? null);

  // ── the floor keys on the record, never on the resolver ───────────────────────
  {
    const floor = await chainFloor(async n => onChain.get(n) ?? null, "xovi.eth", "0x0000000000000000000000000000000000000000");
    check(floor === 1, `the chain floor is 1 with only agent1 holding a record (got ${floor})`);
    // Seen to fail the other way: a resolver-shaped fake, where every name answers,
    // drives the floor to its bound. That is what keying on the resolver would do.
    const everyName = await chainFloor(async () => RECORDING_WALLET, "xovi.eth", "0x0", 8);
    check(everyName === 8, `a fake where every name resolves pins the floor at its bound (got ${everyName})`);
  }

  // ── the request route refuses an unregistered payer ───────────────────────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setEnrolledForTest(async () => false);
    setRegistryForTest(async () => 0n); // UNREGISTERED
    const res = await ask(OTHER);
    check(res.status === 403, `an unregistered payer is refused a name (got ${res.status})`);
    check(store.rows.length === 0, "nothing is written for a refused request");

    // Control one: AgentBook knows somebody.
    setRegistryForTest(async () => 99n);
    const viaAgentBook = await ask(OTHER);
    check(viaAgentBook.status === 200, `an AgentBook wallet is accepted (got ${viaAgentBook.status})`);

    // Control two: AgentBook says no, the page enrolled them. No fake of AgentBook
    // can express this, which is why the enrolled seam exists.
    setRegistryForTest(async () => 0n);
    setEnrolledForTest(async p => p === THIRD);
    const viaEnrolment = await ask(THIRD);
    check(viaEnrolment.status === 200, `an enrolled wallet is accepted though AgentBook says no (got ${viaEnrolment.status})`);
  }

  // ── the label is never reused ─────────────────────────────────────────────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    setEnrolledForTest(async () => false);

    const first = (await (await ask(OTHER)).json()) as { label: string };
    const second = (await (await ask(THIRD)).json()) as { label: string };
    check(first.label !== second.label, `two wallets get different labels (${first.label}, ${second.label})`);
    check(first.label === "agent2", `the first assignment starts after the chain's agent1 (got ${first.label})`);

    const again = (await (await ask(OTHER)).json()) as { label: string };
    check(again.label === first.label, `asking twice returns the same label (${first.label} then ${again.label})`);
    check(store.assigned.length === 2, `no label is burned by a second ask (assigned ${store.assigned.length})`);

    // The counter never decrements when a row is deleted: the floor is the chain's
    // and the maximum is the table's, so removing the newest row must not hand its
    // label to the next wallet.
    const burned = second.label;
    store.rows.splice(store.rows.findIndex(r => r.label === burned), 1);
    const after = (await (await ask("0x5555555555555555555555555555555555555555")).json()) as { label: string };
    check(after.label !== burned, `a deleted row's label is not handed out again (${burned} vs ${after.label})`);
  }

  // ── the name matches only on equality, and state comes from the chain ─────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    await ask(OTHER); // OTHER now holds agent2, requested, nothing on chain

    const requested = (await (await read(OTHER)).json()) as { state: string; matches: boolean; name: string };
    check(requested.state === "requested", `a row with nothing on chain reads requested (got ${requested.state})`);
    check(requested.matches === false, "requested never draws a match");
    check(requested.name === "agent2.xovi.eth", `the read answers this wallet's own name (got ${requested.name})`);

    // The chain gains the record, to this payer.
    onChain.set("agent2.xovi.eth", OTHER);
    const issued = (await (await read(OTHER)).json()) as { state: string; matches: boolean };
    check(issued.state === "issued" && issued.matches, "the record resolving to this payer draws issued");

    // The chain holds the name, but for somebody else. This is the case the wildcard
    // makes ordinary rather than exotic, and it must never draw a match.
    onChain.set("agent2.xovi.eth", THIRD);
    const elsewhere = (await (await read(OTHER)).json()) as { state: string; matches: boolean };
    check(!elsewhere.matches, "a name resolving to another wallet never matches");
    check(elsewhere.state === "requested", `and it is not drawn as issued either (got ${elsewhere.state})`);
    onChain.delete("agent2.xovi.eth");
  }

  // ── the fallback still passes for the recording wallet, with no row ───────────
  {
    setNamesStoreForTest(fakeNamesStore());
    const res = (await (await read(RECORDING_WALLET)).json()) as { state: string; matches: boolean; name: string };
    check(res.matches, "the configured name still matches the recording wallet 0xC0686ae9… from the chain alone");
    check(res.state === "issued", `and reads issued (got ${res.state})`);
    check(res.name === "agent1.xovi.eth", `by the configured name, not a row (got ${res.name})`);
  }

  setNamesStoreForTest(undefined);
  setNameResolverForTest(undefined);
  setRegistryForTest(undefined);
  setEnrolledForTest(undefined);
  process.env.AGENT_ENS_RPC_URL = prevRpc;
  process.env.AGENT_IDENTITY_NAME = prevName;
  rpc.close();
}
