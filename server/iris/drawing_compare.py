"""Drawing ↔ model comparison (docs/drawings.md, "compare"): the items read off a sheet against what the model says.

Model data only, never AI. The reader (drawing_reader.py) may have used Gemini to find an item; this module only
compares what it found with the model's own data: an element's Tag, its Name, the identifier keys in its property
sets (Mark, Reference, ElementName…) and the section of its body profile. An item the AI read but the PDF's text layer
did not confirm (status "ai_only") is compared like any other, and every result about it carries
`evidence.unconfirmed = True`, so the page can say "check the reading first".

`model_index` lists the MEP elements a drawing can show (segments, fittings, accessories, terminals, equipment) with
their family (`kind`, the reader's words: duct, pipe, tray, diffuser, unit, equipment, other), identifiers, section
in millimetres and storey. `compare` matches each tagged item to elements:

1. exact identifier: the item's tag equals one of the element's identifiers once both are normalised (case, spaces,
   dashes and other punctuation ignored: "sa main l02 5" is "SA-MAIN-L02-5");
2. else the tag is a run of whole words in the element's Name ("AHU-01" in "Air handling unit AHU-01 (…)"); only a
   tag with a digit that is not itself a size takes this step.

When several elements carry the identifier (a run split in two keeps its tag), the item takes the one on the
compared storey, of the same family, of the same size, not yet taken, in model order; all of them count as shown.
Then, for each match, at most one mismatch: `type_differs` when the families disagree or one is round and the other
rectangular (one per item: `evidence.reason` lists "kind", "shape" or both, as for a pipe drawn as a rectangular
duct), else `size_differs` when a dimension differs by more than max(5 mm, 2 % of the model's), compared largest to
largest (sizes are not compared across types). A
tagged item with no element is `missing_in_model`. An element with a tag of its own (unique in the model) that no item
shows is `missing_in_drawing`, reported only for the families the drawing shows, for runs, terminals and equipment
(not fittings or accessories, which drawings seldom tag), and only on the drawing's storey: the one given, else the
storey most matches stand on; with neither, none is reported.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Iterable

import ifcopenshell.util.element

from . import datums, demos
from .scene import IfcScene

if TYPE_CHECKING:   # never imported at run time: an item may be the reader's dataclass or a plain dict
    from .drawing_reader import Item  # noqa: F401

TOLERANCE_MM = 5.0      # a dimension differs when |Δ| exceeds the larger of these two
TOLERANCE_REL = 0.02    # of the model's dimension
TOLERANCE_RULE = "max(5 mm, 2% of the model's size)"

# Each MEP class's family (what a drawing calls it) and part (what it is in a system). An IFC2X3 element of a generic
# flow class (IfcFlowSegment…) is read through its type (IfcDuctSegmentType → IfcDuctSegment).
FAMILY = {
    "IfcDuctSegment": ("duct", "segment"), "IfcDuctFitting": ("duct", "fitting"),
    "IfcDamper": ("duct", "accessory"), "IfcDuctSilencer": ("duct", "accessory"),
    "IfcPipeSegment": ("pipe", "segment"), "IfcPipeFitting": ("pipe", "fitting"),
    "IfcValve": ("pipe", "accessory"), "IfcFlowMeter": ("pipe", "accessory"),
    "IfcCableCarrierSegment": ("tray", "segment"), "IfcCableCarrierFitting": ("tray", "fitting"),
    "IfcAirTerminal": ("diffuser", "terminal"),
    "IfcUnitaryEquipment": ("unit", "equipment"), "IfcAirTerminalBox": ("unit", "equipment"),
    "IfcAirToAirHeatRecovery": ("unit", "equipment"),
}
# Then by what the element is: anything else that moves, stores, treats or converts is equipment.
GENERIC = (("IfcElectricDistributionBoard", ("equipment", "equipment")),
           ("IfcEnergyConversionDevice", ("equipment", "equipment")),
           ("IfcFlowMovingDevice", ("equipment", "equipment")),
           ("IfcFlowStorageDevice", ("equipment", "equipment")),
           ("IfcFlowTreatmentDevice", ("equipment", "equipment")),
           ("IfcFlowSegment", ("other", "segment")), ("IfcFlowFitting", ("other", "fitting")),
           ("IfcFlowController", ("other", "accessory")), ("IfcFlowTerminal", ("other", "terminal")),
           ("IfcDistributionControlElement", ("other", "control")))
REPORTED_PARTS = ("segment", "terminal", "equipment")   # what a drawing is expected to tag
SIZED_PARTS = ("segment", "fitting", "accessory", "terminal")   # equipment's body is an assembly, not a section
# Property names that identify one element (Pset_*Common.Reference among them). A value many elements share (a type
# mark) still matches, as several candidates.
ID_KEYS = ("Tag", "Mark", "Reference", "ElementName", "Element Name", "Number")
SIZE_LIKE = re.compile(r"^(?:DN|D|Ø)?\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)?(?:MM)?$")
WINDOW = 6   # the most Name words a tag can span


# ---------------------------------------------------------------------------------------------------- data


@dataclass
class ModelItem:
    """One MEP element as a drawing could show it. `tag` is its own identifier (unique in the model), or None."""
    global_id: str
    ifc_class: str
    kind: str                       # duct | pipe | tray | diffuser | unit | equipment | other
    part: str                       # segment | fitting | accessory | terminal | equipment | control | other
    name: str | None
    tag: str | None
    tag_field: str | None
    identifiers: list[dict]         # [{"field", "value", "key"}] in priority order: Tag, property sets, Name, System
    shape: str | None               # "rect" | "round"
    size_mm: list[float] | None     # rect [larger, smaller]; round [diameter]
    size: str | None                # "600x300" | "Ø150"
    storey: str | None
    systems: list[str] = field(default_factory=list)
    source: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Mismatch:
    kind: str                       # missing_in_model | missing_in_drawing | size_differs | type_differs
    item: str | None                # drawing item id
    element: str | None             # IFC GlobalId
    drawing_value: str | None
    model_value: str | None
    evidence: dict

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------------------------------- words and sizes


def norm(text) -> str:
    """An identifier with case, spaces, dashes and every other non-alphanumeric ignored ("sa main l02 5" →
    "SAMAINL025")."""
    return re.sub(r"[^A-Z0-9]", "", str(text).upper()) if text is not None else ""


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def parse_size(text) -> list[float] | None:
    """A drawing's size label in mm: "600x300", "600 × 300 mm" → [600, 300]; "Ø150", "150ø", "DN54", "D100",
    "150 dia" → [150]. A fitting's "600x400/600x300" gives its first size. None when the text names no size."""
    if not text:
        return None
    t = str(text).strip()
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*[x×X*]\s*(\d+(?:[.,]\d+)?)", t)
    if m:
        return [_num(m.group(1)), _num(m.group(2))]
    m = (re.search(r"(?:Ø|⌀|ø|\bDN|\bD|\bDIA\.?)\s*(\d+(?:[.,]\d+)?)", t, re.I)
         or re.search(r"(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*(?:Ø|⌀|ø|\bDIA\b|\bdia\b)", t, re.I))
    if m:
        return [_num(m.group(1))]
    return None


