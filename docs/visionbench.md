# Iris VisionBench

Iris by Techjays has two parts. **Iris Engineering** is the MEP coordination app: it finds clashes in real 3D building
models, proposes fixes and verifies each fix by geometry before anyone sees it. **Iris VisionBench** (this document)
is our Track 2 entry for the Innodata Frontier AI Hackathon 2026, "Visual Task Factory": a pipeline that generates
synthetic coordination scenes, renders them, asks the questions a coordinator asks, and scores Gemini multimodal
models against answers taken from geometry.

> **The model sees the scene. Iris knows the geometry. The geometry independently verifies the answer.**

Quick start and run commands: [bench/README.md](../bench/README.md). Code: `server/iris_bench/` and `bench/render/`.

**Status (2026-11-23).** Schema v2 (`server/iris_bench/spec.py`) defines nine jobs (J1–J9) in eight scored
categories, and all nine are built. Built and tested: scene generation, IFC export, closed-form geometry, the checker
and its cross-check against Iris's engine, relations, candidate resolutions and cameras (`truth.annotate`), locked
elements, views A/B/C, top, section, before/after and numbered candidates, jobs J1–J9, the no-image, swapped and
pictures-with-text controls, the runner (Gemini or an offline fake model), scoring (including categories, calibration,
confidently wrong and plausible but wrong) and the report. A Gemini 3.8 Flash run over 7 seeds is committed with its
report: [bench/sample-run/](../bench/sample-run/README.md). The few parts still marked **(in progress)** are specified
but not yet part of a run.

## 1. The application: MEP coordination

On a building project, the structure (beams, columns, slabs) and the services (ductwork, pipework, cable trays) are
designed by different teams in separate models. Before anything is built, a coordinator combines the models, finds
the places where they collide, decides which is a real problem, decides what moves, and checks that the move works.
Iris Engineering does that work with geometry. VisionBench asks whether a frontier multimodal model, looking at the
same scene, can do it from pictures.

The answers are not cosmetic. Each wrong answer has a cost on site:

| Model error | What happens on the project | Error type in scoring | Illustrative weight |
|---|---|---|---|
| Calls a real clash "not touching" | The duct is installed into the beam's flange; found on site, it is cut out, re-made and re-hung, and the trades behind it wait | `false_clear` | 5 |
| Approves a fix that does not work | A move that leaves the clash, or hits something new, goes onto the drawings and is installed | `approved_bad_fix` | 5 |
| Moves the element too little | The clash comes back at the next coordination round, or on site, with no clear gap for insulation and hangers | `too_small` | 3 |
| Moves the element into a third element | One clash is swapped for another | `hits_new_element` | 3 |
| Moves it the wrong way | The clash remains; another round of design | `wrong_direction` | 2 |
| Moves the wrong element (e.g. the beam) | A structural change is proposed for a services problem: engineer review, delay, or an unsafe cut | `wrong_element` | 2 |
| Picks an opening the service does not fit | The route cannot be installed, or is installed without the required clearance | J4 wrong | 1 |
| Misreads which element is above, between or through | Wrong instructions to the trades; a fix designed for the wrong geometry | J8/J9 wrong | 1 |
| Flags a near miss or a bracket as a clash | Coordinator time spent on a non-issue | `false_alarm` | 1 |
| Rejects a good fix | Another design round for nothing | `rejected_good_fix` | 1 |

The weights are illustrative, set by the team's judgement of relative cost; they are not measured costs. They feed
the cost-weighted score (section 9), never the plain accuracy.

## 2. The engineering workflow drives the benchmark

Every job is one question from Iris Engineering's own workflow (detect, triage, choose what moves, propose, verify,
review). Each job is scored under one of eight categories (`spec.CATEGORIES`, `spec.JOB_CATEGORY`):

