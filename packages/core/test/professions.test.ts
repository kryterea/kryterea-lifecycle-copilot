import { describe, expect, it } from "vitest";
import { PROFESSIONS } from "../src/index.js";

describe("profession catalogue", () => {
  it("lists five professions in workflow order, each with a framework", () => {
    expect(PROFESSIONS.map((p) => p.role)).toEqual(["ba", "architect", "qa", "compliance", "po"]);
    for (const p of PROFESSIONS) expect(p.frameworks.length).toBeGreaterThan(0);
    expect(PROFESSIONS.find((p) => p.role === "compliance")!.frameworks).toContain("NDPA 2023");
  });
});
