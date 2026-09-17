import { readFileSync } from "node:fs";
import { NOTE_NOTICE, NOTE_NOTICE_URL } from "../lib/agent/note-notice";

type Check = (ok: boolean, label: string) => void;

/**
 * The notice about the note a proposal carries, held to the legal lead's words and to
 * the places that must say it. The words are compared whole, so a paraphrase is red;
 * the document is read for the quoted line, not for the words anywhere in it.
 */
export async function noteNoticeChecks(check: Check) {
  console.log("\n  the note's notice");

  check(
    NOTE_NOTICE ===
      "The note (`behaviorNote`) is published with the clip once the clip is confirmed. Do not send other people's personal data. More information: https://zenbit.mx/en/privacy#xovi-notas",
    "422 · the notice is the legal lead's confirmed text",
  );
  check(NOTE_NOTICE_URL === "https://zenbit.mx/en/privacy#xovi-notas" && NOTE_NOTICE.endsWith(NOTE_NOTICE_URL), "422a · and it links the English section, xovi-notas");

  const spec = readFileSync("docs/spec/03-proposal.md", "utf8");
  const row = spec.indexOf("| `reason` | `behaviorNote` |");
  const quote = spec.indexOf(`> ${NOTE_NOTICE}\n`);
  const nextHeading = spec.indexOf("\n## ", row);
  check(row > 0, "422b · the mapping row for `behaviorNote` is found (negative control for the read)");
  check(
    quote > row && (nextHeading === -1 || quote < nextHeading),
    `422c · docs/spec/03-proposal.md quotes the notice whole, after that row and inside its section (row ${row}, quote ${quote})`,
  );
}
