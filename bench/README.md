# Iris VisionBench

The Track 2 (Visual Task Factory) pipeline of Iris by Techjays: synthetic MEP coordination scenes, rendered pictures,
engineering questions about them, and reference answers taken from geometry. **The model sees the scene. Iris knows
the geometry. The geometry independently verifies the answer.**

The full design (jobs, categories, ground truth, controls, scoring, limitations) is in
[docs/visionbench.md](../docs/visionbench.md).

## Quick start

From the repo root:

```bash
# 1. Renderer: three.js in headless Chromium (SwiftShader, deterministic per job)
(cd bench/render && npm ci && npx playwright install chromium)

# 2. Python side (or: cd server && uv sync)
uv sync --project server --locked --python 3.13

# 3. Credentials: a git-ignored .env at the repo root
cp .env.example .env
#    then set ONE of:
#      GEMINI_API_KEY=...                         (Gemini API)
#      GOOGLE_CLOUD_PROJECT=... and GOOGLE_CLOUD_LOCATION=global   (Vertex AI;
#      sign in once with: gcloud auth application-default login)
```

`server/iris/model_client.py` (`load_env`) reads `.env`; real environment variables win. Never commit keys.

Then, from `server/`:

```bash
uv run iris-bench all --seeds 0:20 --model fake:0.7 --out runs/x      # offline; a real model also needs --max-usd
uv run iris-bench verify --out runs/x --sample 100
uv run iris-bench export --out runs/x --to datasets/sample --sample 50
open runs/x/report.html
```

- `all` runs generate, render, build, run, score, verify and report in order; it returns 2 when an integrity check
  fails (the report is still written). If rendering fails, it carries on without pictures (and skips J5-J7).
- `verify` writes `integrity.json`: the answer key frozen before any model call (`manifest.json` hashes), truth modules
  that import no runner or model client, pictures-mode prompts that name no kinds, ids or measurements, a job-stratified
  sample of reference answers re-derived from `scene.json` by geometry, every answer letter labelled in the item's own
  pictures with the truth's meaning (`letters_shown`), and answer balance against chance (a warning).
- `export` packages a stratified sample of tasks (images, prompt, schema, reference answer, evidence) for sharing.
- **Offline check, no API calls:** `--model fake:0.7` uses the stand-in model (right with probability 0.7, otherwise a
  random schema-valid reply). Its report carries a FAKE MODEL banner: the numbers test the pipeline and say nothing
  about any real model.

### One stage at a time

Every stage is its own command and reads the run folder the previous one wrote:

```bash
uv run iris-bench generate --seeds 0:20 --out runs/x --challenge density=8 --challenge occlusion=1
uv run iris-bench render   --out runs/x
uv run iris-bench build    --out runs/x --modes pictures,pictures_text,no_image,swapped
uv run iris-bench run      --out runs/x --model gemini-3.8-flash --max-usd 2 --concurrency 8
uv run iris-bench score    --out runs/x
uv run iris-bench report   --out runs/x
```

