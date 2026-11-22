"""2D drawings (drawings.py, docs/drawings.md): PDF pages rendered with their exact text layer in pixels, the title
block as printed, scanned sheets marked as having no text layer, the caps, refusals in words, the routes (the reader
and the comparison stubbed: no model is called), eviction with the scene, and projects keeping their drawings."""
import dataclasses
import gc
import io
import json
import math
import sys
import types
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from iris import app as app_module
from iris import drawings
from iris.fixtures import build_clash_fixture
from iris.limits import ProposeLimit
from iris.service import Workspace

W, H = landscape(A3)          # points
S = drawings.DPI / 72         # pixels per point at the default dpi
LABELS = {"D-7 600x300": (100, H - 150), "RTU-4": (400, H - 300)}   # text → baseline (x, y) in points, bottom-left


def plan_pdf(pages: int = 1, title: bool = True, **kw) -> bytes:
    """A small plan sheet: two tags, a title block in the bottom-right corner; more pages repeat it."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H), **kw)
    for _ in range(pages):
        c.setFont("Helvetica", 12)
        for text, (x, y) in LABELS.items():
            c.drawString(x, y, text)
        c.line(100, H - 160, 700, H - 160)   # the duct the label sits on
        if title:
            c.rect(W - 400, 20, 380, 120)
            c.setFont("Helvetica", 9)
            c.drawString(W - 390, 120, "TITLE: LEVEL 02 MEP PLAN")
            c.drawString(W - 390, 95, "SHEET: M-201")
            c.drawString(W - 200, 95, "SCALE: 1:100")
            c.drawString(W - 390, 70, "DRAWING NO.")     # its value printed under it
            c.drawString(W - 390, 55, "NB-M-201")
        c.showPage()
    c.save()
    return buf.getvalue()


def scanned_pdf() -> bytes:
    """A sheet that is only a picture (a scan): marks that look like text, no text layer."""
    img = Image.new("RGB", (800, 560), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([60, 60, 300, 80], fill="black")
    d.rectangle([600, 500, 760, 520], fill="black")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.drawImage(ImageReader(img), 0, 0, width=W, height=H)
    c.showPage()
    c.save()
    return buf.getvalue()


def words_of(page) -> dict[str, drawings.Word]:
    return {w.text: w for w in page.words}


def ink(png, box) -> int:
    """Dark pixels inside a box of the rendered page."""
    im = np.asarray(Image.open(png).convert("L"))
    x0, y0, x1, y1 = (int(math.floor(box[0])), int(math.floor(box[1])), int(math.ceil(box[2])), int(math.ceil(box[3])))
    return int((im[y0:y1, x0:x1] < 128).sum())


@pytest.fixture
def store(tmp_path, monkeypatch):
    s = drawings.Store(tmp_path / "drawings")
    monkeypatch.setattr(drawings, "STORE", s)
    monkeypatch.delenv("IRIS_DRAWING_MAX_PAGES", raising=False)
    monkeypatch.delenv("IRIS_DRAWING_MAX_MB", raising=False)
    return s


# ---------------------------------------------------------------------------------------------------- ingest

def test_pages_are_rendered_and_every_word_is_placed_in_pixels_on_the_image(tmp_path, store):
    data = plan_pdf()
    d = drawings.ingest(data, "L02-plan.pdf", tmp_path / "root")
    assert drawings.ID.fullmatch(d.id) and d.name == "L02-plan.pdf"
    import hashlib
    assert d.sha256 == hashlib.sha256(data).hexdigest()
    assert (tmp_path / "root" / d.id / "source.pdf").read_bytes() == data
    [p] = d.pages
    assert p.index == 0 and p.dpi == drawings.DPI and p.png == "page-0.png" and p.has_text_layer
    assert abs(p.width_px - W * S) <= 1 and abs(p.height_px - H * S) <= 1
    png = tmp_path / "root" / d.id / p.png
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" and Image.open(png).size == (p.width_px, p.height_px)
    found = words_of(p)
    for text, (x, y) in LABELS.items():
        first, *rest = text.split()
        w = found[first]
        assert abs(w.x0 - x * S) < 1.5, (text, w)              # left edge where it was drawn
        baseline = (H - y) * S                                   # top-left origin
        assert w.y0 < baseline < w.y1 and w.y1 - w.y0 < 14 * S   # the line's box holds its baseline
        assert ink(png, (w.x0, w.y0, w.x1, w.y1)) > 50          # and the rendered glyphs are inside it
        for more in rest:
            assert found[more].x0 > w.x1 and abs(found[more].y0 - w.y0) < 1
    # Nothing is drawn where no word is.
    assert ink(png, (found["RTU-4"].x1 + 40, found["RTU-4"].y0, found["RTU-4"].x1 + 200, found["RTU-4"].y1)) == 0


def test_the_title_block_is_read_as_printed_in_the_bottom_right_corner(tmp_path, store):
    d = drawings.ingest(plan_pdf(), "a.pdf", tmp_path)
    assert d.title == {"title": "LEVEL 02 MEP PLAN", "sheet": "M-201", "scale": "1:100", "drawing_no": "NB-M-201"}
    assert drawings.ingest(plan_pdf(title=False), "b.pdf", tmp_path).title == {}


def test_a_title_block_field_is_only_what_is_there_never_guessed():
    def w(text, x, y, size=10.0):
        return drawings.Word(text, x, y, x + 6 * len(text), y + size)
    words = [w("TITLE:", 1100, 900), w("COVER", 1142, 900), w("SHEET", 1178, 900),   # "SHEET" inside a title
             w("SCALE:", 1100, 940),                                                 # a label with no value
             w("SHEET", 1100, 980), w("NO.", 1136, 980), w("M-001", 1250, 980),      # its value in the next cell
             w("TITLE:", 10, 10), w("NOT", 60, 10)]                                  # outside the corner
    assert drawings.title_block(words, 1600, 1000) == {"title": "COVER SHEET", "sheet": "M-001"}
    assert drawings.title_block([], 1600, 1000) == {}


def test_a_scanned_pdf_has_no_text_layer(tmp_path, store):
    d = drawings.ingest(scanned_pdf(), "scan.pdf", tmp_path)
    [p] = d.pages
    assert p.has_text_layer is False and p.words == [] and d.title == {}
    assert ink(tmp_path / d.id / p.png, (0, 0, p.width_px, p.height_px)) > 1000   # the picture itself is rendered


SAMPLE_SHEETS = Path(__file__).resolve().parents[2] / "samples" / "drawings"


def centre_in(w: drawings.Word, box, slack: float = 1.0) -> bool:
    cx, cy = (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2
    return box[0] - slack <= cx <= box[2] + slack and box[1] - slack <= cy <= box[3] + slack


@pytest.mark.parametrize("stem", ["Northbank-M-201", "Northbank-M-201-mismatch"])
def test_every_tag_on_the_sample_sheets_is_one_word_inside_its_label(tmp_path, store, stem):
    pdf = SAMPLE_SHEETS / f"{stem}.pdf"
    if not pdf.exists():
        pytest.skip("samples/drawings/ not generated")
    truth = json.loads((SAMPLE_SHEETS / f"{stem}.truth.json").read_text(encoding="utf-8"))
    d = drawings.ingest(pdf.read_bytes(), pdf.name, tmp_path)
    page = d.pages[truth["page"]]
    assert (page.width_px, page.height_px, page.dpi) == (truth["width_px"], truth["height_px"], truth["dpi"])
    tagged = [i for i in truth["items"] if i["tag"]]
    assert len(tagged) > 100
    lost = [i["tag"] for i in tagged
            if not any(w.text == i["tag"] and centre_in(w, i["label_box"]) and centre_in(w, i["tag_box"])
                       for w in page.words)]
    assert lost == [], f"{len(lost)} of {len(tagged)} tags not read whole inside their labels"
    lost = [i["size"] for i in truth["items"] if i["size"]
            and not any(w.text == i["size"] and centre_in(w, i["size_box"]) for w in page.words)]
    assert lost == []
    assert d.title["sheet"] == truth["title_block"]["sheet"] and d.title["title"] == truth["title_block"]["title"]


def test_dense_labels_a_little_offset_from_each_other_are_still_read_as_whole_tags(tmp_path, store):
    """Six two-line labels side by side, each 2 pt lower than the last: every line's top is within 3 pt of another's,
    so grouping characters into lines by height chains both lines of every label into one and splits the tags."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setFont("Helvetica-Bold", 8)
    drawn = {}
    for i in range(6):
        for n in (1, 2):
            drawn[f"SA-BR-L02-N{i}-{n}"] = (60 + 110 * i, H - 200 - 2 * i - 9.44 * (n - 1))   # baseline, points
    for text, (x, y) in drawn.items():
        c.drawString(x, y, text)
    c.showPage()
    c.save()
    data = buf.getvalue()
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as pdf:   # what grouping by line height made of it
        assert not set(drawn) <= {w["text"] for w in pdf.pages[0].extract_words(use_text_flow=False)}
    [p] = drawings.ingest(data, "dense.pdf", tmp_path).pages
    assert sorted(w.text for w in p.words) == sorted(drawn)
    found = words_of(p)
    for text, (x, y) in drawn.items():
        w = found[text]
        assert abs(w.x0 - x * S) < 1.5 and w.y0 < (H - y) * S < w.y1, (text, w)


