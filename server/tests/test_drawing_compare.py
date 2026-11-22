"""Drawing ↔ model comparison (drawing_compare.py, docs/drawings.md): model data only, never AI. Items are hand-made
here, as the reader would give them, and compared with a tiny model built below and with the Northbank sample."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import pytest

from iris import drawing_compare as dc
from iris.fixtures import build_mep_fixture
from iris.scene import IfcScene

SAMPLES = Path(__file__).resolve().parents[2] / "samples"


def build_drawing_fixture(path: Path, millimetres: bool = False) -> Path:
    """Level 02 services a plan would tag, and a few it would not:

    - SA-MAIN-L02-5, a supply duct 600 x 300 in the "Supply air" system; SA-BR-L02-3, a branch 300 x 200 no item shows;
      SA-BR-L02-4 split in two pieces that keep the tag.
    - CW-MAIN-L02-2, a pipe Ø150; HW-L02-1, a pipe Ø28 no item shows.
    - LV-TRAY-L02-1, a cable tray 300 x 100 drawn as a U channel.
    - A duct with no Tag, named "Extract duct ED-7 400x200"; a duct whose only identifier is a Mark (EX-9) in a set.
    - Two tees tagged T1 (fittings, a tag they share); a diffuser SD-L02-1 (face 595 x 595, neck 450 x 450).
    - On Level 03: SA-MAIN-L03-1, outside the drawing's storey. On the roof: AHU-01.
    """
    k = 1000.0 if millimetres else 1.0
    model = ifcopenshell.api.run("project.create_file", version="IFC4")
    project = ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcProject", name="Iris drawing fixture")
    length = ifcopenshell.api.run("unit.add_si_unit", model, unit_type="LENGTHUNIT",
                                  prefix="MILLI" if millimetres else None)
    ifcopenshell.api.run("unit.assign_unit", model, units=[length])
    ctx = ifcopenshell.api.run("context.add_context", model, context_type="Model")
    body = ifcopenshell.api.run("context.add_context", model, context_type="Model", context_identifier="Body",
                                target_view="MODEL_VIEW", parent=ctx)
    storeys = {}
    for name in ("Level 02", "Level 03", "Roof"):
        storeys[name] = ifcopenshell.api.run("root.create_entity", model, ifc_class="IfcBuildingStorey", name=name)
        ifcopenshell.api.run("aggregate.assign_object", model, relating_object=project, products=[storeys[name]])
    supply = ifcopenshell.api.run("system.add_system", model, ifc_class="IfcDistributionSystem")
    supply.Name = "Supply air"

    def rect(w, h):
        return model.createIfcRectangleProfileDef("AREA", None, None, w * k, h * k)

    def circle(d):
        return model.createIfcCircleProfileDef("AREA", None, None, d * k / 2)

    def element(cls, name, tag=None, profiles=(), storey="Level 02"):
        e = ifcopenshell.api.run("root.create_entity", model, ifc_class=cls, name=name)
        e.Tag = tag
        ifcopenshell.api.run("spatial.assign_container", model, relating_structure=storeys[storey], products=[e])
        ifcopenshell.api.run("geometry.edit_object_placement", model, product=e)
        position = model.createIfcAxis2Placement3D(model.createIfcCartesianPoint((0.0, 0.0, 0.0)))
        solids = [model.createIfcExtrudedAreaSolid(p, position, model.createIfcDirection((0.0, 0.0, 1.0)), 1.0 * k)
                  for p in profiles]
        if solids:
            e.Representation = model.createIfcProductDefinitionShape(
                None, None, [model.createIfcShapeRepresentation(body, "Body", "SweptSolid", solids)])
        return e

    main = element("IfcDuctSegment", "Supply air main L02 600x300", "SA-MAIN-L02-5", [rect(0.6, 0.3)])
    branch = element("IfcDuctSegment", "Supply branch 300x200", "SA-BR-L02-3", [rect(0.3, 0.2)])
    piece_a = element("IfcDuctSegment", "Supply branch 250x200", "SA-BR-L02-4", [rect(0.25, 0.2)])
    piece_b = element("IfcDuctSegment", "Supply branch 250x200", "SA-BR-L02-4", [rect(0.25, 0.2)])
    ifcopenshell.api.run("group.assign_group", model, products=[main, branch, piece_a, piece_b], group=supply)
    element("IfcPipeSegment", "Cold water main L02 DN150", "CW-MAIN-L02-2", [circle(0.15)])
    element("IfcPipeSegment", "Heating flow L02 DN28", "HW-L02-1", [circle(0.028)])
    tray = model.createIfcUShapeProfileDef("AREA", None, None, 0.3 * k, 0.1 * k, 0.004 * k, 0.004 * k)
    element("IfcCableCarrierSegment", "Cable tray L02 300x100", "LV-TRAY-L02-1", [tray])
    element("IfcDuctSegment", "Extract duct ED-7 400x200", None, [rect(0.4, 0.2)])
    marked = element("IfcDuctSegment", "Extract duct 400x200", None, [rect(0.4, 0.2)])
    pset = ifcopenshell.api.run("pset.add_pset", model, product=marked, name="Pset_Identity")
    ifcopenshell.api.run("pset.edit_pset", model, pset=pset, properties={"Mark": "EX-9"})
    element("IfcDuctFitting", "Supply tee 600x300/300x200", "T1", [rect(0.6, 0.3), rect(0.3, 0.2)])
    element("IfcDuctFitting", "Supply tee 600x300/300x200", "T1", [rect(0.6, 0.3), rect(0.3, 0.2)])
    element("IfcAirTerminal", "Supply diffuser 600x600", "SD-L02-1", [rect(0.595, 0.595), rect(0.45, 0.45)])
    element("IfcDuctSegment", "Supply air main L03 600x300", "SA-MAIN-L03-1", [rect(0.6, 0.3)], storey="Level 03")
    element("IfcUnitaryEquipment", "Air handling unit AHU-01", "AHU-01", [rect(4.0, 2.2)], storey="Roof")
    path.parent.mkdir(parents=True, exist_ok=True)
    model.write(str(path))
    return path


@pytest.fixture(scope="module")
def scene(tmp_path_factory) -> IfcScene:
    return IfcScene(build_drawing_fixture(tmp_path_factory.mktemp("drawing") / "services.ifc"))


@pytest.fixture(scope="module")
def index(scene):
    return dc.model_index(scene)


def gid(index, tag):
    return next(m.global_id for m in index if m.tag == tag)


def by_name(index, name):
    return next(m for m in index if m.name == name)


def item(id, tag, kind="duct", size=None, size_mm=None, status="confirmed"):
    return {"id": id, "page": 0, "tag": tag, "kind": kind, "size": size,
            "size_mm": size_mm if size_mm is not None else dc.parse_size(size), "box": [0, 0, 10, 10],
            "source": "ai", "status": status, "evidence": {}}


# The reader's Item has these fields (docs/drawings.md); compare takes it or a dict alike.
@dataclass
class Item:
    id: str
    page: int
    tag: str | None
    kind: str
    size: str | None
    size_mm: list[float] | None
    box: list[float]
    source: str
    status: str
    evidence: dict = field(default_factory=dict)


def kinds(result, of=None):
    return sorted((m.kind, m.item, m.element) for m in result["mismatches"] if of is None or m.kind == of)


# ---------------------------------------------------------------------------------------------------- the model


@pytest.mark.parametrize("millimetres", [False, True])
def test_the_index_reads_family_identifiers_size_and_storey(tmp_path, millimetres):
    index = dc.model_index(IfcScene(build_drawing_fixture(tmp_path / "m.ifc", millimetres)))
    main = next(m for m in index if m.tag == "SA-MAIN-L02-5")
    assert (main.kind, main.part, main.shape, main.size_mm, main.size, main.storey) == (
        "duct", "segment", "rect", [600.0, 300.0], "600x300", "Level 02")
    assert main.tag_field == "Tag" and main.systems == ["Supply air"]
    assert [i["field"] for i in main.identifiers] == ["Tag", "Name", "System"]
    pipe = next(m for m in index if m.tag == "CW-MAIN-L02-2")
    assert (pipe.kind, pipe.shape, pipe.size_mm, pipe.size) == ("pipe", "round", [150.0], "Ø150")
    tray = next(m for m in index if m.tag == "LV-TRAY-L02-1")
    assert (tray.kind, tray.shape, tray.size_mm) == ("tray", "rect", [300.0, 100.0])
    diffuser = next(m for m in index if m.tag == "SD-L02-1")
    assert (diffuser.kind, diffuser.part, diffuser.size_mm) == ("diffuser", "terminal", [595.0, 595.0])
    ahu = next(m for m in index if m.tag == "AHU-01")
    assert (ahu.kind, ahu.part, ahu.size_mm, ahu.storey) == ("unit", "equipment", None, "Roof")
    marked = by_name(index, "Extract duct 400x200")
    assert (marked.tag, marked.tag_field) == ("EX-9", "Pset_Identity.Mark")


def test_a_shared_tag_is_no_element_s_own(index):
    tees = [m for m in index if m.part == "fitting"]
    assert len(tees) == 2 and all(m.tag is None and m.identifiers[0]["value"] == "T1" for m in tees)
    assert all(m.tag is None for m in index if m.name == "Supply branch 250x200")   # the split pieces share theirs
    assert by_name(index, "Extract duct ED-7 400x200").tag is None                   # a Name is not a tag


def test_an_ifc2x3_flow_segment_takes_its_family_from_its_type(tmp_path):
    index = dc.model_index(IfcScene(build_mep_fixture(tmp_path / "mep.ifc", schema="IFC2X3")))
    got = {m.name: (m.ifc_class, m.kind, m.part, m.size_mm) for m in index}
    assert got["DA"] == ("IfcFlowSegment", "duct", "segment", [400.0, 300.0])
    assert got["PA"] == ("IfcFlowSegment", "pipe", "segment", [100.0])


@pytest.mark.parametrize("text, mm", [
    ("600x300", [600, 300]), ("600 × 300 mm", [600, 300]), ("600X300", [600, 300]), ("Ø150", [150]),
    ("150ø", [150]), ("DN54", [54]), ("D100", [100]), ("150 dia", [150]), ("600x400/600x300", [600, 400]),
    ("AHU-01", None), (None, None), ("", None)])
def test_size_labels_parse_to_millimetres(text, mm):
    assert dc.parse_size(text) == mm


def test_sizes_format_and_identifiers_normalise():
    assert (dc.format_size([600.0, 300.0]), dc.format_size([150.0]), dc.format_size([54.5])) == ("600x300", "Ø150", "Ø54.5")
    assert dc.norm("sa main l02 5") == dc.norm("SA-MAIN-L02-5") == dc.norm("Sa_Main L02-5") == "SAMAINL025"
    assert dc.same_storey("Level 02", "L02") and dc.same_storey("level 2", "Level 02")
    assert not dc.same_storey("Level 02", "Level 03") and not dc.same_storey("B1", "L1")


# ---------------------------------------------------------------------------------------------------- matching


def test_an_exact_tag_matches_whatever_its_case_spaces_and_dashes(scene, index):
    result = dc.compare(scene, [item("a", "sa main l02 5", size="600x300")], storey="Level 02", index=index)
    [m] = result["matches"]
    assert (m["item"], m["element"], m["by"], m["score"]) == ("a", gid(index, "SA-MAIN-L02-5"), "tag", 1.0)
    assert m["evidence"]["identifier"] == "SA-MAIN-L02-5" and m["evidence"]["field"] == "Tag"
    assert not [x for x in result["mismatches"] if x.item == "a"]


def test_a_tag_in_the_name_matches_when_no_identifier_does(scene, index):
    result = dc.compare(scene, [item("a", "ED 7", size="400x200")], storey="Level 02", index=index)
    [m] = result["matches"]
    assert (m["element"], m["by"], m["score"]) == (by_name(index, "Extract duct ED-7 400x200").global_id, "name_token", 0.75)
    assert not [x for x in result["mismatches"] if x.item == "a"]
    # whole words only, and never a size or a tag without a digit
    for tag in ("ED-71", "D-7", "400x200", "Extract"):
        got = dc.compare(scene, [item("b", tag)], storey="Level 02", index=index)
        assert not got["matches"] and kinds(got, "missing_in_model") == [("missing_in_model", "b", None)], tag


def test_a_mark_in_a_property_set_matches(scene, index):
    result = dc.compare(scene, [item("a", "EX9", size="400x200")], storey="Level 02", index=index)
    [m] = result["matches"]
    assert (m["by"], m["evidence"]["field"], m["element"]) == (
        "pset", "Pset_Identity.Mark", by_name(index, "Extract duct 400x200").global_id)


def test_the_reader_s_items_compare_like_dicts(scene, index):
    it = Item("a", 0, "CW-MAIN-L02-2", "pipe", "Ø150", [150.0], [0, 0, 1, 1], "text", "confirmed")
    result = dc.compare(scene, [it], storey="Level 02", index=index)
    assert result["matches"][0]["element"] == gid(index, "CW-MAIN-L02-2")
    assert not [x for x in result["mismatches"] if x.item == "a"]


def test_a_split_run_matches_once_and_every_piece_counts_as_shown(scene, index):
    result = dc.compare(scene, [item("a", "SA-BR-L02-4", size="250x200")], storey="Level 02", index=index)
    [m] = result["matches"]
    assert len(m["evidence"]["candidates"]) == 2 and m["score"] == 0.8
    pieces = {x.global_id for x in index if x.name == "Supply branch 250x200"}
    assert not [x for x in result["mismatches"] if x.element in pieces]


# ---------------------------------------------------------------------------------------------------- mismatches


def test_a_size_that_differs_says_both_and_the_tolerance(scene, index):
    result = dc.compare(scene, [item("a", "SA-MAIN-L02-5", size="600x250")], storey="Level 02", index=index)
    [mm] = [x for x in result["mismatches"] if x.item == "a"]
    assert (mm.kind, mm.element, mm.drawing_value, mm.model_value) == (
        "size_differs", gid(index, "SA-MAIN-L02-5"), "600x250", "600x300")
    ev = mm.evidence
    assert (ev["drawing_mm"], ev["model_mm"], ev["delta_mm"], ev["tolerance_mm"]) == (
        [600.0, 250.0], [600.0, 300.0], [0.0, 50.0], [12.0, 6.0])
    assert ev["by"] == "tag" and ev["identifier"] == "SA-MAIN-L02-5" and ev["unconfirmed"] is False


def test_width_and_depth_compare_in_either_order(scene, index):
    result = dc.compare(scene, [item("a", "SA-MAIN-L02-5", size="300x600"),
                                item("b", "LV-TRAY-L02-1", kind="tray", size="100x300")], storey="Level 02", index=index)
    assert not [x for x in result["mismatches"] if x.item in ("a", "b")]


@pytest.mark.parametrize("tag, size_mm, differs", [
    ("SA-MAIN-L02-5", [612, 300], False),      # 2% of 600 is 12 mm
    ("SA-MAIN-L02-5", [612.5, 300], True),
    ("SA-MAIN-L02-5", [600, 306], False),      # 2% of 300 is 6 mm
    ("SA-MAIN-L02-5", [600, 307], True),
    ("CW-MAIN-L02-2", [155], False),           # 2% of 150 is 3 mm: 5 mm holds
    ("CW-MAIN-L02-2", [145], False),
    ("CW-MAIN-L02-2", [155.5], True),
    ("HW-L02-1", [33], False),                 # Ø28: 5 mm
    ("HW-L02-1", [22], True),
])
def test_the_tolerance_is_the_larger_of_5_mm_and_2_percent(scene, index, tag, size_mm, differs):
    kind = "duct" if tag.startswith("SA") else "pipe"
    result = dc.compare(scene, [item("a", tag, kind=kind, size_mm=size_mm)], storey="Level 02", index=index)
    got = [x.kind for x in result["mismatches"] if x.item == "a"]
    assert got == (["size_differs"] if differs else [])


def test_round_against_rectangular_is_a_type_difference(scene, index):
    result = dc.compare(scene, [item("a", "SA-MAIN-L02-5", size="Ø600"),
                                item("b", "CW-MAIN-L02-2", kind="pipe", size="150x150")], storey="Level 02", index=index)
    got = {x.item: x for x in result["mismatches"] if x.item in ("a", "b")}
    assert {k: (x.kind, x.evidence["reason"]) for k, x in got.items()} == {
        "a": ("type_differs", ["shape"]), "b": ("type_differs", ["shape"])}
    assert (got["a"].drawing_value, got["a"].model_value) == ("Ø600", "600x300")
    assert (got["a"].evidence["drawing_shape"], got["a"].evidence["model_shape"]) == ("round", "rect")


def test_a_different_family_is_a_type_difference(scene, index):
    result = dc.compare(scene, [item("a", "CW-MAIN-L02-2", kind="duct", size="Ø150"),
                                item("b", "AHU-01", kind="equipment"),           # unit and equipment agree
                                item("c", "SA-MAIN-L02-5", kind="other", size="600x300")], storey="Level 02", index=index)
    [mm] = [x for x in result["mismatches"] if x.item in ("a", "b", "c")]
    assert (mm.kind, mm.item, mm.drawing_value, mm.model_value, mm.evidence["reason"]) == (
        "type_differs", "a", "duct", "pipe", ["kind"])
    assert mm.evidence["model_class"] == "IfcPipeSegment"


def test_a_pipe_drawn_as_a_rectangular_duct_is_one_type_difference_for_both_reasons(scene, index):
    result = dc.compare(scene, [item("a", "CW-MAIN-L02-2", kind="duct", size="150x100"),
                                item("b", "HW-L02-1", kind="duct", size="Ø100")],   # round, but 100 against Ø28
                        storey="Level 02", index=index)
    got = [x for x in result["mismatches"] if x.item in ("a", "b")]
    assert sorted((x.item, x.kind) for x in got) == [("a", "type_differs"), ("b", "type_differs")]
    a, b = sorted(got, key=lambda x: x.item)
    assert (a.element, a.drawing_value, a.model_value, a.evidence["reason"]) == (
        gid(index, "CW-MAIN-L02-2"), "duct", "pipe", ["kind", "shape"])
    ev = a.evidence
    assert (ev["drawing_kind"], ev["model_kind"], ev["model_class"]) == ("duct", "pipe", "IfcPipeSegment")
    assert (ev["drawing_shape"], ev["model_shape"], ev["drawing_size"], ev["model_size"]) == (
        "rect", "round", "150x100", "Ø150")
    assert ev["by"] == "tag" and ev["identifier"] == "CW-MAIN-L02-2"
    # sizes are not compared across types: the family alone differs, its numbers kept as evidence
    assert (b.evidence["reason"], b.evidence["drawing_mm"], b.evidence["model_mm"]) == (["kind"], [100.0], [28.0])


def test_a_tag_no_element_has_is_missing_in_the_model(scene, index):
    result = dc.compare(scene, [item("a", "FCU-99", kind="unit", size="600x600")], storey="Level 02", index=index)
    assert not result["matches"]
    [mm] = [x for x in result["mismatches"] if x.item == "a"]
    assert (mm.kind, mm.element, mm.drawing_value, mm.model_value) == ("missing_in_model", None, "FCU-99", None)
    assert mm.evidence["drawing_size"] == "600x600"


def test_an_item_without_a_tag_is_left_unmatched(scene, index):
    result = dc.compare(scene, [item("a", None, size="600x300")], storey="Level 02", index=index)
    assert result["unmatched"] == [{"item": "a", "why": "no tag"}]
    assert not [x for x in result["mismatches"] if x.item == "a"]


DRAWING = [item("1", "SA-MAIN-L02-5", size="600x300"), item("2", "CW-MAIN-L02-2", kind="pipe", size="Ø150"),
           item("3", "LV-TRAY-L02-1", kind="tray", size="300x100")]


def test_what_the_drawing_leaves_out_is_reported_on_its_storey_only(scene, index):
    result = dc.compare(scene, DRAWING, storey="Level 02", index=index)
    assert kinds(result, "missing_in_drawing") == sorted(
        ("missing_in_drawing", None, gid(index, t)) for t in ("SA-BR-L02-3", "HW-L02-1", "EX-9"))
    [branch] = [x for x in result["mismatches"] if x.element == gid(index, "SA-BR-L02-3")]
    assert (branch.model_value, branch.evidence["field"], branch.evidence["storey"]) == ("SA-BR-L02-3", "Tag", "Level 02")
    # the duct known by its Mark is one; never: the Level 03 main, the roof AHU, the tees (fittings, a shared tag), the
    # diffuser (the drawing shows none), the split pieces (a shared tag), the duct known only by its Name
    assert result["scope"] == {"storey": "Level 02", "inferred": False, "kinds": ["duct", "pipe", "tray"],
                               "parts": ["segment", "terminal", "equipment"], "checked": True}


def test_only_the_families_the_drawing_shows_are_missing_from_it(scene, index):
    result = dc.compare(scene, DRAWING[:1], storey="L02", index=index)    # a ductwork plan
    assert kinds(result, "missing_in_drawing") == sorted(
        ("missing_in_drawing", None, gid(index, t)) for t in ("SA-BR-L02-3", "EX-9"))


def test_the_storey_comes_from_the_matches_when_not_given(scene, index):
    result = dc.compare(scene, DRAWING, index=index)
    assert (result["scope"]["storey"], result["scope"]["inferred"]) == ("Level 02", True)
    assert {x.element for x in result["mismatches"] if x.kind == "missing_in_drawing"} == {
        gid(index, t) for t in ("SA-BR-L02-3", "HW-L02-1", "EX-9")}
    nothing = dc.compare(scene, [item("a", "FCU-99")], index=index)
    assert not nothing["scope"]["checked"] and not kinds(nothing, "missing_in_drawing")


def test_another_storey_s_element_still_matches_by_its_tag_and_says_so(scene, index):
    result = dc.compare(scene, [item("a", "SA-MAIN-L03-1", size="600x300")], storey="Level 02", index=index)
    [m] = result["matches"]
    assert m["element"] == gid(index, "SA-MAIN-L03-1") and m["evidence"]["model_storey"] == "Level 03"


def test_an_item_only_the_ai_read_is_compared_but_flagged_unconfirmed(scene, index):
    result = dc.compare(scene, [item("a", "SA-MAIN-L02-5", size="600x250", status="ai_only"),
                                item("b", "FCU-99", status="ai_only"),
                                item("c", "CW-MAIN-L02-2", kind="pipe", size="Ø100", status="confirmed")],
                        storey="Level 02", index=index)
    got = {x.item: (x.kind, x.evidence["unconfirmed"]) for x in result["mismatches"] if x.item}
    assert got == {"a": ("size_differs", True), "b": ("missing_in_model", True), "c": ("size_differs", False)}
    assert next(m for m in result["matches"] if m["item"] == "a")["evidence"]["unconfirmed"] is True


def test_the_result_is_json(scene, index):
    import json
    out = dc.to_json(dc.compare(scene, DRAWING + [item("x", "SA-MAIN-L02-5", size="600x250")], index=index))
    assert json.loads(json.dumps(out))["mismatches"][0]["kind"] in ("size_differs", "missing_in_drawing")


# ---------------------------------------------------------------------------------------------------- Northbank


@pytest.fixture(scope="module")
def northbank():
    if not (SAMPLES / "Northbank-MEP.ifc").exists():
        pytest.skip("the Northbank sample is not here")
    scene = IfcScene(SAMPLES / "Northbank-MEP.ifc")
    return scene, dc.model_index(scene)


@pytest.mark.parametrize("stem", ["Northbank-M-201", "Northbank-M-201-mismatch"])
def test_the_sample_sheets_give_exactly_their_planted_mismatches_one_each(northbank, stem):
    import json
    path = SAMPLES / "drawings" / f"{stem}.truth.json"
    if not path.exists():
        pytest.skip("samples/drawings/ not generated")
    truth = json.loads(path.read_text(encoding="utf-8"))
    scene, index = northbank
    result = dc.compare(scene, truth["items"], storey=truth["storey"], index=index)
    got = sorted((m.kind, m.item, m.element, m.drawing_value, m.model_value) for m in result["mismatches"])
    assert got == sorted((m["kind"], m["item"], m["element"], m["drawing_value"], m["model_value"])
                         for m in truth["mismatches"])
    assert len(got) == (4 if stem.endswith("mismatch") else 0)
    reasons = [m.evidence["reason"] for m in result["mismatches"] if m.kind == "type_differs"]
    assert reasons == ([["kind", "shape"]] if got else [])


def test_northbank_services_carry_their_tags_and_sections(northbank):
    scene, index = northbank
    got = {m.global_id: (m.tag, m.kind, m.size, m.storey) for m in index}
    assert got["2AbvqKF25LGeR0M34N_jld"] == ("SA-MAIN-L02-5", "duct", "600x300", "Level 02")
    assert got["3tQ7zxxRDMefPXL6hbHmO2"] == ("LV-TRAY-L02-1", "tray", "300x100", "Level 02")
    assert got["1RHD_I4ibLDuUhW1LBAckc"] == ("CW-MAIN-L02-2", "pipe", "Ø54", "Level 02")
    level = dc.coverage(index, "Level 02")
    runs = {k: v for k, v in level["by"].items() if k.endswith("/segment")}
    assert all(v["tagged_and_sized"] == v["elements"] for v in runs.values())   # every run: own tag and section
    # a plan drawn from the model itself matches all of it, and finds nothing missing
    drawn = [{"id": str(n), "tag": m.tag, "kind": m.kind, "size": m.size, "status": "confirmed"}
             for n, m in enumerate(m for m in index if m.storey == "Level 02" and m.tag
                                   and m.part in dc.REPORTED_PARTS and m.kind != "other")]
    result = dc.compare(scene, drawn, storey="Level 02", index=index)
    assert len(result["matches"]) == len(drawn) > 100 and not result["mismatches"]
    # the answer key's duct drawn 600 x 250 differs by 50 mm
    at = next(n for n, d in enumerate(drawn) if d["tag"] == "SA-MAIN-L02-5")
    drawn[at] = {**drawn[at], "size": "600x250"}
    changed = dc.compare(scene, drawn, storey="Level 02", index=index)
    assert [(x.kind, x.element, x.drawing_value, x.model_value) for x in changed["mismatches"]] == [
        ("size_differs", "2AbvqKF25LGeR0M34N_jld", "600x250", "600x300")]
