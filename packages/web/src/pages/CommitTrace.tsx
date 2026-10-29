import { api, useLoad } from "../api";
import { BackIcon } from "../components/Icon";
import { StatusStamp } from "../components/Stamp";

/** Backward from one commit: the files, the criteria their lines support, the requirements and documents behind them. */
export function CommitTrace({ projectId, sha }: { projectId: string; sha: string }) {
  const { data, error } = useLoad(() => api.commitTrace(projectId, sha), `${projectId}/${sha}`);
  return (
    <div className="page">
      <a className="back" href={`#/projects/${projectId}/trace`}>
        <BackIcon size={15} /> Trace
      </a>
      <header className="page-head">
        <h1>
          Commit <code>{(data?.sha ?? sha).slice(0, 7)}</code>
        </h1>
        {data && (
          <a className="btn secondary sm" href={`#/projects/${projectId}/compare/${data.sha.slice(0, 7)}`}>
            Compare with the latest
          </a>
        )}
      </header>
      {error ? (
        <p className="empty">{error}</p>
      ) : !data ? (
        <p className="muted">Loading.</p>
      ) : (
        <div className="stack">
          <section className="block">
            <h3 className="block-head">Files</h3>
            {data.files.length ? (
              <ul className="plain-list">
                {data.files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No evidence cites a file at this commit.</p>
            )}
          </section>
          <section className="block">
            <h3 className="block-head">Criteria checked here</h3>
            {data.criteria.length ? (
              <ul className="plain-list">
                {data.criteria.map((k) => (
                  <li key={k.id}>
                    {k.requirementKeys.length > 0 && <span className="key">{k.requirementKeys.join(", ")}</span>} {k.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </section>
          <section className="block">
            <h3 className="block-head">Documents</h3>
            {data.documents.length ? (
              <ul className="plain-list">
                {data.documents.map((d) => (
                  <li key={d}>
                    <code>{d}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No requirement links these criteria to a document.</p>
            )}
          </section>
          <section className="block">
            <h3 className="block-head">Findings</h3>
            {data.findings.length ? (
              <ul className="plain-list">
                {data.findings.map((f) => (
                  <li key={f.id} className="row">
                    <StatusStamp status={f.status} /> {f.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None raised or confirmed at this commit.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
