import type { CopilotRecord } from "./record/record.js";
import type { Change, Criterion, Finding, Requirement, RoleId, Trigger } from "./types.js";

export type DriftRule =
  | "requirement_changed"
  | "evidence_lines_changed"
  | "requirement_no_criteria"
  | "requirement_no_evidence"
  | "accepted_risk_changed"
  | "documents_disagree";

export type Hunk = { file: string; start: number; end: number };

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

/** Exact drift titles. Open items rank these as drift. */
export const DRIFT_TITLES = {
  requirement_changed: (key: string) => `Requirement ${key} changed but its criteria did not`,
  evidence_lines_changed: (criterion: string) => `Code behind the evidence for "${short(criterion)}" changed`,
  requirement_no_criteria: (key: string) => `Requirement ${key} has no acceptance criteria`,
  requirement_no_evidence: (key: string) => `Requirement ${key} has no evidence yet`,
  accepted_risk_changed: (title: string) => `Accepted risk needs review: ${title}`,
} as const;

/**
 * The drift rule a finding was raised under, or null for any other finding. Read from the link applyDrift writes,
 * never from the title: a model's finding can carry any title.
 */
export function driftRule(record: CopilotRecord, findingId: string): DriftRule | null {
  const link = record.linksFrom({ type: "finding", id: findingId }).find((l) => l.rel === "affects" && l.to.type === "drift");
  return (link?.to.id as DriftRule | undefined) ?? null;
}

/** Null hunks: the diff is unknown, so every cited line counts as changed. */
const overlaps = (hunks: Hunk[] | null, file: string, line: number) =>
  hunks === null || hunks.some((h) => h.file === file && h.start <= line && line <= h.end);

/**
 * The deterministic drift rules, run at the end of every recheck. Each rule that holds raises one conformance
 * finding per subject (requirement, criterion or accepted finding), linked `affects` to that subject. A drift
 * finding whose rule no longer holds is confirmed fixed by the role that raised it. Nothing here calls a model.
 */
