import type { EvidenceState, RoleId } from "@lifecycle/core";
import type { ReactNode } from "react";
import type { ChangeView } from "../api";
import { FindingItem } from "./FindingItem";
import { Reasoned, Working } from "./SpendMeter";

export const ROLES: Record<RoleId, { name: string; duty: string }> = {
  ba: {
    name: "Business analyst",
    duty: "Reads the request and the code, writes the acceptance criteria and asks what is unclear.",
  },
  architect: {
    name: "Architect and SRE",
    duty: "Looks at how the app behaves when it runs for real: errors, secrets, deploys and lost data.",
  },
  qa: {
    name: "QA",
    duty: "Checks every acceptance criterion against the code and cites the lines it found.",
  },
  compliance: {
    name: "Security and compliance",
    duty: "Matches what the app collects and shares against the NDPA 2023 and card handling duties.",
  },
  po: {
    name: "Product owner",
    duty: "Accepts delivery once every other gate is cleared, and writes the acceptance summary.",
  },
};

export const ROLE_ORDER: RoleId[] = ["ba", "architect", "qa", "compliance", "po"];

export const EVIDENCE: Record<EvidenceState, string> = {
  evidence_found: "Evidence found",
  gap: "Gap",
  no_evidence: "No evidence",
};

const EV_CLASS: Record<EvidenceState, string> = { evidence_found: "ev is-found", gap: "ev is-gap", no_evidence: "ev is-none" };

export function Stamp({ state }: { state: "held" | "cleared" | undefined }) {
  if (state === "cleared") return <span className="stamp is-cleared">&#10003; Cleared</span>;
  if (state === "held") return <span className="stamp is-held">&#9632; Held</span>;
  return <span className="stamp is-none">Not reviewed yet</span>;
}

interface Props {
  role: RoleId;
  view: ChangeView;
  /** True while a job for this change is being polled. */
  jobRunning: boolean;
  onChanged: () => void;
  children?: ReactNode;
}

export function ProfessionalCard({ role, view, jobRunning, onChanged, children }: Props) {
  const gate = view.gates[role];
  const run = view.runs.find((r) => r.role === role);
  const findings = view.findings.filter((f) => f.role === role);
  const working = jobRunning && run?.status === "running";
  const idle = !run && !gate;
  const { name, duty } = ROLES[role];

  return (
    <section className={idle ? "duty is-idle" : "duty"} aria-labelledby={`duty-${role}`}>
      <div className="duty-who">
        <h3 id={`duty-${role}`}>{name}</h3>
        <p>{duty}</p>
      </div>
      <div className="duty-what stack">
        <div>
          <Stamp state={gate?.state} />
          {gate && <p className="gate-reason">{gate.reason}</p>}
        </div>

        {working ? (
          <Working />
        ) : run ? (
          <p className="small">
            {run.status === "stopped_budget" ? (
              <span className="paused">Paused: copilot budget used. </span>
            ) : run.status === "failed" ? (
              <span className="error">Stopped with an error. </span>
            ) : null}
            <span className="muted">Checked commit </span>
            <code>{run.commit.slice(0, 7)}</code> <Reasoned />
          </p>
        ) : (
          <p className="small">Not on duty yet at this stage.</p>
        )}

        {role === "ba" && view.criteria.length > 0 && (
          <p className="small">
            Wrote {view.criteria.length} acceptance {view.criteria.length === 1 ? "criterion" : "criteria"}.
          </p>
        )}

        {role === "qa" && view.criteria.length > 0 && (
          <ul className="criteria" aria-label="Acceptance criteria checked">
            {view.criteria.map((k) => (
              <li key={k.id}>
                <span className={k.latest ? EV_CLASS[k.latest] : "ev is-none"}>{k.latest ? EVIDENCE[k.latest] : "Not checked yet"}</span>
                <span>
                  {k.text}
                  {k.isFailurePath && <span className="muted small"> (failure path)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {children}

        {role === "compliance" && findings.length > 0 && (
          <p className="note">These are things to check, not legal advice. Each one cites the duty it rests on.</p>
        )}

        {findings.length > 0 && (
          <div>
            {findings.map((f) => (
              <FindingItem key={f.id} finding={f} onChanged={onChanged} />
            ))}
          </div>
        )}
        {run && !working && findings.length === 0 && role !== "po" && <p className="small muted">No findings raised.</p>}
      </div>
    </section>
  );
}
