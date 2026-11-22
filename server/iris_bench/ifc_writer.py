"""Write an Iris Bench scene as an IFC4 file Iris can open, check and edit.

Units are metres. Every element becomes one IFC product named and tagged with its scene id ("e3"); beams' web
openings become IfcOpeningElements voiding the beam (named "o1" ...). `ids.json` next to the IFC maps scene ids
(elements and openings) to IFC GlobalIds.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import ifcopenshell
import ifcopenshell.api

from .spec import Element, Scene

IFC_CLASS = {
    "beam": "IfcBeam",
    "column": "IfcColumn",
    "slab": "IfcSlab",
    "duct": "IfcDuctSegment",
    "pipe": "IfcPipeSegment",
    "tray": "IfcCableCarrierSegment",
    "bracket": "IfcDiscreteAccessory",
}
_OPENING_OVERCUT = 0.01   # openings poke 10 mm out of both beam faces, so the cut leaves no coplanar skin


def _run(*args, **kw):
    return ifcopenshell.api.run(*args, **kw)


def _box(model, body, product, lo, hi) -> None:
    """A rectangular extrusion from world `lo` to `hi` (metres), placed at `lo`."""
    sx, sy, sz = (float(hi[i] - lo[i]) for i in range(3))
    profile = model.create_entity(
        "IfcRectangleProfileDef", ProfileType="AREA", XDim=sx, YDim=sy,
        Position=model.create_entity("IfcAxis2Placement2D",
                                     Location=model.create_entity("IfcCartesianPoint", (sx / 2, sy / 2))))
    rep = _run("geometry.add_profile_representation", model, context=body, profile=profile, depth=sz)
    _run("geometry.assign_representation", model, product=product, representation=rep)
    matrix = np.eye(4)
    matrix[:3, 3] = [float(v) for v in lo]
    _run("geometry.edit_object_placement", model, product=product, matrix=matrix, is_si=True)


def _cylinder(model, body, product, start, end, radius) -> None:
    """A circle-profile extrusion along the (axis-aligned) run from `start` to `end`."""
    a, b = np.asarray(start, float), np.asarray(end, float)
    axis = b - a
    length = float(np.linalg.norm(axis))
    axis /= length
    ref = (0.0, 0.0, 1.0)     # runs are horizontal, so Z is always perpendicular
    _run("geometry.edit_object_placement", model, product=product)
    position = model.createIfcAxis2Placement3D(model.createIfcCartesianPoint(tuple(map(float, a))),
                                               model.createIfcDirection(tuple(map(float, axis))),
                                               model.createIfcDirection(ref))
    profile = model.createIfcCircleProfileDef("AREA", None, None, float(radius))
    solid = model.createIfcExtrudedAreaSolid(profile, position, model.createIfcDirection((0.0, 0.0, 1.0)), length)
    product.Representation = model.createIfcProductDefinitionShape(
        None, None, [model.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])])


def write_ifc(scene: Scene, path: str | Path) -> Path:
    """Write `scene` to `path` (IFC4, metres) and `ids.json` beside it; return the IFC path."""
    path = Path(path)
    model = _run("project.create_file", version="IFC4")
    project = _run("root.create_entity", model, ifc_class="IfcProject", name=f"Iris Bench {scene.seed}")
    _run("unit.assign_unit", model, units=[_run("unit.add_si_unit", model, unit_type="LENGTHUNIT")])
    ctx = _run("context.add_context", model, context_type="Model")
    body = _run("context.add_context", model, context_type="Model", context_identifier="Body",
                target_view="MODEL_VIEW", parent=ctx)
    site = _run("root.create_entity", model, ifc_class="IfcSite", name="Site")
    building = _run("root.create_entity", model, ifc_class="IfcBuilding", name="Building")
    storey = _run("root.create_entity", model, ifc_class="IfcBuildingStorey", name="Level 01")
    _run("aggregate.assign_object", model, relating_object=project, products=[site])
    _run("aggregate.assign_object", model, relating_object=site, products=[building])
    _run("aggregate.assign_object", model, relating_object=building, products=[storey])

    ids: dict[str, str] = {}
    for el in scene.elements:
        product = _run("root.create_entity", model, ifc_class=IFC_CLASS[el.kind], name=el.id)
        product.Tag = el.id
        if el.kind == "bracket":
            product.PredefinedType = "BRACKET"
        _run("spatial.assign_container", model, relating_structure=storey, products=[product])
        if el.shape == "box":
            _box(model, body, product, el.min, el.max)
        else:
            _cylinder(model, body, product, el.start, el.end, el.radius)
        ids[el.id] = product.GlobalId
        for o in el.openings:
            ids[o.id] = _opening(model, body, product, el, o)

    path.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(path))
    (path.parent / "ids.json").write_text(json.dumps(ids, indent=2))
    return path


def _opening(model, body, host, beam: Element, o) -> str:
    """An IfcOpeningElement voiding `host`, overcut past the beam's two faces along its width."""
    lo, hi = list(o.min), list(o.max)
    blo, bhi = beam.min, beam.max
    t = 0 if (bhi[0] - blo[0]) < (bhi[1] - blo[1]) else 1      # through-width axis
    lo[t] = min(lo[t], blo[t]) - _OPENING_OVERCUT
    hi[t] = max(hi[t], bhi[t]) + _OPENING_OVERCUT
    opening = _run("root.create_entity", model, ifc_class="IfcOpeningElement", name=o.id)
    opening.PredefinedType = "OPENING"
    _box(model, body, opening, lo, hi)
    _run("feature.add_feature", model, feature=opening, element=host)
    return opening.GlobalId


def write_folder(scene: Scene, out_dir: str | Path) -> Path:
    """`scene.ifc` and `ids.json` in `out_dir`; returns the IFC path."""
    return write_ifc(scene, Path(out_dir) / "scene.ifc")
