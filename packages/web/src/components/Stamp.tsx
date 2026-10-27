import type { FindingKind, FindingStatus, GateState } from "@lifecycle/core";

/**
 * Status as a flat stamp. Each tone keeps one meaning on every screen: green cleared or settled, amber held,
 * ink waiting on you, cobalt in motion, grey not yet.
 */
export type Tone = "cleared" | "held" | "you" | "live" | "idle" | "danger";

export function Stamp({ tone, children, title }: { tone: Tone; children: string; title?: string }) {
  return (
    <span className={`stamp t-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const GateStamp = ({ state }: { state: GateState | undefined }) =>
  state === "cleared" ? <Stamp tone="cleared">Cleared</Stamp> : state === "held" ? <Stamp tone="held">Held</Stamp> : <Stamp tone="idle">Not yet</Stamp>;

export const STATUS: Record<FindingStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  accepted_risk: "Risk accepted",
  deferred: "Deferred",
};

const STATUS_TONE: Record<FindingStatus, Tone> = { open: "held", fixed: "cleared", accepted_risk: "cleared", deferred: "idle" };

/** A deferred legal finding still holds release, so it wears the held tone like an open one. */
export const StatusStamp = ({ status, kind }: { status: FindingStatus; kind?: FindingKind }) => (
  <Stamp tone={status === "deferred" && kind === "legal" ? "held" : STATUS_TONE[status]}>{STATUS[status]}</Stamp>
);
