import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changedFiles,
  listSourceFiles,
  narrowFiles,
  readLines,
  syncRepo,
  verifyCodeTrigger,
} from "../src/index.js";

const root = mkdtempSync(join(tmpdir(), "lifecycle-repo-"));
const origin = join(root, "origin");
let c1 = "";
let c2 = "";
let c3 = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function put(rel: string, content: string | Buffer) {
  const p = join(origin, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

beforeAll(() => {
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q");
  put("src/payment.ts", "export function handleFailedPayment(order) {\n  order.status = 'failed';\n}\n");
  put("src/about.ts", "export const about = 'hello';\n");
  put("old.ts", "export const old = 1;\n");
  put("node_modules/x/index.js", "module.exports = 1;\n");
  put("dist/out.js", "x\n");
  put("pnpm-lock.yaml", "lock\n");
  put("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  put("big.ts", "a".repeat(200 * 1024 + 1));
  git(origin, "add", "-A", "-f");
  git(origin, "commit", "-q", "-m", "one");
  c1 = git(origin, "rev-parse", "HEAD");

  unlinkSync(join(origin, "src/about.ts"));
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "two");
  c2 = git(origin, "rev-parse", "HEAD");

  git(origin, "mv", "old.ts", "renamed.ts");
  put("src/payment.ts", "export function handleFailedPayment(order) {\n  order.status = 'refunded';\n}\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "three");
  c3 = git(origin, "rev-parse", "HEAD");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("repo reader", () => {
  it("syncs a repo into the cache and re-syncs to a new commit", async () => {
    const cache = join(root, "cache");
    git(origin, "checkout", "-q", c2);
    const first = await syncRepo(origin, cache);
    expect(first.commit).toBe(c2);
    expect(first.dir).not.toContain("\\");
    git(origin, "checkout", "-q", "-");
    const second = await syncRepo(origin, cache);
    expect(second.dir).toBe(first.dir);
    expect(second.commit).toBe(c3);
    // full history is kept so changedFiles can diff old commits
    expect((await changedFiles(second.dir, c1, c3)).changed.length).toBeGreaterThan(0);
  });

  it("fails fast on a missing remote", async () => {
    await expect(syncRepo(join(root, "nope"), join(root, "cache2"))).rejects.toThrow();
  });

  it("lists source files and skips node_modules and lockfiles", async () => {
    const files = await listSourceFiles(origin);
    expect(files).toContain("src/payment.ts");
    expect(files).toContain("renamed.ts");
    for (const bad of ["node_modules/x/index.js", "dist/out.js", "pnpm-lock.yaml", "logo.png", "big.ts"]) {
      expect(files).not.toContain(bad);
    }
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
  });

  it("changedFiles reports a deleted file under deleted", async () => {
    const r = await changedFiles(origin, c1, c2);
    expect(r.deleted).toEqual(["src/about.ts"]);
    expect(r.changed).toEqual([]);
  });

  it("changedFiles lists a renamed file's old path as deleted and the new path as changed", async () => {
    const r = await changedFiles(origin, c2, c3);
    expect(r.deleted).toEqual(["old.ts"]);
    expect([...r.changed].sort()).toEqual(["renamed.ts", "src/payment.ts"]);
  });

  it("readLines returns the inclusive range and null for a missing file", async () => {
    expect(readLines(origin, "src/payment.ts", 1, 2)).toBe(
      "export function handleFailedPayment(order) {\n  order.status = 'refunded';",
    );
    expect(readLines(origin, "nope.ts", 1, 1)).toBeNull();
  });

  it("verifyCodeTrigger is false for a missing file and for a line past the end", () => {
    expect(verifyCodeTrigger(origin, { file: "src/payment.ts", line: 2 })).toBe(true);
    expect(verifyCodeTrigger(origin, { file: "nope.ts", line: 1 })).toBe(false);
    expect(verifyCodeTrigger(origin, { file: "src/payment.ts", line: 99 })).toBe(false);
    expect(verifyCodeTrigger(origin, { file: "src/payment.ts", line: 0 })).toBe(false);
  });

  it("rejects absolute paths and ../ traversal", () => {
    put("../secret.txt", "top secret\n");
    expect(readLines(origin, "../secret.txt", 1, 1)).toBeNull();
    expect(readLines(origin, "src/../../secret.txt", 1, 1)).toBeNull();
    expect(readLines(origin, join(root, "secret.txt"), 1, 1)).toBeNull();
    expect(verifyCodeTrigger(origin, { file: "../secret.txt", line: 1 })).toBe(false);
    expect(verifyCodeTrigger(origin, { file: join(root, "secret.txt"), line: 1 })).toBe(false);
  });

  it('narrowFiles ranks payment.ts above about.ts for "failed payment order status"', async () => {
    put("src/about.ts", "export const about = 'hello';\n");
    const files = ["src/about.ts", "src/payment.ts", "renamed.ts"];
    const out = await narrowFiles("failed payment order status", origin, files);
    expect(out[0]).toBe("src/payment.ts");
    expect(out.indexOf("src/payment.ts")).toBeLessThan(out.indexOf("src/about.ts"));
    expect(await narrowFiles("failed payment", origin, files, 1)).toEqual(["src/payment.ts"]);
  });
});
