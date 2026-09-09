import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { GET } from "../app/api/agent/windows/route";
import { resetServerForTest } from "../lib/x402";
import { runOnce, windowsUrlFor, type RunStep } from "../lib/agent/run";
import { startFakeFacilitator } from "./facilitator";
import { startFakeIngest } from "./ingest";

type Check = (ok: boolean, label: string) => void;

const KEY = `0x${"ab".repeat(32)}` as const;
const PAY_TO = "0x000000000000000000000000000000000000dEaD";

/** The handler, called in process, which is how the route itself calls it. */
const windowsFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return GET(new Request(url, init));
};

/** The browser's half: read the live challenge, sign it, hand over the header. */
async function signAt(url: string): Promise<string | undefined> {
  const core = new x402Client();
  registerExactEvmScheme(core, { signer: privateKeyToAccount(KEY) });
  const http = new x402HTTPClient(core);
  const challenge = await GET(new Request(url));
  if (challenge.status !== 402) return undefined;
  const body = await challenge.json().catch(() => ({}));
  const required = http.getPaymentRequiredResponse(n => challenge.headers.get(n), body);
  const payload = await http.createPaymentPayload(required);
  return (http.encodePaymentSignatureHeader(payload) as Record<string, string>)["PAYMENT-SIGNATURE"];
}

async function collect(gen: AsyncGenerator<RunStep>): Promise<RunStep[]> {
  const steps: RunStep[] = [];
  for await (const s of gen) steps.push(s);
  return steps;
}

const names = (steps: RunStep[]) => steps.map(s => s.step);

