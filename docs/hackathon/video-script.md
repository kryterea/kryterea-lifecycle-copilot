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
| 0:05 | Arrow from a client logo (fictional salon, "Glow Studio") to Ada. | A salon hires her to build online bookings with Paystack deposits. |
| 0:10 | Ada to a terminal labelled "Coding agent on Muse Spark", then to a laptop showing the app. | Her coding agent writes the code in an afternoon. |
| 0:15 | A grey question mark appears over the app, then the Kryterea symbol slides in beside it. | But nobody asked what the salon really needs, read the data protection law, or checked the work. That is the job Kryterea does. |

## 0:20 to 1:50 One change, end to end

Screen recording of the panel, fake mode off, real Muse Spark runs on `demo-salon-bookings`.

| Time | Screen | Voice |
|---|---|---|
| 0:20 | Projects page. Tagline under the title. Add project with the repo URL. | Ada adds the salon's repo. Kryterea only reads it. |
| 0:28 | Baseline change. Run next step. The dark Instrument band names each professional as it works. | Five professionals review the app as it is built today, on Muse Spark. |
| 0:40 | Analysis: the analyst's questions. Ada types two answers. | The business analyst asks what the code cannot answer. **[from the run]** |
| 0:50 | Design review. Open one legal finding: "Check this", the NDPA section, the Law tag. | Compliance reads the Nigeria Data Protection Act against the code and cites the exact section. **[from the run]** |
| 1:00 | One operations finding from the architect. | The architect asks what happens when it breaks. **[from the run]** |
| 1:08 | New change: "Take a deposit before holding a slot". Run to Build. The hand-off block: project id and prompt, Copy. | Ada asks for a new feature. At Build, Kryterea hands her coding agent the project and the findings. |
| 1:15 | Cut to the coding agent's terminal (OpenCode on Muse Spark): `list_findings`, edits, `report_fix`, commit, `request_recheck`. | The agent works through the findings over MCP. |
| 1:28 | Back in the panel: the finding shows "Fix reported". | The agent's word is not proof. The finding stays open. |
| 1:33 | Re-check runs. The finding turns Fixed; QA marks each criterion Evidence found. | Kryterea checks the new commit. Only then does it count. |
| 1:42 | Release: every gate Cleared. Acceptance: "Work you can sign", Ada types her name, Accept delivery. | Every gate clears, and Ada signs for the work. |

## 1:50 to 2:35 After delivery

| Time | Screen | Voice |
|---|---|---|
| 1:50 | "Hi Ada." Diagram: the app goes live, a new push arrives. | A week later, the agent pushes a change straight to the live app. |
| 1:58 | Operate stage: "Needs you". A finding raised after delivery. **[from the run]** | Kryterea keeps watching. It finds what the push broke. |
| 2:08 | Open fix change. The new change says "Follows" the delivered one and carries the finding. | One click opens a fix change. The finding goes back through the gates. Nothing gets lost. |
| 2:18 | Acceptance record: the serif document, "Checked by" line, decisions with names, the link to the fix change. Print. | Every decision, every finding and every name lands in one record Ada can hand to her client. |

## 2:35 to 2:50 What changed for Ada

Paper slide, Ada and the client logo, three ticked lines. Each line is something the video showed.

- Every finding ended: fixed and confirmed, or accepted with a reason
- Her coding agent's fixes were checked, not trusted
- One signed record from request to delivery, and after

## 2:50 to 3:00 Close

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
