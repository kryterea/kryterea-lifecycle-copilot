import { useState } from "react";
import { api, useLoad } from "../api";
import { BackIcon } from "../components/Icon";
import { Stamp } from "../components/Stamp";

/** Lines in `after` that are not in `before`, and the other way round. */
function lineDiff(before: string, after: string) {
  const a = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
  const b = new Set(after.split("\n").map((l) => l.trim()).filter(Boolean));
  return { added: [...b].filter((l) => !a.has(l)), removed: [...a].filter((l) => !b.has(l)) };
}

/** The document as Kryterea read it: numbered lines, each requirement marked, each gap beside its line. */
export function DocumentDetail({ projectId, docId }: { projectId: string; docId: string }) {
  const { data, error } = useLoad(() => api.document(docId), docId);
  const [pick, setPick] = useState<number | null>(null);
  if (error) return <p className="error page-pad">{error}</p>;
  if (!data) return <p className="muted page-pad">Loading.</p>;
  const { document: doc, versions, requirements, findings } = data;
  const latest = versions.length - 1;
  const at = pick ?? latest;
  const version = versions[at]!;
  const isLatest = at === latest;
  const active = requirements.filter((r) => r.status === "active");
  const reqAt = new Map(active.map((r) => [r.line, r]));
  const gapsAt = new Map<number, typeof findings>();
  for (const f of findings) {
    const line = f.trigger.type === "doc" ? f.trigger.line : undefined;
    if (line) gapsAt.set(line, [...(gapsAt.get(line) ?? []), f]);
  }
  const unplaced = findings.filter((f) => f.trigger.type !== "doc" || !f.trigger.line);
  const diff = versions.length > 1 ? lineDiff(versions[latest - 1]!.body, versions[latest]!.body) : null;
  return (
    <div className="page wide">
      <a className="back" href={`#/projects/${projectId}/documents`}>
        <BackIcon size={15} /> Documents
      </a>
      <header className="page-head">
        <div>
          <h1 className="mono-name">{doc.name}</h1>
          <p className="row-sub">
            <span>{doc.source === "repo" ? "Repo" : "Pasted"}</span>
            <span>{active.length === 1 ? "1 requirement" : `${active.length} requirements`}</span>
            {findings.length > 0 ? <Stamp tone="held">{findings.length === 1 ? "1 gap" : `${findings.length} gaps`}</Stamp> : <Stamp tone="cleared">No gaps</Stamp>}
          </p>
        </div>
        {versions.length > 1 && (
          <label className="version-pick">
            <span className="sr-only">Version</span>
            <select value={at} onChange={(e) => setPick(Number(e.target.value))}>
              {versions.map((v, i) => (
                <option key={v.id} value={i}>
                  Version {i + 1}
                  {v.commit ? ` at ${v.commit.slice(0, 7)}` : ""}
                  {i === latest ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {diff && isLatest && (diff.added.length > 0 || diff.removed.length > 0) && (
        <section className="block">
          <h3 className="block-head">Last change</h3>
          <ul className="plain-list diff">
            {diff.removed.map((l) => (
              <li key={`-${l}`} className="del">
                {l}
              </li>
            ))}
            {diff.added.map((l) => (
              <li key={`+${l}`} className="ins">
                {l}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="doc-lines card">
        {version.body.split("\n").map((text, i) => {
          const n = i + 1;
          const req = isLatest ? reqAt.get(n) : undefined;
          const gaps = isLatest ? gapsAt.get(n) : undefined;
          return (
            <li key={n} className={req ? "has-req" : gaps ? "has-gap" : undefined}>
              <span className="ln" aria-hidden="true">
                {n}
              </span>
              <span className="lt">
                {req && !text.trimStart().startsWith(req.key) && <span className="key">{req.key}</span>}
                {text || " "}
                {gaps?.map((g) => (
                  <span key={g.id} className="gap-note">
                    <Stamp tone="held">Gap</Stamp> {g.title}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>

      {isLatest && unplaced.length > 0 && (
        <section className="block">
          <h3 className="block-head">Gaps without a line</h3>
          <ul className="plain-list">
            {unplaced.map((g) => (
              <li key={g.id}>{g.title}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
