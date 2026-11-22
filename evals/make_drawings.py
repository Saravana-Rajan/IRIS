"""Sample MEP plan drawings (PDF) from the Northbank sample, with exact ground truth (docs/drawings.md, "Sample data").

No public MEP drawing set exists, so we draw our own from the model: a Level 02 mechanical services plan (sheet M-201,
A1 landscape, vector PDF, real text layer) with the structural grid, the structure as a light background, every duct,
pipe and cable tray on the level in the usual line styles (duct double line, pipe single centreline, tray hatched,
risers crossed), air terminals as diffuser symbols, and each run tagged with its model Tag and size. A second PDF,
"-mismatch", is the same sheet with planted differences from the model (`PLANTED`: a changed size, a removed run, an
extra run the model does not have, a pipe drawn as a duct).

Each PDF gets `<name>.truth.json`: every labelled item (tag, kind, size, size_mm, box in page pixels at 150 dpi, the
model GlobalId), the model elements the sheet covers (`scope`), and the planted mismatches with the kinds of
docs/drawings.md, so the drawing reader and the comparison are scored exactly. No AI; the same models give the same
bytes.

    cd server
    uv run python ../evals/make_drawings.py                     # writes samples/drawings/
    uv run python ../evals/make_drawings.py --out /tmp/drawings --preview /tmp/drawings/M-201.png

Importable: `build(out)` writes everything and returns the paths; `sheet_data()` gives the model data it draws.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass, field, replace
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import ifcopenshell.util.element  # noqa: E402
from reportlab.lib.colors import Color, black, white  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfbase.pdfmetrics import stringWidth  # noqa: E402
from reportlab.pdfgen import canvas as rl_canvas  # noqa: E402

from iris.scene import IfcScene  # noqa: E402

SAMPLES = ROOT / "samples"
OUT = SAMPLES / "drawings"
MODELS = ("Northbank-Structure.ifc", "Northbank-MEP.ifc", "Northbank-Grids.ifc")
STOREY = "Level 02"
PROJECT = "Northbank (sample)"
SHEET = "M-201"
TITLE = "Level 02 — Mechanical services"
STEM = "Northbank-M-201"
DATE = "2026-11-22"
GENERATOR = "Iris by Techjays — generated sample"
DPI = 150
PAPER = (841.0, 594.0)          # A1 landscape, mm
SCALES = (20, 25, 50, 100, 200)  # standard plan scales, the largest that fits is used

# Sheet layout, paper mm (origin bottom left, as in PDF).
FRAME = (20.0, 10.0, 831.0, 584.0)
STRIP_X = 651.0                  # title strip: STRIP_X .. FRAME right
AREA = (24.0, 14.0, STRIP_X - 4.0, 580.0)   # where the plan and its labels may go

# Short pieces of one run (same tag stem, family and size, each at most GROUP_MAX_M in plan, at most GROUP_GAP_M
# apart) share one label that lists every tag on its own line, so the core stays legible.
GROUP_MAX_M = 2.0
GROUP_GAP_M = 0.45

# Planted differences for the "-mismatch" sheet. Kinds as docs/drawings.md (`Mismatch.kind`).
PLANTED = (
    {"kind": "size_differs", "tag": "SA-MAIN-L02-12", "size": "600x250"},
    {"kind": "missing_in_drawing", "tag": "SA-BR-L02-N2-2"},
    {"kind": "missing_in_model", "tag": "LV-TRAY-L02-2", "size": "300x100", "drawn": "tray",
     "plan_m": (-6.0, 1.0, 2.2, 1.3)},
    {"kind": "type_differs", "tag": "HW-MAIN-L02-6", "drawn": "duct", "size": "150x100", "width_m": 0.15},
)

# Fonts and weights (ISO 128 pens, mm).
FONT, BOLD = "Helvetica", "Helvetica-Bold"
LABEL_PT = 8.0
THIN, LIGHT, MEDIUM, HEAVY, FRAME_PEN = 0.18, 0.25, 0.35, 0.5, 0.7
GREY = Color(0.55, 0.55, 0.55)
LIGHT_GREY = Color(0.72, 0.72, 0.72)
DARK = Color(0.12, 0.12, 0.12)
PT_PER_MM = mm

Rect = tuple[float, float, float, float]   # x0, y0, x1, y1 (paper mm, y up)


# ---------------------------------------------------------------------------------------------------------------------
# Model data
# ---------------------------------------------------------------------------------------------------------------------

@dataclass
class Thing:
    """One thing drawn on the plan: a model element (or a planted extra, gid None)."""
    gid: str | None
    ifc_class: str | None
    tag: str | None          # the label's tag: the model Tag, None for an unlabelled or size-only symbol
    name: str | None
    system: str | None
    kind: str | None         # docs/drawings.md Item.kind when labelled: duct | pipe | tray | diffuser | equipment
    style: str               # how it is drawn (`draw_thing`)
    size: str | None         # label text: "600x300", "Ø54"
    size_mm: list[float] | None
    model_size: str | None   # as the model says it ("DN54", "D250", "600x300")
    box: tuple[float, ...]   # x0, y0, z0, x1, y1, z1 metres
    label: bool = False      # gets a tag/size label
    model_tag: str | None = None
    width_m: float | None = None   # drawn width of a run, when not the box's

    @property
    def plan(self) -> Rect:
        x0, y0, _, x1, y1, _ = self.box
        return x0, y0, x1, y1

    @property
    def vertical(self) -> bool:
        x0, y0, z0, x1, y1, z1 = self.box
        return (z1 - z0) > max(x1 - x0, y1 - y0)

    @property
    def along_x(self) -> bool:
        x0, y0, _, x1, y1, _ = self.box
        return (x1 - x0) >= (y1 - y0)


def parse_size(text: str | None) -> tuple[str | None, list[float] | None]:
    """A model size ("600x300", "300x100 riser", "D250", "DN54") → the drawing label and millimetres."""
    if not text:
        return None, None
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", text)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        return f"{m.group(1)}x{m.group(2)}", [a, b]
    m = re.search(r"(?:DN|D|Ø)\s*(\d+(?:\.\d+)?)", text)
    if m:
        return f"Ø{m.group(1)}", [float(m.group(1))]
    return None, None


def _size_property(e) -> str | None:
    for props in ifcopenshell.util.element.get_psets(e).values():
        for k, v in props.items():
            if k.lower() == "size" and isinstance(v, str) and v.strip():
                return v.strip()
    return None


def _profile_size(e) -> str | None:
    """The body's first extruded profile as a size: rectangle W x D in mm, circle D<diameter>."""
    rep = e.Representation
    for r in (rep.Representations if rep else []):
        for it in r.Items:
            if it.is_a("IfcExtrudedAreaSolid"):
                p = it.SweptArea
                if p.is_a("IfcRectangleProfileDef"):
                    return f"{round(p.XDim * 1000)}x{round(p.YDim * 1000)}"
                if p.is_a("IfcCircleProfileDef"):
                    return f"D{round(p.Radius * 2000)}"
    return None


def model_size(e) -> str | None:
    """What the model says the size is: a `Size` property, else the name ("Supply diffuser 600x600"), else the
    profile."""
    s = _size_property(e)
    if s:
        return s
    if e.is_a("IfcAirTerminal") or e.is_a("IfcDamper"):
        m = re.search(r"\d+x\d+|D\d+", e.Name or "")
        if m:
            return m.group(0)
    return _profile_size(e)


