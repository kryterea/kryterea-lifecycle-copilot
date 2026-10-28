import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  BudgetExceededError,
  acceptProposalRisk,
  accepted,
  advance,
  approveProposal,
  checkRepoUrl,
  criteriaOf,
  discoverDocuments,
  driftRule,
  listSourceFiles,
  openFixChange,
  openItems,
  openQuestions,
  problemOf,
  proposalDecisions,
  proposalsOf,
  questionOptions,
  PICKABLE_ROLES,
  PROFESSIONS,
  recheck,
  startCheck,
  syncRepo,
  compareCommits,
  traceCommit,
  traceRequirement,
  withdrawal,
  type ChangeKind,
  type EvidenceState,
  type FindingStatus,
  type RunStatus,
  type WorkflowDeps,
} from "@lifecycle/core";
import { parseGithubRepo } from "./github.js";
import type { linearClient } from "./linear.js";
import type { ConnectionState, SyncStatus } from "./sync.js";

const CHANGE_KINDS: readonly ChangeKind[] = ["understand", "feature", "fix"];
const FINDING_STATUSES: readonly FindingStatus[] = ["open", "fixed", "accepted_risk", "deferred"];
const RECHECK_REASONS = ["manual", "mcp"] as const;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOC_BYTES = 200 * 1024;
const DOC_TOO_BIG = "That document is over 200 KB. Split it or paste the part that matters.";
const DOC_UPLOAD = /^\/api\/projects\/[^/]+\/documents$/;
const MCP_COMMAND = "claude mcp add lifecycle-copilot -e COPILOT_URL=http://localhost:8787 -- node packages/mcp/dist/src/main.js";

export interface Job {
  id: string;
  kind: "advance" | "recheck";
  targetId: string;
  reason?: string;
  state: RunStatus;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/**
 * In-memory background jobs. Lock keys are a project id (recheck) or `<projectId>/<changeId>` (advance), and a
 * key conflicts with itself and anything under it, so a recheck never runs alongside an advance in its project.
 * ponytail: jobs live in process memory and are never pruned; a restart forgets them. Fine for one founder.
 */
export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly locks = new Map<string, string>();

  /** `settled` runs after every job, failed ones included (the sync to GitHub and Linear). */
  constructor(
    private readonly log: Log = console.error,
    private readonly settled?: (job: Job) => void,
  ) {}

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** The id of a running job whose lock conflicts with this key. */
  busy(key: string): string | undefined {
    for (const [held, jobId] of this.locks) {
      if (held === key || held.startsWith(`${key}/`) || key.startsWith(`${held}/`)) return jobId;
    }
    return undefined;
  }

  /** Starts work at once unless the lock is busy; then returns the running job's id with started false. */
  start(
    kind: Job["kind"],
    targetId: string,
    lock: string,
    work: () => Promise<{ stoppedForBudget: boolean }>,
    reason?: string,
  ): { jobId: string; started: boolean } {
    const running = this.busy(lock);
    if (running) return { jobId: running, started: false };
    const job: Job = { id: randomUUID(), kind, targetId, state: "running", startedAt: new Date().toISOString() };
    if (reason) job.reason = reason;
    this.jobs.set(job.id, job);
    this.locks.set(lock, job.id);
    void (async () => work())()
      .then(
        (r) => {
          job.state = r.stoppedForBudget ? "stopped_budget" : "done";
        },
        (e: unknown) => {
          if (e instanceof BudgetExceededError) {
            job.state = "stopped_budget";
            return;
          }
          job.state = "failed";
          job.error = JOB_ERROR;
          this.log(`job ${job.id} (${kind} ${targetId}) failed:`, e);
        },
      )
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        this.locks.delete(lock);
        this.settled?.(job);
      });
    return { jobId: job.id, started: true };
  }
}

/** Shown to the user; the real error (which can hold paths and git output) stays in the server log. */
const JOB_ERROR = "The job stopped with an error. The server log has the details.";

