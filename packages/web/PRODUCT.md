# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Founders and solo builders first: people shipping an app with a coding agent and no team around them. The same panel serves agencies running client projects and companies letting AI build software. They open the panel to see what each professional checked, decide on each finding, answer the business analyst's questions, and accept delivery.

## Product Purpose

Kryterea Lifecycle Copilot carries the duties of the non-coding professionals (business analyst, architect and SRE, QA, security and compliance, product owner) through a change-based delivery workflow, while a coding agent writes the code. Success: the owner knows what is held, why, and what to do next, and ends with an acceptance record a client or auditor can read.

## Positioning

Coding agents write the code; Kryterea carries the duties of the team and professionals who are not coding, through the lifecycle. It never writes product code and never writes to the repo it checks. Every finding cites a file and line, a document line, or a pack entry.

## Operating Context

A local web panel served by the copilot server, next to the owner's coding agent (OpenCode, Claude Code, Cursor) which reads the same findings over MCP. Eight stages: intake, analysis, design review, build, verification, release, acceptance, operate. Model work runs on Meta's Muse Spark and takes seconds to minutes per role.

## Capabilities and Constraints

- Projects (repo URL, optional app URL), changes (understand, feature, fix), findings (status open, fixed, accepted risk, deferred), gates (Held, Cleared), criteria with evidence (Evidence found, Gap, No evidence), acceptance record, spend meter against a $70 budget.
- A deferred legal finding keeps release held; only a fix or an accepted risk with a reason clears it.
- Never use score, rubric, grade, rating, pass or fail wording, and no em or en dashes.
- Legal findings say "Check this", cite only pack entries, and are not legal advice. PCI DSS entries are a standard, NDPA 2023 entries are law.
- Hackathon rule: every file is new work written during the build window. Kryterea's visual language may be followed; no code is copied from Kryterea's private repos.

## Brand Commitments

Kryterea name and visual language (confirmed by the founder 2026-10-27): same look as the Kryterea app, written fresh. Plain, short wording; fewer words is better.

## Evidence on Hand

The demo app `demo-salon-bookings` (Nigerian salon, Paystack deposits) and real Muse Spark outputs recorded in `packages/core/fixtures`. No customers, testimonials or metrics exist; never invent them.

## Product Principles

1. Show what is held and the next action before anything else.
2. Every claim points at evidence the owner can open.
3. The owner decides; the copilot records who decided and why.
4. Fewer words: one line where a paragraph was.

## Accessibility & Inclusion

Works at 375 px with no horizontal scroll. Keyboard and screen reader basics on every control. Light and dark.