| Workflow step | Engineering question | Job | Category | Status |
|---|---|---|---|---|
| Triage | Is there an actual geometric clash between these elements? | J1 `J1_sort` | clash identification | built |
| Choose what moves | Which element is movable under the given constraints? | J2 `J2_who_moves` | element selection | built (constraints via locked elements) |
| Propose | What movement would resolve this clash? | J3 `J3_fix` | movement estimation | built |
| Propose (route) | Which opening is suitable for routing this element? | J4 `J4_opening` | opening selection | built |
| Review | Does the proposed movement resolve the original clash? | J5 `J5_review` | resolution validity | built |
| Verify | Does the movement introduce new clashes? | J6 `J6_new_clash` | new clash detection | built |
| Choose a fix | Which of several proposed solutions is geometrically valid? | J7 `J7_pick_valid` | resolution validity | built |
| Read the scene | Spatial reasoning across several elements: which is highest, which lies between two others, their order | J8 `J8_spatial` | spatial reasoning | built |
| Read the scene | Relationships: passes through, crosses, parallel, supports, touches | J9 `J9_relation` | relationship understanding | built |

What each job asks and how its answer is graded (every reply also carries a `confidence` (0–1) and a short `reason`):

| Job | Asked (pictures mode) | Reply (strict JSON Schema) | Reference answer | Graded by |
|---|---|---|---|---|
| J1 | Is the pair labelled X and Y (a) a real clash, (b) not touching, (c) touching by design? (or, in its yes/no form, is it a real clash?) | `{"answer": "a"\|"b"\|"c"}` or `{"clash": true\|false}` | the planted kind | exact match |
| J2 | Which labelled element should move? (a padlock marks a locked element) | `{"mover_letter": X\|Y}` | the planted mover | exact match |
| J3 | One straight move: element, direction (up/down/north/south/east/west), distance in mm, opening letter or null | `{"element", "direction", "distance_mm", "via_opening"}` | none fixed: any move that passes | `checker.check_fix` on the proposed move |
| J4 | Which labelled openings can the element pass through with a clear gap all round? | `{"fitting": [letters]}` | openings the mover fits (size with 25 mm each side) | set equality |
| J5 | Before and after pictures of a proposed move: does it resolve the original clash? | `{"resolved": true\|false}` | `Resolution.resolves_original` (from `check_fix`) | verdict vs geometry |
| J6 | Before and after pictures of a proposed move: does it introduce a new clash? | `{"new_clash": true\|false}` | `Resolution.new_hits` (from `check_fix`) | verdict vs geometry |
| J7 | Several numbered candidate moves of one clash: which are geometrically valid? | `{"valid": [numbers]}` | `Resolution.valid` | set equality |
| J8 | Three or more labelled elements: which is highest, furthest north, between two others, or their order | `{"answer": letter}` or `{"order": [letters]}` | `geom.bbox` extents (items within 30 mm skipped as ambiguous) | exact match |
| J9 | The relationship between two labelled elements (crosses, parallel, passes through, supports, touches, ...), or whether one passes through an opening | `{"relation": word}` or `{"passes": true\|false}` | `scene.relations` (geometry) | exact match |

J3 has no single right answer: the reply is turned into a move (`jobs.reply_to_fix`) and the checker decides whether
that move works. A model is never marked wrong for finding a different valid fix.

## 3. Scene generation

`scenes.generate(seed, **knobs)` builds one ceiling void, deterministically per seed: one or two steel beams under a
slab, each with one to three rectangular web openings; services (ducts, pipes, cable trays) crossing the beams; an
optional column; and three planted pairs:

| Planted pair | What is true |
|---|---|
| `real` | A service dips 50–400 mm into the beam's bottom flange, directly under an opening it fits through with clearance. The known good fix raises it to the opening's centre. |
| `not_touching` | A service passes under a beam with a 5–40 mm gap (a near miss that looks like a clash). |
| `by_design` | A bracket touches a tray or pipe from below (contact that is not a clash). |

Every other element keeps at least 50 mm from everything. Geometry is built in whole millimetres, so planted distances
are exact, then written in metres (Z up). Each scene is written as `scene.json` and as `scene.ifc` (IFC4, one product
per element, openings as real `IfcOpeningElement` voids) with `ids.json` mapping scene ids to IFC GlobalIds, so Iris
Engineering can open, check and edit the same scene.

What `scene.json` stores (schema v2):

