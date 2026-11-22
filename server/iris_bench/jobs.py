"""The five coordination jobs, asked about one scene's planted pairs.

`build_items(scene, views, modes)` turns a scene and its rendered views into `Item`s:

    J1_sort       real clash / not touching / touching by design          truth {"kind"}
    J2_who_moves  which labelled element should move (real clashes)       truth {"mover_letter"}
    J3_fix        a move of the element that should move (real clashes)   truth {"mover", "letters", "axes", "expected"}
    J4_opening    which labelled openings the mover fits through          truth {"fitting"}
    J5_review     is a shown candidate move good (real clashes)           truth {"fix", "variant", "expected_good"}

Letters: the renderer labels elements (View.labels, element id -> letter) and openings (opening id -> letter, from P
onward). Labels missing from the views are filled in here, seeded by the scene, so items are always buildable.

Modes: "pictures" prompts never name what an element is, how big it is or how far apart things are; the
"pictures_text" comparison mode appends measured facts (roles and signed distance). Every prompt ends with
"Answer with JSON only" and every item carries a strict JSON Schema (`Item.schema`).
"""
from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Callable

from .spec import Element, Fix, Item, Planted, Scene, View

SYSTEM = ("You are an experienced building services coordinator reviewing rendered 3D views of a building model. "
          "Each picture shows labelled parts. Judge only from what the pictures show. Reply with a single JSON "
          "object that follows the given schema.")

ANSWER = "Answer with JSON only."
ELEMENT_LETTERS = "ABCDEFGHIJKLMNO"
OPENING_LETTERS = "PQRSTUVWXYZ"
DIRECTIONS = ("up", "down", "north", "south", "east", "west")
AXES = {"up": (0, 0, 1), "down": (0, 0, -1), "north": (0, 1, 0), "south": (0, -1, 0),
        "east": (1, 0, 0), "west": (-1, 0, 0)}
KIND_CHOICES = {"a": "real", "b": "not_touching", "c": "by_design"}
FIX_VIEWS = ("before", "after")

# A function that renders a candidate fix: (scene, fix) -> views of the scene before and after it (names "before" /
# "after"). Supplied by the renderer; without it no J5 items are built.
FixRenderer = Callable[[Scene, Fix], list[View]]


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
    return {"element": letters_by_id[fix.element], "direction": direction, "distance_mm": int(round(abs(v) * 1000)),
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


# ------------------------------------------------------------------------------------------------- letters and views

def _letters(scene: Scene, views: list[View]) -> dict[str, str]:
    """id -> letter for every element and opening: the renderer's labels first, then seeded letters for the rest
    (elements from A, openings from P)."""
    out: dict[str, str] = {}
    for v in views:
        for k, letter in v.labels.items():
            out.setdefault(k, letter)
    rng = random.Random(f"letters-{scene.seed}")
    used = set(out.values())
    free_e = [c for c in ELEMENT_LETTERS if c not in used]
    free_o = [c for c in OPENING_LETTERS if c not in used]
    rng.shuffle(free_e)
    rng.shuffle(free_o)
    for e in scene.elements:
        if e.id not in out and free_e:
            out[e.id] = free_e.pop()
        for o in e.openings:
            if o.id not in out and free_o:
                out[o.id] = free_o.pop()
    return out


def _openings(scene: Scene) -> list:
    return [o for e in scene.elements for o in e.openings]


def _pair_views(views: list[View], pair: set[str]) -> list[View]:
    """The views framed on this pair (or showing it), never the before/after ones."""
    plain = [v for v in views if v.name not in FIX_VIEWS]
    framed = [v for v in plain if pair & set(v.focus)]
    if framed:
        return framed
    seen = [v for v in plain if any(v.visible_px.get(e, 0) > 0 for e in pair)]
    return seen or plain


def _image(path: str, scene_dir: Path | None) -> str:
    return str(Path(scene_dir) / path) if scene_dir is not None and not Path(path).is_absolute() else path


def _visible(views: list[View], eid: str) -> int:
    return min((v.visible_px.get(eid, 0) for v in views), default=0)


# ------------------------------------------------------------------------------------------------- schemas

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props), "additionalProperties": False}


def schema_j1() -> dict:
    return _obj({"answer": {"type": "string", "enum": list(KIND_CHOICES)}})


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
    return _obj({"good": {"type": "boolean"}})


def normalize_reply(job: str, reply: dict) -> dict:
    """Map a raw reply onto the truth's vocabulary where they differ (J1 letters a/b/c -> kinds)."""
    if job == "J1_sort" and isinstance(reply, dict) and "answer" in reply:
        return {**reply, "kind": KIND_CHOICES.get(str(reply["answer"]).strip().lower())}
    return reply


# ------------------------------------------------------------------------------------------------- text facts

def _role_word(e: Element) -> str:
    return {"structure": "structure (stays put)", "service": "a building service run",
            "support": "a support"}[e.role]


