"""Iris Bench geometry and answer checker, on hand-built scenes (no generator, no IFC writer needed)."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest

from iris_bench import checker, geom
from iris_bench.spec import Element, Fix, Opening, Planted, Scene


def box(eid, lo, hi, kind="duct", role="service", **kw):
    return Element(id=eid, kind=kind, role=role, shape="box", min=tuple(lo), max=tuple(hi), **kw)


def cyl(eid, start, end, r, kind="pipe", role="service"):
    return Element(id=eid, kind=kind, role=role, shape="cylinder", start=tuple(start), end=tuple(end), radius=r)


# Beam along X, 6 m x 0.2 m x 0.4 m (z 2.6-3.0), web opening o1 0.5 wide x 0.36 tall at x 1.0-1.5.
# Duct 400x300 along Y crossing the beam at x 2.8-3.2, z 2.65-2.95: 350 mm into it.
# Pipe DN100 along Y at x 3.0, z 2.2 (top 2.25): 350 mm below the beam, 400 mm below the duct.
# Bracket under the duct (carries it, touching).
def scene() -> Scene:
    beam = box("e1", (0, -0.1, 2.6), (6, 0.1, 3.0), kind="beam", role="structure",
               openings=[Opening("o1", (1.0, -0.15, 2.62), (1.5, 0.15, 2.98))])
    duct = box("e2", (2.8, -2, 2.65), (3.2, 2, 2.95))
    pipe = cyl("e3", (3.0, -2, 2.2), (3.0, 2, 2.2), 0.05)
    bracket = box("e5", (2.75, 1.0, 2.6), (3.25, 1.1, 2.65), kind="bracket", role="support", supports="e2")
    planted = [
        Planted("e1", "e2", "real", -0.35, mover="e2", good_fix=Fix("e2", dz=0.4), fitting_openings=["o1"]),
        Planted("e5", "e2", "by_design", 0.0),
        Planted("e1", "e3", "not_touching", 0.35),
    ]
    return Scene(seed=1, elements=[beam, duct, pipe, bracket], planted=planted)


# --- geom -----------------------------------------------------------------------------------------------------------

def test_box_box_overlap_gap_touch():
    a = box("a", (0, 0, 0), (1, 1, 1))
    assert geom.distance(a, box("b", (0.8, 0.2, 0.2), (2, 0.5, 0.5))) == pytest.approx(-0.2)
    assert geom.distance(a, box("b", (1.3, 0, 0), (2, 1, 1))) == pytest.approx(0.3)
    assert geom.distance(a, box("b", (1.3, 1.4, 0), (2, 2, 1))) == pytest.approx(0.5)     # diagonal 0.3, 0.4
    assert geom.distance(a, box("b", (1.0, 0, 0), (2, 1, 1))) == pytest.approx(0.0)
    # contained: least translation to clear, not the overlap length
    assert geom.distance(a, box("b", (0.1, 0.1, 0.1), (0.3, 0.9, 0.9))) == pytest.approx(-0.3)


def test_box_cylinder():
    pipe = cyl("p", (0, 0, 0), (1, 0, 0), 0.1)                         # along X, centre y=0 z=0
    assert geom.distance(pipe, box("b", (0.2, -1, 0.15), (0.4, 1, 0.3))) == pytest.approx(0.05)
    assert geom.distance(pipe, box("b", (0.2, -1, 0.07), (0.4, 1, 0.3))) == pytest.approx(-0.03)
    corner = box("b", (0.2, 0.2, 0.2), (0.4, 1, 1))
    assert geom.distance(pipe, corner) == pytest.approx(math.hypot(0.2, 0.2) - 0.1)
    beyond = box("b", (1.3, 0.2, 0.2), (2, 1, 1))                      # past the end and off the corner
    assert geom.distance(pipe, beyond) == pytest.approx(math.hypot(0.3, math.hypot(0.2, 0.2) - 0.1))
    assert geom.distance(pipe, box("b", (0.2, -1, 0.1), (0.4, 1, 0.3))) == pytest.approx(0.0)


def test_cylinder_cylinder():
    a = cyl("a", (0, 0, 0), (2, 0, 0), 0.1)
    assert geom.distance(a, cyl("b", (0, 0.5, 0), (2, 0.5, 0), 0.1)) == pytest.approx(0.3)
    assert geom.distance(a, cyl("b", (0, 0.15, 0), (2, 0.15, 0), 0.1)) == pytest.approx(-0.05)
    # crossing in plan at different heights: exact
    assert geom.distance(a, cyl("b", (1, -1, 0.3), (1, 1, 0.3), 0.05)) == pytest.approx(0.15)
    assert geom.distance(a, cyl("b", (1, -1, 0.1), (1, 1, 0.1), 0.05)) == pytest.approx(-0.05)


def test_moved_moves_openings():
    s = scene()
    beam = geom.moved(s.element("e1"), Fix("e1", dx=1, dz=-1))
    assert beam.min == (1, -0.1, 1.6) and beam.openings[0].min == (2.0, -0.15, 1.62)
    pipe = geom.moved(s.element("e3"), Fix("e3", dy=0.5))
    assert pipe.start == (3.0, -1.5, 2.2) and pipe.end == (3.0, 2.5, 2.2)


def test_beam_minus_opening_pieces():
    beam = scene().element("e1")
    ps = geom.pieces(beam)
    vol = sum(np.prod(np.subtract(p.hi, p.lo)) for p in ps)
    assert vol == pytest.approx(6 * 0.2 * 0.4 - 0.5 * 0.2 * 0.36)
    assert len(ps) <= 4


@pytest.mark.parametrize("r, expect", [(0.1, 0.08), (0.17, 0.01), (0.2, -0.4)])
def test_cylinder_through_opening(r, expect):
    s = scene()
    beam, op = s.element("e1"), s.element("e1").openings[0]
    pipe = cyl("p", (1.25, -2, 2.8), (1.25, 2, 2.8), r)
    assert geom.distance(pipe, beam) == pytest.approx(expect)
    assert geom.passes_through(pipe, beam, op)
    assert geom.fits(pipe, op, 0.025, axis=geom.through_axis(op, beam)) == (expect >= 0.025)
    # 20 mm into the web above and below, but too big for the opening: clearing it means leaving the beam (0.4 m)
    # the same pipe through the solid web
    solid = cyl("p", (3.0, -2, 2.8), (3.0, 2, 2.8), r)
    assert geom.distance(solid, beam) < -0.1
    assert not geom.passes_through(solid, beam, op)


def test_fits_box_section():
    op = scene().element("e1").openings[0]          # 0.5 (x) by 0.36 (z), through along y
    duct = scene().element("e2")                    # 0.4 by 0.3
    assert geom.through_axis(op, scene().element("e1")) == 1
    assert geom.fits(duct, op, 0.025, axis=1)
    assert not geom.fits(duct, op, 0.04, axis=1)


# --- check_fix ------------------------------------------------------------------------------------------------------

def test_fix_passes():
    r = checker.check_fix(scene(), Fix("e2", dz=0.4))
    assert r["passed"], r
    assert r["clash_gone"] and r["min_clear_m"] == pytest.approx(0.05) and r["new_hits"] == []
    assert r["via_opening"] is None and r["reason"] == "ok"


def test_fix_too_small():
    r = checker.check_fix(scene(), Fix("e2", dz=0.36))
    assert not r["passed"] and r["clash_gone"]
    assert r["min_clear_m"] == pytest.approx(0.01)
    assert "clearance" in r["reason"]


def test_fix_not_enough_to_clear():
    r = checker.check_fix(scene(), Fix("e2", dz=0.2))
    assert not r["passed"] and not r["clash_gone"]


def test_fix_into_third_element():
    r = checker.check_fix(scene(), Fix("e2", dz=-0.45))
    assert not r["passed"] and r["clash_gone"]
    assert r["new_hits"] == ["e3"]
    assert r["min_clear_m"] == pytest.approx(-0.05)


def test_fix_via_opening():
    s = scene()
    r = checker.check_fix(s, Fix("e2", dx=-1.75, via_opening="o1"))
    assert r["passed"], r
    assert r["via_opening"] == "o1" and r["min_clear_m"] == pytest.approx(0.03)
    tight = checker.check_fix(s, Fix("e2", dx=-1.79, via_opening="o1"))
    assert not tight["passed"] and tight["clash_gone"] and tight["via_opening"] == "o1"
    lying = checker.check_fix(s, Fix("e2", dz=0.4, via_opening="o1"))
    assert not lying["passed"] and "opening" in lying["reason"]


def test_own_bracket_ignored_but_others_not():
    s = scene()
    # moving up leaves its own bracket behind (touching before): ignored
    assert checker.check_fix(s, Fix("e2", dz=0.4))["passed"]
    # a bracket above, where the duct lands 10 mm short of it: its own is ignored, someone else's is a new hit
    above = dict(kind="bracket", role="support")
    s.elements.append(box("e6", (2.75, 1.0, 3.36), (3.25, 1.1, 3.4), supports="e2", **above))
    assert checker.check_fix(s, Fix("e2", dz=0.4))["passed"]
    s.elements[-1] = box("e6", (2.75, 1.0, 3.36), (3.25, 1.1, 3.4), supports="e3", **above)
    r = checker.check_fix(s, Fix("e2", dz=0.4))
    assert not r["passed"] and r["new_hits"] == ["e6"] and r["min_clear_m"] == pytest.approx(0.01)


def test_moving_structure_fails():
    r = checker.check_fix(scene(), Fix("e1", dz=1.0))
    assert not r["passed"] and "structure" in r["reason"]


# --- jobs -----------------------------------------------------------------------------------------------------------

def test_j1_j2_j4_j5():
    s = scene()
    real, design, near = s.planted
    assert checker.check_j1(real, "real") and checker.check_j1(near, "Not touching")
    assert checker.check_j1(design, "by-design") and not checker.check_j1(real, "by_design")
    assert checker.check_j2(real, "e2") and not checker.check_j2(real, "e1")
    assert not checker.check_j2(near, "e1")
    assert checker.check_j4(real, "o1") and not checker.check_j4(real, "o2")
    assert checker.check_j4(Planted("e1", "e2", "real", -0.1, fitting_openings=[]), None)
    assert checker.check_j5(s, Fix("e2", dz=0.4), True)
    assert checker.check_j5(s, Fix("e2", dz=0.36), False)
    assert not checker.check_j5(s, Fix("e2", dz=-0.45), True)


# --- engine crosscheck ----------------------------------------------------------------------------------------------

def _write_ifc(s: Scene, path) -> dict[str, str]:
    """A minimal metre IFC of the scene: boxes as rectangle extrusions, cylinders as circle extrusions, openings as
    IfcOpeningElement voids. Returns element id -> GlobalId."""
    import ifcopenshell
    import ifcopenshell.api
    from iris.fixtures import _box

    run = ifcopenshell.api.run
    model = run("project.create_file", version="IFC4")
    project = run("root.create_entity", model, ifc_class="IfcProject", name="bench")
    run("unit.assign_unit", model, units=[run("unit.add_si_unit", model, unit_type="LENGTHUNIT")])
    ctx = run("context.add_context", model, context_type="Model")
    body = run("context.add_context", model, context_type="Model", context_identifier="Body",
               target_view="MODEL_VIEW", parent=ctx)
    storey = run("root.create_entity", model, ifc_class="IfcBuildingStorey", name="L1")
    run("aggregate.assign_object", model, relating_object=project, products=[storey])
    classes = {"beam": "IfcBeam", "duct": "IfcDuctSegment", "pipe": "IfcPipeSegment", "bracket": "IfcMember",
               "column": "IfcColumn", "slab": "IfcSlab", "tray": "IfcCableCarrierSegment"}
    ids = {}
    for e in s.elements:
        p = run("root.create_entity", model, ifc_class=classes[e.kind], name=e.id)
        run("spatial.assign_container", model, relating_structure=storey, products=[p])
        if e.shape == "box":
            _box(model, body, p, tuple(np.subtract(e.max, e.min)), tuple(e.min))
        else:
            run("geometry.edit_object_placement", model, product=p)
            start, end = np.asarray(e.start, float), np.asarray(e.end, float)
            d = (end - start) / np.linalg.norm(end - start)
            x = np.cross([0.0, 0.0, 1.0], d)
            x /= np.linalg.norm(x)
            pos = model.createIfcAxis2Placement3D(model.createIfcCartesianPoint(tuple(map(float, start))),
                                                  model.createIfcDirection(tuple(map(float, d))),
                                                  model.createIfcDirection(tuple(map(float, x))))
            solid = model.createIfcExtrudedAreaSolid(model.createIfcCircleProfileDef("AREA", None, None, e.radius),
                                                     pos, model.createIfcDirection((0.0, 0.0, 1.0)),
                                                     float(np.linalg.norm(end - start)))
            p.Representation = model.createIfcProductDefinitionShape(
                None, None, [model.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])])
        for o in e.openings:
            op = run("root.create_entity", model, ifc_class="IfcOpeningElement", name=o.id)
            _box(model, body, op, tuple(np.subtract(o.max, o.min)), tuple(o.min))
            run("feature.add_feature", model, feature=op, element=p)
        ids[e.id] = p.GlobalId
    model.write(str(path))
    return ids


def test_engine_crosscheck(tmp_path):
    pytest.importorskip("ifcopenshell")
    s = scene()
    # Box-on-box pairs off to the side, where the engine is exact: a duct 100 mm into a column, a duct 200 mm clear.
    s.elements += [box("e7", (0, 5, 2.0), (2, 5.4, 2.3)),
                   box("e8", (1.0, 5.1, 0), (1.2, 5.3, 2.1), kind="column", role="structure"),
                   box("e9", (0, 6.0, 2.0), (2, 6.4, 2.3))]
    s.planted += [Planted("e8", "e7", "real", -0.1, mover="e7", good_fix=Fix("e7", dz=0.15)),
                  Planted("e7", "e9", "not_touching", 0.6), Planted("e8", "e9", "not_touching", 0.7)]
    assert geom.distance(s.element("e8"), s.element("e7")) == pytest.approx(-0.1)
    ids = _write_ifc(s, tmp_path / "scene.ifc")
    (tmp_path / "ids.json").write_text(json.dumps(ids))
    fixes = [Fix("e2", dz=0.36), Fix("e2", dz=-0.45), Fix("e2", dx=-1.75), Fix("e2", dx=-1.79), Fix("e2", dz=0.2),
             Fix("e7", dz=0.11), Fix("e7", dz=0.05), Fix("e7", dy=0.38)]
    r = checker.crosscheck_engine(s, tmp_path / "scene.ifc", tmp_path / "ids.json", fixes=fixes)
    assert r["pairs"] == 6 and r["fixes"] == 10
    assert r["agree"] == r["pairs"] and r["fixes_agree"] == r["fixes"], r["disagreements"]
    # the duct through the cut web: the engine's depth is an estimate there, and it is noted
    assert any(n["what"] == "pair" and n["b"] == "e2" for n in r["notes"])