| Stored | Field | Status |
|---|---|---|
| Element ids and types | `elements[].id` (`e1`…, never shown to the model), `kind` (beam, column, slab, duct, pipe, tray, bracket), `role` (structure, service, support) | built |
| Dimensions and position | boxes: `min`/`max`; round runs: `start`/`end`/`radius` (axis-aligned along X or Y), metres | built |
| Openings | `elements[].openings[]`: id (`o1`…) and world box | built |
| Supports | `elements[].supports`: the element a bracket carries | built |
| Movement constraints | `role` (structure stays, services move) | built |
| Locked elements | `elements[].locked` (must not move; drawn with a lock badge), `allowed_moves` (permitted directions); `--locked-services N` | built |
| Clash states | `planted[]`: pair, kind, signed distance (negative = overlap depth, positive = gap), mover, good fix, fitting openings | built |
| Spatial relationships | `relations[]`: `Relation(a, b, relation, value_m, via)`: above, below, north_of … west_of, crosses, parallel, passes_through, supports, touches, clashes, clear_of, each with the measured quantity behind it | built |
| Valid and invalid resolutions | `resolutions[]`: `Resolution(pair, label, fix, valid, resolves_original, new_hits, evidence)`: the good fix and labelled bad ones (too small, wrong direction, hits a third element, wrong element), each with the full `check_fix` result as evidence | built (a pair without any falls back to `jobs.candidate_fixes`) |
| Cameras | `cameras[]`: `Camera(name, azimuth_deg, elevation_deg, distance_factor, projection)`: A, B, C, top, section | built |
| Challenge settings | `challenge`: the knobs used (section 10), target pair, occluder, decoy and distractor ids | built |
| Required clearance | `clearance_m` = 0.025 | built |

## 4. Rendering

`render.py` sends jobs to `bench/render/render.mjs`, which draws the scene with three.js in headless Chromium
(SwiftShader): the same job gives the same bytes on the same machine. Pictures are 1024 x 1024 PNG.

| View | Content | Status |
|---|---|---|
| A | The focus pair only, 40% see-through, on a 0.5 m floor grid, camera outside both at a seeded angle | built |
| B | The pair solid, with grey context within 2.5 m at 85% transparency, same camera | built |
| C | As A, turned 90° around | built |
| before / after (`before_A`, `after_A`, `_C`) | A candidate move: the same camera, letters and colours before and after the element is translated, faint context | built |
| top | Plan view, orthographic (`Camera(projection="orthographic")`) | built |
| section | An orthographic elevation looking along the target beam | built |
| candidates | Several proposed moves of one clash, each a numbered picture (`cand_1` …) plus a contact sheet (`cand_grid`), for J7 | built |

Annotations on every picture:

- **Letters.** Focus elements get A, B, C … in a seeded order; openings get P, Q, R …. The scene id never appears.
- **Colours.** Distinct, well separated hues from a seeded palette; context is grey.
- **Scale bar** at the pair's depth (a round length between 50 mm and 10 m), so sizes and gaps can be judged from the
  picture alone.
- **Compass** (N = +Y, E = +X, up = +Z as the camera sees them).
- **Lock badge** on locked elements: hatched with dashed edges, a padlock on the letter tag, and a "fixed" legend.
- **Object-ID pass.** A second, flat-coloured image per view gives each element's visible pixel count
  (`View.visible_px`), the evidence that the element is actually in the picture.
- **Styles:** shaded (default), hidden-line, X-ray.

## 5. Visual-only rules

In `pictures` mode the image must carry the evidence and the prompt must not:

- No element names or types (beam, duct, pipe, tray, column, slab, bracket), no dimensions, no distances, no
  coordinates, no scene ids. `test_pictures_prompts_clean` fails the build if a prompt contains any of those words, a
  number with a unit, or an id.
- Neutral letters: which element is A is seeded per scene, and which letter of a pair is named first is random. J1's
  options are a/b/c; J2's schema offers only the two letters of the pair.
- The only conventions stated in words are the direction words (north = +Y, east = +X, up = +Z) and the required clear
  gap's existence (not its size).
- Every prompt ends "Answer with JSON only." and every reply is validated against the item's JSON Schema before
  grading; an off-schema reply is ungradable, not silently repaired.
- `pictures_text` is a separate comparison mode that appends measured facts (types, roles, signed distance, required
  clearance, opening sizes). It is a control, never the headline.

## 6. Ground truth

