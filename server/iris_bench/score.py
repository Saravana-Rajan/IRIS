"""Iris Bench scoring: turn Items + Results into tidy score rows.

Every row is a flat dict with a `table` key saying which table it belongs to:

- "accuracy":  model x job x mode accuracy with a seeded bootstrap 95% CI
- "category":  model x category x mode accuracy with a bootstrap CI (the eight spec.CATEGORIES; an item counts in each
               of its `categories`, falling back to spec.JOB_CATEGORY[job])
- "partial":   J3 partial credit (direction right, distance in band, right opening)
- "slice":     accuracy per challenge factor bucket (occlusion, density, gap_mm, overlap_mm, visible_px, view, style)
- "taxonomy":  error counts per job and error type
- "cost":      cost-weighted score next to raw accuracy
- "control":   control deltas (no_image / swapped / pictures_text minus pictures), paired by base item

"Sounds reasonable vs geometrically correct" (every reply carries `confidence` 0-1 and a `reason`):

- "calibration":          accuracy per confidence bucket (model x mode)
- "calibration_summary":  coverage, mean confidence, accuracy, ECE, Brier score, overconfidence (model x mode)
- "confidently_wrong":    share of answers given with confidence >= 0.8 that the geometry says are wrong, per category
- "plausible_wrong":      wrong answers whose `reason` names the right element letters / opening / candidates (a lexical
                          check): the reply sounds grounded, the geometry says no. Listed with the checker's verdict.

Grading is the runner's, one rule everywhere: every job but J3 is right when the reply matches truth["expected"]
(runner.grade: schema check, then runner._compare; sets only for "fitting" and "valid", lists otherwise in order).
J3 is the geometry checker on the proposed move. `check_reply(item, reply, scene)` is the runner's `check` hook body
and agrees with runner.grade; for J5/J6/J7 it also re-runs checker.check_fix on the shown fix(es) as extra detail
(detail["geometry"], detail["geometry_agrees"]) that never changes `correct`. `grade(item, result, scene)` regrades a
Result the runner left ungraded through runner.grade with that hook. It is optional: when the checker module is
missing, the Result's own `correct`/`detail` are trusted.
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

import re

from iris_bench.spec import CATEGORIES, JOB_CATEGORY, Fix, Item, Result, Scene

# Illustrative weights only: what each kind of mistake costs on a real job, relative to a harmless false alarm.
# A missed real clash ("false clear") or an approved bad fix reaches site; a too-small move comes back as a re-clash.
COST_WEIGHTS: dict[str, float] = {
    "false_clear": 5.0,
    "approved_bad_fix": 5.0,
    "missed_new_clash": 5.0,
    "too_small": 3.0,
    "hits_new_element": 3.0,
    "wrong_direction": 2.0,
    "wrong_element": 2.0,
    "wrong_opening": 2.0,
    "false_alarm": 1.0,
    "false_new_clash": 1.0,
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

CONF_EDGES = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)   # equal-width confidence buckets for calibration / ECE
CONFIDENT = 0.8                                # "confidently wrong" = confidence >= this and wrong
REVIEW_JOBS = ("J5_review", "J6_new_clash", "J7_pick_valid")   # graded on stored truth; check_fix re-run = detail
GEOMETRY_JOBS = ("J3_fix",) + REVIEW_JOBS   # score.grade regrades these when ungraded, even without needs_checker
SET_JOBS = ("J4_opening", "J7_pick_valid")  # list answers compared as sets (runner.SET_FIELDS: fitting, valid)
_META_KEYS = ("confidence", "reason", "why", "explanation", "rationale")   # reply fields that are not the answer


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


# ---------------------------------------------------------------- categories, confidence, reason

def item_categories(item: Item) -> list[str]:
    """The scored categories of an item: item.categories (known ones, in order), else spec.JOB_CATEGORY[job]."""
    cats = [c for c in (getattr(item, "categories", None) or []) if c in CATEGORIES]
    if cats:
        return list(dict.fromkeys(cats))
    c = JOB_CATEGORY.get(item.job)
    return [c] if c else []


_CONF_WORDS = {"very high": 0.95, "high": 0.85, "medium": 0.6, "moderate": 0.6, "low": 0.3, "very low": 0.1}


def reply_confidence(reply: dict | None) -> float | None:
    """The reply's `confidence` in [0, 1] (percentages and high/medium/low words are mapped; anything else None)."""
    v = _first(reply, "confidence", "certainty", "probability")
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, str):
        s = v.strip().lower().rstrip("%")
        if s in _CONF_WORDS:
            return _CONF_WORDS[s]
        try:
            v = float(s)
        except ValueError:
            return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or x < 0:
        return None
    if x > 1.0:
        x = x / 100.0 if x <= 100.0 else None
    return x


