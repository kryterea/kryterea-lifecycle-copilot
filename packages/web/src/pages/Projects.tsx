import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "@lifecycle/core";
import { api, message } from "../api";
import { ChevronIcon, CloseIcon, PlusIcon } from "../components/Icon";
import { Stamp } from "../components/Stamp";

export function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", repoUrl: "", appUrl: "" });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    api.projects().then((list) => {
      setProjects(list);
      // Each project's open count; one that cannot be read simply shows no stamp.
      for (const p of list) api.openItems(p.id).then((r) => setOpenCounts((o) => ({ ...o, [p.id]: r.total })), () => {});
    }, (e) => setError(message(e)));
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const p = await api.createProject({
        name: form.name.trim(),
        repoUrl: form.repoUrl.trim(),
        ...(form.appUrl.trim() ? { appUrl: form.appUrl.trim() } : {}),
      });
      location.hash = `#/projects/${p.id}`;
    } catch (err) {
      setError(message(err));
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const empty = projects?.length === 0;
  const open = adding || empty;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="pane-line">Claude and Codex build. Kryterea is the professional they build with.</p>
        </div>
        {!empty && (
          <button type="button" className={open ? "btn ghost" : "btn primary"} onClick={() => setAdding(!adding)} aria-expanded={open}>
            {open ? <CloseIcon size={16} /> : <PlusIcon size={16} />}
            {open ? "Close" : "New project"}
          </button>
        )}
      </header>

      {open && (
        <form className="card form" onSubmit={create}>
          <label>
            <span>Name</span>
            <input value={form.name} onChange={set("name")} required maxLength={200} autoFocus={!empty} />
          </label>
          <label>
            <span>Repo URL</span>
            <input value={form.repoUrl} onChange={set("repoUrl")} required maxLength={2000} spellCheck={false} placeholder="https://github.com/you/app" />
          </label>
          <label>
            <span>
              App URL <em>optional</em>
            </span>
            <input type="url" value={form.appUrl} onChange={set("appUrl")} maxLength={2000} spellCheck={false} placeholder="https://app.example.com" />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn primary" disabled={saving}>
              <PlusIcon size={16} /> Add project
            </button>
          </div>
        </form>
      )}

      {projects === null && !error && <p className="muted">Loading.</p>}
      {!open && error && <p className="error">{error}</p>}
      {projects && projects.length > 0 && (
        <ul className="rows" aria-label="Your projects">
          {projects.map((p) => (
            <li key={p.id}>
              <a href={`#/projects/${p.id}`}>
                <span className="row-main">
                  <strong>{p.name}</strong>
                  <span className="mono muted">{p.repoUrl.replace(/^https:\/\//i, "")}</span>
                </span>
                {openCounts[p.id] !== undefined && (openCounts[p.id] ? <Stamp tone="held">{`${openCounts[p.id]} open`}</Stamp> : <Stamp tone="cleared">Nothing open</Stamp>)}
                <ChevronIcon size={16} className="go" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
