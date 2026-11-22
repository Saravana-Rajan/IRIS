"""Iris Bench integrity: evidence that the answer key comes from geometry, not from any model.

    check_run(out_dir) -> dict          runs the five checks below and writes out_dir/integrity.json
    write_manifest(out_dir, items)      called by `build` right after items.jsonl: freezes truth + evidence by hash

The five checks (in report order):

1. truth_frozen     Truth and evidence were written before any model call. `build` hashes every item's truth fields
                    (id, seed, job, mode, truth, evidence, categories) and every scene.json into manifest.json. Later
                    the hashes are recomputed: a tampered, added or dropped item, a changed scene, results older than
                    the manifest, results for unknown items, or a result row carrying a "truth" key all fail it.
2. truth_isolated   Truth code never reads model replies. A static `ast` import scan of the modules that compute
                    truth (truth, checker, geom, scenes, and everything they import inside iris_bench) finds no
                    import of the runner, the model client, the scorer/report/cli/export, or any LLM SDK, and no
                    reference to results.jsonl / graded.jsonl.
3. prompts_clean    Pictures-mode prompts name no element kind (beam, duct ...), no element/opening id (e3, o1), no
                    measurement (450 mm) and no coordinates: the model has to read the picture.
4. truth_rederived  For a seeded, job-stratified sample, the reference answer is re-derived from scene.json with the
                    closed-form checker (checker.check_fix, geom.distance, geom.fits) and must equal the stored truth.
5. answer_balance   Per job, the spread of right answers and the chance / always-majority baselines (a warning, not a
                    failure, when one answer dominates).

This module may import spec, geom, checker, jobs (letters -> ids) and truth; never runner, score or report.
"""
from __future__ import annotations

import ast
import hashlib
import json
import random
import re
import time
from collections import Counter, defaultdict
from dataclasses import asdict, fields
from datetime import datetime, timezone
from pathlib import Path

from iris_bench.spec import SCHEMA_VERSION, Element, Fix, Item, Scene

MANIFEST_NAME = "manifest.json"
INTEGRITY_NAME = "integrity.json"
TRUTH_MODULES = ("truth", "checker", "geom", "scenes")
FORBIDDEN_IMPORTS = ("runner", "model_client", "score", "report", "cli", "export", "google.genai", "vertexai",
                     "openai", "anthropic")
FORBIDDEN_KINDS = ("beam", "column", "slab", "duct", "pipe", "tray", "bracket")
RESULT_FILES = ("results.jsonl", "graded.jsonl")
CODE_MODULES = TRUTH_MODULES + ("jobs", "spec")
PACKAGE_DIR = Path(__file__).resolve().parent

_KIND_RE = re.compile(r"\b(" + "|".join(FORBIDDEN_KINDS) + r")s?\b", re.I)
_ID_RE = re.compile(r"\b[eo]\d+\b")
_MEASURE_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mm|cm|m)\b|\bmm\b", re.I)
_TRIPLE_RE = re.compile(r"\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)")
_COORD_RE = re.compile(r"\b[xyz]\s*=\s*-?\d", re.I)

CHECKS = (("truth_frozen", "Truth and evidence written before any model call", "error"),
          ("truth_isolated", "Truth code never reads model replies", "error"),
          ("prompts_clean", "Pictures-mode prompts leak no kinds, ids or measurements", "error"),
          ("truth_rederived", "Reference answers re-derived from scene.json by geometry", "error"),
          ("letters_shown", "Every answer letter is labelled in the item's own pictures", "error"),
          ("answer_balance", "Answer balance and chance baselines", "warn"))


# ---------------------------------------------------------------- reading a run (no score import)