def reply_reason(reply: dict | None) -> str:
    """The reply's free-text `reason` ("" when it gave none)."""
    v = _first(reply, "reason", "why", "explanation", "rationale", default="")
    return v.strip() if isinstance(v, str) else (json.dumps(v) if v else "")


def _compact(v) -> str:
    if isinstance(v, dict):
        return ", ".join(f"{k}={_compact(x)}" for k, x in v.items())
    if isinstance(v, (list, tuple, set)):
        return "[" + ", ".join(_compact(x) for x in v) + "]"
    if isinstance(v, float):
        return f"{v:g}"
    return str(v)


def answer_text(reply: dict | None) -> str:
    """The reply's answer fields as a short string (confidence and reason left out)."""
    if not isinstance(reply, dict):
        return "" if reply is None else str(reply)
    return _compact({k: v for k, v in reply.items() if k not in _META_KEYS})


def _letters_of(item: Item) -> dict[str, str]:
    """element/opening id -> letter shown in the pictures (from truth["letters"], letter -> id)."""
    lt = _first(item.truth, "letters", default={}) or {}
    out = {v: k for k, v in lt.items() if isinstance(v, str)} if isinstance(lt, dict) else {}
    for k, v in (_first(item.truth, "labels", default={}) or {}).items():
        out.setdefault(k, v)
    return out


def _truth_bool(item: Item, *keys) -> bool | None:
    return _norm_approve(_first(item.truth, *keys))


def _num_set(v) -> set[int] | None:
    """1-based candidate numbers from a reply/truth value: [1, 3], "1,3", ["cand_2"], 2 -> {2}."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return {int(v)}
    if isinstance(v, str):
        return {int(x) for x in re.findall(r"\d+", v)}
    if isinstance(v, (list, tuple, set)):
        out: set[int] = set()
        for x in v:
            s = _num_set(x)
            if s is None:
                return None
            out |= s
        return out
    return None


def _exp_field(item: Item, name: str):
    """truth["expected"][name] (None when absent)."""
    exp = item.truth.get("expected") if isinstance(item.truth, dict) else None
    return exp.get(name) if isinstance(exp, dict) else None


def _j5_truth(item: Item) -> bool | None:
    """Does the shown fix resolve the ORIGINAL clash (Resolution.resolves_original)? Truths from before the J5
    question changed carry only expected_good (the whole fix passes), read as a last resort."""
    v = _first(item.truth, "resolved", "resolves_original", "resolves")
    if v is None:
        v = _exp_field(item, "resolved")
    return _norm_approve(v) if v is not None else _truth_fix_ok(item)


def _j5_reply(reply: dict | None) -> bool | None:
    v = _first(reply, "resolved", "resolves", "resolves_original")
    return _norm_approve(v) if v is not None else _reply_approve(reply)


def _j6_truth(item: Item) -> bool | None:
    v = _first(item.truth, "new_clash", "introduces_new", "introduces_new_clash", "expected_new")
    if v is None:
        v = _exp_field(item, "new_clash")
    if v is None:
        v = _first(item.truth, "answer")
    return _norm_approve(v)


def _j6_reply(reply: dict | None) -> bool | None:
    v = _first(reply, "new_clash", "introduces_new", "introduces_new_clash", "new_clashes", "answer", "verdict")
    if isinstance(v, list):
        return bool(v)
    return _norm_approve(v)


def _j7_truth(item: Item) -> set[int] | None:
    v = _first(item.truth, "valid", "valid_candidates")
    if v is None:
        v = _exp_field(item, "valid")
    if v is None:
        v = _first(item.truth, "answer")
    return _num_set(v)


def _j7_reply(reply: dict | None) -> set[int] | None:
    return _num_set(_first(reply, "valid", "valid_candidates", "answer", "candidates", "choices"))


def j7_candidates(item: Item) -> list[Fix]:
    """The candidate fixes a J7 item shows, in order (candidate 1 first)."""
    raw = _first(item.truth, "candidates", "fixes", "options", default=[]) or []
    out = []
    for c in raw:
        f = _fix_from(c.get("fix") if isinstance(c, dict) and "fix" in c else c)
        if f is not None:
            out.append(f)
    return out


def _norm_answer(v, as_set: bool = False):
    """A comparable form of an answer: strings case/space-folded; lists kept in order (an order question's answer is
    its order) unless `as_set` (J4 fitting, J7 valid) or the value is a set."""
    if isinstance(v, (list, tuple, set)):
        xs = [str(x).strip().lower() for x in v]
        return sorted(xs) if as_set or isinstance(v, set) else xs
    if isinstance(v, str):
        return v.strip().lower().replace("-", "_").replace(" ", "_")
    return v


def _set_field(item: Item, key: str) -> bool:
    return key in ("fitting", "valid") or item.job in SET_JOBS


def _generic_grade(item: Item, reply: dict | None) -> tuple[bool | None, dict]:
    """Exact comparison of the reply's answer with the truth's, for truths runner.grade cannot read (no "expected"):
    J8/J9 and anything jobs.py adds later. Lists compare in order, except J4/J7's sets."""
    t = _first(item.truth, "answer", "expected", "relation", "letter", "letters_answer")
    if t is None:
        return None, {"needs_checker": True, "reason": "no reference answer in truth"}
    if isinstance(t, dict):   # a reply-form reference: every field must match
        if not isinstance(reply, dict):
            return False, {"error": "unparseable", "reason": "reply is not an object"}
        ok = all(_norm_answer(reply.get(k), _set_field(item, k)) == _norm_answer(v, _set_field(item, k))
                 for k, v in t.items())
        return ok, {"reason": f"reference {_compact(t)}; reply {answer_text(reply)}"}
    key = next((k for k in ("answer", "relation", "letter", "choice", "element") if isinstance(reply, dict) and
                k in reply), None)
    if key is None:
        rest = {k: v for k, v in (reply or {}).items() if k not in _META_KEYS}
        if len(rest) != 1:
            return False, {"error": "unparseable", "reason": "reply has no answer field"}
        key = next(iter(rest))
    r = reply[key]
    as_set = _set_field(item, key)
    ok = _norm_answer(r, as_set) == _norm_answer(t, as_set)
    return ok, {"reason": f"reference {_compact(t)}; reply {_compact(r)}"}


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


