import { describe, expect, it } from "vitest";
import { compareCommits, CopilotRecord } from "../src/index.js";

const tick = () => new Promise((r) => setTimeout(r, 5));
const A = "a".repeat(40);
const B = "b".repeat(40);

async function twoCommits() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "LagosPay", repoUrl: "x" });
  const change = record.createChange({ projectId: project.id, title: "Baseline", description: "d", kind: "understand" });
  const k1 = record.addCriterion({ projectId: project.id, changeId: change.id, text: "A paid link is marked paid once", isFailurePath: true });
  const k2 = record.addCriterion({ projectId: project.id, changeId: change.id, text: "A refund marks the payment refunded", isFailurePath: false });
  const finding = (runId: string, title: string, kind: "failure_path" | "legal") =>
    record.addFinding({
      projectId: project.id, changeId: change.id, runId, role: kind === "legal" ? "compliance" : "qa", stage: "verification", kind, title,
      plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "server.js", line: 1, commit: A },
    }).finding;

  const runA = record.startRun({ changeId: change.id, role: "qa", commit: A });
  record.recordCheck({ criterionId: k1.id, runId: runA, state: "gap", evidence: [], note: "" });
  record.recordCheck({ criterionId: k2.id, runId: runA, state: "no_evidence", evidence: [], note: "" });
  const repeat = finding(runA, "A repeated webhook marks a payment paid twice", "failure_path");
  const notice = finding(runA, "Check this: no notice before card data is collected", "legal");
  record.finishRun(runA, "done");
  await tick();

  const runB = record.startRun({ changeId: change.id, role: "qa", commit: B });
  record.recordCheck({ criterionId: k1.id, runId: runB, state: "evidence_found", evidence: [], note: "" });
  record.recordCheck({ criterionId: k2.id, runId: runB, state: "evidence_found", evidence: [], note: "" });
  record.setFindingStatus(repeat.id, "fixed", "Not raised again", "qa");
  const logs = finding(runB, "Card numbers reach the server log", "failure_path");
  record.finishRun(runB, "done");
  await tick();
  // Decided after the last check at B, while B is still the latest commit.
  record.setFindingStatus(notice.id, "accepted_risk", "Notice goes live with the next release", "Ada Obi");
  return { record, project, repeat, notice, logs, k1, k2 };
}

describe("compareCommits", () => {
  it("shows open items and evidence as they stood at each commit", async () => {
    const t = await twoCommits();
    const cmp = compareCommits(t.record, t.project.id, "aaaaaaa", "bbbbbbb")!;
    expect(cmp.from).toMatchObject({ sha: A, open: 2, evidenceFound: 0, gaps: 1, noEvidence: 1 });
    expect(cmp.to).toMatchObject({ sha: B, open: 1, evidenceFound: 2, gaps: 0, noEvidence: 0 });
    expect(cmp.findings).toEqual([
      expect.objectContaining({ id: t.repeat.id, from: "open", to: "fixed" }),
      expect.objectContaining({ id: t.notice.id, kind: "legal", from: "open", to: "accepted_risk" }),
      expect.objectContaining({ id: t.logs.id, from: null, to: "open" }),
    ]);
    expect(cmp.criteria).toEqual([
      expect.objectContaining({ id: t.k1.id, from: "gap", to: "evidence_found" }),
      expect.objectContaining({ id: t.k2.id, from: "no_evidence", to: "evidence_found" }),
    ]);
  });

  it("reads the same either way round and is null for a commit Kryterea never checked", async () => {
    const t = await twoCommits();
    const back = compareCommits(t.record, t.project.id, B, A)!;
    expect(back.from.open).toBe(1);
    expect(back.to.open).toBe(2);
    expect(compareCommits(t.record, t.project.id, A, "c".repeat(40))).toBeNull();
    expect(compareCommits(t.record, t.project.id, "not-a-sha", B)).toBeNull();
  });
});
