# Escalating to the escalation model

**Status:** built (below: "What was built" and "E0"). The design that follows is the plan it was built from; where the
two differ, "What was built" says what the code does. Re-branded to Gemini on Vertex AI on 2026-11-11; no measured
result in this doc has been re-run on Gemini yet.

When the main model's (Gemini Pro, `GEMINI_MODEL`) propose → verify loop ends with no verified fix, the clash gets a
second, longer try: the escalation model (`GEMINI_ESCALATION_MODEL`), with everything Iris learned on the first try and
every registered kind of edit. It runs through the same geometry check: nothing reaches the user unverified, and the
headline stays verified model edits.

## What the escalation model needs

- It is called through `server/iris/model_client.py` (`GeminiModel`) on Vertex AI, like the main model; it takes text
  and images.
- Strict JSON output (a response schema) and streamed thought summaries (`GEMINI_INCLUDE_THOUGHTS`), so
  `complete_json` and `complete_json_reasoning` need no change.
- Thinking tokens count against the output token limit: never set a tight cap, or the answer comes back empty.
- Every call is billed; its price comes from `IRIS_MODEL_PRICES`. Latency and cost per escalation are not yet measured
  on Gemini.

## When it runs

- **Button** (default, owner decision): NoFix ("No edit passed the geometry check") gets **Ask for a deep think**,
  with one line on what it does ("A larger model takes a second, longer look, with everything Iris tried.").
- **After a successful run too** (owner decision): under the options, a quieter **Look for a better fix**. The
  escalation model then gets the first try's options as well as its failures and is asked to beat them (a plain fix
  where the first try found only a resize or a penetration, more clearance, a smaller change). Its options join the
  first try's in one ranked list, each with its model chip; nothing already verified is dropped.
- Owner setting `escalation`: `off` / `button` / `auto` (settings.py, For me and For everyone; env
  `IRIS_ESCALATION`, default `button`). `auto` escalates once when the first try ends with no verified option (never
  after a successful run: that stays a choice).
- Not offered: for a requirements recommendation (nothing may be edited: `_recommend`); for a clash that is not a
  clash.
- Plans: a Fix-together item that failed (`plans.failure_summary`) gets the same button; never automatic in a plan
  (the cost multiplies).

## What the second try reads that the first didn't

