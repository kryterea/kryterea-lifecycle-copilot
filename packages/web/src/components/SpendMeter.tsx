import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type JobState, type Spend } from "../api";

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
    <div className="row">
      {spend.fake && (
        <span className="badge" title="Model outputs are replayed from recorded fixtures. Nothing is sent to Meta.">
          Fixture replay
        </span>
      )}
      <div className={out ? "meter is-out" : "meter"} role="status">
        <span className="meter-bar" aria-hidden="true">
          <i style={{ width: `${share * 100}%` }} />
        </span>
        {out ? "Paused: copilot budget used" : `${usd(spend.spentUsd)} of ${budget(spend.budgetUsd)} copilot budget used`}
      </div>
    </div>
  );
}

/** The model credit on every role result and finding. */
export function Reasoned() {
  const { spend } = useSpend();
  return <span className="byline">Reasoned by Muse Spark{spend?.fake ? " (recorded)" : ""}</span>;
}

export const Working = () => <span className="working">Analysing with Muse Spark</span>;

/** What a finished or running job means for the person watching. Nothing when it simply finished. */
export function JobNote({ job, startError }: { job: JobState | null; startError: string | null }) {
  if (startError) return <p className="error" role="alert">{startError}</p>;
  if (!job) return null;
  if (job.state === "running") return <Working />;
  if (job.state === "stopped_budget") return <p className="paused">Paused: copilot budget used</p>;
  if (job.state === "failed") return <p className="error" role="alert">{job.error ?? "The job stopped with an error."}</p>;
  return null;
}
