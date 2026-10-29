import type { CommitCompare } from "@lifecycle/core";
import { describe, expect, it } from "vitest";
import { compareMarkdown } from "../src/report.js";

const A = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const B = "b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0";

const cmp: CommitCompare = {
  from: { sha: A, open: 3, evidenceFound: 1, gaps: 1, noEvidence: 1 },
  to: { sha: B, open: 1, evidenceFound: 3, gaps: 0, noEvidence: 0 },
  findings: [
    { id: "1", title: "A repeated webhook marks a payment paid twice", kind: "failure_path", role: "qa", from: "open", to: "fixed" },
    { id: "2", title: "Check this: no notice before card data is collected", kind: "legal", role: "compliance", from: "open", to: "accepted_risk" },
    { id: "3", title: "Card numbers reach the [log](http://x)", kind: "failure_path", role: "qa", from: null, to: "open" },
    { id: "4", title: "\"Easy\" cannot be checked", kind: "conformance", role: "ba", from: "open", to: "open" },
    { id: "5", title: "Settled long ago", kind: "operations", role: "architect", from: "fixed", to: "fixed" },
  ],
  criteria: [
    { id: "k1", text: "A paid link is marked paid once", requirementKeys: ["FR-2"], from: "gap", to: "evidence_found" },
    { id: "k2", text: "A refund marks the payment refunded", requirementKeys: [], from: null, to: "evidence_found" },
    { id: "k3", text: "A merchant creates a link", requirementKeys: ["FR-1"], from: "evidence_found", to: "evidence_found" },
  ],
};

describe("compareMarkdown", () => {
  const md = compareMarkdown("LagosPay", cmp);

  it("opens with the two commits and a table of counts with their change", () => {
    expect(md).toContain("# Before and after: LagosPay");
    expect(md).toContain("`a1b2c3d` (before) and `b9c8d7e` (after)");
    expect(md).toContain("| Open items | 3 | 1 | 2 fewer |");
    expect(md).toContain("| Evidence found | 1 | 3 | 2 more |");
    expect(md).toContain("| No evidence | 1 | 0 | 1 fewer |");
  });

  it("lists closed, new and still open findings, and the criteria that moved", () => {
    expect(md).toContain("## Closed (2)\n\n- Fixed: A repeated webhook marks a payment paid twice\n- Risk accepted: Check this: no notice before card data is collected");
    expect(md).toContain("## New (1)\n\n- Card numbers reach the \\[log\\](http://x)");
    expect(md).toContain("## Still open (1)\n\n- \"Easy\" cannot be checked");
    expect(md).toContain("- Gap to Evidence found: FR-2 A paid link is marked paid once");
    expect(md).toContain("- Not checked to Evidence found: A refund marks the payment refunded");
    expect(md).not.toContain("Settled long ago");
    expect(md).not.toContain("A merchant creates a link");
    expect(md).toContain("1 criterion unchanged.");
  });

  it("ends by saying where it came from, and that legal items are not legal advice", () => {
    expect(md.trimEnd().split("\n").at(-1)).toBe("Generated from the Kryterea record. Legal items are things to check, not legal advice.");
    expect(md).not.toMatch(/\b(score|rubric|grade|rating|pass|passed|fail|failed)\b|—|–/i);
  });
});
