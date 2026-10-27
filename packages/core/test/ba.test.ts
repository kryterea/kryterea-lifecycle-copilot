import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyseChange,
  analyseImpact,
  baGate,
  systemPrompt,
  understandApp,
  type Criterion,
  type CopilotRecord,
  type Model,
  type ModelRequest,
  type Packs,
  type RoleContext,
} from "../src/index.js";

const PACK = "BA PACK MARKER: you are the business analyst.";
const dir = mkdtempSync(join(tmpdir(), "lifecycle-ba-"));
const COMMIT = "abc1234";

beforeAll(() => {
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "server.ts"), "import express from 'express';\nconst app = express();\napp.post('/booking', book);\napp.listen(3000);\n");
  writeFileSync(join(dir, "src", "payment.ts"), "export function charge() {}\nexport function deposit() {}\n");
  writeFileSync(join(dir, "README.md"), "# Salon\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const packs: Packs = {
  role: { ba: PACK, architect: "", qa: "", compliance: "", po: "" },
  legal: [],
};

type Handler = (req: ModelRequest) => unknown;
function stub(handlers: Record<string, Handler>, seen: ModelRequest[] = []): Model {
  return (async (req: ModelRequest) => {
    seen.push(req);
    const h = handlers[req.name];
    if (!h) throw new Error(`unexpected model call ${req.name}`);
    return { data: h(req), usage: { input: 0, output: 0 }, costUsd: 0 };
  }) as Model;
}

function ctx(model: Model, over: Partial<RoleContext> = {}): RoleContext {
  return {
    record: {} as CopilotRecord,
    model,
    packs,
    project: { id: "p1", name: "Salon", repoUrl: "x", appUrl: null, createdAt: "t" },
    change: { id: "c1", projectId: "p1", title: "Add deposits", description: "Customers pay a 20 percent deposit when they book.", kind: "feature", stage: "analysis", createdAt: "t" },
    repo: { dir, commit: COMMIT },
    runId: "r1",
    existingFindings: [{ id: "f1", title: "Double click on Pay charges twice", kind: "failure_path" }],
    answers: [],
    ...over,
  };
}

const finding = (over: Record<string, unknown> = {}) => ({
  title: "A finding",
  plain: "plain",
  costIfIgnored: "cost",
  fixPrompt: "fix",
  triggerType: "code",
  file: "src/server.ts",
  line: 3,
  quote: null,
  ...over,
});

const asBuilt = { flows: ["Book a slot"], dataCollected: ["Name"], payments: ["Paystack"], roles: ["Admin"] };

