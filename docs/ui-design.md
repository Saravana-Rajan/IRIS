# Iris UI design direction (engineer-first)

**AI proposes. Geometry proves. The engineer decides.**

> **Status (Nov 22, 2026).** The owner's later direction replaced parts of this file, and the app follows it, not
> them: **light only** on lifemed's palette (white, ink, a lavender accent `--accent` `#b07af2`, the holographic
> `--holo` gradient for AI-made things; no dark theme, no navy, no Appearance control), and a **sidebar app shell**
> (Home, Projects, the open project's steps, Help and Settings in a left sidebar; a top bar with the page's actions and
> search) in place of §6's step rail, context bar and status bar. So §3's token values, §6, §10.1 (the first screen),
> §10.3 (corner and notch) and §10.4 (the menu) are superseded: the notch, the corner and the ☰ Menu button are gone,
> the menu's contents are in **Settings** and **Help** (both from the sidebar), and the first screen is the Home
> dashboard. What was built is in `docs/architecture/12-web-app.md` ("The app shell", "Theme and motion"). The rest
> (the proof grammar's meaning, the critique, components, accessibility) still applies where it does not contradict that.

This file is the design contract for the integration and polish agents working on `web/src`. It covers the critique of
the current app, the tokens (light and dark), type, spacing, the project shell, the component rules, motion,
accessibility, a remove/hide/keep inventory (§10), and a prioritised change list with exact selectors and variables. Everything here can be built in plain
CSS on the `index.css` custom-property system. It needs no new UI library, no CSS framework and no router (see
`docs/architecture/12-web-app.md:13-14`).

The screenshots behind the critique were taken on 22 Nov 2026 from the `main` worktree build, using headless Chromium
against the Northbank demo. They are in `/Users/vc/.claude/jobs/bf5d5cd4/tmp/ui-shots/` and are not in the repo. The
prefixes are `d-` desktop 1440×900, `t-` tablet 1024×768, `m-` phone 390×844 and `k-` OS dark mode at 1440×900.

---

## 1. Stance: drafting conventions as the interface language

Iris is coordination software for engineers, so it should read like a well-made CAD or BIM instrument rather than a SaaS
dashboard. Four decisions follow from that.

1. **The proof grammar is the one bold idea.** Drawings already have a convention: proposed work is dashed, existing
   or confirmed work is solid, and what has been issued is filled. Iris maps its principle onto that convention and
   uses it everywhere a fix, a clash status or a decision appears.

   | Voice | Meaning | Line | Colour role | Example |
   |---|---|---|---|---|
   | **AI proposes** | Provisional, not yet proven | **Dashed** outline | `--ai` (indigo) | "AI-proposed" badge, AI-drafted reason, AI-assessed severity |
   | **Geometry proves** | Measured by the geometry check | **Solid** outline, a measured number beside it | `--proved` (teal) / `--failed` (red) | "Geometry-validated ✓ · nearest +50 mm" |
   | **Engineer decides** | A recorded human decision | **Filled** | `--accent` (Iris navy) | "Accepted by R. Iyer" |
   | Unverified | No check has run | **Dotted** outline | neutral | "Unverified" |

   The brand navy belongs to the human. Navy is the colour of decisions and of the primary action, and AI output never
   wears it.
2. **The stage is the hero.** The 3D model sits in the middle and the panels are instruments around it. Panels are
   flat, separated by hairlines and carry no shadow. Shadows appear only on things that float above the stage:
   popovers, floating panels, dialogs and the viewer tool groups.
3. **Numbers are engineering data.** Distances, clearances, counts, GlobalIds and file names are set in IBM Plex Mono
   with tabular figures. Values carry a sign with a true minus, U+2212 (`−300 mm`, not `-300 mm`, per
   `docs/architecture/21-glossary-and-naming.md`), and always carry a unit. Labels are never set in mono.
4. **Cards mark a separate object, nothing else.** A proposal, an element side (A or B), a dialog and a floating panel
   are objects and may be cards. A group of statistics, an insight list or a call to action is a section inside a
   panel, divided by a hairline.

What stays quiet is everything else: neutral cool greys taken from the brand paper and line colours, one weight
contrast (400 against 600), radii of 3–8 px, no gradients, no glows and no ambient motion except while work actually
runs.

The landing page (`web/src/landing/`) keeps its own dark, marketing look and is out of scope, apart from one
phone-overflow fix (P2-5).

---

## 2. Critique of the current app

### Top 10 issues

| # | Issue | Evidence | Where |
|---|---|---|---|
| 1 | **There is no dark theme.** With the OS in dark mode the app looks the same as in light mode. Users also go from a fully dark landing straight into a bright app. The stage colour, the primary-button text, tooltips, scrims and thumbnails are hard-coded. | `k-04-workspace.png` (OS dark) is identical to `d-04-workspace.png`. `d-01-landing.png` is dark, then `d-04` is light | `index.css:1-12` has light values only. `index.css:190` sets `color-scheme: light`. `viewer/Viewer.ts:259` hard-codes `#dfe6ee`. There are 318 literal colours outside `:root` |
| 2 | **The visual hierarchy points at the wrong action.** The heaviest thing on screen is the navy **Export IFC** button, before anything has been reviewed. The empty inspector shows a disabled primary button and two disabled outline buttons. The triage call-to-action card (2 px navy ring, shadow, full-width primary button) competes with both. That makes three navy blocks and no clear next step. | `d-04-workspace.png`, `k-05-clash.png` | `.corner .btn.primary` (`index.css:265`), `.triage.idle` ring (`:873`), `ClashPanel.tsx` empty branch |
| 3 | **The clash list hides what triage needs.** At 310 px a title is cut to about 20 characters ("Supply air main run…"). On hover and on the selected row, the absolutely positioned `.row-actions` covers the title and the distance ("#1 Supply air" followed by icons), and its tooltip covers the next row. A row shows no class, severity, status or level. A green dot (`.dot.both`) has no visible meaning. Some thumbnails are images and others are empty grey squares. | `d-05-clash.png`, `k-05-clash.png`, `d-04-workspace.png` | `index.css:517-545`, `:522-525`, `:932-936`; `ReportList.tsx:330-360` |
| 4 | **Status, severity and AI vocabulary disagree.** There are three chip systems: `.pchip`, `.chip` and `.pcard-state`. "Open" is amber in `projects.css:42` but neutral in `coordination.css:72`. AI is marked navy in `CoordinationOverview` but indigo in `ProposalCard`. Labels vary for the same state: "Unresolved" against "Open", "Resolved" against "Resolved by geometry", and "By design" against "Reviewed: by design". In the current app the status is a grey "new" pushed to the far right, and "in model" uses the success green, which reads as "validated". | `d-05-clash.png` (header) | `projects.css:40-44`, `coordination.css:65-73`, `proposal.css:11-16`, `ProjectOverview.tsx:257,274-275`, `projectsApi.ts:190` |
| 5 | **Disabled buttons look broken and do not say why.** `.btn:disabled { opacity: .45 }` turns a navy primary into a washed slate-blue with white text at 2.6:1. "Add 0 models" is shown as a button label. | `d-04` (Propose fixes), `d-08-report.png` (Build the report), `m-07-menu.png` (Add 0 models) | `index.css:398`, `:403` |
| 6 | **Cards are overused and nested.** The Insights tab has a bordered notice, a shadowed "Coordinate the models" card, and an "Insights" card holding root-cause cards that hold chips. That is three card styles and cards three deep. `.coord` adds a fourth style (12 px radius plus shadow) while the rest use 8 px and no shadow. | `d-09-insights.png` | `coordination.css:5-6`, `index.css:576`, `:813-870` |
| 7 | **There is too much chrome and too many unlabelled tools.** The stage rail has 20 icon-only buttons in 4 floating groups, explained only by hover tooltips. Every dock group shows collapse, float and pop-out icons all the time, which adds 9 icons across 3 headers. The clash chip on the stage repeats the inspector title, truncated. The Activity drawer takes about 120 px to show an empty "You" lane. | `d-04-workspace.png`, `d-05-clash.png` | `.rail`/`.rail-group` (`index.css:446-447`), `.dock-actions` (`:63`), `.pane-head .clash-chip` (`:336`) |
| 8 | **The stage opens on the wrong content.** It opens on the site context (buildings, trees, water) at full saturation, while the MEP content that coordination is about stays invisible until a clash is picked. The first click on an empty part of the stage floats an empty 360×560 Properties panel over half the model ("Click any element in the model to see its properties."). | `d-04-workspace.png`, `k-06-viewer-xray.png` | `.props` (`index.css:469`), the dock Properties panel default (`docs/panels.md:23-33`) |
| 9 | **Typography has no scale.** There are 23 distinct px sizes (10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17 and more); 12.5 px alone appears 85 times. Weights 500 and 700 are requested 35 times, but `index.html:16` loads only Sans 400/600 and Mono 400, so 500 renders as 400 and Mono bold is synthesised. Tracked uppercase labels come in four different recipes. Distances use a hyphen-minus. | `d-05-clash.png` ("Found by Iris -300 mm") | `index.css` (all files), `web/index.html:16`, `projects.css:22,49`, `coordination.css:24`, `proposal.css` `.pcard-kind`, `model-summary.css` `.msum-group th` |
| 10 | **The phone layout wastes space and confuses.** Two tab bars are stacked (sheet tabs Clashes · Fix · Plan · Chat, then Clashes · Insights), using about 200 of 844 px. "Go to clash" sits as a disabled pill. The menu lists the same files twice ("Add to the open models", then "Open instead") as long checkbox lists. On the landing at 390 px the hero caption runs off the screen ("transfer girder, 1000 dee…"). | `m-04-workspace.png`, `m-07-menu.png`, `m-01-landing.png` | `.sheet-tabs` (`index.css:1831`), `.left-tabs` (`:1965`), `AppMenu.tsx` models section, `landing/Hero.tsx` |

### Other findings (secondary)

- **Report dialog** (`d-08-report.png`, `m-08-report.png`):
  - The intro is a 5-line paragraph.
  - The prerequisite "Triage all" sits in an amber box above a disabled primary button.
  - The disabled reason should sit on the button row as one line. The intro should be one sentence, with details in a `<details>`.
- **Focus.** Offsets are 0, 1, 2, 3, −2, −3 and −4 px. Six `all: unset` controls have no focus style at all (`.pset-link`, `.pick-clear`, `.saved-view .link`, `.row-view`, `.noclash-card .link`, `.sheet-peek-text`), and `.oa-scroll` removes the outline without a replacement (`index.css:1370`).
- **Containers and queries.** Docked components use viewport media queries (`coordination.css` at 520 px, `proposal.css` at 480 px) even though they live in resizable panels. They should use container queries, like `import.css` and `model-summary.css` already do.
- **Token debt.**
  - `--accent`, `--accent-ink` and `--navy` are all `#052640`, so `.btn.primary:hover` (`index.css:393`) is a no-op.
  - The old accent `#2f5d8a` / `rgba(47,93,138,…)` survives in 9 places.
  - The amber/teal/magenta status trio is defined three times with different values (`index.css:926-928`, `:1367`, `:1140`).
- **Generic class collisions.** `.left`/`.right`, `.pick`, `.seg` and `.ok/.bad/.warn/.small` leak into compound selectors. See the dead-CSS list in P2-6.
- **Duplicated helpers in the new files.**
  - Two file-size formatters: `ImportPanel.tsx:20` (decimal "kB") and `projectsApi.ts:168` (binary "KB"), so the same file shows two sizes.
  - Three `plural` helpers.
  - Three wordings of "PDF not supported".
- **What works and should be kept.**
  - The A-red / B-green viewer colouring.
  - X-ray context (`d-05-clash.png`).
  - The A/B/C evidence strip.
  - The mono distance with tolerance.
  - The load card (`m-03-loading.png`).
  - The phone sheet's single next action ("Propose fixes" in the peek line, `m-05-clash.png`).
  - The flat table language of `ProjectsHome` and `ImportPanel`.

---

## 3. Tokens

> Superseded (Nov 22): the app is light only on the lifemed tokens in `index.css :root`; see the status note at the top.

All tokens live in `index.css :root`. Existing names stay valid: they are kept as aliases, so the new component CSS
files and the 2,000 existing rules keep working. The theme resolves in this order: `[data-theme="dark"]` (explicit),
then OS dark unless `[data-theme="light"]` is set, then light.

### 3.1 Colour roles

| Role | Token | Light | Dark | Use |
|---|---|---|---|---|
| App background | `--bg` | `#f5f7f8` (brand Paper) | `#0a1622` | Behind panels, page background, hover fill of ghost controls |
| Surface | `--surface` | `#ffffff` | `#0f1d2b` | Panels, inspector, rail, context bar, cards |
| Raised | `--raised` | `#fbfcfd` | `#142536` | Hover rows, wells inside a surface, drop zones |
| Sunken | `--sunken` | `#eef2f5` | `#0c1925` | Input backgrounds (optional), bar tracks, segmented-control track |
| Hairline | `--line` | `#dde3e7` (brand Line) | `#24384d` | Dividers, panel borders, table rules |
| Soft hairline | `--line-soft` | `#ebeff2` | `#1a2b3c` | Row separators inside lists |
| Strong line | `--line-strong` | `#c3ccd7` | `#34495f` | Button border on hover, selected outlines (replaces literal `#c3ccd7`) |
| Control border | `--control-border` | `#7c8b98` | `#5a7189` | Checkbox, radio, input, unverified dotted outline (3:1, WCAG 1.4.11) |
| Ink | `--ink` | `#11161b` (brand Ink) | `#e6eef6` | Primary text |
| Ink 2 | `--ink-2` | `#33414d` | `#c3d0dc` | Body copy, secondary values (replaces `#33414f` ×9) |
| Muted | `--muted` | `#52636e` (brand Muted) | `#9fb3c6` | Labels, meta, column headers |
| Faint | `--faint` | `#5e6d7a` | `#7f95a9` | Placeholders, timestamps, the "of N" counts |
| Accent (Iris navy) | `--accent` | `#052640` | `#9cc4ea` | Primary button fill, active step, links, focus |
| Accent hover | `--accent-hover` | `#0d3a5f` | `#b8d6f2` | Primary hover (fixes the no-op hover) |
| Accent soft | `--accent-soft` | `#e3eaf0` | `#16314a` | Selected row, active rail step, toggled icon button |
| Accent ink | `--accent-ink` | `#052640` | `#cfe0f0` | Text on `--accent-soft` |
| Accent line | `--accent-line` | `#b6c6d6` | `#2c4c6b` | Outline of navy-outlined chips and selected cards |
| On accent | `--on-accent` | `#ffffff` | `#052640` | Text and icons on `--accent` fills (replaces literal `#fff` on primaries) |
| Brand mark | `--navy` | `#052640` | `#052640` (fill) | **Brand only**: app-icon tile, logo fill. Never use it as a text colour, because it disappears in dark mode |
| Brand mark on surface | `--brand-mark` | `#052640` | `#ffffff` | Logo in the rail's brand slot (`iris-mark-light` / `-dark`) |
| Focus | `--focus` | `#052640` | `#9cc4ea` | 2 px focus ring |
| Scrim, soft | `--scrim-soft` | `rgba(10,14,20,.28)` | `rgba(0,0,0,.45)` | Drawer scrim |
| Scrim | `--scrim` | `rgba(10,14,20,.45)` | `rgba(0,0,0,.6)` | Dialog and menu scrim, tour dim |
| Scrim, strong | `--scrim-strong` | `rgba(10,14,20,.82)` | `rgba(0,0,0,.88)` | Lightbox |
| Inverse | `--inverse-bg` / `--inverse-ink` | `#18212c` / `#ffffff` | `#e6eef6` / `#0a1622` | Tooltips, toasts, selection bar |
| Disabled | `--disabled-bg` / `--disabled-ink` | `#eef1f4` / `#7c8b98` | `#182a3b` / `#6f879d` | Disabled controls (never use opacity) |
| Stage | `--stage-bg` | `#dfe6ee` | `#18232f` | Three.js scene background, dock-switch cover |
| Evidence frame | `--evidence-bg` | `#e9eef3` | `#e9eef3` | Behind A/B/C images and thumbnails. **The same in both themes**, because clash pictures must not change with style (`docs/views.md:366-371`) |

### 3.2 Semantic roles: the proof grammar, statuses and severity

| Role | Token (text / soft fill / line) | Light | Dark | Line style |
|---|---|---|---|---|
| **AI-proposed** | `--ai` / `--ai-soft` / `--ai-line` | `#4b4fb3` / `#eeeffb` / `#c9cbf1` | `#aeb2f7` / `#1d2347` / `#343b72` | **dashed** `--ai` |
| **Geometry-validated**, resolved by geometry | `--proved` / `--proved-soft` / `--proved-line` | `#0b6f7d` / `#e2f5f7` / `#9fd9e1` | `#4fd6e6` / `#0e3238` / `#1d5a63` | solid |
| Proof mark (glyphs, bars, 3D "passed") | `--proved-mark` | `#12b5cb` | `#12b5cb` | n/a |
| **Failed validation** | `--failed` / `--failed-soft` / `--failed-line` | `#b8352a` / `#fbeceb` / `#efc4bf` | `#ff8a80` / `#3a1a1c` / `#6b2b2b` | solid |
| **Unverified** | `--muted` text on transparent | (see muted) | (see muted) | **dotted** `--control-border` |
| **Engineer decision** (accepted) | `--accent` fill, `--on-accent` text | navy | light navy | **filled** |
| Pending: fix kept, awaiting re-check | `--warn` / `--warn-soft` / `--warn-line` | `#9a6100` / `#fbf1df` / `#ecd9b4` | `#f2c260` / `#33280f` / `#5c4818` | solid, half-ring glyph ◐ |
| Open | `--ink` text, `--control-border` outline | | | solid hollow, ring glyph ○ |
| Reviewed: by design | `--muted` text, `--line` outline | | | solid, glyph ⊘ |
| Sent to author | `--accent` text, `--accent-line` outline | | | solid, glyph ↗ |
| Severity high / medium / low / none | `--sev-high` / `--sev-med` / `--sev-low` / `--faint` | `#b8352a` / `#9a6100` / `#52636e` | `#ff8a80` / `#f2c260` / `#9fb3c6` | 3/2/1/0-bar meter |
| Info (neutral notices) | `--info` / `--info-soft` | `#1f5d93` / `#e6f0f9` | `#8cc0f0` / `#132d45` | solid |

**Legacy aliases.** These stay in `:root` so that existing rules keep working:

- `--ok: var(--proved)` and `--ok-soft: var(--proved-soft)`. In Iris, success means "geometry said yes"; the 3D side-B green stays out of the UI.
- `--fail: var(--failed)` and `--fail-soft: var(--failed-soft)`.
- `--warn` keeps its own value (above).
- `--spark: var(--ai)`, `--spark-soft: var(--ai-soft)`, `--spark-line: var(--ai-line)`.
- `--passed: var(--proved-mark)`.
- `--raised` and `--edge` keep their values.
- `--wonder*` and `--image*` stay as Workings actor colours, with the dark values below.

**Rules for colour.**

- **Colour never stands alone.** Every state also has a glyph and a word: ✓ validated, ✕ failed, ? unverified, ○ open, ◐ pending, ⊘ by design, ↗ to author.
- **Open is neutral.** About 400 of 464 clashes are open, so "open" must not shout. Attention comes from severity and class instead. This means `.pchip.open` and `.proj-step-n.open` lose their amber.
- **AI is marked with `--ai`, everywhere.** That covers AI-assessed severity, AI-drafted reasons, AI titles and chips from the model. Navy is never used for AI.

### 3.3 Reserved viewer colours

These match `viewer/Viewer.ts:18-22,71,158-195` and `docs/architecture/13-3d-viewer.md`. They are the same in both
themes. UI swatches must use these variables, and no UI role may reuse them.

```css
--vw-a: #d0342c;      /* side A (alias of --red) */
--vw-b: #1f9d3a;      /* side B (alias of --green) */
--vw-both: #8e44ad;   --vw-selected: #2f8fdf;  --vw-hit: #e040fb;   --vw-before: #e67e22;
--vw-trying: #f5a623; /* alias --trying */      --vw-passed: #12b5cb; --vw-context: #b9c2cc;
```

### 3.4 Verified contrast

These ratios were computed with WCAG 2.x relative luminance. All text pairs reach 4.5:1 or more, and control borders
reach 3:1 or more.

| Pair | Light | Dark |
|---|---|---|
| ink / surface | 18.2 | 14.6 |
| ink-2 / surface | 10.5 | 10.9 |
| muted / surface (and / bg) | 6.2 (5.8) | 7.9 (8.5) |
| faint / surface (and / bg) | 5.3 (4.95) | 5.5 |
| on-accent / accent (primary button) | 15.5 | 8.5 |
| accent-ink / accent-soft | 12.7 | 9.9 |
| proved / surface; / proved-soft | 5.9; 5.2 | 9.8; 7.9 |
| failed / surface; / failed-soft | 5.9; 5.1 | 7.5; 6.8 |
| warn / surface; / warn-soft | 5.1; 4.6 | 10.3; 8.7 |
| ai / surface; / ai-soft | 6.8; 6.0 | 8.5; 7.6 |
| control-border / surface | 3.5 | 3.4 |
| inverse-ink / inverse-bg (tooltip) | 16.2 | 15.6 |

### 3.5 The token block, ready to paste into `index.css`

This replaces `index.css:1-12`. Keep the base rules on the `:root` line, which are `font-family`, `color`,
`background` and `font-size`, as written below.

```css
:root {
  color-scheme: light;
  /* Surfaces and lines */
  --bg: #f5f7f8; --surface: #ffffff; --raised: #fbfcfd; --sunken: #eef2f5;
  --line: #dde3e7; --line-soft: #ebeff2; --line-strong: #c3ccd7; --control-border: #7c8b98;
  /* Text */
  --ink: #11161b; --ink-2: #33414d; --muted: #52636e; --faint: #5e6d7a;
  /* Brand and accent */
  --navy: #052640; --brand-mark: #052640;
  --accent: #052640; --accent-hover: #0d3a5f; --accent-soft: #e3eaf0; --accent-ink: #052640; --accent-line: #b6c6d6;
  --on-accent: #ffffff; --focus: #052640;
  /* Proof grammar */
  --ai: #4b4fb3; --ai-soft: #eeeffb; --ai-line: #c9cbf1;
  --proved: #0b6f7d; --proved-soft: #e2f5f7; --proved-line: #9fd9e1; --proved-mark: #12b5cb;
  --failed: #b8352a; --failed-soft: #fbeceb; --failed-line: #efc4bf;
  --warn: #9a6100; --warn-soft: #fbf1df; --warn-line: #ecd9b4;
  --info: #1f5d93; --info-soft: #e6f0f9;
  --sev-high: var(--failed); --sev-med: var(--warn); --sev-low: var(--muted);
  /* Legacy aliases (keep) */
  --ok: var(--proved); --ok-soft: var(--proved-soft); --fail: var(--failed); --fail-soft: var(--failed-soft);
  --spark: var(--ai); --spark-soft: var(--ai-soft); --spark-line: var(--ai-line);
  --wonder: #5b3c99; --wonder-ink: #432a78; --wonder-soft: #efe8fb; --wonder-line: #d8cbef;
  --image: #9c3a6b; --image-soft: #f9ecf3; --image-line: #ecc9da;
  --you: #8592a3; --edge: #b0bac6;
  /* Viewer roles (same in both themes) */
  --red: #d0342c; --green: #1f9d3a; --vw-a: var(--red); --vw-b: var(--green); --vw-both: #8e44ad;
  --vw-selected: #2f8fdf; --vw-hit: #e040fb; --vw-before: #e67e22; --trying: #f5a623; --vw-trying: var(--trying);
  --passed: var(--proved-mark); --vw-passed: var(--proved-mark); --vw-context: #b9c2cc;
  /* Overlays, inverse, disabled, stage */
  --scrim-soft: rgba(10, 14, 20, .28); --scrim: rgba(10, 14, 20, .45); --scrim-strong: rgba(10, 14, 20, .82);
  --inverse-bg: #18212c; --inverse-ink: #ffffff;
  --disabled-bg: #eef1f4; --disabled-ink: #7c8b98;
  --stage-bg: #dfe6ee; --evidence-bg: #e9eef3;
  /* Elevation: only for things that float above the stage */
  --shadow-1: 0 1px 2px rgba(16, 24, 40, .06), 0 2px 8px rgba(16, 24, 40, .06);   /* stage tool groups, chips on the stage */
  --shadow-2: 0 4px 16px rgba(16, 24, 40, .12), 0 1px 3px rgba(16, 24, 40, .08);  /* popovers, menus, tooltips */
  --shadow-3: 0 12px 32px rgba(16, 24, 40, .18), 0 2px 8px rgba(16, 24, 40, .10); /* floating panels, dialogs */
  --shadow: var(--shadow-1);
  /* Type */
  --font-ui: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --body: var(--font-ui); --mono: var(--font-mono);
  --fs-11: 11px; --fs-12: 12px; --fs-13: 13px; --fs-14: 14px; --fs-16: 16px; --fs-20: 20px; --fs-24: 24px;
  --lh-11: 16px; --lh-12: 16px; --lh-13: 18px; --lh-14: 20px; --lh-16: 22px; --lh-20: 26px; --lh-24: 30px;
  /* Space, size, radius */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px;
  --h-badge: 20px; --h-sm: 28px; --h-md: 32px; --h-lg: 40px; --h-touch: 44px;
  --row: 32px; --row-2line: 52px;
  --r-xs: 3px; --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --radius: var(--r-md);
  /* Shell */
  --rail-w: 72px; --context-h: 44px; --status-h: 28px; --list-w: 340px; --inspector-w: 400px;
  /* Motion */
  --dur-1: 120ms; --dur-2: 180ms; --dur-3: 240ms; --ease: cubic-bezier(.2, .7, .2, 1);
  /* Z scale (replaces ad-hoc 1…5000) */
  --z-stage-ui: 4; --z-stage-top: 6; --z-drawer: 30; --z-dialog: 40; --z-menu: 45; --z-tour: 60; --z-tooltip: 200;

  font-family: var(--font-ui); color: var(--ink); background: var(--bg); font-size: var(--fs-14);
}

/* Dark: explicit choice, or the OS unless the user chose light. Both blocks hold the same values. */
:root[data-theme="dark"] { /* DARK VALUES */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* DARK VALUES */ } }
```

`DARK VALUES` is the same list in both places:

```css
  color-scheme: dark;
  --bg: #0a1622; --surface: #0f1d2b; --raised: #142536; --sunken: #0c1925;
  --line: #24384d; --line-soft: #1a2b3c; --line-strong: #34495f; --control-border: #5a7189;
  --ink: #e6eef6; --ink-2: #c3d0dc; --muted: #9fb3c6; --faint: #7f95a9;
  --brand-mark: #ffffff;
  --accent: #9cc4ea; --accent-hover: #b8d6f2; --accent-soft: #16314a; --accent-ink: #cfe0f0; --accent-line: #2c4c6b;
  --on-accent: #052640; --focus: #9cc4ea;
  --ai: #aeb2f7; --ai-soft: #1d2347; --ai-line: #343b72;
  --proved: #4fd6e6; --proved-soft: #0e3238; --proved-line: #1d5a63;
  --failed: #ff8a80; --failed-soft: #3a1a1c; --failed-line: #6b2b2b;
  --warn: #f2c260; --warn-soft: #33280f; --warn-line: #5c4818;
  --info: #8cc0f0; --info-soft: #132d45;
  --wonder: #c3aef5; --wonder-ink: #d9cbfa; --wonder-soft: #251d3d; --wonder-line: #3d3163;
  --image: #f0a3c8; --image-soft: #3a1a2b; --image-line: #5c2d45;
  --you: #7f95a9; --edge: #4a5f75;
  --scrim-soft: rgba(0, 0, 0, .45); --scrim: rgba(0, 0, 0, .6); --scrim-strong: rgba(0, 0, 0, .88);
  --inverse-bg: #e6eef6; --inverse-ink: #0a1622;
  --disabled-bg: #182a3b; --disabled-ink: #6f879d;
  --stage-bg: #18232f;
  --shadow-1: 0 1px 2px rgba(0, 0, 0, .4), 0 2px 8px rgba(0, 0, 0, .3);
  --shadow-2: 0 4px 16px rgba(0, 0, 0, .45), 0 1px 3px rgba(0, 0, 0, .4);
  --shadow-3: 0 12px 32px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4);
```

**Theme switch.** Add a small `theme.ts` that `main.tsx` imports before render. Menu › Panels and layout gets a
three-way control: **System · Light · Dark**.

```ts
const KEY = "iris.theme";                       // per-viewer convenience only
export function applyTheme(t: "system" | "light" | "dark") {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  try { t === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch { /* private mode */ }
  window.dispatchEvent(new Event("iris:theme"));
}
try { const t = localStorage.getItem(KEY); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch { /* ignore */ }
```

**Viewer.** `viewer/Viewer.ts:259` should read `--stage-bg` and re-read it on two events: `iris:theme`, and
`matchMedia("(prefers-color-scheme: dark)")` changes.

```ts
const stageBg = () => getComputedStyle(document.documentElement).getPropertyValue("--stage-bg").trim() || "#dfe6ee";
this.scene.background = new THREE.Color(stageBg());
```

The captures at `Viewer.ts:2088` and `:2185` (paper, ids) stay as they are: evidence pictures do not change with the
theme.

---

## 4. Typography

**Families.** IBM Plex Sans is the UI face and IBM Plex Mono is the data face. Plex is already loaded, already brand
(`og.svg`) and carries an engineering heritage. Load the weights that are actually used. `web/index.html:16` becomes:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
```

**Weights.** Use 400 for text, 500 for labels and ghost buttons, and 600 for titles, buttons and emphasised numbers.
**Do not use 700**: there are 18 rules with 700, so map them to 600. In mono, use 400 or 500 only.

**Scale.** Seven steps on a 4 px baseline replace the 23 sizes in use today.

| Token | Size / line | Use | Replaces |
|---|---|---|---|
| `--fs-11` | 11 / 16 | Badges, column headers, rail labels, status bar, meta | 8.5, 9.5, 10, 10.5, 11 |
| `--fs-12` | 12 / 16 | Secondary text, chips, dense table cells, hints | 11.5, 12 |
| `--fs-13` | 13 / 18 | **Default panel text**, list rows, buttons, inputs on desktop | 12.5, 13 |
| `--fs-14` | 14 / 20 | Body copy, dialog body, sheet peek line | 13.5, 14, 14.5 |
| `--fs-16` | 16 / 22 | Inspector title (clash title), dialog title, phone inputs (iOS zoom) | 15, 15.5, 16, 16.5, 17 |
| `--fs-20` | 20 / 26 | Page title: Projects, project name on Overview | 18, 19, 21, 22 |
| `--fs-24` | 24 / 30 | Key figures on Overview only (open / resolved), never as decoration | 26, 32 |

**Rules.**

- **Sentence case everywhere.** Remove `text-transform: uppercase` and tracking from these labels: `.proj-table th`, `.proj-card h2`, `.proj-eyebrow`, `.coord-group h4`, `.pcard-kind`, `.imp-table th`, `.msum-group th`, `.opt-kind`, `.clash-head-ai`, `.pcard-ai`. Set them as `font: 600 var(--fs-11)/var(--lh-11) var(--font-ui); color: var(--muted); letter-spacing: 0`.
- **Mono is for values only.** Distances, clearances, deltas, counts in tables, GlobalIds, file names, hashes and timings are mono. Labels, units in prose and buttons are not. Always add `font-variant-numeric: tabular-nums` (the `.mono` utility already does).
- **Signed values** use U+2212: `−300 mm`, `+50 mm`, `±0 mm`. Format them in one helper (`coordination.ts` `distanceText` is the place), and never with `toFixed` alone.
- **Line length.** Prose in dialogs and on pages stays under 72 ch: `max-width: 72ch` on `.report-dialog p`, `.proj-text`, `.page p`.
- **Truncation.** Titles truncate on one line in lists only. In the inspector, titles wrap to as many lines as they need.
- **No headline decoration** in the app: no accent word, no gradient text.

---

## 5. Spacing and density

- **The grid is 4 px.** Use the `--sp-*` tokens. The only half step allowed is 2 px, between an icon and its label inside a badge.
- **Panel padding.** Inspector and list sections use `12px 16px` (`--sp-3 --sp-4`). Page bodies use `24px 32px` (`--sp-6 --sp-8`). Dialogs use `20px 24px`.
- **Gaps.** Between sections: 0 plus a hairline (sections separate with `border-top: 1px solid var(--line)`, not with margins). Inside a section: `--sp-2`. Between form rows: `--sp-3`.
- **Control heights.**

  | Control | Height |
  |---|---|
  | Badge | 20 |
  | Small button, input, chip | 28 |
  | Default button and input | 32 |
  | Shell primary and context-bar buttons | 40 |
  | Touch (`pointer: coarse`) | 44 |

- **Rows.**

  | Row | Height |
  |---|---|
  | Table row | 32 (`--row`) |
  | Clash list row, two lines | 52 (`--row-2line`) |
  | Compact density | 28 |

  `[data-density="compact"]` on `.shell` drops `--row` to 28 px and `--row-2line` to 44 px (P2).
- **Radii.**

  | Token | Value | Used for |
  |---|---|---|
  | `--r-xs` | 3 | Badges, tags, kbd |
  | `--r-sm` | 6 | Buttons, inputs, chips, list rows, segmented controls |
  | `--r-md` | 8 | Cards, popovers, stage tool groups, floating panels |
  | `--r-lg` | 12 | Dialogs, the phone sheet, the load card |

  `999px` is only for `.count` (numeric pills) and progress bars. `50%` is only for dots.
- **Icons.** Lucide at 16 px in buttons and rows, 20 px in the rail, 14 px inside badges and small buttons, stroke 1.75. Stop mixing 13, 14 and 15 px in the same component.

---

## 6. The app shell

> Superseded (Nov 22): built as a sidebar shell (`AppShell.tsx`, `frame.css`), not this rail and context bar; see the
> status note at the top.

### 6.1 Desktop (above 1100 px)

```
┌──────┬──────────────────────────────────────────────────────────────────────────────────────┐
│ [◎]  │ Projects / Northbank riverside / Clash review      ◐ Iris is checking option 2 of 3   [Export IFC] [⋯] │ 44  context bar
│ logo ├─────────────────┬──────────────────────────────────────────────┬─────────────────────┤
│ slot │ CLASH LIST 340  │                                              │ INSPECTOR 400       │
│──────│ Clashes 464 ▾   │  ┌──┐ view tools (labelled groups)           │ #1   ‹ ›   ○ Open   │
│ ▣    │ [filter……… ]    │  │  │            ┌ clash chip ┐            │ Supply air main     │
│Over- │ ─────────────── │  └──┘                                       │ runs through …      │
│view  │ #1 Supply air…  │                                              │ Actual · ▮▮▮ High AI│
│ ▣    │  ○ Open ▮▮▮ L02 │               3D STAGE                       │ ┌ −300 mm │ 1 mm │ L02┐│
│Models│ #2 Cable tray…  │           (--stage-bg)                       │ A ▌Supply air main…  │
│ ▣    │  ◐ Kept ▮▮ L02  │                                              │ B ▌Transfer girder…  │
│Coord.│ …               │                                     ┌cube┐   │ Evidence [A][B][C]   │
│ ■ 37 │                 │                                     └────┘   │ Fixes · 2 of 3 passed│
│Clash │                 ├──────────────────────────────────────────────┤ ┌ ✓ validated ─────┐ │
│review│                 │ ACTIVITY (collapsed to 0; opens 240–380)     │ └──────────────────┘ │
│ ▣    │                 │                                              │ ┊ AI-proposed ┊      │
│Report│                 │                                              ├─────────────────────┤
│──────│                 │                                              │ [Propose fixes] ⋯   │ sticky action bar
│Activ.│                 │                                              │                     │
├──────┴─────────────────┴──────────────────────────────────────────────┴─────────────────────┤
│ 4 models · 1,732 elements · mm · tolerance 1 mm · 2 selected · Gemini idle                   │ 28  status bar
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Structure.** `.shell` is a CSS grid that holds the existing `.app` (dockview) in its main cell. Dockview keeps
owning the list, stage, inspector and activity groups. The shell adds the rail, the context bar and the status bar
around it.

```css
.shell { height: 100%; display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr);
  grid-template-rows: var(--context-h) minmax(0, 1fr) var(--status-h);
  grid-template-areas: "rail context" "rail main" "rail status"; background: var(--bg); }
.shell-rail { grid-area: rail; display: flex; flex-direction: column; gap: 2px; padding: 8px 6px;
  background: var(--surface); border-right: 1px solid var(--line); overflow-y: auto; }
.brand-slot { width: 40px; height: 40px; margin: 0 auto 8px; display: grid; place-items: center;
  border-radius: var(--r-md); color: var(--brand-mark); }
.brand-slot svg { width: 28px; height: 28px; }        /* placeholder: IrisMark; the supplied logo drops in here */
.rail-step { all: unset; box-sizing: border-box; position: relative; display: grid; justify-items: center; gap: 4px;
  padding: 8px 2px 7px; border-radius: var(--r-sm); cursor: pointer; text-align: center;
  font: 500 var(--fs-11)/14px var(--font-ui); color: var(--muted); }
.rail-step svg { width: 20px; height: 20px; }
.rail-step:hover { background: var(--raised); color: var(--ink); }
.rail-step[aria-current="page"] { background: var(--accent-soft); color: var(--accent-ink); }
.rail-step[aria-current="page"]::before { content: ""; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 3px;
  border-radius: 0 2px 2px 0; background: var(--accent); }
.rail-step:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.rail-step .count { position: absolute; top: 3px; right: 6px; }
.rail-sep { height: 1px; margin: 6px 8px; background: var(--line); }
.rail-spacer { flex: 1; }
.shell-context { grid-area: context; display: flex; align-items: center; gap: var(--sp-3); min-width: 0;
  padding: 0 var(--sp-3) 0 var(--sp-4); background: var(--surface); border-bottom: 1px solid var(--line); }
.shell-context .crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--fs-13); color: var(--muted); }
.shell-context .crumbs b { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shell-context .run { margin-inline: auto; }          /* the notch's live status moves here */
.shell-main { grid-area: main; position: relative; min-width: 0; min-height: 0; }
.shell-status { grid-area: status; display: flex; align-items: center; gap: var(--sp-4); padding: 0 var(--sp-3);
  background: var(--surface); border-top: 1px solid var(--line); font: var(--fs-11)/var(--lh-11) var(--font-ui); color: var(--muted); }
.shell-status .mono { color: var(--ink-2); }
```

**Rail.**

- **Order.** The brand slot comes first, then **Projects**, then a separator, then the project steps in sequence (**Overview · Models · Coordination · Clash review · Reports**), then a spacer, then **Activity**, then Menu.
- **Labels.** Every rail item always shows its label. Nothing hides behind hover (`docs/mobile.md` rule 2).
- **Counts.** Clash review carries a `.count` of open clashes.
- **Keyboard.** ↑ and ↓ move between steps and Enter opens one; this replaces ←/→ on today's `.proj-steps`.
- **Changes to ProjectSteps.** In `ProjectOverview.tsx:16-65`, `ProjectSteps` moves from `.proj-stepbar` to `.shell-rail`. Its crumbs move to `.shell-context .crumbs`.
- **Logo.** The placeholder is the current `IrisMark` at 28 px, in `--brand-mark`. The supplied logo replaces the SVG inside `.brand-slot` and nothing else. Clear space is a quarter of the mark's height (`docs/brand-assets.md`).

**Context bar.**

- **Left:** crumbs.
- **Centre:** the live run line. This is the notch's `role=status` content from `Brand.tsx` `Notch`, as a 28 px pill with the orbiting mark.
- **Right:** one primary action at most, then the requirements pill, the agent pill and the Menu button.
- **Export.** Export is a secondary `.btn` until at least one fix is kept, and becomes the primary only on the Reports step.
- **Notch and corner.** In the project shell, the notch (`.notch`, `index.css:240-253`) and the `.corner` cluster (`:262-274`) are retired. The bare-demo workspace without a project can keep them until it is migrated.

**Status bar** (desktop only). It shows open models, element count, units, the active tolerance or requirement, the
selection count and the agent state, in that order. Every number is mono. It replaces the always-open Activity strip as
the place to glance for live state. Activity opens on demand (`.dock` collapsed to 0 by default, and opened to 240 px
while a run streams, per `docs/panels.md`).

### 6.2 Which panels each step shows

The stage is never unmounted. Page steps hide it with `.shell-main[data-page] .dock-area { visibility: hidden; }`, so
the WebGL context and the models survive.

| Step (hash) | Left column | Centre | Right inspector |
|---|---|---|---|
| Projects (`#projects`) | n/a | `ProjectsHome` page, max 1120 px | n/a |
| Overview (`#project/<pid>/overview`) | n/a | `ProjectOverview` page: next step, models, coordination tally, reports, activity | n/a |
| Models | `ImportPanel` above `ModelSummary` (360 px) | Stage | Properties (docked, not floating) |
| Coordination | `CoordinationOverview` (380 px); its rows filter the list and colour the stage | Stage | Insights (root causes, patterns) |
| Clash review | Clash list (340 px) | Stage | `ClashHeader` + evidence + `ProposalCard`s + action bar |
| Reports | n/a | Report builder page (720 px column; the dialog's content, not a modal) | History of built reports |
| Activity | n/a | Workings, full width | Decisions log (who, what, when, reason) |

### 6.3 Tablet (761–1100 px) and phone (760 px and below)

**Tablet.**

- The rail narrows to 64 px. Labels stay, set at 10.5 px on up to two lines ("Clash / review").
- The list becomes the existing left drawer.
- The inspector is 360 px.
- The context bar keeps crumbs and one action. The status bar is hidden.

**Phone.**

- **No rail.** The header shows the logo slot, a step picker (`<select>` styled as a button: "Clash review ▾") and Menu.
- **Sheet.** The existing sheet stays, with **one** tab row: Clashes · Fix · Plan · Chat.
- **Insights** becomes a segmented control inside the Clashes header (`Clashes | Insights`), not a second tab bar.
- **"Go to clash"** is hidden until a clash is picked. It is not shown disabled.
- **Menu › Models** lists each file once with a three-state control (Open / Add / Off), instead of two checkbox lists.

### 6.4 The inspector in Clash review

```
.inspector            flex column, height 100%
  .clash-head         sticky top; ClashHeader: #N, prev/next, status badge, title (16/22, wraps), class / severity / level badges,
                      measure strip (dl: Overlap −300 mm · Limit 1 mm · Location L02 grid 3, mono values), sides A and B
  .evidence           A/B/C images on --evidence-bg, 3 columns, 4:3, click opens the lightbox
  .fixes              section title "Fixes" + summary "2 of 3 passed the geometry check"; ProposalCards, validated first,
                      then AI-proposed, then failed collapsed to one line each ("Offset +280 mm hit Cable tray CT-04 ✕")
  .action-bar         sticky bottom, surface + top hairline, 12px 16px: one primary (Propose fixes / Accept this fix),
                      secondary (Explore wider fix), overflow ⋯ (Try a move yourself, Go to the clash)
```

- **Sides.** A and B are not cards. Each is a row with a 3 px `--vw-a` or `--vw-b` stripe, the element name (600),
  the class in muted text, and a `dl` with File, Level and System. The GlobalId sits in a mono copy button.
- **"In model" chip.** It becomes a neutral `.tag`. It currently uses the success colour, which reads as "validated".
- **Empty inspector.** It shows one line of instruction and no disabled buttons. See §7.7.

---

## 7. Components

### 7.1 Badges, tags, chips and counts

There are four primitives, each with one job. They replace `.pchip`, `.chip.status.*`, `.chip.sev.*`, `.pcard-state`,
`.pcard-ai`, `.clash-head-ai`, `.msum-tag`, `.tv`, `.imp-stage`, `.proj-step-n`, `.proj-count` and `.badge-n`.

| Primitive | Job | Shape | Interactive |
|---|---|---|---|
| `.badge` | A **state** (proof, status, decision) | 20 px, `--r-xs`, 1 px border, glyph + word | No |
| `.tag` | **Metadata** (IFC/STEP, discipline, "by class", "AI-drafted", model name) | 18 px, `--r-xs`, no fill, 1 px `--line` | No |
| `.chip` | A **filter or toggle** (facets, "only open", class filters) | 28 px, `--r-sm`, `aria-pressed` | Yes |
| `.count` | A **number** on a tab, step or button | 16–18 px pill, mono, tabular | No |

```css
.badge { display: inline-flex; align-items: center; gap: 4px; height: var(--h-badge); padding: 0 6px; flex: none;
  border: 1px solid var(--line); border-radius: var(--r-xs); background: transparent; color: var(--ink-2);
  font: 600 var(--fs-11)/1 var(--font-ui); white-space: nowrap; }
.badge > svg { width: 12px; height: 12px; }
/* Proof grammar */
.badge.ai         { border-style: dashed; border-color: var(--ai); color: var(--ai); background: var(--ai-soft); }
.badge.proved     { border-color: var(--proved); color: var(--proved); background: var(--proved-soft); }
.badge.failed     { border-color: var(--failed); color: var(--failed); background: var(--failed-soft); }
.badge.unverified { border-style: dotted; border-color: var(--control-border); color: var(--muted); }
.badge.decided    { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.badge.decided.outline { background: transparent; color: var(--accent); border-color: var(--accent-line); } /* modified / requested another */
/* Clash status */
.badge.st-open     { border-color: var(--control-border); color: var(--ink); }
.badge.st-pending  { border-color: var(--warn-line); color: var(--warn); background: var(--warn-soft); }
.badge.st-resolved { border-color: var(--proved); color: var(--proved); background: var(--proved-soft); }
.badge.st-bydesign { border-color: var(--line); color: var(--muted); }
.badge.st-author   { border-color: var(--accent-line); color: var(--accent); }

.tag { display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 5px; border: 1px solid var(--line);
  border-radius: var(--r-xs); color: var(--muted); font: 500 var(--fs-11)/1 var(--font-ui); white-space: nowrap; }
.tag.code { font-family: var(--font-mono); font-weight: 500; }      /* IFC, STEP, NW */
.tag.ai { border-style: dashed; border-color: var(--ai); color: var(--ai); }   /* AI-drafted, AI-assessed */

.chip { display: inline-flex; align-items: center; gap: 6px; height: var(--h-sm); padding: 0 10px; border: 1px solid var(--line);
  border-radius: var(--r-sm); background: var(--surface); color: var(--ink-2); font: 500 var(--fs-12)/1 var(--font-ui); cursor: pointer; }
.chip:hover { border-color: var(--line-strong); }
.chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-ink); }

.count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: var(--sunken); color: var(--ink-2); font: 500 var(--fs-11)/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.count.strong { background: var(--accent); color: var(--on-accent); }
```

**Severity** is a meter with a word, never a coloured pill.

```html
<span class="sev high"><i></i><i></i><i></i> High <span class="tag ai">AI</span></span>
```

```css
.sev { display: inline-flex; align-items: center; gap: 2px; font: 600 var(--fs-11)/1 var(--font-ui); color: var(--sev-c, var(--muted)); }
.sev > i { width: 3px; height: 10px; border-radius: 1px; background: currentColor; opacity: .25; }
.sev.high { --sev-c: var(--sev-high); } .sev.high > i { opacity: 1; }
.sev.medium { --sev-c: var(--sev-med); } .sev.medium > i:nth-child(-n+2) { opacity: 1; }
.sev.low { --sev-c: var(--sev-low); } .sev.low > i:first-child { opacity: 1; }
.sev.unset { color: var(--faint); font-weight: 500; }          /* "Not assessed": no bars lit */
.sev > i:last-of-type { margin-right: 4px; }
```

**Words are fixed**, following `docs/engineer-workflow.md:116-120`, and are used identically in every component.

| Group | Words |
|---|---|
| Status | Open · Fix kept, awaiting re-check · Resolved by geometry · Reviewed: by design · Sent to author |
| Proof | AI-proposed · Geometry-validated · Failed validation · Unverified |
| Decision | Accepted · Rejected · Modified by hand · Requested another |
| Severity | High · Medium · Low · None · Not assessed, always followed by the `AI` tag when it came from triage |

Change `ProjectOverview.tsx:257` "Unresolved" to "Open", and in `projectsApi.ts:190` change "Resolved" to "Resolved by
geometry" and "By design" to "Reviewed: by design".

### 7.2 Tables and lists

- **Headers.** Use `font: 600 var(--fs-11)/var(--lh-11) var(--font-ui); color: var(--muted)`, in sentence case. Make the header sticky with `position: sticky; top: 0; background: var(--surface)`, and give it a bottom hairline in `--line`.
- **Cells.** Cells are 32 px tall (`--row`) with `0 12px` padding (`0 8px` in panels). Text cells are left-aligned. Numeric cells are right-aligned and mono. Status cells hold a `.badge`.
- **Row separators** are `--line-soft`. There is no zebra striping. Hover uses `--raised`. The selected row uses `--accent-soft` with a 2 px `--accent` inset on the left (`box-shadow: inset 2px 0 var(--accent)`).
- **One table recipe** serves `.proj-table`, `.proj-mini`, `.imp-table` and `.msum-table`. It lives in one shared `.table` rule in `index.css`. Each file then keeps only its column widths.

**Clash list row** (`ReportList.tsx` `.clash-row`) has two lines and a **fixed** 52 px height. The height must be fixed
because `ReportList.tsx:168` measures the first row to virtualise the list.

```
[☐] [thumb 40] #12  Supply air main runs through transfer girder at grid 3   −300 mm
               ○ Open  ▮▮▮ High AI   MEP × Structure · L02               [⊙ ✦ ✓ ⋯]   ← actions only here
```

```css
.clash-row { height: var(--row-2line); padding-left: 8px; border-radius: var(--r-sm); }
.clash-main { grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: 18px 18px; column-gap: 8px; row-gap: 4px;
  align-items: center; padding: 8px 8px 8px 0; font-size: var(--fs-13); }
.clash-main > i { display: none; }                                /* the link dot moves into the meta line as a .badge */
.clash-name { grid-row: 1; grid-column: 1; font: 600 var(--fs-13)/1 var(--font-mono); color: var(--muted); }
.clash-pair { grid-row: 1; grid-column: 2; color: var(--ink); }   /* single line, ellipsis */
.clash-main .dist { grid-row: 1; grid-column: 3; font: 500 var(--fs-12)/1 var(--font-mono); font-variant-numeric: tabular-nums; }
.clash-meta { grid-row: 2; grid-column: 2 / 4; display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden;
  font-size: var(--fs-12); color: var(--muted); }
.row-thumb { width: 40px; height: 40px; background: var(--evidence-bg); border-radius: var(--r-xs); }
.row-actions { top: auto; bottom: 4px; height: 24px; }            /* line 2 only: never covers the title or the distance */
```

**Changes to `ReportList.tsx`.**

- Wrap the `.tv`, `.fixed-label`, `.review-label` and `.row-status` siblings, plus a new status `.badge` and the
  level, in `<span className="clash-meta">`.
- Show one uniform thumbnail treatment. Missing images get the `--evidence-bg` tile, not an empty grey square.

### 7.3 Cards: only for separate objects

| Card | Treatment |
|---|---|
| `ProposalCard` (`.pcard`) | `--surface`, 1 px border **in the proof grammar** (dashed `--ai`, solid `--proved`, solid `--failed`, dotted `--control-border`), `--r-md`, padding `12px`, no shadow. Remove the 3 px `--pc-rule` stripe: the border style already carries the state. A decided card gets a filled navy header band: `.pcard-decided.d-accepted { background: var(--accent); color: var(--on-accent); }` |
| Floating panel, popover | `--surface`, 1 px `--line`, `--r-md`, `--shadow-2` (popover) or `--shadow-3` (floating) |
| Dialog | `--surface`, `--r-lg`, `--shadow-3`, a sticky header and a sticky footer that holds the primary action at the right |
| Project in `ProjectsHome` | Not a card: a table row |

**Not cards.**

- `.coord` (remove `border-radius: 12px` and `box-shadow`, `coordination.css:5-6`).
- `.proj-card` on the Overview page: make it a section with a 1 px `--line` top and a heading.
- The Insights wrapper, `.triage.idle` and the "464 clashes to sort" notice.
- Root-cause items become rows with a hairline between them, and lose their own border.

### 7.4 Buttons

```css
.btn { height: var(--h-md); padding: 0 12px; gap: 6px; border: 1px solid var(--line); border-radius: var(--r-sm);
  background: var(--surface); color: var(--ink); font: 600 var(--fs-13)/1 var(--font-ui);
  transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.btn:hover:not(:disabled) { background: var(--raised); border-color: var(--line-strong); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.ghost { background: transparent; border-color: transparent; font-weight: 500; }
.btn.ghost:hover:not(:disabled) { background: var(--raised); }
.btn.danger { color: var(--failed); }                              /* one meaning only (index.css:2068 → .btn.caution) */
.btn.small { height: var(--h-sm); padding: 0 10px; font-size: var(--fs-12); }
.btn.big { height: var(--h-lg); padding: 0 16px; font-size: var(--fs-14); }
.btn:disabled, .btn.primary:disabled { background: var(--disabled-bg); border-color: var(--disabled-bg); color: var(--disabled-ink);
  opacity: 1; cursor: not-allowed; }
.ibtn { width: var(--h-md); height: var(--h-md); border-radius: var(--r-sm); }
.ibtn:disabled { color: var(--disabled-ink); opacity: 1; }
@media (pointer: coarse) { .btn, .ibtn { min-height: var(--h-touch); } .ibtn { min-width: var(--h-touch); } }
```

**Rules.**

- **One primary per region:** the context bar, the inspector action bar, a dialog footer and an empty state each get one.
- **Labels are verbs that say what happens:** Propose fixes, Accept this fix, Build the report, Export IFC. A button whose count would be zero is not shown. Hide or replace "Add 0 models".
- **A disabled button names its reason** in a one-line `.hint` beside it, for example "Triage first: the report is ordered by triage", which also covers touch screens. It never stands alone in an empty panel.
- **Accept is enabled only for `geometry_validated`.** `proposalState.ts` `toDecision()` already enforces this, and the UI repeats it.

### 7.5 Inputs and segmented controls

- **Inputs.** Height 32 (28 small), padding `0 10px`, `--r-sm`, background `--surface`, a 1 px `--control-border` border at 3.5:1, and a placeholder in `--faint`. On focus they keep the border and add the focus ring (§9). On phone, inputs are 16 px.
- **Segmented control** (`.seg`). Use a track in `--sunken` and an on-segment in `--surface` with `--shadow-1` and ink text, **not** a navy fill. Navy is for decisions, not for view toggles. Each segment is 28 px.

### 7.6 Stage overlays

- **Tool rail** (`.rail`, `index.css:446`).
  - Groups are `--surface`, `--r-md` and `--shadow-1`.
  - Reduce the 20 top-level buttons to 4 labelled popovers plus direct toggles. The popovers are **View** (mode and style), **Cut** (section box), **Measure** and **Camera** (views, saved views). The direct toggles are Fit, Go to clash and Isolate.
  - Each popover lists its items with their key (`kbd`).
- **Clash chip** (`.pane-head .clash-chip`). Show it only when the inspector is collapsed or on tablet and phone. On desktop with the inspector open, the inspector title is the label.
- **View cube.** Keep it at 104 px with the Home button beside it. Its faces use `--surface` and `--line` so they follow the theme.
- **Dock tab actions** (`.dock-actions`). Show collapse, float and pop-out only on `.dv-tabs-and-actions-container:hover` or `:focus-within`, and always on `pointer: coarse`.

  ```css
  .dock-actions { opacity: 0; transition: opacity var(--dur-1); }
  .dv-tabs-and-actions-container:is(:hover, :focus-within) .dock-actions { opacity: 1; }
  @media (pointer: coarse) { .dock-actions { opacity: 1; } }
  ```

- **Properties** opens on the first **selection** of an element, never on a click into empty space. Until then nothing is drawn over the stage.
- **Context.** On open, the stage shows architecture and site models in the X-ray ghost (`--vw-context`) and MEP and structure shaded, so the coordination content reads first. This is a viewer default and is noted for the viewer agent.

### 7.7 Empty, loading and error states

An empty area says what will appear there, gives the one action that fills it, and shows nothing disabled.

| Area | Copy | Action |
|---|---|---|
| Inspector, no clash | "Pick a clash from the list, or double-click two elements in the model." Hint: "J / K steps through clashes." | none |
| Clash list, filter with no match | "No clashes match ‘duct L03’." | Clear filter |
| Clash list, no report | "Run a check to find where the models collide." | Check the open models |
| Projects, none | Existing `.proj-empty`; keep the flow as one line of steps (it is a real sequence, so numbers are fine) | Create project · Open the sample building |
| Models, none | "Import IFC or STEP models. Each file shows its own progress and can be retried." | Import models |
| Reports, none | "No reports yet. Reports are ordered by triage, so run it first." | Triage all, or Build the report when triage is done |
| Activity, none | "Nothing has run yet. Each run shows here: the brief, every idea, its geometry check, the ranking." | none |
| Properties, nothing selected | Not shown (see 7.6) | none |

- **Loading.** Use the existing `LoadCard` pattern, steps that report live state (`docs/brand-assets.md:46-47`). In lists, use a skeleton of three hairline rows with no shimmer animation.
- **Errors.** Use one recipe, `.alert`, in place of `.proj-alert`, `.imp-retry`, `.pcard-fail` and `.overlay.error`.

  ```css
  .alert { display: flex; gap: 8px; align-items: flex-start; padding: 8px 12px; border: 1px solid var(--failed-line);
    border-radius: var(--r-sm); background: var(--failed-soft); color: var(--ink); font-size: var(--fs-13); }
  .alert > svg { color: var(--failed); flex: none; margin-top: 2px; }
  .alert.warn { border-color: var(--warn-line); background: var(--warn-soft); } .alert.warn > svg { color: var(--warn); }
  .alert.info { border-color: var(--accent-line); background: var(--info-soft); } .alert.info > svg { color: var(--info); }
  ```

  The message says what happened and what to do next ("The server restarted and dropped your models. Open them again."). It uses no apology words.

### 7.8 Measures

Distances and clearances use a definition strip, not prose.

```html
<dl class="measure"><div><dt>Overlap</dt><dd class="mono bad">−300 mm</dd></div>
  <div><dt>Limit</dt><dd class="mono">1 mm</dd></div><div><dt>Location</dt><dd>L02 · grid 3</dd></div></dl>
```

```css
.measure { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 0; border: 1px solid var(--line); border-radius: var(--r-sm); }
.measure > div { padding: 6px 10px; } .measure > div + div { border-left: 1px solid var(--line); }
.measure dt { font: 500 var(--fs-11)/var(--lh-11) var(--font-ui); color: var(--muted); }
.measure dd { margin: 2px 0 0; font-size: var(--fs-14); font-weight: 500; color: var(--ink); }
.measure dd.bad { color: var(--failed); } .measure dd.ok { color: var(--proved); }
```

A geometry-validated proposal states its proof in one mono line: `Clear · nearest +50 mm · checked against 1,732 elements`.
That line is the only place the number appears, and it comes from the server (`docs/architecture/07-fixes-and-edits.md`).

---

## 8. Motion

| Token | Duration | Use |
|---|---|---|
| `--dur-1` | 120 ms | Hover, press, colour changes |
| `--dur-2` | 180 ms | Popover and menu open, dock-tab actions fade, row selection |
| `--dur-3` | 240 ms | Sheet snap, dialog open, Activity drawer, inspector section expand |
| (viewer) | 400–600 ms | Camera fly-to-clash, ease-out |

All of these use the easing `var(--ease)`.

**Rules.**

1. **Motion answers an action or reports live work.** No entrance animations, no stagger on lists and panels, no hover lift on cards. `.row-thumb:hover img { transform: scale(1.12) }` (`index.css:934`) goes.
2. **Ambient motion only while work runs.** The orbiting mark runs in the context-bar run line and the load card while a request is live, and **Settle** plays once when the server has kept a fix (`docs/architecture/12-web-app.md:677-679`). Nothing advances on a timer.
3. **No animation stands in for a geometry result.** A proposal card appears as "AI-proposed" (dashed) and changes to "Geometry-validated" (solid) only when the check returns. The border style switches with a 180 ms colour fade, and that is the only transition.
4. **Reduced motion.** Under `prefers-reduced-motion: reduce`, transitions become instant, the camera jumps instead of flying, and the orbit holds still. Merge the 20 scattered reduced-motion blocks into one at the end of `index.css`:

   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
       transition-duration: .01ms !important; scroll-behavior: auto !important; }
   }
   ```

---

## 9. Accessibility

- **Contrast.** Every text token pair in §3.4 reaches at least 4.5:1, and control borders reach at least 3:1. New colour literals are not allowed in component CSS: extend the guard in `tests/model-summary.test.mjs:305-310` to `projects.css`, `import.css`, `coordination.css` and `proposal.css`.
- **Focus.** There is one ring everywhere. The baseline goes in `index.css` after the reset.

  ```css
  :where(button, [role="button"], a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible {
    outline: 2px solid var(--focus); outline-offset: 2px; }
  :where(.rail-step, .seg button, .tabs button, .left-tabs button, .sheet-tabs button, .clash-main, .dv-tab):focus-visible { outline-offset: -2px; }
  ```

  Then delete the ad-hoc offsets (0, 1, 3, −3 and −4 px) and give the six `all: unset` controls their ring back: `.pset-link`, `.pick-clear`, `.saved-view .link`, `.row-view`, `.noclash-card .link` and `.sheet-peek-text`. Remove `.oa-scroll { outline: none }` (`index.css:1370`). Inputs keep `--control-border` and show the same ring, which replaces the soft `0 0 0 2px var(--accent-soft)` glow (2.0:1, too faint).
- **Keyboard.**

  | Where | Keys |
  |---|---|
  | Rail | ↑/↓ and Enter |
  | Clash list | ↑/↓ moves the selection, Enter opens it, Space ticks it |
  | Global | **J / K** next / previous clash (both unused today); `?` opens the shortcut sheet |
  | Viewer (unchanged, `docs/views.md:177-186`) | 1–4, H, F, X, C, I, V, G, O, [ ], Q, S, E, M, P, L, Esc |

  **Accept is never a single key**, because it edits the model. Use a click, or Ctrl/⌘+Enter on a focused validated card.
- **Not colour alone.** Every badge has a glyph and a word, severity has bars and a word, and A and B carry the letters "A" and "B" as well as red and green.
- **Screen readers.** The run line is `role="status"` with `aria-live="polite"`. A decision is announced ("Fix accepted. Clash #12 is now Fix kept, awaiting re-check"). Badges are text, not `aria-label`-only icons. Tables use `<th scope>`. Keep one `.sr-only` utility in `index.css` and delete `.proj-sr` and `.imp-sr`.
- **Targets.** Targets are 44 px on `pointer: coarse` (`docs/mobile.md` rule 6) and at least 28 px on desktop. The current 18–26 px `.ibtn` overrides in panels go to 28 px.
- **Forced colours.**

  ```css
  @media (forced-colors: active) {
    .badge, .tag, .chip, .pcard { border: 1px solid CanvasText; }
    .rail-step[aria-current="page"]::before, .clash-row.pick { forced-color-adjust: none; background: Highlight; }
  }
  ```

---

## 10. Remove, hide, keep

The user's brief was "Remove unwanted things." The test for every element below is whether an MEP engineer needs it
in the core workflow: projects, import, model summary, coordination, clash review with proposals and before/after,
reports and activity. If not, it goes.

| Verdict | Meaning |
|---|---|
| **REMOVE** | Delete it from the UI. The code can go in the same PR, or be left unreferenced and then deleted (P2-6) |
| **HIDE** | Move it under the single **More** (⋯) menu in the context bar, or behind a disclosure in its own panel. Never a default tab, never auto-shown |
| **KEEP** | It stays, possibly moved; the new home is given |

### 10.1 The first screen

> Superseded (Nov 22): the first screen is the Home dashboard (`StartScreen.tsx`): the hero, the start tiles (New
> project and the two samples), How Iris works as eight cards (`HowIrisWorks.tsx`) and recent projects. "See it work"
> was removed; the brand at the top of the sidebar is "Iris", and "Built by Techjays" sits in its footer.

The app no longer opens on the marketing landing. With no hash, `App.tsx:3722-3740` renders `About` today. Instead it
renders a lean **start screen**. `#projects` stays the Projects home and `#about` stays the product page.

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   [logo slot 40]                                ┌──────────────────┐ │
│   Iris by Techjays                              │  northbank.webp  │ │
│   AI proposes. Geometry proves.                 │  (static still,  │ │
│   The engineer decides.                         │   desktop only)  │ │
│                                                 └──────────────────┘ │
│   [ Open projects ]  [ Try the sample building ]                     │
│   Resume Northbank · 3 fixes kept · saved 2 h ago      (only if any) │
│                                                                      │
│   About Iris                                         (small, footer) │
└──────────────────────────────────────────────────────────────────────┘
```

- **Content.** The product name is set at `--fs-24`/600. One line follows at `--fs-16`, in `--ink-2`. Then two buttons:
  - **Open projects** (primary) goes to `#projects`.
  - **Try the sample building** (secondary) creates or opens the Northbank sample project and lands on its Clash review step. It runs **no** live AI call. Today's `startGolden` (`App.tsx:1348`) proposes automatically; that behaviour is not used here.
- **Resume line.** It replaces the Hero `resume` block and appears only when there is a session to resume.
- **Picture.** Nothing animates and no WebGL starts until a model opens. The only picture is the existing still `web/public/demos/northbank.webp` in an `--evidence-bg` frame, `--r-md`, hidden under 761 px.
- **Layout.** Left-aligned in a 960 px column, vertically centred, on `--bg`. Follows the theme.
- **Name.** Suggested new file `web/src/StartScreen.tsx`. It takes props only: `onProjects`, `onSample`, `resume?`, `onAbout`.

### 10.2 Landing and About (`web/src/About.tsx`, `web/src/landing/*`, `web/src/AboutIris.tsx`)

| Element | File : component | Verdict |
|---|---|---|
| Landing as the app's default screen | `App.tsx:3722-3740` `<About …>` when `!stats && !busy && !blank` | **REMOVE** as the default; replaced by the start screen (10.1). The page stays at `#about` for visitors and judges |
| About Iris dialog, a second product page with 6 tabs (Overview, How it works, Fixes, The AI, Inside, Proof); about 784 lines of TSX and the `oa-*` CSS at `index.css:1362-1722` | `AboutIris.tsx` `AboutIris`, opened from `App.tsx:4096` and the notch logo | **REMOVE**. It duplicates the landing. Every "About Iris" entry point goes to `#about` |
| Landing top nav: 6 anchors, a "Watch Iris fix a clash" button and a hamburger | `About.tsx:68-78` `header.lp-nav` | **KEEP**, trimmed to 3 anchors (How it works · Demos · Proof) and one "Open the app" button |
| Hero all-caps eyebrow "IRIS · AI DESIGN COORDINATION" | `landing/Hero.tsx:177` `.lp-eyebrow` | **REMOVE** |
| Hero meta line "Buildings and machines · IFC and STEP in · …" | `landing/Hero.tsx:191` `.lp-hero-meta` | **REMOVE** |
| Hero replay HUD (recorded run, log, chapter buttons) | `landing/Hero.tsx:194-215` `.lp-hud`, `landing/timeline.ts`, `heroScene.ts` | **KEEP**: it is the one picture of the principle working. Fix its phone overflow (P2-5) |
| Hero CTAs: "Watch Iris fix a clash", "Use your own models", "Pick a demo" | `landing/Hero.tsx:183-189` | **KEEP** two: **Try the sample building** and **Open the app**. **REMOVE** "Pick a demo" |
| "The problem" section, with the collide animation and 3 count-up facts | `About.tsx:85-120` `.lp-problem`, `landing/Story.tsx` `Collide`, `Fact` | **REMOVE**. Its one sentence moves into the hero lede. Count-up numbers are decoration, and each is one more measured number to keep true (CLAUDE.md, "Numbers people see are measured") |
| "How it works" loop | `About.tsx:121-130` `.lp-how`, `Story.tsx` `Loop` | **KEEP** |
| "Try the check" sandbox (interactive toy check) | `About.tsx:131-145` `.lp-try`, `landing/Sandbox.tsx`, `landing/check.ts` | **REMOVE**. The real check is one click away |
| "Seven kinds of fix" art grid (8 illustrations) | `About.tsx:146-175` `.lp-fixes`, `landing/FixArt.tsx` | **REMOVE** the grid. **KEEP** one sentence that names the kinds: Move, Offset, Trim, Reroute, Opening, Resize, Seat |
| "The model proposes. Geometry decides." rule | `About.tsx:176-213` `.lp-ai` | **KEEP**, merged into "How it works": it is the principle |
| Platform bento, 20 feature tiles | `About.tsx:214-282` `.lp-platform`, `landing/Bento.tsx` (every `*Art`, `Tile`) | **REMOVE**. It becomes a 7-line plain list that mirrors the workflow steps (Projects, Import, Understand, Coordinate, Review, Report, Activity). `Formats` and `Logo` stay for the footer |
| Demo cards (Northbank, PC-03) | `About.tsx:283-322` `.lp-demos` | **KEEP** Northbank as "Try the sample building". **HIDE** PC-03 under a "More samples" disclosure |
| "Once a demo is open" list | `About.tsx:323-331` `.lp-once` | **REMOVE** (tour copy) |
| "Who it's for" | `About.tsx:332-352` `.lp-who` | **REMOVE** |
| "Proof" (answer-key results) | `About.tsx:353-381` `.lp-proof` | **KEEP**, short: measured results only |
| "New to this? Words you'll see" glossary | `About.tsx:382-406` `.lp-words` | **REMOVE**. Engineers know the words; the glossary lives in the docs |
| Final CTA band "See a verified fix in about 40 seconds" | `About.tsx:407-426` `.lp-final` | **REMOVE**. It repeats the hero CTA |
| Footer with the third-party logo disclaimer | `About.tsx:427+` `.lp-foot` | **KEEP**. The disclaimer is required (`docs/brand-assets.md:55-68`) |

### 10.3 Corner cluster and header (`App.tsx:3405-3425` `corner`, `Brand.tsx:51` `Notch`)

> Done differently (Nov 22): the corner, the notch and the Menu button are all gone, on every page. The requirements
> pill, the agent pill, Save, Report and Export (primary, with the kept-fix count) sit in the top bar's actions, and
> the live status is the one status line in the workspace's header.

| Element | Verdict |
|---|---|
| "Watch Iris fix a clash" primary in the corner while on the landing (`App.tsx:3407`, tablet `:3615`) | **REMOVE**. It duplicates the hero |
| `{n} fixed` chip when Export is not available (`:3408`) | **REMOVE**. The count lives on Export and in the status bar |
| Requirements pill (`.req-pill`) | **KEEP**, moved to the context bar |
| Agent pill (`.agent-pill`, only while an MCP agent is linked) | **KEEP**, moved to the context bar |
| Owner gear (`OwnerSettingsMenu`; already hidden unless unlocked or opened with `#owner`) | **KEEP** as is |
| Export IFC / STEP + IFC | **KEEP**, in the context bar, secondary until a fix is kept |
| Menu button | **KEEP**, as **More** (⋯) |
| Notch: the wordmark hanging from the stage, which grows into the status | **REMOVE** in the project shell. The logo goes to the rail's brand slot and the live status to `.shell-context .run` |

### 10.4 The menu (`App.tsx:4064-4095` `MenuSheet`, plus `modelsMenu`, `coordinateMenu` and `layoutMenu` at `:3465-3530`)

> Done differently (Nov 22): there is no menu button and no More (⋯). The menu's sections (Models, Coordinate, This
> session, Panels and layout) moved as they were into **Settings**, and the flow, the samples and the shortcuts into
> **Help**, both `MenuSheet`s opened from the sidebar.

