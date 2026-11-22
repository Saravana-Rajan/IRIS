"""Make the review queue's saved AI proposals for the Northbank demo (docs/review-queue.md, "Saved results").

Opens the Northbank demo files as the demo card does (`iris.demos.DEMOS`, "northbank"), runs Iris's own detection with
the default tests (`Workspace.detect`), picks the deepest open hard clashes (`prepare.deepest`) plus the answer key's
three clashes on the Level 02 transfer girder (#042, #057, #061), and prepares a fix for each clash pair through the
review queue's own run, recording every model reply (`prepare.generate`). Saved runs read no hosts: a service may pass
through walls and slabs only, each opening reviewed by its host's team, exactly as a replay asks.

    cd server
    uv run python ../evals/prepare_saved.py --dry-run              # calls, tokens and USD: no model is called
    uv run python ../evals/prepare_saved.py --model scripted       # free and offline (written to a temp folder)
    uv run python ../evals/prepare_saved.py                        # the plan and the estimate for Gemini; calls nothing
    uv run python ../evals/prepare_saved.py --model gemini --yes   # the real run: calls Gemini, billed

The real run calls the proposal model (GEMINI_MODEL at GEMINI_THINKING_LEVEL, on Vertex AI) up to PLAN_ROUNDS times per
clash pair, and is billed. **The owner must approve the spend first** (run --dry-run for the estimate). From the repo
root the exact command is:

    uv run --directory server python ../evals/prepare_saved.py --model gemini --yes

It writes samples/prepared/Northbank.json (--out). The set is used only where its key matches: the same files byte for
byte, no edit kept, no requirements, the same proposal model and thinking level (prepare.saved_key).

Every mode except `--model gemini --yes` runs offline: the credentials are dropped from the environment after the
package has read .env, and building a model client raises, so nothing here can reach a model by accident.

A local click-through with a scripted set: make one with --model scripted --out /tmp/prepared/Northbank.json, then run
the server with IRIS_PREPARED_DIR=/tmp/prepared GEMINI_MODEL=scripted GEMINI_THINKING_LEVEL= (empty) so the key
matches.
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from iris import demos, model_client, plans, prepare  # noqa: E402  (reads .env: see offline())
from iris.service import Workspace  # noqa: E402

SAMPLES = ROOT / "samples"
OUT = SAMPLES / "prepared" / "Northbank.json"
SCRIPTED_OUT = Path(tempfile.gettempdir()) / "iris-prepared-scripted" / "Northbank.json"
GIRDER = "1eVHoPtl1IhAbbhivqVqb0"   # TB-L02-01, the Level 02 transfer girder
KEY = {"#042": "2AbvqKF25LGeR0M34N_jld",   # supply air main SA-MAIN-L02-5
       "#057": "3tQ7zxxRDMefPXL6hbHmO2",   # cable tray LV-TRAY-L02-1
       "#061": "1RHD_I4ibLDuUhW1LBAckc"}   # cold water main CW-MAIN-L02-2
CREDENTIALS = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
               "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_APPLICATION_CREDENTIALS")


def offline() -> None:
    """No model can be reached from here on: the credentials leave the environment (the package read .env on import),
    .env is not read again, and building a client raises. The proposal model's id still reads (the key names it)."""
    for name in CREDENTIALS:
        os.environ.pop(name, None)
    model_client.load_env.__defaults__ = (Path("/nonexistent/iris-offline.env"),)

    def refuse(*_a, **_k):
        raise RuntimeError("This run is offline: no model client may be built (use --model gemini --yes).")
    model_client.make_client = refuse


class Counter:
    """Counts the questions a run would ask and their characters, and answers each with no candidates, so every item
    asks all PLAN_ROUNDS rounds (the upper bound). Never touches the network."""

    def __init__(self, model_id: str):
        self.model = model_id
        self.label = "counting stand-in"
        self.thinking_level = model_client.thinking_level("proposal")
        self.calls = self.chars = self.images = 0
        self._lock = threading.Lock()

    def complete_json(self, system, text, images=None, **_kw) -> dict:
        with self._lock:
            self.calls += 1
            self.chars += len(system) + len(text)
            self.images += len(images or [])
        return {"understanding": "", "candidates": []}


def pick(ws: Workspace, sid: str, rid: str, deepest: int) -> list[str]:
    """The answer key's clashes on the girder first, then the deepest open hard clashes; each clash once."""
    report = ws.report(rid)
    key_ids = [c.id for label, service in KEY.items() for c in report.clashes
               if {c.a.global_id, c.b.global_id} == {GIRDER, service} and (c.test_type or "hard") == "hard"]
    found = {s for c in report.clashes for s in KEY.values() if {c.a.global_id, c.b.global_id} == {GIRDER, s}}
    for label, service in KEY.items():
        if service not in found:
            print(f"warning: the answer key's {label} is not in the detected clashes", flush=True)
    return list(dict.fromkeys([*key_ids, *prepare.deepest(ws, sid, rid, [], deepest)]))


