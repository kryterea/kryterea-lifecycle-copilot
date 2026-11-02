# Recordable fix flow: design

Date: 2026-10-28. Status: draft for founder review. Builds on `2026-10-26-lifecycle-copilot-design.md` and `2026-10-27-governed-trace-design.md`.

## Intent

The panel today asks the person to do the professional's job. To start any work you write a change title and "What should change, for whom, and why". Kryterea is supposed to answer those questions, not ask them.

This design turns the panel into one flow a non-expert can walk through from start to finish, and that the founder can screen-record as the 3-minute submission video. The person is Ada: she owns a payments app her coding agent built, she is not a business analyst, architect, QA lead or compliance officer, and she does not know what to ask for. She knows one symptom ("customers say refunds never arrive").

Kryterea takes her repo, detects and finds the problems, applies each profession's framework, gives the solution, hands the fix to her coding agent, and shows the problem next to the result.

## The story the video tells

Four acts, in this order. Times are a target for the 3-minute cut, which may jump over waits with a visible cut (founder: "it can jump, the goal is to show how the system works"). Every frame after a jump is real output from a real run on Muse Spark.

| Time | Act | Steps |
|---|---|---|
| 0:00 to 0:12 | Hook | Ada's agent shipped her app; nobody checked it against what she agreed. |
| 0:12 to 0:35 | Take | 01 Welcome, 02 Workspace home, 03 New project from repo, 04 Files picked up |
| 0:35 to 1:05 | Detect | 05 Scope, 06 Professionals at work, 07 Questions in plain words |
| 1:05 to 1:50 | Find and solve | 08 Assessment, 09 Governance, 10 Changes written for her |
| 1:50 to 2:35 | Fix and prove | 11 Agent fixes over MCP, 12 Before and after |
| 2:35 to 3:00 | Close | 13 Signed record, close card |

The thing a judge must not miss (my call, founder unsure): Ada's own problem, answered with the standard behind it, and Release Held.

## Goals

1. Ada never writes a change title, description, acceptance criterion or "for whom and why". Kryterea writes them; she approves.
2. One continuous path from welcome to signed record, with no dead ends and no form beyond the repo link, one sentence of problem, and answers to questions.
3. She can state a specific problem and still get the whole repo checked, in the same run (founder: "we can do both to show our strength").
4. Each profession is visible as a professional working to a named framework, not as a background job.
5. Questions are answerable by a non-expert, and "I don't know" moves her forward.

## Non-goals

- **Build path.** Onboarding offers only "fix a product problem". No Build option appears anywhere (founder: "no need since we are not demonstrating it").
- **Kryterea platform features.** Templates and Guides carry only what this hackathon project solves (founder: "just what the hackathon project solves"). No other workspace tabs. Nothing that exists only in kryterea-app is shown.
- **A fast or replay mode for the video.** Cuts cover the waits. `pnpm demo` stays as it is for judges who want to replay.
- **Accounts, sign-in, teams.** Ada's name is typed once at welcome and used for the record.

## Anti-goals

These would make the work a failure even if every screen works.

- A finding, problem or question planted in the demo app, or a scripted sentence for Ada that the real run does not answer. Her problem sentence is chosen after a real run shows the refund finding.
- Hand-edited model output on screen.
- Any score, rubric, grade, rating, pass or fail word. Evidence: "Evidence found", "Gap", "No evidence". Gates: "Held", "Cleared".
- Legal findings that say anything stronger than "Check this", or cite anything outside `packs/legal/ndpa-2023.json`. Not legal advice.
- Questions written for professionals ("What is the idempotency strategy for refund webhooks?").
- The panel reading as a replica of the Kryterea platform rather than this entry.

## Constraints

- All of `CLAUDE.md` hard rules apply, in particular: no em dashes, en dashes or spaced hyphens as sentence dashes in any copy; the repo is public; spend capped by `COPILOT_BUDGET_USD` (70); `COPILOT_FAKE_MODEL=1` for UI work and tests.
- Kryterea never writes to the repo it checks. The coding agent does, on a branch with a PR.
- Re-checks read the remote default branch, so a fix is re-checked after merge (existing behaviour, keep).
- Build on the current branch `feat/governed-trace` and its record schema. Existing pages (Change, Record, Compare, Trace, Documents, Connections) stay reachable; the new flow sits in front of them.
- Every new thing lands in `BUILT_DURING_HACKATHON.md`.

## The flow, step by step

Each step says what Ada sees, what she does, and what Kryterea does. "Decided" is the founder's, or follows directly from their words. "Builder's call" is open.

### 01 Welcome

One screen on first open (no project yet). Line: Kryterea fixes product problems. One field: her name, used on the record. One button: Start. No Build option.