def _mm(v: float) -> float:
    return round(float(v), 1)


def format_size(size_mm: Iterable[float] | None) -> str | None:
    """[600, 300] → "600x300"; [150] → "Ø150"."""
    if not size_mm:
        return None
    parts = [f"{v:g}" if v != int(v) else str(int(v)) for v in (_mm(x) for x in size_mm)]
    return f"Ø{parts[0]}" if len(parts) == 1 else "x".join(parts)


def _shape_of(size_mm) -> str | None:
    return None if not size_mm else "round" if len(size_mm) == 1 else "rect" if len(size_mm) == 2 else None


def _storey_key(s) -> tuple[str, int | None]:
    m = re.fullmatch(r"([A-Z]*)0*(\d+)", norm(s))
    return (m.group(1), int(m.group(2))) if m else (norm(s), None)


def same_storey(a, b) -> bool:
    """Whether two storey names say the same level: equal once normalised, or the same number with one prefix the
    start of the other ("Level 02", "L02", "level 2")."""
    if a is None or b is None:
        return a is b
    if norm(a) == norm(b):
        return True
    (la, na), (lb, nb) = _storey_key(a), _storey_key(b)
    return na is not None and na == nb and (la.startswith(lb) or lb.startswith(la))


# ---------------------------------------------------------------------------------------------------- the model


