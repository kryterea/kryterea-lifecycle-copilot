# Kryterea Lifecycle Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A copilot that carries the duties of five non-coding professionals (BA, architect/SRE, QA, security and compliance, product owner) through a change-based delivery workflow, checking a GitHub repo built by any coding agent, with an MCP server for agents and a web work panel for people.

**Architecture:** A TypeScript pnpm monorepo. `core` holds the record (SQLite via Node's built-in `node:sqlite`), the Meta model adapter with a spend ledger, the repo reader, the professional roles and the workflow engine. `server` exposes an HTTP API and a push poller and serves the built web panel. `mcp` is a thin stdio MCP server that calls the HTTP API. `web` is a Vite + React work panel.

**Tech Stack:** Node 22.13 or later (22.23 installed; `node:sqlite` needs no flag from 22.13), TypeScript 5, pnpm 11 workspaces (installed), Vitest, `node:sqlite`, Hono, `@modelcontextprotocol/sdk`, Vite + React 18, git CLI, Playwright (stretch only).

**Spec:** `docs/superpowers/specs/2026-10-26-lifecycle-copilot-design.md`. Read it before any task. Read `HANDOFF.md` and `CLAUDE.md` at the repo root first.

## Global Constraints

- Every file in this repo is written on or after 2026-10-26. Never copy code, prompts, playbooks, rubrics or templates from Kryterea's private product or BA OS (private). BA OS's own text (skills, playbooks, rubrics, templates, its reports) never enters the repo. Work it helps produce during the event (the NDPA legal pack, the workflow diagram, README prose) may enter and is disclosed in `BUILT_DURING_HACKATHON.md`.
- `HANDOFF.md` is internal and never committed (it is in `.gitignore`). Public files never mention internal security history or private repo names.
- No secrets in git. Env vars: `META_API_BASE_URL`, `META_API_KEY`, `META_MODEL`, `GITHUB_TOKEN` (optional, private repos only), `COPILOT_FAKE_MODEL` (`1` = canned outputs, no API calls), `COPILOT_URL` (MCP to server, default `http://localhost:8787`), `PORT` (default 8787).
- Spec items deliberately covered elsewhere or cut: the per-run token cap is the per-call `maxOutputTokens` plus input truncation in each role; document upload is cut (paste only); prompt caching is used only if Task 0 shows the API supports it (put the pack text first in the system prompt so it repeats verbatim).
- Prices: `PRICE_IN_PER_M=1.25`, `PRICE_OUT_PER_M=4.25` (USD per million tokens; confirm in Task 0). Copilot budget `COPILOT_BUDGET_USD=70`. The coding agent's $50 and the $30 reserve are watched in the Meta console, not in code.
- Product copy never uses score, rubric, grade, rating, pass or fail. Finding evidence states are exactly `evidence_found`, `gap`, `no_evidence`, shown as "Evidence found", "Gap", "No evidence". Gate states are exactly `held`, `cleared`, shown as "Held", "Cleared".
- No em dashes anywhere (code comments, copy, docs). Use a period, comma, colon or parentheses.
- Legal findings may cite only entries in `packs/legal/ndpa-2023.json`. Legal copy says "Check this", never "You are in breach".
- The copilot never writes to the target repo.
- Every `ModelRequest.name` is `<role>.<function>` (for example `qa.verifyCriteria`), and each role task adds a fixture `packages/core/fixtures/<name>.json` for it.
- Real-model checkpoint (from the day-1 pre-mortem): Tasks 8, 9, 10 and 11 each end with one real Muse Spark call of the new role on the demo repo (`COPILOT_FAKE_MODEL` unset), output read by the controller and saved as that role's fixture if it is sound. Budget about $1 per checkpoint. A prompt that fails on the real model is fixed in the same task, not on 11-02.
- Slow model, live panel: Muse Spark takes 2 to 8 seconds even for trivial calls. Role functions that make several independent calls (QA per criterion) run them 3 at a time. Long HTTP actions return a run id at once and the panel polls (Task 14).
- Windows dev machine: avoid native npm modules (that is why `node:sqlite`, not better-sqlite3). Run CI on Linux (GitHub Actions) as the source of truth for typecheck and tests.

## Review Focus

1. The model cites a file or line that does not exist: evidence must be verified on disk, and an unverifiable citation turns the check into `no_evidence`, never `evidence_found`. Test in Task 11.
2. The compliance role invents a legal duty not in the pack: any finding whose `citationId` is not in the pack is dropped and logged. Test in Task 9.
3. The budget runs out mid-run: the call is refused before it is sent, the run is stored as `stopped_budget`, and the panel shows "Paused: copilot budget used". Tests in Tasks 2 and 13.
4. The same issue is raised again on a later run: it is deduplicated by fingerprint into the existing finding (with a new evidence row), so history shows one finding changing status, not copies. Test in Task 4.
5. A file named in earlier evidence is deleted or renamed in a later commit: the affected criterion is re-checked, never silently left as `evidence_found`. Test in Task 13.

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts (root, `test.projects`; Vitest 3.2 or later)
.env.example, .gitignore, LICENSE, README.md, CLAUDE.md, BUILT_DURING_HACKATHON.md
HANDOFF.md                                    local only, gitignored
packages/core/fixtures/<request name>.json    canned model outputs for fake mode and tests
.github/workflows/ci.yml
docs/hackathon/day1-verification.md          Task 0 results
docs/hackathon/legal-sources.md               Task 7 source log
docs/hackathon/video-script.md                Task 18
packs/ba.md, architect.md, qa.md, compliance.md, po.md   fresh professional packs
packs/legal/ndpa-2023.json                    verified legal pack
packages/core/src/types.ts                    shared types
packages/core/src/model.ts                    Meta adapter + ledger use
packages/core/src/record/schema.sql           tables
packages/core/src/record/record.ts            CopilotRecord class
packages/core/src/repo/repo.ts                git sync, file listing, evidence checks
packages/core/src/repo/narrow.ts              cheap file narrowing
packages/core/src/packs.ts                    pack loader
packages/core/src/roles/{ba,architect,qa,compliance,po}.ts
packages/core/src/workflow.ts                 stages, duty roster, advance, recheck
packages/core/test/*.test.ts
packages/server/src/{app.ts,poller.ts,main.ts}
packages/mcp/src/main.ts
packages/web/src/...                          Vite React panel
```

The demo app lives in its own public repo (Task 18), never in this one.

---

### Task 0: Day-1 verification gate (no product code)

Nothing else starts until this passes. Skills: superpowers:verification-before-completion.

- [x] **Step 1:** Founder puts the Meta API key in a local `.env` (never committed). Confirm base URL and model id on dev.meta.ai; record them in `docs/hackathon/day1-verification.md`.
- [x] **Step 2:** Call chat completions with curl using a trivial prompt. Expected: HTTP 200 with a `usage` object. Record input and output token counts and the price per million shown in the console.
- [x] **Step 3:** Call again with `response_format` set to a JSON schema `{ok: boolean}`. Expected: valid JSON matching the schema. If unsupported, record it; Task 2 then falls back to "JSON only" instructions plus validation.
- [x] **Step 4:** Send one image (a screenshot) in the message. Record whether image input works. If not, Task 17 is dropped.
- [x] **Step 5:** Coding agent. First check Muse Code (Meta's own coding agent, named at kickoff): can it run on Windows, does it bill to the hackathon credits, does it support MCP servers? If all three, ask it to create `hello.txt` and prefer it on camera, since "use of Meta AI tooling" is a judging criterion. Otherwise install Cline in VS Code, set provider "OpenAI Compatible" with the Meta base URL, key and model, and ask it to create `hello.txt`. If Cline fails, try OpenCode with the same endpoint. Record which works. If none works, stop and tell the founder (fallback in spec section 4).
- [x] **Step 6:** In a scratch folder outside the repo, `npm i @modelcontextprotocol/sdk` and write the SDK's stdio "echo" example server. Add it to the working agent's MCP settings and call it. Expected: echo result in the agent chat. Record.
- [x] **Step 7:** Run the BA OS `risk-challenger` agent on the spec and this plan (pre-mortem). Add any risk it finds that changes a task to `docs/hackathon/day1-verification.md` and tell the founder.
- [ ] **Step 8:** Ask the founder to open the Submit Project form and share its field list. Start `docs/hackathon/submission.md` with those fields so the build aims at what the form asks (kickoff advice: review the form early). Hard gate by 10-28: the founder settles Startup-track eligibility (the kickoff called it the track for incorporated startups), in the Discord questions forum if unsure. The track decides the video's pitch, so it is settled before Task 18 Step 5.
- [x] **Step 9:** Commit `docs/hackathon/day1-verification.md` (after Task 1 creates the repo, if not yet created).

### Task 1: Repository scaffold and first commit

Skills: superpowers:using-git-worktrees is not needed (fresh repo); use superpowers:verification-before-completion.

**Files:** Create: root config files listed in File Structure, `packages/*/package.json`, `packages/*/tsconfig.json`, `.github/workflows/ci.yml`, `LICENSE` (an OSI-approved open-source licence chosen by the founder; the kickoff requires the work to be open source, not only public).

- [x] **Step 1:** `git init` in `kryterea-lifecycle-copilot`. Write `.gitignore` first, covering `HANDOFF.md`, `docs/meta-intro-transcript.txt` (Meta's session content, not ours to publish), `node_modules`, `dist`, `.env`, `*.db`, `data/`, `.cache/`. Run `git status` and confirm neither `HANDOFF.md` nor the transcript is listed. Keep the existing `docs/`, `CLAUDE.md`, `BUILT_DURING_HACKATHON.md`.
- [x] **Step 2:** Root `package.json` with `"engines": {"node": ">=22.13"}`, `"packageManager": "pnpm@11.20.0"`, scripts `test` (`vitest run`), `typecheck` (`tsc -b`), `dev` (server + web).
- [x] **Step 3:** `.env.example` with every env var from Global Constraints, values blank except prices and budget.
- [x] **Step 4:** CI workflow on ubuntu-latest: install, `pnpm typecheck`, `pnpm test`.
- [x] **Step 5:** One placeholder test in `packages/core/test/smoke.test.ts` asserting `1 + 1 === 2`. Run `pnpm test`. Expected: 1 passed.
- [x] **Step 6:** Commit `chore: scaffold repo (hackathon build starts 2026-10-26)`.
- [x] **Step 7:** Ask the founder to approve creating the public GitHub repo (owner from HANDOFF.md). Only on a clear yes: `gh repo create <owner>/kryterea-lifecycle-copilot --public --source . --push`. Confirm CI is green.

### Task 2: Meta model adapter and spend guard

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/types.ts`, `packages/core/src/model.ts`, `packages/core/test/model.test.ts`.

**Interfaces:**
- Produces: `type JsonSchema = Record<string, unknown>`; `class BudgetExceededError extends Error`; `interface SpendLedger { spentUsd(): number; add(costUsd: number, inputTokens: number, outputTokens: number): void }`; `interface ModelRequest { name: string /* e.g. 'ba.understandApp', names the fixture */; system: string; user: string; schema: JsonSchema; maxOutputTokens: number; reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' /* default 'low' */; images?: string[] /* data URLs */ }`; `interface ModelResult<T> { data: T; usage: { input: number; output: number }; costUsd: number }`; `type Model = <T>(req: ModelRequest) => Promise<ModelResult<T>>`; `type ModelFactory = (ledger: SpendLedger) => Model`; `function createModel(opts: { baseUrl: string; apiKey: string; model: string; priceInPerM: number; priceOutPerM: number; budgetUsd: number; ledger: SpendLedger; fetchImpl?: typeof fetch }): Model`; `function createFakeModel(fixturesDir: string): Model` (returns `fixtures/<req.name>.json` with zero cost; throws naming the missing fixture). The ledger is added to immediately after every call, so spend inside a running run is counted. Each role task adds the fixtures for its own request names.

- [ ] **Step 1: Write failing tests** in `model.test.ts` with a fake `fetchImpl`:
  - `costs a call from usage`: usage `{prompt_tokens: 1_000_000, completion_tokens: 100_000}` gives `costUsd === 1.25 + 0.425` and the ledger total rises by that amount.
  - `refuses before sending when the worst case exceeds budget`: ledger at 69.99, budget 70, `maxOutputTokens: 10_000`; expect `BudgetExceededError` and the fake fetch called 0 times. Worst case = estimated input tokens (characters / 4) at input price plus `maxOutputTokens` at output price.
  - `rejects output that does not match the schema`: fake returns `{"wrong":1}` for schema requiring `ok`; expect an error whose message contains `schema`.
  - `retries once on HTTP 429 or 5xx`: first 503 then 200; expect success and 2 calls.
  - `fake model returns the named fixture and names a missing one in its error`.
  - `cost counts reasoning tokens`: usage with `completion_tokens: 1000` of which `completion_tokens_details.reasoning_tokens: 900` costs 1000 output tokens (Muse Spark bills reasoning as output; Task 0).
  - `empty content retries once with double the cap`: first response `content: null` with `completion_tokens` equal to the cap, second returns valid JSON; expect success, 2 calls, the second with `max_completion_tokens` doubled. Two empty replies throw an error containing `empty`.
  - `sends reasoning_effort`: request body has `reasoning_effort: "low"` by default and the request's value when set.
- [ ] **Step 2:** Run `pnpm vitest run packages/core/test/model.test.ts`. Expected: FAIL, `createModel` not defined.
- [ ] **Step 3:** Implement `createModel` in `model.ts`: POST `${baseUrl}/chat/completions` with `response_format: {type: "json_schema", json_schema: {name: "out", schema, strict: true}}`, `reasoning_effort`, and `max_completion_tokens: maxOutputTokens` (which includes reasoning tokens, so every role sets caps with reasoning headroom: at least 4,000), validate with a small hand-written required-keys and type check (no new dependency), images as `image_url` content parts. The budget pre-check uses the doubled cap when retrying.
- [ ] **Step 4:** Run the tests. Expected: 8 passed.
- [ ] **Step 5:** Commit `feat(core): Meta model adapter with spend guard`.

### Task 3: Record, part 1: projects, changes, artifacts, criteria

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/record/schema.sql`, `packages/core/src/record/record.ts`, `packages/core/test/record.test.ts`. Modify `types.ts`.

**Interfaces:**
- Produces types: `RoleId = 'ba'|'architect'|'qa'|'compliance'|'po'`; `StageId = 'intake'|'analysis'|'design_review'|'build'|'verification'|'release'|'acceptance'|'operate'`; `ChangeKind = 'understand'|'feature'|'fix'`; `Project {id, name, repoUrl, appUrl: string|null, createdAt}`; `Change {id, projectId, title, description, kind, stage: StageId, createdAt}`; `Artifact {id, changeId, role, stage, kind: string, body: unknown, createdAt}`; `Criterion {id, projectId, changeId, text, isFailurePath: boolean, createdAt}`.
- Produces: `class CopilotRecord { static open(path: string): CopilotRecord; createProject(i: {name, repoUrl, appUrl?}): Project; getProject(id): Project; createChange(i: {projectId, title, description, kind}): Change; getChange(id): Change; listChanges(projectId): Change[]; setStage(changeId, stage: StageId): void; addArtifact(i: Omit<Artifact,'id'|'createdAt'>): Artifact; listArtifacts(changeId): Artifact[]; addCriterion(i: Omit<Criterion,'id'|'createdAt'>): Criterion; listCriteria(projectId): Criterion[] }`. Ids are `crypto.randomUUID()`. Bodies stored as JSON text. WAL mode on open.

- [ ] **Step 1: Write failing tests:** `creates and reads back a project and change` (new change starts at stage `intake`); `setStage moves a change`; `criteria are listed per project across changes` (two changes, three criteria, `listCriteria` returns 3); `reopening the same file keeps data` (open, write, close, open, read).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `DatabaseSync` from `node:sqlite`; `schema.sql` run on open with `CREATE TABLE IF NOT EXISTS`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): record for projects, changes, artifacts, criteria`.

### Task 4: Record, part 2: immutable findings, status events, dedupe

Skills: superpowers:test-driven-development.

**Files:** Modify `schema.sql`, `record.ts`, `types.ts`. Test `packages/core/test/findings.test.ts`.

**Interfaces:**
- Produces types: `FindingKind = 'legal'|'failure_path'|'operations'|'conformance'`; `FindingStatus = 'open'|'fixed'|'accepted_risk'|'deferred'`; `Trigger = {type:'code', file: string, line: number, commit: string} | {type:'doc', quote: string} | {type:'screen', url: string, screenshotPath: string}`; `FindingInput {projectId, changeId, runId, role, stage, kind, title, plain, costIfIgnored, fixPrompt, trigger: Trigger, citationId?: string, criterionId?: string}`; `Finding = FindingInput & {id, fingerprint, createdAt}`.
- Produces: `CopilotRecord.addFinding(i: FindingInput): {finding: Finding; isNew: boolean}`; `CopilotRecord.setFindingStatus(findingId, status: FindingStatus, reason: string, actor: string): void`; `CopilotRecord.findingStatus(findingId): FindingStatus`; `CopilotRecord.listFindings(filter: {projectId?: string; changeId?: string; status?: FindingStatus}): Array<Finding & {status: FindingStatus}>`; `CopilotRecord.findingHistory(findingId): Array<{status, reason, actor, at}>`.
- Fingerprint: sha256 of `projectId|role|kind|normalised title` (lowercase, collapse whitespace). On a duplicate, add a row to `finding_evidence` with the new trigger and runId, and if the existing status is `fixed`, set it back to `open` with reason "Raised again".

- [ ] **Step 1: Write failing tests:** `new finding starts open`; `findings have no update path` (assert `CopilotRecord.prototype` has no method named `updateFinding`); `duplicate title in same project returns existing finding with isNew false`; `a fixed finding raised again reopens with reason "Raised again"`; `history lists every status change in order`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Findings table has no UPDATE statements anywhere in `record.ts`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): immutable findings with status history and dedupe`.

### Task 5: Record, part 3: runs, gates, links, acceptance read-out

Skills: superpowers:test-driven-development.

**Files:** Modify `schema.sql`, `record.ts`, `types.ts`. Test `packages/core/test/gates.test.ts`.

**Interfaces:**
- Produces types: `GateState = 'held'|'cleared'`; `EvidenceState = 'evidence_found'|'gap'|'no_evidence'`; `RunStatus = 'running'|'done'|'stopped_budget'|'failed'`; `Check {criterionId, runId, state: EvidenceState, evidence: Trigger[], note: string}`; `AcceptanceRecord {change: Change; criteria: Array<Criterion & {latest: EvidenceState|null}>; findings: Array<Finding & {status}>; gates: Partial<Record<RoleId, {state: GateState; reason: string; at: string}>>; decisions: Array<{findingId, status, reason, actor, at}>; runs: Array<{id, role, commit, status, costUsd}>}`.
- Produces: `CopilotRecord.startRun(i: {changeId, role, commit}): string`; `CopilotRecord.finishRun(runId, i: {status: RunStatus; inputTokens: number; outputTokens: number; costUsd: number}): void`; `CopilotRecord.addRunCost(runId: string, costUsd: number, inputTokens: number, outputTokens: number): void` (writes immediately, so a running run counts); `CopilotRecord.spentUsd(): number` (sum of all run costs, running or finished); `function ledgerFor(record: CopilotRecord, runId: string): SpendLedger` (exported from `record.ts`; `add` calls `addRunCost`); every model call happens inside a run, including the PO summary; `CopilotRecord.recordGate(changeId, role, state, reason): void`; `CopilotRecord.gates(changeId)`; `CopilotRecord.recordCheck(c: Check): void`; `CopilotRecord.latestCheck(criterionId): Check|null`; `CopilotRecord.link(from: {type: string; id: string}, rel: 'affects'|'satisfies'|'verifies'|'raised_on', to: {type: string; id: string}): void`; `CopilotRecord.linksTo(to): Array<{from, rel}>`; `CopilotRecord.acceptanceRecord(changeId): AcceptanceRecord`.

- [ ] **Step 1: Write failing tests:** `spentUsd counts a running run's costs immediately`; `latest gate state wins`; `latestCheck returns the newest check`; `acceptanceRecord lists criteria with latest state, open findings, gates and decisions`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): runs, gates, links and acceptance record`.

