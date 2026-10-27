import type { GateState, JsonSchema } from "../types.js";
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

const QUERY = "user account email phone password consent privacy delete payment card log retention";
const PREFIX = "Check this: ";

const str: JsonSchema = { type: "string" };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Never tell the owner they are "in breach". The legal term itself ("personal data breach") is allowed. */
const TERM = /\b(personal )?data breach(es)?\b|\bbreach notification\b/gi;
const ACCUSING = /\b(in|of|is|are|was|were|committed|constitutes?|amounts? to)\s+(a\s+)?breach\b|\bbreach(ed|es|ing)\b/i;
const accusing = (t: string): boolean => ACCUSING.test(t.replace(TERM, "data incident"));

/** The model sees the pack's own "breach" wording as "incident", so there is nothing to echo. Case is kept. */
const soften = (t: string): string => t.replace(/breach/gi, (m) => (m[0] === "B" ? "Incident" : "incident"));

interface RawLegalFinding extends RawFinding {
  citationId: string;
}

/** The as_built body as plain lines (one fact per line, so the model can quote a line), then the change description. */
function renderDocText(asBuilt: unknown, description: string): string {
  const lines: string[] = [];
  const b = (asBuilt && typeof asBuilt === "object" ? asBuilt : {}) as Record<string, unknown>;
  const labels: Array<[string, string]> = [
    ["flows", "Flow"],
    ["dataCollected", "Data collected"],
    ["payments", "Payment"],
    ["roles", "Role"],
  ];
  for (const [key, label] of labels) {
    const v = b[key];
    if (Array.isArray(v)) for (const item of v) lines.push(`${label}: ${String(item)}`);
  }
  if (typeof asBuilt === "string" && asBuilt.trim()) lines.push(asBuilt.trim());
  lines.push(description);
  return lines.join("\n");
}

export function complianceGate(openLegalFindings: number): { state: GateState; reason: string } {
  if (openLegalFindings > 0) {
    const n = openLegalFindings;
    return { state: "held", reason: `${n} legal finding${n === 1 ? "" : "s"} to check before release. Fix each one or accept the risk with a reason.` };
  }
  return { state: "cleared", reason: "No open legal findings." };
}

/**
 * Raises legal findings that cite only entries of the legal pack. For an `understand` change pass the
 * as_built body; for a feature change pass the newest as_built body (the caller finds it).
 */
export async function reviewCompliance(ctx: RoleContext, asBuiltOrChange: unknown, onlyFiles?: string[]): Promise<RoleResult> {
  const empty: RoleResult = { artifacts: [], criteria: [], findings: [], questions: [], affectedCriterionIds: [] };
  const pack = ctx.packs.legal;
  if (pack.length === 0) return empty;
  const ids = new Set(pack.map((d) => d.id));
  const docText = renderDocText(asBuiltOrChange, ctx.change.description);
  const seenDoc = defang(docText); // the model quotes the text it saw, so verify against that
  const fallbackQuote = seenDoc.split("\n").find((l) => l.trim() !== "");
  const mat = await repoMaterial(ctx.repo.dir, QUERY, { maxFiles: 20, maxChars: 40_000, onlyFiles });
  const entries = pack.map((d) => `${d.id} | ${d.law} | ${d.section} | ${soften(d.title)} | ${soften(d.duty)} | ${soften(d.triggers.join("; "))}`).join("\n");

  const { data } = await ctx.model<{ findings: RawLegalFinding[] }>({
    name: "compliance.reviewCompliance",
    system: systemPrompt(
      ctx.packs.role.compliance,
      `Task: review what the app does with people's data and card payments against the legal pack in the user message, and raise a finding for each pack entry the material supports. Set citationId to the id of the pack entry, exactly as listed. Cite only entries from the pack; if none fits, return no findings. Start every title and every plain text with "Check this: ". Say what the app does today, which duty it may touch and what to check. Never say the app is in breach, is illegal or breaks the law. Return at most 8 findings, most important first. The PCI DSS entries are a standard, not law. This is not legal advice. Every finding needs evidence: either a code trigger (triggerType "code", file and line exactly as numbered in the material, quote null) or a doc trigger (triggerType "doc", file and line null, quote copied word for word from the app description or the change description). Never cite a file, line or quote you were not given.`,
    ),
    user: `${contextBlock(ctx)}\n\n<<<BEGIN APP DESCRIPTION>>>\n${seenDoc}\n<<<END APP DESCRIPTION>>>\n\nLegal pack (id | law | section | title | duty | triggers):\n${entries}\n\n${mat.text}`,
    schema: obj({
      findings: {
        type: "array",
        items: obj({
          title: str,
          plain: str,
          costIfIgnored: str,
          fixPrompt: str,
          citationId: { type: "string", enum: [...ids] },
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

  const findings: RoleFinding[] = [];
  for (const f of data.findings) {
    if (!ids.has(f.citationId)) {
      console.warn(`compliance: dropped a finding citing "${f.citationId}", which is not in the legal pack ("${f.title}")`);
      continue;
    }
    const [k] = checkTriggers(ctx.repo.dir, [f], seenDoc, { commit: ctx.repo.commit, shown: mat.shown, kind: "legal", fallbackQuote });
    if (!k) continue;
    const out: RoleFinding = {
      ...k,
      citationId: f.citationId,
      title: k.title.startsWith(PREFIX) ? k.title : PREFIX + k.title,
      plain: k.plain.startsWith(PREFIX) ? k.plain : PREFIX + k.plain,
    };
    if (accusing(`${out.title} ${out.plain} ${out.fixPrompt}`)) {
      console.warn(`compliance: dropped a finding that accuses the owner of a breach ("${k.title}")`);
      continue;
    }
    findings.push(out);
  }
  return { ...empty, findings };
}
