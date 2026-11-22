"""Iris Bench ground truth beyond the planted pairs: relationships, candidate resolutions and cameras.

Everything here is computed from closed-form geometry (geom.py) and judged by the answer checker (checker.check_fix),
never by a model. `annotate(scene)` fills `scene.relations`, `scene.resolutions` and `scene.cameras`; the generator
calls it last, so scene.json carries the whole answer key.

Relations (`relations`): for every element pair within RELATION_RANGE_M (and every planted pair), with a = the first
named element:

    above / below        a lies wholly above / below b (z extents separate); value_m = the vertical gap (>= 0)
    north_of / south_of  a lies wholly north (+Y) / south of b in plan; value_m = the gap along Y (>= 0)
    east_of / west_of    a lies wholly east (+X) / west of b in plan; value_m = the gap along X (>= 0)
    crosses              two runs (beam, duct, pipe, tray) along different horizontal axes whose plan footprints
                         overlap; value_m = their signed distance (the clearance where they cross)
    parallel             two runs along the same axis, side by side (their extents along it overlap); value_m = signed
                         distance
    passes_through       a runs through beam b by way of opening `via` (geom.passes_through: it spans the beam and the
                         centre of its section is inside the void); value_m = signed distance to the beam
    supports             bracket a carries b (by design); value_m = their distance (0)
    touches              distance 0 and not a support
    clashes              distance < 0; value_m = minus the penetration depth
    clear_of             distance > 0; value_m = the gap

Directional relations are stored both ways (a above b and b below a); the symmetric ones once, a before b in scene
order. Every pair in range gets exactly one of supports / touches / clashes / clear_of.

Resolutions (`resolutions`): for every real planted pair, candidate moves of its elements, each judged by
checker.check_fix (valid = passed, resolves_original = clash_gone, new_hits, evidence = the full check result):

    good             the generator's planted fix
    alt_opening      route the mover through another opening of the partner it fits through (when one passes)
    alt_below/above  take the mover to the partner's other side with clearance (when that passes)
    too_small        the good move scaled down (half, else a quarter) — still clashing or short of clearance
    wrong_direction  the good move's size the opposite way, else along the mover's own run
    wrong_element    move the partner instead: structure stays, and a locked service must not move
    wrong_opening    route the mover through an opening of the partner it does not fit through
    hits_third       a move that clears the partner but overlaps another element (resolves the original clash and
                     creates a new one: the new-clash case), else the nearest move into another element

Invalid labels are kept only when the checker fails them; valid alternatives only when it passes them.

Cameras (`default_cameras`): A and B share a seeded isometric viewpoint, C is 90 degrees round, "top" is an
orthographic plan, "section" an orthographic elevation looking along the target beam; extra azimuths/elevations
(scene.challenge "cam_azimuths" / "cam_elevations", or kwargs) add more. Azimuth follows the renderer
(bench/render/bench.js): degrees in the XY plane from +X towards +Y, where the camera stands relative to the focus.
"""
from __future__ import annotations

import itertools
import math
import random

from . import checker, geom
from .spec import Camera, Element, Fix, Relation, Resolution, Scene

RELATION_RANGE_M = 1.5          # pairs closer than this get relations
TOUCH_M = 1e-6                  # |distance| within this is touching
_RUNS = ("beam", "duct", "pipe", "tray")
_MARGIN_M = 0.025               # extra gap beyond the clearance when taking a mover to the partner's other side
_THIRD_MAX_M = 5.0              # longest move tried when looking for a move into a third element
_THIRD_TRIES = 12               # checker calls spent on that search


def _r(x: float) -> float:
    return round(float(x), 6)


# ------------------------------------------------------------------------------------------------------- relations

def run_axis(el: Element) -> int | None:
    """The horizontal axis a run (beam, duct, pipe, tray) goes along (0 = X, 1 = Y); None for anything else."""
    if el.kind not in _RUNS:
        return None
    if el.shape == "cylinder":
        ax = geom.cylinder_axis(el)
        return ax if ax < 2 else None
    lo, hi = geom.bbox(el)
    sx, sy = hi[0] - lo[0], hi[1] - lo[1]
    if sx >= 1.5 * sy:
        return 0
    if sy >= 1.5 * sx:
        return 1
    return None


def _overlap(a, b, k: int) -> float:
    """Overlap of two boxes' (min, max) extents along axis k (negative = gap)."""
    return min(a[1][k], b[1][k]) - max(a[0][k], b[0][k])


def _bbox_gap(a, b) -> float:
    return math.sqrt(sum(max(a[0][k] - b[1][k], b[0][k] - a[1][k], 0.0) ** 2 for k in range(3)))


