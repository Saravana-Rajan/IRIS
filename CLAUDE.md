# Iris: agent guide

Iris: an agent that resolves spatial conflicts (clashes) in 3D models, proven on buildings and machines. A standalone
web app by Techjays, built on Google only: Gemini on Vertex AI, Cloud Run, Cloud Storage. Tagline: "Iris — Does
AI truly see?". Next it is being extended into a Track 2 entry for the Innodata Frontier AI Hackathon 2026, "Visual
Task Factory": synthetic images of real 3D models, questions about them, and geometry-verified answers to benchmark
Gemini multimodal models (README, "Roadmap").

## What it does

1. **Understand** a clash from images (A/B/C, below) plus model data, with Gemini Pro (`GEMINI_MODEL`).
2. **Propose** 1–3 fixes by editing real IFC elements, each **verified** by geometry (clash gone, clearance met,
   nothing new hit) before the user sees it. Loop: propose → verify → retry with the failure reason → rank.
3. **Review** in 3D in the browser (before/after, options 1–3), accept, export the edited IFC or STEP, PDF and BCF.
4. **Voice** and chat; bulk triage and titles on Gemini Flash (`GEMINI_FAST_MODEL`).

The headline is verified model edits. Image-only explanation is a fallback, never the pitch.

## Rules

- **No customer data, ever.** Demo and test models are synthetic.
- **Commits use the repo's configured author with a noreply address.** Never commit a personal email.
- **Secrets never enter git or chat.** Vertex AI uses Application Default Credentials with `GOOGLE_CLOUD_PROJECT` and
  `GOOGLE_CLOUD_LOCATION`; an optional `GEMINI_API_KEY` comes from `.env` (gitignored) or the environment. The browser
  never sees credentials; only the Python server calls Gemini (`server/iris/model_client.py`, class `GeminiModel`).
- **Model names come from env, never code paths:** `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_ESCALATION_MODEL`,
  `GEMINI_IMAGE_MODEL` (defaults in `model_client.DEFAULT_MODELS`); thinking levels `GEMINI_THINKING_LEVEL`,
  `GEMINI_FAST_THINKING_LEVEL`, `GEMINI_ESCALATION_THINKING_LEVEL`; the escalation and image spend cap is
  `IRIS_ESCALATION_MAX_USD_DAY` (images estimated at `IRIS_IMAGE_USD`). Triage, titles and part names always run on
  the fast model.
- **Don't relabel numbers.** A number measured on one model is never reported as another's; re-measure on Gemini.
- **Keep `docs/architecture/` current.** A core change updates its doc in the same PR ("Keep the docs current",
  below).

## Stack and why

- Web: Vite + TypeScript + React; desktop panels on dockview (free MIT core only, never `dockview-enterprise`);
  viewer built on three.js + web-ifc, **no That Open** (three-mesh-bvh is declared
  in `package.json` but nothing imports it). Each IFC file is one `BatchedMesh` (per-element
  transform/colour/visibility, so a preview is one matrix update).
  `COORDINATE_TO_ORIGIN` is off: federated files share coordinates.
- Server: Python 3.13 + FastAPI + IfcOpenShell 0.9 (the demo models pin 0.8.5; keep an eye on drift).
  MCP server over the same operations (`server/iris/service.py` is shared by API and MCP).
- AI: Gemini on Vertex AI through `server/iris/model_client.py`. Roles: Pro for understanding, proposals, chat, plans
  and report text; Flash for bulk triage, titles, STEP part names, voice (buffered segments, transcribed when silence
  ends one) and the lighter Show it built judges; an escalation model for second tries and the full judges; the image
  model for Show it built. Edits made by the model are logged with source `model`.
- Hosting: one Cloud Run service (`deploy/deploy.sh`) serving the web app and API from one origin; Cloud Storage for
  persisted files.

## Geometry facts learned the hard way

- Units: placements/moves/clearances are always **metres**; `IfcScene` converts per file. `edit_object_placement`
  takes SI with `is_si=True`; `add_profile_representation(depth=)` takes SI too.
