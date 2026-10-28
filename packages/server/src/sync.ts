import { createHash } from "node:crypto";
import { openItems, traceRequirement, type CopilotRecord, type OpenItem, type Requirement } from "@lifecycle/core";
import { githubBody, type githubClient } from "./github.js";
import { linearBody, type linearClient } from "./linear.js";
import type { Job } from "./app.js";

type Linear = Pick<ReturnType<typeof linearClient>, "issue" | "upsertComment">;
type GitHub = Pick<ReturnType<typeof githubClient>, "openPulls" | "upsertPullComment" | "upsertCommitComment">;

export interface ConnectionState {
  state: "connected" | "off" | "error";
  detail: string | null;
  /** The last ticket, pull request or commit a comment was written on. */
  lastComment: string | null;
}
export type SyncStatus = { linear: ConnectionState; github: ConnectionState };

export interface SyncDeps {
  record: CopilotRecord;
  /** Null when LINEAR_API_KEY is not set. */
  linear: Linear | null;
  /** Null when GITHUB_TOKEN is not set or the repo is not on github.com. */
  github: (repoUrl: string) => GitHub | null;
  /** A public link to the commit's trace, when the panel is reachable from outside. */
  traceUrl?: (projectId: string, sha: string) => string | null;
  /** Each project's last sync, for the Connections screen. */
  status?: Map<string, SyncStatus>;
}

type Result = { result: "ok" | "off" | string; last: string | null };

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const message = (e: unknown) => (e instanceof Error ? e.message : "Unknown error").slice(0, 200);

/** One comment per linked ticket: each of its requirements, the open items on them and their criteria's evidence. */
async function syncLinear(deps: SyncDeps, linear: Linear, projectId: string, head: string, items: OpenItem[]): Promise<Result> {
  const { record } = deps;
  const byFinding = new Map(items.map((i) => [i.findingId, i]));
  const tickets = new Map<string, Requirement[]>();
  for (const req of record.listRequirements(projectId, { status: "active" })) {
    for (const l of record.requirementLinks(req.id)) {
      if (l.toType === "linear_issue") tickets.set(l.toId, [...(tickets.get(l.toId) ?? []), req]);
    }
  }
  let error: string | null = null;
  let last: string | null = null;
  for (const [key, reqs] of tickets) {
    const body = reqs
      .map((req) => {
        const t = traceRequirement(record, req.id);
        const open = t.findings.flatMap((f) => byFinding.get(f.id) ?? []);
        return linearBody(key, req.text, open, t.criteria.map((k) => k.latest?.state ?? "unchecked"), head);
      })
      .join("\n\n---\n\n");
    const target = `${projectId}/${key}`;
    const prior = record.externalPost("linear", target);
    if (prior?.bodyHash === hash(body)) continue;
    try {
      const issue = await linear.issue(key);
      if (!issue) throw new Error(`Linear has no ticket ${key}.`);
      record.saveExternalPost("linear", target, await linear.upsertComment(issue.id, prior?.commentId ?? null, body), hash(body));
      last = key;
    } catch (e) {
      // One ticket's error does not stop the others; the first is the one reported.
      error ??= message(e);
    }
  }
  return { result: error ?? "ok", last };
}

/** One comment per open pull request, or on the head commit when there is none. */
async function syncGithub(deps: SyncDeps, gh: GitHub, projectId: string, head: string, open: { total: number; items: OpenItem[] }): Promise<Result> {
  const { record } = deps;
  const repoUrl = record.getProject(projectId).repoUrl;
  const body = githubBody(open.items, open.total, head, deps.traceUrl?.(projectId, head) ?? null);
  const pulls = await gh.openPulls();
  const targets = pulls.length
    ? pulls.map((p) => ({ kind: "github_pr", id: `${repoUrl}#${p.number}`, label: `pull request #${p.number}`, write: (c: string | null) => gh.upsertPullComment(p.number, c, body) }))
    : [{ kind: "github_commit", id: `${repoUrl}@${head}`, label: `commit ${head.slice(0, 7)}`, write: (c: string | null) => gh.upsertCommitComment(head, c, body) }];
  let last: string | null = null;
  for (const t of targets) {
    const prior = record.externalPost(t.kind, t.id);
    if (prior?.bodyHash === hash(body)) continue;
    record.saveExternalPost(t.kind, t.id, await t.write(prior?.commentId ?? null), hash(body));
    last = t.label;
  }
  return { result: "ok", last };
}

const state = (r: Result, before: ConnectionState | undefined): ConnectionState => ({
  state: r.result === "ok" ? "connected" : r.result === "off" ? "off" : "error",
  detail: r.result === "ok" || r.result === "off" ? null : r.result,
  lastComment: r.last ?? before?.lastComment ?? null,
});

/**
 * After each check: the open items go to every linked Linear ticket and to GitHub. Comments are written once and
 * edited in place, and only when their text changed. Never throws: each side's error comes back as its text.
 */
export async function syncExternal(deps: SyncDeps, projectId: string, head: string): Promise<{ linear: string; github: string }> {
  const open = openItems(deps.record, projectId);
  const run = async (f: () => Promise<Result>): Promise<Result> => f().catch((e: unknown) => ({ result: message(e), last: null }));
  const linear = await run(async () => (deps.linear ? syncLinear(deps, deps.linear, projectId, head, open.items) : { result: "off", last: null }));
  const github = await run(async () => {
    const gh = deps.github(deps.record.getProject(projectId).repoUrl);
    return gh ? syncGithub(deps, gh, projectId, head, open) : { result: "off", last: null };
  });
  const before = deps.status?.get(projectId);
  deps.status?.set(projectId, { linear: state(linear, before?.linear), github: state(github, before?.github) });
  return { linear: linear.result, github: github.result };
}

/**
 * The hook Jobs calls when any advance or recheck settles, failed ones included: the open items are still right.
 * Syncs one project at a time, in order, at the commit its last check covered. Never throws.
 */
export function syncAfterJob(deps: SyncDeps, sync: typeof syncExternal = syncExternal): (job: Job) => void {
  const queue = new Map<string, Promise<unknown>>();
  return (job) => {
    try {
      const { record } = deps;
      const projectId = job.kind === "recheck" ? record.getProject(job.targetId).id : record.getChange(job.targetId).projectId;
      const head = record.checkedCommit(projectId) ?? record.lastRunCommit(projectId);
      if (!head) return;
      const next = (queue.get(projectId) ?? Promise.resolve()).then(() => sync(deps, projectId, head)).catch(() => {});
      queue.set(projectId, next);
    } catch {
      // An unknown project or change: nothing to post.
    }
  };
}