def _facts(scene: Scene, p: Planted, letters: dict[str, str], extra: list[str] | None = None) -> str:
    a, b = scene.element(p.a), scene.element(p.b)
    lines = [f"{letters[a.id]} is a {a.kind}; class: {_role_word(a)}.", f"{letters[b.id]} is a {b.kind}; class: {_role_word(b)}.",
             f"Signed distance between {letters[a.id]} and {letters[b.id]}: {p.distance_m * 1000:.0f} mm "
             "(negative = overlap depth, positive = clear gap).",
             f"Required clear gap after a fix: {scene.clearance_m * 1000:.0f} mm."]
    return "\n\nMeasured facts:\n- " + "\n- ".join(lines + (extra or []))


def _opening_facts(scene: Scene, letters: dict[str, str], mover: Element) -> list[str]:
    out = []
    lo, hi = bounds(mover)
    axis = _long_axis(mover)
    section = [round((hi[i] - lo[i]) * 1000) for i in range(3) if i != axis]
    out.append(f"{letters[mover.id]} cross-section: {section[0]} x {section[1]} mm.")
    for o in _openings(scene):
        size = [round((o.max[i] - o.min[i]) * 1000) for i in range(3)]
        out.append(f"Opening {letters[o.id]}: {size[0]} x {size[1]} x {size[2]} mm (X x Y x Z).")
    return out


# ------------------------------------------------------------------------------------------------- bad fixes for J5

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


# ------------------------------------------------------------------------------------------------- prompts

def _prompt_j1(x: str, y: str) -> str:
    return (f"Here are pictures of two elements labelled {x} and {y}. Is this (a) a real clash that needs fixing, "
            "(b) not touching, (c) touching by design (one supports the other)? Reply with the letter a, b or c "
            "in the field \"answer\".")


def _prompt_j2(x: str, y: str) -> str:
    return (f"These pictures show a clash between the elements labelled {x} and {y}. Which labelled element should "
            "move to resolve it? The building's frame stays put; the runs that can be rerouted are the ones that "
            "move. Give its letter in the field \"mover_letter\".")


def _prompt_j3(x: str, y: str, ops: list[str]) -> str:
    op_txt = (f" Openings through solid members are labelled with letters from P onward ({', '.join(ops)}); if the "
              "move passes through one, give its letter in \"via_opening\", otherwise null." if ops else
              " There are no labelled openings: set \"via_opening\" to null.")
    return (f"These pictures show a clash between the elements labelled {x} and {y}. Propose one straight move of "
            "the element that should move so the clash is gone with a clear gap all round and nothing new is hit. "
            "Give the element's letter in \"element\", the direction (up, down, north, south, east or west; north "
            "is +Y, east is +X, up is +Z) in \"direction\", and how far to move it, in millimetres, as a whole "
            "number in the distance field." + op_txt)


def _prompt_j4(x: str, ops: list[str]) -> str:
    return (f"The pictures show openings labelled {', '.join(ops)} (letters from P onward). Which openings can the "
            f"element labelled {x} pass through with a clear gap all round? List every opening letter that works "
            "in \"fitting\" (an empty list if none does).")


def _prompt_j5(x: str, y: str, mover: str, n_before: int, n_after: int) -> str:
    return (f"The first {n_before} picture(s) show elements {x} and {y} clashing; the last {n_after} picture(s) show "
            f"the same place after a proposed move of element {mover}. Is this fix good (clash gone, enough space, "
            "nothing new hit)? Reply true or false in \"good\".")


def _finish(prompt: str) -> str:
    return f"{prompt}\n\n{ANSWER}"


# ------------------------------------------------------------------------------------------------- build

