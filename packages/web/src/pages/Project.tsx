import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Change, ChangeKind, Project as ProjectT } from "@lifecycle/core";
import { api, message, useJob } from "../api";
import { STAGE_NAMES } from "../components/StageStrip";
import { JobNote, useSpend } from "../components/SpendMeter";

const KINDS: Array<[ChangeKind, string]> = [
  ["understand", "Understand the app as it is built"],
  ["feature", "New feature"],
  ["fix", "Fix"],
];

/** A repo URL as a link when it is one; a local path stays plain text. */
const RepoLink = ({ url }: { url: string }) =>
  /^https:\/\//i.test(url) ? (
    <a href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  ) : (
    <code>{url}</code>
  );

export function Project({ id }: { id: string }) {
  const [data, setData] = useState<{ project: ProjectT; changes: Change[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", kind: "feature" as ChangeKind });
  const [saving, setSaving] = useState(false);
  const { refresh: refreshSpend } = useSpend();

  const load = useCallback(() => {
    api.project(id).then(setData, (e) => setError(message(e)));
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

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading project.</p>;
  const { project, changes } = data;

  return (
    <>
      <nav className="crumbs">
        <a href="#/">Projects</a>
      </nav>
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <div className="links" style={{ marginTop: 8 }}>
            <span>
              Repo <RepoLink url={project.repoUrl} />
            </span>
            {project.appUrl && (
              <span>
                App{" "}
                <a href={project.appUrl} target="_blank" rel="noreferrer">
                  {project.appUrl}
                </a>
              </span>
            )}
          </div>
        </div>
        <div className="stack">
          <button type="button" disabled={running} onClick={() => start(() => api.recheck(id))}>
            Re-check now
          </button>
          <JobNote job={job} startError={startError} />
        </div>
      </div>

      <section className="sheet">
        <h2>Changes</h2>
        {changes.length === 0 ? (
          <p className="empty">No changes yet. Start with "Understand the app as it is built" so every later change has a baseline.</p>
        ) : (
          <ul className="list">
            {changes.map((c) => (
              <li key={c.id}>
                <a href={`#/changes/${c.id}`}>
                  <strong>{c.title}</strong>
                  <span className="muted">{STAGE_NAMES[c.stage]}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sheet">
        <h2>New change</h2>
        <form className="stack" onSubmit={create}>
          <label>
            Title
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          </label>
          <label>
            Description
            <span className="hint">What should change, for whom, and why. Plain words are best.</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              maxLength={20000}
            />
          </label>
          <label>
            Kind
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ChangeKind })}>
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={saving}>
            Add change
          </button>
        </form>
      </section>
    </>
  );
}
