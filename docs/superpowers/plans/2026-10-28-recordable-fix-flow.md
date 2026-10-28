# Recordable fix flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One path a non-expert walks from welcome to signed record, where Kryterea writes every change and Ada only links a repo, types one sentence, answers plain questions and approves.

**Architecture:** The engine stays: one `understand` change per check runs every profession through the existing stages. New core pieces sit on it: plain questions with a safe default, a product owner writer that matches findings to Ada's problem, merges near duplicates and writes proposed changes, and an approve path that parks a `fix` change at `build` for the coding agent. The server adds a check endpoint, a files endpoint and proposal endpoints; the web panel adds welcome, home tabs, a start page and an assessment page in front of the existing pages.

**Tech Stack:** TypeScript, node:sqlite (`CopilotRecord`), Hono server, MCP SDK, Vite React with hash routes, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-recordable-fix-flow-design.md`

## Global Constraints

- Branch: `feat/governed-trace` (design commit 65ba7a6). Do not push or merge without the founder.
- No score, rubric, grade, rating, pass or fail in any copy, prompt output or test name visible to users. `packages/web/test/copy.test.ts` enforces this for web source; keep it green.
- No em dashes, en dashes or spaced hyphens as sentence dashes anywhere, including comments and fixtures.
- Gates read "Held" or "Cleared"; evidence reads "Evidence found", "Gap", "No evidence".
- Legal findings say "Check this", cite only `packs/legal/ndpa-2023.json`, and the page says "Not legal advice".
- No schema migration. New data lives in artifacts (`problem`, `proposed_changes`, `proposal_decision`) and existing tables. Existing `data/` must stay readable.
- All tests run with the fake model (`createFakeModel(packages/core/fixtures)` or stubs). New model calls get a fixture in `packages/core/fixtures/<name>.json`.
- Kryterea never writes to the checked repo.
- Every reused or new piece is listed in `BUILT_DURING_HACKATHON.md` (Task 12).
- Commits: conventional style, each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm test`, `pnpm typecheck`, `pnpm build`. Windows typecheck may show phantom module errors; CI on Linux is the truth.

## Review Focus

1. **Old records.** A `questions` artifact written before this change has no `options`; the change view and answer form must still work (plain text answer). Test in Task 2.
2. **Writer cites unknown finding ids.** `po.writeChanges` may return ids that are not open findings of the change; they are dropped, and a proposal left with no findings is dropped. Test in Task 3.
3. **Approving twice.** A second approve of the same proposal returns the existing fix change, not a second one. Test in Task 4.
4. **Check with an empty sentence.** No `problem` artifact, title "Whole repo check", the assessment has no "Your problem" card. Tests in Tasks 3 and 5.
5. **Repo URL that is not GitHub** (local path when `allowLocalRepos`): auto name falls back to the last path segment. Test in Task 5.

---

### Task 1: Profession catalogue

**Files:**
- Create: `packages/core/src/professions.ts`
- Modify: `packages/core/src/index.ts` (export)
- Modify: `packages/server/src/app.ts` (route)
- Test: `packages/core/test/professions.test.ts`, `packages/server/test/app.test.ts`

**Interfaces:**
- Produces: `interface Profession { role: RoleId; name: string; frameworks: string[]; checks: string; why: string }`, `const PROFESSIONS: Profession[]` (order: ba, architect, qa, compliance, po), `GET /api/professions` → `{ professions: Profession[] }`.

Values (copy verbatim):

| role | name | frameworks | checks | why |
|---|---|---|---|---|
| ba | Business analyst | ISO/IEC/IEEE 29148 requirement quality | What the app does against what was agreed in the PRD and specs | Reads what was agreed and what the code does |
| architect | Architect | Operations and failure recovery | How the app runs, recovers and settles payments | Payments must settle even when a step breaks |
| qa | QA | Failure paths | Every step that can fail, repeat or be reversed | Refunds, retries and double clicks are failure paths |
| compliance | Security and compliance | NDPA 2023, card handling | Personal data, consent and card data | The app collects personal data and takes cards |
| po | Product owner | Acceptance and sign off | Whether the change is ready to accept | Someone has to sign for what ships |

- [ ] **Step 1: Write the failing tests**

