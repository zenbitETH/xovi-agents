import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { GET as proposalsGET } from "../app/api/proposals/route";

type Check = (ok: boolean, label: string) => void;

const MINE = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const THEIRS = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";

/**
 * A whole clip row, as the reviewing application's list actually returns one.
 *
 * Every field below the first five is one the proxy must drop, and they are here
 * rather than in a comment because an assertion about absence has to be made
 * against a body that really contains the thing. `participants` names the other
 * animals in the tank, `behaviorNote` is a derivation and `stationId` is a station.
 */
function wholeRow(submitter: string, id: number) {
  return {
    id,
    clipHash: `0x${String(id).repeat(4)}`,
    status: "verified",
    submittedAt: "2026-09-08T18:38:34.000Z",
    verifiedAt: "2026-09-09T02:28:59.058Z",
    submitterAddress: submitter,
    ingestKeyId: "key_live_do_not_publish",
    confidence: 500,
    behaviorNote: "sostiene la postura branquial",
    behaviorMetric: 0.82,
    participants: ["Patito", "Larva 2"],
    specimenAlias: "Patito",
    stationId: "AM 3",
    speciesCode: "mexicanum",
    verifiedBy: "0xeCB4C1245665e8A1F43826355aaB0Dd6bF336e05",
    verifierSignature: "0xdeadbeef",
    verifierNonce: "0xnonce",
    verifierChainId: 11155111,
    rejectReason: null,
    videoId: "v9pFMid2BOs",
    startTime: 12475.5,
    endTime: 12491.5,
  };
}

async function startFakeList(body: () => unknown, status = 200) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body()));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/api/clips`,
    close: () => new Promise<void>(r => void server.close(() => r())),
  };
}

const ask = (query: string) => proposalsGET(new Request(`http://localhost/api/proposals${query}`));

export async function proposalsChecks(check: Check) {
  console.log("\n  the proposals proxy");

  const before = process.env.XOVI_PUBLIC_URL;

  // Fails closed with no origin, rather than inventing one.
  delete process.env.XOVI_PUBLIC_URL;
  check((await ask(`?submitter=${MINE}`)).status === 503, "239 · with no public list configured the route refuses");

  const list = await startFakeList(() => [wholeRow(MINE, 1), wholeRow(THEIRS, 2), wholeRow(MINE, 3)]);
  process.env.XOVI_PUBLIC_URL = list.url;

  const answered = await ask(`?submitter=${MINE}`);
  const body = (await answered.json()) as { proposals: Record<string, unknown>[] };
  check(answered.status === 200, "240 · a checksummed submitter is answered");
  check(body.proposals.length === 2, `240a · with that submitter's rows only (${body.proposals.length} of 3)`);

  /*
   * The field review at the wire.
   *
   * A proxy re-serves whatever it does not drop, under a new host, so this is
   * asserted against the whole body rather than field by field: anything the fake
   * row carries and the answer does not name is caught, including a field nobody
   * thought to forbid.
   */
  const served = JSON.stringify(body);
  const mustNotAppear = [
    "ingestKeyId",
    "key_live_do_not_publish",
    "confidence",
    "behaviorNote",
    "sostiene",
    "behaviorMetric",
    "participants",
    "Patito",
    "specimenAlias",
    "stationId",
    "AM 3",
    "speciesCode",
    "mexicanum",
    "verifiedBy",
    "verifierSignature",
    "rejectReason",
  ];
  const leaked = mustNotAppear.filter(f => served.includes(f));
  check(leaked.length === 0, `241 · nothing outside the keep list is re-served (${leaked.join(", ") || "none"})`);
  check(JSON.stringify(wholeRow(MINE, 1)).includes("AM 3"), "241a · while the row it read does carry a station (negative control)");
  const keys = Object.keys(body.proposals[0] ?? {}).sort();
  check(keys.join(",") === "clipHash,id,status,submittedAt,verifiedAt", `241b · and the answer carries the five (${keys.join(",")})`);

  check((await ask("")).status === 400, "242 · a request naming no submitter is refused");
  check((await ask("?submitter=nonsense")).status === 400, "242a · and one that is not an address");

  /*
   * Read only by construction.
   *
   * Not a comment asking for it: the module exports one method, so there is no
   * verb through which anything could be written, and the one call it makes is a
   * GET. Adding an `export async function POST` to the route turns 243 red.
   */
  const source = readFileSync(join(process.cwd(), "app/api/proposals/route.ts"), "utf8");
  const verbs = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g)].map(m => m[1]);
  check(verbs.join(",") === "GET", `243 · the route exports one verb and it is GET (${verbs.join(",") || "none"})`);
  check(/method: "GET"/.test(source), "243a · and the call it makes upstream names the method");
  check(/export\s+async\s+function\s+POST/.test("export async function POST() {}"), "243b · the verb check can see a writer (negative control)");

  await list.close();

  // An upstream that fails is reported in this route's words, never the other
  // application's: that text is written for its operator, in its own language, and
  // it interpolates the values it is about.
  const broken = await startFakeList(() => ({ error: "La clave no cubre la estación AM 1" }), 500);
  process.env.XOVI_PUBLIC_URL = broken.url;
  const upstreamFailed = await ask(`?submitter=${MINE}`);
  const failedBody = JSON.stringify(await upstreamFailed.json());
  check(upstreamFailed.status === 502, "244 · an upstream that will not answer is 502");
  check(!failedBody.includes("AM 1") && !failedBody.includes("clave"), "244a · and its words do not travel through");
  await broken.close();

  if (before === undefined) delete process.env.XOVI_PUBLIC_URL;
  else process.env.XOVI_PUBLIC_URL = before;
}
