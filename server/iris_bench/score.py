"""Iris Bench scoring: turn Items + Results into tidy score rows.

Every row is a flat dict with a `table` key saying which table it belongs to:

- "accuracy":  model x job x mode accuracy with a seeded bootstrap 95% CI
- "partial":   J3 partial credit (direction right, distance in band, right opening)
- "slice":     accuracy per challenge factor bucket (occlusion, density, gap_mm, overlap_mm, visible_px, view, style)
- "taxonomy":  error counts per job and error type
- "cost":      cost-weighted score next to raw accuracy
- "control":   control deltas (no_image / swapped / pictures_text minus pictures), paired by base item

`grade(item, result, scene)` is the hook that calls the geometry checker per job. It is optional: when the checker
module is missing, the Result's own `correct`/`detail` are trusted.
"""
from __future__ import annotations

import csv
import inspect
import json
import math
import random
from collections import Counter, defaultdict
from dataclasses import asdict, replace
from pathlib import Path
from typing import Callable, Iterable

from iris_bench.spec import Fix, Item, Result, Scene

# Illustrative weights only: what each kind of mistake costs on a real job, relative to a harmless false alarm.
# A missed real clash ("false clear") or an approved bad fix reaches site; a too-small move comes back as a re-clash.
COST_WEIGHTS: dict[str, float] = {
    "false_clear": 5.0,
    "approved_bad_fix": 5.0,
    "too_small": 3.0,
    "hits_new_element": 3.0,
    "wrong_direction": 2.0,
    "wrong_element": 2.0,
    "false_alarm": 1.0,
    "rejected_good_fix": 1.0,
    "wrong_label": 1.0,
    "wrong": 1.0,
    "unparseable": 1.0,
    "ungraded": 0.0,   # checker could not run (no scene / crash): reported, never charged
}
MAX_WEIGHT = max(COST_WEIGHTS.values())

CONTROL_MODES = ("no_image", "swapped", "pictures_text")
SLICE_KEYS = ("occlusion", "density", "gap_mm", "overlap_mm", "visible_px", "view", "style")
# Fixed bucket edges for the numeric challenge factors; anything else gets terciles from the data.
BUCKET_EDGES: dict[str, list[float]] = {
    "occlusion": [0.0, 0.25, 0.5, 0.75],
    "density": [0.0, 0.34, 0.67],
    "gap_mm": [0.0, 10.0, 25.0, 50.0, 100.0],
    "overlap_mm": [0.0, 10.0, 25.0, 50.0, 100.0],
    "visible_px": [0.0, 200.0, 1000.0, 5000.0],
}

BAND_ABS_M = 0.025   # distance band: +- max(25 mm, 15%) of the minimal passing distance
BAND_REL = 0.15


# ---------------------------------------------------------------- statistics