def _truth_expected(item: Item) -> dict | None:
    """The reply a perfect model gives, without confidence/reason: truth["expected"], else one derived from an older
    truth's own keys (J5 resolved, J6 new_clash, J7 valid, J1 binary clash, J8 order, J9 relation/passes, then the
    runner's legacy J1/J2/J4/J5 forms). None when the truth does not say."""
    t = item.truth if isinstance(item.truth, dict) else {}
    if isinstance(t.get("expected"), dict):
        return t["expected"]
    job = item.job
    if job == "J5_review":
        v = _first(t, "resolved", "resolves_original", "resolves")
        if isinstance(v, bool):
            return {"resolved": v}
    elif job == "J6_new_clash":
        v = _first(t, "new_clash", "introduces_new", "introduces_new_clash", "expected_new")
        if isinstance(v, bool):
            return {"new_clash": v}
    elif job == "J7_pick_valid":
        v = _num_set(_first(t, "valid", "valid_candidates"))
        if v is not None:
            return {"valid": sorted(v)}
    elif job == "J1_sort" and t.get("question") == "binary" and isinstance(t.get("clash"), bool):
        return {"clash": t["clash"]}
    elif job == "J8_spatial" and t.get("question") == "order" and isinstance(t.get("answer"), list):
        return {"order": list(t["answer"])}
    elif job == "J9_relation":
        if isinstance(t.get("passes"), bool):
            return {"passes": t["passes"]}
        if isinstance(t.get("relation"), str):
            return {"relation": t["relation"]}
    try:
        from iris_bench import runner  # type: ignore
        return runner._legacy_expected(item)
    except Exception:
        return None


