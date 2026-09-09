import { createServer } from "node:http";

/** An index that is reachable and holds nothing, which is the state until a schema
 *  is registered and a clip anchored. The query needs one to reach settlement. */
export async function startEmptyIndex(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { observations: [] } }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(r => server.close(() => r())),
  };
}
