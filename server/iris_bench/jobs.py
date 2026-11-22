"""The nine coordination jobs (the eight engineering questions), asked about one scene.

The model sees the scene. Iris knows the geometry. The geometry independently verifies the answer.

`build_items(scene, views, modes)` turns a scene and its rendered views into `Item`s. Every item carries
`categories=[JOB_CATEGORY[job]]`, a `truth` (never sent to the model) and an `evidence` dict saying how the reference
answer was established (the geometry numbers and checks used: geom.distance, geom.bbox, geom.fits, checker.check_fix,
scene.relations, scene.resolutions).

    job            truth["question"]                 reply fields (+ confidence, reason)      reference
    J1_sort        "sort"   real/apart/by design      answer: "a" | "b" | "c"                  planted kind (+ geom)
                   "binary" is there a real clash?    clash: bool                              planted kind == real
    J2_who_moves   "who_moves" (padlock = locked)     mover_letter                             Planted.mover
    J3_fix         "fix"                              element, direction, distance_mm, via     checker (check hook)
    J4_opening     "opening"                          fitting: [opening letters]               Planted.fitting_openings
    J5_review      "resolves_original"                resolved: bool                           Resolution.resolves_original
    J6_new_clash   "new_clash"                        new_clash: bool                          bool(Resolution.new_hits)
    J7_pick_valid  "pick_valid"                       valid: [candidate numbers]               Resolution.valid
    J8_spatial     "highest" | "north" | "order" |    answer: letter ("none") | order: [...]   geom.bbox extents
                   "between"
    J9_relation    "relation" | "passes_opening"      relation: word | passes: bool            scene.relations (geom)

Every truth carries "question", "answer" (the reference in the reply's vocabulary), "expected" (the exact reply
fields a perfect model gives, without confidence/reason; J3: the reply form of the planted good fix) and "letters"
(picture letter -> element/opening id). Every reply schema also requires "confidence" (0-1) and "reason" (at most
200 characters), so the scorer can compare "sounds reasonable" with "geometrically correct".

Letters: the renderer labels elements (View.labels, element id -> letter, from ELEMENT_LETTERS) and openings (opening
id -> letter, from OPENING_LETTERS), lettering each focus afresh, so a letter means different elements in different
pairs' pictures. Each item therefore takes its letter map from the views it shows (stored as truth["letters"],
letter -> id, which replies are resolved with); ids missing there are filled in, seeded by the scene. Directions
(north, east, up) are read off the compass drawn in every picture.

Pictures: J1-J4 use the views framed on the planted pair; J5/J6 render before/after pictures of a candidate fix
(`fix_renderer`); J7 renders the candidates (`cand_renderer`: views "cand_1".."cand_N" and/or "cand_grid"); J8/J9
use views that label three or more elements (or render such a group with `group_renderer`), and for J9 also the
planted pairs' views. `renderers_for(scene_dir)` builds all three on iris_bench.render.

Candidate fixes (J5-J7) come from `scene.resolutions` (truth.annotate); a pair without any falls back to
`candidate_fixes` judged by checker.check_fix. A move of a locked element is a candidate like any other (check_fix
fails it; its padlock is in the picture).

Ambiguity: J8 items whose answer margin is under AMBIGUOUS_M (30 mm) on any of bottom / centre / top are skipped,
and so are J9 relations that hinge on a gap or overlap under 30 mm (J1 tests those).

Modes: "pictures" prompts never name what an element is, how big it is, where it is or how far apart things are;
the "pictures_text" comparison mode appends measured facts. Every prompt ends with "Answer with JSON only." and every
item carries a strict JSON Schema (`Item.schema`).
"""
from __future__ import annotations

import random
from collections import defaultdict
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from itertools import combinations, pairwise
from pathlib import Path

from . import geom
from .spec import JOB_CATEGORY, Element, Fix, Item, Planted, Scene, View

SYSTEM = ("You are an experienced building services coordinator reviewing rendered 3D views of a building model. "
          "Each picture shows labelled parts. Judge only from what the pictures show. Reply with a single JSON "
          "object that follows the given schema.")

ANSWER = "Answer with JSON only."
REASON_MAX = 200
CONFIDENCE = ("Also give \"confidence\" (a number from 0 to 1: how sure you are) and \"reason\" (one short sentence, "
              f"at most {REASON_MAX} characters, on what decided it).")
META_FIELDS = ("confidence", "reason")
META_PROPS = {"confidence": {"type": "number", "minimum": 0, "maximum": 1},
              "reason": {"type": "string", "maxLength": REASON_MAX}}

# The renderer's letter pools: element letters skip E, N, U, I and O (the compass shows N / E / up), openings use
# their own; past the end, letters repeat with a number (A2, B2 ...).
try:
    from .render import ELEMENT_LETTERS, OPENING_LETTERS
except ImportError:   # renderer module without the pools
    ELEMENT_LETTERS = "ABCDFGHJKLMRST"
    OPENING_LETTERS = "PQVWXYZ"
DIRECTIONS = ("up", "down", "north", "south", "east", "west")
AXES = {"up": (0, 0, 1), "down": (0, 0, -1), "north": (0, 1, 0), "south": (0, -1, 0),
        "east": (1, 0, 0), "west": (-1, 0, 0)}
KIND_CHOICES = {"a": "real", "b": "not_touching", "c": "by_design"}
KIND_LETTER = {v: k for k, v in KIND_CHOICES.items()}
FIX_VIEWS = ("before", "after")
ALL_JOBS = tuple(JOB_CATEGORY)

# J9 answer vocabulary (spec.Relation words), in the order the prompt asks the model to apply them.
RELATIONS = ("passes_through", "supports", "clashes", "touches", "crosses", "parallel", "clear_of")
AMBIGUOUS_M = 0.03          # J8 answer margin / J9 gap or overlap below this is ambiguous: the item is skipped
NEAR_OPENING_M = 0.5        # J9 "does it pass through P": elements this close to the opening's owner are asked about
MAX_GROUPS = 3              # J8/J9 element groups per scene
MAX_GROUP_SIZE = 8          # larger labelled groups are sampled down (seeded) before choosing question subsets
J9_PER_RELATION = 2         # J9 relation items per relation word per scene
J9_OPENING_MAX = 4          # J9 "passes through P" items per scene
BALANCED_JOBS = ("J1_sort", "J5_review", "J6_new_clash", "J9_relation")
BALANCED_QUESTIONS = ("sort", "binary", "resolves_original", "new_clash", "passes_opening")

# A function that renders a candidate fix: (scene, fix) -> views before and after it (names "before*" / "after*").
FixRenderer = Callable[[Scene, Fix], list[View]]
# Renders candidate fixes side by side: (scene, focus=ids, fixes=[Fix]) -> views "before", "cand_1".."cand_N" and/or
# "cand_grid" (called with focus and fixes as keywords).
CandRenderer = Callable[[Scene, list[str], list[Fix]], list[View]]
# Renders a group of elements, each labelled: (scene, focus ids) -> views.
GroupRenderer = Callable[[Scene, list[str]], list[View]]


# ------------------------------------------------------------------------------------------------- geometry helpers

def bounds(e: Element) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """An element's world AABB."""
    if e.shape == "box":
        return tuple(e.min), tuple(e.max)
    r = e.radius or 0.0
    lo = tuple(min(s, t) - r for s, t in zip(e.start, e.end))
    hi = tuple(max(s, t) + r for s, t in zip(e.start, e.end))
    # the axis of the run gets no radius padding
    axis = max(range(3), key=lambda i: abs(e.end[i] - e.start[i]))
    lo = tuple(min(e.start[i], e.end[i]) if i == axis else lo[i] for i in range(3))
    hi = tuple(max(e.start[i], e.end[i]) if i == axis else hi[i] for i in range(3))
    return lo, hi


def _center(e: Element) -> tuple[float, float, float]:
    lo, hi = bounds(e)
    return tuple((a + b) / 2 for a, b in zip(lo, hi))


def _long_axis(e: Element) -> int:
    lo, hi = bounds(e)
    return max(range(3), key=lambda i: hi[i] - lo[i])


