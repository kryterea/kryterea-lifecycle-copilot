import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BudgetExceededError,
  type JsonSchema,
  type Model,
  type ModelRequest,
  type ModelResult,
  type SpendLedger,
} from "./types.js";

export interface CreateModelOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  priceInPerM: number;
  priceOutPerM: number;
  budgetUsd: number;
  ledger: SpendLedger;
  fetchImpl?: typeof fetch;
}

// ponytail: hand-written subset of JSON Schema (type, required, properties, items, enum). Add keywords when a role schema needs them.
function validate(value: unknown, schema: JsonSchema, path: string): string | null {
  const type = schema.type as string | undefined;
  const isObj = typeof value === "object" && value !== null && !Array.isArray(value);
  const ok =
    type === undefined ||
    (type === "object" && isObj) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number") ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);
  if (!ok) return `${path} should be ${type}`;
  const en = schema.enum as unknown[] | undefined;
  if (en && !en.includes(value)) return `${path} is not one of the allowed values`;
  if (isObj) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) return `${path}.${key} is missing`;
    }
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) {
        const err = validate(obj[key], sub, `${path}.${key}`);
        if (err) return err;
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const err = validate(value[i], schema.items as JsonSchema, `${path}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

export function createModel(opts: CreateModelOptions): Model {
  const doFetch = opts.fetchImpl ?? fetch;
  const cost = (i: number, o: number) =>
    (i * opts.priceInPerM) / 1_000_000 + (o * opts.priceOutPerM) / 1_000_000;

  return async <T>(req: ModelRequest): Promise<ModelResult<T>> => {
    const inputChars =
      req.system.length + req.user.length + (req.images ?? []).reduce((n, s) => n + s.length, 0);
    const estInput = Math.ceil(inputChars / 4);
    let cap = req.maxOutputTokens;
    let input = 0;
    let output = 0;
    let costUsd = 0;
    let lastFailure = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const worst = cost(estInput, cap);
      if (opts.ledger.spentUsd() + worst > opts.budgetUsd) {
        throw new BudgetExceededError(
          `Budget used: spent ${opts.ledger.spentUsd().toFixed(4)} plus worst case ${worst.toFixed(4)} exceeds ${opts.budgetUsd}`,
        );
      }
      const content: unknown = req.images?.length
        ? [
            { type: "text", text: req.user },
            ...req.images.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : req.user;
      const res = await doFetch(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "out", schema: req.schema, strict: true },
          },
          reasoning_effort: req.reasoningEffort ?? "low",
          max_completion_tokens: cap,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastFailure = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`Model call ${req.name} failed: HTTP ${res.status}`);

      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      // completion_tokens already includes reasoning tokens (billed as output).
      const i = body.usage?.prompt_tokens ?? 0;
      const o = body.usage?.completion_tokens ?? 0;
      const c = cost(i, o);
      opts.ledger.add(c, i, o);
      input += i;
      output += o;
      costUsd += c;

      const text = body.choices?.[0]?.message?.content;
      if (text === null || text === undefined || text === "") {
        lastFailure = "empty content";
        cap *= 2;
        continue;
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Model call ${req.name} returned output that is not valid JSON for the schema`);
      }
      const err = validate(data, req.schema, "$");
      if (err) throw new Error(`Model call ${req.name} output does not match the schema: ${err}`);
      return { data: data as T, usage: { input, output }, costUsd };
    }
    throw new Error(`Model call ${req.name} failed after retry: ${lastFailure}`);
  };
}

export function createFakeModel(fixturesDir: string): Model {
  return async <T>(req: ModelRequest): Promise<ModelResult<T>> => {
    const file = join(fixturesDir, `${req.name}.json`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`Missing fixture ${req.name}.json (looked in ${fixturesDir})`);
    }
    return { data: JSON.parse(text) as T, usage: { input: 0, output: 0 }, costUsd: 0 };
  };
}