def _sha(data: bytes | str) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def _jsonl(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


_ITEM_FIELDS = {f.name for f in fields(Item)}


def _read_items(path: Path) -> list[Item]:
    return [Item(**{k: v for k, v in d.items() if k in _ITEM_FIELDS}) for d in _jsonl(path)]


def _scene_path(out_dir: Path, seed) -> Path:
    return Path(out_dir) / "scenes" / str(seed) / "scene.json"


def _now_iso(t: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if t is None else t, tz=timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- 1. manifest

def item_digest(item: Item | dict) -> str:
    """sha256 of the fields that make up an item's answer key."""
    d = asdict(item) if hasattr(item, "__dataclass_fields__") else dict(item)
    key = {k: d.get(k) for k in ("id", "seed", "job", "mode", "truth", "evidence", "categories")}
    return _sha(json.dumps(key, sort_keys=True, default=str))


def _items_sha(digests: dict[str, str]) -> str:
    return _sha("\n".join(sorted(digests.values())))


def _code_hashes(package_dir: Path = PACKAGE_DIR) -> dict[str, str]:
    return {m: _sha((package_dir / f"{m}.py").read_bytes()) for m in CODE_MODULES
            if (package_dir / f"{m}.py").exists()}


def write_manifest(out_dir, items: list[Item] | None = None) -> dict:
    """Freeze the answer key: per-item digests, scene hashes and truth-code hashes -> out_dir/manifest.json.
    A rebuild that yields the same answer key keeps the original `built_at` (so earlier results stay valid)."""
    out_dir = Path(out_dir)
    if items is None:
        items = _read_items(out_dir / "items.jsonl")
    digests = {it.id: item_digest(it) for it in items}
    seeds = sorted({it.seed for it in items}, key=str)
    scenes = {str(s): _sha(_scene_path(out_dir, s).read_bytes()) for s in seeds if _scene_path(out_dir, s).exists()}
    built_at = time.time()
    old_p = out_dir / MANIFEST_NAME
    if old_p.exists():
        try:
            old = json.loads(old_p.read_text())
            if old.get("items_sha256") == _items_sha(digests) and old.get("scenes") == scenes:
                built_at = float(old.get("built_at", built_at))
        except (ValueError, TypeError):
            pass
    manifest = {"schema_version": SCHEMA_VERSION, "built_at": built_at, "built_at_iso": _now_iso(built_at),
                "n_items": len(items), "items_sha256": _items_sha(digests), "items": digests, "scenes": scenes,
                "code": _code_hashes()}
    out_dir.mkdir(parents=True, exist_ok=True)
    old_p.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    return manifest


def _check_frozen(out_dir: Path, items: list[Item]) -> tuple[bool, str, dict]:
    mp = out_dir / MANIFEST_NAME
    if not mp.exists():
        return False, "no manifest.json: truth was never frozen at build time (rebuild with `iris-bench build`)", {}
    man = json.loads(mp.read_text())
    stored = man.get("items", {})
    now = {it.id: item_digest(it) for it in items}
    tampered = sorted(i for i in now if i in stored and stored[i] != now[i])
    added = sorted(set(now) - set(stored))
    missing = sorted(set(stored) - set(now))
    changed_scenes, missing_scenes = [], []
    for seed, h in man.get("scenes", {}).items():
        p = _scene_path(out_dir, seed)
        if not p.exists():
            missing_scenes.append(seed)
        elif _sha(p.read_bytes()) != h:
            changed_scenes.append(seed)
    built_at = float(man.get("built_at", 0))
    stale, unknown, leaked = [], set(), []
    for name in RESULT_FILES:
        p = out_dir / name
        if not p.exists():
            continue
        if p.stat().st_mtime + 1e-3 < built_at:
            stale.append(name)
        for row in _jsonl(p):
            if row.get("item_id") not in stored:
                unknown.add(str(row.get("item_id")))
            reply = row.get("reply")
            if "truth" in row or (isinstance(reply, dict) and "truth" in reply):
                leaked.append(str(row.get("item_id")))
    code_now = _code_hashes()
    code_changed = sorted(m for m, h in man.get("code", {}).items() if code_now.get(m) not in (None, h))
    details = {"manifest_built_at": man.get("built_at_iso"), "n_manifest": len(stored), "n_items": len(now),
               "items_sha256_ok": man.get("items_sha256") == _items_sha(now), "tampered": tampered[:50],
               "added": added[:50], "missing": missing[:50], "changed_scenes": changed_scenes,
               "missing_scenes": missing_scenes, "results_older_than_manifest": stale,
               "unknown_result_ids": sorted(unknown)[:50], "truth_in_results": leaked[:50],
               "code_changed_since_build": code_changed}
    problems = []
    if tampered:
        problems.append(f"{len(tampered)} item(s) changed since build: {', '.join(tampered[:5])}")
    if added or missing:
        problems.append(f"{len(added)} added / {len(missing)} missing item(s) vs manifest")
    if changed_scenes or missing_scenes:
        problems.append(f"scene.json changed/missing for seed(s) {', '.join(changed_scenes + missing_scenes)}")
    if stale:
        problems.append(f"{', '.join(stale)} older than the manifest (answers predate the answer key)")
    if unknown:
        problems.append(f"{len(unknown)} result(s) for items not in the manifest")
    if leaked:
        problems.append(f"{len(leaked)} result row(s) carry a 'truth' key")
    if problems:
        return False, "; ".join(problems), details
    note = f" (truth code edited since: {', '.join(code_changed)})" if code_changed else ""
    return True, (f"{len(now)} items and {len(man.get('scenes', {}))} scenes match the build manifest of "
                  f"{man.get('built_at_iso')}; results written after it{note}"), details


# ---------------------------------------------------------------- 2. import scan

def _imports(tree: ast.AST) -> list[tuple[str, int, list[str]]]:
    """(module, level, names) for every import anywhere in the tree (functions included)."""
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out += [(a.name, 0, []) for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            out.append((node.module or "", node.level, [a.name for a in node.names]))
    return out


def _is_forbidden(dotted: str) -> list[str]:
    segs = [s for s in dotted.split(".") if s]
    hits = []
    for f in FORBIDDEN_IMPORTS:
        if "." in f:
            if dotted.lstrip(".") == f or dotted.lstrip(".").startswith(f + ".") or ("." + f + ".") in ("." + dotted + "."):
                hits.append(f)
        elif f in segs:
            hits.append(f)
    return hits


def import_scan(modules=TRUTH_MODULES, package_dir: Path | None = None) -> dict:
    """Static scan: the truth modules (and what they import inside the package) import nothing that sees replies."""
    pkg = Path(package_dir) if package_dir else PACKAGE_DIR
    pkg_name = pkg.name
    queue = [m for m in modules]
    missing = [m for m in modules if not (pkg / f"{m}.py").exists()]
    seen: dict[str, dict] = {}
    while queue:
        mod = queue.pop(0)
        path = pkg / f"{mod}.py"
        if mod in seen or not path.exists():
            continue
        src = path.read_text()
        tree = ast.parse(src, filename=str(path))
        names, local = [], []
        for module, level, imported in _imports(tree):
            prefix = "." * level
            if level and not module:                      # from . import geom, runner
                names += [prefix + n for n in imported]
                local += imported
                continue
            names.append(prefix + module)
            names += [f"{prefix}{module}.{n}" for n in imported if n != "*"]
            head = module.split(".")
            if level == 1 and module:
                local.append(head[0])
            elif level == 0 and head[0] == pkg_name:
                local += [head[1]] if len(head) > 1 else list(imported)
        bad = sorted({f"{n} ({','.join(h)})" for n in names if (h := _is_forbidden(n))})
        reads = any(isinstance(c, ast.Constant) and isinstance(c.value, str) and
                    any(f in c.value for f in RESULT_FILES) for c in ast.walk(tree))
        seen[mod] = {"path": str(path), "imports": sorted(set(names)), "bad": bad, "reads_results": reads}
        queue += [m for m in local if m not in seen and (pkg / f"{m}.py").exists()]
    ok = all(not v["bad"] and not v["reads_results"] for v in seen.values())
    return {"ok": ok, "modules": seen, "missing": missing}


# ---------------------------------------------------------------- 3. prompt leaks

def scan_prompt(prompt: str) -> list[str]:
    """Forbidden tokens in a pictures-mode prompt: element kinds, element/opening ids, measurements, coordinates."""
    hits = []
    for rx in (_KIND_RE, _ID_RE, _MEASURE_RE, _TRIPLE_RE, _COORD_RE):
        hits += [m.group(0) for m in rx.finditer(prompt or "")]
    return list(dict.fromkeys(hits))


# ---------------------------------------------------------------- 4. re-derivation by geometry

def _first(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _fix(d) -> Fix | None:
    if isinstance(d, Fix):
        return d
    if isinstance(d, dict):
        if "fix" in d and isinstance(d["fix"], (dict, Fix)):
            return _fix(d["fix"])
        if "element" in d and any(k in d for k in ("dx", "dy", "dz")):
            return Fix(**{k: d[k] for k in ("element", "dx", "dy", "dz", "via_opening") if k in d})
    return None


def _bool(v) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "y", "a", "good", "valid", "approve", "pass", "passes"):
            return True
        if s in ("false", "no", "n", "b", "bad", "invalid", "reject", "fail", "fails"):
            return False
    return None


def _to_ids(vals, letters: dict) -> set[str]:
    """Letters (or ids) -> element/opening ids, via the item's letter map."""
    return {str(letters.get(str(v), letters.get(str(v).upper(), v))) for v in (vals or [])}


def _pair(item: Item, scene: Scene):
    """The planted pair this item is about: (a, b, Planted | None)."""
    pair = _first(item.truth, "pair", default=None) or _first(item.evidence, "pair", default=None)
    n = item.meta.get("n") if isinstance(item.meta, dict) else None
    planted = None
    if pair and len(pair) == 2:
        planted = next((p for p in scene.planted if {p.a, p.b} == set(pair)), None)
    if planted is None and isinstance(n, int) and 0 <= n < len(scene.planted):
        planted = scene.planted[n]
    if pair and len(pair) == 2:
        return pair[0], pair[1], planted
    if planted is not None:
        return planted.a, planted.b, planted
    return None, None, None


def _checker():
    from iris_bench import checker
    return checker


def _geom():
    from iris_bench import geom
    return geom


def _evidence_check(item: Item, result: dict) -> str | None:
    """A mismatch message when the item's stored check_fix evidence disagrees with a re-run (None = agrees / none)."""
    ev = item.evidence if isinstance(item.evidence, dict) else {}
    cand = [ev] + [v for v in ev.values() if isinstance(v, dict)]
    for d in cand:
        if "passed" in d and "min_clear_m" in d:
            if bool(d["passed"]) != bool(result["passed"]):
                return f"evidence says passed={d['passed']}, re-run says {result['passed']}"
            try:
                if abs(float(d["min_clear_m"]) - float(result["min_clear_m"])) > 1e-4:
                    return f"evidence min_clear_m {d['min_clear_m']} != re-run {result['min_clear_m']}"
            except (TypeError, ValueError):
                pass
            return None
    return None


def _center(el: Element):
    lo, hi = _geom().bbox(el)
    return tuple((a + b) / 2 for a, b in zip(lo, hi))


def _long_axis(el: Element) -> int:
    lo, hi = _geom().bbox(el)
    return max(range(3), key=lambda i: hi[i] - lo[i])


def _relation_holds(scene: Scene, a: str, b: str, rel: str, via: str | None = None) -> bool | None:
    """Geometry check of one Relation (None = not a relation we can measure)."""
    g = _geom()
    try:
        ea, eb = scene.element(a), scene.element(b)
    except StopIteration:
        return None
    rel = str(rel).lower()
    ca, cb = _center(ea), _center(eb)
    directional = {"above": (2, 1), "below": (2, -1), "north_of": (1, 1), "south_of": (1, -1),
                   "east_of": (0, 1), "west_of": (0, -1)}
    if rel in directional:
        ax, sign = directional[rel]
        return (ca[ax] - cb[ax]) * sign > 0
    if rel in ("clashes", "touches", "clear_of"):
        d = g.distance(ea, eb)
        return {"clashes": d < -1e-6, "touches": abs(d) <= 1e-6, "clear_of": d > 1e-6}[rel]
    if rel == "supports":
        return ea.supports == b or eb.supports == a
    if rel == "parallel":
        return _long_axis(ea) == _long_axis(eb)
    if rel == "crosses":
        return _long_axis(ea) != _long_axis(eb)
    if rel == "passes_through" and via:
        owner = next((e for e in scene.elements for o in e.openings if o.id == via), None)
        if owner is None:
            return False
        op = next(o for o in owner.openings if o.id == via)
        return g.passes_through(ea, owner, op)
    return None


def _result(item: Item, status: str, stored, derived, reason: str) -> dict:
    def short(v):
        s = json.dumps(v, default=str, sort_keys=True) if not isinstance(v, str) else v
        return s if len(s) <= 160 else s[:159] + "…"
    return {"status": status, "job": item.job, "item_id": item.id, "stored": short(stored), "derived": short(derived),
            "reason": reason}


def _derive(item: Item, scene: Scene) -> tuple[str, object, object, str]:
    """(status, stored, derived, reason) for one item, from the checker and closed-form geometry."""
    t = item.truth if isinstance(item.truth, dict) else {}
    letters = _first(t, "letters", default={}) or {}
    job = str(item.job)
    ck, g = _checker(), _geom()

    if job.startswith("J1"):
        a, b, _ = _pair(item, scene)
        stored = _first(t, "kind", "label", "clash_kind")
        if a is None or stored is None:
            return "skipped", stored, None, "no pair or kind in truth"
        ea, eb = scene.element(a), scene.element(b)
        d = g.distance(ea, eb)
        if (ea.supports == b or eb.supports == a) and d <= 1e-6:
            kind = "by_design"
        elif d < -1e-6:
            kind = "real"
        else:
            kind = "not_touching"
        return ("match" if kind == stored else "mismatch"), stored, kind, f"signed distance {d * 1000:.1f} mm"

    if job.startswith("J2"):
        a, b, p = _pair(item, scene)
        stored = _first(t, "mover")
        if stored is None and _first(t, "mover_letter") in letters:
            stored = letters[t["mover_letter"]]
        if a is None or stored is None:
            return "skipped", stored, None, "no pair or mover in truth"
        movable = [e for e in (a, b) if scene.element(e).role != "structure" and not scene.element(e).locked]
        derived, why = None, ""
        if len(movable) == 1:
            derived, why = movable[0], "the only element that is neither structure nor locked"
        if p is not None and p.good_fix is not None:
            res = ck.check_fix(scene, p.good_fix)
            if res["passed"] and (derived is None or derived == p.good_fix.element):
                derived, why = p.good_fix.element, (why + "; " if why else "") + "its planted move passes check_fix"
        if derived is None:
            return "skipped", stored, movable, "mover not determined by geometry alone"
        return ("match" if derived == stored else "mismatch"), stored, derived, why

    if job.startswith(("J3", "J5", "J6")):
        fix = None
        if job.startswith("J3"):
            exp = _first(t, "expected")
            if isinstance(exp, dict) and letters:
                try:
                    from iris_bench.jobs import reply_to_fix
                    fix = reply_to_fix(item, exp)
                except Exception:
                    fix = None
            fix = fix or _fix(_first(t, "good_fix", "fix", "expected"))
        else:
            fix = _fix(_first(t, "fix", "proposed", "candidate", "move"))
        if fix is None:
            return "skipped", None, None, "no fix in truth"
        res = ck.check_fix(scene, fix)
        ev = _evidence_check(item, res)
        if ev:
            return "mismatch", asdict(fix), res["reason"], ev
        if job.startswith("J3"):
            return ("match" if res["passed"] else "mismatch"), "reference move passes", res["passed"], res["reason"]
        if job.startswith("J5"):
            stored = _bool(_first(t, "expected_good", "good", "valid", "resolves", "answer", "verdict"))
            if stored is None:
                return "skipped", None, res["passed"], "no verdict in truth"
            derived = res["passed"]
            if "resolves" in t or "resolves_original" in t:   # "does it resolve the original clash" variant
                stored = _bool(_first(t, "resolves_original", "resolves"))
                derived = bool(res["clash_gone"])
            return ("match" if stored == derived else "mismatch"), stored, derived, res["reason"]
        raw = _first(t, "new_clash", "introduces_new", "new_clashes", "has_new", "new_hits", "expected", "answer")
        hits = set(res["new_hits"])
        if isinstance(raw, list):
            stored_ids = _to_ids(raw, letters)
            return ("match" if stored_ids == hits else "mismatch"), sorted(stored_ids), sorted(hits), res["reason"]
        stored = _bool(raw)
        if stored is None:
            return "skipped", raw, bool(hits), "no new-clash verdict in truth"
        return ("match" if stored == bool(hits) else "mismatch"), stored, bool(hits), res["reason"]

    if job.startswith("J4"):
        mover = _first(t, "mover")
        stored = _first(t, "fitting", "fitting_openings", "answer")
        if mover is None or stored is None:
            return "skipped", stored, None, "no mover or fitting list in truth"
        stored_ids = _to_ids(stored if isinstance(stored, list) else [stored], letters)
        el = scene.element(mover)
        # Only the openings the item offered (labelled in its pictures) can be in the answer; older truths without
        # "offered" are judged over every opening in the scene.
        offered = _first(t, "offered")
        pool = _to_ids(offered if isinstance(offered, (list, tuple)) else [offered], letters) \
            if offered is not None else None
        derived = {o.id for owner in scene.elements for o in owner.openings
                   if (pool is None or o.id in pool)
                   and g.fits(el, o, scene.clearance_m, axis=g.through_axis(o, owner))}
        over = f"the {len(pool)} offered opening(s)" if pool is not None else "every opening"
        return ("match" if derived == stored_ids else "mismatch"), sorted(stored_ids), sorted(derived), \
            f"geom.fits with {scene.clearance_m * 1000:.0f} mm clearance, over {over}"

    if job.startswith("J7"):
        cands = _first(t, "candidates", "options", "fixes")
        stored = _first(t, "valid", "valid_numbers", "answer", "expected")
        if not isinstance(cands, list) or stored is None:
            return "skipped", stored, None, "no candidate list in truth"
        derived, reasons = set(), []
        for i, c in enumerate(cands):
            fix = _fix(c)
            if fix is None:
                return "skipped", stored, None, f"candidate {i + 1} has no fix"
            num = int(_first(c, "n", "number", "index", default=i + 1)) if isinstance(c, dict) else i + 1
            res = ck.check_fix(scene, fix)
            reasons.append(f"{num}: {res['reason']}")
            if res["passed"]:
                derived.add(num)
        stored_set = {int(v) for v in (stored if isinstance(stored, list) else [stored]) if str(v).lstrip("-").isdigit()}
        return ("match" if stored_set == derived else "mismatch"), sorted(stored_set), sorted(derived), \
            "; ".join(reasons)

    if job.startswith("J9") and t.get("question") == "passes_opening" and "passes" in t:
        el_id, owner_id, op_id = t.get("element"), t.get("owner"), t.get("opening")
        try:
            el, owner = scene.element(el_id), scene.element(owner_id)
            op = next(o for o in owner.openings if o.id == op_id)
        except StopIteration:
            return "skipped", t.get("passes"), None, "element, owner or opening not in the scene"
        derived = bool(g.passes_through(el, owner, op))
        stored = bool(t["passes"])
        return ("match" if derived == stored else "mismatch"), stored, derived, \
            f"geom.passes_through({el_id}, {owner_id}, {op_id})"

    if job.startswith(("J8", "J9")):
        claims = []
        rels = _first(t, "relations")
        if isinstance(rels, list):
            claims += [r for r in rels if isinstance(r, dict)]
        rel = _first(t, "relation")
        a = _first(t, "a", default=None)
        b = _first(t, "b", default=None)
        pair = _first(t, "pair", default=None)
        if (a is None or b is None) and isinstance(pair, (list, tuple)) and len(pair) == 2:
            a, b = pair
        if isinstance(rel, str) and a is not None and b is not None:
            claims.append({"a": a, "b": b, "relation": rel, "via": _first(t, "via", "via_opening")})
        if not claims:
            return "skipped", None, None, "truth names no measurable relation"
        verdicts = []
        for c in claims:
            ca, cb = _to_ids([c.get("a")], letters).pop(), _to_ids([c.get("b")], letters).pop()
            via = c.get("via")
            via = _to_ids([via], letters).pop() if via else None
            held = _relation_holds(scene, ca, cb, c.get("relation"), via)
            if held is None and scene.relations:
                held = any(r.a == ca and r.b == cb and r.relation == c.get("relation") for r in scene.relations)
            if held is None:
                return "skipped", c, None, f"relation {c.get('relation')!r} not measurable"
            verdicts.append((f"{ca} {c.get('relation')} {cb}", held))
        bad = [v for v, h in verdicts if not h]
        stored = [v for v, _ in verdicts]
        return ("mismatch" if bad else "match"), stored, [v for v, h in verdicts if h], \
            ("geometry disagrees: " + ", ".join(bad)) if bad else "every stated relation holds in the geometry"

    return "skipped", None, None, f"no re-derivation for job {job}"


def rederive(item: Item, scene: Scene) -> dict:
    """Re-derive one item's reference answer from scene geometry and compare with its stored truth. Never raises."""
    try:
        return _result(item, *_derive(item, scene))
    except Exception as e:   # an unexpected truth shape is reported, never fatal
        return _result(item, "skipped", None, None, f"{type(e).__name__}: {e}")


def _sample(items: list[Item], n: int, seed: int) -> list[Item]:
    """Seeded, job-stratified sample (round-robin over jobs) of pictures items."""
    pool = [it for it in items if it.mode == "pictures"] or list(items)
    by_job: dict[str, list[Item]] = defaultdict(list)
    for it in sorted(pool, key=lambda i: i.id):
        by_job[str(it.job)].append(it)
    rng = random.Random(seed)
    for lst in by_job.values():
        rng.shuffle(lst)
    out, k = [], 0
    jobs = sorted(by_job)
    while len(out) < n and any(k < len(by_job[j]) for j in jobs):
        out += [by_job[j][k] for j in jobs if k < len(by_job[j])][: n - len(out)]
        k += 1
    return out


def _check_rederived(out_dir: Path, items: list[Item], sample: int, seed: int) -> tuple[bool, str, dict]:
    cache: dict[str, Scene | None] = {}
    per_job: dict[str, Counter] = defaultdict(Counter)
    mismatches, total = [], Counter()
    for it in _sample(items, sample, seed):
        key = str(it.seed)
        if key not in cache:
            p = _scene_path(out_dir, it.seed)
            cache[key] = Scene.load(p) if p.exists() else None
        sc = cache[key]
        r = rederive(it, sc) if sc is not None else _result(it, "skipped", None, None, "scene.json missing")
        per_job[str(it.job)][r["status"]] += 1
        total[r["status"]] += 1
        if r["status"] == "mismatch":
            mismatches.append(r)
    checked = sum(total.values())
    details = {"checked": checked, "matched": total["match"], "mismatched": total["mismatch"],
               "skipped": total["skipped"], "per_job": {j: dict(c) for j, c in sorted(per_job.items())},
               "mismatches": mismatches[:20], "sample": sample, "seed": seed}
    ok = total["mismatch"] == 0
    summary = f"{total['match']}/{checked} sampled answers re-derived from geometry match"
    if not ok:
        summary += f", {total['mismatch']} mismatch ({', '.join(m['item_id'] for m in mismatches[:3])})"
    if total["skipped"]:
        summary += f", {total['skipped']} skipped"
    return ok, summary, details


# ---------------------------------------------------------------- 4b. answer letters shown in the pictures

_LETTER = re.compile(r"[A-Z]\d*")


def _views_by_image(out_dir: Path, seed) -> dict[str, dict]:
    """Absolute image path -> view row, from scenes/<seed>/views.json and scenes/<seed>/render/views.json."""
    d = (out_dir / "scenes" / str(seed)).resolve()
    out: dict[str, dict] = {}
    for vj in (d / "views.json", d / "render" / "views.json"):
        for v in (_jsonl_or_list(vj) if vj.exists() else []):
            if isinstance(v, dict) and v.get("image"):
                out[str((d / v["image"]).resolve())] = v
    return out


def _jsonl_or_list(path: Path) -> list:
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, list) else []
    except ValueError:
        return []


def _answer_letters(item: Item) -> set[str]:
    """Element/opening letters the reply may give: string enums of the answer fields (not "none")."""
    out: set[str] = set()
    for name, s in ((item.schema or {}).get("properties") or {}).items():
        if name in _META_PROPS or not isinstance(s, dict):
            continue
        enum = s.get("enum") or (s.get("items") or {}).get("enum") or []
        out |= {x for x in enum if isinstance(x, str) and _LETTER.fullmatch(x)}
    return out


def _check_letters_shown(out_dir: Path, items: list[Item]) -> tuple[bool, str, dict]:
    """Every letter a pictures-mode reply may give is labelled in that item's pictures, with the truth's meaning
    (letter -> id). A letter the model cannot see makes the question unanswerable from the pictures."""
    cache: dict[str, dict] = {}
    checked, unknown, bad = 0, 0, []
    for it in items:
        if it.mode != "pictures" or not it.images:
            continue
        key = str(it.seed)
        if key not in cache:
            cache[key] = _views_by_image(out_dir, it.seed)
        rows = [cache[key].get(str(Path(p).resolve())) for p in it.images]
        if any(r is None for r in rows):
            unknown += 1
            continue
        checked += 1
        shown: dict[str, set] = defaultdict(set)
        for r in rows:
            for eid, letter in (r.get("labels") or {}).items():
                shown[letter].add(eid)
        letters = (it.truth or {}).get("letters") or {}
        missing = sorted(x for x in _answer_letters(it) if x not in shown)
        wrong = sorted(x for x in _answer_letters(it) if x in shown and letters.get(x) not in shown[x])
        if missing or wrong:
            bad.append({"item_id": it.id, "not_shown": missing, "other_meaning": wrong})
    ok = not bad
    summary = (f"{checked} pictures items: every answer letter is labelled in their pictures" if ok else
               f"{len(bad)} of {checked} pictures items offer letters their pictures do not show: " +
               "; ".join(f"{b['item_id']} {b['not_shown'] or b['other_meaning']}" for b in bad[:4]))
    if unknown:
        summary += f" ({unknown} items' pictures not found in views.json, not checked)"
    return ok, summary, {"checked": checked, "not_found": unknown, "offending": bad[:30], "n_offending": len(bad)}


# ---------------------------------------------------------------- 5. answer balance

_ANSWER_KEYS = {"J1": ("kind",), "J2": ("mover_letter", "mover"), "J3": ("expected",), "J4": ("fitting",),
                "J5": ("expected_good", "good"), "J6": ("new_clash", "introduces_new", "new_clashes", "has_new"),
                "J7": ("valid", "valid_numbers")}
_META_PROPS = {"confidence", "reason", "reasoning", "explanation"}


def _answer_str(item: Item) -> str:
    t = item.truth if isinstance(item.truth, dict) else {}
    keys = _ANSWER_KEYS.get(str(item.job)[:2], ()) + ("answer", "relation", "expected", "verdict")
    v = _first(t, *keys)
    if isinstance(v, dict):
        v = v.get("direction") or v.get("answer") or json.dumps(v, sort_keys=True)
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, tuple)):   # an order (J8 "order") counts as itself; a set (J4, J7) sorted
        ordered = t.get("question") == "order"
        return ",".join(str(x) for x in (v if ordered else sorted(str(x) for x in v))) or "none"
    return "none" if v is None else str(v)


