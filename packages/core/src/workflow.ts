import { ledgerFor, type CopilotRecord } from "./record/record.js";
import { changedFiles, syncRepo } from "./repo/repo.js";
import { architectGate, reviewOperations } from "./roles/architect.js";
import { analyseChange, analyseImpact, baGate, understandApp } from "./roles/ba.js";
import { complianceGate, reviewCompliance } from "./roles/compliance.js";
import type { RoleContext, RoleResult } from "./roles/context.js";
import { acceptanceSummary, poGate } from "./roles/po.js";
import { qaGate, verifyCriteria } from "./roles/qa.js";
import {
  BudgetExceededError,
  type Change,
  type Check,
  type Criterion,
  type FindingKind,
  type GateState,
  type ModelFactory,
  type Packs,
  type Project,
  type RoleId,
  type StageId,
} from "./types.js";

/** Spec section 5 order. */
export const STAGES: StageId[] = ["intake", "analysis", "design_review", "build", "verification", "release", "acceptance", "operate"];

export interface WorkflowDeps {
  record: CopilotRecord;
  modelFor: ModelFactory;
  packs: Packs;
  cacheDir: string;
  githubToken?: string;
  /** Local paths and file:// repos. Tests and local demo use only. */
  allowLocalRepos?: boolean;
}

type Repo = { dir: string; commit: string };

/** One advance or recheck call: the repo is synced at most once, and every run started is collected. */
interface Session {
  deps: WorkflowDeps;
  project: Project;
  repo: () => Promise<Repo>;
  runIds: string[];
}

function session(deps: WorkflowDeps, projectId: string): Session {
  const project = deps.record.getProject(projectId);
  let repo: Promise<Repo> | undefined;
  return {
    deps,
    project,
    runIds: [],
    repo: () => (repo ??= syncRepo(project.repoUrl, deps.cacheDir, deps.githubToken, { allowLocal: deps.allowLocalRepos === true })),
  };
}

/** A stage either lets the change move on, or stops it here (with the roles whose gates are held). */
type Outcome = { next: true } | { next: false; held: RoleId[] };
const NEXT: Outcome = { next: true };
const stay = (held: RoleId[] = []): Outcome => ({ next: false, held });

const latestBody = <T>(record: CopilotRecord, changeId: string, kind: string): T | undefined =>
  record.listArtifacts(changeId).filter((a) => a.kind === kind).at(-1)?.body as T | undefined;

/** The latest questions, unless answers were saved after them. A later round of questions is open again. */
export function openQuestions(record: CopilotRecord, changeId: string): string[] {
  const last = record.listArtifacts(changeId).filter((a) => a.kind === "questions" || a.kind === "answers").at(-1);
  return last?.kind === "questions" ? ((last.body as { questions?: string[] }).questions ?? []) : [];
}

/** Why and by whom a change was withdrawn, or null. A withdrawn change never moves again. */
export const withdrawal = (record: CopilotRecord, changeId: string) =>
  latestBody<{ reason: string; actor: string }>(record, changeId, "withdrawn") ?? null;

/** Records the gate only when it differs from the current one. True when cleared. */
function gate(record: CopilotRecord, changeId: string, role: RoleId, g: { state: GateState; reason: string }): boolean {
  const cur = record.gates(changeId)[role];
  if (cur?.state !== g.state || cur.reason !== g.reason) record.recordGate(changeId, role, g.state, g.reason);
  return g.state === "cleared";
}

const openOn = (record: CopilotRecord, changeId: string, kind: FindingKind) =>
  record.listFindings({ changeId, status: "open" }).filter((f) => f.kind === kind).length;

/** Legal findings hold until fixed or accepted with a reason; deferring one does not clear the compliance gate. */
const legalUnresolved = (record: CopilotRecord, changeId: string) =>
  record.listFindings({ changeId }).filter((f) => f.kind === "legal" && (f.status === "open" || f.status === "deferred")).length;

/** Ids of the changes linked `affects` to this criterion. */
const affectedBy = (record: CopilotRecord, criterionId: string) =>
  record
    .linksTo({ type: "criterion", id: criterionId })
    .filter((l) => l.rel === "affects" && l.from.type === "change")
    .map((l) => l.from.id);

