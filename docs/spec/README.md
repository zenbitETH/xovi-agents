# Specifications

ETHOnline asks spec-driven projects to publish the artifacts that directed the work, not only the output. These are those artifacts. They were written before the code and are corrected when building proves them wrong. A correction is left visible rather than edited into looking prescient.

| File | What it fixes |
|---|---|
| [`01-agent-layer.md`](./01-agent-layer.md) | The loop, the invariant, the surfaces, and the refusals each one owes |
| [`02-candidate-windows.md`](./02-candidate-windows.md) | The shape the paid read serves, and why an embargoed window is dropped whole rather than redacted |
| `03-*` onward | Added as each leg is specified |

**How corrections are recorded.** When building overtakes a claim, the original wording stays and a dated note is appended under it. Nothing here is edited to look as though it was right the first time. A note that says an invariant is still unproven is doing its job.

These are redacted for public release. The full internal design also covers key custody, threat modelling and operational context for the conservation programme this sits on; none of that is needed to review the agent layer, and none of it is here.

## Working rule

Every invariant in this repository names three things or it is not recorded:

1. **The mechanism.** A database constraint, a closed union, a signature check, a CI grep. Never an assurance that someone was careful.
2. **What defeats it.** Every mechanism has an edge. If nothing is written here, the invariant has not been thought about.
3. **A test that proves it, and that has been seen to fail** on the bug it was written for. A check never observed to go red is not evidence.

This rule exists because an audit of the plan found seven critical issues and six of them were the same shape: a security property asserted in prose that the code did not provide. The rule is the correction.
