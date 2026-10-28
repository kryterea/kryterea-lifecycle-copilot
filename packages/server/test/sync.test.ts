import { describe, expect, it } from "vitest";
import { CopilotRecord } from "@lifecycle/core";
import { Jobs } from "../src/app.js";
import { syncAfterJob, syncExternal, type SyncDeps } from "../src/sync.js";

const SHA = "b".repeat(40);

function fresh() {
  const record = CopilotRecord.open(":memory:");
  const project = record.createProject({ name: "LagosPay", repoUrl: "https://github.com/kryterea/lagospay" });
  const change = record.createChange({ projectId: project.id, title: "Understand", description: "d", kind: "understand" });
  const runId = record.startRun({ changeId: change.id, role: "qa", commit: SHA });
  const doc = record.saveDocumentVersion({ projectId: project.id, name: "docs/PRD.md", source: "repo", body: "v1", commit: null });
  const [req] = record.applyRequirements(doc.document.id, doc.version.id, [{ key: "FR-1", text: "Merchants refund a payment", quote: "refund", line: 4 }]).added;
  const k = record.addCriterion({ projectId: project.id, changeId: change.id, text: "A refund marks the payment refunded", isFailurePath: false });
  record.linkRequirement(req!.id, "criterion", k.id);
  record.recordCheck({ criterionId: k.id, runId, state: "gap", evidence: [], note: "" });
  record.addFinding({
    projectId: project.id, changeId: change.id, runId, role: "qa", stage: "operate", kind: "failure_path", criterionId: k.id,
    title: "Refund twice", plain: "p", costIfIgnored: "c", fixPrompt: "f", trigger: { type: "code", file: "server.js", line: 120, commit: SHA },
  });
  const calls: string[] = [];
  const linear = {
    issue: async (id: string) => (calls.push(`issue ${id}`), { id: `uuid-${id}`, identifier: id, title: "t", url: "u" }),
    upsertComment: async (issueId: string, commentId: string | null, body: string) => (calls.push(`linear ${issueId} ${commentId} ${body.split("\n")[0]}`), "lc-1"),
  };
  const pulls: Array<{ number: number; headSha: string }> = [];
  const gh = {
    openPulls: async () => (calls.push("pulls"), pulls),
    upsertPullComment: async (n: number, commentId: string | null) => (calls.push(`pr ${n} ${commentId}`), "pc-1"),
    upsertCommitComment: async (sha: string, commentId: string | null) => (calls.push(`commit ${sha.slice(0, 7)} ${commentId}`), "cc-1"),
  };
  const deps: SyncDeps = { record, linear, github: () => gh };
  return { record, project, req: req!, calls, pulls, deps, linear, gh };
}

describe("syncExternal", () => {
  it("comments on each linked Linear ticket and on the head commit when there is no pull request", async () => {
    const t = fresh();
    t.record.linkRequirement(t.req.id, "linear_issue", "ENG-12");
    expect(await syncExternal(t.deps, t.project.id, SHA)).toEqual({ linear: "ok", github: "ok" });
    expect(t.calls).toEqual(["issue ENG-12", "linear uuid-ENG-12 null **Kryterea on ENG-12 Merchants refund a payment**", "pulls", "commit bbbbbbb null"]);
  });

  it("comments on each open pull request instead of the commit", async () => {
    const t = fresh();
    t.pulls.push({ number: 4, headSha: SHA }, { number: 5, headSha: "c".repeat(40) });
    await syncExternal(t.deps, t.project.id, SHA);
    expect(t.calls).toEqual(["pulls", "pr 4 null", "pr 5 null"]);
  });

  it("unchanged items make no comment call; a change edits the same comment", async () => {
    const t = fresh();
    t.record.linkRequirement(t.req.id, "linear_issue", "ENG-12");
    t.pulls.push({ number: 4, headSha: SHA });
    await syncExternal(t.deps, t.project.id, SHA);
    t.calls.length = 0;
    await syncExternal(t.deps, t.project.id, SHA);
    expect(t.calls).toEqual(["pulls"]);
    const [f] = t.record.listFindings({ projectId: t.project.id, status: "open" });
    t.record.setFindingStatus(f!.id, "accepted_risk", "Refunds are manual for now", "Ada");
    t.calls.length = 0;
    await syncExternal(t.deps, t.project.id, SHA);
    expect(t.calls).toEqual(["issue ENG-12", "linear uuid-ENG-12 lc-1 **Kryterea on ENG-12 Merchants refund a payment**", "pulls", "pr 4 pc-1"]);
  });

  it("Linear down and GitHub 401: sync returns both error texts, recheck result unchanged", async () => {
    const t = fresh();
    t.record.linkRequirement(t.req.id, "linear_issue", "ENG-12");
    const before = JSON.stringify(t.record.listFindings({ projectId: t.project.id }));
    const deps: SyncDeps = {
      record: t.record,
      linear: { ...t.linear, issue: async () => { throw new Error("Could not reach Linear."); } },
      github: () => ({ ...t.gh, openPulls: async () => { throw new Error("GitHub did not accept the token (401)."); } }),
    };
    expect(await syncExternal(deps, t.project.id, SHA)).toEqual({ linear: "Could not reach Linear.", github: "GitHub did not accept the token (401)." });
    expect(JSON.stringify(t.record.listFindings({ projectId: t.project.id }))).toBe(before);
    // Nothing was saved as posted, so the next sync tries again.
    expect(t.record.externalPost("linear", `${t.project.id}/ENG-12`)).toBeNull();
    expect(t.deps.status).toBeUndefined();
  });

  it("missing keys or a repo off github.com turn the connection off", async () => {
    const t = fresh();
    expect(await syncExternal({ record: t.record, linear: null, github: () => null }, t.project.id, SHA)).toEqual({ linear: "off", github: "off" });
    expect(t.calls).toEqual([]);
  });

  it("keeps each connection's state for the Connections screen", async () => {
    const t = fresh();
    t.record.linkRequirement(t.req.id, "linear_issue", "ENG-12");
    const status = new Map();
    await syncExternal({ ...t.deps, status, github: () => ({ ...t.gh, openPulls: async () => { throw new Error("Could not reach GitHub."); } }) }, t.project.id, SHA);
    expect(status.get(t.project.id)).toMatchObject({
      linear: { state: "connected", detail: null, lastComment: "ENG-12" },
      github: { state: "error", detail: "Could not reach GitHub.", lastComment: null },
    });
  });
});

describe("syncAfterJob", () => {
  it("syncs the job's project at its last checked commit once the job settles, even a failed one", async () => {
    const t = fresh();
    const seen: Array<[string, string]> = [];
    t.record.setCheckedCommit(t.project.id, SHA);
    const after = syncAfterJob(t.deps, async (_d, projectId, head) => (seen.push([projectId, head]), { linear: "ok", github: "ok" }));
    const jobs = new Jobs(() => {}, after);
    const change = t.record.listChanges(t.project.id)[0]!;
    jobs.start("advance", change.id, `${t.project.id}/${change.id}`, async () => ({ stoppedForBudget: false }));
    jobs.start("recheck", "other", "other", async () => { throw new Error("boom"); });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([[t.project.id, SHA]]);
    jobs.start("recheck", t.project.id, t.project.id, async () => { throw new Error("boom"); });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([[t.project.id, SHA], [t.project.id, SHA]]);
  });
});