/** The change's own criteria plus those it affects. */
export const criteriaOf = (record: CopilotRecord, change: Change): Criterion[] =>
  record.listCriteria(change.projectId).filter((k) => k.changeId === change.id || affectedBy(record, k.id).includes(change.id));

const latestChecks = (record: CopilotRecord, criteria: Criterion[]): Check[] =>
  criteria.map((k) => record.latestCheck(k.id)).filter((c): c is Check => c !== null);

/** understand: the as_built it produced. feature, fix or projectWide: the newest as_built in the project. None: {}. */
function asBuiltFor(record: CopilotRecord, change: Change, projectWide = change.kind !== "understand"): unknown {
  const pool = projectWide ? record.listChanges(change.projectId) : [change];
  const all = pool.flatMap((c) => record.listArtifacts(c.id)).filter((a) => a.kind === "as_built");
  all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return all.at(-1)?.body ?? {};
}

/**
 * One run per role call. Costs reach the run only through the ledger the model is built with. A budget stop
 * marks the run stopped_budget, any other error failed; both rethrow.
 */
async function runRole(s: Session, change: Change, role: RoleId, work: (ctx: RoleContext) => Promise<void>): Promise<void> {
  const { record } = s.deps;
  const repo = await s.repo();
  const runId = record.startRun({ changeId: change.id, role, commit: repo.commit });
  s.runIds.push(runId);
  try {
    await work({
      record,
      model: s.deps.modelFor(ledgerFor(record, runId)),
      packs: s.deps.packs,
      project: s.project,
      change,
      repo,
      runId,
      existingFindings: record
        .listFindings({ projectId: s.project.id })
        .filter((f) => f.role === role)
        .map((f) => ({ id: f.id, title: f.title, kind: f.kind })),
      answers: latestBody<{ answers?: string[] }>(record, change.id, "answers")?.answers ?? [],
    });
  } catch (e) {
    record.finishRun(runId, e instanceof BudgetExceededError ? "stopped_budget" : "failed");
    throw e;
  }
  record.finishRun(runId, "done");
}

/** Writes a role result against the run's change. addFinding writes the raised_on link itself. */
function save(ctx: RoleContext, role: RoleId, stage: StageId, r: RoleResult): void {
  const { record, change } = ctx;
  const from = { type: "change", id: change.id };
  for (const a of r.artifacts) record.addArtifact({ changeId: change.id, role, stage, kind: a.kind, body: a.body });
  if (r.questions.length) record.addArtifact({ changeId: change.id, role, stage, kind: "questions", body: { questions: r.questions } });
  for (const c of r.criteria) {
    const k = record.addCriterion({ projectId: change.projectId, changeId: change.id, text: c.text, isFailurePath: c.isFailurePath });
    record.link(from, "satisfies", { type: "criterion", id: k.id });
  }
  for (const id of r.affectedCriterionIds) record.link(from, "affects", { type: "criterion", id });
  for (const f of r.findings) record.addFinding({ projectId: change.projectId, changeId: change.id, runId: ctx.runId, role, stage, ...f });
}

/** One QA run. Checks made before a budget stop are kept; evidence found closes that criterion's open findings. */
async function verify(s: Session, change: Change, stage: StageId, criteria: Criterion[]): Promise<void> {
  const { record } = s.deps;
  await runRole(s, change, "qa", async (ctx) => {
    const r = await verifyCriteria(ctx, criteria);
    for (const c of r.checks) record.recordCheck(c);
    save(ctx, "qa", stage, { artifacts: [], criteria: [], findings: r.findings, questions: [], affectedCriterionIds: [] });
    const found = new Set(r.checks.filter((c) => c.state === "evidence_found").map((c) => c.criterionId));
    for (const f of record.listFindings({ projectId: change.projectId, status: "open" })) {
      if (f.criterionId && found.has(f.criterionId)) record.setFindingStatus(f.id, "fixed", "Evidence found on re-check", "qa");
    }
    if (r.stopped) throw new BudgetExceededError("Copilot budget used during verification");
  });
}