def _style(e, box) -> tuple[str | None, str | None]:
    """(kind, style) for a Level 02 MEP element, or (None, None) when the mechanical plan leaves it out."""
    x0, y0, z0, x1, y1, z1 = box
    vertical = (z1 - z0) > max(x1 - x0, y1 - y0)
    pt = (getattr(e, "PredefinedType", None) or "").upper()
    name = (e.Name or "").lower()
    if e.is_a("IfcDuctSegment"):
        rect = "x" in (model_size(e) or "")
        if vertical:
            return "duct", "riser_duct" if rect else "riser_round"
        return "duct", "rect_duct" if rect else "round_duct"
    if e.is_a("IfcPipeSegment"):
        return "pipe", "pipe_riser" if vertical else "pipe"
    if e.is_a("IfcCableCarrierSegment"):   # a conduit is a cable carrier too: the "tray" family
        if pt == "CONDUITSEGMENT":
            return "tray", "conduit"
        return "tray", "tray_riser" if vertical else "tray"
    if e.is_a("IfcAirTerminal"):
        if "grille" in name:
            return "diffuser", "grille"
        if "valve" in name:
            return "diffuser", "valve_terminal"
        return "diffuser", "diffuser"
    if e.is_a("IfcElectricDistributionBoard"):
        return "equipment", "board"
    if e.is_a("IfcDamper"):
        return None, "damper"
    if e.is_a("IfcDuctFitting"):
        return None, "duct_fitting"
    if e.is_a("IfcPipeFitting"):
        return None, "pipe_fitting"
    if e.is_a("IfcCableCarrierFitting"):
        return None, "conduit" if "conduit" in name else "tray_fitting"
    if e.is_a("IfcValve"):
        return None, "valve"
    if e.is_a("IfcSanitaryTerminal"):
        return None, "sanitary"
    return None, None   # lighting, detectors, call points: the electrical sheet's


def _labelled(kind: str | None, style: str, box) -> bool:
    """Every duct, pipe and cable carrier segment is tagged (the comparison expects each one with a tag of its own on
    the storey), so are terminals (size only) and equipment. Fittings and accessories are drawn, never tagged."""
    return kind in ("duct", "pipe", "tray", "diffuser", "equipment")


@dataclass
class SheetData:
    things: list[Thing]
    grids: list[tuple[str, tuple[float, float], tuple[float, float]]]   # tag, start, end (metres)
    beams: list[tuple[str, Rect]]       # name, plan rect
    columns: list[Rect]
    slab: Rect | None
    models: dict[str, str]              # file → sha256
    model_tags: set[str]                # every Tag in the MEP model, any storey


def _r(v: float) -> float:
    return round(float(v), 4)


@lru_cache(maxsize=4)
def sheet_data(samples: Path = SAMPLES) -> SheetData:
    """Read what the sheet draws from the sample models (Structure + MEP + Grids), boxes from `IfcScene.bounds()`."""
    paths = [Path(samples) / n for n in MODELS]
    scene = IfcScene(paths)
    bounds = scene.bounds()
    by_name = {p.name: m for p, m in zip(scene.paths, scene.models)}

    def box(gid):
        b = bounds.get(gid)
        return None if b is None else tuple(_r(v) for v in (*b[0], *b[1]))

    def storey(e):
        c = ifcopenshell.util.element.get_container(e)
        return getattr(c, "Name", None)

    things = []
    mep = by_name["Northbank-MEP.ifc"]
    for e in mep.by_type("IfcElement"):
        if storey(e) != STOREY:
            continue
        b = box(e.GlobalId)
        if b is None:
            continue
        kind, style = _style(e, b)
        if style is None:
            continue
        ms = model_size(e)
        size, size_mm = parse_size(ms)
        label = _labelled(kind, style, b)
        tag = e.Tag if (label and kind != "diffuser") else None
        if kind == "equipment":   # a board is tagged, not sized
            size = size_mm = None
        system = None
        for props in ifcopenshell.util.element.get_psets(e).values():
            system = system or props.get("System")
        things.append(Thing(gid=e.GlobalId, ifc_class=e.is_a(), tag=tag, name=e.Name, system=system,
                            kind=kind if label else None, style=style, size=size if label else None,
                            size_mm=size_mm if label else None, model_size=ms, box=b, label=label,
                            model_tag=e.Tag))
    things.sort(key=lambda t: (t.ifc_class or "", t.model_tag or "", t.gid or ""))

    grids = []
    gm = by_name["Northbank-Grids.ifc"]
    for g in gm.by_type("IfcGrid"):
        import ifcopenshell.util.placement as up
        mat = up.get_local_placement(g.ObjectPlacement)
        for a in [*g.UAxes, *g.VAxes]:
            pts = [p.Coordinates for p in a.AxisCurve.Points]
            (ax, ay), (bx, by) = pts[0][:2], pts[-1][:2]
            p0 = mat @ [ax, ay, 0, 1]
            p1 = mat @ [bx, by, 0, 1]
            grids.append((a.AxisTag, (_r(p0[0]), _r(p0[1])), (_r(p1[0]), _r(p1[1]))))

    beams, columns, slab = [], [], None
    st = by_name["Northbank-Structure.ifc"]
    for e in st.by_type("IfcElement"):
        if storey(e) != STOREY:
            continue
        b = box(e.GlobalId)
        if b is None:
            continue
        plan = (b[0], b[1], b[3], b[4])
        if e.is_a("IfcBeam"):
            beams.append((e.Name or "", plan))
        elif e.is_a("IfcColumn"):
            columns.append(plan)
        elif e.is_a("IfcSlab"):
            slab = plan
    beams.sort()
    columns.sort()
    models = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    tags = {e.Tag for e in mep.by_type("IfcElement") if e.Tag}
    return SheetData(things, grids, beams, columns, slab, models, tags)


# ---------------------------------------------------------------------------------------------------------------------
# Geometry helpers (paper mm)
# ---------------------------------------------------------------------------------------------------------------------

def grow(r: Rect, d: float) -> Rect:
    return r[0] - d, r[1] - d, r[2] + d, r[3] + d


def overlaps(a: Rect, b: Rect) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def inside(a: Rect, b: Rect) -> bool:
    return a[0] >= b[0] and a[1] >= b[1] and a[2] <= b[2] and a[3] <= b[3]


def union(*rs: Rect) -> Rect:
    return min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)


def seg_hits_rect(p: tuple[float, float], q: tuple[float, float], r: Rect) -> bool:
    """Liang-Barsky: does segment pq cross rectangle r?"""
    x0, y0 = p
    dx, dy = q[0] - x0, q[1] - y0
    t0, t1 = 0.0, 1.0
    for pp, qq in ((-dx, x0 - r[0]), (dx, r[2] - x0), (-dy, y0 - r[1]), (dy, r[3] - y0)):
        if pp == 0:
            if qq < 0:
                return False
        else:
            t = qq / pp
            if pp < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def segs_cross(a, b, c, d) -> bool:
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return (orient(a, b, c) * orient(a, b, d) < 0) and (orient(c, d, a) * orient(c, d, b) < 0)


def nearest_on_rect(p, r: Rect) -> tuple[float, float]:
    return min(max(p[0], r[0]), r[2]), min(max(p[1], r[1]), r[3])


# ---------------------------------------------------------------------------------------------------------------------
# Sheet: model → paper transform, label layout
# ---------------------------------------------------------------------------------------------------------------------

@dataclass
class Placed:
    rect: Rect
    leader: tuple[tuple[float, float], tuple[float, float]] | None


@dataclass
class Layout:
    scale: int
    origin: tuple[float, float]          # paper mm of model (0, 0)
    labels: dict[str, Placed] = field(default_factory=dict)   # key → placement

    def p(self, x: float, y: float) -> tuple[float, float]:
        k = 1000.0 / self.scale
        return self.origin[0] + x * k, self.origin[1] + y * k

    def rect(self, r: Rect) -> Rect:
        a, b = self.p(r[0], r[1]), self.p(r[2], r[3])
        return a[0], a[1], b[0], b[1]

    def len(self, metres: float) -> float:
        return metres * 1000.0 / self.scale


def key(t: Thing) -> str:
    return t.gid or f"extra:{t.tag}"


def natural(text: str | None) -> list:
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", text or "")]


def _stem(tag: str) -> str:
    return re.sub(r"-\d+$", "", tag)


def _extent(t: Thing) -> float:
    x0, y0, x1, y1 = t.plan
    return max(x1 - x0, y1 - y0)


def _gap(a: Rect, b: Rect) -> float:
    dx = max(0.0, a[0] - b[2], b[0] - a[2])
    dy = max(0.0, a[1] - b[3], b[1] - a[3])
    return math.hypot(dx, dy)


@dataclass
class Group:
    """Things that share one label: one thing, or the short pieces of one run (each tag on its own line)."""
    key: str
    members: list[Thing]

    @property
    def primary(self) -> Thing:
        """The longest piece: a leader points at it."""
        return max(self.members, key=lambda t: (round(_extent(t), 4), -self.members.index(t)))


