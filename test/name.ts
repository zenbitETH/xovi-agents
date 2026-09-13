import { createServer } from "node:http";
import { GET as nameGET } from "../app/api/name/route";
import { matchesPayer, setNameResolverForTest } from "../lib/agent/name";

type Check = (ok: boolean, label: string) => void;

const PAYER = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";

/**
 * A JSON-RPC endpoint that answers a chain id and records what it was asked.
 *
 * Recording the methods is the point. "Refused before any read" is a claim about
 * ordering, and the only way to hold it is to count what reached the endpoint: an
 * assertion that the route answered 503 would also pass if it had resolved the name
 * first and thrown the answer away.
 */
async function startFakeRpc(chainIdHex: string) {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const call = JSON.parse(body || "{}") as { id?: number; method?: string };
      methods.push(String(call.method));
      res.writeHead(200, { "content-type": "application/json" });
      if (call.method === "eth_chainId") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: chainIdHex }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "not this fake's job" } }));
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, methods, close: () => new Promise<void>(r => void server.close(() => r())) };
}

const ask = (query: string) => nameGET(new Request(`http://localhost/api/name${query}`));

export async function nameChecks(check: Check) {
  console.log("\n  the name this payer is issued");

  const rpcBefore = process.env.AGENT_ENS_RPC_URL;
  const nameBefore = process.env.AGENT_IDENTITY_NAME;

  check((await ask("")).status === 400, "246 · a request naming no payer is refused");
  check((await ask("?payer=nonsense")).status === 400, "246a · and one that is not an address");

  // No name configured is an answer about this deployment, not a failure.
  delete process.env.AGENT_IDENTITY_NAME;
  const unnamed = await ask(`?payer=${PAYER}`);
  const unnamedBody = (await unnamed.json()) as { name: string | null; matches: boolean };
  check(unnamed.status === 200 && unnamedBody.name === null, "247 · with no name configured the route answers rather than failing");
  check(unnamedBody.matches === false, "247a · and does not claim a match");

  /*
   * A wrong chain is refused BEFORE the name is read.
   *
   * viem names the chain in the client's configuration and not in the endpoint's
   * answer, so a resolver pointed at the wrong endpoint reports a confident answer
   * about a different chain. Under a wildcard parent that answer looks issued.
   */
  process.env.AGENT_IDENTITY_NAME = "agent1.xovi.eth";
  const wrong = await startFakeRpc("0x1");
  process.env.AGENT_ENS_RPC_URL = wrong.url;
  const refused = await ask(`?payer=${PAYER}`);
  check(refused.status === 503, "248 · an endpoint on another chain is refused");
  check(
    wrong.methods.length > 0 && wrong.methods.every(m => m === "eth_chainId"),
    `248a · and nothing was read from it, the chain id apart (${[...new Set(wrong.methods)].join(", ")})`,
  );
  await wrong.close();

  // The control: on the right chain the route goes on and attempts the resolution,
  // so 248a is about ordering and not about the fake refusing everything.
  const right = await startFakeRpc("0xaa36a7");
  process.env.AGENT_ENS_RPC_URL = right.url;
  const attempted = await ask(`?payer=${PAYER}`);
  check(
    right.methods.some(m => m !== "eth_chainId"),
    `249 · on the right chain the name is read (negative control, methods ${[...new Set(right.methods)].join(", ")})`,
  );
  check(attempted.status === 503, "249a · and a resolver that cannot answer is an outage rather than a missing name");
  await right.close();

  /*
   * A name that resolves, to somebody who is not asking.
   *
   * The case that matters most and the one nothing could reach: the fake endpoint
   * answers a chain id and cannot answer a resolution, so every check so far saw
   * either no name or no answer. Under a wildcard parent a resolving name is the
   * normal case and the payer is the only thing that separates issued to this
   * wallet from issued to another, which is why replacing the comparison with
   * `issued` left the suite green.
   */
  const good = await startFakeRpc("0xaa36a7");
  process.env.AGENT_ENS_RPC_URL = good.url;

  setNameResolverForTest(async () => "0xeCB4C1245665e8A1F43826355aaB0Dd6bF336e05");
  const somebodyElse = (await (await ask(`?payer=${PAYER}`)).json()) as { address: string | null; name: string | null; matches: boolean };
  /*
   * A WALLET WITH NO CLAIM ON THE NAME IS TOLD NOTHING ABOUT IT.
   *
   * This asserted the opposite until 2026-09-13: the configured name is the
   * fallback for a wallet with no row, so the route answered every stranger with
   * the name a deployment claims and the wallet it resolves to, beside
   * `matches: false`. Neither value is a secret and it was still this route
   * publishing them to somebody with no part in either.
   */
  check(somebodyElse.address === null && somebodyElse.name === null,
    `251 · a name resolving to somebody else is not served to the wallet asking (${somebodyElse.name}, ${somebodyElse.address})`);
  check(somebodyElse.matches === false, "251a · and does not match a payer it does not name");

  setNameResolverForTest(async () => PAYER);
  const owner = (await (await ask(`?payer=${PAYER}`)).json()) as { address: string | null; name: string | null; matches: boolean };
  check(owner.matches === true, "251b · while the payer it does name matches (negative control)");
  check(owner.name !== null && owner.address !== null,
    "251e · and that payer is served the name and the address it resolves to (negative control)");

  setNameResolverForTest(async () => "0x0000000000000000000000000000000000000000");
  const zero = (await (await ask(`?payer=${PAYER}`)).json()) as { address: string | null; matches: boolean };
  check(zero.matches === false && zero.address === null, "251c · and the zero address is an unissued name, not a match");

  setNameResolverForTest(async () => null);
  const none = (await (await ask(`?payer=${PAYER}`)).json()) as { matches: boolean };
  check(none.matches === false, "251d · as is no record at all");

  setNameResolverForTest(undefined);
  await good.close();

  // The rule on its own, without a route or a chain around it.
  check(matchesPayer(PAYER, PAYER), "252 · the rule matches an address against itself");
  check(!matchesPayer("0xeCB4C1245665e8A1F43826355aaB0Dd6bF336e05", PAYER), "252a · and refuses a different one");
  check(matchesPayer(PAYER.toLowerCase(), PAYER), "252b · while casing is not a difference (negative control)");

  if (rpcBefore === undefined) delete process.env.AGENT_ENS_RPC_URL;
  else process.env.AGENT_ENS_RPC_URL = rpcBefore;
  if (nameBefore === undefined) delete process.env.AGENT_IDENTITY_NAME;
  else process.env.AGENT_IDENTITY_NAME = nameBefore;
}
