import { describe, expect, it } from "vitest";
import type { OpenItem } from "@lifecycle/core";
import { githubBody, githubClient, parseGithubRepo } from "../src/github.js";

type Reply = [number, unknown] | Error;

function fakeFetch(...replies: Reply[]) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: any }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = replies.shift() ?? [200, {}];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r[1]), { status: r[0], headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fn };
}

const repo = { owner: "kryterea", name: "lagospay" };
const API = "https://api.github.com/repos/kryterea/lagospay";
const item = (n: number): OpenItem => ({ id: `f${n}`, findingId: `f${n}`, kind: "operations", role: "architect", title: `Item ${n}`, why: "w", where: `a.js:${n}`, requirementKey: null, createdAt: "" });

describe("githubClient", () => {
  it("lists open pull requests with their head commit", async () => {
    const f = fakeFetch([200, [{ number: 4, head: { sha: "abc" } }]]);
    expect(await githubClient("ghp_test", repo, f.fn).openPulls()).toEqual([{ number: 4, headSha: "abc" }]);
    expect(f.calls[0]).toMatchObject({ url: `${API}/pulls?state=open&per_page=50`, auth: "Bearer ghp_test" });
  });

  it("creates a pull request comment once, then edits the same comment", async () => {
    const f = fakeFetch([201, { id: 77 }], [200, { id: 77 }]);
    const gh = githubClient("t", repo, f.fn);
    const id = await gh.upsertPullComment(4, null, "first");
    expect(id).toBe("77");
    expect(await gh.upsertPullComment(4, id, "second")).toBe("77");
    expect(f.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", `${API}/issues/4/comments`, { body: "first" }],
      ["PATCH", `${API}/issues/comments/77`, { body: "second" }],
    ]);
  });

  it("a deleted comment is written again", async () => {
    const f = fakeFetch([404, { message: "Not Found" }], [201, { id: 78 }]);
    expect(await githubClient("t", repo, f.fn).upsertCommitComment("abc", "77", "b")).toBe("78");
    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ["PATCH", `${API}/comments/77`],
      ["POST", `${API}/commits/abc/comments`],
    ]);
  });

  it("a network error or 401 rejects with a readable message and no token", async () => {
    const f = fakeFetch(new TypeError("fetch failed"), [401, { message: "Bad credentials" }]);
    const gh = githubClient("ghp_secret", repo, f.fn);
    const down = await gh.openPulls().catch((e: Error) => e.message);
    const denied = await gh.upsertPullComment(1, null, "b").catch((e: Error) => e.message);
    expect(down).toBe("Could not reach GitHub.");
    expect(denied).toBe("GitHub did not accept the token (401).");
    expect(`${down} ${denied}`).not.toContain("ghp_secret");
  });
});

describe("parseGithubRepo", () => {
  it("reads owner and name from github.com URLs only", () => {
    expect(parseGithubRepo("https://github.com/kryterea/lagospay.git")).toEqual(repo);
    expect(parseGithubRepo("https://github.com/kryterea/lagospay")).toEqual(repo);
    expect(parseGithubRepo("https://gitlab.com/kryterea/lagospay")).toBeNull();
    expect(parseGithubRepo("C:/code/lagospay")).toBeNull();
  });
});

describe("githubBody", () => {
  it("starts with the hidden marker, lists at most ten items and never blocks", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(i + 1));
    const body = githubBody(items, 12, "abcdef1234", "https://copilot.example/#/projects/p1/commits/abcdef1234");
    const lines = body.split("\n");
    expect(lines[0]).toBe("<!-- kryterea:governance -->");
    expect(lines[1]).toBe("**Kryterea governance**");
    expect(body).toContain("12 open:");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(10);
    expect(body).toContain("- operations | Item 10 | a.js:10");
    expect(body).not.toContain("Item 11");
    expect(body).toContain("And 2 more.");
    expect(body).toContain("[See the trace for abcdef1](https://copilot.example/#/projects/p1/commits/abcdef1234)");
    expect(lines.at(-1)).toBe("Kryterea warns and records. It never blocks a merge.");
  });

  it("all clear", () => {
    expect(githubBody([], 0, "abcdef1234", null)).toBe(
      "<!-- kryterea:governance -->\n**Kryterea governance**\n\nNothing open. Checked at abcdef1.\n\nKryterea warns and records. It never blocks a merge.",
    );
  });
});
