import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  CopilotRecord,
  SYSTEM_ACTOR,
  STAGES,
  advance,
  openFixChange,
  openQuestions,
  recheck,
  withdrawal,
  type Change,
  type Model,
  type ModelFactory,
  type ModelRequest,
  type Packs,
  type WorkflowDeps,
} from "../src/index.js";

const QUOTE = "Customers book a slot";
const DESCRIPTION = `${QUOTE} and pay a deposit.`;
const BOOK = "CRIT-BOOK A customer can book a slot";
const CANCEL = "CRIT-CANCEL A cancelled booking frees the slot";
const NEW = "CRIT-NEW A deposit is taken before the slot is held";
const PAY = "CRIT-PAY A pending booking shows a Pay again button";

const packs: Packs = {
  role: { ba: "BA PACK", architect: "ARCH PACK", qa: "QA PACK", compliance: "COMP PACK", po: "PO PACK" },
  legal: [
    {
      id: "ndpa-consent",
      law: "NDPA 2023",
      section: "s. 26",
      title: "Consent",
      duty: "Get consent before processing.",
      triggers: ["consent"],
      sourceUrl: "https://example.com",
      verifiedOn: "2026-10-27",
    },
  ],
};

const temps: string[] = [];
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function makeOrigin(): { dir: string; put: (rel: string, text: string) => void; commit: (msg: string) => void } {
  const dir = temp("lifecycle-wf-origin-");
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const commit = (msg: string) => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
  };
  git(dir, "init", "-q");
  put("src/app.js", "export function book(slot) {\n  if (!slot) throw new Error('no slot');\n  return save(slot);\n}\n");
  put("src/booking.js", "export function cancel(id) {\n  return remove(id);\n}\n");
  put("src/privacy.js", "export const consent = false;\n");
  commit("one");
  return { dir, put, commit };
}

type Handler = (req: ModelRequest) => unknown;

/** Stub model keyed by request name. Charges 0.01 through the ledger per call; its own costUsd must be ignored. */
function stubModels() {
  const calls: ModelRequest[] = [];
  const qa: Record<string, unknown> = {};
  const state: { failOn?: number } = {};
  const handlers: Record<string, Handler> = {
    "ba.understandApp": () => ({
      asBuilt: { flows: ["Book a slot"], dataCollected: ["Name"], payments: [], roles: ["Customer"] },
      questions: [],
      findings: [],
    }),
    "ba.analyseChange": (req) => ({
      summary: "Bookings.",
      criteria: req.user.includes("Change (feature)")
        ? [{ text: PAY, isFailurePath: false }]
        : [
            { text: BOOK, isFailurePath: false },
            { text: CANCEL, isFailurePath: true },
          ],
      findings: [],
    }),
    "ba.analyseImpact": () => ({ summary: "Deposits.", affected: ["C1"], criteria: [{ text: NEW, isFailurePath: false }], findings: [] }),
    "compliance.reviewCompliance": () => ({ findings: [] }),
    "architect.reviewOperations": () => ({ findings: [] }),
    "qa.verifyCriteria": (req) => {
      const text = /<<<BEGIN CRITERION>>>\n(.*)\n<<<END CRITERION>>>/.exec(req.user)?.[1] ?? "";
      const marker = text.split(" ")[0]!;
      if (qa[marker]) return qa[marker];
      const cite = marker === "CRIT-CANCEL" ? { file: "src/booking.js", line: 2 } : { file: "src/app.js", line: 2 };
      return { state: "evidence_found", evidence: [cite], note: "Done.", title: null, plain: null, costIfIgnored: null, fixPrompt: null };
    },
    "po.acceptanceSummary": () => ({ summary: "All agreed work has evidence found." }),
  };
  const factory: ModelFactory = (ledger) =>
    (async (req: ModelRequest) => {
      calls.push(req);
      if (state.failOn === calls.length) throw new BudgetExceededError("Copilot budget used");
      const h = handlers[req.name];
      if (!h) throw new Error(`unexpected model call ${req.name}`);
      const data = h(req);
      ledger.add(0.01, 100, 50);
      return { data, usage: { input: 100, output: 50 }, costUsd: 0.5 };
    }) as Model;
  const names = () => calls.map((c) => c.name);
  const criteriaVerified = () =>
    calls.filter((c) => c.name === "qa.verifyCriteria").map((c) => /<<<BEGIN CRITERION>>>\n(\S+)/.exec(c.user)?.[1]);
  return { calls, handlers, qa, state, factory, names, criteriaVerified };
}

