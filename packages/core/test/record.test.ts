import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CopilotRecord } from "../src/index.js";

function fresh() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "Demo", repoUrl: "https://example.com/demo.git" });
  return { record, project };
}

describe("record: projects, changes, artifacts, criteria", () => {
  it("creates and reads back a project and change", () => {
    const { record, project } = fresh();
    expect(record.getProject(project.id)).toEqual(project);
    expect(project.appUrl).toBeNull();
    expect(record.listProjects()).toEqual([project]);
    const change = record.createChange({
      projectId: project.id,
      title: "Add export",
      description: "Users can export a CSV",
      kind: "feature",
    });
    expect(change.stage).toBe("intake");
    expect(record.getChange(change.id)).toEqual(change);
    expect(record.listChanges(project.id)).toEqual([change]);
  });

  it("setStage moves a change", () => {
    const { record, project } = fresh();
    const change = record.createChange({ projectId: project.id, title: "t", description: "d", kind: "fix" });
    record.setStage(change.id, "analysis");
    expect(record.getChange(change.id).stage).toBe("analysis");
    expect(() => record.setStage("missing", "build")).toThrow();
  });

  it("stores artifact bodies as JSON and lists them per change", () => {
    const { record, project } = fresh();
    const change = record.createChange({ projectId: project.id, title: "t", description: "d", kind: "understand" });
    const a = record.addArtifact({
      changeId: change.id,
      role: "ba",
      stage: "analysis",
      kind: "brief",
      body: { points: ["a", "b"], n: 2 },
    });
    expect(record.listArtifacts(change.id)).toEqual([a]);
    expect(record.listArtifacts(change.id)[0]?.body).toEqual({ points: ["a", "b"], n: 2 });
  });

  it("criteria are listed per project across changes", () => {
    const { record, project } = fresh();
    const c1 = record.createChange({ projectId: project.id, title: "one", description: "d", kind: "feature" });
    const c2 = record.createChange({ projectId: project.id, title: "two", description: "d", kind: "feature" });
    record.addCriterion({ projectId: project.id, changeId: c1.id, text: "a", isFailurePath: false });
    record.addCriterion({ projectId: project.id, changeId: c1.id, text: "b", isFailurePath: true });
    record.addCriterion({ projectId: project.id, changeId: c2.id, text: "c", isFailurePath: false });
    const other = record.createProject({ name: "Other", repoUrl: "x" });
    const oc = record.createChange({ projectId: other.id, title: "o", description: "d", kind: "fix" });
    record.addCriterion({ projectId: other.id, changeId: oc.id, text: "z", isFailurePath: false });
    const list = record.listCriteria(project.id);
    expect(list).toHaveLength(3);
    expect(list.map((c) => c.isFailurePath)).toEqual([false, true, false]);
  });

  it("reopening the same file keeps data", () => {
    const path = join(mkdtempSync(join(tmpdir(), "record-")), "copilot.db");
    const first = CopilotRecord.open(path);
    const project = first.createProject({ name: "Persist", repoUrl: "r", appUrl: "https://app.example.com" });
    first.close();
    const second = CopilotRecord.open(path);
    expect(second.getProject(project.id)).toEqual(project);
    second.close();
  });
  it("closes runs left running by a restart", () => {
    const record = CopilotRecord.open(":memory:");
    const project = record.createProject({ name: "Runs", repoUrl: "r" });
    const change = record.createChange({ projectId: project.id, title: "T", description: "D", kind: "feature" });
    const done = record.startRun({ changeId: change.id, role: "ba", commit: "a" });
    record.finishRun(done, "done");
    record.startRun({ changeId: change.id, role: "qa", commit: "a" });
    expect(record.closeInterruptedRuns()).toBe(1);
    expect(record.acceptanceRecord(change.id).runs.map((r) => r.status)).toEqual(["done", "failed"]);
    expect(record.closeInterruptedRuns()).toBe(0);
  });
});

