# Kryterea Lifecycle Copilot: design

Date: 2026-10-26. Status: draft for founder review. Working name only.

Built for the Meta Global AI Developer Hackathon (founder approved, Meta API credits received; build window 2026-10-26 to 2026-11-04, submission due 2026-11-04 9:00 PM ET). This is a new project in a new public repository. Nothing from this repo is merged into Kryterea's private product without being rebuilt to that product's standards.

## 1. Intent

Coding agents now write the code. What is still missing, for a founder with no team, for an agency running many client projects, and for an established company letting AI build software, is the professional workflow around the code: the people who analyse a change, review its design and risks, verify what was built, decide whether it can be released, record who accepted it, and keep checking as the product changes.

The copilot carries the duties of those non-coding professionals through the whole lifecycle. It never writes product code. The coding agent stays the builder; the copilot does the professional work around it, raises findings with evidence, holds or clears gates, and keeps the record.

Positioning line (founder's words): coding agents write the code; Kryterea carries the duties of the team and professionals who are not coding, through the lifecycle.

This is not a requirements or product-management tool (founder's decision; that lane is crowded). Requirements are one output of one stage, nothing more.

## 2. Who it is for

One workflow, three audiences (founder's decision):

- Founders and solo builders: it is the team they do not have.
- Agencies: every client project gets the same professional delivery, and the client signs off on evidence rather than a demo call.
- Established companies: AI-built code still goes through professional review, with an audit trail, without adding headcount.

The demo follows a founder (the most relatable story) and closes by showing the same workflow serving an agency and a company.

When a coding agent finishes a change, people look at how the app behaves, not at code. Findings are written for that reader in plain language about app behaviour; the technical detail (file, line, fix) goes to the coding agent.

## 3. Goals, non-goals, anti-goals

Goals:

1. Show a professional workflow that a change moves through, with named professionals doing their duties at each stage.
2. Catch three kinds of issues people could not have known to look for: legal duties, failure paths, and the work of running the app for real (founder's choice).
3. Verify code against what was agreed, re-check on every change, and keep a record that shows issues closing over time.
4. Work with any coding tool (founder's decision: generic).
5. Use Meta models for all reasoning, including the coding agent on camera, inside the $150 of Meta API credits.
6. A 3-minute video judges remember.

Non-goals: writing product code; a chatbot or document Q&A tool (also clears the "basic RAG" ban); legal advice (legal findings are things to check, each citing its source); accounts, billing, multi-tenancy, production hardening; any reuse of Kryterea's private product code, prompts, BA OS playbooks or data.

Anti-goals: judges cannot tell what was built during the event; it reads as a requirements or PRD tool; it reads as another coding agent or AI code reviewer; findings arrive as code jargon; any score, rubric, grading or pass/fail language. Findings are "evidence found", "gap" or "no evidence"; gates are "held" or "cleared".

## 4. Hard constraints

- New work only. First commit after kickoff. `BUILT_DURING_HACKATHON.md` states this and lists everything external (open-source libraries, the Meta API, the coding agent).
- Public repository. No secrets committed; keys from environment variables only.
- Meta model: Muse Spark via the Meta Model API, reported OpenAI-compatible, $1.25 per million input tokens and $4.25 per million output, 1M-token context, structured output, tool calling, prompt caching. Confirm on dev.meta.ai on day 1.
- Fallback if Muse Spark is unusable (my call): first Muse Spark Open hosted by a hackathon partner (Fireworks, Baseten or Modal credits), so a Muse model stays in use for judging and the open-weights bonus prize becomes possible; then a Llama model on Cloudflare Workers AI, which the founder already runs. All model calls go through one adapter so switching is a config change.
- Open source: the kickoff requires the work to be open source, so the repo carries an OSI-approved licence.
- Budget: $150, split (my call) as about $50 for the coding agent (building the demo app and fixing on camera), about $70 for copilot runs, and $30 held back for recording. The copilot has a per-run token cap and a spend counter that stops its calls when its share is used. Coding-agent spend is watched in the Meta console. Use prompt caching wherever the same context repeats.
- Solo builder, 9 days.

## 5. The workflow

The unit of work is a change: a new app, a new feature, a fix, a client request. Every change moves through the same stages.

| Stage | Professionals on duty | What they produce |
|---|---|---|
| Intake | BA, product owner | What is asked, why, who it affects, which duties it triggers |
| Analysis | BA | Impact on existing work, failure paths, acceptance criteria |
| Design review | Architect / SRE, security and compliance | Risks, legal duties, running-for-real concerns, decisions with reasons |
| Build | The coding agent (not the copilot) | The code |
| Verification | QA | Evidence that what was built matches what was agreed, with file and line |
| Release | Compliance, architect / SRE, product owner | Release decision, held or cleared, with reasons |
| Acceptance | Product owner, plus a client or stakeholder when there is one | Sign-off record |
| Operate and improve | All of them | Re-checks on every later change |

Two ways a project starts:

- Existing app, nothing written down (leads the video, founder's choice). The first change is "understand what we have". The BA reads the code and writes down what the app actually does: flows, data collected, payments, roles. My call: code only; using the running app is the QA stretch in section 10. It asks the people involved to confirm intent ("Your app lets anyone see every booking. Is that meant to be admin-only?"), and the professionals' first findings follow.
- An idea or an AI-written document. Intake starts from it instead. One line in the video.

## 6. The professionals

Five roles, each with a gate it holds or clears.

1. Business analyst. Intake and analysis: what a change asks for and why, impact on existing work, failure paths (what happens when a step fails, repeats or is reversed), acceptance criteria. Recovers what an undocumented app does. Owns the record. Gate: analysis agreed.
2. Architect / SRE. Design review and release: backups, rate limits, monitoring, behaviour at 10x users, what support does when something breaks. Gate: ready to run.
3. QA. Verification: each acceptance criterion checked against the code with file and line evidence; stretch, uses the running app like a user. Gate: built as agreed.
4. Security and compliance officer. Design review and release: legal duties a change triggers. Holds the release while a duty is unmet. Gate: release.
5. Product owner. Decisions log (approved, changed, deferred, accepted risk, and why) and the acceptance record, with a client or stakeholder signing where there is one. Gate: accepted.

Each finding carries: who raised it, the stage, the trigger (a file and line, a document line, or a screen), what it costs if ignored in plain language, a ready-to-paste fix prompt, and a status (open, fixed, accepted risk, deferred).

Legal pack (my call): the demo app is treated as a Nigerian business serving Nigerian users. The pack covers the Nigeria Data Protection Act 2023 only, each duty tied to a section checked against the official text, never model memory. Card handling is cited as PCI DSS, labelled a standard and not a law. The duty used in the "add monthly subscriptions" scene is chosen from verified text once the legal pack is done (plan Task 7, by 10-30); if none fits, the scene uses a failure-path or running-for-real finding instead.

## 7. The record (backbone, built first)

change → stage → duty → artifact → evidence (file, line, commit; or document line; or screen) → finding → decision

Change impact is a walk along these links from whatever changed. The acceptance record is a read-out of them. Every check run stores the commit it ran against, so history shows issues closing change by change. Findings are never edited after they are raised; later runs and decisions change their status.

## 8. Connections

- Ideas and documents: paste or upload.
- Code: a GitHub repository (Lovable, Bolt, v0, Replit, Cursor and others all push to GitHub). Re-check on every push to the default branch.
- Running app: its preview or deployed URL (stretch).
- Coding agents: an MCP server exposing at least `list_findings`, `get_finding`, `get_change`, `report_fix` and `request_recheck`. Any MCP-capable agent can use it; for others, each finding has a fix prompt.
- People: a work panel showing the change, its stage, each professional's findings and gates, and the record.

## 9. Demo app and video

Coding agent on camera (founder's decision: one that runs on Meta credits): an open-source coding agent that accepts an OpenAI-compatible endpoint and supports MCP, pointed at Muse Spark. My call: Muse Code, Meta's own coding agent named at kickoff, if it runs here on the hackathon credits and supports MCP, because "use of Meta AI tooling" is a judging criterion. Otherwise Cline in VS Code (visible on screen, mature MCP support), with OpenCode as the backup if Cline misbehaves with the Meta endpoint. Prove the pairing on day 1 with a trivial task before building anything on it.

Demo app: built during the event by that coding agent from plain founder-style prompts that never mention failure handling, compliance or operations. Those prompts are committed to the repo. A booking or ordering app with accounts and test-mode payments. Built by 10-28; the first copilot run on it happens once the roles exist (plan Task 18). The video script is written after the first real check run, around the issues that actually appear. If a scripted issue does not appear, the scene changes, never the app.

Video (3:00), one change at a time through the workflow:

- 0:00 to 0:20. A founder with a working app built by a coding agent, nothing written down, no team.
- 0:20 to 0:50. "Understand what we have": the BA writes down what the app does and asks its questions; compliance and the architect raise their first findings.
- 0:50 to 1:30. Verification: QA finds an issue (for example a failed payment still showing "Order confirmed"); the coding agent picks it up over MCP and fixes it; the re-check clears.
- 1:30 to 2:15. A new change, "add monthly subscriptions", goes through intake, analysis and design review: impact, new duties, targeted re-checks.
- 2:15 to 2:40. Release and acceptance: compliance holds, the issue is fixed, the gate clears, the acceptance record appears.
- 2:40 to 3:00. The same workflow for an agency (client signs off on the record) and a company (audit trail), Meta models doing all the reasoning, the positioning line.

The video shows only the new repo's product and the demo app. Kryterea's private product does not appear.

Video rules from the kickoff: finalists are ranked live on 11-09 from this video alone, so it is produced with a clear voiceover. The rubric puts impact first (who benefits, real-world potential), then use of Meta AI tooling, technical depth and the demo, so the opening states who benefits and the voiceover names Muse Spark wherever it does the reasoning. No chat box on screen: the organisers named simple chat wrappers as a project type to avoid.

Judges (my call): video plus public repo with local run instructions using the judge's own key. No public hosted instance.

## 10. Scope and cut order

Every stage built to demo depth: real and working, narrow. Cut in this order if time runs short:

1. QA using the running app.
2. Starting from an idea or document, beyond a minimal path.
3. Automatic re-check on push (replace with MCP-triggered re-check).
4. Fix prompts for non-MCP tools.

Never cut: the record, the existing-app start, the change workflow with impact analysis, the release gate, the acceptance record.

Schedule: 10-26 to 27 Meta API check, Cline on Muse Spark proven, demo app started, legal pack sourced; 10-28 to 30 record, intake and analysis, compliance and architect review; 10-31 to 11-01 QA verification, MCP, re-check, change impact; 11-02 release gate and acceptance record; 11-03 README and video; 11-04 buffer, submit by midday ET.

## 11. Decided, and left to the builder

Founder's decisions: professional workflow across the lifecycle, carrying non-coding duties, not requirements-led; one workflow for founders, agencies and companies; issues of types legal, failure paths and running for real; code verification and continuous re-checks; generic across coding tools; existing app with nothing written down leads; a coding agent that runs on Meta credits.

My calls, open to correction: the stage list; the five roles; change as the unit of work; the record built first; the budget split; Cline with OpenCode backup; Workers AI Llama fallback; NDPA-only legal pack; BA reads code only; video timing; cut order; no hosted instance.

Left to the builder: stack (default TypeScript; avoid Next.js on Windows, the OpenNext build is broken there), storage, how a cheap first pass narrows files before the model reads them, MCP library, demo hosting.

## 12. Track and theme

- Track: Startup (founder's decision). The submission and video pitch Kryterea as a company: the problem, the three audiences, the workflow, and where it goes after the hackathon.
- Theme: "Build for Your World" (my call): Meta models brought into the domain the founder knows, professional software delivery.
- Judging (kickoff): a pass or fail screen on theme fit and use of Meta AI products, then Meta judges score against the rubric (impact, use of Meta AI tooling, technical depth, demo), then live finals on 11-09 from the video.
- Bonus prizes (my call, founder confirms): enter best agentic use case, which fits role agents gating a change while a coding agent fixes findings over MCP, and community vote. Most viral needs an X post after the event. Open weights only if the Muse Spark Open fallback is used.
- Startup track eligibility: the kickoff described it as for incorporated startups. The founder confirms Kryterea's status before submission.

## 13. Business Analysis OS (BA OS) in this project

Founder's decision: use the BA OS skills and workflows in planning and building to showcase their power.

Two facts limit how. BA OS predates the event, so by the "new work only" and "identify your contributions" rules it cannot be a feature judged in the demo. And it is private, so none of its own text (skills, playbooks, rubrics, templates, reports) may be copied into the public repo. Work it helps produce during the event, such as the verified legal pack, the workflow diagram and README prose, may enter the repo and is disclosed.

How it is used (my call, inside those rules):

1. As the team's working method while building. BA OS skills and agents do the professional work on the project itself: the pre-mortem on the plan, the NDPA obligation register behind the legal pack (verified against the official text), independent verification of the copilot's own outputs on the demo app, the traceability audit before recording, the workflow diagram, the pitch critique, and the final prose pass. The plan names the BA OS skill or agent for each task.
2. Disclosed, not shown. `BUILT_DURING_HACKATHON.md` and the README say that Kryterea's private BA OS was used as pre-existing tooling during development, that none of its content is in the repo, and that it is not part of what is judged.
3. Designed to plug in. The product loads each professional's duties from a "professional pack" directory. The public repo ships packs written fresh during the event. After the hackathon, Kryterea can plug in packs built from BA OS privately. The README states this as the roadmap; the video does not show BA OS.

If the founder wants BA OS visible in the demo anyway, that is their call to make knowingly: it risks disqualification under the contributions rule and would publish private IP.

## 14. Open for the founder

- Licence for the public repo.
- GitHub owner for the public repos (default: the `kryterea` organisation).
