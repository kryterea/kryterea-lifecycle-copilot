# Governed trace: documents, drift and persistent warnings

Date: 2026-10-27. Status: draft for founder approval. Extends `2026-10-26-lifecycle-copilot-design.md`; everything there still holds unless this document changes it.

## Why

AI now writes the PRD, the spec and the code. Nobody checks that the PRD is complete, that the spec still matches it, that the tickets match both, or that the code does what any of them say. Work drifts and slips between stages, and no one can show a client or an auditor who decided what.

Kryterea is the professional team on the project (business analyst, architect, QA, compliance, product owner). It reads the documents and the code, checks them against each other on every change, links everything into one trace, and keeps warning until each gap is closed or a named person accepts it. It governs by keeping the record and the warnings, not by blocking anyone.

Founder's words to keep: "a copilot throughout the lifecycle ensuring drifts and slips do not happen"; "Kryterea needs to be the one governing"; "not stop things but persistent warnings"; present it "professionally and legally".

## Who

- Builders (solo or small teams with a coding agent): PRD and specs live in the repo next to the code.
- Agencies: PRD and specs live in Notion or Google Drive; tickets in Linear; code in GitHub; a coding agent builds.

## Goals

1. **Documents are checked like a professional would.** The BA reads the project's PRD and specs and raises gaps: a missing requirement or failure path, a vague or untestable statement, a contradiction between PRD and spec, a missing compliance or operations need. Compliance and the architect read the same documents for their own areas.
2. **Documents and code are checked against each other, both ways.** A promise in a document that the code does not keep is a gap. Behaviour in the code that no document asked for is raised as "Not in any document" for the owner to confirm or remove.
3. **One trace, Kryterea as the system of record.** Document line → requirement → acceptance criteria → Linear ticket → commit and files → check and evidence → finding → decision with a name and reason → sign-off. It can be followed forward from any document line and backward from any commit. The record export and the printable acceptance record include it.
4. **Drift is caught as it happens.** On every new commit and every change to a tracked document, Kryterea re-checks the links. It warns when: a requirement changed but its criteria did not; code a criterion's evidence rests on changed; a document no longer matches another document; a requirement has no criteria or no evidence; a file behind an accepted risk changed (the acceptance is flagged for review, not silently kept).
5. **Persistent warnings, never blocking.** Open items follow the work into every place people look, and stay until Kryterea confirms the fix or a named person accepts the risk with a reason. An agent saying "fixed" never clears a warning (as today).
   - Coding agent: every MCP tool answer opens with the project's open items (count and the most important few).
   - GitHub: one Kryterea comment per pull request (or per commit pushed straight to the default branch), edited in place as things change, listing open items with a link to the trace. Never a failing status.
   - Linear: one Kryterea comment per linked ticket, edited in place, when its requirement has a gap, drift or no evidence.
   - Panel: a standing "Needs you" list per project.
6. **Professional capacity is visible.** Each role says the practice or standard it works to, why it holds, what it pushed back on, and who accepted what. Decisions carry a name and a reason (as today). Requirement quality is checked against the qualities in ISO/IEC/IEEE 29148 (necessary, unambiguous, verifiable, consistent, complete); this is named as what the work is checked against, never as certification.

## Non-goals

- Blocking merges, pushes or agents.
- Teams, logins, roles, multiple workspaces or sign-up inside the copilot. These exist in the Kryterea platform and are reused as disclosed prior work (see Reuse).
- Notion and Google Drive connectors inside the copilot. The agency path in this build is uploading or pasting a document (Markdown or text); the Kryterea platform's Drive and Notion connections are disclosed prior work.
- Creating or editing Linear tickets. Kryterea links to them and comments on them only.
- Writing to the code of the repo it checks. Comments on GitHub are the only GitHub writes.

## Anti-goals (a failure even if it works)

- A warning that clears on an agent's word, or quietly disappears.
- Comment spam: more than one Kryterea comment per pull request or per ticket.
- A quote, citation, file or line the copilot was not given.
- Any wording that reads as legal advice, a verdict of breach, certification, endorsement, a score, grade, rating, pass or fail. BABOK is not named.
- A trace with dead ends: every requirement, criterion and finding must be reachable from both ends.

## Professional and legal presentation

- Legal findings say "Check this", cite only pack entries (`packs/legal/ndpa-2023.json`), and carry "Not legal advice".
- Evidence reads "Evidence found", "Gap", "No evidence". Gates read "Held", "Cleared". Warnings read "Open", with the reason.
- People decide. Kryterea advises, warns and records; a named person accepts a risk or signs for delivery.
- Each role card names its practice in one line, for example: business analyst, requirements quality (ISO/IEC/IEEE 29148 qualities); QA, acceptance evidence; compliance, NDPA 2023 and the card security entries in the pack; architect, operations and reliability; product owner, acceptance.

## How it gets made (decided)