def group_labels(things: list[Thing]) -> list[Group]:
    """Label groups, in tag order: pieces of one run (same tag stem, family and size), each at most GROUP_MAX_M long in
    plan and at most GROUP_GAP_M from the next, share a label; everything else labelled has its own."""
    labelled = sorted((t for t in things if t.label), key=lambda t: (t.tag is None, natural(t.tag), key(t)))
    parent = {key(t): key(t) for t in labelled}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    short = [t for t in labelled if t.tag and t.gid and _extent(t) <= GROUP_MAX_M]
    for i, a in enumerate(short):
        for b in short[i + 1:]:
            if (a.kind == b.kind and a.size == b.size and _stem(a.tag) == _stem(b.tag)
                    and _gap(a.plan, b.plan) <= GROUP_GAP_M):
                ra, rb = find(key(a)), find(key(b))
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    out: dict[str, list[Thing]] = {}
    for t in labelled:
        out.setdefault(find(key(t)), []).append(t)
    return [Group(key=key(ms[0]), members=ms) for ms in out.values()]


def group_lines(members: list[Thing]) -> list[tuple[str, str]]:
    """A label's lines: each member's tag (bold), then the sizes (one line per distinct size)."""
    lines = [(t.tag, BOLD) for t in members if t.tag]
    sizes: list[str] = []
    for t in members:
        if t.size and t.size not in sizes:
            sizes.append(t.size)
    return lines + [(s, FONT) for s in sizes]


FS_MM = LABEL_PT / PT_PER_MM          # font size in mm
LINE_MM = FS_MM * 1.18
PAD_MM = 0.6


def label_wh(lines: list[tuple[str, str]]) -> tuple[float, float]:
    w = max(stringWidth(s, f, LABEL_PT) for s, f in lines) / PT_PER_MM
    return w + 2 * PAD_MM, len(lines) * LINE_MM + 2 * PAD_MM


def snap(rect: Rect) -> Rect:
    """Move a label so its top sits on the sheet-wide line pitch: every label line on the page then shares one set of
    baselines LINE_MM apart, and a text-layer reader that groups characters into lines by height (pdfplumber chains
    tops within 3 pt) never merges two labels' lines."""
    top = round(rect[3] / LINE_MM) * LINE_MM
    d = top - rect[3]
    return rect[0], rect[1] + d, rect[2], rect[3] + d


def run_rect(lay: Layout, t: Thing) -> Rect:
    """The thing's drawn footprint on paper (a run drawn at `width_m` keeps its centreline)."""
    r = lay.rect(t.plan)
    if t.width_m is not None:
        half = lay.len(t.width_m) / 2
        if t.along_x:
            cy = (r[1] + r[3]) / 2
            r = r[0], cy - half, r[2], cy + half
        else:
            cx = (r[0] + r[2]) / 2
            r = cx - half, r[1], cx + half, r[3]
    if t.style in ("pipe_riser", "riser_round", "valve_terminal"):   # drawn at least 2.4 mm across
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        h = max(1.2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2)
        r = cx - h, cy - h, cx + h, cy + h
    if t.style in ("pipe", "conduit"):
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        if t.along_x:
            r = r[0], cy - 0.35, r[2], cy + 0.35
        else:
            r = cx - 0.35, r[1], cx + 0.35, r[3]
    return r


def fit_scale(data: SheetData, scale: int | None) -> Layout:
    xs = [v for _, a, b in data.grids for v in (a[0], b[0])]
    ys = [v for _, a, b in data.grids for v in (a[1], b[1])]
    x0, x1, y0, y1 = min(xs) - 1.0, max(xs) + 1.0, min(ys) - 1.0, max(ys) + 1.0
    aw, ah = AREA[2] - AREA[0], AREA[3] - AREA[1] - 70.0     # keep room for the view title and scale bar
    if scale is None:
        scale = next(s for s in SCALES if (x1 - x0) * 1000 / s <= aw and (y1 - y0) * 1000 / s <= ah)
    k = 1000.0 / scale
    cx = (AREA[0] + AREA[2]) / 2 - (x0 + x1) / 2 * k
    cy = AREA[1] + 70.0 + ah / 2 - (y0 + y1) / 2 * k
    return Layout(scale=scale, origin=(round(cx, 3), round(cy, 3)))


BUBBLE_R = 5.0


def bubbles(lay: Layout, data: SheetData) -> list[tuple[str, float, float]]:
    """Grid bubbles: tag and centre (paper mm), one past each end of each grid line."""
    out = []
    for tag, a, b in data.grids:
        pa, pb = lay.p(*a), lay.p(*b)
        for p, o in ((pa, pb), (pb, pa)):
            dx, dy = p[0] - o[0], p[1] - o[1]
            n = math.hypot(dx, dy) or 1.0
            out.append((tag, p[0] + dx / n * BUBBLE_R, p[1] + dy / n * BUBBLE_R))
    return out


def fixed_obstacles(lay: Layout, data: SheetData) -> list[Rect]:
    """Grid bubbles, dimension text, the north arrow and the view title: labels keep off them."""
    out = [grow((x - BUBBLE_R, y - BUBBLE_R, x + BUBBLE_R, y + BUBBLE_R), 1.0) for _, x, y in bubbles(lay, data)]
    out.extend(grow(r, 0.5) for r in dimension_rects(lay, data))
    out.append(north_rect())
    out.append(view_title_rect())
    return out


TERMINALS = ("diffuser", "grille", "valve_terminal")
RINGS = (6, 9, 12, 15, 19, 23, 28, 33, 39, 45, 52, 60, 70, 82, 96, 110)   # leader lengths tried, mm


def label_candidates(t: Thing, geom: Rect, w: float, h: float, whole: Rect | None = None):
    """(cost, rect, anchor or None), cheapest first: inside a wide duct, beside the run, then on a leader. `geom` is
    the (primary) piece's drawn rect, `whole` the group's when the label is shared."""
    out = []
    gap = 0.9
    cx, cy = (geom[0] + geom[2]) / 2, (geom[1] + geom[3]) / 2
    runlike = t.style in ("rect_duct", "round_duct", "pipe", "tray", "conduit") and not t.vertical
    if runlike and t.along_x:
        length = geom[2] - geom[0]
        ts = (0.5, 0.35, 0.65, 0.2, 0.8) if length > 3 * w else (0.5,)
        for i, f in enumerate(ts):
            ax = geom[0] + f * length
            pen = 0.4 * i
            if t.style in ("rect_duct", "round_duct") and geom[3] - geom[1] >= h + 0.8 and length >= w + 2:
                out.append((0.0 + pen, (ax - w / 2, cy - h / 2, ax + w / 2, cy + h / 2), None))
            out.append((1.0 + pen, (ax - w / 2, geom[3] + gap, ax + w / 2, geom[3] + gap + h), None))
            out.append((1.3 + pen, (ax - w / 2, geom[1] - gap - h, ax + w / 2, geom[1] - gap), None))
    elif runlike:
        length = geom[3] - geom[1]
        ts = (0.5, 0.35, 0.65, 0.2, 0.8) if length > 3 * h else (0.5,)
        for i, f in enumerate(ts):
            ay = geom[1] + f * length
            pen = 0.4 * i
            out.append((1.0 + pen, (geom[2] + gap, ay - h / 2, geom[2] + gap + w, ay + h / 2), None))
            out.append((1.2 + pen, (geom[0] - gap - w, ay - h / 2, geom[0] - gap, ay + h / 2), None))
    if not runlike or whole is not None:   # beside the thing (or the whole group): terminals above or below first
        g = whole or geom
        gx, gy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
        costs = (1.3, 1.35, 1.0, 1.05) if t.style in TERMINALS else (1.0, 1.1, 1.2, 1.3)
        out.append((costs[0], (g[2] + gap, gy - h / 2, g[2] + gap + w, gy + h / 2), None))
        out.append((costs[1], (g[0] - gap - w, gy - h / 2, g[0] - gap, gy + h / 2), None))
        out.append((costs[2], (gx - w / 2, g[3] + gap, gx + w / 2, g[3] + gap + h), None))
        out.append((costs[3], (gx - w / 2, g[1] - gap - h, gx + w / 2, g[1] - gap), None))
    # On a leader: rings around anchor points on the (primary) run.
    if runlike and t.along_x:
        anchors = [(geom[0] + f * (geom[2] - geom[0]), cy) for f in (0.5, 0.3, 0.7)]
    elif runlike:
        anchors = [(cx, geom[1] + f * (geom[3] - geom[1])) for f in (0.5, 0.3, 0.7)]
    else:
        anchors = [(cx, cy)]
    for ai, (ax, ay) in enumerate(anchors):
        for r in RINGS:
            for k in range(24):
                a = math.radians(15.0 * k + 7.5)
                ux, uy = math.cos(a), math.sin(a)
                # the label's centre sits so its near edge is r from the anchor
                ex = ax + ux * r + (w / 2 if ux > 0.2 else -w / 2 if ux < -0.2 else 0)
                ey = ay + uy * r + (h / 2 if uy > 0.2 else -h / 2 if uy < -0.2 else 0)
                rect = (ex - w / 2, ey - h / 2, ex + w / 2, ey + h / 2)
                out.append((4.0 + r * 0.35 + r * r * 0.012 + ai * 1.5 + (0.6 if abs(uy) > 0.9 else 0.0), rect,
                            (ax, ay)))
    out = [(c, snap(r), a) for c, r, a in out]
    out.sort(key=lambda c: c[0])
    return out


