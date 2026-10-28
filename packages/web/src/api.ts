import { useEffect, useRef, useState } from "react";
import type {
  AcceptanceRecord,
  Change,
  ChangeKind,
  CommitCompare,
  CommitState,
  CommitTrace,
  DocSettings,
  Document,
  DocumentVersion,
  EvidenceState,
  Finding,
  FindingStatus,
  GateMap,
  LegalDuty,
  OpenItem,
  Project,
  ProposalDecision,
  Proposals,
  Requirement,
  RunStatus,
  StageId,
  TraceChain,
} from "@lifecycle/core";

export type Run = AcceptanceRecord["runs"][number];
export type Criterion = AcceptanceRecord["criteria"][number] & { requirementKeys?: string[] };
/** A finding as the change endpoint returns it: legal ones carry the law or standard they cite. */
export type FindingView = Finding & {
  status: FindingStatus;
  law?: LegalDuty["law"];
  section?: string;
  /** The coding agent's fix report, while it waits on a re-check to confirm it. */
  fixReported?: { summary: string; at: string } | null;
  /** The drift rule it was raised under, when Kryterea raised it on drift. */
  drift?: string | null;
  /** The last decision a person or a re-check made on it. */
  decision?: { status: FindingStatus; reason: string; actor: string; at: string } | null;
};

export type DocumentRow = Document & { latest: DocumentVersion; versions: number; requirements: number; gaps: number };
export interface DocumentDetail {
  document: Document;
  versions: DocumentVersion[];
  requirements: Requirement[];
  findings: Array<Finding & { status: FindingStatus }>;
}
export type RequirementRow = Requirement & {
  criteria: number;
  tickets: string[];
  evidence: EvidenceState | null;
  open: number;
  drifted: boolean;
};
export interface ConnectionState {
  state: "connected" | "off" | "error";
  detail: string | null;
  lastComment: string | null;
}
export interface Connections {
  github: ConnectionState;
  linear: ConnectionState & { tickets: number };
  mcp: { command: string };
}
export type { CommitCompare, CommitState, CommitTrace, OpenItem, TraceChain };

/** Another change this one points at: the change it follows, or a fix change opened from it. */
export interface LinkedChange {
  id: string;
  title: string;
  stage: StageId;
}

export interface ChangeView {
  change: Change;
  stage: StageId;
  gates: GateMap;
  findings: FindingView[];
  criteria: Criterion[];
  questions: string[];
  accepted: boolean;
  runs: Run[];
  withdrawn: { reason: string; actor: string } | null;
  follows: LinkedChange | null;
  fixChanges: Array<LinkedChange & { withdrawn: boolean; findingIds: string[] }>;
  documentsRead?: Array<{ name: string; requirements: number; gaps: number }>;
  /** Her problem in her own words, null for a whole repo check. */
  problem: string | null;
  /** The answers on offer for each open question, aligned with `questions`; null where none were stored. */
  questionOptions: Array<{ options: string[]; defaultIndex: number } | null>;
  /** The changes Kryterea wrote for a check, null until they are written. */
  proposals: Proposals | null;
  decisions: ProposalDecision[];
}

export interface Spend {
  spentUsd: number;
  budgetUsd: number;
  model: string | null;
  fake: boolean;
}

