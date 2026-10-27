# Built during the hackathon

Meta Global AI Developer Hackathon, Startup track. Build window: 2026-10-26 to 2026-11-04.

## What is new

This project is a hackathon spin-off of Kryterea, our existing platform for professional software delivery work. The rules ask that only work from the event is demoed, so the Kryterea platform is not entered or extended here. This copilot was built from scratch during the event as a separate product. The only pieces taken from Kryterea are listed under "What is not ours, or not new" below; none of them is a feature of this entry.

Everything in this repository was written during the build window. The first commit is `dc447bb` on 2026-10-27 (build day 2; the design and plan were written on 2026-10-26). The commit history is the record of the work.

Built during the event (update as tasks finish):

- [x] Meta model adapter with spend guard
- [x] The record: changes, findings, gates, evidence, acceptance
- [x] Repo reader and file narrowing
- [x] Five professional packs and the verified NDPA 2023 legal pack
- [x] Business analyst, architect/SRE, QA, security and compliance, and product owner roles
- [x] Change workflow with targeted re-checks
- [x] HTTP API and push poller
- [x] MCP server for coding agents
- [x] Web work panel
- [x] Web panel redesign (2026-10-27): the change screen as a stage Trail beside one stage at a time, icon buttons, shorter copy, phone and dark layouts; `packages/web/PRODUCT.md` and `packages/web/DESIGN.md` record the product and design decisions
- [x] Every process has an end (2026-10-27): fix reports wait on a re-check, fix changes carry findings raised after delivery, withdraw with a reason, back to analysis when no criteria were written, later rounds of analyst questions, reopen a settled finding, interrupted runs closed on start, and the Build stage hand-off for the coding agent
- [x] README
- [x] QA in the running app (2026-10-27): QA tries criteria in the app with a headless browser (Playwright), choosing each step with Muse Spark and judging from screenshots; opt in with `COPILOT_QA_BROWSER=1`
- [ ] Demo app (separate repo `demo-merchant-payments`), built by a coding agent running on Muse Spark from the prompts in its `PROMPTS.md`

## What is not ours, or not new

- Meta Model API (Muse Spark) for all reasoning.
- The coding agent used on camera: OpenCode (open source), running on Muse Spark. Meta's own Muse Code does not run on native Windows, where this was built.
- Open-source libraries listed in each `package.json`.
- The panel's look follows the Kryterea platform's existing visual language so the two read as one family: its colour values, type scale, fonts (Geist, Source Serif 4, JetBrains Mono, loaded from Google Fonts), radii, shadows, motion timings, and the shapes of its stage Trail, status stamps, pill buttons and dark "Instrument" band. Those values and shapes were followed by eye and by number; every component, stylesheet and icon in `packages/web` was written fresh during the event, and no Kryterea code was copied.
- From Kryterea's brand set: the Kryterea symbol (drawn inline in `packages/web/src/main.tsx`) and `packages/web/public/favicon.svg`, plus Kryterea's positioning line ("Claude and Codex build. Kryterea is the professional they build with.") and its "Work You Can Sign" theme, used in the panel and README.
- The Impeccable design skill for Claude Code guided the redesign and its finish review.
- Kryterea's private Business Analysis OS (BA OS) was used as pre-existing development tooling: a pre-mortem on the plan, drafting and verifying the NDPA obligation list against the official text, drawing the workflow diagram, independent review of the copilot's own output on the demo app, and editing prose. BA OS's own skills, playbooks, rubrics, templates and reports are not in this repository, and BA OS is not part of this entry. The things it helped produce during the event (the legal pack in `packs/legal/`, the README diagram and prose) were created during the build window and are part of the entry.
