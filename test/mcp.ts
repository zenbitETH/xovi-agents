import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_PAYMENT_META_KEY, MCP_PAYMENT_REQUIRED_CODE, MCP_PAYMENT_RESPONSE_META_KEY } from "@x402/mcp";
import { TOOL_NAME, atomicAmount, receiptFrom, recordMcpSettlement } from "../lib/mcp/server";
import { DELETE as mcpDELETE, GET as mcpGET, OPTIONS as mcpOPTIONS } from "../app/api/mcp/route";
import { payAndCall } from "../lib/mcp/pay";
import { createx402MCPClient } from "@x402/mcp";
import { findDefaultAsset } from "@x402/evm";
import { startFakeFacilitator } from "./facilitator";
import { startEmptyIndex } from "./index-stub";
import type { Receipt } from "../lib/human/store";

type Check = (ok: boolean, label: string) => void;

/**
 * The refusal, observed rather than described.
 *
 * The server is spawned and actually called, because the shape of this refusal is
 * the one thing about this leg that reading the package could not settle. The
 * types say a payment-required error exists and the wrapper does not use it: an
 * unpaid call comes back as a tool RESULT carrying `isError` and an x402 payload,
 * with no metadata at all. Nothing about that is visible in a declaration file.
 *
 * Offline. No facilitator is contacted, because nothing pays.
 */
const ENV = {
  X402_PAY_TO: "0x2Be7e36bF7B1A99999999999999999999999999b",
  X402_NETWORK: "eip155:84532",
  X402_PRICE: "$0.01",
  SUBGRAPH_URL: "http://127.0.0.1:9/none",
  ANCHOR_RPC_URL: "http://127.0.0.1:9/none",
};