```ts
// professions.test.ts
it("lists five professions in workflow order, each with a framework", () => {
  expect(PROFESSIONS.map((p) => p.role)).toEqual(["ba", "architect", "qa", "compliance", "po"]);
  for (const p of PROFESSIONS) expect(p.frameworks.length).toBeGreaterThan(0);
  expect(PROFESSIONS.find((p) => p.role === "compliance")!.frameworks).toContain("NDPA 2023");
});
// app.test.ts
it("GET /api/professions lists the catalogue", async () => {
  const { call } = setup();
  const r = await call("GET", "/api/professions");
  expect(r.status).toBe(200);
  expect(r.body.professions).toHaveLength(5);
});
```

- [ ] **Step 2:** `pnpm vitest run packages/core/test/professions.test.ts` → FAIL, `PROFESSIONS` not exported.
- [ ] **Step 3:** Implement the constant and the route.
- [ ] **Step 4:** Both tests PASS.
- [ ] **Step 5:** Commit `feat(core): profession catalogue for templates and scope`.

### Task 2: Plain questions with a safe default; understand runs do not pause

**Files:**
- Modify: `packages/core/src/roles/context.ts` (`RoleResult`)
- Modify: `packages/core/src/roles/ba.ts` (`understandApp` schema and prompt)
- Modify: `packages/core/src/workflow.ts` (`save`, `openQuestions`, new `questionOptions`, `analysis` stage)
- Modify: `packages/core/fixtures/ba.understandApp.json`
- Modify: `packages/server/src/app.ts` (`POST /api/changes/:id/answers`, `GET /api/changes/:id`)
- Test: `packages/core/test/ba.test.ts`, `packages/core/test/workflow.test.ts`, `packages/server/test/app.test.ts`

**Interfaces:**
- Produces: `RoleResult.questionOptions?: Array<{ options: string[]; defaultIndex: number }>` (same length as `questions` when present). `questions` artifact body becomes `{ questions: string[]; options?: string[][]; defaults?: number[] }`. `export function questionOptions(record, changeId): Array<{ options: string[]; defaultIndex: number } | null>` aligned with `openQuestions`. `answers` artifact body becomes `{ answers: string[]; assumed?: boolean[]; actor?: string }`. Change view gains `questionOptions`.
- `POST /api/changes/:id/answers` body: `{ answers: string[]; assumed?: boolean[]; actor?: string }`. `assumed[i]` true means the person chose "I don't know" and `answers[i]` is the default option text (the client sends it).

Prompt change for `understandApp`: questions are written for an app owner who is not a professional, each starts from something seen in the code, each has 2 or 3 short answers, and `defaultIndex` names the safe answer (the one that protects customers and money). Schema item: `obj({ question: str, options: strArr, defaultIndex: { type: "integer" } })`. Map to `questions: string[]` plus `questionOptions`; clamp `defaultIndex` into range; drop a question with fewer than 2 options.

Analysis stage: for `c.kind === "understand"`, record the BA gate as today but do not `stay`; run `analyseChange` and continue. Other kinds keep pausing.

- [ ] **Step 1: Write the failing tests**
  - ba.test.ts `understandApp keeps options and a safe default for each question`: stub returns `questions: [{ question: "Q", options: ["A","B"], defaultIndex: 1 }, { question: "Bad", options: ["only"], defaultIndex: 0 }]` → result `questions` `["Q"]`, `questionOptions` `[{ options: ["A","B"], defaultIndex: 1 }]`.
  - workflow.test.ts `an understand change moves past analysis with questions open`: advance an understand change whose fixture asks one question → stage is past `analysis` (reaches `release`), BA gate `held`, `openQuestions` length 1.
  - workflow.test.ts `questionOptions reads old questions artifacts as null`: add a `questions` artifact `{ questions: ["Q"] }` → `questionOptions` is `[null]`.
  - app.test.ts `answers keep the assumed flag and the actor`: post `{ answers: ["B"], assumed: [true], actor: "Ada" }` → artifact body equals that object; `assumed` of wrong length → 400.
- [ ] **Step 2:** Run them → FAIL on the missing field and on stage `analysis`.
- [ ] **Step 3:** Implement; update the fixture so its questions use the new item shape with plain owner wording.
- [ ] **Step 4:** `pnpm test` → all PASS (the existing "analysis does not move on while BA questions are unanswered" test still passes for its feature change).
- [ ] **Step 5:** Commit `feat(core): plain questions with a safe default; understand runs keep going`.

### Task 3: Product owner writes the changes