def test_turned_and_upside_down_text_reads_whole_and_in_reading_order(tmp_path, store):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setFont("Helvetica", 10)
    for angle, text, (x, y) in ((90, "SA-101 Ø150", (100, 200)), (-90, "RTU-7", (300, 500)), (180, "AHU-2", (600, 500))):
        c.saveState()
        c.translate(x, y)
        c.rotate(angle)
        c.drawString(0, 0, text)
        c.restoreState()
    c.showPage()
    c.save()
    d = drawings.ingest(buf.getvalue(), "turned.pdf", tmp_path)
    [p] = d.pages
    found = words_of(p)
    assert sorted(found) == sorted(["SA-101", "Ø150", "RTU-7", "AHU-2"]) and len(p.words) == 4
    up, size, down, flipped = found["SA-101"], found["Ø150"], found["RTU-7"], found["AHU-2"]
    assert up.y1 - up.y0 > 2 * (up.x1 - up.x0) and abs(up.y1 - (H - 200) * S) < 2   # runs up the sheet from its start
    assert size.y1 < up.y0 and abs(size.x0 - up.x0) < 1                             # the next word further up
    assert down.y1 - down.y0 > 2 * (down.x1 - down.x0) and abs(down.y0 - (H - 500) * S) < 2
    assert flipped.x1 - flipped.x0 > 2 * (flipped.y1 - flipped.y0) and abs(flipped.x1 - 600 * S) < 2
    for w in found.values():
        assert ink(tmp_path / d.id / p.png, (w.x0, w.y0, w.x1, w.y1)) > 30, w


