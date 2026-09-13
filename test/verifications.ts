import { existsSync, readFileSync } from "node:fs";
import { RETENTION_DAYS, registrationOf, standingBehind, takeFreeRead } from "../lib/human/cap";
import { deriveIdentifier } from "../lib/human/derive";
import { ENROLLMENT_DAYS, expiryFrom } from "../lib/human/verifications";
import { HUMAN_A, fakeRegistry, fakeStore, fakeVerifications } from "./human";

type Check = (ok: boolean, label: string) => void;

/** The founder's recording wallet, which AgentBook knows and which must pass
 *  exactly as before, and one it does not. */
const RECORDING = "0xC0686ae97FDf62A37F081922c2a92537862E0B95";
const WALLET_A = "0x2Be7e36bA6aE468733c5a03A5cB9f9F1296d73fe";
const NOBODY = "0x9999999999999999999999999999999999999999";
const ENV = { HUMAN_ID_KEY: "c".repeat(64) };

/**
 * The second source of a person behind a wallet, and what the cap does with it.
 *
 * Driven on the fakes directly, with rows planted rather than enrolled, so these
 * hold whatever the routes do: the table is the cap's concern whichever way a row
 * got into it.
 */
export async function verificationChecks(check: Check) {
  console.log("\n  the table, as the cap's second source");

  const T0 = new Date("2026-09-13T12:00:00Z");
  const table = fakeVerifications();
  const usage = fakeStore();
  const registry = fakeRegistry({ [RECORDING]: HUMAN_A });
  const cap = { registry: registry.read, store: usage, verifications: table, freePerDay: 2 };
  const { setCapForTest } = await import("../lib/human/cap");
  setCapForTest(cap);

  // A row as the verify route writes it: the digest, never the value.
  const digest = deriveIdentifier(BigInt(`0x${"5a".repeat(32)}`), ENV);
  table.rows.set(WALLET_A.toLowerCase(), {
    payer: WALLET_A.toLowerCase(),
    action: "enrol-agent",
    nullifierDigest: digest,
    credential: "proof_of_human",
    verifiedAt: T0,
    expiresAt: expiryFrom(T0),
  });

  /*
   * The cap reads both sources, and the table's digest is the identifier.
   */
  const free = [await takeFreeRead(WALLET_A, ENV, T0), await takeFreeRead(WALLET_A, ENV, T0), await takeFreeRead(WALLET_A, ENV, T0)];
  check(free.join(",") === "true,true,false", `313 · an enrolled wallet AgentBook does not know takes the configured allowance and no more (${free.join(",")})`);
  check(usage.counted === 2, "313a · counted twice");
  const standing = await standingBehind(WALLET_A, cap, ENV, T0);
  check(standing?.source === "worldid" && standing.digest === table.rows.get(WALLET_A.toLowerCase())?.nullifierDigest,
    "313b · keyed on the stored digest, read back rather than derived again");
  check((await takeFreeRead(NOBODY, ENV, T0)) === false, "313c · a wallet in neither source settles (negative control)");
  // The read, with the source named, from the same function the route calls.
  check((await registrationOf(WALLET_A, cap, T0)).source === "worldid", "313d · the registration read names the table as the source");
  check((await registrationOf(NOBODY, cap, T0)).state === "not-registered", "313e · and a wallet in neither is not registered");
  // Taken here, while rows exist, for the sweep below: the lapse checks that
  // follow delete them, and a sweep over an empty table proves nothing.
  const storedRows = JSON.stringify([...table.rows.values()]);
  const storedCount = table.rows.size;
  // The thirty day boundary, crossed by one second.
  usage.reset();
  const row2 = table.rows.get(WALLET_A.toLowerCase()) as { verifiedAt: Date };
  const edge = new Date(expiryFrom(row2.verifiedAt).getTime() - 1000);
  check((await takeFreeRead(WALLET_A, ENV, edge)) === true, "314 · one second before the enrollment lapses a read is still free");
  const past = new Date(expiryFrom(row2.verifiedAt).getTime() + 1000);
  check((await takeFreeRead(WALLET_A, ENV, past)) === false, "314a · one second after it, the same wallet settles");
  check(!table.rows.has(WALLET_A.toLowerCase()), "314b · and the lapsed row is gone, deleted on the request path");
  check(ENROLLMENT_DAYS === RETENTION_DAYS, `314c · the enrollment lasts the days the notice declares (${ENROLLMENT_DAYS}, ${RETENTION_DAYS})`);

  // The recording wallet, unchanged: AgentBook answers and the table is not asked.
  usage.reset();
  table.calls.standingOf = 0;
  const recorded = [await takeFreeRead(RECORDING, ENV, T0), await takeFreeRead(RECORDING, ENV, T0), await takeFreeRead(RECORDING, ENV, T0)];
  check(recorded.join(",") === "true,true,false" && table.calls.standingOf === 0,
    `315 · the recording wallet takes its two reads from AgentBook and the table is never consulted (${recorded.join(",")}, ${table.calls.standingOf} table reads)`);
  check((await registrationOf(RECORDING, { registry: registry.read, store: usage, verifications: null, freePerDay: 2 }, T0)).source === "agentbook",
    "315a · and with no table at all it is still registered by AgentBook");


  /*
   * What the migration holds, read and counted.
   */
  const migration = "sql/0005_verifications.sql";
  check(existsSync(migration), `318 · the migration is ${migration}, the next number after the four`);
  const ddl = existsSync(migration) ? readFileSync(migration, "utf8") : "";
  const creates = ddl.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)/g) ?? [];
  check(creates.length > 0 && creates.length === (ddl.match(/IF NOT EXISTS/g) ?? []).length, `318a · every create is IF NOT EXISTS (${creates.length})`);
  const columns = [...(ddl.match(/CREATE TABLE IF NOT EXISTS verifications \(([\s\S]*?)\);/)?.[1] ?? "").matchAll(/^\s+([a-z_]+)\s/gm)].map(m => m[1]);
  check(columns.join(",") === "payer,action,nullifier_digest,credential,verified_at,expires_at", `318b · the table holds the wallet, the action, the digest, the credential and two times (${columns.join(",")})`);
  // Over the statements with the comments stripped: the comments say what the
  // column is not, and a naive match would find its own explanation.
  const statements = ddl.replace(/^\s*--.*$/gm, "");
  check(!/^\s+nullifier\s/m.test(statements) && /nullifier_digest/.test(statements), "318c · and no column is named for the nullifier itself");
  check(/UNIQUE INDEX IF NOT EXISTS \w+ ON verifications \(action, nullifier_digest\)/.test(ddl), "318d · one enrolled wallet per person is an index, not a hope");
  check(/verification_replays/.test(ddl) && /PRIMARY KEY/.test(ddl) && /ON verification_replays \(proof_digest\)/.test(ddl), "318e · replays are keyed twice, on the nonce and on the proof");

  setCapForTest(null);
}
