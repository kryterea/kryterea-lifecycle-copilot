import { useState } from "react";
import type { FindingKind, FindingStatus, Trigger } from "@lifecycle/core";
import { api, message, safeHref, useActor, type FindingView } from "../api";
import { CheckIcon, ChevronIcon, ClockIcon, CopyIcon, RefreshIcon, ShieldIcon } from "./Icon";
import { Reasoned } from "./SpendMeter";
import { STATUS, Stamp, StatusStamp } from "./Stamp";

export const KIND: Record<FindingKind, string> = {
  legal: "Legal",
  failure_path: "Failure path",
  operations: "Operations",
  conformance: "Criterion",
};

/** PCI DSS is an industry standard, the NDPA is law; the tag says which. */
export const lawTag = (law: FindingView["law"]) => (law === "PCI DSS" ? "Standard" : law ? "Law" : null);

export function TriggerLine({ trigger }: { trigger: Trigger }) {
  if (trigger.type === "code") {
    return (
      <p className="trigger">
        <code>
          {trigger.file}:{trigger.line}
        </code>
        <span className="muted"> at {trigger.commit.slice(0, 7)}</span>
      </p>
    );
  }
  if (trigger.type === "doc") {
    return (
      <>
        {trigger.document && (
          <p className="trigger">
            <code>
              {trigger.document}
              {trigger.line ? `:${trigger.line}` : ""}
            </code>
          </p>
        )}
        <blockquote className="trigger">{trigger.quote}</blockquote>
      </>
    );
  }
  const href = safeHref(trigger.url);
  return (
    <p className="trigger">
      {href ? <a href={href}>{trigger.url}</a> : <code>{trigger.url}</code>} <span className="muted">({trigger.screenshotPath})</span>
    </p>
  );
}

const DECISIONS: Array<[FindingStatus, string, typeof CheckIcon]> = [
  ["fixed", "Fixed", CheckIcon],
  ["accepted_risk", "Accept risk", ShieldIcon],
  ["deferred", "Defer", ClockIcon],
];

/** A settled or deferred finding can be opened again; it then holds its gate like a new one. */
const REOPEN: [FindingStatus, string, typeof CheckIcon] = ["open", "Reopen", RefreshIcon];

export function FindingItem({ finding, onChanged }: { finding: FindingView; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [actor, setActor] = useActor();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const tag = lawTag(finding.law);
  // The title already says "Check this:"; the body need not say it twice.
  const lead = finding.title.startsWith("Check this:") ? finding.plain.replace(/^Check this:\s*/, "") : finding.plain;
  const long = lead.length > 240;
  const settled = finding.status === "fixed" || finding.status === "accepted_risk";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(finding.fixPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The browser blocked the clipboard. Select the prompt and copy it by hand.");
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
    <details id={`finding-${finding.id}`} className={settled ? "finding is-settled" : "finding"}>
      <summary>
        <StatusStamp status={finding.status} kind={finding.kind} />
        {finding.fixReported && (
          <Stamp tone="idle" title="Your coding agent reported a fix. It stays open until a re-check confirms it.">
            Fix reported
          </Stamp>
        )}
        {finding.drift && (
          <Stamp tone="held" title="Kryterea raised this because the work drifted from what was agreed.">
            Drift
          </Stamp>
        )}
        <span className="finding-title">{finding.title}</span>
        <span className="finding-meta">
          {KIND[finding.kind]}
          {tag && <span className={tag === "Law" ? "law is-law" : "law"}>{tag}</span>}
        </span>
        <ChevronIcon size={16} className="caret" />
      </summary>

      <div className="finding-body">
        {finding.fixReported && <p className="hint">Fix reported: {finding.fixReported.summary} Waiting on a re-check to confirm it.</p>}
        {finding.decision && finding.status !== "open" && (
          <p className="decision">
            {STATUS[finding.decision.status]} by <strong>{finding.decision.actor}</strong>: {finding.decision.reason}
          </p>
        )}
        <p className={more ? "lead" : "lead is-clamped"}>{lead}</p>
        {long && (
          <button type="button" className="btn ghost sm more" onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? "Less" : "More"}
          </button>
        )}
        {finding.law && (
          <p className="cite">
            {finding.law}, {finding.section}. Not legal advice.
          </p>
        )}

        <dl className="facts">
          <dt>Cost if ignored</dt>
          <dd>{finding.costIfIgnored}</dd>
          <dt>Evidence</dt>
          <dd>
            <TriggerLine trigger={finding.trigger} />
          </dd>
        </dl>

        <div className="prompt">
          <div className="prompt-head">
            <span>Fix prompt</span>
            <button type="button" className="btn ghost sm" onClick={copy}>
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p>{finding.fixPrompt}</p>
        </div>

        <div className="decide">
          <input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          <input aria-label="Your name" placeholder="Your name" value={actor} onChange={(e) => setActor(e.target.value)} maxLength={100} autoComplete="name" />
          <div className="decide-actions" role="group" aria-label="Decision">
            {(finding.status === "open" ? DECISIONS : [...DECISIONS, REOPEN]).map(([status, label, Icon]) => (
              <button key={status} type="button" className="btn secondary sm" disabled={!ready || finding.status === status} onClick={() => decide(status)}>
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>
        {finding.kind === "legal" && finding.status === "open" && <p className="hint">Deferring keeps release held.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Reasoned />
      </div>
    </details>
  );
}