def test_the_caps_on_pages_and_size(tmp_path, store, monkeypatch):
    monkeypatch.setenv("IRIS_DRAWING_MAX_PAGES", "2")
    assert len(drawings.ingest(plan_pdf(pages=2), "two.pdf", tmp_path).pages) == 2
    with pytest.raises(drawings.DrawingError, match="has 3 pages; a drawing may have at most 2"):
        drawings.ingest(plan_pdf(pages=3), "three.pdf", tmp_path / "x")
    monkeypatch.setenv("IRIS_DRAWING_MAX_MB", "1")
    with pytest.raises(drawings.TooBig, match="big.pdf is over 1 MB"):
        drawings.ingest(b"%PDF-1.7\n" + b"0" * (1 << 20), "big.pdf", tmp_path / "x")
    assert not (tmp_path / "x").exists() or not any((tmp_path / "x").iterdir())   # nothing left behind


def test_a_very_large_sheet_renders_at_a_lower_dpi_within_the_pixel_cap(tmp_path, store):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(200 * 72, 200 * 72))   # 200 x 200 inches
    c.drawString(72, 72, "BIG")
    c.showPage()
    c.save()
    [p] = drawings.ingest(buf.getvalue(), "big.pdf", tmp_path).pages
    assert p.dpi < drawings.DPI and p.width_px * p.height_px <= drawings.MAX_PAGE_PIXELS * 1.01
    assert abs(p.width_px - 200 * p.dpi) <= 1 and p.has_text_layer


def test_not_a_pdf_a_damaged_one_and_a_password_protected_one_are_refused_in_words(tmp_path, store):
    with pytest.raises(drawings.DrawingError, match=r"notes\.pdf is not a PDF"):
        drawings.ingest(b"hello, not a drawing", "notes.pdf", tmp_path)
    with pytest.raises(drawings.DrawingError, match="could not be read as a PDF"):
        drawings.ingest(b"%PDF-1.7\nnothing else", "broken.pdf", tmp_path)
    with pytest.raises(drawings.DrawingError, match="password-protected"):
        drawings.ingest(plan_pdf(encrypt="secret"), "locked.pdf", tmp_path)
    assert not any(tmp_path.iterdir())


# ---------------------------------------------------------------------------------------------------- routes

@pytest.fixture
def scene(tmp_path, monkeypatch, store):
    ws = Workspace(tmp_path / "samples")
    monkeypatch.setattr(app_module, "ws", ws)
    sid = ws.open_paths([build_clash_fixture(tmp_path / "Clash.ifc")])
    return TestClient(app_module.app), ws, sid


def upload(client, sid, *files):
    return client.post(f"/api/scenes/{sid}/drawings", files=[("files", f) for f in files])


@dataclasses.dataclass
class FakeItem:   # the shape of drawing_reader.Item (docs/drawings.md)
    id: str
    page: int
    tag: str | None
    kind: str
    size: str | None
    size_mm: list[float] | None
    box: list[float]
    source: str
    status: str
    evidence: dict


