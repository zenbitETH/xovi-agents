import { GET as windowsRoute } from "../windows/route";
import { credentialFor, credentialStoreFrom } from "~~/lib/agent/credentials";
import { DECLINE_SENTENCE, runOnce, windowsUrlFor } from "~~/lib/agent/run";

export const dynamic = "force-dynamic";

/**
 * One delegated run, streamed while it happens.
 *
 * The stream IS the work rather than a channel opened beside it. That distinction
 * is the whole design and it is not a preference: a stream on a separate request
 * from the work is an invocation held open on a stateless server, because nothing
 * can ever write to it, which is the failure this repository already hit and fixed
 * on the MCP transport. Here one invocation owns both the work and the writes, so
 * there is no shared state to keep, nothing to poll, no database required, and no
 * assumption that two requests reach the same instance. Functions are not sticky
 * and this design never needs them to be.
 *
 * The paid route is called IN PROCESS, as an imported handler. A self fetch over
 * the network would have worked in development and would have been wrong: it costs
 * a second invocation, it needs the deployment to be able to reach its own public
 * URL, and it puts a proxy between the settlement and the receipt for no gain. The
 * checks drive the same handler the same way.
 *
 * What the caller supplies is a signature and nothing else. No text, no station,
 * no time range, no window choice: the agent selects from what the server already
 * holds and forms the proposal server side from the window it read. So the input
 * space reaching the ingest surface is unchanged by this route existing, and what
 * changes is how often it is reached, which is what the per person cap governs.
 */
export async function POST(request: Request) {
  const paymentHeader = request.headers.get("PAYMENT-SIGNATURE") ?? undefined;

  // Same origin, so both halves name the same resource without a second place to
  // configure it. Not a security boundary: see windowsUrlFor.
  const windowsUrl = windowsUrlFor(request.url);

  const steps = runOnce({
    windowsUrl,
    paymentHeader,
    ingestUrl: process.env.XOVI_INGEST_URL,
    // Read here and never sent anywhere but the ingest route. It is why the run
    // happens on this side: a browser holding this key could propose without
    // paying, and a stranger's wallet must not become a credential. The
    // environment's key belongs to one wallet; every other wallet proposes with
    // the credential minted for it at enrolment, decrypted for the header only.
    ingestKey: process.env.XOVI_INGEST_KEY,
    ingestKeyPayer: process.env.XOVI_INGEST_KEY_PAYER,
    credentialFor: payer => credentialFor(payer, credentialStoreFrom()),
    windowsFetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return windowsRoute(new Request(url, init));
    },
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const step of steps) {
          // Newline delimited JSON. One object per line, so a reader can act on
          // each step as it arrives instead of waiting for a parseable whole.
          controller.enqueue(encoder.encode(`${JSON.stringify(step)}\n`));
        }
      } catch (err) {
        // A run that dies mid stream has already sent the steps that succeeded, so
        // the last line says what stopped it rather than the connection simply
        // ending and leaving the reader to guess.
        //
        // The class, never the message. A thrown message is written by whatever
        // threw it and can carry anything it happened to be holding, which on this
        // path is a window, a station or a credential. The name is a fixed set.
        console.error("[run] stopped:", err);
        const kind = err instanceof Error ? err.name : "Error";
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ step: "declined", kind: "error", detail: DECLINE_SENTENCE.error, status: undefined, name: kind })}\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // The run is per caller and paid for. Nothing shared may hold it.
      "cache-control": "private, no-store",
      // Proxies that buffer would collect the whole run and deliver it at once,
      // which renders the same bytes and destroys the only thing this is for.
      "x-accel-buffering": "no",
    },
  });
}