def build_items(scene: Scene, views: list[View], modes=("pictures",), *, scene_dir: Path | None = None,
                fix_renderer: FixRenderer | None = None, jobs: tuple[str, ...] | None = None) -> list[Item]:
    """Items for the five jobs, per planted pair and mode.

    `scene_dir` resolves the views' relative image paths; `fix_renderer(scene, fix)` renders before/after views of
    a candidate fix (J5 is skipped without it); `jobs` limits which jobs are built."""
    letters = _letters(scene, views)
    by_letter = {v: k for k, v in letters.items()}
    ops = sorted(o.id for o in _openings(scene))
    op_letters = sorted(letters[o] for o in ops)
    rng = random.Random(f"jobs-{scene.seed}")
    want = set(jobs) if jobs else {"J1_sort", "J2_who_moves", "J3_fix", "J4_opening", "J5_review"}
    items: list[Item] = []

    for n, p in enumerate(scene.planted):
        pair = {p.a, p.b}
        pviews = _pair_views(views, pair)
        imgs = [_image(v.image, scene_dir) for v in pviews]
        x, y = letters[p.a], letters[p.b]
        if rng.random() < 0.5:   # which letter is named first is not a cue
            x, y = y, x
        base_meta = {**scene.challenge, "n": n, "pair_kind": p.kind, "distance_mm": round(p.distance_m * 1000, 1),
                     "gap_mm": round(max(p.distance_m, 0) * 1000, 1),
                     "overlap_mm": round(max(-p.distance_m, 0) * 1000, 1),
                     "visible_px": {letters[e]: _visible(pviews, e) for e in sorted(pair)},
                     "min_visible_px": min(_visible(pviews, e) for e in pair), "n_images": len(imgs)}
        real = p.kind == "real" and p.mover is not None

        specs: list[tuple[str, str, dict, dict, dict, list[str], list[str]]] = []
        # (job, prompt, schema, truth, meta, images, extra text facts)
        if "J1_sort" in want:
            specs.append(("J1_sort", _prompt_j1(x, y), schema_j1(), {"kind": p.kind}, {}, imgs, []))
        if real and "J2_who_moves" in want:
            specs.append(("J2_who_moves", _prompt_j2(x, y), schema_j2(sorted([x, y])),
                          {"mover_letter": letters[p.mover], "mover": p.mover}, {}, imgs, []))
        if real and "J3_fix" in want:
            exp = fix_to_reply(p.good_fix, letters) if p.good_fix else None
            specs.append(("J3_fix", _prompt_j3(x, y, op_letters), schema_j3(sorted([x, y]), op_letters),
                          {"mover": p.mover, "letters": by_letter, "axes": {k: list(v) for k, v in AXES.items()},
                           "expected": exp, "pair": [p.a, p.b]}, {}, imgs, []))
        if real and ops and "J4_opening" in want:
            mover = scene.element(p.mover)
            specs.append(("J4_opening", _prompt_j4(letters[p.mover], op_letters), schema_j4(op_letters),
                          {"fitting": sorted(letters[o] for o in p.fitting_openings), "mover": p.mover,
                           "letters": by_letter}, {"opening_count": len(ops)}, imgs,
                          _opening_facts(scene, letters, mover)))
        if real and fix_renderer is not None and "J5_review" in want:
            cands = candidate_fixes(scene, p)
            if cands:
                # good half the time, otherwise one of the bad kinds
                bad = [k for k in cands if k != "good"]
                variant = "good" if (not bad or rng.random() < 0.5) else rng.choice(bad)
                fix = cands[variant]
                fviews = fix_renderer(scene, fix)
                before = [v for v in fviews if v.name.startswith("before")] or fviews[:1]
                after = [v for v in fviews if v.name.startswith("after")] or fviews[1:]
                fimgs = [_image(v.image, scene_dir) for v in before + after]
                fl = {**letters, **{k: v for fv in fviews for k, v in fv.labels.items()}}
                mv = fl[fix.element]
                specs.append(("J5_review", _prompt_j5(fl[p.a], fl[p.b], mv, len(before), len(after)), schema_j5(),
                              {"fix": asdict(fix), "variant": variant, "expected_good": variant == "good",
                               "pair": [p.a, p.b]},
                              {"variant": variant, "n_images": len(fimgs),
                               "visible_px_after": _visible(after, fix.element)}, fimgs,
                              [f"Proposed move of {mv}: dx {fix.dx * 1000:.0f} mm, dy {fix.dy * 1000:.0f} mm, "
                               f"dz {fix.dz * 1000:.0f} mm."]))

        for job, prompt, schema, truth, meta, images, extra in specs:
            for mode in modes:
                text = prompt
                if mode == "pictures_text":
                    text += _facts(scene, p, letters, extra)
                items.append(Item(id=f"{scene.seed}-{job}-{n}-{mode}", seed=scene.seed, job=job, mode=mode,
                                  images=list(images), prompt=_finish(text), schema=schema, truth=truth,
                                  meta={**base_meta, **meta, "job": job}))
    return items


def balance_j1(items: list[Item], seed: int = 0) -> list[Item]:
    """Over a run, keep J1 items balanced across kinds: per mode, every kind is cut down (seeded) to the rarest
    kind's count. Other jobs pass through untouched, in order."""
    groups: dict[tuple[str, str], list[Item]] = defaultdict(list)
    for it in items:
        if it.job == "J1_sort":
            groups[(it.mode, it.truth["kind"])].append(it)
    keep: set[str] = set()
    for mode in {m for m, _ in groups}:
        kinds = [k for m, k in groups if m == mode]   # a kind missing from the run entirely is not invented
        n = min(len(groups[(mode, k)]) for k in kinds)
        rng = random.Random(f"balance-{seed}-{mode}")
        for k in kinds:
            g = sorted(groups[(mode, k)], key=lambda i: i.id)
            keep.update(i.id for i in rng.sample(g, n))
    return [it for it in items if it.job != "J1_sort" or it.id in keep]
