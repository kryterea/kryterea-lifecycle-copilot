import { age, type OpenItem } from "../api";
import { KIND } from "./FindingItem";
import { ROLES } from "./ProfessionalCard";
import { Stamp, type Tone } from "./Stamp";

const TONE: Record<OpenItem["kind"], Tone> = { legal: "danger", failure_path: "held", conformance: "held", operations: "held", setup: "you" };
const LABEL: Record<OpenItem["kind"], string> = { ...KIND, setup: "Setup" };

/** What still needs a person, most pressing first. An item leaves only when fixed and confirmed, or accepted with a name. */
export function NeedsYou({ items, error, projectId }: { items: { total: number; items: OpenItem[] } | null; error: string | null; projectId?: string }) {
  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading.</p>;
  if (!items.total) return <p className="empty">Nothing open. Every item is fixed and confirmed, or accepted with a name.</p>;
  return (
    <section aria-labelledby="needs-title">
      <h2 id="needs-title" className="section-head">
        {items.total} open <span className="muted">Most pressing first. Each stays until fixed and confirmed, or accepted with a name.</span>
      </h2>
      <ul className="rows open-items">
        {items.items.map((i) => (
          <li key={i.id}>
            <div className="open-item">
              <div className="open-item-head">
                <Stamp tone={TONE[i.kind]}>{LABEL[i.kind]}</Stamp>
                <strong>{i.title}</strong>
              </div>
              <p className="open-item-why">{i.why}</p>
              <p className="row-sub">
                <span>{i.role === "ba" && i.kind === "setup" ? "Kryterea" : ROLES[i.role].name}</span>
                <code>{i.where}</code>
                {i.requirementKey && <span>{i.requirementKey}</span>}
                {i.createdAt && <span className="muted">{age(i.createdAt)}</span>}
              </p>
              {(i.changeId || i.requirementId || i.kind === "setup") && (
                <p className="row links">
                  {i.changeId && (
                    <a className="btn ghost sm" href={`#/changes/${i.changeId}`}>
                      Finding
                    </a>
                  )}
                  {i.requirementId && (
                    <a className="btn ghost sm" href={`#/requirements/${i.requirementId}`}>
                      Trace
                    </a>
                  )}
                  {i.kind === "setup" && projectId && (
                    <a className="btn ghost sm" href={`#/projects/${projectId}/documents`}>
                      Add a document
                    </a>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
