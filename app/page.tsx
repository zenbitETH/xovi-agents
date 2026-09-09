import { RunPanel } from "./run-panel";
import { STATUS_ROWS } from "./status";

/** Nothing here is read at request time, so it prerenders once at build. */
export const dynamic = "force-static";

const REPO = "https://github.com/zenbitETH/xovi-agents";
const SHOWCASE = "https://ethglobal.com/showcase/xovi-agents-2vnfj";

/** The description filed with ETHGlobal, quoted rather than reworded. The
 *  semicolons are the original's. */
const FILED = "Agents pay x402 to read CV windows and propose clips; humans confirm; EAS anchors it";

/** Served on every paid response by app/api/agent/windows/route.ts. Quoted here
 *  because it is the sentence the endpoint itself insists on. */
const NOTE =
  "A window marks where something moved and a person should look. It is not a claim that a behaviour occurred, that an animal was identified, or that confidence is a probability.";

/**
 * What happens after the agent stops, in one place because the page states it
 * once and a check reads it here.
 *
 * The operator is the subject, deliberately. An attestation is a claim by a named
 * party, and a sentence with no one in it reads as the chain deciding something.
 */
const AFTERWARDS =
  "A human operator confirms or rejects, exactly as they do for a clip a person submitted. The agent earns no credit for what it proposed. The operator asserts that confirmation in an EAS attestation. Attestations anchor on Ethereum Sepolia (11155111). Nothing touches mainnet and nothing handles real funds.";

const NOTS = [
  "No behaviour is described as detected. A window says where to look, and a person says what they saw.",
  "No animal alias, no species and no station appears in an attested field.",
  "The confidence score is opaque here. This page states no derivation for it and no threshold.",
  "This page calls this deployment and nothing else, and only after you press the button. No third party is contacted, and the command above is text rather than a live response.",
  "This page sets no cookie and runs no analytics. The fonts are served from this deployment.",
];

function Mark() {
  return (
    <svg viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M638.942 896.88C594.968 973.04 485.032 973.04 441.058 896.88L95.4769 298.36C51.5025 222.2 106.47 127 194.419 127H885.581C973.53 127 1028.5 222.2 984.523 298.36L638.942 896.88Z"
        fill="#059C9C"
      />
      <path
        d="M718.824 473.032C718.824 572.244 638.391 652.671 539.172 652.671C439.953 652.671 359.52 572.244 359.52 473.032C359.52 373.82 439.953 293.393 539.172 293.393C638.391 293.393 718.824 373.82 718.824 473.032Z"
        fill="#F8C471"
      />
    </svg>
  );
}

