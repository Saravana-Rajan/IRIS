# Show it built

**Status:** built (below: "What was built"). The S0 spike shaped the design that follows; where the two differ, "What
was built" says what the code does. Re-branded to Gemini on Vertex AI on 2026-11-11: the picture model is now the
Gemini image model and the judges the escalation model. Image-model capabilities, judge accuracy, latency and costs are
to be re-measured on Gemini; no measured result from the earlier models is kept here.

A button on a fix that turns Iris's own view of it into a realistic picture of what will be built, for people who
don't read BIM views: clients and site teams. The Gemini image model (`GEMINI_IMAGE_MODEL`) draws it. The picture must
keep to the model's context: same elements, same places, same shapes. That is the whole job, and the reason for the
checks below.

## Rules

1. **No geometry, no picture.** Only for a fix that exists as geometry: a verified option, an accepted fix, or a
   verified option that needs approval. Never for a recommendation or advice.
2. **The image model restyles Iris's view; it never designs.** Where anything goes comes from the model.
3. **Every picture is checked against the model before anyone sees it.** A picture that fails is never shown.
4. **The model's own view stays beside it,** and the picture is labelled "Illustration by Gemini Image from Iris's model view. The
   model is the record." What the view leaves out is said too ("ceiling and slab above cut away").
5. **Never the BCF snapshot and never in the export.** The BCF viewpoint keeps the true capture
   (`document.py` takes `after_img`).