def _truth_grade(item: Item, reply: dict) -> tuple[bool | None, dict]:
    """Correctness from the stored reference answer, decided exactly as runner.grade decides it: the schema check
    (off-schema -> None), then runner._compare on truth["expected"] (sets only for "fitting"/"valid"). A truth from
    before "expected" existed gets one derived from its own keys; with none, an exact comparison (_generic_grade)."""
    from iris_bench import runner  # type: ignore
    exp = _truth_expected(item)
    it = item
    if exp is not None and item.truth.get("expected") is not exp:
        it = replace(item, truth={**item.truth, "expected": exp})
    try:
        ok, d = runner.grade(it, reply, None)
    except (KeyError, TypeError, AttributeError):   # a legacy truth the runner cannot read
        ok, d = None, {"needs_checker": True}
    if ok is None and d.get("needs_checker"):
        ok2, d2 = _generic_grade(item, reply)
        return ok2, {**{k: v for k, v in d.items() if k != "needs_checker"}, **d2}
    return ok, d


def _geo_of(d: dict, item: Item) -> dict:
    return {"passed": bool(d.get("passed")), "clash_gone": bool(d.get("clash_gone")),
            "new_hits": list(d.get("new_hits") or []), "min_clear_m": d.get("min_clear_m"),
            "reason": letterize(str(d.get("reason", "")), item)}


def review_detail(item: Item, reply: dict | None, scene: Scene | None) -> dict:
    """J5/J6/J7 extra detail, never a grade: the reference answer, checker.check_fix re-run on the shown fix(es)
    ("geometry": passed, clash_gone, new_hits, min_clear_m, letterized reason; J7: the candidates it passes as
    "valid"), whether that re-run agrees with the stored truth ("geometry_agrees": J5 clash_gone vs resolved, J6 new
    hits vs new_clash, J7 passing candidates vs valid; None when either side is missing), and a "reason" naming the
    reference and the checker's words (ids followed by their picture letters)."""
    if item.job not in REVIEW_JOBS:
        return {}
    t = item.truth if isinstance(item.truth, dict) else {}
    try:
        from iris_bench import checker  # type: ignore
    except Exception:
        checker = None
    clear_mm = f"{scene.clearance_m * 1000:.0f}" if scene is not None else "?"
    try:
        if item.job in ("J5_review", "J6_new_clash"):
            j5 = item.job == "J5_review"
            want = _j5_truth(item) if j5 else _j6_truth(item)
            ref = ("no reference" if want is None else
                   ("resolves the original clash" if want else "does not resolve the original clash") if j5 else
                   ("new clash" if want else "no new clash"))
            out = {("resolved" if j5 else "new_clash"): want}
            fix = _fix_from(_first(t, "fix"))
            if scene is None or fix is None or checker is None:
                return {**out, "geometry": None, "geometry_agrees": None, "reason": f"reference: {ref}"}
            d = checker.check_fix(scene, fix)
            geo = _geo_of(d, item)
            said = geo["clash_gone"] if j5 else bool(geo["new_hits"])
            if j5:
                why = f"fix {'passes' if d['passed'] else 'fails'}: {d.get('reason', '')}"
            elif geo["new_hits"]:
                why = f"move hits {', '.join(geo['new_hits'])} (new, within {clear_mm} mm)"
            else:
                why = (f"nothing new within {clear_mm} mm; least clearance "
                       f"{(d.get('min_clear_m') or 0) * 1000:.0f} mm")
            return {**out, "geometry": geo, "geometry_agrees": None if want is None else said == want,
                    "reason": letterize(f"reference: {ref}; checker: {why}", item)}
        want = _j7_truth(item)
        picked = _j7_reply(reply) or set()
        cands = j7_candidates(item)
        verdicts = [checker.check_fix(scene, f) for f in cands] if scene is not None and cands and checker else []
        geo = None
        if verdicts:
            geo = {"valid": [i + 1 for i, d in enumerate(verdicts) if d["passed"]],
                   "candidates": [{"n": i + 1, **_geo_of(d, item)} for i, d in enumerate(verdicts)]}
        bits = []
        for k in sorted(picked | (want or set())):
            d = verdicts[k - 1] if 0 < k <= len(verdicts) else None
            if cands and not 0 < k <= len(cands):
                bits.append(f"{k}: no such candidate")
            elif want is not None and k in picked and k not in want:
                bits.append(f"picked {k}, invalid" + (f": {d['reason']}" if d else ""))
            elif want is not None and k in want and k not in picked:
                bits.append(f"missed {k}, valid" +
                            (f" (least clearance {(d.get('min_clear_m') or 0) * 1000:.0f} mm)" if d else ""))
        why = "; ".join(bits) or (f"valid {sorted(want) or 'none'}: all picked right" if want is not None else
                                  "no reference")
        return {"geometry": geo, "geometry_agrees": None if geo is None or want is None else set(geo["valid"]) == want,
                "reason": letterize(why, item)}
    except Exception as e:   # a checker problem costs the detail, never the grade
        return {"geometry": None, "geometry_agrees": None, "geometry_error": f"{type(e).__name__}: {e}"}


