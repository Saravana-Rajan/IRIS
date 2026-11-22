"""Closed-form geometry on Iris Bench elements (spec.Element): the answer key's measure, independent of any model.

Every element is decomposed into primitive solids:

- `_Box`: an axis-aligned box.
- `_Cyl`: an axis-aligned cylinder (a run along X or Y; Z works too) — axis, centre in the other two axes, radius,
  extent along the axis.

A beam with openings is its box minus the opening boxes, split into sub-boxes (a grid on the openings' faces, then
cells sharing a full face merged), so an element passing through an opening is measured against the solid web around
it, not the void.

Signed distance (metres): positive = gap, 0 = touching, negative = penetration depth, the minimum translation that
separates the two (as Iris's detection measures it: `min(a.max - b.min, b.max - a.min)` per axis, least axis).

Exactness:
- box–box: exact (gap: Euclidean; penetration: axis-aligned minimum translation, exact for boxes).
- box–cylinder and parallel cylinders: exact. Both solids are a product (interval along the cylinder axis) x (2D
  cross-section), so the gap is sqrt(axis_gap^2 + section_gap^2) and the penetration is the lesser of the axis
  overlap and the 2D circle-vs-rectangle (or circle-vs-circle) depth.
- perpendicular cylinders: conservative. The larger of (cylinder A vs B's bounding box) and (B vs A's bounding box);
  each is a lower bound on the true distance, and it is exact when the two runs cross in plan (the usual case: pipes
  crossing at different heights). It may report them closer than they are near the ends of the runs, never farther.
- penetration is always the least axis-aligned translation (six directions) that clears the other element as a whole:
  for each axis, every piece pair gives the open interval of shifts at which they overlap (closed form for box/box,
  box/cylinder, parallel cylinders; perpendicular cylinders use the other's bounding box, conservative), and the
  depth is the nearest shift outside their union. So a duct through a cut web reads the move that clears the web, not
  a dent into one piece, and a pipe too big for its opening reads the move that takes it out of the beam. For a
  round section near a box corner this is the axis-aligned figure (as Iris's detection reports), not the Euclidean.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace
from functools import lru_cache

from .spec import Element, Fix, Opening, Vec

EPS = 1e-9


@dataclass(frozen=True)
class _Box:
    lo: tuple[float, float, float]
    hi: tuple[float, float, float]


@dataclass(frozen=True)
class _Cyl:
    axis: int                      # 0 = X, 1 = Y, 2 = Z
    c: tuple[float, float]         # centre in the other two axes, in increasing axis order
    r: float
    a0: float                      # extent along the axis
    a1: float


def _others(axis: int) -> tuple[int, int]:
    u, v = (k for k in range(3) if k != axis)
    return u, v


def cylinder_axis(el: Element) -> int:
    """The axis a cylinder runs along (where its start and end differ). Raises when it is not axis-aligned."""
    d = [abs(el.end[k] - el.start[k]) for k in range(3)]
    moving = [k for k in range(3) if d[k] > EPS]
    if len(moving) != 1:
        raise ValueError(f"cylinder {el.id} is not axis-aligned: {el.start} -> {el.end}")
    return moving[0]


def _cyl(el: Element) -> _Cyl:
    ax = cylinder_axis(el)
    u, v = _others(ax)
    return _Cyl(ax, (float(el.start[u]), float(el.start[v])), float(el.radius),
                float(min(el.start[ax], el.end[ax])), float(max(el.start[ax], el.end[ax])))


def bbox(el: Element) -> tuple[Vec, Vec]:
    """World bounding box (min, max) of an element."""
    if el.shape == "box":
        return tuple(map(float, el.min)), tuple(map(float, el.max))
    c = _cyl(el)
    u, v = _others(c.axis)
    lo, hi = [0.0] * 3, [0.0] * 3
    lo[c.axis], hi[c.axis] = c.a0, c.a1
    lo[u], hi[u] = c.c[0] - c.r, c.c[0] + c.r
    lo[v], hi[v] = c.c[1] - c.r, c.c[1] + c.r
    return tuple(lo), tuple(hi)


def _box_of(p) -> _Box:
    if isinstance(p, _Box):
        return p
    u, v = _others(p.axis)
    lo, hi = [0.0] * 3, [0.0] * 3
    lo[p.axis], hi[p.axis] = p.a0, p.a1
    lo[u], hi[u] = p.c[0] - p.r, p.c[0] + p.r
    lo[v], hi[v] = p.c[1] - p.r, p.c[1] + p.r
    return _Box(tuple(lo), tuple(hi))


def _subtract(lo, hi, voids) -> list[_Box]:
    """A box minus axis-aligned void boxes, as disjoint boxes: a grid on every void face, the solid cells kept, then
    cells sharing a full face merged (fewer, larger pieces give truer penetration depths)."""
    clipped = []
    for vlo, vhi in voids:
        a = [max(lo[k], vlo[k]) for k in range(3)]
        b = [min(hi[k], vhi[k]) for k in range(3)]
        if all(b[k] - a[k] > EPS for k in range(3)):
            clipped.append((a, b))
    if not clipped:
        return [_Box(tuple(lo), tuple(hi))]
    cuts = []
    for k in range(3):
        cuts.append(sorted({lo[k], hi[k], *(a[k] for a, _ in clipped), *(b[k] for _, b in clipped)}))
    cells = []
    for i in range(len(cuts[0]) - 1):
        for j in range(len(cuts[1]) - 1):
            for m in range(len(cuts[2]) - 1):
                clo = (cuts[0][i], cuts[1][j], cuts[2][m])
                chi = (cuts[0][i + 1], cuts[1][j + 1], cuts[2][m + 1])
                if any(chi[k] - clo[k] <= EPS for k in range(3)):
                    continue
                mid = [(clo[k] + chi[k]) / 2 for k in range(3)]
                if any(all(a[k] < mid[k] < b[k] for k in range(3)) for a, b in clipped):
                    continue
                cells.append([list(clo), list(chi)])
    merged = True
    while merged:
        merged = False
        for x in range(len(cells)):
            for y in range(x + 1, len(cells)):
                (alo, ahi), (blo, bhi) = cells[x], cells[y]
                for k in range(3):
                    same = all(abs(alo[q] - blo[q]) < EPS and abs(ahi[q] - bhi[q]) < EPS for q in range(3) if q != k)
                    if same and (abs(ahi[k] - blo[k]) < EPS or abs(bhi[k] - alo[k]) < EPS):
                        nlo, nhi = list(alo), list(ahi)
                        nlo[k], nhi[k] = min(alo[k], blo[k]), max(ahi[k], bhi[k])
                        cells[x] = [nlo, nhi]
                        del cells[y]
                        merged = True
                        break
                if merged:
                    break
            if merged:
                break
    return [_Box(tuple(a), tuple(b)) for a, b in cells]


def pieces(el: Element) -> list:
    """The element's solid as primitive pieces (a beam with openings: its box minus the voids, as sub-boxes)."""
    if el.shape == "cylinder":
        return [_cyl(el)]
    lo, hi = tuple(map(float, el.min)), tuple(map(float, el.max))
    if el.openings:
        voids = tuple((tuple(map(float, o.min)), tuple(map(float, o.max))) for o in el.openings)
        return list(_subtract_cached(lo, hi, voids))
    return [_Box(lo, hi)]


