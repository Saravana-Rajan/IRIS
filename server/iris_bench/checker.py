"""The answer checker for Iris Bench: what is true about each job's answer, from closed-form geometry (geom.py), never
from a model. `crosscheck_engine` checks that geometry against Iris's own IFC engine (detection and verify.check).
"""
from __future__ import annotations

import json
from pathlib import Path

from . import geom
from .spec import Element, Fix, Planted, Scene

NO_NEIGHBOUR_M = 1e6        # min_clear_m when there is nothing else in the scene

# Engine crosscheck tolerances (metres). Boxes: both sides are exact (separating axes / box clearance), so 2 mm covers
# float noise and the engine's 2 mm intersection tolerance. Anything round, or a beam with openings, is triangulated
# by the engine (a cylinder as a polygon, its gap read off triangles, a cut web's depth estimated by the BVH
# intersection figure or the box depth), so it gets 10 mm.
TOL_BOX_M = 0.002
TOL_ROUND_M = 0.010
# verify.check only reports neighbours within SEARCH_M (0.5 m) of the moved element, and gaps only up to that.
ENGINE_SEARCH_M = 0.5


def _norm(s) -> str | None:
    if s is None:
        return None
    return str(s).strip().lower().replace("-", "_").replace(" ", "_")


def _own_supports(scene: Scene, eid: str) -> set[str]:
    """Brackets that carry `eid` (they touch it by design, so a move of it ignores them)."""
    return {e.id for e in scene.elements if e.kind == "bracket" and e.supports == eid}


def _ignored(scene: Scene, mover: Element) -> set[str]:
    ignore = _own_supports(scene, mover.id) | {mover.id}
    if mover.kind == "bracket" and mover.supports:
        ignore.add(mover.supports)
    return ignore


def _partners(scene: Scene, eid: str) -> list[str]:
    """The elements `eid` really clashes with, as planted."""
    out = []
    for p in scene.planted:
        if p.kind == "real" and eid in (p.a, p.b):
            out.append(p.b if p.a == eid else p.a)
    return out


def _opening_owner(scene: Scene, opening_id: str):
    for e in scene.elements:
        for o in e.openings:
            if o.id == opening_id:
                return e, o
    return None, None


def directions(fix: Fix) -> list[str]:
    """The compass/vertical directions a fix moves in (+X east, +Y north, +Z up), for Element.allowed_moves."""
    out = []
    for v, pos, neg in ((fix.dx, "east", "west"), (fix.dy, "north", "south"), (fix.dz, "up", "down")):
        if v > 1e-9:
            out.append(pos)
        elif v < -1e-9:
            out.append(neg)
    return out


