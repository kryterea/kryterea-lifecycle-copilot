import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError, CopilotRecord, type Packs, type WorkflowDeps } from "@lifecycle/core";
import { Jobs, createApp, type AppOptions } from "../src/app.js";
import { pollOnce, startPoller } from "../src/poller.js";

const packs: Packs = {
  role: { ba: "BA", architect: "ARCH", qa: "QA", compliance: "COMP", po: "PO" },
  legal: [],
};

let dir = "";
let deps: WorkflowDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lifecycle-server-"));
  deps = {
    record: CopilotRecord.open(join(dir, "copilot.db")),
    modelFor: () => {
      throw new Error("no model calls in server tests");
    },
    packs,
    cacheDir: join(dir, "cache"),
  };
});

afterEach(() => {
  deps.record.close();
  rmSync(dir, { recursive: true, force: true });
});

const REPO = "https://github.com/example/salon.git";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const BASE = "http://127.0.0.1:8787";

function setup(opts: AppOptions = {}) {
  const log = vi.fn();
  const app = createApp(deps, { log, ...opts });
  /** Same-origin JSON requests, as the panel sends them. `headers` overrides or adds. */
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, base = BASE) => {
    const res = await app.request(`${base}${path}`, {
      method,
      headers: { ...(method === "GET" ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { app, call, log };
}

function seedChange() {
  const p = deps.record.createProject({ name: "Salon", repoUrl: REPO });
  const c = deps.record.createChange({ projectId: p.id, title: "Deposits", description: "Take a deposit.", kind: "feature" });
  return { p, c };
}

function seedFinding() {
  const { p, c } = seedChange();
  const k = deps.record.addCriterion({ projectId: p.id, changeId: c.id, text: "A deposit is taken", isFailurePath: false });
  const runId = deps.record.startRun({ changeId: c.id, role: "qa", commit: "a".repeat(40) });
  const { finding } = deps.record.addFinding({
    projectId: p.id,
    changeId: c.id,
    runId,
    role: "qa",
    stage: "verification",
    kind: "failure_path",
    title: "No deposit on retry",
    plain: "A retried booking skips the deposit.",
    costIfIgnored: "Lost deposits.",
    fixPrompt: "Take the deposit on retry.",
    trigger: { type: "doc", quote: "Take a deposit." },
    criterionId: k.id,
  });
  return { p, c, k, finding };
}

describe("HTTP API", () => {
  it("creating a project then a change returns stage intake", async () => {
    const { call } = setup();
    const p = await call("POST", "/api/projects", { name: "Salon", repoUrl: REPO });
    expect(p.status).toBe(201);
    const c = await call("POST", `/api/projects/${p.json.id}/changes`, { title: "Deposits", description: "Take a deposit.", kind: "feature" });
    expect(c.status).toBe(201);
    expect(c.json.stage).toBe("intake");

    const list = await call("GET", "/api/projects");
    expect(list.json.projects.map((x: { id: string }) => x.id)).toEqual([p.json.id]);
    const one = await call("GET", `/api/projects/${p.json.id}`);
    expect(one.json.project.name).toBe("Salon");
    expect(one.json.changes.map((x: { id: string }) => x.id)).toEqual([c.json.id]);
  });

  it("rejects a bad repoUrl, an unknown kind and missing fields with 400", async () => {
    const { call } = setup();
    for (const repoUrl of ["http://github.com/a/b.git", "https://user@github.com/a/b.git", "C:/code/app", "--upload-pack=x"]) {
      const r = await call("POST", "/api/projects", { name: "X", repoUrl });
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/repoUrl/);
    }
    expect((await call("POST", "/api/projects", { repoUrl: REPO })).status).toBe(400);
    expect((await call("POST", "/api/projects", { name: "x".repeat(201), repoUrl: REPO })).status).toBe(400);
    expect((await call("POST", "/api/projects", "not json")).status).toBe(400);
    expect(deps.record.listProjects()).toEqual([]);

    const { p } = seedChange();
    const bad = await call("POST", `/api/projects/${p.id}/changes`, { title: "T", description: "D", kind: "rewrite" });
    expect(bad.status).toBe(400);
  });

  it("allows a local repo path only when local repos are enabled", async () => {
    deps.allowLocalRepos = true;
    const { call } = setup();
    expect((await call("POST", "/api/projects", { name: "Local", repoUrl: dir })).status).toBe(201);
  });

  it("returns 404 JSON for ids that do not exist", async () => {
    const { call } = setup();
    for (const [m, path, body] of [
      ["GET", "/api/projects/nope", undefined],
      ["GET", "/api/changes/nope", undefined],
      ["GET", "/api/changes/nope/record", undefined],
      ["GET", "/api/findings/nope", undefined],
      ["GET", "/api/jobs/nope", undefined],
      ["POST", "/api/changes/nope/advance", undefined],
      ["POST", "/api/projects/nope/recheck", {}],
      ["POST", "/api/findings/nope/status", { status: "fixed", reason: "r", actor: "a" }],
    ] as const) {
      const r = await call(m, path, body);
      expect(r.status, path).toBe(404);
      expect(typeof r.json.error).toBe("string");
    }
  });

  it("rejects a body over 64 KB with 413", async () => {
    const { call } = setup();
    const r = await call("POST", "/api/projects", { name: "X", repoUrl: REPO, pad: "x".repeat(65 * 1024) });
    expect(r.status).toBe(413);
    expect(deps.record.listProjects()).toEqual([]);
  });

  it("advance returns a job id before the run finishes", async () => {
    const { c } = seedChange();
    const run = deferred<{ stage: "analysis"; held: []; stoppedForBudget: boolean }>();
    const advanceFn = vi.fn(() => run.promise);
    const { call } = setup({ advanceFn });

    const r = await call("POST", `/api/changes/${c.id}/advance`);
    expect(r.status).toBe(202);
    expect(advanceFn).toHaveBeenCalledWith(deps, c.id);
    expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json).toEqual({ state: "running" });

    run.resolve({ stage: "analysis", held: [], stoppedForBudget: false });
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json).toEqual({ state: "done" }));
  });

  it("a second advance for the same change while one runs returns 409 with the running job id", async () => {
    const { c } = seedChange();
    const run = deferred<never>();
    const { call, log } = setup({ advanceFn: () => run.promise });
    const first = await call("POST", `/api/changes/${c.id}/advance`);
    const second = await call("POST", `/api/changes/${c.id}/advance`);
    expect(second.status).toBe(409);
    expect(second.json.jobId).toBe(first.json.jobId);
    // A recheck of the same project waits too, since it advances that project's changes.
    const re = await call("POST", `/api/projects/${c.projectId}/recheck`, {});
    expect(re.status).toBe(409);

    run.reject(new Error("git fetch failed: C:/secret/path\n    at secret/stack.ts:1"));
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${first.json.jobId}`)).json.state).toBe("failed"));
    const { error } = (await call("GET", `/api/jobs/${first.json.jobId}`)).json;
    expect(error).toBe("The job stopped with an error. The server log has the details.");
    expect(error).not.toMatch(/fail|secret/i);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a recheck running blocks an advance in the same project, and a refused accept stores nothing", async () => {
    const { p, c } = seedChange();
    deps.record.setStage(c.id, "acceptance");
    const run = deferred<{ runIds: string[]; stoppedForBudget: boolean }>();
    const { call } = setup({ recheckFn: () => run.promise });
    const re = await call("POST", `/api/projects/${p.id}/recheck`, {});
    expect(re.status).toBe(202);
    expect((await call("POST", `/api/changes/${c.id}/advance`)).json.jobId).toBe(re.json.jobId);
    const acc = await call("POST", `/api/changes/${c.id}/accept`, { actor: "founder" });
    expect(acc.status).toBe(409);
    expect(deps.record.listArtifacts(c.id).filter((a) => a.kind === "acceptance")).toEqual([]);
    run.resolve({ runIds: [], stoppedForBudget: false });
  });

  it("a budget stop shows as stopped_budget", async () => {
    const { c } = seedChange();
    const { call } = setup({ advanceFn: async () => ({ stage: "intake", held: [], stoppedForBudget: true }) });
    const r = await call("POST", `/api/changes/${c.id}/advance`);
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json.state).toBe("stopped_budget"));
  });

  it("recheck runs as a job with the given reason, and a budget error escaping it is stopped_budget", async () => {
    const { p } = seedChange();
    const recheckFn = vi.fn(async () => {
      throw new BudgetExceededError("used");
    });
    const { call } = setup({ recheckFn });
    const r = await call("POST", `/api/projects/${p.id}/recheck`, { reason: "mcp" });
    expect(r.status).toBe(202);
    expect(recheckFn).toHaveBeenCalledWith(deps, p.id, "mcp");
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json).toEqual({ state: "stopped_budget" }));
    expect((await call("POST", `/api/projects/${p.id}/recheck`, { reason: "push" })).status).toBe(400);
  });

  it("answers are stored for the BA and accept records the acceptance, then advances", async () => {
    const { c } = seedChange();
    const advanceFn = vi.fn(async () => ({ stage: "operate" as const, held: [], stoppedForBudget: false }));
    const { call } = setup({ advanceFn });

    expect((await call("POST", `/api/changes/${c.id}/answers`, { answers: [] })).status).toBe(400);
    expect((await call("POST", `/api/changes/${c.id}/answers`, { answers: ["x".repeat(2001)] })).status).toBe(400);
    expect((await call("POST", `/api/changes/${c.id}/answers`, { answers: ["Deposit is 20%"] })).status).toBe(201);
    expect(advanceFn).not.toHaveBeenCalled();
    const answers = deps.record.listArtifacts(c.id).find((a) => a.kind === "answers");
    expect(answers).toMatchObject({ role: "ba", stage: "analysis", body: { answers: ["Deposit is 20%"] } });

    expect((await call("GET", `/api/changes/${c.id}`)).json.accepted).toBe(false);
    // Not waiting for acceptance yet: refused, nothing stored, nothing started.
    const early = await call("POST", `/api/changes/${c.id}/accept`, { actor: "founder" });
    expect(early.status).toBe(409);
    expect(early.json.error).toMatch(/not waiting for acceptance/);
    expect(deps.record.listArtifacts(c.id).filter((a) => a.kind === "acceptance")).toEqual([]);
    expect(advanceFn).not.toHaveBeenCalled();

    deps.record.setStage(c.id, "acceptance");
    expect((await call("POST", `/api/changes/${c.id}/accept`, {})).status).toBe(400);
    const r = await call("POST", `/api/changes/${c.id}/accept`, { actor: "founder" });
    expect(r.status).toBe(202);
    expect(typeof r.json.jobId).toBe("string");
    expect(advanceFn).toHaveBeenCalledWith(deps, c.id);
    const acc = deps.record.listArtifacts(c.id).find((a) => a.kind === "acceptance");
    expect(acc).toMatchObject({ role: "po", stage: "acceptance", body: { actor: "founder" } });
    expect((await call("GET", `/api/changes/${c.id}`)).json.accepted).toBe(true);
  });

  it("get change returns stage, findings with status, criteria and questions", async () => {
    const { c, k, finding } = seedFinding();
    deps.record.addArtifact({ changeId: c.id, role: "ba", stage: "intake", kind: "questions", body: { questions: ["How much?"] } });
    const { call } = setup();
    const r = await call("GET", `/api/changes/${c.id}`);
    expect(r.status).toBe(200);
    expect(r.json.stage).toBe("intake");
    expect(r.json.questions).toEqual(["How much?"]);
    expect(r.json.findings.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([[finding.id, "open"]]);
    expect(r.json.criteria).toEqual([expect.objectContaining({ id: k.id, latest: null })]);
    expect((await call("GET", `/api/changes/${c.id}/record`)).json).toMatchObject({ change: { id: c.id }, summary: null });
  });

  it("a fix report leaves the finding open with the report attached, and only an open finding takes one", async () => {
    const { p, c, finding } = seedFinding();
    const { call } = setup();
    expect((await call("POST", `/api/findings/${finding.id}/fix-report`, { summary: "" })).status).toBe(400);
    const r = await call("POST", `/api/findings/${finding.id}/fix-report`, { summary: "Deposit taken on retry" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: "open", fixReported: { summary: "Deposit taken on retry" } });
    const view = await call("GET", `/api/changes/${c.id}`);
    expect(view.json.findings[0].fixReported.summary).toBe("Deposit taken on retry");
    expect((await call("GET", `/api/projects/${p.id}/findings?status=open`)).json.findings[0].fixReported).not.toBeNull();
    deps.record.setFindingStatus(finding.id, "deferred", "Later", "Ada");
    expect((await call("POST", `/api/findings/${finding.id}/fix-report`, { summary: "x" })).status).toBe(409);
  });

  it("withdraw ends a change: it is marked in the views and refuses advance and a second withdraw", async () => {
    const { p, c } = seedChange();
    const advanceFn = vi.fn();
    const { call } = setup({ advanceFn });
    expect((await call("POST", `/api/changes/${c.id}/withdraw`, { reason: "Dropped" })).status).toBe(400);
    expect((await call("POST", `/api/changes/${c.id}/withdraw`, { reason: "Dropped", actor: "Ada" })).status).toBe(201);
    expect((await call("GET", `/api/changes/${c.id}`)).json.withdrawn).toEqual({ reason: "Dropped", actor: "Ada" });
    expect((await call("GET", `/api/projects/${p.id}`)).json.changes[0].withdrawn).toBe(true);
    expect((await call("POST", `/api/changes/${c.id}/advance`)).status).toBe(409);
    expect((await call("POST", `/api/changes/${c.id}/withdraw`, { reason: "Again", actor: "Ada" })).status).toBe(409);
    expect(advanceFn).not.toHaveBeenCalled();
  });

  it("reanalyse sends a change with no criteria back to analysis, and refuses one that has criteria", async () => {
    const { c } = seedChange();
    const advanceFn = vi.fn(async () => ({ stage: "analysis" as const, held: [], stoppedForBudget: false }));
    const { call } = setup({ advanceFn });
    expect((await call("POST", `/api/changes/${c.id}/reanalyse`)).status).toBe(409);
    deps.record.setStage(c.id, "release");
    expect((await call("POST", `/api/changes/${c.id}/reanalyse`)).status).toBe(202);
    expect(deps.record.getChange(c.id).stage).toBe("analysis");
    expect(advanceFn).toHaveBeenCalledWith(deps, c.id);

    const { c: other } = seedFinding();
    deps.record.setStage(other.id, "release");
    expect((await call("POST", `/api/changes/${other.id}/reanalyse`)).status).toBe(409);
  });

  it("fix-change opens a fix change from a delivered change with open findings, and both views link it", async () => {
    const { c, finding } = seedFinding();
    const { call } = setup();
    expect((await call("POST", `/api/changes/${c.id}/fix-change`)).status).toBe(409);
    deps.record.setStage(c.id, "operate");
    const r = await call("POST", `/api/changes/${c.id}/fix-change`);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: "fix", stage: "intake" });
    const view = (await call("GET", `/api/changes/${c.id}`)).json;
    expect(view.fixChanges).toEqual([{ id: r.json.id, title: r.json.title, stage: "intake", withdrawn: false, findingIds: [finding.id] }]);
    expect((await call("GET", `/api/changes/${r.json.id}`)).json.follows).toEqual({ id: c.id, title: "Deposits", stage: "operate" });
  });

  it("status endpoint rejects an unknown status with 400", async () => {
    const { finding } = seedFinding();
    const { call } = setup();
    const bad = await call("POST", `/api/findings/${finding.id}/status`, { status: "closed", reason: "done", actor: "founder" });
    expect(bad.status).toBe(400);
    expect((await call("POST", `/api/findings/${finding.id}/status`, { status: "fixed", reason: "x".repeat(1001), actor: "a" })).status).toBe(400);
    const ok = await call("POST", `/api/findings/${finding.id}/status`, { status: "accepted_risk", reason: "Low volume", actor: "founder" });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("accepted_risk");
    expect(deps.record.findingStatus(finding.id)).toBe("accepted_risk");
  });

  it("get finding returns its criterion and project findings filter by status", async () => {
    const { p, k, finding } = seedFinding();
    const { call } = setup();
    const r = await call("GET", `/api/findings/${finding.id}`);
    expect(r.json.finding.id).toBe(finding.id);
    expect(r.json.status).toBe("open");
    expect(r.json.history.map((h: { status: string }) => h.status)).toEqual(["open"]);
    expect(r.json.criterion).toMatchObject({ id: k.id, text: "A deposit is taken" });

    expect((await call("GET", `/api/projects/${p.id}/findings?status=open`)).json.findings).toHaveLength(1);
    expect((await call("GET", `/api/projects/${p.id}/findings?status=fixed`)).json.findings).toHaveLength(0);
    expect((await call("GET", `/api/projects/${p.id}/findings?status=nope`)).status).toBe(400);
  });

  it("spend endpoint returns spentUsd and budgetUsd", async () => {
    const { c } = seedChange();
    const runId = deps.record.startRun({ changeId: c.id, role: "ba", commit: "b".repeat(40) });
    deps.record.addRunCost(runId, 1.5, 10, 10);
    const { call } = setup({ budgetUsd: 70 });
    expect((await call("GET", "/api/spend")).json).toEqual({ spentUsd: 1.5, budgetUsd: 70, model: null, fake: false });
  });

  it("spend endpoint names the model and says when outputs are replayed fixtures", async () => {
    const { call } = setup({ model: "muse-spark-9", fake: true });
    expect((await call("GET", "/api/spend")).json).toMatchObject({ model: "muse-spark-9", fake: true });
  });

  it("change endpoint lists the latest run of each role", async () => {
    const { c } = seedChange();
    const first = deps.record.startRun({ changeId: c.id, role: "ba", commit: "a".repeat(40) });
    deps.record.finishRun(first, "done");
    const qa = deps.record.startRun({ changeId: c.id, role: "qa", commit: "a".repeat(40) });
    const second = deps.record.startRun({ changeId: c.id, role: "ba", commit: "b".repeat(40) });
    const { call } = setup();
    const runs = (await call("GET", `/api/changes/${c.id}`)).json.runs;
    expect(runs.map((r: { id: string; role: string; status: string }) => [r.role, r.id, r.status])).toEqual([
      ["ba", second, "running"],
      ["qa", qa, "running"],
    ]);
    expect(runs[0].commit).toBe("b".repeat(40));
  });

  it("change endpoint adds the law and section a legal finding cites", async () => {
    const duty = { duty: "d", triggers: [], sourceUrl: "https://example.org", verifiedOn: "2026-10-27", title: "t" };
    deps.packs = {
      ...packs,
      legal: [
        { ...duty, id: "pci-no-cvv-storage", law: "PCI DSS", section: "Requirement 3.3.1.2" },
        { ...duty, id: "ndpa-lawful-basis", law: "NDPA 2023", section: "Section 25(1)" },
      ],
    };
    const { c } = seedChange();
    const runId = deps.record.startRun({ changeId: c.id, role: "compliance", commit: "a".repeat(40) });
    const base = { projectId: c.projectId, changeId: c.id, runId, role: "compliance" as const, stage: "design_review" as const };
    const legal = { ...base, kind: "legal" as const, plain: "Check this.", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "doc" as const, quote: "q" } };
    deps.record.addFinding({ ...legal, title: "Card code kept", citationId: "pci-no-cvv-storage" });
    deps.record.addFinding({ ...legal, title: "No lawful basis", citationId: "ndpa-lawful-basis" });
    deps.record.addFinding({ ...legal, kind: "operations", title: "No backups" });
    const { call } = setup();
    const findings = (await call("GET", `/api/changes/${c.id}`)).json.findings;
    expect(findings.map((f: { title: string; law?: string; section?: string }) => [f.title, f.law, f.section])).toEqual([
      ["Card code kept", "PCI DSS", "Requirement 3.3.1.2"],
      ["No lawful basis", "NDPA 2023", "Section 25(1)"],
      ["No backups", undefined, undefined],
    ]);
  });
});

describe("local-only request guard", () => {
  const NEW = { name: "Salon", repoUrl: REPO };

  it("a text/plain POST gets 415, so a cross-site form cannot write", async () => {
    const { call } = setup();
    const r = await call("POST", "/api/projects", JSON.stringify(NEW), { "content-type": "text/plain" });
    expect(r.status).toBe(415);
    expect((await call("POST", "/api/projects", JSON.stringify(NEW), { "content-type": "" })).status).toBe(415);
    expect(deps.record.listProjects()).toEqual([]);
  });

  it("a foreign Host or the wrong port gets 403 (DNS rebinding)", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/projects", undefined, {}, "http://evil.example:8787")).status).toBe(403);
    expect((await call("GET", "/api/projects", undefined, {}, "http://127.0.0.1:9999")).status).toBe(403);
    expect((await call("POST", "/api/projects", NEW, {}, "http://evil.example:8787")).status).toBe(403);
    expect(deps.record.listProjects()).toEqual([]);
  });

  it("a foreign Origin gets 403 and no CORS header is ever sent", async () => {
    const { call, app } = setup();
    for (const origin of ["http://evil.example", "http://evil.example:8787", "null", "https://127.0.0.1:8787", "http://127.0.0.1:3000"]) {
      expect((await call("POST", "/api/projects", NEW, { origin })).status, origin).toBe(403);
    }
    expect(deps.record.listProjects()).toEqual([]);
    const res = await app.request(`${BASE}/api/projects`, { headers: { origin: "http://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("same-origin requests work on every loopback name, and on a configured host", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/projects", NEW, { origin: BASE })).status).toBe(201);
    for (const base of ["http://localhost:8787", "http://[::1]:8787"]) {
      expect((await call("GET", "/api/projects", undefined, { origin: base }, base)).status, base).toBe(200);
    }
    const lan = setup({ host: "192.168.1.20", port: 9000 });
    expect((await lan.call("GET", "/api/projects", undefined, {}, "http://192.168.1.20:9000")).status).toBe(200);
    expect((await lan.call("GET", "/api/projects", undefined, {}, BASE)).status).toBe(403);
  });

  it("with an API token set, every request needs the bearer token", async () => {
    const { call } = setup({ apiToken: "test-token-123" });
    expect((await call("GET", "/api/projects")).status).toBe(401);
    expect((await call("GET", "/api/projects", undefined, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call("GET", "/api/projects", undefined, { authorization: "test-token-123" })).status).toBe(401);
    expect((await call("GET", "/api/projects", undefined, { authorization: "Bearer test-token-123" })).status).toBe(200);
    expect((await call("POST", "/api/projects", NEW, { authorization: "Bearer test-token-123" })).status).toBe(201);
  });
});

describe("push poller", () => {
  const A = "a".repeat(40);
  const B = "b".repeat(40);

  function projects() {
    const changed = deps.record.createProject({ name: "Changed", repoUrl: "https://github.com/x/changed.git" });
    const same = deps.record.createProject({ name: "Same", repoUrl: "https://github.com/x/same.git" });
    const fresh = deps.record.createProject({ name: "Fresh", repoUrl: "https://github.com/x/fresh.git" });
    deps.record.setCheckedCommit(changed.id, A);
    deps.record.setCheckedCommit(same.id, A);
    return { changed, same, fresh };
  }

  it("poller calls recheck only for the project whose head changed", async () => {
    const { changed, fresh } = projects();
    const lsRemote = vi.fn(async (url: string) => (url.includes("changed") ? B : A));
    const recheckFn = vi.fn(async () => ({ runIds: [], stoppedForBudget: false }));
    await pollOnce(deps, lsRemote, recheckFn, new Jobs());
    expect(recheckFn).toHaveBeenCalledTimes(1);
    expect(recheckFn).toHaveBeenCalledWith(deps, changed.id, "push");
    // No baseline yet: skipped without asking the remote.
    expect(lsRemote).not.toHaveBeenCalledWith(fresh.repoUrl, deps);
  });

  it("a recheck that throws is not retried until the remote head moves", async () => {
    const { changed } = projects();
    let head = B;
    const lsRemote = async (url: string) => (url.includes("changed") ? head : A);
    const recheckFn = vi.fn(async () => {
      throw new Error("schema mismatch");
    });
    const jobs = new Jobs(() => {});
    const tried = new Map<string, string>();
    await pollOnce(deps, lsRemote, recheckFn, jobs, tried);
    await vi.waitFor(() => expect(jobs.busy(changed.id)).toBeUndefined());
    expect(recheckFn).toHaveBeenCalledTimes(1);

    await pollOnce(deps, lsRemote, recheckFn, jobs, tried);
    expect(recheckFn).toHaveBeenCalledTimes(1);

    head = "c".repeat(40);
    await pollOnce(deps, lsRemote, recheckFn, jobs, tried);
    expect(recheckFn).toHaveBeenCalledTimes(2);
  });

  it("poller survives one project's lsRemote throwing and skips a project whose recheck is running", async () => {
    const { same } = projects();
    deps.record.setCheckedCommit(same.id, B); // now it differs from A too
    const lsRemote = vi.fn(async (url: string) => {
      if (url.includes("changed")) throw new Error("network down");
      return A;
    });
    const recheckFn = vi.fn(async () => ({ runIds: [], stoppedForBudget: false }));
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobs = new Jobs();
    await pollOnce(deps, lsRemote, recheckFn, jobs);
    expect(recheckFn).toHaveBeenCalledTimes(1);
    expect(recheckFn).toHaveBeenCalledWith(deps, same.id, "push");

    const busy = deferred<{ runIds: string[]; stoppedForBudget: boolean }>();
    const blocking = vi.fn(() => busy.promise);
    jobs.start("recheck", same.id, same.id, () => blocking());
    const second = vi.fn(async () => ({ runIds: [], stoppedForBudget: false }));
    await pollOnce(deps, lsRemote, second, jobs);
    expect(second).not.toHaveBeenCalled();
    busy.resolve({ runIds: [], stoppedForBudget: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to the last QA run commit when no recheck has run, and stops when asked", async () => {
    const p = deps.record.createProject({ name: "Run", repoUrl: "https://github.com/x/run.git" });
    const c = deps.record.createChange({ projectId: p.id, title: "T", description: "D", kind: "feature" });
    deps.record.finishRun(deps.record.startRun({ changeId: c.id, role: "qa", commit: A }), "done");
    const recheckFn = vi.fn(async () => ({ runIds: [], stoppedForBudget: false }));
    const stop = startPoller(deps, 5, async () => B, recheckFn);
    await vi.waitFor(() => expect(recheckFn).toHaveBeenCalledWith(deps, p.id, "push"));
    stop();
  });
});

describe("documents, trace, open items and connections", () => {
  const SHA = "a".repeat(40);
  function seedDocs() {
    const { p, c, k, finding } = seedFinding();
    const r = deps.record;
    const doc = r.saveDocumentVersion({ projectId: p.id, name: "docs/PRD.md", source: "repo", body: "# PRD\nFR-1 Take a deposit.", commit: SHA });
    const [req] = r.applyRequirements(doc.document.id, doc.version.id, [{ key: "FR-1", text: "Take a deposit", quote: "Take a deposit.", line: 2 }]).added;
    r.linkRequirement(req!.id, "criterion", k.id);
    const runId = r.startRun({ changeId: c.id, role: "qa", commit: SHA });
    r.recordCheck({ criterionId: k.id, runId, state: "gap", evidence: [], note: "" });
    r.finishRun(runId, "done");
    return { p, c, k, finding, doc: doc.document, req: req! };
  }

  it("GET open-items ranks what is open, with the setup item when there are no documents", async () => {
    const { call } = setup();
    const { p } = seedFinding();
    const r = await call("GET", `/api/projects/${p.id}/open-items`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(2);
    expect(r.json.items.map((i: { title: string }) => i.title)).toEqual(["No deposit on retry", "No PRD or spec found"]);
  });

  it("GET documents and one document with its versions, requirements and findings", async () => {
    const { call } = setup();
    const { p, doc } = seedDocs();
    const list = await call("GET", `/api/projects/${p.id}/documents`);
    expect(list.json.documents).toHaveLength(1);
    expect(list.json.documents[0]).toMatchObject({ id: doc.id, name: "docs/PRD.md", requirements: 1, gaps: 0 });
    const one = await call("GET", `/api/documents/${doc.id}`);
    expect(one.json.document.name).toBe("docs/PRD.md");
    expect(one.json.versions).toHaveLength(1);
    expect(one.json.requirements.map((x: { key: string }) => x.key)).toEqual(["FR-1"]);
    expect(one.json.findings).toEqual([]);
    expect((await call("GET", "/api/documents/nope")).status).toBe(404);
  });

  it("POST documents stores an upload; empty is 400; over 200 KB is 413 with the plain message", async () => {
    const { call } = setup();
    const { p } = seedChange();
    const ok = await call("POST", `/api/projects/${p.id}/documents`, { name: "Client brief", body: "The client wants refunds." });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ document: { name: "Client brief", source: "upload" }, changed: true });
    expect((await call("POST", `/api/projects/${p.id}/documents`, { name: "", body: "x" })).status).toBe(400);
    expect((await call("POST", `/api/projects/${p.id}/documents`, { name: "x", body: " " })).status).toBe(400);
    const big = await call("POST", `/api/projects/${p.id}/documents`, { name: "Big", body: "x".repeat(200 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect(big.json.error).toBe("That document is over 200 KB. Split it or paste the part that matters.");
    const huge = await call("POST", `/api/projects/${p.id}/documents`, { name: "Huge", body: "x".repeat(600 * 1024) });
    expect(huge.status).toBe(413);
    expect(huge.json.error).toBe("That document is over 200 KB. Split it or paste the part that matters.");
    // Other routes keep their 64 KB limit.
    expect((await call("POST", `/api/projects/${p.id}/changes`, { title: "t", description: "x".repeat(70 * 1024), kind: "feature" })).status).toBe(413);
  });

  it("PUT doc-settings saves include and exclude globs", async () => {
    const { call } = setup();
    const { p } = seedChange();
    const r = await call("PUT", `/api/projects/${p.id}/doc-settings`, { include: ["notes/**/*.md"], exclude: ["docs/old/**"] });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ include: ["notes/**/*.md"], exclude: ["docs/old/**"] });
    expect(deps.record.docSettings(p.id)).toEqual({ include: ["notes/**/*.md"], exclude: ["docs/old/**"] });
    expect((await call("PUT", `/api/projects/${p.id}/doc-settings`, { include: "x", exclude: [] })).status).toBe(400);
  });

  it("GET requirements carries criteria, tickets, evidence, open and drift", async () => {
    const { call } = setup();
    const { p, req } = seedDocs();
    deps.record.linkRequirement(req.id, "linear_issue", "ENG-12");
    const r = await call("GET", `/api/projects/${p.id}/requirements`);
    expect(r.json.requirements).toHaveLength(1);
    expect(r.json.requirements[0]).toMatchObject({ key: "FR-1", criteria: 1, tickets: ["ENG-12"], evidence: "gap", open: 1, drifted: false });
  });

  it("GET requirement trace, and commit trace or 404", async () => {
    const { call } = setup();
    const { p, req } = seedDocs();
    const t = await call("GET", `/api/requirements/${req.id}/trace`);
    expect(t.json.requirement.key).toBe("FR-1");
    expect(t.json.gaps).toContain("No Linear ticket");
    expect((await call("GET", "/api/requirements/nope/trace")).status).toBe(404);
    const ct = await call("GET", `/api/projects/${p.id}/commits/aaaaaaa/trace`);
    expect(ct.status).toBe(200);
    expect(ct.json.sha).toBe(SHA);
    const none = await call("GET", `/api/projects/${p.id}/commits/bbbbbbb/trace`);
    expect(none.status).toBe(404);
    expect(none.json.error).toBe("Kryterea has not checked this commit.");
  });

  it("GET commits lists checked commits oldest first, and compare reads before and after or says why not", async () => {
    const { call } = setup();
    const { p, c, k } = seedDocs();
    await new Promise((r) => setTimeout(r, 5));
    const runId = deps.record.startRun({ changeId: c.id, role: "qa", commit: "b".repeat(40) });
    deps.record.recordCheck({ criterionId: k.id, runId, state: "evidence_found", evidence: [], note: "" });
    deps.record.finishRun(runId, "done");
    const list = await call("GET", `/api/projects/${p.id}/commits`);
    expect(list.json.commits.map((x: { sha: string }) => x.sha)).toEqual([SHA, "b".repeat(40)]);
    const cmp = await call("GET", `/api/projects/${p.id}/compare?from=aaaaaaa&to=bbbbbbb`);
    expect(cmp.status).toBe(200);
    expect(cmp.json.from).toMatchObject({ sha: SHA, gaps: 1 });
    expect(cmp.json.to).toMatchObject({ evidenceFound: 1, gaps: 0 });
    const none = await call("GET", `/api/projects/${p.id}/compare?from=aaaaaaa&to=ccccccc`);
    expect(none.status).toBe(404);
    expect(none.json.error).toBe("Kryterea has not checked one of these commits.");
  });

  it("POST requirement linear links a ticket, or says why not", async () => {
    const { req } = seedDocs();
    const off = await setup().call("POST", `/api/requirements/${req.id}/linear`, { identifier: "ENG-12" });
    expect(off.status).toBe(409);
    expect(off.json.error).toBe("Linear is not connected.");
    const linear = {
      issue: async (id: string) => (id === "ENG-12" ? { id: "uuid", identifier: id, title: "Deposits", url: "https://linear.app/x/ENG-12" } : null),
      upsertComment: async () => "c",
    };
    const { call } = setup({ linear });
    const ok = await call("POST", `/api/requirements/${req.id}/linear`, { identifier: "eng-12" });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ requirementId: req.id, identifier: "ENG-12", url: "https://linear.app/x/ENG-12" });
    expect(deps.record.requirementLinks(req.id).filter((l) => l.toType === "linear_issue").map((l) => l.toId)).toEqual(["ENG-12"]);
    const missing = await call("POST", `/api/requirements/${req.id}/linear`, { identifier: "ENG-99" });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("Linear has no ticket ENG-99.");
    expect((await call("POST", `/api/requirements/${req.id}/linear`, { identifier: "not a key" })).status).toBe(400);
  });

  it("GET connections shows each side's state and the MCP command", async () => {
    const { req, p } = seedDocs();
    deps.record.linkRequirement(req.id, "linear_issue", "ENG-12");
    const off = await setup().call("GET", `/api/projects/${p.id}/connections`);
    expect(off.json).toMatchObject({
      github: { state: "off", detail: null, lastComment: null },
      linear: { state: "off", detail: null, lastComment: null, tickets: 1 },
      mcp: { command: "claude mcp add lifecycle-copilot -e COPILOT_URL=http://localhost:8787 -- node packages/mcp/dist/src/main.js" },
    });
    const syncStatus = new Map([
      [
        p.id,
        {
          linear: { state: "connected" as const, detail: null, lastComment: "ENG-12" },
          github: { state: "error" as const, detail: "GitHub did not accept the token (401).", lastComment: null },
        },
      ],
    ]);
    const linear = { issue: async () => null, upsertComment: async () => "c" };
    const on = await setup({ syncStatus, githubConnected: true, linear }).call("GET", `/api/projects/${p.id}/connections`);
    expect(on.json.github).toEqual({ state: "error", detail: "GitHub did not accept the token (401).", lastComment: null });
    expect(on.json.linear).toEqual({ state: "connected", detail: null, lastComment: "ENG-12", tickets: 1 });
    const fresh = await setup({ githubConnected: true }).call("GET", `/api/projects/${p.id}/connections`);
    expect(fresh.json.github).toEqual({ state: "connected", detail: null, lastComment: null });
  });
});

describe("change view for the governed trace", () => {
  it("carries documents read, requirement keys on criteria, drift and who accepted each risk", async () => {
    const { call } = setup();
    const { p, c, k, finding } = seedFinding();
    const r = deps.record;
    const doc = r.saveDocumentVersion({ projectId: p.id, name: "docs/PRD.md", source: "repo", body: "FR-1 Take a deposit.", commit: null });
    const [req] = r.applyRequirements(doc.document.id, doc.version.id, [{ key: "FR-1", text: "Take a deposit", quote: "Take a deposit.", line: 1 }]).added;
    r.linkRequirement(req!.id, "criterion", k.id);
    r.addArtifact({ changeId: c.id, role: "ba", stage: "intake", kind: "documents_read", body: { documents: [{ name: "docs/PRD.md", versionId: doc.version.id, hash: "h", commit: null, requirements: 1, gaps: 0 }] } });
    r.setFindingStatus(finding.id, "accepted_risk", "Retries are rare", "Ada");
    const v = await call("GET", `/api/changes/${c.id}`);
    expect(v.json.documentsRead).toEqual([{ name: "docs/PRD.md", requirements: 1, gaps: 0 }]);
    expect(v.json.criteria[0].requirementKeys).toEqual(["FR-1"]);
    expect(v.json.findings[0]).toMatchObject({ id: finding.id, drift: null, decision: { status: "accepted_risk", reason: "Retries are rare", actor: "Ada" } });
  });
});
