import { decodeAbiParameters } from "viem";
import { attestationData, publicClientFor } from "../anchor/eas";
import { OBSERVATION_ABI } from "../anchor/observation";
import { signedBy } from "../anchor/confirmation";
import { DECISION_WORD, type DecisionCode, schemaUid } from "../anchor/schema";

export class QueryUnavailable extends Error {}

/**
 * What the paid query answers with.
 *
 * Deliberately more than the index holds. An index can only say that an
 * attestation exists under our schema; what a caller wants is the confirmation
 * itself and whether it checks out, so this walks the reachability path on their
 * behalf: the index for the identifier, the chain for the attested fields, and a
 * recovery against the published template. That last field is the product.
 */
export type Answer = {
  uid: string;
  attester: string;
  attestedAt: string;
  clipId: number;
  clipHash: string;
  decision: string;
  verifier: string;
  verifierChainId: number;
  confidence: number;
  /** Recovered here and reported, never asserted. A caller can redo it from the
   *  same fields and the template in the specification, and should. */
  signatureMatchesVerifier: boolean;
};

const QUERY = `query Observations($schema: Bytes!, $first: Int!) {
  observations(where: { schemaUID: $schema }, first: $first, orderBy: attestedAt, orderDirection: desc) {
    id
    attester
    attestedAt
  }
}`;

export async function fetchObservations(
  subgraphUrl: string,
  rpcUrl: string,
  limit: number,
): Promise<Answer[]> {
  const res = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { schema: schemaUid(), first: limit } }),
  });
  if (!res.ok) throw new QueryUnavailable(`the index answered ${res.status}`);
  const body = (await res.json()) as { data?: { observations?: { id: string; attester: string; attestedAt: string }[] }; errors?: unknown };
  // A GraphQL endpoint answers 200 with an errors array, so a status check alone
  // would read a failure as an empty result and report "nothing found".
  if (body.errors) throw new QueryUnavailable(`the index returned errors: ${JSON.stringify(body.errors)}`);
  const rows = body.data?.observations ?? [];

  const client = publicClientFor(rpcUrl);
  const out: Answer[] = [];
  for (const row of rows) {
    const onchain = await attestationData(client, row.id as `0x${string}`);
    const f = decodeAbiParameters(OBSERVATION_ABI, onchain.data);
    const decision = DECISION_WORD[Number(f[2]) as DecisionCode];
    out.push({
      uid: row.id,
      attester: row.attester,
      attestedAt: row.attestedAt,
      clipId: Number(f[0]),
      clipHash: f[1],
      decision: decision ?? `unknown(${f[2]})`,
      verifier: f[3],
      verifierChainId: Number(f[6]),
      confidence: Number(f[9]),
      signatureMatchesVerifier: await signedBy(
        { clipId: Number(f[0]), clipHash: f[1], decision: Number(f[2]) as DecisionCode, verifierNonce: f[5], verifierChainId: Number(f[6]) },
        f[4],
        f[3],
      ),
    });
  }
  return out;
}
