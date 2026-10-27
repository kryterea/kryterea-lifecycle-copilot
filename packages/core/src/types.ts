export type JsonSchema = Record<string, unknown>;

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface SpendLedger {
  spentUsd(): number;
  add(costUsd: number, inputTokens: number, outputTokens: number): void;
}

export interface ModelRequest {
  /** `<role>.<function>`, for example `ba.understandApp`. Names the fixture. */
  name: string;
  system: string;
  user: string;
  schema: JsonSchema;
  /** Includes reasoning tokens, so roles leave headroom (at least 4,000). */
  maxOutputTokens: number;
  /** Default 'low'. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Data URLs. */
  images?: string[];
}

export interface ModelResult<T> {
  data: T;
  usage: { input: number; output: number };
  costUsd: number;
}

export type Model = <T>(req: ModelRequest) => Promise<ModelResult<T>>;

export type ModelFactory = (ledger: SpendLedger) => Model;
