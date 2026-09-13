/**
 * The confirmation the page shows, trimmed to what the page shows.
 *
 * The page used to import `fixtures/confirmation.259.json`, and a JSON import
 * arrives whole: the model's number travelled into the browser bundle with the
 * rest of it. Nothing rendered it, and the check that reads the interface for the
 * word reads the source and not the built chunk, so the rule that it is on no
 * surface held everywhere the checks looked and not where a reader could look.
 *
 * So the page imports this instead. Nine values, seven that any reader can check
 * without trusting Zenbit and two that Zenbit asserts, and no tenth. The opaque
 * field is absent from this file rather than filtered later, which is the
 * difference between a property and a habit.
 *
 * Held to the fixture by a check that reads the JSON and compares all nine, so
 * the trimming cannot become a divergence.
 */
export const CONFIRMATION_259 = {
  clipId: 259,
  clipHash: "0x8d160c3c6b81601ab8c26d41b4e025d5f635a7209df709138cd0e8be99af1631",
  status: "verified",
  verifier: "0xeCB4C1245665e8A1F43826355aaB0Dd6bF336e05",
  verifierSignature:
    "0x1d14ede13cf5d14d57926fe3a0ce0b04064fe4b1b511bcf15962c5c952400c4654ca5f50ba067407c6c6ba90576c91c39acbe47348ce13d3138debbd88b98a851c",
  verifierNonce: "0xbf89ded60c474aaca863c1e92cd751d6d8907f964ae3b7e0aba775d1fbdf84ea",
  verifierChainId: 11155111,
  verifiedAt: "2026-09-09T02:28:59.058Z",
  submitter: "0xC0686ae97FDf62A37F081922c2a92537862E0B95",
} as const;

/**
 * The anchor, read from Ethereum Sepolia rather than taken from a message.
 *
 * The page said this confirmation was not anchored, which was true of the fixture
 * and false of the chain: it has been anchored since 2026-09-11 and the copy never
 * moved with it. Asserting an absence from a file's silence is how that happened.
 *
 * **These are constants and the page reads nothing live.** That is the trade: a
 * page that reads would always be current and would also fail when an endpoint
 * does, on the screen whose whole argument is that a stranger can check without
 * the operator. So they are written down, and the recovery check beside them is
 * the part that runs. The consequence is that this block has to change when the
 * anchor does, which is exactly what rotted, so it names where each value came
 * from and how to read it again.
 *
 * Verified against EAS at `0xC2679fBD37d54388Ce493F1DB75320D236e1815e` on chain
 * 11155111: the `Attested` log under the frozen schema returns this uid, this
 * attester and this transaction, and `getAttestation` returns time 1789110516 with
 * a schema equal to `schemaUid()`.
 */
export const ANCHOR_259 = {
  chainId: 11155111,
  onchainUid: "0xf3e3edf3c8bf0051bc2d70848592846b0604f89bd0b9439c4ba06bccf0232044",
  attester: "0x51F1D0074793E7Fa336f538299ad7D3e439e2b09",
  attestedAt: 1789110516,
  attestTx: "0xd86c2902aaf8cb0cebf529e4171f64bdd1b4235aa6f5e2eb419c1e044fca5538",
  // The offchain identifier, which keys the payload endpoint and shares nothing
  // with the one above. `getTimestamp` returns 1789110504 for it, and
  // `getAttestation` returns the empty struct, which is the page's own claim
  // about the wrong call beside the wrong identifier, confirmed by making it.
  offchainUid: "0x3252123f3ac9e0521296847836c61f757c939e54b8892743fdf2f9f068b7a775",
  timestampedAt: 1789110504,
  timestampTx: "0x236b7c7a944d7e2354da9e9f80a2cfa97c8e7ea70ef1d65cceed3f7502fadfb3",
} as const;
