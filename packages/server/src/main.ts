import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { CopilotRecord, createFakeModel, createModel, loadPacks, type ModelFactory } from "@lifecycle/core";
import { Jobs, createApp, isLoopback } from "./app.js";
import { startPoller } from "./poller.js";

/** The repo root is the nearest folder up from this file with pnpm-workspace.yaml (works from src and dist). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("Could not find the repo root (pnpm-workspace.yaml)");
    dir = up;
  }
  return dir;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} must be a non-negative number.`);
    process.exit(1);
  }
  return n;
}

const root = repoRoot();
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const env = process.env;

const fake = env.COPILOT_FAKE_MODEL === "1";
const modelName = env.META_MODEL || "muse-spark-1.3";
const budgetUsd = num("COPILOT_BUDGET_USD", 70);
let modelFor: ModelFactory;
if (fake) {
  const model = createFakeModel(join(root, "packages", "core", "fixtures"));
  modelFor = () => model;
} else {
  if (!env.META_API_KEY) {
    console.error("META_API_KEY is not set. Add it to .env, or set COPILOT_FAKE_MODEL=1 to run without model calls.");
    process.exit(1);
  }
  const apiKey = env.META_API_KEY;
  const options = {
    baseUrl: env.META_API_BASE_URL || "https://api.meta.ai/v1",
    apiKey,
    model: modelName,
    priceInPerM: num("PRICE_IN_PER_M", 1.25),
    priceOutPerM: num("PRICE_OUT_PER_M", 4.25),
    budgetUsd,
  };
  modelFor = (ledger) => createModel({ ...options, ledger });
}

const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });
const deps = {
  record: CopilotRecord.open(join(dataDir, "copilot.db")),
  modelFor,
  packs: await loadPacks(join(root, "packs")),
  cacheDir: join(dataDir, "repos"),
  allowLocalRepos: env.COPILOT_ALLOW_LOCAL_REPOS === "1",
  ...(env.GITHUB_TOKEN ? { githubToken: env.GITHUB_TOKEN } : {}),
};

const port = num("PORT", 8787);
const hostname = env.HOST || "127.0.0.1";
const apiToken = env.COPILOT_API_TOKEN || undefined;
if (!isLoopback(hostname) && !apiToken) {
  console.error("HOST is not a loopback address, so COPILOT_API_TOKEN must be set. The API has no other protection.");
  process.exit(1);
}

const jobs = new Jobs();
const app = createApp(deps, { budgetUsd, jobs, port, host: hostname, apiToken, model: modelName, fake });
const webDir = join(root, "packages", "web", "dist", "app");
if (existsSync(webDir)) app.get("*", serveStatic({ root: webDir }));

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Copilot server on http://${hostname}:${info.port}${fake ? " (fake model)" : ""}`);
});
startPoller(deps, Math.max(1000, num("COPILOT_POLL_MS", 60_000)), undefined, undefined, jobs);
