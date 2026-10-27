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

function setup(opts: AppOptions = {}) {
  const app = createApp(deps, opts);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { app, call };
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
    const { call } = setup({ advanceFn: () => run.promise });
    const first = await call("POST", `/api/changes/${c.id}/advance`);
    const second = await call("POST", `/api/changes/${c.id}/advance`);
    expect(second.status).toBe(409);
    expect(second.json.jobId).toBe(first.json.jobId);
    // A recheck of the same project waits too, since it advances that project's changes.
    const re = await call("POST", `/api/projects/${c.projectId}/recheck`, {});
    expect(re.status).toBe(409);

    run.reject(new Error("model said no\n    at secret/stack.ts:1"));
    await vi.waitFor(async () =>
      expect((await call("GET", `/api/jobs/${first.json.jobId}`)).json).toEqual({ state: "failed", error: "model said no" }),
    );
    expect((await call("POST", `/api/changes/${c.id}/advance`)).status).toBe(202);
  });

  it("a budget stop shows as stopped_budget", async () => {
    const { c } = seedChange();
    const { call } = setup({ advanceFn: async () => ({ stage: "intake", held: [], stoppedForBudget: true }) });
    const r = await call("POST", `/api/changes/${c.id}/advance`);
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json.state).toBe("stopped_budget"));
  });

  it("recheck runs as a job with the given reason", async () => {
    const { p } = seedChange();
    const recheckFn = vi.fn(async () => {
      throw new BudgetExceededError("used");
    });
    const { call } = setup({ recheckFn });
    const r = await call("POST", `/api/projects/${p.id}/recheck`, { reason: "mcp" });
    expect(r.status).toBe(202);
    expect(recheckFn).toHaveBeenCalledWith(deps, p.id, "mcp");
    await vi.waitFor(async () => expect((await call("GET", `/api/jobs/${r.json.jobId}`)).json.state).toBe("failed"));
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
    expect((await call("GET", "/api/spend")).json).toEqual({ spentUsd: 1.5, budgetUsd: 70 });
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