def check_reply(item: Item, reply: dict, scene: Scene | None) -> tuple[bool | None, dict]:
    """The runner's `check(item, reply)` hook body, agreeing with runner.grade on every job.
    J3: check_fix on the reply's move (plus the minimal passing distance for partial credit), the only job the
    geometry grades. Every other job: the stored reference answer, exactly as runner.grade decides it (J5 against
    truth "resolved" = Resolution.resolves_original, J6 against "new_clash", J7 against "valid"). For J5/J6/J7 the
    checker is re-run on the shown fix(es) as extra detail (`review_detail`), which never changes `correct`."""
    if item.job == "J3_fix":
        from iris_bench import checker  # type: ignore
        if scene is None:
            return None, {"needs_checker": True, "reason": "scene not found"}
        fix = reply_fix(item, reply)
        if fix is None:
            return False, {"error": "unparseable", "reason": "reply did not name a usable move"}
        d = dict(checker.check_fix(scene, fix))
        d["fix"] = asdict(fix)
        d["reason"] = letterize(d.get("reason", ""), item)
        g = good_fix(item)
        if g is not None:
            try:
                mp = min_passing_distance(scene, g)
                if mp is not None:
                    d["min_pass_m"] = round(mp, 4)
            except Exception:
                pass
        return bool(d["passed"]), d
    ok, d = _truth_grade(item, reply)
    if item.job in REVIEW_JOBS and ok is not None:
        d = {**d, **review_detail(item, reply, scene)}
    return ok, d


_ID_RE = re.compile(r"\b([eo]\d+)\b")


def letterize(text: str, item: Item) -> str:
    """Add the picture letter after each element/opening id in a checker reason: "to e1" -> "to e1 [B]"."""
    lt = _letters_of(item)
    if not lt or not text:
        return text
    return _ID_RE.sub(lambda m: f"{m.group(1)} [{lt[m.group(1)]}]" if m.group(1) in lt else m.group(1), text)


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
    """Grade a Result the runner left ungraded (correct None with a reply, e.g. detail.needs_checker for J3), through
    runner.grade itself with the check hook bound to `scene`, so schema handling (off-schema -> None) and every
    comparison are the runner's. Already-graded J5/J6/J7 results keep their `correct` and gain `review_detail`; other
    graded or reply-less results pass through. Unchanged when the checker or runner module is unavailable."""
    if result.reply is None:
        return result
    if result.correct is not None:
        # graded by the runner: J5/J6/J7 still get the checker's re-run beside the verdict (detail only, never a
        # change of `correct`), so the report can show the geometry's reason and whether it agrees with the truth
        if item.job not in REVIEW_JOBS or "geometry" in (result.detail or {}):
            return result
        try:
            return replace(result, detail={**result.detail, **review_detail(item, result.reply, scene)})
        except Exception:
            return result
    if not result.detail.get("needs_checker") and item.job not in GEOMETRY_JOBS:
        return result
    try:
        from iris_bench import checker  # noqa: F401  # type: ignore
        from iris_bench import runner  # type: ignore
    except Exception:
        return result
    try:
        ok, d = runner.grade(item, result.reply, check=lambda i, r: check_reply(i, r, scene))
        if item.job in REVIEW_JOBS and ok is not None and "geometry" not in d:
            d = {**d, **review_detail(item, result.reply, scene)}
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
    if item.job == "J5_review":   # the reference is the truth's "resolved", never the checker re-run
        t, r = _j5_truth(item), _j5_reply(reply)
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
    if item.job == "J6_new_clash":
        t, r = _j6_truth(item), _j6_reply(reply)
        if t is None:
            t = _norm_approve(_first(det, "new_clash"))
        if r is None:
            return "unparseable"
        if t is True and not r:
            return "missed_new_clash"
        if t is False and r:
            return "false_new_clash"
        return "wrong"
    if item.job == "J7_pick_valid":
        t, r = _j7_truth(item), _j7_reply(reply)
        if t is None:
            t = _num_set(_first(det, "valid"))
        if r is None:
            return "unparseable"
        if t is not None and r - t:
            return "approved_bad_fix"
        if t is not None and t - r:
            return "rejected_good_fix"
        return "wrong"
    if item.job == "J2_who_moves":
        return "wrong_element"
    if item.job == "J4_opening":
        return "wrong_opening"
    return "wrong"