### Task 6: Repo reader and file narrowing

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/repo/repo.ts`, `packages/core/src/repo/narrow.ts`, tests `packages/core/test/repo.test.ts` (uses a temp git repo built in the test with `git init` and two commits).

**Interfaces:**
- Produces: `syncRepo(repoUrl: string, cacheDir: string, token?: string): Promise<{dir: string; commit: string}>` (shallow clone first time, `fetch` + `reset --hard origin/HEAD` after); `listSourceFiles(dir): Promise<string[]>` (relative paths; excludes `node_modules`, `.git`, `dist`, `build`, `.next`, lockfiles, images, fonts, files over 200 KB); `changedFiles(dir, from: string, to: string): Promise<{changed: string[]; deleted: string[]}>`; `readLines(dir, file, start, end): string|null`; `verifyCodeTrigger(dir, t: {file, line}): boolean`; `narrowFiles(query: string, dir: string, files: string[], limit = 12): Promise<string[]>`.
- `narrowFiles` is deterministic and makes no model call: score each file by count of query keywords (lowercased words of 4+ letters, minus a stopword list) in its path (weight 3) and content (weight 1); return the top `limit`.

- [ ] **Step 1: Write failing tests:** `lists source files and skips node_modules and lockfiles`; `changedFiles reports a deleted file under deleted`; `verifyCodeTrigger is false for a missing file and for a line past the end`; `narrowFiles ranks payment.ts above about.ts for "failed payment order status"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:child_process` `execFile('git', ...)` and `node:fs/promises`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): repo reader and file narrowing`.