@lru_cache(maxsize=4096)
def _subtract_cached(lo, hi, voids) -> tuple[_Box, ...]:
    """`_subtract` memoised on the exact geometry (the pieces are immutable): a cut beam is split once, not per query."""
    return tuple(_subtract(lo, hi, list(voids)))


def _interval(a0, a1, b0, b1) -> float:
    """Signed separation of two intervals: gap >= 0, or minus the least translation that separates them."""
    gap = max(b0 - a1, a0 - b1)
    if gap >= 0:
        return gap
    return -min(a1 - b0, b1 - a0)


def _combine(parts: list[float]) -> float:
    """Signed distance of a product of sets from its per-factor signed distances."""
    if all(s < 0 for s in parts):
        return max(parts)
    return math.sqrt(sum(max(s, 0.0) ** 2 for s in parts))


def _rect_point(lo2, hi2, p2) -> float:
    """Signed distance from a 2D point to a rectangle (negative inside)."""
    s = [max(lo2[k] - p2[k], p2[k] - hi2[k]) for k in range(2)]
    if any(x > 0 for x in s):
        return math.sqrt(sum(max(x, 0.0) ** 2 for x in s))
    return max(s)


def _box_box(a: _Box, b: _Box) -> float:
    return _combine([_interval(a.lo[k], a.hi[k], b.lo[k], b.hi[k]) for k in range(3)])


