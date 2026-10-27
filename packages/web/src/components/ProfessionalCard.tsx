import type { EvidenceState, RoleId } from "@lifecycle/core";
import type { ChangeView } from "../api";
import { Reasoned } from "./SpendMeter";
import { GateStamp, Stamp, type Tone } from "./Stamp";

export const ROLES: Record<RoleId, { name: string; duty: string }> = {
  ba: { name: "Business analyst", duty: "Request, criteria, questions" },
  architect: { name: "Architect and SRE", duty: "Errors, secrets, deploys, data loss" },
  qa: { name: "QA", duty: "Each criterion against the code" },
  compliance: { name: "Security and compliance", duty: "NDPA 2023 and card handling" },
  po: { name: "Product owner", duty: "Acceptance and summary" },
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
  return (
    <li className="duty">
      <div className="duty-main">
        <p className="duty-name">
          {ROLES[role].name}
          <span className="duty-scope">{ROLES[role].duty}</span>
        </p>
        {gate?.reason && <p className="duty-reason">{gate.reason}</p>}
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
