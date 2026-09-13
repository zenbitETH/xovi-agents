import { capFrom, registrationOf } from "../human/cap";
import { now } from "../human/clock";

/**
 * Whether a person stands behind this wallet.
 *
 * A seam, and its default now answers rather than refusing. While nothing in the page
 * could enrol anybody the default was `false` for everyone, which was true then and
 * would be a lie now that a wallet can be verified here: it would refuse a name to
 * exactly the people the enrolment exists for.
 *
 * IT IS A SEAM RATHER THAN A DIRECT READ OF `verifications` because the question is
 * whether a person stands behind the wallet and not how that was established. Both
 * sources answer it, the route asks it once, and a check can answer it without a
 * chain or a table.
 *
 * The checks use it for the control the audit plan asks for, an enrolled wallet with
 * AgentBook saying UNREGISTERED being accepted, which no fake of AgentBook can express.
 */
export type Enrolled = (payer: string) => Promise<boolean>;

/**
 * The default, now that both sources exist.
 *
 * It was `false` for everyone while nothing in the page could enrol a wallet, which
 * was the honest answer then and is the wrong one now. The question is whether a
 * person stands behind the wallet, so it is answered by the same read the
 * registration route answers with, and the name route stops caring which source
 * said yes.
 */
const NOBODY: Enrolled = async payer => (await registrationOf(payer, capFrom(), now())).state === "registered";

let injected: Enrolled | undefined;

/** Set by the World ID leg when it lands, and by the checks. */
export function setEnrolledForTest(enrolled: Enrolled | undefined) {
  injected = enrolled;
}

export function enrolledSeam(): Enrolled {
  return injected ?? NOBODY;
}