export function applyDrift(
  record: CopilotRecord,
  projectId: string,
  change: Change,
  input: { hunks: Hunk[] | null; commit: string; runId: string | (() => string) },
): { raised: number; confirmed: number } {
  const { hunks, commit } = input;
  // A run is only needed when a finding is raised; a function lets the caller start one lazily.
  const runId = () => (typeof input.runId === "string" ? input.runId : input.runId());
  const sha = commit.slice(0, 7);
  const criteria = new Map(record.listCriteria(projectId).map((k) => [k.id, k]));
  const docNames = new Map(record.listDocuments(projectId).map((d) => [d.id, d.name]));
  let raised = 0;

  const raise = (
    role: RoleId,
    rule: DriftRule,
    title: string,
    body: { plain: string; costIfIgnored: string; fixPrompt: string },
    trigger: Trigger,
    subject: { type: string; id: string } | null,
    criterionId?: string,
  ) => {
    // Same role, kind and title is the same finding in the record. One raised by a role, not drift, is left alone:
    // drift never reopens it, links it or confirms it.
    const prior = record.listFindings({ projectId }).find((f) => f.role === role && f.kind === "conformance" && f.title === title);
    if (prior && (prior.status !== "fixed" || driftRule(record, prior.id) !== rule)) return;
    const { finding } = record.addFinding({
      projectId,
      changeId: change.id,
      runId: runId(),
      role,
      stage: change.stage,
      kind: "conformance",
      title,
      ...body,
      trigger,
      ...(criterionId ? { criterionId } : {}),
    });
    record.link({ type: "finding", id: finding.id }, "affects", { type: "drift", id: rule });
    if (subject) record.link({ type: "finding", id: finding.id }, "affects", subject);
    raised++;
  };

  // Requirement rules, evaluated over the record as it stands.
  const holds = new Map<string, Set<DriftRule>>();
  for (const req of record.listRequirements(projectId, { status: "active" })) {
    const linked = record
      .requirementLinks(req.id)
      .filter((l) => l.toType === "criterion")
      .map((l) => criteria.get(l.toId))
      .filter((k): k is Criterion => k !== undefined);
    const rules = requirementRules(record, req, linked);
    holds.set(req.id, rules);
    const trigger: Trigger = { type: "doc", quote: req.quote, document: docNames.get(req.documentId) ?? "", line: req.line };
    const subject = { type: "requirement", id: req.id };
    if (rules.has("requirement_changed")) {
      raise("ba", "requirement_changed", DRIFT_TITLES.requirement_changed(req.key), {
        plain: `The requirement now reads "${req.text}", but its acceptance criteria were written before it changed.`,
        costIfIgnored: "The code can meet criteria that no longer match what was agreed.",
        fixPrompt: `Update the acceptance criteria for ${req.key} to match its new wording, then re-check.`,
      }, trigger, subject);
    }
    if (rules.has("requirement_no_criteria")) {
      raise("ba", "requirement_no_criteria", DRIFT_TITLES.requirement_no_criteria(req.key), {
        plain: `Nothing checks that "${req.text}" works.`,
        costIfIgnored: "It can ship broken, or never ship, and nobody would know.",
        fixPrompt: `Open a change for ${req.key} so the analyst writes acceptance criteria for it.`,
      }, trigger, subject);
    }
    if (rules.has("requirement_no_evidence")) {
      raise("qa", "requirement_no_evidence", DRIFT_TITLES.requirement_no_evidence(req.key), {
        plain: `Acceptance criteria exist for "${req.text}", but no check has found it working in the code yet.`,
        costIfIgnored: "It may not be built, though the documents say it is.",
        fixPrompt: `Build ${req.key}, or show where it lives in the code, then re-check.`,
      }, trigger, subject);
    }
  }

  // Code behind a criterion's evidence changed, and no check has looked at it since.
  for (const k of criteria.values()) {
    const last = record.latestCheck(k.id);
    if (last?.state !== "evidence_found") continue;
    if (record.latestCheckInfo(k.id)?.commit === commit) continue;
    const hit = last.evidence.find((t) => t.type === "code" && overlaps(hunks, t.file, t.line));
    if (hit?.type !== "code") continue;
    raise("qa", "evidence_lines_changed", DRIFT_TITLES.evidence_lines_changed(k.text), {
      plain: `Lines the evidence for "${k.text}" rests on changed at ${sha}. It counts again only once a check finds it in the new code.`,
      costIfIgnored: "A criterion can look done when the code under it changed.",
      fixPrompt: `Re-check the project so QA verifies "${k.text}" against the new code.`,
    }, { type: "code", file: hit.file, line: hit.line, commit }, null, k.id);
  }

  // An accepted risk whose lines changed goes back to a person. The acceptance itself is kept.
  for (const f of record.listFindings({ projectId, status: "accepted_risk" })) {
    if (f.trigger.type !== "code" || !overlaps(hunks, f.trigger.file, f.trigger.line)) continue;
    const decision = record.findingHistory(f.id).at(-1)!;
    raise("ba", "accepted_risk_changed", DRIFT_TITLES.accepted_risk_changed(f.title), {
      plain: `"${f.title}" was accepted as a risk by ${decision.actor} ("${decision.reason}"). The lines it is about changed at ${sha}.`,
      costIfIgnored: "The acceptance may no longer match the code.",
      fixPrompt: "Look at what changed, then accept the risk again with a reason, or fix it.",
    }, { type: "code", file: f.trigger.file, line: f.trigger.line, commit }, { type: "finding", id: f.id });
  }

  // Confirm drift findings whose rule no longer holds.
  let confirmed = 0;
  for (const f of record.listFindings({ projectId, status: "open" })) {
    const rule = driftRule(record, f.id);
    if (!rule || stillHolds(record, f, rule, holds)) continue;
    record.setFindingStatus(f.id, "fixed", `Kryterea re-checked at ${sha}: ${rule.replaceAll("_", " ")} no longer holds`, f.role);
    confirmed++;
  }
  return { raised, confirmed };
}

function requirementRules(record: CopilotRecord, req: Requirement, linked: Criterion[]): Set<DriftRule> {
  const rules = new Set<DriftRule>();
  if (!linked.length) return rules.add("requirement_no_criteria");
  const last = record.requirementEvents(req.id).at(-1);
  if (last?.kind === "changed" && linked.every((k) => k.createdAt <= last.at)) rules.add("requirement_changed");
  // A gap already warns through QA's own finding, so only criteria with nothing found count here.
  const states = linked.map((k) => record.latestCheck(k.id)?.state ?? null);
  if (!states.includes("evidence_found") && !states.includes("gap")) rules.add("requirement_no_evidence");
  return rules;
}

function stillHolds(record: CopilotRecord, f: Finding, rule: DriftRule, holds: Map<string, Set<DriftRule>>): boolean {
  const subjects = record.linksFrom({ type: "finding", id: f.id }).filter((l) => l.rel === "affects");
  switch (rule) {
    case "evidence_lines_changed": {
      const at = f.criterionId ? record.latestCheckInfo(f.criterionId)?.at : undefined;
      return at === undefined || at <= f.createdAt;
    }
    case "accepted_risk_changed": {
      // Holds until a person decides on the original again after this review was raised.
      const original = subjects.find((l) => l.to.type === "finding")?.to.id;
      if (!original || record.findingStatus(original) !== "accepted_risk") return false;
      return record.lastStatusSeq(original) < record.lastStatusSeq(f.id);
    }
    case "documents_disagree":
      return true;
    default:
      return subjects.some((l) => l.to.type === "requirement" && holds.get(l.to.id)?.has(rule));
  }
}