def fake_reader(calls):
    def read_drawing(drawing, pages=None, *, model=None, folder=None):
        calls.append((drawing, pages, folder))
        items = []
        for p in pages if pages is not None else [p.index for p in drawing.pages]:
            yield {"type": "page", "page": p, "total": len(drawing.pages)}
            item = FakeItem(f"{drawing.id}-{p}", p, "D-7", "duct", "600x300", [600.0, 300.0], [208, 292, 351, 317],
                            "ai", "confirmed", {"words": ["D-7", "600x300"], "distance_px": 0})
            items.append(item)
            yield {"type": "item", "item": item}
        yield {"type": "done", "items": items, "cost_usd": 0.0}
    module = types.ModuleType("iris.drawing_reader")
    module.read_drawing = read_drawing
    return module


def ndjson(r) -> list[dict]:
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def test_upload_list_and_page_images(scene):
    client, ws, sid = scene
    r = upload(client, sid, ("plan.pdf", plan_pdf(pages=2), "application/pdf"), ("scan.pdf", scanned_pdf()))
    assert r.status_code == 200, r.text
    plan, scan = r.json()
    assert plan["name"] == "plan.pdf" and len(plan["pages"]) == 2 and plan["title"]["sheet"] == "M-201"
    assert plan["pages"][0]["has_text_layer"] and not scan["pages"][0]["has_text_layer"]
    w = next(w for w in plan["pages"][0]["words"] if w["text"] == "RTU-4")
    assert set(w) == {"text", "x0", "y0", "x1", "y1"} and abs(w["x0"] - 400 * S) < 1.5
    assert set(plan["pages"][0]) == {"index", "width_px", "height_px", "dpi", "png", "words", "has_text_layer"}
    assert client.get(f"/api/scenes/{sid}/drawings").json() == [plan, scan]

    png = client.get(f"/api/drawings/{plan['id']}/pages/1.png")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(png.content)).size == (plan["pages"][1]["width_px"], plan["pages"][1]["height_px"])
    assert client.get(f"/api/drawings/{plan['id']}/pages/2.png").status_code == 404
    assert client.get("/api/drawings/0123456789abcdef/pages/0.png").status_code == 404
    assert client.get("/api/scenes/nope/drawings").status_code == 404
    assert upload(client, "nope", ("plan.pdf", plan_pdf())).status_code == 404


def test_uploads_are_refused_in_words_and_keep_nothing(scene, monkeypatch):
    client, ws, sid = scene
    r = upload(client, sid, ("notes.txt", b"hello"))
    assert r.status_code == 400 and "not a PDF drawing" in r.json()["detail"]
    r = upload(client, sid, ("good.pdf", plan_pdf()), ("fake.pdf", b"hello"))
    assert r.status_code == 400 and r.json()["detail"] == "fake.pdf is not a PDF."
    r = upload(client, sid, ("locked.pdf", plan_pdf(encrypt="secret")))
    assert r.status_code == 400 and "password-protected" in r.json()["detail"]
    assert upload(client, sid, ("a.pdf", plan_pdf()), ("a.pdf", plan_pdf())).status_code == 400
    assert client.get(f"/api/scenes/{sid}/drawings").json() == []
    assert not any(p for p in drawings.STORE.root(sid).iterdir())   # the good file of a refused upload is gone too
    monkeypatch.setenv("IRIS_DRAWING_MAX_MB", "1")
    r = upload(client, sid, ("big.pdf", b"%PDF-1.7\n" + b"0" * (1 << 20)))
    assert r.status_code == 413 and r.json()["detail"] == "big.pdf is over 1 MB."
    monkeypatch.setenv("IRIS_DRAWING_MAX_PAGES", "1")
    r = upload(client, sid, ("two.pdf", plan_pdf(pages=2)))
    assert r.status_code == 400 and "at most 1" in r.json()["detail"]


def test_an_upload_is_one_model_upload_from_the_allowance(scene, monkeypatch):
    client, ws, sid = scene
    monkeypatch.setattr(app_module, "model_upload_limit", ProposeLimit(1, 0, noun="model uploads"))
    assert upload(client, sid, ("a.pdf", plan_pdf())).status_code == 200
    assert upload(client, sid, ("b.pdf", plan_pdf())).status_code == 429


