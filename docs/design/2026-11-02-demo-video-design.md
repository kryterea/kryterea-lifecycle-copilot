# Hackathon demo video: production design

Date: 2026-11-02. Due with the submission, 2026-11-04 9:00 PM ET. Story: `docs/hackathon/video-script.md` (founder approved 2026-11-01, Ada's line edited by the founder 2026-11-02).

## Intent

The 3:00 video is heavily weighted in judging and is the first thing a judge sees. The founder wants it directed and produced like a professional launch video, and wants every part to land, not one highlight. The story is settled; this document is about how it is shot, cut, voiced and finished.

## Goals

- Every second reads clearly at 1080p on a laptop: a judge can read the panel text without pausing.
- Every product frame is real output from a real run on Muse Spark. A cut may skip a wait; nothing on screen is mocked, rebuilt or retouched.
- One continuous story: the change Ada approves in Act 3 is the change her coding agent fixes and she signs in Act 4.
- Narration runs through the whole video with no silent gaps.
- 3:00 or less.

## Non-goals

- No new product features for the video. Copilot bugs found while recording are fixed in their own PR with a test, as in the 11-01 run.
- No changes to the story or voice lines beyond what the take's real output forces (**[from the run]** lines take the take's own words).

## Anti-goals (a failure even if it plays)

- Any zoom, crop, pan into the panel, or picture-in-picture of part of a screen. (Founder, 2026-11-02.)
- A model wait on screen.
- The REPLAY stamp, "(recorded)" labels, or fake mode on camera.
- Score, rubric, grade, rating, pass or fail wording anywhere, on screen or spoken. No em dashes, en dashes or spaced hyphens in any slide or subtitle.
- Legal items said as anything but "Check this", with "Not legal advice" visible.
- Anything from the Kryterea platform itself on screen except the closing "where this sits" slide, which is labelled as context.
- A planted gap in the demo app, or a hand edit to the agent's code or PRD.
- A secret, token, `.env` content, local path or personal account detail on screen.

## Decided by the founder

- **Panel framing: edge to edge.** The panel fills the full frame height. It is 16:10, the video is 16:9, so thin grey side bands fill the rest. No browser chrome, no floating window.
- **Subtitles: quiet.** One plain sentence at a time on a paper fade at the bottom, Geist, ink colour, no word highlight.
- **Slides:** paper ground, Geist, cobalt symbol, the Trail as the running motif (hook, outcomes card, "where this sits", close).
- **Ada:** "Meet Ada. She runs an AI-native agency in Lagos." Fictional; the illustration is not a real person.
- **Shooting split (as played back and accepted 2026-11-02):** Acts 1 to 3 are a fresh live take on Muse Spark on 11-03, paid from the $30 recording reserve. The agent's terminal is a clean real OpenCode pass on Muse Spark, cut to remove waits.
- **Production:** every model wait cut; narration throughout with the free kokoro voice; soft music ducked under the voice; assembled in HyperFrames at 1920 by 1080; every frame checked against the script before the founder sees the cut.

## Constraints

