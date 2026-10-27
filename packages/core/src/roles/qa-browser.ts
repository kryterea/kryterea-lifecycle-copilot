import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Check, Criterion, EvidenceState, JsonSchema, Trigger } from "../types.js";
import { contextBlock, defang, systemPrompt, type RoleContext, type RoleResult } from "./context.js";

/** One step the model asks for. Targets are found by accessible role and name, the way a person reads the page. */
export interface PageAction {
  kind: "click" | "fill" | "goto" | "done";
  role: string | null;
  name: string | null;
  /** fill: the text to type. goto: a path on the app, such as /admin. */
  value: string | null;
}

/** The browser as QA uses it. The server supplies a Playwright one; tests supply a fake. */
export interface AppPage {
  goto(url: string): Promise<void>;
  /** The page's accessibility tree as text. */
  snapshot(): Promise<string>;
  act(a: PageAction): Promise<void>;
  /** PNG bytes of the visible page. */
  screenshot(): Promise<Uint8Array>;
  url(): string;
  close(): Promise<void>;
}

export type OpenPage = () => Promise<AppPage>;

export const MAX_STEPS = 8;
const SNAPSHOT_CHARS = 12_000;
const MAX_IMAGES = 4;

const nullableStr: JsonSchema = { type: ["string", "null"] };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const STEP_SCHEMA = obj({
  kind: { type: "string", enum: ["click", "fill", "goto", "done"] },
  role: nullableStr,
  name: nullableStr,
  value: nullableStr,
  reason: { type: "string" },
});

const JUDGE_SCHEMA = obj({
  state: { type: "string", enum: ["evidence_found", "gap", "no_evidence"] },
  note: { type: "string" },
  title: nullableStr,
  plain: nullableStr,
  costIfIgnored: nullableStr,
  fixPrompt: nullableStr,
});

const STEP_INSTRUCTIONS = `Task: you are testing the running app by hand to see whether it does what one acceptance criterion says. You get the page's accessibility tree and the steps taken so far. Choose the single next step: "click" a control (role and name exactly as in the tree), "fill" a text box (role, name and the value to type), "goto" a path on this app (value, such as /admin), or "done" once you have seen enough to judge the criterion either way. Use made up test details (for example test@example.com), never real personal or card data. Stay on this app.`;

const JUDGE_INSTRUCTIONS = `Task: from the screenshots of the steps just taken in the running app, decide whether the app does what this one acceptance criterion says. Choose "evidence_found" only if the screenshots show it working, "gap" only if they show it missing or wrong, otherwise "no_evidence". Write "note" as one or two plain sentences an owner can follow. For a gap also fill title, plain (what the customer saw), costIfIgnored and fixPrompt (an instruction for a coding agent naming the behaviour wanted). Otherwise set those four to null.`;

/**
 * QA tries the criterion in the running app: at most MAX_STEPS model-chosen steps on the app's own origin, then one
 * judgement from the screenshots. A flow that does not finish in time, or that tries to leave the app, has no
 * evidence. Screenshots are saved to `screensDir` and cited as screen triggers.
 */