def test_reading_streams_the_readers_events_and_keeps_its_items(scene, monkeypatch):
    client, ws, sid = scene
    plan = upload(client, sid, ("plan.pdf", plan_pdf(pages=2))).json()[0]
    did = plan["id"]
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", None)   # a build without the reader
    r = client.post(f"/api/drawings/{did}/read", json={})
    assert r.status_code == 501 and r.json()["detail"] == "reader not available"

    calls = []
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", fake_reader(calls))
    r = client.post(f"/api/drawings/{did}/read", json={}, headers={"Accept-Encoding": "gzip, deflate, br, zstd"})
    assert r.status_code == 200 and r.headers["content-encoding"] == "identity"
    assert r.headers["content-type"].startswith("application/x-ndjson")
    events = ndjson(r)
    assert [e["type"] for e in events] == ["page", "item", "page", "item", "done"]
    assert events[1]["item"]["tag"] == "D-7" and events[1]["item"]["size_mm"] == [600.0, 300.0]
    assert events[-1]["cost_usd"] == 0.0 and len(events[-1]["items"]) == 2
    drawing, pages, folder = calls[0]
    assert isinstance(drawing, drawings.Drawing) and drawing.id == did and pages is None
    assert (folder / drawing.pages[1].png).is_file()            # the reader is told where the page images are
    items = client.get(f"/api/drawings/{did}/items").json()
    assert [i["id"] for i in items] == [f"{did}-0", f"{did}-1"]

    # A read of one page replaces that page's items only.
    r = client.post(f"/api/drawings/{did}/read", json={"pages": [1]})
    assert [e["type"] for e in ndjson(r)] == ["page", "item", "done"] and calls[-1][1] == [1]
    assert sorted(i["page"] for i in client.get(f"/api/drawings/{did}/items").json()) == [0, 1]
    assert client.post(f"/api/drawings/{did}/read", json={"pages": [5]}).status_code == 400
    assert client.post(f"/api/drawings/{did}/read", json={"pages": []}).status_code == 400
    assert client.post("/api/drawings/0123456789abcdef/read", json={}).status_code == 404
    assert client.get("/api/drawings/0123456789abcdef/items").status_code == 404


def test_a_reader_failure_is_an_error_event(scene, monkeypatch):
    client, ws, sid = scene
    did = upload(client, sid, ("plan.pdf", plan_pdf())).json()[0]["id"]

    def broken(drawing, pages=None, *, model=None, folder=None):
        yield {"type": "page", "page": 0, "total": 1}
        raise RuntimeError("the day's budget is spent")
    module = types.ModuleType("iris.drawing_reader")
    module.read_drawing = broken
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", module)
    events = ndjson(client.post(f"/api/drawings/{did}/read", json={}))
    assert events[-1]["type"] == "error" and "budget is spent" in events[-1]["detail"]
    assert client.get(f"/api/drawings/{did}/items").json() == []


def test_compare_hands_the_model_and_every_read_item_to_the_comparison(scene, monkeypatch):
    client, ws, sid = scene
    did = upload(client, sid, ("plan.pdf", plan_pdf())).json()[0]["id"]
    monkeypatch.setitem(sys.modules, "iris.drawing_compare", None)
    r = client.get(f"/api/scenes/{sid}/drawings/compare")
    assert r.status_code == 501 and r.json()["detail"] == "comparison not available"

    monkeypatch.setitem(sys.modules, "iris.drawing_reader", fake_reader([]))
    client.post(f"/api/drawings/{did}/read", json={})

    @dataclasses.dataclass
    class Mismatch:
        kind: str
        item: str | None
        element: str | None
        drawing_value: str | None
        model_value: str | None
        evidence: dict
    seen = []

    def compare(scene_obj, items, storey=None, index=None):
        seen.append((scene_obj, items, storey, index))
        first = items[0]["id"]
        return {"matches": [{"item": first, "element": "GID", "by": "tag"}],
                "mismatches": [Mismatch("size_differs", first, "GID", "600x300", "500x300", {"by": "tag"}),
                               Mismatch("missing_in_drawing", None, "GONE", None, "SA-9", {}),
                               Mismatch("missing_in_drawing", None, "GID", None, "D-7", {})],
                "scope": {"storey": storey}}
    module = types.ModuleType("iris.drawing_compare")
    module.compare = compare
    module.model_index = lambda scene_obj: ["the index"]
    monkeypatch.setitem(sys.modules, "iris.drawing_compare", module)
    second = upload(client, sid, ("other.pdf", plan_pdf(title=False))).json()[0]["id"]   # read: no
    r = client.get(f"/api/scenes/{sid}/drawings/compare")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["matches"] == [{"item": f"{did}-0", "element": "GID", "by": "tag", "drawing": did}]
    assert body["mismatches"][0] == {"kind": "size_differs", "item": f"{did}-0", "element": "GID", "drawing": did,
                                     "drawing_value": "600x300", "model_value": "500x300", "evidence": {"by": "tag"}}
    # An element the drawings show is not missing from them; one they leave out is listed once.
    assert [(m["kind"], m["element"]) for m in body["mismatches"][1:]] == [("missing_in_drawing", "GONE")]
    assert body["drawings"] == [
        {"drawing": did, "name": "plan.pdf", "storey": "LEVEL 02", "read": True, "scope": {"storey": "LEVEL 02"}},
        {"drawing": second, "name": "other.pdf", "storey": None, "read": False, "scope": None}]
    [(scene_obj, items, storey, index)] = seen   # drawing by drawing; the unread one is not compared
    assert scene_obj is ws.scene(sid) and [i["tag"] for i in items] == ["D-7"]
    assert storey == "LEVEL 02" and index == ["the index"]
    assert client.get("/api/scenes/nope/drawings/compare").status_code == 404


