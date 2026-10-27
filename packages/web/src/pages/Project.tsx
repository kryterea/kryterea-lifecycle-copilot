import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Change, ChangeKind, Project as ProjectT } from "@lifecycle/core";
import { api, message, safeHref, useJob } from "../api";
import { BackIcon, ChevronIcon, CloseIcon, ExternalIcon, PlusIcon, RefreshIcon } from "../components/Icon";
import { JobNote, useSpend } from "../components/SpendMeter";
import { MiniTrail, STAGE_NAMES } from "../components/Trail";

const KINDS: Array<[ChangeKind, string]> = [
  ["understand", "Baseline"],
  ["feature", "Feature"],
  ["fix", "Fix"],
];
const KIND_NAME = Object.fromEntries(KINDS) as Record<ChangeKind, string>;

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

export function Project({ id }: { id: string }) {
  const [data, setData] = useState<{ project: ProjectT; changes: Change[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", kind: "feature" as ChangeKind });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const kindSet = useRef(false);
  const { refresh: refreshSpend } = useSpend();

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
  const open = adding || empty;

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
          {!empty && (
            <button type="button" className={open ? "btn ghost" : "btn primary"} onClick={() => setAdding(!adding)} aria-expanded={open}>
              {open ? <CloseIcon size={16} /> : <PlusIcon size={16} />}
              {open ? "Close" : "New change"}
            </button>
          )}
        </div>
      </header>
      <JobNote job={job} startError={startError} />

      {open && (
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

      {!empty && (
        <ul className="rows" aria-label="Changes">
          {changes.map((c) => (
            <li key={c.id}>
              <a href={`#/changes/${c.id}`}>
                <span className="row-main">
                  <strong>{c.title}</strong>
                  <span className="row-sub">
                    <MiniTrail stage={c.stage} />
                    <span>{STAGE_NAMES[c.stage]}</span>
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
