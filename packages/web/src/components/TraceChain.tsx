import type { ReactNode } from "react";
import type { TraceChain as Chain } from "../api";
import { EvidenceStamp } from "./ProfessionalCard";
import { Stamp, StatusStamp } from "./Stamp";

/** One link of the chain. A link with nothing in it is drawn as an open Gap, never left out. */
function Node({ title, gap, children }: { title: string; gap?: string | false; children?: ReactNode }) {
  return (
    <li className={gap ? "node is-gap" : "node"}>
      <p className="node-title">
        {title}
        {gap && <Stamp tone="held">Gap</Stamp>}
      </p>
      {gap ? <p className="hint">{gap}</p> : children}
    </li>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Document line to sign off, in order: what was asked, what checks it, what shows it, who decided. */
export function TraceChain({ t, linear }: { t: Chain; linear?: ReactNode }) {
  const decisions = t.findings.flatMap((f) => f.history.filter((h) => h.status !== "open").map((h) => ({ ...h, title: f.title, id: f.id })));
  return (
    <ol className="chain">
      <Node title="Document">
        <p>
          <code>
            {t.document.name}:{t.document.line}
          </code>
        </p>
        <blockquote className="trigger">{t.document.quote}</blockquote>
      </Node>
      <Node title="Requirement">
        <p>
          <span className="key">{t.requirement.key}</span> {t.requirement.text}
        </p>
        {t.requirement.events.length > 1 && (
          <ul className="plain-list small">
            {t.requirement.events.map((e, i) => (
              <li key={i}>
                <span className="muted">{when(e.at)}</span> {e.kind === "added" ? "Added" : e.kind === "changed" ? "Changed" : "Removed"}: {e.text}
              </li>
            ))}
          </ul>
        )}
      </Node>
      <Node title="Acceptance criteria" gap={!t.criteria.length && "No acceptance criteria"}>
        <ul className="plain-list">
          {t.criteria.map((k) => (
            <li key={k.id} className="row">
              <EvidenceStamp state={k.latest?.state} /> {k.text}
            </li>
          ))}
        </ul>
      </Node>
      <Node title="Linear ticket" gap={!t.tickets.length && "No Linear ticket"}>
        <p>{t.tickets.join(", ")}</p>
      </Node>
      {linear}
      <Node title="Evidence in the code" gap={!t.evidence.length && "No evidence yet"}>
        <ul className="plain-list">
          {t.evidence.map((e, i) => (
            <li key={i}>
              <code>
                {e.file}:{e.line}
              </code>{" "}
              <span className="muted">at {e.commit.slice(0, 7)}</span>
            </li>
          ))}
        </ul>
      </Node>
      <Node title="Findings">
        {t.findings.length ? (
          <ul className="plain-list">
            {t.findings.map((f) => (
              <li key={f.id} className="row">
                <StatusStamp status={f.status} kind={f.kind} /> {f.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None raised.</p>
        )}
      </Node>
      <Node title="Decisions">
        {decisions.length ? (
          <ul className="plain-list">
            {decisions.map((d, i) => (
              <li key={`${d.id}-${i}`}>
                <strong>{d.actor}</strong> <span className="muted">{when(d.at)}</span>
                <br />
                {d.title}: {d.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No decisions yet.</p>
        )}
      </Node>
      <Node title="Sign off" gap={!t.signOff && "Not signed off"}>
        {t.signOff && (
          <p>
            <strong>{t.signOff.by}</strong> <span className="muted">{when(t.signOff.at)}</span>
          </p>
        )}
      </Node>
    </ol>
  );
}
