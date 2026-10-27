import { useState } from "react";
import type { FindingKind, FindingStatus, Trigger } from "@lifecycle/core";
import { api, message, safeHref, useActor, type FindingView } from "../api";
import { Reasoned } from "./SpendMeter";

const KIND: Record<FindingKind, string> = {
  legal: "Legal duty",
  failure_path: "Failure path",
  operations: "Operations",
  conformance: "Acceptance criterion",
};

export const STATUS: Record<FindingStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  accepted_risk: "Risk accepted",
  deferred: "Deferred",
};

/** PCI DSS is an industry standard, the NDPA is law; the tag says which. */
export const lawTag = (law: FindingView["law"]) => (law === "PCI DSS" ? "Standard" : law ? "Law" : null);

export function TriggerLine({ trigger }: { trigger: Trigger }) {
  if (trigger.type === "code") {
    return (
      <p>
        <code>
          {trigger.file}:{trigger.line}
        </code>{" "}
        <span className="muted small">at commit {trigger.commit.slice(0, 7)}</span>
      </p>
    );
  }
  if (trigger.type === "doc") return <blockquote>{trigger.quote}</blockquote>;
  const href = safeHref(trigger.url);
  return (
    <p>
      Seen on {href ? <a href={href}>{trigger.url}</a> : <code>{trigger.url}</code>}{" "}
      <span className="muted small">({trigger.screenshotPath})</span>
    </p>
  );
}

const DECISIONS: Array<[FindingStatus, string]> = [
  ["fixed", "Fixed"],
  ["accepted_risk", "Accept risk"],
  ["deferred", "Defer"],
];

export function FindingItem({ finding, onChanged }: { finding: FindingView; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [actor, setActor] = useActor();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tag = lawTag(finding.law);
  const open = finding.status === "open";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(finding.fixPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser blocked the clipboard. Select the prompt text and copy it by hand.");
    }
  };

  const decide = async (status: FindingStatus) => {
    setSaving(true);
    setError(null);
    try {
      await api.setStatus(finding.id, { status, reason: reason.trim(), actor: actor.trim() });
      setReason("");
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const ready = reason.trim() !== "" && actor.trim() !== "" && !saving;

  return (
    <details className="finding">
      <summary>
        <span className="tags">
          <span className={open ? "tag is-open" : "tag is-closed"}>{STATUS[finding.status]}</span>
          <span className="tag">{KIND[finding.kind]}</span>
          {tag && <span className={tag === "Law" ? "tag is-law" : "tag is-standard"}>{tag}</span>}
          {finding.law && (
            <span className="muted small">
              {finding.law}, {finding.section}
            </span>
          )}
        </span>
        <strong>{finding.title}</strong>
        <span>{finding.plain}</span>
        <Reasoned />
      </summary>
      <div className="body">
        {finding.kind === "legal" && (
          <p className="note">
            Not legal advice. A qualified lawyer should confirm before you rely on it. Deferring a legal finding keeps release held; fix it or accept the risk with a reason.
          </p>
        )}
        <div>
          <h4>What it costs you</h4>
          <p>{finding.costIfIgnored}</p>
        </div>
        <div>
          <h4>What set it off</h4>
          <TriggerLine trigger={finding.trigger} />
        </div>
        <div>
          <h4>Fix prompt for your coding agent</h4>
          <p className="mono prompt">{finding.fixPrompt}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="quiet" onClick={copy}>
              {copied ? "Copied" : "Copy fix prompt"}
            </button>
          </div>
        </div>
        <div className="decide stack">
          <label className="field">
            Reason
            <span className="hint">Kept in the record with your name.</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </label>
          <label className="field">
            Your name
            <input value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" />
          </label>
          <div className="row">
            {DECISIONS.map(([status, label]) => (
              <button key={status} type="button" className="quiet" disabled={!ready || finding.status === status} onClick={() => decide(status)}>
                {label}
              </button>
            ))}
          </div>
          {!ready && !saving && <p className="hint">Add a reason and your name to record a decision.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