**Files:**
- Create: `packages/core/src/roles/po-writer.ts`
- Modify: `packages/core/src/workflow.ts` (`release` stage for understand changes; `startCheck`)
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/fixtures/po.writeChanges.json`
- Test: `packages/core/test/po-writer.test.ts`, `packages/core/test/workflow.test.ts`

**Interfaces:**
- Produces:
  - `interface ProposedChange { title: string; forWhom: string; why: string; findingIds: string[]; criteria: Array<{ text: string; isFailurePath: boolean }> }`
  - `interface Proposals { answersProblem: string[]; duplicates: string[][]; changes: ProposedChange[] }`
  - `async function writeChanges(input: { problem: string | null; findings: Array<{ id: string; role: RoleId; title: string; plain: string; where: string }> }, model: Model, pack: string): Promise<Proposals>` (model call name `po.writeChanges`)
  - `function startCheck(record, i: { projectId: string; problem: string | null }): Change` creates the `understand` change. Title: `Check: ${problem}` cut to 200 chars, or `Whole repo check`. Description: the problem sentence followed by `Then check the whole repo.`, or `Check the whole repo.`. Adds a `problem` artifact `{ text }` (role `po`, stage `intake`) only when a problem is given.
  - `function problemOf(record, changeId): string | null`
  - `function proposalsOf(record, changeId): Proposals | null` (latest `proposed_changes` artifact)
- Writer rules (prompt): titles say what will be true for the customer; `forWhom` names who is affected; `why` is one plain sentence on the cost; every open finding lands in exactly one change; near duplicates (same problem, different words) go in one `duplicates` group and the same change; 1 to 5 changes; `answersProblem` lists the findings that explain the problem, empty when there is no problem.
- Sanitise after the call: drop ids not in the input; drop changes left with no findings; a finding missing from every change gets its own change titled with the finding title.
- Workflow: at `release` for an `understand` change, before `releaseHeld`, if `proposalsOf` is null and the change has open findings, run the writer inside `runRole(s, c, "po", ...)` and save the `proposed_changes` artifact. A budget stop leaves it for the next advance.

- [ ] **Step 1: Write the failing tests**
  - po-writer.test.ts `drops unknown ids and empty changes`: input finding ids `f1`, `f2`; stub returns a change with `["F1","F9"]` and one with `["F9"]` → first change has `["f1"]`, the `F9` only change is gone.
  - `gives a finding the writer left out its own change`: input f1, f2; stub covers f1 only → second change has `findingIds ["f2"]` and title of f2.
  - `sends the problem and every finding to the model`: stub captures the request; user text contains the problem sentence and both ids.
  - workflow.test.ts `startCheck with a sentence stores the problem and titles the change`: `problemOf` returns the sentence; title starts `Check: `.
  - workflow.test.ts `startCheck with no sentence is a whole repo check`: title `Whole repo check`, `problemOf` null.
  - workflow.test.ts `an understand change gets proposed changes at release`: advance with fixtures → `proposalsOf` not null and its ids are open findings of the change.
- [ ] **Step 2:** Run → FAIL, module missing.
- [ ] **Step 3:** Implement the writer. Finding ids are generated, so the model never sees them: the prompt lists findings as labels `F1`, `F2`, ... in input order, the schema returns labels, and the writer maps labels back to ids (an unknown label is an unknown id and is dropped). The fixture `po.writeChanges.json` uses labels: `answersProblem: ["F1"]`, `duplicates: []`, two changes over `F1` and `F2`, so the fake flow shows a problem card end to end. Tests in Step 1 use labels in the stub output and assert on the mapped ids.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat(core): the product owner writes the changes from the findings`.

### Task 4: Approve a proposal, or accept its risk

**Files:**
- Modify: `packages/core/src/workflow.ts` (generalise `openFixChange`; add `approveProposal`, `acceptProposalRisk`, `proposalDecisions`)
- Test: `packages/core/test/workflow.test.ts`

**Interfaces:**
- Consumes: `proposalsOf` (Task 3).
- Produces:
  - `function linkFixChange(record, from: Change, fix: Change, findings: Finding[]): void` holding the linking body of today's `openFixChange` (raised_on links, criterion affects links, `fix_change` and `follows` artifacts). `openFixChange` calls it, behaviour unchanged.
  - `function approveProposal(record, changeId: string, index: number, actor: string): Change` creates a `fix` change with the proposal's title and a description built from `forWhom`, `why` and the finding titles, sets its stage to `build`, adds each criterion as a `Criterion` row on the fix change linked `satisfies`, calls `linkFixChange`, and writes a `proposal_decision` artifact `{ index, decision: "approved", actor, fixChangeId }` on the understand change. Approving an already approved index returns the existing fix change.
  - `function acceptProposalRisk(record, changeId: string, index: number, actor: string, reason: string): void` sets each still open finding of the proposal to `accepted_risk` with the reason and actor, and writes `{ index, decision: "accepted_risk", actor, reason }`.
  - `function proposalDecisions(record, changeId): Array<{ index: number; decision: "approved" | "accepted_risk"; actor: string; reason?: string; fixChangeId?: string }>`