### Task 7: Professional packs and the verified NDPA legal pack

Skills: business-analysis-os:regulatory-compliance (draft obligations from the official text), business-analysis-os agent `compliance-auditor` (verify each entry against the text), business-analysis-os:change-control and business-analysis-os:acceptance-testing (inform the BA and QA duties), superpowers:test-driven-development for the loader. BA OS informs the work; no BA OS text is copied into the repo.

**Files:** Create `packs/ba.md`, `packs/architect.md`, `packs/qa.md`, `packs/compliance.md`, `packs/po.md`, `packs/legal/ndpa-2023.json`, `docs/hackathon/legal-sources.md`, `packages/core/src/packs.ts`, test `packages/core/test/packs.test.ts`.

**Interfaces:**
- Produces: `interface LegalDuty { id: string; law: 'NDPA 2023'; section: string; title: string; duty: string; triggers: string[]; sourceUrl: string; verifiedOn: string }`; `interface Packs { role: Record<RoleId, string>; legal: LegalDuty[] }`; `loadPacks(dir: string): Promise<Packs>` which throws if any role file is missing or any legal entry lacks `section`, `sourceUrl` or `verifiedOn`.

- [ ] **Step 1:** Download the official NDPA 2023 text (Nigeria Data Protection Commission site). Log the URL and retrieval date in `legal-sources.md`.
- [ ] **Step 2:** With the regulatory-compliance skill, draft 8 to 12 duties that a small app with accounts, personal data and payments can trigger (for example: lawful basis and consent, purpose limitation, data minimisation, retention, data subject rights including erasure, security of processing, breach notification). Each entry quotes or closely paraphrases its section.
- [ ] **Step 3:** Run the compliance-auditor agent on the draft against the official text. Fix or drop every entry it disputes. Set `verifiedOn`. Founder reviews the final list before it is used in the video.
- [ ] **Step 4:** Write the five role packs fresh, about 300 to 600 words each: the role's duties at each stage it serves (spec section 6), what a finding must contain, the plain-language rule (write for someone looking at app behaviour), the banned words, and for compliance the rule "cite only pack entries by id". Card handling is cited as PCI DSS, labelled a standard, inside `compliance.md`.
- [ ] **Step 5: Write failing tests:** `loads all five role packs`; `rejects a legal entry without sourceUrl`; `every shipped legal entry has a section and verifiedOn` (runs against the real `packs/`).
- [ ] **Step 6:** Implement `loadPacks`. Run tests. Expected: PASS.
- [ ] **Step 7:** Commit `feat: professional packs and verified NDPA legal pack`.