function setup() {
  const origin = makeOrigin();
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "Salon", repoUrl: origin.dir });
  const models = stubModels();
  const deps: WorkflowDeps = { record, modelFor: models.factory, packs, cacheDir: temp("lifecycle-wf-cache-"), allowLocalRepos: true };
  const change = (kind: Change["kind"], title = "Understand the app") =>
    record.createChange({ projectId: project.id, title, description: DESCRIPTION, kind });
  const crit = (marker: string) => record.listCriteria(project.id).find((c) => c.text.startsWith(marker))!;
  const runs = (changeId: string) => record.acceptanceRecord(changeId).runs;
  return { origin, record, project, models, deps, change, crit, runs };
}

const legalFinding = {
  title: "Check this: consent is not asked",
  plain: "Check this: the app takes names without asking for consent.",
  costIfIgnored: "Customers may complain to the regulator.",
  fixPrompt: "Add a consent step to sign up.",
  citationId: "ndpa-consent",
  triggerType: "doc",
  file: null,
  line: null,
  quote: QUOTE,
};

describe("workflow", () => {
  it("lists the stages in spec order", () => {
    expect(STAGES).toEqual(["intake", "analysis", "design_review", "build", "verification", "release", "acceptance", "operate"]);
  });

  it("understand change runs ba at intake and skips build", async () => {
    const { record, models, deps, change, runs, crit } = setup();
    const c = change("understand");
    const r = await advance(deps, c.id);
    expect(r).toEqual({ stage: "acceptance", held: [], stoppedForBudget: false });
    expect(models.names()).toEqual([
      "ba.understandApp",
      "ba.analyseChange",
      "compliance.reviewCompliance",
      "architect.reviewOperations",
      "qa.verifyCriteria",
      "qa.verifyCriteria",
    ]);
    expect(runs(c.id).map((x) => [x.role, x.status])).toEqual([
      ["ba", "done"],
      ["ba", "done"],
      ["compliance", "done"],
      ["architect", "done"],
      ["qa", "done"],
    ]);
    const kinds = record.listArtifacts(c.id).map((a) => a.kind);
    expect(kinds).toEqual(["as_built", "analysis"]);
    const book = crit("CRIT-BOOK");
    expect(record.linksTo({ type: "criterion", id: book.id })).toContainEqual({ from: { type: "change", id: c.id }, rel: "satisfies" });
    expect(record.latestCheck(book.id)?.state).toBe("evidence_found");
    const gates = record.gates(c.id);
    expect(Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v!.state]))).toEqual({
      ba: "cleared",
      compliance: "cleared",
      architect: "cleared",
      qa: "cleared",
    });
  });

  it("analysis does not move on while BA questions are unanswered", async () => {
    const { record, models, deps, change } = setup();
    const base = models.handlers["ba.understandApp"]!;
    models.handlers["ba.understandApp"] = (req) => ({ ...(base(req) as object), questions: ["Is the booking list meant to be admin only?"] });
    const c = change("understand");
    expect(await advance(deps, c.id)).toEqual({ stage: "analysis", held: ["ba"], stoppedForBudget: false });
    expect(await advance(deps, c.id)).toEqual({ stage: "analysis", held: ["ba"], stoppedForBudget: false });
    expect(models.names()).toEqual(["ba.understandApp"]);
    expect(record.gates(c.id).ba?.state).toBe("held");
    const q = record.listArtifacts(c.id).find((a) => a.kind === "questions");
    expect(q?.body).toEqual({ questions: ["Is the booking list meant to be admin only?"] });

    record.addArtifact({ changeId: c.id, role: "ba", stage: "analysis", kind: "answers", body: { answers: ["Yes, admin only."] } });
    const r = await advance(deps, c.id);
    expect(r.stage).toBe("acceptance");
    const analyse = models.calls.find((x) => x.name === "ba.analyseChange");
    expect(analyse?.user).toContain("Yes, admin only.");
    expect(record.gates(c.id).ba?.state).toBe("cleared");
  });

  it("design review records a held compliance gate but still moves on", async () => {
    const { record, models, deps, change } = setup();
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [legalFinding] });
    const c = change("understand");
    const r = await advance(deps, c.id);
    expect(models.names().slice(3)).toEqual(["architect.reviewOperations", "qa.verifyCriteria", "qa.verifyCriteria"]);
    expect(r).toEqual({ stage: "release", held: ["compliance"], stoppedForBudget: false });
    const legal = record.listFindings({ changeId: c.id });
    expect(legal.map((f) => [f.kind, f.stage, f.status])).toEqual([["legal", "design_review", "open"]]);
  });

  it("recheck moves a feature change from build to verification", async () => {
    const { record, models, deps, change, crit, project, runs, origin } = setup();
    const u = change("understand");
    await advance(deps, u.id);
    const f = change("feature", "Take a deposit");
    expect(await advance(deps, f.id)).toEqual({ stage: "build", held: [], stoppedForBudget: false });
    const impact = models.calls.find((x) => x.name === "ba.analyseImpact");
    expect(impact?.user).toContain(`C1: ${BOOK}`);
    const book = crit("CRIT-BOOK");
    expect(record.linksTo({ type: "criterion", id: book.id })).toContainEqual({ from: { type: "change", id: f.id }, rel: "affects" });

    origin.put("src/deposit.js", "export const deposit = 500;\n");
    origin.commit("take a deposit");
    models.calls.length = 0;
    const res = await recheck(deps, project.id, "push");
    expect(res.stoppedForBudget).toBe(false);
    expect(record.getChange(f.id).stage).toBe("acceptance");
    // Its own criteria (from intake and analysis) plus the one it affects, each once; CRIT-CANCEL is untouched.
    expect(models.criteriaVerified().sort()).toEqual(["CRIT-BOOK", "CRIT-NEW", "CRIT-PAY"]);
    const qaRun = runs(f.id).find((x) => x.role === "qa");
    expect(res.runIds).toContain(qaRun?.id);
  });

  it("release holds while a legal finding is open, then clears after it is marked fixed and rechecked", async () => {
    const { record, models, deps, change, project, origin } = setup();
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [legalFinding] });
    const c = change("understand");
    expect((await advance(deps, c.id)).held).toEqual(["compliance"]);
    expect(await advance(deps, c.id)).toEqual({ stage: "release", held: ["compliance"], stoppedForBudget: false });

    const [finding] = record.listFindings({ changeId: c.id });
    record.setFindingStatus(finding!.id, "fixed", "Consent step added", "owner");
    origin.put("src/privacy.js", "export const consent = true;\n");
    origin.commit("ask consent");
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [] });
    models.calls.length = 0;

    await recheck(deps, project.id, "push");
    const comp = models.calls.find((x) => x.name === "compliance.reviewCompliance");
    expect(comp?.user).toContain("=== src/privacy.js ===");
    expect(comp?.user).not.toContain("=== src/app.js ===");
    expect(record.getChange(c.id).stage).toBe("acceptance");
    expect(record.gates(c.id).compliance?.state).toBe("cleared");
  });

  it("a deferred legal finding keeps the compliance gate held; accepting the risk with a reason clears it", async () => {
    const { record, models, deps, change } = setup();
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [legalFinding] });
    const c = change("understand");
    await advance(deps, c.id);
    expect((await advance(deps, c.id)).held).toEqual(["compliance"]);

    const [finding] = record.listFindings({ changeId: c.id });
    record.setFindingStatus(finding!.id, "deferred", "Next quarter", "owner");
    expect(await advance(deps, c.id)).toEqual({ stage: "release", held: ["compliance"], stoppedForBudget: false });
    expect(record.gates(c.id).compliance?.state).toBe("held");

    record.setFindingStatus(finding!.id, "accepted_risk", "Lawyer confirmed the consent wording", "owner");
    await advance(deps, c.id);
    expect(record.getChange(c.id).stage).toBe("acceptance");
    expect(record.gates(c.id).compliance?.state).toBe("cleared");
  });

  it("recheck re-verifies a criterion whose evidence file was deleted", async () => {
    const { record, models, deps, change, project, origin, crit } = setup();
    const c = change("understand");
    await advance(deps, c.id);
    expect(record.latestCheck(crit("CRIT-CANCEL").id)?.state).toBe("evidence_found");

    git(origin.dir, "rm", "-q", "src/booking.js");
    origin.commit("drop booking");
    models.calls.length = 0;
    await recheck(deps, project.id, "push");
    expect(models.criteriaVerified()).toEqual(["CRIT-CANCEL"]);
    expect(record.latestCheck(crit("CRIT-CANCEL").id)?.state).toBe("no_evidence");
    expect(record.latestCheck(crit("CRIT-BOOK").id)?.state).toBe("evidence_found");
  });

  it("recheck re-verifies a deleted evidence file even after another change's QA run at the newer commit", async () => {
    const { record, models, deps, change, project, origin, crit } = setup();
    await advance(deps, change("understand").id);
    const cancel = crit("CRIT-CANCEL");
    git(origin.dir, "rm", "-q", "src/booking.js");
    origin.commit("drop booking");
    // A second change is verified at the new commit before the poller rechecks.
    await advance(deps, change("understand", "Understand again").id);
    expect(record.lastRunCommit(project.id, "qa")).toBe(git(origin.dir, "rev-parse", "HEAD"));

    const res = await recheck(deps, project.id, "push");
    expect(record.latestCheck(cancel.id)?.state).toBe("no_evidence");
    expect(res.runIds).toContain(record.latestCheck(cancel.id)?.runId);
    expect(record.checkedCommit(project.id)).toBe(git(origin.dir, "rev-parse", "HEAD"));
  });

  it("a push recheck with no new commit does nothing; manual and mcp still re-verify what lacks evidence", async () => {
    const { record, models, deps, change, project, runs } = setup();
    models.qa["CRIT-CANCEL"] = {
      state: "gap",
      evidence: [{ file: "src/booking.js", line: 2 }],
      note: "The slot is not freed.",
      title: "A cancelled booking keeps the slot",
      plain: "The slot stays taken.",
      costIfIgnored: "Lost bookings.",
      fixPrompt: "Free the slot on cancel.",
    };
    const c = change("understand");
    await advance(deps, c.id);
    const before = runs(c.id).length;
    models.calls.length = 0;

    expect(await recheck(deps, project.id, "push")).toEqual({ runIds: [], stoppedForBudget: false });
    expect(models.calls).toHaveLength(0);
    expect(runs(c.id)).toHaveLength(before);

    for (const reason of ["manual", "mcp"] as const) {
      models.calls.length = 0;
      const res = await recheck(deps, project.id, reason);
      expect(models.criteriaVerified()).toEqual(["CRIT-CANCEL"]);
      expect(res.runIds).toHaveLength(1);
    }
    expect(record.getChange(c.id).stage).toBe("release");
  });

  it("acceptance recomputes the release gates and steps back to release when one is held", async () => {
    const { record, models, deps, change, project, origin } = setup();
    const c = change("understand");
    expect((await advance(deps, c.id)).stage).toBe("acceptance");
    models.qa["CRIT-CANCEL"] = {
      state: "gap",
      evidence: [{ file: "src/booking.js", line: 2 }],
      note: "The slot is not freed.",
      title: "A cancelled booking keeps the slot",
      plain: "The slot stays taken.",
      costIfIgnored: "Lost bookings.",
      fixPrompt: "Free the slot on cancel.",
    };
    origin.put("src/booking.js", "export function cancel(id) {\n  return keep(id);\n}\n");
    origin.commit("break cancel");
    await recheck(deps, project.id, "push");
    expect(record.getChange(c.id).stage).toBe("release");

    // Even if the change were still waiting at acceptance, accepting it does not reach operate.
    record.setStage(c.id, "acceptance");
    record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "owner" } });
    models.calls.length = 0;
    expect(await advance(deps, c.id)).toEqual({ stage: "release", held: ["qa"], stoppedForBudget: false });
    expect(models.calls).toHaveLength(0);
    expect(record.gates(c.id).po).toBeUndefined();
  });

  it("an unreachable baseline makes compliance and architect review all files before the baseline moves", async () => {
    const { record, models, deps, change, project, origin } = setup();
    await advance(deps, change("understand").id);
    record.setCheckedCommit(project.id, "0123456789abcdef0123456789abcdef01234567");
    models.calls.length = 0;
    await recheck(deps, project.id, "push");
    for (const name of ["compliance.reviewCompliance", "architect.reviewOperations"]) {
      const call = models.calls.find((x) => x.name === name);
      expect(call?.user).toContain("Files (3):");
      expect(call?.user).toContain("=== src/app.js ===");
    }
    expect(record.checkedCommit(project.id)).toBe(git(origin.dir, "rev-parse", "HEAD"));
  });

  it("an acceptance given before the change stepped back to release does not count afterwards", async () => {
    const { record, models, deps, change, project, origin } = setup();
    const c = change("understand");
    expect((await advance(deps, c.id)).stage).toBe("acceptance");
    record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "owner" } });
    models.qa["CRIT-CANCEL"] = {
      state: "gap",
      evidence: [{ file: "src/booking.js", line: 2 }],
      note: "The slot is not freed.",
      title: "A cancelled booking keeps the slot",
      plain: "The slot stays taken.",
      costIfIgnored: "Lost bookings.",
      fixPrompt: "Free the slot on cancel.",
    };
    origin.put("src/booking.js", "export function cancel(id) {\n  return keep(id);\n}\n");
    origin.commit("break cancel");
    await recheck(deps, project.id, "push");
    expect(record.getChange(c.id).stage).toBe("release");
    const voids = record.listArtifacts(c.id).filter((a) => a.kind === "acceptance_void");
    expect(voids).toHaveLength(1);
    expect(voids[0]).toMatchObject({ role: "po" });
    expect((voids[0]!.body as { reason: string }).reason).toBeTruthy();

    delete models.qa["CRIT-CANCEL"];
    await recheck(deps, project.id, "manual");
    expect(record.getChange(c.id).stage).toBe("acceptance");
    expect(await advance(deps, c.id)).toEqual({ stage: "acceptance", held: [], stoppedForBudget: false });
    expect(models.names()).not.toContain("po.acceptanceSummary");

    record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "owner" } });
    expect((await advance(deps, c.id)).stage).toBe("operate");
  });

  it("a budget stop inside recheck stores stopped_budget and leaves the checked commit alone", async () => {
    const { record, models, deps, change, project, origin, runs } = setup();
    const c = change("understand");
    await advance(deps, c.id);
    origin.put("src/privacy.js", "export const consent = true;\n");
    origin.commit("ask consent");
    models.state.failOn = models.calls.length + 1; // the recheck compliance call
    expect(await recheck(deps, project.id, "push")).toMatchObject({ stoppedForBudget: true });
    expect(runs(c.id).at(-1)).toMatchObject({ role: "compliance", status: "stopped_budget" });
    expect(record.checkedCommit(project.id)).toBeNull();
  });

  it("recheck re-verifies criteria linked affects from a new change and no others", async () => {
    const { record, models, deps, change, project, crit } = setup();
    const c = change("understand");
    await advance(deps, c.id);
    const f = change("feature", "Take a deposit");
    record.link({ type: "change", id: f.id }, "affects", { type: "criterion", id: crit("CRIT-BOOK").id });
    models.calls.length = 0;
    const res = await recheck(deps, project.id, "manual");
    expect(models.criteriaVerified()).toEqual(["CRIT-BOOK"]);
    expect(models.names()).toEqual(["qa.verifyCriteria"]);
    expect(res.runIds).toHaveLength(1);
    expect(record.getChange(f.id).stage).toBe("intake");
  });

  it("budget exhaustion mid-run stores stopped_budget and returns stoppedForBudget", async () => {
    const { models, deps, change, runs } = setup();
    const c = change("understand");
    models.state.failOn = 4; // the architect call
    expect(await advance(deps, c.id)).toEqual({ stage: "design_review", held: [], stoppedForBudget: true });
    expect(runs(c.id).map((x) => [x.role, x.status])).toEqual([
      ["ba", "done"],
      ["ba", "done"],
      ["compliance", "done"],
      ["architect", "stopped_budget"],
    ]);

    // Budget restored: the finished compliance review is not paid for twice.
    models.state.failOn = undefined;
    models.calls.length = 0;
    expect((await advance(deps, c.id)).stage).toBe("acceptance");
    expect(models.names()).toEqual(["architect.reviewOperations", "qa.verifyCriteria", "qa.verifyCriteria"]);
  });

  it("a recheck review charged to a new change does not stand in for its full design review", async () => {
    const { models, deps, change, project, origin } = setup();
    await advance(deps, change("understand").id);
    const f = change("feature", "Take a deposit");
    origin.put("src/privacy.js", "export const consent = true;\n");
    origin.commit("ask consent");
    await recheck(deps, project.id, "push");
    expect(models.names().filter((n) => n === "compliance.reviewCompliance")).toHaveLength(2);

    models.calls.length = 0;
    expect((await advance(deps, f.id)).stage).toBe("build");
    const comp = models.calls.find((x) => x.name === "compliance.reviewCompliance");
    expect(comp?.user).toContain("=== src/app.js ===");
    expect(models.names()).toContain("architect.reviewOperations");
  });

  it("a budget stop during QA keeps the checks already made", async () => {
    const { record, models, deps, change, runs, crit } = setup();
    const c = change("understand");
    models.state.failOn = 6; // the second QA call
    expect(await advance(deps, c.id)).toEqual({ stage: "verification", held: [], stoppedForBudget: true });
    expect(runs(c.id).at(-1)).toMatchObject({ role: "qa", status: "stopped_budget" });
    const checked = [crit("CRIT-BOOK"), crit("CRIT-CANCEL")].filter((k) => record.latestCheck(k.id));
    expect(checked).toHaveLength(1);
  });

  it("automated status changes use SYSTEM_ACTOR, and a fix found on re-check is credited to qa", async () => {
    const { record, models, deps, change, project, crit } = setup();
    models.qa["CRIT-CANCEL"] = {
      state: "gap",
      evidence: [{ file: "src/booking.js", line: 2 }],
      note: "The slot is not freed.",
      title: "A cancelled booking keeps the slot",
      plain: "The slot stays taken.",
      costIfIgnored: "Lost bookings.",
      fixPrompt: "Free the slot on cancel.",
    };
    const c = change("understand");
    expect(await advance(deps, c.id)).toEqual({ stage: "release", held: ["qa"], stoppedForBudget: false });
    const [gap] = record.listFindings({ changeId: c.id });
    expect(gap?.criterionId).toBe(crit("CRIT-CANCEL").id);

    delete models.qa["CRIT-CANCEL"];
    models.calls.length = 0;
    await recheck(deps, project.id, "mcp");
    expect(models.criteriaVerified()).toEqual(["CRIT-CANCEL"]);
    expect(record.findingHistory(gap!.id).map((h) => [h.status, h.actor, h.reason])).toEqual([
      ["open", SYSTEM_ACTOR, "Raised"],
      ["fixed", "qa", "Evidence found on re-check"],
    ]);
    expect(record.getChange(c.id).stage).toBe("acceptance");
  });

  it("a reported fix keeps the finding open until a re-check does not raise it again", async () => {
    const { record, models, deps, change, project, origin } = setup();
    const codeFinding = { ...legalFinding, triggerType: "code", file: "src/privacy.js", line: 1, quote: null };
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [codeFinding] });
    const c = change("understand");
    await advance(deps, c.id);
    expect((await advance(deps, c.id)).held).toEqual(["compliance"]);
    const [finding] = record.listFindings({ changeId: c.id });
    record.addArtifact({ changeId: c.id, role: "compliance", stage: "release", kind: "fix_report", body: { findingId: finding!.id, summary: "Asked consent" } });
    expect(record.pendingFixReport(finding!.id)?.summary).toBe("Asked consent");
    expect(record.findingStatus(finding!.id)).toBe("open");

    // Raised again: the report no longer stands and the finding stays open.
    origin.put("src/privacy.js", "export const consent = 'maybe';\n");
    origin.commit("half fix");
    await recheck(deps, project.id, "push");
    expect(record.findingStatus(finding!.id)).toBe("open");
    expect(record.pendingFixReport(finding!.id)).toBeNull();

    record.addArtifact({ changeId: c.id, role: "compliance", stage: "release", kind: "fix_report", body: { findingId: finding!.id, summary: "Asked consent properly" } });
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [] });
    origin.put("src/privacy.js", "export const consent = true;\n");
    origin.commit("ask consent");
    await recheck(deps, project.id, "push");
    expect(record.findingStatus(finding!.id)).toBe("fixed");
    expect(record.findingHistory(finding!.id).at(-1)).toMatchObject({ actor: "compliance" });
    expect(record.getChange(c.id).stage).toBe("acceptance");
  });

  it("a reported fix on a finding with no code location waits for a person", async () => {
    const { record, models, deps, change, project, origin } = setup();
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [legalFinding] });
    const c = change("understand");
    await advance(deps, c.id);
    await advance(deps, c.id);
    const [finding] = record.listFindings({ changeId: c.id });
    record.addArtifact({ changeId: c.id, role: "compliance", stage: "release", kind: "fix_report", body: { findingId: finding!.id, summary: "Asked consent" } });
    models.handlers["compliance.reviewCompliance"] = () => ({ findings: [] });
    origin.put("src/privacy.js", "export const consent = true;\n");
    origin.commit("ask consent");
    await recheck(deps, project.id, "push");
    expect(record.findingStatus(finding!.id)).toBe("open");
    expect(record.pendingFixReport(finding!.id)?.summary).toBe("Asked consent");
  });

  it("questions asked after the answers are open again and hold the BA gate", async () => {
    const { record, deps, change } = setup();
    const c = change("feature", "Deposits");
    record.addArtifact({ changeId: c.id, role: "ba", stage: "intake", kind: "questions", body: { questions: ["How much?"] } });
    record.addArtifact({ changeId: c.id, role: "ba", stage: "analysis", kind: "answers", body: { answers: ["Ten percent"] } });
    expect(openQuestions(record, c.id)).toEqual([]);
    record.addArtifact({ changeId: c.id, role: "ba", stage: "analysis", kind: "questions", body: { questions: ["Refundable?"] } });
    expect(openQuestions(record, c.id)).toEqual(["Refundable?"]);
    record.setStage(c.id, "analysis");
    expect((await advance(deps, c.id)).held).toEqual(["ba"]);
  });

  it("a withdrawn change never moves and a recheck leaves it alone", async () => {
    const { record, models, deps, change, project } = setup();
    const c = change("feature", "Deposits");
    record.addArtifact({ changeId: c.id, role: "po", stage: "intake", kind: "withdrawn", body: { reason: "Dropped", actor: "Ada" } });
    expect(withdrawal(record, c.id)).toEqual({ reason: "Dropped", actor: "Ada" });
    expect(await advance(deps, c.id)).toEqual({ stage: "intake", held: [], stoppedForBudget: false });
    expect(await recheck(deps, project.id, "manual")).toEqual({ runIds: [], stoppedForBudget: false });
    expect(models.calls).toHaveLength(0);
  });

  it("a fix change carries findings raised after delivery and holds until they are settled", async () => {
    const { record, deps, change } = setup();
    const c = change("understand");
    for (let i = 0; i < 8 && record.getChange(c.id).stage !== "acceptance"; i++) await advance(deps, c.id);
    record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "Ada" } });
    await advance(deps, c.id);
    expect(record.getChange(c.id).stage).toBe("operate");
    expect(() => openFixChange(record, c.id)).toThrow(/no open findings/);

    const run = record.startRun({ changeId: c.id, role: "compliance", commit: "abc" });
    const { finding } = record.addFinding({
      projectId: c.projectId, changeId: c.id, runId: run, role: "compliance", stage: "operate", kind: "legal",
      title: legalFinding.title, plain: legalFinding.plain, costIfIgnored: legalFinding.costIfIgnored,
      fixPrompt: legalFinding.fixPrompt, trigger: { type: "doc", quote: QUOTE }, citationId: "ndpa-consent",
    });
    const fix = openFixChange(record, c.id);
    expect(fix.kind).toBe("fix");
    expect(record.listFindings({ changeId: fix.id }).map((f) => f.id)).toEqual([finding.id]);
    expect(record.listArtifacts(fix.id).find((a) => a.kind === "follows")?.body).toEqual({ changeId: c.id });
    expect(record.listArtifacts(c.id).find((a) => a.kind === "fix_change")?.body).toEqual({ changeId: fix.id });

    record.setStage(fix.id, "release");
    expect((await advance(deps, fix.id)).held).toContain("compliance");
  });

  it("QA tries a criterion the code did not show in the running app, and what it sees is the latest check", async () => {
    const { record, models, deps, origin } = setup();
    const project = record.createProject({ name: "Live", repoUrl: origin.dir, appUrl: "http://localhost:3000" });
    models.qa["CRIT-BOOK"] = { state: "no_evidence", evidence: [], note: "Unclear from code.", title: null, plain: null, costIfIgnored: null, fixPrompt: null };
    models.handlers["qa.exploreStep"] = () => ({ kind: "done", role: null, name: null, value: null, reason: "Seen enough." });
    models.handlers["qa.judgeFlow"] = () => ({ state: "evidence_found", note: "The booking is confirmed.", title: null, plain: null, costIfIgnored: null, fixPrompt: null });
    const page = {
      goto: async () => {},
      snapshot: async () => '- button "Book"',
      act: async () => {},
      screenshot: async () => new Uint8Array([1]),
      url: () => "http://localhost:3000/",
      close: async () => {},
    };
    const live = { ...deps, openPage: async () => page };
    const c = record.createChange({ projectId: project.id, title: "Understand the app", description: DESCRIPTION, kind: "understand" });
    await advance(live, c.id);
    const latest = (marker: string) => record.latestCheck(record.listCriteria(project.id).find((k) => k.text.startsWith(marker))!.id);
    expect(latest("CRIT-BOOK")).toMatchObject({ state: "evidence_found", evidence: [{ type: "screen", url: "http://localhost:3000/" }] });
    expect(latest("CRIT-CANCEL")?.evidence[0]).toMatchObject({ type: "code" });
    expect(models.names().filter((n) => n === "qa.exploreStep")).toHaveLength(1);
  });

  it("acceptance waits without the artifact and clears with it; costs reach the record only through the ledger", async () => {
    const { record, models, deps, change } = setup();
    const c = change("understand");
    expect(await advance(deps, c.id)).toEqual({ stage: "acceptance", held: [], stoppedForBudget: false });
    expect(await advance(deps, c.id)).toEqual({ stage: "acceptance", held: [], stoppedForBudget: false });
    expect(models.names()).not.toContain("po.acceptanceSummary");

    record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "owner" } });
    expect(await advance(deps, c.id)).toEqual({ stage: "operate", held: [], stoppedForBudget: false });
    expect(record.gates(c.id).po?.state).toBe("cleared");
    expect(record.acceptanceRecord(c.id).summary).toBe("All agreed work has evidence found.");
    expect(await advance(deps, c.id)).toEqual({ stage: "operate", held: [], stoppedForBudget: false });
    expect(models.names().filter((n) => n === "po.acceptanceSummary")).toHaveLength(1);

    expect(record.spentUsd()).toBeCloseTo(0.01 * models.calls.length, 10);
  });
});