/**
 * The release gates, recomputed and recorded with no model call: open findings raised on this change and the
 * latest checks of its criteria. Returns the roles that hold.
 */
function releaseHeld(record: CopilotRecord, c: Change): RoleId[] {
  const gates: Array<[RoleId, { state: GateState; reason: string }]> = [
    ["compliance", complianceGate(legalUnresolved(record, c.id))],
    ["architect", architectGate(openOn(record, c.id, "operations"))],
    ["qa", qaGate(latestChecks(record, criteriaOf(record, c)))],
  ];
  return gates.filter(([role, g]) => !gate(record, c.id, role, g)).map(([role]) => role);
}

/** Accepted: the latest `acceptance` or `acceptance_void` artifact is an `acceptance` (POST /accept writes it). */
export const accepted = (record: CopilotRecord, changeId: string) =>
  record
    .listArtifacts(changeId)
    .filter((a) => a.kind === "acceptance" || a.kind === "acceptance_void")
    .at(-1)?.kind === "acceptance";

/** What advance does at each stage. */
const DISPATCH: Record<StageId, (s: Session, c: Change) => Promise<Outcome>> = {
  intake: async (s, c) => {
    const { record } = s.deps;
    await runRole(s, c, "ba", async (ctx) =>
      save(ctx, "ba", "intake", c.kind === "understand" ? await understandApp(ctx) : await analyseImpact(ctx, record.listCriteria(c.projectId))),
    );
    return NEXT;
  },

  // The BA gate is checked first; analyseChange runs only once it clears.
  analysis: async (s, c) => {
    const { record } = s.deps;
    const questions = latestBody<{ questions?: string[] }>(record, c.id, "questions")?.questions ?? [];
    // Answers count only when saved after the latest questions.
    const answers = openQuestions(record, c.id).length ? [] : (latestBody<{ answers?: string[] }>(record, c.id, "answers")?.answers ?? []);
    if (!gate(record, c.id, "ba", baGate(questions, answers))) return stay(["ba"]);
    await runRole(s, c, "ba", async (ctx) => save(ctx, "ba", "analysis", await analyseChange(ctx)));
    return NEXT;
  },

  // Gates are recorded here but do not block; release is where they hold. A role's gate is recorded right after
  // its review, so a stage resumed after a budget stop does not pay for a finished review twice. (A run charged
  // to this change by recheck records no gate, so it never stands in for the full review.)
  design_review: async (s, c) => {
    const { record } = s.deps;
    const asBuilt = asBuiltFor(record, c);
    if (!record.gates(c.id).compliance) {
      await runRole(s, c, "compliance", async (ctx) => save(ctx, "compliance", "design_review", await reviewCompliance(ctx, asBuilt)));
    }
    gate(record, c.id, "compliance", complianceGate(legalUnresolved(record, c.id)));
    if (!record.gates(c.id).architect) {
      await runRole(s, c, "architect", async (ctx) => save(ctx, "architect", "design_review", await reviewOperations(ctx, asBuilt)));
    }
    gate(record, c.id, "architect", architectGate(openOn(record, c.id, "operations")));
    return NEXT;
  },

  // The code of an understand change already exists. Otherwise the coding agent builds; recheck moves it on.
  build: async (_s, c) => (c.kind === "understand" ? NEXT : stay()),

  verification: async (s, c) => {
    const { record } = s.deps;
    const criteria = criteriaOf(record, c);
    if (criteria.length) await verify(s, c, "verification", criteria);
    gate(record, c.id, "qa", qaGate(latestChecks(record, criteria)));
    return NEXT;
  },

  release: async (s, c) => {
    const held = releaseHeld(s.deps.record, c);
    return held.length ? stay(held) : NEXT;
  },

  // Release gates are recomputed first: a recheck may have found a gap since release. If one holds, the change
  // goes back to release and any acceptance already given is voided, so the owner accepts again later.
  acceptance: async (s, c) => {
    const { record } = s.deps;
    const held = releaseHeld(record, c);
    if (held.length) {
      record.setStage(c.id, "release");
      if (accepted(record, c.id)) {
        const reason = `Held again by ${held.join(", ")} after acceptance. Accept again once cleared.`;
        record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance_void", body: { reason } });
      }
      return stay(held);
    }
    if (!accepted(record, c.id)) return stay();
    if (!gate(record, c.id, "po", poGate(record.gates(c.id), true))) return stay(["po"]);
    await runRole(s, c, "po", async (ctx) => {
      const summary = await acceptanceSummary(record.acceptanceRecord(c.id), ctx.model, s.deps.packs.role.po);
      record.addArtifact({ changeId: c.id, role: "po", stage: "acceptance", kind: "acceptance_summary", body: { summary } });
    });
    return NEXT;
  },

  operate: async () => stay(),
};

