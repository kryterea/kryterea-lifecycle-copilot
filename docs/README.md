# Docs

The copilot was built from written designs. Each feature has a design that says what it is for and what it must do, and a plan that breaks the design into small, tested steps with a checkbox for each one. The plans are kept as they were worked, ticks included, so they show the order the work was done in.

## Hackathon

| File | What it is |
|---|---|
| [hackathon/before-after.md](hackathon/before-after.md) | The before and after from the live run on the demo app (2026-11-01), written by `pnpm demo:export` from the record in `demo/lagospay.db`. It is the same page `pnpm demo` opens. |
| [hackathon/video-script.md](hackathon/video-script.md) | The script of the three-minute film, with the voice-over lines and what is on screen. |
| [hackathon/legal-sources.md](hackathon/legal-sources.md) | Where each entry in `packs/legal/ndpa-2023.json` comes from in the Nigeria Data Protection Act 2023, and when it was checked against the official text. |
| [hackathon/day1-verification.md](hackathon/day1-verification.md) | The checks run against the Meta Model API on build day 2: base URL, model id, structured output, image input and tool calling. |

## Designs and plans

| Design | Plan | What it added |
|---|---|---|
| [Lifecycle copilot](design/2026-10-26-lifecycle-copilot-design.md) | [plan](plans/2026-10-26-lifecycle-copilot.md) | The base product: the record, the five professional roles, the change workflow, the MCP server and the panel. |
| [Governed trace](design/2026-10-27-governed-trace-design.md) | [plan](plans/2026-10-27-governed-trace.md) | Documents read from the repo, requirement trace, drift rules, Needs you, and the GitHub and Linear comments. |
| [Recordable fix flow](design/2026-10-28-recordable-fix-flow-design.md) | [plan](plans/2026-10-28-recordable-fix-flow.md) | The four-act path a non-expert walks, from linking a repo to a signed record. |
| [Demo video](design/2026-11-02-demo-video-design.md) | none | How the film was shot and cut. It records the founder's decisions and what the live take did. It changed no code, so it has no plan. |

The earlier designs are records of intent at the time. Where the product moved on, `README.md` and the code describe what it does now.
