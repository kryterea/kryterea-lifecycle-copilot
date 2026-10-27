import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildTools, createMcpServer } from "../src/tools.js";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

/** A fetch that records each call and answers from a queue of [status, json] replies. */
function fakeApi(...replies: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const [status, json] = replies.shift() ?? [200, {}];
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const finding = {
  id: "f1",
  projectId: "p1",
  changeId: "c1",
  kind: "failure_path",
  title: "Payment errors are swallowed",
  plain: "When the card is declined the user sees nothing.",
  costIfIgnored: "Lost sales.",
  fixPrompt: "Show the decline reason in checkout.ts and add a retry button.",
  trigger: { type: "code", file: "src/checkout.ts", line: 42, commit: "abcdef1234567" },
  status: "open",
};

function tools(replies: Array<[number, unknown]>, token?: string) {
  const api = fakeApi(...replies);
  const list = buildTools({ baseUrl: "http://localhost:8787", ...(token ? { token } : {}), fetch: api.fetchFn });
  const run = (name: string, args: Record<string, unknown>) => list.find((t) => t.name === name)!.run(args as never);
  return { ...api, run, list };
}

describe("mcp tools", () => {
  it("tools list contains exactly the five tools", async () => {
    const { list } = tools([]);
    const server = createMcpServer(list);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_change", "get_finding", "list_findings", "report_fix", "request_recheck"]);
    await client.close();
  });

  it("descriptions use plain words only", () => {
    const { list } = tools([]);
    for (const t of list) {
      expect(t.description).not.toMatch(/\b(score|rubric|grade|rating|pass|fail)/i);
      expect(t.description).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
    }
    const all = list.map((t) => t.description).join(" ");
    expect(all).toMatch(/builder/);
    expect(all).toMatch(/panel header/);
    expect(all).toMatch(/report_fix/);
    expect(all).toMatch(/request_recheck/);
  });

  it("rejects bad input before calling the API", async () => {
    const api = fakeApi();
    const server = createMcpServer(buildTools({ fetch: api.fetchFn }));
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const bad = async (name: string, args: Record<string, unknown>) => {
      try {
        const r = await client.callTool({ name, arguments: args });
        return r.isError === true;
      } catch {
        return true;
      }
    };
    expect(await bad("report_fix", { findingId: "f1", summary: "" })).toBe(true);
    expect(await bad("report_fix", { findingId: "f1", summary: "x".repeat(2001) })).toBe(true);
    expect(await bad("list_findings", { projectId: "p1", status: "done" })).toBe(true);
    expect(await bad("get_finding", { findingId: " " })).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it("report_fix posts status fixed with actor coding-agent", async () => {
    const t = tools([[200, { id: "f1", status: "fixed", history: [] }]]);
    const out = await t.run("report_fix", { findingId: "f1", summary: "Showed the decline reason." });
    expect(t.calls[0]).toMatchObject({
      url: "http://localhost:8787/api/findings/f1/status",
      method: "POST",
      body: { status: "fixed", reason: "Showed the decline reason.", actor: "coding-agent" },
    });
    expect(out).toMatch(/request_recheck/);
  });

  it("get_finding returns the fix prompt", async () => {
    const t = tools([[200, { finding, status: "open", history: [], criterion: { id: "k1", text: "Declined cards show a reason" } }]]);
    const out = await t.run("get_finding", { findingId: "f1" });
    expect(out).toContain(finding.fixPrompt);
    expect(out).toContain("Payment errors are swallowed");
    expect(out).toContain("When the card is declined the user sees nothing.");
    expect(out).toContain("src/checkout.ts:42 at abcdef1");
    expect(out).toContain("Declined cards show a reason");
  });

  it("get_finding quotes a doc trigger", async () => {
    const f = { ...finding, trigger: { type: "doc", quote: "Users can pay by card" } };
    const t = tools([[200, { finding: f, status: "open", history: [], criterion: null }]]);
    expect(await t.run("get_finding", { findingId: "f1" })).toContain('"Users can pay by card"');
  });

  it("list_findings sends the status filter and returns one line per finding", async () => {
    const t = tools([[200, { findings: [finding, { ...finding, id: "f2", kind: "legal", title: "No consent notice" }] }]]);
    const out = await t.run("list_findings", { projectId: "p1", status: "open" });
    expect(t.calls[0]!.url).toBe("http://localhost:8787/api/projects/p1/findings?status=open");
    const lines = out.split("\n").filter((l) => l.startsWith("f"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/f1.*open.*Payment errors are swallowed/);
    expect(lines[1]).toMatch(/f2.*legal.*No consent notice/);
  });

  it("list_findings without a status sends no filter and says when empty", async () => {
    const t = tools([[200, { findings: [] }]]);
    const out = await t.run("list_findings", { projectId: "p 1" });
    expect(t.calls[0]!.url).toBe("http://localhost:8787/api/projects/p%201/findings");
    expect(out).toMatch(/No findings/);
  });

  it("get_change summarises stage, gates, findings and criteria", async () => {
    const t = tools([
      [
        200,
        {
          change: { id: "c1", title: "Add checkout", kind: "feature", stage: "build" },
          stage: "build",
          gates: { qa: { state: "held", reason: "Open findings", at: "x" } },
          findings: [finding],
          criteria: [{ id: "k1", text: "Declined cards show a reason", latest: "gap" }],
          questions: ["Which cards?"],
          accepted: false,
        },
      ],
    ]);
    const out = await t.run("get_change", { changeId: "c1" });
    expect(t.calls[0]!.url).toBe("http://localhost:8787/api/changes/c1");
    expect(out).toContain("Add checkout");
    expect(out).toContain("build");
    expect(out).toMatch(/qa: Held/);
    expect(out).toContain("f1");
    expect(out).toMatch(/Declined cards show a reason.*Gap/);
    expect(out).toContain("Which cards?");
  });

  it("request_recheck sends reason mcp", async () => {
    const t = tools([[202, { jobId: "j1" }]]);
    const out = await t.run("request_recheck", { projectId: "p1" });
    expect(t.calls[0]).toMatchObject({ url: "http://localhost:8787/api/projects/p1/recheck", method: "POST", body: { reason: "mcp" } });
    expect(out).toMatch(/started/i);
  });

  it("a 409 on request_recheck becomes a plain message, not an error", async () => {
    const t = tools([[409, { error: "A job is already running for this item", jobId: "j0" }]]);
    expect(await t.run("request_recheck", { projectId: "p1" })).toBe("A check is already running; try again in a minute");
  });

  it("sends the bearer token when set and none otherwise", async () => {
    const withToken = tools([[200, { findings: [] }]], "s3cret");
    await withToken.run("list_findings", { projectId: "p1" });
    expect(withToken.calls[0]!.headers.get("authorization")).toBe("Bearer s3cret");
    const without = tools([[200, { findings: [] }]]);
    await without.run("list_findings", { projectId: "p1" });
    expect(without.calls[0]!.headers.get("authorization")).toBeNull();
  });

  it("sends application/json on reads and writes", async () => {
    const t = tools([[200, { findings: [] }], [200, { id: "f1", status: "fixed", history: [] }]]);
    await t.run("list_findings", { projectId: "p1" });
    await t.run("report_fix", { findingId: "f1", summary: "done" });
    for (const c of t.calls) expect(c.headers.get("content-type")).toBe("application/json");
  });

  it("a non-2xx answer becomes an error with the API message only", async () => {
    const t = tools([[404, { error: "Finding not found" }]], "s3cret");
    const err = await t.run("get_finding", { findingId: "nope" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Finding not found");
  });

  it("a network failure is an error that leaks neither the token nor the URL", async () => {
    const list = buildTools({
      baseUrl: "http://user:pw@localhost:8787",
      token: "s3cret",
      fetch: (async () => {
        throw new TypeError("fetch failed http://user:pw@localhost:8787 Bearer s3cret");
      }) as typeof fetch,
    });
    const err = await list.find((t) => t.name === "list_findings")!.run({ projectId: "p1" } as never).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Could not reach the copilot/);
    expect((err as Error).message).not.toMatch(/s3cret|pw/);
  });

  it("tool errors reach the agent as isError results", async () => {
    const api = fakeApi([404, { error: "Finding not found" }]);
    const server = createMcpServer(buildTools({ fetch: api.fetchFn }));
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "get_finding", arguments: { findingId: "nope" } });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("Finding not found");
    await client.close();
  });
});