def bootstrap_ci(values: list[float], n_boot: int = 1000, seed: int = 0, alpha: float = 0.05) -> tuple[float, float]:
    """Percentile bootstrap CI of the mean. Seeded, so the same inputs give the same interval."""
    n = len(values)
    if n == 0:
        return (math.nan, math.nan)
    if n == 1 or len(set(values)) == 1:
        m = sum(values) / n
        return (m, m)
    rng = random.Random(seed)
    means = sorted(sum(values[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot))
    lo = means[int(math.floor((alpha / 2) * (n_boot - 1)))]
    hi = means[int(math.ceil((1 - alpha / 2) * (n_boot - 1)))]
    return (lo, hi)


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else math.nan


# ---------------------------------------------------------------- reply / truth reading (tolerant of key names)

def _first(d: dict | None, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _norm_kind(v) -> str | None:
    """Map a J1 label/verdict to one of real / not_touching / by_design."""
    if v is None:
        return None
    if isinstance(v, bool):
        return "real" if v else "not_touching"
    s = str(v).strip().lower().replace("-", "_").replace(" ", "_")
    if s in ("a", "b", "c"):   # jobs.KIND_CHOICES letters
        return {"a": "real", "b": "not_touching", "c": "by_design"}[s]
    if "design" in s or "support" in s or "intended" in s:
        return "by_design"
    if "not" in s or "clear" in s or "gap" in s or "no_clash" in s or s in ("false", "no", "none"):
        return "not_touching"
    if "real" in s or "clash" in s or "hit" in s or s in ("true", "yes"):
        return "real"
    return s


def _norm_approve(v) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s.startswith(("approve", "accept", "yes", "ok", "pass", "good", "true")):
        return True
    if s.startswith(("reject", "deny", "no", "fail", "bad", "false")):
        return False
    return None


def _truth_kind(item: Item) -> str | None:
    return _norm_kind(_first(item.truth, "kind", "label", "answer", "clash_kind", "verdict"))


def _reply_kind(reply: dict | None) -> str | None:
    return _norm_kind(_first(reply, "verdict", "kind", "label", "answer", "status", "clash"))


def _truth_fix_ok(item: Item) -> bool | None:
    v = _first(item.truth, "expected_good", "fix_ok", "good", "fix_passes", "passes", "approve", "answer", "verdict")
    return _norm_approve(v)


def _reply_approve(reply: dict | None) -> bool | None:
    return _norm_approve(_first(reply, "good", "approve", "approved", "verdict", "decision", "answer"))


def reply_fix(item: Item, reply: dict | None) -> Fix | None:
    """The Fix a J3 reply proposes. Prefers jobs.reply_to_fix (letters -> ids); falls back to raw keys."""
    if not isinstance(reply, dict):
        return None
    fn = None
    try:
        from iris_bench import jobs  # type: ignore
        fn = getattr(jobs, "reply_to_fix", None)
    except Exception:
        fn = None
    if fn is not None and "letters" in item.truth:
        try:
            return _call_flex(fn, item=item, reply=reply)
        except (ValueError, TypeError, KeyError, AttributeError):
            return None
    eid = _first(reply, "element", "mover", "move")
    if eid is None:
        return None
    labels = _first(item.truth, "labels", default={}) or {}
    rev = {v: k for k, v in labels.items()}
    eid = rev.get(eid, eid)
    try:
        dx, dy, dz = (float(_first(reply, k, default=0.0)) for k in ("dx", "dy", "dz"))
    except (TypeError, ValueError):
        return None
    if all(abs(v) > 5 for v in (dx, dy, dz) if v):   # replies in mm
        dx, dy, dz = dx / 1000, dy / 1000, dz / 1000
    return Fix(element=str(eid), dx=dx, dy=dy, dz=dz, via_opening=_first(reply, "via_opening", "opening"))


def _fix_from(d) -> Fix | None:
    if d is None:
        return None
    if isinstance(d, Fix):
        return d
    if isinstance(d, dict):
        return Fix(**{k: d[k] for k in ("element", "dx", "dy", "dz", "via_opening") if k in d})
    return None


def good_fix(item: Item) -> Fix | None:
    """The known-good fix for a J3 item: truth["good_fix"], or truth["expected"] (a reply-form answer)."""
    g = _fix_from(_first(item.truth, "good_fix", "fix"))
    if g is None and isinstance(item.truth.get("expected"), dict):
        g = reply_fix(item, item.truth["expected"])
    return g


def _vec(f: Fix) -> tuple[float, float, float]:
    return (f.dx, f.dy, f.dz)


def _norm3(v) -> float:
    return math.sqrt(sum(c * c for c in v))


# ---------------------------------------------------------------- grading hook

def _call_flex(fn: Callable, **avail):
    """Call fn with whichever of the available names its signature asks for (scene, item, reply, truth, fix...)."""
    sig = inspect.signature(fn)
    args, kwargs = [], {}
    for name, p in sig.parameters.items():
        if name in avail:
            if p.kind in (p.POSITIONAL_ONLY,):
                args.append(avail[name])
            else:
                kwargs[name] = avail[name]
        elif p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            raise TypeError(f"{fn.__name__} needs {name!r}")
    return fn(*args, **kwargs)


def min_passing_distance(scene: Scene, good: Fix, steps: int = 14) -> float | None:
    """Smallest move along the known-good fix's direction that check_fix passes (bisection, ~0.1 mm at 1 m).
    None when even the good fix fails."""
    from iris_bench import checker  # type: ignore
    mag = _norm3(_vec(good))
    if mag <= 0 or not checker.check_fix(scene, good)["passed"]:
        return None
    unit = tuple(c / mag for c in _vec(good))
    lo, hi = 0.0, mag
    for _ in range(steps):
        mid = (lo + hi) / 2
        f = Fix(good.element, unit[0] * mid, unit[1] * mid, unit[2] * mid, good.via_opening)
        if checker.check_fix(scene, f)["passed"]:
            hi = mid
        else:
            lo = mid
    return hi


def check_reply(item: Item, reply: dict, scene: Scene | None) -> tuple[bool | None, dict]:
    """The runner's `check(item, reply)` hook body. J3: check_fix on the reply's move (plus the minimal passing
    distance for partial credit). J5: the verdict against check_fix on the shown fix. J1/J2/J4: runner's own grade."""
    from iris_bench import checker  # type: ignore
    if item.job == "J3_fix":
        if scene is None:
            return None, {"needs_checker": True, "reason": "scene not found"}
        fix = reply_fix(item, reply)
        if fix is None:
            return False, {"error": "unparseable", "reason": "reply did not name a usable move"}
        d = dict(checker.check_fix(scene, fix))
        d["fix"] = asdict(fix)
        g = good_fix(item)
        if g is not None:
            try:
                mp = min_passing_distance(scene, g)
                if mp is not None:
                    d["min_pass_m"] = round(mp, 4)
            except Exception:
                pass
        return bool(d["passed"]), d
    if item.job == "J5_review":
        if scene is None:
            return None, {"needs_checker": True, "reason": "scene not found"}
        fix = _fix_from(item.truth["fix"])
        d = checker.check_fix(scene, fix)
        ok = bool(d["passed"]) == bool(_reply_approve(reply))
        return ok, {"fix_passed": bool(d["passed"]), "reason": f"fix {'passes' if d['passed'] else 'fails'}: "
                                                               f"{d['reason']}"}
    from iris_bench.runner import grade as runner_grade  # type: ignore
    return runner_grade(item, reply, None)


def make_check(scenes_dir: Path | None) -> Callable[[Item, dict], tuple[bool | None, dict]]:
    """A runner `check` that loads scenes/<seed>/scene.json on demand (cached)."""
    cache: dict[int, Scene | None] = {}

    def scene_for(seed: int) -> Scene | None:
        if seed not in cache:
            p = Path(scenes_dir) / str(seed) / "scene.json" if scenes_dir else None
            cache[seed] = Scene.load(p) if p and p.exists() else None
        return cache[seed]

    def check(item: Item, reply: dict) -> tuple[bool | None, dict]:
        try:
            return check_reply(item, reply, scene_for(item.seed))
        except Exception as e:   # a checker crash marks the item, never sinks the run
            return None, {"grade_error": f"{type(e).__name__}: {e}"}
    return check


def grade(item: Item, result: Result, scene: Scene | None = None) -> Result:
    """Grade a Result the runner left ungraded (correct None with a reply, e.g. detail.needs_checker for J3/J5).
    Already-graded or unparseable results pass through. Unchanged when the checker module is unavailable."""
    if result.correct is not None or result.reply is None:
        return result
    if not result.detail.get("needs_checker") and item.job not in ("J3_fix", "J5_review"):
        return result
    try:
        from iris_bench import checker  # noqa: F401  # type: ignore
    except Exception:
        return result
    try:
        ok, d = check_reply(item, result.reply, scene)
    except Exception as e:  # a checker crash must not sink the whole score
        return replace(result, detail={**result.detail, "grade_error": f"{type(e).__name__}: {e}"})
    det = {k: v for k, v in result.detail.items() if k != "needs_checker"}
    return replace(result, correct=ok, detail={**det, **d})


# ---------------------------------------------------------------- per-item classification

def j3_partial(item: Item, result: Result) -> dict:
    """J3 partial credit: direction right, distance within +-max(25 mm, 15%) of the minimal pass, right opening."""
    out = {"direction_right": None, "distance_in_band": None, "right_opening": None}
    fix = _fix_from(_first(result.detail, "fix")) or reply_fix(item, result.reply)
    good = good_fix(item)
    if fix is None or good is None:
        return out
    gv, fv = _vec(good), _vec(fix)
    axis = max(range(3), key=lambda i: abs(gv[i]))
    if gv[axis] != 0:
        out["direction_right"] = bool(fix.element == good.element and fv[axis] * gv[axis] > 0)
    min_pass = _first(item.truth, "min_pass_m", "min_move_m", default=None)
    if min_pass is None:
        min_pass = _first(result.detail, "min_pass_m", default=None)
    if min_pass is None:
        min_pass = abs(gv[axis])
    min_pass = float(min_pass)
    band = max(BAND_ABS_M, BAND_REL * min_pass)
    out["distance_in_band"] = bool(abs(_norm3(fv) - min_pass) <= band)
    fitting = _first(item.truth, "fitting_openings", default=None)
    if fitting:
        out["right_opening"] = fix.via_opening in fitting
    elif good.via_opening:
        out["right_opening"] = fix.via_opening == good.via_opening
    return out


def classify(item: Item, result: Result | None) -> str | None:
    """Error type for one item (None = correct)."""
    if result is None or (result.reply is None and result.correct is not True):
        return "unparseable"
    if result.correct is True:
        return None
    explicit = _first(result.detail, "error_type", "error")
    if explicit in COST_WEIGHTS:
        return str(explicit)
    if result.correct is None:
        if result.detail.get("needs_checker") or result.detail.get("grade_error"):
            return "ungraded"
        return "unparseable"
    reply, det = result.reply, result.detail
    if item.job == "J1_sort":
        t, r = _truth_kind(item), _reply_kind(reply)
        if r is None:
            return "unparseable"
        if t == "real" and r != "real":
            return "false_clear"
        if t != "real" and r == "real":
            return "false_alarm"
        return "wrong_label"
    if item.job == "J5_review":
        t, r = _first(det, "fix_passed", default=_truth_fix_ok(item)), _reply_approve(reply)
        if r is None:
            return "unparseable"
        if r and t is False:
            return "approved_bad_fix"
        if not r and t is True:
            return "rejected_good_fix"
        return "wrong"
    if item.job == "J3_fix":
        fix = _fix_from(_first(det, "fix")) or reply_fix(item, reply)
        if fix is None:
            return "unparseable"
        good = good_fix(item)
        mover = _first(item.truth, "mover", default=good.element if good else None)
        if mover is not None and fix.element != mover:
            return "wrong_element"
        if _first(det, "new_hits"):
            return "hits_new_element"
        if good is not None:
            gv, fv = _vec(good), _vec(fix)
            axis = max(range(3), key=lambda i: abs(gv[i]))
            if gv[axis] != 0 and fv[axis] * gv[axis] <= 0 and not _first(det, "clash_gone", default=False):
                return "wrong_direction"
        return "too_small"
    return "wrong"


def item_rows(items: list[Item], results: list[Result]) -> list[dict]:
    """One flat row per (item, result): the unit every aggregate is built from."""
    by_id = {it.id: it for it in items}
    rows = []
    for r in results:
        it = by_id.get(r.item_id)
        if it is None:
            continue
        err = classify(it, r)
        row = {
            "item_id": it.id, "base_id": base_id(it.id), "model": r.model, "seed": it.seed, "job": it.job,
            "mode": it.mode, "correct": 1.0 if r.correct is True else 0.0, "parsed": r.reply is not None,
            "error": err, "cost": 0.0 if err is None else COST_WEIGHTS.get(err, 1.0),
            "reason": _first(r.detail, "reason", "why", default=""),
            "latency_s": r.latency_s, "cost_usd": r.cost_usd,
        }
        if it.job == "J3_fix":
            row.update(j3_partial(it, r))
        for k in SLICE_KEYS:
            if k in it.meta:
                row[f"meta_{k}"] = it.meta[k]
        rows.append(row)
    return rows


def base_id(item_id: str) -> str:
    """Item id without its mode suffix, so the same question in different control modes can be paired."""
    for m in ("pictures_text", "no_image", "swapped", "pictures"):
        if item_id.endswith("-" + m):
            return item_id[: -len(m) - 1]
    return item_id


# ---------------------------------------------------------------- slicing

def _scalar(v):
    if isinstance(v, dict):
        nums = [x for x in v.values() if isinstance(x, (int, float))]
        return min(nums) if nums else None
    if isinstance(v, (list, tuple)):
        nums = [x for x in v if isinstance(x, (int, float))]
        return min(nums) if nums else None
    return v


def bucket(key: str, value, all_values: list | None = None) -> str | None:
    v = _scalar(value)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return str(v)
    edges = BUCKET_EDGES.get(key)
    if edges is None:
        nums = sorted(x for x in (_scalar(a) for a in (all_values or [])) if isinstance(x, (int, float)))
        if len(nums) < 3:
            return f"{v:g}"
        edges = [nums[0], nums[len(nums) // 3], nums[2 * len(nums) // 3]]
    lo_i = max((i for i, e in enumerate(edges) if v >= e), default=None)
    if lo_i is None:
        return f"<{edges[0]:g}"
    if lo_i == len(edges) - 1:
        return f">={edges[-1]:g}"
    return f"[{edges[lo_i]:g},{edges[lo_i + 1]:g})"


# ---------------------------------------------------------------- aggregates

def _acc_row(table: str, rows: list[dict], seed: int, **keys) -> dict:
    vals = [r["correct"] for r in rows]
    lo, hi = bootstrap_ci(vals, seed=seed)
    return {"table": table, **keys, "n": len(vals), "accuracy": _mean(vals), "ci_lo": lo, "ci_hi": hi}


def _group(rows: Iterable[dict], *keys) -> dict[tuple, list[dict]]:
    g: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        g[tuple(r.get(k) for k in keys)].append(r)
    return dict(sorted(g.items(), key=lambda kv: tuple(str(x) for x in kv[0])))


def score_rows(items: list[Item], results: list[Result], seed: int = 0, n_boot: int = 1000) -> list[dict]:
    """All tidy score rows (see module doc). Deterministic for a given seed."""
    per = item_rows(items, results)
    out: list[dict] = []

    for (model, job, mode), rs in _group(per, "model", "job", "mode").items():
        out.append(_acc_row("accuracy", rs, seed, model=model, job=job, mode=mode))
    for (model, mode), rs in _group(per, "model", "mode").items():
        out.append(_acc_row("accuracy", rs, seed, model=model, job="ALL", mode=mode))

    for (model, mode), rs in _group([r for r in per if r["job"] == "J3_fix"], "model", "mode").items():
        row = {"table": "partial", "model": model, "job": "J3_fix", "mode": mode, "n": len(rs)}
        for k in ("direction_right", "distance_in_band", "right_opening"):
            vs = [1.0 if r.get(k) else 0.0 for r in rs if r.get(k) is not None]
            row[k] = _mean(vs)
            row[f"{k}_n"] = len(vs)
        out.append(row)

    for key in SLICE_KEYS:
        mk = f"meta_{key}"
        have = [r for r in per if mk in r]
        if not have:
            continue
        allv = [r[mk] for r in have]
        for r in have:
            r["_bucket"] = bucket(key, r[mk], allv)
        for (model, job, mode, b), rs in _group(have, "model", "job", "mode", "_bucket").items():
            if b is None:
                continue
            out.append(_acc_row("slice", rs, seed, model=model, job=job, mode=mode, factor=key, bucket=b))
        for r in have:
            r.pop("_bucket", None)

    for (model, job, mode), rs in _group(per, "model", "job", "mode").items():
        counts = Counter(r["error"] for r in rs if r["error"] is not None)
        for err, c in sorted(counts.items()):
            out.append({"table": "taxonomy", "model": model, "job": job, "mode": mode, "error": err, "count": c,
                        "share_of_items": c / len(rs), "weight": COST_WEIGHTS.get(err, 1.0)})

    for (model, job, mode), rs in _group(per, "model", "job", "mode").items():
        total = sum(r["cost"] for r in rs)
        out.append({"table": "cost", "model": model, "job": job, "mode": mode, "n": len(rs),
                    "accuracy": _mean([r["correct"] for r in rs]), "mean_cost": total / len(rs),
                    "cost_weighted_score": 1.0 - total / (len(rs) * MAX_WEIGHT)})

    for (model, job), rs in _group(per, "model", "job").items():
        pics = {r["base_id"]: r["correct"] for r in rs if r["mode"] == "pictures"}
        if not pics:
            continue
        for mode in CONTROL_MODES:
            ctl = {r["base_id"]: r["correct"] for r in rs if r["mode"] == mode}
            paired = [(pics[b], ctl[b]) for b in ctl if b in pics]
            if not paired:
                continue
            diffs = [c - p for p, c in paired]
            lo, hi = bootstrap_ci(diffs, n_boot=n_boot, seed=seed)
            out.append({"table": "control", "model": model, "job": job, "mode": mode, "n": len(paired),
                        "acc_pictures": _mean([p for p, _ in paired]), "acc_control": _mean([c for _, c in paired]),
                        "delta": _mean(diffs), "ci_lo": lo, "ci_hi": hi})
    return out


# ---------------------------------------------------------------- IO

def write_rows(rows: list[dict], csv_path: Path, jsonl_path: Path | None = None) -> None:
    csv_path = Path(csv_path)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    with csv_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: _cell(r.get(k)) for k in cols})
    if jsonl_path is not None:
        write_jsonl(rows, jsonl_path)


def _cell(v):
    if isinstance(v, float) and math.isnan(v):
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return v


def _json_default(o):
    if hasattr(o, "__dataclass_fields__"):
        return asdict(o)
    if isinstance(o, Path):
        return str(o)
    return str(o)


def write_jsonl(rows: Iterable, path: Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for r in rows:
            d = asdict(r) if hasattr(r, "__dataclass_fields__") else r
            f.write(json.dumps(d, default=_json_default) + "\n")


def read_items(path: Path) -> list[Item]:
    return [Item(**json.loads(l)) for l in Path(path).read_text().splitlines() if l.strip()]


def read_results(path: Path) -> list[Result]:
    return [Result(**json.loads(l)) for l in Path(path).read_text().splitlines() if l.strip()]


def score_run(items: list[Item], results: list[Result], out_dir: Path, scenes_dir: Path | None = None,
              grade_fn: Callable | None = grade, seed: int = 0) -> tuple[list[Result], list[dict]]:
    """Grade (if a checker is around), score, and write scores.csv / scores.jsonl / graded.jsonl / item_scores.jsonl."""
    out_dir = Path(out_dir)
    by_id = {it.id: it for it in items}
    scene_cache: dict[int, Scene | None] = {}

    def scene_for(s: int) -> Scene | None:
        if s not in scene_cache:
            p = Path(scenes_dir) / str(s) / "scene.json" if scenes_dir else None
            scene_cache[s] = Scene.load(p) if p and p.exists() else None
        return scene_cache[s]

    graded = []
    for r in results:
        it = by_id.get(r.item_id)
        graded.append(grade_fn(it, r, scene_for(it.seed)) if (grade_fn and it) else r)
    rows = score_rows(items, graded, seed=seed)
    write_rows(rows, out_dir / "scores.csv", out_dir / "scores.jsonl")
    write_jsonl(graded, out_dir / "graded.jsonl")
    write_jsonl(item_rows(items, graded), out_dir / "item_scores.jsonl")
    return graded, rows
