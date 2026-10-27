import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Artifact, Change, ChangeKind, Criterion, Project, StageId } from "../types.js";
import { SCHEMA } from "./schema.js";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

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
}
