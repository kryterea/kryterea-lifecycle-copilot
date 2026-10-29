import { describe, expect, it } from "vitest";
import { CopilotRecord, traceCommit, traceRequirement } from "../src/index.js";

const A = "a".repeat(40);

function fresh() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "LagosPay", repoUrl: "x" });
  const change = record.createChange({ projectId: project.id, title: "Understand", description: "d", kind: "understand" });
  const runId = record.startRun({ changeId: change.id, role: "qa", commit: A });
  const v = record.saveDocumentVersion({ projectId: project.id, name: "docs/PRD.md", source: "repo", body: "# PRD\nMerchants refund a payment.", commit: A });
  const [req] = record.applyRequirements(v.document.id, v.version.id, [{ key: "PRD-1", text: "Merchants refund a payment", quote: "Merchants refund a payment.", line: 2 }]).added;
  return { record, project, change, runId, doc: v.document, req: req! };
}

describe("trace", () => {
  it("follows a requirement to sign off and names missing links as gaps", () => {
    const { record, project, change, runId, doc, req } = fresh();
    let chain = traceRequirement(record, req.id);
    expect(chain.document).toEqual({ id: doc.id, name: "docs/PRD.md", line: 2, quote: "Merchants refund a payment." });
    expect(chain.gaps).toEqual(["No acceptance criteria", "No Linear ticket", "No evidence yet", "Not signed off"]);

    const k = record.addCriterion({ projectId: project.id, changeId: change.id, text: "A refund marks the payment refunded", isFailurePath: false });
    record.linkRequirement(req.id, "criterion", k.id);
    record.linkRequirement(req.id, "linear_issue", "PAY-3");
    record.recordCheck({ criterionId: k.id, runId, state: "evidence_found", evidence: [{ type: "code", file: "server.js", line: 120, commit: A }], note: "Refund sets status." });
    const { finding } = record.addFinding({
      projectId: project.id, changeId: change.id, runId, role: "qa", stage: "verification", kind: "failure_path",
      title: "Refund twice", plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "server.js", line: 121, commit: A }, criterionId: k.id,
    });
    record.setFindingStatus(finding.id, "accepted_risk", "Paystack blocks a second refund", "Ada");
    record.setStage(change.id, "operate");
    record.addArtifact({ changeId: change.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "Ada" } });

    chain = traceRequirement(record, req.id);
    expect(chain.requirement.events.map((e) => e.kind)).toEqual(["added"]);
    expect(chain.criteria.map((c) => [c.text, c.latest?.state])).toEqual([["A refund marks the payment refunded", "evidence_found"]]);
    expect(chain.tickets).toEqual(["PAY-3"]);
    expect(chain.evidence).toEqual([{ file: "server.js", line: 120, commit: A }]);
    expect(chain.findings.map((f) => [f.title, f.status, f.history.at(-1)?.actor])).toEqual([["Refund twice", "accepted_risk", "Ada"]]);
    expect(chain.signOff).toMatchObject({ by: "Ada" });
    expect(chain.gaps).toEqual([]);
  });

  it("traces a commit back to criteria, requirements and documents", () => {
    const { record, project, change, runId, req } = fresh();
    const k = record.addCriterion({ projectId: project.id, changeId: change.id, text: "A refund marks the payment refunded", isFailurePath: false });
    record.linkRequirement(req.id, "criterion", k.id);
    record.recordCheck({ criterionId: k.id, runId, state: "evidence_found", evidence: [{ type: "code", file: "server.js", line: 120, commit: A }], note: "" });
    record.addFinding({
      projectId: project.id, changeId: change.id, runId, role: "architect", stage: "operate", kind: "operations",
      title: "No backups", plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "db.js", line: 4, commit: A },
    });
    const t = traceCommit(record, project.id, A.slice(0, 7))!;
    expect(t.sha).toBe(A);
    expect(t.files).toEqual(["server.js", "db.js"]);
    expect(t.criteria).toEqual([{ id: k.id, text: "A refund marks the payment refunded", requirementKeys: ["PRD-1"] }]);
    expect(t.documents).toEqual(["docs/PRD.md"]);
    expect(t.findings.map((f) => [f.title, f.status])).toEqual([["No backups", "open"]]);
  });

  it("unknown commit returns null", () => {
    const { record, project } = fresh();
    expect(traceCommit(record, project.id, "c".repeat(40))).toBeNull();
    expect(traceCommit(record, project.id, "zz")).toBeNull();
  });
});
