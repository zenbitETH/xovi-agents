import { GET as windowsRoute } from "../windows/route";
import type { RunStep } from "~~/lib/agent/run";
import { credentialFor, credentialStoreFrom } from "~~/lib/agent/credentials";
import { DECLINE_SENTENCE, namesACell, payerFromHeader, runOnce, runOutcome, windowsUrlFor } from "~~/lib/agent/run";
import { recordRun, runsStoreFrom } from "~~/lib/agent/runs-store";

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

  /*
   * A run is one cell, and a request that names none is refused.
   *
   * It used to be served the whole snapshot, which is the defect this route was
   * fixed for: a person chose a cell, signed a challenge for that cell and read
   * every day there was. Refusing is the honest floor, since the page never sends
   * a run without a cell and anything else arriving here is not the product.
   */
  if (!namesACell(request.url)) {
    return new Response(JSON.stringify({ error: "name the day and the species this run reads" }), {
      status: 400,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

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

  const asked = new URL(request.url);
  const cell = { day: asked.searchParams.get("day") ?? "", species: asked.searchParams.get("species") ?? "" };

  const encoder = new TextEncoder();
  /*
   * Kept so the run can be recorded once it has finished.
   *
   * The steps are the run, and what is written afterwards is derived from them
   * rather than assembled alongside them, so the row and the stream cannot come
   * to different conclusions about the same run.
   */
  const walked: RunStep[] = [];
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const step of steps) {
          walked.push(step);
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
        /*
         * The run is recorded after it has been delivered, and never before.
         *
         * Nothing about the answer depends on this write: a person who paid has
         * been served whatever happens here, and failing their run over a row on
         * the board would be the larger wrong, which is the same rule the receipt
         * ledger works under. A run the route never served leaves no row at all,
         * because the mark on the board says this cell was read by your agent and
         * a refused payment read nothing.
         */
        await recordRun({
          outcome: runOutcome(walked),
          payer: payerFromHeader(paymentHeader),
          day: cell.day,
          species: cell.species,
          store: runsStoreFrom(),
          at: new Date(),
        });
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
