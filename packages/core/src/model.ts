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
  /** Delay before the transient retry. Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

// ponytail: hand-written subset of JSON Schema (type incl. unions, required, properties, items, enum). Add keywords when a role schema needs them.
function validate(value: unknown, schema: JsonSchema, path: string): string | null {
  const rawType = schema.type as string | string[] | undefined;
  const types = rawType === undefined ? undefined : Array.isArray(rawType) ? rawType : [rawType];
  const isObj = typeof value === "object" && value !== null && !Array.isArray(value);
  const matches = (t: string) =>
    (t === "object" && isObj) ||
    (t === "array" && Array.isArray(value)) ||
    (t === "string" && typeof value === "string") ||
    (t === "number" && typeof value === "number") ||
    (t === "integer" && Number.isInteger(value)) ||
    (t === "boolean" && typeof value === "boolean") ||
    (t === "null" && value === null);
  if (types && !types.some(matches)) return `${path} should be ${types.join(" or ")}`;
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
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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
    // One transient retry and one empty/truncated retry, independent: at most 3 sends.
    let transientRetried = false;
    let emptyRetried = false;

    for (;;) {
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
        if (transientRetried) {
          throw new Error(`Model call ${req.name} failed after retry: HTTP ${res.status}`);
        }
        transientRetried = true;
        const header = res.headers.get("retry-after");
        const seconds = header === null ? Number.NaN : Number(header);
        await sleep(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000);
        continue;
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`Model call ${req.name} failed: HTTP ${res.status} ${text}`);
      }

      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      // completion_tokens already includes reasoning tokens (billed as output).
      // No usage reported: charge the pre-checked worst case rather than nothing.
      const i = body.usage ? (body.usage.prompt_tokens ?? 0) : estInput;
      const o = body.usage ? (body.usage.completion_tokens ?? 0) : cap;
      const c = body.usage ? cost(i, o) : worst;
      opts.ledger.add(c, i, o);
      input += i;
      output += o;
      costUsd += c;

      const choice = body.choices?.[0];
      const text = choice?.message?.content;
      if (text === null || text === undefined || text === "" || choice?.finish_reason === "length") {
        if (emptyRetried) {
          throw new Error(`Model call ${req.name} returned empty or truncated output after retry`);
        }
        emptyRetried = true;
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
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error(`Fixture ${req.name}.json is not valid JSON`);
    }
    return { data, usage: { input: 0, output: 0 }, costUsd: 0 };
  };
}
