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

export type FindingKind = "legal" | "failure_path" | "operations" | "conformance";

export type FindingStatus = "open" | "fixed" | "accepted_risk" | "deferred";

export type Trigger =
  | { type: "code"; file: string; line: number; commit: string }
  | { type: "doc"; quote: string; document?: string; line?: number }
  | { type: "screen"; url: string; screenshotPath: string };

export interface FindingInput {
  projectId: string;
  changeId: string;
  runId: string;
  role: RoleId;
  stage: StageId;
  kind: FindingKind;
  title: string;
  plain: string;
  costIfIgnored: string;
  fixPrompt: string;
  trigger: Trigger;
  citationId?: string;
  criterionId?: string;
}

export type Finding = FindingInput & {
  id: string;
  fingerprint: string;
  createdAt: string;
};

export type GateState = "held" | "cleared";

export type EvidenceState = "evidence_found" | "gap" | "no_evidence";

export type RunStatus = "running" | "done" | "stopped_budget" | "failed";

export type LinkRel = "affects" | "satisfies" | "raised_on";

export interface LinkEnd {
  type: string;
  id: string;
}

export interface Check {
  criterionId: string;
  runId: string;
  state: EvidenceState;
  evidence: Trigger[];
  note: string;
}

export type GateMap = Partial<Record<RoleId, { state: GateState; reason: string; at: string }>>;

/** A decision made on one of a check's proposed changes. */
export type ProposalDecision = { index: number; decision: "approved" | "accepted_risk"; actor: string; reason?: string; fixChangeId?: string };

export interface AcceptanceRecord {
  change: Change;
  criteria: Array<Criterion & { latest: EvidenceState | null }>;
  findings: Array<Finding & { status: FindingStatus }>;
  gates: GateMap;
  decisions: Array<{ findingId: string; status: FindingStatus; reason: string; actor: string; at: string }>;
  runs: Array<{ id: string; role: RoleId; commit: string; status: RunStatus; costUsd: number }>;
  /** Her problem in her own words: for a fix change, from the check it follows. Null when none was given. */
  problem: string | null;
  /** The latest questions paired with the answers saved after them. */
  answers: Array<{ question: string; answer: string; assumed: boolean; actor: string | null }>;
  /** The decisions made on the proposed changes of the check this record starts from. */
  proposalDecisions: ProposalDecision[];
  /** From the latest `acceptance_summary` artifact, null when none. */
  summary: string | null;
  /** Each requirement linked to these criteria: its criteria with their latest state, and the decisions people made on findings about it. */
  trace: Array<{
    key: string;
    text: string;
    criteria: Array<{ text: string; state: EvidenceState | null }>;
    decisions: Array<{ title: string; status: FindingStatus; by: string; reason: string; at: string }>;
  }>;
}

/** A PRD, spec or other project document: a repo file, or one uploaded or pasted (kept in the record only). */
export interface Document {
  id: string;
  projectId: string;
  name: string;
  source: "repo" | "upload";
  createdAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  contentHash: string;
  commit: string | null;
  body: string;
  createdAt: string;
}

/** One requirement read from a document line. Its key is its identity across document versions. */
export interface Requirement {
  id: string;
  projectId: string;
  documentId: string;
  key: string;
  text: string;
  quote: string;
  line: number;
  status: "active" | "removed";
  createdAt: string;
  updatedAt: string;
}

export interface RequirementEvent {
  requirementId: string;
  kind: "added" | "changed" | "removed";
  text: string;
  versionId: string;
  at: string;
}

export interface RequirementLink {
  requirementId: string;
  toType: "criterion" | "linear_issue";
  toId: string;
  createdAt: string;
}

/** Glob patterns added to and removed from the default document discovery. */
export interface DocSettings {
  include: string[];
  exclude: string[];
}

export interface LegalDuty {
  id: string;
  law: "NDPA 2023" | "PCI DSS";
  section: string;
  title: string;
  duty: string;
  triggers: string[];
  sourceUrl: string;
  verifiedOn: string;
}

export interface Packs {
  role: Record<RoleId, string>;
  legal: LegalDuty[];
}
