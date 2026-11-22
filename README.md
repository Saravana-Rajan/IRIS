<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/iris/svg/iris-wordmark-dark.svg">
    <img src="assets/brand/iris/svg/iris-wordmark-light.svg" alt="Iris by Techjays" width="260">
  </picture>
</h1>

> **Iris — Does AI truly see?**<br>
> *Fixes, not just findings. Where teams' 3D designs collide, Gemini proposes a real edit to the model, Iris proves
> it with geometry, and only fixes that pass reach you.*

[![Gemini on Vertex AI](https://img.shields.io/badge/Gemini-Vertex_AI-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white&labelColor=555555)](docs/architecture/08-ai-models-prompts-and-spend.md)
[![Cloud Run](https://img.shields.io/badge/Google_Cloud-Cloud_Run-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white&labelColor=555555)](docs/architecture/17-deployment-and-operations.md)
[![Fixes: verified by geometry](https://img.shields.io/badge/Every_Fix-Verified_by_Geometry-00897B?style=for-the-badge&labelColor=555555)](docs/architecture/07-fixes-and-edits.md)
[![Formats: IFC, STEP, BCF, PDF](https://img.shields.io/badge/Formats-IFC_%C2%B7_STEP_%C2%B7_BCF_%C2%B7_PDF-5C6BC0?style=for-the-badge&labelColor=555555)](docs/architecture/14-files-in-and-out.md)
[![MCP server](https://img.shields.io/badge/MCP-Server_%2B_Pairing_Links-111111?style=for-the-badge&labelColor=555555)](docs/architecture/11-mcp-and-agent-links.md)

[How it works](#how-it-works) · [Run locally](#run-locally) · [Tests](#tests) · [Roadmap](#roadmap-innodata-track-2--visual-task-factory) ·
[Architecture](docs/architecture/README.md)

---

**Iris by Techjays is for the design coordinator, who makes every team's 3D design fit together, on a building or a machine.** Iris checks
the models every team makes against each other and finds where they conflict: two parts designed into the same space,
or too close to leave room (the industry calls these clashes). It sorts what matters from what doesn't and proposes one
to three fixes. Every fix is a real edit to the model, and is checked by geometry before anyone sees it: the conflict is
gone, there is clearance, and nothing new is hit. You review the options in 3D, accept one, and export the edited model.

## At a glance

- **Fixes, verified.** Every option edits the model's own elements and passes the geometry check first. A failed idea
  goes back to Gemini with the reason. Seven fix kinds (move, offset with bends, trim, route, penetration, resize,
  seat) and fixes that combine them.
- **Its own clash detection.** On the Northbank demo, every pair of models checked: 464 clashes in 1,732 elements in
  about 4 s (geometry only, no model calls). Navisworks XML clash reports are read too.
- **Buildings and machines.** IFC models and STEP assemblies in; the edited IFC or STEP, PDF reports and BCF issues out.
- **You keep the last word.** Before / After / Both in 3D, beside plans, sections and elevations; accept, undo, export.
  Keeping runs the check again on the server, never trusting the page.
- **Watch it work.** Workings draws each run as it happens: the brief, the model's ideas, Iris's check on each, the ranking.
- **Bring your own agent.** An MCP server over the same operations, with pairing links, so any MCP client fixes through
  the same geometry check.

### Gemini at work

| Role | Env var | What it does in Iris |
|---|---|---|
| **Gemini Pro** | `GEMINI_MODEL` | Reads each clash from three pictures and the model data, proposes edits; chat, root causes, plans and report text |
| **Gemini Flash** | `GEMINI_FAST_MODEL` | Bulk triage of hundreds of clashes, clash titles, STEP part names, voice transcription, and the lighter Show it built judges |
| **Escalation model** | `GEMINI_ESCALATION_MODEL` | A second try on clashes the main model could not fix, and the full Show it built judges (daily cap `IRIS_ESCALATION_MAX_USD_DAY`) |
| **Gemini image model** | `GEMINI_IMAGE_MODEL` | Show it built: a checked fix restyled as a picture of what will be built |

Thinking depth is set per role with `GEMINI_THINKING_LEVEL`, `GEMINI_FAST_THINKING_LEVEL` and
`GEMINI_ESCALATION_THINKING_LEVEL`; default model ids live in `model_client.DEFAULT_MODELS` and env vars override them. The server calls Gemini through `server/iris/model_client.py`
(`GeminiModel`); the browser never does. Prompts and budgets: [08 · AI models, prompts and spend](docs/architecture/08-ai-models-prompts-and-spend.md).

## How it works

```
Browser (React + three.js + web-ifc)          Server (Python, FastAPI, on Cloud Run)
  view · pick · isolate · preview options  ⇄    Iris core (also an MCP server)
                                                  ├─ IfcOpenShell: load, connected runs, edits, IFC export
                                                  ├─ Geometry check: collision + clearance (IfcOpenShell tree)
                                                  └─ Gemini on Vertex AI (vision, reasoning)
```

The agent loop is **propose → verify → retry → rank**: Gemini proposes fixes from the clash images, the element data
and a domain pack (rules of thumb, in `server/iris/domain_packs/`); the geometry check tests each one; failures are fed
back with what they hit; only verified options are shown. A fix is a **move** (an element and its straight run), a
**local offset** (split either side of an obstacle, raise or lower the middle piece, join it with bends), a **reroute**
(up to three such steps), a **trim** at a joint, or a penetration, resize or seat. Every kind is registered once
(design: [docs/edits.md](docs/edits.md)). The browser previews moves instantly; the server makes the real edit and is
the only source of clearance numbers. Elements are addressed by IFC GlobalId everywhere.

- **Detection** ([docs/detection.md](docs/detection.md), `server/iris/detect.py`): every pair of open models and each
  model against itself, hard at 1 mm, plus duplicates. Pairs meant to meet (joined by ports, one assembly, a door in its
  wall) are counted but not reported. A box sweep finds candidate pairs; IfcOpenShell's triangle tree measures them.
- **Triage** (`server/iris/triage.py`): every clash gets a verdict (real, by design, not physical, model error). Sure
  cases are settled by rule with no model call; the rest go to Gemini Flash in batches, with their images.
- **Titles and numbers:** every clash has a stable `#N` and a readable title written by Gemini Flash (`server/iris/titles.py`).
- **Fix together and root causes** (`server/iris/plans.py`): fixes for several clashes are applied in one trial and
  checked against the whole model, swapping in a next-best option when two collide. Root causes find the element at
  the centre of several clashes and build one plan.
- **Explore wider fix:** for a clash that needs changes around it, Iris inspects nearby geometry and checks complete
  arrangements of up to three coordinated edit groups, each with designer review conditions.
- **Coordination requirements** ([docs/requirements.md](docs/requirements.md)): a design level, a strictness, checks
  between groups, who moves for whom and pairs declared by design. They only ever turn into numbers (tolerance,
  clearance, move limit) and every verified fix says which requirements it meets.
- **Chat and voice** (`server/iris/chat.py`): Gemini with tools over the open report and model: list and look at
  clashes, measure, find elements and openings, check a move, propose fixes, drive the view.
- **STEP** ([docs/step.md](docs/step.md)): AP203/AP214/AP242 assemblies are converted to IFC on open, keeping part names
  and colours; export gives your STEP back with the fixes written in.
- **Show it built** ([docs/show-it-built.md](docs/show-it-built.md)): the Gemini image model restyles Iris's own view of
  a checked fix; the picture is checked against the model before anyone sees it.
- **Viewer:** Shaded / X-ray / Context / Isolate, section box, measure with snapping, properties, filters by property,
  plans, sections and elevations beside 3D. Keys: 1-4 views, H fit, F go to clash, S section, M measure, Esc clears.

### Connect an agent (MCP)

Any MCP client can work on your Iris session. In the app choose **Connect an agent** and paste the settings it shows:

```bash
gemini mcp add --transport http iris https://<host>/mcp --header "Authorization: Bearer <token>"
```

The agent sees what you have open, checks its own ideas against the model, runs Iris's fix agent, applies fixes,
triages, builds the report and exports. The link is a secret that expires 12 hours after its last use. Locally, with
its own session: `cd server && uv run python -m iris.mcp_server`. Details: [docs/mcp.md](docs/mcp.md).

## Demo models

Two synthetic model sets ship in [samples/](samples/README.md), each with an answer key and no customer data:

- **Northbank, a riverside office site** (6 IFC files): structure, building services, architecture, site and grids. On
  Level 02 a transfer girder is hit by a supply-air duct, a cable tray and a cold water main. `Northbank-MEP-Rev04.ifc`
  holds the designer's own fixes, the benchmark for Iris's.
- **PC-03, a robot palletising cell** (2 STEP revisions): a robot, conveyor, guarding and services with eight planted
  problems; Rev B is the fixed revision. `evals/step_cell.py` checks fixes against its answer key.

## Run locally

**Prerequisites:** Git, [Node.js](https://nodejs.org/en/download) LTS 22.12+, [uv](https://docs.astral.sh/uv/) (it
installs Python 3.13), and a browser with WebGL. On Linux also `sudo apt install libgl1`. PDF reports need Pango (see
[PDF system libraries](#pdf-system-libraries)). On Windows PowerShell use `npm.cmd` in place of `npm`.

```bash
uv python install 3.13
uv sync --project server --locked --python 3.13
npm ci --prefix web
test -f .env || cp .env.example .env      # at the repo root; never committed
```

Start the two servers in separate terminals from the repo root, then open <http://127.0.0.1:5173>:

```bash
cd server && uv run --locked uvicorn iris.app:app --reload --reload-dir iris --host 127.0.0.1 --port 8000
cd web && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Vite forwards `/api` to port 8000; <http://127.0.0.1:8000/api/samples> should return JSON with `files` and `demos`.
Keep `--reload-dir iris`: plain `--reload` also watches `server/.venv` and a package install would restart the server,
dropping open models. Edits live in server memory, so export before restarting.

**First check, without any credentials:** generate a small model with
`uv run --directory server --locked python -m iris.fixtures ../samples/fixture-clash.ifc`, open only that file from
**Menu › Models**, choose **Check 3 elements**, pick clash #1, expand **Try a move yourself**, enter **-0.80** and choose
**Check this move**. Expect **Clear · nearest +50 mm** (a **-0.40** move clears the beam but hits the pipe).

### Enable AI features

Iris calls Gemini on Vertex AI from the Python server. Set these in the root `.env` (no quotes, no inline comments) or
the environment, then restart the server:

| Variable | Purpose |
|---|---|
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | The Vertex AI project and location (default `global`). Authenticate with Application Default Credentials (`gcloud auth application-default login`) |
| `GEMINI_API_KEY` | Optional: an API key, used only when no project is set |
| `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_ESCALATION_MODEL`, `GEMINI_IMAGE_MODEL` | Override the model for each role (above) |
| `GEMINI_THINKING_LEVEL`, `GEMINI_FAST_THINKING_LEVEL`, `GEMINI_ESCALATION_THINKING_LEVEL` | Thinking level per role (defaults `low`, the model's own, `high`) |
| `GEMINI_INCLUDE_THOUGHTS` | `1` (default) streams thought summaries to Workings; `0` turns them off |

Viewing, detection, measuring and manual move checks need no credentials. Proposals, chat, triage, titles, plans,
report text and STEP part classification need Gemini access, and live calls may incur charges. Every setting, caps
included, is in [the configuration reference](docs/architecture/15-requirements-settings-and-config.md).

### PDF system libraries

WeasyPrint needs Pango ([platform instructions](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#installation)):

- **Ubuntu/Debian:** `sudo apt install libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 fonts-dejavu-core`
- **macOS:** `brew install pango libffi`
- **Windows:** [MSYS2](https://www.msys2.org/), then `pacman -S mingw-w64-ucrt-x86_64-pango` in its UCRT64 shell; set
  `WEASYPRINT_DLL_DIRECTORIES=C:\msys64\ucrt64\bin` if Python cannot find the DLLs.

Check with `uv run --directory server --locked python -m weasyprint --info`.

### Troubleshooting

| Symptom | Check |
|---|---|
| Page loads but API requests fail | Both servers running? Check `/api/samples` on port 8000 and the Python terminal |
| Viewer reports missing `.wasm` files | `npm run copy-wasm --prefix web`, then refresh |
| AI request fails | Check `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION`, ADC or `GEMINI_API_KEY`, model access and quota |
| Open models vanish ("Open them again") | The server was started without `--reload-dir iris` |
| MCP client cannot connect through 5173 | Use `http://127.0.0.1:8000/mcp`; Vite proxies `/api`, not `/mcp` |

## Deploy (Cloud Run)

One container serves the built web app and the API from the same origin, deployed to Cloud Run by
[`deploy/deploy.sh`](deploy/deploy.sh); persisted files go to Cloud Storage and secrets come from the Cloud Run
environment (Secret Manager), never git. Open models and edits live in server memory, so the service runs a single
instance. Proposals, chat and other model calls are capped per visitor and per day (`IRIS_*` settings in
`server/iris/limits.py`). Owner settings unlock with `IRIS_OWNER_TOKEN` and `#owner` in the URL. Full guide:
[17 · Deployment and operations](docs/architecture/17-deployment-and-operations.md).

## Tests

From the repo root, after installing dependencies (and the PDF libraries for the server suite):

```bash
uv run --directory server --locked pytest -q
npm run build --prefix web
npm test --prefix web
```

The unit tests use synthetic models and scripted AI responses; they need no credentials. Real-model
[evals](evals/README.md) are separate, make paid Gemini calls, and are being re-run on Gemini: earlier results were
measured on other models and are not reported here.

## Roadmap: Innodata Track 2 — Visual Task Factory

Iris is being extended into an entry for Track 2 of the Innodata Frontier AI Hackathon 2026. The same scenes and
geometry engine that verify fixes become a **factory of visual tasks** for benchmarking Gemini multimodal models:

- **Synthetic images:** Iris renders views of real 3D models (the A/B/C clash views, plans, sections, X-ray) with
  controlled camera, transparency and context.
- **Questions:** generated per image: does A touch B, which is in front, how far apart, which element blocks the duct,
  how many clashes are visible.
- **Geometry-verified answers:** every answer comes from IfcOpenShell measurements, not from a model or a person, so
  the ground truth is exact.
- **Scoring:** Gemini's answers are graded against that ground truth, by task type and difficulty — asking, in
  numbers, whether AI truly sees.

This part is **Iris VisionBench**: the design is in [docs/visionbench.md](docs/visionbench.md), and the quick start
(install, run, read the report) in [bench/README.md](bench/README.md).

Beyond that: connectors so a kept fix lands in the designers' own tools, checks against site photos and scans, and
saved projects ([20 · Decisions, limits and roadmap](docs/architecture/20-decisions-limits-and-roadmap.md)).

## Documentation

[docs/architecture/](docs/architecture/README.md) maps the whole application: product and journeys, architecture,
flows, server and web code, geometry, fixes, AI models and prompts, the API and MCP, files, configuration, security,
deployment, tests and evals, with diagrams. Feature designs are in [docs/](docs/); the brand kit is in
[assets/brand/iris/](assets/brand/iris/).
