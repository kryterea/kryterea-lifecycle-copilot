import type { EvidenceState, RoleId } from "@lifecycle/core";
import type { ChangeView } from "../api";
import { Reasoned } from "./SpendMeter";
import { GateStamp, Stamp, type Tone } from "./Stamp";

/** Each role and the practice it works to, in the words the panel shows. */
export const ROLES: Record<RoleId, { name: string; duty: string }> = {
  ba: { name: "Business analyst", duty: "Requirements quality, against the qualities in ISO/IEC/IEEE 29148" },
  architect: { name: "Architect and SRE", duty: "Operations and reliability" },
  qa: { name: "QA", duty: "Acceptance evidence" },
  compliance: { name: "Security and compliance", duty: "NDPA 2023 and card security entries in the pack. Not legal advice." },
  po: { name: "Product owner", duty: "Acceptance and sign off" },
};

export const ROLE_ORDER: RoleId[] = ["ba", "architect", "qa", "compliance", "po"];

export const EVIDENCE: Record<EvidenceState, string> = {
  evidence_found: "Evidence found",
  gap: "Gap",
  no_evidence: "No evidence",
};

const EV_TONE: Record<EvidenceState, Tone> = { evidence_found: "cleared", gap: "held", no_evidence: "idle" };

export const EvidenceStamp = ({ state }: { state: EvidenceState | null | undefined }) =>
  state ? <Stamp tone={EV_TONE[state]}>{EVIDENCE[state]}</Stamp> : <Stamp tone="idle">Not checked</Stamp>;

/** One professional on duty: who, their gate and why, and which commit they read. */
export function DutyRow({ role, view, working }: { role: RoleId; view: ChangeView; working: boolean }) {
  const gate = view.gates[role];
  const run = view.runs.find((r) => r.role === role);
  // Where this professional pushed back, and who accepted the risk when people chose to go ahead.
  const raised = view.findings.filter((f) => f.role === role && (f.status === "open" || f.status === "accepted_risk"));
  const acceptedBy = raised.filter((f) => f.status === "accepted_risk" && f.decision);
  return (
    <li className="duty">
      <div className="duty-main">
        <p className="duty-name">
          {ROLES[role].name}
          <span className="duty-scope">{ROLES[role].duty}</span>
        </p>
        {gate?.reason && <p className="duty-reason">{gate.reason}</p>}
        {raised.length > 0 && (
          <p className="duty-meta">
            <a href={`#finding-${raised[0]!.id}`}>Pushed back on {raised.length === 1 ? "1 item" : `${raised.length} items`}</a>
          </p>
        )}
        {acceptedBy.map((f) => (
          <p key={f.id} className="duty-meta">
            Accepted by <strong>{f.decision!.actor}</strong>: {f.decision!.reason}
          </p>
        ))}
        {run && !working && (
          <p className="duty-meta">
            {run.status === "stopped_budget" ? (
              <span className="paused">Paused: copilot budget used</span>
            ) : run.status === "failed" ? (
              <span className="error">Stopped with an error</span>
            ) : (
              <Reasoned />
            )}
            <code>{run.commit.slice(0, 7)}</code>
          </p>
        )}
      </div>
      {working ? <Stamp tone="live">Working</Stamp> : <GateStamp state={gate?.state} />}
    </li>
  );
}
