import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  createFakeModel,
  createModel,
  type ModelRequest,
  type SpendLedger,
} from "../src/index.js";

function makeLedger(start = 0): SpendLedger & { input: number; output: number } {
  let spent = start;
  const l = {
    input: 0,
    output: 0,
    spentUsd: () => spent,
    add(cost: number, i: number, o: number) {
      spent += cost;
      l.input += i;
      l.output += o;
    },
  };
  return l;
}

type Reply = { status?: number; content?: string | null; usage?: Record<string, unknown> };

function fakeFetch(replies: Reply[]) {
  const bodies: Record<string, any>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    const r = replies[bodies.length - 1] ?? replies[replies.length - 1]!;
    const status = r.status ?? 200;
    if (status !== 200) return new Response("nope", { status });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: r.content === undefined ? '{"ok":true}' : r.content } }],
        usage: r.usage ?? { prompt_tokens: 10, completion_tokens: 10 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
const req: ModelRequest = { name: "t.t", system: "s", user: "u", schema, maxOutputTokens: 4000 };

function build(replies: Reply[], ledger = makeLedger(), budgetUsd = 70) {
  const f = fakeFetch(replies);
  const model = createModel({
    baseUrl: "https://example.test/v1",
    apiKey: "k",
    model: "m",
    priceInPerM: 1.25,
    priceOutPerM: 4.25,
    budgetUsd,
    ledger,
    fetchImpl: f.fetchImpl,
  });
  return { model, ledger, ...f };
}

describe("createModel", () => {
  it("costs a call from usage", async () => {
    const { model, ledger } = build([
      { usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } },
    ]);
    const res = await model<{ ok: boolean }>(req);
    expect(res.costUsd).toBe(1.25 + 0.425);
    expect(res.usage).toEqual({ input: 1_000_000, output: 100_000 });
    expect(ledger.spentUsd()).toBe(1.25 + 0.425);
  });

  it("refuses before sending when the worst case exceeds budget", async () => {
    const { model, bodies } = build([{}], makeLedger(69.99));
    await expect(model({ ...req, maxOutputTokens: 10_000 })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(bodies.length).toBe(0);
  });

  it("rejects output that does not match the schema", async () => {
    const { model, ledger } = build([{ content: '{"wrong":1}' }]);
    await expect(model(req)).rejects.toThrow(/schema/);
    expect(ledger.spentUsd()).toBeGreaterThan(0); // the tokens were spent
  });

  it("retries once on HTTP 429 or 5xx", async () => {
    const { model, bodies } = build([{ status: 503 }, {}]);
    const res = await model<{ ok: boolean }>(req);
    expect(res.data.ok).toBe(true);
    expect(bodies.length).toBe(2);
  });

  it("cost counts reasoning tokens", async () => {
    const { model } = build([
      {
        usage: {
          prompt_tokens: 0,
          completion_tokens: 1000,
          completion_tokens_details: { reasoning_tokens: 900 },
        },
      },
    ]);
    const res = await model(req);
    expect(res.usage.output).toBe(1000);
    expect(res.costUsd).toBe((1000 * 4.25) / 1_000_000);
  });

  it("empty content retries once with double the cap", async () => {
    const { model, bodies, ledger } = build([
      { content: null, usage: { prompt_tokens: 100, completion_tokens: 4000 } },
      { usage: { prompt_tokens: 100, completion_tokens: 50 } },
    ]);
    const res = await model<{ ok: boolean }>(req);
    expect(res.data.ok).toBe(true);
    expect(bodies.length).toBe(2);
    expect(bodies[0]!.max_completion_tokens).toBe(4000);
    expect(bodies[1]!.max_completion_tokens).toBe(8000);
    const both = (200 * 1.25 + 4050 * 4.25) / 1_000_000;
    expect(res.costUsd).toBeCloseTo(both, 12);
    expect(ledger.spentUsd()).toBeCloseTo(both, 12);
    expect(res.usage).toEqual({ input: 200, output: 4050 });
  });

  it("two empty replies throw an error containing empty", async () => {
    const { model, bodies } = build([{ content: "" }, { content: null }]);
    await expect(model(req)).rejects.toThrow(/empty/);
    expect(bodies.length).toBe(2);
  });

  it("sends reasoning_effort", async () => {
    const a = build([{}]);
    await a.model(req);
    expect(a.bodies[0]!.reasoning_effort).toBe("low");
    expect(a.bodies[0]!.response_format.json_schema).toEqual({ name: "out", schema, strict: true });
    const b = build([{}]);
    await b.model({ ...req, reasoningEffort: "high", images: ["data:image/png;base64,AA"] });
    expect(b.bodies[0]!.reasoning_effort).toBe("high");
    expect(b.bodies[0]!.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AA" },
    });
  });
});

describe("createFakeModel", () => {
  it("returns the named fixture and names a missing one in its error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fx-"));
    writeFileSync(join(dir, "t.t.json"), '{"ok":true}');
    const model = createFakeModel(dir);
    const res = await model<{ ok: boolean }>(req);
    expect(res).toEqual({ data: { ok: true }, usage: { input: 0, output: 0 }, costUsd: 0 });
    await expect(model({ ...req, name: "x.missing" })).rejects.toThrow(/x\.missing\.json/);
  });
});
