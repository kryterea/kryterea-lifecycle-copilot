import { mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPacks, type RoleId } from "../src/index.js";

const REAL = fileURLToPath(new URL("../../../packs", import.meta.url));
// Built from parts so this file does not itself contain the banned words.
const BANNED = new RegExp(String.raw`\b(${["sc" + "ore", "rub" + "ric", "gra" + "de", "rat" + "ing", "pa" + "ss", "fa" + "il"].join("|")})\b`, "i");
const ROLES: RoleId[] = ["ba", "architect", "qa", "compliance", "po"];

/** Copy the real packs into a temp dir so a test can break one thing. */
async function copyPacks(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "packs-"));
  await cp(REAL, dir, { recursive: true });
  return dir;
}

async function writeLegal(dir: string, entries: unknown[]) {
  await mkdir(join(dir, "legal"), { recursive: true });
  await writeFile(join(dir, "legal", "ndpa-2023.json"), JSON.stringify(entries));
}

const goodEntry = {
  id: "x-1",
  law: "NDPA 2023",
  section: "Section 1",
  title: "t",
  duty: "d",
  triggers: ["a"],
  sourceUrl: "https://example.org",
  verifiedOn: "2026-10-27",
};

describe("loadPacks", () => {
  it("loads all five role packs", async () => {
    const packs = await loadPacks(REAL);
    for (const r of ROLES) expect(packs.role[r].length).toBeGreaterThan(500);
    expect(packs.legal.length).toBe(15);
  });

  it("every shipped legal entry has a section and verifiedOn", async () => {
    const { legal } = await loadPacks(REAL);
    expect(legal.filter((e) => e.law === "NDPA 2023")).toHaveLength(12);
    expect(legal.filter((e) => e.law === "PCI DSS")).toHaveLength(3);
    for (const e of legal) {
      expect(e.section, e.id).toBeTruthy();
      expect(e.verifiedOn, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.sourceUrl, e.id).toMatch(/^https:\/\//);
    }
    expect(new Set(legal.map((e) => e.id)).size).toBe(legal.length);
  });

  it("keeps pack wording clean: no dashes and no banned product words", async () => {
    const { role, legal } = await loadPacks(REAL);
    const text = [...Object.values(role), JSON.stringify(legal)].join("\n");
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(text).not.toMatch(BANNED);
  });

  it("names the missing role file", async () => {
    const dir = await copyPacks();
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "qa.md"));
    await expect(loadPacks(dir)).rejects.toThrow(/qa\.md/);
  });

  it.each(["section", "sourceUrl", "verifiedOn"])("rejects a legal entry without %s", async (field) => {
    const dir = await copyPacks();
    const entry: Record<string, unknown> = { ...goodEntry };
    delete entry[field];
    await writeLegal(dir, [goodEntry, entry].map((e, i) => (i ? { ...e, id: "bad-one" } : e)));
    await expect(loadPacks(dir)).rejects.toThrow(new RegExp(`bad-one.*${field}`));
  });

  it("rejects a legal entry whose law is not allowed", async () => {
    const dir = await copyPacks();
    await writeLegal(dir, [{ ...goodEntry, id: "odd-law", law: "GDPR" }]);
    await expect(loadPacks(dir)).rejects.toThrow(/odd-law.*law/);
  });
});
