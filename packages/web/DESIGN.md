---
name: Kryterea Lifecycle Copilot
description: A paper-and-cobalt review panel where a change walks a Trail of eight stages and every status is a flat mono stamp.
colors:
  brand: "#2f5bea"
  brand-deep: "#244bc9"
  brand-bright: "#3d67f0"
  on-brand: "#ffffff"
  brand-tint: "#eef2fe"
  ink: "#14161a"
  secondary: "#3a3f46"
  muted: "#646c7a"
  border: "#d1d5db"
  hairline: "#e5e7eb"
  surface: "#ffffff"
  surface-muted: "#f3f4f6"
  paper: "#f1f3f6"
  cleared: "#187747"
  caution: "#946012"
  danger: "#c02626"
  cleared-tint: "#e8f4ee"
  caution-tint: "#fbf2e2"
  danger-tint: "#fbebeb"
  instrument: "#14161a"
  instrument-text: "#f6f7f9"
  instrument-muted: "#949ba5"
  instrument-accent: "#6b8bf5"
typography:
  page:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  page-phone:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  record-title:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.35
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
  meta:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  tag:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
  document:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.03125rem"
    fontWeight: 400
    lineHeight: 1.65
  stamp:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  input: "6px"
  card: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.pill}"
    height: "38px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "38px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.pill}"
    height: "38px"
  button-ghost-hover:
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand}"
  button-sm:
    height: "30px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "9px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  stamp:
    textColor: "{colors.ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  instrument:
    backgroundColor: "{colors.instrument}"
    textColor: "{colors.instrument-text}"
    rounded: "{rounded.card}"
    padding: "16px 18px"
---

# Design System: Kryterea Lifecycle Copilot

## Overview

**Creative North Star: "The Trail"**

The panel follows the Kryterea platform's app on purpose, so the copilot and the platform read as one family: same colour values, type scale, faces, radii, shadows, motion timings, Trail, stamps, pill buttons and dark Instrument band. Every line of code here was written fresh during the hackathon; nothing was copied. The look is a paper ground, white work surfaces, one cobalt accent, and flat mono stamps that state status in a word.

A change is a journey. A vertical spine of eight stages (Intake to Operate) is the map; the pane beside it shows only the selected stage: who is on duty, what they found, the one next action. Density is calm and document-like. Screens refuse stacked cards where every role and finding compete at once.

**Key Characteristics:**
- Paper `#f1f3f6` page, white `#ffffff` surfaces, hairline borders, almost no shadow at rest.
- Cobalt is the only hue with a job: spine, primary pill, focus, links. Green, amber, red appear only on stamps and counts.
- Status is a stamp, never a colour alone and never a number.
- Three faces by role: Geist for UI, Source Serif 4 for the record, JetBrains Mono for stamps and code.
- Light and dark both ship; dark swaps the same token names.

## Colors

Restrained: cool neutrals plus one cobalt, with three status hues kept off large areas. Values live in the frontmatter; this prose names roles only.

### Primary
- **Trail Cobalt** (`brand`): spine fill, primary pill, links, live stamp, focus ring (at 60% mix), selection. `brand-bright` to `brand` is the primary pill gradient; `brand-deep` is its hover end. `brand-tint` is the quiet wash behind ghost hover, finished-dot halo, and the accept bar.
- **Dark-mode Cobalt**: `#6b8bf5` replaces `brand` in dark; `on-brand` becomes `#0b1020`.

### Neutral
- **Ink** (`ink`): text, the "you" stamp, selected stop. **Secondary** (`secondary`) for supporting text, **Muted** (`muted`) for meta and todo stops.
- **Paper** (`paper`) is the page; **Surface** (`surface`) is every work surface; **Surface Muted** (`surface-muted`) is hover rows, quoted text, prompt wells, track of the spend bar.
- **Border** (`border`) for inputs and idle stamps; **Hairline** (`hairline`) for every divider and card edge.

### Status
- **Cleared green** (`cleared`), **Held amber** (`caution`), **Danger red** (`danger`), each with a `-tint` for counts and washes. Token names avoid the banned words on purpose (a copy guard test scans `src/`).

### Instrument
- `instrument`, `instrument-text`, `instrument-muted`, `instrument-accent`: the dark band only. Do not use them elsewhere.