ORDERS = ("crowded", "sparse", "west", "north", "tag")   # placement orders tried; the cheapest layout wins


def layout_labels(lay: Layout, data: SheetData, things: list[Thing], groups: list[Group],
                  dims: dict[str, tuple[float, float]]) -> float:
    """Place every label with collision avoidance: greedy in each of `ORDERS`, keeping the cheapest result (sum of
    placement costs: leader length, outlines and leaders crossed). `things` are every thing either variant draws (as
    obstacles), `dims` each group's largest label (w, h) across the variants, so one layout serves both sheets and a
    label sits in the same place on each. Returns the cost."""
    best = None
    for order in ORDERS:
        trial = Layout(scale=lay.scale, origin=lay.origin)
        try:
            cost = _layout_once(trial, data, things, groups, dims, order)
        except RuntimeError:
            continue
        if best is None or cost < best[0] - 1e-9:
            best = (cost, trial.labels)
    if best is None:
        raise RuntimeError("no label layout fits the sheet")
    lay.labels = best[1]
    return best[0]


def _layout_once(lay: Layout, data: SheetData, things: list[Thing], groups: list[Group],
                 dims: dict[str, tuple[float, float]], order_by: str) -> float:
    geoms = {key(t): run_rect(lay, t) for t in things}
    mep = [(key(t), grow(geoms[key(t)], 0.3)) for t in things]
    cols = [grow(lay.rect(c), 0.6) for c in data.columns]
    fixed = fixed_obstacles(lay, data)
    placed: list[Rect] = []
    leaders: list[tuple[tuple[float, float], tuple[float, float]]] = []

    def crowd(gr: Group):
        g = grow(union(*(geoms[key(t)] for t in gr.members)), 8.0)
        return sum(1 for _, r in mep if overlaps(g, r))

    def centre(gr: Group):
        g = geoms[key(gr.primary)]
        return (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
    sort_key = {
        "crowded": lambda gr: (-crowd(gr), natural(gr.key)),
        "sparse": lambda gr: (crowd(gr), natural(gr.key)),
        "west": lambda gr: (round(centre(gr)[0], 3), natural(gr.key)),
        "north": lambda gr: (-round(centre(gr)[1], 3), natural(gr.key)),
        "tag": lambda gr: natural(gr.key),
    }[order_by]
    order = sorted(groups, key=sort_key)
    total = 0.0

    for gr in order:
        own = {key(t) for t in gr.members}
        t = gr.primary
        whole = union(*(geoms[key(m)] for m in gr.members)) if len(gr.members) > 1 else None
        w, h = dims[gr.key]
        best = None
        for strict in (True, False):
            for cost, rect, anchor in label_candidates(t, geoms[key(t)], w, h, whole):
                if best is not None and cost >= best[0]:
                    break
                if not inside(rect, AREA):
                    continue
                padded = grow(rect, 0.8)
                if any(overlaps(padded, r) for r in placed):
                    continue
                if any(overlaps(padded, r) for r in fixed) or any(overlaps(rect, r) for r in cols):
                    continue
                extra = 0.0
                hits = [o for o, r in mep if o not in own and overlaps(rect, r)]
                if anchor is None and (hits or any(overlaps(rect, r) for o, r in mep if o in own and o != key(t))):
                    continue
                if anchor is not None:
                    if any(overlaps(rect, r) for o, r in mep if o in own):
                        continue
                    if hits:
                        if strict:
                            continue
                        extra += 30.0 * len(hits)
                    end = nearest_on_rect(anchor, rect)
                    if any(seg_hits_rect(anchor, end, grow(r, 0.3)) for r in placed):
                        continue
                    if any(seg_hits_rect(a, b, padded) for a, b in leaders):
                        continue
                    extra += 2.0 * sum(1 for o, r in mep if o not in own and seg_hits_rect(anchor, end, r))
                    extra += 8.0 * sum(1 for a, b in leaders if segs_cross(anchor, end, a, b))
                score = cost + extra
                if best is None or score < best[0]:
                    best = (score, rect, anchor)
            if best is not None:
                break
        if best is None:
            raise RuntimeError(f"no room for the label of {gr.key}")
        cost, rect, anchor = best
        total += cost
        leader = None
        if anchor is not None:
            leader = (anchor, nearest_on_rect(anchor, rect))
            leaders.append(leader)
        placed.append(rect)
        lay.labels[gr.key] = Placed(rect=tuple(round(v, 3) for v in rect), leader=leader)
    return total


# ---------------------------------------------------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------------------------------------------------

class Pen:
    """A reportlab canvas in paper millimetres."""

    def __init__(self, c):
        self.c = c

    def width(self, w_mm: float, color=black, dash: tuple[float, ...] | None = None):
        self.c.setLineWidth(w_mm * PT_PER_MM)
        self.c.setStrokeColor(color)
        self.c.setDash([d * PT_PER_MM for d in dash] if dash else [])

    def line(self, x0, y0, x1, y1):
        self.c.line(x0 * mm, y0 * mm, x1 * mm, y1 * mm)

    def rect(self, r: Rect, stroke=1, fill=0, fill_color=white):
        self.c.setFillColor(fill_color)
        self.c.rect(r[0] * mm, r[1] * mm, (r[2] - r[0]) * mm, (r[3] - r[1]) * mm, stroke=stroke, fill=fill)

    def circle(self, x, y, r, stroke=1, fill=0, fill_color=white):
        self.c.setFillColor(fill_color)
        self.c.circle(x * mm, y * mm, r * mm, stroke=stroke, fill=fill)

    def text(self, x, y, s, font=FONT, pt=LABEL_PT, align="left", color=black):
        self.c.setFillColor(color)
        self.c.setFont(font, pt)
        if align == "center":
            self.c.drawCentredString(x * mm, y * mm, s)
        elif align == "right":
            self.c.drawRightString(x * mm, y * mm, s)
        else:
            self.c.drawString(x * mm, y * mm, s)

    def hatch(self, r: Rect, step: float, w=THIN, color=black):
        c = self.c
        c.saveState()
        p = c.beginPath()
        p.rect(r[0] * mm, r[1] * mm, (r[2] - r[0]) * mm, (r[3] - r[1]) * mm)
        c.clipPath(p, stroke=0, fill=0)
        self.width(w, color)
        n = int(((r[2] - r[0]) + (r[3] - r[1])) / step) + 1
        for i in range(n + 1):
            x = r[0] - (r[3] - r[1]) + i * step
            self.line(x, r[1], x + (r[3] - r[1]), r[3])
        c.restoreState()


PIPE_PENS = {   # system → (width mm, dash mm)
    "Domestic cold water": (HEAVY, None),
    "Domestic hot water": (HEAVY, (3.0, 1.2)),
    "Soil and waste": (0.6, (5.0, 1.0, 0.8, 1.0)),
}


def _cross(pen: Pen, g: Rect, w=LIGHT):
    pen.width(w)
    pen.line(g[0], g[1], g[2], g[3])
    pen.line(g[0], g[3], g[2], g[1])


def draw_thing(pen: Pen, lay: Layout, t: Thing) -> None:
    g = run_rect(lay, t)
    cx, cy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
    s = t.style
    if s in ("rect_duct", "round_duct"):
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
        if s == "round_duct":
            pen.width(THIN, dash=(4.0, 1.0, 0.8, 1.0))
            if t.along_x:
                pen.line(g[0], cy, g[2], cy)
            else:
                pen.line(cx, g[1], cx, g[3])
    elif s == "riser_duct":
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
        _cross(pen, g)
    elif s in ("riser_round", "pipe_riser"):
        r = (g[2] - g[0]) / 2
        pen.width(MEDIUM)
        pen.circle(cx, cy, r, fill=1)
        _cross(pen, (cx - r * 0.7, cy - r * 0.7, cx + r * 0.7, cy + r * 0.7), THIN)
    elif s == "pipe":
        w, dash = PIPE_PENS.get(t.system or "", (HEAVY, None))
        pen.width(w, dash=dash)
        if t.along_x:
            pen.line(g[0], cy, g[2], cy)
        else:
            pen.line(cx, g[1], cx, g[3])
    elif s == "pipe_fitting":
        w, _ = PIPE_PENS.get(t.system or "", (HEAVY, None))
        pen.width(w)
        if g[2] - g[0] > 0.6 or g[3] - g[1] > 0.6:
            if t.along_x:
                pen.line(g[0], cy, g[2], cy)
            else:
                pen.line(cx, g[1], cx, g[3])
    elif s in ("tray", "tray_riser", "tray_fitting"):
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
        pen.hatch(g, 1.6)
        pen.width(MEDIUM)
        pen.rect(g)
        if s == "tray_riser":
            _cross(pen, g)
    elif s == "conduit":
        pen.width(LIGHT, dash=(1.5, 0.8))
        if t.along_x:
            pen.line(g[0], cy, g[2], cy)
        else:
            pen.line(cx, g[1], cx, g[3])
    elif s == "duct_fitting":
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
    elif s == "damper":
        pen.width(LIGHT)
        pen.rect(g, fill=1)
        pen.line(g[0], g[1], g[2], g[3])
    elif s == "diffuser":
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
        pen.width(THIN)
        pen.rect(grow(g, -(g[2] - g[0]) * 0.18))
        _cross(pen, g, THIN)
    elif s == "grille":
        pen.width(MEDIUM)
        pen.rect(g, fill=1)
        pen.width(THIN)
        for i in range(1, 6):
            y = g[1] + (g[3] - g[1]) * i / 6
            pen.line(g[0] + 0.8, y, g[2] - 0.8, y)
    elif s == "valve_terminal":
        r = (g[2] - g[0]) / 2
        pen.width(MEDIUM)
        pen.circle(cx, cy, r, fill=1)
        pen.circle(cx, cy, r * 0.35, fill=1, fill_color=black)
    elif s == "valve":
        pen.width(LIGHT)
        h = 1.2
        p = pen.c.beginPath()
        p.moveTo((cx - h) * mm, (cy - h) * mm)
        p.lineTo((cx + h) * mm, (cy + h) * mm)
        p.lineTo((cx + h) * mm, (cy - h) * mm)
        p.lineTo((cx - h) * mm, (cy + h) * mm)
        p.close()
        pen.c.setFillColor(white)
        pen.c.drawPath(p, stroke=1, fill=1)
    elif s == "sanitary":
        pen.width(LIGHT)
        pen.rect(g, fill=1)
        pen.width(THIN)
        inner = grow(g, -0.12 * min(g[2] - g[0], g[3] - g[1]))
        pen.c.ellipse(inner[0] * mm, inner[1] * mm, inner[2] * mm, inner[3] * mm, stroke=1, fill=0)
    elif s == "board":
        pen.width(MEDIUM)
        pen.rect(g, fill=1, fill_color=LIGHT_GREY)
        pen.hatch(g, 0.8, color=DARK)
        pen.width(MEDIUM)
        pen.rect(g)


def draw_label(pen: Pen, members: list[Thing], placed: Placed) -> dict[str, Rect]:
    """Draw a label (white mask, its lines, the leader) in its placed rect; the text boxes in paper mm: one per tag
    ("tag:<key>"), one per size ("size:<text>"), and "label"."""
    lines = group_lines(members)
    w, h = label_wh(lines)
    r = placed.rect
    cx = (r[0] + r[2]) / 2
    box = (cx - w / 2, r[3] - h, cx + w / 2, r[3])   # top-aligned: its lines stay on the sheet's pitch
    if placed.leader:
        (ax, ay), _ = placed.leader
        end = nearest_on_rect((ax, ay), box)
        pen.width(THIN)
        pen.line(ax, ay, end[0], end[1])
        pen.circle(ax, ay, 0.45, stroke=0, fill=1, fill_color=black)
    pen.rect(box, stroke=0, fill=1)
    by_tag = {t.tag: key(t) for t in members if t.tag}
    boxes: dict[str, Rect] = {"label": box}
    for i, (s, font) in enumerate(lines):
        base = box[3] - PAD_MM - i * LINE_MM - 0.84 * FS_MM
        tw = stringWidth(s, font, LABEL_PT) / PT_PER_MM
        pen.text(cx, base, s, font=font, align="center")
        tb = (cx - tw / 2, base - 0.207 * FS_MM, cx + tw / 2, base + 0.793 * FS_MM)
        boxes[f"tag:{by_tag[s]}" if font == BOLD else f"size:{s}"] = tb
    return boxes


def _dims(data: SheetData):
    us = sorted({(a[0], tag) for tag, a, b in data.grids if abs(a[0] - b[0]) < 1e-6})
    vs = sorted({(a[1], tag) for tag, a, b in data.grids if abs(a[1] - b[1]) < 1e-6})
    ys = [v for _, a, b in data.grids for v in (a[1], b[1])]
    xs = [v for _, a, b in data.grids for v in (a[0], b[0])]
    return us, vs, max(ys), min(xs)


DIM_PT = 7.0


def dimension_texts(lay: Layout, data: SheetData) -> list[tuple[str, Rect]]:
    """The dimension strings between grids (mm, as drawings give them) and where their text goes."""
    us, vs, ytop, xleft = _dims(data)
    out = []
    th = DIM_PT / PT_PER_MM
    y_line = lay.p(0, ytop)[1] - 16.0
    for (xa, _), (xb, _) in zip(us, us[1:]):
        s = f"{round((xb - xa) * 1000)}"
        mx = (lay.p(xa, 0)[0] + lay.p(xb, 0)[0]) / 2
        w = stringWidth(s, FONT, DIM_PT) / PT_PER_MM
        out.append((s, (mx - w / 2, y_line + 0.8, mx + w / 2, y_line + 0.8 + th)))
    x_line = lay.p(xleft, 0)[0] + 16.0
    for (ya, _), (yb, _) in zip(vs, vs[1:]):
        s = f"{round((yb - ya) * 1000)}"
        my = (lay.p(0, ya)[1] + lay.p(0, yb)[1]) / 2
        w = stringWidth(s, FONT, DIM_PT) / PT_PER_MM
        out.append((s, (x_line + 1.0, my - th / 2, x_line + 1.0 + w, my + th / 2)))
    return out


def dimension_rects(lay: Layout, data: SheetData) -> list[Rect]:
    return [r for _, r in dimension_texts(lay, data)]


def draw_grids_and_dims(pen: Pen, lay: Layout, data: SheetData) -> None:
    pen.width(THIN, GREY, dash=(8.0, 1.5, 1.0, 1.5))
    for _tag, a, b in data.grids:
        pa, pb = lay.p(*a), lay.p(*b)
        pen.line(pa[0], pa[1], pb[0], pb[1])
    for tag, cx, cy in bubbles(lay, data):
        pen.width(LIGHT, DARK)
        pen.circle(cx, cy, BUBBLE_R, fill=1)
        pen.text(cx, cy - 1.25, tag, font=BOLD, pt=10, align="center", color=DARK)
    # Dimension chains: grid to grid, with ticks.
    us, vs, ytop, xleft = _dims(data)
    y_line = lay.p(0, ytop)[1] - 16.0
    x_line = lay.p(xleft, 0)[0] + 16.0
    pen.width(THIN, DARK)
    pen.line(lay.p(us[0][0], 0)[0] - 2, y_line, lay.p(us[-1][0], 0)[0] + 2, y_line)
    for x, _ in us:
        px = lay.p(x, 0)[0]
        pen.line(px - 1, y_line - 1, px + 1, y_line + 1)
        pen.line(px, y_line - 2, px, y_line + 2)
    pen.line(x_line, lay.p(0, vs[0][0])[1] - 2, x_line, lay.p(0, vs[-1][0])[1] + 2)
    for y, _ in vs:
        py = lay.p(0, y)[1]
        pen.line(x_line - 1, py - 1, x_line + 1, py + 1)
        pen.line(x_line - 2, py, x_line + 2, py)
    for s, r in dimension_texts(lay, data):
        pen.text(r[0], r[1] + 0.207 * DIM_PT / PT_PER_MM, s, pt=DIM_PT, color=DARK)


def draw_structure(pen: Pen, lay: Layout, data: SheetData) -> None:
    if data.slab:
        pen.width(HEAVY, GREY)
        pen.rect(lay.rect(data.slab))
    for name, r in data.beams:
        heavy = "transfer" in name.lower()
        pen.width(MEDIUM if heavy else LIGHT, GREY, dash=(3.0, 1.5))
        pen.rect(lay.rect(r))
    pen.width(LIGHT, GREY)
    for r in data.columns:
        pen.rect(lay.rect(r), fill=1, fill_color=GREY)


def north_rect() -> Rect:
    x, y = AREA[2] - 22.0, AREA[3] - 30.0
    return x - 12.0, y - 12.0, x + 12.0, y + 22.0


def draw_north(pen: Pen) -> None:
    x, y = AREA[2] - 22.0, AREA[3] - 30.0
    pen.width(LIGHT)
    pen.circle(x, y, 10.0)
    p = pen.c.beginPath()
    p.moveTo(x * mm, (y + 10.0) * mm)
    p.lineTo((x - 4.0) * mm, (y - 7.0) * mm)
    p.lineTo(x * mm, (y - 3.5) * mm)
    p.close()
    pen.c.setFillColor(black)
    pen.c.drawPath(p, stroke=1, fill=1)
    p = pen.c.beginPath()
    p.moveTo(x * mm, (y + 10.0) * mm)
    p.lineTo((x + 4.0) * mm, (y - 7.0) * mm)
    p.lineTo(x * mm, (y - 3.5) * mm)
    p.close()
    pen.c.setFillColor(white)
    pen.c.drawPath(p, stroke=1, fill=1)
    pen.text(x, y + 12.5, "N", font=BOLD, pt=14, align="center")


def view_title_rect() -> Rect:
    return AREA[0] + 4.0, AREA[1], AREA[0] + 200.0, AREA[1] + 40.0


def draw_view_title(pen: Pen, lay: Layout) -> None:
    x0, y0 = AREA[0] + 16.0, AREA[1] + 26.0
    pen.width(MEDIUM)
    pen.circle(x0, y0, 9.0)
    pen.line(x0 - 9.0, y0, x0 + 9.0, y0)
    pen.text(x0, y0 + 2.2, "1", font=BOLD, pt=12, align="center")
    pen.text(x0, y0 - 5.6, SHEET, pt=7, align="center")
    pen.text(x0 + 13.0, y0 + 1.5, "LEVEL 02 — MECHANICAL SERVICES PLAN", font=BOLD, pt=14)
    pen.width(HEAVY)
    tw = stringWidth("LEVEL 02 — MECHANICAL SERVICES PLAN", BOLD, 14) / PT_PER_MM
    pen.line(x0 + 13.0, y0 - 0.2, x0 + 13.0 + tw, y0 - 0.2)
    pen.text(x0 + 13.0, y0 - 5.6, f"SCALE 1:{lay.scale}", pt=9)
    # Scale bar: 5 m in 1 m blocks.
    bx, by = x0 + 13.0, AREA[1] + 8.0
    step = lay.len(1.0)
    pen.width(LIGHT)
    for i in range(5):
        pen.rect((bx + i * step, by, bx + (i + 1) * step, by + 2.0), fill=1, fill_color=black if i % 2 == 0 else white)
    for i in range(6):
        s = "5 m" if i == 5 else str(i)
        pen.text(bx + i * step, by + 3.2, s, pt=7, align="center")
    pen.text(bx + 5 * step + 8.0, by + 0.4, f"1:{lay.scale}", font=BOLD, pt=8)


LEGEND = (
    ("rect_duct", "RECTANGULAR DUCTWORK (W x D)"),
    ("round_duct", "CIRCULAR DUCTWORK"),
    ("riser_duct", "DUCT RISER"),
    ("diffuser", "SUPPLY AIR DIFFUSER"),
    ("grille", "RETURN AIR GRILLE"),
    ("damper", "FIRE / VOLUME CONTROL DAMPER"),
    ("cw", "COLD WATER PIPEWORK"),
    ("hw", "HOT WATER PIPEWORK"),
    ("sw", "SOIL AND WASTE PIPEWORK"),
    ("pipe_riser", "PIPE RISER / STACK"),
    ("tray", "CABLE TRAY"),
    ("beam", "STRUCTURE OVER (BACKGROUND)"),
)

NOTES = (
    "DO NOT SCALE. ALL DIMENSIONS IN MILLIMETRES.",
    "DUCT SIZES ARE WIDTH x DEPTH; PIPE SIZES ARE DIAMETERS.",
    "SERVICES AT HIGH LEVEL IN THE CEILING VOID UNLESS NOTED.",
    "READ WITH THE STRUCTURAL DRAWINGS.",
    "SYNTHETIC SAMPLE DRAWN FROM THE NORTHBANK MODEL.",
)


def legend_rect() -> Rect:
    return STRIP_X + 4.0, 396.0, FRAME[2] - 4.0, 541.0


def draw_strip(pen: Pen, lay: Layout) -> None:
    x0, x1 = STRIP_X, FRAME[2]
    pen.width(FRAME_PEN)
    pen.line(x0, FRAME[1], x0, FRAME[3])
    # Notes
    y = FRAME[3] - 8.0
    pen.text(x0 + 4.0, y, "NOTES", font=BOLD, pt=10)
    for i, n in enumerate(NOTES, 1):
        y -= 5.0
        pen.text(x0 + 4.0, y, f"{i}.", pt=7.5)
        pen.text(x0 + 9.0, y, n, pt=7.5)
    pen.width(MEDIUM)
    pen.line(x0, 545.0, x1, 545.0)
    # Legend
    lx = legend_rect()
    pen.text(x0 + 4.0, lx[3] - 4.0, "LEGEND", font=BOLD, pt=10)
    y = lx[3] - 14.0
    for style, text in LEGEND:
        sx = x0 + 6.0
        r = (sx, y - 1.8, sx + 18.0, y + 1.8)
        if style in ("rect_duct", "round_duct"):
            pen.width(MEDIUM)
            pen.rect(r)
            if style == "round_duct":
                pen.width(THIN, dash=(4.0, 1.0, 0.8, 1.0))
                pen.line(r[0], y, r[2], y)
        elif style == "riser_duct":
            q = (sx + 6.0, y - 3.0, sx + 12.0, y + 3.0)
            pen.width(MEDIUM)
            pen.rect(q)
            pen.width(LIGHT)
            pen.line(q[0], q[1], q[2], q[3])
            pen.line(q[0], q[3], q[2], q[1])
        elif style in ("diffuser", "grille"):
            q = (sx + 6.0, y - 3.0, sx + 12.0, y + 3.0)
            draw_thing(pen, Layout(1000, (0, 0)), Thing(None, None, None, None, None, None, style, None, None,
                                                         None, (q[0], q[1], 0, q[2], q[3], 0)))
        elif style == "damper":
            q = (sx + 5.0, y - 2.0, sx + 13.0, y + 2.0)
            pen.width(LIGHT)
            pen.rect(q)
            pen.line(q[0], q[1], q[2], q[3])
        elif style in ("cw", "hw", "sw"):
            w, dash = PIPE_PENS[{"cw": "Domestic cold water", "hw": "Domestic hot water",
                                 "sw": "Soil and waste"}[style]]
            pen.width(w, dash=dash)
            pen.line(r[0], y, r[2], y)
        elif style == "pipe_riser":
            pen.width(MEDIUM)
            pen.circle(sx + 9.0, y, 1.6, fill=1)
            pen.width(THIN)
            pen.line(sx + 7.9, y - 1.1, sx + 10.1, y + 1.1)
            pen.line(sx + 7.9, y + 1.1, sx + 10.1, y - 1.1)
        elif style == "tray":
            pen.width(MEDIUM)
            pen.rect(r, fill=1)
            pen.hatch(r, 1.6)
            pen.width(MEDIUM)
            pen.rect(r)
        elif style == "beam":
            pen.width(LIGHT, GREY, dash=(3.0, 1.5))
            pen.rect(r)
        pen.text(sx + 24.0, y - 1.0, text, pt=7.5)
        y -= 11.5
    pen.width(MEDIUM)
    pen.line(x0, lx[1] - 4.0, x1, lx[1] - 4.0)
    # Revisions
    y = lx[1] - 12.0
    pen.text(x0 + 4.0, y, "REV", font=BOLD, pt=7.5)
    pen.text(x0 + 18.0, y, "DATE", font=BOLD, pt=7.5)
    pen.text(x0 + 44.0, y, "DESCRIPTION", font=BOLD, pt=7.5)
    pen.text(x0 + 4.0, y - 6.0, "P01", pt=7.5)
    pen.text(x0 + 18.0, y - 6.0, DATE, pt=7.5)
    pen.text(x0 + 44.0, y - 6.0, "FIRST ISSUE FOR COORDINATION", pt=7.5)
    pen.width(MEDIUM)
    pen.line(x0, 265.0, x1, 265.0)
    # Maker
    pen.text(x0 + 4.0, 254.0, GENERATOR, font=BOLD, pt=10)
    pen.text(x0 + 4.0, 247.0, "Synthetic data from the Northbank sample models. Not for construction.", pt=7)
    pen.line(x0, 240.0, x1, 240.0)
    # Title block fields
    def field_(fx, fy, caption, value, pt=12, font=BOLD):
        pen.text(fx, fy + max(7.0, pt / PT_PER_MM * 0.75 + 3.0), caption, pt=6.5, color=DARK)
        pen.text(fx, fy, value, font=font, pt=pt)
    field_(x0 + 4.0, 222.0, "PROJECT", PROJECT, pt=16)
    pen.line(x0, 212.0, x1, 212.0)
    field_(x0 + 4.0, 194.0, "DRAWING TITLE", TITLE, pt=14)
    pen.line(x0, 184.0, x1, 184.0)
    field_(x0 + 4.0, 168.0, "SCALE", f"1:{lay.scale} @ A1", pt=11)
    field_(x0 + 64.0, 168.0, "DATE", DATE, pt=11)
    field_(x0 + 124.0, 168.0, "PAPER", "A1", pt=11)
    pen.line(x0, 160.0, x1, 160.0)
    field_(x0 + 4.0, 144.0, "STATUS", "FOR COORDINATION", pt=11)
    field_(x0 + 124.0, 144.0, "DRAWN", "IRIS", pt=11)
    pen.line(x0, 136.0, x1, 136.0)
    field_(x0 + 4.0, 120.0, "DISCIPLINE", "MECHANICAL", pt=11)
    field_(x0 + 124.0, 120.0, "LEVEL", STOREY, pt=11)
    pen.line(x0, 112.0, x1, 112.0)
    pen.line(x0 + 120.0, 112.0, x0 + 120.0, 136.0)
    pen.line(x0 + 120.0, 136.0, x0 + 120.0, 160.0)
    pen.line(x0 + 60.0, 160.0, x0 + 60.0, 184.0)
    pen.line(x0 + 120.0, 160.0, x0 + 120.0, 184.0)
    field_(x0 + 4.0, 80.0, "SHEET", SHEET, pt=34)
    field_(x0 + 124.0, 80.0, "REV", "P01", pt=22)
    pen.line(x0 + 120.0, FRAME[1], x0 + 120.0, 112.0)
    pen.text(x0 + 4.0, 30.0, f"Plan of {STOREY} from {', '.join(MODELS)}.", pt=6.5, color=DARK)
    pen.text(x0 + 4.0, 24.0, "Tags and sizes are the model's own (IFC Tag, Size).", pt=6.5, color=DARK)


def title_block_fields(lay: Layout) -> dict:
    return {"project": PROJECT, "sheet": SHEET, "title": TITLE, "level": STOREY, "scale": f"1:{lay.scale}", "paper": "A1",
            "date": DATE, "revision": "P01", "status": "FOR COORDINATION", "maker": GENERATOR}


# ---------------------------------------------------------------------------------------------------------------------
# Variants and truth
# ---------------------------------------------------------------------------------------------------------------------

def px_box(r: Rect) -> list[float]:
    """Paper mm (y up) → page pixels at DPI (origin top left)."""
    k = DPI / 25.4
    return [round(r[0] * k, 1), round((PAPER[1] - r[3]) * k, 1), round(r[2] * k, 1), round((PAPER[1] - r[1]) * k, 1)]


def variant_things(data: SheetData, variant: str) -> tuple[list[Thing], dict[str, str]]:
    """The things a variant draws, and the planted change per drawn key ("clean" plants nothing)."""
    things = list(data.things)
    by_tag = {t.tag: t for t in things if t.tag}
    changes: dict[str, str] = {}
    if variant == "clean":
        return things, changes
    for p in PLANTED:
        if p["kind"] == "missing_in_model":
            x0, y0, x1, y1 = p["plan_m"]
            size, size_mm = parse_size(p["size"])
            t = Thing(gid=None, ifc_class=None, tag=p["tag"], name=None, system=None, kind=p["drawn"],
                      style=p["drawn"], size=size, size_mm=size_mm, model_size=None,
                      box=(x0, y0, 6.85, x1, y1, 6.95), label=True)
            things.append(t)
            changes[key(t)] = p["kind"]
            continue
        t = by_tag[p["tag"]]
        i = things.index(t)
        if p["kind"] == "missing_in_drawing":
            things.pop(i)
        elif p["kind"] == "size_differs":
            size, size_mm = parse_size(p["size"])
            things[i] = replace(t, size=size, size_mm=size_mm)
        elif p["kind"] == "type_differs":
            size, size_mm = parse_size(p["size"])
            things[i] = replace(t, kind=p["drawn"], style="rect_duct", size=size, size_mm=size_mm,
                                width_m=p["width_m"])
        changes[key(t)] = p["kind"]
    return things, changes


def planted_truth(data: SheetData, drawn: dict[str, dict]) -> list[dict]:
    by_tag = {t.tag: t for t in data.things if t.tag}
    out = []
    for p in PLANTED:
        m = by_tag.get(p["tag"])
        item = drawn.get(p["tag"])
        if p["kind"] == "size_differs":
            out.append({"kind": p["kind"], "tag": p["tag"], "item": item["id"], "element": m.gid,
                        "drawing_value": item["size"], "model_value": m.size, "model_size": m.model_size})
        elif p["kind"] == "missing_in_drawing":
            out.append({"kind": p["kind"], "tag": p["tag"], "item": None, "element": m.gid,
                        "drawing_value": None, "model_value": p["tag"]})
        elif p["kind"] == "missing_in_model":
            out.append({"kind": p["kind"], "tag": p["tag"], "item": item["id"], "element": None,
                        "drawing_value": p["tag"], "model_value": None})
        elif p["kind"] == "type_differs":
            out.append({"kind": p["kind"], "tag": p["tag"], "item": item["id"], "element": m.gid,
                        "drawing_value": item["kind"], "model_value": m.kind,
                        "note": "drawn as a rectangular duct; sizes are not compared across kinds"})
    return out


def render(data: SheetData, lay: Layout, groups: list[Group], variant: str, path: Path) -> dict:
    """Write one PDF and return its truth."""
    things, changes = variant_things(data, variant)
    present = {key(t): t for t in things}
    c = rl_canvas.Canvas(str(path), pagesize=(PAPER[0] * mm, PAPER[1] * mm), invariant=1, pageCompression=1)
    c.setTitle(f"{PROJECT} {SHEET} {TITLE}")
    c.setAuthor(GENERATOR)
    c.setSubject("Synthetic MEP plan with ground truth" + (" (planted mismatches)" if variant != "clean" else ""))
    c.setCreator(GENERATOR)
    pen = Pen(c)
    pen.width(FRAME_PEN)
    pen.rect(FRAME)
    pen.width(LIGHT)
    pen.rect((5.0, 5.0, PAPER[0] - 5.0, PAPER[1] - 5.0))
    draw_grids_and_dims(pen, lay, data)
    draw_structure(pen, lay, data)
    order = {"sanitary": 0, "board": 0, "duct_fitting": 1, "tray_fitting": 1, "conduit": 1, "pipe_fitting": 2,
             "pipe": 3, "valve": 4, "tray": 5, "tray_riser": 5, "rect_duct": 6, "round_duct": 6, "damper": 7,
             "riser_duct": 7, "riser_round": 7, "pipe_riser": 8, "diffuser": 8, "grille": 8, "valve_terminal": 8}
    for t in sorted(things, key=lambda t: (order.get(t.style, 9), key(t))):
        draw_thing(pen, lay, t)
    labels = []   # (thing, boxes, placed, group size)
    for gr in groups:
        members = [present[key(t)] for t in gr.members if key(t) in present]
        if not members:
            continue
        placed = lay.labels[gr.key]
        if placed.leader and key(gr.primary) not in present:   # its piece is gone: point at the nearest one left
            a = placed.leader[0]
            r = min((run_rect(lay, m) for m in members), key=lambda r: math.dist(a, nearest_on_rect(a, r)))
            placed = Placed(rect=placed.rect, leader=(((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), placed.leader[1]))
        labels.append((members, draw_label(pen, members, placed), placed))
    draw_north(pen)
    draw_view_title(pen, lay)
    draw_strip(pen, lay)
    c.showPage()
    c.save()

    items = []
    for members, boxes, placed in labels:
        for t in members:
            geom = run_rect(lay, t)
            items.append((t, geom, boxes, placed, len(members)))
    items.sort(key=lambda x: (x[0].tag is None, natural(x[0].tag), key(x[0])))
    out = []
    for n, (t, geom, boxes, placed, shared) in enumerate(items, 1):
        tag_box = boxes.get(f"tag:{key(t)}")
        size_box = boxes.get(f"size:{t.size}") if t.size else None
        out.append({
            "id": f"{SHEET}-{n:03d}",
            "tag": t.tag, "kind": t.kind, "size": t.size, "size_mm": t.size_mm,
            "box": px_box(union(geom, *(b for b in (tag_box, size_box) if b))),
            "gid": t.gid,
            "ifc_class": t.ifc_class, "name": t.name, "model_tag": t.model_tag, "model_size": t.model_size,
            "system": t.system,
            "geom_box": px_box(geom),
            "label_box": px_box(boxes["label"]),
            "tag_box": px_box(tag_box) if tag_box else None,
            "size_box": px_box(size_box) if size_box else None,
            "label_shared_by": shared,
            "leader": None if placed.leader is None else [round(v, 1) for p in placed.leader for v in
                                                           (p[0] * DPI / 25.4, (PAPER[1] - p[1]) * DPI / 25.4)],
            "planted": changes.get(key(t)),
        })

    drawn = {i["tag"]: i for i in out if i["tag"]}
    untagged = [{"gid": t.gid, "ifc_class": t.ifc_class, "style": t.style, "box": px_box(run_rect(lay, t))}
                for t in sorted(things, key=key) if not t.label]
    k = 1000.0 / lay.scale * DPI / 25.4
    return {
        "pdf": path.name,
        "variant": variant,
        "generator": "evals/make_drawings.py",
        "page": 0, "dpi": DPI, "paper": "A1", "paper_mm": list(PAPER),
        "width_px": round(PAPER[0] / 25.4 * DPI), "height_px": round(PAPER[1] / 25.4 * DPI),
        "title_block": title_block_fields(lay),
        "storey": STOREY,
        "models": data.models,
        # model metres → page pixels: px = a * x + c, py = d * y + f
        "model_to_px": {"a": round(k, 6), "c": round(lay.origin[0] * DPI / 25.4, 3),
                        "d": round(-k, 6), "f": round((PAPER[1] - lay.origin[1]) * DPI / 25.4, 3)},
        "rules": {
            "labelled": f"every duct, pipe and cable carrier segment on {STOREY} (tag and size), air terminals (size "
                        "only: their model tags are not unique), distribution boards (tag); fittings and accessories "
                        "are drawn untagged",
            "shared_labels": f"short pieces of one run (same tag stem, family and size, each at most {GROUP_MAX_M} m "
                             f"in plan, at most {GROUP_GAP_M} m apart) share one label, one tag per line",
            "sizes": "rectangular W x D in mm as the model's Size; model DN<n> (pipe) and D<n> (round duct) drawn Ø<n>",
            "boxes": "page pixels at dpi, origin top left: box = the item's drawn outline with its tag and size text",
        },
        "scope": sorted(t.gid for t in data.things if t.label and t.tag),
        "scope_terminals": sorted(t.gid for t in data.things if t.label and not t.tag),
        "items": out,
        "untagged": untagged,
        "legend_box": px_box(legend_rect()),
        "title_block_box": px_box((STRIP_X, FRAME[1], FRAME[2], FRAME[3])),
        "mismatches": [] if variant == "clean" else planted_truth(data, drawn),
    }


def build(out: Path = OUT, samples: Path = SAMPLES, *, scale: int | None = None) -> list[Path]:
    """Write the clean and the mismatch sheet with their truth files into `out`; the paths written."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    data = sheet_data(Path(samples))
    lay = fit_scale(data, scale)
    variants = {v: variant_things(data, v)[0] for v in ("clean", "mismatch")}
    # Every thing either sheet draws, as obstacles; a thing drawn wider on one sheet counts at its widest.
    every: dict[str, Thing] = {}
    for v in ("clean", "mismatch"):
        for t in variants[v]:
            if key(t) not in every or t.width_m is not None:
                every[key(t)] = t
    groups = group_labels([*data.things, *(t for t in variants["mismatch"] if t.gid is None)])
    dims = {}
    for gr in groups:
        sizes = []
        for v in ("clean", "mismatch"):
            have = {key(t): t for t in variants[v]}
            members = [have[key(t)] for t in gr.members if key(t) in have]
            if members:
                sizes.append(label_wh(group_lines(members)))
        dims[gr.key] = (max(w for w, _ in sizes), max(h for _, h in sizes))
    layout_labels(lay, data, list(every.values()), groups, dims)
    written = []
    for variant, stem in (("clean", STEM), ("mismatch", f"{STEM}-mismatch")):
        pdf = out / f"{stem}.pdf"
        truth = render(data, lay, groups, variant, pdf)
        tj = out / f"{stem}.truth.json"
        tj.write_text(json.dumps(truth, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        written += [pdf, tj]
    return written


def preview(pdf: Path, png: Path, dpi: int = DPI) -> Path:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(pdf))
    try:
        doc[0].render(scale=dpi / 72).to_pil().save(png)
    finally:
        doc.close()
    return png


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--samples", type=Path, default=SAMPLES)
    ap.add_argument("--scale", type=int, default=None, help="plan scale denominator (default: largest that fits)")
    ap.add_argument("--preview", type=Path, default=None, help="also render the clean sheet to this PNG")
    args = ap.parse_args(argv)
    paths = build(args.out, args.samples, scale=args.scale)
    for p in paths:
        print(f"{p}  {p.stat().st_size / 1024:.1f} KB")
    truth = json.loads(paths[1].read_text(encoding="utf-8"))
    kinds: dict[str, int] = {}
    for i in truth["items"]:
        kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    print(f"scale 1:{truth['title_block']['scale'].split(':')[1]}, items {len(truth['items'])} {kinds}, "
          f"untagged {len(truth['untagged'])}")
    if args.preview:
        print(preview(paths[0], args.preview))
    return 0


if __name__ == "__main__":
    sys.exit(main())