/** What the repo sync picked up, grouped; documents carry their line counts. */
export interface RepoFiles {
  commit: string;
  groups: Array<{ kind: "code" | "documents" | "config" | "tests" | "skipped"; files: string[] }>;
  documents: Array<{ path: string; lines: number }>;
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
async function call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
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
  professions: () =>
    call<{ professions: Array<{ role: string; name: string; frameworks: string[]; checks: string; why: string }> }>("GET", "/api/professions").then(
      (r) => r.professions,
    ),
  projects: () => call<{ projects: Project[] }>("GET", "/api/projects").then((r) => r.projects),
  createProject: (b: { repoUrl: string; name?: string; appUrl?: string }) => call<Project>("POST", "/api/projects", b),
  files: (p: string) => call<RepoFiles>("GET", `/api/projects/${id(p)}/files`),
  check: (p: string, problem: string) => call<{ changeId: string; jobId: string }>("POST", `/api/projects/${id(p)}/check`, { problem }),
  project: (p: string) => call<{ project: Project; changes: Array<Change & { withdrawn: boolean }> }>("GET", `/api/projects/${id(p)}`),
  createChange: (p: string, b: { title: string; description: string; kind: ChangeKind }) =>
    call<Change>("POST", `/api/projects/${id(p)}/changes`, b),
  recheck: (p: string) => call<{ jobId: string }>("POST", `/api/projects/${id(p)}/recheck`, { reason: "manual" }).then((r) => r.jobId),
  change: (c: string) => call<ChangeView>("GET", `/api/changes/${id(c)}`),
  record: (c: string) => call<AcceptanceRecord>("GET", `/api/changes/${id(c)}/record`),
  advance: (c: string) => call<{ jobId: string }>("POST", `/api/changes/${id(c)}/advance`).then((r) => r.jobId),
  answer: (c: string, b: { answers: string[]; assumed?: boolean[]; actor?: string }) => call<unknown>("POST", `/api/changes/${id(c)}/answers`, b),
  approveProposal: (c: string, index: number, actor: string) => call<Change>("POST", `/api/changes/${id(c)}/proposals/${index}/approve`, { actor }),
  acceptProposalRisk: (c: string, index: number, b: { actor: string; reason: string }) =>
    call<{ decisions: ProposalDecision[] }>("POST", `/api/changes/${id(c)}/proposals/${index}/accept-risk`, b),
  accept: (c: string, actor: string) => call<{ jobId: string }>("POST", `/api/changes/${id(c)}/accept`, { actor }).then((r) => r.jobId),
  withdraw: (c: string, b: { reason: string; actor: string }) => call<unknown>("POST", `/api/changes/${id(c)}/withdraw`, b),
  reanalyse: (c: string) => call<{ jobId: string }>("POST", `/api/changes/${id(c)}/reanalyse`).then((r) => r.jobId),
  fixChange: (c: string) => call<Change>("POST", `/api/changes/${id(c)}/fix-change`),
  setStatus: (f: string, b: { status: FindingStatus; reason: string; actor: string }) =>
    call<unknown>("POST", `/api/findings/${id(f)}/status`, b),
  job: (j: string) => call<JobState>("GET", `/api/jobs/${id(j)}`),
  spend: () => call<Spend>("GET", "/api/spend"),
  openItems: (p: string) => call<{ total: number; items: OpenItem[] }>("GET", `/api/projects/${id(p)}/open-items`),
  documents: (p: string) => call<{ documents: DocumentRow[] }>("GET", `/api/projects/${id(p)}/documents`).then((r) => r.documents),
  document: (d: string) => call<DocumentDetail>("GET", `/api/documents/${id(d)}`),
  uploadDocument: (p: string, b: { name: string; body: string }) => call<{ document: Document; changed: boolean }>("POST", `/api/projects/${id(p)}/documents`, b),
  docSettings: (p: string, b: DocSettings) => call<DocSettings>("PUT", `/api/projects/${id(p)}/doc-settings`, b),
  requirements: (p: string) => call<{ requirements: RequirementRow[] }>("GET", `/api/projects/${id(p)}/requirements`).then((r) => r.requirements),
  trace: (r: string) => call<TraceChain>("GET", `/api/requirements/${id(r)}/trace`),
  linkLinear: (r: string, identifier: string) => call<{ identifier: string; url: string }>("POST", `/api/requirements/${id(r)}/linear`, { identifier }),
  commitTrace: (p: string, sha: string) => call<CommitTrace>("GET", `/api/projects/${id(p)}/commits/${id(sha)}/trace`),
  commits: (p: string) => call<{ commits: Array<{ sha: string; at: string }> }>("GET", `/api/projects/${id(p)}/commits`).then((r) => r.commits),
  compare: (p: string, from: string, to: string) =>
    call<CommitCompare>("GET", `/api/projects/${id(p)}/compare?from=${id(from)}&to=${id(to)}`),
  connections: (p: string) => call<Connections>("GET", `/api/projects/${id(p)}/connections`),
};

/** Loads once per key; `reload` fetches again. Errors become a readable message. */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let alive = true;
    latest.current().then(
      (d) => alive && (setData(d), setError(null)),
      (e) => alive && setError(message(e)),
    );
    return () => {
      alive = false;
    };
  }, [key, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** "3 days ago" style age for an ISO time. */
export function age(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

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