describe("record: documents and requirements", () => {
  const save = (record: CopilotRecord, projectId: string, body: string) =>
    record.saveDocumentVersion({ projectId, name: "docs/PRD.md", source: "repo", body, commit: "abc1234" });

  it("keeps one version per content and reports changes", () => {
    const { record, project } = fresh();
    const a = save(record, project.id, "# PRD\nOne");
    const b = save(record, project.id, "# PRD\nOne");
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(b.version.id).toBe(a.version.id);
    expect(record.documentVersions(a.document.id)).toHaveLength(1);
    save(record, project.id, "# PRD\nTwo");
    expect(record.documentVersions(a.document.id)).toHaveLength(2);
    const [doc] = record.listDocuments(project.id);
    expect(doc).toMatchObject({ name: "docs/PRD.md", source: "repo", versions: 2 });
    expect(doc!.latest.body).toBe("# PRD\nTwo");
  });

  it("applies requirements by key: added, changed, removed, with events", () => {
    const { record, project } = fresh();
    const v1 = save(record, project.id, "v1");
    const r1 = record.applyRequirements(v1.document.id, v1.version.id, [
      { key: "FR-1", text: "a", quote: "a", line: 1 },
      { key: "FR-2", text: "b", quote: "b", line: 2 },
    ]);
    expect(r1.added.map((r) => r.key)).toEqual(["FR-1", "FR-2"]);
    const v2 = save(record, project.id, "v2");
    const r2 = record.applyRequirements(v2.document.id, v2.version.id, [
      { key: "FR-1", text: "a2", quote: "a2", line: 1 },
      { key: "FR-3", text: "c", quote: "c", line: 3 },
    ]);
    expect(r2.added.map((r) => r.key)).toEqual(["FR-3"]);
    expect(r2.changed.map((r) => r.key)).toEqual(["FR-1"]);
    expect(r2.removed.map((r) => r.key)).toEqual(["FR-2"]);
    const fr1 = r2.changed[0]!;
    expect(record.requirementEvents(fr1.id).map((e) => e.kind)).toEqual(["added", "changed"]);
    expect(record.listRequirements(project.id, { status: "active" }).map((r) => r.key)).toEqual(["FR-1", "FR-3"]);
    expect(record.listRequirements(project.id).map((r) => r.key)).toEqual(["FR-1", "FR-2", "FR-3"]);
    // A removed requirement that comes back is active again.
    const v3 = save(record, project.id, "v3");
    const r3 = record.applyRequirements(v3.document.id, v3.version.id, [
      { key: "FR-1", text: "a2", quote: "a2", line: 1 },
      { key: "FR-2", text: "b", quote: "b", line: 2 },
      { key: "FR-3", text: "c", quote: "c", line: 3 },
    ]);
    expect(r3.added.map((r) => r.key)).toEqual(["FR-2"]);
    expect(r3.changed).toEqual([]);
  });

  it("links requirements idempotently", () => {
    const { record, project } = fresh();
    const v = save(record, project.id, "v1");
    const [req] = record.applyRequirements(v.document.id, v.version.id, [{ key: "FR-1", text: "a", quote: "a", line: 1 }]).added;
    record.linkRequirement(req!.id, "linear_issue", "ENG-12");
    record.linkRequirement(req!.id, "linear_issue", "ENG-12");
    record.linkRequirement(req!.id, "criterion", "k1");
    expect(record.requirementLinks(req!.id).map((l) => [l.toType, l.toId])).toEqual([
      ["linear_issue", "ENG-12"],
      ["criterion", "k1"],
    ]);
  });

  it("stores document settings and external posts", () => {
    const { record, project } = fresh();
    expect(record.docSettings(project.id)).toEqual({ include: [], exclude: [] });
    record.setDocSettings(project.id, { include: ["README.md"], exclude: [] });
    expect(record.docSettings(project.id)).toEqual({ include: ["README.md"], exclude: [] });
    expect(record.externalPost("linear", "ENG-12")).toBeNull();
    record.saveExternalPost("linear", "ENG-12", "c1", "h1");
    record.saveExternalPost("linear", "ENG-12", "c1", "h2");
    expect(record.externalPost("linear", "ENG-12")).toEqual({ commentId: "c1", bodyHash: "h2" });
  });
});