- **Budget:** copilot spend under `COPILOT_BUDGET_USD` (70); $5.82 spent; $30 reserved for the take, not touched before 11-03. Coding-agent spend is on Meta credits.
- **The copilot reads the remote HEAD** of the linked repo (`packages/core/src/repo/repo.ts:135-150`). `kryterea/demo-merchant-payments` HEAD is now the fixed code (tag `after`, 18724e2). A fresh take against it will not find Ada's problem. The take needs a repo whose HEAD is the `before` code (a1c5df0). See Open question 1.
- **Continuity:** Acts 3 and 4 must show the same project and the same change. If Act 4 used the 11-01 run while Acts 1 to 3 are a new take, the change title, project and IDs would differ between the acts.
- **Rules from `CLAUDE.md` and the founder:** ask before creating or pushing public repos, submitting forms or signing up for services; pushing and merging need approval; never read or print `.env`; the coding-agent prompt never mentions `.env`; the coding agent on camera runs on Muse Spark.
- **Machine:** Windows 11. Playwright 1.64 drives the installed Chrome (`channel: "chrome"`); its bundled Chromium is not installed. ffmpeg is installed. HyperFrames CLI is available (Studio preview crashed in 0.8.223 for the YC video; render worked).
- **Delivery:** MP4, H.264, 1920 by 1080, 30 fps, AAC audio. Uploaded where the submission form accepts a link (founder's call at upload time).

## How it is made

### Where the work lives

A new production folder beside the repos: `kryterea project/hackathon-video/` (not in the public repo; footage and audio are large). It starts as a copy of the YC video's working pipeline in `kryterea project/demo-video/recorder/` (script.json, vo.mjs, cut.mjs, gen.mjs, music.py, lib.mjs, cast.mjs), with the crop and mask steps removed. The copy is adapted, not rewritten. Only this design doc and the script live in the public repo. (My call.)

### Capturing the panel

- Chrome at a 1440 by 900 CSS viewport, light theme, 100% zoom, device scale 1.2, so each frame is exactly 1728 by 1080 pixels. It sits in the 1920 by 1080 frame unscaled, with 96 px bands each side. No resampling, so text stays crisp. (My call; the founder chose edge to edge, the scale factor is how.)
- Capture with a CDP screencast as in `cast.mjs` (frames held until the page changes), encoded at 30 fps.
- A dedicated Chrome profile for the take, deleted after recording.
- Ada's typing is real typing in the page, at a human pace.
- Each part starts after its page has finished loading.

### Capturing the agent's terminal

- A real capture of the terminal window running OpenCode on Muse Spark, sized so its capture is 1728 by 1080 and sits with the same bands as the panel. Use ffmpeg `gdigrab` on the window, or a Windows Terminal with a matching size. Use a large font (about 20 px) so it reads at 1080p without zoom.
- One prompt per beat, written before the take: `list_changes`, read the approved change, edit, `report_fix`, commit, open the pull request. The agent does not call `request_recheck` before merge (the re-check reads HEAD), the same as on 11-01.
- If the clean pass needs more than one prompt, every prompt stays on screen or is spoken. The voice-over must not imply one prompt did it if it did not (the script's "must not smooth over" list).

### The take (11-03)

1. Fresh copilot data dir, live model, no fake mode, no replay.
2. Act 1: welcome, Ada's name, workspace home, link the take repo, files picked up.
3. Act 2: Start page, Ada types her problem (the 11-01 wording), Auto; profession cards while they run; questions in plain words. She picks one answer and says "I don't know" to one.
4. Act 3: assessment with her problem first and Release Held; a legal item with "Check this", the NDPA section and "Not legal advice"; the product owner's changes; Ada approves one, and the fix change appears with its criteria.
5. Act 4: the agent's terminal pass on the same change; Ada merges the PR; she starts the re-check on the merged commit; the finding turns Fixed and the chain fills with evidence; the Before and after page; the acceptance record; every gate Cleared; Ada types her name and accepts delivery.
6. Record the decision scenes in story order, so no later state shows up early.
7. If release cannot reach Cleared in the take without the risk acceptances made on 11-01, Ada makes them on camera with reasons, briefly, and the voice-over says so. (Script's "must not smooth over" list.)

### Cutting

- Hard cut from each action straight to the result; no model wait on screen. Find the cut points by sampling frames, not from logged timestamps (cast.mjs marks drifted about 60 s on the YC take).
- No transitions inside a scene beyond a cut. Slides come in and go out with a short fade on paper. (My call.)

### Voice, subtitles, music

- Voice-over: kokoro `af_heart` through NoizAI `tts --backend kokoro`, run from `~/.cache/kokoro`. The script's lines, with **[from the run]** lines filled from the take. Every line ends within about 1 s of its cut. Check how "Kryterea" and "Muse Spark" are pronounced by ear; respell them in the TTS input if they sound wrong.
- Subtitles: the spoken sentence, quiet style (founder's pick). Subtitles show the voice-over only, never a summary.
- Music: synthesised pad from `music.py` (no download, no licence question). It sits about 18 dB under the voice and rises only on slides with no voice-over, if there are any. (My call.)
- Loudness about -14 LUFS integrated, peaks under -1 dBTP. (My call.)

### Slides

HyperFrames compositions in the brand: paper `#f1f3f6`, ink `#14161a`, cobalt `#2f5bea`, Geist and JetBrains Mono from Google Fonts, the real Kryterea symbol (from `packages/web/public/favicon.svg`), and the Trail drawn as a line with stage dots. Hook diagram builds one piece at a time, as the script says. Ada and the client logo are simple flat illustrations made for the video. The client is a fictional fintech whose name the founder picks and checks (Open question 2).

### Review before the founder sees it

- Watch the full render at 1080p. Pull a frame every 2 s and read each one against the anti-goals and the script.
- Check: no wait, no zoom or crop, no REPLAY or "(recorded)", no banned wording, no dashes, legal wording right, outcomes card numbers match what the video showed, and total length 3:00 or less.
- Then hand the founder the render plus a one-page cut sheet: what each scene shows, its timecode, and anything that differed from the script.

## Calls made after the builder check (mine, for the founder to check)

- **Narration fills the video.** The founder's standing preference is a narrator talking throughout. The approved lines stay word for word. Short linking lines are added where a scene runs longer than its line. Each added line only says what is on screen. The founder reads the full voice-over text with the first cut, before the final render.
- **Several prompts are shown honestly.** Each prompt the agent needs is a hard cut with a small mono stamp ("Prompt 2 of 4"). The voice says it plainly, for example "It takes her coding agent a few prompts." Act 4 may run past the script's targets; the slides and Act 1 give the time back so the total stays at 3:00 or less.
- **A failed re-check stays on camera.** If the agent's first fix does not clear the re-check, the video shows that and the next prompt, because it shows the point that the agent's word is not proof. The take is redone only if the copilot itself breaks.
- **Risk acceptances are shown in one pass.** If the take needs Ada to accept risks before release clears, she accepts one on camera with her reason typed. The rest appear in one steady scroll of the real list. The voice says "She accepts the rest as risks, each with a reason, for later releases." The count shown is the real count.
- **The merge is a cut, not a GitHub page.** The terminal shows the agent opening the pull request. The video then cuts to the panel re-check on the merged commit, and the voice says "Ada merges it." No GitHub page is captured, so no account name or avatar shows. The script's 2:04 screen note changes accordingly.
- **Cost.** All copilot spend so far, including the full 11-01 run, is $5.82. One take is expected to cost a few dollars, so the $30 reserve covers retakes.
- **Order.** The agent's terminal pass is recorded after Act 3, against the take's own approved change.

## Left to the builder

- Exact cut points, scene lengths within the script's targets, slide motion details.
- Terminal colour scheme and font, as long as it reads at 1080p.
- Whether the outcomes card numbers come from the take's own before and after (preferred, once the take is done) or from 11-01. Either way, every number is one the video showed.

## Founder answers (2026-11-02)

1. **Repo the take reads:** a new public repo from tag `before`, approved. Created as `kryterea/lantana-payment-links` (renamed from the first name so the project shows the client, not the demo repo).
2. **Client:** "You pick it." Picked **Lantana Pay**, a fictional fintech with no web hits for the name. Logo is a flat flower mark drawn for the video.
3. **Act 4 source:** the same take, end to end. Acts 1 to 4 are one continuous run on 2026-11-02 (founder: "take it now, I will review today"), so the $30 reserve was used on 11-02, not 11-03.

## What the take did (2026-11-02, Muse Spark)

- The take ran against [kryterea/lantana-payment-links](https://github.com/kryterea/lantana-payment-links), a recording copy of the demo app at tag `before`.
- One agent prompt fixed the approved change: 12 findings reported with `report_fix`, one commit, push, and [pull request #1](https://github.com/kryterea/lantana-payment-links/pull/1), merged. No second prompt, so no "Prompt N of M" stamps.
- The re-check on the merged commit took every one of the change's five acceptance criteria to Evidence found.
- 34 items still held release. Ada accepted one on camera with her typed reason and the other 33 through the API, each with a founder-approved reason saved on its decision in the record (legal 8, operations 4, covered by other changes 8, untouched requirements 10, touched requirements 4).
- Before and after: open items 37 to 10, evidence found 2 to 10, her problem's 4 findings Fixed, 23 closed, 0 new.
- Copilot spend for the take: $1.17.
