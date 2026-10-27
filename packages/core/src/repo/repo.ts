import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|[^/]*\.lock)$/i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp[34]|mov|wasm|exe|dll|so|dylib)$/i;

const fwd = (p: string) => p.replaceAll("\\", "/");

async function git(cwd: string | undefined, args: string[], token?: string): Promise<string> {
  const full = token ? ["-c", `http.extraHeader=Authorization: Bearer ${token}`, ...args] : args;
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      full,
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        if (!err) return resolvePromise(stdout);
        // Never echo the token: execFile errors embed the full command line.
        const scrub = (s: string) => (token ? s.split(token).join("***") : s);
        reject(new Error(scrub(`git ${args[0]} failed: ${(stderr || err.message).trim()}`)));
      },
    );
  });
}

/** Full clone into cacheDir the first time, then fetch and hard-reset to the remote HEAD. Writes only to cacheDir. */
export async function syncRepo(
  repoUrl: string,
  cacheDir: string,
  token?: string,
): Promise<{ dir: string; commit: string }> {
  const name = basename(repoUrl.replace(/[\\/]+$/, "")).replace(/\.git$/, "").replace(/[^\w.-]/g, "_") || "repo";
  const dir = resolve(cacheDir, `${name}-${createHash("sha1").update(repoUrl).digest("hex").slice(0, 8)}`);
  if (existsSync(join(dir, ".git"))) {
    await git(dir, ["fetch", "--prune", "origin", "HEAD"], token);
    await git(dir, ["reset", "--hard", "FETCH_HEAD"]);
  } else {
    await git(undefined, ["clone", "--quiet", repoUrl, dir], token);
  }
  const commit = (await git(dir, ["rev-parse", "HEAD"])).trim();
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
  const raw = await git(dir, ["diff", "--name-status", "--no-renames", "-z", from, to]);
  const parts = raw.split("\0").filter(Boolean);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    (parts[i] === "D" ? deleted : changed).push(parts[i + 1]!);
  }
  return { changed, deleted };
}

/** Absolute path of a file inside dir, or null if it is absolute, escapes dir (including by symlink) or is missing. */
function safePath(dir: string, file: string): string | null {
  if (!file || isAbsolute(file)) return null;
  const root = resolve(dir);
  const target = resolve(root, file);
  const inside = (r: string) => r !== "" && !r.startsWith("..") && !isAbsolute(r);
  if (!inside(relative(root, target))) return null;
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
    const lines = readFileSync(p, "utf8").split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  } catch {
    return null;
  }
}

/** Lines start..end (1-based, inclusive, end clamped to the file) joined with \n, or null. */
export function readLines(dir: string, file: string, start: number, end: number): string | null {
  const lines = fileLines(dir, file);
  if (!lines || !Number.isInteger(start) || start < 1 || start > lines.length || end < start) return null;
  return lines.slice(start - 1, end).join("\n");
}

/** True only when the cited file exists inside dir and the cited line is within it. */
export function verifyCodeTrigger(dir: string, t: { file: string; line: number }): boolean {
  return readLines(dir, t.file, t.line, t.line) !== null;
}
