# 22 · Build log (Oct 27 – Nov 22)

> History, condensed: each entry records what was built and decided at the time, where in the code, and how it was
> checked. Test counts and geometry/check timings were true then. Numbers that depended on the language model
> (latency, cost, eval pass rates) were removed when Iris moved to Gemini on Vertex AI and will be re-measured there.
> The topic docs [01](01-product-and-journeys.md)–[21](21-glossary-and-naming.md) describe the code as it is now;
> where they and this log disagree, the code and the topic docs win.
>
> New work adds a short dated entry at the end (what changed, where in the code, how it was checked, any owner
> decision) **and** updates the topic docs it touches (see [README.md](README.md), "Keeping these docs current").
> Re-branded on 2026-11-11.

Done (Oct 27): skeleton, federated scene, neighbourhood check, agent loop (tested with a scripted model), API, MCP
server, Northbank spikes 1–4, Cloud Run deploy (`deploy/deploy.sh`, one instance since scenes live in memory; caps in
`server/iris/limits.py`). Proposal scores append to `evals/results.csv`. Validation then: 66 server tests, web build.

Wider fixes (Oct 28): isolated geometry/connection checks, a bounded planner/API/chat slice and whole-proposal review. Context offsets cover plain rectangular/circular profiles on straight
horizontal services; sloped routes and hollow/U profiles are unsupported; new geometry or connection violations reject.

Navisworks clash reports (Oct 27): `server/iris/reports.py` reads flat and grouped XML; the app lists clashes by test
with A/B/C images, matches them to the open model (Northbank 317/317 with Site) and re-measures on selection. Triage
eval: `evals/navisworks_triage.py`.

Local offsets (Oct 27): `server/iris/edits.py` splits a straight extruded segment, raises/lowers the middle with bends
and risers, keeps the GlobalId on the first piece and re-chains ports, trying it in an IfcOpenShell transaction;
`edits.passages` ray-casts for openings in the obstacle.

UX pass (Oct 27): `POST /propose/stream` streams agent steps as NDJSON into an "Agent activity" table;
`GEMINI_THINKING_LEVEL=low` by default and the loop stops at the first verified option. Options carry `before` meshes
(Before / After / Both).

Viewer (Oct 27): Shaded / X-ray / Context / Isolate modes, section box, clash marker, camera presets, measure,
properties card and shortcuts; navigation frames where the two elements meet, a move frames where the moved element
lands (`Viewer.frameFix`), and one-element clashes (35 of 317) draw purple.

Chat (Oct 27): `server/iris/chat.py`, a Gemini Pro tool loop (≤8 model calls per message) with tools for report summary,
clashes, images, measuring, openings, check_move/offset, propose_fixes and view actions; `POST /api/chat` streams
NDJSON. Gotcha: an effect returning Chromium's `scrollIntoView` Promise blanks the panel.

Plans (Oct 27): `server/iris/plans.py` runs an agent per pair in parallel (geometry serialises on the `Workspace.lock`
RLock), then `verify_together` applies all fixes in one transaction and checks each against everything. Root causes are
hubs with ≥2 real partners; `build_root_cause` asks the model (`domain_packs/root_cause.md`) for cause + strategy.

Insights (Oct 27): `plans.patterns` groups real clashes by class pair + files; `triage_patterns` is one model call
(`domain_packs/patterns.md`) → by_design / modelling_error / real_problem; `as_designed` gives a plan with no edits.
Northbank has 11 patterns.

Bulk triage (Oct 27–28): `server/iris/triage.py` applies sure rules first (non-physical, touch ≤ 1 mm), then one
strict-JSON call per clash on 8 workers via `model_client.triage_model()` (the fast model). `triage.Job` is shared per report; with `scene_id`, `_triage_facts` settles one-element pairs and
verdicts carry `basis` and `fix_hint`. Northbank: 184 of 317 settled by rule (111 of 217 with models open).

The agent drives the viewer (Oct 27): `agent.resolve(trials=True)` emits trial events that `web/src/pilot.ts` plays
(amber checking, teal clear, hits magenta); any user camera move takes over and **Let Iris drive** resumes. Validation:
50 server tests.

Start page and demo report (Oct 27): `About.tsx` explains clashes for BIM newcomers with **Open the Northbank demo**.
Sample reports drop IfcGeographicElement, IfcSpace and IfcBuildingElementProxy tests (`IRIS_SAMPLE_EXCLUDE`): Northbank
becomes 217 clashes in 52 tests.

Reasoning (Oct 27–28): `GeminiModel.complete_json_reasoning` streams thought summaries (`GEMINI_INCLUDE_THOUGHTS`) when
someone watches; `complete_json_streamed` does the same for triage, keeping up to 6000 chars per verdict. UI: "How the
model reasoned".

Clash pictures read by colour (Oct 27): `web/src/clashImage.ts` reads each Navisworks picture in the browser (512 grid,
~8 ms): red A, green B and where they meet; thumbnails zoom there. A segmentation model never found the overlap on flat
renders.

Voice (Oct 27, live Oct 29): `web/src/voice.ts` records 16 kHz audio and `POST /api/transcribe` sends it to Gemini
Flash, biased to BIM words; the transcript becomes a chat message (caps `IRIS_VOICE_PER_HOUR/DAY`, 60 s / 3 MB). Live
voice (`docs/voice.md`, `server/iris/voice_live.py`) relays PCM over `/api/voice/live` so the key stays server-side;
hold to talk or hands-free. Tested with espeak-ng speech and a fake microphone, not yet a human voice.

Export (Oct 27): edits accumulate in the in-memory models and export writes each edited file once (zip when several);
only kept fixes call `mark_edited`. A restart starts clean.

The view follows activity, not the tab (Oct 28): `viewPlan` in App.tsx; a plan takes the view, picking a clash gives it
back (`selectClash(c, keepPlan)`).

Bends (Oct 28): offsets turn with radiused 90° fittings (IfcDuctFitting etc., BEND, 8 facets per 90°, two ports each;
`IRIS_OFFSET_CORNERS=square` for the old corners). `edits.bend_radius` = min(depth, (rise - 40 mm)/2), matching Rev04's
180 mm duct, 100 mm tray and 54 mm pipe.

Joints and trims (Oct 27): `verify.check` also runs collision without touching, since intersection read Clash7's transom
30 mm into a mullion as a 0 mm gap. New fix kind **trim** (`edits.butt_trim`) cuts a member back to butt the other's
face, failing only on new or worse contacts.

Reports and BCF (Oct 28): `server/iris/document.py` / `web/src/ReportDoc.tsx` build PDFs (one, per team or per model)
with a page per real or fixed clash (before/after capture, AI-drafted explanation, review table), DRAFT until every team
reviews, plus a BCF 2.1 zip. PDFs use WeasyPrint. The browser sends its shown verdicts, so a restarted server need not
re-triage.

Not a clash (Oct 28): `web/src/noClash.ts` flags clashes needing no fix (same element, non-physical, ≤ 1 mm touch, no
overlap, by_design) with **Mark as not a clash**. After c0087 got a verified "trim the pad footing 900 mm",
`edits.butt_trim` refuses non-slender members (`SLENDER = 3`); eval `evals/not_a_clash.py`.

Guided tour (Oct 28): `web/src/Tour.tsx`, 30 steps in 10 acts; each spotlights a `data-tour` control and advances on
`TourState`. Live model steps offer **Watch a recorded run** after 45 s (plan 75 s), replaying `web/public/tour/`
through the same pilot code.

Streams through the edge (Oct 28): the hosting edge buffered compressed NDJSON, so `app._ndjson` sends
`Content-Encoding: identity`. Test with `Accept-Encoding: gzip, deflate, br, zstd`.

Triage and Insights UI (Oct 28): Triage leads the left panel (rule count, model progress, verdict bar, Set aside /
Flag); Insights shows root-cause chips and patterns. `Tooltips` (ui.tsx) draws every `data-tip` in one window-clamped
layer.

Owner settings (Oct 28): `server/iris/owner.py`. `IRIS_OWNER_TOKEN` (Secret Manager / Cloud Run env) unlocks via `POST
/api/owner/unlock` (constant-time, rate-capped) into a signed 30-day cookie; `_OwnerContext` then reads
`X-Iris-Settings` (thinking levels, no_caps) for `GeminiModel`. Validation: 79 server tests.

See-through elements (Oct 28): alpha < 0.99 goes in a second `glass` BatchedMesh; picks prefer solid hits. Demo set 2:
`palletising-cell/` (Rev A, five planted problems; Rev B fixed); offset, move and trim pass on it.

Iris detection (Oct 28): `docs/detection.md`, `server/iris/detect.py`. Tests every file pair, each file against itself
and duplicates (hard at 1 mm), skipping same-element, port-joined, assembly and door-in-wall pairs. Sort and sweep over
`IfcScene.bounds()`, one triangle tree per run, exact separating-axis depth for rectangular extrusions, recentring
beyond 200 m, 5,000 per test. Depth is the move needed to clear (#057 −100 mm, #061 −77 mm); ids hash test + GlobalId
pair, so reruns mark new/resolved. API `/api/scenes/{sid}/detect/stream` (cap `IRIS_DETECT_PER_HOUR`), chat tool
`detect_clashes`, UI `Detect.tsx`. Checks: Northbank 633 clashes in 7-12 s, 117/117 sampled Navisworks overlaps; cell
Rev A 13/13 planted, Rev B 0. Browser: detect → #061 → "up 280 mm through the beam opening" → accept → 1 resolved, 0
new.

Clash numbers and titles (Oct 28): each clash gets a report-unique #N (Navisworks label kept as `ref`; detection numbers
never reused). `titles.py` has the fast model title clashes 40 per call, 8 at a time. New App imports must be added to
`web/tests/app-host.mjs` and `app-replacement.test.mjs`.

Coordination first (Oct 28, owner decision): Iris's own check is the golden path, Navisworks secondary; the demo runs
`openDemo` → `runDetect` and proposes on the duct × girder clash. Tour clashes are GlobalId pairs (`clashOfPair`).
Triage reads alike groups once (633 clashes in 98 model calls).

Header, thumbnails, Site (Oct 28): the header shows only the name "Iris", centred with the logo (`.bar` is a 3-column
grid). Detected clashes get list thumbnails: `Viewer.thumbClash` draws a small view A off screen as a row scrolls into
view (`LazyThumb` in ReportList.tsx; queue in App.tsx, paused while a proposal, plan, replay or check runs). Site-model
tests are listed but off by default; Northbank: 464 clashes in 1,732 elements, ~4 s.

Owner and everyone settings (Oct 28): `server/iris/settings.py` holds settings for everyone (effort, triage_effort;
None = env default: `GEMINI_THINKING_LEVEL` and a triage thinking level), kept in a shared store when deployed, else
`IRIS_SETTINGS_FILE` (gitignored). Precedence: owner's header > everyone's > environment (`GeminiModel.effort`). Owner-only `GET/PUT /api/settings`; tests use a per-test store (`tests/conftest.py`).

Insights, Triage, thumbnails (Oct 28): `GET /api/models` (`model_client.triage_model_info`) tells the page which
model triage runs on (`triageOpen`). Insights no longer jumps: patterns are read once per report,
root causes keep their places (`keepPlaces`), fixed-width columns never reflow a row (checked: tops and heights equal).
The funnel button filters the list to a pattern or root cause (`listFocus`); Triage can collapse to its count and bar.
Thumbnails no longer flash: `Viewer.posed` renders the restored view before returning and the queue draws one per 60 ms
(canvas sampling: brightness jump 45 levels → 0). Patterns are read automatically (`explainPatterns(quiet)`).

STEP models (Oct 28; `docs/step.md`, `server/iris/step.py`): STEP → IFC on open (`cadquery-ocp` 8.0 beside IfcOpenShell,
no conflict); parts become triangulated elements with pset `Iris_STEP`, groups become IfcGroups, GlobalIds come from
file hash + label path; the titles' model picks each part's class (`domain_packs/step_classes.md`). Cached by file hash
(`samples/step-cache`). Fixes are moves only (`IfcScene.step_run` moves touching parts together); export writes
`<name>.iris.step`. Upload via `POST /api/models/upload` (`IRIS_MODEL_UPLOAD_MAX_MB`, `IRIS_MODEL_UPLOADS_PER_HOUR/DAY`).
`evals/step_cell.py`: Rev A 144 parts, 13/13 planted, 0 unexpected; C2 ladder +150 mm verified and written back. The
container image needs `libgl1` for OCP.

Cell fixes and tour (Oct 28): `step._prism` writes plain cylinders and boxes as `IfcExtrudedAreaSolid` (cell: 97 exact,
47 meshes) so offsets and trims work on STEP parts; export adds new pieces to the part's group (`service.step_changes`;
use `BRepBuilderAPI_Transform`, never `.Moved()`). `plans.merge_shared` merges Fix-together pairs sharing a movable
element; `_try_trim` won't trim a fixed element when the other side can move; `plans.failure_summary` gives one plain
line per failed idea. Cell tour: `CELL_STEPS` (12 steps). Eval: C1 one job; C2 +150; C3 trim 40 mm; air line 7 → 15 parts.

Landing demo cards (Oct 29): two equal cards (`DemoCard` in About.tsx) share pictures with the README's "Two demos"
table, captured in Iris's own viewer by `web/scripts/capture-demos.cjs`; recapture after visual changes.

Agents over MCP (Oct 29; docs/mcp.md): a pairing link (`agents.py`: `iris_` token, sha256 kept, 12 h sliding, 24 h max,
revocable) ties an MCP client to the visitor's session; the page PUTs its context and follows
`GET /api/links/{token}/events` (NDJSON; `onAgentEvent` reuses `onChatEvent`). `mcp_server.build` exposes 28 tools on
`chat.Chat._run`; remote at `/mcp` behind `_McpGate` (401 without a live token), stateless JSON, or stdio; failures are
`ToolError`s, long work is a job. Caps `IRIS_LINKS_PER_HOUR`/`DAY`, `IRIS_AGENT_CALLS_PER_HOUR`. Checked locally: an
`mcp` client and a browser on one link ran #58 end to end (capture, verified offset, apply_fix).

