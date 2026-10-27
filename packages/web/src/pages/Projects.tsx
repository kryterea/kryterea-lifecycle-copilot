import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "@lifecycle/core";
import { api, message } from "../api";

export function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", repoUrl: "", appUrl: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.projects().then(setProjects, (e) => setError(message(e)));
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Each project is one app the copilot watches. It reads the code and never writes to it.</p>
        </div>
      </div>

      <section className="sheet" aria-label="Your projects">
        {projects === null && !error && <p className="muted">Loading projects.</p>}
        {projects?.length === 0 && <p className="empty">No projects yet. Add the first one below.</p>}
        {projects && projects.length > 0 && (
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`#/projects/${p.id}`}>
                  <strong>{p.name}</strong>
                  <span className="muted mono">{p.repoUrl}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sheet">
        <h2>New project</h2>
        <form className="stack" onSubmit={create}>
          <label>
            Name
            <input value={form.name} onChange={set("name")} required maxLength={200} />
          </label>
          <label>
            Repo URL
            <span className="hint">An https git URL. A local path works when the server allows local repos.</span>
            <input value={form.repoUrl} onChange={set("repoUrl")} required maxLength={2000} spellCheck={false} />
          </label>
          <label>
            App URL
            <span className="hint">Optional. Where the running app lives.</span>
            <input type="url" value={form.appUrl} onChange={set("appUrl")} maxLength={2000} spellCheck={false} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={saving}>
            Add project
          </button>
        </form>
      </section>
    </>
  );
}