### Task 8: Business analyst role

Skills: superpowers:test-driven-development. BA OS `elicitation` and `change-control` skills inform prompt design only.

**Files:** Create `packages/core/src/roles/ba.ts`, `packages/core/src/roles/context.ts`, test `packages/core/test/ba.test.ts` (fake model returning canned JSON).

**Interfaces:**
- Consumes: `Model` (Task 2), `CopilotRecord`, `Packs`, repo functions.
- Produces in `context.ts`: `interface RoleContext { record: CopilotRecord; model: Model; packs: Packs; project: Project; change: Change; repo: {dir: string; commit: string}; runId: string; existingFindings: Array<{id: string; title: string; kind: FindingKind}> /* this role's findings in the project, so the model reuses a title for the same issue (dedupe, Review Focus 4) */; answers: string[] /* from the latest 'answers' artifact, empty if none */ }`; `interface RoleResult { artifacts: Array<{kind: string; body: unknown}>; criteria: Array<{text: string; isFailurePath: boolean}>; findings: Array<Omit<FindingInput,'projectId'|'changeId'|'runId'|'role'|'stage'>>; questions: string[]; affectedCriterionIds: string[] }`. The workflow stores `questions` as an artifact of kind `questions`. Every role prompt lists `existingFindings` and says "reuse the exact title when it is the same issue".
- Produces in `ba.ts`: `understandApp(ctx): Promise<RoleResult>` (request name `ba.understandApp`; artifact kind `as_built` with flows, data collected, payments, roles; 2 to 3 `questions`; criteria describing the observed behaviour that should hold, including failure-path criteria, so QA has something to verify; failure-path findings with code triggers); `baGate(questions: string[], answers: string[]): {state: GateState; reason: string}` (cleared when there are no questions or answers exist); `analyseChange(ctx): Promise<RoleResult>` (acceptance criteria for the change, failure-path criteria with `isFailurePath: true`); `analyseImpact(ctx, existing: Criterion[]): Promise<RoleResult>` (fills `affectedCriterionIds` only with ids that exist in `existing`; new criteria for the change).
- Starting from an idea or an AI-written document (spec section 5, minimal path): the founder creates a change of kind `feature` and pastes the document as its `description`; `analyseChange` treats it as the source and uses `doc` triggers quoting it. Add test `analyseChange quotes the pasted document in doc triggers`.
- File reading budget: `understandApp` sends the file list plus at most 40 files chosen by `narrowFiles` with query "routes pages api auth user payment order booking schema model", truncated at 60k characters total.