Today the menu holds four jobs. After the change it holds only rare things, because each step owns its own actions.

| Item | Verdict, new home |
|---|---|
| Models › "Add to the open models" plus "Open instead": the same files listed twice as checkboxes, "Add 0 models", "Upload models…" (`modelsMenu`) | **REMOVE** from the menu. **KEEP** in the Models step (`ImportPanel`): one list, one Open / Add / Off control per file, one "Import models" button |
| Coordinate › "Check the open models", "Run all N checks again", "Back to Iris's checks" (`coordinateMenu`) | **REMOVE** from the menu. **KEEP** as the Coordination step header's "Run checks" (`CoordinationOverview`) |
| Coordinate › Navisworks XML: sample reports, "Upload an export folder…", "Upload XML files…" | **HIDE** under More › Import › Navisworks clash report |
| This session › Requirements | **KEEP**, in the Coordination step header and the context-bar pill. **REMOVE** from the menu |
| This session › "Report: PDF and BCF" | **REMOVE** from the menu. The Reports step owns it |
| This session › Export | **REMOVE** from the menu. It duplicates the context bar |
| This session › "Connect an agent" (MCP pairing) | **HIDE** under More › Connect an agent |
| Panels and layout › list of panels to reopen, "Reset the layout" | **HIDE** under More › Layout |
| Panels and layout › hint paragraph about dragging tabs | **REMOVE** |
| Panels and layout › "Workings in Activity" checkbox | **REMOVE**. The Activity step always shows Workings, and the drawer opens on a run |
| Panels and layout › "Classic layout (fixed panels)" | **HIDE** under More › Layout. It is a removal candidate once the shell ships, because two desktop layout systems cost UX and maintenance |
| Help › About Iris | **KEEP**, under More, opening `#about` |
| Help › "Take the guided tour" (`Tour.tsx`) | **HIDE** under More › Help. Never auto-start it |
| Help › "Remove a model" | **REMOVE** from the menu. It becomes a row action in the Models step |
| (new) Appearance: System · Light · Dark | **ADD** under More |