export type Log = (message: string, error?: unknown) => void;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 502,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(400, message);

/** A project name from its repo: the GitHub repo name or last path segment, as words (`demo-merchant-payments` becomes `Demo merchant payments`). */
export function nameFromRepo(repoUrl: string): string {
  const raw = parseGithubRepo(repoUrl)?.name ?? repoUrl.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)!.replace(/\.git$/, "");
  const words = raw.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Project";
}

type FileKind = "code" | "documents" | "config" | "tests" | "skipped";
const FILE_KINDS: readonly FileKind[] = ["code", "documents", "config", "tests", "skipped"];
const TEST_PATH = /(^|[/._-])(tests?|specs?|__tests__)([/._-]|$)/i;
const CONFIG_FILE = /^(package\.json|dockerfile|\.env\.example|.*\.config\.[^.]+|.*\.ya?ml|.*\.toml)$/i;

type Body = Record<string, unknown>;

async function readBody(c: Context): Promise<Body> {
  let b: unknown;
  try {
    b = await c.req.json();
  } catch {
    throw bad("Body must be JSON");
  }
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw bad("Body must be a JSON object");
  return b as Body;
}

function text(b: Body, key: string, max: number): string {
  const v = b[key];
  if (typeof v !== "string" || !v.trim()) throw bad(`${key} is required`);
  if (v.length > max) throw bad(`${key} is longer than ${max} characters`);
  return v;
}

function optText(b: Body, key: string, max: number): string | undefined {
  return b[key] === undefined || b[key] === null || b[key] === "" ? undefined : text(b, key, max);
}

/** An optional non-empty list of unique professions from `allowed`; absent means all of them (Auto). */
function optPick<T extends string>(v: unknown, allowed: readonly T[], key: string): T[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0) throw bad(`${key} must be a non-empty list`);
  const picked = v.map((x) => oneOf(x, allowed, key));
  if (new Set(picked).size !== picked.length) throw bad(`${key} must not repeat a profession`);
  return picked;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], key: string): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw bad(`${key} must be one of ${allowed.join(", ")}`);
  return v as T;
}

/** Record lookups throw `<Thing> not found: id`; that becomes a 404, anything else stays a 500. */
function found<T>(get: () => T): T {
  try {
    return get();
  } catch (e) {
    if (e instanceof Error && / not found: /.test(e.message)) throw new HttpError(404, e.message.split(":")[0]!);
    throw e;
  }
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** The host as it appears in a URL (IPv6 in brackets), lower case. */
const urlHost = (h: string) => {
  const host = h.toLowerCase();
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

export const isLoopback = (host: string) => LOOPBACK.includes(urlHost(host));

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The API has no accounts, so it trusts only the local machine. The Host must be loopback (or the configured
 * host) on our port, which stops DNS rebinding. An Origin, when sent, must be that same origin, and writes must
 * be JSON, which a cross-site page cannot send without a preflight we never answer (no CORS headers at all).
 * With an API token set, every request also needs it.
 */
function requestGuard(o: { port: number; host?: string; apiToken?: string }) {
  const hosts = new Set(LOOPBACK);
  if (o.host) hosts.add(urlHost(o.host));
  const sameOrigin = (u: URL) => hosts.has(u.hostname) && Number(u.port || (u.protocol === "https:" ? 443 : 80)) === o.port;
  return async (c: Context, next: () => Promise<void>) => {
    if (!sameOrigin(new URL(c.req.url))) throw new HttpError(403, "This API only answers requests made to this machine");
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      let u: URL | undefined;
      try {
        u = new URL(origin);
      } catch {
        u = undefined;
      }
      if (!u || u.protocol !== "http:" || !sameOrigin(u)) throw new HttpError(403, "Cross-site requests are not allowed");
    }
    if (o.apiToken) {
      const auth = c.req.header("authorization") ?? "";
      const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!timingSafeEqual(digest(given), digest(o.apiToken))) throw new HttpError(401, "A valid API token is required");
    }
    const write = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
    if (write && !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) {
      throw new HttpError(415, "Send the request as application/json");
    }
    await next();
  };
}