- [ ] **Step 1: Write failing tests:** `understandApp returns questions, criteria and an as_built artifact`; `baGate held with unanswered questions, cleared once answers exist`; `analyseImpact drops affected ids that do not exist`; `failure path criteria are flagged isFailurePath`; `prompt sent to the model contains the ba pack text` (fake model captures the request).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The caller (workflow) writes the result to the record; roles return data only.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): business analyst role`.

### Task 9: Security and compliance role

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/roles/compliance.ts`, test `packages/core/test/compliance.test.ts`.

**Interfaces:**
- Produces: `reviewCompliance(ctx, asBuiltOrChange: unknown): Promise<RoleResult>`; every finding has `kind: 'legal'` and a `citationId` present in `ctx.packs.legal`; `complianceGate(openLegalFindings: number): {state: GateState; reason: string}` (held while > 0).

- [ ] **Step 1: Write failing tests:** `drops a finding whose citationId is not in the pack and logs it`; `keeps a finding citing a pack id`; `gate is held with one open legal finding and cleared with none`; `finding copy contains "Check this" and never "breach"`; `a code trigger to a missing file is converted to a doc trigger` (same `verifyCodeTrigger` rule as Tasks 10 and 11).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The model receives only the pack entries (id, section, title, duty, triggers), not the law text.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): compliance role with cited-only legal findings`.

### Task 10: Architect / SRE role

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/roles/architect.ts`, test `packages/core/test/architect.test.ts`.

**Interfaces:**
- Produces: `reviewOperations(ctx): Promise<RoleResult>` covering backups, rate limits, monitoring, behaviour at 10x users, support when something breaks; findings `kind: 'operations'`, code trigger where one exists, otherwise `doc` trigger quoting the as-built artifact. `architectGate(openOperationsFindings: number): {state, reason}`.

