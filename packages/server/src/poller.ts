import { recheck, remoteHead, type WorkflowDeps } from "@lifecycle/core";
import { Jobs } from "./app.js";

export type LsRemote = (repoUrl: string, deps: WorkflowDeps) => Promise<string>;

/** Remote HEAD through core's git handling: canonical URL, no prompts, timeout, token only for github.com. */
export const gitLsRemote: LsRemote = (repoUrl, deps) =>
  remoteHead(repoUrl, deps.githubToken, { allowLocal: deps.allowLocalRepos === true });

/**
 * One pass over every project. A project is rechecked when its remote head differs from the commit the last
 * recheck covered (or, before any, the last done QA run). No baseline yet, or a job running in the project:
 * skipped. One project's error never stops the others.
 */
export async function pollOnce(deps: WorkflowDeps, lsRemote: LsRemote, recheckFn: typeof recheck, jobs: Jobs): Promise<void> {
  const { record } = deps;
  for (const p of record.listProjects()) {
    try {
      const base = record.checkedCommit(p.id) ?? record.lastRunCommit(p.id, "qa");
      if (!base || jobs.busy(p.id)) continue;
      const head = await lsRemote(p.repoUrl, deps);
      if (head !== base) jobs.start("recheck", p.id, p.id, () => recheckFn(deps, p.id, "push"), "push");
    } catch (e) {
      console.error(`poller: project ${p.id} skipped:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Polls every intervalMs (the first pass after one interval). Returns a stop function. */
export function startPoller(
  deps: WorkflowDeps,
  intervalMs = 60_000,
  lsRemote: LsRemote = gitLsRemote,
  recheckFn: typeof recheck = recheck,
  jobs: Jobs = new Jobs(),
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    await pollOnce(deps, lsRemote, recheckFn, jobs).catch((e: unknown) => console.error("poller: pass failed:", e));
    if (!stopped) schedule();
  };
  const schedule = () => {
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref();
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
