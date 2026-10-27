import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILE_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
// Directories evidence may never cite (a hallucinated .git/HEAD:1 must not verify).
const NO_EVIDENCE_DIRS = new Set([".git", "node_modules", "dist"]);
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|[^/]*\.lock)$/i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp[34]|mov|wasm|exe|dll|so|dylib)$/i;
const COMMIT_ID = /^[0-9a-f]{7,40}$/i;

const GIT_SHORT_MS = 30_000;
const GIT_NET_MS = 120_000;

const fwd = (p: string) => p.replaceAll("\\", "/");

interface GitOptions {
  cwd?: string;
  token?: string;
  /** Send the GitHub Basic auth header, through the child environment only (never argv, never .git/config). */
  auth?: boolean;
  allowLocal?: boolean;
  timeoutMs?: number;
}

function scrubber(token?: string): (s: string) => string {
  if (!token) return (s) => s;
  const pair = `x-access-token:${token}`;
  const forms = [Buffer.from(pair).toString("base64"), pair, token].sort((a, b) => b.length - a.length);
  return (s) => forms.reduce((acc, f) => acc.split(f).join("***"), s);
}

async function git(args: string[], o: GitOptions = {}): Promise<string> {
  const config = [
    "protocol.allow=never",
    "protocol.https.allow=always",
    ...(o.allowLocal ? ["protocol.file.allow=always"] : []),
    "http.followRedirects=false",
    "credential.helper=",
  ].flatMap((c) => ["-c", c]);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  if (o.auth && o.token) {
    const b64 = Buffer.from(`x-access-token:${o.token}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${b64}`;
  }
  const scrub = scrubber(o.token);
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      [...config, ...args],
      { cwd: o.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env, timeout: o.timeoutMs ?? GIT_SHORT_MS },
      (err, stdout, stderr) => {
        if (!err) return resolvePromise(stdout);
        const why = err.killed ? "timed out" : (stderr || err.message).trim();
        reject(new Error(scrub(`git ${args[0]} failed: ${why}`)));
      },
    );
  });
}

/**
 * Returns the parsed URL for an https repo, or null for a local path / file:// (only with allowLocal).
 * Rejects options, userinfo, control characters and every other scheme.
 */
function checkRepoUrl(repoUrl: string, allowLocal: boolean): URL | null {
  if (!repoUrl || repoUrl.startsWith("-") || /[\u0000-\u001f]/.test(repoUrl)) {
    throw new Error("repoUrl rejected: invalid");
  }
  if (/^https:\/\//i.test(repoUrl)) {
    let u: URL;
    try {
      u = new URL(repoUrl);
    } catch {
      throw new Error("repoUrl rejected: not a valid URL");
    }
    if (u.username || u.password || u.host.includes("@")) throw new Error("repoUrl rejected: credentials in URL");
    return u;
  }
  const isLocal = /^file:\/\//i.test(repoUrl) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(repoUrl);
  if (allowLocal && isLocal) return null;
  throw new Error("repoUrl rejected: only https URLs are allowed");
}

/**
 * Full clone into cacheDir the first time, then fetch and hard-reset to the remote HEAD.
 * Writes only to cacheDir. The token goes (as Basic auth, via env) only to github.com.
 * `allowLocal` permits local paths and file:// remotes: tests only, the server never sets it.
 */
export async function syncRepo(
  repoUrl: string,
  cacheDir: string,
  token?: string,
  opts: { allowLocal?: boolean } = {},
): Promise<{ dir: string; commit: string }> {
  const allowLocal = opts.allowLocal === true;
  const parsed = checkRepoUrl(repoUrl, allowLocal);
  const base = { token, auth: parsed?.hostname.toLowerCase() === "github.com", allowLocal };
  const name = basename(repoUrl.replace(/[\\/]+$/, "")).replace(/\.git$/, "").replace(/[^\w.-]/g, "_") || "repo";
  const dir = resolve(cacheDir, `${name}-${createHash("sha1").update(repoUrl).digest("hex").slice(0, 8)}`);
  if (existsSync(join(dir, ".git"))) {
    await git(["fetch", "--prune", "origin", "HEAD"], { ...base, cwd: dir, timeoutMs: GIT_NET_MS });
    await git(["reset", "--hard", "FETCH_HEAD"], { ...base, cwd: dir });
  } else {
    // An interrupted first clone leaves a .git-less dir that would block every later clone.
    rmSync(dir, { recursive: true, force: true });
    await git(["clone", "--quiet", "--", repoUrl, dir], { ...base, timeoutMs: GIT_NET_MS });
  }
  const commit = (await git(["rev-parse", "HEAD"], { ...base, cwd: dir })).trim();
  return { dir: fwd(dir), commit };
}

/** Relative, forward-slash paths of text-like source files, sorted. */
export async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(r);
      } else if (e.isFile() && !LOCKFILE.test(r) && !BINARY_EXT.test(r)) {
        if ((await stat(join(dir, r))).size <= MAX_FILE_BYTES) out.push(r);
      }
    }
  }
  await walk("");
  return out.sort();
}

/** Files changed between two commits. A rename lists the old path as deleted and the new path as changed. */
export async function changedFiles(
  dir: string,
  from: string,
  to: string,
): Promise<{ changed: string[]; deleted: string[] }> {
  if (!COMMIT_ID.test(from) || !COMMIT_ID.test(to)) throw new Error("changedFiles: from and to must be commit ids");
  const raw = await git(["diff", "--name-status", "--no-renames", "-z", from, to, "--"], { cwd: dir });
  const parts = raw.split("\0").filter(Boolean);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    (parts[i] === "D" ? deleted : changed).push(parts[i + 1]!);
  }
  return { changed, deleted };
}

/**
 * Absolute path of a citable file inside dir, or null if the path is absolute, escapes dir
 * (lexically or by symlink), is missing, or sits under .git, node_modules or dist.
 */
export function safePath(dir: string, file: string): string | null {
  if (!file || isAbsolute(file)) return null;
  const root = resolve(dir);
  const target = resolve(root, file);
  const rel = relative(root, target);
  const inside = (r: string) => r !== "" && r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r);
  if (!inside(rel)) return null;
  if (rel.split(sep).some((seg) => NO_EVIDENCE_DIRS.has(seg.toLowerCase()))) return null;
  try {
    return inside(relative(realpathSync(root), realpathSync(target))) ? target : null;
  } catch {
    return null;
  }
}

function fileLines(dir: string, file: string): string[] | null {
  const p = safePath(dir, file);
  if (!p) return null;
  try {
    if (statSync(p).size > MAX_FILE_BYTES) return null;
    const lines = readFileSync(p, "utf8").split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  } catch {
    return null;
  }
}

/** Lines start..end (1-based, inclusive, end clamped to the file) joined with \n, or null. */
export function readLines(dir: string, file: string, start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  const lines = fileLines(dir, file);
  if (!lines || start > lines.length) return null;
  return lines.slice(start - 1, end).join("\n");
}

/** True only when the cited file exists inside dir and the cited line is within it. */
export function verifyCodeTrigger(dir: string, t: { file: string; line: number }): boolean {
  return readLines(dir, t.file, t.line, t.line) !== null;
}