### 10.5 Panels and the workspace

| Element | File : component | Verdict |
|---|---|---|
| Model (centre stage) | `dockLayout.ts:10` | **KEEP** |
| Coordination: clash list with Clashes / Insights tabs | `dockLayout.ts:11`, `ReportList.tsx`, `Insights.tsx` | **KEEP** the list. **Move** Insights (root causes, patterns) to the Coordination step's inspector, which removes the inner tab bar |
| Filters tab | `dockLayout.ts:12`, `FiltersPanel.tsx` | **KEEP** in the Models step (behind the list), and reachable from Visibility |
| Clash inspector | `dockLayout.ts:13`, `ClashPanel.tsx`, `ClashHeader.tsx`, `ProposalCard.tsx` | **KEEP** (§6.4) |
| Plan tab (Fix together) | `dockLayout.ts:14` | **KEEP**, but only shown while a plan exists |
| Chat tab, plus voice (mic, hands-free) | `dockLayout.ts:15`, `Chat.tsx`, `voice.ts` | **HIDE**. It is not a default tab: an "Ask Iris" button in the context bar opens it as a floating panel. The mic stays inside Chat |
| Edits (edit log, undo, redo) | `dockLayout.ts:16`, `EditPanel.tsx` | **KEEP**. Shown in the Activity step's decisions log, and as a tab once something is kept |
| Activity drawer (Workings / Steps, Follow, zoom, Fit, Events) | `dockLayout.ts:17`, `Workings.tsx`, `Activity.tsx` | **KEEP** as the Activity step. The bottom drawer is **collapsed by default** and opens only while a run streams |
| Properties floating on first click into empty space | `dockLayout.ts:18`, `Properties.tsx`, `.props` | **KEEP**, docked in the inspector on the Models step. Never open it empty (§7.6) |
| "464 clashes to sort / Run Triage all…" notice | `ReportList.tsx:33` `.impact-bar` | **REMOVE** (duplicate) |
| "Coordinate the models" card with "What was checked" details | `Detect.tsx:75` | **REMOVE** as a card. Its facts move into the `CoordinationOverview` head |
| Triage call-to-action card ("Triage · STEP 1", big primary) | `ReportList.tsx` `.triage.idle` (`index.css:873`) | **REMOVE** the card. **KEEP** one "Triage all" button in the list header and in `CoordinationOverview`. Today it appears in 4 places |
| "Naming 304…" sparkle chip in the list header | `ReportList.tsx:282` | **REMOVE** from the header. Naming progress shows in the status bar |
| Stage clash chip ("#1 Supply air main … ×") | `ViewPanes.tsx` / `.pane-head .clash-chip` | **HIDE**: shown only when the inspector is collapsed, or on tablet and phone |
| Agent "pilot" pill ("Let Iris drive" / "Take the view") | `App.tsx:3764-3771` `.pilot` | **KEEP**, but only while an agent or a replay drives the view |
| Pilot glow overlay | `App.tsx:3763` `.pilot-glow`, `index.css:1028-1036` | **REMOVE** (decoration) |
| Guided tours, Northbank and cell (`data-tour` hooks) | `Tour.tsx`, `App.tsx:312` `startTour` | **HIDE** under More › Help. Keep the `data-tour` hooks |
| Golden path: open, then auto-propose | `App.tsx:1348` `startGolden` | **HIDE** under More › Help › "Watch Iris fix a clash" (it spends a live proposal) |