def _box_cyl(b: _Box, c: _Cyl) -> float:
    u, v = _others(c.axis)
    along = _interval(b.lo[c.axis], b.hi[c.axis], c.a0, c.a1)
    section = _rect_point((b.lo[u], b.lo[v]), (b.hi[u], b.hi[v]), c.c) - c.r
    return _combine([along, section])


def _cyl_cyl(a: _Cyl, b: _Cyl) -> float:
    if a.axis == b.axis:
        along = _interval(a.a0, a.a1, b.a0, b.a1)
        section = math.dist(a.c, b.c) - a.r - b.r
        return _combine([along, section])
    # Perpendicular: conservative (see module doc).
    return max(_box_cyl(_box_of(b), a), _box_cyl(_box_of(a), b))


def _piece_distance(p, q) -> float:
    if isinstance(p, _Box) and isinstance(q, _Box):
        return _box_box(p, q)
    if isinstance(p, _Box):
        return _box_cyl(p, q)
    if isinstance(q, _Box):
        return _box_cyl(q, p)
    return _cyl_cyl(p, q)


def _flip(iv):
    return None if iv is None else (-iv[1], -iv[0])


def _strict(a0, a1, b0, b1) -> bool:
    return a1 > b0 + EPS and b1 > a0 + EPS


def _forbidden_box_box(p: _Box, q: _Box, k: int):
    """Open interval of shifts s of `p` along axis k for which p + s overlaps q (None: never)."""
    if not all(_strict(p.lo[j], p.hi[j], q.lo[j], q.hi[j]) for j in range(3) if j != k):
        return None
    return q.lo[k] - p.hi[k], q.hi[k] - p.lo[k]


def _forbidden_cyl_box(c: _Cyl, b: _Box, k: int):
    """Shifts of cylinder `c` along axis k for which it overlaps box `b`."""
    u, v = _others(c.axis)
    if k == c.axis:
        if _rect_point((b.lo[u], b.lo[v]), (b.hi[u], b.hi[v]), c.c) - c.r >= -EPS:
            return None
        return b.lo[k] - c.a1, b.hi[k] - c.a0
    if not _strict(c.a0, c.a1, b.lo[c.axis], b.hi[c.axis]):
        return None
    i = 0 if k == u else 1
    j, kj = 1 - i, (v if k == u else u)
    dj = max(b.lo[kj] - c.c[j], c.c[j] - b.hi[kj], 0.0)
    if dj >= c.r - EPS:
        return None
    w = math.sqrt(c.r * c.r - dj * dj)
    return b.lo[k] - w - c.c[i], b.hi[k] + w - c.c[i]


def _forbidden_cyl_cyl(a: _Cyl, b: _Cyl, k: int):
    if a.axis != b.axis:
        return _forbidden_cyl_box(a, _box_of(b), k)   # conservative, as in _cyl_cyl
    R = a.r + b.r
    if k == a.axis:
        if math.dist(a.c, b.c) >= R - EPS:
            return None
        return b.a0 - a.a1, b.a1 - a.a0
    if not _strict(a.a0, a.a1, b.a0, b.a1):
        return None
    u, _ = _others(a.axis)
    i = 0 if k == u else 1
    dj = abs(b.c[1 - i] - a.c[1 - i])
    if dj >= R - EPS:
        return None
    w = math.sqrt(R * R - dj * dj)
    d = b.c[i] - a.c[i]
    return d - w, d + w


def _forbidden(p, q, k: int):
    if isinstance(p, _Box) and isinstance(q, _Box):
        return _forbidden_box_box(p, q, k)
    if isinstance(p, _Cyl) and isinstance(q, _Box):
        return _forbidden_cyl_box(p, q, k)
    if isinstance(p, _Box) and isinstance(q, _Cyl):
        return _flip(_forbidden_cyl_box(q, p, k))
    return _forbidden_cyl_cyl(p, q, k)


def _clear_shift(intervals, direction: int) -> float:
    """The smallest shift (>= 0 along `direction` +1/-1) that lies in none of the open intervals."""
    s = 0.0
    moved = True
    while moved:
        moved = False
        for lo, hi in intervals:
            if lo + EPS < s < hi - EPS:
                s = hi if direction > 0 else lo
                moved = True
    return abs(s)


