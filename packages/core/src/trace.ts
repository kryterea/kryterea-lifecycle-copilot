import type { CopilotRecord } from "./record/record.js";
import type { Check, Criterion, EvidenceState, Finding, FindingKind, FindingStatus, Requirement, RequirementEvent, RoleId } from "./types.js";

export interface TraceChain {
  document: { id: string; name: string; line: number; quote: string };
  requirement: Requirement & { events: RequirementEvent[] };
  criteria: Array<Criterion & { latest: Check | null }>;
  tickets: string[];
  evidence: Array<{ file: string; line: number; commit: string }>;
  findings: Array<Finding & { status: FindingStatus; history: Array<{ status: FindingStatus; reason: string; actor: string; at: string }> }>;
  signOff: { by: string; at: string } | null;
  /** Each missing link in plain words. A gap is shown, never hidden. */
  gaps: string[];
}

export interface CommitTrace {
  sha: string;
  files: string[];
  criteria: Array<{ id: string; text: string; requirementKeys: string[] }>;
  documents: string[];
  findings: Array<{ id: string; title: string; status: FindingStatus }>;
}

/** Counts for one side of a compare: the record as it stood while that commit was the latest one checked. */
export interface CommitState {
  sha: string;
  open: number;
  evidenceFound: number;
  gaps: number;
  noEvidence: number;
}

export interface CommitCompare {
  from: CommitState;
  to: CommitState;
  /** Every finding that existed at either commit; null where it did not exist yet. */
  findings: Array<{ id: string; title: string; kind: FindingKind; role: RoleId; from: FindingStatus | null; to: FindingStatus | null }>;
  /** Every criterion checked by either commit; null where it had no check yet. */
  criteria: Array<{ id: string; text: string; requirementKeys: string[]; from: EvidenceState | null; to: EvidenceState | null }>;
}

/**
 * Before and after: open items and evidence as they stood at two commits Kryterea checked (short ids are enough).
 * A commit's state includes decisions made while it was the latest one checked. Null if either was never checked.
 */
export function compareCommits(record: CopilotRecord, projectId: string, from: string, to: string): CommitCompare | null {
  const side = (sha: string) => {
    if (!/^[0-9a-f]{4,40}$/i.test(sha)) return null;
    const [full] = record.runCommits(projectId, sha.toLowerCase());
    const window = full ? record.commitWindow(projectId, full) : null;
    return full && window ? { sha: full, before: window.end } : null;
  };
  const a = side(from);
  const b = side(to);
  if (!a || !b) return null;
  const statusBefore = (findingId: string, before: string | null) =>
    record.findingHistory(findingId).filter((h) => before === null || h.at < before).at(-1)?.status ?? null;

  const findings = record
    .listFindings({ projectId })
    .map((f) => ({ id: f.id, title: f.title, kind: f.kind, role: f.role, from: statusBefore(f.id, a.before), to: statusBefore(f.id, b.before) }))
    .filter((f) => f.from !== null || f.to !== null);
  const criteria = record
    .listCriteria(projectId)
    .map((k) => ({
      id: k.id,
      text: k.text,
      requirementKeys: record.requirementsLinkedTo("criterion", k.id).map((r) => r.key),
      from: record.checkStateBefore(k.id, a.before),
      to: record.checkStateBefore(k.id, b.before),
    }))
    .filter((k) => k.from !== null || k.to !== null);
  const count = (sha: string, side: "from" | "to"): CommitState => ({
    sha,
    open: findings.filter((f) => f[side] === "open").length,
    evidenceFound: criteria.filter((k) => k[side] === "evidence_found").length,
    gaps: criteria.filter((k) => k[side] === "gap").length,
    noEvidence: criteria.filter((k) => k[side] === "no_evidence").length,
  });
  return { from: count(a.sha, "from"), to: count(b.sha, "to"), findings, criteria };
}

/** The latest acceptance on a delivered change, unless voided after it. */
function signedOff(record: CopilotRecord, changeId: string): { by: string; at: string } | null {
  const last = record
    .listArtifacts(changeId)
    .filter((a) => a.kind === "acceptance" || a.kind === "acceptance_void")
    .at(-1);
  if (last?.kind !== "acceptance" || record.getChange(changeId).stage !== "operate") return null;
  return { by: String((last.body as { actor?: unknown }).actor ?? ""), at: last.createdAt };
}