async function advanceIn(s: Session, changeId: string): Promise<{ stage: StageId; held: RoleId[]; stoppedForBudget: boolean }> {
  const { record } = s.deps;
  for (;;) {
    const change = record.getChange(changeId);
    let out: Outcome;
    try {
      out = await DISPATCH[change.stage](s, change);
    } catch (e) {
      if (e instanceof BudgetExceededError) return { stage: change.stage, held: [], stoppedForBudget: true };
      throw e;
    }
    // Re-read: acceptance can step a change back to release.
    if (!out.next) return { stage: record.getChange(changeId).stage, held: out.held, stoppedForBudget: false };
    record.setStage(change.id, STAGES[STAGES.indexOf(change.stage) + 1]!);
  }
}

/**
 * Runs the change through its stages until a gate holds, it waits (build, acceptance), the budget stops it,
 * or it reaches operate. Safe to call again: finished stages are not re-run.
 */
export async function advance(
  deps: WorkflowDeps,
  changeId: string,
): Promise<{ stage: StageId; held: RoleId[]; stoppedForBudget: boolean }> {
  const change = deps.record.getChange(changeId);
  if (withdrawal(deps.record, changeId)) return { stage: change.stage, held: [], stoppedForBudget: false };
  return advanceIn(session(deps, change.projectId), changeId);
}

/**
 * Findings raised after delivery land on a change that is already done. This opens a fix change that carries
 * them through the stages again: the findings and their criteria are linked to it, and each change names the
 * other, so the record reads both ways.
 */
export function openFixChange(record: CopilotRecord, changeId: string): Change {
  const c = record.getChange(changeId);
  if (c.stage !== "operate") throw new Error("Only a delivered change opens a fix change");
  const open = record.listFindings({ changeId, status: "open" });
  if (!open.length) throw new Error("This change has no open findings to carry");
  const fix = record.createChange({
    projectId: c.projectId,
    title: `Fix after delivery: ${c.title}`.slice(0, 200),
    description: [`Findings raised after "${c.title}" was delivered:`, ...open.map((f) => `- ${f.title}: ${f.plain}`)].join("\n"),
    kind: "fix",
  });
  for (const f of open) {
    record.link({ type: "finding", id: f.id }, "raised_on", { type: "change", id: fix.id });
    if (f.criterionId) record.link({ type: "change", id: fix.id }, "affects", { type: "criterion", id: f.criterionId });
  }
  record.addArtifact({ changeId: c.id, role: "po", stage: "operate", kind: "fix_change", body: { changeId: fix.id } });
  record.addArtifact({ changeId: fix.id, role: "po", stage: "intake", kind: "follows", body: { changeId: c.id } });
  return fix;
}

/**
 * A reported fix is confirmed when the reviewer who raised the finding looked again and did not raise it. A code
 * finding also needs its file among the reviewed ones. Findings tied to a criterion are left to QA's evidence.
 */
function confirmReportedFixes(record: CopilotRecord, projectId: string, commit: string, reviewed: string[] | undefined): void {
  for (const f of record.listFindings({ projectId, status: "open" })) {
    if (f.criterionId || (f.role !== "compliance" && f.role !== "architect")) continue;
    if (reviewed && f.trigger.type === "code" && !reviewed.includes(f.trigger.file)) continue;
    const report = record.pendingFixReport(f.id);
    if (report) record.setFindingStatus(f.id, "fixed", `Not raised again on re-check at ${commit.slice(0, 7)}. Reported fix: ${report.summary}`, f.role);
  }
}