def penetration(a: Element, b: Element) -> float:
    """The least axis-aligned translation of `a` that clears all of `b` (0 when they do not overlap). Exact against a
    beam's whole web (a shift that only lands in the next piece, or only partly in the void, does not count)."""
    pa, pb = pieces(a), pieces(b)
    best = math.inf
    for k in range(3):
        ivs = [iv for p in pa for q in pb if (iv := _forbidden(p, q, k)) is not None]
        if not ivs:
            return 0.0
        best = min(best, _clear_shift(ivs, +1), _clear_shift(ivs, -1))
    return best


def distance(a: Element, b: Element) -> float:
    """Signed distance between two elements, metres: negative = penetration depth (least axis-aligned translation of
    one that clears the other, voids included), positive = gap (exact Euclidean, see module doc for perpendicular
    cylinders), 0 = touching. Openings in either element are voids."""
    d = min(_piece_distance(p, q) for p in pieces(a) for q in pieces(b))
    if d >= -EPS:
        return d if d > EPS else 0.0
    return -penetration(a, b)


def _shift(v: Vec | None, d: tuple[float, float, float]) -> Vec | None:
    return None if v is None else (v[0] + d[0], v[1] + d[1], v[2] + d[2])


def moved(el: Element, fix: Fix) -> Element:
    """A translated copy of `el` (its openings move with it). `fix.element` is not checked against `el.id`."""
    d = (float(fix.dx), float(fix.dy), float(fix.dz))
    return replace(el, min=_shift(el.min, d), max=_shift(el.max, d), start=_shift(el.start, d),
                   end=_shift(el.end, d),
                   openings=[Opening(o.id, _shift(o.min, d), _shift(o.max, d)) for o in el.openings])


def through_axis(opening: Opening, beam: Element | None = None) -> int:
    """The axis an opening goes through the beam along: where it spans the whole beam (the thinnest such axis of the
    beam), or, without the beam, the opening's thinnest axis."""
    size = [opening.max[k] - opening.min[k] for k in range(3)]
    if beam is not None and beam.shape == "box":
        spans = [k for k in range(3)
                 if opening.min[k] <= beam.min[k] + 1e-6 and opening.max[k] >= beam.max[k] - 1e-6]
        if spans:
            return min(spans, key=lambda k: beam.max[k] - beam.min[k])
    return min(range(3), key=lambda k: size[k])


def _section(el: Element, axis: int) -> tuple[str, tuple]:
    """The element's cross-section across `axis`: ("circle", (cu, cv, r)) for a cylinder along it, otherwise its
    bounding rectangle ("rect", (lo_u, lo_v, hi_u, hi_v))."""
    u, v = _others(axis)
    if el.shape == "cylinder" and cylinder_axis(el) == axis:
        c = _cyl(el)
        return "circle", (c.c[0], c.c[1], c.r)
    lo, hi = bbox(el)
    return "rect", (lo[u], lo[v], hi[u], hi[v])


def passes_through(el: Element, beam: Element, opening: Opening) -> bool:
    """Whether `el` runs through `beam` by way of `opening`: it spans the beam's thickness along the opening's through
    axis and the centre of its cross-section lies inside the opening. Says nothing about clearance (see `fits` and
    `distance`)."""
    t = through_axis(opening, beam)
    u, v = _others(t)
    lo, hi = bbox(el)
    if not (lo[t] <= beam.min[t] + 1e-6 and hi[t] >= beam.max[t] - 1e-6):
        return False
    kind, s = _section(el, t)
    cu, cv = (s[0], s[1]) if kind == "circle" else ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)
    return opening.min[u] < cu < opening.max[u] and opening.min[v] < cv < opening.max[v]


def fits(el_cross_section: Element, opening: Opening, clearance: float, axis: int | None = None) -> bool:
    """Whether the element's cross-section, with `clearance` all round, is no larger than the opening (size only,
    wherever it is placed). `axis` is the opening's through axis (default: the opening's thinnest axis). A cylinder
    along that axis is a circle (2r + 2c each way); anything else uses its bounding rectangle."""
    t = through_axis(opening) if axis is None else axis
    u, v = _others(t)
    ou, ov = opening.max[u] - opening.min[u], opening.max[v] - opening.min[v]
    kind, s = _section(el_cross_section, t)
    if kind == "circle":
        wu = wv = 2 * s[2]
    else:
        wu, wv = s[2] - s[0], s[3] - s[1]
    return wu + 2 * clearance <= ou + 1e-9 and wv + 2 * clearance <= ov + 1e-9
