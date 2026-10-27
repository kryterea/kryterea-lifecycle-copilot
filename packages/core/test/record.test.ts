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
});