- [ ] **Step 1: Write failing tests:** `operations findings carry kind operations`; `a code trigger to a missing file is converted to a doc trigger` (uses `verifyCodeTrigger`); `gate held while operations findings are open`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Narrow with query "env config deploy database backup rate limit log monitor error".
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): architect and SRE role`.

### Task 11: QA conformance role

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/roles/qa.ts`, test `packages/core/test/qa.test.ts`.

**Interfaces:**
- Produces: `verifyCriteria(ctx, criteria: Criterion[], onlyFiles?: string[]): Promise<{checks: Check[]; findings: RoleResult['findings']}>`. One model call per criterion, each with the top 6 files from `narrowFiles(criterion.text, ...)` (restricted to `onlyFiles` when given) truncated at 20k characters. A `gap` produces a `conformance` finding (or `failure_path` when the criterion is a failure path) with a code trigger, `criterionId` set, and a fix prompt naming the file and line and quoting the criterion. `qaGate(checks: Check[]): {state, reason}` (held while any latest check is `gap` or `no_evidence`).

- [ ] **Step 1: Write failing tests:** `evidence citing a missing file becomes no_evidence` (Review Focus 1); `evidence citing a line past the end becomes no_evidence`; `a gap produces a finding whose fixPrompt contains the file, line and criterion text`; `onlyFiles restricts which files are sent to the model`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): QA conformance role with verified evidence`.

### Task 12: Product owner role

Skills: superpowers:test-driven-development.

**Files:** Create `packages/core/src/roles/po.ts`, test `packages/core/test/po.test.ts`.

**Interfaces:**
- Produces: `poGate(gates: Partial<Record<RoleId, {state: GateState}>>, accepted: boolean): {state, reason}` (cleared only when ba, architect, qa and compliance gates are all `cleared` and `accepted` is true; reason names every gate still held). `acceptanceSummary(rec: AcceptanceRecord, model: Model): Promise<string>` (request name `po.acceptanceSummary`; plain-language summary, at most 200 words; one model call, made inside a `po` run; stored as artifact kind `acceptance_summary` and included in the record read-out). The PO's decisions log needs no model: it is the finding status history plus gate records, already in `AcceptanceRecord`.

- [ ] **Step 1: Write failing tests:** `po gate held while compliance is held, reason names compliance`; `po gate cleared when all four cleared and accepted`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): product owner gate and acceptance summary`.

### Task 13: Workflow engine

Skills: superpowers:test-driven-development. BA OS `process-modelling` skill and `visual-modeller` agent produce the Mermaid workflow diagram for `README.md` from `STAGES` and `ON_DUTY`.

**Files:** Create `packages/core/src/workflow.ts`, test `packages/core/test/workflow.test.ts`.

**Interfaces:**
- Produces: `STAGES: StageId[]` in spec order; `interface WorkflowDeps { record: CopilotRecord; modelFor: ModelFactory; packs: Packs; cacheDir: string; githubToken?: string }` (each run builds its model with `modelFor(ledgerFor(record, runId))`); `advance(deps: WorkflowDeps, changeId: string): Promise<{stage: StageId; held: RoleId[]; stoppedForBudget: boolean}>`; `recheck(deps: WorkflowDeps, projectId: string, reason: 'push'|'mcp'|'manual'): Promise<{runIds: string[]; stoppedForBudget: boolean}>`.
- Dispatch table (`DISPATCH` in `workflow.ts`): what `advance` calls at each stage. One run per role call.

  | Stage | understand | feature / fix | Gate that blocks leaving the stage |
  |---|---|---|---|
  | intake | `ba.understandApp` | `ba.analyseImpact` against all project criteria | none |
  | analysis | `ba.analyseChange` using `answers` | `ba.analyseChange` | BA (`baGate`) |
  | design_review | `compliance.reviewCompliance`, `architect.reviewOperations` | same | none (gates recorded, not blocking) |
  | build | skipped (the code already exists) | waits; `recheck` moves the change to verification | none |
  | verification | `qa.verifyCriteria` on this change's criteria | `qa.verifyCriteria` on this change's criteria plus those linked `affects` | none (gate recorded) |
  | release | no model call: compute `complianceGate`, `architectGate`, `qaGate` from current open findings and latest checks | same | compliance, architect, QA |
  | acceptance | waits for `POST /accept`, then `poGate` and `po.acceptanceSummary` | same | PO |
  | operate | handled by `recheck` | same | none |

- PO gate needs a BA gate: the BA gate recorded at analysis is the one `poGate` reads.
- On duty in `operate`, per spec "all of them": `recheck` re-runs QA, compliance and architect; the BA and PO act through new changes (a new change runs intake and analysis again).
- `advance` writes results: findings via `addFinding` (link `raised_on` to the change), criteria (link `satisfies` to the change), `affectedCriterionIds` as `affects` links, artifacts, questions, gates.
- `recheck` syncs the repo, finds changed and deleted files since the last run's commit, re-verifies criteria whose last evidence touched a changed or deleted file plus criteria linked `affects` from open changes, re-runs compliance and architect only on changed files, and moves every change at `build` on to `verification` (then runs verification for it). A `BudgetExceededError` stops the loop, marks the run `stopped_budget`, and returns `stoppedForBudget: true`.

