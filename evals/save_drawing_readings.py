"""Save the drawing reader's Gemini reading of each sample sheet, once (docs/drawings.md, "Saved readings").

    cd server && uv run python ../evals/save_drawing_readings.py [--max-usd 0.30] [--only Northbank-M-201.pdf]

Each sample PDF in samples/drawings/ is taken in as an upload is (drawings.ingest) and read by the real reader
(drawing_reader.read_drawing: the fast model, the prompt as it is now, every page checked against its text layer). The
model's reply for each page is written to samples/drawings/<stem>.reading.json with the PDF's sha256 and the prompt's
hash (drawing_reader.write_saved); the server replays it instead of calling the model when the same PDF is read with
the same prompt (drawing_reader.saved_reading), and says it is a saved reading. A reply already in the reader's own
cache (drawing_reader.CACHE) is used again at no cost, so a second run only rewrites the files.

A hard cap on what one run may spend (--max-usd, default $0.30): a page is not started when what has been spent plus
its estimate, or the last page's real cost when that is higher, would pass it; the run stops and says so. Each call is
also held to --max-output-tokens (thinking included), so no single page can cost more than that allows.

The reader's own thinking level (`drawing_reader.THINKING`, high) did not finish the A1 sample sheet within its 240 s
deadline (Nov 22: two 504 DEADLINE_EXCEEDED, no tokens returned), so the saved readings are made at --thinking low
(default) with --timeout 300; the file records both (`settings`). Same model, prompt, schema and images.

    cd server && uv run python ../evals/save_drawing_readings.py --check

--check calls no model: it replays each saved reading, opens the sample building's models, and prints per sheet the
items by status, how many of the sheet's labels (its .truth.json) were confirmed, and the comparison with the model
(drawing_compare.compare) next to the mismatches planted in the sheet; then both sheets compared together as the
Drawings step compares them (drawings.compare_scene).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from iris import demos, drawing_reader, drawings, model_client  # noqa: E402

SAMPLES = ROOT / "samples" / "drawings"


class Cap:
    """A run's hard cap (USD), in the reader's budget shape: refused / hold / charge."""

    def __init__(self, max_usd: float):
        self.max_usd = max_usd
        self.spent = 0.0
        self.last = 0.0

    def refused(self, estimate: float) -> str | None:
        need = max(estimate, self.last)
        if self.spent + need > self.max_usd + 1e-12:
            return f"stopped: ${self.spent:.4f} spent, the next page needs about ${need:.4f}, the cap is ${self.max_usd:.2f}"
        return None

    def hold(self, estimate: float):
        return contextlib.nullcontext()

    def charge(self, usd: float) -> None:
        self.spent += max(0.0, usd)
        self.last = max(0.0, usd)


def check() -> int:
    """Replay each saved reading (no model call), compare it with the sample building, and set it beside the truth."""
    from iris import drawing_compare
    from iris.service import Workspace

    class NoModel:
        model, priced = "no-model", False

        def estimate_usd(self, n):
            return 0.0

        def read(self, *a, **kw):
            raise RuntimeError("a page has no saved reading: nothing was called")

    demo = next(d for d in demos.DEMOS if d.drawings)
    ws = Workspace()
    sid = ws.open(list(demo.files))
    scene = ws.scene(sid)
    index = drawing_compare.model_index(scene)
    held, items = [], {}
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name in demo.drawings:
            pdf = SAMPLES / name
            d = drawings.ingest(pdf.read_bytes(), name, Path(tmp))
            info = drawing_reader.saved_info(d)
            if info is None:
                print(f"{name}: no saved reading for this PDF and prompt")
                return 4
            done = list(drawing_reader.read_drawing(d, model=NoModel(), cache_dir=False,
                                                    folder=drawings.folder_of(d)))[-1]
            got = done["items"]
            held.append(d)
            items[d.id] = got
            tally = {st: sum(1 for i in got if i["status"] == st) for st in drawing_reader.STATUSES}
            truth = json.loads((SAMPLES / f"{pdf.stem}.truth.json").read_text())
            labels = [t for t in truth["items"] if t.get("tag") or t.get("size")]

            def key(tag, size):
                parsed = drawing_reader.parse_size(size, strict=False) if size else None
                return (drawing_reader.canon_tag(tag) if tag else None, parsed.dims_mm if parsed else None)
            confirmed = {key(i["tag"], i["size"]) for i in got if i["status"] == "confirmed"}
            hit = sum(1 for t in labels if key(t.get("tag"), t.get("size")) in confirmed)
            result = drawings.plain(drawing_compare.compare(scene, got, storey=drawings.storey_of(d.title), index=index))
            def what(m):   # a mismatch by its kind and what it is about: the element, else the tag drawn
                return m["kind"], m.get("element") or m.get("drawing_value")
            found = sorted(what(m) for m in result["mismatches"])
            planted = sorted(what(m) for m in truth["mismatches"])
            same = found == planted
            bad += not same
            print(f"{name}: saved reading by {info['label']} ({info['at']}); {len(got)} items {tally}; "
                  f"{hit} of {len(labels)} printed labels confirmed; "
                  f"{len(result['matches'])} matched the model; mismatches {len(found)} "
                  f"({'exactly the planted ones' if same else 'NOT the planted ones'})")
            for m in result["mismatches"]:
                print(f"    found   {m['kind']}: drawing {m.get('drawing_value')}, model {m.get('model_value')}"
                      f"{'' if what(m) in planted else '  (not planted)'}")
            for m in planted:
                if m not in found:
                    print(f"    missed  {m}")
    together = drawings.compare_scene(scene, held, lambda did: items.get(did, []), drawing_compare.compare,
                                      drawing_compare.model_index)
    by_sheet = {d.id: d.name for d in held}
    print("both sheets together (the Drawings step):",
          [(by_sheet[m["drawing"]], m["kind"]) for m in together["mismatches"]])
    return 1 if bad else 0


class CappedReader(drawing_reader.GeminiReader):
    """The reader's Gemini call as it is, with a cap on output tokens (thinking included)."""

    def __init__(self, model: str, *, max_output_tokens: int, **kw):
        super().__init__(model, **kw)
        self.max_output_tokens = max_output_tokens

    def config(self, system: str, schema: dict):
        return super().config(system, schema).model_copy(update={"max_output_tokens": self.max_output_tokens})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--max-usd", type=float, default=0.30)
    ap.add_argument("--thinking", default="low", help="the call's thinking level (the reader's own: high)")
    ap.add_argument("--max-output-tokens", type=int, default=18000)
    ap.add_argument("--timeout", type=float, default=300.0, help="seconds per call")
    ap.add_argument("--only", default="", help="one sample PDF's name")
    ap.add_argument("--check", action="store_true", help="replay the saved readings against the model; no model call")
    args = ap.parse_args()
    if args.check:
        return check()
    model_client.load_env()
    model = model_client.model_id("fast")
    cap = Cap(args.max_usd)
    pdfs = [p for p in sorted(SAMPLES.glob("*.pdf")) if not args.only or p.name == args.only]
    settings = {"thinking_level": args.thinking, "max_output_tokens": args.max_output_tokens,
                "timeout_s": args.timeout}
    reader = CappedReader(model, max_output_tokens=args.max_output_tokens, thinking_level=args.thinking,
                          timeout_s=args.timeout, retries=0)
    worst = model_client.cost(model, 5 * drawing_reader.IMAGE_TOKENS + drawing_reader.TEXT_TOKENS,
                              args.max_output_tokens)
    print(f"model {model}; prompt {drawing_reader.prompt_hash()[:12]}; {settings}; worst page ${worst:.3f}; "
          f"cap ${args.max_usd:.2f}; {len(pdfs)} sheet(s)", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        for pdf in pdfs:
            d = drawings.ingest(pdf.read_bytes(), pdf.name, Path(tmp))
            if cap.spent + max(worst, cap.last) > cap.max_usd + 1e-12:
                print(f"{pdf.name}: stopped: ${cap.spent:.4f} spent and a page may cost up to ${worst:.4f}; "
                      f"the cap is ${cap.max_usd:.2f}")
                return 2
            started = time.monotonic()
            try:
                events = list(drawing_reader.read_drawing(d, model=reader, budget=cap, folder=drawings.folder_of(d),
                                                          saved=False))
            except drawing_reader.ReadRefused as e:
                print(f"{pdf.name}: {e}")
                return 2
            print(f"{pdf.name}: read in {time.monotonic() - started:.0f} s", flush=True)
            done = events[-1]
            if done.get("errors"):
                print(f"{pdf.name}: the reply for page(s) {sorted(done['errors'])} failed: {done['errors']}; not saved")
                return 3
            out = drawing_reader.write_saved(d, SAMPLES / f"{pdf.stem}.reading.json", model=model, settings=settings)
            tally = {s: 0 for s in drawing_reader.STATUSES}
            for it in done["items"]:
                tally[it["status"]] += 1
            cost = sum(float((p.get("usage") or {}).get("usd") or 0) for p in json.loads(out.read_text())["pages"])
            print(f"{pdf.name}: {len(done['items'])} items {tally}; this run ${done['cost_usd']:.4f}; "
                  f"the reading cost ${cost:.4f}; saved {out.relative_to(ROOT)}", flush=True)
    print(f"spent this run: ${cap.spent:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
