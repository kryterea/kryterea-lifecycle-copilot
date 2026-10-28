import { useState } from "react";
import { api, useLoad, type ConnectionState } from "../api";
import { CheckIcon, CopyIcon } from "../components/Icon";
import { Stamp } from "../components/Stamp";

function State({ s }: { s: ConnectionState }) {
  if (s.state === "connected") return <Stamp tone="cleared">Connected</Stamp>;
  if (s.state === "error") return <Stamp tone="danger">Error</Stamp>;
  return <Stamp tone="idle">Not connected</Stamp>;
}

function Side({ name, s, keyName, extra }: { name: string; s: ConnectionState; keyName: string; extra?: string }) {
  return (
    <li className="connection">
      <div className="connection-head">
        <strong>{name}</strong>
        <State s={s} />
      </div>
      {s.state === "off" && <p className="hint">Not connected. Add {keyName} to .env and restart.</p>}
      {s.state === "error" && <p className="error">{s.detail}</p>}
      {s.state === "connected" && (
        <p className="hint">
          {s.lastComment ? `Last comment on ${s.lastComment}.` : "No comment yet. The next check writes one."}
          {extra ? ` ${extra}` : ""}
        </p>
      )}
    </li>
  );
}

/** Where Kryterea's warnings reach people: the coding agent, GitHub and Linear. */
export function Connections({ projectId }: { projectId: string }) {
  const { data, error } = useLoad(() => api.connections(projectId), projectId);
  const [copied, setCopied] = useState(false);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading.</p>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.mcp.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="stack">
      <p className="lead-line">Kryterea comments and warns. It never blocks a merge or an agent.</p>
      <ul className="rows connections">
        <li className="connection">
          <div className="connection-head">
            <strong>Coding agent</strong>
            <Stamp tone="cleared">Over MCP</Stamp>
          </div>
          <p className="hint">Every answer opens with what is still open on this project.</p>
          <div className="command">
            <code>{data.mcp.command}</code>
            <button type="button" className="btn ghost icon sm" onClick={copy} aria-label="Copy command" title="Copy command">
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
          </div>
        </li>
        <Side name="GitHub" s={data.github} keyName="GITHUB_TOKEN" />
        <Side name="Linear" s={data.linear} keyName="LINEAR_API_KEY" extra={data.linear.tickets === 1 ? "1 linked ticket." : `${data.linear.tickets} linked tickets.`} />
      </ul>
    </section>
  );
}
