import type { CommitCompare, EvidenceState, FindingStatus } from "@lifecycle/core";
import { mdLine } from "./linear.js";

const STATUS: Record<FindingStatus, string> = { open: "Open", fixed: "Fixed", accepted_risk: "Risk accepted", deferred: "Deferred" };
const EVIDENCE: Record<EvidenceState, string> = { evidence_found: "Evidence found", gap: "Gap", no_evidence: "No evidence" };
const METRICS = [
  ["open", "Open items"],
  ["evidenceFound", "Evidence found"],
  ["gaps", "Gaps"],
  ["noEvidence", "No evidence"],
] as const;

const change = (before: number, after: number) => {
  const d = after - before;
  return d === 0 ? "Same" : `${Math.abs(d)} ${d < 0 ? "fewer" : "more"}`;
};

/** A before and after as Markdown for a public page: model text is escaped, numbers come straight from the record. */
export function compareMarkdown(project: string, cmp: CommitCompare): string {
  const closed = cmp.findings.filter((f) => f.from === "open" && f.to !== null && f.to !== "open");
  const added = cmp.findings.filter((f) => f.from !== "open" && f.to === "open");
  const still = cmp.findings.filter((f) => f.from === "open" && f.to === "open");
  const moved = cmp.criteria.filter((k) => k.from !== k.to);
  const same = cmp.criteria.length - moved.length;
  const list = (rows: string[], empty: string) => (rows.length ? rows.join("\n") : empty);

  return [
    `# Before and after: ${mdLine(project)}`,
    "",
    `Kryterea checked \`${cmp.from.sha.slice(0, 7)}\` (before) and \`${cmp.to.sha.slice(0, 7)}\` (after). Each side is the record as it stood while that commit was the latest one checked, decisions included.`,
    "",
    "| | Before | After | Change |",
    "|---|---|---|---|",
    ...METRICS.map(([key, label]) => `| ${label} | ${cmp.from[key]} | ${cmp.to[key]} | ${change(cmp.from[key], cmp.to[key])} |`),
    "",
    `## Closed (${closed.length})`,
    "",
    list(closed.map((f) => `- ${STATUS[f.to!]}: ${mdLine(f.title)}`), "Nothing open before was closed."),
    "",
    `## New (${added.length})`,
    "",
    list(added.map((f) => `- ${mdLine(f.title)}`), "Nothing new opened."),
    "",
    `## Still open (${still.length})`,
    "",
    list(still.map((f) => `- ${mdLine(f.title)}`), "Nothing open before is still open."),
    "",
    "## Acceptance criteria that moved",
    "",
    list(
      moved.map((k) => {
        const keys = k.requirementKeys.length ? `${k.requirementKeys.map((x) => mdLine(x)).join(", ")} ` : "";
        return `- ${k.from ? EVIDENCE[k.from] : "Not checked"} to ${k.to ? EVIDENCE[k.to] : "Not checked"}: ${keys}${mdLine(k.text)}`;
      }),
      "No criterion changed state.",
    ),
    ...(same > 0 ? ["", `${same === 1 ? "1 criterion" : `${same} criteria`} unchanged.`] : []),
    "",
    "Generated from the Kryterea record. Legal items are things to check, not legal advice.",
    "",
  ].join("\n");
}
