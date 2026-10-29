import type { JsonSchema, Model, RoleId } from "../types.js";
import { defang, systemPrompt } from "./context.js";

export interface ProposedChange {
  title: string;
  forWhom: string;
  why: string;
  findingIds: string[];
  criteria: Array<{ text: string; isFailurePath: boolean }>;
}

export interface Proposals {
  /** Findings that explain the owner's problem. Empty when there is no problem. */
  answersProblem: string[];
  /** Groups of findings that are the same problem in different words. */
  duplicates: string[][];
  changes: ProposedChange[];
}

export interface WriterFinding {
  id: string;
  role: RoleId;
  title: string;
  plain: string;
  where: string;
}

const strings = { type: "array", items: { type: "string" } };

// Finding ids are generated, so the model sees labels (F1, F2, ...) and the writer maps them back. `findingIds` holds labels.
const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    answersProblem: strings,
    duplicates: { type: "array", items: strings },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          forWhom: { type: "string" },
          why: { type: "string" },
          findingIds: strings,
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, isFailurePath: { type: "boolean" } },
              required: ["text", "isFailurePath"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "forWhom", "why", "findingIds", "criteria"],
        additionalProperties: false,
      },
    },
  },
  required: ["answersProblem", "duplicates", "changes"],
  additionalProperties: false,
};

const INSTRUCTIONS = `Task: turn the open findings into the changes the owner should approve. The owner is not an engineer.
Rules:
1. Write 1 to 5 changes. Each title says what will be true for the customer once it is done, not what the code does.
2. "forWhom" names who is affected. "why" is one plain sentence on what it costs if nothing is done.
3. Every finding goes in exactly one change. List findings by their labels (F1, F2, ...) in "findingIds".
4. Findings that are the same problem in different words go in one "duplicates" group and in the same change.
5. "answersProblem" lists the labels of the findings that explain the owner's problem. Leave it empty when the message says there is no problem.
6. Give each change the criteria that show it is done, marking the ones that cover what happens when something goes wrong.
7. Legal findings are the [compliance] ones. A change that closes a legal finding starts its title with "Check this: ", never says the owner is in breach or breaks the law, and names only the law entries its findings cite from the pack.
Return the changes, the duplicates and answersProblem.`;

/** One model call. Labels in, ids out: unknown labels are dropped, empty changes are dropped, a finding left out gets its own change. */
export async function writeChanges(
  input: { problem: string | null; findings: WriterFinding[] },
  model: Model,
  pack: string,
): Promise<Proposals> {
  const label = (i: number) => `F${i + 1}`;
  const ids = new Map(input.findings.map((f, i) => [label(i), f.id]));
  const list = input.findings
    .map((f, i) => `${label(i)}: [${f.role}] ${defang(f.title)}\n${defang(f.plain)}\nWhere: ${defang(f.where)}`)
    .join("\n\n");
  const problem = input.problem ? defang(input.problem) : "(none: this is a check of the whole repo)";
  const { data } = await model<Proposals>({
    name: "po.writeChanges",
    system: systemPrompt(pack, INSTRUCTIONS),
    user: `<<<BEGIN PROBLEM>>>\n${problem}\n<<<END PROBLEM>>>\n\n<<<BEGIN FINDINGS>>>\n${list}\n<<<END FINDINGS>>>`,
    schema: SCHEMA,
    maxOutputTokens: 8000,
    reasoningEffort: "low",
  });

  const toIds = (labels: unknown): string[] => {
    const out = (Array.isArray(labels) ? labels : []).map((l) => ids.get(String(l).trim().toUpperCase())).filter((id): id is string => !!id);
    return [...new Set(out)];
  };
  const taken = new Set<string>();
  const changes: ProposedChange[] = [];
  for (const c of Array.isArray(data.changes) ? data.changes : []) {
    // A finding lands in one change only: the first that names it.
    const findingIds = toIds(c.findingIds).filter((id) => !taken.has(id));
    if (!findingIds.length) continue;
    findingIds.forEach((id) => taken.add(id));
    changes.push({ title: c.title, forWhom: c.forWhom, why: c.why, findingIds, criteria: (c.criteria ?? []).map((k) => ({ text: k.text, isFailurePath: k.isFailurePath })) });
  }
  for (const f of input.findings) {
    if (!taken.has(f.id)) changes.push({ title: f.title, forWhom: "Anyone using the app", why: f.plain, findingIds: [f.id], criteria: [] });
  }
  return {
    answersProblem: input.problem ? toIds(data.answersProblem) : [],
    duplicates: (Array.isArray(data.duplicates) ? data.duplicates : []).map(toIds).filter((g) => g.length > 1),
    changes,
  };
}