def _chance(schema: dict) -> float | None:
    """Chance-level accuracy of a uniform random schema-valid reply (categorical fields only)."""
    props = (schema or {}).get("properties", {}) if isinstance(schema, dict) else {}
    p, seen = 1.0, False
    for name, s in props.items():
        if name in _META_PROPS or not isinstance(s, dict):
            continue
        t = s.get("type")
        if "enum" in s:
            p *= 1 / max(1, len(s["enum"]))
            seen = True
        elif t == "boolean" or (isinstance(t, list) and "boolean" in t):
            p *= 0.5
            seen = True
        elif t == "array" and isinstance(s.get("items"), dict) and "enum" in s["items"]:
            p *= 1 / 2 ** len(s["items"]["enum"])
            seen = True
    return p if seen else None


def answer_balance(items: list[Item]) -> list[dict]:
    """Per job (pictures items): how the right answers are spread, the always-majority baseline and chance level."""
    by_job: dict[str, list[Item]] = defaultdict(list)
    for it in items:
        if it.mode == "pictures":
            by_job[str(it.job)].append(it)
    out = []
    for job, its in sorted(by_job.items()):
        counts = Counter(_answer_str(it) for it in its)
        maj, mc = counts.most_common(1)[0]
        ch = [c for c in (_chance(it.schema) for it in its) if c is not None]
        share = mc / len(its)
        out.append({"job": job, "n": len(its), "counts": dict(counts.most_common()), "majority_answer": maj,
                    "majority_share": share, "chance": (sum(ch) / len(ch)) if ch else None,
                    "imbalanced": share > 0.7})
    return out