Time left and resume (Oct 29): the link dialog shows time left on the server's clock (`clock_offset`). The session is
kept in `localStorage` (`iris.session`) and the landing offers "Pick up where you left off" (`resumeSession`, with fixes
the agent applied meanwhile, `Link.applied`); `Workspace.keep` evicts live links' scenes last. The dialog leads with
Token and Server rows; client settings JSON (`mcpServers`, `"mode": "optional"`, since `required` aborts runs when a link
expires) sits under "First time?"; read tools carry `readOnlyHint`. Start fresh revokes the saved link.

Coordination requirements (Oct 29; `docs/requirements.md`, `server/iris/requirements.py`, `web/src/Requirements.tsx`):
an optional `iris-requirements/1` file sets a design level (L1-L5), strictness, groups (never by GlobalId), a check
matrix, who moves, by-design pairs and guidance; no file means today's behaviour. It compiles into detection tests
(`req:a|b`, `Test.min_size_m`), triage rules, prompt lines and `Workspace.fix_settings`. The model drafts a file
(`.../requirements/suggest`), audits by-design rules (`triage.audit_rules`) and recommends where nothing may be edited
(`agent._recommend`). Pages send `X-Iris-Requirements`; a forgotten id is a 409 that `api.ts` retries; triage jobs are
keyed by `model_key` + `rules_key`. Checked on Northbank: L3 464 = 464 (cell 107 = 107); under Strict #1's +400 mm
offset keeps 50 mm ≥ 40 mm; L5 recommends without editing; a by-design rule settled 102 at once.

Small models and a blank project (Oct 29): `Viewer.reach(metres, share)` caps building-sized distances at a share of the
scene's diagonal, the marker keeps constant screen size, the near plane goes to 0.5 mm; checked on a generated 110 mm
load cell and Northbank #1 / #40. **Use your own models** opens `ProjectStart.tsx` (drop IFC or STEP, import a report).

Next, in order: ✅ spike 4 with images; ✅ local offsets and bends (later sideways offsets); ✅ viewer modes and A/B/C
capture (plan view to do); ✅ streamed agent loop and chat; ✅ bulk triage on Gemini Flash, voice, IFC export, PDF + BCF,
Iris detection, STEP; ✅ the escalation model (`docs/escalation.md`) and Show it built (`docs/show-it-built.md`).
Later: accounts and saved projects, STEP machines inside buildings, trims on meshed STEP parts.

Phones and tablets (Oct 29; `docs/mobile.md`, `web/src/layout.ts`, `Sheet.tsx`): desktop above 1100 px; tablet with a
clash drawer at 761-1100 px; phone at 760 px and below with a bottom sheet over App's own panes (re-placed by CSS, never
remounted) that follows activity (`follow()`). Touch gets 44 px targets, long press for A then B, full-screen dialogs.
Checked with Playwright (iPhone 13 / SE, Pixel 7, iPad Mini, desktop): no sideways scroll, golden path by touch.

Insights patterns and room for the list (Oct 29): patterns are cards; the left pane has **Clashes** and **Insights**
tabs (`leftView`). List top / clashes in view: desktop 1440x900 from below the fold to 275 px / 14; iPhone 13 1 → 6.

Renamed to Iris (Oct 29): app, PDF, BCF, MCP server `iris` and exports `<name>.iris.ifc` / `.iris.step` say Iris. Kept:
`server/iris`, `IRIS_*` env, `X-Iris-Settings`, cookie `iris_owner`, storage `iris.*`, `Pset_IrisConstraints`.

Fix kinds in one registry (Oct 29; `docs/edits.md`): each layer registers a kind once (`agent.TRIES` / `PARAMS`,
`plans.IN_TRIAL`, `plans.KEEP` behind `POST /api/scenes/{sid}/fix/apply`, `web/src/fixKinds.ts`); unknown kinds are
refused. `agent.TIERS` ranks geometry, then resize, then penetration; split runs are checked against every obstacle.
The "largest move" limit now measures lateral offsets. Checked: 399 server tests, 53 web tests.

Reroute (Oct 29; `edits.apply_route`, `agent._try_route`): up to 3 steps on the run's own axes (`edits.run_frame`), one
axis per change, 90° bends via `_build_chain`; slopes up to 15° keep their fall, falling drainage is refused. The model
reads `edits.free_bands` (rays every 30 mm) and clashes within 3 m (`Workspace._nearby`). Cell C6 (159 parts, 16
planted): #22 got a route 250 mm round each column, 53 mm clear, accepted via `/fix/apply`. 418 server tests.

Accept in place (Oct 29): apply replies carry `Workspace.patch` (revisions and meshes); `viewer/patch.ts` patches the
page at `revision_before`, else reloads. Checked: Northbank and the cell route accepted with no download (headless
Chromium); 4 server tests (`test_accept_in_place.py`), 3 web tests (`viewer-patch.test.mjs`).

Penetrations (Oct 29; `edits.penetration`, `agent._try_penetration`): an opening where a straight service crosses an
extruded `IfcWall` / `IfcSlab` (never beams or columns; 50 mm surround). Opening = section + clearance + 5 mm, rounded
to 10 mm, 10 mm proud (C7: Ø130 mm, 220 mm deep); a provision for void is always added and the host is cut only if
`requirements.can_cut`, else "Opening requested". STEP export cuts the host (`BRepAlgoAPI_Cut`). Checked:
`tests/test_penetration.py` (15); C7 kept and cut, the STEP wall 2,655 cm³ smaller.

