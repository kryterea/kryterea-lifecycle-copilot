import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { undocumentedFlows, reviewDocuments, type CopilotRecord, type Model, type ModelRequest, type Packs, type Requirement, type RoleContext } from "../src/index.js";

const packs: Packs = { role: { ba: "BA PACK", architect: "", qa: "", compliance: "", po: "" }, legal: [] };

const PRD = [
  "# LagosPay PRD",
  "",
  "FR-1: Merchants create payment links with an amount.",
  "Customers pay a link with Paystack.",
  "Refunds should be fast.",
].join("\n");

function ctx(model: Model): RoleContext {
  return {
    record: {} as CopilotRecord,
    model,
    packs,
    project: { id: "p1", name: "LagosPay", repoUrl: "x", appUrl: null, createdAt: "t" },
    change: { id: "c1", projectId: "p1", title: "Understand", description: "d", kind: "understand", stage: "intake", createdAt: "t" },
    repo: { dir: ".", commit: "abc1234" },
    runId: "r1",
    existingFindings: [],
    answers: [],
  };
}

function stub(data: unknown, seen: ModelRequest[] = []): Model {
  return (async (req: ModelRequest) => {
    seen.push(req);
    return { data, usage: { input: 0, output: 0 }, costUsd: 0 };
  }) as Model;
}

const req = (key: string, quote: string, line: number, document = "docs/PRD.md") => ({ document, key, text: quote, quote, line });
const gap = (over: Record<string, unknown> = {}) => ({
  document: "docs/PRD.md",
  kind: "quality",
  title: "Refund speed is not measurable",
  plain: "Nobody can check what fast means.",
  costIfIgnored: "Disputes about refund times.",
  fixPrompt: "State the refund time in hours.",
  quote: "Refunds should be fast.",
  line: 5,
  ...over,
});

const previous = (key: string, text: string): Requirement => ({
  id: key,
  projectId: "p1",
  documentId: "d1",
  key,
  text,
  quote: text,
  line: 4,
  status: "active",
  createdAt: "t",
  updatedAt: "t",
});

