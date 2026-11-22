# Review queue: prepared fixes, one clash at a time

**AI proposes. Geometry proves. The engineer decides.** The owner asked: "It needs human review for each clash. Can
it make a fix and show a before vs after view in the same place, automatically?" The review queue does that: after a
coordination check, **Prepare fixes** runs Iris's own fix agent on the clashes that need a fix, in the background, a
few at a time; the reviewer then walks a queue, one clash per screen, with the verified fix on the left and the 3D
before/after on the right. Nothing is kept until the reviewer presses **Accept**, and Accept goes through the same
keep route as everywhere else (`plans.apply`: tried again on the server first).

## What it reuses

| Piece | Reused from |
|---|---|
| Which pairs a clash list means; one item per distinct physical pair | `plans.pairs_for` (Fix together) |
| The fix loop: agent → geometry verify → retry with the reason → rank | `agent.resolve` through `plans._resolve_items` (`PLAN_WORKERS` 4 at a time, `PLAN_ROUNDS` 2), each result remembered for a second try (`Workspace._remember`) |
| "No verified fix found: why" | `plans.failure_summary` (the item's `error`) |
| Caps | one proposal per clash pair prepared live (`propose_limit.take_many`, all or nothing, before the stream); at most `plans.MAX_ITEMS` (8) per run |
| Before / After / Both | `Viewer.showOption(..., "before" \| "after" \| "both")`: the fix solid in its new place, what it changes ghosted in its old one |
| Accept | `POST /api/scenes/{scene_id}/fix/apply` → `plans.apply` → `plans.recheck` (409 `NotVerified` with why) |
| Reject, Request another | `POST /api/scenes/{scene_id}/decisions` (`rejected` with the reason, `requested_another`), then a fresh `propose/stream` for "Request another" |
| Activity | the journal's decisions (`GET .../edits`), which Activity already shows |

## Server: `POST /api/scenes/{scene_id}/prepare/stream`

`server/iris/prepare.py` (`run`, `deepest`, the saved sets) and the route in `app.py` (`prepare_stream`).

Body `PrepareRequest`:

| Field | Meaning |
|---|---|
| `report_id` | the clash list (Iris's checks or an imported report) |
| `clash_ids` | the clashes to prepare (the ticked ones, or the ones triage marked real) |
| `pick` | `"ids"` (default: `clash_ids`) or `"deepest"`: the server picks the deepest open hard clashes with both sides physical (`prepare.deepest`), for a list with no triage and nothing ticked |
| `fixed` | clash ids already fixed or reviewed: never picked (with `"ids"` they are dropped from `clash_ids`) |

`prepare.deepest`: hard clashes (`test_type` hard) overlapping (distance < 0), not in `fixed`, matched in the open
model and physical (`plans.pairs_for`); clashes between different models before clashes within one, deepest first; at
most `plans.MAX_ITEMS` distinct pairs. A pair reported by several clashes gives all of their ids (one card).

One card per distinct physical pair: pairs are never merged (`plans.pairs_for(..., merge=False)`, unlike Fix
together), at most `plans.MAX_ITEMS` per run, and no item is told about the others (no shared notes).

Refusals before the stream: 404 scene, report or an unknown clash id; 422 "Nothing to prepare."; 429 the proposal cap
(`propose_limit.take_many(who, n_live)`: one per pair prepared live, all or none; a pair replayed from a saved file is
free; the owner has no caps).

Events (NDJSON through `app._ndjson`, `Content-Encoding: identity`), in this order: `prepare_start`; then, saved pairs
first and live pairs after, each pair's `item` events, its last `item` (`status` done) immediately followed by its
`prepared`; then `done`.

| Type | Fields | When |
|---|---|---|
| `prepare_start` | `total`, `items` (`[{key, clash_ids, element_a, element_b, label, distance_m, saved}]`), `skipped` (why some clashes cannot be prepared, as words), `saved` (`{label, model, made, title}` of the saved file in use, or null) | first |
| `item` | as Fix together's `item`: `key`, `status` thinking / checking (`attempt`, `passed`, `seconds`?, `checked`?, `reason`?) / done (`ok`, `title`: the best option's title, or why not) | while an item is worked on |
| `prepared` | `key`, `clash_ids`, `element_a`, `element_b`, `label`, `distance_m`, `status` (`ready` or `failed`), `source` (`live` or `saved`), `options` (every one verified by geometry in this run, best first, each an `agent.Option` with `pair`, `others`, `before`, `preview`, `placements`, `min_clearance_m`, `checked_against`, `model`), `understanding`, `why` (failed only), `tried`, `model` (who proposed: "Gemini Pro", or the saved file's model), `recommended`, `done` (how many have finished, this one included), `total` | each item as it finishes |
| `done` | `ready`, `failed`, `total`, `seconds` | last |
| `error` | `detail` | the run failed |

`ready` means at least one option passed the geometry check of its kind in this run; `failed` carries the honest why
(`plans.failure_summary`, a recommendation when the requirements allow no edit, or, for a saved pair whose question
the file does not hold, `prepare.MISS`: "The saved AI proposals do not cover this clash as Iris asks about it now, so no
fix was prepared: request another to ask the model live.").

`saved.title` is the sentence to show: "Saved AI proposals for this sample (Gemini Pro, 2026-11-22)".

## Saved results for the unedited sample

A saved file replays the AI's replies, never the geometry's results: every saved reply goes back through
`agent.resolve` (`plans._resolve_items` with `model=prepare.ReplayModel(saved)`), so each option is tried, checked and
ranked on the server exactly as live ones are before anyone sees it.

- **Where:** `samples/prepared/*.json` (`IRIS_PREPARED_DIR` overrides); the first whose `key` equals the scene's.
  None is in the repo yet. `.gitignore` un-ignores `samples/prepared/` and `.dockerignore` ships `samples/**/*.json`,
  so a set, once made and committed, deploys with the samples.
- **The file:** `{"format": 1, "key": {...}, "label": "Saved AI proposals for this sample", "model": id,
  "model_label": label, "made": ISO date, "calls": {sha256(system + "\0" + question): reply}, "items": {"a|b":
  {"clash_key", "clash_ids", "label", "options": n verified when made}}}`. `items` says which pairs are replayed
  (free); a pair the model failed on while making the file is left out (prepared live).
- **The key** (`prepare.saved_key`): `{"version": prepare.VERSION, "files": [[name, sha256], ...] in scene order,
  "requirements": null, "clearance_m": 0.025, "rounds": PLAN_ROUNDS, "want": agent.OPTIONS, "model":
  model_client.model_id("proposal"), "thinking": model_client.thinking_level("proposal"), "prompt": sha256 of
  domain_packs/<pack>.md, "hosts": null}`. The files are those the scene was opened from (`Workspace.original_paths`),
  hashed once per path, size and time. No key (so no saved set) after an edit is kept (revision 0 only) or with
  coordination requirements in force. The file's key names the model that made the replies (`generate` writes the
  recording model's id and thinking level), so a set is used only where that model is the configured one. Any
  difference is a miss, and every pair is prepared live.
- **No hosts:** saved runs read no hosts (`hosts_model=None`), when made and when replayed, so both ask the same
  questions: a service may pass through walls and slabs only, each opening reviewed by its host's team.
- **No images:** a question's hash is its system prompt and text only. Sets are made from model data alone (Iris's
  own detection has no pictures).
- **Per question:** a reply is used only for the exact question it answered. A question the file does not hold (the
  code changed what Iris asks, an imported report's notes, another platform rounding a number differently) fails that
  item honestly with `prepare.MISS`; "Request another" asks live.
- **Made by** `evals/prepare_saved.py` (`prepare.generate` with a `prepare.Recorder`): the Northbank demo files as the
  demo card opens them, Iris's detection with the default tests, the answer key's three girder clashes, then
  `prepare.deepest`. `--dry-run` counts the calls and prices them with no model call; without `--yes` it prints the
  plan and the estimate and calls nothing; every mode but `--model gemini --yes` runs offline (credentials dropped
  after the package reads `.env`, `make_client` refuses). It needs the owner's approval before it runs on Gemini:
  `uv run --directory server python ../evals/prepare_saved.py --model gemini --yes`. It writes
  `samples/prepared/Northbank.json` (`--out` elsewhere; `--samples` reads the models from another folder): a temp
  file in the same folder, made readable (0644: the server's image may run as another user), then renamed into place,
  so a reader never sees half a file.
- **Scripted:** `prepare.ScriptedModel` (id `scripted`, "Scripted test model") is a free, offline, deterministic
  stand-in: it moves the side that is a service up or down by set amounts and offsets it through an opening the
  question names. Only passed in explicitly (tests, `--model scripted`, a local click-through with
  `IRIS_PREPARED_DIR=<its folder> GEMINI_MODEL=scripted GEMINI_THINKING_LEVEL=`); nothing in the environment selects it.

## Measured so far (scripted model only)

These are `prepare.ScriptedModel` results, free and offline (`evals/prepare_saved.py --model scripted`, Northbank,
2026-11-22). They are not Gemini's; nothing here has been run on Gemini yet.

- Detection found 464 clashes. The generator's pick (the answer key's pairs plus `deepest(8)`) gave 8 pairs: the answer
  key falls within the deepest 8.
- Made with the scripted model: 6 ready, 2 failed, 13 replies recorded, about 55 s.
- Replayed in a fresh process whose model raises if called: the key matched, 0 live calls, the same 6 ready and 2
  failed, every option checked again (about 60 s: the geometry checks).
- A whole-run raise of #042 by 0.40 m now fails: the move keeps its joints and carries the tee, branch and damper,
  which hit secondary beams. Of the scripted ideas, only offsets passed for #042, #057 and #061.
- `--dry-run` for Gemini: at most 16 calls (8 pairs x 2 rounds), about 43,976 input tokens (characters / 4), 32,000
  output tokens assumed (2,000 a call), no images: about $0.31 on the model `.env` and `deploy/deploy.sh` set for
  proposals (gemini-3.8-flash at thinking low), about $0.41 on gemini-4-argon. An estimate, not a bill.

## Web

- `web/src/reviewQueueModel.ts`: the pick rule, the stream call, the shared prepare store (it outlives the queue being
  closed, so the entry point can say "Preparing fixes: 3 of 8"), progress text, keyboard map, auto-advance.
- `web/src/ReviewQueue.tsx`: `ReviewFixesEntry` (the one entry point on Clash review: "Prepare fixes", then
  "Preparing fixes: 3 of 8", then "Review fixes (n ready)") and `ReviewQueue` (the two-pane review).
- `web/src/review-queue.css`.

Layout (two panes, light only):

- **Top:** "3 of 8 reviewed · 2 accepted · 1 rejected", status pills per clash, ← / → and Close.
- **Left:** the clash title with a red distance badge; the proposal card (AI-proposed: holo edge; Geometry-validated ✓
  in green; what moves, how far, the evidence: clash gone, clearance, nothing new hit); the reviewer's name; Accept
  (ink), Reject with a reason (outline), Request another (text). It moves to the next clash after a decision.
- **Right:** the 3D view at the clash with a segmented "Before | After | Both" control. It is the page's one viewer,
  moved into the pane with `Viewer.mountIn` while the queue is open; the queue holds its pair in focus even after the
  page's own effects (a keep patches the model and the page sets its focus again), and closing puts the viewer back
  with the camera where it was and no clash marker left.
- **Keys:** A accept, R reject, → next, ← previous (not while typing); Escape closes (or cancels the reason).

### Mounting it in `App.tsx`

The page wiring is kept small so it can move with the app shell:

1. `import { ReviewFixesEntry, ReviewQueue } from "./ReviewQueue";` (and both names plus `"./ReviewQueue"` in the stub
   lists of `web/tests/app-host.mjs` and `web/tests/app-replacement.test.mjs`).
2. `const [reviewOpen, setReviewOpen] = useState(false);`, closed again when the scene or the clash list changes.
3. `<ReviewFixesEntry sceneId reportId reportTitle clashes triage={listTriage} ticked={checked}
   fixed={[...fixed ids, ...reviewed ids]} onOpen={() => setReviewOpen(true)} />` on Clash review: the primary action
   in the workspace's header, at the right of the app shell's top bar (`workActions`, when `reviewLeads`: Clash review
   or a session outside a project, not on phones and tablets), with Export beside it as a secondary; its one line
   and "Prepare again" show beside the button only on very wide screens (the queue has both), its error under it
   (`frame.css`).
4. `{reviewOpen && sceneId && report && <ReviewQueue … viewer={viewer.current} reviewer onReviewer={setReviewer}
   onDecisions={(d) => noteDecisions(d, true)} onClose={() => setReviewOpen(false)} onKept={…} />}` with the overlays,
   inside the workspace (`div.app`): in the app shell it covers the shell's body only (`.shell .rq` is absolute), so the
   sidebar and the top bar stay.
   `onKept` does what `accept()` does after its keep request (note the decisions, `applyToViewer`, `setEdits`,
   `markFixed`, `setRemeasure`); it never makes a keep request of its own.

Nothing is applied without Accept.