def check_fix(scene: Scene, fix: Fix) -> dict:
    """Apply `fix` and judge it.

    Passed = the mover is not structure, not locked, moves only in its `allowed_moves` (when it lists any), every
    planted real clash of the mover is gone, the least distance to every other element is at least
    `scene.clearance_m` (brackets carrying the mover are ignored), nothing new is hit, and, when the fix names an
    opening, the moved element really passes through it.

    Returns {"passed", "clash_gone", "min_clear_m", "new_hits": [ids closer than clearance after that were not
    before, the clash partners excluded], "via_opening": the opening it passes through after the move or None,
    "reason"}."""
    try:
        mover = scene.element(fix.element)
    except StopIteration:
        return {"passed": False, "clash_gone": False, "min_clear_m": -NO_NEIGHBOUR_M, "new_hits": [],
                "via_opening": None, "reason": f"unknown element {fix.element}"}
    after = geom.moved(mover, fix)
    ignore = _ignored(scene, mover)
    partners = _partners(scene, mover.id)
    clear = scene.clearance_m

    before_d: dict[str, float] = {}
    after_d: dict[str, float] = {}
    for e in scene.elements:
        if e.id in ignore:
            continue
        before_d[e.id] = geom.distance(mover, e)
        after_d[e.id] = geom.distance(after, e)

    clash_gone = bool(partners) and all(after_d[p] >= -1e-9 for p in partners if p in after_d)
    min_clear = min(after_d.values()) if after_d else NO_NEIGHBOUR_M
    new_hits = sorted(eid for eid, d in after_d.items()
                      if d < clear - 1e-9 and before_d[eid] >= clear - 1e-9 and eid not in partners)

    via = None
    for e in scene.elements:
        if e.id == mover.id:
            continue
        for o in e.openings:
            if geom.passes_through(after, e, o):
                via = o.id
                break
        if via:
            break

    reasons = []
    if mover.role == "structure":
        reasons.append("structure stays: the mover is structure")
    if mover.locked:
        reasons.append(f"locked: {mover.id} must not move")
    if mover.allowed_moves:
        barred = [d for d in directions(fix) if d not in mover.allowed_moves]
        if barred:
            reasons.append(f"not allowed: {mover.id} may not move {', '.join(barred)}")
    if not partners:
        reasons.append(f"{mover.id} has no planted real clash")
    elif not clash_gone:
        worst = min(after_d[p] for p in partners if p in after_d)
        reasons.append(f"clash not gone: still {worst * 1000:.0f} mm into the clash partner")
    if min_clear < clear - 1e-9:
        nearest = min(after_d, key=after_d.get)
        reasons.append(f"clearance {min_clear * 1000:.0f} mm to {nearest} < required {clear * 1000:.0f} mm")
    if new_hits:
        reasons.append(f"new hits: {', '.join(new_hits)}")
    if fix.via_opening is not None and fix.via_opening != via:
        owner, _ = _opening_owner(scene, fix.via_opening)
        reasons.append(f"does not pass through opening {fix.via_opening}" if owner else
                       f"unknown opening {fix.via_opening}")
    passed = not reasons
    return {"passed": passed, "clash_gone": clash_gone, "min_clear_m": round(min_clear, 6), "new_hits": new_hits,
            "via_opening": via, "reason": "ok" if passed else "; ".join(reasons)}


def check_j1(planted: Planted, answer_kind) -> bool:
    """J1 sort: the clash kind ("real" | "not_touching" | "by_design"), spacing, case and dashes ignored."""
    return _norm(answer_kind) == planted.kind


def check_j2(planted: Planted, answer_element) -> bool:
    """J2 who moves: the element id that should move."""
    return planted.mover is not None and _norm(answer_element) == _norm(planted.mover)


def check_j4(planted: Planted, answer_opening) -> bool:
    """J4 opening: any opening the mover fits through. With none fitting, the right answer is none (None/"none")."""
    a = _norm(answer_opening)
    if not planted.fitting_openings:
        return a in (None, "", "none", "null")
    return a in {_norm(o) for o in planted.fitting_openings}


def check_j5(scene: Scene, fix: Fix, answer_good) -> bool:
    """J5 review: the model's verdict on a proposed fix against the truth (check_fix passed)."""
    return bool(answer_good) == check_fix(scene, fix)["passed"]


# ---------------------------------------------------------------------------------------------------------------------
# Crosscheck against Iris's engine


def _tol(*els: Element) -> float:
    return TOL_ROUND_M if any(e.shape == "cylinder" or e.openings for e in els) else TOL_BOX_M


def _exact(*els: Element) -> bool:
    """Whether the engine measures this pair exactly: uncut rectangular solids only (detect._Solids)."""
    return all(e.shape == "box" and not e.openings for e in els)


def _ids(ids_json) -> dict[str, str]:
    if isinstance(ids_json, dict):
        return dict(ids_json)
    return json.loads(Path(ids_json).read_text())


