import { api, useLoad } from "../api";

export function Templates() {
  const { data, error } = useLoad(api.professions, "professions");
  return (
    <div className="page">
      <header className="page-head">
        <h1>Templates</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading.</p>}
      {data && (
        <ul className="templates" aria-label="Professionals">
          {data.map((p) => (
            <li key={p.role} className="card">
              <strong>{p.name}</strong>
              <span className="tags">
                {p.frameworks.map((f) => (
                  <span key={f} className="tag">
                    {f}
                  </span>
                ))}
              </span>
              <span className="muted">{p.checks}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Each professional works from a pack in this repo.</p>
    </div>
  );
}
