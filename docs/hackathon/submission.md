# Submission form

Fields of the Submit Project form on the event page, captured 2026-10-27, with working drafts. Final text is written in Task 19 from what was actually built and shown. The founder submits.

## What the form asks

| # | Field | Required | Notes |
|---|---|---|---|
| 1 | Team Name | Yes | |
| 2 | Team Members | | Umar Kabir (solo) |
| 3 | Which track are you submitting to? | Yes | Indie Developer Track or Startups Track |
| 4 | Which problem statement did you build towards? | Yes | Build for Your World or Push the Frontier |
| 5 | Most Viral Track: your X post link | No | The only bonus prize with its own field |
| 6 | Project Description | Yes | "Describe your project and what problem it solves" |
| 7 | Public GitHub Repository | Yes | |
| 8 | 3-Minute Demo Video | Yes | YouTube link |
| 9 | Describe your use of Meta products to build the submitted project | Yes | |
| 10 | Why are Meta's models important to your solution? | Yes | |
| 11 | Feedback from your experience using Meta products | No | |
| 12 | Feedback from your experience using partner technologies (Fireworks, Modal, Baseten) | No | Leave blank unless partner credits are used |
| 13 | Consent: Meta and Cerebral Valley may use, publish, share and promote the submitted materials | Checkbox | Founder decides |

What the form does not have, and where it goes instead:

- No field for prior work. The kickoff said prior work must be called out with where the new work starts. It goes in the Project Description (field 6), with a link to `BUILT_DURING_HACKATHON.md`.
- No field for bonus prizes other than most viral. Best agentic use case, best build on open weights, best creative build and community vote are presumably judged from the submission itself, so the description and video make the agentic workflow obvious.

## Track and theme

- Track (field 3): Startups Track. The event page defines it as "for teams and founders building a real product", judged on technical execution and whether it holds up in production. The kickoff talk called it the track for incorporated startups; the written definition does not require incorporation. The founder confirms in the Discord questions forum if in doubt.
- Theme (field 4): Build for Your World.

Because the Startup track is judged on whether the product holds up in production, the README's local run must work first time for a judge, and the video should show real runs, not fake-mode screens.

## Drafts

### 1. Team Name

Kryterea

### 6. Project Description (draft)

Coding agents now write most of the code in small teams, but nobody does the work the rest of a software team used to do: write down what was agreed, think through failure paths, check legal duties, plan for running the app for real, and confirm the code does what was agreed. Kryterea Lifecycle Copilot carries those non-coding duties (business analyst, architect and SRE, QA, security and compliance, product owner) through a change-based workflow, while any coding agent writes the code. It reads the repo, raises findings with evidence, holds the release until they are resolved, hands fix prompts to the coding agent over MCP, re-checks on every push, and produces an acceptance record a client or auditor can read.

This is a hackathon spin-off of Kryterea. Kryterea is our existing platform for professional software delivery work. The hackathon rules ask for new work only, so we could not enter or extend the Kryterea product. Instead we built this copilot from scratch during the event, in a new public repository, as a separate product that takes the same idea to coding agents. No code, prompts or content from the Kryterea platform are in this repository. The first commit (`dc447bb`, 27 October 2026) is where the new work starts, and `BUILT_DURING_HACKATHON.md` lists everything built during the event and everything external.

### 9. Use of Meta products (draft)

Muse Spark through the Meta Model API does all the copilot's reasoning: every professional role is a Muse Spark call with structured JSON output, tool calling and image input. The coding agent in the demo, OpenCode, also runs on Muse Spark, built the demo app from plain founder prompts, and fixes findings over MCP. Reasoning effort is set per role to keep cost down.

### 10. Why Meta's models matter (draft)

To be written from the real runs: what Muse Spark's reasoning made possible (reading a whole app and naming failure paths with file and line evidence), its long context, structured output, and the cost per change.

### 11. Feedback on Meta products (draft notes)

- Muse Code does not run on native Windows; the launcher supports macOS and Linux only.
- The base URL shown on dev.meta.ai pointed at `/v1/responses`; OpenAI-compatible clients need `/v1`.
- `max_completion_tokens` includes reasoning tokens, so a low cap returns empty content without an error.
- Price per million tokens is not returned by the API.
