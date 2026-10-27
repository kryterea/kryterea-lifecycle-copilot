import type { AcceptanceRecord, GateMap, GateState, JsonSchema, Model, RoleId } from "../types.js";
import { defang, systemPrompt } from "./context.js";

const REQUIRED_GATES: Array<[RoleId, string]> = [
  ["ba", "business analyst"],
  ["architect", "architect"],
  ["qa", "QA"],
  ["compliance", "compliance"],
];

/** Cleared only when the other four gates are cleared and the owner has accepted. A missing gate counts as held. */
export function poGate(gates: GateMap | Partial<Record<RoleId, { state: GateState }>>, accepted: boolean): { state: GateState; reason: string } {
  const held = REQUIRED_GATES.filter(([id]) => gates[id]?.state !== "cleared").map(([, name]) => name);
  if (held.length === 0 && accepted) return { state: "cleared", reason: "Every other gate is cleared and the owner has accepted." };
  const parts = [];
  if (held.length) parts.push(`Held by: ${held.join(", ")}`);
  if (!accepted) parts.push(held.length ? "Also waiting for the owner to accept" : "Every other gate is cleared, waiting for the owner to accept");
  return { state: "held", reason: parts.join(". ") };
}

const SCHEMA: JsonSchema = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};

const INSTRUCTIONS = `Task: write the acceptance summary for the change in the record. Write at most 200 words, in plain language, for a client or an auditor who has not followed the work. Cover four things: what was agreed, what evidence was found, what is still open, and which decisions were made by whom. Use only what the record shows. Plain paragraphs, no headings or lists. Return it as "summary".`;

const MAX_WORDS = 200;

/** One model call. The caller (the workflow) stores the returned text as an artifact of kind `acceptance_summary`. */
export async function acceptanceSummary(rec: AcceptanceRecord, model: Model, pack: string): Promise<string> {
  const { data } = await model<{ summary: string }>({
    name: "po.acceptanceSummary",
    system: systemPrompt(pack, INSTRUCTIONS),
    user: `Acceptance record:\n<<<BEGIN RECORD>>>\n${defang(JSON.stringify(rec))}\n<<<END RECORD>>>`,
    schema: SCHEMA,
    maxOutputTokens: 4000,
    reasoningEffort: "low",
  });
  // Length is enforced here, not by the token cap.
  return String(data.summary ?? "").trim().split(/\s+/).slice(0, MAX_WORDS).join(" ");
}