- Clash tree: use `ifcopenshell.geom.tree(backend="opencascade.trianglebvh")`; the default brep backend has no
  `*_many` queries. Use **intersection** (not collision) for hard clashes: collision misses one element wholly
  inside another. Clearance query gives true gaps.
- Never call the clash queries with an empty set: IfcOpenShell segfaults (guarded in `verify.check`).
- `geometry.edit_object_placement(..., is_si=False)` scales the matrix you pass to SI **in place**: pass a copy when
  the matrix is used again. A frame shared by a route's fittings put every fitting after the first a thousandth of
  the way to the origin on millimetre models (0.3048 on feet), and the check passed them in empty space. Metre test
  fixtures can't show it; test placements on mm or feet with a non-zero placement translation (Revit's way).
- Speed: element boxes are cached once at open (`IfcScene.bounds()`, ~3 s on Northbank), each check triangulates
  only the neighbourhood: 0.4–0.6 s per check on Northbank.
- Every clash query triangulates an element with the same kernel (`scene.kernel`): Revit's faceted meshes
  (`IfcFacetedBrep`, `IfcFaceBasedSurfaceModel`, no openings) on the mesh kernel, the rest OpenCASCADE. OpenCASCADE
  sews those meshes first (Snowdon Towers' check: 150 s, 17 s this way); the two kernels close them differently, so
  detection, the live measure and `verify.check` must use the same rule or a clash found is not one the check sees.
- Port-connected neighbours are ignored in checks (they touch by design); `IfcFeatureElement` (openings) and
  virtual elements are not physical.
- three.js is Y-up, IFC Z-up: viewer delta = (dx, dz, −dy).

## Demo data: Northbank

Synthetic models generated by the team's scripts (generator source not included); the six IFCs ship in `samples/`,
alongside PC-03's two STEP revisions. Other local sample data stays gitignored. Coordination set = Structure + MEP + Architecture; Grids and Site are context only.
Answer key: three clashes on the Level 02 transfer girder `TB-L02-01` (`1eVHoPtl1IhAbbhivqVqb0`):

| | Element | GlobalId | Hit |
|---|---|---|---|
| #042 | Supply air main `SA-MAIN-L02-5` | `2AbvqKF25LGeR0M34N_jld` | −300 mm |
| #057 | Cable tray `LV-TRAY-L02-1` | `3tQ7zxxRDMefPXL6hbHmO2` | −400 mm |
| #061 | Cold water main `CW-MAIN-L02-2` | `1RHD_I4ibLDuUhW1LBAckc` | −400 mm |

Findings (Oct 27):
- Raising #042 by 0.40 m passes with exactly 50 mm all round (its web opening).
- Whole-element moves fail for #057 and #061 (long runs; walls and other services along their length).
- **Rev04 (`Northbank-MEP-Rev04.ifc`) is the designer's fix and the benchmark:** a local offset on all three:
  split either side of the girder (about x 2.6–4.4 m), raise the middle piece (duct +400, tray +250, CW +280 mm),
  short angled pieces with bends either side.
- With the full model visible the girder is hidden by façade and slabs: the viewer needs a context-ghost mode.

## Images sent to the model (per clash)

| | Content |
|---|---|
| A | Pair only, 40% transparent, framed on both, camera outside both, grids on |
| B | Pair solid + grey context at 85% transparency within 2.5 m, same camera |
| C | Pair only, 40% transparent, ≈90° from A; a section/side view when one element is a slab/wall/beam |
| text | Signed distance, names/classes/levels, rule. Severity comes from numbers, not pixels |

## Starting a session

- **Read `docs/architecture/README.md` first** for the map of the application, then the doc for the part you will
  change (table under "Where things are").
- **Specs and plans go in `docs/`** (like `docs/detection.md`, `docs/requirements.md`).
- Follow `AGENTS.md`: large work uses a branch per slice named for its kind (`feature/…`, `fix/…`, `docs/…`, never a
  tool prefix like `codex/` or `claude/`) and a PR; do not implement on `main` or merge without authorization. Run
  the relevant server tests, web build (`npm run build`, `npm test`) and product runtime checks before delivery.
- Demo models: the eight public IFC/STEP files are already in `samples/`; ordinary local setup needs no private repo.
  Generator-side evals and Navisworks packages need a separate demo-models checkout at `../demo-models`, or set
  `DEMO_MODELS` to it. Preserve model bytes; see `samples/README.md`.
- Deploy: Cloud Run, public, with proposal caps. Credentials come from the environment or Secret Manager, never chat.
  Build the web app, run `deploy/deploy.sh` (`docs/architecture/17-deployment-and-operations.md`), open the service
  URL, load Northbank, try one proposal.


## Where things are

The map of the whole application is `docs/architecture/` (start at its `README.md`): one doc per part, with
diagrams, checked against the code. Feature designs (the "why") stay in `docs/*.md`, and the map links to them.

| To understand | Read in `docs/architecture/` |
|---|---|
| What Iris does, every way in, the golden path | `01-product-and-journeys.md` |
| The big picture: parts, process, threads, locks | `02-system-architecture.md` |
| One user action end to end (sequence diagrams) | `03-end-to-end-flows.md` |
| Every server module and what it depends on | `04-server-code-map.md` |
| Objects, ids, lifecycles, where state lives | `05-domain-model-and-state.md` |
| Scene loading, the check, detection | `06-geometry-and-detection.md` |
| Fix kinds, the registry, edits, accept in place | `07-fixes-and-edits.md` |
| Gemini roles, prompts, thinking level, spend | `08-ai-models-prompts-and-spend.md` |
| Agent loop, plans, triage, titles, chat, escalation, built views | `09-agent-workflows.md` |
| Every route, stream event, header and error | `10-http-api-and-streams.md` |
| MCP tools and pairing links | `11-mcp-and-agent-links.md` |
| The React app, its state and modules | `12-web-app.md` |
| The 3D viewer | `13-3d-viewer.md` |
| IFC, STEP, Navisworks, uploads, export, PDF, BCF | `14-files-in-and-out.md` |
| Requirements, settings, every env var | `15-requirements-settings-and-config.md` |
| Secrets, the owner, caps, budgets | `16-security-caps-and-cost.md` |
| The Cloud Run deploy and running it | `17-deployment-and-operations.md` |
| Tests, evals, what to run before delivery | `18-testing-and-evals.md` |
| Northbank and the palletising cell | `19-demo-data.md` |
| Owner decisions, rejected ideas, known limits, roadmap | `20-decisions-limits-and-roadmap.md` |
| Words and names | `21-glossary-and-naming.md` |
| The dated build log | `22-build-log.md` |

## Keep the docs current (every agent, every change)

- **A change to core behaviour updates the matching doc in `docs/architecture/` in the same PR.** Core means a new,
  renamed or removed module, route, stream event, fix kind, model or prompt, env var, cap or budget, stored state or
  id, deploy step, test harness, user-facing flow, or an owner decision. The table in `docs/architecture/README.md`
  ("Keeping these docs current") says which doc each kind of change touches; each doc ends with its own "When to
  update this doc" list.
- When you re-check a doc against the code, update its "Checked against code" date and commit. If you find a doc
  wrong, fix it, even when your change didn't cause it.
- Record notable work as a short dated entry at the end of `docs/architecture/22-build-log.md` (what changed, where,
  how it was checked), not in this file. This file keeps the rules, the traps and the status.
- `server/tests/test_docs_map.py` fails when a server module, prompt, web source file, route, MCP tool or env var is
  missing from the map, or a link in it is broken. Fix it by adding the doc line, never by loosening the test.
- A feature with a design of its own still gets `docs/<feature>.md` (like `docs/edits.md`); the map links to it.

## Traps

- **Web tests stub App's imports:** a new import in `web/src/App.tsx` must be added to both stub lists
  (`web/tests/app-host.mjs` and `app-replacement.test.mjs`), or `npm test` fails to resolve it. Their transform
  cannot read `for (const [a, b] of …)` in App: iterate keys instead.
- **Effects return nothing:** Chromium's `scrollIntoView` returns a Promise; an effect that returns it breaks React's
  cleanup and blanks the panel, so effects use braces.
- **Streams behind a proxy:** an edge that compresses NDJSON holds it back from browsers, so every stream goes through
  `app._ndjson` with `Content-Encoding: identity`. Test a stream with `Accept-Encoding: gzip, deflate, br, zstd`.
- **Trials don't mark files edited:** `IfcScene.translate` moves and moves back; only a kept fix (`Workspace.apply`,
  `apply_offset`, `apply_trim`, …) calls `mark_edited`. Edits live in memory: a restart or reopening the models
  starts clean.
