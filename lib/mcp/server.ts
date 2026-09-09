import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { getDefaultAsset } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { parseUnits } from "viem";
import { createPaymentWrapper, createToolResourceUrl } from "@x402/mcp";
import { authorizationFrom, recordSettlement } from "../human/cap";
import { type EnvLike, PaymentMisconfigured, readConfig } from "../x402";
import { QueryUnavailable, fetchObservations } from "./observations";

export const TOOL_NAME = "observations";

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
 * The refusal here is NOT a header. A challenge is a JSON-RPC error carrying the
 * payment-required code, the payment arrives in request metadata and the receipt
 * leaves in result metadata, and those are three different mechanisms. Anything
 * asserting on an HTTP header is testing a surface this protocol does not use.
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
      onAfterSettlement: async ({ settlement, paymentPayload }) => {
        const a = authorizationFrom(paymentPayload as { payload?: unknown });
        if (!a) return;
        const s = settlement as { transaction?: string; network?: string };
        if (!s.transaction) return;
        await recordSettlement({
          nonce: a.nonce,
          transactionHash: s.transaction,
          payer: a.from,
          payTo: a.to,
          amount: a.value,
          network: s.network ?? cfg.network,
          source: "mcp",
        });
      },
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
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 50);
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
