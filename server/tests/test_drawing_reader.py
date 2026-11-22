"""The drawing reader (iris/drawing_reader.py, docs/drawings.md): tiles and box mapping, sizes and tags, the
reconcile statuses, the event stream with FakeReader, the cache, the budget and the Gemini request's shape. No model
is called: FakeReader reads the text layer, and the Gemini request goes to a stub client."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest
from PIL import Image

from iris import drawing_reader as dr
from iris import model_client, spend

try:   # the ingest slice's dataclasses (docs/drawings.md); the reader only needs their fields
    from iris.drawings import Drawing, Page, Word
except ImportError:   # pragma: no cover - before drawings.py exists
    @dataclass
    class Word:
        text: str
        x0: float
        y0: float
        x1: float
        y1: float

    @dataclass
    class Page:
        index: int
        width_px: int
        height_px: int
        dpi: int
        png: str
        words: list = field(default_factory=list)
        has_text_layer: bool = False

    @dataclass
    class Drawing:
        id: str
        name: str
        sha256: str
        pages: list
        title: dict


@pytest.fixture(autouse=True)
def fresh_spend():
    spend.reset()
    yield
    spend.reset()


def label(text: str, x: float, y: float, h: float = 20, cw: float = 10) -> list[Word]:
    """Words laid out as a PDF's text layer gives them: one per space-separated token, left to right."""
    out = []
    for token in text.split(" "):
        out.append(Word(token, x, y, x + cw * len(token), y + h))
        x += cw * (len(token) + 1)
    return out


def box(words: list[Word]) -> list[float]:
    return [min(w.x0 for w in words), min(w.y0 for w in words), max(w.x1 for w in words), max(w.y1 for w in words)]


def page(tmp_path, index: int, width: int, height: int, words: list[Word], text_layer: bool = True) -> Page:
    name = f"page-{index}.png"
    Image.new("RGB", (width, height), "white").save(tmp_path / name)
    return Page(index=index, width_px=width, height_px=height, dpi=150, png=name, words=words,
                has_text_layer=text_layer)


# Labels on a large sheet (tiled), in reading order as scan_text returns them (top to bottom, left to right).
BIG_LABELS = [("SA-101 600x300", 200, 150), ("RA-201 500 x 250", 1500, 300), ("VAV-3", 2600, 420),
              ("FCU-12 400x250", 400, 900), ("CHW-301 Ø80", 1450, 1000), ("SD-1 Ø250", 2400, 1200),
              ("CT-401 300x100", 300, 1700), ("EF-2", 2000, 1800)]


def big_page(tmp_path, index: int = 0) -> Page:
    words = [w for text, x, y in BIG_LABELS for w in label(text, x, y)]
    words += label("A1", 50, 50) + label("1:100", 2700, 1900) + label("M-201", 2800, 1950)
    return page(tmp_path, index, 3000, 2000, words)


def small_page(tmp_path, index: int = 1) -> Page:
    words = label("AHU-1 Ø400", 100, 100) + label("P-2", 900, 600)
    return page(tmp_path, index, 1200, 800, words)


def drawing(tmp_path, *pages, sha="ab" * 32) -> Drawing:
    return Drawing(id="d1", name="sheet.pdf", sha256=sha, pages=list(pages), title={"sheet": "M-201"})


def run(d, tmp_path, **kw):
    kw.setdefault("folder", tmp_path)
    kw.setdefault("cache_dir", tmp_path / "cache")
    return list(dr.read_drawing(d, **kw))


# ------------------------------------------------------------------------------------------------- tiles and boxes

def test_a_large_page_is_sent_whole_and_as_four_overlapping_quarters():
    t = dr.tiles(3000, 2000)
    assert [x.index for x in t] == [1, 2, 3, 4, 5]
    whole, tl, tr, bl, br = t
    assert (whole.x0, whole.y0, whole.x1, whole.y1) == (0, 0, 3000, 2000)
    assert tl.x1 - tr.x0 == pytest.approx(300)          # neighbours overlap by 10% of the width
    assert tl.y1 - bl.y0 == pytest.approx(200)          # and of the height
    assert (tr.x1, br.y1, bl.x0, tl.y0) == (3000, 2000, 0, 0)
    assert len(dr.tiles(2000, 1400)) == 1               # not over TILE_ABOVE_PX: the page alone