def _family(e) -> tuple[str, str] | None:
    """(kind, part) of an MEP element, or None for anything else."""
    if not e.is_a("IfcDistributionElement"):
        return None
    cls = e.is_a()
    if cls not in FAMILY:
        t = ifcopenshell.util.element.get_type(e)
        if t is not None and t.is_a().endswith("Type"):
            cls = t.is_a()[:-4]
    if cls in FAMILY:
        return FAMILY[cls]
    return next((fam for c, fam in GENERIC if e.is_a(c)), ("other", "other"))


def _body_items(e) -> list:
    rep = getattr(e, "Representation", None)
    reps = list(rep.Representations) if rep is not None else []
    body = [r for r in reps if r.RepresentationIdentifier == "Body"] or reps
    out, todo = [], [i for r in body for i in r.Items]
    while todo:
        i = todo.pop(0)
        if i.is_a("IfcMappedItem"):
            todo.extend(i.MappingSource.MappedRepresentation.Items)
        elif i.is_a("IfcBooleanResult"):
            todo.append(i.FirstOperand)
        else:
            out.append(i)
    return out


def _section(item) -> tuple[str, list[float]] | None:
    """(shape, dimensions in file units) of one body item's section: a rectangle (or a tray's U or C channel, by its
    outside), a circle (hollow ones by the outside), a swept disk. Anything else has no section."""
    if item.is_a("IfcSweptDiskSolid"):
        return "round", [2 * item.Radius]
    if not item.is_a("IfcSweptAreaSolid"):
        return None
    p = item.SweptArea
    if p.is_a("IfcCircleProfileDef"):
        return "round", [2 * p.Radius]
    if p.is_a("IfcRectangleProfileDef"):
        return "rect", [p.XDim, p.YDim]
    if p.is_a("IfcUShapeProfileDef"):
        return "rect", [p.Depth, p.FlangeWidth]
    if p.is_a("IfcCShapeProfileDef"):
        return "rect", [p.Depth, p.Width]
    return None


def section_mm(e, unit_scale: float) -> tuple[str | None, list[float] | None]:
    """An element's section from its body profile in mm: the largest section among its body items (a tee's main run,
    a diffuser's face). Rectangles larger side first."""
    best = None
    for item in _body_items(e):
        got = _section(item)
        if got is None:
            continue
        shape, dims = got
        area = dims[0] * dims[1] if shape == "rect" else math.pi * dims[0] ** 2 / 4
        if best is None or area > best[0]:
            best = (area, shape, dims)
    if best is None:
        return None, None
    _, shape, dims = best
    mm = [_mm(d * unit_scale * 1000.0) for d in dims]
    return shape, sorted(mm, reverse=True)


def _identifiers(e, systems: list[str]) -> list[dict]:
    """The element's identifiers in priority order, each once: its Tag, identifier keys in its (and its type's)
    property sets, its Name, then its systems (listed, never matched: a system names many elements)."""
    out: list[dict] = []

    def add(fld, v):
        if v is None or isinstance(v, bool):
            return
        v = str(v).strip()
        key = norm(v)
        if key and not any(o["key"] == key for o in out):
            out.append({"field": fld, "value": v, "key": key})

    add("Tag", getattr(e, "Tag", None))
    try:
        psets = ifcopenshell.util.element.get_psets(e, psets_only=True)
    except Exception:
        psets = {}
    for pset in sorted(psets):
        props = psets[pset]
        for k in ID_KEYS:
            if k in props:
                add(f"{demos.PSET_NAMES.get(pset, pset)}.{k}", props[k])
    add("Name", getattr(e, "Name", None))
    out.extend({"field": "System", "value": s, "key": norm(s)} for s in systems if norm(s))
    return out


