import { driftRule } from "./drift.js";
import type { CopilotRecord } from "./record/record.js";
import type { Finding, FindingKind, RoleId, Trigger } from "./types.js";

export interface OpenItem {
  id: string;
  findingId: string | null;
  /** The change the finding was raised on, for a link to it. */
  changeId: string | null;
  kind: FindingKind | "setup";
  role: RoleId;
  title: string;
  why: string;
  where: string;
  requirementKey: string | null;
  requirementId: string | null;
  createdAt: string;
}

function where(t: Trigger): string {
  if (t.type === "code") return `${t.file}:${t.line}`;
  if (t.type === "screen") return t.url;
  return t.document ? (t.line ? `${t.document}:${t.line}` : t.document) : "documents";
}

/** Rank: legal, failure paths, drift, other conformance, operations, setup. */
function rank(record: CopilotRecord, f: Finding): number {
  if (f.kind === "legal") return 0;
  if (f.kind === "failure_path") return 1;
  if (driftRule(record, f.id)) return 2;
  return f.kind === "conformance" ? 3 : 4;
}

/** What is open on a project, most pressing first. The coding agent, the panel and the comments all read this. */
export function openItems(record: CopilotRecord, projectId: string): { total: number; items: OpenItem[] } {
  const ranked = record
    .listFindings({ projectId, status: "open" })
    .map((f) => ({ f, r: rank(record, f) }))
    .sort((a, b) => a.r - b.r || b.f.createdAt.localeCompare(a.f.createdAt));
  const items: OpenItem[] = ranked.map(({ f }) => {
    const req = record.linksFrom({ type: "finding", id: f.id }).find((l) => l.rel === "affects" && l.to.type === "requirement");
    return {
      id: f.id,
      findingId: f.id,
      changeId: f.changeId,
      kind: f.kind,
      role: f.role,
      title: f.title,
      why: f.plain,
      where: where(f.trigger),
      requirementKey: req ? record.getRequirement(req.to.id).key : null,
      requirementId: req?.to.id ?? null,
      createdAt: f.createdAt,
    };
  });
  if (!record.listDocuments(projectId).length) {
    items.push({
      id: `setup:documents:${projectId}`,
      findingId: null,
      changeId: null,
      kind: "setup",
      role: "ba",
      title: "No PRD or spec found",
      why: "Kryterea checks the code against what was agreed. Add a PRD or spec under docs/, or upload one.",
      where: "docs/",
      requirementKey: null,
      requirementId: null,
      createdAt: "",
    });
  }
  return { total: items.length, items };
}
