# Demo video script (3:00)

Format follows the reference the founder chose: a short persona story drawn as a simple animated diagram, a live product walkthrough, a second act that shows a harder case, an outcomes card, and a brand close. Kryterea's version keeps the structure and swaps the content.

Rules for this script:

- Only show what was built during the event. The Kryterea platform itself does not appear.
- Script around what the real Muse Spark run on the demo app raised. Lines marked **[from the run]** are filled in from the recorded run, never invented. No gaps are planted in the demo app.
- No made-up numbers on the outcomes card. Every line there must be something the viewer just saw.
- No chat window on screen. The panel and the coding agent's terminal carry the story.
- Persona is fictional. Name and face are illustrations, not a real person.

Slides use the Kryterea brand: cobalt symbol, Geist type, paper background, the Trail as the recurring motif.

## 0:00 to 0:12 Hook

Diagram builds one piece at a time on a paper slide.

| Time | Screen | Voice |
|---|---|---|
| 0:00 | "Meet Ada." Ada's illustration. | Meet Ada. She runs a two person AI-native agency in Lagos. |
| 0:05 | Arrow from a client logo (a fictional fintech startup; the founder picks a name and checks no real company uses it) to Ada, then to a terminal labelled "Coding agent on Muse Spark" and a laptop showing the app. | Her coding agent shipped a payment links app in an afternoon. |
| 0:09 | A grey question mark appears over the app, then the Kryterea symbol slides in beside it. | Nobody checked it against what she agreed. That is the job Kryterea does. |

The video is four acts: take, detect, find and solve, fix and prove. Times are a target; a visible cut may jump over a wait, and every frame after a cut is real output from a real run on Muse Spark.

## 0:12 to 0:35 Act 1: Take

Screen recording of the panel, fake mode off, real Muse Spark runs on `demo-merchant-payments`. The app and its `docs/PRD.md` were both written by the coding agent from the prompts in its `PROMPTS.md`.

| Time | Screen | Voice |
|---|---|---|
| 0:12 | Welcome page, Ada enters her name. Then the workspace home. | Ada opens Kryterea. |
| 0:18 | Link a repo: the project takes the repo's name. | She links the client's repo. Kryterea only reads it. |
| 0:26 | The files picked up, including `docs/PRD.md`, with their counts. | It shows her exactly which files it picked up. |

## 0:35 to 1:05 Act 2: Detect

| Time | Screen | Voice |
|---|---|---|
| 0:35 | Start page: Ada types what is wrong in her own words. Auto is chosen. **[from the run]** | Ada says what is wrong, in her own words. Kryterea decides which professions check it. |
| 0:45 | Professionals at work: each profession card as it runs. | Each profession does its part of the job. |
| 0:55 | A question in plain words with listed answers and a safe default. Ada picks one. A second question: she says "I don't know" and the default is saved as assumed. **[from the run]** | Questions come in plain words. If she does not know, the safe default is recorded as assumed, with her name. |

## 1:05 to 1:50 Act 3: Find and solve

| Time | Screen | Voice |
|---|---|---|
| 1:05 | Assessment page: Ada's problem first, with the standard behind it and Release Held. **[from the run]** | The assessment starts with her problem, answered with the standard behind it. |
| 1:20 | The rest of what was found: a legal item with "Check this", the section cited, "Not legal advice". **[from the run]** | Everything else open, most pressing first. Compliance cites the exact section of the law. |
| 1:32 | The changes the product owner wrote for her. Ada approves one; a fix change appears with its acceptance criteria. **[from the run]** | Ada never writes a change. The product owner does, and she approves it. |

## 1:50 to 2:35 Act 4: Fix and prove

| Time | Screen | Voice |
|---|---|---|
| 1:50 | Coding agent's terminal (OpenCode on Muse Spark): `list_changes`, then the approved change, edits, `report_fix`, commit, `request_recheck`. | Her coding agent starts from the approved change over MCP and fixes it. |
| 2:04 | Back in the panel: the re-check runs, the finding turns Fixed, the chain fills with evidence. **[from the run]** | The agent's word is not proof. Only a re-check of the new commit closes it. |
| 2:14 | Before and after page, starting from her problem. | Her problem, before and after. |
| 2:24 | Acceptance record: her problem first, the assumed answers, every decision and name, and the closing line "Not legal advice. Kryterea advises and records; people decide." Every gate Cleared; Ada types her name, Accept delivery. | Every gate clears, and Ada signs for the work. |

## 2:35 to 2:45 What changed for Ada

Paper slide, Ada and the client logo, three ticked lines. Each line is something the video showed.

- Her own problem named first, in the assessment, the before and after and the record
- Changes written for her, approved by her, fixed by her coding agent over MCP
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
