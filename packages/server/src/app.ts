import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  BudgetExceededError,
  accepted,
  advance,
  checkRepoUrl,
  recheck,
  type ChangeKind,
  type FindingStatus,
  type RunStatus,
  type WorkflowDeps,
} from "@lifecycle/core";

const CHANGE_KINDS: readonly ChangeKind[] = ["understand", "feature", "fix"];
const FINDING_STATUSES: readonly FindingStatus[] = ["open", "fixed", "accepted_risk", "deferred"];
const RECHECK_REASONS = ["manual", "mcp"] as const;
const MAX_BODY_BYTES = 64 * 1024;

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

  constructor(private readonly log: Log = console.error) {}

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
      });
    return { jobId: job.id, started: true };
  }
}

/** Shown to the user; the real error (which can hold paths and git output) stays in the server log. */
const JOB_ERROR = "The job stopped with an error. The server log has the details.";

export type Log = (message: string, error?: unknown) => void;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 415,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(400, message);

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
  /** The model name the server calls, shown by the panel (default muse-spark-1.3). */
  model?: string;
  /** True when model outputs are replayed fixtures (COPILOT_FAKE_MODEL=1). */
  fake?: boolean;
  /** Injectable for tests. */
  advanceFn?: typeof advance;
  recheckFn?: typeof recheck;
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
  app.use("/api/*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "Body is larger than 64 KB" }, 413) }));
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

  app.get("/api/projects", (c) => c.json({ projects: record.listProjects() }));

  app.post("/api/projects", async (c) => {
    const b = await readBody(c);
    const name = text(b, "name", 200);
    const repoUrl = text(b, "repoUrl", 2000);
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
    return c.json({ project, changes: record.listChanges(project.id) });
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

  app.get("/api/projects/:id/findings", (c) => {
    const project = getProject(c.req.param("id"));
    const s = c.req.query("status");
    const status = s === undefined || s === "" ? undefined : oneOf(s, FINDING_STATUSES, "status");
    return c.json({ findings: record.listFindings({ projectId: project.id, ...(status ? { status } : {}) }) });
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
    const questions = record.listArtifacts(change.id).filter((a) => a.kind === "questions").at(-1)?.body as
      | { questions?: string[] }
      | undefined;
    // The latest run of each role, so the panel can show who has checked this change and who is working now.
    const runs = Object.values(Object.fromEntries(r.runs.map((x) => [x.role, x])));
    // Legal findings carry the law or standard they cite, so the panel can tell a law from an industry standard.
    const findings = r.findings.map((f) => {
      const duty = f.citationId ? deps.packs.legal.find((d) => d.id === f.citationId) : undefined;
      return duty ? { ...f, law: duty.law, section: duty.section } : f;
    });
    return c.json({
      change: r.change,
      stage: r.change.stage,
      gates: r.gates,
      findings,
      criteria: r.criteria,
      questions: questions?.questions ?? [],
      accepted: accepted(record, change.id),
      runs,
    });
  });

  app.get("/api/changes/:id/record", (c) => c.json(record.acceptanceRecord(getChange(c.req.param("id")).id)));

  app.post("/api/changes/:id/advance", (c) => {
    const change = getChange(c.req.param("id"));
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
    const artifact = record.addArtifact({ changeId: change.id, role: "ba", stage: "analysis", kind: "answers", body: { answers: list } });
    return c.json(artifact, 201);
  });

  app.post("/api/changes/:id/accept", async (c) => {
    const change = getChange(c.req.param("id"));
    const b = await readBody(c);
    const actor = text(b, "actor", 100);
    if (change.stage !== "acceptance") throw new HttpError(409, "This change is not waiting for acceptance");
    // Checked before writing, so a refused accept leaves no acceptance behind.
    const running = jobs.busy(`${change.projectId}/${change.id}`);
    if (running) throw new HttpError(409, "A job is already running for this item", { jobId: running });
    record.addArtifact({ changeId: change.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor } });
    return c.json({ jobId: started(startAdvance(change.projectId, change.id)) }, 202);
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
    c.json({ spentUsd: record.spentUsd(), budgetUsd, model: opts.model ?? "muse-spark-1.3", fake: opts.fake === true }),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