| Flag | Meaning |
|---|---|
| `--seeds` | `0:20` (0 to 19), `3`, `1,4,9`, `0:20:5`. Required by `generate` and `all`; later stages default to the seeds on disk |
| `--challenge key=value` | Repeatable scene knob, e.g. `density=8`, `decoys=2`, `occlusion=1`, `gap_mm=10`, `overlap_mm=100`, `beams=2`, `column=true`, `orient=y`, `style=xray` |
| `--modes` | Which item modes to build (default all four: `pictures`, `pictures_text`, `no_image`, `swapped`); add `agentic` for copies of the pictures items that `run` sends to `iris_bench.agentic.run_agentic` (skipped with a note when the module is missing) |
| `--control-sample N` | Items kept per control mode (`no_image`, `swapped`, `pictures_text`), job-stratified and seeded, the same base items in each mode where possible (default 100; `0` keeps all). Every `pictures` item is kept |
| `--no-j5` | Skip the fix renders (J5/J6 before/after, J7 candidates); J8/J9 group renders still run |
| `--balance` | Balance J1 answers across clash kinds over the run |
| `--limit N` | Ask the model about the first N items only |
| `--sample N` | Ask only N job-stratified `pictures` (and `agentic`) items, e.g. a thinking comparison |
| `--sample-controls K` | With `--sample`: also K items per control mode, on the sampled base items first (paired deltas) |
| `--ids FILE` | Ask exactly the item ids listed in FILE (e.g. a budget-sized, job-balanced selection); cached replies are free |
| `--thinking LEVEL` | `default` (Google's per-model default; Flash-Lite gets LOW, since its MINIMAL default is meant for simple extraction) or `low` / `medium` / `high`. A non-default level runs under the label `<model>@<level>`: its own cache, result rows and report rows |
| `--max-usd X` | Stop starting model calls once this `run`'s new spend reaches X (in-flight calls can overshoot by at most `--concurrency` calls). `run` then returns 3; `all` scores and reports the partial results |
| `--max-steps N` | Agentic mode: model turns per episode (default 4) |
| `--concurrency N` | Parallel model calls (default 8) |
| `--workers N` | Processes for generate (default: CPU count); also caps `--render-workers` |
| `--render-workers N` | Processes that drive a headless browser in render and build (default min(4, CPUs)). More starve each other on a loaded machine and the browsers crash |
| `--no-ifc` | Skip writing `scene.ifc` |

Rendering: `render` draws every planted pair of a seed in one browser, from the scene's cameras (A, B, C, top,
section). A job lost to a browser crash ("browser has been closed") is tried once more in a fresh browser; a pair whose
camera render still fails falls back to the renderer's A/B/C views. `render_stats.json` in the run folder counts
camera renders, fallbacks, browser restarts and failed fix / candidate / group renders in `build`.

### Gemini settings (fair, reproducible; `server/iris_bench/runner.py`)

