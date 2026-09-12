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
