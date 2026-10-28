import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changedFiles,
  commitMessages,
  diffHunks,
  listSourceFiles,
  narrowFiles,
  readLines,
  remoteHead,
  syncRepo,
  verifyCodeTrigger,
} from "../src/index.js";
import { checkRepoUrl, safePath } from "../src/repo/repo.js";

const root = mkdtempSync(join(tmpdir(), "lifecycle-repo-"));
const origin = join(root, "origin");
let c1 = "";
let c2 = "";
let c3 = "";

const LOCAL = { allowLocal: true };

// Symlink creation needs a privilege on Windows; probe once and skip the symlink test if it is missing.
const canSymlink = (() => {
  try {
    const probe = mkdtempSync(join(tmpdir(), "lifecycle-link-"));
    writeFileSync(join(probe, "a"), "x");
    symlinkSync(join(probe, "a"), join(probe, "b"));
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
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
    const o = join(root, "sync-origin");
    mkdirSync(o, { recursive: true });
    git(o, "init", "-q");
    writeFileSync(join(o, "old.ts"), "v1\n");
    writeFileSync(join(o, "keep.ts"), "keep1\n");
    git(o, "add", "-A");
    git(o, "commit", "-q", "-m", "s1");
    const s1 = git(o, "rev-parse", "HEAD");
    const cache = join(root, "cache");
    const first = await syncRepo(o, cache, undefined, LOCAL);
    expect(first.commit).toBe(s1);
    expect(first.dir).not.toContain("\\");
    expect(existsSync(join(first.dir, "old.ts"))).toBe(true);

    git(o, "mv", "old.ts", "renamed.ts");
    writeFileSync(join(o, "keep.ts"), "keep2\n");
    git(o, "add", "-A");
    git(o, "commit", "-q", "-m", "s2");
    const s2 = git(o, "rev-parse", "HEAD");
    const second = await syncRepo(o, cache, undefined, LOCAL);
    expect(second.dir).toBe(first.dir);
    expect(second.commit).toBe(s2);
    expect(existsSync(join(second.dir, "renamed.ts"))).toBe(true);
    expect(existsSync(join(second.dir, "old.ts"))).toBe(false);
    expect(readFileSync(join(second.dir, "keep.ts"), "utf8").trim()).toBe("keep2");
    // full history is kept so changedFiles can diff old commits
    expect((await changedFiles(second.dir, s1, s2)).deleted).toEqual(["old.ts"]);
  });

  it("recovers when the cache dir exists without .git", async () => {
    const cache = join(root, "cache-broken");
    const first = await syncRepo(origin, cache, undefined, LOCAL);
    rmSync(join(first.dir, ".git"), { recursive: true, force: true });
    const again = await syncRepo(origin, cache, undefined, LOCAL);
    expect(again.commit).toBe(c3);
  });

  it("fails fast on a missing remote and never leaks the token", async () => {
    const err = await syncRepo(join(root, "nope"), join(root, "cache2"), "tok-secret", LOCAL).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    for (const form of ["tok-secret", Buffer.from("x-access-token:tok-secret").toString("base64"), "x-access-token:tok-secret"]) {
      expect(msg).not.toContain(form);
    }
  });

  it("validates repo URLs: parser-differential URLs are rejected, plain github URLs become canonical", () => {
    for (const bad of [
      "https://github.com\\@evil.example/x.git",
      "https://evil.example%2f@github.com/x",
      "https://github.com/o/my repo.git",
      "https://github.com:444/o/r.git",
      "https://github.com/o/r.git?x=1",
      "https://github.com/o/r.git#frag",
    ]) {
      expect(() => checkRepoUrl(bad, false)).toThrow(/repoUrl rejected/);
    }
    expect(checkRepoUrl("https://github.com/o/r.git", false)).toEqual({
      url: "https://github.com/o/r.git",
      github: true,
    });
    expect(checkRepoUrl("https://GitHub.com/o/r", false)).toEqual({ url: "https://github.com/o/r", github: true });
    expect(checkRepoUrl("https://gitlab.com/o/r.git", false).github).toBe(false);
  });

  it("remoteHead reads the remote HEAD commit without cloning and rejects unsafe URLs", async () => {
    expect(await remoteHead(origin, undefined, LOCAL)).toBe(c3);
    await expect(remoteHead(origin)).rejects.toThrow(/repoUrl rejected/);
    await expect(remoteHead("--upload-pack=touch pwned", undefined, LOCAL)).rejects.toThrow(/repoUrl rejected/);
  });

  it("rejects unsafe repo URLs before running git", async () => {
    const cache = join(root, "cache3");
    for (const bad of [
      "--upload-pack=touch pwned",
      "https://user@github.com/a/b.git",
      "https://user:pass@github.com/a/b.git",
      "http://github.com/a/b.git",
      "ssh://github.com/a/b.git",
      origin, // a local path without allowLocal
    ]) {
      await expect(syncRepo(bad, cache)).rejects.toThrow(/repoUrl rejected/);
    }
    await expect(syncRepo("--upload-pack=touch pwned", cache, undefined, LOCAL)).rejects.toThrow(/repoUrl rejected/);
    await expect(syncRepo("https://u:p@github.com/a/b.git", cache, undefined, LOCAL)).rejects.toThrow(/repoUrl rejected/);
    expect(existsSync(join(cache))).toBe(false);
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

  it("keeps secret files out of the listing and out of evidence, but lists .env.example", async () => {
    const d = mkdtempSync(join(tmpdir(), "lifecycle-secrets-"));
    try {
      const w = (rel: string) => {
        mkdirSync(dirname(join(d, rel)), { recursive: true });
        writeFileSync(join(d, rel), "SECRET=1\n");
      };
      for (const f of [".env", "config/.env.local", ".env.production", "certs/site.pem", "deploy.key", "id_rsa", ".npmrc", ".netrc", ".env.example", "src/app.ts"]) w(f);
      const files = await listSourceFiles(d);
      expect(files).toEqual([".env.example", "src/app.ts"]);
      expect(safePath(d, ".env")).toBeNull();
      expect(safePath(d, "config/.env.local")).toBeNull();
      expect(readLines(d, ".env", 1, 1)).toBeNull();
      expect(verifyCodeTrigger(d, { file: "certs/site.pem", line: 1 })).toBe(false);
      expect(safePath(d, ".env.example")).not.toBeNull();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("changedFiles reports a deleted file under deleted", async () => {
    const r = await changedFiles(origin, c1, c2);
    expect(r.deleted).toEqual(["src/about.ts"]);
    expect(r.changed).toEqual([]);
  });

  it("changedFiles rejects anything that is not a commit id", async () => {
    await expect(changedFiles(origin, "--output=x", c2)).rejects.toThrow(/commit ids/);
    await expect(changedFiles(origin, c1, "HEAD")).rejects.toThrow(/commit ids/);
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

  it("does not accept .git, node_modules or non-integer ranges as evidence, but allows ..foo", () => {
    expect(readLines(origin, ".git/HEAD", 1, 1)).toBeNull();
    expect(verifyCodeTrigger(origin, { file: ".git/HEAD", line: 1 })).toBe(false);
    expect(verifyCodeTrigger(origin, { file: "src/../.git/HEAD", line: 1 })).toBe(false);
    expect(verifyCodeTrigger(origin, { file: "node_modules/x/index.js", line: 1 })).toBe(false);
    expect(readLines(origin, "src/payment.ts", 1, Number.NaN)).toBeNull();
    expect(readLines(origin, "src/payment.ts", 1.5, 2)).toBeNull();
    expect(readLines(origin, "big.ts", 1, 1)).toBeNull();
    put("..foo.txt", "dotdot\n");
    expect(readLines(origin, "..foo.txt", 1, 1)).toBe("dotdot");
  });

  it.skipIf(!canSymlink)("a symlink to .git/config is not evidence", () => {
    symlinkSync(join(origin, ".git", "config"), join(origin, "cfg-link"));
    expect(readLines(origin, "cfg-link", 1, 1)).toBeNull();
    expect(verifyCodeTrigger(origin, { file: "cfg-link", line: 1 })).toBe(false);
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

describe("diffHunks and commitMessages", () => {
  it("gives new-side line ranges per file, and the line a deletion was removed before", async () => {
    const d = mkdtempSync(join(tmpdir(), "lifecycle-hunks-"));
    git(d, "init", "-q");
    writeFileSync(join(d, "a.js"), "1\n2\n3\n4\n5\n6\n");
    writeFileSync(join(d, "gone.js"), "x\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "one");
    const from = git(d, "rev-parse", "HEAD");
    writeFileSync(join(d, "a.js"), "1\nTWO\n3\n5\n6\n7\n");
    rmSync(join(d, "gone.js"));
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "PAY-3 change a and drop gone");
    const to = git(d, "rev-parse", "HEAD");
    expect(await diffHunks(d, from, to)).toEqual([
      { file: "a.js", start: 2, end: 2 },
      { file: "a.js", start: 3, end: 4 },
      { file: "a.js", start: 6, end: 6 },
      { file: "gone.js", start: 1, end: Number.MAX_SAFE_INTEGER },
    ]);
    expect(await commitMessages(d, from, to)).toEqual(["PAY-3 change a and drop gone"]);
    await expect(diffHunks(d, "nope", to)).rejects.toThrow();
    rmSync(d, { recursive: true, force: true });
  });
});

describe("diffHunks body lines", () => {
  it("is not fooled by removed or added lines that look like file headers", async () => {
    const d = mkdtempSync(join(tmpdir(), "lifecycle-hunks2-"));
    git(d, "init", "-q");
    writeFileSync(join(d, "q.sql"), "select 1;\n-- old comment\nselect 2;\n3\n4\n5\nend;\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "one");
    const from = git(d, "rev-parse", "HEAD");
    writeFileSync(join(d, "q.sql"), "select 1;\n++ b/evil.js\nselect 2;\n3\n4\n5\nEND;\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "two");
    const to = git(d, "rev-parse", "HEAD");
    expect(await diffHunks(d, from, to)).toEqual([
      { file: "q.sql", start: 2, end: 2 },
      { file: "q.sql", start: 7, end: 7 },
    ]);
    rmSync(d, { recursive: true, force: true });
  });
});
