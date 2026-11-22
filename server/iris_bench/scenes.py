"""Iris Bench scene generator: a small ceiling void with planted clashes, deterministic per seed.

Layout (before the optional X/Y swap): 1-2 steel beams run along X under a slab, each with 1-3 rectangular web
openings cut through its width. Services (ducts, pipes, cable trays) run along Y, each crossing one beam. Planted:

- "real": the mover service crosses beam 1 with its top `overlap_mm` into the beam's bottom flange, right under an
  opening it fits through with clearance; `good_fix` raises it so it is centred in that opening.
- "not_touching": a service under a beam with its top `gap_mm` below the beam's bottom.
- "by_design": a bracket touching a tray or pipe from below.

Everything else keeps at least `_CLEAR` mm from everything (checked on axis-aligned boxes). Geometry is built in whole
millimetres so planted distances are exact, then written in metres.
"""
from __future__ import annotations

import random
from pathlib import Path

from .spec import Element, Fix, Opening, Planted, Scene

CLEARANCE_MM = 25          # scene.clearance_m in mm
_CLEAR = 50                # minimum gap between elements that are not planted pairs (mm)
_TRIES = 200

# AABB in mm: ((x0, y0, z0), (x1, y1, z1))
Box = tuple[tuple[int, int, int], tuple[int, int, int]]


# ---------------------------------------------------------------------------------------------------------- geometry

def _aabb(el: Element) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """World axis-aligned box of an element (metres)."""
    if el.shape == "box":
        return tuple(el.min), tuple(el.max)
    lo = [min(a, b) for a, b in zip(el.start, el.end)]
    hi = [max(a, b) for a, b in zip(el.start, el.end)]
    axis = next(i for i in range(3) if abs(el.end[i] - el.start[i]) > 1e-12)
    for i in range(3):
        if i != axis:
            lo[i] -= el.radius
            hi[i] += el.radius
    return tuple(lo), tuple(hi)


def _moved(box, dx=0.0, dy=0.0, dz=0.0):
    d = (dx, dy, dz)
    return tuple(box[0][i] + d[i] for i in range(3)), tuple(box[1][i] + d[i] for i in range(3))


def box_distance(a, b) -> float:
    """Signed distance between two boxes: positive = gap (Euclidean), negative = overlap depth (smallest push-out)."""
    gaps = [max(a[0][i] - b[1][i], b[0][i] - a[1][i]) for i in range(3)]
    if all(g < 0 for g in gaps):
        return max(gaps)      # least negative: the depth along the easiest axis
    return sum(max(g, 0.0) ** 2 for g in gaps) ** 0.5


def _beam_through_axis(beam: Element) -> int:
    """The horizontal axis across the beam's width (0 = X, 1 = Y)."""
    lo, hi = _aabb(beam)
    return 0 if (hi[0] - lo[0]) < (hi[1] - lo[1]) else 1


def section(el: Element) -> tuple[float, float]:
    """A service's cross-section (horizontal width across its run, height)."""
    lo, hi = _aabb(el)
    run = 0 if (hi[0] - lo[0]) > (hi[1] - lo[1]) else 1
    return hi[1 - run] - lo[1 - run], hi[2] - lo[2]


def fits_through(el: Element, opening: Opening, clearance: float) -> bool:
    """`el`'s cross-section passes through `opening` with `clearance` all round (sizes only)."""
    w, h = section(el)
    lo, hi = _aabb(el)
    across = 1 if (hi[0] - lo[0]) > (hi[1] - lo[1]) else 0     # horizontal axis across the service's run
    ow = opening.max[across] - opening.min[across]
    oh = opening.max[2] - opening.min[2]
    return w + 2 * clearance <= ow + 1e-9 and h + 2 * clearance <= oh + 1e-9


def clear_of_beam(box, beam: Element, clearance: float) -> bool:
    """`box` keeps `clearance` from the beam's solid, counting its web openings as empty.

    The box is clear when it is `clearance` away from the beam's box, or when, where it overlaps the beam, it lies
    inside one opening shrunk by `clearance` across the two axes that are not the through-width axis."""
    bb = _aabb(beam)
    if box_distance(box, bb) >= clearance - 1e-9:
        return True
    t = _beam_through_axis(beam)
    for o in beam.openings:
        if all(box[0][i] >= o.min[i] + clearance - 1e-9 and box[1][i] <= o.max[i] - clearance + 1e-9
               for i in range(3) if i != t):
            return True
    return False


