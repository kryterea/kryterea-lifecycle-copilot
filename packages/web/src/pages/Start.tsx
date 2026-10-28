import { useState, type FormEvent } from "react";
import { api, message, useLoad } from "../api";
import { CheckIcon, ChevronIcon } from "../components/Icon";

const GROUP_LABEL = { code: "Code", documents: "Documents", config: "Config", tests: "Tests", skipped: "Skipped" } as const;

/** After linking a repo: what was read, what is wrong in her words, who should look. */
export function Start({ id }: { id: string }) {
  const project = useLoad(() => api.project(id), id);
  const files = useLoad(() => api.files(id), id);
  const professions = useLoad(() => api.professions(), "professions");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.check(id, problem.trim());
      location.hash = `#/changes/${encodeURIComponent(r.changeId)}/assessment`;
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{project.data?.project.name ?? "New project"}</h1>
        </div>
      </header>

      <section className="start-block">
        <h2>Files picked up</h2>
        {!files.data && !files.error && <p className="muted">Reading the repo</p>}
        {files.error && <p className="error">Could not read the repo. {files.error}</p>}
        {files.data && (
          <>
            <ul className="rows" aria-label="Files picked up">
              {files.data.groups
                .filter((g) => g.files.length > 0)
                .map((g) => (
                  <li key={g.kind}>
                    <div className="item">
                      <strong>{GROUP_LABEL[g.kind]}</strong>
                      <span className="mono muted">{g.files.length}</span>
                    </div>
                  </li>
                ))}
            </ul>
            {files.data.documents.length > 0 && (
              <ul className="rows" aria-label="Documents">
                {files.data.documents.map((d) => (
                  <li key={d.path}>
                    <div className="item">
                      <span className="mono start-path">{d.path}</span>
                      <span className="mono muted nowrap">{d.lines} lines</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <form className="card form" onSubmit={check}>
        <label>
          <span>What is wrong?</span>
          <input
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            maxLength={500}
            placeholder="Describe the problem in your own words, or leave it empty to check the whole repo."
          />
        </label>
        <div className="start-block">
          <h2>Who should look?</h2>
          <p className="start-auto">
            <CheckIcon size={16} /> <strong>Auto (recommended)</strong>
          </p>
          {professions.data && (
            <ul className="rows" aria-label="Professionals">
              {professions.data.map((p) => (
                <li key={p.role}>
                  <div className="item">
                    <span className="row-main">
                      <strong>{p.name}</strong>
                      <span className="hint">{p.why}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy || !!files.error}>
            Check <ChevronIcon size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