export async function exploreFlow(
  ctx: RoleContext,
  criterion: Criterion,
  appUrl: string,
  open: OpenPage,
  screensDir?: string,
): Promise<{ check: Check; screenshots: string[]; finding?: RoleResult["findings"][number] }> {
  const origin = new URL(appUrl).origin;
  const base = { criterionId: criterion.id, runId: ctx.runId };
  const noEvidence = (note: string, screenshots: string[]) => ({ check: { ...base, state: "no_evidence" as const, evidence: [], note }, screenshots });
  const page = await open();
  const shots: Array<{ url: string; png: Uint8Array }> = [];
  const log: string[] = [];
  try {
    await page.goto(origin + new URL(appUrl).pathname);
    shots.push({ url: page.url(), png: await page.screenshot() });
    let finished = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const tree = (await page.snapshot()).slice(0, SNAPSHOT_CHARS);
      const { data } = await ctx.model<PageAction & { reason: string }>({
        name: "qa.exploreStep",
        system: systemPrompt(ctx.packs.role.qa, STEP_INSTRUCTIONS),
        user: `${contextBlock(ctx)}\n\nCriterion:\n<<<BEGIN CRITERION>>>\n${defang(criterion.text)}\n<<<END CRITERION>>>\n\nSteps so far:\n${log.join("\n") || "(none)"}\n\nPage ${defang(page.url())}:\n<<<BEGIN PAGE>>>\n${defang(tree)}\n<<<END PAGE>>>`,
        schema: STEP_SCHEMA,
        maxOutputTokens: 4000,
        reasoningEffort: "low",
      });
      if (data.kind === "done") {
        finished = true;
        break;
      }
      if (data.kind === "goto") {
        const target = new URL(data.value ?? "/", origin);
        if (target.origin !== origin) return noEvidence("The test tried to leave the app, so it stopped.", []);
        await page.goto(target.href);
      } else {
        await page.act(data).catch(() => log.push(`  (could not ${data.kind} ${data.role ?? ""} "${data.name ?? ""}")`));
      }
      // A click can navigate; anything off the app's origin ends the test.
      if (new URL(page.url()).origin !== origin) return noEvidence("The test followed a link off the app, so it stopped.", []);
      log.push(`${step + 1}. ${data.kind} ${data.role ?? ""} ${data.name ? `"${data.name}"` : ""}${data.kind === "fill" ? " (text typed)" : ""}`.trim());
      shots.push({ url: page.url(), png: await page.screenshot() });
    }

    const saved = save(shots, screensDir, criterion.id, ctx.runId);
    if (!finished) return noEvidence(`The flow did not finish within ${MAX_STEPS} steps.`, saved);

    const recent = shots.slice(-MAX_IMAGES);
    const { data } = await ctx.model<{ state: EvidenceState; note: string; title: string | null; plain: string | null; costIfIgnored: string | null; fixPrompt: string | null }>({
      name: "qa.judgeFlow",
      system: systemPrompt(ctx.packs.role.qa, JUDGE_INSTRUCTIONS),
      user: `${contextBlock(ctx)}\n\nCriterion (${criterion.isFailurePath ? "failure path" : "normal path"}):\n<<<BEGIN CRITERION>>>\n${defang(criterion.text)}\n<<<END CRITERION>>>\n\nSteps taken:\n${log.join("\n") || "(only the first page)"}\n\nThe last ${recent.length} screenshots follow in order.`,
      schema: JUDGE_SCHEMA,
      maxOutputTokens: 4000,
      reasoningEffort: "low",
      images: recent.map((s) => `data:image/png;base64,${Buffer.from(s.png).toString("base64")}`),
    });

    const last = shots.at(-1)!;
    const evidence: Trigger[] = [{ type: "screen", url: last.url, screenshotPath: saved.at(-1) ?? "" }];
    if (data.state === "evidence_found") return { check: { ...base, state: "evidence_found", evidence, note: data.note }, screenshots: saved };
    if (data.state !== "gap") return noEvidence(data.note, saved);
    return {
      check: { ...base, state: "gap", evidence, note: data.note },
      screenshots: saved,
      finding: {
        kind: criterion.isFailurePath ? "failure_path" : "conformance",
        title: data.title?.trim() || `Seen in the app: ${criterion.text.slice(0, 80)}`,
        plain: data.plain?.trim() || data.note,
        costIfIgnored: data.costIfIgnored?.trim() || "The app ships a promise it does not keep.",
        fixPrompt: `${data.fixPrompt?.trim() || `Make this true: "${criterion.text}".`} Seen at ${last.url}.`,
        trigger: evidence[0]!,
        criterionId: criterion.id,
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Writes the screenshots as PNG files and returns their file names; nothing is written without a folder. */
function save(shots: Array<{ png: Uint8Array }>, dir: string | undefined, criterionId: string, runId: string): string[] {
  if (!dir) return [];
  mkdirSync(dir, { recursive: true });
  return shots.map((s, i) => {
    const name = `${runId}-${criterionId}-${i + 1}.png`;
    writeFileSync(join(dir, name), s.png);
    return name;
  });
}