# ---------------------------------------------------------------- run all checks

def _check_prompts(items: list[Item]) -> tuple[bool, str, dict]:
    scanned, bad = 0, []
    for it in items:
        if it.mode == "pictures_text":
            continue
        scanned += 1
        hits = scan_prompt(it.prompt)
        if hits:
            bad.append({"item_id": it.id, "hits": hits})
    ok = not bad
    summary = (f"{scanned} prompts scanned, none names a kind, id or measurement" if ok else
               f"{len(bad)} of {scanned} prompts leak: " + "; ".join(f"{b['item_id']} {b['hits'][:3]}" for b in bad[:3]))
    return ok, summary, {"scanned": scanned, "offending": bad[:20], "n_offending": len(bad)}


def check_run(out_dir, sample: int = 25, seed: int = 0, write: bool = True) -> dict:
    """Run the five integrity checks on a run folder; write integrity.json when `write`."""
    out_dir = Path(out_dir)
    items = _read_items(out_dir / "items.jsonl")
    outcomes = {}

    def run(name, fn):
        try:
            outcomes[name] = fn()
        except Exception as e:   # a crashing check is a failed check, never a crashed verify
            outcomes[name] = (False, f"check crashed: {type(e).__name__}: {e}", {})

    run("truth_frozen", lambda: _check_frozen(out_dir, items))

    def isolated():
        s = import_scan()
        bad = {m: v["bad"] for m, v in s["modules"].items() if v["bad"]}
        reads = [m for m, v in s["modules"].items() if v["reads_results"]]
        summary = (f"{len(s['modules'])} truth modules ({', '.join(sorted(s['modules']))}) import no runner, model "
                   "client or scorer" if s["ok"] else
                   f"forbidden imports {bad} / reads results: {reads}")
        if s["missing"]:
            summary += f"; not present: {', '.join(s['missing'])}"
        return s["ok"], summary, s
    run("truth_isolated", isolated)
    run("prompts_clean", lambda: _check_prompts(items))
    run("truth_rederived", lambda: _check_rederived(out_dir, items, sample, seed))
    run("letters_shown", lambda: _check_letters_shown(out_dir, items))

    def balance():
        rows = answer_balance(items)
        imb = [r["job"] for r in rows if r["imbalanced"]]
        parts = [f"{r['job']} majority {r['majority_share']:.0%}" +
                 (f" vs chance {r['chance']:.0%}" if r["chance"] is not None else "") for r in rows]
        summary = ("; ".join(parts) or "no pictures items") + (f" — imbalanced: {', '.join(imb)}" if imb else "")
        return not imb, summary, {"jobs": rows}
    run("answer_balance", balance)

    checks = []
    for name, title, sev in CHECKS:
        ok, summary, details = outcomes[name]
        checks.append({"name": name, "title": title, "ok": bool(ok), "severity": sev, "summary": summary,
                       "details": details})
    report = {"ok": all(c["ok"] for c in checks if c["severity"] == "error"), "generated_at": _now_iso(),
              "out_dir": str(out_dir), "n_items": len(items), "checks": checks}
    if write:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / INTEGRITY_NAME).write_text(json.dumps(report, indent=1, default=str))
    return report


def summary_lines(report: dict) -> list[str]:
    """One line per check for the CLI: PASS / FAIL / WARN, title, summary."""
    out = []
    for c in report.get("checks", []):
        status = "PASS" if c["ok"] else ("WARN" if c.get("severity") == "warn" else "FAIL")
        out.append(f"{status} {c['title']}: {c['summary']}")
    out.append(f"integrity: {'OK' if report.get('ok') else 'FAILED'} ({report.get('n_items', 0)} items)")
    return out