- Built inside this repo (`kryterea-lifecycle-copilot`), on the existing stack: `@lifecycle/core` workflow and SQLite record, Hono server, MCP server, Vite React panel. Model: Muse Spark, under the existing `COPILOT_BUDGET_USD` cap.
- The record stays additive: new tables are fine; existing CHECK constraints are not changed. Document gaps use the existing finding kinds (`conformance` for document quality and drift, `failure_path`, `legal`, `operations`).
- Documents tracked by default: Markdown files in the repo whose path or name matches `prd`, `spec`, `requirement` or sits under `docs/`, plus any document uploaded or pasted for the project. Each version is kept by content hash and commit so drift can be shown as before and after.
- Linear: `LINEAR_API_KEY` in the copilot's `.env` (the founder adds it; Claude never handles the key). A change or requirement is linked to a Linear issue by its identifier (for example `ENG-12`), entered in the panel or found in a commit message or branch name.
- GitHub: `GITHUB_TOKEN` in `.env` with permission to comment on the checked repo (the founder adds it). Only works once the demo repo is public, which still needs the founder's approval.
- The demo app's PRD is written by the coding agent from a founder-style prompt (logged as prompt 2 in its `PROMPTS.md`), so it is a real AI-created PRD with whatever gaps it has. Nothing is planted.

## Reuse (disclosed, never shown as new)

Multiple projects with team members, working alone or together, sign-off with named signers, and connections to GitHub, Notion, Linear and Google Drive exist in the Kryterea platform. The video shows them only on the closing "where this sits in Kryterea" card; `BUILT_DURING_HACKATHON.md` lists them. Code copied from kryterea-app (if any) is copied as files, never history or secrets, and listed there.

## Video focus

Documents and code checked by professionals: the AI-written PRD's gaps, the trace from a PRD line to the commit and the signed record, drift caught on a new push, the same warning appearing in the coding agent, on GitHub and in Linear, a fix confirmed by Kryterea (not trusted), and named decisions in the record.

## Constraints

- Finish as early as possible, before 2026-11-02; submission 2026-11-04 9:00 PM ET.
- Public repo rules in `CLAUDE.md` hold (no secrets, no dashes, disclosure, ask before publishing or signing up).
- Model spend within the $70 cap; fake model for UI work and tests.
- CI on Linux is the truth for tests and typecheck.

## Calls made by Claude (founder to check)

These settle questions a builder would otherwise guess at. Each is Claude's call, not something the founder said.

1. **A requirement** is extracted by the BA from a document line and stored per project (new table), with the exact quote and location (file and heading, or line). Its identity across versions is an ID written in the document when there is one (for example `FR-3`); otherwise the BA maps old to new requirements when a document changes, and anything unmapped is added or removed. Linear links attach to a requirement.
2. **Where document work lives.** Requirements are project-level. Criteria stay per change and link to the requirement they cover. A document finding is raised on the change that is in progress when it is found (the baseline change on first read); if none is in progress, on the latest delivered change, the same way findings after delivery work today. Findings keep their existing fingerprints, so the same gap re-found is the same finding.
3. **Confirming a document fix** works like a code fix: the finding clears only when a re-read of the new document version, covering the quoted section, no longer raises it; or a named person accepts it with a reason. A reported fix alone changes nothing.
4. **"Not in any document"** is checked per flow the BA already recovers from the code (not per file), at most 8 per run, so the list stays short enough to act on.
5. **MCP preamble** is on every tool answer. Tools that take a finding or change ID resolve the project from it. The top three open items are shown, ranked: legal, then failure paths, then drift, then the rest, newest first, with a total count.
6. **GitHub and Linear mechanics.**
   - **GitHub:** the poller lists open pull requests through the GitHub API on each tick, with no webhook because the copilot runs locally. The comment's id is stored in the record and also tagged in the comment. A push straight to the default branch gets a commit comment. When everything clears, the comment is edited to say nothing is open; it is never deleted.
   - **Linear:** comments go through its GraphQL API, created once and then updated. A ticket identifier in a commit message or branch name links it without using the panel.
7. **Evidence drift** means a commit's diff overlaps the cited lines of a file a criterion's evidence rests on (from git's diff hunks), not any change to the file.
8. **Document discovery** uses the default pattern, plus include and exclude lists per project, editable in the panel. An uploaded or pasted document is identified by the name given at upload and kept in the record only, never written to the repo.
9. **Cost.**
   - **Documents:** a document is read by the model only when its content changes.
   - **Requirements:** a re-check covers only requirements whose document, criteria or evidence lines changed.
   - **Code:** code checks keep using the existing narrowing.
10. **Gates.** Document gaps hold Kryterea's own gates in its own record, like other findings do today (the BA gate for document quality, QA for unproven requirements). Nothing outside Kryterea is ever stopped. The role cards' "pushed back on" and "who accepted what" come from findings and their status events.

## Left to the builder

Table shapes, prompt wording, the order of work, how open items are ranked, the panel layout within the existing Kryterea visual system, and how the trace view looks.
