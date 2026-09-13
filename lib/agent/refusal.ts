/**
 * The facilitator's own reason codes, as sentences a person can act on.
 *
 * Its own module because both sides need it: the run writes the sentence into the
 * step's detail, and the page draws it on the failure card. `lib/agent/run.ts`
 * reaches the filesystem, so importing the constant from there put `node:fs` into
 * the browser bundle and the build refused it. One constant either way, which is
 * the point: a second copy on the card is a sentence that can drift from the one
 * the run reports.
 *
 * **Only codes this deployment has been answered with.** A guessed sentence for an
 * unseen code would be the page explaining a failure it has never met, so anything
 * else keeps the route's own words.
 */
export const REFUSAL_SENTENCE: Record<string, string> = {
  insufficient_funds: "this wallet holds no USDC on Base Sepolia",
};

export function refusalSentence(detail: string): string {
  return REFUSAL_SENTENCE[detail.trim()] ?? detail;
}