def fix_is_clear(scene: Scene, fix: Fix) -> bool:
    """The moved element keeps `scene.clearance_m` from everything (beams' openings counted as empty)."""
    me = scene.element(fix.element)
    box = _moved(_aabb(me), fix.dx, fix.dy, fix.dz)
    for el in scene.elements:
        if el.id == me.id or el.supports == me.id:
            continue   # its own bracket moves with it
        if el.kind == "beam":
            if not clear_of_beam(box, el, scene.clearance_m):
                return False
        elif box_distance(box, _aabb(el)) < scene.clearance_m - 1e-9:
            return False
    return True


# ---------------------------------------------------------------------------------------------------------- builder

class _Builder:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.items: list[dict] = []        # mm geometry, converted to Elements at the end
        self.keepout: list[Box] = []       # extra boxes nothing may come near (the mover's fixed position)
        self.n_open = 0

    def add(self, **kw) -> dict:
        kw["id"] = f"e{len(self.items) + 1}"
        kw.setdefault("openings", [])
        self.items.append(kw)
        return kw

    @staticmethod
    def box_of(it: dict) -> Box:
        if it["shape"] == "box":
            return it["min"], it["max"]
        (x0, y0, z0), (x1, y1, z1), r = it["start"], it["end"], it["radius"]
        if x0 != x1:
            return (min(x0, x1), y0 - r, z0 - r), (max(x0, x1), y0 + r, z0 + r)
        return (x0 - r, min(y0, y1), z0 - r), (x0 + r, max(y0, y1), z0 + r)

    def free(self, box: Box, ignore: tuple[str, ...] = (), clear: int = _CLEAR) -> bool:
        for it in self.items:
            if it["id"] in ignore:
                continue
            if box_distance(box, self.box_of(it)) < clear:
                return False
        return all(box_distance(box, k) >= clear for k in self.keepout)

    def service(self, kind: str, x0: int, w: int, h: int, top: int, y0: int, y1: int, along: str = "y") -> dict:
        """A service with its horizontal section starting at `x0` (or y0 for runs along X), top at `top`."""
        if kind == "pipe":
            r = w // 2
            zc = top - r
            if along == "y":
                return dict(kind="pipe", role="service", shape="cylinder", start=(x0 + r, y0, zc), end=(x0 + r, y1, zc),
                            radius=r)
            return dict(kind="pipe", role="service", shape="cylinder", start=(y0, x0 + r, zc), end=(y1, x0 + r, zc),
                        radius=r)
        if along == "y":
            return dict(kind=kind, role="service", shape="box", min=(x0, y0, top - h), max=(x0 + w, y1, top))
        return dict(kind=kind, role="service", shape="box", min=(y0, x0, top - h), max=(y1, x0 + w, top))

    def size(self, kind: str) -> tuple[int, int]:
        r = self.rng
        if kind == "duct":
            return 2 * r.randint(150, 400), 2 * r.randint(100, 175)
        if kind == "pipe":
            d = 2 * r.randint(20, 80)
            return d, d
        return 2 * r.randint(75, 300), 2 * r.randint(25, 50)   # tray


def _crossing(b: _Builder, beam: dict, kind: str, w: int, h: int, top_from: int, top_to: int,
              ignore: tuple[str, ...] = (), clear: int = _CLEAR) -> dict | None:
    """Place a service along Y crossing `beam`, its top somewhere in [top_from, top_to], away from everything."""
    rng = b.rng
    (bx0, by0, _), (bx1, by1, _) = beam["min"], beam["max"]
    yc = (by0 + by1) // 2
    for _ in range(_TRIES):
        x0 = rng.randint(bx0 + 150, max(bx0 + 150, bx1 - 150 - w))
        top = rng.randint(min(top_from, top_to), max(top_from, top_to))
        half = rng.randint(1000, 1500)
        it = b.service(kind, x0, w, h, top, yc - half, yc + half)
        if b.free(b.box_of(it), ignore, clear):
            return it
    return None


