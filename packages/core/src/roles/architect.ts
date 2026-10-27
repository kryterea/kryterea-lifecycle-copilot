import type { GateState, JsonSchema } from "../types.js";
import {
  checkTriggers,
  contextBlock,
  defang,
  renderDocText,
  repoMaterial,
  systemPrompt,
  type RawFinding,
  type RoleContext,
  type RoleResult,
} from "./context.js";

const QUERY = "env config deploy database backup rate limit log monitor error";

const str: JsonSchema = { type: "string" };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export function architectGate(openOperationsFindings: number): { state: GateState; reason: string } {
  if (openOperationsFindings > 0) {
    const n = openOperationsFindings;
    return { state: "held", reason: `${n} operations finding${n === 1 ? "" : "s"} to deal with before release. Fix each one or accept the risk with a reason.` };
  }
  return { state: "cleared", reason: "No open operations findings." };
}

/**
 * Raises operations findings: what happens when the app runs for real. For an `understand` change pass the
 * as_built body; for a feature change pass the newest as_built body (the caller finds it).
 */
export async function reviewOperations(ctx: RoleContext, asBuiltOrChange: unknown, onlyFiles?: string[]): Promise<RoleResult> {
  const docText = renderDocText(asBuiltOrChange, ctx.change.description);
  const seenDoc = defang(docText); // the model quotes the text it saw, so verify against that
  const fallbackQuote = seenDoc.split("\n").find((l) => l.trim() !== "");
  // ".github" is opted in so CI and deploy workflows are visible; other dot directories stay out.
  const mat = await repoMaterial(ctx.repo.dir, QUERY, { maxFiles: 20, maxChars: 40_000, onlyFiles, allowDotDirs: [".github"] });

  const { data } = await ctx.model<{ findings: RawFinding[] }>({
    name: "architect.reviewOperations",
    system: systemPrompt(
      ctx.packs.role.architect,
      `Task: review how this app would run for real and raise operations findings. Cover these five areas where the material supports them: backups (what could be restored if the data store vanished), rate limits (can one person or script hammer sign-in, payment or booking), monitoring (how the owner would find out something broke), behaviour at ten times the users (the first thing that would slow down or stop), and support when something breaks (what the owner can look up when a customer says "I paid but got nothing"). Return at most 8 findings, most important first. Raise a finding only where the material shows the app depends on the thing or shows nothing in place for it. Say each one in terms the owner can see: what happens to customers or the business, not code. Every fixPrompt must be a ready-to-paste instruction a coding agent can act on in one change. Every finding needs evidence: either a code trigger (triggerType "code", file and line exactly as numbered in the material, quote null) or a doc trigger (triggerType "doc", file and line null, quote copied word for word from the app description or the change description). Never cite a file, line or quote you were not given.`,
    ),
    user: `${contextBlock(ctx)}\n\n<<<BEGIN APP DESCRIPTION>>>\n${seenDoc}\n<<<END APP DESCRIPTION>>>\n\n${mat.text}`,
    schema: obj({
      findings: {
        type: "array",
        items: obj({
          title: str,
          plain: str,
          costIfIgnored: str,
          fixPrompt: str,
          triggerType: { type: "string", enum: ["code", "doc"] },
          file: { type: ["string", "null"] },
          line: { type: ["integer", "null"] },
          quote: { type: ["string", "null"] },
        }),
      },
    }),
    maxOutputTokens: 16000,
    reasoningEffort: "medium",
  });

  const findings = checkTriggers(ctx.repo.dir, data.findings, seenDoc, { commit: ctx.repo.commit, shown: mat.shown, kind: "operations", fallbackQuote });
  return { artifacts: [], criteria: [], findings, questions: [], affectedCriterionIds: [] };
}