### 10.6 Clash inspector actions (`App.tsx:3870-4025`)

| Element | Verdict |
|---|---|
| Propose fixes | **KEEP**, the primary action in the action bar |
| Explore wider fix | **KEEP**, secondary |
| Go to the clash (`:3907`) | **REMOVE**. It duplicates `ClashHeader`'s "Focus in 3D", the F key and the stage chip. Keep "Focus in 3D" only |
| Try a move yourself (`:4014`, `<details>`) | **HIDE** in the action bar's ⋯ overflow |
| "Tick several clashes in the list to fix them together." permanent hint (`:4022`) | **REMOVE**. The multi-select bar (`.selbar`) appears when 2 or more clashes are ticked |
| Look for a better fix (`:3999`, escalation) | **KEEP**, only after a failed or no-fix result |
| Show it built (`:3875`, `:3980`, Gemini image restyle) | **HIDE**. Experimental: off by default, with its switch under More › Experimental |
| Before / After / Both | **KEEP**, linked from each proposal card |
| Accept / Reject / Modify / Request another | **KEEP** (`ProposalCard`) |

### 10.7 Viewer tool rail (`ViewerToolbar.tsx`)

20 top-level buttons become 7 top-level controls. Every key keeps working.

| Tool | Verdict, new place |
|---|---|
| Modes Shaded / X-ray / Near it / Only it (V X C I) | **KEEP**, in the **View** popover, with the active mode's icon shown on the rail |
| Visual styles: Shaded, Consistent colours, Shaded with edges, Hidden line, X-ray (G) | **HIDE**, nested in View |
| Layouts: 3D only, Plan and 3D, Four views (Q) | **KEEP**, in View |
| Section box (S) | **KEEP**, top level |
| Outline the pair (E), Connections (L) | **HIDE**, in a **More tools** popover |
| Go to the clash / frame selection (F) | **KEEP**, top level |
| Measure (M) | **KEEP**, top level |
| Edit the model by hand (P) | **KEEP**, top level, but only on the Clash review and Models steps |
| Home / fit (H) | **KEEP**, top level |
| Camera: standard views 1–4, perspective or orthographic, history | **KEEP**, in the **Camera** popover |
| Saved views | **KEEP**, in Camera |
| Visibility: models, levels, classes | **KEEP**, top level |
| Save a screenshot | **HIDE**, in Camera |
| View cube and its Home button | **KEEP** |

