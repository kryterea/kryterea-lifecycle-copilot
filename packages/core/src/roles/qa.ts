import { verifyCodeTrigger } from "../repo/repo.js";
import type { Check, Criterion, EvidenceState, GateState, JsonSchema, Trigger } from "../types.js";
import { contextBlock, defang, repoMaterial, systemPrompt, type RoleContext, type RoleResult } from "./context.js";

const MAX_FILES = 6;
const MAX_CHARS = 20_000;
const CONCURRENCY = 3;

const str: JsonSchema = { type: "string" };
const nullableStr: JsonSchema = { type: ["string", "null"] };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

interface RawCheck {
  state: EvidenceState;
  evidence: Array<{ file: string; line: number }>;
  note: string;
  title: string | null;
  plain: string | null;
  costIfIgnored: string | null;
  fixPrompt: string | null;
}

const SCHEMA = obj({
  state: { type: "string", enum: ["evidence_found", "gap", "no_evidence"] },
  evidence: { type: "array", items: obj({ file: str, line: { type: "integer" } }) },
  note: str,
  title: nullableStr,
  plain: nullableStr,
  costIfIgnored: nullableStr,
  fixPrompt: nullableStr,
});

const INSTRUCTIONS = `Task: decide whether the code does what this one acceptance criterion says. Choose exactly one state: "evidence_found" (the code clearly does it), "gap" (the code shows it is missing, partial or contradicts the criterion), or "no_evidence" (the material does not let you tell). When you cannot point to a real line, choose "no_evidence". For a failure path criterion, the happy path working is not evidence.
Cite evidence as file and line exactly as numbered in the material. For evidence_found cite the line that does it. For a gap cite the line that shows the gap. For no_evidence leave evidence empty. Never cite a file or line you were not shown.
Write "note" as one or two plain sentences an owner can follow, no code terms. For a gap also fill title, plain (what the customer would see), costIfIgnored (what it costs the business) and fixPrompt (a ready-to-paste instruction for a coding agent naming the behaviour wanted and where to look). For any other state set title, plain, costIfIgnored and fixPrompt to null.`;

/** Runs fn over items with at most `limit` in flight; results keep input order. Stops taking new items after an error. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function verifyOne(
  ctx: RoleContext,
  c: Criterion,
  onlyFiles?: string[],
): Promise<{ check: Check; finding?: RoleResult["findings"][number] }> {
  const mat = await repoMaterial(ctx.repo.dir, c.text, { maxFiles: MAX_FILES, maxChars: MAX_CHARS, onlyFiles });
  const { data } = await ctx.model<RawCheck>({
    name: "qa.verifyCriteria",
    system: systemPrompt(ctx.packs.role.qa, INSTRUCTIONS),
    user: `${contextBlock(ctx)}\n\nCriterion (${c.isFailurePath ? "failure path" : "normal path"}):\n<<<BEGIN CRITERION>>>\n${defang(c.text)}\n<<<END CRITERION>>>\n\n${mat.text}`,
    schema: SCHEMA,
    maxOutputTokens: 6000,
    reasoningEffort: "low",
  });

  // A citation counts only if the model was shown that file, the line was within what it saw, and it exists on disk.
  const seen = new Set<string>();
  const evidence: Trigger[] = [];
  for (const e of data.evidence ?? []) {
    const last = mat.shown.get(e.file);
    const key = `${e.file}:${e.line}`;
    if (last === undefined || !Number.isInteger(e.line) || e.line < 1 || e.line > last || seen.has(key)) continue;
    if (!verifyCodeTrigger(ctx.repo.dir, e)) continue;
    seen.add(key);
    evidence.push({ type: "code", file: e.file, line: e.line, commit: ctx.repo.commit });
  }

  const base = { criterionId: c.id, runId: ctx.runId };
  if (data.state === "no_evidence") return { check: { ...base, state: "no_evidence", evidence: [], note: data.note } };
  if (evidence.length === 0) {
    return { check: { ...base, state: "no_evidence", evidence: [], note: "The evidence the review pointed to could not be confirmed in the code, so this is not counted as found." } };
  }
  if (data.state === "evidence_found") return { check: { ...base, state: "evidence_found", evidence, note: data.note } };

  const first = evidence[0] as Extract<Trigger, { type: "code" }>;
  let fix = data.fixPrompt?.trim() || `Make this true: "${c.text}".`;
  if (!fix.includes(first.file) || !fix.includes(String(first.line)) || !fix.includes(c.text)) {
    fix += ` Look at ${first.file} line ${first.line}. The agreed criterion: "${c.text}".`;
  }
  return {
    check: { ...base, state: "gap", evidence, note: data.note },
    finding: {
      kind: c.isFailurePath ? "failure_path" : "conformance",
      title: data.title?.trim() || `The app does not yet do what was agreed: ${c.text.slice(0, 80)}`,
      plain: data.plain?.trim() || data.note,
      costIfIgnored: data.costIfIgnored?.trim() || "The app ships a promise it does not keep.",
      fixPrompt: fix,
      trigger: first,
      criterionId: c.id,
    },
  };
}

/** One model call per criterion (3 at a time), each citation verified on disk. Results are in criteria order. */
export async function verifyCriteria(
  ctx: RoleContext,
  criteria: Criterion[],
  onlyFiles?: string[],
): Promise<{ checks: Check[]; findings: RoleResult["findings"] }> {
  const results = await pool(criteria, CONCURRENCY, (c) => verifyOne(ctx, c, onlyFiles));
  return {
    checks: results.map((r) => r.check),
    findings: results.flatMap((r) => (r.finding ? [r.finding] : [])),
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 criterion ${one}` : `${n} criteria ${many}`);

/** Held while any criterion's latest check is a gap or has no evidence. */
export function qaGate(checks: Check[]): { state: GateState; reason: string } {
  if (checks.length === 0) return { state: "held", reason: "No criteria checked yet" };
  const latest = new Map<string, EvidenceState>();
  for (const c of checks) latest.set(c.criterionId, c.state); // last in array order wins
  let gaps = 0;
  let none = 0;
  for (const s of latest.values()) {
    if (s === "gap") gaps++;
    else if (s === "no_evidence") none++;
  }
  if (gaps + none === 0) return { state: "cleared", reason: "Every criterion has evidence found." };
  const parts = [];
  if (gaps) parts.push(plural(gaps, "has a gap", "have a gap"));
  if (none) parts.push(plural(none, "has no evidence yet", "have no evidence yet"));
  return { state: "held", reason: `${parts.join(" and ")}.` };
}
