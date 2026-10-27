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
// Secret files never reach a model prompt and can never be cited as evidence (.env.example and friends are fine).
const ENV_FILE = /^\.env(\..+)?$/i;
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i;
const SECRET_FILE = /^(id_rsa.*|\.npmrc|\.netrc|.*\.(pem|key))$/i;
export const isSecretFile = (file: string): boolean => {
  const name = basename(file.replaceAll("\\", "/"));
  return (ENV_FILE.test(name) && !ENV_TEMPLATE.test(name)) || SECRET_FILE.test(name);
};
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
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraHeader";
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
 * Validates a repo URL and returns the ONLY string git may see. An https URL is rebuilt from the
 * parsed host and path (no port, query, fragment, userinfo), after rejecting characters that git and
 * WHATWG URL parse differently. Local paths and file:// need allowLocal and pass through unchanged.
 */
export function checkRepoUrl(repoUrl: string, allowLocal: boolean): { url: string; github: boolean } {
  if (!repoUrl || repoUrl.startsWith("-") || /[\u0000-\u001f\u007f]/.test(repoUrl)) {
    throw new Error("repoUrl rejected: invalid");
  }
  if (/^https:\/\//i.test(repoUrl)) {
    if (/[\\@%?#\s\u0000-\u001f\u007f]/.test(repoUrl)) throw new Error("repoUrl rejected: unsafe characters");
    let u: URL;
    try {
      u = new URL(repoUrl);
    } catch {
      throw new Error("repoUrl rejected: not a valid URL");
    }
    if (u.username || u.password || u.port || u.search || u.hash) throw new Error("repoUrl rejected: unsafe parts");
    return { url: `https://${u.hostname}${u.pathname}`, github: u.hostname === "github.com" };
  }
  const isLocal = /^file:\/\//i.test(repoUrl) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(repoUrl);
  if (allowLocal && isLocal) return { url: repoUrl, github: false };
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
  const { url, github } = checkRepoUrl(repoUrl, allowLocal);
  const base = { token, auth: github, allowLocal };
  const name = basename(url.replace(/[\\/]+$/, "")).replace(/\.git$/, "").replace(/[^\w.-]/g, "_") || "repo";
  const dir = resolve(cacheDir, `${name}-${createHash("sha1").update(url).digest("hex").slice(0, 8)}`);
  if (existsSync(join(dir, ".git"))) {
    await git(["fetch", "--prune", "origin", "HEAD"], { ...base, cwd: dir, timeoutMs: GIT_NET_MS });
    await git(["reset", "--hard", "FETCH_HEAD"], { ...base, cwd: dir });
  } else {
    // An interrupted first clone leaves a .git-less dir that would block every later clone.
    rmSync(dir, { recursive: true, force: true });
    await git(["clone", "--quiet", "--", url, dir], { ...base, timeoutMs: GIT_NET_MS });
  }
  const commit = (await git(["rev-parse", "HEAD"], { ...base, cwd: dir })).trim();
  return { dir: fwd(dir), commit };
}

/** The commit the remote HEAD points at, without cloning. Same URL checks and git safety as syncRepo. */
export async function remoteHead(repoUrl: string, token?: string, opts: { allowLocal?: boolean } = {}): Promise<string> {
  const allowLocal = opts.allowLocal === true;
  const { url, github } = checkRepoUrl(repoUrl, allowLocal);
  const out = await git(["ls-remote", "--", url, "HEAD"], { token, auth: github, allowLocal, timeoutMs: GIT_NET_MS });
  const sha = out.split(/\s/)[0] ?? "";
  if (!COMMIT_ID.test(sha)) throw new Error("git ls-remote found no HEAD");
  return sha;
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
      } else if (e.isFile() && !LOCKFILE.test(r) && !BINARY_EXT.test(r) && !isSecretFile(r)) {
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
 * Changed line ranges on the new side, from `git diff -U0`. A pure deletion covers the lines either side of where
 * it was; a deleted file covers every line.
 */
export async function diffHunks(dir: string, from: string, to: string): Promise<Array<{ file: string; start: number; end: number }>> {
  if (!COMMIT_ID.test(from) || !COMMIT_ID.test(to)) throw new Error("diffHunks: from and to must be commit ids");
  const raw = await git(["diff", "-U0", "--no-renames", "--no-color", from, to, "--"], { cwd: dir });
  const out: Array<{ file: string; start: number; end: number }> = [];
  let oldFile = "";
  let file: string | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("--- ")) oldFile = line.slice(4).replace(/^a\//, "");
    else if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
      if (file === null) out.push({ file: oldFile, start: 1, end: Number.MAX_SAFE_INTEGER });
    } else if (file && line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      out.push(count === 0 ? { file, start, end: start + 1 } : { file, start, end: start + count - 1 });
    }
  }
  return out;
}

/** Subjects of the commits after `from` up to `to`, oldest first. */
export async function commitMessages(dir: string, from: string, to: string): Promise<string[]> {
  if (!COMMIT_ID.test(from) || !COMMIT_ID.test(to)) throw new Error("commitMessages: from and to must be commit ids");
  const raw = await git(["log", "--reverse", "--format=%s", `${from}..${to}`], { cwd: dir });
  return raw.split("\n").filter((l) => l.trim() !== "");
}

const hasBlockedSegment =(rel: string) => rel.split(sep).some((seg) => NO_EVIDENCE_DIRS.has(seg.toLowerCase()));

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
  if (hasBlockedSegment(rel) || isSecretFile(rel)) return null;
  try {
    const real = relative(realpathSync(root), realpathSync(target));
    return inside(real) && !hasBlockedSegment(real) && !isSecretFile(real) ? target : null;
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
