// Opens the recorded demo run with no keys: a copy of demo/lagospay.db, replayed model, no polling, and no GitHub,
// Linear or Meta key (empty values here win over .env), so nothing is sent anywhere.
// Usage: pnpm demo (builds first), then open the printed address.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const record = join(root, "demo", "lagospay.db");
if (!existsSync(record)) {
  console.error("No demo record yet. It is added from the live run on the demo app (pnpm demo:export).");
  process.exit(1);
}
const dataDir = mkdtempSync(join(tmpdir(), "kryterea-demo-"));
copyFileSync(record, join(dataDir, "copilot.db"));
const db = new DatabaseSync(join(dataDir, "copilot.db"), { readOnly: true });
const project = db.prepare("SELECT id, name FROM projects ORDER BY rowid LIMIT 1").get();
db.close();

const port = process.env.PORT || "8787";
const env = {
  ...process.env,
  PORT: port,
  COPILOT_DATA_DIR: dataDir,
  COPILOT_FAKE_MODEL: "1",
  COPILOT_POLL_MS: "86400000",
  META_API_KEY: "",
  GITHUB_TOKEN: "",
  LINEAR_API_KEY: "",
};
console.log(`Demo record: ${project.name}`);
console.log(`Before and after: http://localhost:${port}/#/projects/${project.id}/compare`);
const server = spawn(process.execPath, [join(root, "packages", "server", "dist", "src", "main.js")], { env, stdio: "inherit" });
server.on("exit", (code) => process.exit(code ?? 0));