def test_a_box_on_a_quarter_maps_back_to_page_pixels():
    tr = dr.tiles(3000, 2000)[2]                          # top right: x 1350-3000, y 0-1100
    assert dr.to_page([0, 0, 1000, 1000], tr) == [1350, 0, 3000, 1100]
    assert dr.to_page([500, 500, 500, 500], tr) == [2175, 550, 2175, 550]
    assert dr.to_page([100, 200, 300, 400], tr) == [1350 + 330, 110, 1350 + 660, 330]
    assert dr.to_page([300, 400, 100, 200], tr) == [1350 + 330, 110, 1350 + 660, 330]   # min and max swapped
    assert dr.to_page([-5, -5, 1200, 1200], tr) == [1350, 0, 3000, 1100]                # clamped to the image
    for t in dr.tiles(3000, 2000):
        b = [t.x0 + 37.0, t.y0 + 91.0, t.x0 + 412.0, t.y0 + 133.0]
        back = dr.to_page(dr.to_tile(b, t), t)
        assert all(abs(u - v) <= 2.0 for u, v in zip(back, b))


# ------------------------------------------------------------------------------------------------- sizes and tags

@pytest.mark.parametrize("text, dims, unit, assumed", [
    ("600x300", (600, 300), "mm", True), ("600 x 300", (600, 300), "mm", True), ("600×300", (600, 300), "mm", True),
    ("600 X 300", (600, 300), "mm", True), ("600mm x 300mm", (600, 300), "mm", False),
    ("Ø150", (150,), "mm", True), ("150Ø", (150,), "mm", True), ("150 dia", (150,), "mm", True),
    ("150 DIA", (150,), "mm", True), ("ø150", (150,), "mm", True), ("⌀150", (150,), "mm", True),
    ("DN150", (150,), "mm", False), ('24"x12"', (609.6, 304.8), "in", False), ('6" dia', (152.4,), "in", False),
    ("6″Ø", (152.4,), "in", False), ("(600x300)", (600, 300), "mm", True),
])
def test_printed_sizes_parse_to_millimetres(text, dims, unit, assumed):
    s = dr.parse_size(text)
    assert s is not None and s.dims_mm == pytest.approx(dims) and s.unit == unit and s.unit_assumed is assumed


@pytest.mark.parametrize("text", ["abc", "1:100", "150", "SA-101", "L02", "", None])
def test_text_that_is_not_a_size(text):
    assert dr.parse_size(text) is None


def test_a_bare_number_is_a_size_only_from_the_model():
    assert dr.parse_size("150") is None
    assert dr.parse_size("150", strict=False).dims_mm == (150,)
    assert dr.parse_size("150", strict=False).same(dr.parse_size("Ø150"))
    assert not dr.parse_size("600x300").same(dr.parse_size("300x600"))   # as printed: order matters


@pytest.mark.parametrize("text, tag", [("SA-101", True), ("AHU1", True), ("SA-MAIN-L02-5", True),
                                       ("FCU – 12", True), ("VAV-3,", True), ("A1", False), ("L02", False),
                                       ("600x300", False), ("DN150", False), ("1:100", False), ("OFFICE", False)])
def test_what_looks_like_a_tag(text, tag):
    assert dr.looks_like_tag(text) is tag


def test_tags_compare_without_case_dashes_or_spaces_and_suggest_a_kind():
    assert dr.canon_tag("fcu – 12") == dr.canon_tag("FCU-12") == "FCU-12"
    assert [dr.kind_of_tag(t) for t in ("AHU-1", "SA-MAIN-L02-5", "LV-TRAY-1", "CHW-3", "SD-4", "P-2", "XQ-1")] == \
        ["unit", "duct", "tray", "pipe", "diffuser", "equipment", "other"]


# ------------------------------------------------------------------------------------------------- reconcile

def ai(tag, size, b, kind="duct", image=1):
    return {"tag": tag, "size": size, "kind": kind, "box": list(b), "image": image}