# ---------------------------------------------------------------- sounds reasonable vs geometrically correct

def truth_text(item: Item) -> str:
    """The reference answer as a short string, in the reply's vocabulary where it can be."""
    t = item.truth
    if item.job == "J1_sort":
        return str(_truth_kind(item) or "")
    if item.job == "J2_who_moves":
        return str(_first(t, "mover_letter", "answer", default="") or "")
    if item.job == "J3_fix":
        e = _first(t, "expected", "good_fix")
        return _compact(e) if e is not None else ""
    if item.job == "J4_opening":
        f = _first(t, "fitting", "answer")
        return _compact(f) if f is not None else ""
    if item.job == "J5_review":
        g = _j5_truth(item)
        return "" if g is None else ("resolved" if g else "not resolved") + \
            (f" ({t['variant']})" if t.get("variant") else "")
    if item.job == "J6_new_clash":
        g = _j6_truth(item)
        return "" if g is None else ("new clash" if g else "no new clash")
    if item.job == "J7_pick_valid":
        v = _j7_truth(item)
        return "" if v is None else f"valid {sorted(v)}"
    a = _first(t, "answer", "expected", "relation")
    return "" if a is None else _compact(a)


def _letter_list(v) -> list[str]:
    vals = v if isinstance(v, (list, tuple, set)) else [v]
    return [str(x) for x in vals if isinstance(x, str) and re.fullmatch(r"[A-Z]", x.strip())]


def answer_tokens(item: Item) -> list[str]:
    """What a reason must name to be 'about the right thing': the picture letters of the element(s) / opening(s) the
    reference answer is about (J7: the valid candidate numbers; J9: the relation words too)."""
    t, lt = item.truth, _letters_of(item)
    ids = lambda xs: [lt[x] for x in xs if isinstance(x, str) and x in lt]   # noqa: E731
    if item.job == "J1_sort":
        out = ids(_first(t, "pair", default=[]) or [])
        return out or _letter_list(list((item.meta.get("visible_px") or {}).keys()))
    if item.job == "J2_who_moves":
        return _letter_list(_first(t, "mover_letter")) or ids([_first(t, "mover")])
    if item.job == "J3_fix":
        e = _first(t, "expected", default={}) or {}
        out = _letter_list([e.get("element"), e.get("via_opening")]) if isinstance(e, dict) else []
        return out or ids([_first(t, "mover")])
    if item.job == "J4_opening":
        return _letter_list(_first(t, "fitting", default=[]) or [])
    if item.job in ("J5_review", "J6_new_clash"):
        hits = ids(_first(t, "new_hits", "hits", default=[]) or []) if item.job == "J6_new_clash" else []
        fix = _fix_from(_first(t, "fix"))
        return hits or (ids([fix.element]) if fix else [])
    if item.job == "J7_pick_valid":
        v = _j7_truth(item)
        return [str(n) for n in sorted(v)] if v else []
    a = _first(t, "answer", "expected")
    out = _letter_list(a)
    if item.job == "J9_relation":
        rel = _first(t, "relation")
        if isinstance(rel, str):
            out.append(rel.replace("_", " "))
    if not out and isinstance(a, str):
        out = [a.replace("_", " ")]
    return out


_VERBISH = re.compile(r"is|was|has|had|can|could|should|must|will|would|may|might|does|did|needs|need|stays|"
                      r"moves|move|sits|goes|runs|lies|[a-z]+(?<!ss)(?<!us)(?<!is)s")