describe("reviewDocuments", () => {
  it("extracts requirements with their quote and line, keeping written IDs", async () => {
    const seen: ModelRequest[] = [];
    const out = await reviewDocuments(
      ctx(stub({ requirements: [req("FR-1", "Merchants create payment links with an amount.", 3), req("PRD-2", "Customers pay a link with Paystack.", 4)], gaps: [gap()] }, seen)),
      [{ name: "docs/PRD.md", body: PRD }],
      [],
    );
    expect(seen[0]!.name).toBe("ba.reviewDocuments");
    expect(seen[0]!.user).toContain("<<<BEGIN DOCUMENT docs/PRD.md>>>");
    expect(seen[0]!.user).toContain("3: FR-1: Merchants create payment links with an amount.");
    expect(seen[0]!.system).toContain("ISO/IEC/IEEE 29148");
    expect(out.requirements.map((r) => [r.key, r.line])).toEqual([
      ["FR-1", 3],
      ["PRD-2", 4],
    ]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({
      kind: "conformance",
      title: "Refund speed is not measurable",
      trigger: { type: "doc", quote: "Refunds should be fast.", document: "docs/PRD.md", line: 5 },
    });
  });

  it("maps a reworded requirement to its previous key and adds a new one", async () => {
    const body = "# PRD\nMerchants make payment links for any amount.\nMerchants can refund a payment.";
    const seen: ModelRequest[] = [];
    const out = await reviewDocuments(
      ctx(stub({ requirements: [req("PRD-1", "Merchants make payment links for any amount.", 2), req("PRD-2", "Merchants can refund a payment.", 3)], gaps: [] }, seen)),
      [{ name: "docs/PRD.md", body }],
      [previous("PRD-1", "Merchants create payment links")],
    );
    expect(seen[0]!.user).toContain("PRD-1: Merchants create payment links");
    expect(out.requirements.map((r) => r.key)).toEqual(["PRD-1", "PRD-2"]);
  });

  it("gives a requirement with no usable key the next free number, never a duplicate", async () => {
    const body = "# PRD\nOne thing.\nAnother thing.";
    const out = await reviewDocuments(
      ctx(stub({ requirements: [req("PRD-1", "One thing.", 2), req("PRD-1", "Another thing.", 3)], gaps: [] })),
      [{ name: "docs/PRD.md", body }],
      [],
    );
    expect(out.requirements.map((r) => r.key)).toEqual(["PRD-1", "PRD-2"]);
  });

  it("drops a gap or requirement whose quote is not in the document", async () => {
    const out = await reviewDocuments(
      ctx(
        stub({
          requirements: [req("FR-9", "Merchants get paid daily.", 3), req("FR-1", "Merchants create payment links with an amount.", 3, "docs/OTHER.md")],
          gaps: [gap({ quote: "Refunds take one day." }), gap({ document: "docs/OTHER.md" }), gap({ line: 1 })],
        }),
      ),
      [{ name: "docs/PRD.md", body: PRD }],
      [],
    );
    expect(out.requirements).toEqual([]);
    expect(out.findings).toEqual([]);
  });

  it("raises at most 8 gaps", async () => {
    const gaps = Array.from({ length: 12 }, (_, i) => gap({ title: `Gap ${i}` }));
    const out = await reviewDocuments(ctx(stub({ requirements: [], gaps })), [{ name: "docs/PRD.md", body: PRD }], []);
    expect(out.findings).toHaveLength(8);
  });

  it("a missing failure path gap is a failure_path finding", async () => {
    const out = await reviewDocuments(
      ctx(stub({ requirements: [], gaps: [gap({ kind: "failure_path", title: "No rule for a declined card", quote: "Customers pay a link with Paystack.", line: 4 })] })),
      [{ name: "docs/PRD.md", body: PRD }],
      [],
    );
    expect(out.findings[0]?.kind).toBe("failure_path");
  });
});

describe("undocumentedFlows", () => {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-ba-docs-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "server.js"), 'app.post("/links", create);\napp.post("/refund", refund);\napp.get("/export", exportCsv);\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const flow = (over: Record<string, unknown> = {}) => ({ title: "Merchants export payments as CSV", plain: "The app exports every payment, but no document asks for it.", costIfIgnored: "Customer data leaves the app with nobody deciding it should.", fixPrompt: "unused", triggerType: "code", file: "src/server.js", line: 3, quote: null, ...over });

  it("raises behaviour no document asked for, at most 8, each with a code trigger", async () => {
    const seen: ModelRequest[] = [];
    const many = Array.from({ length: 10 }, (_, i) => flow({ title: `Flow ${i}` }));
    const out = await undocumentedFlows(
      { ...ctx(stub({ findings: [flow({ title: "No trigger", file: null, line: null, triggerType: "doc", quote: "x" }), flow({ line: 99 }), ...many] }, seen)), repo: { dir, commit: "abc1234" } },
      ["Create a payment link", "Export payments as CSV"],
      [previous("PRD-1", "Merchants create payment links")],
    );
    expect(seen[0]!.name).toBe("ba.undocumentedFlows");
    expect(seen[0]!.user).toContain("Export payments as CSV");
    expect(seen[0]!.user).toContain("PRD-1: Merchants create payment links");
    expect(out).toHaveLength(8);
    for (const f of out) {
      expect(f.kind).toBe("conformance");
      expect(f.title).toMatch(/^Not in any document: /);
      expect(f.trigger).toMatchObject({ type: "code", file: "src/server.js", line: 3 });
      expect(f.fixPrompt).toContain("PRD");
    }
  });

  it("makes no model call with no flows or no requirements", async () => {
    const seen: ModelRequest[] = [];
    expect(await undocumentedFlows(ctx(stub({ findings: [] }, seen)), [], [previous("PRD-1", "x")])).toEqual([]);
    expect(await undocumentedFlows(ctx(stub({ findings: [] }, seen)), ["a flow"], [])).toEqual([]);
    expect(seen).toHaveLength(0);
  });
});
