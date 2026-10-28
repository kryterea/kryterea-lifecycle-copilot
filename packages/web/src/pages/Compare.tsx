import type { CommitCompare, CommitState } from "../api";
import { api, useLoad } from "../api";
import { BackIcon } from "../components/Icon";
import { EvidenceStamp } from "../components/ProfessionalCard";
import { StatusStamp } from "../components/Stamp";

type Metric = [keyof Omit<CommitState, "sha">, string, "down" | "up"];
const METRICS: Metric[] = [
  ["open", "Open items", "down"],
  ["evidenceFound", "Evidence found", "up"],
  ["gaps", "Gaps", "down"],
  ["noEvidence", "No evidence", "down"],
];

const short = (sha: string) => sha.slice(0, 7);
const go = (projectId: string, from: string, to: string) => (location.hash = `#/projects/${projectId}/compare/${short(from)}/${short(to)}`);

/** Before and after: what was open and what had evidence at two commits Kryterea checked. */
export function Compare({ projectId, from, to }: { projectId: string; from?: string; to?: string }) {
  const commits = useLoad(() => api.commits(projectId), projectId);
  const list = commits.data ?? [];
  const a = from ?? list[0]?.sha;
  const b = to ?? list.at(-1)?.sha;
  const ready = a !== undefined && b !== undefined && a !== b;
  const cmp = useLoad(() => (ready ? api.compare(projectId, a, b) : Promise.resolve(null)), `${projectId}/${a}/${b}`);
  // The findings that explain her problem come from the project's latest understand change.
  const problem = useLoad(async () => {
    const { changes } = await api.project(projectId);
    const check = changes.filter((c) => c.kind === "understand").at(-1);
    return check ? ((await api.change(check.id)).proposals?.answersProblem ?? []) : [];
  }, projectId);

  const picker = (label: string, value: string | undefined, set: (sha: string) => void) => (
    <label className="compare-pick">
      <span>{label}</span>
      <select value={list.find((c) => value && c.sha.startsWith(value))?.sha ?? ""} onChange={(e) => set(e.target.value)}>
        {list.map((c) => (
          <option key={c.sha} value={c.sha}>
            {short(c.sha)} · {new Date(c.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="page wide">
      <a className="back" href={`#/projects/${projectId}/trace`}>
        <BackIcon size={15} /> Trace
      </a>
      <header className="page-head">
        <div>
          <h1>Before and after</h1>
          <p className="lead-line">Open items and evidence as they stood at each commit Kryterea checked, decisions included.</p>
        </div>
      </header>
      {commits.error ? (
        <p className="error">{commits.error}</p>
      ) : !commits.data ? (
        <p className="muted">Loading.</p>
      ) : list.length < 2 ? (
        <p className="empty">Kryterea has checked {list.length === 1 ? "one commit" : "no commits"} so far. Push a change and run a check to compare.</p>
      ) : (
        <div className="stack">
          <div className="compare-picks">
            {picker("Before", a, (sha) => go(projectId, sha, b!))}
            {picker("After", b, (sha) => go(projectId, a!, sha))}
          </div>
          {!ready ? (
            <p className="empty">Pick two different commits.</p>
          ) : cmp.error ? (
            <p className="error">{cmp.error}</p>
          ) : !cmp.data ? (
            <p className="muted">Loading.</p>
          ) : (
            <Result projectId={projectId} cmp={cmp.data} yours={new Set(problem.data ?? [])} />
          )}
        </div>
      )}
    </div>
  );
}

function delta(before: number, after: number, better: "down" | "up") {
  const d = after - before;
  if (d === 0) return { text: "Same", tone: "same" };
  const good = better === "down" ? d < 0 : d > 0;
  return { text: `${Math.abs(d)} ${d < 0 ? "fewer" : "more"}`, tone: good ? "good" : "bad" };
}

function Result({ projectId, cmp, yours }: { projectId: string; cmp: CommitCompare; yours: Set<string> }) {
  // Her problem first, closed or still open; the groups below hold the rest.
  const mine = cmp.findings.filter((f) => yours.has(f.id) && f.from === "open");
  const rest = cmp.findings.filter((f) => !mine.includes(f));
  const closed = rest.filter((f) => f.from === "open" && f.to !== null && f.to !== "open");
  const added = rest.filter((f) => f.from !== "open" && f.to === "open");
  const still = rest.filter((f) => f.from === "open" && f.to === "open");
  const moved = cmp.criteria.filter((k) => k.from !== k.to);
  const same = cmp.criteria.length - moved.length;
  return (
    <>
      <section className="compare-metrics" aria-label="Summary">
        {METRICS.map(([key, label, better]) => {
          const d = delta(cmp.from[key], cmp.to[key], better);
          return (
            <div key={key} className="metric card">
              <span className="metric-label">{label}</span>
              <span className="metric-values">
                <span className="muted">{cmp.from[key]}</span>
                <span aria-label="to"> → </span>
                <strong>{cmp.to[key]}</strong>
              </span>
              <span className={`metric-delta is-${d.tone}`}>{d.text}</span>
            </div>
          );
        })}
      </section>
      <p className="row-sub">
        <a href={`#/projects/${projectId}/commits/${cmp.from.sha}`}>
          <code>{short(cmp.from.sha)}</code>
        </a>
        <span>to</span>
        <a href={`#/projects/${projectId}/commits/${cmp.to.sha}`}>
          <code>{short(cmp.to.sha)}</code>
        </a>
      </p>

      {mine.length > 0 && <FindingGroup title="Your problem" empty="" rows={mine} />}
      <FindingGroup title="Closed" empty="Nothing open before was closed." rows={closed} />
      <FindingGroup title="New" empty="Nothing new opened." rows={added} />
      <FindingGroup title="Still open" empty="Nothing open before is still open." rows={still} />

      <section className="block">
        <h3 className="block-head">Acceptance criteria</h3>
        {moved.length ? (
          <ul className="plain-list compare-list">
            {moved.map((k) => (
              <li key={k.id}>
                <span className="compare-stamps">
                  {k.from ? <EvidenceStamp state={k.from} /> : <span className="muted small">Not checked</span>}
                  <span aria-label="to">→</span>
                  <EvidenceStamp state={k.to} />
                </span>
                <span>
                  {k.requirementKeys.length > 0 && <span className="key">{k.requirementKeys.join(", ")}</span>}
                  {k.text}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No criterion changed state.</p>
        )}
        {same > 0 && <p className="muted small">{same === 1 ? "1 criterion" : `${same} criteria`} unchanged.</p>}
      </section>
    </>
  );
}

function FindingGroup({ title, empty, rows }: { title: string; empty: string; rows: CommitCompare["findings"] }) {
  return (
    <section className="block">
      <h3 className="block-head">
        {title} <span className="muted">{rows.length}</span>
      </h3>
      {rows.length ? (
        <ul className="plain-list compare-list">
          {rows.map((f) => (
            <li key={f.id}>
              <span className="compare-stamps">
                {f.from ? <StatusStamp status={f.from} kind={f.kind} /> : <span className="muted small">Not raised</span>}
                <span aria-label="to">→</span>
                {f.to && <StatusStamp status={f.to} kind={f.kind} />}
              </span>
              <span>{f.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}