def mentioned(token: str, text: str) -> bool:
    """Lexical check: does `text` name `token`? Letters as standalone capitals (a sentence-opening article "A ..." does
    not count), numbers only as "candidate 2" / "option 2" / "#2", words case-insensitively."""
    if not token or not text:
        return False
    if token.isdigit():
        return re.search(rf"(?:candidate|cand|option|fix|proposal|solution|choice|move|number|no\.?|#)\s*_?"
                         rf"{token}(?!\d)", text, re.I) is not None
    if re.fullmatch(r"[A-Z]", token):
        for m in re.finditer(rf"(?<![\w'’]){token}(?![\w'’])", text):
            before = text[: m.start()].rstrip()
            after = text[m.end():]
            sentence_start = not before or before[-1] in ".!?\n"
            nxt = re.match(r"\s+([a-z]+)", after)
            if sentence_start and token in "AI" and nxt and not _VERBISH.fullmatch(nxt.group(1)):
                continue   # an article or pronoun: "A duct runs ...", "I think ..." (but "A moves up" names A)
            return True
        return False
    return re.search(rf"\b{re.escape(token)}\b", text, re.I) is not None


def reason_mentions(item: Item, text: str) -> list[str]:
    return [tok for tok in answer_tokens(item) if mentioned(tok, text)]


def geometry_verdict(item: Item, result: Result | None) -> str:
    """The checker's reason for this result, else the reference answer and how it was established (item.evidence)."""
    why = _first(result.detail if result else None, "reason", "why", default="")
    if why and why != "ok":
        return str(why)
    ev = item.evidence if isinstance(getattr(item, "evidence", None), dict) else {}
    ev_txt = _first(ev, "reason", "summary", "why", default="")
    if not ev_txt and ev:
        ev_txt = _compact({k: v for k, v in list(ev.items())[:4] if not isinstance(v, (dict, list))})
    ref = truth_text(item)
    parts = [f"reference: {ref}" if ref else "", letterize(str(ev_txt), item) if ev_txt else "",
             "checker: ok" if why == "ok" else ""]
    return "; ".join(p for p in parts if p)


