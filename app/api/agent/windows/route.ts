import { NextResponse } from "next/server";
import { applyEmbargo } from "~~/lib/windows/embargo";
import { SnapshotUnavailable, loadSnapshot } from "~~/lib/windows/snapshot";
import { PaymentMisconfigured, WINDOWS_ROUTE, adapterFor, buildServer, paymentHeaderFrom } from "~~/lib/x402";

export const dynamic = "force-dynamic";

/** Paid responses are per-caller and must never be stored by a shared cache: the
 *  body is what was bought, and a CDN holding it would serve the next caller for
 *  free. Applied to the refusals too, so a 402 challenge is never cached either. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function refuse(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

/**
 * Sell a look at where something moved.
 *
 * What is sold is the derivation, not the footage: a window is a span of a
 * livestream anyone can already watch, so serving one discloses nothing new. The
 * product is that a detector looked and decided this span was worth a person's
 * attention, and declined to say what caused the motion.
 *
 * The endpoint does not claim behaviour, and the wording matters because the
 * detector cannot tell an animal from an operator's hand: the appearance signal
 * reads the same for both. A window may contain a person.
 */
export async function GET(request: Request) {
  const { header, sentV1Only } = paymentHeaderFrom(request);
  if (sentV1Only) {
    // v2 would ignore X-PAYMENT silently and answer 402 as though nothing had
    // been sent, leaving a correctly built v1 client with no way to learn why.
    return refuse(402, "Este servidor habla x402 v2: la firma viaja en PAYMENT-SIGNATURE, no en X-PAYMENT", {
      hint: "x402 v2",
    });
  }

  let server;
  try {
    server = await buildServer();
  } catch (err) {
    if (err instanceof PaymentMisconfigured) {
      // Fails closed. An endpoint that cannot charge does not become free.
      return refuse(503, "El cobro no está configurado, así que esta ruta no atiende");
    }
    // The facilitator was unreachable at startup. Also closed, and distinguished
    // from a rejection so an operator can tell an outage from an attack.
    return refuse(503, "El facilitador no está disponible");
  }

  const result = await server.processHTTPRequest({
    adapter: adapterFor(request),
    path: new URL(request.url).pathname,
    method: "GET",
    paymentHeader: header,
    routePattern: WINDOWS_ROUTE,
  });

  // The 402 challenge, or a rejected payment. Returned verbatim: the protocol
  // owns this response, including the empty object body that v2 specifies.
  if (result.type === "payment-error") {
    return NextResponse.json(result.response.body ?? {}, {
      status: result.response.status,
      headers: { ...result.response.headers, ...NO_STORE },
    });
  }

  // The work happens HERE, between verification and settlement, so that a failure
  // in it cannot be paid for. Nothing below this line settles unless it returns.
  let payload;
  try {
    const all = loadSnapshot();
    const { kept, dropped } = applyEmbargo(all);
    payload = {
      schema: "xovi/candidate-window/v1",
      windows: kept,
      // Deliberately not a count of what was withheld. Publishing "3 dropped"
      // tells a caller who knows the roster exactly how many embargoed animals
      // were active, which is the thing the embargo exists to withhold.
      served: kept.length,
      note: "A window marks where something moved and a person should look. It is not a claim that a behaviour occurred, that an animal was identified, or that confidence is a probability.",
    };
    void dropped;
  } catch (err) {
    const why = err instanceof SnapshotUnavailable ? err.message : "unexpected";
    // Payment was verified and is NOT settled: the caller keeps their money
    // because they did not get what they paid for.
    return refuse(503, "No hay instantánea de ventanas disponible", { detail: why });
  }

  if (result.type === "no-payment-required") {
    return NextResponse.json(payload, { headers: NO_STORE });
  }

  const settled = await server.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
    { request: { adapter: adapterFor(request), path: new URL(request.url).pathname, method: "GET" } },
    undefined,
    result.beforeHandlerSettlement,
  );

  if (!settled.success) {
    // The content is withheld when settlement fails. Serving it anyway would make
    // the payment optional in practice, whatever the 402 said.
    //
    // The receipt goes back with it. Without those headers the caller sees a 402
    // that is neither a challenge nor a receipt, and cannot tell a refusal it should
    // stop on from one it should retry later. That distinction is the whole of what
    // a delegated agent needs in order to behave.
    return NextResponse.json(
      { error: "El pago no se liquidó", reason: settled.errorReason },
      { status: 402, headers: { ...settled.headers, ...NO_STORE } },
    );
  }

  return NextResponse.json(payload, { headers: { ...settled.headers, ...NO_STORE } });
}
