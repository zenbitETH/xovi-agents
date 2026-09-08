import { createServer } from "node:http";

/**
 * The clip ingest route, faked on localhost.
 *
 * The real one lives in a private repository this code cannot change, which is
 * the reason for a fake rather than a mock: the contract is on the other side of
 * a boundary, so it is copied deliberately and in one place, and every shape here
 * was read from that route rather than guessed. The refusals it reproduces are the
 * ones a proposing agent has to tell apart.
 *
 * It also keeps every body it was sent. Two of the client's obligations are about
 * fields that must NOT arrive, and an assertion about absence has to be made where
 * the request lands, not where it is built.
 */
export type FakeIngest = {
  url: string;
  hits: number;
  /** Every body received, parsed. Absence assertions read this. */
  bodies: Record<string, unknown>[];
  /** What the next request gets. Defaults to a created clip. */
  outcome: "created" | "rejected" | "duplicate" | "badStation" | "noTarget" | "badKey" | "throttled" | "oddConflict";
  reset(): void;
  close(): Promise<void>;
};

const CLIP_HASH = `0x${"ab".repeat(32)}`;

export async function startFakeIngest(): Promise<FakeIngest> {
  const state = {
    hits: 0,
    bodies: [] as Record<string, unknown>[],
    outcome: "created" as FakeIngest["outcome"],
    nextId: 1,
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c as Buffer));
    req.on("end", () => {
      state.hits++;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = {};
      }
      state.bodies.push(body);

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (!/^bearer\s/i.test(req.headers.authorization ?? "")) {
        return send(401, { error: "Clave de ingesta inválida" });
      }
      // Reproduced from the real route rather than invented. A machine claiming
      // human provenance is refused, never silently overwritten, so a caller that
      // tried finds out that it tried.
      if (body.source !== undefined && body.source !== "cv") {
        return send(403, {
          error: "Una máquina no puede declarar procedencia humana: esa procedencia significa que alguien responde",
        });
      }
      switch (state.outcome) {
        case "throttled":
          res.writeHead(429, { "content-type": "application/json", "retry-after": "3600" });
          return res.end(JSON.stringify({ error: "Demasiadas solicitudes" }));
        case "oddConflict":
          // A 409 from something that is not this route: a proxy, a gateway, a
          // firewall. No retryable flag, so no decision may be inferred from it.
          return send(409, { error: "conflict" });
        case "badKey":
          return send(401, { error: "Clave de ingesta inválida" });
        case "badStation":
          return send(403, { error: `La clave no cubre la estación ${String(body.stationId)}` });
        case "noTarget":
          return send(422, { error: "El objetivo del clip no existe" });
        case "duplicate":
          return send(409, { error: "Clip duplicado", clipHash: CLIP_HASH, retryable: true });
        case "rejected":
          return send(409, {
            error: "Esta propuesta ya fue rechazada por una persona",
            clipHash: CLIP_HASH,
            retryable: false,
          });
        default:
          // status and source are server-derived and echoed back, which is what
          // makes them worth asserting: the client never sent either one.
          return send(201, { id: state.nextId++, clipHash: CLIP_HASH, status: "pending", source: "cv" });
      }
    });
  });

  // Unreferenced so a throw between listen and close fails the suite fast instead
  // of holding the event loop open and looking like a hang.
  server.unref();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake ingest did not bind a port");

  return {
    url: `http://127.0.0.1:${address.port}/api/ingest/clips`,
    get hits() {
      return state.hits;
    },
    get bodies() {
      return state.bodies;
    },
    get outcome() {
      return state.outcome;
    },
    set outcome(v: FakeIngest["outcome"]) {
      state.outcome = v;
    },
    reset() {
      state.hits = 0;
      state.bodies.length = 0;
      state.outcome = "created";
    },
    close() {
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
