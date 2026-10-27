import { listSourceFiles, readLines } from "../repo/repo.js";
import { narrowFiles } from "../repo/narrow.js";
import type { CopilotRecord } from "../record/record.js";
import type {
  Change,
  FindingInput,
  FindingKind,
  Model,
  Packs,
  Project,
} from "../types.js";

export interface RoleContext {
  record: CopilotRecord;
  model: Model;
  packs: Packs;
  project: Project;
  change: Change;
  repo: { dir: string; commit: string };
  runId: string;
  /** This role's findings in the project, so the model reuses a title for the same issue. */
  existingFindings: Array<{ id: string; title: string; kind: FindingKind }>;
  /** From the latest 'answers' artifact, empty if none. */
  answers: string[];
}

export type RoleFinding = Omit<FindingInput, "projectId" | "changeId" | "runId" | "role" | "stage">;

export interface RoleResult {
  artifacts: Array<{ kind: string; body: unknown }>;
  criteria: Array<{ text: string; isFailurePath: boolean }>;
  findings: RoleFinding[];
  questions: string[];
  affectedCriterionIds: string[];
}

/** Shared by every role. The banned words appear here only, as an instruction to the model. */
const SHARED_RULES = `Rules for every answer:
1. The copilot computes gates. Never state whether a gate is held or cleared.
2. Never use the words score, rubric, grade, rating, pass or fail in any output. Describe evidence only as "Evidence found", "Gap" or "No evidence".
3. Do not use em dashes or en dashes. Use a period, comma, colon or brackets.
4. When an existing finding listed in the user message is the same issue, reuse its exact title.`;

/** Pack text first so the long, repeated prefix can be cached, then shared rules, then the task. */
export function systemPrompt(pack: string, instructions: string): string {
  return `${pack}\n\n${SHARED_RULES}\n\n${instructions}`;
}

/** Project, change, owner answers and existing findings, for the user message. */
export function contextBlock(ctx: RoleContext): string {
  const existing = ctx.existingFindings.length
    ? ctx.existingFindings.map((f) => `- [${f.kind}] ${f.title}`).join("\n")
    : "(none)";
  const answers = ctx.answers.length ? ctx.answers.map((a) => `- ${a}`).join("\n") : "(none)";
  return [
    `Project: ${ctx.project.name}`,
    `Commit: ${ctx.repo.commit}`,
    `Change (${ctx.change.kind}): ${ctx.change.title}`,
    `Change description:\n${ctx.change.description}`,
    `Owner answers so far:\n${answers}`,
    `Existing findings (reuse the exact title when it is the same issue):\n${existing}`,
  ].join("\n\n");
}

const LIST_CHARS = 6000;

/**
 * The file list plus the best-matching files with numbered lines (so the model can cite file:line),
 * cut off at maxChars in total.
 */
export async function repoMaterial(
  dir: string,
  query: string,
  opts: { maxFiles: number; maxChars: number },
): Promise<string> {
  const files = await listSourceFiles(dir);
  let out = `Files (${files.length}):\n${files.join("\n").slice(0, LIST_CHARS)}`;
  for (const file of await narrowFiles(query, dir, files, opts.maxFiles)) {
    const text = readLines(dir, file, 1, 1_000_000);
    if (text === null) continue;
    const numbered = text
      .split("\n")
      .map((l, i) => `${i + 1}: ${l}`)
      .join("\n");
    const block = `\n\n=== ${file} ===\n${numbered}`;
    const room = opts.maxChars - out.length;
    if (room <= 200) break;
    if (block.length > room) {
      out += `${block.slice(0, room)}\n[truncated]`;
      break;
    }
    out += block;
  }
  return out;
}