Builder's call: where the name is stored (project settings or a workspace row) and whether the welcome shows again once a project exists (my call: never again).

### 02 Workspace home

Three tabs: **Projects** (live, where the whole recording happens), **Templates**, **Guides**.

- **Templates** list the professional packs this entry ships: Business analyst, Architect, QA, Security and compliance, Product owner. Each card names the profession, the framework it works to (ISO/IEC/IEEE 29148 requirement quality, NDPA 2023 via the legal pack, card handling, failure paths, operations), and what it checks, read from `packs/*.md` and `packs/legal/ndpa-2023.json`. Read only.
- **Guides** hold one page, "How Kryterea fixes a product problem", walking the four acts. Static.

My call: the frameworks named on each card come from a short list kept next to the packs, not parsed from the pack prose.

### 03 New project from a repo

Ada pastes or picks her GitHub repo. No name field: the project is named from the repo (founder). App URL becomes optional and moves to project settings.

Decided: project name comes from the repo. Builder's call: whether to offer a picker of her repos (needs the GitHub token to list them) or only a URL field that fills the name live from `parseGithubRepo` and the GitHub repo API (name, description). My call: URL field with live name, picker only if cheap.

### 04 Files picked up

Right after linking, Kryterea syncs the repo and shows what it read, grouped: product code, documents (PRD, specs under `docs/`), config, tests, skipped. Each document says what it is ("PRD, 144 lines, 8 requirements found"). This replaces the "Documents not read yet" state for new projects: documents are read at link time, not first run.

Builder's call: whether requirements are extracted at link time (a model call) or just listed and extracted when the run starts. My call: list at link time without a model call, extract when the run starts, so linking stays instant and free.

### 05 Scope

One screen, two parts.

1. **What is wrong?** A single line: "Describe the problem in your own words, or leave it empty to check the whole repo." Either way the whole repo is checked; a stated problem is answered first (founder: both).
2. **Who should look?** **Auto (recommended)** selected, or pick any of the five professions. Under Auto, before the run, Kryterea shows who it picked and one line of why each.

Pressing Check starts one `understand` change, created by Kryterea. Title and description are written by Kryterea from her sentence (or "Whole repo check" with none). Her sentence is stored verbatim as the change's problem statement.

Builder's call: how Auto picks. Options are a cheap model call over her sentence plus the files picked up, or a deterministic rule (all five for a whole repo check; for a problem, the professions whose pack keywords match plus BA always). My call: all five run for the whole repo part regardless; Auto only orders them and writes the why line, so nothing is missed and no extra call is needed beyond one short one. A manual pick limits which professions run.

### 06 Professionals at work

While the run goes, one row per profession: name, the framework it is applying, and its state (Waiting, Reading, Found 3, Done). Live from the existing runs and jobs.

### 07 Questions in plain words

When the BA has questions, they appear one at a time. Each question:

- is written for an app owner, starting from what Kryterea saw in her code;
- has two or three plain answers plus **I don't know**.

"I don't know" means Kryterea takes the safe default it names on screen, and records it as an assumption under Ada's name. It never blocks the run.

This changes the question shape from `string[]` to structured questions with options and a stated safe default. The BA prompt must produce them. Existing answer flow (`/api/changes/:id/answers`, `openQuestions`) is extended, not replaced.

### 08 Assessment

The heart. Layout (mockup accepted for direction, finding wording comes from the run):

1. Her words at the top: "You asked: ..." with the **Release Held** stamp, and one line of which professionals checked and why.
2. **Her problem, answered.** One large card for the finding (or findings) that answer her sentence: who raised it, what is wrong, where (code line, PRD line), the standard behind it, cost if ignored, the fix.
3. **"While checking, we found N more you did not ask about."** One row per finding: profession, plain title, where. A row opens the same full card.
4. Two actions: see the changes Kryterea wrote; answer the open question (if any).

With no problem stated, part 2 is absent and part 3 reads "We found N problems".

Kryterea decides which findings answer her problem. Builder's call: a field the model sets on each finding during the run (it has her sentence in context) or a short follow-up call. My call: in the run, so no extra call.

Near-duplicate findings (seen on a real run: "Abandoned checkout stays pending forever" and "Abandoned payments stay pending forever") must not both appear as separate rows. Builder's call on how: dedupe during the run against already-raised findings, or group at display. Both findings stay in the record either way.

### 09 Governance

The release verdict (Held or Cleared, and which professions hold) shows on the assessment page itself, since the video has no seconds for another page. The existing gate detail stays one click away. Each problem ends one of two ways: fixed and confirmed by re-check, or accepted with a reason by a named person. Unchanged rules.

