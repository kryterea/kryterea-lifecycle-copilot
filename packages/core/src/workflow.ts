import { discoverDocuments } from "./docs/discover.js";
import { findingFingerprint, ledgerFor, type CopilotRecord } from "./record/record.js";
import { changedFiles, diffHunks, listSourceFiles, readLines, syncRepo } from "./repo/repo.js";
import { applyDrift, driftRule } from "./drift.js";
import { where } from "./open-items.js";
import { architectGate, reviewOperations } from "./roles/architect.js";
import { analyseChange, analyseImpact, baGate, understandApp } from "./roles/ba.js";
import { reviewDocuments, undocumentedFlows } from "./roles/ba-docs.js";
import { complianceGate, reviewCompliance } from "./roles/compliance.js";
import type { RoleContext, RoleResult } from "./roles/context.js";
import { acceptanceSummary, poGate } from "./roles/po.js";
import { writeChanges, type Proposals } from "./roles/po-writer.js";
import { qaGate, verifyCriteria } from "./roles/qa.js";
import { exploreFlow, type OpenPage } from "./roles/qa-browser.js";
import {
  BudgetExceededError,
  type Change,
  type Check,
  type Criterion,
  type Finding,
  type FindingKind,
  type GateState,
  type ModelFactory,
  type Packs,
  type Project,
  type ProposalDecision,
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
  /** A browser for QA to try criteria in the project's running app (its appUrl). Without one, QA reads code only. */
  openPage?: OpenPage;
  /** Where QA's screenshots of the running app are saved. */
  screensDir?: string;
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

/** The answers on offer for each open question, null where the question was stored without any. */
export function questionOptions(record: CopilotRecord, changeId: string): Array<{ options: string[]; defaultIndex: number } | null> {
  const questions = openQuestions(record, changeId);
  const body = latestBody<{ options?: string[][]; defaults?: number[] }>(record, changeId, "questions");
  return questions.map((_, i) => {
    const options = body?.options?.[i];
    return options ? { options, defaultIndex: body?.defaults?.[i] ?? 0 } : null;
  });
}

/** The professions a check can be limited to. The product owner always runs. */
export const PICKABLE_ROLES = ["ba", "architect", "qa", "compliance"] as const satisfies readonly RoleId[];

/**
 * Opens an understand change for a check: with the owner's problem in her own words, or of the whole repo.
 * The problem is kept as an artifact so the assessment can put it first. `roles` limits which professions
 * look (kept as a `scope` artifact); absent means every profession.
 */
export function startCheck(record: CopilotRecord, i: { projectId: string; problem: string | null; roles?: RoleId[] }): Change {
  const problem = i.problem?.trim() || null;
  const c = record.createChange({
    projectId: i.projectId,
    title: problem ? `Check: ${problem}`.slice(0, 200) : "Whole repo check",
    description: problem ? `${/[.!?]$/.test(problem) ? problem : `${problem}.`} Then check the whole repo.` : "Check the whole repo.",
    kind: "understand",
  });
  if (problem) record.addArtifact({ changeId: c.id, role: "po", stage: "intake", kind: "problem", body: { text: problem } });
  if (i.roles) record.addArtifact({ changeId: c.id, role: "po", stage: "intake", kind: "scope", body: { roles: i.roles } });
  return c;
}

/** True when the change was limited to some professions and this one is not among them. */
const skipped = (record: CopilotRecord, changeId: string, role: RoleId): boolean => {
  const roles = latestBody<{ roles?: RoleId[] }>(record, changeId, "scope")?.roles;
  return role !== "po" && roles !== undefined && !roles.includes(role);
};

/** The problem the owner described when the check started, or null for a whole repo check. */
export const problemOf = (record: CopilotRecord, changeId: string): string | null =>
  latestBody<{ text?: string }>(record, changeId, "problem")?.text ?? null;

/** The product owner's latest proposed changes for this check, or null before they are written. */
export const proposalsOf = (record: CopilotRecord, changeId: string): Proposals | null =>
  latestBody<Proposals>(record, changeId, "proposed_changes") ?? null;

/** The BA gate from the latest questions. Answers count only when saved after them. */
function questionsGate(record: CopilotRecord, changeId: string): { state: GateState; reason: string } {
  const questions = latestBody<{ questions?: string[] }>(record, changeId, "questions")?.questions ?? [];
  const answers = openQuestions(record, changeId).length ? [] : (latestBody<{ answers?: string[] }>(record, changeId, "answers")?.answers ?? []);
  return baGate(questions, answers);
}

/** Why and by whom a change was withdrawn, or null. A withdrawn change never moves again. */
export const withdrawal = (record: CopilotRecord, changeId: string) =>
  latestBody<{ reason: string; actor: string }>(record, changeId, "withdrawn") ?? null;

/** Records the gate only when it differs from the current one. True when cleared. A profession left out of the scope is held. */
function gate(record: CopilotRecord, changeId: string, role: RoleId, g: { state: GateState; reason: string }): boolean {
  if (skipped(record, changeId, role)) g = { state: "held", reason: "Not checked" };
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
  if (skipped(record, change.id, role)) return;
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
      documents: record.listDocuments(s.project.id).map((d) => ({ name: d.name, body: d.latest.body })),
      requirements: record.listRequirements(s.project.id, { status: "active" }),
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
  if (r.questions.length) {
    const o = r.questionOptions;
    const body = o ? { questions: r.questions, options: o.map((x) => x.options), defaults: o.map((x) => x.defaultIndex) } : { questions: r.questions };
    record.addArtifact({ changeId: change.id, role, stage, kind: "questions", body });
  }
  const requirements = r.criteria.length ? record.listRequirements(change.projectId, { status: "active" }) : [];
  for (const c of r.criteria) {
    const k = record.addCriterion({ projectId: change.projectId, changeId: change.id, text: c.text, isFailurePath: c.isFailurePath });
    record.link(from, "satisfies", { type: "criterion", id: k.id });
    for (const req of requirements) if (c.requirementKeys?.includes(req.key)) record.linkRequirement(req.id, "criterion", k.id);
  }
  for (const id of r.affectedCriterionIds) record.link(from, "affects", { type: "criterion", id });
  for (const f of r.findings) record.addFinding({ projectId: change.projectId, changeId: change.id, runId: ctx.runId, role, stage, ...f });
}

/** Repo documents over this size are not read (pasted ones are refused at the API). */
const MAX_DOC_BYTES = 200 * 1024;

/** Versions of the project's documents the analyst has already read (from `documents_read` artifacts). */
function readVersions(record: CopilotRecord, projectId: string): Set<string> {
  const ids = record
    .listChanges(projectId)
    .flatMap((c) => record.listArtifacts(c.id))
    .filter((a) => a.kind === "documents_read")
    .flatMap((a) => ((a.body as { documents?: Array<{ versionId: string }> }).documents ?? []).map((d) => d.versionId));
  return new Set(ids);
}

/** Open document gaps by the analyst: a doc trigger that names a document. Drift findings are not gaps in a document. */
const docGapsOn = (record: CopilotRecord, changeId: string) =>
  record
    .listFindings({ changeId, status: "open" })
    .filter((f) => f.role === "ba" && f.trigger.type === "doc" && f.trigger.document !== undefined && driftRule(record, f.id) === null);

/** The analyst's gate for documents: held while any document gap raised on the change is open. */
function docGate(record: CopilotRecord, changeId: string): { state: GateState; reason: string } {
  const n = docGapsOn(record, changeId).length;
  if (n === 0) return { state: "cleared", reason: "No open document gaps." };
  return { state: "held", reason: `${n} document gap${n === 1 ? "" : "s"} to fix or accept with a reason.` };
}

/**
 * Brings the record's documents up to date: repo documents found by discoverDocuments at the synced commit, plus
 * uploaded ones. Only versions the analyst has not read go to the model. Requirements are applied per document and
 * gaps are raised on `change`. A document gap the re-read did not raise again is confirmed fixed by the analyst.
 */
async function syncDocs(s: Session, change: Change): Promise<{ changed: string[] }> {
  const { record } = s.deps;
  const repo = await s.repo();
  const projectId = s.project.id;
  const files = discoverDocuments(await listSourceFiles(repo.dir), record.docSettings(projectId));
  for (const file of files) {
    const body = readLines(repo.dir, file, 1, Number.MAX_SAFE_INTEGER);
    if (body === null || Buffer.byteLength(body) > MAX_DOC_BYTES) continue;
    record.saveDocumentVersion({ projectId, name: file, source: "repo", body, commit: repo.commit });
  }
  const repoDocs = new Set(files);
  const read = readVersions(record, projectId);
  const due = record.listDocuments(projectId).filter((d) => (d.source === "upload" || repoDocs.has(d.name)) && !read.has(d.latest.id));
  if (!due.length) return { changed: [] };

  await runRole(s, change, "ba", async (ctx) => {
    // One call reads as many documents as fit; the rest go to the next call, so none is skipped.
    let pending = due;
    while (pending.length) {
      const previous = pending.flatMap((d) => record.listRequirements(projectId).filter((r) => r.documentId === d.id));
      const out = await reviewDocuments(ctx, pending.map((d) => ({ name: d.name, body: d.latest.body })), previous, record.listCriteria(projectId));
      const batch = pending.filter((d) => out.shown.has(d.name));
      if (!batch.length) break;
      pending = pending.filter((d) => !out.shown.has(d.name));
      for (const d of batch) {
        const read = out.requirements.filter((r) => r.document === d.name);
        // A document cut at the reading limit keeps each requirement the model could not see (its quote is not in the
        // lines shown), at the line its quote is on now.
        const lines = d.latest.body.replaceAll("\r\n", "\n").split("\n");
        const shownText = lines.slice(0, out.shown.get(d.name)!).join("\n");
        const keys = new Set(read.map((r) => r.key));
        const kept =
          shownText.length < lines.join("\n").length
            ? previous
                .filter((r) => r.documentId === d.id && r.status === "active" && !keys.has(r.key) && !shownText.includes(r.quote))
                .map((r) => ({ ...r, line: lines.findIndex((l) => l.includes(r.quote)) + 1 || r.line }))
            : [];
        record.applyRequirements(d.id, d.latest.id, [...read, ...kept]);
        // Existing criteria the analyst matched. Links are only added, never removed by a later read.
        const byKey = new Map(record.listRequirements(projectId).filter((r) => r.documentId === d.id).map((r) => [r.key, r.id]));
        for (const r of read) for (const k of r.criterionIds) record.linkRequirement(byKey.get(r.key)!, "criterion", k);
      }
      const before = new Set(record.listFindings({ projectId, status: "open" }).map((f) => f.id));
      save(ctx, "ba", change.stage, { artifacts: [], criteria: [], findings: out.findings, questions: [], affectedCriterionIds: [] });
      const raised = new Set(out.findings.map((f) => findingFingerprint(projectId, "ba", f.kind, f.title)));
      // A gap the re-read did not raise again closes only when its quoted line is gone, or a new gap quotes that line.
      for (const f of record.listFindings({ projectId, status: "open" })) {
        const t = f.trigger;
        if (!before.has(f.id) || f.role !== "ba" || t.type !== "doc" || raised.has(f.fingerprint) || driftRule(record, f.id) !== null) continue;
        const doc = batch.find((d) => d.name === t.document);
        if (!doc) continue;
        const again = out.findings.find((g) => g.trigger.type === "doc" && g.trigger.document === t.document && g.trigger.quote === t.quote);
        if (again) record.setFindingStatus(f.id, "fixed", `Raised again on re-read as "${again.title}"`, "ba");
        else if (!doc.latest.body.includes(t.quote)) record.setFindingStatus(f.id, "fixed", `Not raised again on re-read at ${doc.latest.contentHash.slice(0, 7)}`, "ba");
      }
      record.addArtifact({
        changeId: change.id,
        role: "ba",
        stage: change.stage,
        kind: "documents_read",
        body: {
          documents: batch.map((d) => ({
            name: d.name,
            versionId: d.latest.id,
            hash: d.latest.contentHash,
            commit: d.latest.commit,
            requirements: out.requirements.filter((r) => r.document === d.name).length,
            gaps: out.findings.filter((f) => f.trigger.type === "doc" && f.trigger.document === d.name).length,
          })),
        },
      });
    }
  });
  return { changed: due.map((d) => d.name) };
}

/** Reads the project's changed documents and raises their gaps on `change`. See syncDocs. */
export async function syncDocuments(deps: WorkflowDeps, projectId: string, change: Change): Promise<{ changed: string[] }> {
  return syncDocs(session(deps, projectId), change);
}

/** Criteria an existing finding was matched to (QA folded its own finding into it), so evidence found closes it. */
const findingCriteria = (record: CopilotRecord, findingId: string) =>
  record
    .linksFrom({ type: "finding", id: findingId })
    .filter((l) => l.rel === "affects" && l.to.type === "criterion")
    .map((l) => l.to.id);

/**
 * QA's findings that no open finding already covers, so one issue warns once. Covered: an open finding on the
 * same criterion (QA rewords its title between checks), or an open failure path from any role citing the same
 * file within 3 lines. A covered finding is linked to the criterion instead, so evidence found later closes it.
 */
function notRaisedYet(record: CopilotRecord, projectId: string, findings: RoleResult["findings"]): RoleResult["findings"] {
  const open = record.listFindings({ projectId, status: "open" });
  return findings.filter((f) => {
    const t = f.trigger;
    // A drift finding never covers QA's finding: it closes on its own rule, which would take QA's gap with it.
    const same = open.find(
      (o) =>
        driftRule(record, o.id) === null &&
        ((f.criterionId !== undefined && o.criterionId === f.criterionId) ||
          (o.kind === "failure_path" && t.type === "code" && o.trigger.type === "code" && o.trigger.file === t.file && Math.abs(o.trigger.line - t.line) <= 3)),
    );
    if (same && f.criterionId && same.criterionId !== f.criterionId) {
      record.link({ type: "finding", id: same.id }, "affects", { type: "criterion", id: f.criterionId });
    }
    return !same;
  });
}

/** One QA run. Checks made before a budget stop are kept; evidence found closes that criterion's open findings. */
async function verify(s: Session, change: Change, stage: StageId, criteria: Criterion[]): Promise<void> {
  const { record } = s.deps;
  await runRole(s, change, "qa", async (ctx) => {
    const r = await verifyCriteria(ctx, criteria);
    const checks = [...r.checks];
    const findings = [...r.findings];
    let stopped = r.stopped === "budget";
    // The running app, when there is one: QA tries each criterion the code alone did not show working. What it
    // sees there is recorded after the code check, so it is the latest word. An app that is down changes nothing.
    // Page text can carry instructions to the model, so what the app shows never overturns a gap in the code and
    // never closes a finding: only evidence in the code does that.
    const { openPage, screensDir } = s.deps;
    const appUrl = s.project.appUrl;
    if (!stopped && openPage && appUrl) {
      for (const k of criteria) {
        const code = r.checks.find((c) => c.criterionId === k.id);
        if (!code || code.state === "evidence_found") continue;
        try {
          const seen = await exploreFlow(ctx, k, appUrl, openPage, screensDir);
          if (seen.check.state === "no_evidence" || (seen.check.state === "evidence_found" && code.state === "gap")) continue;
          checks.push(seen.check);
          if (seen.finding) findings.push(seen.finding);
        } catch (e) {
          if (e instanceof BudgetExceededError) {
            stopped = true;
            break;
          }
          console.warn(`qa: could not try "${k.text.slice(0, 60)}" in the running app: ${String(e)}`);
        }
      }
    }
    for (const c of checks) record.recordCheck(c);
    save(ctx, "qa", stage, { artifacts: [], criteria: [], findings: notRaisedYet(record, change.projectId, findings), questions: [], affectedCriterionIds: [] });
    const found = new Set(r.checks.filter((c) => c.state === "evidence_found").map((c) => c.criterionId));
    for (const f of record.listFindings({ projectId: change.projectId, status: "open" })) {
      const on = f.criterionId ? [f.criterionId] : findingCriteria(record, f.id);
      if (on.some((id) => found.has(id))) record.setFindingStatus(f.id, "fixed", "Evidence found on re-check", "qa");
    }
    if (stopped) throw new BudgetExceededError("Copilot budget used during verification");
  });
}

/** Open failure paths raised on the change. Document gaps are left to the analyst's gate. */
const openPathsOn = (record: CopilotRecord, changeId: string) => {
  const gaps = new Set(docGapsOn(record, changeId).map((f) => f.id));
  return record.listFindings({ changeId, status: "open" }).filter((f) => f.kind === "failure_path" && !gaps.has(f.id)).length;
};

/** QA holds on its criteria's latest checks, and while a failure path raised on the change is open. */
function releaseQaGate(record: CopilotRecord, c: Change): { state: GateState; reason: string } {
  const g = qaGate(latestChecks(record, criteriaOf(record, c)));
  const n = openPathsOn(record, c.id);
  if (g.state === "held" || n === 0) return g;
  return { state: "held", reason: `${n} failure path finding${n === 1 ? "" : "s"} to deal with before release. Fix each one or accept the risk with a reason.` };
}

/**
 * The release gates, recomputed and recorded with no model call: open findings raised on this change and the
 * latest checks of its criteria. Returns the roles that hold.
 */
function releaseHeld(record: CopilotRecord, c: Change): RoleId[] {
  const ba = record.gates(c.id).ba;
  const docs = docGate(record, c.id);
  // An understand run does not pause for its questions, so answers saved later clear the gate here.
  const baNow = c.kind === "understand" ? (docs.state === "held" ? docs : questionsGate(record, c.id)) : docs.state === "held" || ba?.state !== "cleared" ? docs : ba;
  const gates: Array<[RoleId, { state: GateState; reason: string }]> = [
    ["ba", baNow],
    ["compliance", complianceGate(legalUnresolved(record, c.id))],
    ["architect", architectGate(openOn(record, c.id, "operations"))],
    ["qa", releaseQaGate(record, c)],
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
    await syncDocs(s, c);
    await runRole(s, c, "ba", async (ctx) =>
      save(ctx, "ba", "intake", c.kind === "understand" ? await understandApp(ctx) : await analyseImpact(ctx, record.listCriteria(c.projectId))),
    );
    // Both ways: behaviour in the code that no document asked for. Only when there are requirements to compare.
    const requirements = record.listRequirements(c.projectId, { status: "active" });
    const flows = (asBuiltFor(record, c) as { flows?: unknown }).flows;
    if (c.kind === "understand" && requirements.length && Array.isArray(flows) && flows.length) {
      await runRole(s, c, "ba", async (ctx) => {
        const findings = await undocumentedFlows(ctx, flows.map(String), requirements);
        save(ctx, "ba", "intake", { artifacts: [], criteria: [], findings, questions: [], affectedCriterionIds: [] });
      });
    }
    return NEXT;
  },

  // The BA gate is checked first; analyseChange runs only once it clears. An understand run records the gate
  // and goes on, because its questions have a safe default; release is where the gate holds.
  analysis: async (s, c) => {
    const { record } = s.deps;
    const asked = questionsGate(record, c.id);
    if (!gate(record, c.id, "ba", asked) && c.kind !== "understand") return stay(["ba"]);
    await runRole(s, c, "ba", async (ctx) => save(ctx, "ba", "analysis", await analyseChange(ctx)));
    // Document gaps hold the gate as other findings hold theirs: recorded here, holding at release.
    const docs = docGate(record, c.id);
    gate(record, c.id, "ba", docs.state === "held" ? docs : asked);
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

  // An understand change gets its changes written first. A budget stop leaves that for the next advance.
  release: async (s, c) => {
    const { record } = s.deps;
    const open = c.kind === "understand" && !proposalsOf(record, c.id) ? record.listFindings({ changeId: c.id, status: "open" }) : [];
    if (open.length) {
      await runRole(s, c, "po", async (ctx) => {
        const findings = open.map((f) => ({ id: f.id, role: f.role, title: f.title, plain: f.plain, where: where(f.trigger) }));
        const body = await writeChanges({ problem: problemOf(record, c.id), findings }, ctx.model, s.deps.packs.role.po);
        record.addArtifact({ changeId: c.id, role: "po", stage: "release", kind: "proposed_changes", body });
      });
    }
    const held = releaseHeld(record, c);
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
  linkFixChange(record, c, fix, open);
  return fix;
}

/** Carries findings onto a fix change and has each change name the other, so the record reads both ways. */
function linkFixChange(record: CopilotRecord, from: Change, fix: Change, findings: Finding[]): void {
  for (const f of findings) {
    record.link({ type: "finding", id: f.id }, "raised_on", { type: "change", id: fix.id });
    if (f.criterionId) record.link({ type: "change", id: fix.id }, "affects", { type: "criterion", id: f.criterionId });
  }
  record.addArtifact({ changeId: from.id, role: "po", stage: from.stage, kind: "fix_change", body: { changeId: fix.id } });
  record.addArtifact({ changeId: fix.id, role: "po", stage: "intake", kind: "follows", body: { changeId: from.id } });
}

export type { ProposalDecision } from "./types.js";

/** The decisions made on a check's proposed changes so far, oldest first. */
export const proposalDecisions = (record: CopilotRecord, changeId: string): ProposalDecision[] =>
  record.listArtifacts(changeId).filter((a) => a.kind === "proposal_decision").map((a) => a.body as ProposalDecision);

function proposalAt(record: CopilotRecord, changeId: string, index: number) {
  const ch = proposalsOf(record, changeId)?.changes[index];
  if (!ch) throw new Error("No such proposed change");
  return ch;
}

/**
 * Approving a written change opens a fix change for the coding agent, parked at build with the proposal's
 * criteria. Only the findings still open are carried over (none open still opens it: the re-check confirms).
 * Approving the same proposal again returns the fix change it already opened.
 */
export function approveProposal(record: CopilotRecord, changeId: string, index: number, actor: string): Change {
  const ch = proposalAt(record, changeId, index);
  if (!actor.trim()) throw new Error("Say who is approving");
  const done = proposalDecisions(record, changeId).find((d) => d.index === index && d.decision === "approved");
  if (done?.fixChangeId) return record.getChange(done.fixChangeId);
  const from = record.getChange(changeId);
  const findings = record.listFindings({ changeId }).filter((f) => ch.findingIds.includes(f.id));
  const fix = record.createChange({
    projectId: from.projectId,
    title: ch.title.slice(0, 200),
    description: [`For ${ch.forWhom}. ${ch.why}`, ...findings.map((f) => `- ${f.title}`)].join("\n"),
    kind: "fix",
  });
  record.setStage(fix.id, "build");
  const carried = findings.filter((f) => f.status === "open");
  for (const c of ch.criteria) {
    const k = record.addCriterion({ projectId: from.projectId, changeId: fix.id, text: c.text, isFailurePath: c.isFailurePath });
    record.link({ type: "change", id: fix.id }, "satisfies", { type: "criterion", id: k.id });
    // Evidence found on the change's criteria then closes the findings it carries, whichever role raised them.
    for (const f of carried) record.link({ type: "finding", id: f.id }, "affects", { type: "criterion", id: k.id });
  }
  linkFixChange(record, from, fix, carried);
  record.addArtifact({ changeId, role: "po", stage: from.stage, kind: "proposal_decision", body: { index, decision: "approved", actor, fixChangeId: fix.id } });
  return fix;
}

/** Accepting the risk closes the proposal's still open findings under the actor, with their reason. */
export function acceptProposalRisk(record: CopilotRecord, changeId: string, index: number, actor: string, reason: string): void {
  const ch = proposalAt(record, changeId, index);
  if (!actor.trim() || !reason.trim()) throw new Error("Say who is accepting the risk and why");
  for (const f of record.listFindings({ changeId, status: "open" })) {
    if (ch.findingIds.includes(f.id)) record.setFindingStatus(f.id, "accepted_risk", reason, actor);
  }
  record.addArtifact({ changeId, role: "po", stage: record.getChange(changeId).stage, kind: "proposal_decision", body: { index, decision: "accepted_risk", actor, reason } });
}

/**
 * A reported fix is confirmed only when the reviewer who raised the finding completed a review that showed it the
 * finding's file, through the finding's line, and did not raise it again. Findings with no code location, and
 * findings tied to a criterion (QA's evidence settles those), are left to a person or to QA.
 */
function confirmReportedFixes(record: CopilotRecord, projectId: string, commit: string, shown: Partial<Record<RoleId, Map<string, number>>>): void {
  for (const f of record.listFindings({ projectId, status: "open" })) {
    if (f.criterionId || f.trigger.type !== "code") continue;
    const lastLine = shown[f.role]?.get(f.trigger.file);
    if (lastLine === undefined || lastLine < f.trigger.line) continue;
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
    // Document findings land on the newest change still in progress, else on the newest delivered one.
    const target = changes.filter((c) => c.stage !== "operate").at(-1) ?? newest;
    await syncDocs(s, target);
    // Unknown diff (no baseline, or it is unreachable): review all files, so moving the baseline never skips code.
    if (!diff || diff.changed.length) {
      const asBuilt = asBuiltFor(record, newest, true);
      const only = diff?.changed;
      // What each review was shown, kept only once its run completes (runRole throws on a failed run).
      const shown: Partial<Record<RoleId, Map<string, number>>> = {};
      await runRole(s, newest, "compliance", async (ctx) => {
        const r = await reviewCompliance(ctx, asBuilt, only);
        save(ctx, "compliance", "operate", r);
        shown.compliance = r.shown;
      });
      await runRole(s, newest, "architect", async (ctx) => {
        const r = await reviewOperations(ctx, asBuilt, only);
        save(ctx, "architect", "operate", r);
        shown.architect = r.shown;
      });
      confirmReportedFixes(record, projectId, repo.commit, shown);
    }
    if (toVerify.length) await verify(s, newest, "operate", toVerify);
    // Drift: deterministic rules over the record and the diff, no model call. No baseline or no new commit: nothing
    // changed. A baseline whose diff cannot be read is null, so every cited line counts as changed (fails closed).
    const hunks = !base || base === repo.commit ? [] : diff ? await diffHunks(repo.dir, base, repo.commit).catch(() => null) : null;
    // A drift run is recorded only when a rule raises a finding.
    let driftRun: string | undefined;
    applyDrift(record, projectId, record.getChange(target.id), {
      hunks,
      commit: repo.commit,
      runId: () => {
        if (!driftRun) {
          driftRun = record.startRun({ changeId: target.id, role: "ba", commit: repo.commit });
          s.runIds.push(driftRun);
        }
        return driftRun;
      },
    });
    if (driftRun) record.finishRun(driftRun, "done");
    // Changes at build go first: their verification can close findings that hold an older change at release.
    for (const c of [...atBuild, ...changes.filter((x) => x.stage !== "build")]) {
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