def _run_axis(e: Element) -> int | None:
    """The horizontal axis a run goes along (its length at least 3x its section), else None (columns, slabs, boxes)."""
    lo, hi = geom.bbox(e)
    size = [hi[i] - lo[i] for i in range(3)]
    k = max(range(3), key=lambda i: size[i])
    if k == 2 or size[k] < 3 * max(size[i] for i in range(3) if i != k):
        return None
    return k


def _extent(scene: Scene, eid: str, axis: int) -> tuple[float, float, float]:
    """(low side, centre, high side) of an element along one axis."""
    lo, hi = geom.bbox(scene.element(eid))
    return lo[axis], (lo[axis] + hi[axis]) / 2, hi[axis]


def _above(ext: dict, u: str, v: str) -> float:
    """How clearly u is beyond v along the axis on every measure (bottom, centre and top): the least difference."""
    return min(ext[u][i] - ext[v][i] for i in range(3))


def _opening_owner(scene: Scene, oid: str):
    for e in scene.elements:
        for o in e.openings:
            if o.id == oid:
                return e, o
    return None, None


def _openings(scene: Scene) -> list:
    return [o for e in scene.elements for o in e.openings]


def fix_to_reply(fix: Fix, letters_by_id: dict[str, str]) -> dict | None:
    """A single-axis Fix as a J3 reply (None when it moves along more than one axis)."""
    comps = [(fix.dx, 0), (fix.dy, 1), (fix.dz, 2)]
    moving = [(v, i) for v, i in comps if abs(v) > 1e-9]
    if len(moving) != 1:
        return None
    v, i = moving[0]
    unit = [0, 0, 0]
    unit[i] = 1 if v > 0 else -1
    direction = next(d for d, a in AXES.items() if list(a) == unit)
    return {"element": letters_by_id[fix.element], "direction": direction, "distance_mm": round(abs(v) * 1000),
            "via_opening": letters_by_id.get(fix.via_opening) if fix.via_opening else None}


def reply_to_fix(item: Item, reply: dict) -> Fix:
    """A J3 reply ({element, direction, distance_mm, via_opening}) as a spec.Fix in metres. Raises ValueError when
    a letter or direction is not one the item offered."""
    letters = item.truth["letters"]
    axes = item.truth.get("axes", AXES)
    eid = letters.get(str(reply.get("element", "")).strip().upper())
    if eid is None or eid.startswith("o"):
        raise ValueError(f"unknown element letter {reply.get('element')!r}")
    direction = str(reply.get("direction", "")).strip().lower()
    if direction not in axes:
        raise ValueError(f"unknown direction {reply.get('direction')!r}")
    try:
        dist = float(reply.get("distance_mm")) / 1000.0
    except (TypeError, ValueError):
        raise ValueError(f"bad distance {reply.get('distance_mm')!r}") from None
    if dist < 0:
        raise ValueError("distance must not be negative")
    via = reply.get("via_opening")
    oid = None
    if via not in (None, "", "null", "none"):
        oid = letters.get(str(via).strip().upper())
        if oid is None or not oid.startswith("o"):
            raise ValueError(f"unknown opening letter {via!r}")
    ux, uy, uz = axes[direction]
    return Fix(element=eid, dx=ux * dist, dy=uy * dist, dz=uz * dist, via_opening=oid)


def _check(scene: Scene, fix: Fix) -> dict:
    """checker.check_fix, or {"error"} when it cannot run."""
    try:
        from . import checker
        return dict(checker.check_fix(scene, fix))
    except Exception as e:   # a checker problem marks the evidence, never sinks the build
        return {"error": f"{type(e).__name__}: {e}"}


# ------------------------------------------------------------------------------------------------- letters and views

def _is_plain(v: View) -> bool:
    return not v.name.startswith(("before", "after", "cand"))