def generate(seed: int, *, density: int = 0, decoys: int = 0, gap_mm: int | None = None,
             overlap_mm: int | None = None, occlusion: bool | int = False, beams: int | None = None,
             column: bool | None = None, orient: str | None = None, **extra) -> Scene:
    """A ceiling-void scene for `seed`. Same seed and knobs, same scene.

    density: 0-20 extra distractor services. decoys: services of the mover's kind and size, parallel to it, not
    clashing. gap_mm: the near miss's gap (5-40, random by default). overlap_mm: the real clash's depth (50-400,
    random by default). occlusion: add a large duct beside the real clash (on the +X side of it before any swap) and
    record the hint for the renderer. beams: 1 or 2. column: add a column under beam 1. orient: "x" (beams along X)
    or "y". Anything else in `extra` is recorded in `scene.challenge` untouched (view, style ...)."""
    rng = random.Random(seed)
    if not 0 <= density <= 20:
        raise ValueError("density must be 0-20")
    gap = int(gap_mm) if gap_mm is not None else rng.randint(5, 40)
    depth = int(overlap_mm) if overlap_mm is not None else rng.randint(50, 400)
    if not 1 <= gap <= 100:
        raise ValueError("gap_mm must be 1-100")
    if not 10 <= depth <= 500:
        raise ValueError("overlap_mm must be 10-500")
    n_beams = beams if beams is not None else rng.choice((1, 2))
    has_column = column if column is not None else rng.random() < 0.5
    orient = orient or rng.choice(("x", "y"))
    b = _Builder(rng)
    c = CLEARANCE_MM

    # --- the mover's section and its opening decide beam 1's depth
    # The mover dips into the bottom flange only: taller than the overlap (its bottom stays below the beam) and the
    # beam wider than it, so the overlap depth is unambiguous (Iris measures the shallowest way out).
    kinds = [k for k, tallest in (("duct", 10_000), ("pipe", 160), ("tray", 100)) if tallest >= depth + 20]
    mover_kind = rng.choice(kinds)
    mw, mh = b.size(mover_kind)
    if mover_kind == "pipe":
        mw = mh = max(mw, 2 * ((depth + 21) // 2 + rng.randint(0, 10)))
        mw = mh = min(mw, 160)
    elif mh < depth + 20:
        mh = 2 * ((depth + 21) // 2 + rng.randint(0, 40))
        if mover_kind == "tray":
            mh = min(mh, 100)
    ow = mw + 2 * (c + rng.randint(5, 75))
    oh = mh + 2 * (c + rng.randint(5, 50))
    top_margin = rng.randint(50, 100)
    low_margin = max(depth + rng.randint(20, 60), 60)
    d1 = top_margin + oh + low_margin
    d1 = max(d1, 10 * rng.randint(50, 70))
    low_margin = d1 - top_margin - oh

    soffit = 3200 + 10 * rng.randint(-20, 20)     # slab soffit = beam tops
    beam_items = []
    y_cursor = 0
    length = 10 * rng.randint(400, 600)
    for k in range(n_beams):
        bw = 10 * rng.randint(25, 40)
        if k == 0:
            bw = max(bw, 10 * ((depth + 59) // 10))
        bd = d1 if k == 0 else 10 * rng.randint(50, 80)
        beam_items.append(b.add(kind="beam", role="structure", shape="box",
                                min=(0, y_cursor - bw // 2, soffit - bd), max=(length, y_cursor + bw // 2, soffit)))
        y_cursor += 10 * rng.randint(350, 450)
    beam1 = beam_items[0]

    def add_opening(beam: dict, x0: int, w: int, z0: int, h: int) -> dict:
        b.n_open += 1
        o = dict(id=f"o{b.n_open}", min=(x0, beam["min"][1], z0), max=(x0 + w, beam["max"][1], z0 + h))
        beam["openings"].append(o)
        return o

    def place_openings(beam: dict, n: int, taken: list[tuple[int, int]]):
        bot, top = beam["min"][2], beam["max"][2]
        for _ in range(n):
            for _ in range(_TRIES):
                w = 10 * rng.randint(15, 80)
                h = 10 * rng.randint(10, max(10, (top - bot - 100) // 10))
                h = min(h, top - bot - 100)
                x0 = rng.randint(300, length - 300 - w)
                if all(x0 + w + 200 <= a or x0 >= bb + 200 for a, bb in taken):
                    z0 = rng.randint(bot + 50, top - 50 - h)
                    add_opening(beam, x0, w, z0, h)
                    taken.append((x0, x0 + w))
                    break

    # beam 1's target opening, centred where the mover will cross
    ox0 = rng.randint(400, length - 400 - ow)
    beam1_bot = beam1["min"][2]
    target = add_opening(beam1, ox0, ow, beam1_bot + low_margin, oh)
    place_openings(beam1, rng.randint(0, 2), [(ox0, ox0 + ow)])
    for beam in beam_items[1:]:
        place_openings(beam, rng.randint(1, 3), [])

    # slab over everything, column under beam 1's start
    y_lo = beam_items[0]["min"][1] - 2000
    y_hi = beam_items[-1]["max"][1] + 2000
    b.add(kind="slab", role="structure", shape="box", min=(-500, y_lo, soffit), max=(length + 500, y_hi, soffit + 200))
    if has_column:
        cw = 10 * rng.randint(25, 40)
        cy = (beam1["min"][1] + beam1["max"][1]) // 2
        b.add(kind="column", role="structure", shape="box", min=(0, cy - cw // 2, 0), max=(cw, cy + cw // 2, beam1_bot))

    # --- planted real clash: the mover, its top `depth` into beam 1's bottom, under the target opening
    mx0 = ox0 + (ow - mw) // 2
    yc1 = (beam1["min"][1] + beam1["max"][1]) // 2
    half = rng.randint(1000, 1500)
    mover = b.add(**b.service(mover_kind, mx0, mw, mh, beam1_bot + depth, yc1 - half, yc1 + half))
    o_mid2 = 2 * target["min"][2] + oh                 # twice the opening's centre z
    m_box = b.box_of(mover)
    dz = (o_mid2 - (m_box[0][2] + m_box[1][2])) // 2   # exact: oh - mh is even
    b.keepout.append(((m_box[0][0], m_box[0][1], m_box[0][2]), (m_box[1][0], m_box[1][1], m_box[1][2] + dz)))

    # --- occluder (optional): a big duct beside the mover, same beam, below it
    occluder = None
    if occlusion:
        for _ in range(_TRIES):
            w, h = 2 * rng.randint(250, 400), 2 * rng.randint(125, 200)
            side = rng.choice((1, -1))
            x0 = m_box[1][0] + rng.randint(80, 250) if side > 0 else m_box[0][0] - rng.randint(80, 250) - w
            top = beam1_bot - rng.randint(60, 200)
            it = b.service("duct", x0, w, h, top, yc1 - half, yc1 + half)
            if 0 <= x0 and x0 + w <= length and b.free(b.box_of(it)):
                occluder = b.add(**it)
                break

    # --- planted near miss: a service under some beam, its top `gap` below the beam
    near = None
    for _ in range(_TRIES):
        beam = rng.choice(beam_items)
        kind = rng.choice(("duct", "pipe", "tray"))
        w, h = b.size(kind)
        it = _crossing(b, beam, kind, w, h, beam["min"][2] - gap, beam["min"][2] - gap, ignore=(beam["id"],))
        if it is not None:
            near = b.add(**it)
            near_beam = beam
            break
    if near is None:
        raise RuntimeError(f"seed {seed}: no room for the near miss")

    # --- planted by design: a bracket under a tray or pipe
    carried = bracket = None
    for _ in range(_TRIES):
        beam = rng.choice(beam_items)
        kind = rng.choice(("tray", "pipe"))
        w, h = b.size(kind)
        it = _crossing(b, beam, kind, w, h, beam["min"][2] - 400, beam["min"][2] - 100)
        if it is None:
            continue
        (sx0, sy0, sz0), (sx1, sy1, _) = b.box_of(it)
        yb = rng.choice((sy0 + rng.randint(200, 600), sy1 - rng.randint(250, 650)))
        br = dict(kind="bracket", role="support", shape="box", min=(sx0 - 50, yb, sz0 - 50), max=(sx1 + 50, yb + 50, sz0))
        if b.free(b.box_of(br)):
            carried = b.add(**it)
            br["supports"] = carried["id"]
            bracket = b.add(**br)
            break
    if bracket is None:
        raise RuntimeError(f"seed {seed}: no room for the bracket")

    # --- decoys: same kind and size as the mover, parallel, clear of everything
    decoy_ids = []
    for _ in range(decoys):
        beam = rng.choice(beam_items)
        it = _crossing(b, beam, mover_kind, mw, mh, beam["min"][2] - 300, beam["min"][2] - 60)
        if it is not None:
            decoy_ids.append(b.add(**it)["id"])

    # --- distractors: random services crossing a beam or running beside one
    distractor_ids = []
    for _ in range(density):
        kind = rng.choice(("duct", "pipe", "tray"))
        w, h = b.size(kind)
        beam = rng.choice(beam_items)
        if rng.random() < 0.7:
            it = _crossing(b, beam, kind, w, h, beam["min"][2] - 900, beam["min"][2] - 60)
        else:
            it = None
            for _ in range(_TRIES):
                side = rng.choice((1, -1))
                y0 = (beam["max"][1] + rng.randint(300, 1200)) if side > 0 else (beam["min"][1] - rng.randint(300, 1200) - w)
                top = rng.randint(beam["min"][2] - 600, soffit - 60)
                cand = b.service(kind, y0, w, h, top, 200, length - 200, along="x")
                if b.free(b.box_of(cand)):
                    it = cand
                    break
        if it is not None:
            distractor_ids.append(b.add(**it)["id"])

    # --- to metres (and swap X/Y when the beams run along Y)
    swap = orient == "y"

    def m(v):
        v = (v[1], v[0], v[2]) if swap else v
        return tuple(round(x / 1000, 6) for x in v)

    elements = []
    for it in b.items:
        el = Element(id=it["id"], kind=it["kind"], role=it["role"], shape=it["shape"], supports=it.get("supports"),
                     openings=[Opening(id=o["id"], min=m(o["min"]), max=m(o["max"])) for o in it["openings"]])
        if it["shape"] == "box":
            el.min, el.max = m(it["min"]), m(it["max"])
        else:
            el.start, el.end, el.radius = m(it["start"]), m(it["end"]), round(it["radius"] / 1000, 6)
        elements.append(el)

    scene = Scene(seed=seed, elements=elements, planted=[], clearance_m=c / 1000)
    mover_el = scene.element(mover["id"])
    fix = Fix(element=mover["id"], dz=round(dz / 1000, 6), via_opening=target["id"])
    fitting = [o.id for el in elements for o in el.openings if fits_through(mover_el, o, scene.clearance_m)]
    scene.planted = [
        Planted(a=mover["id"], b=beam1["id"], kind="real", distance_m=-depth / 1000, mover=mover["id"],
                good_fix=fix, fitting_openings=fitting),
        Planted(a=near["id"], b=near_beam["id"], kind="not_touching", distance_m=gap / 1000),
        Planted(a=bracket["id"], b=carried["id"], kind="by_design", distance_m=0.0),
    ]
    scene.challenge = {
        "density": density, "decoys": decoys, "gap_mm": gap, "overlap_mm": depth, "occlusion": bool(occlusion),
        "beams": n_beams, "column": has_column, "orient": orient,
        "target": [mover["id"], beam1["id"]], "occluder": occluder["id"] if occluder else None,
        "decoy_ids": decoy_ids, "distractor_ids": distractor_ids,
        **extra,
    }
    if not fix_is_clear(scene, fix):    # by construction; a failure here is a generator bug
        raise RuntimeError(f"seed {seed}: the planted fix is not clear")
    return scene


def to_folder(scene: Scene, out_dir: str | Path) -> Path:
    """Write `scene.json` into `out_dir` (created) and return the folder."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene.save(out / "scene.json")
    return out
