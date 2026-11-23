# VisionBench sample run: Gemini 3.8 Flash, 7 seeds

This folder holds the outputs of a real, paid Iris VisionBench run, committed so you can inspect them without running
anything. It is the run behind the VisionBench numbers in the [main README](../../README.md#iris-visionbench-gemini-38-flash).

| | |
|---|---|
| Model | `gemini-3.8-flash` on Vertex AI, Google's default thinking level, media resolution HIGH, JSON schema output |
| Scenes | 7 seeds (0 to 6), 28 planted pairs, generated with `--locked-services 1` |
| Pictures | 362 rendered pictures (three.js in headless Chromium): views A, B, C, top and section, fix before/after, J7 candidates |
| Items built | **1,183**: 298 `pictures`, 298 `pictures_text`, 298 `no_image`, 289 `swapped` |
| Items graded | **160**: 95 `pictures` (11 per job, 7 for J4), 22 `no_image`, 22 `swapped`, 21 `pictures_text` |
| Spend | **$2.33** for 170 Gemini calls (`manifest.json`, `model_runs` → `usd_all_calls_in_cache`) |
| Budget | Capped with `--max-usd`; the cap stopped the run (`budget_hit: true`), and 7 items were never asked |
| Integrity | **PASS** (`integrity.json`): answer key frozen before any model call, 298/298 reference answers re-derived by geometry, every answer letter shown in its pictures |
| Date | Built 2026-11-22 09:16 UTC; model run 2026-11-22 |

**Headline (pictures mode, 95% bootstrap CI):** 58% [47, 67] with pictures, 36% [18, 59] with no picture, 14% [0, 32]
with the wrong (swapped) picture, and 90% [76, 100] with pictures plus measurements as text. Mean confidence 0.96,
ECE 0.385. The samples are small (n = 7 to 22 per category), so read these numbers as a first measurement.

## Open the report

- **`gemini-3.8-flash-7/report.html`**: open it in a browser from a clone or download of the repo (GitHub shows HTML
  as source). It is self-contained (inline SVG charts, no external libraries), and its sample items load their pictures
  from `scenes/`.
- **`gemini-3.8-flash-7/report.md`**: the same report as Markdown, readable on GitHub, with pictures.
- **`gemini-3.8-flash-7/pictures.md`**: every graded item with its job, mode, whether the answer was right, and links to
  the pictures it was shown.

## What each file contains

All paths are in `gemini-3.8-flash-7/`.

| File | Contents |
|---|---|
| `items.jsonl` | The 1,183 items, one per line: `id`, `seed`, `job` (J1 to J9), `mode`, the exact `prompt`, the reply's JSON `schema`, the `images` shown, the reference answer (`truth`), the geometry `evidence` and the scored `categories` |
| `manifest.json` | The answer key frozen at build time: a SHA-256 per item over id, seed, job, mode, truth, evidence and categories, a hash per `scene.json`, hashes of the truth code, and `model_runs` (every setting sent to Gemini, token prices, calls, spend, budget) |
| `results.jsonl` | One row per answered item: the model's `reply`, `correct`, the checker's `detail`, `latency_s` and `cost_usd` |
| `graded.jsonl` | The same rows after grading by the geometry checker |
| `item_scores.jsonl` | One flat row per graded item: answer and reference answer, confidence, the model's reason and the checker's reason, error type, category and scene knobs (density, gap, overlap, occlusion, visible pixels) |
| `scores.jsonl`, `scores.csv` | 477 tidy score rows: accuracy per job, mode and category with 95% CIs, controls, calibration (ECE, Brier), confidently wrong, error taxonomy, cost-weighted score and slices |
| `integrity.json` | The `iris-bench verify` result: the six checks, their details and any offending items |
| `render_stats.json` | Render counts per seed: camera renders, fallbacks (0), browser restarts (0), fix and candidate renders |
| `report.md`, `report.html` | The report |
| `cache/gemini-3.8-flash.jsonl` | The raw reply cache: 170 Gemini replies, each with model version, finish reason, token counts and cost |
| `scenes/<seed>/scene.json` | The scene: elements, openings, planted pairs and their truth, challenge knobs. The answer key is derived from it |
| `scenes/<seed>/scene.ifc`, `ids.json` | The scene as IFC4 (written with IfcOpenShell) and the map from scene ids to IFC GlobalIds |
| `scenes/<seed>/views.json`, `render/views.json` | Per picture: the letter shown for each element, colours, visible pixels and focus |
| `scenes/<seed>/render/*.webp` | The 221 pictures shown to Gemini for the graded items |
| `pictures.md` | Index: graded item → pictures |

## What was changed from the raw run folder

Nothing in the results was edited. To publish the folder we made only these changes, all mechanical:

1. **Local paths removed.** Absolute paths on the machine that made the run became relative: the `images` paths in
   `items.jsonl` (now `scenes/<seed>/render/<name>.png`) and the module paths in `integrity.json` (now
   `server/iris_bench/<module>.py`). The item digests in `manifest.json` do not cover these paths, so they still match.
2. **Pictures stored as WebP.** The run made 362 PNG pictures (84 MB with their object-ID passes). We kept the 221
   that the graded items showed, converted to WebP at quality 80 (6.2 MB), under the same name with `.webp`.
   `items.jsonl` keeps the `.png` names the run used (they also key `views.json`, which `verify` reads), and the
   picture links in `report.md` and `report.html` were changed from `.png` to `.webp` so they display.
3. **Left out:** the pictures of the 1,023 items that were not graded, the object-ID passes (`*.id.png`) and a lock
   file. `iris-bench render` makes them again from the scenes.

Every other file is byte for byte as the run wrote it.

## Check it yourself, free and offline

From the repo root, after the [setup](../../README.md#run-locally). Use a scratch copy, because these commands rewrite
files in the folder they are given, and run them from inside it, because the picture paths are relative to it:

```bash
REPO=$(pwd)
cp -R bench/sample-run/gemini-3.8-flash-7 /tmp/sample-run && cd /tmp/sample-run
uv run --project "$REPO/server" iris-bench score  --out .                # regrades: 58% / 36% / 14% / 90%, as committed
uv run --project "$REPO/server" iris-bench verify --out . --sample 400   # the integrity checks pass, 298/298 re-derived
```

No model is called: `score` regrades the saved replies with the geometry checker, and `verify` re-derives the reference
answers from `scene.json`. A `report` run here writes `.png` picture links; open the committed report for pictures.

## Reproduce it

All commands run from `server/`. Install the renderer once first:
`(cd ../bench/render && npm ci && npx playwright install chromium)`.

**Free, offline, with a stand-in model** (right 70% of the time; its report carries a FAKE MODEL banner, and its numbers
test the pipeline, not a model):

```bash
uv run iris-bench all --seeds 0:7 --locked-services 1 --control-sample 0 --model fake:0.7 --out runs/seven
open runs/seven/report.html                    # xdg-open on Linux
```

This regenerates the same seven scenes: we checked that each `scene.json` it writes is byte-identical to the one in this
folder. It then renders, builds, answers, scores, verifies and reports.

**Paid, with Gemini, always capped** (needs Vertex AI or a Gemini API key in the root `.env`; `run` refuses a real model
without `--max-usd`). A run of this one's shape on the same build:

```bash
uv run iris-bench run    --out runs/seven --model gemini-3.8-flash --sample 95 --sample-controls 22 --max-usd 2 --concurrency 8
uv run iris-bench score  --out runs/seven
uv run iris-bench verify --out runs/seven --sample 400
uv run iris-bench report --out runs/seven
```

`--max-usd` stops new calls once the run's new spend reaches the cap (in-flight calls can overshoot by at most
`--concurrency` calls). Replies are cached in `runs/seven/cache/`, so a rerun of the same items is free. A Gemini 3.8
Flash call averaged $0.0137 on Nov 22. Every stage and flag: [bench/README.md](../README.md). The design:
[docs/visionbench.md](../../docs/visionbench.md).
