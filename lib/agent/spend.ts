/**
 * The most a single payment may be, whoever is paying.
 *
 * **The control exists to stop a typo, not to stop the price.** It was $0.05 while
 * the ruled price is $0.50, so the payer rejected the challenge before signing it
 * and the run ended on `All payment requirements were rejected by spendControls`
 * with nothing settled: a ceiling below the price is a refusal of the product
 * rather than a guard on it.
 *
 * One dollar leaves the ruled price an order of magnitude of headroom and still
 * catches the failure this is for, which is a price that arrives with a zero too
 * many. Both payers read it from here, and the browser passes it explicitly rather
 * than leaning on a default, so the two cannot drift apart again.
 */
export const MAX_PER_PAYMENT = "$1.00";
