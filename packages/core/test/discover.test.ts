import { describe, expect, it } from "vitest";
import { discoverDocuments } from "../src/index.js";

const FILES = ["docs/PRD.md", "SPEC.md", "README.md", "node_modules/x/docs/a.md", ".env", "docs/secrets.key", "src/a.ts"];

describe("discoverDocuments", () => {
  it("finds PRD and spec files and skips secrets and node_modules", () => {
    expect(discoverDocuments(FILES, { include: [], exclude: [] })).toEqual(["docs/PRD.md", "SPEC.md"]);
    expect(discoverDocuments(FILES, { include: [], exclude: ["SPEC.md"] })).toEqual(["docs/PRD.md"]);
    expect(discoverDocuments(FILES, { include: ["README.md"], exclude: [] })).toEqual(["docs/PRD.md", "SPEC.md", "README.md"]);
  });

  it("never includes a secret file, even when asked to", () => {
    expect(discoverDocuments(FILES, { include: [".env", "docs/*.key"], exclude: [] })).toEqual(["docs/PRD.md", "SPEC.md"]);
  });
});
