# Evaluation log

`results.csv` is the running record of how Iris's proposals score: one row per model call, appended, never
rewritten, so runs on new datasets and new prompts stay comparable with the first ones.

| Column | Meaning |
|---|---|
| `date` | Day of the run |
| `dataset` | Model set and revision, e.g. `northbank-rev03` |
| `clash` | Clash label from the dataset's answer key (`#042`) |
| `model` | Gemini model id (`GEMINI_MODEL` unless `--model` says otherwise) |
| `images` | `none` or `ABC` (see CLAUDE.md, "Images sent to the model") |
| `run` | Repeat number for the same clash and settings |
| `latency_s` | Wall time of the model call |
| `candidates` / `passing` | Candidates returned / candidates that pass `verify.check` (25 mm clearance) |
| `top1_pass` | Whether the model's first choice passes |
| `top1_delta_m` | First choice as `dx,dy,dz` in metres, Z up |
| `top1_clearance_mm` | Smallest clearance of the first choice, in mm |
| `reference_delta_m` | The dataset's known good fix, when it has one (Northbank: the designer's Rev04) |
| `notes` | What the first choice hit, or what stood out |

Headline numbers to watch: **top-1 pass rate** and **any-candidate pass rate** per dataset, before the retry loop.
The loop's own result (attempts until a verified option) gets its own columns once runs go through `agent.resolve`.

## Running on Gemini

Every eval that calls a model goes through `iris.model_client.GeminiModel` (Vertex AI), built in `eval_models.py`.
Credentials and defaults come from the server's environment (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`,
optional `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_ESCALATION_MODEL`, `GEMINI_THINKING_LEVEL`);
flags override them for one run: `--model`, `--location`, `--project`, `--thinking`.

## Summary

| Date | Dataset | Clashes | Images | Calls | Top-1 pass | Any pass | Median latency |
|---|---|---|---|---|---|---|---|