export interface AppOptions {
  budgetUsd?: number;
  /** The port the server listens on (default 8787). Requests to another port are refused. */
  port?: number;
  /** The configured listen host, accepted in the Host header besides loopback. */
  host?: string;
  /** When set, every /api request needs `Authorization: Bearer <token>`. */
  apiToken?: string;
  /** Where job and request errors are logged (default console.error). */
  log?: Log;
  jobs?: Jobs;
  /** The model name the server calls, shown by the panel. main.ts holds the default. */
  model?: string;
  /** True when model outputs are replayed fixtures (COPILOT_FAKE_MODEL=1). */
  fake?: boolean;
  /** Injectable for tests. */
  advanceFn?: typeof advance;
  recheckFn?: typeof recheck;
  /** Null or absent when LINEAR_API_KEY is not set. */
  linear?: Pick<ReturnType<typeof linearClient>, "issue" | "upsertComment"> | null;
  /** True when GITHUB_TOKEN is set. */
  githubConnected?: boolean;
  /** Each project's last sync to GitHub and Linear (filled by sync.ts). */
  syncStatus?: Map<string, SyncStatus>;
}

export function createApp(deps: WorkflowDeps, opts: AppOptions = {}): Hono {
  const { record } = deps;
  const log = opts.log ?? console.error;
  const jobs = opts.jobs ?? new Jobs(log);
  const advanceFn = opts.advanceFn ?? advance;
  const recheckFn = opts.recheckFn ?? recheck;
  const budgetUsd = opts.budgetUsd ?? 70;
  const app = new Hono();

  app.use("/api/*", requestGuard({ port: opts.port ?? 8787, host: opts.host, apiToken: opts.apiToken }));
  // A document upload may carry up to 200 KB of text (JSON escaping can double it); everything else 64 KB.
  const docLimit = bodyLimit({ maxSize: 2 * MAX_DOC_BYTES + 4096, onError: (c) => c.json({ error: DOC_TOO_BIG }, 413) });
  const apiLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "Body is larger than 64 KB" }, 413) });
  app.use("/api/*", (c, next) => (c.req.method === "POST" && DOC_UPLOAD.test(c.req.path) ? docLimit : apiLimit)(c, next));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status);
    log(`${c.req.method} ${c.req.path} failed:`, err);
    return c.json({ error: "Internal error" }, 500);
  });

  const getChange = (id: string) => found(() => record.getChange(id));
  const getProject = (id: string) => found(() => record.getProject(id));
  const getFinding = (id: string) => {
    const f = record.listFindings({}).find((x) => x.id === id);
    if (!f) throw new HttpError(404, "Finding not found");
    return f;
  };
  const started = (r: { jobId: string; started: boolean }) => {
    if (!r.started) throw new HttpError(409, "A job is already running for this item", { jobId: r.jobId });
    return r.jobId;
  };
  const startAdvance = (projectId: string, changeId: string) =>
    jobs.start("advance", changeId, `${projectId}/${changeId}`, () => advanceFn(deps, changeId));
  const notBusy = (projectId: string, changeId: string) => {
    const running = jobs.busy(`${projectId}/${changeId}`);
    if (running) throw new HttpError(409, "A job is already running for this item", { jobId: running });
  };
  const notWithdrawn = (changeId: string) => {
    if (withdrawal(record, changeId)) throw new HttpError(409, "This change was withdrawn");
  };
  /** A finding with the coding agent's fix report, while that report still waits on a re-check. */
  const withFixReport = <F extends { id: string }>(f: F) => ({ ...f, fixReported: record.pendingFixReport(f.id) });
  const linkedChange = (id: string) => {
    const c = record.getChange(id);
    return { id: c.id, title: c.title, stage: c.stage };
  };

  app.get("/api/professions", (c) => c.json({ professions: PROFESSIONS }));

  app.get("/api/projects", (c) => c.json({ projects: record.listProjects() }));

  app.post("/api/projects", async (c) => {
    const b = await readBody(c);
    const repoUrl = text(b, "repoUrl", 2000);
    const name = optText(b, "name", 200) ?? nameFromRepo(repoUrl);
    const appUrl = optText(b, "appUrl", 2000);
    try {
      checkRepoUrl(repoUrl, deps.allowLocalRepos === true);
    } catch (e) {
      throw bad((e as Error).message);
    }
    if (appUrl !== undefined && !/^https?:\/\/\S+$/i.test(appUrl)) throw bad("appUrl must be an http or https URL");
    return c.json(record.createProject({ name, repoUrl, ...(appUrl ? { appUrl } : {}) }), 201);
  });

  app.get("/api/projects/:id", (c) => {
    const project = getProject(c.req.param("id"));
    return c.json({ project, changes: record.listChanges(project.id).map((x) => ({ ...x, withdrawn: withdrawal(record, x.id) !== null })) });
  });

  app.post("/api/projects/:id/changes", async (c) => {
    const project = getProject(c.req.param("id"));
    const b = await readBody(c);
    const change = record.createChange({
      projectId: project.id,
      title: text(b, "title", 200),
      description: text(b, "description", 20_000),
      kind: oneOf(b.kind, CHANGE_KINDS, "kind"),
    });
    return c.json(change, 201);
  });

  // What a check will read, grouped for the owner. No model call.
  // ponytail: listSourceFiles drops files over the size limit, so "skipped" stays empty until it reports them.
  app.get("/api/projects/:id/files", async (c) => {
    const project = getProject(c.req.param("id"));
    let repo: { dir: string; commit: string };
    try {
      repo = await syncRepo(project.repoUrl, deps.cacheDir, deps.githubToken, { allowLocal: deps.allowLocalRepos === true });
    } catch (e) {
      log(`GET ${c.req.path} could not read the repo:`, e);
      throw new HttpError(502, "Could not read the repo. Check the link and try again.");
    }
    const files = await listSourceFiles(repo.dir);
    const docs = new Set(discoverDocuments(files, record.docSettings(project.id)));
    const kindOf = (f: string): FileKind =>
      docs.has(f) ? "documents" : TEST_PATH.test(f) ? "tests" : CONFIG_FILE.test(f.split("/").at(-1)!) ? "config" : "code";
    const groups = FILE_KINDS.map((kind) => ({ kind, files: files.filter((f) => kindOf(f) === kind && kind !== "skipped") }));
    const documents = [...docs].map((path) => ({ path, lines: readFileSync(join(repo.dir, path), "utf8").replace(/\n$/, "").split("\n").length }));
    return c.json({ commit: repo.commit, groups, documents });
  });

  app.post("/api/projects/:id/check", async (c) => {
    const project = getProject(c.req.param("id"));
    const b = await readBody(c);
    const problem = optText(b, "problem", 500) ?? null;
    const roles = optPick(b.roles, PICKABLE_ROLES, "roles");
    // A recheck holds the whole project, so refuse before opening a change that could not start.
    notBusy(project.id, "new");
    const change = startCheck(record, { projectId: project.id, problem, ...(roles ? { roles } : {}) });
    return c.json({ changeId: change.id, jobId: started(startAdvance(project.id, change.id)) }, 202);
  });

  app.get("/api/projects/:id/findings", (c) => {
    const project = getProject(c.req.param("id"));
    const s = c.req.query("status");
    const status = s === undefined || s === "" ? undefined : oneOf(s, FINDING_STATUSES, "status");
    return c.json({ findings: record.listFindings({ projectId: project.id, ...(status ? { status } : {}) }).map(withFixReport) });
  });

  app.post("/api/projects/:id/recheck", async (c) => {
    const project = getProject(c.req.param("id"));
    const b = await readBody(c);
    const reason = b.reason === undefined ? "manual" : oneOf(b.reason, RECHECK_REASONS, "reason");
    const jobId = started(jobs.start("recheck", project.id, project.id, () => recheckFn(deps, project.id, reason), reason));
    return c.json({ jobId }, 202);
  });

  app.get("/api/changes/:id", (c) => {
    const change = getChange(c.req.param("id"));
    const r = record.acceptanceRecord(change.id);
    const artifacts = record.listArtifacts(change.id);
    const ids = (kind: string) => artifacts.filter((a) => a.kind === kind).map((a) => (a.body as { changeId: string }).changeId);
    // The latest run of each role, so the panel can show who has checked this change and who is working now.
    const runs = Object.values(Object.fromEntries(r.runs.map((x) => [x.role, x])));
    // Legal findings carry the law or standard they cite, so the panel can tell a law from an industry standard.
    // Each finding also carries its drift rule and, once a person decided on it, that decision.
    const findings = r.findings.map((f) => {
      const duty = f.citationId ? deps.packs.legal.find((d) => d.id === f.citationId) : undefined;
      const last = record.findingHistory(f.id).at(-1);
      const decision = last && last.status !== "open" ? { status: last.status, reason: last.reason, actor: last.actor, at: last.at } : null;
      return withFixReport({ ...f, ...(duty ? { law: duty.law, section: duty.section } : {}), drift: driftRule(record, f.id), decision });
    });
    // What the analyst read for this change, newest read last.
    const read = artifacts.filter((a) => a.kind === "documents_read").at(-1)?.body as { documents?: Array<{ name: string; requirements: number; gaps: number }> } | undefined;
    const documentsRead = (read?.documents ?? []).map((d) => ({ name: d.name, requirements: d.requirements, gaps: d.gaps }));
    const criteria = r.criteria.map((k) => ({ ...k, requirementKeys: record.requirementsLinkedTo("criterion", k.id).map((q) => q.key) }));
    // Fix changes opened from this one after delivery, with the findings each carries. A withdrawn one carries nothing.
    const fixChanges = ids("fix_change").map((id) => ({
      ...linkedChange(id),
      withdrawn: withdrawal(record, id) !== null,
      findingIds: record.listFindings({ changeId: id }).map((f) => f.id),
    }));
    return c.json({
      change: r.change,
      stage: r.change.stage,
      gates: r.gates,
      findings,
      criteria,
      documentsRead,
      questions: openQuestions(record, change.id),
      questionOptions: questionOptions(record, change.id),
      problem: problemOf(record, change.id),
      proposals: proposalsOf(record, change.id),
      decisions: proposalDecisions(record, change.id),
      accepted: accepted(record, change.id),
      runs,
      withdrawn: withdrawal(record, change.id),
      follows: ids("follows").map(linkedChange)[0] ?? null,
      fixChanges,
    });
  });

  app.get("/api/changes/:id/record", (c) => c.json(record.acceptanceRecord(getChange(c.req.param("id")).id)));

  app.post("/api/changes/:id/advance", (c) => {
    const change = getChange(c.req.param("id"));
    notWithdrawn(change.id);
    return c.json({ jobId: started(startAdvance(change.projectId, change.id)) }, 202);
  });

  app.post("/api/changes/:id/answers", async (c) => {
    const change = getChange(c.req.param("id"));
    const b = await readBody(c);
    const answers = b.answers;
    if (!Array.isArray(answers) || answers.length === 0 || answers.length > 50) throw bad("answers must be a list of 1 to 50 strings");
    const list = answers.map((a: unknown, i) => {
      if (typeof a !== "string" || !a.trim() || a.length > 2000) throw bad(`answers[${i}] must be non-empty text of at most 2000 characters`);
      return a;
    });
    const assumed = b.assumed;
    if (assumed !== undefined && (!Array.isArray(assumed) || assumed.length !== list.length || assumed.some((x) => typeof x !== "boolean"))) {
      throw bad("assumed must be a list of true or false, one for each answer");
    }
    const actor = b.actor;
    if (actor !== undefined && (typeof actor !== "string" || !actor.trim() || actor.length > 100)) throw bad("actor must be non-empty text of at most 100 characters");
    const body = { answers: list, ...(assumed !== undefined && { assumed }), ...(actor !== undefined && { actor }) };
    const artifact = record.addArtifact({ changeId: change.id, role: "ba", stage: "analysis", kind: "answers", body });
    return c.json(artifact, 201);
  });

  app.post("/api/changes/:id/accept", async (c) => {
    const change = getChange(c.req.param("id"));
    const b = await readBody(c);
    const actor = text(b, "actor", 100);
    if (change.stage !== "acceptance") throw new HttpError(409, "This change is not waiting for acceptance");
    // Checked before writing, so a refused accept leaves no acceptance behind.
    notWithdrawn(change.id);
    notBusy(change.projectId, change.id);
    record.addArtifact({ changeId: change.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor } });
    return c.json({ jobId: started(startAdvance(change.projectId, change.id)) }, 202);
  });

  // The end for work that will not ship: the change stops where it is, with the reason in the record.
  app.post("/api/changes/:id/withdraw", async (c) => {
    const change = getChange(c.req.param("id"));
    const b = await readBody(c);
    const reason = text(b, "reason", 1000);
    const actor = text(b, "actor", 100);
    if (change.stage === "operate") throw new HttpError(409, "A delivered change cannot be withdrawn");
    notWithdrawn(change.id);
    notBusy(change.projectId, change.id);
    record.addArtifact({ changeId: change.id, role: "po", stage: change.stage, kind: "withdrawn", body: { reason, actor } });
    return c.json({ withdrawn: { reason, actor } }, 201);
  });

  // QA cannot clear a change with no acceptance criteria; this sends it back to the analyst to write them.
  app.post("/api/changes/:id/reanalyse", (c) => {
    const change = getChange(c.req.param("id"));
    notWithdrawn(change.id);
    if (!["verification", "release", "acceptance"].includes(change.stage) || criteriaOf(record, change).length) {
      throw new HttpError(409, "Only a change past build with no acceptance criteria goes back to analysis");
    }
    notBusy(change.projectId, change.id);
    record.setStage(change.id, "analysis");
    return c.json({ jobId: started(startAdvance(change.projectId, change.id)) }, 202);
  });

  /** One decision per proposal: the other kind of decision on the same index is a conflict. */
  const proposalRoute = (kind: "approved" | "accepted_risk") => async (c: Context) => {
    const change = getChange(c.req.param("id")!);
    const b = await readBody(c);
    const actor = text(b, "actor", 100).trim();
    const reason = kind === "accepted_risk" ? text(b, "reason", 1000).trim() : "";
    const raw = c.req.param("index")!;
    const index = Number(raw);
    try {
      if (!/^\d+$/.test(raw) || !proposalsOf(record, change.id)?.changes[index]) throw new Error("No such proposed change");
      if (proposalDecisions(record, change.id).some((d) => d.index === index && d.decision !== kind)) {
        throw new HttpError(409, "This proposed change already has a different decision");
      }
      if (kind === "approved") return c.json(approveProposal(record, change.id, index, actor), 201);
      acceptProposalRisk(record, change.id, index, actor, reason);
      return c.json({ decisions: proposalDecisions(record, change.id) }, 200);
    } catch (e) {
      if (e instanceof Error && e.message === "No such proposed change") throw new HttpError(404, e.message);
      throw e;
    }
  };
  app.post("/api/changes/:id/proposals/:index/approve", proposalRoute("approved"));
  app.post("/api/changes/:id/proposals/:index/accept-risk", proposalRoute("accepted_risk"));

  app.post("/api/changes/:id/fix-change", (c) => {
    const change = getChange(c.req.param("id"));
    if (change.stage !== "operate") throw new HttpError(409, "Only a delivered change opens a fix change");
    if (!record.listFindings({ changeId: change.id, status: "open" }).length) throw new HttpError(409, "This change has no open findings to carry");
    return c.json(openFixChange(record, change.id), 201);
  });

  // The coding agent's word is not proof: the finding stays open, and holding its gate, until a re-check agrees.
  app.post("/api/findings/:id/fix-report", async (c) => {
    const finding = getFinding(c.req.param("id"));
    const b = await readBody(c);
    const summary = text(b, "summary", 2000);
    if (finding.status !== "open") throw new HttpError(409, "Only an open finding takes a fix report");
    const change = record.getChange(finding.changeId);
    record.addArtifact({ changeId: change.id, role: finding.role, stage: change.stage, kind: "fix_report", body: { findingId: finding.id, summary } });
    return c.json(withFixReport(finding), 201);
  });

  app.get("/api/projects/:id/open-items", (c) => c.json(openItems(record, getProject(c.req.param("id")).id)));

  /** Open findings raised on a document's lines. */
  const docFindings = (projectId: string, name: string) =>
    record.listFindings({ projectId, status: "open" }).filter((f) => f.trigger.type === "doc" && f.trigger.document === name);

  app.get("/api/projects/:id/documents", (c) => {
    const project = getProject(c.req.param("id"));
    const requirements = record.listRequirements(project.id, { status: "active" });
    const documents = record.listDocuments(project.id).map((d) => ({
      ...d,
      requirements: requirements.filter((r) => r.documentId === d.id).length,
      gaps: docFindings(project.id, d.name).length,
    }));
    return c.json({ documents });
  });

  app.get("/api/documents/:id", (c) => {
    const document = found(() => record.getDocument(c.req.param("id")));
    return c.json({
      document,
      versions: record.documentVersions(document.id),
      requirements: record.listRequirements(document.projectId).filter((r) => r.documentId === document.id),
      findings: docFindings(document.projectId, document.name),
    });
  });

  app.post("/api/projects/:id/documents", async (c) => {
    const project = getProject(c.req.param("id"));
    const b = await readBody(c);
    const name = text(b, "name", 200).trim();
    if (typeof b.body !== "string" || !b.body.trim()) throw bad("body is required");
    if (Buffer.byteLength(b.body, "utf8") > MAX_DOC_BYTES) throw new HttpError(413, DOC_TOO_BIG);
    return c.json(record.saveDocumentVersion({ projectId: project.id, name, source: "upload", body: b.body, commit: null }), 201);
  });

  app.put("/api/projects/:id/doc-settings", async (c) => {
    const project = getProject(c.req.param("id"));
    const b = await readBody(c);
    const globs = (key: string) => {
      const v = b[key];
      if (!Array.isArray(v) || v.length > 50 || !v.every((g) => typeof g === "string" && g.trim() && g.length <= 200)) {
        throw bad(`${key} must be a list of up to 50 file patterns`);
      }
      return v.map((g: string) => g.trim());
    };
    record.setDocSettings(project.id, { include: globs("include"), exclude: globs("exclude") });
    return c.json(record.docSettings(project.id));
  });

  /** One state for a requirement's criteria: a gap anywhere wins, then evidence, then no evidence. */
  const evidenceOf = (states: Array<EvidenceState | null>): EvidenceState | null =>
    states.includes("gap") ? "gap" : states.includes("evidence_found") ? "evidence_found" : states.includes("no_evidence") ? "no_evidence" : null;

  app.get("/api/projects/:id/requirements", (c) => {
    const project = getProject(c.req.param("id"));
    const requirements = record.listRequirements(project.id, { status: "active" }).map((req) => {
      const t = traceRequirement(record, req.id);
      const open = t.findings.filter((f) => f.status === "open");
      return {
        ...req,
        criteria: t.criteria.length,
        tickets: t.tickets,
        evidence: evidenceOf(t.criteria.map((k) => k.latest?.state ?? null)),
        open: open.length,
        drifted: open.some((f) => driftRule(record, f.id) !== null),
      };
    });
    return c.json({ requirements });
  });

  app.get("/api/requirements/:id/trace", (c) => c.json(found(() => traceRequirement(record, c.req.param("id")))));

  app.post("/api/requirements/:id/linear", async (c) => {
    const requirement = found(() => record.getRequirement(c.req.param("id")));
    const b = await readBody(c);
    const identifier = text(b, "identifier", 30).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(identifier)) throw bad("identifier must look like ENG-12");
    if (!opts.linear) throw new HttpError(409, "Linear is not connected.");
    const issue = await opts.linear.issue(identifier).catch((e: unknown) => {
      throw new HttpError(502, e instanceof Error ? e.message : "Could not reach Linear.");
    });
    if (!issue) throw new HttpError(404, `Linear has no ticket ${identifier}.`);
    record.linkRequirement(requirement.id, "linear_issue", identifier);
    return c.json({ requirementId: requirement.id, identifier, title: issue.title, url: issue.url });
  });

  app.get("/api/projects/:id/commits/:sha/trace", (c) => {
    const project = getProject(c.req.param("id"));
    const trace = traceCommit(record, project.id, c.req.param("sha"));
    if (!trace) throw new HttpError(404, "Kryterea has not checked this commit.");
    return c.json(trace);
  });

  app.get("/api/projects/:id/commits", (c) => c.json({ commits: record.commitsChecked(getProject(c.req.param("id")).id) }));

  app.get("/api/projects/:id/compare", (c) => {
    const project = getProject(c.req.param("id"));
    const cmp = compareCommits(record, project.id, c.req.query("from") ?? "", c.req.query("to") ?? "");
    if (!cmp) throw new HttpError(404, "Kryterea has not checked one of these commits.");
    return c.json(cmp);
  });

  app.get("/api/projects/:id/connections", (c) => {
    const project = getProject(c.req.param("id"));
    const last = opts.syncStatus?.get(project.id);
    const side = (on: boolean, s: ConnectionState | undefined): ConnectionState =>
      on ? (s ?? { state: "connected", detail: null, lastComment: null }) : { state: "off", detail: null, lastComment: null };
    const tickets = new Set(
      record.listRequirements(project.id).flatMap((r) => record.requirementLinks(r.id).filter((l) => l.toType === "linear_issue").map((l) => l.toId)),
    ).size;
    return c.json({
      github: side(opts.githubConnected === true, last?.github),
      linear: { ...side(Boolean(opts.linear), last?.linear), tickets },
      mcp: { command: MCP_COMMAND },
    });
  });

  app.get("/api/findings/:id", (c) => {
    const finding = getFinding(c.req.param("id"));
    const criterion = finding.criterionId
      ? (record.listCriteria(finding.projectId).find((k) => k.id === finding.criterionId) ?? null)
      : null;
    return c.json({ finding, status: finding.status, history: record.findingHistory(finding.id), criterion });
  });

  app.post("/api/findings/:id/status", async (c) => {
    const finding = getFinding(c.req.param("id"));
    const b = await readBody(c);
    const status = oneOf(b.status, FINDING_STATUSES, "status");
    record.setFindingStatus(finding.id, status, text(b, "reason", 1000), text(b, "actor", 100));
    return c.json({ id: finding.id, status, history: record.findingHistory(finding.id) });
  });

  app.get("/api/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) throw new HttpError(404, "Job not found");
    return c.json(job.error ? { state: job.state, error: job.error } : { state: job.state });
  });

  app.get("/api/spend", (c) =>
    c.json({ spentUsd: record.spentUsd(), budgetUsd, model: opts.model ?? null, fake: opts.fake === true }),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