- [ ] **Step 1: Write failing tests** (fake model, temp repo):
  - `understand change runs ba at intake and skips build`.
  - `analysis does not move on while BA questions are unanswered`.
  - `design review records a held compliance gate but still moves on`.
  - `recheck moves a feature change from build to verification`.
  - `release holds while a legal finding is open, then clears after it is marked fixed and rechecked`.
  - `recheck re-verifies a criterion whose evidence file was deleted` (Review Focus 5).
  - `recheck re-verifies criteria linked affects from a new change and no others`.
  - `budget exhaustion mid-run stores stopped_budget and returns stoppedForBudget` (Review Focus 3).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): change workflow, gates and targeted recheck`.

### Task 14: HTTP server and push poller

Skills: superpowers:test-driven-development.

**Files:** Create `packages/server/src/app.ts`, `poller.ts`, `main.ts`, test `packages/server/test/app.test.ts` (Hono `app.request`).

**Interfaces:**
- Produces routes (JSON): `POST /api/projects {name, repoUrl, appUrl?}`; `GET /api/projects/:id`; `POST /api/projects/:id/changes {title, description, kind}`; `GET /api/changes/:id` (change, stage, gates, findings with status, criteria with latest state, questions); `POST /api/changes/:id/advance` (returns `{runId}` at once and runs in the background; `GET /api/runs/:id` returns `{state: 'running' | 'done' | 'stopped_budget' | 'error', error?}`, and the panel polls it; the same applies to `/recheck`); `POST /api/changes/:id/answers {answers: string[]}` (stored as artifact kind `answers`, read by BA at analysis); `POST /api/changes/:id/accept {actor}`; `POST /api/findings/:id/status {status, reason, actor}`; `POST /api/projects/:id/recheck {reason}`; `GET /api/projects/:id/findings?status=` (findings with status); `GET /api/findings/:id` (finding, status, history, and its criterion when `criterionId` is set); `GET /api/changes/:id/record` (AcceptanceRecord plus the acceptance summary); `GET /api/spend` (`{spentUsd, budgetUsd}`); static files from `packages/web/dist`. `POST /accept` records the founder's acceptance, then runs `poGate` and, if cleared, `acceptanceSummary`. `startPoller(deps: WorkflowDeps, intervalMs = 60_000, lsRemote: (repoUrl: string) => Promise<string> = gitLsRemote)` polls every project in the record and calls `recheck(deps, projectId, 'push')` for each whose head commit changed.

- [ ] **Step 1: Write failing tests:** `advance returns a run id before the run finishes`; `creating a project then a change returns stage intake`; `status endpoint rejects an unknown status with 400`; `spend endpoint returns spentUsd and budgetUsd`; `get finding returns its criterion`; `poller calls recheck only for the project whose head changed` (fake `lsRemote`, two projects).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `main.ts` reads env, opens `./data/copilot.db`, loads packs, builds `modelFor` from `createModel` (or `createFakeModel('packages/core/fixtures')` when `COPILOT_FAKE_MODEL=1`), starts the server on `PORT` (default 8787) and the poller.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): HTTP API and push poller`.

### Task 15: MCP server for coding agents

Skills: mcp-server-dev:build-mcp-server (or mcp-builder), superpowers:test-driven-development.

**Files:** Create `packages/mcp/src/main.ts`, `packages/mcp/src/tools.ts`, test `packages/mcp/test/tools.test.ts`.

**Interfaces:**
- Produces tools (stdio), each a thin call to the HTTP API at `COPILOT_URL` (default `http://localhost:8787`): `list_findings {projectId, status?}`; `get_finding {findingId}` (returns plain text, trigger, fix prompt, criterion); `get_change {changeId}`; `report_fix {findingId, summary}` (sets status `fixed`, actor `coding-agent`); `request_recheck {projectId}`. Tool descriptions tell the agent: you are the builder; fix findings, then call `report_fix` and `request_recheck`.

- [ ] **Step 1: Write failing tests:** `report_fix posts status fixed with actor coding-agent`; `get_finding returns the fix prompt`; `tools list contains exactly the five tools`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `@modelcontextprotocol/sdk`.
- [ ] **Step 4:** Run. Expected: PASS. Then connect it to the coding agent proven in Task 0 and call `list_findings` by hand. Expected: findings listed in the agent chat.
- [ ] **Step 5:** Commit `feat(mcp): MCP tools for coding agents`.

### Task 16: Web work panel

Skills: frontend-design:frontend-design (primary), impeccable or ui-ux-pro-max for the polish pass, design:ux-copy for labels, superpowers:verification-before-completion. Use the Kryterea brand (name, colours) but write fresh components; copy nothing from Kryterea's private product or marketing site.

**Files:** Create `packages/web/` (Vite React app): `src/main.tsx`, `src/api.ts`, `src/pages/Project.tsx`, `src/pages/Change.tsx`, `src/pages/Record.tsx`, `src/components/StageStrip.tsx`, `src/components/ProfessionalCard.tsx`, `src/components/FindingItem.tsx`, `src/components/SpendMeter.tsx`; test `packages/web/test/copy.test.ts`.

**Screens:**
- Project: repo and app links, list of changes with their stage, "New change" form (title, description, kind), "Re-check now".
- Change: stage strip across the eight stages; one card per professional on duty showing what they checked, their findings in plain language, and their gate (Held / Cleared, with reason); BA questions with answer boxes; each finding expandable to "What it costs you", trigger, "Copy fix prompt", and status buttons (Fixed, Accept risk, Defer) with a reason field; "Accept delivery" button enabled only when the PO gate can clear.
- Record: the acceptance record read-out, printable.
- Spend meter in the header: "$X of $70 copilot budget used"; at the limit, "Paused: copilot budget used".
- Every role result and finding shows a small "Reasoned by Muse Spark" label, and a running role shows a working state ("Analysing with Muse Spark") while its run id is polled, so judges see Meta models doing the work and the panel never looks frozen.

