# Built during the hackathon

Meta Global AI Developer Hackathon, Startup track. Build window: 2026-10-26 to 2026-11-04.

## What is new

This project is a hackathon spin-off of Kryterea, our existing platform for professional software delivery work. The rules ask for new work only, so the Kryterea platform is not entered or extended here. This copilot was built from scratch during the event as a separate product, and no code, prompts or content from the Kryterea platform are in this repository.

Everything in this repository was written during the build window. The first commit is `dc447bb` on 2026-10-27 (build day 2; the design and plan were written on 2026-10-26). The commit history is the record of the work.

Built during the event (update as tasks finish):

- [ ] Meta model adapter with spend guard
- [ ] The record: changes, findings, gates, evidence, acceptance
- [ ] Repo reader and file narrowing
- [ ] Five professional packs and the verified NDPA 2023 legal pack
- [ ] Business analyst, architect/SRE, QA, security and compliance, and product owner roles
- [ ] Change workflow with targeted re-checks
- [ ] HTTP API and push poller
- [ ] MCP server for coding agents
- [ ] Web work panel
- [ ] Demo app (separate repo `demo-salon-bookings`), built by a coding agent running on Muse Spark from the prompts in its `PROMPTS.md`

## What is not ours, or not new

- Meta Model API (Muse Spark) for all reasoning.
- The coding agent used on camera: OpenCode (open source), running on Muse Spark. Meta's own Muse Code does not run on native Windows, where this was built.
- Open-source libraries listed in each `package.json`.
- Kryterea's private Business Analysis OS (BA OS) was used as pre-existing development tooling: a pre-mortem on the plan, drafting and verifying the NDPA obligation list against the official text, drawing the workflow diagram, independent review of the copilot's own output on the demo app, and editing prose. BA OS's own skills, playbooks, rubrics, templates and reports are not in this repository, and BA OS is not part of this entry. The things it helped produce during the event (the legal pack in `packs/legal/`, the README diagram and prose) were created during the build window and are part of the entry.
