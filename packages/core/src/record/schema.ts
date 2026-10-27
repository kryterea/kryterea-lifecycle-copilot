/** SQL for the record. Run on every open, so every statement is idempotent. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  app_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('understand','feature','fix')),
  stage TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_project ON changes(project_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id),
  role TEXT NOT NULL,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_change ON artifacts(change_id);

CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  change_id TEXT NOT NULL REFERENCES changes(id),
  text TEXT NOT NULL,
  is_failure_path INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS criteria_project ON criteria(project_id);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  change_id TEXT NOT NULL REFERENCES changes(id),
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('legal','failure_path','operations','conformance')),
  title TEXT NOT NULL,
  plain TEXT NOT NULL,
  cost_if_ignored TEXT NOT NULL,
  fix_prompt TEXT NOT NULL,
  trigger TEXT NOT NULL,
  citation_id TEXT,
  criterion_id TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_project ON findings(project_id);

CREATE TRIGGER IF NOT EXISTS findings_immutable_update BEFORE UPDATE ON findings
BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS findings_immutable_delete BEFORE DELETE ON findings
BEGIN SELECT RAISE(ABORT, 'findings are immutable'); END;

CREATE TABLE IF NOT EXISTS finding_evidence (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  run_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finding_evidence_finding ON finding_evidence(finding_id);

CREATE TABLE IF NOT EXISTS finding_status_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  status TEXT NOT NULL CHECK (status IN ('open','fixed','accepted_risk','deferred')),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finding_status_finding ON finding_status_events(finding_id);

CREATE TABLE IF NOT EXISTS links (
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  rel TEXT NOT NULL CHECK (rel IN ('affects','satisfies','raised_on')),
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (from_type, from_id, rel, to_type, to_id)
);
CREATE INDEX IF NOT EXISTS links_to ON links(to_type, to_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES changes(id),
  role TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','done','stopped_budget','failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_change ON runs(change_id);

CREATE TABLE IF NOT EXISTS gate_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL REFERENCES changes(id),
  role TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held','cleared')),
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gate_events_change ON gate_events(change_id);

CREATE TABLE IF NOT EXISTS checks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  criterion_id TEXT NOT NULL REFERENCES criteria(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  state TEXT NOT NULL CHECK (state IN ('evidence_found','gap','no_evidence')),
  evidence TEXT NOT NULL,
  note TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checks_criterion ON checks(criterion_id);
`;
