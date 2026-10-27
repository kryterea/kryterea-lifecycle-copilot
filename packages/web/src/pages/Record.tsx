import { useEffect, useState } from "react";
import type { AcceptanceRecord, RunStatus } from "@lifecycle/core";
import { api, message, type ChangeView } from "../api";
import { STATUS, TriggerLine, lawTag } from "../components/FindingItem";
import { EVIDENCE, ROLE_ORDER, ROLES } from "../components/ProfessionalCard";
import { Reasoned } from "../components/SpendMeter";
import { STAGE_NAMES } from "../components/StageStrip";

const RUN: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  stopped_budget: "Paused: copilot budget used",
  failed: "Stopped with an error",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Record({ id }: { id: string }) {
  const [rec, setRec] = useState<AcceptanceRecord | null>(null);
  const [view, setView] = useState<ChangeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The change view carries the law each legal finding cites; the record carries decisions and runs.
    Promise.all([api.record(id), api.change(id)]).then(
      ([r, v]) => {
        setRec(r);
        setView(v);
      },
      (e) => setError(message(e)),
    );
  }, [id]);

  if (!rec || !view) return error ? <p className="error">{error}</p> : <p className="muted">Loading the acceptance record.</p>;
  const { change } = rec;
  const findingTitle = new Map(rec.findings.map((f) => [f.id, f.title]));
  const lawOf = new Map(view.findings.map((f) => [f.id, f]));
  const hasLegal = rec.findings.some((f) => f.kind === "legal");
  const totalUsd = rec.runs.reduce((n, r) => n + r.costUsd, 0);

  return (
    <article className="record">
      <nav className="crumbs no-print">
        <a href={`#/changes/${id}`}>Back to the change</a>
      </nav>
      <div className="page-head">
        <div>
          <h1>Acceptance record</h1>
          <p>
            {change.title}. Stage: {STAGE_NAMES[change.stage]}. Opened {when(change.createdAt)}.
          </p>
        </div>
        <button type="button" className="quiet no-print" onClick={() => window.print()}>
          Print record
        </button>
      </div>

      <section className="sheet">
        <h2>What was asked</h2>
        <p>{change.description}</p>

        <h2>Acceptance summary</h2>
        {rec.summary ? (
          <>
            <p className="summary">{rec.summary}</p>
            <Reasoned />
          </>
        ) : (
          <p className="empty">Written by the product owner when delivery is accepted.</p>
        )}

        <h2>Gates</h2>
        <table>
          <thead>
            <tr>
              <th>Professional</th>
              <th>Gate</th>
              <th>Why</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_ORDER.map((r) => {
              const g = rec.gates[r];
              return (
                <tr key={r}>
                  <td>{ROLES[r].name}</td>
                  <td>{g ? (g.state === "cleared" ? "Cleared" : "Held") : "Not reviewed yet"}</td>
                  <td>{g?.reason ?? ""}</td>
                  <td>{g ? when(g.at) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>Acceptance criteria</h2>
        {rec.criteria.length === 0 ? (
          <p className="empty">No criteria written yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Latest evidence</th>
              </tr>
            </thead>
            <tbody>
              {rec.criteria.map((k) => (
                <tr key={k.id}>
                  <td>
                    {k.text}
                    {k.isFailurePath ? " (failure path)" : ""}
                  </td>
                  <td>{k.latest ? EVIDENCE[k.latest] : "Not checked yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Findings</h2>
        {hasLegal && <p className="note">Legal findings are things to check, not legal advice.</p>}
        {rec.findings.length === 0 ? (
          <p className="empty">No findings raised.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Finding</th>
                <th>Raised by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rec.findings.map((f) => {
                const cited = lawOf.get(f.id);
                const tag = lawTag(cited?.law);
                return (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.title}</strong>
                      {tag && (
                        <span className="small muted">
                          {" "}
                          ({tag}: {cited?.law}, {cited?.section})
                        </span>
                      )}
                      <p>{f.plain}</p>
                      <TriggerLine trigger={f.trigger} />
                    </td>
                    <td>{ROLES[f.role].name}</td>
                    <td>{STATUS[f.status]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h2>Decisions</h2>
        {rec.decisions.length === 0 ? (
          <p className="empty">No one has changed a finding yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Finding</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {rec.decisions.map((d, i) => (
                <tr key={i}>
                  <td>{when(d.at)}</td>
                  <td>{findingTitle.get(d.findingId) ?? d.findingId}</td>
                  <td>{STATUS[d.status]}</td>
                  <td>{d.reason}</td>
                  <td>{d.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Model runs</h2>
        {rec.runs.length === 0 ? (
          <p className="empty">No runs yet.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Professional</th>
                  <th>Commit</th>
                  <th>Outcome</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {rec.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{ROLES[r.role].name}</td>
                    <td>
                      <code>{r.commit.slice(0, 7)}</code>
                    </td>
                    <td>{RUN[r.status]}</td>
                    <td>${r.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 8 }}>
              Copilot spend on this change: ${totalUsd.toFixed(2)}. <Reasoned />
            </p>
          </>
        )}
      </section>
    </article>
  );
}