**Closed-form geometry, never a model.** `geom.py` measures elements exactly: box to box, box to cylinder and parallel
cylinders are exact; a beam with openings is split into solid sub-boxes so a duct through an opening is measured
against the web around it, not the void; penetration depth is the least axis-aligned move that separates the two (as
Iris Engineering's detection reports it). Perpendicular cylinders are measured conservatively (never reported farther
apart than they are).

**The checker.** `checker.check_fix(scene, fix)` applies a move and passes it only when: the mover is not structure,
the planted clash is gone, the moved element keeps at least 25 mm from every other element (brackets carrying it are
ignored), nothing new is hit, and a named opening is really the one it passes through. It returns the evidence:
`clash_gone`, `min_clear_m`, `new_hits`, `via_opening`, `reason`.

**Cross-check against Iris's engine.** `checker.crosscheck_engine` opens `scene.ifc` in Iris Engineering's own engine
(IfcOpenShell triangulation, `detect.measure_pair`, `verify.check`) and compares every planted pair and every good fix
with `geom.py`: within 2 mm for uncut boxes, 10 mm where a cylinder or cut beam is triangulated. Two independent
computations of the same answer.

**The model never generates its own ground truth.** Reference answers are fixed when the scene is generated, before
any model call. `Item.truth` is stored beside the prompt and never sent. The model under test (Gemini) plays no part
in generating scenes, labelling them or grading them.

**Integrity checks.**

| Check | Where | Status |
|---|---|---|
| Same seed, same scene; scene round-trips through JSON | `test_scenes.py` | built |
| Planted distances equal the closed-form figure; nothing else is within 50 mm | generator + `test_scenes.py` | built |
| The good fix is clear and goes through its opening (the generator refuses a scene where it is not) | `scenes.generate`, `test_scenes.py` | built |
| Iris's engine agrees: overlap within 2 mm, near miss not a clash, good fix passes `verify.check` | `test_iris_engine_agrees` | built |
| Same job, same image bytes; another seed differs | `test_render.py` | built |
| Prompts clean; expected replies valid against their schemas | `test_jobs.py` | built |
| Swapped controls only use pictures whose truth differs | `controls.swapped` | built |
| Visible-pixel counts recorded per element per view | `View.visible_px`, `Item.meta` | built |
| `iris-bench verify`: truth frozen before any model call, truth code isolated, prompts clean, a job-stratified sample of truths re-derived by geometry (`--sample`), every answer letter labelled in the item's own pictures (`letters_shown`), answer balance | `integrity.check_run` | built |
| `iris-bench verify`: engine cross-check over a whole run, drop items whose decisive element is below a visible-pixel threshold | CLI | in progress |
| `Item.evidence`: how each reference answer was established (the numbers and checks behind it) | jobs | built |

## 7. Controls

A score only means the model "sees" if it drops when the picture is taken away or wrong. Each `pictures` item gets
paired copies (same question, same truth):

| Control | What changes | What it tells us | Status |
|---|---|---|---|
| `no_image` | No pictures at all | What can be answered from the text and priors alone; a job that scores the same without the picture is not testing vision | built |
| `swapped` | Pictures from another scene whose truth differs | A model that still gives this item's truth is not reading the pictures | built |
| `pictures_text` | Measured facts appended to the prompt | How much of the gap is perception rather than reasoning | built |
| counterfactual | The same scene with one geometric change that flips the answer (the mover lowered out of the clash, an opening shrunk below the service, the other element locked), re-rendered with truth recomputed | A model that sees should flip its answer with the geometry | in progress |

Scoring reports each control as a paired delta (control minus pictures, same base item) with a bootstrap 95% CI.

## 8. Running a model

