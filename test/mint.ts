import { createServer } from "node:http";
import { createHash } from "node:crypto";

/**
 * The reviewing application's mint route, faked on localhost.
 *
 * `POST /api/ingest/keys` under a shared secret, body `{ agentAddress, label }`,
 * answering the credential once on the call that mints it and only the prefix
 * afterwards, idempotent per address. Every call is kept, header and body, so the
 * checks can say what travelled on this wire and that nothing else did.
 *
 * `keys` maps each minted credential to the address it was bound to, and the
 * fake ingest reads the same map to say whose credential it was presented: that
 * is the binding the real route enforces when it writes a clip's submitter.
 */
export type FakeMint = {
  url: string;
  origin: string;
  secret: string;
  calls: { authorization: string | undefined; contentType: string | undefined; body: Record<string, unknown> }[];
  /** Credential to address, for every credential minted. */
  keys: Map<string, string>;
  /** Answer only the prefix even on a first call, as a route would for an
   *  address minted before this deployment kept rows. */
  prefixOnly: boolean;
  reset(): void;
  close(): Promise<void>;
};

export async function startFakeMint(secret = "mint-secret-for-the-checks"): Promise<FakeMint> {
  const state = {
    calls: [] as FakeMint["calls"],
    keys: new Map<string, string>(),
    minted: new Map<string, string>(),
    prefixOnly: false,
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c as Buffer));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = {};
      }
      state.calls.push({ authorization: req.headers.authorization, contentType: req.headers["content-type"], body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method !== "POST" || new URL(req.url ?? "/", "http://x").pathname !== "/api/ingest/keys") return send(404, { error: "not found" });
      if (req.headers.authorization !== `Bearer ${secret}`) return send(401, { error: "Clave de acuñación inválida" });
      const address = String(body.agentAddress ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) return send(400, { error: "agentAddress" });
      const prefix = createHash("sha256").update(address).digest("hex").slice(0, 12);
      if (state.minted.has(address) || state.prefixOnly) return send(200, { prefix });
      const key = `xvi_${prefix}_${createHash("sha256").update(`secret:${address}`).digest("hex")}`;
      state.minted.set(address, key);
      state.keys.set(key, address);
      return send(201, { key, prefix });
    });
  });
  server.unref();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake mint did not bind a port");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/api/ingest/keys`,
    origin,
    secret,
    get calls() {
      return state.calls;
    },
    get keys() {
      return state.keys;
    },
    get prefixOnly() {
      return state.prefixOnly;
    },
    set prefixOnly(v: boolean) {
      state.prefixOnly = v;
    },
    reset() {
      state.calls.length = 0;
      state.keys.clear();
      state.minted.clear();
      state.prefixOnly = false;
    },
    close() {
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