def _letters(scene: Scene, views: list[View]) -> dict[str, str]:
    """id -> letter for every element and opening: these views' labels first (no letter used twice), then seeded
    letters for the rest (elements from A, openings from P)."""
    out: dict[str, str] = {}
    used: set[str] = set()
    for v in views:
        for k, letter in v.labels.items():
            if k not in out and letter not in used:
                out[k] = letter
                used.add(letter)
    rng = random.Random(f"letters-{scene.seed}")
    n_el = len(scene.elements)
    n_op = len(_openings(scene))
    pool_e = [f"{c}{k if k > 1 else ''}" for k in range(1, 2 + n_el // len(ELEMENT_LETTERS)) for c in ELEMENT_LETTERS]
    pool_o = [f"{c}{k if k > 1 else ''}" for k in range(1, 2 + n_op // len(OPENING_LETTERS)) for c in OPENING_LETTERS]
    free_e = [c for c in pool_e if c not in used]
    free_o = [c for c in pool_o if c not in used]
    rng.shuffle(free_e)
    rng.shuffle(free_o)
    for e in scene.elements:
        if e.id not in out and free_e:
            out[e.id] = free_e.pop()
        for o in e.openings:
            if o.id not in out and free_o:
                out[o.id] = free_o.pop()
    return out


def one_letter_map(views: list[View]) -> list[View]:
    """The views that letter things the same way as the first one: a view is kept only when none of its labels gives
    an id a different letter, or a letter to a different id, than the views kept before it. Renders letter each focus
    afresh (a letter means different elements in different groups' pictures), so one item shows one letter map."""
    out: list[View] = []
    by_id: dict[str, str] = {}
    by_letter: dict[str, str] = {}
    for v in views:
        if all(by_id.get(k, lt) == lt and by_letter.get(lt, k) == k for k, lt in v.labels.items()):
            out.append(v)
            for k, lt in v.labels.items():
                by_id[k], by_letter[lt] = lt, k
    return out


def one_render(views: list[View]) -> list[View]:
    """The views of one render (the same focus as the first view), with one letter map (`one_letter_map`)."""
    if not views:
        return []
    return one_letter_map([v for v in views if list(v.focus) == list(views[0].focus)])


def _pair_views(views: list[View], pair: set[str]) -> list[View]:
    """The views framed on this pair (exactly, then any focus holding it, then any touching it, then any showing
    it), never the before/after or candidate ones; only views that agree with the first on every letter."""
    plain = [v for v in views if _is_plain(v)]
    tests = (lambda v: set(v.focus) == pair, lambda v: pair <= set(v.focus), lambda v: bool(pair & set(v.focus)),
             lambda v: all(v.visible_px.get(e, 0) > 0 for e in pair),
             lambda v: any(v.visible_px.get(e, 0) > 0 for e in pair))
    for t in tests:
        sel = [v for v in plain if t(v)]
        if sel:
            return one_letter_map(sel)
    return one_letter_map(plain)


def _image(path: str, scene_dir: Path | None) -> str:
    return str(Path(scene_dir) / path) if scene_dir is not None and not Path(path).is_absolute() else path


def _visible(views: list[View], eid: str) -> int:
    return min((v.visible_px.get(eid, 0) for v in views), default=0)


def _rng(scene: Scene, *keys) -> random.Random:
    """A seeded stream per purpose, so building a subset of jobs never changes the items built."""
    return random.Random("jobs-" + "-".join(str(k) for k in (scene.seed, *keys)))


def _lst(xs) -> str:
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


# ------------------------------------------------------------------------------------------------- schemas

def _obj(props: dict) -> dict:
    """A strict reply object: the answer fields plus the required confidence and reason."""
    props = {**props, **META_PROPS}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def core_schema(schema: dict) -> dict:
    """The schema without confidence/reason (the answer fields alone)."""
    props = {k: v for k, v in schema.get("properties", {}).items() if k not in META_FIELDS}
    return {**schema, "properties": props, "required": [k for k in schema.get("required", []) if k in props]}


def schema_j1() -> dict:
    return _obj({"answer": {"type": "string", "enum": list(KIND_CHOICES)}})


def schema_j1_binary() -> dict:
    return _obj({"clash": {"type": "boolean"}})


def schema_j2(letters: list[str]) -> dict:
    return _obj({"mover_letter": {"type": "string", "enum": letters}})


def schema_j3(elements: list[str], openings: list[str]) -> dict:
    return _obj({"element": {"type": "string", "enum": elements},
                 "direction": {"type": "string", "enum": list(DIRECTIONS)},
                 "distance_mm": {"type": "integer", "minimum": 0, "maximum": 5000},
                 "via_opening": {"type": ["string", "null"], "enum": [*openings, None]}})


def schema_j4(openings: list[str]) -> dict:
    return _obj({"fitting": {"type": "array", "items": {"type": "string", "enum": openings}, "uniqueItems": True}})


def schema_j5() -> dict:
    return _obj({"resolved": {"type": "boolean"}})


def schema_j6() -> dict:
    return _obj({"new_clash": {"type": "boolean"}})


def schema_j7(n: int) -> dict:
    return _obj({"valid": {"type": "array", "items": {"type": "integer", "minimum": 1, "maximum": n},
                           "uniqueItems": True, "maxItems": n}})


def schema_j8_pick(options: list[str]) -> dict:
    return _obj({"answer": {"type": "string", "enum": options}})


def schema_j8_order(letters: list[str]) -> dict:
    return _obj({"order": {"type": "array", "items": {"type": "string", "enum": letters}, "uniqueItems": True,
                           "minItems": len(letters), "maxItems": len(letters)}})


def schema_j9_relation() -> dict:
    return _obj({"relation": {"type": "string", "enum": list(RELATIONS)}})


def schema_j9_passes() -> dict:
    return _obj({"passes": {"type": "boolean"}})


def normalize_reply(job: str, reply: dict) -> dict:
    """Map a raw reply onto the truth's vocabulary where they differ (J1 letters a/b/c -> kinds)."""
    if job == "J1_sort" and isinstance(reply, dict) and "answer" in reply:
        return {**reply, "kind": KIND_CHOICES.get(str(reply["answer"]).strip().lower())}
    return reply


# ------------------------------------------------------------------------------------------------- text facts

def _role_word(e: Element) -> str:
    return {"structure": "structure (stays put)", "service": "a building service run",
            "support": "a support"}[e.role]


def _mm(v: float) -> str:
    return f"{v * 1000:.0f}"


def _el_line(scene: Scene, eid: str, letters: dict[str, str]) -> str:
    e = scene.element(eid)
    lo, hi = geom.bbox(e)
    lock = "; locked (must not move)" if e.locked else ""
    return (f"{letters[eid]} is a {e.kind}; class: {_role_word(e)}{lock}; extent X {_mm(lo[0])} to {_mm(hi[0])}, "
            f"Y {_mm(lo[1])} to {_mm(hi[1])}, Z {_mm(lo[2])} to {_mm(hi[2])} mm.")


def _facts(scene: Scene, p: Planted, letters: dict[str, str], extra: list[str] | None = None) -> list[str]:
    a, b = scene.element(p.a), scene.element(p.b)
    lines = []
    for e in (a, b):
        lock = "; locked (must not move)" if e.locked else ""
        lines.append(f"{letters[e.id]} is a {e.kind}; class: {_role_word(e)}{lock}.")
    lines += [f"Signed distance between {letters[a.id]} and {letters[b.id]}: {p.distance_m * 1000:.0f} mm "
              "(negative = overlap depth, positive = clear gap).",
              f"Required clear gap after a fix: {scene.clearance_m * 1000:.0f} mm."]
    return lines + (extra or [])


def _opening_facts(scene: Scene, letters: dict[str, str], mover: Element, offered: list[str]) -> list[str]:
    lo, hi = bounds(mover)
    axis = _long_axis(mover)
    section = [round((hi[i] - lo[i]) * 1000) for i in range(3) if i != axis]
    out = [f"{letters[mover.id]} cross-section: {section[0]} x {section[1]} mm."]
    for o in _openings(scene):
        if o.id in offered:
            size = [round((o.max[i] - o.min[i]) * 1000) for i in range(3)]
            out.append(f"Opening {letters[o.id]}: {size[0]} x {size[1]} x {size[2]} mm (X x Y x Z).")
    return out


def _move_fact(fix: Fix, letter: str) -> str:
    return f"Proposed move of {letter}: dx {_mm(fix.dx)} mm, dy {_mm(fix.dy)} mm, dz {_mm(fix.dz)} mm."


# ------------------------------------------------------------------------------------------------- candidate fixes

def candidate_fixes(scene: Scene, p: Planted) -> dict[str, Fix]:
    """The good fix and up to three deliberately bad ones: too small, wrong direction (along the mover's own run, so
    the clash stays), and one that drives the mover into a third element."""
    good = p.good_fix
    out: dict[str, Fix] = {}
    if good is None:
        return out
    out["good"] = good
    out["too_small"] = Fix(good.element, good.dx * 0.25, good.dy * 0.25, good.dz * 0.25, good.via_opening)
    mover = scene.element(good.element)
    mag = max(abs(good.dx), abs(good.dy), abs(good.dz)) or 0.3
    axis = _long_axis(mover)
    d = [0.0, 0.0, 0.0]
    d[axis] = mag
    out["wrong_direction"] = Fix(good.element, *d)
    others = [e for e in scene.elements if e.id not in (p.a, p.b) and e.role != "support"]
    if others:
        mc = _center(mover)
        third = min(others, key=lambda e: sum((x - y) ** 2 for x, y in zip(_center(e), mc)))
        tc = _center(third)
        out["hits_third"] = Fix(good.element, *(round(t - m, 4) for t, m in zip(tc, mc)))
    return out


def _original_after(scene: Scene, p: Planted, fix: Fix) -> float:
    """Signed distance of the planted pair after the fix (unchanged when the fix moves something else)."""
    a, b = scene.element(p.a), scene.element(p.b)
    if fix.element == p.a:
        a = geom.moved(a, fix)
    elif fix.element == p.b:
        b = geom.moved(b, fix)
    return geom.distance(a, b)


def _directions(fix: Fix) -> list[str]:
    """The directions a fix moves in (east +X, north +Y, up +Z), as checker.directions names them."""
    try:
        from . import checker
        return list(checker.directions(fix))
    except Exception:   # older checker: name them here
        out = []
        for v, pos, neg in ((fix.dx, "east", "west"), (fix.dy, "north", "south"), (fix.dz, "up", "down")):
            if abs(v) > 1e-9:
                out.append(pos if v > 0 else neg)
        return out


def pair_resolutions(scene: Scene, n: int, p: Planted) -> list[dict]:
    """Candidate fixes for planted pair `n`, each with its geometry verdict:
    {"k", "label", "fix", "valid", "resolves_original", "new_hits", "evidence"}.

    From scene.resolutions (truth.annotate) when the pair has any: truth from Resolution.valid / resolves_original /
    new_hits, evidence = Resolution.evidence (the full check_fix result) plus where it came from. Otherwise
    candidate_fixes judged by checker.check_fix (valid = passed, resolves_original = the pair no longer overlaps,
    new_hits). Moves of a locked element stay (check_fix fails them; the padlock is in the picture); moves of an
    unknown element are left out. "hidden_rule" marks a move that fails only because of the mover's `allowed_moves`
    (it would pass without them): nothing in the picture shows that, so J7 never offers it."""
    src = [r for r in (getattr(scene, "resolutions", None) or []) if r.pair == n]
    raw = [(r.label, r.fix, r) for r in src] if src else \
        [(label, fix, None) for label, fix in candidate_fixes(scene, p).items()]
    out = []
    for k, (label, fix, res) in enumerate(raw):
        try:
            mover = scene.element(fix.element)
        except StopIteration:
            continue
        after = _original_after(scene, p, fix)
        if res is not None:
            ck = dict(res.evidence) if res.evidence else _check(scene, fix)
            valid, resolves, hits, source = bool(res.valid), bool(res.resolves_original), list(res.new_hits), \
                "scene.resolutions"
        else:
            ck = _check(scene, fix)
            if "error" in ck:
                continue
            valid, resolves, hits, source = bool(ck["passed"]), after >= -1e-9, list(ck.get("new_hits", [])), \
                "checker.check_fix"
        ev = {**ck, "source": source, "label": label, "fix": asdict(fix), "valid": valid,
              "resolves_original": resolves, "new_hits": hits, "original_after_m": round(after, 6)}
        if (after >= -1e-9) != resolves:
            ev["geom_disagrees"] = True
        hidden = False
        if not valid and mover.allowed_moves and any(d not in mover.allowed_moves for d in _directions(fix)):
            free = replace(scene, elements=[replace(e, allowed_moves=[]) if e.id == mover.id else e
                                            for e in scene.elements])
            hidden = bool(_check(free, fix).get("passed"))
            ev["hidden_rule"] = hidden
        out.append({"k": k, "label": label, "fix": fix, "valid": valid, "resolves_original": resolves,
                    "new_hits": hits, "evidence": ev, "hidden_rule": hidden})
    return out


# ------------------------------------------------------------------------------------------------- prompts

def _prompt_j1(x: str, y: str) -> str:
    return (f"Here are pictures of two elements labelled {x} and {y}. Is this (a) a real clash that needs fixing, "
            "(b) not touching, (c) touching by design (one supports the other)? Reply with the letter a, b or c "
            "in the field \"answer\".")


def _prompt_j1_binary(x: str, y: str) -> str:
    return (f"Here are pictures of two elements labelled {x} and {y}. Is there an actual geometric clash between "
            "them: do they overlap or cut into each other? Elements that only touch, or a support carrying the "
            "other, do not count. Reply true or false in \"clash\".")


def _prompt_j2(x: str, y: str) -> str:
    return (f"These pictures show a clash between the elements labelled {x} and {y}. Which labelled element can "
            "move to resolve it under the given constraints? The building's frame stays put, and a padlock means "
            "that element must not move; the runs that can be rerouted are the ones that move. Give its letter in "
            "the field \"mover_letter\".")


def _prompt_j3(x: str, y: str, ops: list[str]) -> str:
    op_txt = (f" Openings through solid members are labelled {', '.join(ops)}; if the move passes through one, give "
              "its letter in \"via_opening\", otherwise null." if ops else
              " There are no labelled openings: set \"via_opening\" to null.")
    return (f"These pictures show a clash between the elements labelled {x} and {y}. Propose one straight move of "
            "the element that should move so the clash is gone with a clear gap all round and nothing new is hit. "
            "Give the element's letter in \"element\", the direction (up, down, north, south, east or west; use the "
            "compass in the pictures) in \"direction\", and how far to move it, in millimetres, as a whole "
            "number in the distance field." + op_txt)


def _prompt_j4(x: str, ops: list[str]) -> str:
    return (f"The pictures show openings labelled {', '.join(ops)}. Which openings can the "
            f"element labelled {x} pass through with a clear gap all round? List every opening letter that works "
            "in \"fitting\" (an empty list if none does).")


def _fix_intro(x: str, y: str, mover: str, n_before: int, n_after: int) -> str:
    return (f"The first {n_before} picture(s) show elements {x} and {y} clashing; the last {n_after} picture(s) "
            f"show the same place after a proposed move of element {mover}.")


def _prompt_j5(x: str, y: str, mover: str, n_before: int, n_after: int) -> str:
    return (_fix_intro(x, y, mover, n_before, n_after) + f" Does this move resolve the original clash between {x} "
            f"and {y}, so that they no longer overlap? Judge only that clash; ignore anything else the move might "
            "cause. Reply true or false in \"resolved\".")


def _prompt_j6(x: str, y: str, mover: str, n_before: int, n_after: int) -> str:
    return (_fix_intro(x, y, mover, n_before, n_after) + f" Does the move introduce a new clash: does {mover} now "
            f"hit, or end up hard against, any element other than {x} and {y} that it was clear of before? Judge "
            f"only new clashes, not whether the original one is gone. Reply true or false in \"new_clash\".")


def _prompt_j7(x: str, y: str, n: int, layout: str, has_before: bool) -> str:
    intro = (f"The first picture shows elements {x} and {y} clashing. " if has_before else
             f"These pictures concern a clash between elements {x} and {y}. ")
    shown = (f"The next {n} pictures show {n} proposed solutions, numbered 1 to {n} in the order shown; each moves "
             "one labelled element." if layout == "separate" else
             f"The last picture is a grid of {n} panels numbered 1 to {n}, each showing one proposed solution that "
             "moves one labelled element.")
    return (intro + shown + f" A solution is valid only if the clash between {x} and {y} is gone with a clear gap "
            "all round, the moved element keeps a clear gap from everything else, no part of the building's frame "
            "is moved, and no element with a padlock is moved. Which solutions are valid? List every valid solution "
            "number in \"valid\".")


_J8_LEAD = "The pictures show labelled elements."


def _prompt_j8(q: str, letters: list[str], ends: tuple[str, str] | None = None) -> str:
    if q == "highest":
        return f"{_J8_LEAD} Of {_lst(letters)}, which one sits highest? Give its letter in \"answer\"."
    if q == "north":
        return (f"{_J8_LEAD} Of {_lst(letters)}, which one lies furthest north (use the compass in the pictures)? "
                "Give its letter in \"answer\".")
    if q == "order":
        return (f"{_J8_LEAD} Order {_lst(letters)} from lowest to highest. List all {len(letters)} letters in "
                "\"order\", lowest first.")
    a, c = ends
    if len(letters) == 1:
        return (f"{_J8_LEAD} Does {letters[0]} lie between {a} and {c} in height (above one of them and below the "
                f"other)? Give its letter in \"answer\" if it does, or \"none\" if it does not.")
    return (f"{_J8_LEAD} Of {_lst(letters)}, which one lies between {a} and {c} in height (above one of them and "
            f"below the other)? Give its letter in \"answer\", or \"none\" if none of them does.")


def _prompt_j9_relation(x: str, y: str) -> str:
    return (f"The pictures show labelled elements. What is the relationship between {x} and {y}? Choose the first "
            "that applies: \"passes_through\" (one runs through an opening in the other), \"supports\" (one carries "
            "the other by design), \"clashes\" (they overlap or cut into each other), \"touches\" (they are in "
            "contact without overlapping), \"crosses\" (they run across each other at an angle without touching), "
            "\"parallel\" (they run side by side in the same direction without touching), \"clear_of\" (apart, none "
            "of the above). Give it in \"relation\".")


def _prompt_j9_passes(x: str, ops: list[str], p: str) -> str:
    return (f"The pictures show the element labelled {x} and openings labelled {_lst(ops)}. Does {x} pass through "
            f"opening {p}? Reply true or false in \"passes\".")


def _finish(prompt: str) -> str:
    return f"{prompt}\n\n{CONFIDENCE}\n\n{ANSWER}"


# ------------------------------------------------------------------------------------------------- item specs

@dataclass
class _Spec:
    job: str
    n: object                    # id token: the pair index for pair items, else a short string ("0yn", "g0order")
    prompt: str
    schema: dict
    truth: dict
    evidence: dict
    meta: dict
    images: list[str]
    facts: list[str] = field(default_factory=list)   # pictures_text lines


def _truth(question: str, field_name: str | None, answer, letters: dict[str, str], **extra) -> dict:
    t = {"question": question, "answer": answer, "letters": {v: k for k, v in letters.items()}}
    if field_name is not None:
        t["expected"] = {field_name: answer}
    return {**t, **extra}


class _FixViews:
    """fix_renderer with a cache, so J5 and J6 share the pictures of one fix."""

    def __init__(self, scene: Scene, renderer: FixRenderer | None):
        self.scene, self.renderer, self.cache = scene, renderer, {}

    def __call__(self, fix: Fix) -> list[View]:
        key = (fix.element, round(fix.dx, 6), round(fix.dy, 6), round(fix.dz, 6), fix.via_opening)
        if key not in self.cache:
            self.cache[key] = list(self.renderer(self.scene, fix))
        return self.cache[key]


def _geom_kind(scene: Scene, a: Element, b: Element, d: float) -> str:
    if (a.supports == b.id or b.supports == a.id) and d <= 1e-6:
        return "by_design"
    return "real" if d < -1e-6 else "not_touching"


def _pair_specs(scene: Scene, views: list[View], n: int, p: Planted, want: set[str], scene_dir: Path | None,
                fixv: _FixViews | None, cand_renderer: CandRenderer | None) -> list[_Spec]:
    pair = {p.a, p.b}
    pids = [p.a, p.b]
    pviews = _pair_views(views, pair)
    imgs = [_image(v.image, scene_dir) for v in pviews]
    letters = _letters(scene, pviews)
    rng = _rng(scene, "pair", n)
    x, y = letters[p.a], letters[p.b]
    if rng.random() < 0.5:   # which letter is named first is not a cue
        x, y = y, x
    ea, eb = scene.element(p.a), scene.element(p.b)
    d = geom.distance(ea, eb)
    base = {"pair_index": n, "pair_kind": p.kind, "distance_mm": round(p.distance_m * 1000, 1),
            "gap_mm": round(max(p.distance_m, 0) * 1000, 1), "overlap_mm": round(max(-p.distance_m, 0) * 1000, 1),
            "visible_px": {letters[e]: _visible(pviews, e) for e in sorted(pair)},
            "min_visible_px": min(_visible(pviews, e) for e in pair), "n_images": len(imgs)}
    facts = _facts(scene, p, letters)
    real = p.kind == "real" and p.mover is not None
    out: list[_Spec] = []

    def spec(job, nn, prompt, schema, truth, evidence, meta=None, images=None, extra=None):
        out.append(_Spec(job, nn, prompt, schema, truth, evidence, {**base, **(meta or {})},
                         list(imgs if images is None else images), facts + (extra or [])))

    if "J1_sort" in want:
        gk = _geom_kind(scene, ea, eb, d)
        ev = {"source": "geom.distance", "distance_m": round(d, 6), "planted_kind": p.kind,
              "planted_distance_m": p.distance_m, "geom_kind": gk, "agrees": gk == p.kind}
        spec("J1_sort", n, _prompt_j1(x, y), schema_j1(),
             _truth("sort", "answer", KIND_LETTER[p.kind], letters, kind=p.kind, pair=pids), ev)
        clash = p.kind == "real"
        spec("J1_sort", f"{n}yn", _prompt_j1_binary(x, y), schema_j1_binary(),
             _truth("binary", "clash", clash, letters, clash=clash, kind=p.kind, pair=pids),
             {**ev, "clash": clash, "agrees": (d < -1e-6) == clash})

    if not real:
        return out
    mover = scene.element(p.mover)

    if "J2_who_moves" in want and not mover.locked and mover.role != "structure":
        ml = letters[p.mover]
        movable = [letters[e.id] for e in (ea, eb) if e.role != "structure" and not e.locked]
        spec("J2_who_moves", n, _prompt_j2(x, y), schema_j2(sorted([x, y])),
             _truth("who_moves", "mover_letter", ml, letters, mover_letter=ml, mover=p.mover, pair=pids,
                    locked=sorted(letters[e.id] for e in (ea, eb) if e.locked)),
             {"source": "scene.planted.mover", "mover": p.mover, "roles": {letters[e.id]: e.role for e in (ea, eb)},
              "locked": {letters[e.id]: e.locked for e in (ea, eb)}, "movable": movable,
              "agrees": movable == [ml]},
             {"locked_in_pair": any(e.locked for e in (ea, eb))},
             extra=[f"{letters[e.id]} carries a padlock badge (locked)." for e in (ea, eb) if e.locked])

    # only openings labelled in this pair's pictures: a letter the model cannot see is never offered (no J4 when
    # the pair's pictures label none; J3 then says there are no labelled openings)
    offered = sorted(o.id for o in _openings(scene) if any(o.id in v.labels for v in pviews))
    op_letters = sorted(letters[o] for o in offered)

    if "J3_fix" in want:
        exp = fix_to_reply(p.good_fix, letters) if p.good_fix else None
        ev = {"source": "checker.check_fix", **_check(scene, p.good_fix)} if p.good_fix else \
            {"source": "scene.planted", "good_fix": None}
        spec("J3_fix", n, _prompt_j3(x, y, op_letters), schema_j3(sorted([x, y]), op_letters),
             {"question": "fix", "mover": p.mover, "letters": {v: k for k, v in letters.items()},
              "axes": {k: list(v) for k, v in AXES.items()}, "expected": exp, "pair": pids,
              "good_fix": asdict(p.good_fix) if p.good_fix else None}, ev)

    if offered and "J4_opening" in want:
        fitting = sorted(letters[o] for o in p.fitting_openings if o in offered)
        fits = {}
        for oid in offered:
            owner, o = _opening_owner(scene, oid)
            ax = geom.through_axis(o, owner)
            fits[letters[oid]] = {"fits": geom.fits(mover, o, scene.clearance_m, axis=ax), "through_axis": ax,
                                  "size_m": [round(o.max[i] - o.min[i], 6) for i in range(3)]}
        geo_fit = sorted(k for k, v in fits.items() if v["fits"])
        spec("J4_opening", n, _prompt_j4(letters[p.mover], op_letters), schema_j4(op_letters),
             _truth("opening", "fitting", fitting, letters, fitting=fitting, mover=p.mover, offered=offered,
                    pair=pids),
             {"source": "geom.fits", "clearance_m": scene.clearance_m, "openings": fits,
              "planted_fitting": list(p.fitting_openings), "agrees": geo_fit == fitting},
             {"opening_count": len(offered)}, extra=_opening_facts(scene, letters, mover, offered))

    need_res = (fixv is not None and want & {"J5_review", "J6_new_clash"}) or \
        (cand_renderer is not None and "J7_pick_valid" in want)
    if not need_res:
        return out
    recs = pair_resolutions(scene, n, p)

    if fixv is not None:
        rr = _rng(scene, "review", n)
        chosen: list[tuple[str, dict]] = []
        if "J5_review" in want:
            yes = [r for r in recs if r["resolves_original"]]
            no = [r for r in recs if not r["resolves_original"]]
            chosen += [("J5_review", rr.choice(g)) for g in (yes, no) if g]
        if "J6_new_clash" in want:
            hit = [r for r in recs if r["new_hits"]]
            hit = [r for r in hit if r["resolves_original"]] or hit       # resolves the clash, but hits something
            clean = [r for r in recs if not r["new_hits"]]
            clean = [r for r in clean if r["valid"]] or clean             # the good fix, when there is one
            chosen += [("J6_new_clash", rr.choice(g)) for g in (hit, clean) if g]
        for job, r in chosen:
            fix = r["fix"]
            fviews = fixv(fix)
            before = [v for v in fviews if v.name.startswith("before")] or fviews[:1]
            after = [v for v in fviews if v.name.startswith("after")] or fviews[1:]
            if not before or not after:
                continue
            fimgs = [_image(v.image, scene_dir) for v in before + after]
            fl = _letters(scene, fviews)
            fx, fy = (fl[p.a], fl[p.b]) if (x == letters[p.a]) else (fl[p.b], fl[p.a])
            mv = fl[fix.element]
            common = {"fix": asdict(fix), "label": r["label"], "variant": r["label"], "valid": r["valid"],
                      "resolves_original": r["resolves_original"], "new_hits": list(r["new_hits"]), "pair": pids}
            meta = {"label": r["label"], "variant": r["label"], "n_images": len(fimgs),
                    "visible_px_after": _visible(after, fix.element), "fix_element": fix.element}
            ex = [_move_fact(fix, mv)]
            if job == "J5_review":
                res = r["resolves_original"]
                spec(job, f"{n}r{r['k']}", _prompt_j5(fx, fy, mv, len(before), len(after)), schema_j5(),
                     _truth("resolves_original", "resolved", res, fl, resolved=res, **common), r["evidence"], meta,
                     fimgs, ex)
            else:
                hit_b = bool(r["new_hits"])
                spec(job, f"{n}r{r['k']}", _prompt_j6(fx, fy, mv, len(before), len(after)), schema_j6(),
                     _truth("new_clash", "new_clash", hit_b, fl, new_clash=hit_b,
                            new_hit_letters=[fl.get(e, e) for e in r["new_hits"]],
                            **{k: v for k, v in common.items()}), r["evidence"], meta, fimgs, ex)

    if cand_renderer is not None and "J7_pick_valid" in want:
        s = _j7_spec(scene, n, p, recs, pviews, x == letters[p.a], scene_dir, cand_renderer)
        if s is not None:
            s.meta = {**base, **s.meta}
            s.facts = _facts(scene, p, _letters(scene, s._views)) + s.facts
            out.append(s)
    return out


def _j7_spec(scene: Scene, n: int, p: Planted, recs: list[dict], pviews: list[View], a_first: bool,
             scene_dir: Path | None, cand_renderer: CandRenderer) -> _Spec | None:
    """3-4 candidates: at least one valid, the rest invalid, one of them plausible (it clears the original clash, or
    is the right move cut short)."""
    rng = _rng(scene, "pick", n)
    recs = [r for r in recs if not r["hidden_rule"]]
    valid = [r for r in recs if r["valid"]]
    invalid = [r for r in recs if not r["valid"]]
    if not valid or len(invalid) < 2:
        return None
    n_valid = 2 if len(valid) >= 2 and rng.random() < 0.5 else 1
    n_invalid = min(4 - n_valid, len(invalid))
    plausible = [r for r in invalid if r["resolves_original"]] or [r for r in invalid if r["label"] == "too_small"]
    first = rng.choice(plausible) if plausible else rng.choice(invalid)
    rest = rng.sample([r for r in invalid if r is not first], n_invalid - 1)
    cands = rng.sample(valid, n_valid) + [first] + rest
    rng.shuffle(cands)
    fixes = [r["fix"] for r in cands]
    focus = sorted({p.a, p.b, *(f.element for f in fixes)})
    cviews = list(cand_renderer(scene, focus=focus, fixes=fixes))   # keywords: wrappers may take *args, **kw
    by_name = {v.name: v for v in cviews}
    N = len(cands)
    singles = [by_name.get(f"cand_{i}") for i in range(1, N + 1)]
    before = [v for v in cviews if v.name.startswith("before") or v.name == "cand_0"][:1]
    if all(singles):
        layout, shown = "separate", singles
    elif "cand_grid" in by_name:
        layout, shown = "grid", [by_name["cand_grid"]]
    else:
        return None
    if not before and pviews:   # the pair's own picture, when it letters the pair the same way
        cl = shown[0].labels
        if all(pviews[0].labels.get(e) == cl.get(e) for e in focus if e in cl):
            before = pviews[:1]
    shown_views = before + shown
    cl = _letters(scene, shown_views)
    x, y = (cl[p.a], cl[p.b]) if a_first else (cl[p.b], cl[p.a])
    nums = sorted(i + 1 for i, r in enumerate(cands) if r["valid"])
    cand_rows = [{"number": i + 1, "label": r["label"], "fix": asdict(r["fix"]), "valid": r["valid"],
                  "resolves_original": r["resolves_original"], "new_hits": list(r["new_hits"])}
                 for i, r in enumerate(cands)]
    s = _Spec("J7_pick_valid", n, _prompt_j7(x, y, N, layout, bool(before)), schema_j7(N),
              _truth("pick_valid", "valid", nums, cl, valid=nums, candidates=cand_rows, pair=[p.a, p.b]),
              {"source": "checker.check_fix",
               "candidates": [{"number": i + 1, **r["evidence"]} for i, r in enumerate(cands)]},
              {"n_candidates": N, "n_valid": len(nums), "layout": layout, "labels": [r["label"] for r in cands],
               "n_images": len(shown_views)},
              [_image(v.image, scene_dir) for v in shown_views],
              [f"Solution {i + 1}: " + _move_fact(r["fix"], cl[r["fix"].element]) for i, r in enumerate(cands)])
    s._views = shown_views   # letters for the pair facts
    return s


# ------------------------------------------------------------------------------------------------- J8 / J9 groups

def _labelled(scene_ids: set[str], v: View) -> frozenset:
    return frozenset(k for k in v.labels if k in scene_ids and v.visible_px.get(k, 0) > 0)


def _group_focuses(scene: Scene) -> list[list[str]]:
    """Element groups to render for J8/J9: each planted pair plus its two nearest other runs (no supports)."""
    out, seen = [], set()
    for p in scene.planted:
        pa, pb = scene.element(p.a), scene.element(p.b)
        others = [e for e in scene.elements if e.id not in (p.a, p.b) and e.role != "support"]
        others.sort(key=lambda e: (min(geom.distance(e, pa), geom.distance(e, pb)), e.id))
        focus = [p.a, p.b] + [e.id for e in others[:2]]
        if len(focus) >= 3 and frozenset(focus) not in seen:
            seen.add(frozenset(focus))
            out.append(focus)
        if len(out) >= MAX_GROUPS:
            break
    return out


def _groups(scene: Scene, views: list[View], group_renderer: GroupRenderer | None) -> list[tuple[list[str], list[View]]]:
    """(element ids, views) for every distinct set of three or more elements labelled and visible together in one
    view; rendered with `group_renderer` when the views have none."""
    ids = {e.id for e in scene.elements}
    plain = [v for v in views if _is_plain(v)]
    out, seen = [], set()
    for v in plain:
        g = _labelled(ids, v)
        if len(g) >= 3 and g not in seen:
            seen.add(g)
            out.append((sorted(g), one_render([v] + [w for w in plain if w is not v and _labelled(ids, w) == g])))
    if not out and group_renderer is not None:
        for focus in _group_focuses(scene):
            gv = one_render([v for v in group_renderer(scene, focus) if _is_plain(v)])
            g = frozenset().union(*(_labelled(ids, v) for v in gv)) if gv else frozenset()
            if len(g) >= 3 and g not in seen:
                seen.add(g)
                out.append((sorted(g), gv))
    return out[:MAX_GROUPS]


def _subsets(ids: list[str], rng: random.Random):
    """Element subsets to ask about, in preference order: the whole group (up to 4), then 4s, then 3s."""
    if len(ids) > MAX_GROUP_SIZE:
        ids = sorted(rng.sample(ids, MAX_GROUP_SIZE))
    if len(ids) <= 4:
        yield list(ids)
    for k in (4, 3):
        if k >= len(ids):
            continue
        combos = [list(c) for c in combinations(ids, k)]
        rng.shuffle(combos)
        yield from combos


def _top(ext: dict, sub: list[str]) -> tuple[str, float] | None:
    for w in sub:
        m = min(_above(ext, w, x) for x in sub if x != w)
        if m >= AMBIGUOUS_M:
            return w, m
    return None


def _order(ext: dict, sub: list[str]) -> tuple[list[str], float] | None:
    s = sorted(sub, key=lambda e: ext[e][1])
    m = min(_above(ext, hi, lo) for lo, hi in pairwise(s))
    return (s, m) if m >= AMBIGUOUS_M else None


def _between(ext: dict, sub: list[str]) -> list[tuple[str, str, str | None, float]]:
    """(lower end, upper end, the one element between them or None, margin) for every pair of ends where every other
    element is clearly between or clearly outside (by AMBIGUOUS_M on bottom, centre and top) and at most one is
    between."""
    out = []
    for a in sub:
        for c in sub:
            if a == c or _above(ext, c, a) < AMBIGUOUS_M:
                continue
            others = [b for b in sub if b not in (a, c)]
            inside, margin, ok = [], _above(ext, c, a), True
            for b in others:
                m_in = min(_above(ext, b, a), _above(ext, c, b))
                m_out = max(_above(ext, a, b), _above(ext, b, c))
                if m_in >= AMBIGUOUS_M:
                    inside.append(b)
                    margin = min(margin, m_in)
                elif m_out >= AMBIGUOUS_M:
                    margin = min(margin, m_out)
                else:
                    ok = False
                    break
            if ok and others and len(inside) <= 1:
                out.append((a, c, inside[0] if inside else None, margin))
    return out


def _j8_specs(scene: Scene, groups, scene_dir: Path | None) -> list[_Spec]:
    out = []
    for gi, (ids, gviews) in enumerate(groups):
        letters = _letters(scene, gviews)
        imgs = [_image(v.image, scene_dir) for v in gviews]
        ext = {2: {e: _extent(scene, e, 2) for e in ids}, 1: {e: _extent(scene, e, 1) for e in ids}}
        for q in ("highest", "north", "order", "between"):
            rng = _rng(scene, "j8", gi, q)
            axis = 1 if q == "north" else 2
            ex = ext[axis]
            found = None
            for sub in _subsets(ids, rng):
                if q in ("highest", "north"):
                    r = _top(ex, sub)
                    if r:
                        w, m = r
                        rel = "north_of" if q == "north" else "above"
                        found = (sub, letters[w], {"answer_id": w},
                                 [{"a": w, "b": x, "relation": rel} for x in sub if x != w], m, None)
                elif q == "order":
                    r = _order(ex, sub)
                    if r:
                        s, m = r
                        found = (sub, [letters[e] for e in s], {"order_ids": s},
                                 [{"a": hi, "b": lo, "relation": "above"} for lo, hi in pairwise(s)], m, None)
                else:
                    cfgs = _between(ex, sub)
                    if cfgs:
                        ones = [c for c in cfgs if c[2] is not None]
                        nones = [c for c in cfgs if c[2] is None]
                        a, c, b, m = rng.choice(ones) if ones and (not nones or rng.random() < 0.6) else \
                            rng.choice(nones)
                        others = [e for e in sub if e not in (a, c)]
                        claims = ([{"a": b, "b": a, "relation": "above"}, {"a": b, "b": c, "relation": "below"}]
                                  if b else
                                  [{"a": o, "b": a, "relation": "below"} if _above(ex, a, o) >= AMBIGUOUS_M else
                                   {"a": o, "b": c, "relation": "above"} for o in others])
                        found = (sub, letters[b] if b else "none",
                                 {"answer_id": b, "ends": [a, c], "options": [letters[e] for e in others]},
                                 claims, m, (letters[a], letters[c]))
                if found:
                    break
            if not found:
                continue
            sub, answer, extra, claims, margin, ends = found
            sub_letters = sorted(letters[e] for e in sub)
            if q == "order":
                schema, fld = schema_j8_order(sub_letters), "order"
                prompt = _prompt_j8(q, sub_letters)
            elif q == "between":
                opts = sorted(extra["options"])
                schema, fld = schema_j8_pick(opts + ["none"]), "answer"
                prompt = _prompt_j8(q, opts, ends)
            else:
                schema, fld = schema_j8_pick(sub_letters), "answer"
                prompt = _prompt_j8(q, sub_letters)
            rels = [asdict(r) for r in getattr(scene, "relations", []) or []
                    if r.a in sub and r.b in sub and r.relation in ("above", "below", "north_of", "south_of")]
            ax_name = "y" if axis == 1 else "z"
            ev = {"source": "geom.bbox", "axis": ax_name, "measures": ["low", "centre", "high"],
                  "extent_m": {letters[e]: [round(v, 6) for v in ex[e]] for e in sub},
                  "margin_m": round(margin, 6), "min_margin_m": AMBIGUOUS_M, "relations": rels}
            facts = [_el_line(scene, e, letters) for e in sub]
            out.append(_Spec("J8_spatial", f"g{gi}{q}", prompt, schema,
                             _truth(q, fld, answer, letters, elements=sub, relations=claims, **extra), ev,
                             {"group": gi, "group_size": len(sub), "n_images": len(imgs),
                              "visible_px": {letters[e]: _visible(gviews, e) for e in sub},
                              "min_visible_px": min(_visible(gviews, e) for e in sub), "margin_mm": round(margin * 1000, 1)},
                             imgs, facts))
    return out


_CONTACT = ("passes_through", "supports", "clashes", "touches")


def _geom_relations(scene: Scene, a: Element, b: Element, d: float) -> tuple[set[str], dict]:
    """The relation words geometry gives a pair (when scene.relations says nothing about it), and the via opening."""
    names, extra = set(), {}
    if a.supports == b.id or b.supports == a.id:
        names.add("supports")
    for x, y in ((a, b), (b, a)):
        for o in y.openings:
            if geom.passes_through(x, y, o):
                names.add("passes_through")
                extra = {"a": x.id, "b": y.id, "via": o.id}
    if d < -1e-6:
        names.add("clashes")
    elif d <= 1e-6:
        names.add("touches")
    ra, rb = _run_axis(a), _run_axis(b)
    if ra is not None and rb is not None:
        if ra == rb:
            names.add("parallel")
        else:
            (la, ha), (lb, hb) = geom.bbox(a), geom.bbox(b)
            if all(la[i] <= hb[i] and lb[i] <= ha[i] for i in (0, 1)):
                names.add("crosses")
    return names or {"clear_of"}, extra


def _pick_relation(names: set[str]) -> str | None:
    """One answer, by the prompt's order; None when two contact relations contradict each other."""
    if "supports" in names:
        return None if names & {"clashes", "passes_through"} else "supports"
    if "passes_through" in names:
        return None if names & {"clashes", "touches"} else "passes_through"
    if "clashes" in names:
        return "clashes"
    if "touches" in names:
        return "touches"
    if "crosses" in names and "parallel" in names:
        return None
    for r in ("crosses", "parallel"):
        if r in names:
            return r
    return "clear_of"


def pair_relation(scene: Scene, a: str, b: str) -> tuple[str | None, dict, dict]:
    """(answer, claim {a, b, relation, via}, evidence) for one pair: scene.relations first, geometry otherwise.
    The answer is None when ambiguous: contradicting contact relations, or a gap/overlap under AMBIGUOUS_M that
    decides between contact and clear."""
    ea, eb = scene.element(a), scene.element(b)
    d = geom.distance(ea, eb)
    rels = [r for r in (getattr(scene, "relations", None) or []) if {r.a, r.b} == {a, b}]
    vocab = [r for r in rels if r.relation in RELATIONS]
    claim = {"a": a, "b": b}
    if vocab:
        names, source = {r.relation for r in vocab}, "scene.relations"
        pt = next((r for r in vocab if r.relation == "passes_through"), None)
        if pt is not None:
            claim = {"a": pt.a, "b": pt.b, "via": pt.via}
    else:
        names, extra = _geom_relations(scene, ea, eb, d)
        source = "geom"
        claim = {**claim, **extra}
    ans = _pick_relation(names)
    if ans in ("crosses", "parallel", "clear_of") and d < AMBIGUOUS_M:
        ans = None
    if ans == "clashes" and d > -AMBIGUOUS_M:
        ans = None
    ev = {"source": source, "relations": [asdict(r) for r in rels] if rels else sorted(names),
          "distance_m": round(d, 6), "min_margin_m": AMBIGUOUS_M}
    return ans, {**claim, "relation": ans}, ev


def _passes(scene: Scene, el: Element, owner: Element, o) -> tuple[bool, dict]:
    """Does el pass through opening o of owner: scene.relations when it has any passes_through for el, else geometry."""
    rels = [r for r in (getattr(scene, "relations", None) or []) if r.relation == "passes_through" and el.id in (r.a, r.b)]
    geo = geom.passes_through(el, owner, o)
    if rels:
        yes, source = any(r.via == o.id for r in rels), "scene.relations"
    elif getattr(scene, "relations", None):
        yes, source = False, "scene.relations"
    else:
        yes, source = geo, "geom.passes_through"
    return yes, {"source": source, "passes_through": geo, "agrees": geo == yes,
                 "relations": [asdict(r) for r in rels], "distance_to_owner_m": round(geom.distance(el, owner), 6)}


def _j9_specs(scene: Scene, views: list[View], groups, scene_dir: Path | None) -> list[_Spec]:
    ids = {e.id for e in scene.elements}
    plain = [v for v in views if _is_plain(v)] + [v for _, gv in groups for v in gv if v not in views]
    pair_views: dict[tuple[str, str], list[View]] = defaultdict(list)
    for v in plain:
        for a, b in combinations(sorted(_labelled(ids, v)), 2):
            pair_views[(a, b)].append(v)
    out: list[_Spec] = []

    # "What is the relationship between A and B?"
    by_rel: dict[str, list] = defaultdict(list)
    for (a, b), pv in sorted(pair_views.items()):
        ans, claim, ev = pair_relation(scene, a, b)
        if ans is not None:
            exact = [v for v in pv if set(v.focus) == {a, b}]
            by_rel[ans].append(((a, b), one_render(exact or pv), claim, ev))   # one group's pictures, one letter map
    rng = _rng(scene, "j9")
    k = 0
    for rel in RELATIONS:
        lst = by_rel.get(rel, [])
        for (a, b), pv, claim, ev in rng.sample(lst, min(J9_PER_RELATION, len(lst))):
            letters = _letters(scene, pv)
            x, y = (letters[a], letters[b]) if rng.random() < 0.5 else (letters[b], letters[a])
            d = ev["distance_m"]
            out.append(_Spec("J9_relation", f"r{k}", _prompt_j9_relation(x, y), schema_j9_relation(),
                             _truth("relation", "relation", rel, letters, relation=rel, a=claim["a"], b=claim["b"],
                                    via=claim.get("via"), pair=[a, b], relations=[claim]), ev,
                             {"n_images": len(pv), "distance_mm": round(d * 1000, 1),
                              "visible_px": {letters[e]: _visible(pv, e) for e in (a, b)},
                              "min_visible_px": min(_visible(pv, e) for e in (a, b))},
                             [_image(v.image, scene_dir) for v in pv],
                             [_el_line(scene, a, letters), _el_line(scene, b, letters),
                              f"Signed distance between {letters[a]} and {letters[b]}: {d * 1000:.0f} mm "
                              "(negative = overlap depth, positive = clear gap)."]))
            k += 1

    # "Does A pass through opening P?"
    cands: dict[str, dict[bool, list]] = defaultdict(lambda: {True: [], False: []})
    for owner in scene.elements:
        for o in owner.openings:
            ov = [v for v in plain if o.id in v.labels and owner.id in _labelled(ids, v)]
            seen = set()
            for v in ov:
                for eid in sorted(_labelled(ids, v)):
                    el = scene.element(eid)
                    if eid == owner.id or eid in seen or el.role == "support":
                        continue
                    yes, ev = _passes(scene, el, owner, o)
                    if not yes and ev["distance_to_owner_m"] > NEAR_OPENING_M:
                        continue
                    seen.add(eid)
                    shown = one_render([v] + [w for w in ov if w is not v and eid in _labelled(ids, w)])
                    cands[o.id][yes].append((el, owner, o, shown, ev))
    # every "yes" is kept (they are rare), then as many "no" (at least one), up to J9_OPENING_MAX in all
    rng = _rng(scene, "j9o")
    yes_p = [(True, rng.choice(cands[oid][True])) for oid in sorted(cands) if cands[oid][True]]
    no_p = [(False, rng.choice(cands[oid][False])) for oid in sorted(cands) if cands[oid][False]]
    yes_p = rng.sample(yes_p, min(len(yes_p), J9_OPENING_MAX // 2))
    no_p = rng.sample(no_p, min(len(no_p), max(len(yes_p), 1)))
    picks = sorted(yes_p + no_p, key=lambda t: (t[1][2].id, not t[0]))
    for j, (yes, (el, owner, o, pv, ev)) in enumerate(picks):
        letters = _letters(scene, pv)
        ops = sorted(letters[x.id] for x in owner.openings if any(x.id in v.labels for v in pv))
        claims = [{"a": el.id, "b": owner.id, "relation": "passes_through", "via": o.id}] if yes else []
        lo, hi = o.min, o.max
        out.append(_Spec("J9_relation", f"o{j}", _prompt_j9_passes(letters[el.id], ops, letters[o.id]),
                         schema_j9_passes(),
                         _truth("passes_opening", "passes", yes, letters, passes=yes, element=el.id, opening=o.id,
                                owner=owner.id, relations=claims), ev,
                         {"n_images": len(pv), "visible_px": {letters[el.id]: _visible(pv, el.id)},
                          "min_visible_px": _visible(pv, el.id)},
                         [_image(v.image, scene_dir) for v in pv],
                         [_el_line(scene, el.id, letters), _el_line(scene, owner.id, letters),
                          f"Opening {letters[o.id]} in {letters[owner.id]}: X {_mm(lo[0])} to {_mm(hi[0])}, "
                          f"Y {_mm(lo[1])} to {_mm(hi[1])}, Z {_mm(lo[2])} to {_mm(hi[2])} mm."]))
    return out


# ------------------------------------------------------------------------------------------------- build

def build_items(scene: Scene, views: list[View], modes=("pictures",), *, scene_dir: Path | None = None,
                fix_renderer: FixRenderer | None = None, cand_renderer: CandRenderer | None = None,
                group_renderer: GroupRenderer | None = None, jobs: tuple[str, ...] | None = None) -> list[Item]:
    """Items for the nine jobs, per planted pair / element group and mode.

    `scene_dir` resolves the views' relative image paths; `fix_renderer(scene, fix)` renders before/after views of a
    candidate fix (J5/J6 are skipped without it); `cand_renderer(scene, focus, fixes)` renders candidates side by
    side (J7 is skipped without it); `group_renderer(scene, focus)` renders a labelled group of 3+ elements for J8/J9
    when no view already labels one; `jobs` limits which jobs are built."""
    want = set(jobs) if jobs else set(ALL_JOBS)
    fixv = _FixViews(scene, fix_renderer) if fix_renderer is not None else None
    specs: list[_Spec] = []
    for n, p in enumerate(scene.planted):
        specs += _pair_specs(scene, views, n, p, want, scene_dir, fixv, cand_renderer)
    if want & {"J8_spatial", "J9_relation"}:
        groups = _groups(scene, views, group_renderer)
        if "J8_spatial" in want:
            specs += _j8_specs(scene, groups, scene_dir)
        if "J9_relation" in want:
            specs += _j9_specs(scene, views, groups, scene_dir)

    items: list[Item] = []
    for s in specs:
        for mode in modes:
            text = s.prompt
            if mode == "pictures_text" and s.facts:
                text += "\n\nMeasured facts:\n- " + "\n- ".join(s.facts)
            items.append(Item(id=f"{scene.seed}-{s.job}-{s.n}-{mode}", seed=scene.seed, job=s.job, mode=mode,
                              images=list(s.images), prompt=_finish(text), schema=s.schema, truth=s.truth,
                              meta={**scene.challenge, **s.meta, "n": s.n, "job": s.job,
                                    "question": s.truth.get("question")},
                              categories=[JOB_CATEGORY[s.job]], evidence=s.evidence))
    return items


def renderers_for(scene_dir: Path, style: str | None = None, camera=None) -> dict:
    """fix_renderer / cand_renderer / group_renderer for `build_items`, on iris_bench.render (whichever of its
    functions exist): `build_items(scene, views, modes, scene_dir=d, **renderers_for(d))`."""
    from . import render
    kw = {"style": style} if style else {}
    out: dict = {}

    def focus_of(sc: Scene, fixes: list[Fix]) -> list[str]:
        moved = {f.element for f in fixes}
        return sorted(moved | {x for p in sc.planted if moved & {p.a, p.b} for x in (p.a, p.b)})

    if hasattr(render, "render_fix"):
        out["fix_renderer"] = lambda sc, fix: list(render.render_fix(scene_dir, focus_of(sc, [fix]), fix, **kw))
    if hasattr(render, "render_candidates"):
        def cand(sc: Scene, focus: list[str], fixes: list[Fix]) -> list[View]:
            if camera is not None:
                return list(render.render_candidates(scene_dir, focus, fixes, camera=camera))
            return list(render.render_candidates(scene_dir, focus, fixes))
        out["cand_renderer"] = cand
    if hasattr(render, "render_scene"):
        out["group_renderer"] = lambda sc, focus: list(render.render_scene(scene_dir, focus, views=("A", "C"), **kw))
    return out


# ------------------------------------------------------------------------------------------------- balance

def _answer_key(it: Item) -> str:
    t = it.truth
    return repr(t.get("answer", t.get("kind")))


def _balanced(it: Item, jobs: tuple[str, ...]) -> bool:
    return it.job in jobs and it.truth.get("question", "sort") in BALANCED_QUESTIONS


def balance(items: list[Item], jobs: tuple[str, ...] = BALANCED_JOBS, seed: int = 0) -> list[Item]:
    """Over a run, keep yes/no and kind answers balanced: per (job, mode, question) of BALANCED_QUESTIONS every
    answer is cut down (seeded) to the rarest answer's count. Everything else passes through untouched, in order. An
    answer missing from the run is not invented (a group with one answer keeps everything)."""
    groups: dict[tuple, dict[str, list[Item]]] = defaultdict(lambda: defaultdict(list))
    for it in items:
        if _balanced(it, jobs):
            groups[(it.job, it.mode, it.truth.get("question"))][_answer_key(it)].append(it)
    keep: set[str] = set()
    for key, by_ans in groups.items():
        n = min(len(g) for g in by_ans.values())
        rng = random.Random(f"balance-{seed}-{'-'.join(map(str, key))}")
        for ans in sorted(by_ans):
            g = sorted(by_ans[ans], key=lambda i: i.id)
            keep.update(i.id for i in rng.sample(g, n))
    return [it for it in items if not _balanced(it, jobs) or it.id in keep]


def balance_j1(items: list[Item], seed: int = 0) -> list[Item]:
    """J1 only: kinds balanced in the 3-way sort, yes/no balanced in the binary question."""
    return balance(items, ("J1_sort",), seed)


def balance_j6(items: list[Item], seed: int = 0) -> list[Item]:
    return balance(items, ("J6_new_clash",), seed)