`runner.run` calls Gemini directly through `google-genai` (`generate_content`, the client from Iris's
`model_client.make_client`: Vertex AI or the Gemini API) with one fixed rule for every model, from
Google's Vertex AI guidance (checked Nov 22, 2026 with small live probes; notes kept outside this repo): an `Image k:` text part before
each picture and the question last; `media_resolution` HIGH; a JSON reply under the item's JSON Schema
(`response_json_schema`); thinking at Google's default level (Flash-Lite LOW), or a level named with `--thinking`, which
runs under the label `<model>@<level>`; no temperature, top_p, penalties or output cap. Only transport errors (429,
5xx, timeouts) are retried; a reply that is not JSON is a failed answer (its finish reason, e.g. MAX_TOKENS, is kept).
Replies are cached by model label, item id and a hash of prompt, schema and images, so a rerun makes no new calls;
each cached row keeps the model version, finish reason and tokens, and `run` records the settings, counts and cost under
`model_runs` in `manifest.json`. `--max-usd` stops starting calls once a run's new spend reaches it. `fake:<p>` is an
offline stand-in (right with probability p) for testing the pipeline; its reports carry a FAKE MODEL banner.
`runner.write_batch_jsonl` writes the same requests as Vertex AI batch prediction lines.

## 9. Scoring

**Per item.** J1, J2, J4, J8 and J9 compare with the truth exactly, J7 as a set. J3 goes through the geometry checker; J5 and J6
are compared with the checker's verdict on the move shown. An unparseable
or off-schema reply counts as wrong (`unparseable`); a checker failure is reported as `ungraded`, never charged.

**Per run** (`score.py`, written to `scores.csv` / `scores.jsonl`):

| Table | What it holds | Status |
|---|---|---|
| accuracy | model x job x mode, with a seeded bootstrap 95% CI | built |
| category | accuracy for each of the eight categories (`JOB_CATEGORY`), per mode | built |
| partial | J3 partial credit: direction right; distance within ±max(25 mm, 15%) of the smallest move that passes (found by bisection on the checker); right opening | built |
| taxonomy | error counts per job and error type (section 1) | built |
| cost | cost-weighted score = 1 − total weight / (items x max weight) | built |
| slice | accuracy per challenge factor bucket (section 10) | built |
| control | paired deltas for no_image, swapped, pictures_text | built |
| calibration | replies carry a confidence (0–1); reliability by confidence bin; share of **confidently wrong** answers (wrong at high confidence, the dangerous kind for a coordinator); ECE, Brier | built |
| plausible-but-wrong | answers a reviewer would accept at a glance (right element, right direction, a real opening, a sensible distance, or approving a fix that looks fine) that fail the geometry check; in the report, wrong answers whose reason names the right elements or opening | built |

The last two rows measure the gap this benchmark exists to expose: **an answer that sounds reasonable versus one that
is geometrically correct.** Only the second survives the checker.

## 10. Visual-challenge axes

Knobs on `scenes.generate` (passed as `--challenge key=value`) and the renderer vary what the model must see, not
just how many things there are. Scoring slices accuracy by each.

| Axis | Knob | What varies | Slice |
|---|---|---|---|
| Clutter | `density` 0–20 | Distractor services crossing or running beside the beams | `density` |
| Look-alikes | `decoys` | Services of the mover's kind and size, parallel, not clashing | via `density`/report |
| Near-miss subtlety | `gap_mm` 1–100 | How small the near miss's gap is | `gap_mm` |
| Clash depth | `overlap_mm` 10–500 | How deep the real clash is | `overlap_mm` |
| Occlusion | `occlusion` | A large duct beside the real clash, in front from some angles | `occlusion` |
| Evidence | (measured) | Visible pixels of the decisive element | `visible_px` |
| Layout | `beams` 1–2, `column`, `orient` x/y | Number of beams and openings, a column, rotation in plan | |
| Viewpoint | seeded camera; `view` | Azimuth and elevation per seed; A/B/C; top and section | `view` |
| Render style | `style` | Shaded, hidden-line, X-ray | `style` |
| Constraints | `locked`, `allowed_moves` (`--locked-services`) | Which element may move, shown only by a badge | |
| Relationship type | J8/J9 | Above/below, between, order, crosses, parallel, passes through, supports, touches | |

## 11. Limitations

- **Simplified geometry.** Axis-aligned boxes and straight round runs only: no fittings, bends, slopes, insulation or
  hangers; one ceiling void with one or two beams. Real coordination models are messier.
- **One kind of fix.** J3 scores a single straight move. Iris Engineering also offsets with bends, reroutes, trims and
  resizes; those are not benchmarked yet.
- **Synthetic look.** Clean renders, not exports of production models or site photos, so results say how a model reads
  coordination renders, not the field.