export async function agentRunChecks(check: Check) {
  console.log("\n  the delegated run, as a sequence somebody watches\n");

  const fac = await startFakeFacilitator();
  const ingest = await startFakeIngest();
  const ORIGIN = "http://127.0.0.1";
  const WINDOWS = `${ORIGIN}/api/agent/windows`;

  const arrange = (snapshot?: string) => {
    process.env.X402_PAY_TO = PAY_TO;
    process.env.X402_NETWORK = "eip155:84532";
    process.env.X402_FACILITATOR_URL = fac.url;
    process.env.X402_PRICE = "$0.01";
    if (snapshot === undefined) delete process.env.WINDOWS_SNAPSHOT;
    else process.env.WINDOWS_SNAPSHOT = snapshot;
    resetServerForTest();
    fac.reset();
    ingest.reset();
  };

  // A run with no signature at all reaches nothing and says why.
  arrange("fixtures/windows.synthetic.jsonl");
  const unpaid = await collect(runOnce({ windowsUrl: WINDOWS, windowsFetch }));
  check(names(unpaid).includes("payment-refused"), "179 · a run with no signature is refused before any work");
  check(!names(unpaid).includes("read"), "180 · and nothing is read, so an unpaid run cannot see a window");
  check(fac.hits.settle === 0, "181 · and nothing settles (negative control)");

  // The whole loop, paid, with the credential present.
  arrange("fixtures/windows.synthetic.jsonl");
  const header = await signAt(WINDOWS);
  check(Boolean(header), "182 · the browser half produces a PAYMENT-SIGNATURE from the live challenge");
  const full = await collect(
    runOnce({
      windowsUrl: WINDOWS,
      paymentHeader: header,
      windowsFetch,
      ingestUrl: ingest.url,
      ingestKey: "k-test",
      ingestFetch: fetch,
    }),
  );
  const order = names(full);
  check(
    JSON.stringify(order) ===
      JSON.stringify(["presenting", "paid", "read", "selected", "proposing", "proposed", "done"]),
    `183 · the full run is presenting, paid, read, selected, proposing, proposed, done (got ${order.join(", ")})`,
  );
  const paid = full.find(s => s.step === "paid");
  check(paid?.step === "paid" && paid.free === false && Boolean(paid.transaction),
    "184 · the paid step carries the transaction, decoded from PAYMENT-RESPONSE");
  check(fac.hits.settle === 1, "185 · exactly one settlement, so the run pays once");
  check(ingest.hits === 1, "186 · and exactly one proposal reaches the ingest route");

  // The invariant, asserted over the wire rather than over the source.
  const sent = ingest.bodies[0] ?? {};
  check(!("source" in sent) && !("submitterAddress" in sent),
    "187 · the proposal names no source and no submitter, so a payer cannot attribute the work to a person");
  check(sent.behaviorTag === "other", "188 · and the tag stays other, because the detector cannot classify behaviour");

  /*
   * What a stranger's browser is shown, and what it is not.
   *
   * The feed is a published surface. The window the server read carries a station,
   * a species and possibly an alias, and the proposal it forms carries them too
   * because the ingest route is specified to receive them. None of that reaches
   * the stream: the window id is opaque and the rest stays server side.
   */
  const wire = JSON.stringify(full);
  check(!wire.includes("AM 1") && !/"stationId"/.test(wire),
    "187b · no station reaches the streamed run, though the window the agent read has one");
  check(!/"speciesCode"|mexicanum|andersoni|dumerilii/.test(wire),
    "187c · and no species");
  check(!/"specimenAlias"/.test(wire), "187d · and no alias");
  check(JSON.stringify(sent).includes("AM 1"),
    "187e · while the proposal the ingest route receives does carry the station (negative control)");

  // The credential is the one thing that must never be watchable.
  const streamed = JSON.stringify(full);
  check(!streamed.includes("k-test"), "189 · the ingest credential appears nowhere in the streamed run");
  check(JSON.stringify({ k: "k-test" }).includes("k-test"), "190 · the credential check can see the credential (negative control)");

  // With no credential the run stops one step short instead of claiming success.
  arrange("fixtures/windows.synthetic.jsonl");
  const header2 = await signAt(WINDOWS);
  const noKey = await collect(runOnce({ windowsUrl: WINDOWS, paymentHeader: header2, windowsFetch }));
  check(names(noKey).includes("selected") && names(noKey).includes("not-submitted"),
    "191 · with no credential the run selects and then stops, rather than reporting a proposal");
  check(!names(noKey).includes("proposed"), "192 · and never says proposed (negative control for 191)");

  /*
   * What the two halves agreeing on a URL is, and what it is not.
   *
   * The first version of this asserted that a payment signed for one origin would
   * not complete a run at another, and it passed. It passed because that run had
   * no ingest credential and stopped at "not-submitted", not because anything
   * refused it: the payment settled, three windows were read and a window was
   * selected. The assertion was false and green at the same time.
   *
   * So the true behaviour is asserted instead. An EIP-3009 authorization signs the
   * token, the recipient, the amount, a validity window and a nonce. It does not
   * sign the path, and a payment presented at a different origin settles. What
   * makes it spendable once is the nonce, and the URL derivation exists so the two
   * halves name one resource, not to bind anything.
   */
  arrange("fixtures/windows.synthetic.jsonl");
  const header3 = await signAt(WINDOWS);
  const elsewhere = await collect(
    runOnce({ windowsUrl: "http://127.0.0.2/api/agent/windows", paymentHeader: header3, windowsFetch }),
  );
  check(names(elsewhere).includes("paid"),
    "193 · an authorization is not bound to a path: presented at another origin it still settles");
  check(
    windowsUrlFor("https://xovi-agents.example/api/agent/run") === "https://xovi-agents.example/api/agent/windows",
    "194 · the run derives the paid route from its own request, so both halves name one resource",
  );
  check(
    windowsUrlFor("http://localhost:3000/api/agent/run?x=1") === "http://localhost:3000/api/agent/windows",
    "195 · including the port, and without carrying the query across",
  );

  // The run presents at exactly the URL it was given, with the header it was given.
  arrange("fixtures/windows.synthetic.jsonl");
  const header5 = await signAt(WINDOWS);
  const seen: { url: string; header: string | null }[] = [];
  await collect(
    runOnce({
      windowsUrl: WINDOWS,
      paymentHeader: header5,
      windowsFetch: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        seen.push({ url, header: new Headers(init?.headers).get("PAYMENT-SIGNATURE") });
        return GET(new Request(url, init));
      },
    }),
  );
  check(seen.length === 1 && seen[0].url === WINDOWS,
    "196 · the paid route is called once, at the URL the run was configured with");
  check(seen[0]?.header === header5,
    "197 · and the browser's signature is forwarded unchanged rather than re-signed");

  // No snapshot is unavailable, not unpaid, and the two must not read alike.
  arrange(undefined);
  const header4 = await signAt(WINDOWS);
  const dark = await collect(runOnce({ windowsUrl: WINDOWS, paymentHeader: header4, windowsFetch }));
  check(names(dark).includes("unavailable"), "198 · a missing snapshot is reported as unavailable rather than as a refused payment");
  check(fac.hits.settle === 0, "199 · and nothing settled, so a run that served nothing charged nothing");

  await fac.close();
  await ingest.close();
}
