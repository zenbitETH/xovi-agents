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
/**
 * Split on the semicolons that end statements, which is not every semicolon.
 *
 * The previous version split the raw text. `0004_anchors.sql` has `duplication;` in
 * the middle of a two line comment, so the split cut the comment in half and the
 * remainder — starting with a backtick — arrived at the server as the first token of
 * a statement. The failure read `syntax error at or near "`"`, which points at a
 * character the file only ever uses inside prose.
 *
 * So skip a `--` comment to end of line, and skip quoted text, before deciding a
 * semicolon terminates anything. The comment is dropped rather than carried, which
 * also retires the old "is every line a comment" filter.
 *
 * Known limit, stated rather than implied: dollar quoted bodies are not handled, so
 * a function definition would need this to grow. Nothing in `sql/` uses one.
 */
export function splitStatements(text: string, file = "sql"): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      buf += "\n";
      continue;
    }
    // A block comment is the same class as the defect this function exists for: a
    // semicolon inside one ends a statement that has not ended. Nothing in `sql/`
    // uses one today, which is the only reason it was not the bug that bit us.
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) throw new Error(`${file}: unterminated block comment at offset ${i}`);
      i = close + 1;
      buf += "\n";
      continue;
    }
    if (c === "'" || c === '"') {
      // Refusing beats guessing. Running to end of file swallowed the remainder into
      // one statement and let the server report a syntax error about text far from
      // the real fault, which is how this class of defect stays expensive. A doubled
      // quote is an escaped quote, not a close, so scan rather than take the first.
      let j = i + 1;
      for (;;) {
        const close = text.indexOf(c, j);
        if (close === -1) {
          const what = c === "'" ? "string" : "quoted identifier";
          throw new Error(`${file}: unterminated ${what} starting at offset ${i}`);
        }
        if (text[close + 1] === c) {
          j = close + 2;
          continue;
        }
        buf += text.slice(i, close + 1);
        i = close;
        break;
      }
      continue;
    }
    if (c === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

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
    const statements = splitStatements(readFileSync(join(dir, file), "utf8"), file);
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