def item_rows(items: list[Item], results: list[Result]) -> list[dict]:
    """One flat row per (item, result): the unit every aggregate is built from."""
    by_id = {it.id: it for it in items}
    rows = []
    for r in results:
        it = by_id.get(r.item_id)
        if it is None:
            continue
        err = classify(it, r)
        cats = item_categories(it)
        model_reason = reply_reason(r.reply)
        ments = reason_mentions(it, model_reason) if r.reply is not None else []
        toks = answer_tokens(it) if model_reason else []
        row = {
            "item_id": it.id, "base_id": base_id(it.id), "model": r.model, "seed": it.seed, "job": it.job,
            "mode": it.mode, "correct": 1.0 if r.correct is True else 0.0, "parsed": r.reply is not None,
            "error": err, "cost": 0.0 if err is None else COST_WEIGHTS.get(err, 1.0),
            "reason": _first(r.detail, "reason", "why", default=""),
            "latency_s": r.latency_s, "cost_usd": r.cost_usd,
            "category": cats[0] if cats else None, "categories": cats,
            "confidence": reply_confidence(r.reply), "model_reason": model_reason,
            "answer": answer_text(r.reply), "truth_answer": truth_text(it),
            "checker_reason": geometry_verdict(it, r), "mentions": ments,
            "plausible": bool(r.correct is False and r.reply is not None and toks and len(ments) == len(toks)),
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
    out += category_rows(per, seed)

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
    out += calibration_rows(per)
    out += confidently_wrong_rows(per)
    out += plausible_wrong_rows(per)
    return out


# ---------------------------------------------------------------- categories and calibration

def _by_category(per: list[dict]) -> list[dict]:
    """Rows fanned out to one copy per scored category (an item in two categories counts in both)."""
    return [{**r, "_cat": c} for r in per for c in (r.get("categories") or [])]


def category_rows(per: list[dict], seed: int = 0) -> list[dict]:
    """model x category x mode accuracy with bootstrap CIs, categories in spec.CATEGORIES order."""
    order = {c: i for i, c in enumerate(CATEGORIES)}
    out = []
    groups = _group(_by_category(per), "model", "_cat", "mode")
    for (model, cat, mode), rs in sorted(groups.items(), key=lambda kv: (str(kv[0][0]), order.get(kv[0][1], 99),
                                                                          str(kv[0][2]))):
        jobs = ",".join(sorted({r["job"] for r in rs}))
        out.append(_acc_row("category", rs, seed, model=model, category=cat, mode=mode, jobs=jobs))
    return out


def _graded_conf(rs: list[dict]) -> list[dict]:
    """Rows that carry a confidence and a geometry verdict (ungraded items are not charged either way)."""
    return [r for r in rs if r.get("confidence") is not None and r.get("error") != "ungraded"]


def _bucket_of(c: float) -> int:
    for i in range(len(CONF_EDGES) - 1):
        if c < CONF_EDGES[i + 1]:
            return i
    return len(CONF_EDGES) - 2


def ece(confs: list[float], correct: list[float]) -> float:
    """Expected calibration error over the CONF_EDGES buckets: sum_b n_b/N * |accuracy_b - mean confidence_b|."""
    n = len(confs)
    if n == 0:
        return math.nan
    bins: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for c, k in zip(confs, correct):
        bins[_bucket_of(c)].append((c, k))
    return sum(len(b) / n * abs(_mean([k for _, k in b]) - _mean([c for c, _ in b])) for b in bins.values())


def calibration_rows(per: list[dict]) -> list[dict]:
    """Per model x mode: accuracy per confidence bucket ("calibration") and a summary with ECE and Brier score."""
    out = []
    for (model, mode), rs in _group(per, "model", "mode").items():
        cr = _graded_conf(rs)
        confs, corr = [r["confidence"] for r in cr], [r["correct"] for r in cr]
        for i in range(len(CONF_EDGES) - 1):
            lo, hi = CONF_EDGES[i], CONF_EDGES[i + 1]
            b = [(c, k) for c, k in zip(confs, corr) if _bucket_of(c) == i]
            if not b:
                continue
            mc, acc = _mean([c for c, _ in b]), _mean([k for _, k in b])
            out.append({"table": "calibration", "model": model, "mode": mode, "bucket": f"{lo:.1f}-{hi:.1f}",
                        "lo": lo, "hi": hi, "n": len(b), "mean_conf": mc, "accuracy": acc, "gap": mc - acc})
        mc, acc = _mean(confs), _mean(corr)
        out.append({"table": "calibration_summary", "model": model, "mode": mode, "n": len(rs), "n_conf": len(cr),
                    "coverage": len(cr) / len(rs) if rs else math.nan, "mean_conf": mc, "accuracy": acc,
                    "ece": ece(confs, corr),
                    "brier": _mean([(c - k) ** 2 for c, k in zip(confs, corr)]),
                    "overconfidence": mc - acc if cr else math.nan})
    return out


def confidently_wrong_rows(per: list[dict], threshold: float = CONFIDENT) -> list[dict]:
    """Per model x mode x category (and "ALL"): how often the model is sure (confidence >= threshold) and wrong."""
    out = []
    order = {c: i for i, c in enumerate(CATEGORIES)}

    def row(model, mode, cat, rs):
        cr = _graded_conf(rs)
        sure = [r for r in cr if r["confidence"] >= threshold]
        cw = [r for r in sure if r["correct"] != 1.0]
        return {"table": "confidently_wrong", "model": model, "mode": mode, "category": cat, "n": len(rs),
                "n_conf": len(cr), "n_confident": len(sure), "n_cw": len(cw),
                "rate": len(cw) / len(cr) if cr else math.nan,
                "share_of_confident": len(cw) / len(sure) if sure else math.nan, "threshold": threshold}

    groups = _group(_by_category(per), "model", "mode", "_cat")
    for (model, mode, cat), rs in sorted(groups.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]),
                                                                          order.get(kv[0][2], 99))):
        out.append(row(model, mode, cat, rs))
    for (model, mode), rs in _group(per, "model", "mode").items():
        out.append(row(model, mode, "ALL", rs))
    return out


def plausible_wrong_rows(per: list[dict]) -> list[dict]:
    """Wrong answers whose stated reason names the right element letters / opening / candidates, with the checker's
    verdict beside it. Most confident first."""
    pw = [r for r in per if r.get("plausible")]
    pw.sort(key=lambda r: (-(r.get("confidence") if r.get("confidence") is not None else -1.0), r["item_id"]))
    return [{"table": "plausible_wrong", "model": r["model"], "mode": r["mode"], "item_id": r["item_id"],
             "job": r["job"], "category": r.get("category"), "confidence": r.get("confidence"),
             "model_reason": r.get("model_reason", ""), "checker_reason": r.get("checker_reason", ""),
             "answer": r.get("answer", ""), "truth_answer": r.get("truth_answer", ""),
             "mentions": r.get("mentions", []), "error": r.get("error")} for r in pw]


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
