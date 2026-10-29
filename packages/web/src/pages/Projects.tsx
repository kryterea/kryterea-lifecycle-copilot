import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "@lifecycle/core";
import { api, message } from "../api";
import { BranchIcon, ChevronIcon, CloseIcon, PlusIcon } from "../components/Icon";
import { Stamp } from "../components/Stamp";

/** The name the server gives a project linked without one: the repo name as words. Same rule as the server. */
function nameFromRepo(repoUrl: string): string {
  const raw = repoUrl.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)!.replace(/\.git$/, "");
  const words = raw.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "";
}

export function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
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
      const p = await api.createProject({ repoUrl: repoUrl.trim() });
      location.hash = `#/projects/${p.id}/start`;
    } catch (err) {
      setError(message(err));
      setSaving(false);
    }
  };

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
            <span>GitHub repo</span>
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required maxLength={2000} spellCheck={false} autoFocus={!empty} placeholder="https://github.com/you/app" />
            {nameFromRepo(repoUrl) && <span className="hint">Project name: {nameFromRepo(repoUrl)}</span>}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn primary" disabled={saving}>
              <BranchIcon size={16} /> Link repo
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
