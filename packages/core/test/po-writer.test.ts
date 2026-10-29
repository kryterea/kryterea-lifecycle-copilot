import { describe, expect, it } from "vitest";
import { writeChanges, type Model, type ModelRequest } from "../src/index.js";

const findings = [
  { id: "f1", role: "qa" as const, title: "Payment is taken twice", plain: "A retry charges the customer again.", where: "src/pay.js:12" },
  { id: "f2", role: "compliance" as const, title: "No consent step", plain: "Names are saved without asking.", where: "docs/prd.md:4" },
];

const change = (title: string, labels: string[]) => ({ title, forWhom: "Customers", why: "They lose money.", findingIds: labels, criteria: [{ text: "It works", isFailurePath: false }] });

function stub(reply: unknown, seen: ModelRequest[] = []): Model {
  return (async (req: ModelRequest) => {
    seen.push(req);
    if (req.name !== "po.writeChanges") throw new Error(`unexpected model call ${req.name}`);
    return { data: reply, usage: { input: 0, output: 0 }, costUsd: 0 };
  }) as Model;
}

describe("writeChanges", () => {
  it("drops unknown ids and empty changes", async () => {
    const out = await writeChanges(
      { problem: null, findings },
      stub({ answersProblem: [], duplicates: [], changes: [change("Stop double charges", ["F1", "F9"]), change("Ghost", ["F9"]), change("Ask for consent", ["F2"])] }),
      "PACK",
    );
    expect(out.changes.map((c) => c.findingIds)).toEqual([["f1"], ["f2"]]);
  });

  it("gives a finding the writer left out its own change", async () => {
    const out = await writeChanges({ problem: null, findings }, stub({ answersProblem: [], duplicates: [], changes: [change("Stop double charges", ["F1"])] }), "PACK");
    expect(out.changes).toHaveLength(2);
    expect(out.changes[1]).toMatchObject({ title: "No consent step", findingIds: ["f2"] });
  });

  it("sends the problem and every finding to the model", async () => {
    const seen: ModelRequest[] = [];
    await writeChanges(
      { problem: "Customers get charged twice.", findings },
      stub({ answersProblem: ["F1"], duplicates: [], changes: [change("a", ["F1"]), change("b", ["F2"])] }, seen),
      "PO PACK MARKER",
    );
    const req = seen[0]!;
    expect(req.system.startsWith("PO PACK MARKER")).toBe(true);
    expect(req.system).toContain("Never use the words");
    expect(req.user).toContain("Customers get charged twice.");
    expect(req.user).toContain("Payment is taken twice");
    expect(req.user).toContain("No consent step");
    expect(req.user).toContain("F1");
    expect(req.user).toContain("F2");
    expect(req.user).not.toContain("f1");
    expect(req.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("tells the writer to keep a legal finding at Check this and cite only the pack", async () => {
    const seen: ModelRequest[] = [];
    await writeChanges({ problem: null, findings }, stub({ answersProblem: [], duplicates: [], changes: [] }, seen), "PACK");
    const system = seen[0]!.system;
    expect(system).toContain('A change that closes a legal finding starts its title with "Check this: "');
    expect(system).toContain("never says the owner is in breach or breaks the law");
    expect(system).toContain("names only the law entries its findings cite from the pack");
  });

  it("a whole repo check has no findings answering a problem", async () => {
    const out = await writeChanges({ problem: null, findings }, stub({ answersProblem: ["F1"], duplicates: [], changes: [change("a", ["F1", "F2"])] }), "PACK");
    expect(out.answersProblem).toEqual([]);
  });

  it("maps answersProblem and duplicates back to ids", async () => {
    const out = await writeChanges(
      { problem: "p", findings },
      stub({ answersProblem: ["F2", "F7"], duplicates: [["F1", "F2"], ["F1", "F9"]], changes: [change("a", ["F1", "F2"])] }),
      "PACK",
    );
    expect(out.answersProblem).toEqual(["f2"]);
    expect(out.duplicates).toEqual([["f1", "f2"]]);
  });
});
