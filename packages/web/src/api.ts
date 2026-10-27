import { useEffect, useRef, useState } from "react";
import type {
  AcceptanceRecord,
  Change,
  ChangeKind,
  Finding,
  FindingStatus,
  GateMap,
  LegalDuty,
  Project,
  RunStatus,
  StageId,
} from "@lifecycle/core";

export type Run = AcceptanceRecord["runs"][number];
export type Criterion = AcceptanceRecord["criteria"][number];
/** A finding as the change endpoint returns it: legal ones carry the law or standard they cite. */
export type FindingView = Finding & { status: FindingStatus; law?: LegalDuty["law"]; section?: string };

export interface ChangeView {
  change: Change;
  stage: StageId;
  gates: GateMap;
  findings: FindingView[];
  criteria: Criterion[];
  questions: string[];
  accepted: boolean;
  runs: Run[];
}

export interface Spend {
  spentUsd: number;
  budgetUsd: number;
  model: string | null;
  fake: boolean;
}

export interface JobState {
  state: RunStatus;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly jobId?: string,
  ) {
    super(message);
  }
}

/** Every write is JSON (the server refuses anything else), even when there is nothing to send. */
async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) },
  );
  const data = (await res.json().catch(() => ({}))) as { error?: string; jobId?: string };
  if (!res.ok) throw new ApiError(data.error ?? `The server answered ${res.status}.`, res.status, data.jobId);
  return data as T;
}

const id = encodeURIComponent;

export const api = {
  projects: () => call<{ projects: Project[] }>("GET", "/api/projects").then((r) => r.projects),
  createProject: (b: { name: string; repoUrl: string; appUrl?: string }) => call<Project>("POST", "/api/projects", b),
  project: (p: string) => call<{ project: Project; changes: Change[] }>("GET", `/api/projects/${id(p)}`),
  createChange: (p: string, b: { title: string; description: string; kind: ChangeKind }) =>
    call<Change>("POST", `/api/projects/${id(p)}/changes`, b),
  recheck: (p: string) => call<{ jobId: string }>("POST", `/api/projects/${id(p)}/recheck`, { reason: "manual" }).then((r) => r.jobId),
  change: (c: string) => call<ChangeView>("GET", `/api/changes/${id(c)}`),
  record: (c: string) => call<AcceptanceRecord>("GET", `/api/changes/${id(c)}/record`),
  advance: (c: string) => call<{ jobId: string }>("POST", `/api/changes/${id(c)}/advance`).then((r) => r.jobId),
  answer: (c: string, answers: string[]) => call<unknown>("POST", `/api/changes/${id(c)}/answers`, { answers }),
  accept: (c: string, actor: string) => call<{ jobId: string }>("POST", `/api/changes/${id(c)}/accept`, { actor }).then((r) => r.jobId),
  setStatus: (f: string, b: { status: FindingStatus; reason: string; actor: string }) =>
    call<unknown>("POST", `/api/findings/${id(f)}/status`, b),
  job: (j: string) => call<JobState>("GET", `/api/jobs/${id(j)}`),
  spend: () => call<Spend>("GET", "/api/spend"),
};

/** The URL when it is http or https, else null: model or user text never becomes a javascript: link. */
export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Starts long work (it returns a job id at once) and polls the job every 1.5 s until it is no longer running.
 * `refresh` runs on every poll and once at the end, so the page shows each role's run as it lands.
 * A 409 means a job is already running here; the panel follows that one instead.
 */
export function useJob(refresh: () => void) {
  const [job, setJob] = useState<({ id: string } & JobState) | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const latest = useRef(refresh);
  latest.current = refresh;

  const jobId = job?.state === "running" ? job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let next: JobState;
      try {
        next = await api.job(jobId);
      } catch (e) {
        next = { state: "failed", error: message(e) };
      }
      if (!alive) return;
      latest.current();
      if (next.state === "running") timer = setTimeout(tick, 1500);
      else setJob({ id: jobId, ...next });
    };
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId]);

  const start = async (begin: () => Promise<string>) => {
    setStartError(null);
    try {
      setJob({ id: await begin(), state: "running" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.jobId) setJob({ id: e.jobId, state: "running" });
      else setStartError(message(e));
    }
  };

  return { job, running: jobId !== null, start, startError };
}

/** The name people sign decisions with, remembered in this browser only. */
export function useActor(): [string, (v: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("kryterea.actor") ?? "";
    } catch {
      return "";
    }
  });
  const save = (v: string) => {
    setName(v);
    try {
      localStorage.setItem("kryterea.actor", v);
    } catch {
      // Storage can be blocked; the name still works for this visit.
    }
  };
  return [name, save];
}