### 10.8 Project pages (new components)

| Element | File : component | Verdict |
|---|---|---|
| Numbered 4-tile flow in the empty state | `ProjectsHome.tsx` `.proj-flow` | **KEEP** as one line of steps (a real sequence) |
| "Open the sample building" beside Create | `ProjectsHome.tsx` `.proj-create` | **KEEP** |
| "2D drawings (PDF): Not yet supported" disabled row | `ProjectOverview.tsx:234-235` `.proj-future` | **REMOVE** the row. Keep the single muted line in `ImportPanel` `FORMATS`, which honours "shown as such, never simulated" with one wording |
| SHA-256 column in the Models card | `ProjectOverview.tsx` `ModelsCard` `.proj-hash` | **HIDE**: shown on the model row's details or tooltip with a copy button |
| Saved states table (# / Saved / Edits / Files) | `ProjectOverview.tsx` `SavedCard` | **HIDE**, moved to the Activity step |
| "How disciplines are mapped" explanation | `ModelSummary.tsx` `details.msum-how` | **KEEP**, collapsed |

---

## 11. Prioritised changes for the integration and polish agents

All line numbers refer to `web/src/index.css`, which was identical in the `main` and `engineer` worktrees on
22 Nov 2026. Re-grep before editing, because other agents are active.

### P0: foundation (do first; low risk, large payoff)

1. **Tokens and dark theme.**
   - Replace `:root` (`:1-12`) with §3.5, add the two dark blocks, and add `theme.ts` and the Menu control.
   - In `.dockview-theme-iris` (`:189-215`), delete `color-scheme: light` (it inherits now), and map these values:

     | From | To |
     |---|---|
     | `--dv-tabs-container-scrollbar-color: #9aa5b1` | `var(--control-border)` |
     | `--dv-drag-over-background-color: rgba(5,38,64,.14)` | `color-mix(in srgb, var(--accent) 14%, transparent)` |
     | `--dv-floating-box-shadow` | `var(--shadow-3)` |
     | `--dv-scrollbar-background-color` | `color-mix(in srgb, var(--ink) 25%, transparent)` |

   - Change `Viewer.ts:259` to read `--stage-bg` (§3.5).
2. **Literal colours to tokens**, the highest-traffic first.

   | Literal | Token | Where |
   |---|---|---|
   | `#fff` | `var(--on-accent)` | On primary or navy fills: `:161`, `:392`, `:474`, `:486`, `:583`, `:2039` |
   | `#fff` | `var(--surface)` | Elsewhere |
   | `#c3ccd7` | `var(--line-strong)` | `:391`, `:1271`, `:1824` |
   | `#222` | `var(--evidence-bg)` | `:569`, `:809`, `:932` |
   | `#18212c` | `var(--inverse-bg)`, with `color: var(--inverse-ink)` | `:415`, `:1732` |
   | `rgba(10,14,20,.28/.35/.4/.55/.82)` | `--scrim-soft` / `--scrim` / `--scrim-strong` | `:807`, `:947`, `:1124`, `:1770`, `:1795`, `:1868` |
   | `#33414f`, `#33404f`, `#3d4a5a` | `var(--ink-2)` | |
   | `#f5a623` | `var(--trying)` | `:926`, `:2027` |
   | `#12b5cb` | `var(--passed)` | |
   | `#e040fb` | `var(--vw-hit)` | `:928` |
   | `#e67e22` | `var(--vw-before)` | `:481` |
   | `#8e44ad` | `var(--vw-both)` | `:480` |

   - Replace the old accent `#2f5d8a` / `rgba(47,93,138,…)` (`:360`, `:657`, `:679`, `:747`, `:1422`, `:1537`) with `--accent` / `color-mix(in srgb, var(--accent) 15%, transparent)`.
   - Define or remove the undefined `--panel` (`:966`), `--hover` (`:365`) and `--bad` (`:1100`); they become `--surface`, `--raised` and `--failed`.
   - Leave the About page (`:1362-1722`) for P2.
3. **Fonts.** Update `index.html:16` (§4) and change all `font-weight: 700` to `600` (18 rules, including `coordination.css` and `import.css`).
4. **Disabled states.** Use §7.4 `.btn:disabled` / `.ibtn:disabled` in place of `:398` and `:403`. In `ClashPanel.tsx`'s empty branch, do not render Propose, Explore or Go-to while no clash is picked. In `ReportDoc.tsx`, put the reason beside "Build the report".
5. **One badge system.** Add `.badge`, `.tag`, `.chip`, `.count`, `.sev` and `.alert` (§7.1, §7.7) to `index.css`. The fastest path that needs no TSX edits is to add the old selectors to the new rules' selector lists:

   | Old selector | New rule |
   |---|---|
   | `.pchip.open` | `.badge.st-open` |
   | `.pchip.resolved` | `.badge.st-resolved` |
   | `.pchip.reviewed` | `.badge.st-bydesign` |
   | `.chip.status.open_` (`coordination.css:72-73`) | `.badge.st-*` |
   | `.pcard-state` + `.pcard.s-ai` | `.badge.ai` |
   | `.pcard.s-valid` | `.badge.proved` |
   | `.pcard.s-fail` | `.badge.failed` |
   | `.pcard.s-unverified` | `.badge.unverified` |
   | `.pcard-ai`, `.clash-head-ai`, `.chip.src-model` | `.tag.ai` |
   | `.imp-type` | `.tag.code` |
   | `.msum-tag` | `.tag` |
   | `.proj-step-n`, `.proj-count`, `.badge-n` | `.count` |

   Then delete the per-file chip rules: `projects.css:40-44`, `coordination.css:65-73` and `proposal.css:11-16`. Delete `.chip.sev.*` too, because it is unscoped and leaks app-wide. Fix the vocabulary as in §7.1. Mark AI-assessed severity with `.tag.ai`, not `chip accent` (`CoordinationOverview.tsx`).
6. **Focus.** Add the §9 baseline. Remove the per-rule offsets at `:162`, `:248`, `:475`, `:556`, `:903`, `:1825`, `:1836`, `:1969` and `:2087`. Add rings to the six `all: unset` controls.
7. **Clash list rows** (§7.2): the CSS at `:517-545` and `:932-936`, plus the `clash-meta` wrapper in `ReportList.tsx`. Format distances with U+2212 in `coordination.ts` `distanceText` and in the list's `.dist`.
8. **"In model" chip.** In `ElementCard` or `ClashPanel`, make it a neutral `.tag`, not `.chip.ok`.

### P1: shell and structure

9. **Project shell** (§6.1–6.2):
   - Add `.shell`, `.shell-rail`, `.brand-slot`, `.rail-step`, `.shell-context` and `.shell-status`.
   - Move `ProjectSteps` from `.proj-stepbar` / `.proj-steps` (`projects.css`) into the rail.
   - Retire `.notch` and `.corner` inside the shell. Move the run status to `.shell-context .run`.
   - Make Export a secondary `.btn` until fixes are kept.
   - Never unmount the stage on page steps.
10. **Inspector** (§6.4):
    - Order the content as head, evidence, fixes, then a sticky action bar.
    - Make sides A and B stripe rows, not cards.
    - Use the measure strip (§7.8).
    - Collapse failed proposals to one line.
    - The proof grammar on `.pcard` borders replaces the `--pc-rule` stripe (`proposal.css:3-8`).
11. **De-card** (§7.3):
    - `.coord`: remove the radius 12 and shadow, `coordination.css:5-6`.
    - Map `.coord-total` 8 → `--r-sm`.
    - Make `.proj-card` a section.
    - Flatten the Insights tab wrappers (`index.css:813-870`): no nested borders, rows separated by hairlines.
    - Make `.triage.idle` (`:873`) a flat section with one primary button and no ring or shadow.
12. **Sentence-case labels and the type scale** (§4). Do the new files first (`projects.css`, `import.css`, `coordination.css`, `proposal.css`, `model-summary.css`), then `index.css` by frequency: 12.5 → 13 (85), 11.5 → 12 (41), 13.5 → 14 (18), 10.5 → 11 (9), 15 and 15.5 → 16.
13. **Radii and spacing.**
    - Use `--r-xs`, `--r-sm`, `--r-md` and `--r-lg` only: 6 and 7 → `--r-sm`; 10 and 12 → `--r-md` on panels and `--r-lg` on dialogs; 14, 16 and 18 → `--r-lg`.
    - Base text is `--fs-13` in all panels (`projects.css` and `import.css` already are; `coordination.css`, `model-summary.css` and `proposal.css` are 12.5 → 13).
    - Unify bar tracks on `--sunken`, 6 px, radius 999.
14. **Stage chrome** (§7.6): the rail popover grouping, dock actions shown on hover or focus, the clash chip shown only when the inspector is collapsed, and Properties opening only on a selection.
15. **Phone** (§6.3):
    - One tab row.
    - Insights as a segmented control.
    - Hide "Go to clash" until a clash is picked.
    - Menu › Models as one list with Open / Add / Off.
16. **Container queries for docked components.** Change `coordination.css`'s `@media (max-width: 520px)` and `proposal.css`'s `@media (max-width: 480px)` to `@container`, and give `.slot.in-dock` `container-type: inline-size`.
17. **Shared helpers.** Use one `fileSize` (binary, "KB"/"MB", from `projectsApi.ts:168`), one `plural` and one "PDF not supported" string.
18. **Apply the §10 verdicts.**
    - Add the start screen (10.1) and point the no-hash route at it.
    - Remove `AboutIris` and route every "About Iris" to `#about`.
    - Trim the landing sections (10.2).
    - Empty the menu down to More: Import › Navisworks, Connect an agent, Layout, Appearance, Experimental, Help, About.
    - Remove the triage duplicates, the pilot glow and the permanent hints (10.5–10.6).
    - Regroup the viewer rail (10.7).

    Each removed import must also come out of the stub lists in `web/tests/app-host.mjs` and `app-replacement.test.mjs` (CLAUDE.md, Traps).

### P2: polish

19. **Density toggle.** Add `[data-density="compact"]` on `.shell` (§5) to Menu › Panels and layout.
20. **Status bar content** (§6.1). The agent state reads from the existing run state.
21. **Merge fragmented media blocks.** There are eight `max-width: 760px`, nine `pointer: coarse` and twenty reduced-motion blocks. Merge them into one of each at the end of `index.css`.
22. **About page** (`:1362-1722`). Tokenise its 129 literals onto the dark tokens. It is a dark-tone page, so give it `data-tone="dark"` scoping like the landing does.
23. **Landing phone overflow.** The hero caption under the 3D scene runs off screen at 390 px (`m-01-landing.png`, `landing/Hero.tsx` and `landing.css` `.lp-hud`). Add `overflow-wrap: anywhere` and clamp the caption width to `100%`.
24. **Dead CSS.** Remove these unreferenced classes and tokens:
    - `.about-close` (`:949`, `:1901`)
    - `.bar-side` (`:226-227`)
    - `.hint-bar` (`:456`, `:1850`)
    - `.measure-label` (`:458`)
    - `.root-text` (`:509-510`)
    - `.stage-empty` (`:448-449`)
    - `.props .card-actions` (`:386-387`)
    - `.stat` (`:312`, `:229`)
    - `--oa-navy`

    Also resolve the duplicated selectors (`.btn.ghost.on` at `:396` against `:1767`; `.clash-row` `:517`/`:521`; `.corner` `:262`/`:270`) and rename the leaky generics (`.left`/`.right` → `.pane-left`/`.pane-right`; `.pick` → `.filter-pick`).
25. **Forced-colours** block (§9).

### Definition of done for each change

- The change looks right in light, in dark (`[data-theme="dark"]`) and in OS dark with no attribute set.
- The new component CSS contains no colour literal; the test guard passes.
- Every interactive element shows the focus ring when reached by Tab.
- Status words match §7.1 exactly.
- Distances show U+2212.
- Phone (390 px) and tablet (1024 px) captures are checked for overflow.