- **Keeping never trusts the page:** every keep route goes through `plans.apply`, which tries each option again
  (`plans.recheck`: `agent.TRIES` with the clearance and requirements of the clash in its `pair`), checks several
  together and keeps all or none (409 `NotVerified` with why). `Workspace.apply_*` are its primitives and do not check.
  A new fix kind needs a `plans.CANDIDATE` entry.
- **STEP export:** place shapes with `BRepBuilderAPI_Transform`, never `.Moved()` (names and colours are lost on
  write).
- **Prompts say only what differs from the defaults:** "every hard clash matters" in the L3 triage line once turned
  12 model-error verdicts into 80 on Northbank.
- **Numbers people see are measured:** the landing's numbers, the README's "Two demos" table and the demo cards share
  pictures and numbers; change them together and only from measured runs, and recapture `web/public/demos/*.webp`
  after visual changes: the stills with `web/scripts/capture-demos.cjs`, the cards' and steps' clips with
  `capture-proposals.cjs --landing` (live proposals; rewrite their alt text from the new run).
- **The dev server watches `iris/` only** (`--reload-dir iris`, README). Plain `--reload` watches
  `server/.venv` too: a `uv sync` or install from another session restarted it and dropped every open model (Nov 2).
- **Nothing names a demo, a domain or a vendor outside its home:** demos in `server/iris/demos.py` (and the tour,
  landing, evals), building or machine and what stays in place in the requirements (`IfcScene.stays`, never a class
  list in a fix path), the 25 mm default in `requirements.DEFAULT_CLEARANCE_M`, model names from `GET /api/models`
  (`web/src/aiNames.ts`), limits in `IRIS_*` settings. A prompt example must never be a demo's answer.