def _pair_relations(a: Element, b: Element, d: float) -> list[Relation]:
    out: list[Relation] = []
    ba, bb = geom.bbox(a), geom.bbox(b)

    # state: supports / touches / clashes / clear_of
    if a.kind == "bracket" and a.supports == b.id:
        out.append(Relation(a.id, b.id, "supports", _r(d)))
    elif b.kind == "bracket" and b.supports == a.id:
        out.append(Relation(b.id, a.id, "supports", _r(d)))
    elif abs(d) <= TOUCH_M:
        out.append(Relation(a.id, b.id, "touches", 0.0))
    elif d < 0:
        out.append(Relation(a.id, b.id, "clashes", _r(d)))
    else:
        out.append(Relation(a.id, b.id, "clear_of", _r(d)))

    # order: vertical, then plan (both ways)
    for k, pos, neg in ((2, "above", "below"), (1, "north_of", "south_of"), (0, "east_of", "west_of")):
        if ba[0][k] >= bb[1][k] - TOUCH_M:          # a wholly on the + side of b
            g = _r(max(ba[0][k] - bb[1][k], 0.0))
            out += [Relation(a.id, b.id, pos, g), Relation(b.id, a.id, neg, g)]
        elif bb[0][k] >= ba[1][k] - TOUCH_M:
            g = _r(max(bb[0][k] - ba[1][k], 0.0))
            out += [Relation(b.id, a.id, pos, g), Relation(a.id, b.id, neg, g)]

    # runs: crosses / parallel
    ra, rb = run_axis(a), run_axis(b)
    if ra is not None and rb is not None:
        if ra != rb and _overlap(ba, bb, 0) > TOUCH_M and _overlap(ba, bb, 1) > TOUCH_M:
            out.append(Relation(a.id, b.id, "crosses", _r(d)))
        elif ra == rb and _overlap(ba, bb, ra) > TOUCH_M:
            out.append(Relation(a.id, b.id, "parallel", _r(d)))

    # passes_through: an element inside a beam's opening void
    for beam, other in ((a, b), (b, a)):
        if beam.kind == "beam" and beam.shape == "box" and other.shape in ("box", "cylinder"):
            for o in beam.openings:
                if geom.passes_through(other, beam, o):
                    out.append(Relation(other.id, beam.id, "passes_through", _r(d), via=o.id))
    return out


def relations(scene: Scene, max_m: float = RELATION_RANGE_M) -> list[Relation]:
    """Ground-truth relationships for every element pair within `max_m` (plus every planted pair). See module doc."""
    planted = {frozenset((p.a, p.b)) for p in scene.planted}
    boxes = {e.id: geom.bbox(e) for e in scene.elements}
    out: list[Relation] = []
    for a, b in itertools.combinations(scene.elements, 2):
        is_planted = frozenset((a.id, b.id)) in planted
        if not is_planted and _bbox_gap(boxes[a.id], boxes[b.id]) > max_m:   # the box gap never exceeds the true gap
            continue
        d = geom.distance(a, b)
        if not is_planted and d > max_m:
            continue
        out += _pair_relations(a, b, d)
    return out


# ----------------------------------------------------------------------------------------------------- resolutions

def _fix(eid: str, d, via: str | None = None) -> Fix:
    return Fix(element=eid, dx=_r(d[0]) + 0.0, dy=_r(d[1]) + 0.0, dz=_r(d[2]) + 0.0, via_opening=via)


def _vec(f: Fix) -> tuple[float, float, float]:
    return (f.dx, f.dy, f.dz)


def _norm(v) -> float:
    return math.sqrt(sum(x * x for x in v))


def _key(f: Fix) -> tuple:
    return (f.element, round(f.dx, 6), round(f.dy, 6), round(f.dz, 6), f.via_opening)


def _center(box) -> list[float]:
    return [(box[0][k] + box[1][k]) / 2 for k in range(3)]


def _centre_in(mover: Element, beam: Element, o) -> tuple[float, float, float]:
    """The translation that centres the mover's section in opening `o` (the two axes across its through axis)."""
    t = geom.through_axis(o, beam)
    mc = _center(geom.bbox(mover))
    oc = _center((o.min, o.max))
    return tuple(0.0 if k == t else oc[k] - mc[k] for k in range(3))


def _other_side(mover: Element, partner: Element, good: Fix, clear: float) -> tuple[float, float, float] | None:
    """A vertical move taking the mover to the partner's other side (opposite to the good fix), with clearance."""
    if abs(good.dz) < 1e-9:
        return None
    m, p = geom.bbox(mover), geom.bbox(partner)
    if good.dz > 0:   # good goes up: try below the partner
        return (0.0, 0.0, -(m[1][2] - p[0][2] + clear + _MARGIN_M))
    return (0.0, 0.0, p[1][2] - m[0][2] + clear + _MARGIN_M)