/**
 * The operate duty. Diffs from the commit the last completed recheck covered (before the first one: the
 * earliest done QA run, so a later advance-time QA run cannot hide a diff), then: compliance and architect on
 * the changed files, or all files when the diff is unknown (charged to the newest change), QA on criteria whose evidence touched a changed or deleted
 * file, whose latest check is not evidence_found, or that an open change affects (with no baseline: every
 * criterion of open changes). Changes at build move to verification; changes at build, release or acceptance
 * are advanced. A push with no new commit does nothing.
 */
export async function recheck(
  deps: WorkflowDeps,
  projectId: string,
  reason: "push" | "mcp" | "manual",
): Promise<{ runIds: string[]; stoppedForBudget: boolean }> {
  const { record } = deps;
  const s = session(deps, projectId);
  // Withdrawn changes are left alone: nothing is charged to them and they never move again.
  const changes = record.listChanges(projectId).filter((c) => !withdrawal(record, c.id));
  const newest = changes.at(-1);
  if (!newest) return { runIds: [], stoppedForBudget: false };
  const repo = await s.repo();
  const base = record.checkedCommit(projectId) ?? record.firstRunCommit(projectId, "qa");
  if (reason === "push" && base === repo.commit) return { runIds: [], stoppedForBudget: false };
  // null: no usable baseline (none yet, or its commit is gone after a force push).
  const diff = !base
    ? null
    : base === repo.commit
      ? { changed: [], deleted: [] }
      : await changedFiles(repo.dir, base, repo.commit).catch((e: unknown) => {
          console.warn(`recheck: diff from ${base} failed, re-verifying open changes: ${String(e)}`);
          return null;
        });

  const open = new Set(changes.filter((c) => c.stage !== "operate").map((c) => c.id));
  const atBuild = changes.filter((c) => c.stage === "build");
  const coveredByBuild = new Set(atBuild.flatMap((c) => criteriaOf(record, c).map((k) => k.id)));
  const touched = new Set([...(diff?.changed ?? []), ...(diff?.deleted ?? [])]);
  const toVerify = record.listCriteria(projectId).filter((k) => {
    if (coveredByBuild.has(k.id)) return false;
    const last = record.latestCheck(k.id);
    return (
      (!diff && open.has(k.changeId)) ||
      (last !== null && last.state !== "evidence_found") ||
      (last?.evidence.some((t) => t.type === "code" && touched.has(t.file)) ?? false) ||
      affectedBy(record, k.id).some((id) => open.has(id))
    );
  });

  try {
    // Unknown diff (no baseline, or it is unreachable): review all files, so moving the baseline never skips code.
    if (!diff || diff.changed.length) {
      const asBuilt = asBuiltFor(record, newest, true);
      const only = diff?.changed;
      await runRole(s, newest, "compliance", async (ctx) => save(ctx, "compliance", "operate", await reviewCompliance(ctx, asBuilt, only)));
      await runRole(s, newest, "architect", async (ctx) => save(ctx, "architect", "operate", await reviewOperations(ctx, asBuilt, only)));
      confirmReportedFixes(record, projectId, repo.commit, only);
    }
    if (toVerify.length) await verify(s, newest, "operate", toVerify);
    for (const c of changes) {
      if (c.stage === "build") record.setStage(c.id, "verification");
      if (c.stage === "build" || c.stage === "release" || c.stage === "acceptance") {
        if ((await advanceIn(s, c.id)).stoppedForBudget) return { runIds: s.runIds, stoppedForBudget: true };
      }
    }
  } catch (e) {
    if (e instanceof BudgetExceededError) return { runIds: s.runIds, stoppedForBudget: true };
    throw e;
  }
  // Only a recheck that covered the whole diff moves the baseline.
  record.setCheckedCommit(projectId, repo.commit);
  return { runIds: s.runIds, stoppedForBudget: false };
}
