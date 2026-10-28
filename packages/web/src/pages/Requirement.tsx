import { useState, type FormEvent } from "react";
import { api, message, useLoad } from "../api";
import { BackIcon } from "../components/Icon";
import { TraceChain } from "../components/TraceChain";

/** The full chain for one requirement, with a field to link its Linear ticket. */
export function Requirement({ id }: { id: string }) {
  const { data, error, reload } = useLoad(() => api.trace(id), id);
  const [ticket, setTicket] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (error) return <p className="error page-pad">{error}</p>;
  if (!data) return <p className="muted page-pad">Loading.</p>;
  const link = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const r = await api.linkLinear(id, ticket.trim());
      setNote(`Linked ${r.identifier}. Its comment follows on the next check.`);
      setTicket("");
      reload();
    } catch (err) {
      setNote(message(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="page">
      <a className="back" href={`#/projects/${data.requirement.projectId}/trace`}>
        <BackIcon size={15} /> Trace
      </a>
      <header className="page-head">
        <div>
          <p className="eyebrow">{data.requirement.key}</p>
          <h1>{data.requirement.text}</h1>
        </div>
      </header>
      <TraceChain
        t={data}
        linear={
          <li className="node node-form">
            <form className="row" onSubmit={link}>
              <label className="sr-only" htmlFor="ticket">
                Linear ticket
              </label>
              <input id="ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="ENG-12" required maxLength={30} spellCheck={false} />
              <button type="submit" className="btn secondary sm" disabled={saving}>
                Link ticket
              </button>
              {note && <span className="hint">{note}</span>}
            </form>
          </li>
        }
      />
    </div>
  );
}