def _ignored(scene: Scene, mover: Element) -> set[str]:
    out = {mover.id} | {e.id for e in scene.elements if e.kind == "bracket" and e.supports == mover.id}
    if mover.kind == "bracket" and mover.supports:
        out.add(mover.supports)
    return out


def _into(lo_m, hi_m, lo_t, hi_t) -> list[float]:
    """The least translation making box m overlap box t by `need` along every axis (need: 50 mm, or half the smaller
    size when that is less)."""
    d = []
    for k in range(3):
        need = min(0.05, (hi_m[k] - lo_m[k]) / 2, (hi_t[k] - lo_t[k]) / 2)
        if min(hi_m[k], hi_t[k]) - max(lo_m[k], lo_t[k]) >= need:
            d.append(0.0)
        elif lo_m[k] + hi_m[k] < lo_t[k] + hi_t[k]:
            d.append(lo_t[k] + need - hi_m[k])
        else:
            d.append(hi_t[k] - need - lo_m[k])
    return d


def _third_candidates(scene: Scene, mover: Element, partner: Element, bases: list) -> list[tuple[float, Fix, str]]:
    """Moves of the mover into another element, from each base move: (length, fix, third id), cheapest geometry
    pre-screen applied (the moved mover clears the partner and overlaps the third)."""
    skip = _ignored(scene, mover) | {partner.id}
    seen, out = set(), []
    for base in bases:
        lo, hi = geom.bbox(geom.moved(mover, _fix(mover.id, base)))
        for t in scene.elements:
            if t.id in skip:
                continue
            tlo, thi = geom.bbox(t)
            e = _into(lo, hi, tlo, thi)
            v = tuple(base[k] + e[k] for k in range(3))
            if _norm(v) > _THIRD_MAX_M or _norm(v) < 1e-6:
                continue
            f = _fix(mover.id, v)
            if (_key(f), t.id) in seen:
                continue
            seen.add((_key(f), t.id))
            after = geom.moved(mover, f)
            if geom.distance(after, partner) >= 0 and geom.distance(after, t) < 0:
                out.append((_norm(v), f, t.id))
    out.sort(key=lambda x: (x[0], x[2]))
    return out


def _pair_resolutions(scene: Scene, n: int) -> list[Resolution]:
    p = scene.planted[n]
    good = p.good_fix
    mover = scene.element(p.mover)
    partner = scene.element(p.b if p.a == mover.id else p.a)
    clear = scene.clearance_m
    cache: dict[tuple, dict] = {}
    out: list[Resolution] = []
    used: set[tuple] = set()

    def judge(f: Fix) -> dict:
        k = _key(f)
        if k not in cache:
            cache[k] = checker.check_fix(scene, f)
        return cache[k]

    def add(label: str, f: Fix) -> Resolution:
        r = judge(f)
        res = Resolution(pair=n, label=label, fix=f, valid=bool(r["passed"]), resolves_original=bool(r["clash_gone"]),
                         new_hits=list(r["new_hits"]), evidence=dict(r))
        out.append(res)
        used.add(_key(f))
        return res

    def fresh(f: Fix) -> bool:
        return _key(f) not in used

    add("good", good)
    gv = _vec(good)

    # valid alternatives: another fitting opening, the partner's other side
    for o in (partner.openings if partner.kind == "beam" else []):
        if o.id in p.fitting_openings and o.id != good.via_opening:
            f = _fix(mover.id, _centre_in(mover, partner, o), via=o.id)
            if fresh(f) and judge(f)["passed"]:
                add("alt_opening", f)
                break
    side = _other_side(mover, partner, good, clear)
    side_fix = _fix(mover.id, side) if side else None
    if side_fix is not None and fresh(side_fix) and judge(side_fix)["passed"]:
        add("alt_below" if side[2] < 0 else "alt_above", side_fix)

    # invalid: too small, wrong direction, wrong element, wrong opening
    for frac in (0.5, 0.25):
        f = _fix(mover.id, [x * frac for x in gv], via=good.via_opening)
        if fresh(f) and not judge(f)["passed"]:
            add("too_small", f)
            break
    size = _norm(gv)
    ra = run_axis(mover)
    lateral = [0.0, 0.0, 0.0]
    lateral[ra if ra is not None else 0] = size
    for v in ([-x for x in gv], lateral):
        f = _fix(mover.id, v)
        if fresh(f) and not judge(f)["passed"]:
            add("wrong_direction", f)
            break
    if partner.role == "structure" or partner.locked:
        if partner.role == "structure":
            v = [-x for x in gv]                                   # the same relative move, made by the beam
        else:   # the least move of the partner clear of the mover, on the side away from the good fix
            m, q = geom.bbox(mover), geom.bbox(partner)
            v = [0.0, 0.0, (m[1][2] - q[0][2] + clear + 0.005) if good.dz < 0 else -(q[1][2] - m[0][2] + clear + 0.005)]
        f = _fix(partner.id, v)
        if fresh(f) and not judge(f)["passed"]:
            add("wrong_element", f)
    if partner.kind == "beam":
        mc = _center(geom.bbox(mover))
        for o in sorted(partner.openings, key=lambda o: _norm([a - b for a, b in zip(_center((o.min, o.max)), mc)])):
            if o.id not in p.fitting_openings:
                f = _fix(mover.id, _centre_in(mover, partner, o), via=o.id)
                if fresh(f) and not judge(f)["passed"]:
                    add("wrong_opening", f)
                    break

    # hits_third: clears the partner but lands in another element (the new-clash case)
    def overlaps_new(f: Fix, r: dict) -> bool:   # a new hit that is a real overlap, not just short of clearance
        after = geom.moved(mover, f)
        return any(geom.distance(after, scene.element(h)) < 0 for h in r["new_hits"])

    third = None
    if side_fix is not None and fresh(side_fix):
        r = judge(side_fix)
        if not r["passed"] and r["clash_gone"] and overlaps_new(side_fix, r):
            third = side_fix
    if third is None:
        bases = [(0.0, 0.0, 0.0)] + [_vec(x.fix) for x in out if x.valid] + ([side] if side else [])
        cands = _third_candidates(scene, mover, partner, bases)
        for _, f, tid in cands[:_THIRD_TRIES]:
            r = judge(f)
            if fresh(f) and not r["passed"] and r["clash_gone"] and tid in r["new_hits"]:
                third = f
                break
        if third is None:   # nothing clears the partner into a third element: the nearest move into one
            for t in sorted((e for e in scene.elements if e.id not in _ignored(scene, mover) | {partner.id}),
                            key=lambda e: _bbox_gap(geom.bbox(e), geom.bbox(mover))):
                lo, hi = geom.bbox(mover)
                f = _fix(mover.id, _into(lo, hi, *geom.bbox(t)))
                if _norm(_vec(f)) > 1e-6 and fresh(f) and t.id in judge(f)["new_hits"] and not judge(f)["passed"]:
                    third = f
                    break
    if third is not None:
        add("hits_third", third)
    return out