### Named Rules
**The One Hue Rule.** Cobalt is the only decorative hue. Green, amber and red mean status and nothing else.
**The Stamp Meaning Rule.** Each stamp tone carries one meaning on every screen: cleared (green) settled, held (amber) holding release, you (ink) waiting on the person, live (cobalt) in motion, idle (grey) not yet. A deferred legal finding wears held, because deferring does not clear the law.

## Typography

**UI Font:** Geist (with ui-sans-serif, system-ui, Segoe UI)
**Record Font:** Source Serif 4 (with Georgia)
**Mono Font:** JetBrains Mono (with ui-monospace, Cascadia Mono, Consolas)

**Character:** Geist is Kryterea's brand face and a sanctioned exception to the design detector's overused-font rule. Serif appears only where the owner reads a document; mono only where something is a code, a path, or a stamp.

### Hierarchy
- **Page** (650, 1.875rem, 1.15, -0.02em): page and stage headings. 1.5rem at 560px and below.
- **Title** (600, 1.375rem, 1.25): the change title atop the rail.
- **Section** (600, 1.125rem): section heads on the record.
- **Body** (400, 0.9375rem, 1.55): default. Headings use `text-wrap: balance`, paragraphs `pretty`.
- **Label** (500, 0.875rem): buttons, stop names, row details.
- **Meta** (400, 0.8125rem): hints, citations, row subtext. Smaller 0.75rem is used for byline and finding meta.
- **Document** (serif 400, 1.03125rem, 1.65): the acceptance record body, finding text on the record, quoted triggers. Record title is serif 1.25rem.
- **Stamp** (mono 500, 0.6875rem, uppercase, 0.05em).

### Named Rules
**The Three Faces Rule.** Sans for interface, serif for the record, mono for stamps and code. No fourth face.
**The Tabular Rule.** Money and counts use `font-variant-numeric: tabular-nums`.

## Layout

A 1200px shell (24px side padding, 16px at 560px and below) under a sticky 56px top bar with the wordmark and the status stamps; the bar is identical on every screen. Document pages (projects, record) centre a 760px column. The change screen is a two-column grid: 264px sticky rail (project crumb as back link, change title, Trail) and a fluid stage pane, 48px apart. Inside the pane, blocks sit on a 20px gap and rows use 14 to 18px padding. Lists are one bordered container with hairline dividers, never a stack of separate cards.

**Phone (860px and below):** the grid collapses to one column. The Trail turns horizontal, eight equal columns, dots only, inside a bordered strip, with "N of 8" under it; the stage heading names the stop. Open counts become small badges on the dot. At 560px, finding rows re-flow to two lines and facts, forms and decisions go single column. No horizontal scroll at 375px. Reduced motion collapses all animation; print hides the bar and mutes stamps to black.

## Elevation & Depth

Mostly flat with a hairline edge; tonal layering (paper under white) does the work. Shadows are a small vocabulary:

- **Card** (`0 1px 2px rgba(20,22,26,0.04), 0 1px 3px rgba(20,22,26,0.05)`): every bordered container, secondary pill, selected stop, selected segment.
- **Pop** (`0 16px 44px rgba(20,22,26,0.16), 0 2px 8px rgba(20,22,26,0.06)`): the Instrument band only.
- **Glow** (`0 1px 2px rgba(47,91,234,0.3), 0 6px 16px -6px rgba(47,91,234,0.55)`): the primary pill only, with a 1px inner highlight.

The top bar is a 88% surface with a 10px backdrop blur and a hairline underneath.

### Named Rules
**The Flat Stamp Rule.** Stamps have a border and no fill, no shadow, no radius above 4px.
**The One Glow Rule.** Only the primary pill glows; at most one per view.

## Shapes

Pills for actions and segmented controls (999px). Cards 10px, rows and Trail buttons 12px, inputs 6px, stamps and law tags 4px. The Trail dot is a 12px circle with a 2px border; the spine is 2px wide, hairline when ahead, cobalt when behind. Empty states are dashed `border` boxes. Icons are one stroke family: 24 grid, 1.7 stroke, round caps, `currentColor`, sized 18 by default; icons are inline SVG and decorative unless labelled.

## Components