export default function Page() {
  return (
    <>
      <header className="ag-header">
        <div className="ag-header-inner">
          <a className="ag-brand ag-link" href={REPO}>
            <Mark />
            <span className="ag-wordmark">xovi</span>
            <span className="ag-wordmark-sub">agents</span>
          </a>
          <a className="ag-link" href={REPO}>
            Repository
          </a>
        </div>
      </header>

      <main className="ag-page">
        <section className="ag-rise">
          <p className="ag-eyebrow">ETHOnline 2026 · Continuity track</p>
          <h1>Xovi Agents</h1>
          <p className="ag-quote">{FILED}</p>
          <p className="ag-attrib">Project description filed with ETHGlobal</p>
          <p style={{ marginTop: "1rem" }}>A delegated agent pays for data, proposes a record, and cannot approve its own work.</p>
          <p className="ag-sub">
            This service has no browser interface. Everything it does happens over HTTP, and this page exists so the root address answers with
            something instead of a 404. The repository holds the specifications, the checks and the disclosure.
          </p>
          <div className="ag-actions">
            <a className="btn xv-action" href={REPO}>
              Read the repository
            </a>
            <a className="btn xv-action-outline" href={SHOWCASE}>
              ETHGlobal showcase
            </a>
          </div>
        </section>

        <section className="ag-section xv-clay ag-card ag-rise" style={{ animationDelay: "80ms" }}>
          <h2>What it is for</h2>
          <p className="xv-desc">
            Xovi is a conservation dApp built around a public axolotl livestream. People watch the stream, mark behaviours they see, and submit
            them as clips. Other people confirm or reject those clips. Confirmed observations accrue as a record.
          </p>
          <p className="xv-desc">
            This repository adds a machine to that loop, in the one position where a machine belongs. The agent proposes and then stops. It never
            confirms anything, and it earns no credit for what it proposes.
          </p>
          <p className="ag-quote">{NOTE}</p>
          <p className="ag-attrib">the note field of every paid response, app/api/agent/windows/route.ts</p>
          <p className="xv-desc" style={{ marginTop: "0.75rem", opacity: 0.7 }}>
            Xovi is pre-launch.
          </p>
        </section>

        <section className="ag-section xv-clay ag-card ag-stripe ag-rise" style={{ animationDelay: "120ms" }}>
          <h2>An agent may propose. No credential in existence may confirm.</h2>
          <p className="xv-desc">
            That is inherited rather than built for this event. The credential primitive it rests on shipped in Xovi before the event, and its
            capability list has no confirm member. A machine can create rows that are born proposed. Reaching confirmed requires a human session,
            and no bearer token opens that door.
          </p>
          <p className="xv-desc" style={{ opacity: 0.7 }}>
            Stated precisely, because the distinction is the sort of thing a reviewer checks: the capability list is enforced by the credential&apos;s
            server side allow list. It is not a database constraint. The clip provenance column is a database constraint. Those are different
            strengths of claim and this page will not blur them.
          </p>
        </section>

        <RunPanel />

        <section className="ag-section xv-clay ag-card">
          <h2>After the agent stops</h2>
          <p className="xv-desc" style={{ fontSize: "0.875rem" }}>
            {AFTERWARDS}
          </p>
        </section>

        <section className="ag-section xv-clay ag-card">
          <h2>The paid read</h2>
          <p className="ag-mono">GET /api/agent/windows</p>
          <p className="xv-desc" style={{ fontSize: "0.875rem" }}>
            Candidate windows: spans of a public livestream where something moved and a person should look.
          </p>
          <div className="ag-row">
            <p className="xv-desc" style={{ margin: 0, fontSize: "0.875rem" }}>
              It answers 402 with the payment challenge until a request carries payment. The challenge travels in the headers, and the version 2
              body is empty, so a client that reads only the body learns nothing.
            </p>
          </div>
          <div className="ag-row">
            <p className="xv-desc" style={{ margin: 0, fontSize: "0.875rem" }}>
              Settlement happens after the work succeeds and never before. A read that fails costs nothing, because the caller did not get what
              they paid for.
            </p>
          </div>
          <div className="ag-row">
            <p className="xv-desc" style={{ margin: 0, fontSize: "0.875rem" }}>
              Price $0.01. Payments settle on Base Sepolia (eip155:84532).
            </p>
          </div>
          <pre className="ag-pre">curl -i https://&lt;host&gt;/api/agent/windows</pre>
          <p className="xv-desc" style={{ margin: 0, fontSize: "0.8125rem", opacity: 0.6 }}>
            That answers 402 with the challenge, or 503 if the payment address is unset.
          </p>
        </section>

        <section className="ag-section xv-clay ag-card">
          <h2>Status</h2>
          <p className="xv-desc" style={{ fontSize: "0.875rem" }}>
            This repository was created on 2026-09-06 and is being built across the event window. Each leg lands as its own pull request, so the
            history shows the order things were actually built in. The table in README.md is the source; this page repeats it and adds nothing.
          </p>
          {STATUS_ROWS.map(row => (
            <div key={row.leg} className="ag-row">
              <span>{row.leg}</span>
              <span className={`ag-state ${row.state.startsWith("built") ? "ag-state-built" : "ag-state-open"}`}>{row.state}</span>
            </div>
          ))}
        </section>

        <section className="ag-section xv-clay ag-card ag-card-sm">
          <h2>What this does not do</h2>
          <ul className="ag-nots">
            {NOTS.map(line => (
              <li key={line}>
                <span className="ag-dot" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="ag-foot">
        <p className="ag-legal" style={{ marginBottom: "0.75rem" }}>
          Built for ETHOnline 2026 on the Continuity track, which means it extends a project that existed before the event.
        </p>
        <div className="ag-foot-row">
          <a className="ag-link" href={REPO}>
            Repository
          </a>
          <span aria-hidden="true">·</span>
          <a className="ag-link" href={SHOWCASE}>
            Showcase
          </a>
          <span aria-hidden="true">·</span>
          <a className="ag-link" href={`${REPO}/blob/main/DISCLOSURE.md`}>
            DISCLOSURE.md
          </a>
          <span aria-hidden="true">·</span>
          <a className="ag-link" href={`${REPO}/blob/main/AI-USAGE.md`}>
            AI-USAGE.md
          </a>
          <span aria-hidden="true">·</span>
          <a className="ag-link" href={`${REPO}/tree/main/docs/spec`}>
            docs/spec
          </a>
          <span aria-hidden="true">·</span>
          <a className="ag-link" href="https://zenbit.mx/en/privacy">
            Privacy
          </a>
        </div>
        <p className="ag-legal">MIT. Copyright (c) 2026 ZENBIT S.A.S. de C.V.</p>
        <p className="ag-legal">
          Controller: ZENBIT S.A.S. de C.V. Contact hola@zenbit.mx. Full privacy notice at https://zenbit.mx/en/privacy.
        </p>
        <p className="ag-legal">Zenbit builds and maintains this repository.</p>
      </footer>
    </>
  );
}
