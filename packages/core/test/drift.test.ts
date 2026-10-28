import { describe, expect, it } from "vitest";
import { applyDrift, CopilotRecord } from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

function fresh() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "LagosPay", repoUrl: "x" });
  const change = record.createChange({ projectId: project.id, title: "Understand", description: "d", kind: "understand" });
  const runId = record.startRun({ changeId: change.id, role: "qa", commit: "a".repeat(40) });
  const doc = record.saveDocumentVersion({ projectId: project.id, name: "docs/PRD.md", source: "repo", body: "v1", commit: "a".repeat(40) });
  const reqs = (rows: Array<[string, string]>, body = "v1") => {
    const v = record.saveDocumentVersion({ projectId: project.id, name: "docs/PRD.md", source: "repo", body, commit: null });
    return record.applyRequirements(doc.document.id, v.version.id, rows.map(([key, text], i) => ({ key, text, quote: text, line: i + 1 })));
  };
  const criterion = (text: string, reqId?: string) => {
    const k = record.addCriterion({ projectId: project.id, changeId: change.id, text, isFailurePath: false });
    if (reqId) record.linkRequirement(reqId, "criterion", k.id);
    return k;
  };
  const drift = (hunks: Array<{ file: string; start: number; end: number }> = [], commit = "b".repeat(40)) =>
    applyDrift(record, project.id, change, { hunks, commit, runId });
  const open = () => record.listFindings({ projectId: project.id, status: "open" }).map((f) => [f.role, f.title]);
  return { record, project, change, runId, reqs, criterion, drift, open };
}

describe("applyDrift", () => {
  it("requirement_changed: a requirement changed but its criteria did not", async () => {
    const t = fresh();
    const [r] = t.reqs([["FR-1", "Merchants create payment links"]]).added;
    const k = t.criterion("A merchant creates a link", r!.id);
    t.record.recordCheck({ criterionId: k.id, runId: t.runId, state: "evidence_found", evidence: [], note: "" });
    await tick();
    t.reqs([["FR-1", "Merchants create payment links in naira or dollars"]], "v2");
    t.drift();
    expect(t.open()).toContainEqual(["ba", "Requirement FR-1 changed but its criteria did not"]);
  });

  it("requirement_no_criteria: a requirement with no acceptance criteria", () => {
    const t = fresh();
    t.reqs([["FR-1", "Merchants refund a payment"]]);
    expect(t.drift().raised).toBe(1);
    expect(t.open()).toEqual([["ba", "Requirement FR-1 has no acceptance criteria"]]);
  });

  it("requirement_no_evidence: criteria exist but none has evidence yet", () => {
    const t = fresh();
    const [r] = t.reqs([["FR-1", "Merchants refund a payment"]]).added;
    t.criterion("A merchant refunds a payment", r!.id);
    t.drift();
    expect(t.open()).toEqual([["qa", "Requirement FR-1 has no evidence yet"]]);
  });

  it("evidence_lines_changed: code behind a criterion's evidence changed", () => {
    const t = fresh();
    const k = t.criterion("A refund marks the payment refunded");
    t.record.recordCheck({ criterionId: k.id, runId: t.runId, state: "evidence_found", evidence: [{ type: "code", file: "server.js", line: 120, commit: "a".repeat(40) }], note: "" });
    t.drift([{ file: "server.js", start: 118, end: 121 }]);
    const [f] = t.record.listFindings({ projectId: t.project.id, status: "open" });
    expect(f).toMatchObject({ role: "qa", title: 'Code behind the evidence for "A refund marks the payment refunded" changed', criterionId: k.id });
    expect(f!.trigger).toEqual({ type: "code", file: "server.js", line: 120, commit: "b".repeat(40) });
  });

  it("an accepted risk whose trigger lines change gets a review finding and keeps its acceptance", () => {
    const t = fresh();
    const { finding } = t.record.addFinding({
      projectId: t.project.id, changeId: t.change.id, runId: t.runId, role: "architect", stage: "operate", kind: "operations",
      title: "No backups of payments", plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "db.js", line: 4, commit: "a".repeat(40) },
    });
    t.record.setFindingStatus(finding.id, "accepted_risk", "Host takes daily snapshots", "Ada");
    t.drift([{ file: "db.js", start: 3, end: 5 }]);
    expect(t.open()).toEqual([["ba", "Accepted risk needs review: No backups of payments"]]);
    expect(t.record.findingStatus(finding.id)).toBe("accepted_risk");
    // The next push does not touch db.js: the review stays open until a person decides again.
    t.drift([]);
    expect(t.open()).toHaveLength(1);
    t.record.setFindingStatus(finding.id, "accepted_risk", "Snapshots still cover the new table", "Ada");
    t.drift([]);
    expect(t.open()).toEqual([]);
  });

  it("confirms a drift finding when its rule no longer holds", () => {
    const t = fresh();
    const [r] = t.reqs([["FR-1", "Merchants refund a payment"]]).added;
    t.drift();
    const [f] = t.record.listFindings({ projectId: t.project.id, status: "open" });
    const k = t.criterion("A merchant refunds a payment", r!.id);
    t.record.recordCheck({ criterionId: k.id, runId: t.runId, state: "evidence_found", evidence: [], note: "" });
    expect(t.drift().confirmed).toBe(1);
    expect(t.record.findingStatus(f!.id)).toBe("fixed");
    expect(t.record.findingHistory(f!.id).at(-1)!.reason).toBe("Kryterea re-checked at bbbbbbb: requirement no criteria no longer holds");
  });

  it("a diff that does not overlap cited lines raises nothing", () => {
    const t = fresh();
    const k = t.criterion("A refund marks the payment refunded");
    t.record.recordCheck({ criterionId: k.id, runId: t.runId, state: "evidence_found", evidence: [{ type: "code", file: "server.js", line: 120, commit: "a".repeat(40) }], note: "" });
    expect(t.drift([{ file: "server.js", start: 10, end: 20 }, { file: "other.js", start: 120, end: 120 }])).toEqual({ raised: 0, confirmed: 0 });
  });
});

describe("applyDrift identity and unknown diffs", () => {
  it("a finding that only looks like a drift title is never confirmed by drift", () => {
    const t = fresh();
    const { finding } = t.record.addFinding({
      projectId: t.project.id, changeId: t.change.id, runId: t.runId, role: "ba", stage: "intake", kind: "conformance",
      title: "Requirement FR-9 has no acceptance criteria", plain: "p", costIfIgnored: "c", fixPrompt: "f",
      trigger: { type: "doc", quote: "q", document: "docs/PRD.md", line: 1 },
    });
    expect(t.drift().confirmed).toBe(0);
    expect(t.record.findingStatus(finding.id)).toBe("open");
  });

  it("an unknown diff sends every accepted risk on code back for review", () => {
    const t = fresh();
    const { finding } = t.record.addFinding({
      projectId: t.project.id, changeId: t.change.id, runId: t.runId, role: "architect", stage: "operate", kind: "operations",
      title: "No backups of payments", plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "db.js", line: 4, commit: "a".repeat(40) },
    });
    t.record.setFindingStatus(finding.id, "accepted_risk", "Host snapshots", "Ada");
    applyDrift(t.record, t.project.id, t.change, { hunks: null, commit: "b".repeat(40), runId: t.runId });
    expect(t.open()).toEqual([["ba", "Accepted risk needs review: No backups of payments"]]);
  });
});