def test_an_item_whose_tag_and_size_are_printed_near_it_is_confirmed():
    tag, size = label("SA-101", 100, 100), label("600 x 300", 180, 100)
    out = dr.reconcile([ai("SA-101", "600×300", box(tag + size))], tag + size, width=1600, height=1000)
    assert len(out) == 1
    it = out[0]
    assert (it["status"], it["source"], it["size_mm"]) == ("confirmed", "ai", [600, 300])
    assert it["evidence"]["tag"]["distance_px"] == 0 and it["evidence"]["size"]["text"] == "600 x 300"
    assert [w["text"] for w in it["evidence"]["size"]["words"]] == ["600", "x", "300"]
    assert it["evidence"]["unit"] == "mm" and it["evidence"]["unit_assumed"] is True


@pytest.mark.parametrize("printed, read", [("150Ø", "Ø150"), ("150 dia", "Ø150"), ("Ø150", "150 DIA"),
                                           ('24" x 12"', '24"x12"'), ("600x300", "600 X 300")])
def test_sizes_match_in_any_printed_form(printed, read):
    words = label("EX-4", 100, 100) + label(printed, 160, 100)
    out = dr.reconcile([ai("EX-4", read, box(words))], words, width=1600, height=1000)
    assert [o["status"] for o in out] == ["confirmed"]


def test_inches_are_converted_and_say_so():
    words = label('24" x 12"', 100, 100)
    out = dr.reconcile([ai(None, '24"x12"', box(words))], words, width=1600, height=1000)
    assert out[0]["status"] == "confirmed"
    assert out[0]["size_mm"] == pytest.approx([609.6, 304.8]) and out[0]["evidence"]["unit"] == "in"


def test_a_misread_size_is_ai_only_and_shows_what_is_printed():
    words = label("SA-101", 100, 100) + label("600x300", 180, 100)
    out = dr.reconcile([ai("SA-101", "650x300", box(words))], words, width=1600, height=1000)
    assert len(out) == 1                                  # the printed size is not a second, text-only item
    it = out[0]
    assert it["status"] == "ai_only" and "tag" in it["evidence"]
    assert it["evidence"]["text_says"]["size"]["text"] == "600x300"
    assert "size not found" in it["evidence"]["why"]


def test_a_label_listing_several_tags_is_one_item_per_tag_sharing_its_one_size():
    """Short pieces of one run share a label: their tags one per line, the size once under them. The model gives the
    label as one item whose tag has line breaks."""
    words = label("SA-BR-1", 100, 100) + label("SA-BR-2", 100, 122) + label("SA-BR-3", 100, 144) + label("300x200", 105, 166)
    whole = dr.Tile(1, "whole sheet", 0.0, 0.0, 1600.0, 1000.0)
    reply = {"items": [{"image": 1, "tag": "SA-BR-1\nSA-BR-2\nSA-BR-3", "kind": "duct", "size": "300x200",
                        "box_2d": dr.to_tile(box(words), whole)}]}
    ai_items, dropped = dr._ai_items(reply, [whole])
    assert dropped == 0 and [i["tag"] for i in ai_items] == ["SA-BR-1", "SA-BR-2", "SA-BR-3"]
    assert ai_items[0]["box"][1] < ai_items[1]["box"][1] < ai_items[2]["box"][1]     # each on its own line
    out = dr.reconcile(ai_items, words, width=1600, height=1000)
    assert [(i["tag"], i["size"], i["status"]) for i in out] == [
        ("SA-BR-1", "300x200", "confirmed"), ("SA-BR-2", "300x200", "confirmed"), ("SA-BR-3", "300x200", "confirmed")]
    assert all(i["evidence"]["label_tags"] == 3 for i in out)                       # no text-only leftovers either


def test_a_size_printed_on_the_label_beside_is_not_the_items():
    """A tag's size is the one on its own label: a size printed just beside it belongs to another label."""
    words = label("CW-R-9", 300, 100) + label("Ø54", 310, 122) + label("Ø150", 236, 122)
    out = dr.reconcile([ai("CW-R-9", "Ø150", box(label("CW-R-9", 300, 100)), kind="pipe")], words,
                       width=1600, height=1000)
    it = out[0]
    assert it["status"] == "ai_only" and "tag" in it["evidence"] and "size" not in it["evidence"]
    assert it["evidence"]["why"] == "size not found on the item's label in the text layer"
    assert it["evidence"]["text_says"]["size"]["text"] == "Ø54"
    assert [(i["size"], i["status"]) for i in out[1:]] == [("Ø150", "text_only")]   # the other label's size, unread
    assert [b for b in dr.label_blocks(words)].count(dr.label_blocks(words)[0]) == 2   # CW-R-9 and Ø54: one label


