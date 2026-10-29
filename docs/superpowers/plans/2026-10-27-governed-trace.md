# Governed Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Kryterea reads a project's PRD and specs like a professional, links every document line through requirements, criteria, Linear tickets, commits, evidence, findings and named decisions to sign-off, catches drift on every commit and document edit, and keeps warning (never blocking) in the coding agent, on GitHub, in Linear and in the panel until each item is confirmed fixed or accepted by a named person.

**Architecture:** New core modules for documents, requirements, drift and open items sit beside the existing workflow and write to new additive tables in the SQLite record. The server gains document, trace, open-item and connection routes plus Linear and GitHub comment clients driven from the existing recheck path. The panel gains Needs you, Documents, Trace and Connections views; MCP answers gain an open-items preamble.

**Tech Stack:** TypeScript, Node 22 `node:sqlite`, Hono, `@modelcontextprotocol/sdk`, Vite React 18, Vitest. Muse Spark through the existing `createModel`. Linear GraphQL API and GitHub REST API through `fetch` (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-10-27-governed-trace-design.md` (extends `docs/superpowers/specs/2026-10-26-lifecycle-copilot-design.md`).

## Global Constraints

- No em dashes, en dashes or spaced hyphens as sentence dashes in any copy, comment, prompt or doc.
- No score, rubric, grade, rating, pass or fail wording. Evidence: "Evidence found", "Gap", "No evidence". Gates: "Held", "Cleared". Warnings: "Open" with the reason. BABOK is never named.
- Legal findings say "Check this", cite only `packs/legal/ndpa-2023.json` entries, and every legal surface carries "Not legal advice".
- Requirement quality is checked "against the qualities in ISO/IEC/IEEE 29148 (necessary, unambiguous, verifiable, consistent, complete)"; never claim certification or endorsement.
- People decide: a warning clears only when Kryterea confirms it (re-check, re-read, or a deterministic rule no longer holding) or a named person accepts it with a reason. An agent's report never clears anything.
- Never block: no failing GitHub status, no refusal to agents. Comments only, one per pull request, commit or Linear ticket, edited in place, never deleted.
- Record is additive: new tables only; existing CHECK constraints and the findings immutability triggers are untouched. Document findings use existing kinds (`conformance`, `failure_path`, `legal`, `operations`).
- Never write to the code of the checked repo. Never read or print `.env`; keys come from `LINEAR_API_KEY` and `GITHUB_TOKEN` env vars (trim whitespace). A missing key turns that connection off with a visible "Not connected" state, never an error.
- Model spend stays under `COPILOT_BUDGET_USD` (70). A document is sent to the model only when its content hash changes. Tests and UI work use the fake model.
- Panel follows the existing Kryterea visual system in `packages/web/src/styles.css` (tokens, Stamp, Trail, ProfessionalCard), icon-forward buttons, light and dark themes, works at 375px wide.
- Commits: conventional style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. CI on Linux is the truth; check it after every push.

## Review Focus

1. A document without requirement IDs is edited (one sentence reworded, one added): requirements keep their identity and links, one is added, none duplicated. Test in Task 3.
2. A model cites a quote that is not in the document, or a document/line it was not given: the finding is dropped, never stored. Test in Task 3.
3. Linear or GitHub is unreachable or the key is wrong: the recheck still finishes, open items are still correct, and Connections shows the error text. Tests in Tasks 10 and 11.
4. A repo with no PRD or spec: no model call for documents, Needs you shows "No PRD or spec found" with how to add one, and the trace view shows its empty state. Tests in Tasks 2 and 8.
5. A secret-looking file (`.env`, keys) matches the document pattern, or a pasted document is huge: secret files are never read; pastes over 200 KB are refused with a clear message. Tests in Tasks 2 and 12.

---

## File Structure

Core (`packages/core/src`):
- `record/schema.ts` (modify): new tables `documents`, `document_versions`, `requirements`, `requirement_events`, `requirement_links`, `project_settings`, `external_posts`.
- `record/record.ts` (modify): methods for those tables.
- `types.ts` (modify): `Document`, `DocumentVersion`, `Requirement`, `RequirementEvent`, `RequirementLink`, `OpenItem`, `DriftRule`; doc trigger gains optional `document` and `line`.
- `docs/discover.ts` (create): which repo files are documents.
- `roles/ba-docs.ts` (create): BA reads documents, extracts requirements, raises document gaps, maps versions, finds undocumented flows.
- `drift.ts` (create): deterministic drift rules and their auto-confirmation.
- `open-items.ts` (create): ranked open items per project.
- `trace.ts` (create): forward trace for a requirement, backward trace for a commit.
- `workflow.ts` (modify): run document review at intake and on document change; link criteria to requirements; drift on recheck; QA no longer duplicates findings.
- `roles/ba.ts`, `roles/compliance.ts`, `roles/architect.ts` (modify): documents in their material; criteria carry `requirementKeys`.

Server (`packages/server/src`):
- `linear.ts` (create), `github.ts` (create): comment clients.
- `sync.ts` (create): after each recheck, post open items to Linear and GitHub.
- `app.ts` (modify): routes listed in Task 12.
- `main.ts` (modify): wire keys.

MCP (`packages/mcp/src/tools.ts`, modify): open-items preamble.

Web (`packages/web/src`):
- `api.ts` (modify), `main.tsx` (modify routes).
- `pages/Project.tsx` (modify): section switcher Changes, Needs you, Documents, Trace, Connections.
- `pages/Documents.tsx`, `pages/Trace.tsx`, `pages/Requirement.tsx`, `pages/CommitTrace.tsx` (create).
- `components/NeedsYou.tsx`, `components/TraceChain.tsx` (create); `ProfessionalCard.tsx`, `FindingItem.tsx`, `pages/Change.tsx`, `pages/Record.tsx` (modify).

Demo repo (`../demo-merchant-payments`): `PROMPTS.md` prompt 2, `docs/PRD.md` written by the coding agent.

---

## Screens (every screen built and shown)

Each screen lists what it shows, its states, and the task that builds it. All copy follows Global Constraints.

| # | Screen | Route | Shows | Empty / error states | Task |
|---|---|---|---|---|---|
| S1 | Projects | `#/` | Each project with an "Open" count stamp from open items | No projects: existing empty form | 13 |
| S2 | Project: Changes | `#/projects/:id` | Existing change list and add-change form, now one section of a switcher (Changes, Needs you, Documents, Trace, Connections) with counts | Existing | 13 |
| S3 | Project: Needs you | `#/projects/:id/needs-you` | Ranked open items: role, kind stamp, title, why it is open, where it lives (document line, file:line, ticket), age, link to its finding and trace; total count. Clears only per Global Constraints | "Nothing open. Every item is fixed and confirmed, or accepted with a name." "No PRD or spec found" item with how to add one | 8, 13 |
| S4 | Project: Documents | `#/projects/:id/documents` | Tracked documents (repo path or uploaded name), source, version count, last read commit, requirements count, gap count; Upload or paste (name + Markdown); include and exclude patterns editor | "No PRD or spec found. Add one to the repo under docs/, or paste one here." Paste over 200 KB: "That document is over 200 KB. Split it or paste the part that matters." | 12, 13 |
| S5 | Document detail | `#/projects/:id/documents/:docId` | Numbered text of the latest version with each requirement highlighted and its key; gaps shown beside the quoted lines; version picker with before and after for the last change (added, changed, removed requirements) | One version: no picker | 13 |
| S6 | Project: Trace | `#/projects/:id/trace` | Table, one row per requirement: key, text, document line, criteria count, Linear ticket, evidence state of its criteria, open findings, decision. Filter: All, Open, No criteria, No evidence, Drifted. Search by commit SHA jumps to S8 | No requirements: points to S4 | 13 |
| S7 | Requirement trace | `#/requirements/:id` | The chain, left to right on desktop and top to bottom on phone: document line → requirement (with history) → criteria → Linear ticket → commits and files (evidence) → checks → findings → decisions with name, reason and time → sign-off. Link Linear ticket field (identifier) | Missing link in the chain shows as an open "Gap" node, never hidden | 7, 13 |
| S8 | Commit trace | `#/projects/:id/commits/:sha` | Backward: files changed, criteria whose evidence those lines support, their requirements and documents, findings raised or confirmed at that commit | Unknown commit: "Kryterea has not checked this commit." | 13 |
| S9 | Project: Connections | `#/projects/:id/connections` | Coding agent (MCP command to copy), GitHub (Connected / Not connected / error text, last comment link), Linear (same, linked tickets count). Line: "Kryterea comments and warns. It never blocks a merge or an agent." | No key: "Not connected. Add LINEAR_API_KEY (or GITHUB_TOKEN) to .env and restart." | 12, 13 |
| S10 | Change page (modified) | `#/changes/:id` | Intake: documents read and requirements in scope. Analysis: document gaps grouped by document, each with quote and line. Criteria list shows the requirement key each covers. Role cards: practice line, "Pushed back on" (findings it raised that are open or accepted) and "Accepted by" (name, reason) | Existing | 13, 14 |
| S11 | Finding (modified) | inside S10, S3 | Doc trigger renders document name and line with the quoted text; drift findings show before and after; accepted risk under review shows the original acceptance | Existing | 13 |
| S12 | Record (modified) | `#/changes/:id/record` | Adds "Trace" section (each requirement → criteria → evidence → decision) and the line "Not legal advice. Kryterea advises and records; people decide." | Existing | 14 |
| E1 | Coding agent (MCP) | terminal | Every tool answer opens with: "Kryterea: N open on this project." then up to three items (kind, title, id) then the tool's own answer | "Kryterea: nothing open on this project." | 9 |
| E2 | GitHub comment | PR or commit | Title "Kryterea governance", N open with up to ten items (kind, title, where), link text to the trace, footer "Kryterea warns and records. It never blocks a merge." | All clear: "Nothing open. Checked at <sha>." | 11 |
| E3 | Linear comment | ticket | "Kryterea on <KEY> <requirement>", its open items, evidence state of its criteria | All clear: "Nothing open for this requirement. Checked at <sha>." | 10 |

---

### Task 1: QA stops duplicating failure paths the analyst already raised

The live run on the demo app raised the same four failure paths twice (BA at intake, QA at verification), so the panel showed 21 holding for 17 issues. Warnings must not double.

**Files:**
- Modify: `packages/core/src/workflow.ts` (the `verify` function, where QA findings are pushed)
- Test: `packages/core/test/workflow.test.ts`

**Interfaces:**
- Produces: no new exports.

- [x] **Step 1: Write the failing test** `it("QA adds no finding on a criterion that already has an open finding from any role")`: BA understand fixture raises a failure-path finding tied to criterion CRIT-CANCEL; QA fixture returns a gap with its own finding on CRIT-CANCEL. After `advance` to release: `record.listFindings({ projectId, status: "open" }).filter(f => f.criterionId === cancel.id)` has length 1, and the QA check on CRIT-CANCEL is still recorded as `gap`.
- [x] **Step 2:** Run `pnpm vitest run packages/core/test/workflow.test.ts -t "QA adds no finding"`; expect FAIL (length 2).
- [x] **Step 3:** In `verify`, before saving, drop QA findings whose `criterionId` already has an open finding in `record.listFindings({ projectId, status: "open" })`. Checks are kept.
- [x] **Step 4:** Run the test file; expect PASS.
- [x] **Step 5:** Commit `fix(core): QA does not repeat a finding the analyst already raised`.

### Task 2: Record documents, requirements and settings; discover documents

**Files:**
- Modify: `packages/core/src/record/schema.ts`, `packages/core/src/record/record.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/docs/discover.ts`
- Test: `packages/core/test/record.test.ts`, `packages/core/test/discover.test.ts`

**Interfaces:**
- Produces (types):
  - `Document { id; projectId; name: string; source: "repo" | "upload"; createdAt }`
  - `DocumentVersion { id; documentId; contentHash: string; commit: string | null; body: string; createdAt }`
  - `Requirement { id; projectId; documentId; key: string; text: string; quote: string; line: number; status: "active" | "removed"; createdAt; updatedAt }`
  - `RequirementEvent { requirementId; kind: "added" | "changed" | "removed"; text: string; versionId: string; at }`
  - `RequirementLink { requirementId; toType: "criterion" | "linear_issue"; toId: string; createdAt }`
  - `DocSettings { include: string[]; exclude: string[] }`
  - Doc trigger becomes `{ type: "doc"; quote: string; document?: string; line?: number }`.
- Produces (record methods):
  - `saveDocumentVersion(i: { projectId: string; name: string; source: "repo" | "upload"; body: string; commit: string | null }): { document: Document; version: DocumentVersion; changed: boolean }`. Same hash returns `changed: false` and no new version.
  - `listDocuments(projectId: string): Array<Document & { latest: DocumentVersion; versions: number }>`
  - `documentVersions(documentId: string): DocumentVersion[]`
  - `applyRequirements(documentId: string, versionId: string, next: Array<{ key: string; text: string; quote: string; line: number }>): { added: Requirement[]; changed: Requirement[]; removed: Requirement[] }`. Matches by `key`; writes `requirement_events`.
  - `listRequirements(projectId: string, opts?: { status?: "active" | "removed" }): Requirement[]`
  - `requirementEvents(requirementId: string): RequirementEvent[]`
  - `linkRequirement(requirementId: string, toType: RequirementLink["toType"], toId: string): void` (idempotent)
  - `requirementLinks(requirementId: string): RequirementLink[]`
  - `docSettings(projectId: string): DocSettings`, `setDocSettings(projectId: string, s: DocSettings): void`
  - `externalPost(target: string, targetId: string): { commentId: string; bodyHash: string } | null`, `saveExternalPost(target: string, targetId: string, commentId: string, bodyHash: string): void`
- Produces (discover): `discoverDocuments(files: string[], settings: DocSettings): string[]` in `docs/discover.ts`. Default: `.md` or `.mdx` files whose path matches `/(^|\/)docs\//i` or whose name matches `/prd|spec|requirement/i`; minus `isSecretFile`; minus `node_modules`; then settings.include globs added and settings.exclude globs removed.

- [x] **Step 1: Write failing tests.**
  - `record.test.ts` `it("keeps one version per content and reports changes")`: saving the same body twice gives one version and `changed: false` the second time; a new body gives two versions.
  - `it("applies requirements by key: added, changed, removed, with events")`: apply `[FR-1 a, FR-2 b]` then `[FR-1 a2, FR-3 c]` gives added `[FR-3]`, changed `[FR-1]`, removed `[FR-2]`; `requirementEvents(FR-1)` kinds `["added","changed"]`; `listRequirements(p, {status:"active"})` keys `["FR-1","FR-3"]`.
  - `it("links requirements idempotently")`.
  - `discover.test.ts` `it("finds PRD and spec files and skips secrets and node_modules")`: input `["docs/PRD.md","SPEC.md","README.md","node_modules/x/docs/a.md",".env","docs/secrets.key","src/a.ts"]` gives `["docs/PRD.md","SPEC.md"]`; with `exclude: ["SPEC.md"]` gives `["docs/PRD.md"]`; with `include: ["README.md"]` adds it.
- [x] **Step 2:** Run both test files; expect FAIL.
- [x] **Step 3:** Add the tables (`CREATE TABLE IF NOT EXISTS`, unique `(project_id, name)` on documents, unique `(document_id, key)` on requirements, unique `(requirement_id, to_type, to_id)` on links, primary key `(target, target_id)` on `external_posts`), the types, the methods, and `discoverDocuments` (use `node:path` `matchesGlob` for include and exclude). Export from `index.ts`.
- [x] **Step 4:** Run; expect PASS. Run `pnpm test` (all green).
- [x] **Step 5:** Commit `feat(core): record documents, requirements and their links`.

### Task 3: The analyst reads documents like a professional

**Files:**
- Create: `packages/core/src/roles/ba-docs.ts`
- Modify: `packages/core/src/roles/context.ts` (`checkTriggers` accepts documents)
- Create fixture: `packages/core/fixtures/ba.reviewDocuments.json`
- Test: `packages/core/test/ba-docs.test.ts`

**Interfaces:**
- Consumes: `Requirement`, `RoleContext`, `RoleResult`, `checkTriggers` from Task 2 and existing code.
- Produces: `reviewDocuments(ctx: RoleContext, docs: Array<{ name: string; body: string }>, previous: Requirement[]): Promise<{ requirements: Array<{ document: string; key: string; text: string; quote: string; line: number }>; findings: RoleResult["findings"] }>`.
  - Model call name `ba.reviewDocuments`. Input: each document with numbered lines inside `<<<BEGIN DOCUMENT name>>>` fences (defanged), plus the previous requirements (key, text) per document.
  - Instructions (copy verbatim intent): extract each requirement with its exact quote and line; keep an ID written in the document as its key, otherwise reuse the key of the previous requirement it is the same as, otherwise create `<DOC>-<n>` with the next free number; raise at most 8 gaps, each against the qualities in ISO/IEC/IEEE 29148 (necessary, unambiguous, verifiable, consistent, complete) or as a missing failure path, a contradiction between documents, or a missing compliance or operations need; each gap quotes the document word for word with document and line; say each gap in terms the owner can act on.
  - Findings: kind `conformance` (quality, contradiction, missing need) or `failure_path`; trigger `{ type: "doc", quote, document, line }`; titles start with what is wrong in plain words.
  - Guard: any requirement or finding whose quote is not found verbatim in the named document at or within 3 lines of the given line is dropped.

- [x] **Step 1: Write failing tests** with a fake model:
  - `it("extracts requirements with their quote and line, keeping written IDs")`.
  - `it("maps a reworded requirement to its previous key and adds a new one")` (Review Focus 1): previous `[PRD-1 "Merchants create payment links"]`, model returns key `PRD-1` for the reworded line and `PRD-2` for a new one; result keys `["PRD-1","PRD-2"]`.
  - `it("drops a gap or requirement whose quote is not in the document")` (Review Focus 2): returns 0 findings for a made-up quote and for a document name not given.
  - `it("raises at most 8 gaps")`.
- [x] **Step 2:** Run `pnpm vitest run packages/core/test/ba-docs.test.ts`; expect FAIL.
- [x] **Step 3:** Implement `reviewDocuments` and extend `checkTriggers` with an optional `docs: Map<string, string[]>` argument used for doc triggers that name a document.
- [x] **Step 4:** Run; expect PASS.
- [x] **Step 5:** Commit `feat(core): the analyst reads PRDs and specs and raises gaps`.

### Task 4: Compliance and the architect read the documents too; criteria cover requirements

**Files:**
- Modify: `packages/core/src/roles/compliance.ts`, `packages/core/src/roles/architect.ts`, `packages/core/src/roles/ba.ts`, `packages/core/src/roles/context.ts` (`renderDocText`)
- Modify fixtures: `ba.analyseChange.json`, `ba.analyseImpact.json` (add `requirementKeys`)
- Test: `packages/core/test/compliance.test.ts`, `packages/core/test/architect.test.ts`, `packages/core/test/ba.test.ts`

**Interfaces:**
- Consumes: `reviewDocuments` output shape (Task 3).
- Produces:
  - `RoleContext` gains `documents?: Array<{ name: string; body: string }>` and `requirements?: Requirement[]`.
  - `renderDocText` includes each document (numbered, fenced) when `ctx.documents` is set, so doc triggers from compliance and the architect can quote it.
  - BA criteria output gains `requirementKeys: string[]`; `RoleResult.criteria[n].requirementKeys?: string[]`.

- [x] **Step 1: Write failing tests:** compliance `it("can cite a PRD line as the trigger for a legal finding")`; architect `it("can cite a spec line as the trigger for an operations finding")`; BA `it("returns the requirement keys each criterion covers")`.
- [x] **Step 2:** Run the three files; expect FAIL.
- [x] **Step 3:** Pass documents into the material and the doc-trigger check; add `requirementKeys` to the BA criteria schema with the instruction "list the requirement keys this criterion covers; empty if none".
- [x] **Step 4:** Run; expect PASS.
- [x] **Step 5:** Commit `feat(core): compliance and the architect read the documents; criteria name their requirements`.

### Task 5: Documents in the workflow

**Files:**
- Modify: `packages/core/src/workflow.ts`
- Test: `packages/core/test/workflow.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4.
- Produces: `syncDocuments(deps: WorkflowDeps, projectId: string, change: Change): Promise<{ changed: string[] }>` (exported). Discovers repo documents, adds uploaded ones from the record, saves versions, and runs `reviewDocuments` only for documents whose hash changed; applies requirements; raises gap findings on `change`.
- Behaviour:
  - At intake (every change kind), `syncDocuments` runs before the BA, and the BA, compliance and architect get `documents` and `requirements` in their context.
  - `save` links each new criterion to the requirements named in its `requirementKeys` (`linkRequirement(r.id, "criterion", k.id)`).
  - The change a document finding lands on: the change passed in; `recheck` passes the latest change that is not withdrawn and not at operate, else the latest delivered change.
  - Gates: `baGate` also holds while any open BA `conformance` or `failure_path` finding with a doc trigger is raised on the change, with reason `<n> document gaps to fix or accept with a reason.` Nothing outside Kryterea is stopped. Test: `it("document gaps hold the analyst's gate until fixed or accepted")`.
  - Confirmation of a document gap: after a re-read of a document version, open BA findings with a doc trigger naming that document whose quote is no longer in the new body, or that were not raised again, are set `fixed` with reason `Not raised again on re-read at <hash 7>` by `ba`. Findings whose quote is still present and were raised again stay open.

- [x] **Step 1: Write failing tests:**
  - `it("reads documents at intake, stores requirements and links criteria to them")`.
  - `it("does not call the model for documents whose content did not change")`: second `advance` on a new change with the same PRD makes no `ba.reviewDocuments` call.
  - `it("a document gap clears only when a re-read no longer raises it")`: edit the PRD body to fix the quoted line, recheck, finding status `fixed`; a reported fix alone leaves it `open`.
  - `it("no documents: no document model call and no document findings")` (Review Focus 4).
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `pnpm test`; expect PASS.
- [x] **Step 5:** Commit `feat(core): documents are read at intake and re-read when they change`.

### Task 6: Code and documents checked both ways

**Files:**
- Modify: `packages/core/src/roles/ba-docs.ts`, `packages/core/src/workflow.ts`
- Create fixture: `packages/core/fixtures/ba.undocumentedFlows.json`
- Test: `packages/core/test/ba-docs.test.ts`, `packages/core/test/workflow.test.ts`

**Interfaces:**
- Produces: `undocumentedFlows(ctx: RoleContext, flows: string[], requirements: Requirement[]): Promise<RoleResult["findings"]>`. Model call `ba.undocumentedFlows`; at most 8 findings; kind `conformance`; title starts `Not in any document: `; code trigger required (verified by `checkTriggers`); fixPrompt asks the owner to add it to the PRD or remove it.
- Promise not kept: already covered by QA gaps on criteria linked to requirements; no new code.
- Requirement with no criteria: handled as a drift rule in Task 7.

- [x] **Step 1: Write failing tests:** `it("raises behaviour no document asked for, at most 8, each with a code trigger")`; workflow `it("runs the undocumented check when the baseline has documents")` and `it("skips it when there are no documents")`.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement; call it in the understand path after `understandApp`, using `asBuilt.flows`, only when requirements exist.
- [x] **Step 4:** Run; expect PASS.
- [x] **Step 5:** Commit `feat(core): flag behaviour no document asked for`.

### Task 7: Drift rules and the trace

**Files:**
- Create: `packages/core/src/drift.ts`, `packages/core/src/trace.ts`
- Modify: `packages/core/src/workflow.ts` (`recheck`), `packages/core/src/repo/repo.ts` (diff hunks)
- Test: `packages/core/test/drift.test.ts`, `packages/core/test/trace.test.ts`

**Interfaces:**
- Produces:
  - `diffHunks(dir: string, from: string, to: string): Promise<Array<{ file: string; start: number; end: number }>>` in `repo.ts` (from `git diff -U0`, new-side line ranges; deleted lines map to the line they were removed before).
  - `type DriftRule = "requirement_changed" | "evidence_lines_changed" | "requirement_no_criteria" | "requirement_no_evidence" | "accepted_risk_changed" | "documents_disagree"`.
  - `applyDrift(record: CopilotRecord, projectId: string, change: Change, input: { hunks: Array<{ file: string; start: number; end: number }>; changedRequirements: Requirement[]; commit: string; runId: string }): { raised: number; confirmed: number }`. Raises one `conformance` finding per rule and subject with a fixed title (below), role `ba` for requirement rules and `qa` for evidence rules, and sets a previously raised drift finding `fixed` with reason `Kryterea re-checked at <sha7>: <rule> no longer holds` when its rule no longer holds. `documents_disagree` comes from Task 3 contradiction gaps, so it is only confirmed here, never raised.
  - Titles (exact): `Requirement <key> changed but its criteria did not`, `Code behind the evidence for "<criterion short>" changed`, `Requirement <key> has no acceptance criteria`, `Requirement <key> has no evidence yet`, `Accepted risk needs review: <original title>`.
  - Evidence-lines rule also queues those criteria for re-verification in the same recheck.
  - `traceRequirement(record: CopilotRecord, requirementId: string): TraceChain` and `traceCommit(record: CopilotRecord, projectId: string, sha: string): CommitTrace | null`, where `TraceChain = { document: { id; name; line; quote }; requirement: Requirement & { events: RequirementEvent[] }; criteria: Array<Criterion & { latest: Check | null }>; tickets: string[]; evidence: Array<{ file: string; line: number; commit: string }>; findings: Array<Finding & { status: FindingStatus; history: Array<{ status; reason; actor; at }> }>; signOff: { by: string; at: string } | null; gaps: string[] }` and `gaps` names each missing link in plain words (for example `No acceptance criteria`). `CommitTrace = { sha: string; files: string[]; criteria: Array<{ id: string; text: string; requirementKeys: string[] }>; documents: string[]; findings: Array<{ id: string; title: string; status: FindingStatus }> }`.
  - Rule roles: `requirement_changed`, `requirement_no_criteria`, `accepted_risk_changed` are raised by `ba`; `evidence_lines_changed` and `requirement_no_evidence` by `qa`.

- [x] **Step 1: Write failing tests (drift.test.ts):** one test per rule raising its exact title; `it("confirms a drift finding when its rule no longer holds")`; `it("a diff that does not overlap cited lines raises nothing")`; `it("an accepted risk whose trigger lines change gets a review finding and keeps its acceptance")`. **(trace.test.ts):** `it("follows a requirement to sign off and names missing links as gaps")`; `it("traces a commit back to criteria, requirements and documents")`; `it("unknown commit returns null")`.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement; call `applyDrift` at the end of `recheck` (after QA) with hunks from the last checked commit to head.
- [x] **Step 4:** Run `pnpm test`; expect PASS.
- [x] **Step 5:** Commit `feat(core): drift rules confirmed by Kryterea, and the trace both ways`.

### Task 8: Open items

**Files:**
- Create: `packages/core/src/open-items.ts`
- Test: `packages/core/test/open-items.test.ts`

**Interfaces:**
- Produces: `interface OpenItem { id: string; findingId: string | null; kind: FindingKind | "setup"; role: RoleId; title: string; why: string; where: string; requirementKey: string | null; createdAt: string }` and `openItems(record: CopilotRecord, projectId: string): { total: number; items: OpenItem[] }`. Items are open findings (status `open`) plus the setup item `No PRD or spec found` when the project has no documents. Ranked: legal, failure_path, drift titles (Task 7), other conformance, operations, setup; newest first within a rank. `where` is `document:line`, `file:line`, or the screen URL.

- [x] **Step 1: Write failing tests:** ranking order; `it("accepted and fixed findings are not open items")`; `it("a project with no documents has the setup item")` (Review Focus 4).
- [x] **Step 2:** Run; expect FAIL. **Step 3:** Implement and export. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(core): ranked open items per project`.

### Task 9: The coding agent always hears what is open

**Files:**
- Modify: `packages/mcp/src/tools.ts`
- Test: `packages/mcp/test/tools.test.ts`

**Interfaces:**
- Consumes: `GET /api/projects/:id/open-items` (Task 12) returning `{ total, items }`; finding and change responses carry `projectId`.
- Produces: every tool result starts with `Kryterea: <N> open on this project.` then up to three lines `- <kind> | <title> | <findingId or where>`, or `Kryterea: nothing open on this project.`. Tools taking a finding or change id resolve the project from that response. If the open-items call fails the tool still answers, with `Kryterea: open items could not be read.`

- [x] **Step 1: Write failing tests:** one per tool asserting the preamble; `it("still answers when open items cannot be read")`.
- [x] **Step 2:** FAIL. **Step 3:** Implement in the shared tool wrapper. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(mcp): every answer opens with what is still open`.

### Task 10: Linear comments

**Files:**
- Create: `packages/server/src/linear.ts`
- Test: `packages/server/test/linear.test.ts`

**Interfaces:**
- Produces: `linearClient(apiKey: string, fetchFn: typeof fetch = fetch): { issue(identifier: string): Promise<{ id: string; identifier: string; title: string; url: string } | null>; upsertComment(issueId: string, commentId: string | null, body: string): Promise<string> }` against `https://api.linear.app/graphql` with header `Authorization: <key>`; `issue` uses the `issue(id:)` query with the identifier; `upsertComment` uses `commentCreate` or `commentUpdate`.
- Produces: `linearBody(key: string, requirement: string, items: OpenItem[], criteriaStates: string[], sha: string): string` with the copy in screen E3.
- Produces: `findIssueKeys(text: string): string[]` matching `/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g`.

- [x] **Step 1: Write failing tests** with a fake fetch: create then update reuses the comment id; unknown identifier returns null; `it("a network error or 401 rejects with a readable message and nothing else breaks")` (Review Focus 3); `findIssueKeys("fix ENG-12 and PAY-3")` gives `["ENG-12","PAY-3"]`.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(server): Linear comments, created once and edited in place`.

### Task 11: GitHub comments and the sync after each check

**Files:**
- Create: `packages/server/src/github.ts`, `packages/server/src/sync.ts`
- Modify: `packages/server/src/main.ts`, `packages/server/src/poller.ts` (call sync after a recheck job), `packages/server/src/app.ts` (call sync after manual recheck and advance jobs)
- Test: `packages/server/test/github.test.ts`, `packages/server/test/sync.test.ts`

**Interfaces:**
- Produces: `githubClient(token: string, repo: { owner: string; name: string }, fetchFn = fetch): { openPulls(): Promise<Array<{ number: number; headSha: string }>>; upsertPullComment(n: number, commentId: string | null, body: string): Promise<string>; upsertCommitComment(sha: string, commentId: string | null, body: string): Promise<string> }`. Comment bodies start with the hidden marker `<!-- kryterea:governance -->`.
- Produces: `githubBody(items: OpenItem[], total: number, sha: string, traceUrl: string | null): string` with the copy in screen E2 (at most ten items).
- Produces: `syncExternal(deps: { record: CopilotRecord; linear: ReturnType<typeof linearClient> | null; github: ((repoUrl: string) => ReturnType<typeof githubClient> | null) }, projectId: string, head: string): Promise<{ linear: "ok" | "off" | string; github: "ok" | "off" | string }>`. Links Linear keys found in commit messages and branch names since the last checked commit to the requirements those commits' criteria cover; writes one comment per linked ticket and one per open pull request (or per head commit when there is no pull request); skips the API call when the body hash is unchanged (`externalPost`); returns the error text on failure and never throws. Status is stored in memory for the Connections screen.

- [x] **Step 1: Write failing tests:** GitHub upsert creates then edits the same comment; no pull request posts a commit comment; `sync` with unchanged items makes no API call; `it("Linear down and GitHub 401: sync returns both error texts, recheck result unchanged")` (Review Focus 3); missing keys return `off`.
- [x] **Step 2:** FAIL. **Step 3:** Implement and wire (`LINEAR_API_KEY`, `GITHUB_TOKEN`, trimmed). **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(server): warnings follow the work to GitHub and Linear`.

### Task 12: Server routes for documents, trace, open items and connections

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/app.test.ts`

**Interfaces:**
- Produces routes (JSON; writes follow the existing origin and token rules):
  - `GET /api/projects/:id/open-items` → `{ total, items: OpenItem[] }`
  - `GET /api/projects/:id/documents` → `{ documents }` (Task 2 `listDocuments` shape plus `requirements` and `gaps` counts)
  - `GET /api/documents/:id` → `{ document, versions, requirements, findings }`
  - `POST /api/projects/:id/documents` `{ name: string; body: string }` → 201 `{ document, version, changed }`; 413 with `That document is over 200 KB. Split it or paste the part that matters.` when `body` exceeds 200 KB (Review Focus 5); 400 for an empty name or body
  - `PUT /api/projects/:id/doc-settings` `{ include: string[]; exclude: string[] }` → 200 settings
  - `GET /api/projects/:id/requirements` → `{ requirements: Array<Requirement & { criteria: number; tickets: string[]; evidence: EvidenceState | null; open: number; drifted: boolean }> }`
  - `GET /api/requirements/:id/trace` → `TraceChain`
  - `POST /api/requirements/:id/linear` `{ identifier: string }` → 200 link, 404 `Linear has no ticket <id>.`, 409 `Linear is not connected.`
  - `GET /api/projects/:id/commits/:sha/trace` → `CommitTrace` or 404 `Kryterea has not checked this commit.`
  - `GET /api/projects/:id/connections` → `{ github: { state: "connected" | "off" | "error"; detail: string | null; lastComment: string | null }; linear: same plus { tickets: number }; mcp: { command: string } }`
  - Existing finding and change responses include `projectId`.

- [x] **Step 1: Write failing tests** for each route's success and listed error cases.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [x] **Step 5:** Commit `feat(server): documents, trace, open items and connections over the API`.

### Task 13: Panel screens S1 to S11

**Files:**
- Modify: `packages/web/src/api.ts`, `packages/web/src/main.tsx`, `packages/web/src/pages/Projects.tsx`, `packages/web/src/pages/Project.tsx`, `packages/web/src/pages/Change.tsx`, `packages/web/src/components/FindingItem.tsx`, `packages/web/src/components/ProfessionalCard.tsx`, `packages/web/src/styles.css`
- Create: `packages/web/src/pages/Documents.tsx`, `packages/web/src/pages/DocumentDetail.tsx`, `packages/web/src/pages/Trace.tsx`, `packages/web/src/pages/Requirement.tsx`, `packages/web/src/pages/CommitTrace.tsx`, `packages/web/src/pages/Connections.tsx`, `packages/web/src/components/NeedsYou.tsx`, `packages/web/src/components/TraceChain.tsx`

**Interfaces:**
- Consumes: Task 12 routes exactly as named there.
- Produces: hash routes `#/projects/:id/(needs-you|documents|trace|connections)`, `#/projects/:id/documents/:docId`, `#/projects/:id/commits/:sha`, `#/requirements/:id`.
- Role card practice lines (exact): business analyst `Requirements quality, against the qualities in ISO/IEC/IEEE 29148`; architect `Operations and reliability`; QA `Acceptance evidence`; compliance `NDPA 2023 and card security entries in the pack. Not legal advice.`; product owner `Acceptance and sign off`. Under each: `Pushed back on` (count of its findings open or accepted, linked) and `Accepted by` (name and reason of each accepted risk on its findings).

- [x] **Step 1:** Add the API calls and routes; build S3 Needs you and S9 Connections first (they carry the governance story), then S4, S5, S6, S7, S8, then the S1, S2, S10, S11 changes, each with the states in the Screens table.
- [x] **Step 2:** Run `pnpm -C packages/web build`; expect no type errors.
- [x] **Step 3:** Verify in the browser pane with `COPILOT_FAKE_MODEL=1`: each route renders, empty states show their exact copy, desktop and 375px wide, light and dark. Fix what the pass shows in one batch, confirm once.
- [x] **Step 4:** Commit `feat(web): Needs you, Documents, Trace and Connections`.

### Task 14: Record carries the trace and the disclaimer

**Files:**
- Modify: `packages/core/src/record/record.ts` (`acceptanceRecord`), `packages/core/src/types.ts` (`AcceptanceRecord.trace`), `packages/web/src/pages/Record.tsx`
- Test: `packages/core/test/record.test.ts`

**Interfaces:**
- Produces: `AcceptanceRecord.trace: Array<{ key: string; text: string; criteria: Array<{ text: string; state: EvidenceState | null }>; decisions: Array<{ title: string; status: FindingStatus; by: string; reason: string; at: string }> }>`.

- [x] **Step 1: Write failing test** `it("the acceptance record lists each requirement with its criteria, evidence and decisions")`.
- [x] **Step 2:** FAIL. **Step 3:** Implement; Record page renders a Trace section and the line `Not legal advice. Kryterea advises and records; people decide.` **Step 4:** PASS.
- [x] **Step 5:** Commit `feat: the signed record carries the trace`.

### Task 15: Demo repo gets an AI-written PRD; live run

**Files:**
- Modify: `../demo-merchant-payments/PROMPTS.md`; created by the coding agent: `../demo-merchant-payments/docs/PRD.md`

- [x] **Step 1:** Add prompt 2 to `PROMPTS.md`, exactly: `Write a PRD for this app in docs/PRD.md so my team and clients know what it does and what we plan next. Include monthly subscriptions as the next feature.` Commit `chore: prompt 2`.
- [ ] **Step 2:** Run the coding agent with prompt 2 (same launcher recipe as prompt 1). Commit its output as written, `docs: PRD written by the coding agent from prompt 2`. Never edit it by hand.
- [ ] **Step 3:** In the panel (real model): create the Linear tickets the founder chooses for the PRD's requirements, then link them in S7; run a recheck on the LagosPay project; confirm documents, requirements, gaps, drift, Needs you and the MCP preamble show real results. Linear comments appear; GitHub waits on the public repo approval.
- [ ] **Step 4:** Note the real finding titles for the video script (no planting).

### Task 16: Docs, disclosure and final checks

**Files:**
- Modify: `README.md`, `BUILT_DURING_HACKATHON.md`, `docs/hackathon/video-script.md`, `.env.example` (add `LINEAR_API_KEY=` and keep `GITHUB_TOKEN=`), this plan's checkboxes.

- [x] **Step 1:** README: documents, trace, drift, persistent warnings, connections setup, "Kryterea warns and records; it never blocks". BUILT_DURING: new bullets for each task; reuse list (teams, multiple projects with members, sign-off, Drive and Notion connections from the Kryterea platform) under "What is not ours, or not new". Video script: scenes for PRD gaps, trace, drift on a push, the same warning in agent, GitHub and Linear, confirmed fix, signed record; closing card "Where this sits in Kryterea".
- [ ] **Step 2:** Run `pnpm test` and `pnpm typecheck`; push; confirm CI green on the final commit.
- [x] **Step 3:** Commit `docs: governed trace in README, disclosure and video script`.
