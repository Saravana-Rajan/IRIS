"""Iris Bench shared contract: the data every part of the pipeline reads and writes.

Units are metres, Z up, scenes stay near the origin (within ±50 m). Every element is an axis-aligned box or an
axis-aligned cylinder (a run along X or Y), so the answer key can be computed in closed form. The scene generator
writes this, the renderer draws it, the checker measures it, and the jobs ask about it.

Pipeline: generate(seed) -> Scene -> scene.json + scene.ifc -> render -> Views -> build items -> Item -> model reply
-> check -> Result -> score.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

SCHEMA_VERSION = 2

Kind = Literal["beam", "column", "slab", "duct", "pipe", "tray", "bracket"]
Role = Literal["structure", "service", "support"]
Shape = Literal["box", "cylinder"]
ClashKind = Literal["real", "not_touching", "by_design"]
Job = Literal["J1_sort", "J2_who_moves", "J3_fix", "J4_opening", "J5_review",
              "J6_new_clash", "J7_pick_valid", "J8_spatial", "J9_relation"]

# The eight scored task categories. Every Item carries one or more of these in `categories`.
Category = Literal["clash_identification", "relationship_understanding", "element_selection", "spatial_reasoning",
                   "opening_selection", "movement_estimation", "resolution_validity", "new_clash_detection"]
CATEGORIES: tuple[str, ...] = ("clash_identification", "relationship_understanding", "element_selection",
                               "spatial_reasoning", "opening_selection", "movement_estimation",
                               "resolution_validity", "new_clash_detection")

# The engineering question each job asks, and the category it is scored under.
#   J1 Is there an actual geometric clash between these elements?          -> clash_identification
#   J2 Which element is movable under the given constraints?               -> element_selection
#   J3 What movement would resolve this clash?                             -> movement_estimation
#   J4 Which opening is suitable for routing this element?                 -> opening_selection
#   J5 Does the proposed movement resolve the original clash?              -> resolution_validity
#   J6 Does the movement introduce new clashes?                            -> new_clash_detection
#   J7 Which of several proposed solutions is geometrically valid?         -> resolution_validity
#   J8 Spatial reasoning across several elements (highest, between, order) -> spatial_reasoning
#   J9 Relationships (passes through, crosses, parallel, supports, touches) -> relationship_understanding
JOB_CATEGORY: dict[str, str] = {
    "J1_sort": "clash_identification", "J2_who_moves": "element_selection", "J3_fix": "movement_estimation",
    "J4_opening": "opening_selection", "J5_review": "resolution_validity", "J6_new_clash": "new_clash_detection",
    "J7_pick_valid": "resolution_validity", "J8_spatial": "spatial_reasoning", "J9_relation": "relationship_understanding",
}
Mode = Literal["pictures", "pictures_text", "no_image", "swapped", "agentic"]

Vec = tuple[float, float, float]


@dataclass
class Opening:
    """A rectangular void through a beam's web, as a world box (min, max)."""
    id: str                      # "o1", "o2" ... unique within the scene
    min: Vec
    max: Vec


@dataclass
class Element:
    id: str                      # "e1", "e2" ... unique within the scene; never shown to the model
    kind: Kind
    role: Role                   # structure stays; services move; supports are by design
    shape: Shape
    min: Vec | None = None       # box: world min corner
    max: Vec | None = None       # box: world max corner
    start: Vec | None = None     # cylinder: axis start (axis-aligned along X or Y)
    end: Vec | None = None       # cylinder: axis end
    radius: float | None = None  # cylinder radius
    openings: list[Opening] = field(default_factory=list)   # beams only
    supports: str | None = None  # for kind "bracket": the id of the element it carries (touching by design)
    locked: bool = False         # an explicit constraint: this element must not move (drawn with a lock badge)
    allowed_moves: list[str] = field(default_factory=list)   # directions it may move ("up", "down", "north", ...); [] = any


@dataclass
class Fix:
    """A move of one element: a translation, optionally through a named opening."""
    element: str                 # element id
    dx: float = 0.0
    dy: float = 0.0
    dz: float = 0.0
    via_opening: str | None = None


@dataclass
class Relation:
    """A ground-truth spatial relationship, computed by geometry (never by a model)."""
    a: str
    b: str
    relation: str                # "above" | "below" | "north_of" | "south_of" | "east_of" | "west_of" | "crosses" |
                                 # "parallel" | "passes_through" | "supports" | "touches" | "clashes" | "clear_of"
    value_m: float | None = None  # the measured quantity behind it (vertical gap, distance, overlap ...)
    via: str | None = None        # opening id for "passes_through"


