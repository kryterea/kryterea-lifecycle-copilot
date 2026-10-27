import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Artifact,
  Change,
  ChangeKind,
  AcceptanceRecord,
  Check,
  Criterion,
  DocSettings,
  Document,
  DocumentVersion,
  EvidenceState,
  Finding,
  FindingInput,
  FindingStatus,
  GateMap,
  GateState,
  LinkEnd,
  LinkRel,
  Project,
  Requirement,
  RequirementEvent,
  RequirementLink,
  RoleId,
  RunStatus,
  SpendLedger,
  StageId,
  Trigger,
} from "../types.js";
import { SCHEMA } from "./schema.js";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

/** Actor recorded for status changes the copilot makes itself. */
export const SYSTEM_ACTOR = "copilot";

export function findingFingerprint(projectId: string, role: RoleId, kind: string, title: string): string {
  const normal = title.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${projectId}|${role}|${kind}|${normal}`).digest("hex");
}

function toProject(r: Row): Project {
  return {
    id: r.id as string,
    name: r.name as string,
    repoUrl: r.repo_url as string,
    appUrl: (r.app_url as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toChange(r: Row): Change {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    description: r.description as string,
    kind: r.kind as ChangeKind,
    stage: r.stage as StageId,
    createdAt: r.created_at as string,
  };
}

function toArtifact(r: Row): Artifact {
  return {
    id: r.id as string,
    changeId: r.change_id as string,
    role: r.role as Artifact["role"],
    stage: r.stage as StageId,
    kind: r.kind as string,
    body: JSON.parse(r.body as string) as unknown,
    createdAt: r.created_at as string,
  };
}

function toCriterion(r: Row): Criterion {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    changeId: r.change_id as string,
    text: r.text as string,
    isFailurePath: r.is_failure_path === 1,
    createdAt: r.created_at as string,
  };
}

function toFinding(r: Row): Finding {
  const f: Finding = {
    id: r.id as string,
    projectId: r.project_id as string,
    changeId: r.change_id as string,
    runId: r.run_id as string,
    role: r.role as RoleId,
    stage: r.stage as StageId,
    kind: r.kind as Finding["kind"],
    title: r.title as string,
    plain: r.plain as string,
    costIfIgnored: r.cost_if_ignored as string,
    fixPrompt: r.fix_prompt as string,
    trigger: JSON.parse(r.trigger as string) as Trigger,
    fingerprint: r.fingerprint as string,
    createdAt: r.created_at as string,
  };
  if (r.citation_id != null) f.citationId = r.citation_id as string;
  if (r.criterion_id != null) f.criterionId = r.criterion_id as string;
  return f;
}

function toDocument(r: Row): Document {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    source: r.source as Document["source"],
    createdAt: r.created_at as string,
  };
}

function toRequirement(r: Row): Requirement {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    documentId: r.document_id as string,
    key: r.key as string,
    text: r.text as string,
    quote: r.quote as string,
    line: r.line as number,
    status: r.status as Requirement["status"],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toLink(r: Row): RequirementLink {
  return {
    requirementId: r.requirement_id as string,
    toType: r.to_type as RequirementLink["toType"],
    toId: r.to_id as string,
    createdAt: r.created_at as string,
  };
}

const LATEST_STATUS =
  "(SELECT status FROM finding_status_events e WHERE e.finding_id = f.id ORDER BY e.seq DESC LIMIT 1)";

export class CopilotRecord {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): CopilotRecord {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    return new CopilotRecord(db);
  }

  close(): void {
    this.db.close();
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  createProject(i: { name: string; repoUrl: string; appUrl?: string }): Project {
    const p: Project = {
      id: randomUUID(),
      name: i.name,
      repoUrl: i.repoUrl,
      appUrl: i.appUrl ?? null,
      createdAt: now(),
    };
    this.run(
      "INSERT INTO projects (id, name, repo_url, app_url, created_at) VALUES (?, ?, ?, ?, ?)",
      p.id,
      p.name,
      p.repoUrl,
      p.appUrl,
      p.createdAt,
    );
    return p;
  }

  getProject(id: string): Project {
    const r = this.one("SELECT * FROM projects WHERE id = ?", id);
    if (!r) throw new Error(`Project not found: ${id}`);
    return toProject(r);
  }

  listProjects(): Project[] {
    return this.all("SELECT * FROM projects ORDER BY rowid").map(toProject);
  }

  createChange(i: { projectId: string; title: string; description: string; kind: ChangeKind }): Change {
    const c: Change = { id: randomUUID(), ...i, stage: "intake", createdAt: now() };
    this.run(
      "INSERT INTO changes (id, project_id, title, description, kind, stage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      c.id,
      c.projectId,
      c.title,
      c.description,
      c.kind,
      c.stage,
      c.createdAt,
    );
    return c;
  }

  getChange(id: string): Change {
    const r = this.one("SELECT * FROM changes WHERE id = ?", id);
    if (!r) throw new Error(`Change not found: ${id}`);
    return toChange(r);
  }

  listChanges(projectId: string): Change[] {
    return this.all("SELECT * FROM changes WHERE project_id = ? ORDER BY rowid", projectId).map(toChange);
  }

  setStage(changeId: string, stage: StageId): void {
    if (this.run("UPDATE changes SET stage = ? WHERE id = ?", stage, changeId) === 0) {
      throw new Error(`Change not found: ${changeId}`);
    }
  }

  addArtifact(i: Omit<Artifact, "id" | "createdAt">): Artifact {
    const a: Artifact = { id: randomUUID(), ...i, createdAt: now() };
    this.run(
      "INSERT INTO artifacts (id, change_id, role, stage, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      a.id,
      a.changeId,
      a.role,
      a.stage,
      a.kind,
      JSON.stringify(a.body),
      a.createdAt,
    );
    return a;
  }

  listArtifacts(changeId: string): Artifact[] {
    return this.all("SELECT * FROM artifacts WHERE change_id = ? ORDER BY rowid", changeId).map(toArtifact);
  }

  addCriterion(i: Omit<Criterion, "id" | "createdAt">): Criterion {
    const c: Criterion = { id: randomUUID(), ...i, createdAt: now() };
    this.run(
      "INSERT INTO criteria (id, project_id, change_id, text, is_failure_path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.id,
      c.projectId,
      c.changeId,
      c.text,
      c.isFailurePath ? 1 : 0,
      c.createdAt,
    );
    return c;
  }

  listCriteria(projectId: string): Criterion[] {
    return this.all("SELECT * FROM criteria WHERE project_id = ? ORDER BY rowid", projectId).map(toCriterion);
  }

  link(from: LinkEnd, rel: LinkRel, to: LinkEnd): void {
    this.run(
      "INSERT INTO links (from_type, from_id, rel, to_type, to_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
      from.type,
      from.id,
      rel,
      to.type,
      to.id,
    );
  }

  private statusEvent(findingId: string, status: FindingStatus, reason: string, actor: string): void {
    this.run(
      "INSERT INTO finding_status_events (finding_id, status, reason, actor, at) VALUES (?, ?, ?, ?, ?)",
      findingId,
      status,
      reason,
      actor,
      now(),
    );
  }

  /** Same issue again (same fingerprint) adds evidence to the existing finding. */
  addFinding(i: FindingInput): { finding: Finding; isNew: boolean } {
    const fingerprint = findingFingerprint(i.projectId, i.role, i.kind, i.title);
    const existing = this.one("SELECT * FROM findings WHERE fingerprint = ?", fingerprint);
    const at = now();
    let finding: Finding;
    let isNew: boolean;
    this.db.exec("BEGIN");
    try {
      if (existing) {
        finding = toFinding(existing);
        isNew = false;
        if (this.findingStatus(finding.id) === "fixed") {
          this.statusEvent(finding.id, "open", "Raised again", SYSTEM_ACTOR);
        }
      } else {
        finding = { ...i, id: randomUUID(), fingerprint, createdAt: at };
        isNew = true;
        this.run(
          `INSERT INTO findings (id, project_id, change_id, run_id, role, stage, kind, title, plain,
            cost_if_ignored, fix_prompt, trigger, citation_id, criterion_id, fingerprint, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          finding.id,
          i.projectId,
          i.changeId,
          i.runId,
          i.role,
          i.stage,
          i.kind,
          i.title,
          i.plain,
          i.costIfIgnored,
          i.fixPrompt,
          JSON.stringify(i.trigger),
          i.citationId ?? null,
          i.criterionId ?? null,
          fingerprint,
          at,
        );
        this.statusEvent(finding.id, "open", "Raised", SYSTEM_ACTOR);
      }
      this.run(
        "INSERT INTO finding_evidence (finding_id, run_id, trigger, at) VALUES (?, ?, ?, ?)",
        finding.id,
        i.runId,
        JSON.stringify(i.trigger),
        at,
      );
      this.link({ type: "finding", id: finding.id }, "raised_on", { type: "change", id: i.changeId });
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { finding, isNew };
  }

  setFindingStatus(findingId: string, status: FindingStatus, reason: string, actor: string): void {
    if (!this.one("SELECT 1 AS x FROM findings WHERE id = ?", findingId)) {
      throw new Error(`Finding not found: ${findingId}`);
    }
    this.statusEvent(findingId, status, reason, actor);
  }

  findingStatus(findingId: string): FindingStatus {
    const r = this.one(
      "SELECT status FROM finding_status_events WHERE finding_id = ? ORDER BY seq DESC LIMIT 1",
      findingId,
    );
    if (!r) throw new Error(`Finding not found: ${findingId}`);
    return r.status as FindingStatus;
  }

  listFindings(filter: {
    projectId?: string;
    changeId?: string;
    status?: FindingStatus;
  }): Array<Finding & { status: FindingStatus }> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId) {
      where.push("f.project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.changeId) {
      where.push(
        "EXISTS (SELECT 1 FROM links l WHERE l.from_type = 'finding' AND l.from_id = f.id AND l.rel = 'raised_on' AND l.to_type = 'change' AND l.to_id = ?)",
      );
      params.push(filter.changeId);
    }
    if (filter.status) {
      where.push(`${LATEST_STATUS} = ?`);
      params.push(filter.status);
    }
    const sql = `SELECT f.*, ${LATEST_STATUS} AS status FROM findings f${
      where.length ? " WHERE " + where.join(" AND ") : ""
    } ORDER BY f.rowid`;
    return this.all(sql, ...params).map((r) => ({ ...toFinding(r), status: r.status as FindingStatus }));
  }

  /** Order of the finding's latest status event among all status events. */
  lastStatusSeq(findingId: string): number {
    return Number(this.one("SELECT MAX(seq) AS seq FROM finding_status_events WHERE finding_id = ?", findingId)?.seq ?? 0);
  }

  findingHistory(findingId: string): Array<{ status: FindingStatus; reason: string; actor: string; at: string }> {
    return this.all("SELECT * FROM finding_status_events WHERE finding_id = ? ORDER BY seq", findingId).map((r) => ({
      status: r.status as FindingStatus,
      reason: r.reason as string,
      actor: r.actor as string,
      at: r.at as string,
    }));
  }

  findingEvidence(findingId: string): Array<{ runId: string; trigger: Trigger; at: string }> {
    return this.all("SELECT * FROM finding_evidence WHERE finding_id = ? ORDER BY seq", findingId).map((r) => ({
      runId: r.run_id as string,
      trigger: JSON.parse(r.trigger as string) as Trigger,
      at: r.at as string,
    }));
  }

  startRun(i: { changeId: string; role: RoleId; commit: string }): string {
    const id = randomUUID();
    this.run(
      "INSERT INTO runs (id, change_id, role, commit_sha, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
      id,
      i.changeId,
      i.role,
      i.commit,
      now(),
    );
    return id;
  }

  /** Only sets status. Costs come from addRunCost alone. */
  finishRun(runId: string, status: RunStatus): void {
    if (this.run("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?", status, now(), runId) === 0) {
      throw new Error(`Run not found: ${runId}`);
    }
  }

  /** A run still marked running when the server starts was cut off by a restart; it can never finish. */
  closeInterruptedRuns(): number {
    return this.run("UPDATE runs SET status = 'failed', finished_at = ? WHERE status = 'running'", now());
  }

  /**
   * The coding agent's latest fix report for a finding, while it still waits on a re-check: nothing has been
   * raised again or decided on the finding since. Ties count as waiting (same millisecond in fast tests).
   */
  pendingFixReport(findingId: string): { summary: string; at: string } | null {
    // ponytail: scans every fix report; index on the finding id if reports ever run into thousands.
    const report = this.all("SELECT body, created_at FROM artifacts WHERE kind = 'fix_report' ORDER BY rowid DESC")
      .map((r) => ({ ...(JSON.parse(r.body as string) as { findingId?: string; summary?: string }), at: r.created_at as string }))
      .find((r) => r.findingId === findingId);
    if (!report) return null;
    const lastStatus = this.findingHistory(findingId).at(-1)?.at ?? "";
    const lastEvidence = this.findingEvidence(findingId).at(-1)?.at ?? "";
    return report.at >= lastStatus && report.at >= lastEvidence ? { summary: report.summary ?? "", at: report.at } : null;
  }

  /** Writes at once, so a running run counts toward spentUsd. */
  addRunCost(runId: string, costUsd: number, inputTokens: number, outputTokens: number): void {
    const changed = this.run(
      `UPDATE runs SET cost_usd = cost_usd + ?, input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ? WHERE id = ?`,
      costUsd,
      inputTokens,
      outputTokens,
      runId,
    );
    if (changed === 0) throw new Error(`Run not found: ${runId}`);
  }

  /** Total cost of all runs, running or finished. */
  spentUsd(): number {
    return Number(this.one("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM runs")?.total ?? 0);
  }

  /**
   * Commit of the newest finished run in the project, of one role when given. A stopped or failed run
   * did not cover the diff.
   */
  lastRunCommit(projectId: string, role?: RoleId): string | null {
    return this.runCommit(projectId, role, "DESC");
  }

  /** Commit of the oldest finished run in the project, of one role when given. */
  firstRunCommit(projectId: string, role?: RoleId): string | null {
    return this.runCommit(projectId, role, "ASC");
  }

  private runCommit(projectId: string, role: RoleId | undefined, order: "ASC" | "DESC"): string | null {
    const r = this.one(
      `SELECT r.commit_sha FROM runs r JOIN changes c ON c.id = r.change_id
       WHERE c.project_id = ? AND r.status = 'done' AND (? IS NULL OR r.role = ?) ORDER BY r.rowid ${order} LIMIT 1`,
      projectId,
      role ?? null,
      role ?? null,
    );
    return r ? (r.commit_sha as string) : null;
  }

  /** The commit a completed recheck covered up to. Only recheck writes it. */
  setCheckedCommit(projectId: string, commit: string): void {
    this.run(
      `INSERT INTO checked_commits (project_id, commit_sha) VALUES (?, ?)
       ON CONFLICT (project_id) DO UPDATE SET commit_sha = excluded.commit_sha`,
      projectId,
      commit,
    );
  }

  checkedCommit(projectId: string): string | null {
    const r = this.one("SELECT commit_sha FROM checked_commits WHERE project_id = ?", projectId);
    return r ? (r.commit_sha as string) : null;
  }

  recordGate(changeId: string, role: RoleId, state: GateState, reason: string): void {
    this.run(
      "INSERT INTO gate_events (change_id, role, state, reason, at) VALUES (?, ?, ?, ?, ?)",
      changeId,
      role,
      state,
      reason,
      now(),
    );
  }

  /** Latest state per role. */
  gates(changeId: string): GateMap {
    const out: GateMap = {};
    for (const r of this.all("SELECT * FROM gate_events WHERE change_id = ? ORDER BY seq", changeId)) {
      out[r.role as RoleId] = { state: r.state as GateState, reason: r.reason as string, at: r.at as string };
    }
    return out;
  }

  recordCheck(c: Check): void {
    this.run(
      "INSERT INTO checks (criterion_id, run_id, state, evidence, note, at) VALUES (?, ?, ?, ?, ?, ?)",
      c.criterionId,
      c.runId,
      c.state,
      JSON.stringify(c.evidence),
      c.note,
      now(),
    );
  }

  latestCheck(criterionId: string): Check | null {
    const r = this.one("SELECT * FROM checks WHERE criterion_id = ? ORDER BY seq DESC LIMIT 1", criterionId);
    if (!r) return null;
    return {
      criterionId: r.criterion_id as string,
      runId: r.run_id as string,
      state: r.state as EvidenceState,
      evidence: JSON.parse(r.evidence as string) as Trigger[],
      note: r.note as string,
    };
  }

  /** When the criterion's latest check was made, and at which commit. */
  latestCheckInfo(criterionId: string): { at: string; commit: string } | null {
    const r = this.one(
      "SELECT c.at, r.commit_sha FROM checks c JOIN runs r ON r.id = c.run_id WHERE c.criterion_id = ? ORDER BY c.seq DESC LIMIT 1",
      criterionId,
    );
    return r ? { at: r.at as string, commit: r.commit_sha as string } : null;
  }

  /** Full commit ids of the project's runs that start with `sha` (a short or full id). */
  runCommits(projectId: string, sha: string): string[] {
    return this.all(
      `SELECT DISTINCT r.commit_sha FROM runs r JOIN changes c ON c.id = r.change_id
       WHERE c.project_id = ? AND substr(r.commit_sha, 1, length(?)) = ?`,
      projectId,
      sha,
      sha,
    ).map((r) => r.commit_sha as string);
  }

  /** Every check made by a run at one commit, oldest first. */
  checksAt(projectId: string, commit: string): Check[] {
    return this.all(
      `SELECT k.* FROM checks k JOIN runs r ON r.id = k.run_id JOIN changes c ON c.id = r.change_id
       WHERE c.project_id = ? AND r.commit_sha = ? ORDER BY k.seq`,
      projectId,
      commit,
    ).map((r) => ({
      criterionId: r.criterion_id as string,
      runId: r.run_id as string,
      state: r.state as EvidenceState,
      evidence: JSON.parse(r.evidence as string) as Trigger[],
      note: r.note as string,
    }));
  }

  linksTo(to: LinkEnd): Array<{ from: LinkEnd; rel: LinkRel }> {
    return this.all("SELECT * FROM links WHERE to_type = ? AND to_id = ? ORDER BY rowid", to.type, to.id).map((r) => ({
      from: { type: r.from_type as string, id: r.from_id as string },
      rel: r.rel as LinkRel,
    }));
  }

  /** A new version only when the body's hash differs from the latest one. */
  saveDocumentVersion(i: { projectId: string; name: string; source: Document["source"]; body: string; commit: string | null }): {
    document: Document;
    version: DocumentVersion;
    changed: boolean;
  } {
    let row = this.one("SELECT * FROM documents WHERE project_id = ? AND name = ?", i.projectId, i.name);
    if (!row) {
      this.run(
        "INSERT INTO documents (id, project_id, name, source, created_at) VALUES (?, ?, ?, ?, ?)",
        randomUUID(),
        i.projectId,
        i.name,
        i.source,
        now(),
      );
      row = this.one("SELECT * FROM documents WHERE project_id = ? AND name = ?", i.projectId, i.name)!;
    }
    const document = toDocument(row);
    const contentHash = createHash("sha256").update(i.body).digest("hex");
    const latest = this.documentVersions(document.id).at(-1);
    if (latest?.contentHash === contentHash) return { document, version: latest, changed: false };
    const version: DocumentVersion = { id: randomUUID(), documentId: document.id, contentHash, commit: i.commit, body: i.body, createdAt: now() };
    this.run(
      "INSERT INTO document_versions (id, document_id, content_hash, commit_sha, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      version.id,
      version.documentId,
      version.contentHash,
      version.commit,
      version.body,
      version.createdAt,
    );
    return { document, version, changed: true };
  }

  getDocument(id: string): Document {
    const r = this.one("SELECT * FROM documents WHERE id = ?", id);
    if (!r) throw new Error(`Document not found: ${id}`);
    return toDocument(r);
  }

  listDocuments(projectId: string): Array<Document & { latest: DocumentVersion; versions: number }> {
    return this.all("SELECT * FROM documents WHERE project_id = ? ORDER BY rowid", projectId).flatMap((r) => {
      const versions = this.documentVersions(r.id as string);
      const latest = versions.at(-1);
      return latest ? [{ ...toDocument(r), latest, versions: versions.length }] : [];
    });
  }

  documentVersions(documentId: string): DocumentVersion[] {
    return this.all("SELECT * FROM document_versions WHERE document_id = ? ORDER BY rowid", documentId).map((r) => ({
      id: r.id as string,
      documentId: r.document_id as string,
      contentHash: r.content_hash as string,
      commit: (r.commit_sha as string | null) ?? null,
      body: r.body as string,
      createdAt: r.created_at as string,
    }));
  }

  /**
   * The document's requirements as read from one version, matched by key. A key not seen before (or removed and
   * now back) is added, a different text is changed, an active key missing from `next` is removed. Quote and line
   * follow the version without an event.
   */
  applyRequirements(
    documentId: string,
    versionId: string,
    next: Array<{ key: string; text: string; quote: string; line: number }>,
  ): { added: Requirement[]; changed: Requirement[]; removed: Requirement[] } {
    const doc = this.getDocument(documentId);
    const current = new Map(
      this.all("SELECT * FROM requirements WHERE document_id = ?", documentId).map((r) => [r.key as string, toRequirement(r)]),
    );
    const out = { added: [] as Requirement[], changed: [] as Requirement[], removed: [] as Requirement[] };
    const at = now();
    const event = (id: string, kind: RequirementEvent["kind"], text: string) =>
      this.run(
        "INSERT INTO requirement_events (requirement_id, kind, text, version_id, at) VALUES (?, ?, ?, ?, ?)",
        id,
        kind,
        text,
        versionId,
        at,
      );
    const seen = new Set<string>();
    this.db.exec("BEGIN");
    try {
      for (const n of next) {
        if (seen.has(n.key)) continue;
        seen.add(n.key);
        const cur = current.get(n.key);
        if (!cur) {
          const r: Requirement = { id: randomUUID(), projectId: doc.projectId, documentId, ...n, status: "active", createdAt: at, updatedAt: at };
          this.run(
            `INSERT INTO requirements (id, project_id, document_id, key, text, quote, line, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            r.id,
            r.projectId,
            documentId,
            r.key,
            r.text,
            r.quote,
            r.line,
            at,
            at,
          );
          event(r.id, "added", r.text);
          out.added.push(r);
          continue;
        }
        const back = cur.status === "removed";
        const changed = !back && cur.text !== n.text;
        this.run(
          "UPDATE requirements SET text = ?, quote = ?, line = ?, status = 'active', updated_at = ? WHERE id = ?",
          n.text,
          n.quote,
          n.line,
          back || changed ? at : cur.updatedAt,
          cur.id,
        );
        const r: Requirement = { ...cur, ...n, status: "active", updatedAt: back || changed ? at : cur.updatedAt };
        if (back) {
          event(r.id, "added", r.text);
          out.added.push(r);
        } else if (changed) {
          event(r.id, "changed", r.text);
          out.changed.push(r);
        }
      }
      for (const cur of current.values()) {
        if (seen.has(cur.key) || cur.status === "removed") continue;
        this.run("UPDATE requirements SET status = 'removed', updated_at = ? WHERE id = ?", at, cur.id);
        event(cur.id, "removed", cur.text);
        out.removed.push({ ...cur, status: "removed", updatedAt: at });
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }

  getRequirement(id: string): Requirement {
    const r = this.one("SELECT * FROM requirements WHERE id = ?", id);
    if (!r) throw new Error(`Requirement not found: ${id}`);
    return toRequirement(r);
  }

  listRequirements(projectId: string, opts: { status?: Requirement["status"] } = {}): Requirement[] {
    return this.all(
      "SELECT * FROM requirements WHERE project_id = ? AND (? IS NULL OR status = ?) ORDER BY rowid",
      projectId,
      opts.status ?? null,
      opts.status ?? null,
    ).map(toRequirement);
  }

  requirementEvents(requirementId: string): RequirementEvent[] {
    return this.all("SELECT * FROM requirement_events WHERE requirement_id = ? ORDER BY seq", requirementId).map((r) => ({
      requirementId: r.requirement_id as string,
      kind: r.kind as RequirementEvent["kind"],
      text: r.text as string,
      versionId: r.version_id as string,
      at: r.at as string,
    }));
  }

  linkRequirement(requirementId: string, toType: RequirementLink["toType"], toId: string): void {
    this.run(
      "INSERT INTO requirement_links (requirement_id, to_type, to_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      requirementId,
      toType,
      toId,
      now(),
    );
  }

  requirementLinks(requirementId: string): RequirementLink[] {
    return this.all("SELECT * FROM requirement_links WHERE requirement_id = ? ORDER BY rowid", requirementId).map(toLink);
  }

  /** Requirements linked to a criterion or a Linear issue. */
  requirementsLinkedTo(toType: RequirementLink["toType"], toId: string): Requirement[] {
    return this.all(
      "SELECT r.* FROM requirements r JOIN requirement_links l ON l.requirement_id = r.id WHERE l.to_type = ? AND l.to_id = ? ORDER BY r.rowid",
      toType,
      toId,
    ).map(toRequirement);
  }

  docSettings(projectId: string): DocSettings {
    const r = this.one("SELECT * FROM project_settings WHERE project_id = ?", projectId);
    return r
      ? { include: JSON.parse(r.doc_include as string) as string[], exclude: JSON.parse(r.doc_exclude as string) as string[] }
      : { include: [], exclude: [] };
  }

  setDocSettings(projectId: string, s: DocSettings): void {
    this.run(
      `INSERT INTO project_settings (project_id, doc_include, doc_exclude) VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET doc_include = excluded.doc_include, doc_exclude = excluded.doc_exclude`,
      projectId,
      JSON.stringify(s.include),
      JSON.stringify(s.exclude),
    );
  }

  /** The comment Kryterea keeps on a ticket, pull request or commit, so it is edited in place, never repeated. */
  externalPost(target: string, targetId: string): { commentId: string; bodyHash: string } | null {
    const r = this.one("SELECT * FROM external_posts WHERE target = ? AND target_id = ?", target, targetId);
    return r ? { commentId: r.comment_id as string, bodyHash: r.body_hash as string } : null;
  }

  saveExternalPost(target: string, targetId: string, commentId: string, bodyHash: string): void {
    this.run(
      `INSERT INTO external_posts (target, target_id, comment_id, body_hash) VALUES (?, ?, ?, ?)
       ON CONFLICT (target, target_id) DO UPDATE SET comment_id = excluded.comment_id, body_hash = excluded.body_hash`,
      target,
      targetId,
      commentId,
      bodyHash,
    );
  }

  linksFrom(from: LinkEnd): Array<{ rel: LinkRel; to: LinkEnd }> {
    return this.all("SELECT * FROM links WHERE from_type = ? AND from_id = ? ORDER BY rowid", from.type, from.id).map((r) => ({
      rel: r.rel as LinkRel,
      to: { type: r.to_type as string, id: r.to_id as string },
    }));
  }

  /** Criteria are the change's own plus any it affects. Decisions are status changes made by people. */
  acceptanceRecord(changeId: string): AcceptanceRecord {
    const change = this.getChange(changeId);
    const criteria = this.all(
      `SELECT * FROM criteria WHERE change_id = ? OR id IN (
         SELECT to_id FROM links WHERE from_type = 'change' AND from_id = ? AND rel = 'affects' AND to_type = 'criterion')
       ORDER BY rowid`,
      changeId,
      changeId,
    ).map((r) => {
      const c = toCriterion(r);
      return { ...c, latest: this.latestCheck(c.id)?.state ?? null };
    });
    const findings = this.listFindings({ changeId });
    const decisions = findings.flatMap((f) =>
      this.findingHistory(f.id)
        .filter((h) => h.actor !== SYSTEM_ACTOR)
        .map((h) => ({ findingId: f.id, ...h })),
    );
    decisions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const runs = this.all("SELECT * FROM runs WHERE change_id = ? ORDER BY rowid", changeId).map((r) => ({
      id: r.id as string,
      role: r.role as RoleId,
      commit: r.commit_sha as string,
      status: r.status as RunStatus,
      costUsd: r.cost_usd as number,
    }));
    const latestSummary = this.listArtifacts(changeId).filter((a) => a.kind === "acceptance_summary").at(-1);
    const body = latestSummary?.body as { summary?: unknown } | undefined;
    const summary = typeof body?.summary === "string" ? body.summary : null;
    return { change, criteria, findings, gates: this.gates(changeId), decisions, runs, summary };
  }
}

/** Ties the model adapter's spend guard to a run. spentUsd covers every run, so the budget is global. */
export function ledgerFor(record: CopilotRecord, runId: string): SpendLedger {
  return {
    spentUsd: () => record.spentUsd(),
    add: (costUsd, inputTokens, outputTokens) => record.addRunCost(runId, costUsd, inputTokens, outputTokens),
  };
}
