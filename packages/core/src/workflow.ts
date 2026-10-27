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

/** Records the gate only when it differs from the current one. True when cleared. */
function gate(record: CopilotRecord, changeId: string, role: RoleId, g: { state: GateState; reason: string }): boolean {
  const cur = record.gates(changeId)[role];
  if (cur?.state !== g.state || cur.reason !== g.reason) record.recordGate(changeId, role, g.state, g.reason);
  return g.state === "cleared";
}

const openOn = (record: CopilotRecord, changeId: string, kind: FindingKind) =>
  record.listFindings({ changeId, status: "open" }).filter((f) => f.kind === kind).length;

/** Ids of the changes linked `affects` to this criterion. */
const affectedBy = (record: CopilotRecord, criterionId: string) =>
  record
    .linksTo({ type: "criterion", id: criterionId })
    .filter((l) => l.rel === "affects" && l.from.type === "change")
    .map((l) => l.from.id);

/** The change's own criteria plus those it affects. */
const criteriaOf = (record: CopilotRecord, change: Change): Criterion[] =>
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
    ["compliance", complianceGate(openOn(record, c.id, "legal"))],
    ["architect", architectGate(openOn(record, c.id, "operations"))],
    ["qa", qaGate(latestChecks(record, criteriaOf(record, c)))],
  ];
  return gates.filter(([role, g]) => !gate(record, c.id, role, g)).map(([role]) => role);
}

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
    const answers = latestBody<{ answers?: string[] }>(record, c.id, "answers")?.answers ?? [];
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
    gate(record, c.id, "compliance", complianceGate(openOn(record, c.id, "legal")));
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
  // goes back to release. Accepted means an `acceptance` artifact exists (POST /accept writes it).
  acceptance: async (s, c) => {
    const { record } = s.deps;
    const held = releaseHeld(record, c);
    if (held.length) {
      record.setStage(c.id, "release");
      return stay(held);
    }
    if (!record.listArtifacts(c.id).some((a) => a.kind === "acceptance")) return stay();
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
  return advanceIn(session(deps, deps.record.getChange(changeId).projectId), changeId);
}

/**
 * The operate duty. Diffs from the commit the last completed recheck covered (before the first one: the
 * earliest done QA run, so a later advance-time QA run cannot hide a diff), then: compliance and architect on
 * the changed files (charged to the newest change), QA on criteria whose evidence touched a changed or deleted
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
  const changes = record.listChanges(projectId);
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
    if (diff?.changed.length) {
      const asBuilt = asBuiltFor(record, newest, true);
      await runRole(s, newest, "compliance", async (ctx) => save(ctx, "compliance", "operate", await reviewCompliance(ctx, asBuilt, diff.changed)));
      await runRole(s, newest, "architect", async (ctx) => save(ctx, "architect", "operate", await reviewOperations(ctx, asBuilt, diff.changed)));
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