@dataclass
class Resolution:
    """A candidate fix for one planted pair, with the geometry verdict and its evidence."""
    pair: int                    # index into Scene.planted
    label: str                   # "good" | "too_small" | "wrong_direction" | "hits_third" | "wrong_element" | ...
    fix: "Fix"
    valid: bool                  # checker.check_fix(...)["passed"]
    resolves_original: bool      # the planted clash is gone
    new_hits: list[str] = field(default_factory=list)
    evidence: dict = field(default_factory=dict)   # the full check_fix result (min_clear_m, reason, ...)


@dataclass
class Camera:
    """A configurable viewpoint. Renderers accept these instead of (or as well as) a seeded random camera."""
    name: str                    # "A", "B", "C", "top", "section_x" ...
    azimuth_deg: float = 45.0
    elevation_deg: float = 30.0
    distance_factor: float = 1.0  # 1.0 = frame the focus tightly
    projection: str = "perspective"   # "perspective" | "orthographic"


@dataclass
class Planted:
    """One pair the generator placed on purpose, with what is true about it."""
    a: str                       # element id
    b: str                       # element id
    kind: ClashKind
    distance_m: float            # negative = overlap depth, positive = gap, 0 = touching
    mover: str | None = None     # the element that should move (real clashes only)
    good_fix: Fix | None = None  # a fix the generator knows is valid (real clashes only)
    fitting_openings: list[str] = field(default_factory=list)   # openings the mover fits through (J4)


@dataclass
class Scene:
    seed: int
    elements: list[Element]
    planted: list[Planted]
    challenge: dict = field(default_factory=dict)   # density, occlusion, gap_mm, decoys, view, style ...
    clearance_m: float = 0.025                      # required clear gap for a fix to pass
    relations: list[Relation] = field(default_factory=list)       # ground-truth relationships (geometry)
    resolutions: list[Resolution] = field(default_factory=list)   # valid AND invalid candidate fixes, with evidence
    cameras: list[Camera] = field(default_factory=list)           # viewpoints to render (empty = renderer defaults)
    schema_version: int = SCHEMA_VERSION

    def element(self, eid: str) -> Element:
        return next(e for e in self.elements if e.id == eid)

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    def save(self, path: Path) -> None:
        Path(path).write_text(self.to_json())

    @staticmethod
    def from_dict(d: dict) -> "Scene":
        els = [Element(**{**e, "openings": [Opening(**o) for o in e.get("openings", [])]}) for e in d["elements"]]
        pl = [Planted(**{**p, "good_fix": Fix(**p["good_fix"]) if p.get("good_fix") else None}) for p in d["planted"]]
        rel = [Relation(**r) for r in d.get("relations", [])]
        res = [Resolution(**{**r, "fix": Fix(**r["fix"])}) for r in d.get("resolutions", [])]
        cams = [Camera(**c) for c in d.get("cameras", [])]
        return Scene(seed=d["seed"], elements=els, planted=pl, challenge=d.get("challenge", {}),
                     clearance_m=d.get("clearance_m", 0.025), relations=rel, resolutions=res, cameras=cams,
                     schema_version=d.get("schema_version", SCHEMA_VERSION))

    @staticmethod
    def load(path: Path) -> "Scene":
        return Scene.from_dict(json.loads(Path(path).read_text()))


@dataclass
class View:
    """One rendered picture. The renderer writes `views.json` (a list of these) next to the PNGs."""
    name: str                    # "A" | "B" | "C" | "before" | "after"
    image: str                   # path to the PNG, relative to the scene folder
    id_image: str                # path to the object-ID PNG (flat colour per element)
    labels: dict[str, str]       # element id -> letter shown in the picture ("e3" -> "A")
    colors: dict[str, str]       # element id -> hex colour used in the picture
    visible_px: dict[str, int]   # element id -> visible pixel count in this view (evidence gate)
    focus: list[str] = field(default_factory=list)   # element ids this view is framed on


@dataclass
class Item:
    """One task given to a model."""
    id: str                      # f"{seed}-{job}-{n}-{mode}"
    seed: int
    job: Job
    mode: Mode
    images: list[str]            # absolute or scene-relative PNG paths, in the order shown
    prompt: str
    schema: dict                 # JSON schema the reply must follow
    truth: dict                  # what the checker needs (never sent to the model)
    meta: dict = field(default_factory=dict)   # challenge settings copied from the scene, for slicing results
    categories: list[str] = field(default_factory=list)   # scored categories (see CATEGORIES / JOB_CATEGORY)
    evidence: dict = field(default_factory=dict)  # how the reference answer was established (geometry numbers, checks)


@dataclass
class Result:
    item_id: str
    model: str
    reply: dict | None
    correct: bool | None         # None = unparseable / refused
    detail: dict = field(default_factory=dict)   # e.g. {"clash_gone": true, "min_clear_mm": 50, "new_hits": []}
    latency_s: float = 0.0
    cost_usd: float = 0.0