def test_an_image_whose_boxes_are_all_shifted_the_same_way_is_moved_back(tmp_path):
    """Seen once on a quarter: every box half a quarter too low. Tags printed once on the page measure the shift."""
    p = big_page(tmp_path)
    found = dr.scan_text(p.words, radius=dr.radius_px(p.width_px, p.height_px))
    items = [ai(f["tag"], f["size"], [f["box"][0], f["box"][1] + 600, f["box"][2], f["box"][3] + 600], image=4)
             for f in found if f["tag"] and f["tag"] != "M-201"]
    out = dr.reconcile(items, p.words, width=p.width_px, height=p.height_px)
    read = [i for i in out if i["source"] == "ai"]
    assert read and all(i["status"] == "confirmed" for i in read)
    assert {(i["evidence"]["box_shift"]["dx"], i["evidence"]["box_shift"]["dy"]) for i in read} == {(0.0, -600.0)}
    assert all(i["evidence"]["box_shift"]["anchors"] == len(items) for i in read)
    # One box far off on its own is not a shift: it stays where it was read, and is not confirmed there.
    lone = dr.reconcile(items[:1] + [ai(f["tag"], f["size"], f["box"], image=2) for f in found[1:3] if f["tag"]],
                        p.words, width=p.width_px, height=p.height_px)
    [far] = [i for i in lone if i["source"] == "ai" and i["tag"] == items[0]["tag"]]
    assert far["status"] == "ai_only" and far["box"] == items[0]["box"] and "box_shift" not in far["evidence"]


def test_text_beyond_the_radius_does_not_confirm():
    words = label("SA-101", 100, 100)
    far = [1000, 700, 1060, 720]
    out = dr.reconcile([ai("SA-101", None, far)], words, width=1600, height=1000)
    assert {o["status"] for o in out} == {"ai_only", "text_only"}
    assert dr.reconcile([ai("SA-101", None, far)], words, width=1600, height=1000, radius=2000)[0]["status"] == \
        "confirmed"


def test_an_item_with_nothing_printed_to_check_is_ai_only():
    out = dr.reconcile([ai(None, None, [10, 10, 30, 30], kind="diffuser")], [], width=1600, height=1000)
    assert out[0]["status"] == "ai_only" and "nothing printed" in out[0]["evidence"]["why"]


def test_a_page_without_a_text_layer_confirms_nothing():
    words = label("SA-101", 100, 100) + label("FCU-12", 600, 600)
    out = dr.reconcile([ai("SA-101", None, box(words[:1]))], words, width=1600, height=1000, has_text_layer=False)
    assert [(o["status"], o["evidence"]["why"]) for o in out] == [("ai_only", "no text layer: read by the AI only")]


def test_unread_tags_and_sizes_in_the_text_layer_are_text_only_items():
    words = (label("SA-101", 100, 100) + label("FCU-12 400x250", 600, 400) + label("Ø100", 1200, 800)
             + label("A1", 20, 20) + label("1:100", 1400, 950) + label("M-201", 1500, 950) + label("OFFICE 2.01", 800, 50))
    out = dr.reconcile([ai("SA-101", None, box(words[:1]))], words, width=1600, height=1000, exclude=("M-201",))
    text = [o for o in out if o["status"] == "text_only"]
    assert [(o["tag"], o["size"], o["kind"], o["size_mm"]) for o in text] == [
        ("FCU-12", "400x250", "unit", [400, 250]), (None, "Ø100", "other", [100])]
    assert all(o["source"] == "text" for o in text)
    assert [w["text"] for w in text[0]["evidence"]["words"]] == ["FCU-12", "400x250"]