def test_the_real_reader_and_comparison_run_through_the_routes_offline(scene, monkeypatch):
    """drawing_reader with its FakeReader (the sheet's own text, no model, no cost) and drawing_compare, end to end."""
    reader = pytest.importorskip("iris.drawing_reader")
    pytest.importorskip("iris.drawing_compare")
    client, ws, sid = scene
    did = upload(client, sid, ("plan.pdf", plan_pdf())).json()[0]["id"]

    def wrapped(**kw):
        module = types.ModuleType("iris.drawing_reader")
        module.read_drawing = lambda drawing, pages=None, *, folder=None: reader.read_drawing(
            drawing, pages, cache_dir=False, folder=folder, **kw)
        module.ReadRefused = reader.ReadRefused
        return module
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", wrapped(model=reader.FakeReader(), budget=None))
    events = ndjson(client.post(f"/api/drawings/{did}/read", json={}))
    assert events[0]["type"] == "page" and events[-1]["type"] == "done", events[-1]
    items = client.get(f"/api/drawings/{did}/items").json()
    assert items and all(i["page"] == 0 and len(i["box"]) == 4 for i in items)
    assert {"D-7", "RTU-4"} & {i["tag"] for i in items}
    r = client.get(f"/api/scenes/{sid}/drawings/compare")
    assert r.status_code == 200, r.text
    assert {"matches", "mismatches", "drawings"} <= set(r.json()) and r.json()["drawings"][0]["storey"] == "LEVEL 02"

    # A read the budget cannot cover is refused before the stream starts.
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", wrapped(model=reader.FakeReader(usd_per_call=1.0),
                                                                    budget=0.5))
    r = client.post(f"/api/drawings/{did}/read", json={})
    assert r.status_code == 429, r.text


def test_drawings_go_with_their_scene(tmp_path, monkeypatch, store):
    ws = Workspace(tmp_path / "samples", max_scenes=1)
    monkeypatch.setattr(app_module, "ws", ws)
    client = TestClient(app_module.app)
    first = ws.open_paths([build_clash_fixture(tmp_path / "A.ifc")])
    did = upload(client, first, ("plan.pdf", plan_pdf())).json()[0]["id"]
    folder = store.base / first
    assert (folder / did / "page-0.png").is_file()
    ws.open_paths([build_clash_fixture(tmp_path / "B.ifc")])   # the first scene is let go
    gc.collect()
    assert not folder.exists()                                  # its files go with its scene object
    assert client.get(f"/api/drawings/{did}/pages/0.png").status_code == 404
    assert did not in store.drawings and first not in store.scenes


def test_the_level_is_taken_from_the_title_as_printed():
    assert drawings.storey_of({"title": "LEVEL 02 MEP PLAN"}) == "LEVEL 02"
    assert drawings.storey_of({"title": "Mechanical plan L3 east"}) == "L3"
    assert drawings.storey_of({"title": "GROUND FLOOR LIGHTING"}) == "GROUND FLOOR"
    assert drawings.storey_of({"title": "SCHEDULES", "sheet": "L02"}) is None
    assert drawings.storey_of({}) is None


def test_prune_forgets_the_drawings_of_scenes_no_longer_open(tmp_path, store):
    d = drawings.ingest(plan_pdf(), "p.pdf", store.root("aaaa"))
    store.add("aaaa", d)
    store.prune(["bbbb"])
    assert store.list("aaaa") == [] and not (store.base / "aaaa").exists()


# ---------------------------------------------------------------------------------------------------- sample drawings

SAMPLE_SHEETS = Path(__file__).resolve().parents[2] / "samples" / "drawings"


def test_the_sample_building_lists_its_sample_drawings():
    from iris import demos
    northbank = ["Northbank-Architecture.ifc", "Northbank-MEP.ifc", "Northbank-Site.ifc", "Northbank-Structure.ifc"]
    [listed] = demos.listing(northbank, ["northbank-m-201.pdf", "Other.pdf"])
    assert listed["id"] == "northbank" and listed["drawings"] == ["northbank-m-201.pdf"]   # those there are, as named
    assert demos.drawings_for(["Northbank-MEP.ifc"]) == ("Northbank-M-201.pdf", "Northbank-M-201-mismatch.pdf")
    assert demos.drawings_for(["Clash.ifc"]) == () and demos.drawings_for([]) == ()
    assert {"Northbank-M-201.pdf", "Northbank-M-201-mismatch.pdf"} <= set(drawings.sample_names(SAMPLE_SHEETS.parent))