Same rule for every model (Google's Vertex AI guidance, checked Nov 22, 2026): thinking at Google's default level unless
`--thinking` says otherwise (Flash-Lite LOW), `include_thoughts` off, `media_resolution` HIGH, JSON reply with the
item's JSON Schema (`response_json_schema`), no temperature / top_p / penalties / max_output_tokens, an `Image k:`
text part before each picture and the question last. Only transport errors (429, 5xx, timeouts) are retried; a reply
that is not JSON (finish reason recorded, e.g. MAX_TOKENS) is a failed answer and is never retried. Each cached reply
keeps the model version, finish reason and tokens; `run` records what it sent, counts and cost under `model_runs` in
`manifest.json`. Cost uses `runner.BENCH_PRICES` (USD per 1M tokens billed in Nov 2026: Argon/Carbon $2/$10 until
Nov 30, then $4/$20; 3.8 Flash $0.75/$3.75; Flash-Lite $0.30/$2.50; `IRIS_BENCH_PRICES` overrides).

### Real runs (paid): lean plan, always with a budget

VisionBench evaluates **Gemini 3.8 Flash** (the CLI default, `--model gemini-3.8-flash`); Gemini 3.5 Flash-Lite is an
optional cheap comparison. Gemma 4 on Vertex MaaS needs the OpenAI-compatible chat/completions call, which the runner
does not have yet. `run` refuses a real model without `--max-usd`. Several models share one run folder (render once;
`run` replaces only its own model label's rows). Check `manifest.json` `model_runs.<label>.usd_new_this_run` after
each model. With 6 seeds the build gives about 260 pictures items plus 3 x 100 controls (about 560 calls); about 9
seeds give the ~400 pictures items planned per model. Measured on Nov 22 (gemini-3.8-flash, Google-default thinking,
media resolution HIGH; 170 calls): $0.0137 per call on average, about 3,800 input and 2,800 thinking tokens; thinking
is about 80% of the cost. J7 (pick the valid solution) runs about $0.04 a call (up to $0.06), J3/J4 about $0.02, the
rest $0.004 to $0.015. So $2.50 buys about 180 calls, and a run of 300 pictures items plus 3 x 100 controls costs
about $8. `run` asks every pictures item first, then the controls one base
item at a time, so a budget stop leaves a balanced subset; `--sample N --sample-controls K` picks the subset up front.

```bash
# ~400 pictures items per model: pick the seed count from a dry build (items.jsonl, mode "pictures")
uv run iris-bench generate --seeds 0:6 --out runs/real --locked-services 1
uv run iris-bench render   --out runs/real
uv run iris-bench build    --out runs/real                  # every pictures item + 100 per control mode
uv run iris-bench run    --out runs/real --model gemini-3.8-flash --max-usd 2 --concurrency 8
uv run iris-bench run    --out runs/real --model gemini-3.8-flash --thinking high --sample 50 --max-usd 0.75
# optional cheap comparison (thinking LOW by the default rule)
uv run iris-bench run    --out runs/real --model gemini-3.5-flash-lite --max-usd 1 --concurrency 8
uv run iris-bench score  --out runs/real && uv run iris-bench verify --out runs/real && uv run iris-bench report --out runs/real
```

For the final runs, prefer Vertex batch prediction (half price): `runner.write_batch_jsonl(items, path,
model=label)` writes the same requests (no CLI flag or submit/collect step yet).

Keep run folders (`runs/`) out of git. The one exception is the published sample run,
[sample-run/](sample-run/README.md): a Gemini 3.8 Flash run with its pictures as WebP, which `score` and `verify`
re-check offline.

## What each stage writes

Everything lands in the run folder, `runs/<name>/`:

| Stage | Writes | Notes |
|---|---|---|
| generate | `scenes/<seed>/scene.json` | The scene (schema v2): elements, openings, planted pairs and their truth, challenge knobs. Same seed and knobs, same scene |
| | `scenes/<seed>/scene.ifc`, `ids.json` | IFC4 via IfcOpenShell, so Iris's own engine can open and check it; `ids.json` maps scene ids to IFC GlobalIds |
| render | `scenes/<seed>/render/<tag>_<view>.png` | The pictures: views A, B, C per planted pair |
| | `scenes/<seed>/render/<tag>_<view>.id.png` | Object-ID pass (flat colour per element), used for the visible-pixel counts |
| | `scenes/<seed>/render/views.json`, `scenes/<seed>/views.json` | Per view: letters, colours, visible pixels per element, focus |
| build | `items.jsonl` | One item per job x planted pair x mode, plus `no_image` and `swapped` control copies. J5 before/after pictures are rendered on demand into `render/` |
| run | `results.jsonl` | One result per item: reply, correct, detail, latency, cost |
| | `cache/<model>.jsonl` | Reply cache keyed by model, item id and a hash of prompt, schema and images: a rerun makes no new calls. Errors are not cached, so they are retried |
| score | `graded.jsonl`, `scores.csv`, `scores.jsonl`, `item_scores.jsonl` | Results graded by the geometry checker, tidy score rows, one row per item |
| report | `report.md`, `report.html` | Self-contained (inline SVG, no external libraries) |

`runner.write_batch_jsonl` can also write the same requests as Vertex AI batch prediction lines (no CLI flag yet).
`render_stats.json` holds the render and build render counts (see "Rendering" above).

## How to read report.html

Sections, top to bottom (`server/iris_bench/report.py`):

| Section | What it shows |
|---|---|
| FAKE MODEL banner | Present only for `fake:` runs: ignore every number below it |
| Accuracy with pictures | Per model, accuracy per job and over all jobs, with 95% bootstrap CI whiskers |
| Controls | Accuracy over all jobs per mode, and a paired table: control minus pictures on the same questions. A model that uses the picture drops on `no_image` and `swapped`; `pictures_text` shows how much stated measurements help |
| Cost-weighted score | Errors weighted by what they would cost on a job (illustrative weights, not measured: `false_clear` and `approved_bad_fix` 5 ... `false_alarm` 1). Score = 1 - total cost / (items x max weight) |
| J3 partial credit | Direction right, distance within +-max(25 mm, 15%) of the minimal passing move, right opening |
| Where accuracy drops | The worst challenge slices against the overall figure: occlusion, density, gap_mm, overlap_mm, visible_px, view, style |
| Error taxonomy | Counts per job and error type (false clear, false alarm, approved bad fix, too small, hits a new element, wrong direction, wrong element, ...) |
| Sample items | Right and wrong answers per job: the pictures, the reply and the checker's reason |

Reading rules:

- Overlapping confidence intervals: no claim either way.
- `swapped` close to `pictures`: that job is not being answered from the pictures.
- `no_image` close to `pictures`: the question is answerable from priors or wording; flag the job.
- A per-category table (the eight categories) and calibration / confidently-wrong figures are **in progress**.

## Tests

```bash
uv run --directory server pytest -q tests/bench
```

The renderer tests need node and `bench/render`'s packages (step 1 above).
