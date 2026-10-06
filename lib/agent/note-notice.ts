/**
 * The simplified notice for the note a proposal carries.
 *
 * A run sends the window's `reason` as `behaviorNote`, and the reviewing application
 * publishes that note with the clip once a person confirms it. Whoever runs this agent
 * never sees that application's form, so the notice is said beside the field in
 * docs/spec/03-proposal.md and where the credential is obtained. The words are the
 * legal lead's, confirmed on 2026-09-17, and link the English section of Zenbit's notice.
 */
export const NOTE_NOTICE_URL = "https://zenbit.mx/en/privacy#xovi-notas";

export const NOTE_NOTICE = `The note (\`behaviorNote\`) is published with the clip once the clip is confirmed. Do not send other people's personal data. More information: ${NOTE_NOTICE_URL}`;
