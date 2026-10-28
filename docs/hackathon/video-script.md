# Demo video script (3:00)

Format follows the reference the founder chose: a short persona story drawn as a simple animated diagram, a live product walkthrough, a second act that shows a harder case, an outcomes card, and a brand close. Kryterea's version keeps the structure and swaps the content.

Rules for this script:

- Only show what was built during the event. The Kryterea platform itself does not appear.
- Script around what the real Muse Spark run on the demo app raised. Lines marked **[from the run]** are filled in from the recorded run, never invented. No gaps are planted in the demo app.
- No made-up numbers on the outcomes card. Every line there must be something the viewer just saw.
- No chat window on screen. The panel and the coding agent's terminal carry the story.
- Persona is fictional. Name and face are illustrations, not a real person.

Slides use the Kryterea brand: cobalt symbol, Geist type, paper background, the Trail as the recurring motif.

## 0:00 to 0:20 Meet Ada

Diagram builds one piece at a time on a paper slide.

| Time | Screen | Voice |
|---|---|---|
| 0:00 | "Meet Ada." Ada's illustration. | Meet Ada. She runs a two person AI-native agency in Lagos. |
| 0:05 | Arrow from a client logo (a fictional fintech startup; the founder picks a name and checks no real company uses it) to Ada. | A fintech startup hires her to build payment links for small businesses in Lagos, paid through Paystack. |
| 0:10 | Ada to a terminal labelled "Coding agent on Muse Spark", then to a laptop showing the app. | Her coding agent writes the code in an afternoon. |
| 0:15 | A grey question mark appears over the app, then the Kryterea symbol slides in beside it. | But this app moves money. Nobody asked what the business really needs, read the data protection law and the card rules, or checked the work. That is the job Kryterea does. |

## 0:20 to 1:50 One change, end to end

Screen recording of the panel, fake mode off, real Muse Spark runs on `demo-merchant-payments`. The app and its `docs/PRD.md` were both written by the coding agent from the prompts in its `PROMPTS.md`.

| Time | Screen | Voice |
|---|---|---|
| 0:20 | Projects page. Add project with the repo URL. Documents section: `docs/PRD.md`, its requirement count and gaps. | Ada adds the client's repo. Kryterea only reads it, starting with the PRD her agent wrote. |
| 0:30 | Document view: numbered lines, requirement keys, a gap beside its line. **[from the run]** | The analyst reads the PRD like a reviewer would and marks the lines nobody can build or check as written. |
| 0:42 | Needs you: the ranked list. Open one legal item: "Check this", the NDPA section, "Not legal advice". **[from the run]** | Everything open on the project, most pressing first. Compliance cites the exact section of the law. |
| 0:55 | Trace: the requirements table. Open subscriptions: the chain from document line to sign off, with its gaps. Link the Linear ticket. | Every requirement keeps a chain: the line it came from, its criteria, its ticket, the code, the decisions. A missing link shows as a gap. |
| 1:08 | Coding agent's terminal (OpenCode on Muse Spark): a tool answer that opens with "Kryterea: N open on this project." Then `get_finding`, edits, `report_fix`, commit, `request_recheck`. | Ada's coding agent sees the same open items before every action, and works through them over MCP. |
| 1:20 | The pull request comment on GitHub, then the comment on the Linear ticket: the same items. **[from the run]** | The same warning reaches GitHub and Linear. Kryterea comments; it never blocks a merge. |
| 1:30 | Back in the panel: the re-check runs, the finding turns Fixed, the chain fills with evidence. | The agent's word is not proof. Only a re-check of the new commit closes it. |
| 1:42 | Acceptance: every gate Cleared. Ada types her name, Accept delivery. | Every gate clears, and Ada signs for the work. |

## 1:50 to 2:35 After delivery

| Time | Screen | Voice |
|---|---|---|
| 1:50 | "Hi Ada." Diagram: the app goes live, a new push arrives. | A week later, a push changes code the work was signed on. |
| 1:58 | Needs you: a drift finding, with the Drift stamp and the commit. The GitHub comment updates. **[from the run]** | Kryterea runs its drift rules on every push. The code moved away from what was agreed, and everyone sees it. |
| 2:10 | The finding: accept it as a risk, with Ada's name and reason. The decision line under the professional's card. | Ada decides. Kryterea warns and records; people decide. |
| 2:20 | Acceptance record: the Trace section, each requirement with its criteria and decisions, and the closing line "Not legal advice. Kryterea advises and records; people decide." Print. | Every requirement, every decision and every name in one record Ada can hand to her client. |

## 2:35 to 2:45 What changed for Ada

Paper slide, Ada and the client logo, three ticked lines. Each line is something the video showed.

- Every requirement traced from the PRD line to the signed record
- Drift caught on the push, in the panel, the agent, GitHub and Linear
- Every open item ended: fixed and confirmed, or accepted by a named person

## 2:45 to 2:52 Where this sits in Kryterea

Paper slide, the Trail motif. "Where this sits in Kryterea." The copilot as one layer of the Kryterea platform, beside the platform's teams, projects with members, named sign off, and Drive and Notion connections. Small caption: "Platform features shown for context. Not part of this entry."

Voice: This copilot is the delivery layer of Kryterea, the platform for work teams can sign.

## 2:52 to 3:00 Close

| Screen | Voice |
|---|---|
| Kryterea symbol and wordmark. "Work You Can Sign." | Kryterea. Work you can sign. |
| "Claude and Codex build. Kryterea is the professional they build with." Under it: the GitHub repo URL and "Built on Muse Spark". | Open source, built on Muse Spark. |

## Recording checklist

- Record the panel at 1440 by 900, light theme, browser zoom 100%.
- Use the real Muse Spark run for every **[from the run]** line; note the finding titles here before writing the final voice-over.
- Coding agent on camera runs on Meta credits (OpenCode with Muse Spark).
- Keep the Replay stamp off camera: record with live runs, not fake mode.
- Read the final voice-over aloud against the timing; cut words, not pauses.
- After the live run: tag `before` (the agent's code and PRD) and `after` (its last fix) in the demo repo, run `pnpm demo:export` on the live data dir, and take the outcomes card's numbers from `docs/hackathon/before-after.md`.
- Show the Before and after page once, between the confirmed fix and the signed record.
