import { createServer } from "node:http";
import { POST as requestPOST } from "../app/api/agent/name/route";
import { GET as nameGET } from "../app/api/name/route";
import { setEnrolledForTest } from "../lib/agent/enrolled";
import { setNameResolverForTest } from "../lib/agent/name";
import { readFileSync } from "node:fs";
import { type NameRow, type NamesStore, setNamesStoreForTest } from "../lib/agent/names-store";
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
function fakeNamesStore(): NamesStore & { rows: NameRow[]; assigned: string[]; released: string[] } {
  const rows: NameRow[] = [];
  const assigned: string[] = [];
  const released: string[] = [];
  // Starts at 2 exactly as the migration's sequence does, because `agent1` was issued
  // by hand before the table existed.
  let next = 2;
  return {
    rows,
    assigned,
    released,
    requestLabel: async payer => {
      const existing = rows.find(r => r.payer === payer);
      if (existing) return existing;
      // A sequence, modelled as one: it only ever goes up, and deleting a row does
      // not move it. Modelling it as `max(rows) + 1` would make the fake kinder than
      // the schema and hide the exact bug the schema was changed to prevent.
      const label = `agent${next++}`;
      if (rows.some(r => r.label === label)) throw new Error("names_label_unq");
      // `issued_at` is written with the row, as the statement does: a row is the issuance.
      const at = new Date().toISOString();
      const row: NameRow = { payer, label, requestedAt: at, issuedAt: at, txHash: null };
      rows.push(row);
      assigned.push(label);
      return row;
    },
    release: async label => {
      const i = rows.findIndex(r => r.label === label && r.txHash === null);
      if (i >= 0) rows.splice(i, 1);
      released.push(label);
    },
    byPayer: async payer => rows.find(r => r.payer === payer) ?? null,
    byLabel: async label => rows.find(r => r.label === label) ?? null,
    pending: async () => rows.filter(r => r.txHash === null),
    markIssued: async (label, txHash, at) => {
      const row = rows.find(r => r.label === label && r.txHash === null);
      if (!row) return false;
      row.txHash = txHash;
      row.issuedAt = row.issuedAt ?? at.toISOString();
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

  // ── the request route refuses an unregistered payer ───────────────────────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setEnrolledForTest(async () => false);
    setRegistryForTest(async () => 0n); // UNREGISTERED
    const res = await ask(OTHER);
    check(res.status === 403, `300 · an unregistered payer is refused a name (got ${res.status})`);
    check(store.rows.length === 0, "300a · nothing is written for a refused request");

    // Control one: AgentBook knows somebody.
    setRegistryForTest(async () => 99n);
    const viaAgentBook = await ask(OTHER);
    check(viaAgentBook.status === 200, `300b · an AgentBook wallet is accepted (got ${viaAgentBook.status})`);

    // Control two: AgentBook says no, the page enrolled them. No fake of AgentBook
    // can express this, which is why the enrolled seam exists.
    setRegistryForTest(async () => 0n);
    setEnrolledForTest(async p => p === THIRD);
    const viaEnrolment = await ask(THIRD);
    check(viaEnrolment.status === 200, `300c · an enrolled wallet is accepted though AgentBook says no (got ${viaEnrolment.status})`);
  }

  // ── the label is never reused ─────────────────────────────────────────────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    setEnrolledForTest(async () => false);

    const first = (await (await ask(OTHER)).json()) as { label: string };
    const second = (await (await ask(THIRD)).json()) as { label: string };
    check(first.label !== second.label, `301 · two wallets get different labels (${first.label}, ${second.label})`);
    check(first.label === "agent2", `301a · the first assignment starts after the chain's agent1 (got ${first.label})`);

    const again = (await (await ask(OTHER)).json()) as { label: string };
    check(again.label === first.label, `301b · asking twice returns the same label (${first.label} then ${again.label})`);
    check(store.assigned.length === 2, `301c · no label is burned by a second ask (assigned ${store.assigned.length})`);

    // The counter never decrements when a row is deleted: the floor is the chain's
    // and the maximum is the table's, so removing the newest row must not hand its
    // label to the next wallet.
    const burned = second.label;
    store.rows.splice(store.rows.findIndex(r => r.label === burned), 1);
    const after = (await (await ask("0x5555555555555555555555555555555555555555")).json()) as { label: string };
    check(after.label !== burned, `301d · a deleted row's label is not handed out again, because the counter is a sequence (${burned} vs ${after.label})`);
  }

  // ── the name matches only on equality, and state comes from the chain ─────────
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    await ask(OTHER); // OTHER now holds agent2, requested, nothing on chain

    const requested = (await (await read(OTHER)).json()) as { state: string; matches: boolean; name: string };
    check(requested.state === "requested", `302 · a row with nothing on chain reads requested (got ${requested.state})`);
    check(requested.matches === false, "302a · requested never draws a match");
    check(requested.name === "agent2.xovi.eth", `302b · the read answers this wallet's own name (got ${requested.name})`);

    // The chain gains the record, to this payer.
    onChain.set("agent2.xovi.eth", OTHER);
    const issued = (await (await read(OTHER)).json()) as { state: string; matches: boolean };
    check(issued.state === "issued" && issued.matches, "302c · the record resolving to this payer draws issued");

    // The chain holds the name, but for somebody else. This is the case the wildcard
    // makes ordinary rather than exotic, and it must never draw a match.
    onChain.set("agent2.xovi.eth", THIRD);
    const elsewhere = (await (await read(OTHER)).json()) as { state: string; matches: boolean };
    check(!elsewhere.matches, "302d · a name resolving to another wallet never matches");
    check(elsewhere.state === "requested", `302e · and it is not drawn as issued either (got ${elsewhere.state})`);
    onChain.delete("agent2.xovi.eth");
  }

  // ── the fallback still passes for the recording wallet, with no row ───────────
  {
    setNamesStoreForTest(fakeNamesStore());
    const res = (await (await read(RECORDING_WALLET)).json()) as { state: string; matches: boolean; name: string };
    check(res.matches, "303 · the configured name still matches the recording wallet 0xC0686ae9… from the chain alone");
    check(res.state === "issued", `303a · and reads issued (got ${res.state})`);
    check(res.name === "agent1.xovi.eth", `303b · by the configured name, not a row (got ${res.name})`);
  }

  // ── 304 · a label the chain already holds is released, and the next taken ─────
  //
  // Finding 1. The head claimed this mechanism in its own comment and no check held
  // it: removing the chain check kept a taken label and the suite stayed green. The
  // case is not exotic. `agent1` was issued by hand before this table existed and
  // another could be, so the sequence can hand out a number whose name is already
  // somebody's.
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    setEnrolledForTest(async () => false);

    // The sequence starts at 2, so the first candidate is agent2. Put it on chain,
    // issued to somebody else.
    onChain.set("agent2.xovi.eth", THIRD);

    const res = (await (await ask(OTHER)).json()) as { label: string; state: string };
    check(res.label === "agent3", `304 · a label already issued to another wallet is abandoned and the next taken (got ${res.label})`);
    check(res.state === "requested", `304a · and the wallet still ends up with a request (got ${res.state})`);
    check(store.rows.length === 1, `304b · the abandoned label leaves no row behind (rows ${store.rows.length})`);
    check(store.released.length === 1 && store.released[0] === "agent2",
      `304c · exactly one label was released, and it was the taken one (${store.released.join(",") || "none"})`);
    // The wallet the name belongs to keeps it: the release path must never delete
    // somebody else's claim, and the check names that rather than implying it.
    check(onChain.get("agent2.xovi.eth") === THIRD, "304d · the name on chain is untouched by the release");
    onChain.delete("agent2.xovi.eth");
  }

  // ── 305 · issued is the chain's answer, never the row's ──────────────────────
  //
  // Finding 2. The read route's comment says drawing issued from the table alone is
  // the mutation the checks are shaped to catch. It was not: a row carrying a hash
  // with the chain empty stayed green. A hash is evidence that an issuance was
  // attempted, not that the record exists; it can belong to a reverted transaction,
  // or the record can have been changed since.
  {
    const store = fakeNamesStore();
    setNamesStoreForTest(store);
    setRegistryForTest(async () => 99n);
    const asked = (await (await ask(OTHER)).json()) as { label: string };
    await store.markIssued(asked.label, `0x${"ab".repeat(32)}`, new Date());

    const row = await store.byPayer(OTHER);
    check(row?.txHash !== null, "305 · the row now carries a transaction hash (the fixture is the case)");

    const read1 = (await (await read(OTHER)).json()) as { state: string; matches: boolean };
    check(read1.state === "requested", `305a · a row marked issued with the chain empty still reads requested (got ${read1.state})`);
    check(read1.matches === false, "305b · and draws no match");

    // Positive control: the same row, once the chain agrees.
    onChain.set(`${asked.label}.xovi.eth`, OTHER);
    const read2 = (await (await read(OTHER)).json()) as { state: string };
    check(read2.state === "issued", `305c · and reads issued once the record exists (positive control, got ${read2.state})`);
    onChain.delete(`${asked.label}.xovi.eth`);
  }

  // ── 306 · a registry that fails is not an answer about the wallet ────────────
  //
  // Finding 8. Refusing with 403 would tell somebody to go and register when the read
  // failed, which is the shape the registration route already refuses by answering
  // `unread` as its own state.
  {
    setNamesStoreForTest(fakeNamesStore());
    setEnrolledForTest(async () => false);
    setRegistryForTest(async () => {
      throw new Error("the registry did not answer");
    });
    const res = await ask(OTHER);
    check(res.status === 503, `306 · a registry that throws answers 503, not a refusal about the wallet (got ${res.status})`);
  }

  // ── 307 · the issuer's three rules, read from the script ─────────────────────
  //
  // Finding 4. Text checks, because the script is not driven in process: it sends
  // transactions. Each is turned red by the opposite, so they are not decoration.
  {
    const src = readFileSync(new URL("../bin/issue-names.ts", import.meta.url), "utf8");
    /*
     * Positions are taken from the CALL SITES, not from the words.
     *
     * The first version of these took `indexOf("waitForTransactionReceipt")`, which
     * found the word in this script's own doc comment, several lines above the call,
     * and 307f went red against code that was right. Present-in-the-file and
     * called-here are different questions, and a text check that cannot tell them
     * apart reports on the prose.
     */
    const waitAt = src.search(/await publicClient\.waitForTransactionReceipt\(/);
    const markAt = src.search(/await store\.markIssued\(/);
    const sendAt = src.search(/await wallet\.writeContract\(/);
    check(waitAt > 0 && markAt > 0 && sendAt > 0, "307g · the three call sites this check reads are all present (control)");
    check(waitAt > 0 && markAt > waitAt, "307 · the issuer waits for a receipt before it marks a row issued");
    check(/receipt\.status !== "success"/.test(src), "307a · and only a success receipt gets past");
    check(/const execute = argv\.includes\("--execute"\)/.test(src), "307b · sending is opt in: --execute is the only way");
    check(/if \(!execute\)/.test(src), "307c · and the default path prints instead of sending");
    check(/NAMES_OWNER_KEY_FILE/.test(src), "307d · the owner key is read from the file that variable names");
    check(!/process\.env\.NAMES_OWNER_KEY\b/.test(src), "307e · and never from the environment directly");
    // The hash reaches the operator before the wait, so a wait that throws does not
    // lose a transaction that was really sent.
    const sentAt = src.search(/console\.log\(`  sent /);
    check(sentAt > sendAt && sentAt < waitAt,
      "307f · the hash is printed after the send and before the wait, so a failed wait still names it");
  }

  // ── 308 · the migration's own guarantees, read from the file ─────────────────
  //
  // Finding 5. `START WITH 2` was modelled by the fake and read by nothing, so the
  // migration could have started at 1 and every check stayed green while the first
  // wallet was handed `agent1`, the founder's own name.
  {
    const sql = readFileSync(new URL("../sql/0006_names.sql", import.meta.url), "utf8");
    /*
     * Read the STATEMENT, not the file.
     *
     * The first version tested the file for `START WITH 2`, and the migration's own
     * comment explains the choice in those words a few lines above the statement. So
     * changing the sequence to start at 1 left the comment saying 2, the check found
     * it, and 308a stayed green against the very mutation it exists for. The same trap
     * as 307f, twice in one file: a text check that does not anchor to code reports on
     * the prose that describes the code.
     *
     * Comment lines are dropped first, then the statement is matched whole.
     */
    const statements = sql
      .split("\n")
      .filter(line => !line.trimStart().startsWith("--"))
      .join("\n");
    const sequence = /CREATE SEQUENCE IF NOT EXISTS names_label_seq[^;]*;/.exec(statements)?.[0] ?? "";
    check(sequence.length > 0, "308 · the label counter is a sequence (and this check found the statement)");
    check(/START WITH 2\b/.test(sequence), `308a · starting at 2, because agent1 was issued by hand before this table`);
    check(/MINVALUE 2\b/.test(sequence), "308b · and it cannot be set below that");
    check(/CREATE UNIQUE INDEX IF NOT EXISTS names_payer_unq/.test(statements), "308c · payer is unique, so asking twice cannot burn two labels");
    check(/CREATE UNIQUE INDEX IF NOT EXISTS names_label_unq/.test(statements), "308d · label is unique, so one subname cannot reach two wallets");
  }

  setNamesStoreForTest(undefined);
  setNameResolverForTest(undefined);
  setRegistryForTest(undefined);
  setEnrolledForTest(undefined);
  process.env.AGENT_ENS_RPC_URL = prevRpc;
  process.env.AGENT_IDENTITY_NAME = prevName;
  rpc.close();
}