Which hosts take an opening (Oct 29; `server/iris/hosts.py`): hard rules (`hosts.hard_rule`: columns, glazing,
transfer elements like Northbank's girder) > requirements' `penetrations` rules > the model's reading per host kind
(`hosts.read`, cached, `Pset_*Common` only) > walls and slabs. Cell C8: 32 mm conduit through a 3 mm gland plate (161
parts, 17 planted). Checked: `tests/test_hosts.py` (12); C8 Ø34 mm fitted hole, plate cut; 449 server, 59 web tests.

Resize (Oct 29; `docs/edits.md` "Resize", code `edits.resize_size` / `apply_resize`, `agent._try_resize`): the sixth
kind of fix, a flatter section where an obstacle leaves too little depth (`{"kind": "resize", "split_m", "depth_m",
"keep"}`). Iris picks the width: a duct keeps its equivalent diameter (Huebscher, to 5 mm, at most 4:1), a tray its
cross-section (at least 50 mm deep); pipes, round ducts, non-rectangular profiles, STEP parts and sloped runs are
refused with the reason. `_build_chain` builds original, transition (lofted, faces at most 30°), resized middle,
transition, rest, with an `Iris_Resize` pset. Checked by `tests/test_resize.py` (11) and 460 server tests; in the
browser a duct flattened to 225 mm deep under a beam (710 x 225 mm) was accepted in place.

Bigger uploads (Oct 29, target 500 MB; `docs/uploads.md`, `evals/README.md` "Big models"): the page checks the cap
(`model_upload_max_mb`; `web/src/uploads.ts`), gzips files over 1 MB and streams to `POST /api/models/upload/stream`
(NDJSON progress); the server refuses early (411, 413), unpacks `.gz` in a thread with a running size cap
(`app._unpack`). Boxes (`IfcScene.bounds`) go through CGAL (1 ms vs 20-30 ms) from 50 MB (`IRIS_BIG_MODEL_MB`) in
batches of 2,000 (4.8 GB → 1.4 GB on a 150 MB model); Northbank's 464 clashes unchanged. Detection's sweep got a lower
bound (500 MB: 482 → 18 s); `IRIS_SCENE_BUDGET_MB` evicts scenes, `IRIS_WIDER_FIX_MAX_MB` (100) limits wider fixes.
Locally on 4 CPUs 150 MB took 123 s, 500 MB 484 s, so the deployed cap stays 150 MB until boxes and web-ifc drawing get
faster (next: a Web Worker). Checked by `tests/test_uploads.py` (7), `web/tests/uploads.test.mjs` (3); after PR reviews
491 server and 63 web tests.

Escalating to a larger model (Oct 29; `docs/escalation.md`, code `escalation.py`, `spend.py`, `agent._try_combined`): a
second, longer try on the escalation model (`GEMINI_ESCALATION_MODEL`) for a clash Gemini Pro could not fix, or for a
better fix. `GeminiModel.usage` counts usage priced from `IRIS_MODEL_PRICES`; one daily budget
(`IRIS_ESCALATION_MAX_USD_DAY`) is claimed atomically (`spend.claim` / `spend.held`), with caps `IRIS_ESCALATE_PER_HOUR`
/ `_PER_DAY` (`ProposeLimit.take_all`). The brief carries the first try's ideas and failures, nearby openings and
elements within 5 m; the last try is kept per scene and pair (`Workspace.last_try`) while revision and requirements
match. Combined fixes are a seventh kind: 1-3 move / offset / route steps on different elements, never structure,
checked together and kept all or nothing (`edits.kept_files`). Page buttons, model chips, chat and MCP
`propose_fixes(escalate=true)`. Checked by 520 server and 64 web tests and in the browser on Northbank #1.

Show it built (Oct 29; `docs/show-it-built.md`, code `built.py`, `web/src/BuiltView.tsx`, `Viewer.captureBuilt`): the
Gemini image model restyles Iris's view of a verified fix as a presentation render, checked before anyone sees it. A
cutaway is chosen from 12 directions by class costs, then look, ids and normals passes come from one camera; the result
must pass an outline pixel gate (edges F ≥ 0.55, worst tile ≤ 0.45) and two escalation-model judges, with one retry.
Cached by hash (`IRIS_BUILT_CACHE`), drawn once per key, off by default (`IRIS_BUILT_VIEWS`), charged to the escalation
budget with a lighter Gemini Pro check when spent. The page labels it "Illustration by the Gemini image model from
Iris's model view. The model is the record."; the PDF draws at most 10, the BCF keeps the true capture. Checked by
`tests/test_built.py` (11), `test_document.py` and accept → triage → Report in the browser. Known gaps: a combined step
moving another team's service doesn't add that reviewer; second-try options aren't de-duplicated.

A move keeps what it stands on (Oct 30; `docs/edits.md`, code `verify.supports` / `keep_supports`): fence posts with
anchors cast 70 mm into the slab failed every horizontal move, and escalated fixes lifted them off it to pass. For moved
non-run elements, what they stand on (base at a host's top or ≤ 300 mm into it, `verify.stands_on`) is kept if no deeper
than before; lifting off everything or sinking deeper fails. Applied in `agent._try_move`, `plans.verify_together`,
`Workspace.verify_move(obstacles=)` and `check_move(obstacle=)`. Checked by `tests/test_supports.py` (8) and 540 server
tests; C4 now gets plain moves (posts N3/N4 350 mm north), C5 still has no fix (every direction hits a conveyor, tray or
filter).

`.env` before every setting (Oct 30; code `server/iris/__init__.py`, `limits.env_int` / `env_float`; docs
[15](15-requirements-settings-and-config.md), [10](10-http-api-and-streams.md)): settings read at import ignored `.env`
locally (Cloud Run sets real variables) and an empty cap crashed on `int("")`. Now `__init__.py` calls
`model_client.load_env()` first, real variables still win, and number settings treat unset or empty as default. Checked
by `tests/test_env_file.py` (3) and 553 server tests.

Chat and MCP take their routes' caps; a visitor is the peer (Oct 30; code `plans.read_patterns`, `chat.Chat._run`,
`mcp_server`, `limits.client_id`; docs 09 and 16): pattern readings from chat, MCP and the route share
`plans.read_patterns` (one proposal per new reading, cached, empty readings free); chat and MCP detection take a
detection run (`IRIS_DETECT_PER_HOUR` / `_PER_DAY`) charged to the visitor, never the owner. The deploy sets
`IRIS_TRUST_FORWARDED` 0 (peer address) so a visitor can't pick their identity through `X-Forwarded-For`; N > 0 takes
the N-th entry from the right. Checked by 559 server tests (9 new, failing on the old code).

Iris in every download, and the cell tour on the current cell (Oct 30; `docs/architecture/14`, `19`, `21`): downloads
are `iris-report.pdf`, `iris-issues.bcfzip` and `<project>-iris.zip` (`app.export_zip_name`); the PDF names the triage
model that ran (`document.triage_by`, `model_client.triage_model_info()`). The cell tour (161 parts, 17 pairs) was
re-recorded on the current STEP, since GlobalIds follow its bytes; a failed live proposal now offers the recording
(`liveMissed`). Checked by 552 server and 69 web tests, `evals/detection_cell.py` Rev A 17/17 with 0 unexpected, and
headless Chromium through all 12 steps.

Keeping a fix tries it again (Oct 30; [07](07-fixes-and-edits.md) "Keeping a fix", code `plans.recheck` /
`plans.apply`): apply routes rebuilt fixes without re-checking, so a client could keep an unverified edit. Every keep
now goes through `plans.apply`: options are re-tried as proposed (`plans.CANDIDATE`, `agent.TRIES`), checked together
(`verify_together`) and kept in one re-entrant `edits.kept_files` or not at all; a failing fix is a 409
(`plans.NotVerified`). Checked by `tests/test_keep_verified.py` (9) and 559 server tests; on Northbank tampered options
were refused in 0.4-1.0 s with the scene unchanged, and the girder plan (duct +400, tray +250, cold water +280 mm, three
trims) kept in 7.4 s.

Joints (Oct 30; `docs/connections.md`, code `connections.py`), slice 1 of 3: joints are connected ports, or for STEP
parts flow faces meeting within 2 mm with opposed normals; `connections.run` joins straight segments cap to cap. A move
that would pull a joint apart is refused (`plan_move`, `IRIS_CONNECTED_MOVES` refuse | carry | off) everywhere moves are
checked, and the model reads what each side is joined to (`connections.describe`). The cell's 40 flow parts' joints take
3.8 s. Tests in `tests/test_connections.py`.

Moves that keep their joints (Oct 30, slice 2): `IRIS_CONNECTED_MOVES` defaults to `carry`. `plan_move` takes fittings
and valves along, stretches a segment the move runs along (`edits.stretch`), and refuses equipment, structure, side
branches, pieces < 50 mm or more than 12 parts; `check_joints` keeps ports ≤ 2 mm apart and
`Workspace.apply(expect=edit)` refuses a changed plan. Cell C2 lifts 4 parts with the riser 150 mm taller; the Northbank
census (`evals/joints.py`) has 195 of 1,992 dry plans keeping their joints, median 16 ms. Tests in
`tests/test_connected_moves.py`.

See connections (Oct 30, slice 3; code `connections.graph`, `web/src/links.ts`, `Viewer.setLinks`): `GET
/api/scenes/{sid}/connections` returns edges (joint, assembly, hosted, rests_on, contact), cached by revision (Northbank
0.38 s: 875 rests on, 650 joints, 26 hosted, 6 contacts). Alt + point or the **Connections** toggle (key L) lights
linked elements by kind; Shift lights the whole run. Tests `tests/links.test.mjs`, `tests/viewer-links.test.mjs`.

Sign-offs kept per report (Oct 30; code `web/src/signoffs.ts`): sign-offs stored under the report title leaked between
runs titled "Coordination · N models" and could lift the PDF's DRAFT wrongly. They are now keyed per clash id
(`iris.signoffs:clash:<id>`, stable across reruns) or, for imports, title and files; old entries migrate only to
matching clashes (`migrateTitleKeyed`). Checked by `web/tests/signoffs.test.mjs` (5) and 80 web tests.

About Iris (Oct 30; code `web/src/AboutIris.tsx`, `aboutRoute.ts`): a full page in six tabs replacing the header's "How
it works" dialog, addressed as `#about/<tab>` so Back closes it; CSS/SVG animations with a reduced-motion still state.
Checked by `tests/about.test.mjs` (5) and Chromium at 1440x900 and 390x844.

Navigate freely, and drawing views beside 3D (Oct 30; design [docs/views.md](../views.md); code
`web/src/viewer/views.ts`, `drawing.ts`, `Viewer.ts`, `web/src/ViewPanes.tsx`, `server/iris/datums.py`): free navigation
(leave a clash, orbit about the pointer, view cube, orthographic, saved views, section box), display styles, filters,
hide and isolate. Single, Two and Quad layouts show plan, section and elevation as orthographic cameras with
stencil-filled cut faces and linework from one composite shader; each clash click sets the unpinned views. `GET
/api/scenes/{sid}/datums` gives levels, grids and storeys. Checked in Playwright on Northbank (captures byte-identical,
Quad redraws idle 0, new clash 3), `test_datums.py` (6), `views.test.mjs` (11), `drawing.test.mjs` (4); real-GPU frame
times still to measure.

Review of the drawing views (Oct 30; `drawing.ts`, `views.ts`, `ViewPanes.tsx`): cut faces count front and back faces
instead of parity so overlapping parts fill; redraw keys include look and up; annotations survive maximise; duplicate
level names no longer make a 0 m storey (`views.nextAbove`); narrow panes fold header controls into a menu. Checked by
102 web tests, `tsc`, and Chromium in Quad at 1600, 1366 and 1180 px.

Drawing views after the live smoke test (Oct 30; code `web/src/viewer/drawing.ts`, `Viewer.ts`, `annotate.ts`, `ui.tsx`,
`App.tsx`): the viewer went blank from a lost WebGL context (each drawing pane's targets were 4× multisampled, about 90
MB a pane). Drawings now skip multisampling, hidden panes free their targets, a lost context is announced and every pane
redraws on restore while captures and thumbnails wait. Pan/zoom redraw once at rest; resizes no longer blink; Esc closes
only an open menu. Checked on Northbank (software GL): one redraw after 60 pan moves, no black thumbnails after
`WEBGL_lose_context`; 102 web tests.

Approved identity and motion library (Oct 30; `assets/brand/iris/`, design in `docs/brand-assets.md`): the owner chose
the Iris Type wordmark and split-O symbol, delivered as vector masters, SVG/PNG/icon/print/social assets and palette
tokens, plus Orbit, Breathe, Resolve, Settle and Reveal motion as SVG/APNG/GIF, native elements and React wrappers that
honour reduced motion. Checked: web build, 102 web tests, 9 architecture-map tests, wrapper type check, browser checks
at phone to desktop widths.

Measure in every view, and the rail split (Oct 30; design [docs/measure.md](../measure.md); code
`web/src/viewer/measure.ts`, `Viewer.ts`, `MeasurePanel.tsx`, `ViewerToolbar.tsx`): M works in 3D and every drawing
(points on the drawing's plane), snapping (N) to ends, midpoints, feature edges and cut outlines; the Measure panel
keeps several measurements to copy, delete or clear. In Two and Quad the 3D tools move into the 3D pane. Checked in
Chromium on Northbank, Quad: snaps on a pointer grid, plan measurements at Δz 0, rails at 1600×1000 and 1366×768;
`measure.test.mjs` (6); 108 web tests.

Panels that dock, collapse, float and pop out (Oct 30; design [docs/panels.md](../panels.md); code `web/src/dock.tsx`,
`dockLayout.ts`, `App.tsx`, `Tour.tsx`, `web/public/popout.html`): dockview 8.5.1 (MIT, pinned, never its paid package),
classic layout as default, pop-outs from the start. Panel content renders into slots that only move, so nothing
remounts; the classic layout places the same slots as `display: contents`; layouts persist per browser. Checked:
`dock.test.mjs` (7), 109 web tests, bundle +93 kB JS / +11 kB CSS gzipped; Playwright on Northbank float, collapse,
pop-out, reload, Reset, tour.

Review of the panels (Oct 30; `dock.tsx`, `dockLayout.ts`, `ReportList.tsx`, `Chat.tsx`): split floating/pop-out windows
save and reload whole (`windowViews`) and stay drop-locked after `fromJSON`; one `components` object stops constant
re-layouts; handles let go only on real unmount; pop-out clash lists scroll in their own document; `Popover` keeps menus
inside clipping panels (`roomFor`). Checked: 111 web tests; in Chromium an edge click leaves the right bar at 380 px.

Properties of any element (Oct 30; code `server/iris/properties.py`, `service.py`, `app.py`, `web/src/Properties.tsx`):
a click selects any element, even a faded one behind a see-through view; the Properties panel shows card, type,
materials, size, attributes and every property/quantity set (SI) with filter and copy, served by `GET
/api/scenes/{sid}/elements/{gid}/properties`. Checked: `test_properties.py` (5), `properties.test.mjs` (4), 115 web
tests; on Northbank the girder reads Steel S355, 400 × 12000 × 1000 mm.

The owner's test of the panels (Oct 30; `dock.tsx`, `dockLayout.ts`, `index.css`): empty side bars give their room to
the model (`fitEdges`) and return when a panel docks; the dock is its own stacking layer so tooltips and dialogs sit
above floating panels; a bar's only panel can now pop out (`popOut` floats it first, `returnToBars` restores it).
Checked: 121 web tests; at 1440×900 the model grew from 750 to 1060 px with one panel floated, 1440 × 850 with all five.

When the server lets go of the models (Oct 30; code `server/iris/app.py`, `web/src/api.ts`, `App.tsx`, `BuiltView.tsx`):
every deploy and idle scale-down starts a fresh process with no scenes, so a page holding an old scene id got 404s.
`_scene` and `_report` now add `X-Iris-Gone: scene:<id>` / `report:<id>` (`_gone`); App shows one notice, drops fixes
and evidence, hides Export and offers **Open them again** (`reopenGone`). Checked: `test_api.py`, `gone.test.mjs` (3),
607 server and 124 web tests, and a server restarted mid-session.

The Iris notch, menu and brand in the app (Oct 30; code `web/src/Brand.tsx`, `AppMenu.tsx`, `ViewPanes.tsx`,
`index.html`, `server/iris/document.py`): the desktop header is gone; the wordmark hangs in a notch (About Iris) and
**Menu** opens `MenuSheet` on every layout. The notch grows while Iris works (`notchStatus`), `LoadCard` lists real
loading steps via `Viewer.load`'s `onDrawn`, spinners are the split-O, and favicons, manifest, splash and PDF cover use
the kit. Checked: 124 web tests; at 1440×900 on Northbank (4 of 4 downloaded, 5.1 MB, 1,961 elements drawn) and the PDF
cover in WeasyPrint.

A machines pack and a persona per domain (Oct 30; code `server/iris/domains.py`, `domain_packs/machines.md`, the shared
prompts): every prompt said "senior BIM coordinator", so the palletising cell was treated as a building. `domains.of(ws,
scene_id)` reads an all-STEP scene as `machines`; the fix agent reads `machines.md` (static-coordination rules: anchored
frames and robot bases stay, guarding and safety zones intact, no robot-motion claims) and other prompts fill `{role}`
per domain. Checked: `test_domains.py` (11); 618 server tests; `evals/step_cell.py` passes (17 of 17 planted pairs).

Team names typed, titles and the rule audit by domain (Oct 30; code `domains.py`, `titles.py`, `triage.py`,
`document.py`, `web/src/ReportDoc.tsx`): no team name is fixed; the report dialog has a field per model (cleared returns
the guess), triage's `responsible` is held to guessed teams (`triage.schema_for`) and mapped to typed names
(`STAYS_FIRST`). `titles.md` takes `{meeting}` per domain and `triage.AUDIT` takes `{role}`. Checked: `test_domains.py`
(14), 621 server and 124 web tests.

Workings (Oct 30; code `web/src/runlog.ts`, `workingsGraph.ts`, `Workings.tsx`, `Activity.tsx`, `server/iris/agent.py`;
design [docs/workings.md](../workings.md)): the Activity panel draws each run live as lanes (who started it, the model,
Iris) of steps for proposals, Fix together, triage, Show it built and checks, with Follow, zoom, replay and a run
picker. Existing trackers write the run log; no new dependency. Checked: 135 web tests (`workings.test.mjs`, 11) and
live runs on Northbank. Review (PR 58): `workings.ts` renamed `workingsGraph.ts` (case-only clash), superseded runs end,
and the server times each check (`attempt.seconds`); 607 server tests, 136 web tests.

Collapsed side bars' strips (Oct 30; `web/src/index.css`): vertical tabs get 12 px above and below and 4 px between, the
marker on the inner side; later their content centres across the 40 px strip (11–28 px instead of 22–39 px). Checked in
Chromium on Northbank with the bars collapsed, including at 3× scale.

Workings in the viewer, rejecting a fix, landing in view (Oct 30; `Workings.tsx`, `runlog.ts`, `fixKinds.ts`, `api.ts`):
hovering a check in Workings shows that trial in place (teal pass, amber with hits) and a click keeps it
([docs/workings.md](../workings.md)). Reject sits beside Accept with an optional why and Undo, and the next proposal
sends rejections as `notes` ([docs/edits.md](../edits.md), "Rejecting a fix"). The Clash panel scrolls to Verified
options once per result. Checked: 139 web tests; a rejection reason carried into the next request.

Nothing fixed to one project, domain, demo or vendor (Oct 30; code `requirements.py`, `domains.py`, `demos.py`,
`demos/*.json`, `scene.py`, `agent.py`, `model_client.py`, `mcp_server.py`, `web/src/aiNames.ts`, `Requirements.tsx`):
new optional `Doc.domain` and `Doc.stays`; `IfcScene.stays` replaces `FIXED_CLASSES`, `agent.STAYS` and `Element.fixed`
via `Workspace.requirements_for`. `demos.py` holds demo sets and default requirements served by `GET /api/samples`;
`requirements.DEFAULT_CLEARANCE_M` replaces every 0.025. Settings include `IRIS_MODEL_LABELS` / `_PRICES` and
`GEMINI_INCLUDE_THOUGHTS`, and `GET /api/models` names each role's model (`labels.proposal`). Checked: 629 server tests
(`test_defaults.py`, 8 new), 142 web tests; `step_cell.py` passes with requirements off and on; Northbank still 464
clashes in 1,732 elements.

Properties floating or on the right (Oct 30; `dock.tsx`, `dockLayout.ts`; [docs/panels.md](../panels.md)): Properties
can dock right (after Chat) or float, its last place kept in `iris.dock.properties`; with four tabs, back tabs show as
icons so nothing hides in an overflow menu. Checked: 143 web tests.

The escalation model's own lane in Workings (Oct 31; code `web/src/workingsGraph.ts`;
[docs/workings.md](../workings.md)): a second try drew in the escalation model's colour under the first model's label;
it now gets its own lane and timeline row when it runs. Checked: 143 web tests (`workings.test.mjs`).

The repository renamed to Iris (Oct 31): repo only; the code's internal `iris` names stay
([21](21-glossary-and-naming.md), "Internal names kept on purpose") and README's "Run it" starts with the clone.
Checked: `git fetch` on the new remote, `test_docs_map.py`.

Orbit round the selection and the clash (Oct 31; code `web/src/viewer/Viewer.ts`, `App.tsx`): a drag orbits round the
selected element's box centre, or round the clash while Iris works on it (`orbitAround` keeps the pivot fixed on
screen); the pilot's slow turn glides sideways to centre the clash first. Checked: `viewer-orbit.test.mjs` (2); 145 web
tests.