def resolutions(scene: Scene) -> list[Resolution]:
    """Candidate fixes for every real planted pair (valid and invalid), each judged by checker.check_fix."""
    out: list[Resolution] = []
    for n, p in enumerate(scene.planted):
        if p.kind == "real" and p.good_fix is not None and p.mover is not None:
            out += _pair_resolutions(scene, n)
    return out


# --------------------------------------------------------------------------------------------------------- cameras

def _target_beam(scene: Scene) -> Element | None:
    tgt = scene.challenge.get("target") or []
    for eid in tgt:
        try:
            el = scene.element(eid)
        except StopIteration:
            continue
        if el.kind == "beam":
            return el
    return next((e for e in scene.elements if e.kind == "beam"), None)


def default_cameras(scene: Scene, seed: int | None = None, *, azimuths=(), elevations=()) -> list[Camera]:
    """A and B (same seeded isometric viewpoint), C (90 degrees round), "top" (orthographic plan), "section"
    (orthographic, level, looking along the target beam), then one camera per extra azimuth x elevation (named
    "az<deg>_el<deg>"; a missing list uses the seeded value)."""
    rng = random.Random(f"iris-bench-cameras-{scene.seed if seed is None else seed}")
    az = round(rng.uniform(20.0, 70.0) + 90 * rng.randrange(4), 1)
    el = round(rng.uniform(22.0, 38.0), 1)
    beam = _target_beam(scene)
    along = run_axis(beam) if beam is not None else 0
    cams = [Camera("A", az, el), Camera("B", az, el), Camera("C", round((az + 90) % 360, 1), el),
            Camera("top", 0.0, 90.0, 1.0, "orthographic"),
            Camera("section", 0.0 if along in (0, None) else 270.0, 0.0, 1.0, "orthographic")]
    azs = [float(a) for a in azimuths] or ([az] if elevations else [])
    els = [float(e) for e in elevations] or [el]
    names = {c.name for c in cams}
    for a, e in itertools.product(azs, els):
        name = f"az{a:g}_el{e:g}"
        if name not in names:
            cams.append(Camera(name, a % 360, e))
            names.add(name)
    return cams


# -------------------------------------------------------------------------------------------------------- annotate

def annotate(scene: Scene) -> Scene:
    """Fill scene.relations, scene.resolutions and scene.cameras (in place) and return the scene."""
    scene.relations = relations(scene)
    scene.resolutions = resolutions(scene)
    scene.cameras = default_cameras(scene, scene.seed, azimuths=scene.challenge.get("cam_azimuths") or (),
                                    elevations=scene.challenge.get("cam_elevations") or ())
    return scene