### 10 Changes written for her

Kryterea groups the open findings into changes and writes each one: title, who it affects, why it matters, which findings it closes, and acceptance criteria. Near-duplicates land in the same change. Ada sees a short list and does one of:

- **Approve**: the change is created as a `fix` change with its findings and criteria linked, and becomes available to her coding agent over MCP.
- **Accept the risk**: she gives a reason; her name and reason go on the record for each finding in it.

The "What should change, for whom, and why" form leaves the main path. It survives as a small "Add your own change" link for people who know what they want.

Builder's call: grouping by a model call (likely; it writes the titles and the why) with a deterministic fallback by file. Reuse the linking done by `openFixChange`, generalised so it does not require a delivered change.

### 11 Agent fixes over MCP

Unchanged in shape. Ada's coding agent (OpenCode on Muse Spark in the recording) uses the existing tools `list_findings`, `get_finding`, `get_change`, `report_fix`, `request_recheck`. It fixes on a branch, opens a PR, reports back. The panel shows the reports arriving on the change.

Builder's call: whether MCP needs a tool that lists approved changes, so the agent starts from the change rather than from findings. My call: add `list_changes` (approved and open) if `list_findings` alone makes the agent's first step unclear.

### 12 Before and after

Existing compare view, reached from the change after re-check: what closed, what is new, what still holds, between the `before` and `after` commits. Ada's problem card shows first, closed or still open.

### 13 Signed record

Existing record. Adds: Ada's problem sentence, her answers including each "I don't know" with the default taken, and the changes she approved or accepted. Drift on a later push remains possible as a closing beat but is not in the 3-minute cut.

## What exists and what is new

| Step | State today |
|---|---|
| 01 Welcome, 02 Home, 03 Auto-named project, 04 Files picked up | New |
| 05 Scope (problem sentence, Auto) | New; runs on the existing `understand` change |
| 06 Professionals at work | Mostly exists (runs, jobs); needs the live per-profession view |
| 07 Plain questions with "I don't know" | Wrong shape today; question schema and BA prompt change |
| 08 Assessment | New page over existing findings; adds "answers her problem" and dedupe |
| 09 Governance | Exists; surfaced on the assessment page |
| 10 Changes written for her | New; replaces the manual change form in the main path |
| 11, 12, 13 | Exist; small additions to the record and maybe one MCP tool |

## Settled after the builder check

These are my calls, not the founder's. Each can change without changing what the video shows.

1. **Which verdict the assessment shows.** The verdict of the one `understand` change the scope step created. Its findings stay raised on it; a fix change links them, and when re-check marks them fixed (or Ada accepts them) that change's release gates recompute and the stamp turns Cleared. No findings move between changes.
2. **What an approved fix change does.** It is parked, not run. It is created at the `build` stage (skipping intake, analysis and design review, which already happened on the `understand` change), waits for the agent, and `recheck` moves it to verification as today. No new model spend or questions after Ada approves.
3. **Questions never pause the run.** The professionals keep working while a question waits. The assessment shows as soon as the run is done, with "Answer 1 question" on it. The BA gate treats an unanswered question as open, an answered one (including "I don't know") as settled.
4. **"N more" counts** the open findings of that `understand` change, minus the ones that answer her problem, after dedupe.
5. **Manual profession pick** is built last and is not in the recording. A profession that did not run shows "Not checked", and Release cannot show Cleared while any profession is Not checked.
6. **Fix change criteria** are real `Criterion` rows on the fix change, written by the change writer, checked by QA on re-check through the existing evidence path. Findings keep no `criterionId`, so `confirmReportedFixes` still confirms code findings.
7. **The problem sentence** is stored as an artifact of a new kind (`problem`) on the `understand` change. No schema migration; existing `data/` stays readable.
8. **The safe default** is always one of the listed answers, marked as the default by the BA prompt. "I don't know" saves that answer with `assumed: true` and the person's name in the existing answers artifact; the record shows it as "Assumed: ..., by Ada".

## Left to the builder

All the "Builder's call" items above, plus: routes and page names, copy within the rules, how progress updates (polling the existing jobs endpoint is fine), and test shape. Tests run on `COPILOT_FAKE_MODEL=1`; the fake model must produce structured questions, an "answers the problem" mark and change groupings so the flow is testable end to end without spend.

## After the build

The paused Task 15 live run is redone on this flow: fresh `data/demo-live`, real run on `kryterea/demo-merchant-payments` at tag `before`, Ada's sentence chosen from what the run finds, agent fix on a branch with a PR, merge, re-check, tag `after`, `pnpm demo:export`, then the video script's lines filled from that run.