def test_one_printed_label_confirms_one_item_nearest_first():
    words = label("Ø150", 100, 100)
    near, farther = [90, 95, 150, 125], [100, 160, 160, 190]
    out = dr.reconcile([ai(None, "Ø150", farther, kind="pipe"), ai(None, "Ø150", near, kind="diffuser")], words,
                       width=1600, height=1000)
    by_kind = {o["kind"]: o["status"] for o in out}
    assert by_kind == {"diffuser": "confirmed", "pipe": "ai_only"}


def test_a_label_read_on_the_whole_sheet_and_a_quarter_is_one_item():
    words = label("SA-101", 100, 100)
    out = dr.reconcile([ai("SA-101", None, [98, 99, 162, 121], image=1), ai("SA-101", None, box(words), image=2)],
                       words, width=3000, height=2000)
    assert len(out) == 1 and out[0]["status"] == "confirmed" and out[0]["evidence"]["images"] == [2, 1]
    assert out[0]["box"] == box(words)                    # the quarter's box is kept


# ------------------------------------------------------------------------------------------------- the stream

def test_the_event_stream_with_the_fake_reader(tmp_path):
    big, small = big_page(tmp_path, 0), small_page(tmp_path, 1)
    reader = dr.FakeReader()
    events = run(drawing(tmp_path, big, small), tmp_path, model=reader)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "page" and kinds[-1] == "done" and kinds.count("page") == 2 and kinds.count("done") == 1
    pages = [e for e in events if e["type"] == "page"]
    assert [(p["index"], p["total"], p["cached"]) for p in pages] == [(0, 2, False), (1, 2, False)]
    items = [e["item"] for e in events if e["type"] == "item"]
    done = events[-1]
    assert done["items"] == items and done["cost_usd"] == 0 and done["errors"] == {}
    assert reader.calls == 2
    assert len({i["id"] for i in items}) == len(items)
    assert set(items[0]) == {"id", "page", "tag", "kind", "size", "size_mm", "box", "source", "status", "evidence"}
    on_big = {i["tag"] or i["size"]: i for i in items if i["page"] == 0}
    # BIG_LABELS in reading order: #1 misread (RA-201's size), #3 missed (FCU-12), plus the invented ZZ-999
    assert on_big["SA-101"]["status"] == "confirmed"
    assert on_big["RA-201"]["status"] == "ai_only"
    assert on_big["RA-201"]["evidence"]["text_says"]["size"]["text"] == "500 x 250"
    assert on_big["FCU-12"]["status"] == "text_only" and on_big["FCU-12"]["size"] == "400x250"
    assert on_big["ZZ-999"]["status"] == "ai_only"
    assert {i["status"] for i in items} == {"confirmed", "ai_only", "text_only"}
    assert "A1" not in on_big                                    # a grid label is not an item
    assert on_big["M-201"]["source"] == "ai"                     # the sheet number: never a text-only item
    assert not [i for i in items if i["status"] == "text_only" and i["tag"] == "M-201"]
    # boxes read on the quarters come back to where the labels are printed
    words = big.words
    for text, x, y in BIG_LABELS:
        tag = text.split(" ")[0]
        if on_big[tag]["source"] == "ai":
            assert on_big[tag]["evidence"]["images"][0] > 1          # read on a quarter
            expected = box([w for w in words if x <= w.x0 and w.y0 == y][:len(text.split(" "))])
            assert all(abs(a - b) <= 2.0 for a, b in zip(on_big[tag]["box"], expected))
    assert {i["tag"]: i["status"] for i in items if i["page"] == 1} == {"AHU-1": "confirmed", "P-2": "confirmed",
                                                                       "ZZ-999": "ai_only"}


def test_reading_some_pages_only(tmp_path):
    events = run(drawing(tmp_path, big_page(tmp_path, 0), small_page(tmp_path, 1)), tmp_path, pages=[1],
                 model=dr.FakeReader())
    assert [e["index"] for e in events if e["type"] == "page"] == [1]
    assert {e["item"]["page"] for e in events if e["type"] == "item"} == {1}


# ------------------------------------------------------------------------------------------------- the cache

