import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { getDefaultAsset } from "@x402/evm";
import { z } from "zod";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { parseUnits } from "viem";
import { createPaymentWrapper, createToolResourceUrl } from "@x402/mcp";
import { authorizationFrom, recordSettlement } from "../human/cap";
import { type EnvLike, PaymentMisconfigured, readConfig } from "../x402";
import { QueryUnavailable, fetchObservations } from "./observations";

export const TOOL_NAME = "observations";

/**
 * The most rows one paid call will answer with.
 *
 * The same number on every transport. The query costs one index fetch plus one
 * contract read per row, so a large limit is a long invocation, and a cap that
 * differed between the local and the networked path would make the offline checks
 * stop being evidence about the deployed one.
 */
export const MAX_LIMIT = 10;

/**
 * Writes the receipt for a settled query, and is exported so it can be exercised.
 *
 * A hook that writes the ledger and is reached by no check is the same shape as the
 * defect it was written to fix, one level in: settling without recording was
 * invisible because nothing looked, and an untested hook is invisible for the same
 * reason. `record` is injectable for exactly that.
 *
 * Returns whether a receipt was attempted, so a check can tell "wrote nothing
 * because there was nothing to write" from "wrote nothing because the call was
 * dropped".
 */
export async function recordMcpSettlement(
  settlement: unknown,
  paymentPayload: unknown,
  fallbackNetwork: string,
  record: typeof recordSettlement = recordSettlement,
): Promise<boolean> {
  const a = authorizationFrom((paymentPayload ?? {}) as { payload?: unknown });
  if (!a) return false;
  const s = (settlement ?? {}) as { transaction?: string; network?: string };
  if (!s.transaction) return false;
  await record({
    nonce: a.nonce,
    transactionHash: s.transaction,
    payer: a.from,
    payTo: a.to,
    amount: a.value,
    network: s.network ?? fallbackNetwork,
    source: "mcp",
  });
  return true;
}

export class QueryMisconfigured extends Error {}

/** "$0.01" as the token's smallest unit. The dollar syntax is the repository's own
 *  convention for the price, and the wire wants an integer string. */
export function atomicAmount(price: string, decimals: number): string {
  const m = /^\$?([0-9]+(?:\.[0-9]+)?)$/.exec(price.trim());
  if (!m) throw new QueryMisconfigured(`X402_PRICE is not an amount: ${price}`);
  return parseUnits(m[1], decimals).toString();
}

/**
 * The paid query, on the same rail as the paid read.
 *
 * Same facilitator, same recipient, same network, read through the same
 * `readConfig` rather than a second copy, because two configurations for one
 * payment rail is how a demo ends up charging to an address nobody funded.
 *
 * The refusal here is a TOOL RESULT, measured rather than inferred. An unpaid call
 * comes back with `isError` set and an x402 challenge in its text content, and with
 * no metadata at all. The package exports a payment-required error and a 402 code
 * and this wrapper calls neither, so a check written from the declarations would
 * assert on a mechanism the server never uses. Checks 154 to 159 pin the shape,
 * including that the refusal carries no metadata, since a check reading metadata
 * would find nothing and agree. The payment arrives in request metadata and the
 * receipt leaves in result metadata; three mechanisms, none of them a header.
 */