- Errors: unknown index or change without proposals throws `Error("No such proposed change")`; empty actor or (for risk) empty reason throws.

- [ ] **Step 1: Write the failing tests**
  - `approving a proposal parks a fix change at build with its criteria`: stage `build`, kind `fix`, `criteriaOf(fix)` texts equal the proposal's, each finding linked `raised_on` the fix change.
  - `approving twice returns the same fix change`: second call returns the same id and `listChanges` grows by one only.
  - `accepting the risk closes the proposal's findings under the actor`: each finding `accepted_risk`, history actor `Ada`.
  - `openFixChange still carries a delivered change's findings` (existing test stays green).
  - `recheck moves an approved fix change to verification`: after approve, a recheck with a new commit leaves the fix change at `verification` or later.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat(core): approve a written change for the coding agent, or accept its risk`.

### Task 5: Server: auto named project, files picked up, check, proposals

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/app.test.ts`

**Interfaces:**
- Consumes: `startCheck`, `problemOf`, `proposalsOf`, `approveProposal`, `acceptProposalRisk`, `proposalDecisions`, `questionOptions`, `PROFESSIONS`.
- Produces:
  - `POST /api/projects`: `name` optional. When missing, `nameFromRepo(repoUrl)`: GitHub repo name, or last path segment, with `-` and `_` turned into spaces and the first letter upper cased (`demo-merchant-payments` → `Demo merchant payments`). Export `nameFromRepo` for tests.
  - `GET /api/projects/:id/files` → `{ commit: string; groups: Array<{ kind: "code" | "documents" | "config" | "tests" | "skipped"; files: string[] }>; documents: Array<{ path: string; lines: number }> }`. Syncs the repo (same `syncRepo` call the workflow uses, cached), lists with `listSourceFiles`, documents via `discoverDocuments` with the project's doc settings. Classify: tests by `test`/`spec` in the path; config by file name (`package.json`, `*.config.*`, `.env.example`, `*.yml`, `*.yaml`, `*.toml`, `Dockerfile`); documents from `discoverDocuments`; skipped is files over the size limit; the rest code. No model call.
  - `POST /api/projects/:id/check` body `{ problem?: string }` (max 500 chars) → 202 `{ changeId, jobId }`; creates the change with `startCheck` and starts the advance job used by `/advance`.
  - `GET /api/changes/:id` gains `problem`, `questionOptions`, `proposals`, `decisions`.
  - `POST /api/changes/:id/proposals/:index/approve` `{ actor }` → 201 fix change.
  - `POST /api/changes/:id/proposals/:index/accept-risk` `{ actor, reason }` → 200.
- [ ] **Step 1: Write the failing tests**
  - `creates a project named from the repo`: post `{ repoUrl: "https://github.com/kryterea/demo-merchant-payments" }` → name `Demo merchant payments`.
  - `names a local repo from its folder` (allowLocalRepos): last segment.
  - `lists the files picked up, grouped`: local fixture repo with `src/a.js`, `docs/PRD.md`, `package.json`, `test/a.test.js` → each in its group; documents has `docs/PRD.md` with its line count.
  - `check starts an understand change with the problem`: 202, change kind `understand`, view `problem` equals the sentence.
  - `check with no problem is a whole repo check`.
  - `approve and accept-risk go through`: 400 on missing actor; 404 on unknown index.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Commit `feat(server): named projects, files picked up, check and proposal routes`.

### Task 6: MCP lists approved changes

**Files:**
- Modify: `packages/mcp/src/tools.ts`
- Test: the existing MCP tools test file (create `packages/mcp/test/tools.test.ts` if none covers tools)