def model_index(scene: IfcScene) -> list[ModelItem]:
    """Every MEP element of the scene (all files) a drawing can show, in model order: family, identifiers, section
    in mm from the body profile, storey. Its `tag` is the first Tag-like identifier no other element shares."""
    rows = []
    for i, model in enumerate(scene.models):
        scale = scene.unit_scales[i]
        for e in model.by_type("IfcDistributionElement"):
            fam = _family(e)
            if fam is None:
                continue
            kind, part = fam
            st = ifcopenshell.util.element.get_container(e, ifc_class="IfcBuildingStorey")
            systems = sorted({g.Name for g in ifcopenshell.util.element.get_groups(e)
                              if g.is_a("IfcSystem") and g.Name})
            shape, size = section_mm(e, scale) if part in SIZED_PARTS else (None, None)
            rows.append(ModelItem(
                global_id=e.GlobalId, ifc_class=e.is_a(), kind=kind, part=part, name=getattr(e, "Name", None),
                tag=None, tag_field=None, identifiers=_identifiers(e, systems), shape=shape, size_mm=size,
                size=format_size(size), storey=datums.storey_name(st) if st is not None else None, systems=systems,
                source=scene.paths[i].name))
    counts = Counter(k for r in rows for k in {x["key"] for x in r.identifiers if x["field"] not in ("Name", "System")})
    for r in rows:
        own = next((x for x in r.identifiers if x["field"] not in ("Name", "System") and counts[x["key"]] == 1), None)
        if own is not None:
            r.tag, r.tag_field = own["value"], own["field"]
    return rows


# ---------------------------------------------------------------------------------------------------- comparing


def _get(item, name, default=None):
    return item.get(name, default) if isinstance(item, dict) else getattr(item, name, default)


def _item_size(item) -> list[float] | None:
    got = _get(item, "size_mm")
    if got:
        try:
            return [float(v) for v in got]
        except (TypeError, ValueError):
            pass
    return parse_size(_get(item, "size"))


def _kinds_agree(item_kind, m: ModelItem) -> bool:
    if not item_kind or item_kind == "other" or item_kind == m.kind:
        return True
    if {item_kind, m.kind} <= {"unit", "equipment"}:
        return True
    if m.part == "accessory" and item_kind == "equipment":
        return True
    return m.kind == "other" and item_kind == "equipment"


def tolerance_mm(model_mm: float) -> float:
    return max(TOLERANCE_MM, TOLERANCE_REL * abs(model_mm))


def _size_check(drawing_mm, m: ModelItem) -> dict | None:
    """How a drawing's size compares with the model's: None when either is unknown; else the shapes, both sizes
    largest first, the differences and the tolerance per dimension, and whether it `agrees`."""
    if not drawing_mm or not m.size_mm:
        return None
    d_shape = _shape_of(drawing_mm)
    if d_shape != m.shape:
        return {"shape_agrees": False, "drawing_shape": d_shape, "model_shape": m.shape,
                "drawing_mm": list(drawing_mm), "model_mm": list(m.size_mm), "agrees": False}
    d = sorted((float(v) for v in drawing_mm), reverse=True)
    delta = [round(abs(a - b), 1) for a, b in zip(d, m.size_mm)]
    tol = [round(tolerance_mm(b), 1) for b in m.size_mm]
    return {"shape_agrees": True, "drawing_mm": d, "model_mm": list(m.size_mm), "delta_mm": delta,
            "tolerance_mm": tol, "tolerance": TOLERANCE_RULE,
            "agrees": all(x <= t + 1e-6 for x, t in zip(delta, tol))}