_Re-run with Gemini to populate._ `answer_key.py` (#042, #057, #061; `--requirements demo` to run under Northbank's own requirements).

## Triage of Navisworks results

`navisworks_triage.py` sends every clash in a Navisworks three-view sample package (the demo-models
repo's `northbank/StructuredOutputs/`) to the model with its A/B/C images and metadata, and asks for a verdict
(`real_clash` / `by_design` / `non_physical` / `modelling_error`), severity, owner and action under a strict JSON schema.
There is no human review yet, so it scores against a reference built from metadata only: a space or port on either
side is `non_physical`, a result within 1 mm is a touch (not a real clash), and the answer key must come back as
`real_clash` with the service, not the girder, moving. Each run keeps its replies, `triage.csv` and `summary.md` in
`runs/<date>-<name>/`.

| Date | Model | Package | Clashes | Images | Answer key | Non-physical | Touching | Failed calls | Median latency |
|---|---|---|---|---|---|---|---|---|---|

_Re-run with Gemini to populate._

The app's **Triage all** uses the same prompt, schema and sure rules (`server/iris/triage.py`) on the fast model
(`GEMINI_FAST_MODEL`), as this eval does by default; `--model` scores another Gemini model on the same package.

## Not a clash: don't fix

`not_a_clash.py` runs joints inside one model that are built that way, where the geometry check alone would pass a
harmful edit: a ground beam cast into its pad footing (Clash1, pad footing C1 vs ground beam grid C), a curtain-wall
transom into its mullion (Clash7), a steel beam into its column. Scored in `not_a_clash.csv` (append-only): triage's
verdict, the options, whether any option changes what must stay put (the pad, the mullion, the column), and whether
every option is marked model cleanup.

Trims need a slender member (`edits.SLENDER`: length at least 3x its width across) and a trim inside one model is
marked `cleanup`.

| Date | Cases | Triage by design | Touches what must stay | All options model cleanup |
|---|---|---|---|---|

_Re-run with Gemini to populate._

## Big models

`big_models.py` writes synthetic IFC4 files of a given size (a third of the elements tessellated, 100-600 triangles
each; the rest extrusions; a property set of eight values on every element: about 3.6 kB an element) and measures the
server opening one the way an upload does; `big_models_browser.cjs` uploads one through the page's **Use your own
models** and times each stage it shows. Local, Oct 29: 4 CPUs, 15 GB, headless Chromium with software rendering.

| File | Elements | Server: open, boxes, detection | Peak RSS | Through the page, end to end | JS heap |
|---|---|---|---|---|---|
| 150 MB | 41,457 | 5 s, 37 s, 5 s | 1.4 GB | 123 s (packed to 32 MB in 6 s; drawing 59 s) | 1.0 GB |
| 250 MB | 68,915 | 9 s, 66 s, 9 s | 1.8 GB | 194 s (packed to 53 MB in 10 s; drawing 91 s) | 1.6 GB |
| 500 MB | 137,181 | 17 s, 174 s, 18 s | 2.8 GB | 484 s (packed to 106 MB in 20 s; drawing 184 s) | 1.4 GB |

The 500 MB rows were measured before big models used CGAL for every element (150 MB: boxes 45 → 37 s with it).

What changed on the way (docs/uploads.md): boxes in one iterator peaked at 4.8 GB for the 150 MB model (2,000 at a
time: 1.4 GB); meshes through OpenCASCADE took 20-30 ms each (CGAL: about 1 ms; the 5 MB model's boxes 11.9 → 1.6 s);
detection's sweep was quadratic (500 MB: 482 → 18 s). Northbank's boxes and its 464 detected clashes are identical
to before.

**The cap stays 150 MB on the demo**: it opens in about two minutes (on a 2-CPU host the server part takes longer).
250 and 500 MB open too, in about 3 and 8 minutes. What stands between them and 500 MB: the boxes (one triangulation
per element in IfcOpenShell, about 1 ms each on 4 CPUs) and drawing in the browser (web-ifc on the page's main
thread, about 3 minutes, the page frozen meanwhile). The follow-ups are parsing in a Web Worker and boxes without
triangulating.

## Which hosts take an opening

`penetration_hosts.py` reads 25 labelled hosts (16 in Northbank, 9 in the PC-03 cell) the way a proposal does
(`hosts.decide`: hard rules, then the model's reading of each kind of host, all kinds in one call, on
`GEMINI_FAST_MODEL`) and scores the verdict, reviewer and fit against what a coordinator would accept
(`penetration_hosts.csv`, append-only). Hosts a hard rule settles (transfer girder, column, glazing, the cell's motor
control centre, light curtain and robot restricted space) are scored too.

| Date | Model | Hosts | As expected | Kinds read | Seconds |
|---|---|---|---|---|---|

_Re-run with Gemini to populate._

## A second try on the escalation model (E0)

`escalation.py --cell <palletising-cell> --northbank <northbank/IFC> --out runs/<date>-escalation` sweeps one proposal
(`GEMINI_MODEL`) over every planted cell clash and Northbank's answer key and B1 (`--reuse` reads a saved
`sweep.json`), then gives each clash left unfixed three arms of two rounds: the proposal model again, the proposal model
with the escalation brief, the escalation model (`GEMINI_ESCALATION_MODEL`) with it; clashes fixed only with a resize
or an opening get the escalation model's "better fix". Rows go in `results.csv` (run `escalation-*`); the arms' advice
and failures in `results.json`, a table in `summary.md`.

| Date | Cases | Unfixed after the sweep | Proposal again | Proposal + brief | Escalation + brief | Escalation cost |
|---|---|---|---|---|---|---|

_Re-run with Gemini to populate._

## The palletising cell from STEP

`step_cell.py --cell <palletising-cell> --out runs/<date>-cell-step` opens the cell's STEP files as the app does (part
classes named by `GEMINI_FAST_MODEL`; `--no-classes` for none), then checks detection, the C1, C2, C3, C6, C7 and C8
fixes, export and Rev B (`--requirements demo` to run under the cell's own requirements). _Re-run with Gemini to populate._

## Iris detection

`detection_navisworks.py` runs Iris's own detection (`server/iris/detect.py`, docs/detection.md) on Northbank
and compares it with the Navisworks package. `detection_cell.py` checks it on the palletising cell from
the demo-models repo, against the cell's generated answer key.

    cd server
    uv run python ../evals/detection_navisworks.py --out ../evals/runs/<date>-northbank-detection
    uv run python ../evals/detection_cell.py --out ../evals/runs/<date>-cell-detection

Results on Oct 28 (`runs/2026-10-28-northbank-detection/`, `runs/2026-10-28-cell-detection/`):

| | Result |
|---|---|
| Northbank, default tests | 633 clashes in 1,961 elements, 7-12 s |
| Sampled Navisworks results Iris also reports | 117 of 117 real overlaps. The other 200 are 129 not physical, 46 touches, 24 one element, 1 joined by ports |
| Answer key | 3/3, including #061, which Navisworks stored no result for |
| Cell Rev A / Rev B | 13/13 planted pairs and 0 unexpected / 0 planted and 0 unexpected |

Oct 30, the cell after C6-C8 were added (`runs/2026-10-30-cell-detection/`): Rev A 112 clashes over 161 parts in 0.8 s,
17/17 planted pairs, 95 by design, 0 unexpected; Rev B 185 parts, 0 planted, 93 by design, 0 unexpected.

The per-discipline counts in `summary.md` are context, not a score. Navisworks stores ports, spaces, sub-objects of one
element and repeated pairs, and 3,100 of its 7,668 stored results are tests of a space, port or opening.

## Properties: nothing dropped

`properties_complete.py` (Oct 31, owner request: "ensure we are retrieving all properties of an element"). For every
object with a GlobalId in the given files it counts the property values the file gives it straight from the
relationships (sets on the object and on its type, IFC4 sets of sets, complex parts, predefined sets; one value per set
and property name, the object's own winning) and checks `properties.Reader.read` returns as many, and never the hidden
demo note. No model calls.

| Date | Models | Objects | Values | Seconds | Result |
|---|---|---|---|---|---|
| Oct 31 | Northbank: Structure, MEP, Architecture, Site, Grids, MEP Rev04 | 5,666 | 16,303 | 2.2 | complete, 0 differ |

Before this reader the panel missed reference values, garbled ranges, tables and complex properties into text, read
only five attributes and the type's name, gave no units, read no type quantities, no material layers, no
classifications, groups or documents, and failed (500) on an IFC4 set of property sets.