## Status and next steps

Built and verified by geometry before anyone sees a fix: Iris's own detection (and Navisworks reports), `#N` numbers
and model-written titles, bulk triage, seven fix kinds (move, offset with bends, trim, route, penetration, resize,
seat) plus combined fixes, joints (`docs/connections.md`), Fix together and root causes, Insights patterns, chat and
live voice, the MCP server with pairing links, coordination requirements, STEP models (the palletising cell), PDF
reports and BCF, IFC/STEP export, accept in place, escalation (`docs/escalation.md`), Show it built
(`docs/show-it-built.md`), phones and tablets, guided tours, drawing views (`docs/views.md`), measuring
(`docs/measure.md`), docking panels (`docs/panels.md`), properties and filters (`docs/filters.md`), kept checks
(`docs/detection.md`), Workings (`docs/workings.md`), hand edits with one edit log (`docs/manual-edits.md`), and
adding or removing models (`docs/add-and-remove-models.md`). How each part works: `docs/architecture/`. What was built
when: `docs/architecture/22-build-log.md`.

The AI layer moved to Gemini on Vertex AI and hosting to Cloud Run. Model-dependent results (proposal latency, triage
agreement, eval pass rates, costs) must be re-measured on Gemini before any are quoted.

Next, in order.
1. Re-run the answer key (Northbank #042/#057/#061 at Rev04 heights) and `evals/step_cell.py` on Gemini; record the
   results in the build log.
2. Innodata Track 2, "Visual Task Factory": render synthetic views from the open scenes, generate questions, take
   answers from geometry, and score Gemini multimodal models against them.
3. Later: user accounts and saved projects; STEP machines inside building models; offsets and trims on meshed STEP
   parts; glTF/GLB input; connectors into design tools; site photos and scans aligned to the model
   (`docs/architecture/20-decisions-limits-and-roadmap.md`).
