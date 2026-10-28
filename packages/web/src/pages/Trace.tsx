import { useState, type FormEvent } from "react";
import type { RequirementRow } from "../api";
import { EvidenceStamp } from "../components/ProfessionalCard";
import { Stamp } from "../components/Stamp";

type Filter = "all" | "open" | "no-criteria" | "no-evidence" | "drifted";
const FILTERS: Array<[Filter, string, (r: RequirementRow) => boolean]> = [
  ["all", "All", () => true],
  ["open", "Open", (r) => r.open > 0],
  ["no-criteria", "No criteria", (r) => r.criteria === 0],
  ["no-evidence", "No evidence", (r) => r.criteria > 0 && r.evidence !== "evidence_found"],
  ["drifted", "Drifted", (r) => r.drifted],
];

/** One row per requirement: where it was written, what checks it, its ticket, its evidence and what is open. */
export function Trace({ projectId, rows, error }: { projectId: string; rows: RequirementRow[] | null; error: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sha, setSha] = useState("");
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading.</p>;
  if (!rows.length) {
    return (
      <p className="empty">
        No requirements yet. <a href={`#/projects/${projectId}/documents`}>Add a PRD or spec</a>, then run a check.
      </p>
    );
  }
  const find = (e: FormEvent) => {
    e.preventDefault();
    const s = sha.trim().toLowerCase();
    if (/^[0-9a-f]{4,40}$/.test(s)) location.hash = `#/projects/${projectId}/commits/${s}`;
  };
  const shown = rows.filter(FILTERS.find(([f]) => f === filter)![2]);
  return (
    <section className="stack">
      <div className="trace-tools">
        <fieldset className="segmented">
          <legend className="sr-only">Show</legend>
          {FILTERS.map(([f, label, test]) => (
            <label key={f} className={filter === f ? "is-on" : undefined}>
              <input type="radio" name="trace-filter" checked={filter === f} onChange={() => setFilter(f)} />
              {label} <span className="num">{rows.filter(test).length}</span>
            </label>
          ))}
        </fieldset>
        <form className="sha-search" onSubmit={find} role="search">
          <label className="sr-only" htmlFor="sha">
            Commit
          </label>
          <input id="sha" value={sha} onChange={(e) => setSha(e.target.value)} placeholder="Commit SHA" pattern="[0-9a-fA-F]{4,40}" spellCheck={false} />
          <button type="submit" className="btn secondary sm">
            Trace commit
          </button>
        </form>
      </div>
      <div className="table-wrap">
        <table className="trace-table">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Criteria</th>
              <th scope="col">Ticket</th>
              <th scope="col">Evidence</th>
              <th scope="col">Open</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <th scope="row">
                  <a href={`#/requirements/${r.id}`}>
                    <span className="key">{r.key}</span> {r.text}
                  </a>
                  <span className="where">line {r.line}</span>
                  {r.drifted && <Stamp tone="held">Drifted</Stamp>}
                </th>
                <td className="num-cell">{r.criteria || <Stamp tone="held">None</Stamp>}</td>
                <td>{r.tickets.length ? r.tickets.join(", ") : <span className="muted">None</span>}</td>
                <td>{r.criteria ? <EvidenceStamp state={r.evidence} /> : <span className="muted">n/a</span>}</td>
                <td className="num-cell">{r.open || <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && <p className="empty">Nothing matches this filter.</p>}
    </section>
  );
}
