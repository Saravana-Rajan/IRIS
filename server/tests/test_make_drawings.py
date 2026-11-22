"""The sample MEP drawings (evals/make_drawings.py, docs/drawings.md "Sample data") say exactly what their truth says.

Generated from the Northbank sample in `samples/` into a temporary folder: the PDF opens, every truth tag and size is in
the text layer inside its box, the clean sheet agrees with the model (and with `drawing_compare`), the mismatch sheet
differs from it by exactly the planted list, the output is byte-for-byte deterministic, and `samples/drawings/` holds
what the generator writes today.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "evals" / "make_drawings.py"
SAMPLES = ROOT / "samples"
MODELS = ("Northbank-Structure.ifc", "Northbank-MEP.ifc", "Northbank-Grids.ifc")

pytestmark = pytest.mark.skipif(not all((SAMPLES / m).exists() for m in MODELS),
                                reason="the Northbank sample models are not in samples/")


def _load():
    spec = importlib.util.spec_from_file_location("make_drawings", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["make_drawings"] = mod   # dataclasses resolve their module by name
    spec.loader.exec_module(mod)
    return mod


md = _load()
PX = md.DPI / 72.0   # PDF points → pixels at the truth's dpi


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("drawings")
    paths = md.build(out)
    pdfs = {p.stem: p for p in paths if p.suffix == ".pdf"}
    truths = {p.name.removesuffix(".truth.json"): json.loads(p.read_text(encoding="utf-8"))
              for p in paths if p.name.endswith(".truth.json")}
    return out, pdfs, truths


@pytest.fixture(scope="module")
def scene():
    from iris.scene import IfcScene
    return IfcScene([SAMPLES / m for m in MODELS])


def _words(pdf: Path, **kw):
    import pdfplumber
    with pdfplumber.open(pdf) as doc:
        page = doc.pages[0]
        return [{**w, "px": [w["x0"] * PX, w["top"] * PX, w["x1"] * PX, w["bottom"] * PX]}
                for w in page.extract_words(**kw)]


def _centre_in(b, box, slack=1.0) -> bool:
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return box[0] - slack <= cx <= box[2] + slack and box[1] - slack <= cy <= box[3] + slack


def _iou(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / area if area else 0.0


def test_writes_a_clean_and_a_mismatch_sheet_small(built):
    out, pdfs, truths = built
    assert set(pdfs) == {"Northbank-M-201", "Northbank-M-201-mismatch"}
    assert set(truths) == set(pdfs)
    assert sum(p.stat().st_size for p in out.iterdir()) < 3 * 1024 * 1024


@pytest.mark.parametrize("flow", [False, True], ids=["by-line", "text-flow"])
def test_every_truth_tag_and_size_is_in_the_text_layer_inside_its_box(built, flow):
    """Both ways pdfplumber groups characters into words (by line height, or in the PDF's own order) give every tag
    and size whole, inside its truth box."""
    _, pdfs, truths = built
    for stem, pdf in pdfs.items():
        words = _words(pdf, use_text_flow=flow)
        truth = truths[stem]
        assert truth["items"], stem
        for item in truth["items"]:
            for field, box_field in (("tag", "tag_box"), ("size", "size_box")):
                text = item[field]
                if text is None:
                    continue
                box = item[box_field]
                hits = [w for w in words if w["text"] == text and _centre_in(w["px"], box)]
                assert hits, f"{stem}: {field} {text!r} of {item['id']} is not in the text layer at {box}"
                assert max(_iou(w["px"], box) for w in hits) > 0.8, f"{stem}: {text!r} box is loose"
                assert _centre_in(hits[0]["px"], item["box"]), f"{stem}: {text!r} outside the item box"


def test_page_renders_at_the_truths_pixel_size(built):
    import pypdfium2 as pdfium
    _, pdfs, truths = built
    for stem, pdf in pdfs.items():
        doc = pdfium.PdfDocument(str(pdf))
        try:
            image = doc[0].render(scale=md.DPI / 72).to_pil()
        finally:
            doc.close()
        assert image.size == (truths[stem]["width_px"], truths[stem]["height_px"])


def test_title_block_is_in_the_text_layer(built):
    _, pdfs, truths = built
    words = {w["text"] for w in _words(pdfs["Northbank-M-201"])}
    tb = truths["Northbank-M-201"]["title_block"]
    for value in (tb["sheet"], tb["scale"], tb["level"], tb["title"], tb["project"], tb["maker"]):
        assert all(part in words for part in value.split()), value


def test_labels_do_not_overlap_and_stay_off_the_title_strip(built):
    _, _, truths = built
    for stem, truth in truths.items():
        labels = sorted({tuple(i["label_box"]) for i in truth["items"]})
        for i, a in enumerate(labels):
            for b in labels[i + 1:]:
                assert _iou(a, b) == 0.0, f"{stem}: labels overlap {a} {b}"
        strip = truth["title_block_box"]
        assert all(b[2] < strip[0] for b in labels), stem


def test_clean_sheet_is_the_model(built, scene):
    """Every tagged item is the model element it names, every segment on the storey is on the sheet."""
    _, _, truths = built
    clean = truths["Northbank-M-201"]
    assert clean["mismatches"] == []
    items = [i for i in clean["items"] if i["tag"]]
    for i in items:
        e = scene.element(i["gid"])
        assert e.tag == i["tag"] and e.storey == md.STOREY, i["id"]
        assert md.parse_size(md.model_size(scene.entity(i["gid"])))[0] == i["size"] or i["kind"] == "equipment"
    segments = {e.GlobalId for m in scene.models
                for cls in ("IfcDuctSegment", "IfcPipeSegment", "IfcCableCarrierSegment") for e in m.by_type(cls)
                if scene.element(e.GlobalId).storey == md.STOREY}
    assert segments <= {i["gid"] for i in items}
    assert set(clean["scope"]) == {i["gid"] for i in items}
    kinds = {}
    for i in clean["items"]:
        kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
    assert kinds == {"duct": 67, "pipe": 34, "tray": 5, "diffuser": 16, "equipment": 1}


def _diff(clean: dict, other: dict) -> set[tuple[str, str]]:
    a = {i["tag"]: i for i in clean["items"] if i["tag"]}
    b = {i["tag"]: i for i in other["items"] if i["tag"]}
    out = {("missing_in_drawing", t) for t in a.keys() - b.keys()}
    out |= {("missing_in_model", t) for t in b.keys() - a.keys()}
    for t in a.keys() & b.keys():
        if a[t]["kind"] != b[t]["kind"]:
            out.add(("type_differs", t))
        elif a[t]["size"] != b[t]["size"]:
            out.add(("size_differs", t))
    return out


def test_mismatch_sheet_differs_by_exactly_the_planted_list(built):
    _, _, truths = built
    clean, mism = truths["Northbank-M-201"], truths["Northbank-M-201-mismatch"]
    planted = {(m["kind"], m["tag"]) for m in mism["mismatches"]}
    assert planted == {(p["kind"], p["tag"]) for p in md.PLANTED}
    assert {m["kind"] for m in mism["mismatches"]} == {
        "missing_in_model", "missing_in_drawing", "size_differs", "type_differs"}
    assert _diff(clean, mism) == planted
    # Everything not planted (terminals included) is drawn in the same place with the same text on both sheets (a
    # label that lists a removed piece loses that line, so tag boxes may move; the text-layer test checks them).
    tags = {tag for _, tag in planted}

    def same(t):
        return {(i["tag"], i["gid"], i["size"], tuple(i["geom_box"])) for i in t["items"] if i["tag"] not in tags}
    assert same(clean) == same(mism)


def test_drawing_compare_finds_nothing_on_the_clean_sheet_and_the_planted_list_on_the_other(built, scene):
    from iris import drawing_compare
    _, _, truths = built
    index = drawing_compare.model_index(scene)
    clean = drawing_compare.compare(scene, truths["Northbank-M-201"]["items"], storey=md.STOREY, index=index)
    assert clean["mismatches"] == []
    by_id = {i["id"]: i for i in truths["Northbank-M-201"]["items"]}
    assert all(m["element"] == by_id[m["item"]]["gid"] for m in clean["matches"])
    assert len(clean["matches"]) == sum(1 for i in by_id.values() if i["tag"])

    mism = truths["Northbank-M-201-mismatch"]
    got = drawing_compare.compare(scene, mism["items"], storey=md.STOREY, index=index)
    # Exactly the planted list, one mismatch each: the pipe drawn as a rectangular duct is one type difference that
    # says both reasons.
    found = sorted((m.kind, m.item, m.element or m.drawing_value) for m in got["mismatches"])
    expected = sorted((m["kind"], m["item"], m["element"] or m["tag"]) for m in mism["mismatches"])
    assert found == expected and len(found) == 4
    [typed] = [m for m in got["mismatches"] if m.kind == "type_differs"]
    assert (typed.drawing_value, typed.model_value, typed.evidence["reason"]) == ("duct", "pipe", ["kind", "shape"])


def test_output_is_deterministic(built, tmp_path):
    out, _, _ = built
    again = md.build(tmp_path)
    for p in again:
        assert p.read_bytes() == (out / p.name).read_bytes(), p.name


def test_shipped_samples_are_what_the_generator_writes(built):
    out, _, _ = built
    shipped = SAMPLES / "drawings"
    if not shipped.exists():
        pytest.skip("samples/drawings/ not generated")
    names = sorted(p.name for p in out.iterdir())
    # Beside them: each sheet's saved Gemini reading (evals/save_drawing_readings.py, test_drawings.py checks them).
    readings = sorted(p.name for p in shipped.glob("*.reading.json"))
    assert readings == sorted(f"{Path(n).stem}.reading.json" for n in names if n.endswith(".pdf"))
    assert sorted(p.name for p in shipped.iterdir() if not p.name.startswith(".") and p.name not in readings) == names
    for n in names:
        assert (shipped / n).read_bytes() == (out / n).read_bytes(), (
            f"samples/drawings/{n} is stale: cd server && uv run python ../evals/make_drawings.py")
