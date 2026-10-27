import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CopilotRecord, type FindingInput } from "../src/index.js";

function setup() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "Demo", repoUrl: "r" });
  const change = record.createChange({ projectId: project.id, title: "c1", description: "d", kind: "feature" });
  const input = (over: Partial<FindingInput> = {}): FindingInput => ({
    projectId: project.id,
    changeId: change.id,
    runId: "run-1",
    role: "compliance",
    stage: "verification",
    kind: "legal",
    title: "Personal data is stored without a stated purpose",
    plain: "The signup form keeps emails but never says why.",
    costIfIgnored: "A regulator may ask you to explain.",
    fixPrompt: "Add a purpose line to the signup form.",
    trigger: { type: "code", file: "src/signup.ts", line: 12, commit: "abc123" },
    citationId: "ndpa-s24",
    ...over,
  });
  return { record, project, change, input };
}

describe("findings", () => {
  it("new finding starts open", () => {
    const { record, project, input } = setup();
    const { finding, isNew } = record.addFinding(input());
    expect(isNew).toBe(true);
    expect(finding.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.findingStatus(finding.id)).toBe("open");
    const listed = record.listFindings({ projectId: project.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: finding.id, status: "open", citationId: "ndpa-s24" });
    expect(record.findingEvidence(finding.id)).toHaveLength(1);
  });

  it("findings have no update path", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../src/record/record.ts"), "utf8");
    expect(source).not.toMatch(/UPDATE\s+findings\b/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+findings\b/i);
    expect(Object.getOwnPropertyNames(CopilotRecord.prototype)).not.toContain("updateFinding");
  });

  it("the database refuses to rewrite or delete a finding", () => {
    const path = join(mkdtempSync(join(tmpdir(), "findings-")), "copilot.db");
    const record = CopilotRecord.open(path);
    const p = record.createProject({ name: "P", repoUrl: "r" });
    const c = record.createChange({ projectId: p.id, title: "c", description: "d", kind: "fix" });
    record.addFinding({
      projectId: p.id,
      changeId: c.id,
      runId: "r",
      role: "qa",
      stage: "verification",
      kind: "failure_path",
      title: "t",
      plain: "p",
      costIfIgnored: "x",
      fixPrompt: "f",
      trigger: { type: "doc", quote: "q" },
    });
    record.close();
    const raw = new DatabaseSync(path);
    expect(() => raw.exec("UPDATE findings SET title = 'changed'")).toThrow(/immutable/);
    expect(() => raw.exec("DELETE FROM findings")).toThrow(/immutable/);
    raw.close();
  });

  it("duplicate title in same project returns existing finding with isNew false", () => {
    const { record, project, input } = setup();
    const first = record.addFinding(input());
    const again = record.addFinding(
      input({
        runId: "run-2",
        title: "  PERSONAL data is stored   without a stated purpose ",
        plain: "Different wording.",
        trigger: { type: "code", file: "src/other.ts", line: 3, commit: "def456" },
      }),
    );
    expect(again.isNew).toBe(false);
    expect(again.finding.id).toBe(first.finding.id);
    expect(again.finding.title).toBe("Personal data is stored without a stated purpose");
    expect(again.finding.plain).toBe("The signup form keeps emails but never says why.");
    expect(again.finding.trigger).toEqual({ type: "code", file: "src/signup.ts", line: 12, commit: "abc123" });
    expect(record.listFindings({ projectId: project.id })).toHaveLength(1);
    const evidence = record.findingEvidence(first.finding.id);
    expect(evidence).toHaveLength(2);
    expect(evidence[1]).toMatchObject({
      runId: "run-2",
      trigger: { type: "code", file: "src/other.ts", line: 3, commit: "def456" },
    });
  });

  it("the same title in another project or role is a different finding", () => {
    const { record, input } = setup();
    const other = record.createProject({ name: "Other", repoUrl: "r2" });
    const oc = record.createChange({ projectId: other.id, title: "c", description: "d", kind: "fix" });
    const a = record.addFinding(input());
    const b = record.addFinding(input({ projectId: other.id, changeId: oc.id }));
    const c = record.addFinding(input({ role: "qa" }));
    expect(new Set([a.finding.id, b.finding.id, c.finding.id]).size).toBe(3);
    expect(b.isNew && c.isNew).toBe(true);
  });

  it('a fixed finding raised again reopens with reason "Raised again"', () => {
    const { record, input } = setup();
    const { finding } = record.addFinding(input());
    record.setFindingStatus(finding.id, "fixed", "Added purpose line", "alice");
    expect(record.findingStatus(finding.id)).toBe("fixed");
    record.addFinding(input({ runId: "run-3" }));
    expect(record.findingStatus(finding.id)).toBe("open");
    const history = record.findingHistory(finding.id);
    expect(history[history.length - 1]).toMatchObject({ status: "open", reason: "Raised again" });
  });

  it("raising an accepted risk again does not reopen it", () => {
    const { record, input } = setup();
    const { finding } = record.addFinding(input());
    record.setFindingStatus(finding.id, "accepted_risk", "Low impact", "alice");
    record.addFinding(input({ runId: "run-3" }));
    expect(record.findingStatus(finding.id)).toBe("accepted_risk");
  });

  it("history lists every status change in order", () => {
    const { record, input } = setup();
    const { finding } = record.addFinding(input());
    record.setFindingStatus(finding.id, "deferred", "Next sprint", "alice");
    record.setFindingStatus(finding.id, "fixed", "Done", "bob");
    record.setFindingStatus(finding.id, "open", "Came back", "bob");
    const history = record.findingHistory(finding.id);
    expect(history.map((h) => h.status)).toEqual(["open", "deferred", "fixed", "open"]);
    expect(history.map((h) => h.actor)).toEqual(["copilot", "alice", "bob", "bob"]);
    expect(history[1]).toMatchObject({ reason: "Next sprint" });
    expect(history[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("setFindingStatus rejects an unknown finding", () => {
    const { record } = setup();
    expect(() => record.setFindingStatus("nope", "fixed", "x", "a")).toThrow();
  });

  it("listFindings filters by change through raised_on, by status and by project", () => {
    const { record, project, change, input } = setup();
    const c2 = record.createChange({ projectId: project.id, title: "c2", description: "d", kind: "fix" });
    const a = record.addFinding(input());
    const b = record.addFinding(input({ title: "Second issue", kind: "operations", role: "architect" }));
    // raised again on a later change: shows on both
    record.addFinding(input({ changeId: c2.id, runId: "run-9" }));
    record.setFindingStatus(b.finding.id, "fixed", "ok", "alice");

    expect(record.listFindings({ changeId: change.id }).map((f) => f.id).sort()).toEqual(
      [a.finding.id, b.finding.id].sort(),
    );
    expect(record.listFindings({ changeId: c2.id }).map((f) => f.id)).toEqual([a.finding.id]);
    expect(record.listFindings({ projectId: project.id, status: "fixed" }).map((f) => f.id)).toEqual([b.finding.id]);
    expect(record.listFindings({ changeId: change.id, status: "open" }).map((f) => f.id)).toEqual([a.finding.id]);
  });
});
