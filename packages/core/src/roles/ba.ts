import type { Criterion, GateState, JsonSchema } from "../types.js";
import {
  checkTriggers,
  contextBlock,
  defang,
  repoMaterial,
  systemPrompt,
  type RawFinding,
  type RoleContext,
  type RoleFinding,
  type RoleResult,
} from "./context.js";

const UNDERSTAND_QUERY = "routes pages api auth user payment order booking schema model";

// Schema helpers: every property is required (strict output); optional values are typed with null.
const str: JsonSchema = { type: "string" };
const strArr: JsonSchema = { type: "array", items: str };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });

const findingSchema = obj({
  title: str,
  plain: str,
  costIfIgnored: str,
  fixPrompt: str,
  triggerType: { type: "string", enum: ["code", "doc"] },
  file: { type: ["string", "null"] },
  line: { type: ["integer", "null"] },
  quote: { type: ["string", "null"] },
});
const criterionSchema = obj({ text: str, isFailurePath: { type: "boolean" }, requirementKeys: strArr });

interface RawCriterion {
  text: string;
  isFailurePath: boolean;
  requirementKeys?: string[];
}

const keepVerified = (raw: RawFinding[], ctx: RoleContext, shown: Map<string, number>): RoleFinding[] =>
  checkTriggers(ctx.repo.dir, raw, ctx.change.description, { commit: ctx.repo.commit, shown, kind: "failure_path" });

const criteriaOf = (raw: RawCriterion[]) =>
  raw.map((c) => ({ text: c.text, isFailurePath: c.isFailurePath, requirementKeys: c.requirementKeys ?? [] }));

export function baGate(questions: string[], answers: string[]): { state: GateState; reason: string } {
  if (questions.length === 0) return { state: "cleared", reason: "No open questions for the owner." };
  if (answers.length > 0) return { state: "cleared", reason: "The owner has answered the questions." };
  const n = questions.length;
  return { state: "held", reason: n === 1 ? "1 question waits for the owner." : `${n} questions wait for the owner.` };
}

export async function understandApp(ctx: RoleContext): Promise<RoleResult> {
  const mat = await repoMaterial(ctx.repo.dir, UNDERSTAND_QUERY, { maxFiles: 40, maxChars: 60_000 });
  const { data } = await ctx.model<{
    asBuilt: { flows: string[]; dataCollected: string[]; payments: string[]; roles: string[] };
    questions: Array<{ question: string; options: string[]; defaultIndex: number }>;
    findings: RawFinding[];
  }>({
    name: "ba.understandApp",
    system: systemPrompt(
      ctx.packs.role.ba,
      `Task: understand an existing app from its code. Describe what it does today: the flows a person can go through, the data it collects, how payments work, and who can do what. Then ask the owner 2 to 3 short questions to confirm intent. The owner is not a professional, so write each question in plain words, start it from something you saw in the code, and give it 2 or 3 short answers to pick from. Set defaultIndex to the safe answer: the one that protects customers and money. Then list failure-path findings: places where a step can fail, repeat or be reversed and the app does the wrong thing. Every finding needs a code trigger: set triggerType to "code" with the file and line exactly as numbered in the material, and set quote to null. Never cite a file or line that is not in the material. Do not write acceptance criteria.`,
    ),
    user: `${contextBlock(ctx)}\n\n${mat.text}`,
    schema: obj({
      asBuilt: obj({ flows: strArr, dataCollected: strArr, payments: strArr, roles: strArr }),
      questions: arr(obj({ question: str, options: strArr, defaultIndex: { type: "integer" } })),
      findings: arr(findingSchema),
    }),
    maxOutputTokens: 16000,
    reasoningEffort: "medium",
  });
  // A question with fewer than 2 answers cannot be picked from, so it is dropped.
  const asked = data.questions.filter((q) => q.options.length >= 2).slice(0, 3);
  return {
    artifacts: [{ kind: "as_built", body: data.asBuilt }],
    criteria: [],
    findings: keepVerified(data.findings, ctx, mat.shown),
    questions: asked.map((q) => q.question),
    questionOptions: asked.map((q) => ({ options: q.options, defaultIndex: Math.min(Math.max(q.defaultIndex, 0), q.options.length - 1) })),
    affectedCriterionIds: [],
  };
}

const CHANGE_QUERY = (ctx: RoleContext) => `${ctx.change.title} ${ctx.change.description}`;