describe("understandApp", () => {
  it("returns questions and an as_built artifact, and no criteria", async () => {
    const seen: ModelRequest[] = [];
    const model = stub(
      {
        "ba.understandApp": () => ({
          asBuilt,
          questions: ["q1", "q2", "q3", "q4"],
          findings: [finding(), finding({ title: "Bad cite", file: "src/missing.ts" }), finding({ title: "Bad line", line: 99 })],
        }),
      },
      seen,
    );
    const r = await understandApp(ctx(model));
    expect(r.criteria).toEqual([]);
    expect(r.questions).toEqual(["q1", "q2", "q3"]);
    expect(r.artifacts).toEqual([{ kind: "as_built", body: asBuilt }]);
    expect(r.findings.map((f) => f.title)).toEqual(["A finding"]);
    expect(r.findings[0]!.kind).toBe("failure_path");
    expect(r.findings[0]!.trigger).toEqual({ type: "code", file: "src/server.ts", line: 3, commit: COMMIT });
    expect(seen[0]!.maxOutputTokens).toBe(16000);
    expect(seen[0]!.reasoningEffort).toBe("medium");
  });

  it("sends at most 40 files and 60k characters of material", async () => {
    const big = mkdtempSync(join(tmpdir(), "lifecycle-ba-big-"));
    try {
      for (let i = 0; i < 50; i++) writeFileSync(join(big, `booking${i}.ts`), `// booking route\n${"x".repeat(3000)}\n`);
      const seen: ModelRequest[] = [];
      const model = stub({ "ba.understandApp": () => ({ asBuilt, questions: [], findings: [] }) }, seen);
      await understandApp(ctx(model, { repo: { dir: big, commit: COMMIT } }));
      const user = seen[0]!.user;
      expect((user.match(/^=== /gm) ?? []).length).toBeLessThanOrEqual(40);
      expect(user.length).toBeLessThan(60_000 + 2_000);
      expect(user).toContain("[truncated]");
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });
});

describe("baGate", () => {
  it("held with unanswered questions, cleared once answers exist", () => {
    expect(baGate(["q"], []).state).toBe("held");
    expect(baGate(["q"], ["a"]).state).toBe("cleared");
    expect(baGate([], []).state).toBe("cleared");
  });
});

describe("analyseImpact", () => {
  const existing: Criterion[] = [
    { id: "id-a", projectId: "p1", changeId: "c0", text: "Booking confirms", isFailurePath: false, createdAt: "t" },
    { id: "id-b", projectId: "p1", changeId: "c0", text: "Declined card shows a message", isFailurePath: true, createdAt: "t" },
  ];

  it("drops affected ids that do not exist", async () => {
    const seen: ModelRequest[] = [];
    const model = stub(
      {
        "ba.analyseImpact": () => ({
          summary: "s",
          affected: ["C2", "C9", "bogus", "C2"],
          criteria: [{ text: "Deposit is shown", isFailurePath: false }],
          findings: [],
        }),
      },
      seen,
    );
    const r = await analyseImpact(ctx(model), existing);
    expect(r.affectedCriterionIds).toEqual(["id-b"]);
    expect(r.criteria).toEqual([{ text: "Deposit is shown", isFailurePath: false }]);
    expect(seen[0]!.user).toContain("C1: Booking confirms");
    expect(seen[0]!.user).toContain("C2: Declined card shows a message");
    expect(seen[0]!.maxOutputTokens).toBe(8000);
  });
});

describe("analyseChange", () => {
  it("flags failure path criteria with isFailurePath", async () => {
    const model = stub({
      "ba.analyseChange": () => ({
        summary: "s",
        criteria: [
          { text: "Customer sees the deposit amount", isFailurePath: false },
          { text: "A declined card keeps the slot free", isFailurePath: true },
        ],
        questions: [],
        findings: [],
      }),
    });
    const r = await analyseChange(ctx(model));
    expect(r.criteria.map((c) => c.isFailurePath)).toEqual([false, true]);
  });

  it("quotes the pasted document in doc triggers", async () => {
    const model = stub({
      "ba.analyseChange": () => ({
        summary: "s",
        criteria: [],
        questions: [],
        findings: [
          finding({ title: "Kept", triggerType: "doc", file: null, line: null, quote: "pay a 20 percent deposit" }),
          finding({ title: "Dropped", triggerType: "doc", file: null, line: null, quote: "a 50 percent deposit" }),
        ],
      }),
    });
    const r = await analyseChange(ctx(model));
    expect(r.findings.map((f) => f.title)).toEqual(["Kept"]);
    expect(r.findings[0]!.trigger).toEqual({ type: "doc", quote: "pay a 20 percent deposit" });
  });
});

describe("prompts", () => {
  it("sends the ba pack text first, the existing titles, and a strict schema", async () => {
    const seen: ModelRequest[] = [];
    const model = stub(
      {
        "ba.understandApp": () => ({ asBuilt, questions: [], findings: [] }),
        "ba.analyseChange": () => ({ summary: "", criteria: [], questions: [], findings: [] }),
        "ba.analyseImpact": () => ({ summary: "", affected: [], criteria: [], findings: [] }),
      },
      seen,
    );
    const c = ctx(model, { answers: ["Yes, public by design"] });
    await understandApp(c);
    await analyseChange(c);
    await analyseImpact(c, []);
    expect(seen.map((r) => r.name)).toEqual(["ba.understandApp", "ba.analyseChange", "ba.analyseImpact"]);
    for (const req of seen) {
      expect(req.system.startsWith(PACK)).toBe(true);
      expect(req.system).toContain("The copilot computes gates");
      expect(req.user).toContain("Double click on Pay charges twice");
      expect(req.user).toContain("Yes, public by design");
      expect(req.user).toContain("3: app.post('/booking', book);");
      const bad: string[] = [];
      const walk = (s: Record<string, unknown>, path: string) => {
        if (s.type === "object") {
          const keys = Object.keys(s.properties as object);
          if (JSON.stringify([...(s.required as string[])].sort()) !== JSON.stringify([...keys].sort())) bad.push(path);
          for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
        }
        if (s.type === "array") walk(s.items as Record<string, unknown>, `${path}[]`);
      };
      walk(req.schema, req.name);
      expect(bad).toEqual([]);
    }
  });

  it("systemPrompt orders pack, shared rules, instructions", () => {
    const s = systemPrompt("PACK", "DO THIS");
    expect(s.indexOf("PACK")).toBe(0);
    expect(s.indexOf("PACK")).toBeLessThan(s.indexOf("computes gates"));
    expect(s.indexOf("computes gates")).toBeLessThan(s.indexOf("DO THIS"));
  });
});
