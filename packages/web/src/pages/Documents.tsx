import { useState, type FormEvent } from "react";
import { api, message, type DocumentRow } from "../api";
import { ChevronIcon, CloseIcon, PlusIcon } from "../components/Icon";
import { Stamp } from "../components/Stamp";

const MAX_DOC_BYTES = 200 * 1024;
const TOO_BIG = "That document is over 200 KB. Split it or paste the part that matters.";
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** Paste or upload a document the repo does not hold: a client brief, a spec from Notion or Drive. */
function Paste({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) return setError(TOO_BIG);
    setName((n) => n || file.name);
    setBody(await file.text());
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (new Blob([body]).size > MAX_DOC_BYTES) return setError(TOO_BIG);
    setSaving(true);
    setError(null);
    try {
      await api.uploadDocument(projectId, { name: name.trim(), body });
      setName("");
      setBody("");
      onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="card form" onSubmit={save}>
      <label>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="Client brief" />
      </label>
      <label>
        <span>Markdown</span>
        <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <label className="file">
        <span>Or choose a .md file</span>
        <input type="file" accept=".md,.mdx,.txt,text/markdown,text/plain" onChange={(e) => void fromFile(e.target.files?.[0])} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn primary" disabled={saving}>
          <PlusIcon size={16} /> Add document
        </button>
        <span className="hint">Kryterea reads it on the next check.</span>
      </div>
    </form>
  );
}

/** Which repo files count as documents, besides docs/ and files named like a PRD, spec or requirements. */
function Patterns({ projectId }: { projectId: string }) {
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.docSettings(projectId, { include: lines(include), exclude: lines(exclude) });
      setNote("Saved. The next check uses these patterns.");
    } catch (err) {
      setNote(message(err));
    }
  };
  return (
    <form className="card form" onSubmit={save}>
      <p className="hint">Kryterea reads Markdown under docs/ and files named like a PRD, spec or requirements. One pattern per line.</p>
      <div className="two">
        <label>
          <span>Also read</span>
          <textarea rows={3} value={include} onChange={(e) => setInclude(e.target.value)} placeholder="notes/**/*.md" />
        </label>
        <label>
          <span>Skip</span>
          <textarea rows={3} value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="docs/archive/**" />
        </label>
      </div>
      <div className="row">
        <button type="submit" className="btn secondary">
          Save patterns
        </button>
        {note && <span className="hint">{note}</span>}
      </div>
    </form>
  );
}

export function Documents({ projectId, rows, error, onChanged }: { projectId: string; rows: DocumentRow[] | null; error: string | null; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [patterns, setPatterns] = useState(false);
  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading.</p>;
  return (
    <section className="stack">
      <div className="row">
        <button type="button" className={adding ? "btn ghost" : "btn primary"} onClick={() => setAdding(!adding)} aria-expanded={adding}>
          {adding ? <CloseIcon size={16} /> : <PlusIcon size={16} />} {adding ? "Close" : "Paste a document"}
        </button>
        <button type="button" className="btn ghost" onClick={() => setPatterns(!patterns)} aria-expanded={patterns}>
          File patterns
        </button>
      </div>
      {adding && (
        <Paste
          projectId={projectId}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
      {patterns && <Patterns projectId={projectId} />}
      {rows.length === 0 ? (
        <p className="empty">No PRD or spec yet. Kryterea reads them from docs/ in the repo each time a change runs, or paste one here.</p>
      ) : (
        <ul className="rows" aria-label="Documents">
          {rows.map((d) => (
            <li key={d.id}>
              <a href={`#/projects/${projectId}/documents/${d.id}`}>
                <span className="row-main">
                  <strong className="mono-name">{d.name}</strong>
                  <span className="row-sub">
                    <span>{d.source === "repo" ? "Repo" : "Pasted"}</span>
                    <span>{d.versions === 1 ? "1 version" : `${d.versions} versions`}</span>
                    {d.latest.commit && <code>{d.latest.commit.slice(0, 7)}</code>}
                    <span>{d.requirements === 1 ? "1 requirement" : `${d.requirements} requirements`}</span>
                  </span>
                </span>
                {d.gaps > 0 ? <Stamp tone="held">{d.gaps === 1 ? "1 gap" : `${d.gaps} gaps`}</Stamp> : <Stamp tone="cleared">No gaps</Stamp>}
                <ChevronIcon size={16} className="go" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