def test_the_shipped_sample_sheets_have_current_saved_readings(tmp_path):
    """Each sample sheet's saved reading is of that very PDF, with the reader's prompt as it is now, at its page size:
    a visitor's read replays it for nothing. A prompt change makes them stale (the read would call the model for every
    visitor): make them again with evals/save_drawing_readings.py."""
    from iris import drawing_reader as dr
    from iris import demos
    for name in demos.drawings_for(["Northbank-MEP.ifc"]):
        d = drawings.ingest((SAMPLE_SHEETS / name).read_bytes(), name, tmp_path)
        info = dr.saved_info(d)
        assert info is not None, f"{name}: no current saved reading (cd server && uv run python ../evals/save_drawing_readings.py)"
        assert info["label"].startswith("Gemini")


@pytest.fixture
def sample_scene(tmp_path, monkeypatch, store):
    """A scene the sample building's set names (a small fixture model saved as Northbank-MEP.ifc), the two sample
    sheets in its samples folder, and a saved reading of each (made with the offline reader) where the server looks."""
    import shutil as sh
    from iris import drawing_reader as dr
    samples = tmp_path / "samples"
    (samples / "drawings").mkdir(parents=True)
    for name in ("Northbank-M-201.pdf", "Northbank-M-201-mismatch.pdf"):
        sh.copy(SAMPLE_SHEETS / name, samples / "drawings" / name)
        d = drawings.ingest((SAMPLE_SHEETS / name).read_bytes(), name, tmp_path / "made")
        list(dr.read_drawing(d, model=dr.FakeReader(model="gemini-3.8-flash"), cache_dir=tmp_path / "cache",
                             folder=drawings.folder_of(d), saved=False))
        dr.write_saved(d, tmp_path / "saved" / f"{Path(name).stem}.reading.json", model="gemini-3.8-flash",
                       cache_dir=tmp_path / "cache")
    monkeypatch.setattr(dr, "SAVED", tmp_path / "saved")
    ws = Workspace(samples)
    monkeypatch.setattr(app_module, "ws", ws)
    sid = ws.open_paths([build_clash_fixture(tmp_path / "Northbank-MEP.ifc")])
    return TestClient(app_module.app), ws, sid


def test_the_sample_drawings_attach_once_and_read_from_their_saved_reading_with_no_model_call(sample_scene,
                                                                                               monkeypatch):
    from iris import drawing_reader as dr

    def no_model(*a, **kw):
        raise AssertionError("the model was called")
    monkeypatch.setattr(dr.GeminiReader, "read", no_model)
    monkeypatch.setattr(dr.model_client, "make_client", no_model)
    client, ws, sid = sample_scene
    r = client.post(f"/api/scenes/{sid}/drawings/samples")
    assert r.status_code == 200, r.text
    attached = r.json()
    assert [d["name"] for d in attached] == ["Northbank-M-201.pdf", "Northbank-M-201-mismatch.pdf"]
    assert all(d["title"]["sheet"] == "M-201" and len(d["pages"]) == 1 for d in attached)
    assert all(d["saved_reading"]["label"] == "Gemini 3.8 Flash" for d in attached)
    again = client.post(f"/api/scenes/{sid}/drawings/samples").json()     # held already: not attached twice
    assert [d["id"] for d in again] == [d["id"] for d in attached]
    listed = client.get(f"/api/scenes/{sid}/drawings").json()
    assert [d["id"] for d in listed] == [d["id"] for d in attached] and listed[0]["saved_reading"]
    assert client.get(f"/api/drawings/{attached[1]['id']}/pages/0.png").status_code == 200

    events = ndjson(client.post(f"/api/drawings/{attached[1]['id']}/read", json={},
                                headers={"Accept-Encoding": "gzip, deflate, br, zstd"}))
    assert events[0]["type"] == "page" and events[0]["saved"] is True
    done = events[-1]
    assert done["type"] == "done" and done["cost_usd"] == 0 and done["saved"]["label"] == "Gemini 3.8 Flash"
    items = client.get(f"/api/drawings/{attached[1]['id']}/items").json()
    assert items and all("saved_reading" in i["evidence"] for i in items if i["source"] == "ai")


def test_sample_drawings_only_go_with_the_sample_building(sample_scene, tmp_path):
    client, ws, sid = sample_scene
    other = ws.open_paths([build_clash_fixture(tmp_path / "Clash.ifc")])
    r = client.post(f"/api/scenes/{other}/drawings/samples")
    assert r.status_code == 409 and "sample building" in r.json()["detail"]
    assert client.get(f"/api/scenes/{other}/drawings").json() == []
    assert client.post("/api/scenes/nope/drawings/samples").status_code == 404


