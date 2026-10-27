# Kryterea Lifecycle Copilot: project instructions

Hackathon entry for the Meta Global AI Developer Hackathon (Startup track). Build window 2026-10-26 to 2026-11-04; submission due 2026-11-04 9:00 PM ET. Read `HANDOFF.md` first in any new session.

## What this is

Coding agents write the code. This copilot carries the duties of the non-coding professionals (business analyst, architect/SRE, QA, security and compliance officer, product owner) through a change-based delivery workflow. It never writes product code and never writes to the repo it checks.

Design: `docs/superpowers/specs/2026-10-26-lifecycle-copilot-design.md`. Plan: `docs/superpowers/plans/2026-10-26-lifecycle-copilot.md`. Work the plan task by task; tick its checkboxes as you go.

## Hard rules

1. New work only. Every file here is written during the build window. Never copy anything from Kryterea's private product, marketing or document repos, or BA OS (private). BA OS may be used as a tool. Its own text (skills, playbooks, rubrics, templates, its reports) never enters this repo; work it helps produce during the event (the verified legal pack, the workflow diagram, README prose) may, and is disclosed in `BUILT_DURING_HACKATHON.md`.
2. This repo is public. No secrets in git; keys only in `.env` (ignored). `HANDOFF.md` is internal and gitignored; never commit it.
3. No score, rubric, grade, rating, pass or fail language in product copy, README or video. Evidence: "Evidence found", "Gap", "No evidence". Gates: "Held", "Cleared".
4. No em dashes, en dashes or spaced hyphens as sentence dashes, anywhere.
5. Legal findings cite only entries in `packs/legal/ndpa-2023.json` and say "Check this", never "You are in breach". Not legal advice.
6. Copilot model spend is capped by `COPILOT_BUDGET_USD` (70). Use `COPILOT_FAKE_MODEL=1` for UI work and tests.
7. Ask the founder before: creating or pushing public repos, submitting any form, signing up for any service, or anything listed in `HANDOFF.md` section 9.
8. Never plant gaps in the demo app. Script the video around what actually appears.
9. Keep `BUILT_DURING_HACKATHON.md` current: it is how judges tell what is new.

## Commands

- `pnpm install`
- `pnpm test` (Vitest, all packages)
- `pnpm typecheck`
- `pnpm dev` (server on 8787 plus the web panel)

Windows note: local typecheck can show phantom "cannot find module" errors from the pnpm store. GitHub Actions on Linux is the truth; check CI after every push.

## Skills to use

- Process: superpowers:subagent-driven-development, superpowers:test-driven-development, superpowers:verification-before-completion, superpowers:requesting-code-review, superpowers:finishing-a-development-branch.
- Build: frontend-design:frontend-design (panel), mcp-server-dev:build-mcp-server or mcp-builder (MCP), webapp-testing (stretch), security-review (before final push).
- BA OS (working method, see `HANDOFF.md` section 6): risk-challenger, regulatory-compliance, compliance-auditor, elicitation, change-control, acceptance-testing, process-modelling, visual-modeller, requirements-verifier, traceability-auditor, executive-review, deliverable-critic, technical-writer, natural-prose-editor.

## Commit style

Conventional commits (`feat(core): ...`, `docs: ...`). Small commits per plan step; the commit history is part of the evidence of new work.