def test_a_page_is_read_once_per_model_and_prompt(tmp_path, monkeypatch):
    d = drawing(tmp_path, big_page(tmp_path, 0), small_page(tmp_path, 1))
    reader = dr.FakeReader()
    first = run(d, tmp_path, model=reader)
    second = run(d, tmp_path, model=reader)
    assert reader.calls == 2                                   # the second run read nothing
    assert [e["cached"] for e in second if e["type"] == "page"] == [True, True]

    def plain(events):
        out = []
        for i in events[-1]["items"]:
            i = dict(i, evidence={k: v for k, v in i["evidence"].items() if k != "cached"})
            out.append(i)
        return out
    assert plain(first) == plain(second)
    assert len(list((tmp_path / "cache").glob("*.json"))) == 2
    cached = json.loads(next((tmp_path / "cache").glob("*.json")).read_text())
    assert {"reply", "tiles", "usage", "model", "prompt_hash", "drawing_sha256", "page"} <= set(cached)

    other = dr.FakeReader(model="another-model")
    run(d, tmp_path, model=other)
    assert other.calls == 2                                    # a different model reads again
    monkeypatch.setattr(dr, "VERSION", "test-changed")
    run(d, tmp_path, model=reader)
    assert reader.calls == 4                                   # so does a changed prompt
    run(drawing(tmp_path, small_page(tmp_path, 1), sha="cd" * 32), tmp_path, model=reader)
    assert reader.calls == 5                                   # and a different file


def test_no_cache_when_asked(tmp_path):
    reader = dr.FakeReader()
    d = drawing(tmp_path, small_page(tmp_path, 1))
    run(d, tmp_path, model=reader, cache_dir=False)
    run(d, tmp_path, model=reader, cache_dir=False)
    assert reader.calls == 2 and not (tmp_path / "cache").exists()


# ------------------------------------------------------------------------------------------------- saved readings

def saved_reading_of(d, tmp_path, model: str = "gemini-3.8-flash"):
    """A saved reading of `d`, made as evals/save_drawing_readings.py makes one (a read, then write_saved): its events,
    and the file's path."""
    events = run(d, tmp_path, model=dr.FakeReader(model=model), saved=False)
    path = dr.write_saved(d, tmp_path / "saved" / "sheet.reading.json", model=model, cache_dir=tmp_path / "cache")
    return events, path


def without(items, *keys):
    return [dict(i, evidence={k: v for k, v in i["evidence"].items() if k not in keys}) for i in items]


def test_model_ids_read_as_names_with_their_version():
    assert dr.model_name("gemini-3.8-flash") == "Gemini 3.8 Flash"
    assert dr.model_name("gemini-3.5-flash-lite") == "Gemini 3.5 Flash Lite"
    assert dr.model_name("") == ""


def test_a_saved_reading_is_replayed_with_no_model_call_and_says_so(tmp_path, monkeypatch):
    d = drawing(tmp_path, big_page(tmp_path, 0), small_page(tmp_path, 1))
    made, path = saved_reading_of(d, tmp_path)
    data = json.loads(path.read_text())
    assert data["drawing_sha256"] == d.sha256 and data["prompt_hash"] == dr.prompt_hash()
    assert data["model"] == "gemini-3.8-flash" and [p["page"] for p in data["pages"]] == [0, 1]
    assert all({"tiles", "reply", "usage", "at"} <= set(p) for p in data["pages"])

    monkeypatch.setattr(dr, "SAVED", tmp_path / "saved")          # where the server looks by default
    live = dr.FakeReader(usd_per_call=1.0)                       # a cap of 0.5 would refuse it, were it called
    events = run(d, tmp_path, model=live, cache_dir=False, budget=0.5)
    assert live.calls == 0
    pages = [e for e in events if e["type"] == "page"]
    assert [(e["index"], e["saved"], e["cached"]) for e in pages] == [(0, True, True), (1, True, True)]
    done = events[-1]
    assert done["cost_usd"] == 0 and done["errors"] == {}
    assert done["saved"] == {"model": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "at": data["pages"][0]["at"],
                             "pages": [0, 1]}
    ai = [i for i in done["items"] if i["source"] == "ai"]
    assert ai and all(i["evidence"]["saved_reading"] == {"model": "gemini-3.8-flash", "label": "Gemini 3.8 Flash",
                                                         "at": data["pages"][0]["at"]} for i in ai)
    # The same items, statuses and boxes as the read that was saved: the reply is checked against the text layer again.
    assert without(done["items"], "cached", "saved_reading") == without(made[-1]["items"], "cached", "saved_reading")
    assert dr.saved_info(d) == {"model": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "at": data["at"]}
    assert not run(d, tmp_path, model=live, cache_dir=False, saved=False, budget=5)[0]["saved"]   # saved=False: live
    assert live.calls == 2