export async function mcpChecks(check: Check) {
  // Each constant is asserted defined before anything is compared against it. A
  // renamed export is `undefined`, and `x[undefined]` returns undefined while
  // `code === undefined` compares false, so a negative assertion against a name
  // that no longer exists passes for the wrong reason.
  check(MCP_PAYMENT_REQUIRED_CODE === 402, "149 · the payment required code is defined and is 402");
  check(MCP_PAYMENT_META_KEY === "x402/payment", "150 · the request metadata key is defined");
  check(MCP_PAYMENT_RESPONSE_META_KEY === "x402/payment-response", "151 · the response metadata key is defined");
  check(atomicAmount("$0.01", 6) === "10000", "152 · a dollar price becomes the token's smallest unit");

  // The settlement hook, exercised. A hook that writes the ledger and is reached by
  // no check is the same shape as the defect it was written to fix.
  const written: Receipt[] = [];
  const fakeRecord = async (r: Receipt) => void written.push(r);
  const settlement = { transaction: "0xdeadbeef", network: "eip155:84532" };
  const authPayload = { payload: { authorization: { from: "0xpayer", to: "0xrecipient", value: "10000", nonce: "0xnonce" } } };

  check(await recordMcpSettlement(settlement, authPayload, "eip155:84532", fakeRecord) === true,
    "152b · a settled query records a receipt (seen to fail by dropping the call)");
  check(written.length === 1 && written[0].source === "mcp",
    "152c · under its own source, so two rails settling to one recipient leave rows that can be told apart");
  check(written[0].transactionHash === "0xdeadbeef" && written[0].payer === "0xpayer" && written[0].amount === "10000",
    "152d · carrying the settlement and the authorization rather than defaults");

  check(await recordMcpSettlement(settlement, { payload: {} }, "eip155:84532", fakeRecord) === false,
    "152e · a payload with no authorization writes nothing rather than a row naming nobody");
  check(await recordMcpSettlement({}, authPayload, "eip155:84532", fakeRecord) === false,
    "152f · and a settlement with no transaction writes nothing either");
  check(written.length === 1, "152g · so the ledger still holds exactly the one real receipt");

  // Where the receipt actually is, pinned. The server attaches it to metadata and
  // the paying client consumes that and re-exposes it, so the exported metadata
  // helper returns null on a call that settled. A client reading only the helper
  // prints "no receipt" for a payment that happened.
  check(receiptFrom({ paymentResponse: { transaction: "0xabc", network: "eip155:84532" } })?.transaction === "0xabc",
    "152h · the receipt is read from the client's own field, which is where a paid call puts it (seen to fail)");
  check(receiptFrom({ _meta: { "x402/payment-response": { transaction: "0xdef" } } })?.transaction === "0xdef",
    "152i · and from metadata too, for a raw result the client never touched");
  check(receiptFrom({ content: [] }) === null && receiptFrom({ paymentResponse: {} }) === null,
    "152j · and a call that settled nothing reports nothing rather than an empty object");

  // The stream that could never carry a message. A stateless server rebuilt per
  // request cannot send anything down a GET, so accepting one holds an invocation
  // open to do nothing, and an open origin is what makes that reachable from any
  // page in any visitor's browser. Timed, because answering 405 slowly is still an
  // invocation somebody else is holding.
  const started = Date.now();
  const got = await mcpGET();
  const elapsed = Date.now() - started;
  check(got.status === 405, "153a · a GET is refused rather than held open on a server that can never answer it");
  check(elapsed < 1000, `153b · and refused in milliseconds (${elapsed}ms), since a slow refusal is still a held invocation (seen to fail)`);
  check(got.headers.get("Allow") === "POST, OPTIONS", "153c · naming what this server does accept");
  check((await mcpDELETE()).status === 405, "153d · and a DELETE too, there being no session to delete");
  check(mcpOPTIONS().headers.get("Access-Control-Allow-Methods") === "POST, OPTIONS",
    "153e · and the advertised methods match, so a browser is not invited to try the refused ones");

  // The retry, against the REAL client over stdio against the real server.
  //
  // The previous version of these checks used a fake client that returned the
  // challenge as a tool result. The installed client does not do that: with
  // automatic payment off it THROWS, carrying the challenge on the error. So the
  // fake modelled a boundary nobody had observed, the checks were green, and the
  // shipped client could not pay at all. The fake now sits only where something was
  // observed: the scheme, which is where a signature is created, and the
  // counterparty, which is what flakes.
  const idx = await startEmptyIndex();
  const fac3 = await startFakeFacilitator();
  const signing = { signatures: 0 };
  const countingScheme = {
    scheme: "exact",
    // The real scheme carries this and the client's spend controls call it to decide
    // whether an asset is a known default. A fake without it is rejected before any
    // payload is created, which is the shape of modelling a boundary partially.
    findDefaultAsset,
    async createPaymentPayload() {
      // Counting HERE is the point. A retry that re-signs sends the right number of
      // requests and creates the wrong number of signatures, so a counter on sends
      // is green with the bug in place.
      signing.signatures++;
      return {
        x402Version: 2,
        payload: {
          signature: `0x${"ab".repeat(65)}`,
          authorization: {
            from: `0x${"11".repeat(20)}`,
            to: `0x${"22".repeat(20)}`,
            value: "10000",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 600),
            nonce: `0x${"33".repeat(32)}`,
          },
        },
      };
    },
  };

  const paying = createx402MCPClient({
    name: "suite-payer",
    version: "0",
    schemes: [{ network: "eip155:84532" as never, client: countingScheme as never }],
    autoPayment: false,
  });
  await paying.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "bin/mcp-server.ts"],
      env: { ...process.env, ...ENV, SUBGRAPH_URL: idx.url, X402_FACILITATOR_URL: fac3.url } as Record<string, string>,
    }),
  );

  fac3.settleFailuresRemaining = 1;
  const rode = await payAndCall(paying as never, TOOL_NAME, { limit: 1 }, async () => {});
  check(signing.signatures === 1,
    "153f · one signature for the whole call, however many times it is sent (seen to fail)");
  check(fac3.hits.settle === 2, "153g · the counterparty was reached twice, so the flake was ridden out");
  check(new Set(fac3.settleBodies).size === 1, "153h · and both attempts carried the same authorization");
  check(rode.log.length === 2 && rode.log[0].outcome === "settle_failed" && rode.log[1].outcome === "settled",
    "153i · with every attempt logged by its real index");

  fac3.reset();
  signing.signatures = 0;
  fac3.settleSucceeds = false;
  const gaveUp = await payAndCall(paying as never, TOOL_NAME, { limit: 1 }, async () => {});
  check(fac3.hits.settle === 3 && signing.signatures === 1,
    "153j · a counterparty that never lands is tried three times and signed for once");
  check(gaveUp.receipt === null && gaveUp.log.length === 3,
    "153k · and gives up rather than paying again");

  await paying.close();
  await fac3.close();
  await idx.close();

  const client = new Client({ name: "suite", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "bin/mcp-server.ts"],
      env: { ...process.env, ...ENV } as Record<string, string>,
    }),
  );

  const tools = await client.listTools();
  check(tools.tools.some(t => t.name === TOOL_NAME), "153 · the tool is offered before anything is paid");

  const result = (await client.callTool({ name: TOOL_NAME, arguments: { limit: 1 } })) as {
    isError?: boolean;
    content?: { type: string; text?: string }[];
    _meta?: Record<string, unknown>;
  };

  check(result.isError === true, "154 · an unpaid call is refused as a tool result, not as a thrown error");
  const text = result.content?.[0]?.text ?? "";
  let payload: { x402Version?: number; accepts?: { amount?: string; asset?: string; payTo?: string }[]; resource?: { url?: string } } = {};
  try {
    payload = JSON.parse(text);
  } catch {
    /* left empty, and the checks below fail on it */
  }
  check(payload.x402Version === 2, "155 · the refusal carries an x402 v2 challenge in its content");
  check(
    Boolean(payload.accepts?.[0]?.amount) && Boolean(payload.accepts?.[0]?.asset),
    "156 · with an amount and an asset, which a price shorthand would have left empty (seen to fail)",
  );
  check(payload.accepts?.[0]?.amount === "10000", "157 · the amount is the price in the token's smallest unit");
  check(payload.resource?.url === `mcp://tool/${TOOL_NAME}`, "158 · and the resource names this tool rather than a default");
  check(result._meta === undefined, "159 · the refusal carries no metadata, so a check reading it would find nothing and agree");

  await client.close();
}
