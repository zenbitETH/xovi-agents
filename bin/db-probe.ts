import { postgresStore } from "../lib/human/postgres";

/**
 * The two guarantees, against the real database, run by hand.
 *
 * The checks prove these against a fake that models the same rules. This proves the
 * database enforces them, which is a different claim: a fake agrees with whoever
 * wrote it, and a unique index does not.
 *
 * It writes rows under identifiers and hashes that are obviously not real, and
 * removes them afterwards.
 */
const MARK = "probe-" + "0".repeat(8);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const store = postgresStore(url);
  const day = "2000-01-01";
  const idA = `${MARK}-identifier-A`;
  let bad = 0;
  const check = (ok: boolean, label: string) => {
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  };

  const receipt = {
    source: "route" as const,
    payer: `${MARK}-payer`,
    payTo: `${MARK}-payto`,
    amount: "10000",
    network: "eip155:84532",
    nonce: `${MARK}-nonce`,
    transactionHash: `${MARK}-tx`,
  };
  check(await store.recordReceipt(receipt), "a settlement is recorded");
  check(!(await store.recordReceipt(receipt)), "the same one again is refused by the database, not by us");
  check(
    !(await store.recordReceipt({ ...receipt, nonce: `${MARK}-nonce-2` })),
    "a replay under a different nonce is still caught, by the transaction hash",
  );

  check(await store.tryTakeFreeRead(idA, day, 2), "the first free read of the day is taken");
  check(await store.tryTakeFreeRead(idA, day, 2), "and the second, under the limit");
  check(!(await store.tryTakeFreeRead(idA, day, 2)), "the third is refused at the limit");
  check(
    !(await store.tryTakeFreeRead(`${MARK}-identifier-zero`, day, 0)),
    "and a limit of zero takes nothing, which the obvious statement gets wrong",
  );

  // Two agents of one person share one row, because the row is keyed on the person.
  // This is the same call twice: the agent address never reaches this table.
  const shared = await store.tryTakeFreeRead(`${MARK}-shared`, day, 3);
  const sharedAgain = await store.tryTakeFreeRead(`${MARK}-shared`, day, 3);
  check(shared && sharedAgain, "two reads under one identifier both succeed under the limit");

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const rows = await sql`SELECT used FROM human_usage WHERE identifier = ${`${MARK}-shared`}`;
  check(rows.length === 1 && Number(rows[0].used) === 2, "and they are ONE row with a count of two, not two rows");

  await sql`DELETE FROM receipts WHERE payer LIKE ${MARK + "%"}`;
  await sql`DELETE FROM human_usage WHERE identifier LIKE ${MARK + "%"}`;
  console.log(`\n  ${bad === 0 ? "all green" : `${bad} FAILED`}, probe rows removed`);
  process.exitCode = bad ? 1 : 0;
}

main().catch(err => {
  console.error("  probe failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