const CHANGE_RULES = `Acceptance criteria are one sentence each about something a person can observe in the app. Each failure path (a declined card, a double click, a step cancelled halfway) gets its own criterion with isFailurePath true. A finding is a failure-path problem you can show evidence for. Its trigger is either a code trigger (triggerType "code", file and line exactly as numbered in the material, quote null) or a doc trigger (triggerType "doc", file and line null, quote copied word for word from the change description). Never cite a file, line or quote you were not given. For each criterion, list in requirementKeys the keys of the project requirements it covers, exactly as listed; empty if none.`;

/** The project's active requirements, so each criterion can name the ones it covers. */
const requirementsText = (ctx: RoleContext) =>
  ctx.requirements?.length
    ? `\n\nProject requirements (key: text):\n${ctx.requirements.map((r) => `${defang(r.key)}: ${defang(r.text)}`).join("\n")}`
    : "";

/** Keys the model named that are real requirements of the project. */
const realKeys = (ctx: RoleContext, criteria: RoleResult["criteria"]) => {
  const keys = new Set((ctx.requirements ?? []).map((r) => r.key));
  return criteria.map((c) => ({ ...c, requirementKeys: [...new Set(c.requirementKeys ?? [])].filter((k) => keys.has(k)) }));
};

export async function analyseChange(ctx: RoleContext): Promise<RoleResult> {
  const mat = await repoMaterial(ctx.repo.dir, CHANGE_QUERY(ctx), { maxFiles: 12, maxChars: 30_000 });
  const { data } = await ctx.model<{
    summary: string;
    criteria: RawCriterion[];
    findings: RawFinding[];
  }>({
    name: "ba.analyseChange",
    system: systemPrompt(
      ctx.packs.role.ba,
      `Task: analyse the change. If the change description is a pasted document, treat it as the source of what is wanted. Summarise what is being asked and who is affected, write acceptance criteria for the change. If the request is vague, state your assumptions in the summary. ${CHANGE_RULES}`,
    ),
    user: `${contextBlock(ctx)}${requirementsText(ctx)}\n\n${mat.text}`,
    schema: obj({ summary: str, criteria: arr(criterionSchema), findings: arr(findingSchema) }),
    maxOutputTokens: 8000,
    reasoningEffort: "medium",
  });
  return {
    artifacts: [{ kind: "analysis", body: { summary: data.summary } }],
    criteria: realKeys(ctx, criteriaOf(data.criteria)),
    findings: keepVerified(data.findings, ctx, mat.shown),
    questions: [],
    affectedCriterionIds: [],
  };
}

export async function analyseImpact(ctx: RoleContext, existing: Criterion[]): Promise<RoleResult> {
  const mat = await repoMaterial(ctx.repo.dir, CHANGE_QUERY(ctx), { maxFiles: 12, maxChars: 30_000 });
  const labelled = existing.map((c, i) => ({ label: `C${i + 1}`, id: c.id, text: c.text }));
  const list = labelled.length ? labelled.map((c) => `${c.label}: ${c.text}`).join("\n") : "(none)";
  const { data } = await ctx.model<{
    summary: string;
    affected: string[];
    criteria: RawCriterion[];
    findings: RawFinding[];
  }>({
    name: "ba.analyseImpact",
    system: systemPrompt(
      ctx.packs.role.ba,
      `Task: work out the impact of the change on what already exists. From the existing criteria listed in the user message, return in "affected" the labels (such as C1) of those the change could break or alter; return only labels from that list. Write new criteria for the change, and failure-path findings. ${CHANGE_RULES}`,
    ),
    user: `${contextBlock(ctx)}${requirementsText(ctx)}\n\nExisting criteria:\n${list}\n\n${mat.text}`,
    schema: obj({ summary: str, affected: strArr, criteria: arr(criterionSchema), findings: arr(findingSchema) }),
    maxOutputTokens: 8000,
    reasoningEffort: "medium",
  });
  const byLabel = new Map(labelled.map((c) => [c.label, c.id]));
  const affected = [...new Set(data.affected.map((l) => byLabel.get(l.trim())).filter((id): id is string => !!id))];
  return {
    artifacts: [{ kind: "impact", body: { summary: data.summary } }],
    criteria: realKeys(ctx, criteriaOf(data.criteria)),
    findings: keepVerified(data.findings, ctx, mat.shown),
    questions: [],
    affectedCriterionIds: affected,
  };
}
