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

export type RoleId = "ba" | "architect" | "qa" | "compliance" | "po";

export type StageId =
  | "intake"
  | "analysis"
  | "design_review"
  | "build"
  | "verification"
  | "release"
  | "acceptance"
  | "operate";

export type ChangeKind = "understand" | "feature" | "fix";

export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  appUrl: string | null;
  createdAt: string;
}

export interface Change {
  id: string;
  projectId: string;
  title: string;
  description: string;
  kind: ChangeKind;
  stage: StageId;
  createdAt: string;
}

export interface Artifact {
  id: string;
  changeId: string;
  role: RoleId;
  stage: StageId;
  kind: string;
  body: unknown;
  createdAt: string;
}

export interface Criterion {
  id: string;
  projectId: string;
  changeId: string;
  text: string;
  isFailurePath: boolean;
  createdAt: string;
}