- **Direction words.** North and east are given as a convention and drawn as a compass in every picture; the planted
  good fixes are vertical, so J3 rarely depends on it, but J8's north questions do.
- **Who moves is often a prior.** With structure vs service as the only constraint, J2 can be answered from what a
  beam looks like; locked elements (`--locked-services`, a padlock in the picture) make it a question about the
  picture.
- **Tolerances.** The engine cross-check allows 10 mm where a cylinder or cut beam is triangulated; perpendicular round
  runs are measured conservatively.
- **Determinism is per machine.** SwiftShader gives identical bytes for the same job on the same machine, not
  necessarily across machines; the scenes and truths are identical everywhere.
- **Small runs, wide intervals.** Every accuracy carries a bootstrap CI; we make no claim where intervals overlap.
- **Cost weights are judgement,** not measured site costs.
- **One small run so far.** The committed sample ([bench/sample-run/](../bench/sample-run/README.md)) is one model,
  `gemini-3.8-flash`, on 7 seeds: 58% [47%, 67%] over 95 pictures items, with 7 to 11 items per job, so the per-job
  intervals are wide. Larger runs and more models are future work.

## 12. How this maps to the judging criteria

| Criterion (weight) | What the jury looks for | Where VisionBench answers it |
|---|---|---|
| Working implementation and repeatability (25%) | Pipeline runs end to end, reusable beyond one example | One CLI, `iris-bench all --seeds 0:N`: any number of seeded scenes; parallel workers; reply cache; offline fake model; Vertex batch lines; bench tests in `server/tests/bench/` |
| Validity and validation evidence (25%) | Questions need vision; the image holds the evidence; answers verified independently of the model | Visual-only prompts enforced by a test; scale bar and visible-pixel evidence; truth from closed-form geometry, cross-checked by Iris's engine; no-image and swapped controls; `verify` (truth frozen, re-derived, letters shown) |
| Meaningful variation (20%) | Tasks vary relationships and reasoning, not just counts | Nine jobs in eight categories, from clash identification to resolution validity; three clash states; openings, constraints, multi-element relations; challenge axes in section 10 |
| Original approach and engineering judgement (15%) | Design choices, scope, resource use, honest limits, quality of findings | Questions taken from a working product's workflow; the grader is the same geometry that verifies fixes in Iris Engineering; J3 graded by outcome, not by matching one answer; partial credit, cost-weighted errors, slices; section 11 |
| Practical impact and communication (15%) | Application, why errors matter, scoring separates right from wrong, clear demo | MEP coordination and the error-to-site table (section 1); `report.html` shows right and wrong answers side by side with the checker's reason |

## 13. Code map

| File | Role |
|---|---|
| `server/iris_bench/spec.py` | The shared contract: Scene, Element, Opening, Planted, Fix, Relation, Resolution, Camera, View, Item, Result; jobs, categories, modes |
| `server/iris_bench/scenes.py` | Seeded scene generator and its knobs |
| `server/iris_bench/ifc_writer.py` | `scene.ifc` (IFC4) and `ids.json` |
| `server/iris_bench/geom.py` | Closed-form distances, penetration, moves, openings |
| `server/iris_bench/checker.py` | `check_fix`, per-job checks, `crosscheck_engine` |
| `server/iris_bench/render.py`, `bench/render/` | Headless three.js renderer: views, letters, scale bar, object-ID pass |
| `server/iris_bench/truth.py` | Relations, candidate resolutions and cameras (`annotate`), from geometry and the checker |
| `server/iris_bench/jobs.py` | Items per job (J1–J9), prompts, JSON Schemas, candidates, J1 balancing |
| `server/iris_bench/controls.py` | no_image and swapped copies; counterfactual pairing |
| `server/iris_bench/integrity.py` | `iris-bench verify`: truth frozen, truth code isolated, prompts clean, truths re-derived, answer balance |
| `server/iris_bench/runner.py` | Gemini or fake model, reply cache, grading hook, Vertex batch lines |
| `server/iris_bench/score.py` | Grading with the checker, all score tables |
| `server/iris_bench/report.py` | `report.md` and `report.html` |
| `server/iris_bench/cli.py` | `iris-bench` commands |
| `server/tests/bench/` | Scene, geometry and engine, job, renderer and scoring tests |
