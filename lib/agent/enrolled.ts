/**
 * Whether this wallet enrolled through the page.
 *
 * A seam with a default of false, and the default is the honest one: on this branch
 * the World ID leg does not exist, so nobody has enrolled here and saying so is not a
 * stub. The name request already has a second source in AgentBook, which is the one
 * that answers today.
 *
 * IT IS A SEAM RATHER THAN A DIRECT READ OF `verifications` because that table belongs
 * to the other leg and lands in migration 0005, and a route of mine reading a table I
 * do not own would couple two branches at the schema. The World ID leg sets this once
 * and the name route stops caring which source answered, which is the right shape
 * anyway: the question is whether a person stands behind the wallet, not how that was
 * established.
 *
 * The checks use it for the control the audit plan asks for, an enrolled wallet with
 * AgentBook saying UNREGISTERED being accepted, which no fake of AgentBook can express.
 */
export type Enrolled = (payer: string) => Promise<boolean>;

const NOBODY: Enrolled = async () => false;

let injected: Enrolled | undefined;

/** Set by the World ID leg when it lands, and by the checks. */
export function setEnrolledForTest(enrolled: Enrolled | undefined) {
  injected = enrolled;
}

export function enrolledSeam(): Enrolled {
  return injected ?? NOBODY;
}
