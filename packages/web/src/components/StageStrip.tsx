import type { StageId } from "@lifecycle/core";
import { Working } from "./SpendMeter";

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

export function StageStrip({ stage, working, held }: { stage: StageId; working: boolean; held: boolean }) {
  const now = STAGES.indexOf(stage);
  return (
    <ol className="strip" aria-label="Stages of this change">
      {STAGES.map((s, i) => {
        const cls = i < now ? "is-done" : i === now ? `is-now${held && !working ? " is-held" : ""}` : "";
        return (
          <li key={s} className={cls} aria-current={i === now ? "step" : undefined}>
            {STAGE_NAMES[s]}
            {i === now && working && <Working />}
          </li>
        );
      })}
    </ol>
  );
}