def test_an_uploaded_drawing_has_no_saved_reading_unless_it_is_a_sample_sheet(sample_scene, tmp_path, monkeypatch):
    from iris import drawing_reader as dr
    client, ws, sid = sample_scene
    [plain] = upload(client, sid, ("plan.pdf", plan_pdf())).json()
    assert plain["saved_reading"] is None
    [same] = upload(client, sid, ("copy.pdf", (SAMPLE_SHEETS / "Northbank-M-201.pdf").read_bytes())).json()
    assert same["saved_reading"]["model"] == "gemini-3.8-flash"     # the very same file: its saved reading is honest

    # A read of the plain upload goes to the model (no saved reading to replay), and nothing says "saved".
    calls = []

    def live(self, page, images, system, text, schema):
        calls.append(page.index)
        return {"items": [], "title": None}, {"model": self.model, "usd": 0.0}
    monkeypatch.setattr(dr.GeminiReader, "read", live)
    monkeypatch.setattr(dr, "CACHE", tmp_path / "live-cache")       # no reply cached by an earlier run
    events = ndjson(client.post(f"/api/drawings/{plain['id']}/read", json={},
                                headers={"Accept-Encoding": "gzip, deflate, br, zstd"}))
    assert calls == [0]
    assert events[0]["type"] == "page" and events[0]["saved"] is False
    done = events[-1]
    assert done["type"] == "done" and done["saved"] is None
    assert not any("saved_reading" in i["evidence"] for i in client.get(f"/api/drawings/{plain['id']}/items").json())


def test_two_issues_of_one_sheet_are_each_compared_whole():
    """An element left out of one drawing is not missing when another sheet shows it; when the other drawing is the
    same sheet (its sheet number), it is still missing from this one."""
    def held(*sheets):
        return [drawings.Drawing(id=f"d{i}", name=f"{i}.pdf", sha256=str(i), pages=[], title=t)
                for i, t in enumerate(sheets)]

    def compare(scene, items, storey=None, index=None):
        if items[0] == "shows":
            return {"matches": [{"item": "i1", "element": "GID", "by": "tag"}], "mismatches": []}
        return {"matches": [], "mismatches": [{"kind": "missing_in_drawing", "item": None, "element": "GID",
                                               "drawing_value": None, "model_value": "SA-1", "evidence": {}}]}
    items = {"d0": ["shows"], "d1": ["leaves out"]}.get

    def missing(sheets):
        out = drawings.compare_scene(None, held(*sheets), items, compare)
        return [(m["kind"], m["drawing"]) for m in out["mismatches"]]
    assert missing([{"sheet": "M-201"}, {"sheet": "M 201"}]) == [("missing_in_drawing", "d1")]   # one sheet, twice
    assert missing([{"sheet": "M-201"}, {"sheet": "M-202"}]) == []                                # another sheet
    assert missing([{}, {}]) == []                                                                # no numbers
    assert missing([{"drawing_no": "NB-1"}, {"drawing_no": "nb-1"}]) == [("missing_in_drawing", "d1")]


# ---------------------------------------------------------------------------------------------------- projects

def test_a_project_keeps_its_drawings_and_their_items_and_brings_them_back(scene, tmp_path, monkeypatch):
    client, ws, sid = scene
    monkeypatch.setenv("IRIS_PROJECTS_DIR", str(tmp_path / "projects"))
    monkeypatch.setattr(app_module, "_classifier", lambda: None)
    data = plan_pdf()
    did = upload(client, sid, ("plan.pdf", data)).json()[0]["id"]
    monkeypatch.setitem(sys.modules, "iris.drawing_reader", fake_reader([]))
    client.post(f"/api/drawings/{did}/read", json={})

    pid = client.post("/api/projects", json={"name": "Drawings"}).json()["id"]
    p = client.post(f"/api/projects/{pid}/attach", json={"scene_id": sid}).json()
    import hashlib
    sha = hashlib.sha256(data).hexdigest()
    assert p["drawings"] == [{"name": "plan.pdf", "sha256": sha, "size": len(data), "pages": 1, "items": 1}]
    kept = tmp_path / "projects" / pid / "drawings"
    assert (kept / f"{sha}.pdf").read_bytes() == data
    assert json.loads((kept / f"{sha}.items.json").read_text())[0]["tag"] == "D-7"
    assert client.post(f"/api/projects/{pid}/save", json={"scene_id": sid}).json()["drawings"] == p["drawings"]

    opened = client.post(f"/api/projects/{pid}/open").json()
    new = opened["scene_id"]
    assert new != sid
    [back] = client.get(f"/api/scenes/{new}/drawings").json()
    assert back["sha256"] == sha and back["name"] == "plan.pdf" and back["id"] != did
    assert back["title"]["sheet"] == "M-201"
    assert [i["tag"] for i in client.get(f"/api/drawings/{back['id']}/items").json()] == ["D-7"]
    assert client.get(f"/api/drawings/{back['id']}/pages/0.png").status_code == 200