### Buttons
- **Shape:** full pill, 38px tall (30px `sm`, 38px square `icon`), 16px side padding, label 500 0.875rem, optional leading icon at 8px gap.
- **Primary:** brand-bright to brand gradient, white label, glow. Hover shifts to brand to brand-deep.
- **Secondary:** white, `border`, card shadow; hover tints border and label cobalt.
- **Ghost:** transparent, secondary label; hover `brand-tint` wash with cobalt label. Left-aligned ghosts pull back 12px so the label meets the heading edge.
- **Press and disabled:** scale 0.98 over 120ms; disabled is 50% opacity.

### Stamp
Flat mono uppercase, 1.5px currentColor border, 4px radius. Tones: cleared, held, you, live, idle (grey border), danger. Gates read **Held** / **Cleared**; evidence reads **Evidence found** / **Gap** / **No evidence**; finding status reads Open, Fixed, Risk accepted, Deferred. Law and standard tags are a quieter 1px outlined mono tag: NDPA is tagged **Law** (ink border), PCI DSS is tagged **Standard** (grey).

### Trail
Vertical list of eight stops, each a full-width button: dot, stage name, optional amber open-count pill. Done stop: filled cobalt dot with a `brand-tint` halo and a cobalt spine segment below it. Live: cobalt ring, and pulses (1.8s) while the model works. You: ink ring with an inner dot. Todo: grey ring, muted name. Selected: white lifted row, weight 600. `MiniTrail` is a read-only eight-dot strip (6px) used in list rows.

### Rows and Cards
White container, hairline border, 10px radius, card shadow; rows divided by hairlines, 14 to 18px padding, hover `surface-muted`, trailing chevron nudges 2px right and turns cobalt.

### Findings
A `details` row: stamp, title, meta (law tag, file:line), caret that rotates 90deg when open. The body shows lead text clamped to three lines, a facts grid (128px labels), a quoted trigger in serif, a prompt well in mono, and a decision form. Settled findings dim their title to muted. Legal findings open with "Check this" and show "Not legal advice".

### Duty rows (ProfessionalCard)
Name in 600 with the duty in muted meta, one reason line, a meta line (byline, paused, error), and the gate stamp at the right edge.

### Top bar status
No money in the chrome. An idle **Replay** stamp shows when model outputs are recorded; a held **Paused: budget used** stamp appears only once the copilot budget is spent. Per-run cost lives in the acceptance record.

### Inputs
40px tall, white, `border`, 6px radius. Focus: cobalt border plus a 3px cobalt ring at 22%. Segmented control: a pill track with a white selected segment.

### The Instrument (signature)
Dark `instrument` band on a 16px cobalt line grid at 8% with a slow sweep (3.4s) and a blinking current step; steps are mono 0.75rem. It appears only while the model works and is the only ambient motion in the product. Its grid is a sanctioned exception to the design detector, because it is Kryterea's pinned brand element.

### Motion
Tokens: ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, ease-in-out `cubic-bezier(0.77, 0, 0.175, 1)`; press 120ms, state 160ms, enter 220ms. Entrances rise 4px and fade. Transforms and opacity only. Reduced motion is honoured.

## Do's and Don'ts

### Do:
- **Do** show what is held and the next action first on every screen; one primary pill per view.
- **Do** use only tokens from `src/styles.css`; add a token before adding a literal. Dark mode must work by token swap alone.
- **Do** keep copy short and plain. Gates read Held / Cleared. Evidence reads Evidence found / Gap / No evidence.
- **Do** begin every legal finding with "Check this" and show "Not legal advice". Tag PCI DSS as Standard and NDPA as Law.
- **Do** pair every status colour with its stamp word, so meaning never rests on colour.
- **Do** keep 44px touch height for Trail stops on phone, and visible `:focus-visible` rings everywhere.

### Don't:
- **Don't** use the banned grading vocabulary (see the repo writing rules and PRODUCT.md) or any em or en dash, in copy or in token names. A copy guard test (`packages/web/test/copy.test.ts`) enforces this on `src/`.
- **Don't** stack every role and finding as parallel cards; the Trail picks one stage at a time.
- **Don't** use green, amber or red as decoration, or cobalt for status.
- **Don't** add ambient motion outside the Instrument, or show the Instrument when the model is idle.
- **Don't** introduce another face, a rounded stamp, a filled stamp, or a second glowing element.
- **Don't** copy from Kryterea's private repos; follow the language, write fresh.
