import { describe, expect, it } from "vitest";
import { applyDrift, CopilotRecord, openItems } from "../src/index.js";
import type { FindingKind, RoleId, Trigger } from "../src/index.js";

function fresh() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "LagosPay", repoUrl: "x" });
  const change = record.createChange({ projectId: project.id, title: "Understand", description: "d", kind: "understand" });
  const runId = record.startRun({ changeId: change.id, role: "qa", commit: "a".repeat(40) });
  const add = (role: RoleId, kind: FindingKind, title: string, trigger: Trigger) =>
    record.addFinding({ projectId: project.id, changeId: change.id, runId, role, stage: "operate", kind, title, plain: `why ${title}`, costIfIgnored: "c", fixPrompt: "f", trigger }).finding;
  const code = (file: string, line: number): Trigger => ({ type: "code", file, line, commit: "a".repeat(40) });
  return { record, project, change, runId, add, code };
}

describe("openItems", () => {
  it("ranks legal, failure paths, drift, other conformance, operations", () => {
    const t = fresh();
    const doc = t.record.saveDocumentVersion({ projectId: t.project.id, name: "docs/PRD.md", source: "repo", body: "v1", commit: null });
    t.record.applyRequirements(doc.document.id, doc.version.id, [{ key: "FR-1", text: "Refunds", quote: "Refunds", line: 4 }]);
    t.add("architect", "operations", "No backups", t.code("db.js", 3));
    t.add("ba", "conformance", "Spec says email, code sends SMS", { type: "doc", quote: "email", document: "docs/PRD.md", line: 9 });
    applyDrift(t.record, t.project.id, t.change, { hunks: [], commit: "b".repeat(40), runId: t.runId });
    t.add("qa", "failure_path", "Refund twice", t.code("server.js", 120));
    t.add("compliance", "legal", "Check this: consent", { type: "screen", url: "http://localhost:3000/signup", screenshotPath: "s.png" });
    const { total, items } = openItems(t.record, t.project.id);
    expect(total).toBe(5);
    expect(items.map((i) => i.title)).toEqual([
      "Check this: consent",
      "Refund twice",
      "Requirement FR-1 has no acceptance criteria",
      "Spec says email, code sends SMS",
      "No backups",
    ]);
    expect(items.map((i) => i.where)).toEqual(["http://localhost:3000/signup", "server.js:120", "docs/PRD.md:4", "docs/PRD.md:9", "db.js:3"]);
    expect(items[2]).toMatchObject({ kind: "conformance", role: "ba", requirementKey: "FR-1" });
    expect(items[0]).toMatchObject({ why: "why Check this: consent", requirementKey: null });
  });

  it("accepted and fixed findings are not open items", () => {
    const t = fresh();
    t.record.saveDocumentVersion({ projectId: t.project.id, name: "docs/PRD.md", source: "repo", body: "v1", commit: null });
    const a = t.add("qa", "failure_path", "A", t.code("a.js", 1));
    const b = t.add("qa", "failure_path", "B", t.code("b.js", 1));
    t.add("qa", "failure_path", "C", t.code("c.js", 1));
    t.record.setFindingStatus(a.id, "accepted_risk", "Low volume", "Ada");
    t.record.setFindingStatus(b.id, "fixed", "Done", "qa");
    expect(openItems(t.record, t.project.id).items.map((i) => i.title)).toEqual(["C"]);
  });

  it("a project with no documents has the setup item", () => {
    const t = fresh();
    t.add("architect", "operations", "No backups", t.code("db.js", 3));
    const { total, items } = openItems(t.record, t.project.id);
    expect(total).toBe(2);
    expect(items.at(-1)).toMatchObject({ kind: "setup", findingId: null, title: "No PRD or spec found" });
  });
});