A patterns reading's 502 (Oct 31; code `web/src/api.ts`): an automatic patterns reading (`POST
/api/reports/{id}/patterns/{scene}/triage`) got a 502 from the gateway without reaching the server, a slow silent
request left unread. `api.triagePatterns` now retries after 502/503/504 or no answer (after 1.5 s and 4 s); it cannot
charge twice since `plans.read_patterns` keeps one reading per report, scene and patterns. Checked:
`gateway-retry.test.mjs` (2).

Filter the clash list by status (Oct 31; code `web/src/ReportList.tsx`): once anything is fixed or reviewed, filters
offer All, To fix (replacing "Hide resolved"), Fixed and Reviewed with counts; header chips toggle them. Checked on
Northbank: All 464, To fix 463, Fixed 1; 145 web tests.

The Triage card and the top of the clash list, laid out again (Oct 31; code `web/src/Triage.tsx`, `ReportList.tsx`,
`index.css`): a Step 1 pill and full-width **Triage all n clashes** button; the naming message became a "Naming n…" pill
whose tip names the model; search gets its own row and filters appear only when useful. Checked in Chromium at desktop
and phone widths in every card state; 145 web tests.

Seat: one element bears on another (Oct 31; design in `docs/edits.md` "Seat", code `edits.seat`, `agent.seat_of` /
`_try_seat`): prompted by Northbank's #16, a lift-pit wall 500 mm into pad B1, and decided from geometry for any pair. A
seventh kind, `seat`: an element coming down into a straight-prism support (standing 50 mm above it, foot at most 100 mm
below its bottom, cut at most half of it) gets a recess (`IfcOpeningElement` RECESS) of the support's top face with a 1
mm bedding joint, since flush faces re-measured as -500 mm. Structure reviews it (`domains.SEAT_REVIEW`); wired through
`Workspace.check_seat`, chat and MCP (32 tools). On #16 the seat was proposed first, verified and ranked above a trim
(0.20 x 0.50 x 0.65 m cut); Detect again: 1 resolved, 0 new. `tests/test_seat.py` (15); 644 server, 148 web tests.

No layout patches behind the load card (Oct 31; `web/src/viewer/Viewer.ts`): with two or four views, the empty panes'
backgrounds showed behind "Loading 4 models"; `drawFrame` now draws one empty 3D view over the stage until models open.
Checked: `web/tests/viewer-empty-stage.test.mjs` (2) and in Chromium.

More model formats on the roadmap (Oct 31; owner decision; no code): GLB, glTF, OBJ, STL, DWG and the like wait until
after the freeze and come in only as checked models converted to IFC on the server like STEP, glTF/GLB first
([20](20-decisions-limits-and-roadmap.md)). A trial via `step.convert`: GLB kept the six parts and three clashes; IGES
gave one part.

Design tools and site data on the roadmap (Oct 31; no code): two "Later" sections in
[20](20-decisions-limits-and-roadmap.md): connectors into design tools (send native ids, receive kept fixes, apply
natively), with a table of tools, ways in and feasibility; and site data aligned to the model with an image segmentation model (capture,
alignment, segmentation, lifting to 3D, measuring on the server). None built or tried.

Every property of an object (Oct 31; `server/iris/properties.py` `Reader`, `web/src/Properties.tsx`;
[docs/panels.md](../panels.md)): one reader walks the model's relationships for any object with a GlobalId: every
attribute with its unit, type and type sets (`from_type`), every property kind, materials and layers, classifications,
groups, documents, storey and project path; an IFC4 property-set 500 is gone. `properties.shown` keeps the hidden demo
note out. Checked: `evals/properties_complete.py` on six Northbank files (5,666 objects, 16,303 values, counts match an
independent count, 2.2 s); `tests/test_properties.py` (10); 649 server, 151 web tests.

The filters' index (Oct 31; `server/iris/facets.py`, `GET /api/scenes/{id}/facets`; [docs/filters.md](../filters.md)):
every filterable value the Properties panel shows, turned round so each lists its elements, built with the panel's
reader and kept until a kept edit; `facets.matching` serves chat and MCP. Northbank: 1,997 elements, 46 facets, 0.8 s,
about 240 KB. `tests/test_facets.py` (7).

The Filters panel (Oct 31; `web/src/filters.ts`, `FiltersPanel.tsx`, `Viewer.setRules`;
[docs/filters.md](../filters.md)): filters by models, classes, floors and property conditions (lengths in mm) colour,
colour by value, hide or isolate, combining with Grey the rest, Colour by…, Zoom to them and counts; kept per model set
and in saved views. Ten colours at least ΔE 22 from other roles. Checked: `web/tests/filters.test.mjs` (7),
`viewer-filters.test.mjs` (3); Colour by System on Northbank (11 systems, 844 elements).

Filter colours in drawings (Oct 31; `Viewer.setDrawingsShow`, `useDrawingPaint`): drawings show what the filters leave,
what the 3D view shows, or the whole model, filling coloured elements on paper, with a colour key over the 3D view; on a
phone Filters sits under Tools. Checked: `web/tests/viewer-filters.test.mjs` (5), Chromium and a 390 px phone.

The Properties panel, redesigned (Oct 31; `web/src/ElementCard.tsx`; [docs/panels.md](../panels.md)): header,
breadcrumbs (Project › Site › Building › Level, each opening its properties), an icon bar (A, B, zoom, hide, isolate,
section box, links), then every set; each value has Copy, Filter by this value, Colour by this property and Isolate all.
Checked in Chromium: Supply air on #1's duct filters 271 elements.

Filters by chat, voice and agents (Oct 31; `facets.resolve`, `set_filters` / `clear_filters` in `chat.py` and
`mcp_server.py`; [docs/filters.md](../filters.md)): filters resolved on the server against the index (an unknown name
fails with the closest so the model retries) and sent to the page as `ui filters`; MCP has 34 tools, chat 26; voice goes
through chat. After a live run named a missing system, `set_filters` reports each coloured value with its count; Zoom to
them frames only what is shown and the key lists only colours on screen. Checked: `tests/test_chat.py` (9),
`test_facets.py` (9), `web/tests/filters-chat.test.mjs`.

Applying a filter zooms every view (Oct 31; `filters.applied` / `zoomTarget`, `Viewer.frameEverywhere`;
[docs/filters.md](../filters.md), "Zoom"): any filter added or changed, by page, chat or MCP, flies the 3D view and pans
unpinned drawings to what it acts on; restored filters do not move the camera. Checked: `web/tests/filters.test.mjs`
(10), `viewer-filters.test.mjs` (6), 168 web tests.

The review of the filters PR (Oct 31; PR #75, 15 comments): empty chat conditions refused, `filters.withBy`, twenty
colours then Other, Try again on a failed index request, index built outside the lock, `datums.storey_name`, yes kept
apart from 1. Checked: `tests/test_facets.py` (13), `test_properties.py` (11), `web/tests/filters.test.mjs` (12).

Checks on filters, on the server (Oct 31; `detect.Selection.filter`, `check_id`, `check_name`;
[docs/detection.md](../../docs/detection.md)): a test's side can be a filter (B also Everything or itself); a check's id
comes from what it compares, a clash keeps id, #N, views and sign-offs across checks, and no element pairs with itself.
`detect_clashes` takes sides `a` and `b`, counted before a run is spent; the page shares its filters with chat and
agents. Checked: `tests/test_detect.py` (28), `test_facets.py` (14), `test_chat.py` (12).

Checks on filters, on the page (Oct 31; `web/src/checks.ts`, App's `filterCheck`;
[docs/filters.md](../../docs/filters.md), "Checks"): What do these hit? per filter, and Check clashes picks sides, hard
or clearance and mm; results replace the list. On Northbank, Level 02 supply ducts: 5.3 s, one clash under the full
check's id and #1; a run sharing no test now calls new only unnumbered clashes. The index reads outside the lock (0.9 s
alone, 2.9 s during the opening check). `web/tests/filters-check.test.mjs` (8), 179 web tests.

Public local setup and bundled demo data (Oct 31): the README gives a two-terminal local setup
(locked installs, uv Python 3.13, Node, safe `.env`, key-free fixture check, PDF/GL dependencies). Six Northbank IFCs
and PC-03 Rev A/B STEP files (15,443,510 bytes) ship in the repo via a `.gitignore` allowlist, disclosed as synthetic
baseline data. Checked: SHA-256 hashes match, nine map checks and `git diff --check` pass.

Hide the rest (Oct 31; `FilterState.hideRest`, `set_filters` `hide_rest`; [docs/filters.md](../../docs/filters.md)): the
rest is Shown, Grey or Hidden, keeping colours and reaching drawings, also from chat and agents. Checked:
`web/tests/filters.test.mjs` (13), `filters-check.test.mjs` (9); a chat request isolated 68 Level 02 ducts in blue.

Windows setup fixes and updating a local checkout (Oct 31): WinGet commands for uv and Node, a fresh terminal for PATH
and `npm.cmd` past PowerShell's `npm.ps1`; README and map doc 17 describe exporting edits, stopping servers,
fast-forwarding and re-syncing. `tests/test_docs_map.py` passes.

Orbit round the clash in focus (Oct 31; `web/src/viewer/Viewer.ts`, `App.tsx`): the clash in focus is now the pivot
(`setOrbitClash`) and a press stops a camera flight first; the selection still wins. `web/tests/viewer-orbit.test.mjs`
(4); a 220 px drag kept #1's marker within 3 px (370 px before).

The corner keeps clear of the notch (Oct 31; `web/src/App.tsx`, `index.css`, `Owner.tsx`): the top right corner ran up
to 222 px into the wordmark notch. The kept-fix count moves onto Export (✓n), owner settings onto their button; pills
drop to icons under 1180 px and the notch narrows (`--corner-w`). `web/tests/corner.test.mjs` (2); clears by 34–311 px.

Chat turns in Workings (Oct 31; `web/src/workingsGraph.ts`, `Chat.tsx`, `runlog.ts`): each chat turn is a run ("Chat:
<question>") with each model call, tool, result and answer, via an `asked` event and `traceChat`; MCP agents not drawn
yet. Checked: 187 web tests; "filter by distribution systems" drew its run in Chromium.

Checks take what the filters show (Oct 31; `facets.acted` / `shown`, `detect.everything`, `checks.viewOf`;
[docs/filters.md](../../docs/filters.md), "Checks"): a filtered check had taken the Site model (1,961 elements, 633
clashes). A filter side is what it acts on, Everything excludes site models, and What the filters show (`{"shown":
true}`) is a side. Checked: `test_detect.py` (32), `filters-check.test.mjs` (11); Distribution system vs Everything: 3
clashes; shown (1,732) within: 464.

No blank page as the panels arrive (Oct 31; `web/src/App.tsx`; `docs/panels.md`, "Into the dock under a cover"): a cover
(`dockCover`) holds the dock switch until the stage draws three frames (6 s at most), then fades.
`web/tests/dock-cover.test.mjs` (2); a 10 fps recording went from 25 blank frames to none; 189 web tests.

A fix option's rows lost their grey boxes again (Oct 31): the filters' segmented choices reused `.fact`, greying a fix
option's rows; they now use `.fseg`. `web/tests/filters.test.mjs` (14) guards `.fact`.

Counts match between the filter list and Check clashes (Oct 31; `checks.sideCounts`, `chat.side_count`): every place
says the list's 1,768, naming the 36 rooms a check cannot test (`rooms_not_checked`). `filters-check.test.mjs` (12),
`test_detect.py` (33).

Kept checks: several clash checks at once (Oct 31; `server/iris/checks.py`, `Workspace.detect_all` / `union_report`,
`detect._assign_ids`, `Detect.tsx` `CheckPicker`; [docs/detection.md](../detection.md), "Kept checks"): each check keeps
its latest run, diffed against its own; one list with one #N per clash, a picker (Run again, Remove, Run all again),
triage readings that carry while a pair's depth moves at most 1 mm; `detect_clashes(check=…)`, `GET`/`DELETE
/api/scenes/{id}/checks`, `IRIS_MAX_CHECKS` (12). Checked: `tests/test_checks.py` (13), 694 server, 200 web tests;
Northbank full check 464 clashes in 5.1 s, ducts 1 in 2.2 s, beams 240 in 0.6 s keeping ids; Run all again 7.0 s.

**Oct 31, review of the kept-checks PR** (PR #87). Fixed: a failed triage read stays unread (`Register.keep_reading`);
titling is one run per scene (`_title_key`, `_kept_titles`); a reading reaches a new list only for an unchanged clash
(`checks.same_clash`, `_same_in`, web `sameClash`); reused keys move to the end of the jobs' cap (`_keep_job`); Triage
during a run follows or queues behind it (`Job(after, prepare)`). Checked: `tests/test_checks.py` (20), 701 server
tests; `web/tests/checks-list.test.mjs` (8), 201 web tests; build clean.

**Oct 31, proposal clips in the README.** A "See it work" section shows live proposal runs as animated WebP time-lapses
in `docs/media/proposals/` (Northbank #1-#3, the cell's #66). `web/scripts/capture-proposals.cjs` records Chromium's
screencast and `web/scripts/timelapse.py` speeds waits up 2-6×. Checked: four runs against a local server with the
model, each with one verified option (duct +400, tray +250, cold water +280; air line −150); `tests/test_docs_map.py`
passes. (Later removed: they showed the pre-Iris UI, and are to be recaptured on Gemini.)

**Nov 1, a fixed clash left the clash list when selected.** With a verdict filter on, the selected clash alone gets the
live measure (no overlap once fixed), so the "real" filter dropped it. Fix: a clash with a kept fix keeps its triage
verdict (moved into `noClash.shownVerdicts`), and the selected row stays. Checked: `web/tests/clash-list.test.mjs` (2),
203 web tests, build clean.

**Nov 1, quick actions on a clash row** (`ReportList` `RowActions` / `sameElements`, App's `proposeFromList`). Hovering
a row shows Propose fixes, Mark as not a clash, and a count of clashes sharing either element (narrows the list).
Checked: `web/tests/row-actions.test.mjs` (3), 204 web tests, build clean; in Chromium on Northbank, Same elements on #1
shows the 15 clashes on the duct or girder.

**Nov 1, a clash row shows its proposal** (App's `trackAgent` / `runState` / `doneProposals` / `viewProposal`). Fixes a
run's result landing on another clash's panel: the tracker writes the panel only while that clash is on screen; the row
shows Proposing…, "N fixes ready" or "No fix found", with View; one runs at a time ("Waiting for #N"). Checked:
`web/tests/proposal-status.test.mjs` (2), 208 web tests, build clean; in Chromium against a local server, #1 kept
proposing with #2 open.

**Nov 1, isolate a clash's elements from its row** (App's `isolating` / `isolateClash` / `endIsolation`). Isolate uses
the page's temporary isolation for the two elements plus a kept fix's pieces; while on, each clash opened next goes
straight to its own isolated pair until Show all, Reset or the button again. Checked: `web/tests/isolate-clash.test.mjs`
(2), `row-actions.test.mjs` (4), 211 web tests, build clean; seen in Chromium.

**Nov 1, hand edits and one edit log for everything** ([docs/manual-edits.md](../manual-edits.md)). `journal.py` logs
every keep (fixes, plans, MCP, hand edits) (who, what, lineage, check) with undo/redo over each file's transactions;
trial moves run in `edits.scratch` because one outside a transaction broke undo (`UndoSystemError`); files keep 1,024
transactions. `faces.py` / `manual.py` add push/pull, align, move, void, cut, split, remove a section, delete and clip,
each gated by the requirements and checked in a trial and on keep (`/edit/*`, `/edits*` routes). The page gets the Edit
tool (P), Keep with N clashes, an Edits panel and Ctrl+Z / Ctrl+Shift+Z. The model gets chat tools (`list_faces`,
`edit_check`, `edit_keep`, `undo_edit`, `list_edits`) behind a consent gate; MCP has matching tools. Edits flow to the
report, BCF, exported IFC (`Iris_Edit`), `iris-edits.json`/`.csv` and STEP. Checked: `tests/test_journal.py` (9),
`test_manual.py` (23), `test_chat_edits.py` (4), `test_edit_log_out.py` (5), 750+ server tests;
`web/tests/edit-helpers.test.mjs` (4), 213 web tests, build clean. In Chromium on Northbank, pushing clash #1's duct top
50 mm reported "Makes 1 clash: girder −350 mm" and kept, as did the model via chat; a model fix (offset +400 mm) then a
20 mm hand pull kept E2 following E1, clash still resolved.

**Nov 1, fewer restrictions on editing by hand** (owner feedback). Every body has faces (`edits.solids`, mesh corners,
section sides, clip planes); align at first contact with Clip it flush; open joints kept via `accept_joints`; split and
clip on any body (`edits.split_by_clip`); a live drag. All 1,732 Northbank physical elements now have a face to push (was
1,324), listed in 1.6 s. Checked: 761 server, 218 web tests, Chromium. Design: [docs/manual-edits.md](../manual-edits.md).

**Nov 1, review of PR #92** (13 threads). A push takes only openings through its face; chat consent gate
(`chat.consents`); undo/redo re-measure clashes (`clash_states`); `edit_rerun_limit`; `faces.curve_points`,
`detect.measure_pairs`, structure rules in `hosts.py`. Checked: 771 server, 222 web tests, build clean, `test_docs_map`.

**Nov 1, hand edits change the face or element picked only** ([docs/editing-parity.md](../editing-parity.md), 0a). Joined
parts stay unless `carry: true` (**Take joined parts along**); open joints kept only as **Keep with N open joints**. Export
CSV/JSON written as UTF-8. Checked: 768 server, 222 web tests; Chromium: Northbank supply main moved 50 mm, undone.

**Nov 1, hand edits can no longer leave a model saying two things** ([docs/editing-parity.md](../editing-parity.md), 0b).
`fixtures.build_parametric_fixture` carries layer/profile sets, `Axis`, joins; `consistency.py` plus `manual.check` refuse
what an edit makes worse, in words with numbers (0.38 s vs 0.40 s on a wall). Checked: 796 server tests,
`test_parametric_edits.py`; on the running server a refused edit's keep answers 409.

**Nov 1, hand edits bring the model's data along** ([docs/editing-parity.md](../editing-parity.md), Tier 1). `parametric.py`
grows layers, updates profiles, `Axis`, base quantities (`quantities.py`) and joins; shared data is copied per element
(`edits.unmap`, type "… (Iris)"), a `shared` rule guards it. Checked: 804 server tests; 24-edit matrix schema-valid;
exported W1 300 mm, W2 still 250 mm, `Iris_Edit` stamped.

**Nov 1, MEP by hand: offset, join, disconnect** ([docs/editing-parity.md](../editing-parity.md), Tier 2).
`edits.apply_offset`, `join_plan`, `join_segments`; keys F, N, X; the model and MCP read the ops. Fixed snapping through
context and off-step number fields (`noValidate`). Checked: 812 server, 223 web tests; clash #1 offset 400 mm, cleared.

**Nov 1, what the model says, edited** ([docs/editing-parity.md](../editing-parity.md), Tier 3). `property_edits.py` edits
attributes, properties, type, material, classification and storey as undoable `property` entries; routes
`…/property-choices`, `…/properties`, `edit_property`; the Properties panel gets pencils. Checked: 820 server, 225 web.

**Nov 1, the model's fixes keep the model true** ([docs/editing-parity.md](../editing-parity.md)). Fix trials sync sets,
`Axis`, quantities and joins (`agent._fix_trial`, `_keeps_true`); `plans.apply` refuses on disagreement. Checked:
`test_fix_consistency.py` (a trimmed typed beam keeps axis and quantities at 4.8 m).

**Nov 1, bends at any angle**. `edits.bend_turn`, `_bend_mesh`, `apply_offset(bend_deg=)` 15 to 90; Edit tool 90°/45°.
Checked: `test_mep_edits.py` (a 45° offset is one joined chain, middle 400 mm up), 225 web tests.

**Nov 1, transitions on a carried resize**. A pushed duct/pipe size adds transitions at joined ends
(`edits.add_transitions`, `_loft_any`), max 30° turn. Checked: `test_mep_edits.py` (a 173 mm transition), schema-valid.

**Nov 1, classifications from the panel** (Tier 3). Swap in one change (`replace`), remove, or **Add a classification**;
duplicates refused. Checked: `test_property_edits.py`, 226 web tests.

**Nov 1, apply to the type**. `scope: "type"` (**Apply to the type**) changes every element of the type
(`parametric.type_share`, `to_type`), others clash-checked. Checked: `test_parametric_edits.py` (F1 and F2 100 mm taller).

**Nov 1, a carried wall end**. Path-joined wall ends follow a carried move (`manual._retrims`). Checked:
`test_parametric_edits.py` (W2 moved 500 mm east: W1 4.5 m, join held, undone).

**Nov 1, the model and agents use the new edits**. Chat rules and `edit_check`/`check_edit` say when to carry joined parts
or apply to the type; `edit_property` documents `replace`. Checked: chat, MCP and property suites (30 passed).

**Nov 1, a beam's axis stays at its cardinal point**. `parametric._cardinal`; new `cardinal` rule
(`consistency.cardinal_offset`). Checked: `test_parametric_edits.py` (BM1 top 50 mm: axis 3.025 m), `test_consistency.py`.

**Nov 1, a layered type made thicker for every wall**. `parametric._grow_layers`, `manual._push_face`. Checked: W1's face
50 mm makes WT-250's insulation 85 mm and W2 300 mm wide, undone; pulling through plaster refused.

**Nov 1, the model's wall moves keep their joins**. `agent.joined_ends`, `follow_joined`, `plans._keep_move`. Checked:
`test_fix_consistency.py` (W2 300 mm east: W1 4.3 m, one entry, undone).

**Nov 1, a carried move re-fits its neighbours**. Bends and a riser instead of moving a doubly-joined straight
(`connections.plan_move(refit=True)`, `edits.apply_jog`). On Northbank 664 carried 400 mm plans keep joints 370 times (102
before). Checked: `test_mep_edits.py`.

**Nov 1, the model's moves re-fit too**. `connections.refit_moves`, `IRIS_MOVE_REFIT` (on unless `off`), kept by
`Workspace.apply`; combined fixes not yet. Checked: `test_mep_edits.py`, `test_connected_moves.py`, agent suites.

**Nov 1, hand edits on real Revit models** ([docs/editing-parity.md](../editing-parity.md)). Snowdon Towers (six IFC2X3
files): 1,644 checks, 1,493 made, 91 refused, 60 errors (one bug), one crash. Fixed IFC2X3 `IfcFlowSegment`, branches,
OpenCASCADE split crash, classification codes; `IRIS_GEOM_THREADS` and a neighbour cache (66 s to 13 s). 848 server tests.

**Nov 1, the Edit tool shows what else changes** ([docs/manual-edits.md](../manual-edits.md)). `manual.choices_for`,
`effects`, "Also changes N other elements" (`manual.also`); floating Properties closes on edit. Checked: 228 web tests.

**Nov 1, triage stops, goes on and reads faster** ([09](09-agent-workflows.md), "Stopping and going on"). Triage runs
in waves of `IRIS_TRIAGE_WORKERS` calls (default now 24, `triage.WORKERS`). Revit names elements "Family:Type:ElementId"
and `_stem` kept the id, so each Revit clash was its own call: a trailing `:<digits>` is now dropped (`_ELEMENT_ID`),
biggest alike groups first. `triage_report(stop=…)` cancels the queue and returns within 0.5 s, leaving unfinished
clashes unread; `POST /api/reports/{id}/triage/stop` is for the starter (`Job.starter`) or owner only, else 403. A
stopped or failed run is replaced by one seeded with its good readings that asks only the rest ("Continue · N left").
Checked: `test_triage.py`, 862 server tests, 236 web tests; on Northbank, Stop at 209 of 464 then Continue kept all 209.

**Nov 1, smoother curves in the viewer** ([13](13-3d-viewer.md), "Loading"). Snowdon Towers' round ducts drew as
12-sided faceted tubes. The loader now asks web-ifc for 24 sides (`ifcLoader.CIRCLE_SEGMENTS`) and makes creased
normals (`viewer/normals.ts`, 40° crease), also for kept fixes and previews; outlines and snap edges use 40° (were 25°).
In Node: Snowdon HVAC and plumbing +16-19% triangles, structure 1.0M → 1.6M (about 2 s slower, mostly rebar), smoothing
about 0.35 µs a triangle; Northbank 35k → 50k. Checked: `normals.test.mjs`, `viewer-patch.test.mjs`, web tests, build;
in Chromium on Snowdon, elbows and ducts shade smooth with only rims outlined.

**Nov 1, georeferenced models drawn without snapping** ([13](13-3d-viewer.md), "Coordinates and units"). Snowdon lies
about 418 km from its origin, where a float32 steps 31 mm, so vertices snapped and round ends came out square. The viewer
now draws from an origin (`viewer/origin.ts`), taking placements relative to it in double precision; the first file of
a load picks it (median placement, zero within 1 km of zero) and later files and patches reuse it; every IFC point
crosses through it, heights never shifted. Checked: `origin.test.mjs`, `viewer-load.test.mjs`, 240 web tests, build;
in Chromium on Snowdon, #2's elbow and #3's duct round before and after a kept push/pull.

**Nov 1, fittings placed right on millimetre and feet models** ([07](07-fixes-and-edits.md)). On Snowdon (feet) a
proposal blanked the 3D view: IfcOpenShell's `edit_object_placement` with `is_si=False` scales its matrix in place, and
`edits._new_fitting` passed the segment's shared frame, so each later fitting was rescaled (bends hundreds of km off,
passed as "verified"). It now passes a copy; metre models were unaffected. Checked: `test_route.py` (metres and mm),
866 server tests pass (5 failures also on main); in Chromium on Snowdon #14, the four bends drawn round the riser.

**Nov 1, a chain's pieces must meet** ([07](07-fixes-and-edits.md), "The chain builder"). A far-away piece hits nothing,
so it could verify. `_build_chain` now ends with `_check_meets`: each piece's box within `MEET_M` (5 mm) of the next,
else `Unsupported`, undone by the trial. Checked: `test_route.py` (a bend 50 m away refused), 867 server tests pass.

**Nov 1, adding and removing models: the server** ([docs/add-and-remove-models.md](../add-and-remove-models.md), slice
1). An open scene adds and drops models without reopening, keeping edits, fixes, checks and triage. `IfcScene.add_files`
/ `remove_file` bump revision and `layout` and clear `scene.FILE_CACHES`; `Workspace.add_models` refuses STEP/IFC
mixing, duplicates and over-budget scenes; `remove_model` refuses a stale layout (409) or the only model and drops its
clashes from kept checks (`checks.Register.drop_file`); edit-log entries become `model_removed` (`Journal.drop_file`).
Checked: `test_scene_models.py` (27), 895 server tests; on Northbank 452 clashes, Architecture added in 0.6 s, Run all
463 in 2.9 s, removed back to 451, export `Northbank-MEP.iris.ifc` carrying `Iris_Edit`.

**Nov 1, adding and removing models: the page and viewer** ([docs/add-and-remove-models.md](../add-and-remove-models.md),
slice 2). Menu › Models offers **Add to the open models** above **Open instead**; `App.addModels` checks first
(`sceneModels.addRefusal`), fetches only new files, `Viewer.add`s them and reruns kept checks. Visibility's remove
button names what goes and offers Export first; an unknown layout reloads every file (`reloadModels`). Checked:
`scene-models.test.mjs` (8), 251 web tests, build; in Chromium 452 → 463 → 451 clashes with edit E1 kept.

**Nov 1, an isolated clash shows what its fix moves** (`fix/isolate-shows-what-a-fix-moves`). Isolate hid the fittings
a preview moves (`Viewer.moved`), so Snowdon #20's tilted drain ended mid-air; `applyMode` and `drawLinks` now show
them, and after Keep isolation adds what kept edits changed (`App.keptFor`). Checked: `viewer-filters.test.mjs`,
`isolate-clash.test.mjs`, 253 web tests, build; in Chromium on Snowdon #20, the drain's bend stayed joined and isolated.

**Nov 1, Revit's sanitary pipes are drainage** ([07](07-fixes-and-edits.md), "Route"). On Autodesk's Snowdon Towers
sample the model and the escalation model found no fix for #20 (a cold-water stub through a washer drain): Revit's
IFC2X3 systems carry no type, and neither "Building Sanitary" nor "Pipe Types:PVC - DWV" matched `edits.GRAVITY_WORDS`,
so the drainage rule (a route keeps a drain's fall) never applied to Snowdon's 697 sanitary segments. The words now take
`sanitary` and `dwv`. Checked: `test_route.py` (three failed before), the server suite.

**Nov 1, a drain tilts instead of breaking its joint** ([docs/connections.md](../connections.md), "A drain tilts";
[07](07-fixes-and-edits.md), "Move"). Snowdon's #20: a washer's waste arm runs dead level through a cold-water stub 24
mm from its bend, each pipe held at one end by a fixture, so every move was refused. Now, under re-fits, a drain moved
straight up or down turns about the cap that stays (`edits.tilt`, `tilt_fits`, `tilt_room`, `drain_outlet`;
`connections.Tilt` in `MovePlan.tilts`); it must end falling more toward its outlet, each joint turning at most 5°
(`TILT_TURN_MAX_DEG`). The model is told how far a held drain may go. Checked: `test_drain_tilt.py`, the server suite
(898 passed; 4 fail on main too); on Snowdon the arm dropped 65 mm falls 4.4° and passes at 25.1 mm; in Chromium #20's
first idea, "Increase fall of drain A 70mm at clash end", verified (4.7°, 30 mm clear), drawn tilted and accepted. Also
fixed: `/fix/apply` refused a tilt that translates nothing (`test_the_page_keeps_a_tilt_that_translates_nothing`).

**Nov 2, a big model stays quick while Iris works** ([12](12-web-app.md), "The clash list draws what is on screen";
[13](13-3d-viewer.md), "Frames"). On Snowdon's architecture (204 MB, 6,604 elements, 2,471 clashes) the 3D view held 60
fps but the page's thread did not: every list row re-rendered on each title batch, thumbnail and click (0.3–0.6 s each),
and the viewer drew every frame at rest. A clash click took 0.9–6 s, Properties 2.5 s. Now the list draws only rows on
screen (`rowWindow`), the viewer draws on demand (`redraw`) and thumbnails wait while the camera moves
(`Viewer.moving`). Checked on the same model: a clash click in 34–63 ms, Properties 94–136 ms, orbiting 58 fps, the
thread busy 34 ms of 8 s at rest; `viewer-frames.test.mjs`, `clash-list.test.mjs`, web tests (259), build.

**Nov 2, models parsed in a worker, an upload while it goes up** ([13](13-3d-viewer.md), "Loading"). Snowdon's 204 MB
architecture held the page about six seconds (web-ifc open, tessellation, normals, placing on the main thread). The
parse moved to a worker (`viewer/ifcParse.ts` run by `viewer/ifcWorker.ts`; `ifcLoader.ts` builds batches from its
arrays without copying and ends it after 15 s idle), and an upload is parsed while it goes up (`Viewer.stage`, used by
`Viewer.load`). Checked in Chromium: shown the moment the server finished, where before it took 5.6 s more behind a 5.3
s freeze; longest stall 0.4 s. `ifc-parse.test.mjs`, `viewer-load.test.mjs`, web tests, build.

**Nov 2, a check on a Revit model in 17 s, not 150** ([06](06-geometry-and-detection.md), "Narrow phase and depth"). The
check of Snowdon's architecture spent 148 of about 150 s building its triangle tree: OpenCASCADE sews each of Revit's
faceted meshes into a solid first. Every clash query (detection, the live measure, a fix's check) now triangulates an
element whose body is only `IfcFacetedBrep` or `IfcFaceBasedSurfaceModel` (through mapped items, no openings) with the
mesh kernel (`scene.faceted`, `scene.kernel`), so all three agree. The check takes 17 s and finds 2,453 clashes instead
of 2,471; the mesh kernel misses about 20 recessed lamps, and the owner chose the speed. Northbank and the cell have no
faceted elements and triangulate as before. Checked: `test_faceted_kernel.py`, server tests (928 pass; 4 fail the same
on main); Northbank's same 464 clashes and girder depths (#042 −300, #057 −100, #061 −77 mm).

**Nov 2, the dev server ignores its virtual environment** (README, "Start both servers"). Models vanished and every call
answered 404 after `WatchFiles detected changes in '.venv\...'`: plain `--reload` watches `server/`, which holds
`.venv`, so a package re-sync restarted the server and dropped every scene, report and kept fix. The local command
(README, `app.py`, [10](10-http-api-and-streams.md), [18](18-testing-and-evals.md)) now adds `--reload-dir iris`, and
the README's troubleshooting names the symptom. Checked with uvicorn 0.54: a `.venv` write no longer restarts it, a code
change does.

**Nov 2, openings through Revit's faceted walls** ([07](07-fixes-and-edits.md), "Penetrations"). On Snowdon plumbing and
structure, #1 (a copper pipe through `Basic Wall:Concrete 24":601472`, -610 mm) got no fix: the model's first idea, an
opening, was refused because `edits.not_penetrable` took extrusion hosts only, and Revit writes that wall as an
`IfcFacetedBrep`. Now a host needs only a body the kernel can triangulate, and one it cannot is refused in words.
Checked: `test_penetration.py` (a faceted wall takes the same Ø170 mm opening; both cases failed before); on Snowdon
(1,279 clashes, 17 s) #1 now gets a Ø220 mm opening, 32 mm clear, verified in 0.5 s.

**Nov 2, the landing plays a fix, not a still** ([19](19-demo-data.md), "Landing clips"; [18](18-testing-and-evals.md)).
The demo cards now play a live proposal recorded by `capture-proposals.cjs --landing` (1110 × 435 window at twice the
pixels, the 3D view only); Workings recorded alone at 720 × 540. Frames are `Page.captureScreenshot` at scale 2 (the
screencast sends CSS size); `--gpu` keeps the frame rate up. The cards (`DemoCard` → `Clip` in About.tsx) play
`fix-northbank.webp` (2.2 MB) and `fix-cell.webp` (1.2 MB), "What Iris does" `workings.webp` (0.9 MB), each with a
`-still.webp` served through `<picture>` for less motion; animated WebP at quality 65. Checked: web build, 263 web
tests, `test_docs_map.py`; in Chromium clips load and play, stills with reduced motion.

**Nov 2, a recorded run beside each step** ([19](19-demo-data.md), "Landing clips"; [18](18-testing-and-evals.md)). Each
step of "What Iris does" (`Step` in About.tsx) got its own clip: `check.webp`, `understand.webp` (the Clash panel while
the model reads #1), `workings.webp` and `keep.webp` (Before / After, Accept, Export IFC). One proposal on #1, captured
whole and cropped, gives the card and steps 2-4. Checked: web build, 263 web tests, `test_docs_map.py`; six clips and
stills in Chromium.

**Nov 2, the steps as tabs beside one player** ([19](19-demo-data.md), "Landing clips"; [12](12-web-app.md)). The
per-step layout stood about 1,650 px tall, so `StepsPlayer` (About.tsx) lists the four steps as tabs beside one 16:10
frame, moving on when a clip has played through until the visitor picks a step (click or arrow keys). `stepClips.ts`
reads an animated WebP's length from its frames (`webpDuration`) and fetches each clip once (`loadClip`), replaying from
a fresh object URL; nothing loads before the section is in view. Checked: `step-clips.test.mjs` (4), 267 web tests, web
build; in Chromium the section is 400 px high, tabs stack on a phone.

**Nov 2, the live service stays warm, and the README names its user** ([17](17-deployment-and-operations.md), "The
container"; [20](20-decisions-limits-and-roadmap.md)). A visitor after a quiet spell met a cold start with no models
open, so the deployed service keeps one instance warm (minimum instances 1 on Cloud Run). The README now opens with the
user, the design coordinator, in plain words, and gains "Who it's for" (the table in [01](01-product-and-journeys.md))
and "What's next" (from 20's "Later"). Checked: `test_docs_map.py`.

**Nov 2, deployed warm, and Show it built on for everyone** ([17](17-deployment-and-operations.md);
[16](16-security-caps-and-cost.md), "Show it built's budget"; [20](20-decisions-limits-and-roadmap.md)). PR #118
deployed from `main`: an instance started with no request; Northbank 464 clashes in 5.0 s; streams `identity` under a
browser's `Accept-Encoding`; the cell's 112 clashes numbered as before. With no `samples/step-cache`, the cell's first
opening converted again (38.6 s) and was opened by hand so visitors find it cached. `built_views` was set to true in the
deployed settings and the service restarted, since settings are read once per process: `/api/models` then said
`built_views: true`, and a non-picture sent to `built/stream` was refused 422 with no model call and no cap taken.

**Nov 3, the golden path reads its clash close up, and thumbnails fill while Iris works** ([13](13-3d-viewer.md),
"Flights" and "Performance notes"; [12](12-web-app.md)). "Watch Iris fix a clash" read the clash zoomed out on the whole
site: `Viewer.orbit` glided from where the camera was and replaced the flight in; it now counts from where a flight
under way lands. Thumbnails waited out the whole proposal (`App` paused them, `Viewer.moving` counted the pilot's turn);
now they pause only while models load or a check runs, and `posed` lifts any preview so a picture shows the clash as
found. Checked in Chromium: framed on the duct and girder from 1 s; thumbnails 0 of 25 rows before, every row on screen
by the end after; A/B/C pictures unchanged; `npm test` 288, `npm run build`, `test_docs_map.py`.

**Nov 3, a picture framed where the pair is in the model** ([13](13-3d-viewer.md), "`posed`"). `posed` drew the model
without the preview but measured the pair with it (`boxOf` applies previewed moves), so a thumbnail drawn during a trial
was framed where the trial put it. It now measures with the moves lifted too. Checked: `viewer-links.test.mjs` (fails
without it), `npm test` 289, `npm run build`.

**Nov 3, Show it built's picture, laid out again, and dragged on itself** ([docs/show-it-built.md](../show-it-built.md),
"Page"; [12](12-web-app.md)). The Clash panel's tools row overflowed, the label's icon sat alone, and the slider's ends
read opposite to the picture. Now the picture is the control: a press or drag moves the wipe, a round handle marks it,
each side is named, it starts at half; touch uses `touch-action: pan-y`, keys work through `role="slider"`. Checked in
Chromium at 300-520 px with mouse, keys and emulated touch; `built-view.test.mjs` (4, new), `npm test`, `npm run build`.

**Nov 4, a new landing that shows Iris working** ([01](01-product-and-journeys.md), [12](12-web-app.md),
[19](19-demo-data.md), [20](20-decisions-limits-and-roadmap.md)). `About.tsx` keeps its props and exports and is now a
page built from `web/src/landing/` with its own stylesheet. **The hero** is a live three.js replay (`Hero.tsx`,
`heroScene.ts`, `timeline.ts`) of Northbank's answer key from the models' own geometry, read with IfcOpenShell into
`northbank.ts`: it sweeps the check, pins #1 to #3 at their depths (-300, -100, -77 mm), grows, checks and keeps each
idea, and shows the tray's whole move failing first on the spigots it really crosses; it pauses off screen and gives
stills for less motion and without WebGL. **Try the check yourself** (`check.ts`, `Sandbox.tsx`) cuts the check to the
plane that decides #1: drag the duct and it reports clash gone, new hits and room left (+400 mm gives the recorded 50
mm; +375 to +425 mm passes at 25 mm). Checked: `landing.test.mjs` (19, new), `npm test` 313, `npm run build`, server
suite (934), `test_docs_map.py`; Chromium at four sizes and reduced motion. It adds about 33 KB gzipped of script.

**Nov 4, the landing checked against Iris itself** ([01](01-product-and-journeys.md), [19](19-demo-data.md)). Every
claim on the landing was read against the code and design docs. Corrected: the model is told an opening's heights and
the rise that clears it (`agent.py` from `edits.passages`: +0.375 to +0.425 m at 25 mm), not its size; the tray's beat
follows the recorded root-cause plan (`girder-plan.json`) and the hits `verify.check` reports; drawing views are up to
four including 3D; the escalation model is offered, not automatic; only move, offset, trim, route and opening are
claimed verified on the demos. Checked: `landing.test.mjs` (20), `npm test`, `npm run build`, `test_docs_map.py`, the
page in Chromium.

**Nov 4, the formats' logos and the Navisworks tile's picture** ([12](12-web-app.md), [18](18-testing-and-evals.md),
[20](20-decisions-limits-and-roadmap.md), [docs/brand-assets.md](../brand-assets.md)). The Navisworks tile now shows a
report coming in (`NavisArt`). The IFC, BCF, Navisworks and MCP logos (trimmed, 192 px, in `web/public/logos/`; STEP and
PDF drawn) go in a strip under the hero (`Formats`, `landing/logos.ts`), on the hand-off tile, the agent tile and the
glossary; the footer says whose they are and that Iris is not affiliated. Checked: `landing.test.mjs` 21 (every logo a
file), `npm test` 314, `npm run build`, server suite 934; Chromium at 1440, 900 and 390 px.

**Nov 5, the README's local setup checked from a fresh clone** ([README](../../README.md#run-locally)). Followed "Run
locally" exactly on Linux from a new clone: uv sync, `npm ci`, `.env` from the template, both servers, `/api/samples`
through Vite's proxy, and step 4 in Chromium. Fixed what a newcomer would trip on: **Models** is in **Menu** at every
width; the four Northbank files are ticked by default; opening does not check, so step 4 names **Check 3 elements** and
picking clash #1. The reader brings their own model credentials. Checked: server suite 934, `npm run build`, `npm test`
314, `weasyprint --info`, the local MCP server's `initialize`, every README relative link.

**Nov 11, moved to Google: Gemini on Vertex AI, Cloud Run, Cloud Storage; renamed Iris.** The team took the product
over as Iris and runs it only on Google: the main model is Gemini Pro (`GEMINI_MODEL`), bulk triage, titles and voice use
Gemini Flash (`GEMINI_FAST_MODEL`), the escalation lane uses `GEMINI_ESCALATION_MODEL`, and
illustrations use `GEMINI_IMAGE_MODEL`, all through `server/iris/model_client.py` (`GeminiModel`) with Application
Default Credentials (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`). Reasoning effort became the thinking level
(`GEMINI_THINKING_LEVEL`, `GEMINI_ESCALATION_THINKING_LEVEL`, `GEMINI_INCLUDE_THOUGHTS`), and model prices come from
`IRIS_MODEL_PRICES`. The app deploys to Cloud Run with `deploy/deploy.sh`, keeps persisted files in a Cloud Storage
bucket and its secrets in Cloud Run env / Secret Manager (see [17](17-deployment-and-operations.md)). Every
model-dependent number in this log (latency, cost, eval and answer-key results) was removed rather than relabelled;
they will be re-measured on Gemini. The final env set adds `GEMINI_FAST_THINKING_LEVEL` (the fast model's thinking
level), `IRIS_IMAGE_USD` (each picture's cost charged to the day's budget) and segment voice (speech found by loudness,
`IRIS_VOICE_VAD_RMS`, each segment transcribed once `IRIS_VOICE_SILENCE_MS` of quiet ends it), and removes the
open-weights switch (`open_weights`, `IRIS_OPEN_WEIGHTS`): titles, triage and part names always run on the fast model.

**Nov 22, auto-deploy on push to `main`, and the web app on Firebase Hosting** ([17](17-deployment-and-operations.md);
[10](10-http-api-and-streams.md); [16](16-security-caps-and-cost.md); [18](18-testing-and-evals.md);
[20](20-decisions-limits-and-roadmap.md)). A push to `main` now tests and deploys through GitHub Actions
(`.github/workflows/ci.yml`, `deploy.yml`), signed in by Workload Identity Federation with no JSON key;
`deploy/github-setup.sh` sets up the project and the repository variables once. Hosting is split: Firebase Hosting
serves the page (`firebase.json`, `.firebaserc`), Cloud Run service `iris-api` serves only the API, and the browser
calls it directly. `IRIS_ALLOWED_ORIGINS` (`origins.py`) turns on CORS with credentials for those origins, makes the
owner cookie `SameSite=None; Secure; Partitioned` (`owner.py`) and lets their pages open the voice socket
(`voice_live.py`); `GET /api/health` reports `IRIS_VERSION`, and in split mode `GET /` answers JSON instead of the page
(`app.py`). The page reaches the server through `apiUrl`, `wsUrl` and `apiFetch`, set by `VITE_API_BASE` at build time
(`api.ts`, `voice.ts`, `BuiltView.tsx`, `workingsGraph.ts`, `ReportDoc.tsx`, `clashImage.ts`). `deploy.sh` deploys a
given `IMAGE`, names the service `iris-api`, and defaults to minimum instances 0 and CPU only during requests
(`CPU_THROTTLING`); `setup.sh` gives Artifact Registry a cleanup policy keeping the newest 5 images. Checked:
`test_origins.py` (new) and a voice relay origin test, `npm test`, web builds with and without `VITE_API_BASE` (the
bundle grepped for the URL), `bash -n`, actionlint and shellcheck on the scripts and workflows. Not yet run against
Google Cloud: the dev machine is not signed in to gcloud.

**Nov 22, Iris VisionBench documented** ([docs/visionbench.md](../visionbench.md),
[bench/README.md](../../bench/README.md)). The Track 2 pipeline (`server/iris_bench/`, `bench/render/`, the
`iris-bench` CLI) has its design written against schema v2 (`spec.py`): jobs J1–J9 in eight scored categories, what a
scene stores, the views and visual-only prompt rules, ground truth from closed-form geometry cross-checked by Iris's
engine, the controls, scoring, challenge axes, limitations and the judging criteria. J6–J9, locked elements,
relations, resolutions, cameras, top and section views, counterfactual controls, per-category and calibration
scoring, `iris-bench verify` and `export` are marked in progress. No model numbers are quoted. Checked: read against
the code in `server/iris_bench/` and `bench/render/`; `test_docs_map.py`.

**Nov 22, Iris VisionBench wired end to end; fair Gemini settings; no paid run yet** ([docs/visionbench.md](../visionbench.md),
[bench/README.md](../../bench/README.md)). `iris-bench build` takes its J5/J6 fix, J7 candidate and J8/J9 group
renderers from `jobs.renderers_for` (each guarded: a failed render skips that item, never the seed), so all nine jobs
build; `--modes ...,agentic` adds agentic copies that `run` sends to `iris_bench.agentic.run_agentic`. Rendering draws
a seed's pairs in one browser, retries jobs lost to a browser crash once in a fresh browser (`render.render_many`,
`CRASH_MARKERS`), falls back to A/B/C per pair only when that fails, runs at most `--render-workers` (min(4, CPUs))
browsers at once, and counts it all in `render_stats.json`. Scoring grades J5 on "resolves the original clash", J6 on
"new clash" and J7 on the valid set from the stored truth, exactly as the runner does (the checker re-run is kept as a
cross-check); J8 orders are compared in order; `verify` re-derives J4 over the openings offered in the pictures. J8/J9
items show one render's pictures (`jobs.one_render`: one letter map per item). J3/J4 offer only openings labelled
in the pair's own pictures (a pair whose pictures show none gets no J4, and its J3 says there are none): before, the
fallback offered every opening in the scene, and gemini-3.8-flash rightly answered that it could not see them;
`verify` now fails any item whose answer letters its pictures do not show (`letters_shown`). The runner calls Gemini with one rule
for every model (thinking at Google's default, Flash-Lite LOW, or `--thinking` under a `<model>@<level>` label;
media resolution HIGH; `response_json_schema`; no temperature; `Image k:` before each picture; transport-only
retries), records model version, finish reason and tokens per reply and the settings under `model_runs` in
`manifest.json`, caps new spend with `--max-usd`, and samples controls to `--control-sample` (100) per mode. Paid runs
are capped by `--max-usd` (required for a real model); commands are in bench/README.md. First paid run
(`server/runs/gemini-3.8-flash-7`, not in git): gemini-3.8-flash, 7 seeds, 95 pictures items (11 per job, J4 7) and
21-22 per control mode, $2.33 recorded over 170 calls; `verify` passed (298/298 pictures answers re-derived, every
answer letter shown). Pictures 58% [47, 67], no image 36% [18, 59], swapped pictures 14% [0, 32], pictures plus
measured facts 90% [76, 100]; mean confidence 0.96 in every mode. Small samples: read these as a pipeline check,
not a model result. Checked: `pytest tests/bench`; `iris-bench all --seeds 0:6
--model fake:0.7 --locked-services 1` (verify passes, all nine jobs and four modes present, 24/24 pairs rendered
from the scene cameras with no fallback); a 3-seed fake run with `agentic`.
**Nov 22 (2026-11-22), engineer-first workflow, server side** ([docs/engineer-workflow.md](../engineer-workflow.md);
[04](04-server-code-map.md), [05](05-domain-model-and-state.md), [10](10-http-api-and-streams.md),
[14](14-files-in-and-out.md), [15](15-requirements-settings-and-config.md), [17](17-deployment-and-operations.md)).
Projects (`projects.py`, `/api/projects*`) keep the original models, saved states (each model as it is now, the edit
log, decisions and clash memory), clash reviews and reports on disk across restarts (`IRIS_PROJECTS_DIR`, at most
`IRIS_PROJECTS_MAX`; `/mnt/iris/projects` on Cloud Run with a bucket); a reopened project keeps each clash's number and
title. Decisions in the journal (`POST /api/scenes/{scene_id}/decisions`; a keep records the reviewer and appends an
`accepted` decision); `checked_against` in kept fixes' checks; as-designed plans never geometry-validated
(`check.passed` false). Checked: `server/tests/test_projects.py` and `test_decisions.py`, the full server suite and
`test_docs_map.py`.

**Nov 22 (2026-11-22), the coordination report for the engineer-first workflow** ([14](14-files-in-and-out.md);
[docs/engineer-workflow.md](../engineer-workflow.md), step 10). `document.py`: the project's name and a models table
(schema and element count only from the open scene) on the cover; both GlobalIds on each page; the fix box read from
the edit log as re-checked at keep (`kept_fix`: the clash's own option from `params.options`), with direction and
distance, the moved element's name and GlobalId, the AI-drafted rationale, the required and measured clearance and
"checked against N elements"; what backs a fix said from the strongest record (`evidence_state`: "Geometry-validated
at keep" only from the log's check, never the page's word; "as designed" never validated); the reviewers' decisions
as a proposal history and as dated BCF comments. Checked: `server/tests/test_document_engineer.py` (HTML and rows; the
PDF needs pango) and the full server suite.

**Nov 22 (2026-11-22), engineer workflow wired through the server** ([09](09-agent-workflows.md),
[10](10-http-api-and-streams.md), [14](14-files-in-and-out.md), [05](05-domain-model-and-state.md)). The report route
takes `project_id` (404 "No such project."): its name on the cover, and with no live edit log the newest saved
state's decisions (`projects.saved_decisions`). The edit log CSV adds `actor`, `check`, `verified`, `min_clearance_mm`
and `checked_against` after its old columns. The chat words an "as designed" root cause "accepted as designed — no
geometry check", never "not all verified". A reopened project's kept fix is labelled from its saved check
("Geometry-validated at keep (earlier session)", `document.earlier_for`) when this session kept none; saved entries
and a keep's decision carry `session` (the scene id), and entries are matched by session and E-id (`entry_key`), never
E-id alone. Checked: `test_projects.py`, `test_decisions.py`, `test_chat.py`, `test_document_engineer.py`, the full
server suite.

**Nov 22 (2026-11-22), PDF drawings in, and the drawing routes** ([04](04-server-code-map.md),
[05](05-domain-model-and-state.md), [10](10-http-api-and-streams.md), [14](14-files-in-and-out.md),
[15](15-requirements-settings-and-config.md); [docs/drawings.md](../drawings.md)). `drawings.py`: `ingest` takes a PDF
(sha256; each page rendered with pypdfium2 to PNG at 150 dpi, lower only past 50 MP; pdfplumber's words mapped to
pixels on that image, origin top-left; `has_text_layer`; the title block's SHEET / SCALE / TITLE / DRAWING NO. as
printed in the bottom-right quarter, never guessed), refusing a non-PDF, a damaged or password-protected one, and one
past `IRIS_DRAWING_MAX_MB` (50) or `IRIS_DRAWING_MAX_PAGES` (40), leaving nothing on disk. `drawings.STORE` holds each
scene's drawings and their last read items under `$TMP/iris-drawings/<scene id>/`, deleted with the scene (a finalizer
on the scene object, and a sweep on every drawing call). Routes: `POST`/`GET /api/scenes/{scene_id}/drawings` (one
model upload from the allowance), `GET /api/drawings/{drawing_id}/pages/{n}.png`, `POST /api/drawings/{drawing_id}/read`
(the reader's NDJSON stream; a budget refusal before the first event is a plain 429; 501 without the reader),
`GET /api/drawings/{drawing_id}/items`, `GET /api/scenes/{scene_id}/drawings/compare` (drawing by drawing with the
level from each title block, the model index built once; 501 without the comparison). Projects copy the drawings and
their items into `drawings/` on attach and save and ingest them again on open. Checked: `server/tests/test_drawings.py`
(reportlab sheets: word boxes against the rendered ink, title fields, a scan, the caps, refusals, every route with the
reader and comparison stubbed and once with the real reader's `FakeReader` and the real comparison, eviction, a
project round trip), `test_docs_map.py` and the full server suite.

**Nov 22 (2026-11-22), fixes from testing the live site** ([12](12-web-app.md), [14](14-files-in-and-out.md),
[03](03-end-to-end-flows.md), [10](10-http-api-and-streams.md), [11](11-mcp-and-agent-links.md),
[docs/engineer-workflow.md](../engineer-workflow.md)). **The report no longer needs triage:** the route and MCP's
`generate_report` drop the 409 "Triage the report first"; `document.build_rows` puts a clash with no verdict, fix,
kept edit, decision or mark in a new `untriaged` section, listed by clash test under "Not triaged" and counted on the
cover, never as noise or needing action, and the report stays DRAFT while any is ("· n not triaged" on the stamp).
The dialog (`ReportDoc.tsx`, `reportCounts`) builds with only the teams table read, says "n not triaged (listed by
clash test)" and offers Triage all as a secondary. **Save says how it went** (`SaveButton` in `ProjectOverview.tsx`,
both Save buttons): "Saved ✓" for 2 s, or "Not saved" with the reason. **A fixed clash** shows "Fixed ✓" in
`ClashPanel` (what was kept, Undo when `coordination.undoableFix` finds its fix is the newest kept edit, "Propose a
different fix" as a secondary) and App leaves out Propose fixes, Explore wider fix and Go to the clash. **The
Overview's share closed** (`projectsApi.closedText`): 1 of 464 is "<1% closed", not "0%". **The clash list's line**
("3 tests · 464 in the model", "Naming n…") wraps on a 300 px panel instead of being clipped (`.report-meta`). **The
menu's "More"** names only the sections it shows. Checked: `test_document.py` (a report with no triage and an accepted
fix), `test_projects.py` (the route builds with no triage), `test_document_engineer.py`, web
`report-dialog.test.mjs`, `clash-fixed.test.mjs`, `projects-api.test.mjs` (Save, `closedText`), `corner.test.mjs`
(the More label), `npm test`, `tsc`, `npm run build`, `test_docs_map.py` and the full server suite (the two pango PDF
tests fail locally, as before).

**Nov 22 (2026-11-22), the sample drawings demo: saved readings, the samples route, See it work**
([docs/drawings.md](../drawings.md), [10](10-http-api-and-streams.md), [12](12-web-app.md), [19](19-demo-data.md)).
Each sample sheet ships with the drawing reader's Gemini 3.8 Flash reply to it (`samples/drawings/*.reading.json`,
made once by `evals/save_drawing_readings.py`), keyed by the PDF's sha256, `prompt_hash()` and the page size; a read
of that very file replays it as the same NDJSON stream (`page.saved`, `evidence.saved_reading`, `done.saved`, $0, no
budget check), and any other PDF is read live as before. `POST /api/scenes/{scene_id}/drawings/samples` attaches the
open demo's sheets; the first screen's **Try the sample drawings** and the Drawings step's **Add the sample
drawings** use it, and the page labels a replay "Saved AI reading of this sample (Gemini 3.8 Flash)". `--check`
(no model call): the clean sheet 123 items (119 confirmed, 3 AI-read, 1 text only), 0 mismatches; the mismatch sheet
124 items (121 / 2 / 1), exactly its 4 planted mismatches (size differs, missing in model, type differs, missing in
drawing). The first screen's **See it work** (`DemoClips.tsx`) plays `check.webp` beside the new `drawings.webp`,
recorded by `web/scripts/capture-drawings.cjs` against one origin with no Gemini credentials (Metal GPU, `--gpu`);
the full-size MP4s for the hackathon video go to `~/Downloads/Iris-demo/`. Found on the way: the recorder's frames
(CDP `Page.captureScreenshot` with `clip.scale` 2) laid the page out at twice the window while capturing, so every
frame showed it shifted and the sheet viewer fitted the page to the wrong size; frames now come from Playwright's
screenshot, and the sheet viewer fits the page again when its stage resizes until the reader moves the view.
Checked: `test_drawing_reader.py` (a replay and three misses: another file, a changed prompt, another page size),
`test_drawings.py` (the samples route, a sample read with no model call, and an upload read live), the web tests
(`drawings-samples.test.mjs`), `tsc`, the build, `test_docs_map.py`, the full server suite (only the two pango PDF
tests fail locally).

**Nov 22 (2026-11-22), the samples' first check builds no geometry** ([docs/detection.md](../detection.md), "Saved
checks for the samples"; [02](02-system-architecture.md), [04](04-server-code-map.md),
[05](05-domain-model-and-state.md), [06](06-geometry-and-detection.md), [10](10-http-api-and-streams.md),
[14](14-files-in-and-out.md), [17](17-deployment-and-operations.md), [18](18-testing-and-evals.md),
[19](19-demo-data.md); [samples/README.md](../../samples/README.md)). On the live service (`iris-api`: 2 vCPU, 4 GiB,
one instance, scale to zero, CPU boost) the first coordination check of Northbank (four IFCs, 1,732 elements checked,
464 clashes) once took 186 s on a cold instance with two scenes opened at nearly the same time; warm it takes about
11 s. Nearly all of it was building geometry twice: every element's box when the models open (`IfcScene.bounds`),
then detection's triangle tree (`detect._tree`, the same elements again, with the clash kernels) and the measures.
On one machine detection is deterministic whatever the threads (1, 2, 4 and 10 checked, on linux/x86_64 and
macOS/arm64), so the shipped samples now carry what their geometry gave (`server/iris/saved_checks.py`;
`samples/saved-checks/northbank.json`, generated, about 550 KB with both platforms, committed; `.gitignore` allows the
folder and `.dockerignore` already lets its JSON into the image): each file's element boxes, keyed by the file's
SHA-256, `IfcScene.big()`, `saved_checks.BOXES_VERSION`, the IfcOpenShell version and the platform
(`IfcScene.bounds(saved=True)` and `add_files(saved=True)`, passed by `Workspace.open_paths` and `add_models`); and
each test's measurement of the default check, under one key for the whole run (the files' hashes in order, every box
to the bit, every test's settings and candidate pairs, the offset, `detect.VERSION` (new, 1), the IfcOpenShell
version and the platform). **Per platform** (`saved_checks.PLATFORM`; `PLATFORMS`: `linux-x86_64`, `darwin-arm64`):
on Northbank, linux/x86_64's boxes (in Docker) differ from macOS/arm64's in the last bit for 12 elements, and the
triangle queries' depths differ for 46 clashes and their points for 309 (so the #N order too), so a Mac-made replay on
Cloud Run would not be its live check. The pairs go into the key as a set, sorted: NumPy's sort orders boxes that start
at the same x differently on x86 and ARM. **The probe:** before a process first replays a check it measures `PROBES`
(8) of its clashes again (pairs the triangle queries measured, spread over the tests) in a small tree of just their
elements; any difference to the bit and it runs live, with a logged warning, remembered per process (`_probed`). With
the Mac's entry forced in on linux/x86_64, the probe refuses it; it costs about 0.5 s once per process locally.
`detect.run(replay=True)` on a scene at revision 0 takes the saved check, all tests or none; the workspace's runs
(`Workspace._run_check`: the detect stream, Run all again, chat, MCP) and the requirements preview's count pass it, a
direct call measures live. Everything after the measurement is made live (the rules, clash ids, #N, the diff, the
report, coverage, kept checks, triage input, Insights); the events are the same but for the phase line ("Unchanged
sample models: taking the saved geometry of n elements"), and `Run.saved` and the detect stream's `done` (`saved`)
say so. Any difference runs live: another byte, a kept edit or a model added or removed, a box a trial moved, another
test or setting, other candidate pairs, another platform or probe, other code. Regenerate with `uv run python -m
iris.saved_checks --docker` from `server/` (no AI): this machine's entry, then linux/x86_64's in Docker
(`python:3.13-slim-bookworm`, `--platform linux/amd64`, the same IfcOpenShell, NumPy and defusedxml versions), merged
into one file (`saved_checks.merge`); bump `detect.VERSION` or `BOXES_VERSION` first for a change to what detection
measures or how boxes are made. `saved_checks._digests` is capped (cleared past 256 entries). Also in detection: the
broad phase (`detect._candidates`) takes every element's window at once, in chunks of `CANDIDATES_CHUNK` (2^20)
window entries, instead of one element at a time, giving the same pairs in the same order; and the triangle tree uses
`scene.THREADS` (the CPUs the process may use) instead of `os.cpu_count()`, with the same results. Measured on Apple
Silicon (10 cores): live, opening the four files 0.1-0.5 s, boxes 1.5-1.7 s, the check 2.4-2.8 s (tree 1.5 s,
measures 0.8 s, broad phase 0.3 s, now 0.13 s); limited to 2 threads, as on Cloud Run, boxes 4.1 s and the check 5.8 s
(tree 4.6 s); replayed, boxes 0.04 s and the check 0.3 s (0.5-0.6 s with a process's first probe). On a busy machine
(load about 30 on 10 cores), open to first result: one scene 6.2-7.0 s with the code before, 0.7 s replayed; two scenes
opened at once 9.0-13.2 s before, 1.2 s replayed. On linux/x86_64 in Docker (emulated) the replay equals the live run
to the bit (464 clashes; the probe passes; 7.7 s for the probe's first OpenCASCADE call under emulation). The first
OpenCASCADE call in a fresh process takes 0.3 s; `import iris.app` about 2.7 s, 1.1 s of it the `mcp` package.
Expected on Cloud Run, not yet measured there: about 11 s warm live becomes about 1-2 s for the unchanged samples,
warm or cold, with no triangulation on the open or the first check; a cold start's container start and imports are
unchanged. Checked:
`test_saved_checks.py` (7: replay equals live on a fixture and on Northbank, edits and settings miss, both platforms'
entries current), `test_detect.py` (`test_the_broad_phase_gives_every_near_pair_in_sweep_order` and
`test_the_broad_phase_on_the_fixtures_as_before`, both against the old one-at-a-time sweep kept in the test),
`test_checks.py`, `test_docs_map.py`, the full server suite.

**Nov 22 (2026-11-22), the review queue: prepared fixes, one clash at a time, before and after in place**
([docs/review-queue.md](../review-queue.md); [04](04-server-code-map.md), [07](07-fixes-and-edits.md),
[09](09-agent-workflows.md), [10](10-http-api-and-streams.md), [12](12-web-app.md), [13](13-3d-viewer.md),
[15](15-requirements-settings-and-config.md), [16](16-security-caps-and-cost.md), [18](18-testing-and-evals.md),
[19](19-demo-data.md)). The owner asked for human review of each clash with the fix and a before/after view in the same
place, made automatically. **Prepare fixes** (`POST /api/scenes/{scene_id}/prepare/stream`, `prepare.run`) runs the
existing fix loop (`agent.resolve` through `plans._resolve_items`, 4 at a time, 2 rounds, at most 8 pairs, one proposal
per pair prepared live) on the ticked clashes, else triage's real ones, else the deepest (`prepare.deepest`), and
streams `prepare_start`, `item`, `prepared` and `done`; only options the geometry passed count as ready, and a pair with
none says why. **Saved results** for the unedited sample (`samples/prepared/*.json`, `IRIS_PREPARED_DIR`) hold the
model's replies, never its results: keyed by `prepare.VERSION`, the files' sha256s, revision 0, no requirements, the
default clearance, rounds, options kept, the model id and thinking level and the prompt's hash, each reply used only
for the exact question it answered, and replayed through `agent.resolve` so every option is checked again; labelled
"Saved AI proposals for this sample (model, date)". `evals/prepare_saved.py` makes the set; it was NOT run on Gemini
(the owner approves that spend first): its dry run counts 16 calls at most (8 pairs × 2 rounds), about 44,000 input
and 32,000 output tokens, about $0.31 on the configured proposal model. A free run with `prepare.ScriptedModel` made a
scripted set (6 ready, 2 failed; scripted results, not Gemini's) and a fresh process replayed it with no model call.
**Web:** `ReviewFixesEntry` (the one entry point on Clash review: "Prepare fixes (8)" → "Preparing fixes: 3 of 8" →
"Review fixes (n ready)") and `ReviewQueue` (two panes: the clash with its red distance badge, the verified card with
its evidence, the reviewer, Accept / Reject with a reason / Request another, auto-advance, A / R / arrow keys; the one
3D viewer moved in with the new `Viewer.mountIn`, Before | After | Both). Accept goes through `fix/apply` → `plans.apply`
(tried again first); reject and request-another through `/decisions`; nothing is kept without Accept. App.tsx gained one
import, an open flag, the entry and the overlay with its `onKept`. Checked: `server/tests/test_prepare.py` (10), the full
server suite (1351 passed; the 2 pango PDF tests fail locally), `web/tests/review-queue.test.mjs` (20) and
`viewer-mount.test.mjs` (5), `npm test`, `tsc`, `npm run build`, and a headless Chromium click-through on a local
one-origin server with the scripted model only (sample building → Prepare fixes → the saved scripted set replayed →
Before / After / Both → accept one, reject one with a reason → a failed clash shown with its why → phone width with no
horizontal scroll → close), the keep and both decisions read back from the edit log with the reviewer and clash key.
Found on the way: a whole-run raise of the supply air main by 0.40 m no longer passes (the move now carries its joints,
and the tee, branch and damper hit secondary beams); its offset does.

**Nov 22 (2026-11-22), the sidebar app shell and the lifemed theme** ([12](12-web-app.md), [01](01-product-and-journeys.md)).
Iris is now an app with a left sidebar, not a website (the owner's brief). **The shell** (`AppShell.tsx`, `shellNav.ts`,
`appShell.css`, `frame.css`, `PageHeader.tsx`, `page.css`): `App` renders `div.shell`, the `Sidebar` (Home, Projects,
Workspace for a session outside a project, the open project's seven steps with counts, Help, Settings, the reviewer's
name edited inline; a 64 px rail kept in `iris.sidebar`, collapsed by default on the 3D workspace; a drawer from a slim
light top bar on phones and tablets) beside the `TopBar` (the toggle, the search over projects, clashes, elements and
pages, the page's primary action) over the body, where the workspace stays mounted and Home or a project's page sits
over it. **Home** (`StartScreen.tsx`, `home.css`): the greeting revealed word by word beside the holographic ribbon,
the resume card, the start tiles, recent projects, See it work and How Iris works. **Projects** (`ProjectsHome.tsx`,
`ProjectOverview.tsx`, `projects.css`): a table with status tabs, status pills and a row menu (Open, Rename, Remove
from this browser), a New project dialog, the overview's stat cards counting up; `ProjectSteps` is gone. **Theme**
(`index.css`, `index.html`'s theme colour #ffffff): lifemed's tokens, white and ink with a lavender accent and the
`--holo` gradient for AI-made things; light only, no dark fills. **Motion** (`Holo.tsx`, `holo.css`): the ribbon, the
text reveal, the count-up, the AI shimmer on the status line and the holo edge on AI-proposed cards, all still under
reduced motion. **The workspace decluttered** (`workspace.css`): Activity collapsed to a slim strip with one line
(`ActivityLine`; the layout kept as `iris.dock.v2`, v1 not read), the clash details once (`ClashHeader`, then Propose
fixes visible without scrolling, then `ClashPanel`), the list's row icons on hover or a ⋮ menu under status tabs with
counts, six core 3D tools and the rest under More tools, no Iris pill and no notch, one status line in the header,
Export in the header's actions, and no ☰ Menu (its contents are Settings, beside Help, in the sidebar). The release fix
f76fb7c (report without triage, Save feedback, the fixed clash state) was merged (c0d6265) and kept in the new shell.
`web/scripts/record-demo.cjs` reads `iris.dock.v2` and opens More tools for the views and saved views. Checked: the
full web suite (`npm test`: 528 tests after the review queue merged, all passing), `tsc`, `vite build`, server `test_docs_map.py` and `test_web_pages.py`, and
headless Chromium screenshots at 1512×805 and 390×844 against a local one-origin server, with no Gemini call. **The logo** is the owner's
chosen Aperture (six holographic blades around an ink hexagonal pupil): `Brand.tsx` draws it inline (`ApertureMark`,
`Lockup`, `AppIcon`), the sidebar and top bar use it, the status line's mark opens and closes its blades while Iris
works, every spinner is the mark turning, and `web/public` has the new favicon (SVG, 32 px PNG, ICO), Apple touch,
Android and maskable icons, the pinned tab and a white manifest theme; the boot splash and the PDF cover
(`document.LOCKUP`) carry it too ([docs/brand-assets.md](../brand-assets.md)). **The review queue** (`feature/review-queue`, merged) sits in
the shell: Review fixes is Clash review's primary action at the right of the top bar, with Export beside it as a
secondary, and the queue covers the shell's body, so the sidebar and the top bar stay
([docs/review-queue.md](../review-queue.md), "Mounting it in `App.tsx`").

Later on Nov 22 (2026-11-22), three of the owner's calls. **The sidebar's footer** (9434dda, f3b1bbb): the user block
(avatar, name, Reviewer, Edit) is gone; the sidebar ends with `BuiltBy`, the small Aperture mark and "Built by
Techjays" (the mark alone, with that tip, on the rail), and the brand at the top and in the phone's top bar is the mark
and "Iris". The reviewer's name (`iris.reviewer`) is asked above the proposals again (always) and in Settings ("Your
name for review decisions"); Home's greeting still uses it. **White and pink on every screen** (84e3d61: `index.css`'s
tokens, the end of `frame.css`, `viewer/Viewer.ts`): white surfaces with lavender-grey hairlines (`--panel` #f5f4f8
only for tracks and header bands), `--pink` #ff5cd6 and a pink-magenta `--accent-ink` #b0269a, primary buttons on
`--holo-cta` (#d3249c → #9a46dd → #5f62e0, each stop 4.5:1 or more with white text) with a pink glow on hover and an
ink focus ring, secondary buttons pink on hover, the selected clash row a pink tint with a pink edge, chips and badges
on white or pink, pink form controls, every spinner the Aperture in the holo colours, white dock tabs underlined in
pink, and the 3D background #f3f1f8. **Home** lost "See it work" (`DemoClips.tsx` and `demoClips.css` deleted; the
clips stay in `web/public/demos/` for the submission video) for **How Iris works** (`HowIrisWorks.tsx`,
`howIrisWorks.css`, 4edc4cb): eight cards in four phases (Bring in, Find, Fix, Share) with icon tiles, step pills and
measured proof chips, Propose with the AI holo edge and Validate with a green "Geometry" badge, "AI proposes → geometry
proves" between them; a card opens its step on the sample building (`onSampleStep` → `trySample(step)`). Tests:
`sidebar.test.mjs` (the footer), `shell.test.mjs`, `start-screen.test.mjs` and `how-iris-works.test.mjs`. The owner then asked to drop the striped holographic ribbon everywhere: `HoloRibbon` is gone; empty states, the loading card and Home's quiet lines show the Aperture in a soft pink circle (`MarkBadge`), and the hero keeps a soft pink wash until the 3D glass aperture (`feature/hero-ribbon`) arrives. A pink glow now follows the cursor over the pages, never the 3D workspace (`CursorGlow.tsx`: eased, a trailing periwinkle glow, a breath at rest, a still wash on touch or under reduced motion), and the start tiles and How Iris works cards light under the cursor. Checked: `cursor-glow.test.mjs`, the full web suite, `npm run build`.