def test_a_saved_reading_of_another_file_prompt_or_page_size_falls_through_to_the_model(tmp_path, monkeypatch):
    d = drawing(tmp_path, small_page(tmp_path, 1))
    saved_reading_of(d, tmp_path)
    where = tmp_path / "saved"
    reader = dr.FakeReader()

    other = drawing(tmp_path, small_page(tmp_path, 1), sha="cd" * 32)   # another PDF: its hash is not the saved one
    events = run(other, tmp_path, model=reader, cache_dir=False, saved=where)
    assert reader.calls == 1 and events[0]["saved"] is False and events[-1]["saved"] is None
    assert dr.saved_info(other, folder=where) is None
    assert not any("saved_reading" in i["evidence"] for i in events[-1]["items"])

    version = dr.VERSION
    monkeypatch.setattr(dr, "VERSION", "test-changed")              # the prompt changed: the saved reply is stale
    events = run(d, tmp_path, model=reader, cache_dir=False, saved=where)
    assert reader.calls == 2 and events[-1]["saved"] is None and dr.saved_info(d, folder=where) is None
    monkeypatch.setattr(dr, "VERSION", version)
    assert dr.saved_info(d, folder=where) is not None

    resized = drawing(tmp_path, page(tmp_path, 1, 600, 400, label("AHU-1 Ø400", 50, 50)))   # same file, other size
    events = run(resized, tmp_path, model=reader, cache_dir=False, saved=where)
    assert reader.calls == 3 and events[-1]["saved"] is None


def test_a_saved_reading_needs_the_page_read_first(tmp_path):
    d = drawing(tmp_path, small_page(tmp_path, 1))
    with pytest.raises(ValueError, match="has not been read"):
        dr.write_saved(d, tmp_path / "x.reading.json", model="gemini-3.8-flash", cache_dir=tmp_path / "cache")


# ------------------------------------------------------------------------------------------------- the budget

def test_a_read_past_the_days_budget_is_refused_before_anything_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("IRIS_ESCALATION_MAX_USD_DAY", "0.10")
    spend.charge(0.08)
    reader = dr.FakeReader(usd_per_call=0.05)
    stream = dr.read_drawing(drawing(tmp_path, small_page(tmp_path, 1)), model=reader, folder=tmp_path,
                             cache_dir=tmp_path / "cache")
    with pytest.raises(dr.ReadRefused, match="today's AI budget"):
        next(stream)
    assert reader.calls == 0 and spend.spent() == pytest.approx(0.08)


def test_reads_are_charged_to_the_day_and_cached_pages_are_free(tmp_path, monkeypatch):
    monkeypatch.setenv("IRIS_ESCALATION_MAX_USD_DAY", "0.10")
    reader = dr.FakeReader(usd_per_call=0.05)
    d = drawing(tmp_path, small_page(tmp_path, 1))
    events = run(d, tmp_path, model=reader)
    assert events[-1]["cost_usd"] == pytest.approx(0.05) and spend.spent() == pytest.approx(0.05)
    spend.charge(0.05)                                         # the day is now spent
    again = run(d, tmp_path, model=reader)                     # but this page is cached
    assert again[-1]["cost_usd"] == 0 and reader.calls == 1
    with pytest.raises(dr.ReadRefused):
        run(drawing(tmp_path, small_page(tmp_path, 1), sha="ef" * 32), tmp_path, model=reader)


def test_a_cap_on_one_read(tmp_path):
    reader = dr.FakeReader(usd_per_call=0.05)
    d = drawing(tmp_path, big_page(tmp_path, 0), small_page(tmp_path, 1))
    with pytest.raises(dr.ReadRefused, match="this read's cap"):
        run(d, tmp_path, model=reader, budget=0.06)
    assert reader.calls == 0
    events = run(d, tmp_path, model=reader, budget=0.12)
    assert events[-1]["cost_usd"] == pytest.approx(0.10) and reader.calls == 2