**Interfaces:**
- Produces: tool `list_changes`: no input; returns the project's `fix` changes that are not withdrawn and not at `operate`, each `{ id, title, stage, findingIds }` where `findingIds` are findings linked `raised_on` the change. Uses the existing server API (`GET /api/projects/:id` plus `GET /api/changes/:id`) the other tools call. Tool description tells the agent to start here, then `get_change`, fix on a branch, `report_fix` per finding, `request_recheck`.
- [ ] **Step 1:** Failing test `list_changes returns approved fix changes with their findings` against a stubbed fetch.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(mcp): list_changes so the agent starts from the approved change`.

### Task 7: Web: welcome, home tabs, templates, guides

**Files:**
- Create: `packages/web/src/pages/Welcome.tsx`, `packages/web/src/pages/Templates.tsx`, `packages/web/src/pages/Guides.tsx`, `packages/web/src/me.ts`
- Modify: `packages/web/src/main.tsx` (routes, top tabs), `packages/web/src/api.ts` (`professions`), `packages/web/src/styles.css`

**Interfaces:**
- Produces: `me.ts`: `getName(): string | null`, `setName(name: string): void` over `localStorage` key `kryterea.name`, both wrapped in try/catch (null when storage throws). Routes: `#/welcome`, `#/templates`, `#/guides`; `#/` shows Projects. Top tabs: Projects, Templates, Guides. With no name and no projects, `#/` redirects to `#/welcome`.
- Welcome copy: heading `Kryterea fixes product problems`, line `Link your repo. Tell us what is wrong, or let us check everything. Professionals find the problems, your coding agent fixes them, and you sign for the result.`, field `Your name` (used on the record), button `Start`. No Build option.
- Templates: one card per `PROFESSIONS` entry: name, frameworks as tags, checks. Footer line: `Each professional works from a pack in this repo.`
- Guides: one page `How Kryterea fixes a product problem`, four sections: Take (link your repo, Kryterea reads it), Detect (say what is wrong; the right professionals check), Find and solve (every problem, where, why, the fix; release Held until each is fixed or accepted), Fix and prove (your coding agent fixes over MCP; Kryterea checks again and shows before and after).
- [ ] **Step 1:** `pnpm vitest run packages/web/test/copy.test.ts` stays green after writing the pages (the guard is this task's automated test).
- [ ] **Step 2:** `pnpm --filter web build` succeeds.
- [ ] **Step 3:** Browser check with `COPILOT_FAKE_MODEL=1`: fresh storage lands on Welcome; Start lands on Projects; tabs switch.
- [ ] **Step 4:** Commit `feat(web): welcome, templates and guides`.

### Task 8: Web: new project from a repo, files picked up, scope

**Files:**
- Create: `packages/web/src/pages/Start.tsx`
- Modify: `packages/web/src/pages/Projects.tsx` (form keeps only the repo URL), `packages/web/src/main.tsx` (route `#/projects/:id/start`), `packages/web/src/api.ts` (`files`, `check`; `createProject` name optional)

**Interfaces:**
- Consumes: `GET /api/projects/:id/files`, `POST /api/projects/:id/check`, `GET /api/professions`.
- Projects form: one field `GitHub repo`, a live line under it `Project name: <nameFromRepo preview>` (same rule as the server, duplicated in the client as a 3 line function), button `Link repo`; on success go to `#/projects/:id/start`. App URL moves out of this form.
- Start page, top to bottom: `Files picked up` with the groups and counts, documents listed with line counts (loading state `Reading the repo`); then `What is wrong?` single line input, placeholder `Describe the problem in your own words, or leave it empty to check the whole repo.`; then `Who should look?` with `Auto (recommended)` selected and, under it, one row per profession: name and `why`; button `Check` → `#/changes/:changeId/assessment`.
- [ ] **Step 1:** Copy guard green. **Step 2:** Build succeeds.
- [ ] **Step 3:** Browser check (fake model, local fixture repo): linking shows the auto name; Start lists groups; Check navigates.
- [ ] **Step 4:** Commit `feat(web): link a repo, see what was read, say what is wrong`.

### Task 9: Web: assessment page

**Files:**
- Create: `packages/web/src/pages/Assessment.tsx`
- Modify: `packages/web/src/main.tsx` (route `#/changes/:id/assessment`), `packages/web/src/api.ts` (view fields, `approveProposal`, `acceptProposalRisk`, `answer` with `assumed` and `actor`), `packages/web/src/styles.css`

**Interfaces:**
- Consumes: change view (`problem`, `questionOptions`, `proposals`, `decisions`, `gates`, `findings`, `runs`), job polling via `api.job`.
- Sections:
  1. **While running:** one row per profession: name, first framework, state from the change's runs (`Waiting` with no run, `Reading` while running, `Found N` from its findings, `Done`). Poll every 2 s until the job ends.
  2. **Header:** `You asked: "<problem>"` (absent with no problem), the release stamp (`Held` with the roles holding, or `Cleared`), one line `Checked by <names>.`
  3. **Questions** (one at a time, only open ones): question text, option buttons, `I don't know`. Choosing `I don't know` sends the default option text with `assumed: true` and shows `Kryterea will assume: <default>`. Old questions with no options get a text field.
  4. **Your problem:** one large card per finding in `proposals.answersProblem`: profession, title, Where, Why it matters (`plain`), Cost if ignored, The fix (`fixPrompt`). Reuse `FindingItem` if it renders these fields; otherwise extend it.
  5. **Also found:** heading `While checking, we found N more you did not ask about` (or `We found N problems` with no problem). One row per finding not in `answersProblem`, near duplicates from `proposals.duplicates` shown once with `+1 similar`. A row expands to the full card.
  6. **Changes Kryterea wrote:** one card per proposal: title, For whom, Why, findings it closes, criteria. Buttons `Approve` and `Accept the risk` (asks for a reason). After a decision the card shows `Approved by Ada` with a link to the fix change, or `Risk accepted by Ada: <reason>`. A small link `Add your own change` opens the existing change form.
- [ ] **Step 1:** Copy guard green. **Step 2:** Build succeeds.
- [ ] **Step 3:** Browser check with fake model through a full check: running rows update, questions answer with and without `I don't know`, Approve creates a fix change at `build`, Accept the risk needs a reason. Desktop and phone width.
- [ ] **Step 4:** Commit `feat(web): assessment page: her problem first, the rest, the changes written for her`.

### Task 10: Problem first in before and after, and in the record

**Files:**
- Modify: `packages/web/src/pages/Compare.tsx`, `packages/web/src/pages/Record.tsx`, `packages/core/src/record/record.ts` (`acceptanceRecord`), `packages/core/src/types.ts` (`AcceptanceRecord`)
- Test: `packages/core/test/record.test.ts`

**Interfaces:**
- `AcceptanceRecord` gains `problem: string | null`, `answers: Array<{ question: string; answer: string; assumed: boolean; actor: string | null }>`, `decisions` (shape of `proposalDecisions`). For a fix change these come from the change it follows.
- Compare: when the project's latest understand change has `answersProblem`, those findings show first under `Your problem`, closed or still open.
- Record: shows `Problem`, then answers (`Assumed: <answer>, by <actor>` when assumed), then decisions.
- [ ] **Step 1:** Failing test `the record carries the problem, assumed answers and decisions`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `pnpm test` PASS, copy guard green, build succeeds.
- [ ] **Step 5:** Commit `feat: the record and before and after start from her problem`.

### Task 11: Manual profession pick (last; not in the recording)

**Files:**
- Modify: `packages/core/src/workflow.ts` (`startCheck` takes `roles?: RoleId[]`, stored on the `problem` artifact or a `scope` artifact; `runRole` callers skip roles not picked; `releaseHeld` adds a held gate `Not checked` for each skipped role in `ba`, `architect`, `qa`, `compliance`)
- Modify: `packages/server/src/app.ts` (`roles` on `/check`), `packages/web/src/pages/Start.tsx` (pick list under Auto)
- Test: `packages/core/test/workflow.test.ts`

- [ ] **Step 1:** Failing tests `a skipped profession does not run` (no run for that role) and `release stays Held while a profession is not checked` (held roles include it, reason `Not checked`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `pnpm test` PASS, build succeeds.
- [ ] **Step 5:** Commit `feat: pick professions by hand; unpicked ones show Not checked`.

### Task 12: Docs, disclosure and a full fake run

**Files:**
- Modify: `BUILT_DURING_HACKATHON.md`, `README.md` (the flow in four acts, the new MCP tool), the video script if it lives in the repo (only the shape; `[from the run]` lines stay for the live run)

- [ ] **Step 1:** List every new piece from Tasks 1 to 11 under what was built this week.
- [ ] **Step 2:** `pnpm test`, `pnpm typecheck`, `pnpm build` all succeed; note any Windows phantom errors for CI.
- [ ] **Step 3:** Full browser walk with `COPILOT_FAKE_MODEL=1` and a fresh `COPILOT_DATA_DIR`: welcome, home, link, files, check, assessment, answer, approve, MCP `list_changes` via the server API, record. Screenshot each step.
- [ ] **Step 4:** Commit `docs: the recordable fix flow`.

## After the plan

Task 15 of the hackathon plan (the live run) is redone on this flow with real spend, per the design's "After the build" section. That needs the founder at the keyboard and is not part of this plan.