/**
 * Forward from one document line: the requirement and its history, its criteria with their latest checks, Linear
 * tickets, the code evidence, findings on those criteria or about the requirement (with every decision), and the
 * sign off of the change that delivered it.
 */
export function traceRequirement(record: CopilotRecord, requirementId: string): TraceChain {
  const requirement = record.getRequirement(requirementId);
  const doc = record.getDocument(requirement.documentId);
  const links = record.requirementLinks(requirementId);
  const ids = new Set(links.filter((l) => l.toType === "criterion").map((l) => l.toId));
  const criteria = record
    .listCriteria(requirement.projectId)
    .filter((k) => ids.has(k.id))
    .map((k) => ({ ...k, latest: record.latestCheck(k.id) }));
  const tickets = links.filter((l) => l.toType === "linear_issue").map((l) => l.toId);
  const evidence = criteria.flatMap((k) =>
    k.latest?.state === "evidence_found"
      ? k.latest.evidence.flatMap((t) => (t.type === "code" ? [{ file: t.file, line: t.line, commit: t.commit }] : []))
      : [],
  );
  const about = (f: Finding) =>
    (f.criterionId !== undefined && ids.has(f.criterionId)) ||
    record
      .linksFrom({ type: "finding", id: f.id })
      .some((l) => l.rel === "affects" && ((l.to.type === "requirement" && l.to.id === requirementId) || (l.to.type === "criterion" && ids.has(l.to.id))));
  const findings = record
    .listFindings({ projectId: requirement.projectId })
    .filter(about)
    .map((f) => ({ ...f, history: record.findingHistory(f.id) }));
  const changes = [...new Set(criteria.map((k) => k.changeId))];
  const signOff = changes.map((id) => signedOff(record, id)).find((s) => s !== null) ?? null;

  const gaps: string[] = [];
  if (!criteria.length) gaps.push("No acceptance criteria");
  if (!tickets.length) gaps.push("No Linear ticket");
  if (!criteria.some((k) => k.latest?.state === "evidence_found")) gaps.push("No evidence yet");
  if (!signOff) gaps.push("Not signed off");
  return {
    document: { id: doc.id, name: doc.name, line: requirement.line, quote: requirement.quote },
    requirement: { ...requirement, events: record.requirementEvents(requirementId) },
    criteria,
    tickets,
    evidence,
    findings,
    signOff,
    gaps,
  };
}

/**
 * Backward from a commit Kryterea checked (a short id is enough): the files its checks and findings cite, the
 * criteria checked there with the requirements they cover, those requirements' documents, and the findings raised
 * or evidenced there. Null for a commit no run covered.
 */
export function traceCommit(record: CopilotRecord, projectId: string, sha: string): CommitTrace | null {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return null;
  const [full] = record.runCommits(projectId, sha.toLowerCase());
  if (!full) return null;
  const files: string[] = [];
  const addFile = (f: string) => {
    if (!files.includes(f)) files.push(f);
  };
  const checks = record.checksAt(projectId, full);
  for (const c of checks) for (const t of c.evidence) if (t.type === "code" && t.commit === full) addFile(t.file);

  const all = record.listCriteria(projectId);
  const docs = new Map(record.listDocuments(projectId).map((d) => [d.id, d.name]));
  const documents: string[] = [];
  const criteria = [...new Set(checks.map((c) => c.criterionId))].flatMap((id) => {
    const k = all.find((x) => x.id === id);
    if (!k) return [];
    const reqs = record.requirementsLinkedTo("criterion", id);
    for (const r of reqs) {
      const name = docs.get(r.documentId);
      if (name && !documents.includes(name)) documents.push(name);
    }
    return [{ id, text: k.text, requirementKeys: reqs.map((r) => r.key) }];
  });

  const findings = record
    .listFindings({ projectId })
    .filter((f) => record.findingEvidence(f.id).some((e) => e.trigger.type === "code" && e.trigger.commit === full))
    .map((f) => {
      if (f.trigger.type === "code") addFile(f.trigger.file);
      return { id: f.id, title: f.title, status: f.status };
    });
  return { sha: full, files, criteria, documents, findings };
}
