// Saves the live run's record as the demo record and writes the before and after report from it.
// Usage: pnpm demo:export <data dir> [before sha] [after sha]   (defaults: first and latest checked commits)
// The data dir must hold only the demo project. The export is refused if it carries a local path or anything key-like.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [dir, fromArg, toArg] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: pnpm demo:export <data dir> [before sha] [after sha]");
  process.exit(1);
}
const source = join(resolve(dir), "copilot.db");
if (!existsSync(source)) {
  console.error(`No record at ${source}`);
  process.exit(1);
}
const out = join(root, "demo", "lagospay.db");
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
const src = new DatabaseSync(source, { readOnly: true });
const projects = src.prepare("SELECT id, name FROM projects").all();
if (projects.length !== 1) {
  console.error(`The record holds ${projects.length} projects. Use a data dir with only the demo project.`);
  process.exit(1);
}
src.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
src.close();

// The demo record is public: refuse local paths and anything that looks like a key.
const RISKY = /[A-Za-z]:[\\/]Users|\/Users\/|\/home\/|sk_(live|test)_|pk_(live|test)_|ghp_|github_pat_|lin_api_|META_API_KEY|-----BEGIN/;
const db = new DatabaseSync(out, { readOnly: true });
const hits = [];
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
    for (const [col, v] of Object.entries(row)) if (typeof v === "string" && RISKY.test(v)) hits.push(`${name}.${col}`);
  }
}
db.close();
if (hits.length) {
  rmSync(out, { force: true });
  console.error(`Not exported: possible local path or key in ${[...new Set(hits)].join(", ")}`);
  process.exit(1);
}

const { CopilotRecord, compareCommits } = await import(pathToFileURL(join(root, "packages", "core", "dist", "src", "index.js")).href);
const { compareMarkdown } = await import(pathToFileURL(join(root, "packages", "server", "dist", "src", "report.js")).href);
const record = CopilotRecord.open(out);
const [project] = projects;
const commits = record.commitsChecked(project.id);
const from = fromArg ?? commits[0]?.sha;
const to = toArg ?? commits.at(-1)?.sha;
const cmp = from && to && from !== to ? compareCommits(record, project.id, from, to) : null;
record.close();
if (!cmp) {
  console.error("Need two different commits Kryterea checked to write the report.");
  process.exit(1);
}
const report = join(root, "docs", "hackathon", "before-after.md");
writeFileSync(report, compareMarkdown(project.name, cmp));
console.log(`Saved ${out}`);
console.log(`Wrote ${report}: open items ${cmp.from.open} to ${cmp.to.open}, evidence found ${cmp.from.evidenceFound} to ${cmp.to.evidenceFound}`);
