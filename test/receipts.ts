import { GET as receiptsGET } from "../app/api/receipts/route";
import { RECEIPTS_SHOWN, type ReceiptReader, setReceiptReaderForTest } from "../lib/human/receipts";
import type { Settlement } from "../lib/human/store";

type Check = (ok: boolean, label: string) => void;

/** Two payers, so "only this payer's rows" is a claim the data can falsify rather
 *  than one a single row satisfies by having nowhere else to come from. */
const ASKING = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const OTHER = "0x1111111111111111111111111111111111111111";

function settlement(payer: string, nonce: string): Settlement {
  return {
    source: "route",
    payer,
    payTo: "0x0000000000000000000000000000000000000abc",
    amount: "10000",
    network: "eip155:84532",
    nonce,
    txHash: `0x${nonce.slice(2).padStart(64, "0")}`,
    settledAt: "2026-09-11T05:00:00.000Z",
  };
}

/** A reader that answers from a map, and records what it was asked for, so the
 *  cap and the address it received are both observable. */
function fakeReader(rows: Record<string, Settlement[]>) {
  const seen: { payer: string; limit: number }[] = [];
  const reader: ReceiptReader = {
    byPayer: async (payer, limit) => {
      seen.push({ payer, limit });
      return (rows[payer.toLowerCase()] ?? []).slice(0, limit);
    },
  };
  return { reader, seen };
}

const ask = (query: string) => receiptsGET(new Request(`http://localhost/api/receipts${query}`));

export async function receiptsChecks(check: Check) {
  console.log("\n  the receipts route");

  const { reader, seen } = fakeReader({
    [ASKING.toLowerCase()]: [settlement(ASKING, "0xaa"), settlement(ASKING, "0xbb")],
    [OTHER.toLowerCase()]: [settlement(OTHER, "0xcc")],
  });
  setReceiptReaderForTest(reader);

  const answered = await ask(`?payer=${ASKING}`);
  const body = (await answered.clone().json()) as { settlements: Record<string, unknown>[] };
  check(answered.status === 200, "218 · a checksummed payer is answered");
  check(body.settlements.length === 2, "218a · with that payer's rows");
  check(
    body.settlements.every(row => String(row.payer).toLowerCase() === ASKING.toLowerCase()),
    "218b · and no other payer's, which the second payer in the store makes falsifiable",
  );

  // The projection, named field by field so the assertion fails when the wire
  // shape grows rather than when somebody remembers to look.
  const FIELDS = ["source", "payer", "payTo", "amount", "network", "nonce", "txHash", "settledAt"];
  const keys = Object.keys(body.settlements[0] ?? {}).sort();
  check(keys.join(",") === [...FIELDS].sort().join(","), `219 · the served fields are exactly the eight (${keys.length})`);

  // The leak control. A reader whose rows carry a field the route never named,
  // which is what a column added to `receipts` and picked up by the driver would
  // look like from here. The route must serve the eight and drop the ninth.
  const widened = { ...settlement(ASKING, "0xdd"), identifierDigest: "a keyed derivation that must never ship" };
  setReceiptReaderForTest({ byPayer: async () => [widened as Settlement] });
  const narrowed = (await (await ask(`?payer=${ASKING}`)).json()) as { settlements: Record<string, unknown>[] };
  check(!("identifierDigest" in (narrowed.settlements[0] ?? {})), "219a · a field the reader grew is not served (control)");
  check(Object.keys(narrowed.settlements[0] ?? {}).length === 8, "219b · and the count is still eight");

  setReceiptReaderForTest(reader);

  // Refusals. A missing parameter is the shape most likely to be read as
  // "everything", so it is the one asserted first.
  check((await ask("")).status === 400, "220 · a request naming no payer is refused");
  check((await ask("?payer=")).status === 400, "220a · and an empty payer is refused");
  check((await ask("?payer=nonsense")).status === 400, "220b · and a string that is not an address");
  check((await ask("?payer=0x2be7")).status === 400, "220c · and an address of the wrong length");
  // Mixed case with a broken checksum is a typo, and viem's strict default is what
  // catches it. Lowercase is not a typo and is the negative control: a gate that
  // refuses every spelling satisfies every refusal above.
  check((await ask(`?payer=${ASKING.slice(0, -1)}A`)).status === 400, "220d · and a mixed case address whose checksum does not match");
  check((await ask(`?payer=${ASKING.toLowerCase()}`)).status === 200, "220e · while an all lowercase address is answered (negative control)");

  check(seen.every(call => call.limit === RECEIPTS_SHOWN), `221 · every read is capped at ${RECEIPTS_SHOWN}`);
  check(
    seen.some(call => call.payer === ASKING),
    "221a · and the reader is handed the canonical spelling, so one address is one payer",
  );

  const headers = (await ask(`?payer=${ASKING}`)).headers.get("cache-control") ?? "";
  check(headers.includes("no-store") && headers.includes("private"), `222 · one payer's history is never cached (${headers})`);
  check(((await ask("")).headers.get("cache-control") ?? "").includes("no-store"), "222a · nor is the refusal");

  // No ledger and a broken ledger are different sentences, and neither of them is
  // an empty history. A wallet with no receipts is a fact about the wallet.
  setReceiptReaderForTest(null);
  const unconfigured = await ask(`?payer=${ASKING}`);
  check(unconfigured.status === 503, "223 · no ledger configured is 503, not an empty list");

  setReceiptReaderForTest({
    byPayer: async () => {
      throw new Error("relation \"receipts\" does not exist");
    },
  });
  // Wrapped, because the regression this check exists to catch is the route losing
  // its try and catch, and an unwrapped call would then reject, abort the harness
  // on this line and skip every check after it. A crash that hides the rest of the
  // suite is a worse report than one red line.
  const broken = await ask(`?payer=${ASKING}`).catch(() => null);
  check(broken !== null, "223a · a ledger that throws is answered rather than raised through the route");
  check(broken?.status === 503, "223b · and the answer is 503, not the framework's 500");
  const brokenBody = broken === null ? "" : JSON.stringify(await broken.json());
  check(!brokenBody.includes("relation"), "223c · while the driver's message stays in the log");

  setReceiptReaderForTest(undefined);
}