def estimate(ws: Workspace, sid: str, rid: str, ids: list[str], output_tokens: int) -> dict:
    """The calls a run asks and what they cost, with no model call: each item's questions built and counted."""
    mid = model_client.model_id("proposal")
    counter = Counter(mid)
    prepare.run(ws, sid, rid, ids, lambda e: None, None, live_model=counter, live_hosts=None, limit=None)
    tin = round(counter.chars / 4)
    tout = counter.calls * output_tokens
    return {"model": mid, "thinking": model_client.thinking_level("proposal"), "calls": counter.calls,
            "images": counter.images, "input_tokens": tin, "output_tokens": tout,
            "usd": round(model_client.cost(mid, tin, tout), 4)}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--model", choices=("scripted", "gemini"), default="gemini")
    p.add_argument("--yes", action="store_true", help="required to call Gemini (billed; the owner approves first)")
    p.add_argument("--dry-run", action="store_true", help="count the calls and estimate the cost; no model call")
    p.add_argument("--out", type=Path, help=f"where to write the set (default {OUT.relative_to(ROOT)}; "
                                            f"--model scripted: {SCRIPTED_OUT})")
    p.add_argument("--samples", type=Path, default=SAMPLES)
    p.add_argument("--deepest", type=int, default=plans.MAX_ITEMS, help="how many of the deepest pairs to add")
    p.add_argument("--output-tokens", type=int, default=2000,
                   help="output tokens assumed per call for the estimate (the reply and its thinking)")
    args = p.parse_args()
    live = args.model == "gemini" and args.yes and not args.dry_run
    if not live:
        offline()
    out = args.out or (SCRIPTED_OUT if args.model == "scripted" else OUT)

    if args.model == "scripted":
        model = prepare.ScriptedModel()
    elif live:
        model = model_client.GeminiModel(timeout_s=240)
    else:
        model = Counter(model_client.model_id("proposal"))
    demo = next(d for d in demos.DEMOS if d.id == "northbank")
    ws = Workspace(samples=args.samples, model=model)   # a model given: no host reading
    print(f"Opening {', '.join(demo.files)}", flush=True)
    sid = ws.open(list(demo.files))
    found = ws.detect(sid)
    rid = found["report"]["id"]
    print(f"Detection: {len(ws.report(rid).clashes)} clashes in {found['seconds']} s", flush=True)
    ids = pick(ws, sid, rid, args.deepest)
    items, skipped = prepare.pairs(ws, sid, rid, ids, limit=None)
    print(f"{len(items)} clash pairs to prepare (the answer key, then the {args.deepest} deepest):")
    for it in items:
        mm = f"{it.distance_m * 1000:+.0f} mm" if it.distance_m is not None else "?"
        print(f"  {mm:>9}  {it.label}  [{', '.join(it.clash_ids)}]")
    for why in skipped:
        print(f"  skipped: {why}")
    print(f"Upper bound: {len(items)} pairs x {plans.PLAN_ROUNDS} rounds = {len(items) * plans.PLAN_ROUNDS} calls",
          flush=True)

    if args.dry_run or (args.model == "gemini" and not args.yes):
        e = estimate(ws, sid, rid, ids, args.output_tokens)
        print(f"Estimate on {e['model']} (thinking {e['thinking'] or 'default'}): {e['calls']} calls, "
              f"~{e['input_tokens']:,} input tokens (characters / 4), {e['output_tokens']:,} output tokens assumed "
              f"({args.output_tokens} per call), images {e['images']}: about ${e['usd']:.2f}. A second round's "
              f"question is a little longer (the first round's tries); a round that verifies a fix ends the item.")
        if not args.dry_run:
            print("Nothing was called. To run it on Gemini (billed; the owner approves first):\n"
                  "  uv run --directory server python ../evals/prepare_saved.py --model gemini --yes")
        return 0

    def show(e: dict) -> None:
        if e.get("type") != "prepared":
            return
        line = (", ".join(f"{o['title']} ({(o.get('min_clearance_m') or 0) * 1000:.0f} mm clear)" for o in e["options"])
                if e["status"] == "ready" else e.get("why", "").replace("\n", " | "))
        print(f"  [{e['done']}/{e['total']}] {e['status']:<6} {e['label']}: {line}", flush=True)

    print(f"Preparing on {prepare.label_of(model)} ({getattr(model, 'model', '')}), writing {out}", flush=True)
    r = prepare.generate(ws, sid, rid, ids, model, out=out, emit=show, limit=None)
    print(f"Wrote {r['path']}: {r['items']} pairs ({r['ready']} ready, {r['failed']} failed), {r['calls']} replies "
          f"recorded, {r['seconds']} s" + (f"; usage {r['usage']}" if r.get("usage") else ""))
    if r["skipped_failed"]:
        print(f"Not saved (the model failed on them): {', '.join(r['skipped_failed'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
