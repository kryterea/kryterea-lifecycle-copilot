import type { JsonSchema, Requirement } from "../types.js";
import { contextBlock, defang, documentsBlock, quoteNear, systemPrompt, type RoleContext, type RoleResult } from "./context.js";

// Schema helpers: every property is required (strict output); optional values are typed with null.
const str: JsonSchema = { type: "string" };
const int: JsonSchema = { type: "integer" };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });

const MAX_GAPS = 8;

const GAP_KINDS = ["quality", "failure_path", "contradiction", "missing_need"] as const;

interface RawRequirement {
  document: string;
  key: string;
  text: string;
  quote: string;
  line: number;
}

interface RawGap {
  document: string;
  kind: (typeof GAP_KINDS)[number];
  title: string;
  plain: string;
  costIfIgnored: string;
  fixPrompt: string;
  quote: string;
  line: number;
}

export interface ReadRequirement {
  document: string;
  key: string;
  text: string;
  quote: string;
  line: number;
}

const INSTRUCTIONS = `Task: read the project's documents (PRD, specs, requirements) like a professional business analyst.
1. Extract each requirement: one thing the product must do or be. Give its text in one sentence, its exact quote copied word for word from one line of the document, and that line's number as shown. Keep an ID written in the document (such as FR-3) as its key. Otherwise, when it is the same requirement as one in the previous requirements listed for that document (even reworded), reuse that key. Otherwise use the document's short name in capitals, a hyphen and the next free number (such as PRD-4).
2. Raise at most ${MAX_GAPS} gaps, most important first. Check each requirement against the qualities in ISO/IEC/IEEE 29148 (necessary, unambiguous, verifiable, consistent, complete) and use kind "quality" for a requirement that lacks one. Use "failure_path" for a step that can fail, repeat or be reversed with no rule for it, "contradiction" when two documents or two lines disagree, and "missing_need" for a missing compliance, security or operations need. Each gap quotes the document word for word with its document name and line number. Say each gap in terms the owner can act on: title starts with what is wrong in plain words, fixPrompt says what to write in the document.
Never quote text, a document or a line you were not given.`;

/** The document's short name for new keys: "docs/PRD.md" gives "PRD". */
const prefixOf = (name: string) =>
  (name.split("/").at(-1) ?? name).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 12) || "DOC";

/**
 * The analyst reads the documents: requirements with their quote and line, and document gaps as findings. A
 * requirement or gap whose quote is not on or near its line in a document it was given is dropped. Keys repeated
 * within one document get the next free number, so no requirement is stored twice.
 */
export async function reviewDocuments(
  ctx: RoleContext,
  docs: Array<{ name: string; body: string }>,
  previous: Requirement[],
): Promise<{ requirements: ReadRequirement[]; findings: RoleResult["findings"] }> {
  const block = documentsBlock(docs);
  const prev = previous.length ? previous.map((r) => `- ${defang(r.key)}: ${defang(r.text)}`).join("\n") : "(none)";
  const { data } = await ctx.model<{ requirements: RawRequirement[]; gaps: RawGap[] }>({
    name: "ba.reviewDocuments",
    system: systemPrompt(ctx.packs.role.ba, INSTRUCTIONS),
    user: `${contextBlock(ctx)}\n\nPrevious requirements (reuse a key when it is the same requirement):\n${prev}\n\n${block.text}`,
    schema: obj({
      requirements: arr(obj({ document: str, key: str, text: str, quote: str, line: int })),
      gaps: arr(
        obj({
          document: str,
          kind: { type: "string", enum: [...GAP_KINDS] },
          title: str,
          plain: str,
          costIfIgnored: str,
          fixPrompt: str,
          quote: str,
          line: int,
        }),
      ),
    }),
    maxOutputTokens: 16000,
    reasoningEffort: "medium",
  });
  const real = (d: { document: string; quote: string; line: number }) => {
    const lines = block.lines.get(d.document);
    return lines !== undefined && quoteNear(lines, d.quote, d.line);
  };

  // A new number never takes a previous key: that would give a new requirement an old one's history.
  const taken = new Set(previous.map((p) => p.key));
  const used = new Map<string, Set<string>>();
  const requirements: ReadRequirement[] = [];
  for (const r of data.requirements.filter(real)) {
    const keys = used.get(r.document) ?? new Set<string>();
    used.set(r.document, keys);
    let key = r.key.trim();
    if (!key || keys.has(key)) {
      const prefix = prefixOf(r.document);
      let n = 1;
      while (keys.has(`${prefix}-${n}`) || taken.has(`${prefix}-${n}`)) n++;
      key = `${prefix}-${n}`;
    }
    keys.add(key);
    requirements.push({ document: r.document, key, text: r.text, quote: r.quote, line: r.line });
  }

  const findings = data.gaps
    .filter(real)
    .slice(0, MAX_GAPS)
    .map((g) => ({
      kind: g.kind === "failure_path" ? ("failure_path" as const) : ("conformance" as const),
      title: g.title,
      plain: g.plain,
      costIfIgnored: g.costIfIgnored,
      fixPrompt: g.fixPrompt,
      trigger: { type: "doc" as const, quote: g.quote, document: g.document, line: g.line },
    }));
  return { requirements, findings };
}