- [ ] **Step 1: Write failing test** `copy.test.ts`: scan every file under `packages/web/src` and fail on any of `score`, `rubric`, `grade`, `rating`, `pass`, `fail` as whole words in string literals, and on the em dash character.
- [ ] **Step 2:** Run. Expected: PASS on empty app; it guards later steps.
- [ ] **Step 3:** Build the three screens against the API.
- [ ] **Step 4:** Run the server with a seeded record (`pnpm dev`), open the panel, walk a change from intake to acceptance with `COPILOT_FAKE_MODEL=1` (fake mode from Task 14). Take screenshots. Check 375 px width.
- [ ] **Step 5:** Run `pnpm test`. Expected: all pass.
- [ ] **Step 6:** Commit `feat(web): work panel`.

### Task 17: Stretch: QA uses the running app

Only if Task 0 Step 4 showed image input works and Tasks 0 to 16 are done by the end of 11-02. Skills: webapp-testing, superpowers:test-driven-development.

**Files:** Create `packages/core/src/roles/qa-browser.ts`, test `packages/core/test/qa-browser.test.ts`.

**Interfaces:** `exploreFlow(ctx, criterion: Criterion, appUrl: string): Promise<{check: Check; screenshots: string[]}>`: Playwright opens `appUrl`, the model picks the next action from the page's accessibility snapshot (at most 8 steps), screenshots go to the model for the final judgement; triggers are `{type:'screen'}`. Test accounts come only from the demo app's seed file.

- [ ] **Step 1:** Failing test `stops after 8 steps and returns no_evidence` with a fake model and a static local page.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): QA explores the running app (stretch)`.

### Task 18: Demo app, first real run, video script

Skills: business-analysis-os agents `requirements-verifier` and `traceability-auditor` (independently review the copilot's output on the demo app), walkthrough-script-agent (script), business-analysis-os:executive-review and the `deliverable-critic` agent (Startup-track story), business-analysis-os:natural-prose-editor (final pass).

- [ ] **Step 1:** Create a second public repo `<owner>/demo-salon-bookings` (founder approves). In it, with the coding agent from Task 0 running on Muse Spark, build the demo app from plain founder-style prompts only, for example: "Build me a booking website for my hair salon in Lagos. Customers pick a service and time, create an account, and pay a deposit with Paystack. I want an admin page to see bookings." Never mention failure handling, compliance or operations. Save every prompt in `PROMPTS.md` in that repo. The coding agent is OpenCode on Muse Spark (Task 0). Commit a launcher script in the demo repo that reads `META_API_KEY` from the environment and sets `OPENCODE_DISABLE_CLAUDE_CODE=1` and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, so personal skills and the key never load or appear on camera. Payment in test mode only; if the founder has no Paystack test account, the agent may mock the payment step and say so.
- [ ] **Step 2:** Run the copilot on the demo repo: create the project, create change "Understand what we have" (kind `understand`), advance through intake and design review. Export the record.
- [ ] **Step 3:** Run the BA OS `requirements-verifier` agent on the BA's as-built artifact and criteria, and the `traceability-auditor` agent on the record export. Fix any copilot bug they reveal in its own task's files with a test. Their reports stay out of the public repo (they are BA OS output).
- [ ] **Step 4:** Create change "Add monthly subscriptions" (kind `feature`) and walk it through. Let the coding agent fix findings over MCP. Confirm release holds then clears.
- [ ] **Step 4b:** Put the copilot in one real user's hands (a founder or agency contact the founder picks) on their own repo or the demo repo. Note what they did, where they got stuck and what they valued in `docs/hackathon/user-test.md` (no personal data). Fix anything that blocks them. This is the impact evidence the rubric puts first; skip only if no one is available by 11-02.
- [ ] **Step 5:** Write `docs/hackathon/video-script.md` around the issues that actually appeared (spec section 9 timing). If a planned issue did not appear, change the scene, never the app. Order it for the rubric: impact (who benefits and why) first, then Meta models doing the reasoning, then technical depth. Write it as a voiceover script.
- [ ] **Step 6:** Run `deliverable-critic` on the script as a Startup-track judge would read it. Revise. Founder approves the script.
- [ ] **Step 7:** Commit `docs: video script`.

### Task 19: README, disclosure, security pass, video, submission

Skills: business-analysis-os:technical-writer then business-analysis-os:natural-prose-editor (README), security-review (before the final public push), superpowers:finishing-a-development-branch, superpowers:verification-before-completion.

- [ ] **Step 1:** README: what it is (positioning line), the three audiences, the workflow diagram from Task 13, how to run locally with your own Meta key, the MCP setup for any MCP-capable agent, the roadmap ("professional packs can be swapped for Kryterea's private packs"), and a "Built during the hackathon" section linking `BUILT_DURING_HACKATHON.md`.
- [ ] **Step 2:** `BUILT_DURING_HACKATHON.md`: build window, first commit hash and date, everything built during the event, external pieces (open-source libraries, Meta Model API, Cline or OpenCode), and the disclosure that Kryterea's private BA OS was used as development tooling, none of its content is in the repo, and it is not part of the entry.
- [ ] **Step 3:** Run the security-review skill and a secret scan (`git log -p | grep -iE "key|token|secret"` reviewed by hand) on both public repos, plus a scan for private names (Kryterea's private repo names, internal rule names) across the full history of both. Expected: no secrets. Confirm `.env` and `data/*.db` are ignored.
- [ ] **Step 4:** CI green on the final commit.
- [ ] **Step 5:** Founder records the 3-minute video from the script (screen capture of the panel, the coding agent and the demo app). Upload as unlisted YouTube or Loom; check it plays logged out.
- [ ] **Step 6:** Founder submits at https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit by midday ET on 2026-11-04: Startup track, public repo URL, video link, every team member added, the prior-work call-out (where new work starts: the first commit), and the bonus prizes entered (default: best agentic use case, community vote; most viral if the founder posts on X). Claude prepares the text for each form field in `docs/hackathon/submission.md`; the founder submits.
- [ ] **Step 7:** After submitting: founder shares the project gallery link for the community vote and, if chosen, posts on X and adds the post link to the form.
