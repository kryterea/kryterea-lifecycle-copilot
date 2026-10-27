import type { StageId } from "@lifecycle/core";

/** The eight stages in workflow order (a copy of core's STAGES, so the panel bundles no server code). */
export const STAGE_NAMES: Record<StageId, string> = {
  intake: "Intake",
  analysis: "Analysis",
  design_review: "Design review",
  build: "Build",
  verification: "Verification",
  release: "Release",
  acceptance: "Acceptance",
  operate: "Operate",
};

export const STAGES = Object.keys(STAGE_NAMES) as StageId[];

export type NodeState = "done" | "live" | "you" | "todo";

const SPOKEN: Record<NodeState, string> = { done: "done", live: "in progress", you: "needs you", todo: "not started" };

export interface TrailStop {
  stage: StageId;
  state: NodeState;
  /** Open findings raised at this stage, shown as a count. */
  open: number;
}

/**
 * The Trail: a cobalt spine through the eight stages, filled up to where the work is. Each stop is a button that
 * shows that stage in the pane beside it. At phone width the spine turns horizontal and only the dots remain.
 */
export function Trail({ stops, selected, pulse, onSelect }: { stops: TrailStop[]; selected: StageId; pulse: boolean; onSelect: (s: StageId) => void }) {
  return (
    <>
    <ol className="trail" aria-label="Stages">
      {stops.map((s) => (
        <li key={s.stage} className={`stop is-${s.state}${s.stage === selected ? " is-selected" : ""}`}>
          <button
            type="button"
            onClick={() => onSelect(s.stage)}
            aria-current={s.state === "live" || s.state === "you" ? "step" : undefined}
            aria-pressed={s.stage === selected}
          >
            <span className={`dot${pulse && (s.state === "live" || s.state === "you") ? " is-pulsing" : ""}`} aria-hidden="true" />
            <span className="stop-name">{STAGE_NAMES[s.stage]}</span>
            <span className="sr-only">, {SPOKEN[s.state]}</span>
            {s.open > 0 && (
              <span className="count" title={`${s.open} open`}>
                {s.open}
                <span className="sr-only"> open</span>
              </span>
            )}
          </button>
        </li>
      ))}
    </ol>
    {/* Phone only: the dots carry no names; the stage heading just below names the picked stop, this says where it sits. */}
    <p className="trail-now" aria-hidden="true">
      {STAGES.indexOf(selected) + 1} of {STAGES.length}
    </p>
    </>
  );
}

/** A read-only eight dot strip for list rows. */
export function MiniTrail({ stage }: { stage: StageId }) {
  // Operate is the end of the road: every stop reads as done.
  const now = stage === "operate" ? STAGES.length : STAGES.indexOf(stage);
  return (
    <span className="mini-trail" aria-hidden="true">
      {STAGES.map((s, i) => (
        <i key={s} className={i < now ? "is-done" : i === now ? "is-now" : undefined} />
      ))}
    </span>
  );
}