# ------------------------------------------------------------------------------------------------- Gemini's request

class StubModels:
    def __init__(self, reply: str, usage: dict):
        self.reply, self.usage, self.calls = reply, usage, []

    def generate_content(self, model, contents, config):
        self.calls.append(SimpleNamespace(model=model, contents=contents, config=config))
        return SimpleNamespace(candidates=None, text=self.reply, usage_metadata=self.usage, model_version=model)


def stub_client(reply: dict | str, usage: dict | None = None):
    text = reply if isinstance(reply, str) else json.dumps(reply)
    return SimpleNamespace(models=StubModels(text, usage or {"prompt_token_count": 7000, "candidates_token_count": 400,
                                                             "thoughts_token_count": 2600}))


def test_the_gemini_request_labels_each_image_and_holds_the_reply_to_the_schema(tmp_path):
    big = big_page(tmp_path, 0)
    tl = dr.tiles(3000, 2000)[1]
    reply = {"items": [{"image": 2, "tag": "SA-101", "kind": "duct", "size": "600x300",
                        "box_2d": dr.to_tile(box(big.words[:2]), tl)}],
             "title": {"sheet": "M-201", "scale": "1:100", "title": None}}
    client = stub_client(reply)
    reader = dr.GeminiReader("gemini-3.8-flash", client=client)
    events = run(drawing(tmp_path, big), tmp_path, model=reader, budget=dr.DayBudget(exempt=False))
    call = client.models.calls[0]
    assert call.model == "gemini-3.8-flash"
    parts = call.contents[0].parts
    labels = [p.text for p in parts[0:10:2]]
    assert labels == [f"Image {k}:" for k in range(1, 6)]
    assert all(p.inline_data.mime_type == "image/png" for p in parts[1:10:2])
    assert parts[-1].text == dr.page_text(dr.tiles(3000, 2000))               # instructions last
    cfg = call.config
    assert cfg.temperature is None
    assert cfg.media_resolution == model_client._types().MediaResolution.MEDIA_RESOLUTION_HIGH
    assert str(cfg.thinking_config.thinking_level).upper().endswith("HIGH")
    assert cfg.response_mime_type == "application/json" and cfg.response_json_schema == dr.schema(5)
    assert cfg.system_instruction == dr.system_prompt()
    done = events[-1]
    usd = model_client.cost("gemini-3.8-flash", 7000, 3000)
    assert done["cost_usd"] == pytest.approx(usd) and spend.spent() == pytest.approx(usd)
    assert done["titles"] == {"0": {"sheet": "M-201", "scale": "1:100", "title": None}}
    sa = next(i for i in done["items"] if i["tag"] == "SA-101")
    assert sa["status"] == "confirmed" and sa["evidence"]["model"] == "gemini-3.8-flash"


def test_a_reply_that_is_not_json_fails_the_page_and_is_not_cached(tmp_path):
    client = stub_client("not json")
    reader = dr.GeminiReader("gemini-3.8-flash", client=client)
    d = drawing(tmp_path, small_page(tmp_path, 1))
    events = run(d, tmp_path, model=reader, budget=dr.DayBudget(exempt=False))
    assert "not valid JSON" in events[-1]["errors"]["1"]
    assert {i["status"] for i in events[-1]["items"]} == {"text_only"}      # the text layer still shows
    assert not list((tmp_path / "cache").glob("*.json"))


def test_the_schema_is_strict():
    s = dr.schema(5)
    item = s["properties"]["items"]["items"]
    assert item["properties"]["kind"]["enum"] == list(dr.KINDS)
    assert item["additionalProperties"] is False and s["additionalProperties"] is False
    assert set(item["required"]) == {"image", "tag", "kind", "size", "box_2d"}
    assert item["properties"]["image"]["maximum"] == 5 and dr.schema(1)["properties"]["items"]["items"][
        "properties"]["image"]["maximum"] == 1
    assert item["properties"]["box_2d"]["minItems"] == item["properties"]["box_2d"]["maxItems"] == 4


def test_the_prompt_says_read_only_what_is_printed():
    text = dr.system_prompt()
    for rule in ("Never guess", "exactly", "[ymin, xmin, ymax, xmax]", "Image 1 is the whole sheet"):
        assert rule in text
