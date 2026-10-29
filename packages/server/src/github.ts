import type { OpenItem } from "@lifecycle/core";
import { itemLine } from "./linear.js";

const TIMEOUT_MS = 10_000;
export const GOVERNANCE_MARKER = "<!-- kryterea:governance -->";
const FOOTER = "Kryterea warns and records. It never blocks a merge.";

/** Owner and name of a github.com repo URL, or null for any other host or a local path. */
export function parseGithubRepo(repoUrl: string): { owner: string; name: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

/** The comment on a pull request or commit: what is open on the project, at most ten items. */
export function githubBody(items: OpenItem[], total: number, sha: string, traceUrl: string | null): string {
  const head = [GOVERNANCE_MARKER, "**Kryterea governance**", ""];
  const at = sha.slice(0, 7);
  if (!total) return [...head, `Nothing open. Checked at ${at}.`, "", FOOTER].join("\n");
  const more = total > 10 ? [`And ${total - 10} more.`] : [];
  const trace = traceUrl ? ["", `[See the trace for ${at}](${traceUrl})`] : [];
  return [...head, `${total} open:`, ...items.slice(0, 10).map(itemLine), ...more, ...trace, "", `Checked at ${at}.`, "", FOOTER].join("\n");
}

/** A minimal GitHub REST client for one repo. Errors carry a readable message and never the token. */
export function githubClient(token: string, repo: { owner: string; name: string }, fetchFn: typeof fetch = fetch) {
  const base = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; json: any }> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "kryterea-lifecycle-copilot",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error("Could not reach GitHub.");
    }
    if (res.status === 401 || res.status === 403) throw new Error(`GitHub did not accept the token (${res.status}).`);
    const json = await res.json().catch(() => null);
    if (res.status !== 404 && (res.status < 200 || res.status >= 300)) throw new Error(`GitHub answered with status ${res.status}.`);
    return { status: res.status, json };
  }

  /** Edits the comment in place when its id is known and it still exists; otherwise writes a new one. */
  async function upsert(editPath: string | null, createPath: string, body: string): Promise<string> {
    if (editPath) {
      const r = await call("PATCH", editPath, { body });
      if (r.status !== 404) return String(r.json?.id);
    }
    const r = await call("POST", createPath, { body });
    if (r.status === 404 || r.json?.id === undefined) throw new Error("GitHub could not find the pull request or commit.");
    return String(r.json.id);
  }

  return {
    async openPulls(): Promise<Array<{ number: number; headSha: string }>> {
      const r = await call("GET", "/pulls?state=open&per_page=50");
      if (r.status === 404 || !Array.isArray(r.json)) throw new Error("GitHub could not find the repo.");
      return r.json.map((p: any) => ({ number: Number(p.number), headSha: String(p.head?.sha ?? "") }));
    },
    upsertPullComment: (n: number, commentId: string | null, body: string) =>
      upsert(commentId ? `/issues/comments/${encodeURIComponent(commentId)}` : null, `/issues/${n}/comments`, body),
    upsertCommitComment: (sha: string, commentId: string | null, body: string) =>
      upsert(commentId ? `/comments/${encodeURIComponent(commentId)}` : null, `/commits/${encodeURIComponent(sha)}/comments`, body),
  };
}