The same system pack (`construction.md`, plus the requirements' guidance) and `domain_packs/escalation.md`. The user
text is `_describe` plus:

1. **The first try:** its understanding and advice, every attempt with its reason, what it hit (`hit_ids` by name and
   class) and where (`Attempt.where`). The server keeps the last result per scene and pair (`Workspace`), so the
   browser doesn't resend it.
2. **A wider neighbourhood:** every element within 5 m of the pair (class, name, system, storey, box, ports) and the
   free height along the run (soffit to the next element below).
3. **Passages in every blocker,** not only the clash's obstacle (`edits.passages` for each element it hit).
4. **The requirements,** as the first try gets them: who may move, clearance, largest move, who reviews.
5. **The kinds of edit, from the registry:** every `agent.TRIES` kind with its `PARAMS`, written from the registry so
   the model is never offered a kind that isn't there. After the Advanced edits: reroute, resize, penetration.
6. **Compound fixes (new):** one candidate may change several elements (move the return-air main 150 mm *and* offset
   the duct), tried in one trial and checked together, the way `plans.verify_together` checks a plan. This needs a
   compound kind in the registry (an ask of the edits work, below).
7. **Pictures:** A/B/C, as the first try had. Later: one view per main blocker.

The brief is capped at about 60k tokens: a long context means no trimming is needed for quality, but each token is
billed.

## The loop

`agent.resolve(model=escalation, max_rounds=2, …)`: the same kinds, refusals, ranking (`agent.TIERS`) and trials
streamed to the pilot. Events and options carry `model`, so the activity table, the pilot's status line and the option
name the escalation model. As today, a round with only a resize or a penetration gets one more round to find a plain
fix.

A penetration, or any option with `review`, shows **Needs approval by structure** (or services): the geometry is
verified, it is never applied before that team says yes, and the PDF and BCF assign it to them.

If the second try fails too, NoFix shows its advice ("What decides it") and "The escalation model also tried n ideas";
**Flag for the model's author** carries both runs.

## Model plumbing

- `GEMINI_ESCALATION_MODEL` and a role `"escalation"` in `GeminiModel`, so the owner's thinking level for the main
  model (`GEMINI_THINKING_LEVEL`) doesn't carry over; the escalation model has its own
  (`GEMINI_ESCALATION_THINKING_LEVEL`, default medium), which the owner can change.
- **Usage:** read token usage from every call, add it up per run, and return tokens and an estimated cost with the
  result. The owner sees it in the activity footer; evals record it.
- Calls time out at 240 s (the escalation model thinks longer than the main one).

## Caps

- `IRIS_ESCALATE_PER_HOUR` per visitor (default 3) and `IRIS_ESCALATE_PER_DAY` for everyone (default 30);
  an escalation also takes one proposal. The owner has no caps; MCP links charge the link's creator.
- A spend guard: `IRIS_ESCALATION_MAX_USD_DAY` (one budget for every escalation-model call, Show it built's judges
  included), from the recorded usage, stops escalations for the day.

## UI

- NoFix: the button and its line. While it runs: the live thought notes, the pilot and the activity table, as for
  the first try; status "The escalation model is thinking".
- Options: a small model chip naming the escalation model; "Needs approval by …" for reviewed kinds.
- Phones: when NoFix shows, the peek line's next step is Ask for a deep think.
- Chat: `propose_fixes(escalate=true)`. MCP: `escalate_fix` (a job, like propose).
- Tour: not in the main tour (live cost and time); a recorded run later, if it earns a step.

## E0: is it the model or the brief?

The experiment that decides whether the escalation model earns its cost.

- **Set:** (a) every real clash in the Northbank and cell runs where the first try has no verified option (sweep
  once, list in `evals/escalation.csv`); (b) the Advanced edits work's cases that need a reroute, resize or
  penetration; (c) known failures such as the cell's C5 HMI (the clearance check counts the floor contact).
- **Arms:** the main model again (control), the main model with the escalation brief, the escalation model with the
  escalation brief. The same round limit for each.
- **Measure:** verified or not, time to the first verified option, rounds, tokens, cost. The answer key (3/3 at Rev04
  heights) must not change.
- **Also:** on clashes the first try does fix, does the escalation model find a better one (plain where the first
  try's was a resize or a penetration, more clearance, a smaller change), and how often? That sizes the "better fix"
  link.
- **Decide:** keep the button if the escalation model with the brief verifies clearly more than the main model with
  the brief (at least two more cases, or cases where the main model with the brief verified none). If the brief alone
  closes the gap, give the brief to the main model first and keep escalation for what is left.
- Rows go in `evals/results.csv` (append-only).

## Plan (after the Advanced IFC edits land)

Branch `feature/escalation`, one PR.

1. E0 (`evals/escalation.py`); write the numbers and the decision here.
2. Server: `escalation.py` (the brief), `Workspace` keeps the last result per pair, `propose/stream` takes
   `escalate: true`, usage and the `"escalation"` role in `model_client`, caps, the setting. Tests with a scripted
   model: the kind list comes from the registry; refused when the first try found an option; caps and spend guard;
   usage adds up; after a successful run the first try's options are kept and ranked with the second's; a reviewed
   kind is never applied without approval.
3. The compound kind, if the edits work didn't add it.
4. Web: the NoFix button, the "Look for a better fix" link under the options, model chip, needs-approval chip,
   activity labels, phone peek. If App's imports change, add
   them to both stub lists (`web/tests/app-host.mjs`, `app-replacement.test.mjs`).
5. Chat and MCP tools.
6. Runtime check: one escalation end to end in the browser on Northbank and on the cell, the PDF page showing the
   option and its reviewer; then on the Cloud Run service.
7. CLAUDE.md entry. Landing and README only with measured numbers.

## Asks of the Advanced IFC edits work

- `PARAMS` for each kind, clear enough to write the escalation model's kind list from.
- A compound candidate (several edits, one trial), or a note that it is out of scope.
- Preview meshes for a penetration (the girder drawn with its new opening): Show it built needs them too
  (`docs/show-it-built.md`).
- Bends that follow the segment's profile. `edits._bend_mesh` sweeps a closed rectangle (or circle) for every bend, so
  an offset cable tray (`IfcUShapeProfileDef`, Northbank's 300 × 100 mm, 4 mm walls) gets closed box bends between
  open channels; the same would hold for C, I and L profiles. Sweep the profile's own outline. Show it built's pictures
  draw the tray open all the way and a prompt line didn't change that (`docs/show-it-built.md`), so this is what makes
  picture and model agree.
- Test cases that need each new kind, for E0.

## What was built

- **Model:** `model_client.escalation_model()` (`GEMINI_ESCALATION_MODEL`, 240 s timeout, role `"escalation"`,
  thinking level `GEMINI_ESCALATION_THINKING_LEVEL`). `escalation_info()` tells the page the model, its label and the
  mode. `GeminiModel.usage` counts every call's tokens, however the call ended; prices come from `IRIS_MODEL_PRICES`
  by model id prefix, so any version of a model is billed. A run's usage is the difference over that run
  (`Usage.snapshot`), reported only for a model billed per token.
- **Budget:** `spend.py`, one day's limit for every escalation-model call (`IRIS_ESCALATION_MAX_USD_DAY`; in memory,
  UTC day). A request claims its estimate when it is let through (`spend.claim`, `escalation.ESTIMATE_USD` a second
  try; checked and held in one step) and the second try takes the claim over while it runs (`spend.held`), so tries
  started together cannot all pass on a nearly spent day. The owner is exempt from the limit, not from the count.
- **Setting:** `settings.escalation()` off / button / auto (`IRIS_ESCALATION`, default button) and the escalation
  thinking level, for me and for everyone in the owner menu.
- **The brief:** `escalation.brief` = the first try (understanding, advice, each idea with why it failed and what it
  hit by name, the fixes it verified), the elements it ran into most with the openings and room past each
  (`blockers`), every element within 5 m (`neighbourhood`: class, name, level, box, whether a combined fix may move it,
  whether it is joined to A or B), and the kinds of fix from the registry. Prompt: `domain_packs/escalation.md`.
- **The combined kind** (`agent._try_combined`, registered in `TRIES`/`PARAMS`/`IN_TRIAL`/`KEEP`/`SIZED`): 1 to 3
  steps (move, offset, route), each on its own element, one on A or B, tried in one trial and checked together
  (`check_combined`: each step's elements against everything, a split run's shortened ends against A, B and the other
  steps). Never structure (`agent.stays`: the fixed classes by inheritance, IFC2X3's `IfcWallStandardCase` included,
  and piles), nothing but services besides A and B, and a moved run must hold neither; the requirements apply to
  every element a step moves. Ranks after a single element's fix (`TIERS` 0.5) and ends the search. Kept all or
  nothing (`edits.kept_files`), with each split run's pieces returned on its own (`groups`). A plan checks it the same
  way (`plans._in_trial_combined` returns its own check).
- **The second try:** `Workspace.escalate`: reads the last try at the pair (`last_try`, kept per scene and pair, 200
  at most, dropped with its scene), but only while it still holds: once an edit was kept in the scene or the
  requirements changed, its options were verified against a model or rules that are gone, so the second try starts
  without it. Two rounds on the escalation model; the result's options are both tries' in one ranked list, each with
  its `model`, and its attempts both tries'. A first try that a plan made (a Fix-together item) is remembered too.
  Refused where nothing may be edited (409, before any cap is taken). `propose` with `auto`: a second try at once when
  nothing verified, if the caller's caps allow; if it fails, the first try's result comes back with a note.
- **API:** `POST /propose` and `/propose/stream` with `escalate: true` (events: `escalating` with the model and the
  first try's ideas, then the second try's events, each with `model`); `GET /api/models` has `escalation`. Caps:
  `IRIS_ESCALATE_PER_HOUR` / `_PER_DAY`, plus one proposal, both taken or neither
  (`ProposeLimit.take_all`).
- **Page:** NoFix's **Ask for a deep think**; under verified options **Look for a better fix**; a failed
  Fix-together item's **Ask for a deep think** (it reads the plan's try at that pair); model chips on options and
  ideas; the pilot names the model and numbers the second try's ideas after the first's; the owner sees tokens and
  cost. A second try that fails or is refused puts the first try's options back.
- **Chat and MCP:** `propose_fixes(escalate=true)`; chat suggests it when there is no fix, or only a resize or an
  opening, and no recommendation. The `escalating` event carries the first try (understanding, ideas, verified
  options), so a page that did not watch it keeps those options if the second try fails. A plan whose model changed
  since it was checked (a failed item's second try was kept) cannot be accepted until it is built again.
- **Tests:** `tests/test_escalation.py` (combined fixes, guards, atomic keep, the second try, staleness, caps, budget,
  usage, chat, API) and `tests/test_plans.py` (a combined fix in a plan; a plan item remembered).

## E0 on Gemini

Not yet measured on Gemini. Run `evals/escalation.py` on the set above with the three arms, write the table and the
decision here, and append the rows to `evals/results.csv`. Two things the earlier run taught that do not depend on the
model:

- **Read lifted fixes with care.** A move check that counted a post's embedment in its slab as a clash once the post
  moved let a lift off the slab dodge it: geometrically verified, not buildable as drawn. Fixed in the check
  (`docs/edits.md` "A move keeps what it stands on"): a post slid along its slab keeps its anchors' contact, and a
  lift off it is refused.
- **A fix that moves structure** (such as a pad footing) is verified but needs structure's review; `review` should
  say so (follow-up: the same "structure review" chip a penetration in structure gets).

## Open questions

1. Cap defaults and the daily spend limit (`IRIS_ESCALATE_PER_HOUR`, `IRIS_ESCALATE_PER_DAY`,
   `IRIS_ESCALATION_MAX_USD_DAY`): set once cost per escalation is measured on Gemini.

Decided: a button by default; also offered after a successful run, to look for a better fix.