export function buildPaidTool(env: EnvLike = process.env) {
  const cfg = readConfig(env);
  const subgraphUrl = env.SUBGRAPH_URL;
  const rpcUrl = env.ANCHOR_RPC_URL;
  // Fails closed and separately from the payment configuration, so an operator is
  // told which half is missing rather than being handed one message for both.
  if (!subgraphUrl) throw new QueryMisconfigured("SUBGRAPH_URL is not set");
  if (!rpcUrl) throw new QueryMisconfigured("ANCHOR_RPC_URL is not set");

  const core = new x402ResourceServer(new HTTPFacilitatorClient({ url: cfg.facilitatorUrl }));
  registerExactEvmScheme(core);

  // The HTTP resource server takes a `price` shorthand and works out the asset and
  // the atomic amount itself. This wrapper does not: it takes payment requirements
  // as they go on the wire, so an entry carrying `price` would advertise a
  // challenge with no amount and no asset at all. That is worth stating because a
  // type assertion silences it and the result still starts and still answers.
  const asset = getDefaultAsset(cfg.network);

  const paid = createPaymentWrapper(core, {
    accepts: [
      {
        scheme: "exact",
        network: cfg.network,
        amount: atomicAmount(cfg.price, asset.decimals),
        asset: asset.asset,
        payTo: cfg.payTo,
        // How long a signed authorisation stays good for. Required here, unlike on
        // the http path where the server fills it in, and the compiler only asks
        // once the requirement is typed rather than asserted.
        maxTimeoutSeconds: 300,
        // The token's EIP-712 domain. The exact scheme signs a transfer
        // authorisation against it, and a wrong name or version yields a
        // signature the facilitator rejects for reasons that read as a network
        // problem.
        extra: { name: asset.name, version: asset.version },
      },
    ],
    hooks: {
      // Settling without recording was the audit's second Medium. The paid read
      // writes a receipt and this rail did not, so two surfaces settled to one
      // recipient and only one of them left a row. The write is best effort and
      // never changes the answer: the caller has paid and been served, and failing
      // them over bookkeeping would be the larger wrong, which is the same rule the
      // read follows.
      onAfterSettlement: async ({ settlement, paymentPayload }) =>
        void (await recordMcpSettlement(settlement, paymentPayload, cfg.network)),
    },
    resource: {
      // Without this the payload advertises `mcp://tool/paid_tool`, because the
      // wrapper never learns the tool's name. Observed on the wire, not inferred.
      url: createToolResourceUrl(TOOL_NAME),
      description: "Confirmed clip observations, with the reviewer's signature checked against the attested fields",
      mimeType: "application/json",
      serviceName: "xovi-agents",
    },
  });

  const handler = paid<{ limit?: number }>(async args => {
    const limit = Math.min(Math.max(args.limit ?? 5, 1), MAX_LIMIT);
    // The work happens between verification and settlement, exactly as on the paid
    // read, so a failure here cannot be charged for.
    const answers = await fetchObservations(subgraphUrl, rpcUrl, limit);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              observations: answers,
              // An empty answer is a real answer and must not read as a broken one.
              // Until the schema is registered and a confirmed clip is anchored and
              // the index has caught up, this is legitimately empty, and a caller
              // who paid and received nothing is owed the difference between "the
              // index answered and holds no rows" and "the index did not answer",
              // which is an error and arrives as one.
              empty: answers.length === 0
                ? "The index answered and holds no observations under this schema yet. Nothing has been anchored, or the index has not caught up. This is not an error; an unreachable index raises instead."
                : undefined,
              note: "An attestation asserts that a reviewer signed a decision about a clip. It does not assert that the clip depicts anything in particular. Rebuild the message from the template in docs/spec/05 and recover the address yourself rather than trusting signatureMatchesVerifier.",
            },
            null,
            1,
          ),
        },
      ],
    };
  });

  return { core, handler, price: cfg.price, network: cfg.network, payTo: cfg.payTo };
}

export { PaymentMisconfigured, QueryUnavailable };

/**
 * Registers the tool on a server, whichever transport that server is speaking.
 *
 * One definition, called by both entry points. Two registrations would let the
 * local path and the deployed path drift, and the offline checks would then be
 * evidence about a tool nobody reaches.
 */
export function registerObservationsTool(
  server: { tool: (n: string, d: string, schema: unknown, cb: unknown) => unknown },
  env: EnvLike = process.env,
) {
  const { handler, price } = buildPaidTool(env);
  server.tool(
    TOOL_NAME,
    `Confirmed clip observations, with the reviewer's signature checked (${price} per call, up to ${MAX_LIMIT})`,
    { limit: z.number().int().min(1).max(MAX_LIMIT).optional() },
    handler,
  );
}
