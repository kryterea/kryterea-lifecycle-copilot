import { useEffect, useState } from "react";
import type { AcceptanceRecord, Proposals, RunStatus } from "@lifecycle/core";
import { api, message, type ChangeView } from "../api";
import { TriggerLine, lawTag } from "../components/FindingItem";
import { BackIcon, PrintIcon } from "../components/Icon";
import { EvidenceStamp, ROLE_ORDER, ROLES } from "../components/ProfessionalCard";
import { Reasoned } from "../components/SpendMeter";
import { GateStamp, StatusStamp } from "../components/Stamp";
import { STAGE_NAMES } from "../components/Trail";

const RUN: Record<RunStatus, string> = {
  running: "Running",
  done: "Done",
  stopped_budget: "Paused: budget used",
  failed: "Stopped with an error",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Record({ id }: { id: string }) {
  const [rec, setRec] = useState<AcceptanceRecord | null>(null);
  const [view, setView] = useState<ChangeView | null>(null);
  const [proposals, setProposals] = useState<Proposals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The change view carries the law each legal finding cites; the record carries decisions and runs.
    // A fix change's decisions were made on the proposals of the check it follows, so those titles come from there.
    Promise.all([api.record(id), api.change(id)]).then(
      async ([r, v]) => {
        const from = v.follows ? await api.change(v.follows.id).catch(() => null) : v;
        setRec(r);
        setView(v);
        setProposals(from?.proposals ?? null);
      },
      (e) => setError(message(e)),
    );
  }, [id]);

  if (!rec || !view) return error ? <p className="error page-pad">{error}</p> : <p className="muted page-pad">Loading.</p>;
  const { change } = rec;
  const findingTitle = new Map(rec.findings.map((f) => [f.id, f.title]));
  const lawOf = new Map(view.findings.map((f) => [f.id, f]));
  const hasLegal = rec.findings.some((f) => f.kind === "legal");
  const totalUsd = rec.runs.reduce((n, r) => n + r.costUsd, 0);
  const checkedBy = ROLE_ORDER.filter((r) => rec.runs.some((x) => x.role === r && x.status === "done")).map((r) => ROLES[r].name);

  return (
    <article className="page record">
      <div className="row no-print record-bar">
        <a className="back" href={`#/changes/${id}`}>
          <BackIcon size={15} /> Change
        </a>
        <button type="button" className="btn secondary sm" onClick={() => window.print()}>
          <PrintIcon size={15} /> Print
        </button>
      </div>

      <header className="record-head">
        <h1>Acceptance record</h1>
        <p className="record-title">{change.title}</p>
        <p className="muted">
          {STAGE_NAMES[change.stage]} · opened {when(change.createdAt)}
        </p>
        {checkedBy.length > 0 && <p className="muted">Checked by {checkedBy.join(", ")}.</p>}
        {view.withdrawn && (
          <p className="paused">
            Withdrawn by {view.withdrawn.actor}: {view.withdrawn.reason}
          </p>
        )}
        {view.follows && (
          <p>
            Follows <a href={`#/changes/${view.follows.id}/record`}>{view.follows.title}</a>
          </p>
        )}
        {view.fixChanges.map((x) => (
          <p key={x.id}>
            {x.withdrawn ? "Fix change withdrawn: " : "Findings after delivery carried by "}
            <a href={`#/changes/${x.id}/record`}>{x.title}</a>
          </p>
        ))}
      </header>

      {rec.problem && (
        <section>
          <h2>Problem</h2>
          <p>{rec.problem}</p>
        </section>
      )}

      {rec.answers.length > 0 && (
        <section>
          <h2>Answers</h2>
          <ul className="criteria">
            {rec.answers.map((a, i) => (
              <li key={i}>
                <span>
                  <strong>{a.question}</strong>
                  <br />
                  {a.assumed ? `Assumed: ${a.answer}${a.actor ? `, by ${a.actor}` : ""}` : a.answer}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rec.proposalDecisions.length > 0 && (
        <section>
          <h2>Changes decided</h2>
          <ul className="criteria">
            {rec.proposalDecisions.map((d, i) => (
              <li key={i}>
                <span>
                  <strong>{proposals?.changes[d.index]?.title ?? `Change ${d.index + 1}`}</strong>
                  <br />
                  {d.decision === "approved" ? "Approved" : "Risk accepted"} by {d.actor}
                  {d.reason ? `: ${d.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Asked</h2>
        <p>{change.description}</p>
      </section>

      <section>
        <h2>Summary</h2>
        {rec.summary ? (
          <>
            <p className="summary">{rec.summary}</p>
            <Reasoned />
          </>
        ) : (
          <p className="empty">Written by the product owner at acceptance.</p>
        )}
      </section>

      <section>
        <h2>Gates</h2>
        <div className="table-wrap">
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
                    <td>
                      <GateStamp state={g?.state} />
                    </td>
                    <td>{g?.reason ?? ""}</td>
                    <td className="nowrap">{g ? when(g.at) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Criteria</h2>
        {rec.criteria.length === 0 ? (
          <p className="empty">None written yet.</p>
        ) : (
          <ul className="criteria">
            {rec.criteria.map((k) => (
              <li key={k.id}>
                <EvidenceStamp state={k.latest} />
                <span>
                  {k.text}
                  {k.isFailurePath && <span className="muted"> Failure path.</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Trace</h2>
        {rec.trace.length === 0 ? (
          <p className="empty">No requirement is linked to these criteria.</p>
        ) : (
          <ul className="record-findings">
            {rec.trace.map((r) => (
              <li key={r.key}>
                <p className="record-finding-head">
                  <span className="key">{r.key}</span>
                  <strong>{r.text}</strong>
                </p>
                <ul className="criteria">
                  {r.criteria.map((k, i) => (
                    <li key={i}>
                      <EvidenceStamp state={k.state} />
                      <span>{k.text}</span>
                    </li>
                  ))}
                </ul>
                {r.decisions.map((d, i) => (
                  <p key={i} className="muted small">
                    <StatusStamp status={d.status} /> {d.title}. {d.by}: {d.reason}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Findings</h2>
        {hasLegal && <p className="hint">Legal findings are things to check, not legal advice.</p>}
        {rec.findings.length === 0 ? (
          <p className="empty">None raised.</p>
        ) : (
          <ul className="record-findings">
            {rec.findings.map((f) => {
              const cited = lawOf.get(f.id);
              const tag = lawTag(cited?.law);
              return (
                <li key={f.id}>
                  <p className="record-finding-head">
                    <StatusStamp status={f.status} kind={f.kind} />
                    <strong>{f.title}</strong>
                  </p>
                  <p className="muted small">
                    {ROLES[f.role].name}
                    {tag && ` · ${tag}: ${cited?.law}, ${cited?.section}`}
                  </p>
                  <p>{f.plain}</p>
                  <TriggerLine trigger={f.trigger} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Decisions</h2>
        {rec.decisions.length === 0 ? (
          <p className="empty">None yet.</p>
        ) : (
          <div className="table-wrap">
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
                    <td className="nowrap">{when(d.at)}</td>
                    <td>{findingTitle.get(d.findingId) ?? d.findingId}</td>
                    <td>
                      <StatusStamp status={d.status} />
                    </td>
                    <td>{d.reason}</td>
                    <td>{d.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Model runs</h2>
        {rec.runs.length === 0 ? (
          <p className="empty">None yet.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Professional</th>
                    <th>Commit</th>
                    <th>Outcome</th>
                    <th className="num">Cost</th>
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
                      <td className="num">${r.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="row small muted spend-line">
              <span>Copilot spend: ${totalUsd.toFixed(2)}</span>
              <Reasoned />
            </p>
          </>
        )}
      </section>
      <p className="hint">Not legal advice. Kryterea advises and records; people decide.</p>
    </article>
  );
}