def _name_keys(index: list[ModelItem]) -> dict[str, list[ModelItem]]:
    """Every run of up to WINDOW whole words of each element's Name, normalised → the elements."""
    out: dict[str, list[ModelItem]] = defaultdict(list)
    for m in index:
        words = re.findall(r"[A-Z0-9]+", (m.name or "").upper())
        keys = {"".join(words[a:b]) for a in range(len(words)) for b in range(a + 1, min(len(words), a + WINDOW) + 1)}
        for k in keys:
            out[k].append(m)
    return out


def _narrow(cands: list[tuple[ModelItem, dict]], storey, kind, size_mm):
    """Keep the candidates on the storey, then of the family, then of the size, each step only when some remain."""
    tests = [lambda m: storey is None or same_storey(m.storey, storey),
             lambda m: _kinds_agree(kind, m),
             lambda m: (_size_check(size_mm, m) or {"agrees": True})["agrees"]]
    on_storey = cands
    for n, keep in enumerate(tests):
        sub = [c for c in cands if keep(c[0])]
        if sub:
            cands = sub
        if n == 0:
            on_storey = cands
    return cands, on_storey


def compare(scene: IfcScene, items: Iterable[Any], *, storey: str | None = None,
            index: list[ModelItem] | None = None) -> dict:
    """A drawing's items against the model. `items` are the reader's Items or dicts with their fields (id, tag, kind,
    size, size_mm, status). `storey` is the drawing's level when known. Returns {matches: [{item, element, by, score,
    evidence}], mismatches: [Mismatch], unmatched: [{item, why}], scope: {...}}; `by` is "tag" (the Tag attribute),
    "pset" (an identifier in a property set), "name" (the whole Name) or "name_token" (words of the Name)."""
    index = model_index(scene) if index is None else index
    by_key: dict[str, list[tuple[ModelItem, dict]]] = defaultdict(list)
    for m in index:
        for ident in m.identifiers:
            if ident["field"] != "System":
                by_key[ident["key"]].append((m, ident))
    names: dict[str, list[ModelItem]] | None = None
    items = list(items)
    matches, mismatches, unmatched = [], [], []
    covered: set[str] = set()
    used: Counter = Counter()
    matched: list[ModelItem] = []
    shown = set()

    for it in items:
        iid = str(_get(it, "id"))
        tag, kind, status = _get(it, "tag"), _get(it, "kind"), _get(it, "status")
        size_mm = _item_size(it)
        if kind and kind != "other":
            shown.add(kind)
        base = {"drawing_tag": tag, "status": status, "unconfirmed": status == "ai_only"}
        key = norm(tag)
        if not key:
            unmatched.append({"item": iid, "why": "no tag"})
            continue

        cands: list[tuple[ModelItem, dict]] = []
        seen = set()
        for m, ident in by_key.get(key, []):
            if m.global_id not in seen:
                seen.add(m.global_id)
                cands.append((m, ident))
        how = "exact"
        if not cands and any(c.isdigit() for c in key) and not SIZE_LIKE.match(key):
            names = _name_keys(index) if names is None else names
            cands = [(m, {"field": "Name", "value": m.name, "key": norm(m.name)}) for m in names.get(key, [])]
            how = "name_token"
        if not cands:
            mismatches.append(Mismatch("missing_in_model", iid, None, tag, None, {
                **base, "searched": "Tag, property-set identifiers (" + ", ".join(ID_KEYS) + ") and Name",
                "drawing_kind": kind, "drawing_size": format_size(size_mm)}))
            continue

        narrowed, on_storey = _narrow(cands, storey, kind, size_mm)
        fresh = [c for c in narrowed if used[c[0].global_id] == 0]
        m, ident = (fresh or narrowed)[0]
        used[m.global_id] += 1
        covered.update(c[0].global_id for c in on_storey)
        matched.append(m)
        if m.kind != "other":
            shown.add(m.kind)
        if how == "name_token":
            by, score = "name_token", 0.75
        elif ident["field"] == "Tag":
            by, score = "tag", 1.0
        elif ident["field"] == "Name":
            by, score = "name", 0.9
        else:
            by, score = "pset", 1.0
        if len(narrowed) > 1:
            score *= 0.8
        ev = {**base, "by": by, "field": ident["field"], "identifier": ident["value"], "score": round(score, 2),
              "candidates": [c[0].global_id for c in narrowed] if len(narrowed) > 1 else []}
        if storey is not None and not same_storey(m.storey, storey):
            ev["model_storey"] = m.storey
        matches.append({"item": iid, "element": m.global_id, "by": by, "score": round(score, 2), "evidence": ev})

        # At most one mismatch per item: its type (family, shape or both, every reason listed), else its size. Sizes
        # are not compared across types; the numbers stay in the evidence.
        drawn_size = _get(it, "size") or format_size(size_mm)
        check = _size_check(size_mm, m)
        reasons = [r for r, differs in (("kind", not _kinds_agree(kind, m)),
                                        ("shape", check is not None and not check["shape_agrees"])) if differs]
        if reasons:
            values = (kind, m.kind) if "kind" in reasons else (drawn_size, m.size)
            mismatches.append(Mismatch("type_differs", iid, m.global_id, *values, {
                **ev, "reason": reasons, "drawing_kind": kind, "model_kind": m.kind, "model_class": m.ifc_class,
                "drawing_size": drawn_size, "model_size": m.size, **(check or {})}))
        elif check is not None and not check["agrees"]:
            mismatches.append(Mismatch("size_differs", iid, m.global_id, drawn_size, m.size, {**ev, **check}))

    # Scope for what the drawing leaves out: its storey, else where most matches stand, and only what it shows.
    scope_storey, inferred, whole = storey, False, False
    if storey is None and matched:
        scope_storey, inferred = Counter(m.storey for m in matched).most_common(1)[0][0], True
        whole = scope_storey is None   # a model without storeys: the drawing's scope is all of it
    scope = {"storey": scope_storey, "inferred": inferred, "kinds": sorted(shown), "parts": list(REPORTED_PARTS),
             "checked": storey is not None or bool(matched)}
    if scope["checked"]:
        for m in index:
            if (m.tag and m.part in REPORTED_PARTS and m.kind != "other" and m.kind in shown
                    and m.global_id not in covered and (whole or same_storey(m.storey, scope_storey))):
                mismatches.append(Mismatch("missing_in_drawing", None, m.global_id, None, m.tag, {
                    "by": "tag", "field": m.tag_field, "identifier": m.tag, "model_kind": m.kind,
                    "model_class": m.ifc_class, "model_size": m.size, "storey": m.storey,
                    "scope_storey": scope_storey, "scope_inferred": inferred, "unconfirmed": False}))
    else:
        scope["why"] = "no storey given and nothing matched: what the drawing leaves out is not checked"
    return {"matches": matches, "mismatches": mismatches, "unmatched": unmatched, "scope": scope}


def to_json(result: dict) -> dict:
    """`compare`'s result with its Mismatches as plain dicts."""
    return {**result, "mismatches": [m.to_dict() if isinstance(m, Mismatch) else m for m in result["mismatches"]]}


def coverage(index: list[ModelItem], storey: str | None = None) -> dict:
    """How many indexed elements (on `storey`, if given) a drawing could name and size: by kind and part, those with
    a tag of their own, with a section, and with both."""
    rows = [m for m in index if storey is None or same_storey(m.storey, storey)]
    out: dict = {"elements": len(rows), "tagged": sum(1 for m in rows if m.tag),
                 "sized": sum(1 for m in rows if m.size_mm),
                 "tagged_and_sized": sum(1 for m in rows if m.tag and m.size_mm), "by": {}}
    for m in rows:
        b = out["by"].setdefault(f"{m.kind}/{m.part}", {"elements": 0, "tagged": 0, "sized": 0, "tagged_and_sized": 0})
        b["elements"] += 1
        b["tagged"] += bool(m.tag)
        b["sized"] += bool(m.size_mm)
        b["tagged_and_sized"] += bool(m.tag and m.size_mm)
    return out
