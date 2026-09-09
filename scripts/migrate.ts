import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Apply the schema files that have not been applied.
 *
 * Keyed on the whole filename rather than on a number, so two files that happen to
 * start with the same digits are two migrations and neither is silently skipped.
 * The order is the sorted filename, and a gap in the numbering means nothing.
 *
 * There is no interactive transaction over the HTTP driver, so a file that fails
 * part way leaves its earlier statements applied and its tag unrecorded, and
 * re-running applies them again. Every statement here is therefore written to be
 * safe to run twice, which is what the IF NOT EXISTS in the files is for. That is a
 * property of the files rather than of this runner, and it is the runner's job to
 * say so rather than to imply a guarantee it cannot give.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await sql`SELECT tag FROM schema_migrations`).map(r => String(r.tag)));

  const dir = join(process.cwd(), "sql");
  const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const file of files) {
    const tag = file.replace(/\.sql$/, "");
    if (applied.has(tag)) {
      console.log(`  skip   ${tag}`);
      continue;
    }
    const statements = readFileSync(join(dir, file), "utf8")
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.split("\n").every(l => l.trim().startsWith("--")));
    for (const statement of statements) await sql.query(statement);
    await sql`INSERT INTO schema_migrations (tag) VALUES (${tag})`;
    console.log(`  apply  ${tag}  (${statements.length} statement(s))`);
    ran++;
  }
  console.log(`\n  ${ran} applied, ${files.length - ran} already there`);
}

main().catch(err => {
  console.error("  migrate failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
