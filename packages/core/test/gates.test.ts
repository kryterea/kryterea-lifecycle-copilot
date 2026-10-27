import { describe, expect, it } from "vitest";
import { CopilotRecord, ledgerFor, type FindingInput } from "../src/index.js";

function setup() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "Demo", repoUrl: "r" });
  const change = record.createChange({ projectId: project.id, title: "c1", description: "d", kind: "feature" });
  return { record, project, change };
}

describe("runs, gates, links, acceptance", () => {
  it("spentUsd counts a running run's costs immediately", () => {
    const { record, change } = setup();
    expect(record.spentUsd()).toBe(0);
    const r1 = record.startRun({ changeId: change.id, role: "qa", commit: "abc" });
    record.addRunCost(r1, 0.25, 100, 50);
    record.addRunCost(r1, 0.5, 10, 5);
    expect(record.spentUsd()).toBeCloseTo(0.75);
    const r2 = record.startRun({ changeId: change.id, role: "po", commit: "abc" });
    record.addRunCost(r2, 1, 1, 1);
    record.finishRun(r1, "done");
    expect(record.spentUsd()).toBeCloseTo(1.75);
    const runs = record.acceptanceRecord(change.id).runs;
    expect(runs).toEqual([
      { id: r1, role: "qa", commit: "abc", status: "done", costUsd: 0.75 },
      { id: r2, role: "po", commit: "abc", status: "running", costUsd: 1 },
    ]);
    expect(() => record.addRunCost("missing", 1, 1, 1)).toThrow();
  });

  it("ledgerFor writes through to the run and reports total spend across runs", () => {
    const { record, change } = setup();
    const r1 = record.startRun({ changeId: change.id, role: "qa", commit: "abc" });
    const r2 = record.startRun({ changeId: change.id, role: "po", commit: "abc" });
    record.addRunCost(r1, 2, 1, 1);
    const ledger = ledgerFor(record, r2);
    expect(ledger.spentUsd()).toBeCloseTo(2);
    ledger.add(0.5, 10, 20);
    expect(ledger.spentUsd()).toBeCloseTo(2.5);
    expect(record.spentUsd()).toBeCloseTo(2.5);
  });

  it("finishRun can record a budget stop", () => {
    const { record, change } = setup();
    const r = record.startRun({ changeId: change.id, role: "qa", commit: "abc" });
    record.finishRun(r, "stopped_budget");
    expect(record.acceptanceRecord(change.id).runs[0]?.status).toBe("stopped_budget");
    expect(() => record.finishRun("missing", "done")).toThrow();
  });

  it("lastRunCommit returns the commit of the newest finished run in the project", () => {
    const { record, project, change } = setup();
    expect(record.lastRunCommit(project.id)).toBeNull();
    const r1 = record.startRun({ changeId: change.id, role: "qa", commit: "c1" });
    expect(record.lastRunCommit(project.id)).toBeNull();
    record.finishRun(r1, "done");
    const c2 = record.createChange({ projectId: project.id, title: "c2", description: "d", kind: "fix" });
    const r2 = record.startRun({ changeId: c2.id, role: "qa", commit: "c2" });
    record.finishRun(r2, "done");
    const r3 = record.startRun({ changeId: c2.id, role: "qa", commit: "c3" });
    record.finishRun(r3, "stopped_budget");
    expect(record.lastRunCommit(project.id)).toBe("c2");
    const other = record.createProject({ name: "Other", repoUrl: "x" });
    expect(record.lastRunCommit(other.id)).toBeNull();
  });

  it("lastRunCommit can filter by role, so a later run of another role does not move the baseline", () => {
    const { record, project, change } = setup();
    const q = record.startRun({ changeId: change.id, role: "qa", commit: "q1" });
    record.finishRun(q, "done");
    const b = record.startRun({ changeId: change.id, role: "ba", commit: "b2" });
    record.finishRun(b, "done");
    expect(record.lastRunCommit(project.id)).toBe("b2");
    expect(record.lastRunCommit(project.id, "qa")).toBe("q1");
    expect(record.lastRunCommit(project.id, "po")).toBeNull();
  });

  it("firstRunCommit returns the oldest finished run's commit, of one role when given", () => {
    const { record, project, change } = setup();
    expect(record.firstRunCommit(project.id, "qa")).toBeNull();
    const s = record.startRun({ changeId: change.id, role: "qa", commit: "q0" });
    record.finishRun(s, "stopped_budget");
    const b = record.startRun({ changeId: change.id, role: "ba", commit: "b1" });
    record.finishRun(b, "done");
    for (const commit of ["q1", "q2"]) record.finishRun(record.startRun({ changeId: change.id, role: "qa", commit }), "done");
    expect(record.firstRunCommit(project.id)).toBe("b1");
    expect(record.firstRunCommit(project.id, "qa")).toBe("q1");
  });

  it("checked commit is stored per project and overwritten", () => {
    const { record, project } = setup();
    const other = record.createProject({ name: "Other", repoUrl: "x" });
    expect(record.checkedCommit(project.id)).toBeNull();
    record.setCheckedCommit(project.id, "a1");
    record.setCheckedCommit(project.id, "b2");
    record.setCheckedCommit(other.id, "z9");
    expect(record.checkedCommit(project.id)).toBe("b2");
    expect(record.checkedCommit(other.id)).toBe("z9");
  });

  it("latest gate state wins", () => {
    const { record, change } = setup();
    expect(record.gates(change.id)).toEqual({});
    record.recordGate(change.id, "qa", "held", "Two criteria have gaps");
    record.recordGate(change.id, "compliance", "held", "Check this");
    record.recordGate(change.id, "qa", "cleared", "All criteria have evidence");
    const gates = record.gates(change.id);
    expect(gates.qa).toMatchObject({ state: "cleared", reason: "All criteria have evidence" });
    expect(gates.compliance).toMatchObject({ state: "held", reason: "Check this" });
    expect(gates.qa?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(gates.po).toBeUndefined();
  });

  it("latestCheck returns the newest check", () => {
    const { record, project, change } = setup();
    const crit = record.addCriterion({ projectId: project.id, changeId: change.id, text: "t", isFailurePath: false });
    expect(record.latestCheck(crit.id)).toBeNull();
    const run = record.startRun({ changeId: change.id, role: "qa", commit: "abc" });
    record.recordCheck({ criterionId: crit.id, runId: run, state: "no_evidence", evidence: [], note: "first" });
    const evidence = [{ type: "code" as const, file: "a.ts", line: 3, commit: "abc" }];
    record.recordCheck({ criterionId: crit.id, runId: run, state: "evidence_found", evidence, note: "second" });
    expect(record.latestCheck(crit.id)).toEqual({
      criterionId: crit.id,
      runId: run,
      state: "evidence_found",
      evidence,
      note: "second",
    });
  });

  it("links are idempotent and read back with linksTo", () => {
    const { record, project, change } = setup();
    const crit = record.addCriterion({ projectId: project.id, changeId: change.id, text: "t", isFailurePath: false });
    record.link({ type: "change", id: change.id }, "affects", { type: "criterion", id: crit.id });
    record.link({ type: "change", id: change.id }, "affects", { type: "criterion", id: crit.id });
    record.link({ type: "artifact", id: "a1" }, "satisfies", { type: "criterion", id: crit.id });
    const links = record.linksTo({ type: "criterion", id: crit.id });
    expect(links).toHaveLength(2);
    expect(links).toContainEqual({ from: { type: "change", id: change.id }, rel: "affects" });
    expect(links).toContainEqual({ from: { type: "artifact", id: "a1" }, rel: "satisfies" });
    // 'verifies' was dropped from the vocabulary
    expect(() =>
      record.link({ type: "a", id: "1" }, "verifies" as unknown as "affects", { type: "criterion", id: crit.id }),
    ).toThrow();
  });

  it("acceptanceRecord lists criteria with latest state, open findings, gates and decisions", () => {
    const { record, project, change } = setup();
    const earlier = record.createChange({ projectId: project.id, title: "old", description: "d", kind: "feature" });
    const own = record.addCriterion({ projectId: project.id, changeId: change.id, text: "own", isFailurePath: false });
    const fail = record.addCriterion({ projectId: project.id, changeId: change.id, text: "fail", isFailurePath: true });
    const old = record.addCriterion({ projectId: project.id, changeId: earlier.id, text: "old", isFailurePath: false });
    const untouched = record.addCriterion({ projectId: project.id, changeId: earlier.id, text: "x", isFailurePath: false });
    record.link({ type: "change", id: change.id }, "affects", { type: "criterion", id: old.id });
    record.link({ type: "change", id: change.id }, "affects", { type: "criterion", id: own.id });

    const run = record.startRun({ changeId: change.id, role: "qa", commit: "abc" });
    record.recordCheck({ criterionId: own.id, runId: run, state: "evidence_found", evidence: [], note: "ok" });
    record.recordCheck({ criterionId: old.id, runId: run, state: "gap", evidence: [], note: "gap" });

    const base = (over: Partial<FindingInput>): FindingInput => ({
      projectId: project.id,
      changeId: change.id,
      runId: run,
      role: "qa",
      stage: "verification",
      kind: "failure_path",
      title: "x",
      plain: "p",
      costIfIgnored: "c",
      fixPrompt: "f",
      trigger: { type: "doc", quote: "q" },
      ...over,
    });
    const a = record.addFinding(base({ title: "Open one" }));
    const b = record.addFinding(base({ title: "Accepted one" }));
    const elsewhere = record.addFinding(base({ title: "On other change", changeId: earlier.id }));
    record.setFindingStatus(b.finding.id, "accepted_risk", "Low impact", "alice");
    record.recordGate(change.id, "qa", "held", "A gap remains");

    const ar = record.acceptanceRecord(change.id);
    expect(ar.change.id).toBe(change.id);
    const byId = new Map(ar.criteria.map((c) => [c.id, c.latest]));
    expect(byId.get(own.id)).toBe("evidence_found");
    expect(byId.get(old.id)).toBe("gap");
    expect(byId.get(fail.id)).toBeNull();
    expect(byId.has(untouched.id)).toBe(false);
    expect(ar.criteria).toHaveLength(3);
    expect(ar.findings.map((f) => [f.id, f.status]).sort()).toEqual(
      [
        [a.finding.id, "open"],
        [b.finding.id, "accepted_risk"],
      ].sort(),
    );
    expect(ar.findings.map((f) => f.id)).not.toContain(elsewhere.finding.id);
    expect(ar.gates.qa).toMatchObject({ state: "held", reason: "A gap remains" });
    expect(ar.decisions).toHaveLength(1);
    expect(ar.decisions[0]).toMatchObject({
      findingId: b.finding.id,
      status: "accepted_risk",
      reason: "Low impact",
      actor: "alice",
    });
    expect(ar.runs).toHaveLength(1);
  });

  it("acceptanceRecord carries the latest acceptance_summary, null when none", () => {
    const { record, change } = setup();
    expect(record.acceptanceRecord(change.id).summary).toBeNull();
    const add = (body: unknown) => record.addArtifact({ changeId: change.id, role: "po", stage: "acceptance", kind: "acceptance_summary", body });
    add({ summary: "First." });
    add({ summary: "Second." });
    record.addArtifact({ changeId: change.id, role: "po", stage: "acceptance", kind: "acceptance", body: { actor: "a" } });
    expect(record.acceptanceRecord(change.id).summary).toBe("Second.");
  });
});
