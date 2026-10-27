import type { CopilotRecord } from "./record/record.js";
import type { Check, Criterion, Finding, FindingStatus, Requirement, RequirementEvent } from "./types.js";

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
