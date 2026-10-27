import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Artifact,
  Change,
  ChangeKind,
  AcceptanceRecord,
  Check,
  Criterion,
  EvidenceState,
  Finding,
  FindingInput,
  FindingStatus,
  GateMap,
  GateState,
  LinkEnd,
  LinkRel,
  Project,
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

  linksTo(to: LinkEnd): Array<{ from: LinkEnd; rel: LinkRel }> {
    return this.all("SELECT * FROM links WHERE to_type = ? AND to_id = ? ORDER BY rowid", to.type, to.id).map((r) => ({
      from: { type: r.from_type as string, id: r.from_id as string },
      rel: r.rel as LinkRel,
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
