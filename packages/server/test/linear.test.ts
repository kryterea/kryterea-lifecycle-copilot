import { describe, expect, it } from "vitest";
import type { OpenItem } from "@lifecycle/core";
import { findIssueKeys, linearBody, linearClient } from "../src/linear.js";

type Reply = [number, unknown] | Error;

function fakeFetch(...replies: Reply[]) {
  const calls: Array<{ url: string; auth: string | null; query: string; variables: Record<string, unknown> }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), query: body.query, variables: body.variables });
    const r = replies.shift() ?? [200, { data: {} }];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r[1]), { status: r[0], headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fn };
}

const item = (over: Partial<OpenItem>): OpenItem => ({
  id: "f1", findingId: "f1", kind: "failure_path", role: "qa", title: "Refund twice", why: "w", where: "server.js:120", requirementKey: "FR-1", createdAt: "", ...over,
});

describe("linearClient", () => {
  it("finds an issue by identifier with the key in the Authorization header", async () => {
    const f = fakeFetch([200, { data: { issue: { id: "uuid-1", identifier: "ENG-12", title: "Payment links", url: "https://linear.app/x/issue/ENG-12" } } }]);
    const issue = await linearClient("lin_api_test", f.fn).issue("ENG-12");
    expect(issue).toEqual({ id: "uuid-1", identifier: "ENG-12", title: "Payment links", url: "https://linear.app/x/issue/ENG-12" });
    expect(f.calls[0]).toMatchObject({ url: "https://api.linear.app/graphql", auth: "lin_api_test", variables: { id: "ENG-12" } });
  });

  it("an unknown identifier returns null", async () => {
    const f = fakeFetch([200, { data: null, errors: [{ message: "Entity not found: Issue", extensions: { code: "ENTITY_NOT_FOUND" } }] }]);
    expect(await linearClient("k", f.fn).issue("ENG-999")).toBeNull();
  });

  it("creates a comment once, then edits the same comment", async () => {
    const f = fakeFetch(
      [200, { data: { commentCreate: { success: true, comment: { id: "c-1" } } } }],
      [200, { data: { commentUpdate: { success: true, comment: { id: "c-1" } } } }],
    );
    const linear = linearClient("k", f.fn);
    const id = await linear.upsertComment("uuid-1", null, "first");
    expect(id).toBe("c-1");
    expect(await linear.upsertComment("uuid-1", id, "second")).toBe("c-1");
    expect(f.calls[0]!.query).toMatch(/commentCreate/);
    expect(f.calls[0]!.variables).toEqual({ input: { issueId: "uuid-1", body: "first" } });
    expect(f.calls[1]!.query).toMatch(/commentUpdate/);
    expect(f.calls[1]!.variables).toEqual({ id: "c-1", input: { body: "second" } });
  });

  it("a network error or 401 rejects with a readable message and nothing else breaks", async () => {
    const f = fakeFetch(new TypeError("fetch failed"), [401, { errors: [{ message: "Authentication required" }] }], [200, { data: { issue: null } }]);
    const linear = linearClient("lin_api_secret", f.fn);
    const down = await linear.issue("ENG-1").catch((e: Error) => e.message);
    const denied = await linear.upsertComment("uuid-1", null, "b").catch((e: Error) => e.message);
    expect(down).toBe("Could not reach Linear.");
    expect(denied).toBe("Linear did not accept the API key (401).");
    expect(`${down} ${denied}`).not.toContain("lin_api_secret");
    expect(await linear.issue("ENG-2")).toBeNull();
  });
});

describe("findIssueKeys", () => {
  it("finds each Linear key once, in order", () => {
    expect(findIssueKeys("fix ENG-12 and PAY-3")).toEqual(["ENG-12", "PAY-3"]);
    expect(findIssueKeys("ENG-12: again ENG-12, not utf-8 or eng-4")).toEqual(["ENG-12"]);
  });
});

describe("linearBody", () => {
  it("names the requirement, lists its open items and the evidence on its criteria", () => {
    const body = linearBody("ENG-12", "Merchants create payment links", [item({}), item({ kind: "legal", title: "Check this: consent", where: "docs/PRD.md:4" })], ["evidence_found", "gap"], "abcdef1234");
    expect(body.split("\n")).toEqual([
      "**Kryterea on ENG-12 Merchants create payment links**",
      "",
      "2 open:",
      "- error handling | Refund twice | server.js:120",
      "- legal | Check this: consent | docs/PRD.md:4",
      "",
      "Criteria: Evidence found, Gap",
      "",
      "Checked at abcdef1.",
    ]);
  });

  it("all clear", () => {
    expect(linearBody("ENG-12", "Payment links", [], ["evidence_found"], "abcdef1234")).toBe(
      "**Kryterea on ENG-12 Payment links**\n\nNothing open for this requirement. Checked at abcdef1.\n\nCriteria: Evidence found",
    );
  });

  it("model text cannot add links, mentions or extra lines", () => {
    const body = linearBody("ENG-12", "R", [item({ title: "Ping @ada [here](http://x)\nnew line" })], [], "abcdef1234");
    expect(body).toContain("- error handling | Ping \\@ada \\[here\\](http://x) new line | server.js:120");
  });
});