def crosscheck_engine(scene: Scene, ifc_path, ids_json, fixes: list[Fix] | None = None) -> dict:
    """Verify geom.py against Iris's engine on the scene's IFC.

    Pairs (every planted pair): geom.distance against `iris.detect.measure_pair` (overlap depth, negative, None when
    apart). An overlap of two uncut boxes must match the engine's depth within tolerance (the engine is exact there);
    anything round or cut only needs the engine to see an overlap, since its depth is then an estimate (the lesser of
    the BVH intersection figure and the box depth): the difference goes in "notes"; a gap below 0.5 m must match verify.check's
    clearance figure within tolerance (and the engine must see no overlap); a touch (|d| < tol) agrees with either.
    Gaps beyond 0.5 m are only checked for "no overlap" (verify.check looks no further).

    Fixes (each planted good_fix, plus `fixes`): the element is translated in the IFC (`IfcScene.translate`, moved
    back after), then `iris.verify.check(..., clearance_m=scene.clearance_m, exclude_connected=False)`, its own
    brackets ignored. Its pass must equal geom's "clear of everything" (min_clear_m >= clearance), unless geom's
    clearance is within tolerance of the requirement (borderline: counted as agreeing, noted).

    Tolerances: TOL_BOX_M (2 mm) when both are boxes, TOL_ROUND_M (10 mm) when a cylinder or a cut beam is involved.

    Returns {"pairs": n, "agree": k, "fixes": n, "fixes_agree": k, "disagreements": [...], "notes": [...]}."""
    from iris import detect, verify
    from iris.scene import IfcScene

    ids = _ids(ids_json)
    sc = IfcScene(ifc_path)
    out = {"pairs": 0, "agree": 0, "fixes": 0, "fixes_agree": 0, "disagreements": [], "notes": []}

    def gap_from_check(ga: str, gb: str) -> float | None:
        v = verify.check(sc, [ga], clearance_m=ENGINE_SEARCH_M, exclude_connected=False)
        for h in v.hits:
            if h.other == gb:
                return h.distance_m
        return None

    for p in scene.planted:
        a, b = scene.element(p.a), scene.element(p.b)
        ga, gb = ids[p.a], ids[p.b]
        d = geom.distance(a, b)
        tol = _tol(a, b)
        m = detect.measure_pair(sc, ga, gb)
        rec = {"what": "pair", "a": p.a, "b": p.b, "geom_m": round(d, 6), "engine_overlap_m": m, "tol_m": tol}
        exact = _exact(a, b)
        rec["engine_exact"] = exact
        if d <= -tol:
            # Two uncut boxes: the engine's depth is exact (separating axes), so it must match. Otherwise the engine's
            # depth is an estimate (the lesser of the BVH intersection figure and the box depth, which can be off
            # either way, detect._measure): both must see an overlap, and the depth difference is reported.
            ok = m is not None and (abs(m - d) <= tol or not exact)
            if ok and not exact and abs(m - d) > tol:
                out["notes"].append({**rec, "note": "engine depth is an estimate here"})
        elif d >= tol:
            ok = m is None or m > -tol
            if ok and d < ENGINE_SEARCH_M:
                g = gap_from_check(ga, gb)
                rec["engine_gap_m"] = g
                ok = g is not None and abs(g - d) <= tol
        else:
            ok = m is None or abs(m) <= tol
        out["pairs"] += 1
        if ok:
            out["agree"] += 1
        else:
            out["disagreements"].append(rec)

    todo = [p.good_fix for p in scene.planted if p.kind == "real" and p.good_fix is not None] + list(fixes or [])
    for fix in todo:
        mover = scene.element(fix.element)
        mine = check_fix(scene, fix)
        geom_clear = mine["min_clear_m"] >= scene.clearance_m - 1e-9
        tol = max([_tol(mover)] + [_tol(e) for e in scene.elements if e.id != mover.id
                                   and geom.distance(geom.moved(mover, fix), e) < ENGINE_SEARCH_M])
        gid = ids[fix.element]
        ignore = {ids[i] for i in _ignored(scene, mover) if i in ids and i != mover.id}
        sc.translate([gid], (fix.dx, fix.dy, fix.dz))
        try:
            v = verify.check(sc, [gid], clearance_m=scene.clearance_m, ignore=ignore, exclude_connected=False)
        finally:
            sc.translate([gid], (-fix.dx, -fix.dy, -fix.dz))
        rec = {"what": "fix", "element": fix.element, "move": [fix.dx, fix.dy, fix.dz],
               "geom_clear": geom_clear, "geom_min_clear_m": mine["min_clear_m"],
               "engine_passed": v.passed, "engine_min_clear_m": v.min_clearance_m,
               "engine_hits": [(h.other, round(h.distance_m, 4)) for h in v.hits], "tol_m": tol}
        borderline = abs(mine["min_clear_m"] - scene.clearance_m) <= tol
        ok = v.passed == geom_clear or borderline
        if ok and borderline and v.passed != geom_clear:
            out["notes"].append({**rec, "note": "borderline clearance"})
        out["fixes"] += 1
        if ok:
            out["fixes_agree"] += 1
        else:
            out["disagreements"].append(rec)
    return out

