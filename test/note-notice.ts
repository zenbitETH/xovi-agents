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

  /*
   * Where the credential is obtained. The World ID step is what mints it, for a wallet
   * enrolled here and for one AgentBook already knows, and its reading is where this
   * surface says what a step keeps and costs. So the notice goes in that reading, drawn
   * from the module, and not in the step itself, which carries no explanation.
   */
  const page = readFileSync("app/app-shell.tsx", "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  const enrol = code.slice(code.indexOf("function Enrol({"), code.indexOf("function WayBack("));
  const modalAt = enrol.indexOf("<dialog ref={details}");
  const stepBody = modalAt === -1 ? "" : enrol.slice(0, modalAt);
  const modal = modalAt === -1 ? "" : enrol.slice(modalAt);
  check(stepBody.length > 0 && modal.length > 0, `423 · the World ID step and its reading are found apart (negative control, ${stepBody.length}/${modal.length})`);
  check(
    /NOTE_NOTICE\.slice\(0, NOTE_NOTICE\.indexOf\(NOTE_NOTICE_URL\)\)/.test(modal) && /<a className="ag-link" href=\{NOTE_NOTICE_URL\}>/.test(modal),
    "423a · the reading draws the notice from the module and links its section",
  );
  check(!/NOTE_NOTICE/.test(stepBody), "423b · and the step itself carries none of it");
  const copies = (code.match(/Do not send other people/g) ?? []).length;
  check(copies === 0, `423c · the words are written once, in the module (${copies} copies in the shell)`);

  // What that expression yields, computed the way the page computes it: the text before
  // the link split on backticks, the odd pieces drawn as code, then the link's text.
  const pieces = NOTE_NOTICE.slice(0, NOTE_NOTICE.indexOf(NOTE_NOTICE_URL)).split("`");
  const shown = pieces.join("") + NOTE_NOTICE_URL.replace(/^https:\/\//, "");
  check(
    pieces.length === 3 && pieces[1] === "behaviorNote" && shown === NOTE_NOTICE.replace(/`/g, "").replace("https://", ""),
    `423d · split that way, it reads as the notice with the field as the one code piece (${pieces.length} pieces)`,
  );
}
