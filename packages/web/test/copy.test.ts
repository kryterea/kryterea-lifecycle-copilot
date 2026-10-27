import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

// Built from code points so this file never holds the characters it hunts for.
const BANNED: Array<[string, RegExp]> = [
  ["judging words", /\b(score|rubric|grade|rating|pass|fail)\b/i],
  ["em dash", new RegExp(String.fromCodePoint(0x2014))],
  ["en dash", new RegExp(String.fromCodePoint(0x2013))],
];

describe("panel copy guard", () => {
  it("finds source files to scan", () => {
    expect(files(src).length).toBeGreaterThan(0);
  });

  it("no source file uses judging words or long dashes", () => {
    const hits: string[] = [];
    for (const file of files(src)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const [what, re] of BANNED) if (re.test(line)) hits.push(`${file}:${i + 1} ${what}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
