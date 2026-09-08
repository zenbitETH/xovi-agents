import { createServer } from "node:http";

/**
 * A facilitator that answers on localhost, so the route can be driven end to end
 * without money and without the network.
 *
 * This exists because the property that matters most about the paid route cannot
 * be checked by reading it. "Settle only when the handler succeeded" is a claim
 * about what happens between two calls, and a grep over route.ts proves the order
 * of the text rather than the order of the calls. Counting the hits on /verify and
 * /settle proves the behaviour.
 *
 * The client contacts exactly three paths (@x402/core server/index.js, the fetch
 * calls at /verify, /settle and /supported) and validates each reply against a zod
 * schema in that same file. The shapes below are copied from those schemas rather
 * than guessed, which is why /settle carries a transaction even when it reports
 * failure: settleResponseSchema requires the field in both cases.
 *
 * What this does NOT prove: that a real facilitator rejects a forged signature, or
 * that any USDC moves. This one believes everything it is told. That is criterion
 * 2 and it belongs to the live probe with a funded payer.
 */
export type FakeFacilitator = {
  url: string;
  hits: { supported: number; verify: number; settle: number };
  /** Flip to make /settle report a refusal, keeping the schema valid. */
  settleSucceeds: boolean;
  reset(): void;
  close(): Promise<void>;
};

const NETWORK = "eip155:84532";
const FAKE_TX = `0x${"11".repeat(32)}`;

export async function startFakeFacilitator(): Promise<FakeFacilitator> {
  const state = {
    hits: { supported: 0, verify: 0, settle: 0 },
    settleSucceeds: true,
  };

  const server = createServer((req, res) => {
    // The body is drained even though nothing here reads it: leaving a request
    // body unconsumed keeps the socket open and the suite hangs at the end
    // instead of failing, which is the least useful way for a test to break.
    req.resume();
    const path = (req.url ?? "").split("?")[0];
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (path.endsWith("/supported")) {
      state.hits.supported++;
      return send({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} });
    }
    if (path.endsWith("/verify")) {
      state.hits.verify++;
      return send({ isValid: true, payer: undefined });
    }
    if (path.endsWith("/settle")) {
      state.hits.settle++;
      if (state.settleSucceeds) {
        return send({ success: true, transaction: FAKE_TX, network: NETWORK });
      }
      // transaction and network are required by settleResponseSchema even on a
      // refusal, so a failure that omits them is rejected as malformed and the
      // route reports a parse error rather than the refusal it was handed.
      return send({ success: false, errorReason: "insufficient_funds", transaction: FAKE_TX, network: NETWORK });
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `no route for ${path}` }));
  });

  // Unreferenced so a throw between listen and close fails the suite fast instead
  // of holding the event loop open and looking like a hang.
  server.unref();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake facilitator did not bind a port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    get hits() {
      return state.hits;
    },
    get settleSucceeds() {
      return state.settleSucceeds;
    },
    set settleSucceeds(v: boolean) {
      state.settleSucceeds = v;
    },
    reset() {
      state.hits.supported = 0;
      state.hits.verify = 0;
      state.hits.settle = 0;
      state.settleSucceeds = true;
    },
    close() {
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