Decided (owner): the fix after only (Iris's own before and after views are already there); a clean presentation render,
not a site photo; a switch in the owner menu at the top right, For me and For everyone; two
escalation-model judges per picture, not one (a false accept misleads, a false reject only costs a retry); the open tray
bend is fixed in the model, not the prompt (below); the PDF gets a built view for every accepted fix automatically
(below).

Why restyle only: asked to draw a fix itself, an image model redraws the geometry and invents numbers. Restyling Iris's
own render keeps the layout, so keeping to the model comes from the inputs, the prompt and the check. What the Gemini
image model can and can't do here is to be re-measured.

## S0: restyling Iris's own views

Code: `spikes/built/` (`fixes.py`, `capture.cjs`, `s0.py`) and the capture page `web/spikes/built.ts`, which drives
Iris's real `Viewer`. Pictures and scores stay out of git (`OUT_DIR`).

**Cases:** six proposed, verified and accepted fixes: Northbank's duct, tray and cold-water offsets through the girder
(+400, +250, +280 mm: Rev04's heights), the Clash7 transom trim, and on the cell the CT-301 ladder offset over post W5
and the PL-301 air-pipe offset under the conveyor rail.

### The view

- **A fix in a ceiling void can't be seen in a solid model.** With the context solid, Northbank's duct showed 0% from
  every one of 12 directions, the cold-water main 13% and the tray 36%: slab above, ceiling below, walls around.
- **So the view is a cutaway, chosen by the page.** Of 12 directions (above, low, below × four quarters), the one that
  shows the most of the changed pieces for the least taken away. Each step takes away the element hiding the most of
  the fix for what it costs: ceilings, lights, grilles, furniture, slabs and glazing cost 1, walls 2, services,
  structure and machine parts 6; never the pair or what the fix passes through. A slab, roof or ceiling taken away
  above the fix becomes the section's top (its underside), one below its bottom, so the floor above and its furniture
  go with it, cleanly cut. Looking up costs a little more than looking down.
- **Frame the change, not the run:** an offset's first and last pieces are the rest of the run (metres), so the view
  frames the pieces between, as the agent checks `pieces[1:-1]`. Framing the pair's boxes made the girder fixes a
  speck.
- **Zones aren't built:** see-through elements under 0.2 opacity (a robot's restricted space, a door's working space)
  are hidden; glazing and mesh guards (0.3–0.5) stay.
- Result: 61–98% of each fix in view, with at most one element taken away beyond the section.

### The pictures

Two images per call: the **look** (true colours, solid, everything within 3 m, the cutaway) and the **lines**
(element boundaries and creases from the ids and normals passes, black on white). The design choices, to be
re-checked on the Gemini image model:

- The look alone invites invented objects (supports, panels, plinths); the lines beside it hold the layout.
- Telling the image model what things are ("a ceiling void", names) invites it to add what such places usually have,
  so the prompt names nothing and lets it read the materials from the look.
- The prompt avoids "cut" wording, keeps the background and asks for no extra pipes, rods or hangers.
- **Weak spot: see-through parts** (mesh guards drawn semi-transparent in the look) can be dropped or shrunk. To try:
  draw physical see-through parts more opaque in the look.

### The check

1. **Pixels (instant):** edges of the picture against edges of Iris's own render, at 256 px after a blur (so concrete
   and galvanising texture drops out): F-score ≥ 0.55, and no tile of an 8 × 8 grid more than 45% covered by edges
   that are near neither the render's nor the model's lines (an added object). The thresholds are to be re-validated
   on the Gemini image model's pictures.
2. **A judge:** image 1 the look, image 2 the picture, image 3 the **ids picture** (`s0.ids_picture`: each element its
   own flat colour, background white), so the judge reads the model view correctly (side-by-side openings, for
   example, rather than one wide slot); list the objects in image 1, then go over image 2 region by region and record
   anything added, removed, moved, reshaped or resized, with a size; verdict faithful, minor differences or unfaithful,
   and unfaithful fails the picture (`s0.JUDGE_SYSTEM`).

**Which judge** (an earlier judge comparison). A false reject costs a
retry or, at worst, no picture (the true view still shows); a false accept puts a wrong picture beside the model. So
the judge is **the escalation model (`GEMINI_ESCALATION_MODEL`), medium thinking, with the ids picture as image 3, two
calls in parallel, either unfaithful fails** (owner decision). How well that catches shape changes on Gemini is to be
re-measured with `judges.py` on the labelled set (known-bad pictures and faithful restyles).

**The open tray bend is the model's mismatch, not the picture's.** Northbank's cable tray is an `IfcUShapeProfileDef`
(300 × 100 mm, 4 mm walls), an open channel, but `edits._bend_mesh` builds every bend as a closed rectangle (or
circle), so Iris's offset puts closed boxes between open channels. An image model draws the tray open all the way, as
a real one is, and a prompt line ("keep each object's cross-section as it is drawn: closed shapes stay closed and open
channels stay open, bends and fittings included", `s0.SHAPES`, variant `closed`) didn't change that. So the prompt
stays as it was, and the bends are to follow the segment's profile (an ask of the edits work, `docs/escalation.md`);
then the picture and the model agree.

**Not run:** radius 2 and 5 m (3 m throughout); a penetration (needs the edits work); judges at high thinking. The
capture took up to 77 s in headless Chromium on software GL, mostly fetching classes one by one; in the app the
classes come with the scene and the GPU draws the passes.

## Design after S0

### Capture (browser)

`Viewer.captureBuilt(fix)` in one task, the view put back (like `posed`): the cutaway viewpoint above, then the look
(1024 px), ids, normals and the fix's own pieces; the server colours the ids pass for the judge
(`s0.ids_picture`). Classes for the cut costs come from the server with the scene
(`describe` today is one call per element). The page sends look, lines (or ids and normals, and the server draws the
lines), the legend and what was taken away.

### Generate and check (server)

- `server/iris/built.py`: two pictures at once from the Gemini image model, so one usually passes without a second
  round; each through the pixel gate, then two escalation-model judges (medium, look + picture + ids picture), all four
  calls in parallel. The first picture both judges pass is shown; with none, one more pair with the judges'
  differences in the prompt ("don't drop the mesh guard panels on the right"), then "The image model couldn't keep to
  the model here" and the true view only.
- The panel streams the stages. Time and cost per click are to be measured on Gemini; prices come from
  `IRIS_MODEL_PRICES`.
- **Who gets it:** a switch in the owner menu at the top right (`settings.py` `built_views`, For me and For everyone;
  env `IRIS_BUILT_VIEWS`, default off). Off for everyone, the button isn't shown to
  visitors; the owner can keep it on for themselves. Built views share the escalation's daily spend limit
  (`IRIS_ESCALATION_MAX_USD_DAY`, `docs/escalation.md`), and the caps apply to visitors. Over the limit: three judges on the
  fast model (`GEMINI_FAST_MODEL`, low thinking; `built.main_judge_model`, `MAIN_JUDGES`), any of the three failing it,
  with the label saying the check was the lighter one. Cached by a hash
  of the look, lines and prompt version, so the PDF, replays and the tour reuse a picture.
- Not offered for trims and cleanups: a 30 mm cut-back is invisible at the scale of the view (the transom).

### API and UI

- `POST /api/scenes/{sid}/built/stream` (NDJSON through `_ndjson`): `{look, lines | ids + normals, fix_mask, legend,
  cut, fix: {kind, moved, edit}, report_id?, clash_id?}`. Events: drawing, gate `{f, tile}`, judging `{verdicts}`,
  retry `{why}`, done `{image_url, scores, cut}`, failed `{why}`. Caps `IRIS_BUILT_PER_HOUR` / `_PER_DAY`; the
  owner has none.
- **Clash panel** (an option, or an accepted fix): **Show it built** → the picture beside Iris's view, with a wipe
  dragged on the picture itself, and a "Lines from the model" overlay, so anyone can see it matches; what was cut away,
  and the check's verdicts behind a "Checked against the model" chip. `web/src/BuiltView.tsx`.
- **PDF, automatically for accepted fixes** (owner decision): on the fix page, beside "The model as it is" and "With
  the fix", a third picture "As it could look built (illustration)"; the report's evidence gains `built_img`. Only
  while the switch is on for that visitor; off, the PDF is as today.
  - **At accept** (a single fix, a plan's fixes, a replayed tour fix), the page starts Show it built for each fix in
    the background, from the same moment it captures the before and after views. The page keeps each accepted fix's
    pieces with its evidence, so the cutaway can be framed again later.
  - **At report time**, an accepted fix still without one (accepted before the switch went on, or capped at the
    time) gets one then, in parallel, at most 10 per report; the report stream says "Drawing n built views" and waits
    for those and for any still drawing from an accept.
  - A fix whose pictures all fail the check keeps its true views only, with the line "No built view: the image model
    couldn't keep to the model here".
  - Proposed options that were not accepted get one only if someone pressed Show it built on them.
  - Each costs what a click does and counts against the visitor's caps (none for the owner). The BCF snapshot stays
    the true capture.
- Plan panel, per fix. Chat: `show_it_built`. MCP later. The phone's Fix sheet.

## Plan

Branch `feature/show-it-built`, one PR.

1. `Viewer.captureBuilt` from `web/spikes/built.ts` (cutaway, zones, framing), classes with the scene.
2. `built.py` (prompt, image call, pixel gate, judges, retry, cache), the endpoint, caps. Tests: the gate rejects
   synthetic bad pictures (an object pasted in, one moved, another scene) and passes the look against itself; the
   judge rule with a scripted model; never offered without geometry or for a trim; the BCF snapshot stays the true
   capture; caps; cache.
3. UI in the clash panel and the plan panel; the phone's Fix sheet.
4. The PDF's third picture: built at accept in the background, missing ones at report time (at most 10, in
   parallel), the true views alone when a fix's pictures fail.
5. Chat tool; a tour step only as a recorded run.
6. Runtime check in the browser on Northbank and the cell, then on the Cloud Run service. README picture only from a
   real run.

## What was built

- **Capture** (`Viewer.captureBuilt`, one task, the view put back): the cutaway of S0 (12 directions, costs by class
  from `GET /api/scenes/{sid}/classes`, slabs/roofs/coverings above or below become the section, zones never drawn),
  then three square passes from one camera: the look, ids (index + 1 in 24 bits, unlit, the batches' materials swapped,
  a proposed fix's pieces their own ids) and view-space normals. A proposed option draws its pieces in their elements'
  colours with the originals hidden; a kept fix is the model itself.
- **Server** (`server/iris/built.py`): the outline from ids and normals, two restyles at once on the Gemini image model
  (`GEMINI_IMAGE_MODEL`, `PROMPT`), the pixel gate (coarse edges F ≥ 0.55, no 8 × 8 tile over 0.45 new edges), two
  escalation-model judges per picture that passes (look, picture, ids picture; either unfaithful fails it), one more
  pair told what the judges found, then "The image model couldn't keep to the model here". Kept in a cache by a hash of
  the passes and the prompt's version (`IRIS_BUILT_CACHE`), served at `/api/built/<key>.jpg` and `<key>-lines.png`.
- **Money:** `built.ESTIMATE_USD` (two rounds: pictures at `IMAGE_USD` each, from `IRIS_IMAGE_USD`, default 0.04,
  plus the escalation judges at `JUDGE_USD`) is held against the day's escalation budget
  (`IRIS_ESCALATION_MAX_USD_DAY`) while a picture is made (`spend.held`). When the budget can't cover that but can cover
  `LIGHTER_ESTIMATE_USD` (the pictures plus `MAIN_JUDGES`, three, fast-model judges at `LIGHT_JUDGE_USD` each), the
  lighter check runs instead: `built.main_judge_model`, the fast model (`GEMINI_FAST_MODEL`) at low thinking. The
  picture's tooltip names the judge (`judge_label()` or `main_judge_label()`). Each picture returned is charged
  `IMAGE_USD` and each judge its tokens. Caps `IRIS_BUILT_PER_HOUR` / `_PER_DAY`; a cached picture costs nothing; the
  owner is exempt.
- **Who gets it:** `built_views` in the owner menu, For me and For everyone (`IRIS_BUILT_VIEWS`, default off);
  `GET /api/models` tells the page. Off, nothing is shown and nothing is drawn. Never for a trim or a cleanup.
- **API:** `POST /api/scenes/{sid}/built/stream` `{look, ids, normals, fix_kind}` → NDJSON drawing, gate, judging,
  judged, retry, then the result (`status` done with `image_url`, `lines_url`, `gate`, `verdicts`, `judge`; or failed
  with `why`). 403 when off, 422 for a trim or a bad picture, 429 for the caps or the budget.
- **Page** (`web/src/BuiltView.tsx`): **Show it built** on the chosen option and on each verified fix in the Plan
  panel; while it works the stage in words; then the picture over Iris's view, the illustration left of the wipe and
  Iris's view right of it, each side named and its name cut at the wipe with it. The picture is the control (owner
  request): a press or drag on it moves the wipe (a finger only once it moves, and a swipe the browser takes as a
  scroll puts it back; `touch-action: pan-y`), a handle on the wipe says so, the focused picture takes the arrow, Page
  and Home/End keys (`role="slider"`), and it starts at half and half. Under it **Lines from the model** and a
  "Checked against the model" chip with the outline match and the judges' verdicts in its tip, then the label
  "Illustration by Gemini Image from Iris's model view. The model is the record." and what the cutaway took away. A failed picture says
  so and keeps Iris's views.
- **Accept, automatically:** a single fix, a plan's fixes and a replayed tour fix are captured as proposed before they
  are kept, and drawn in the background (an option's picture already made is reused). The clash panel shows the kept
  fix's picture under "As it could look built", or a button to draw it.
- **PDF:** the report dialog first waits for the pictures still drawing and draws those of kept fixes that have none
  (at most 10 at once: switched on later, or capped then); the fix page shows a third picture "As it could look built
  (illustration from Iris's view; the model is the record)", or "No built view: …". The BCF keeps the true capture.
- **Chat:** `show_it_built(clash_id)`: the page draws the chosen option of that clash, else its kept fix (else it
  says there is nothing to draw yet). MCP: later.
- **Once, and keyed on the fix:** the page keys a picture on the pair and the fix itself (kind, numbers, edit), never
  its title alone, and shares one being drawn (Show it built, then Accept within the minute, is one request); the server
  makes a picture once per key at a time (a second ask waits and costs nothing) and writes its cache files whole. A
  picture checked the lighter way is drawn again and checked by the escalation model when a later request can pay for
  it. Kept fixes are recorded even while the switch is off, so a report after it goes on can draw them.
- **What a picture shows:** a split run is framed on its new middle, a penetration on its opening (its provision for
  void is not drawn, so the opening stays open), a combined fix on its new middles and the moved runs near the clash,
  each piece in its own run's colour; anything the server lists as not physical (spaces, provisions) is left out.
  When a report draws a kept fix again, pieces it cannot find by id are framed by the elements the fix changed.
  Pieces are drawn with creased normals (sharp edges stay sharp): averaged normals shade a cut wall in streaks that an
  image model draws as facets and judges reject.
- **Money:** a request claims its estimate when it is let through (`spend.claim`: checked and held in one step) and
  its work takes the claim over (`spend.held`), so two requests on a nearly spent day cannot both pass.
- **Limits:** each pass at most 12 M characters, refused from its header when not square 256-2048 px (before any pixel
  is decoded); the judges' thinking level is their own (medium for the escalation judges, low for the lighter check's), whatever the thinking-level settings say.
- **Tests:** `tests/test_built.py` (passes and key, the gate against restyles and invented objects, two judges and the
  cache, a judge's finding sent back then failing, the gate stopping a picture before the judges, the API's switch,
  kinds, caps and the lighter check, the PDF reading a picture only by its URL).

## Open questions

1. Re-run the judge comparison on the Gemini image model and the escalation-model judges; record
   accuracy, time and cost here.
