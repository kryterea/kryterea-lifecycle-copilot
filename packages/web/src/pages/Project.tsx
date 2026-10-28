import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Change, ChangeKind, Project as ProjectT } from "@lifecycle/core";
import { api, message, safeHref, useJob, useLoad } from "../api";
import { BackIcon, ChevronIcon, CloseIcon, ExternalIcon, PlusIcon, RefreshIcon } from "../components/Icon";
import { NeedsYou } from "../components/NeedsYou";
import { JobNote, useSpend } from "../components/SpendMeter";
import { MiniTrail, STAGE_NAMES } from "../components/Trail";
import { Connections } from "./Connections";
import { Documents } from "./Documents";
import { Trace } from "./Trace";

const KINDS: Array<[ChangeKind, string]> = [
  ["understand", "Baseline"],
  ["feature", "Feature"],
  ["fix", "Fix"],
];
const KIND_NAME = Object.fromEntries(KINDS) as Record<ChangeKind, string>;

export type Section = "changes" | "needs-you" | "documents" | "trace" | "connections";
const SECTIONS: Array<[Section, string]> = [
  ["changes", "Changes"],
  ["needs-you", "Needs you"],
  ["documents", "Documents"],
  ["trace", "Trace"],
  ["connections", "Connections"],
];

/** A link that opens the URL when it is a safe one; a local path stays plain text. */
function Out({ label, url }: { label: string; url: string }) {
  const href = safeHref(url);
  return href ? (
    <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer">
      <ExternalIcon size={14} /> {label}
    </a>
  ) : (
    <code className="muted" title={label}>
      {url}
    </code>
  );
}

export function Project({ id, section = "changes" }: { id: string; section?: Section }) {
  const [data, setData] = useState<{ project: ProjectT; changes: Array<Change & { withdrawn: boolean }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", kind: "feature" as ChangeKind });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const kindSet = useRef(false);
  const { refresh: refreshSpend } = useSpend();
  const open = useLoad(() => api.openItems(id), id);
  const docs = useLoad(() => api.documents(id), id);
  const reqs = useLoad(() => api.requirements(id), id);

  const load = useCallback(() => {
    api.project(id).then((d) => {
      setData(d);
      // On first load only: a project with no changes starts with a baseline of the app as built.
      if (!kindSet.current && d.changes.length === 0) setForm((f) => ({ ...f, kind: "understand" }));
      kindSet.current = true;
    }, (e) => setError(message(e)));
  }, [id]);
  useEffect(load, [load]);

  const { job, running, start, startError } = useJob(() => {
    load();
    open.reload();
    docs.reload();
    reqs.reload();
    refreshSpend();
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const c = await api.createChange(id, { title: form.title.trim(), description: form.description.trim(), kind: form.kind });
      location.hash = `#/changes/${c.id}`;
    } catch (err) {
      setError(message(err));
      setSaving(false);
    }
  };

  if (!data) return error ? <p className="error page-pad">{error}</p> : <p className="muted page-pad">Loading.</p>;
  const { project, changes } = data;
  const empty = changes.length === 0;
  const formOpen = section === "changes" && (adding || empty);
  const counts: Partial<Record<Section, number>> = {
    changes: changes.length,
    ...(open.data ? { "needs-you": open.data.total } : {}),
    ...(docs.data ? { documents: docs.data.length } : {}),
    ...(reqs.data ? { trace: reqs.data.length } : {}),
  };

  return (
    <div className="page">
      <a className="back" href="#/">
        <BackIcon size={15} /> Projects
      </a>
      <header className="page-head">
        <div>
          <h1>{project.name}</h1>
          <div className="row links">
            <Out label="Repo" url={project.repoUrl} />
            {project.appUrl && <Out label="App" url={project.appUrl} />}
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn secondary icon" disabled={running} onClick={() => start(() => api.recheck(id))} aria-label="Re-check now" title="Re-check now">
            <RefreshIcon size={16} className={running ? "spin" : undefined} />
          </button>
          {section === "changes" && !empty && (
            <button type="button" className={formOpen ? "btn ghost" : "btn primary"} onClick={() => setAdding(!adding)} aria-expanded={formOpen}>
              {formOpen ? <CloseIcon size={16} /> : <PlusIcon size={16} />}
              {formOpen ? "Close" : "New change"}
            </button>
          )}
        </div>
      </header>
      <JobNote job={job} startError={startError} />

      <nav className="sections" aria-label="Project sections">
        {SECTIONS.map(([s, label]) => (
          <a key={s} href={`#/projects/${id}${s === "changes" ? "" : `/${s}`}`} aria-current={s === section ? "page" : undefined} className={s === "needs-you" && counts[s] ? "has-open" : undefined}>
            {label}
            {counts[s] !== undefined && <span className="num">{counts[s]}</span>}
          </a>
        ))}
      </nav>

      {section === "needs-you" && <NeedsYou items={open.data} error={open.error} projectId={id} />}
      {section === "documents" && <Documents projectId={id} rows={docs.data} error={docs.error} onChanged={docs.reload} />}
      {section === "trace" && <Trace projectId={id} rows={reqs.data} error={reqs.error} />}
      {section === "connections" && <Connections projectId={id} />}

      {formOpen && (
        <form className="card form" onSubmit={create}>
          {empty && <p className="hint">Start with a baseline so every later change has one.</p>}
          <fieldset className="segmented">
            <legend className="sr-only">Kind</legend>
            {KINDS.map(([k, label]) => (
              <label key={k} className={form.kind === k ? "is-on" : undefined}>
                <input type="radio" name="kind" value={k} checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            <span>Title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          </label>
          <label>
            <span>What should change, for whom, and why</span>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required maxLength={20000} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn primary" disabled={saving}>
              <PlusIcon size={16} /> Add change
            </button>
          </div>
        </form>
      )}

      {section === "changes" && !empty && (
        <ul className="rows" aria-label="Changes">
          {changes.map((c) => (
            <li key={c.id}>
              <a href={`#/changes/${c.id}`}>
                <span className="row-main">
                  <strong>{c.title}</strong>
                  <span className="row-sub">
                    <MiniTrail stage={c.stage} />
                    <span>{c.withdrawn ? "Withdrawn" : STAGE_NAMES[c.stage]}</span>
                    <span className="muted">{KIND_NAME[c.kind]}</span>
                  </span>
                </span>
                <ChevronIcon size={16} className="go" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
