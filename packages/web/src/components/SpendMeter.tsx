import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type JobState, type Spend } from "../api";
import { CheckIcon, SparkIcon } from "./Icon";
import { Stamp } from "./Stamp";

const SpendContext = createContext<{ spend: Spend | null; refresh: () => void }>({ spend: null, refresh: () => {} });

/** Reads /api/spend on load, every 10 s, and whenever a page asks (after a job ends). */
export function SpendProvider({ children }: { children: ReactNode }) {
  const [spend, setSpend] = useState<Spend | null>(null);
  const refresh = useCallback(() => {
    api.spend().then(setSpend, () => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);
  return <SpendContext.Provider value={{ spend, refresh }}>{children}</SpendContext.Provider>;
}

export const useSpend = () => useContext(SpendContext);

const usd = (n: number) => `$${n.toFixed(2)}`;
/** The budget reads "$70" when whole, "$70.50" otherwise. */
const budget = (n: number) => (Number.isInteger(n) ? `$${n}` : usd(n));

export function SpendMeter() {
  const { spend } = useSpend();
  if (!spend) return null;
  const out = spend.spentUsd >= spend.budgetUsd;
  const share = spend.budgetUsd > 0 ? Math.min(1, spend.spentUsd / spend.budgetUsd) : 1;
  return (
    <div className="spend">
      {spend.fake && (
        <Stamp tone="idle" title="Model outputs are replayed from recorded Muse Spark runs. Nothing is sent to Meta.">
          Replay
        </Stamp>
      )}
      <div className={out ? "meter is-out" : "meter"} role="status">
        <span className="meter-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${share})` }} />
        </span>
        <span className="meter-text">
          {out ? (
            "Paused: copilot budget used"
          ) : (
            <>
              <b>{usd(spend.spentUsd)}</b> of {budget(spend.budgetUsd)} <span className="meter-tail">copilot budget used</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** The model credit on every role result and finding. */
export function Reasoned() {
  const { spend } = useSpend();
  return (
    <span className="byline">
      <SparkIcon size={12} />
      Reasoned by Muse Spark{spend?.fake ? " (recorded)" : ""}
    </span>
  );
}

/**
 * The Instrument: the dark band that appears only while Muse Spark is working, and the panel's only ambient
 * motion. Its steps are the professionals actually on duty, ticked as their runs land.
 */
export function Instrument({ steps }: { steps: Array<{ name: string; done: boolean }> }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="instrument" role="status" aria-live="polite">
      <p className="instrument-title">
        <SparkIcon size={15} /> Analysing with Muse Spark
      </p>
      {steps.length > 0 && (
        <ol className="instrument-steps">
          {steps.map((s, i) => (
            <li key={s.name} className={s.done ? "is-done" : i === current ? "is-now" : undefined} aria-current={i === current ? "step" : undefined}>
              {s.done ? <CheckIcon size={13} /> : <i aria-hidden="true" />}
              {s.name}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** What a finished job means for the person watching. Nothing when it simply finished. */
export function JobNote({ job, startError }: { job: JobState | null; startError: string | null }) {
  if (startError) return <p className="error" role="alert">{startError}</p>;
  if (!job || job.state === "running" || job.state === "done") return null;
  if (job.state === "stopped_budget") return <p className="paused">Paused: copilot budget used</p>;
  return <p className="error" role="alert">{job.error ?? "The job stopped with an error."}</p>;
}
