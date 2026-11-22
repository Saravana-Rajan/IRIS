"""2D drawings (docs/drawings.md): PDF sheets taken in for the drawing reader, kept per scene.

`ingest` renders each page to a PNG with pypdfium2 (at `DPI`, lower only for a page too big to hold at it) and reads
its exact text layer with pdfplumber: every word with its box in pixels on the rendered page (origin top-left). A
title block is looked for in each sheet's bottom-right quarter (SHEET / SCALE / TITLE / DRAWING NO.): what is printed
there is recorded, nothing is guessed. A scanned PDF has no text layer (`Page.has_text_layer` False); the reader then
marks everything it reads "AI-read: check".

`STORE` holds each scene's drawings in memory, their files in a folder of the scene's own under `ROOT`
(`<scene id>/<drawing id>/source.pdf` and `page-<index>.png`). They go with the scene: when the scene object is let go
(an eviction) its folder is deleted, and every call first sweeps the drawings of scenes no longer open (`prune`).
Projects copy the PDFs (and the last read items) into their own `drawings/` folder (projects.py).

Licences: pypdfium2 (Apache-2.0 / BSD-3), pdfplumber (MIT). Never PyMuPDF (AGPL).
"""
from __future__ import annotations

import collections
import dataclasses
import hashlib
import io
import logging
import math
import re
import secrets
import shutil
import tempfile
import threading
import weakref
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import pdfplumber
import pypdfium2 as pdfium
from pdfplumber.utils.text import WordExtractor

from .limits import env_int

log = logging.getLogger(__name__)

DPI = 150
MAX_PAGE_PIXELS = 50_000_000   # an A0 sheet at 150 dpi is 35 MP; a bigger page renders at a lower dpi (its own `dpi`)
MAX_FILES = 10                 # PDFs in one upload
MAX_PER_SCENE = 30             # drawings one scene holds
ROOT = Path(tempfile.gettempdir()) / "iris-drawings"
ID = re.compile(r"[0-9a-f]{16}")
_PDFIUM = threading.Lock()      # PDFium is not thread-safe: one call into it at a time


def max_pages() -> int:
    """Pages one PDF may have (IRIS_DRAWING_MAX_PAGES, default 40); read on each call."""
    return env_int("IRIS_DRAWING_MAX_PAGES", 40)


def max_mb() -> int:
    """Megabytes one PDF may have (IRIS_DRAWING_MAX_MB, default 50); read on each call."""
    return env_int("IRIS_DRAWING_MAX_MB", 50)


class DrawingError(ValueError):
    """A file Iris cannot take as a drawing: not a PDF, password-protected, no pages, too many pages (a 400, its
    words for the user)."""


class TooBig(DrawingError):
    """A PDF over IRIS_DRAWING_MAX_MB (a 413)."""


@dataclass
class Word:
    text: str
    x0: float   # pixels on the rendered page, origin top-left
    y0: float
    x1: float
    y1: float


@dataclass
class Page:
    index: int            # 0-based position in the PDF; the image is `page-<index>.png`, GET .../pages/<index>.png
    width_px: int
    height_px: int
    dpi: int
    png: str              # path relative to the drawing's folder
    words: list[Word] = field(default_factory=list)
    has_text_layer: bool = False


@dataclass
class Drawing:
    id: str
    name: str
    sha256: str
    pages: list[Page]
    title: dict           # title block fields found on the first sheet that has one: sheet, scale, title, drawing_no

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


# ---------------------------------------------------------------------------------------------------- ingest

def ingest(pdf_bytes: bytes, name: str, root: Path) -> Drawing:
    """Take one PDF in: its hash, each page rendered to `root/<id>/page-<index>.png`, its text layer in pixels, the
    title block. The PDF is kept as `root/<id>/source.pdf`. DrawingError (TooBig) for a file that is not a readable
    PDF or is past the caps; nothing is left on disk then. PDFium is not thread-safe: every call into it holds
    `_PDFIUM` (uploads render one at a time; pdfplumber reads the text layer outside it)."""
    name = Path(str(name or "drawing.pdf")).name or "drawing.pdf"
    cap = max_mb()
    if len(pdf_bytes) > cap << 20:
        raise TooBig(f"{name} is over {cap} MB.")
    if b"%PDF-" not in pdf_bytes[:1024]:
        raise DrawingError(f"{name} is not a PDF.")
    with _PDFIUM:
        try:
            doc = pdfium.PdfDocument(pdf_bytes)
        except pdfium.PdfiumError as e:
            if getattr(e, "err_code", None) in (pdfium.raw.FPDF_ERR_PASSWORD, pdfium.raw.FPDF_ERR_SECURITY):
                raise DrawingError(f"{name} is password-protected: save it without a password and upload it "
                                   "again.") from None
            raise DrawingError(f"{name} could not be read as a PDF (it may be damaged).") from None
        count = len(doc)
    did = secrets.token_hex(8)
    folder = Path(root) / did
    made = False
    try:
        if count == 0:
            raise DrawingError(f"{name} has no pages.")
        most = max_pages()
        if most and count > most:
            raise DrawingError(f"{name} has {count} pages; a drawing may have at most {most}.")
        folder.mkdir(parents=True)
        made = True
        (folder / "source.pdf").write_bytes(pdf_bytes)
        texts = _text_layers(pdf_bytes, count, name)
        pages = []
        for i in range(count):
            with _PDFIUM:
                page = doc[i]
                try:
                    pages.append(_render(page, i, folder, texts[i]))
                finally:
                    page.close()
    except BaseException:
        if made:
            shutil.rmtree(folder, ignore_errors=True)
        raise
    finally:
        with _PDFIUM:
            doc.close()
    title: dict = {}
    for p in pages:
        title = title_block(p.words, p.width_px, p.height_px)
        if title:
            break
    drawing = Drawing(id=did, name=name, sha256=hashlib.sha256(pdf_bytes).hexdigest(), pages=pages, title=title)
    drawing.folder = folder   # not a field (not sent to the page): where its PNGs and PDF are (`page_path`)
    return drawing


def folder_of(drawing: Drawing) -> Path:
    """The folder that holds a drawing's PNGs and PDF: where it was ingested, else where the store keeps it."""
    return Path(getattr(drawing, "folder", None) or STORE.folder(drawing.id))


def page_path(drawing: Drawing, index: int) -> Path:
    """The PNG of a drawing's page (`Page.index`): in the folder it was ingested into, else where the store keeps it.
    IndexError: no such page."""
    if not 0 <= index < len(drawing.pages):
        raise IndexError(index)
    return folder_of(drawing) / drawing.pages[index].png


def _render(page, index: int, folder: Path, text) -> Page:
    """One page as a PNG at DPI (lower when it would be over MAX_PAGE_PIXELS), its words placed on that image."""
    w_pt, h_pt = page.get_size()
    dpi = DPI
    if w_pt * h_pt * (dpi / 72) ** 2 > MAX_PAGE_PIXELS:
        dpi = max(1, int(72 * math.sqrt(MAX_PAGE_PIXELS / (w_pt * h_pt))))
    bitmap = page.render(scale=dpi / 72)
    try:
        image = bitmap.to_pil()
        png = f"page-{index}.png"
        image.save(folder / png, format="PNG", optimize=False)
        width, height = image.size
    finally:
        bitmap.close()
    words = _place(text, width, height) if text else []
    return Page(index=index, width_px=width, height_px=height, dpi=dpi, png=png, words=words,
                has_text_layer=bool(words))


def _text_layers(pdf_bytes: bytes, count: int, name: str) -> list:
    """Each page's words as pdfplumber reads them (points, top-left) with the page's crop box; None for a page whose
    text layer could not be read (treated as having none: every item read on it is then 'AI-read: check')."""
    out: list = [None] * count
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i, p in enumerate(pdf.pages[:count]):
                try:
                    out[i] = (_words_of(p), p.cropbox)
                except Exception as e:   # a damaged content stream: the page still renders
                    log.warning("drawing %s page %d: text layer not read (%s: %s)", name, i, type(e).__name__, e)
    except Exception as e:   # pdfminer cannot parse what PDFium can render
        log.warning("drawing %s: text layer not read (%s: %s)", name, type(e).__name__, e)
    return out


# Characters → words. pdfplumber's default groups characters into lines by height, chaining every top within 3 pt of
# the next: on a dense sheet labels a little offset from each other chain into one "line" taller than a line of text,
# two lines of one label interleave and their tags come out in pieces (6 of the 107 on the Northbank sample before its
# labels were snapped to one pitch). Words are taken instead in the order the PDF draws them (text flow): a word ends
# at a blank, where the next character jumps back, leaves a gap wider than WORD_GAP of the text height, or steps off
# its line by more than LINE_STEP of it. Each direction of text is read on its own and in its own direction (pdfplumber
# reads text flow left to right only), so a label turned along a vertical run comes out whole and in reading order.
WORD_GAP = 0.25    # of the text height: wider than kerning, narrower than a word space
LINE_STEP = 0.4    # of the text height: a superscript stays in its word, the next line does not


def _direction(char: dict) -> str:
    """Which way a character's line of text runs on the page: ltr, rtl (upside down), btt (turned anticlockwise, read
    up the sheet) or ttb (turned clockwise)."""
    a, b = (char.get("matrix") or (1, 0))[:2]   # the baseline's direction in PDF space (y up)
    if abs(a) >= abs(b):
        return "ltr" if a >= 0 else "rtl"
    return "btt" if b > 0 else "ttb"


def _words_of(page) -> list[dict]:
    """A page's words as pdfplumber's dicts (points, origin top-left), read in text flow, each direction on its own."""
    by_dir: dict[str, list[dict]] = {}
    for c in page.chars:
        d = _direction(c)
        height = c["height"] if d in ("ltr", "rtl") else c["width"]   # pdfminer's `size` is along the page's y
        by_dir.setdefault(d, []).append({**c, "size": max(float(height), 0.5)})
    words: list[dict] = []
    for d, chars in by_dir.items():
        turned = d in ("btt", "ttb")   # pdfplumber's x/y tolerances swap for vertical text
        words.extend(WordExtractor(
            use_text_flow=True, keep_blank_chars=False, char_dir=d, line_dir="ltr" if turned else "ttb",
            x_tolerance_ratio=LINE_STEP if turned else WORD_GAP,
            y_tolerance_ratio=WORD_GAP if turned else LINE_STEP).extract_words(chars))
    return words


def _place(text, width: int, height: int) -> list[Word]:
    """pdfplumber's words (points from the top-left of the media box) as pixels on the rendered crop box."""
    words, (cx0, ctop, cx1, cbottom) = text
    sx, sy = width / max(cx1 - cx0, 1e-9), height / max(cbottom - ctop, 1e-9)
    out = []
    for w in words:
        t = str(w.get("text", "")).strip()
        if not t:
            continue
        x0, y0 = (float(w["x0"]) - cx0) * sx, (float(w["top"]) - ctop) * sy
        x1, y1 = (float(w["x1"]) - cx0) * sx, (float(w["bottom"]) - ctop) * sy
        if x1 <= 0 or y1 <= 0 or x0 >= width or y0 >= height:   # outside the visible sheet
            continue
        out.append(Word(t, round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)))
    return out


# ---------------------------------------------------------------------------------------------------- title block

# Normalised label words (letters and digits only, upper case) → field; longest first. A label counts only at the
# start of a text run (a cell of the title block), so "COVER SHEET" in a title is not a sheet label.
LABELS: list[tuple[tuple[str, ...], str]] = sorted([
    (("DRAWING", "NO"), "drawing_no"), (("DRAWING", "NUMBER"), "drawing_no"), (("DWG", "NO"), "drawing_no"),
    (("DRAWING", "TITLE"), "title"), (("SHEET", "TITLE"), "title"), (("TITLE",), "title"),
    (("SHEET", "NO"), "sheet"), (("SHEET", "NUMBER"), "sheet"), (("SHEET",), "sheet"),
    (("SCALE",), "scale"),
], key=lambda kv: -len(kv[0]))


def _norm(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def _label(tokens: list[str]) -> tuple[str, int] | None:
    """The field a run of words starts with, and how many words the label takes; None when it starts with none."""
    norm = [_norm(t) for t in tokens]
    for words, name in LABELS:
        k = len(words)
        if tuple(norm[:k]) == words:
            return name, k
        if norm and norm[0] == "".join(words):   # "DWG.NO." as one word
            return name, 1
    return None


def _runs(words: list[Word]) -> list[list[Word]]:
    """Words grouped into lines (by vertical centre), each line split into runs at gaps wider than its text height."""
    lines: list[list[Word]] = []
    for w in sorted(words, key=lambda w: ((w.y0 + w.y1) / 2, w.x0)):
        h = max(w.y1 - w.y0, 1.0)
        mid = (w.y0 + w.y1) / 2
        for line in lines:
            ref = line[0]
            if abs((ref.y0 + ref.y1) / 2 - mid) < 0.5 * max(ref.y1 - ref.y0, h):
                line.append(w)
                break
        else:
            lines.append([w])
    runs = []
    for line in lines:
        line.sort(key=lambda w: w.x0)
        run = [line[0]]
        for w in line[1:]:
            gap = w.x0 - run[-1].x1
            if gap > 1.5 * max(run[-1].y1 - run[-1].y0, w.y1 - w.y0):
                runs.append(run)
                run = [w]
            else:
                run.append(w)
        runs.append(run)
    return runs


def _box(run: list[Word]) -> tuple[float, float, float, float]:
    return min(w.x0 for w in run), min(w.y0 for w in run), max(w.x1 for w in run), max(w.y1 for w in run)


def _value(tokens: list[str]) -> str:
    return " ".join(tokens).lstrip(":-–— ").strip()


def title_block(words: list[Word], width: float, height: float) -> dict:
    """The title block's fields printed in the sheet's bottom-right quarter: {sheet, scale, title, drawing_no}, each
    only when its label is there with a value beside it (the rest of its run, else the next run on its line) or
    under it (the nearest run below, starting near the label). Nothing is guessed: no label, no field."""
    corner = [w for w in words if (w.x0 + w.x1) / 2 >= width / 2 and (w.y0 + w.y1) / 2 >= height / 2]
    if not corner:
        return {}
    runs = _runs(corner)
    found: dict[str, str] = {}
    for run in runs:
        tokens = [w.text for w in run]
        hit = _label(tokens)
        if hit is None or hit[0] in found:
            continue
        name, k = hit
        value = _value(tokens[k:])
        if not value:
            value = _beside(run, runs) or _below(run, runs)
        if value:
            found[name] = value
    return found


def _beside(label: list[Word], runs: list[list[Word]]) -> str:
    """The next run to the right on the label's line, when it is not a label itself."""
    x0, y0, x1, y1 = _box(label)
    mid, h = (y0 + y1) / 2, y1 - y0
    best = None
    for run in runs:
        bx0, by0, bx1, by1 = _box(run)
        if run is label or bx0 < x1 or abs((by0 + by1) / 2 - mid) > 0.5 * max(h, by1 - by0):
            continue
        if bx0 - x1 > 12 * max(h, 1.0):
            continue
        if best is None or bx0 < _box(best)[0]:
            best = run
    if best is None or _label([w.text for w in best]):
        return ""
    return _value([w.text for w in best])


def _below(label: list[Word], runs: list[list[Word]]) -> str:
    """The nearest run under the label (within four text heights), starting near its left edge, not a label."""
    x0, y0, x1, y1 = _box(label)
    h = max(y1 - y0, 1.0)
    best = None
    for run in runs:
        bx0, by0, bx1, by1 = _box(run)
        if run is label or by0 < y1 - 0.25 * h or by0 - y1 > 4 * h:
            continue
        if bx1 < x0 - 2 * h or bx0 > x0 + max(x1 - x0, 2 * h):
            continue
        if best is None or by0 < _box(best)[1]:
            best = run
    if best is None or _label([w.text for w in best]):
        return ""
    return _value([w.text for w in best])


# ---------------------------------------------------------------------------------------------------- store

class Store:
    """Each open scene's drawings and their last read items, in memory; their files under `base/<scene id>/`.

    A scene's drawings go when the scene does: `watch` deletes the scene's folder once its scene object is let go (an
    eviction), and every call first forgets the drawings of such scenes; `prune(live)` drops any scene not in `live`."""

    def __init__(self, base: Path = ROOT):
        self.base = Path(base)
        self.lock = threading.RLock()
        self.scenes: dict[str, list[str]] = {}       # scene id → drawing ids, in upload order
        self.drawings: dict[str, Drawing] = {}
        self.scene_of: dict[str, str] = {}           # drawing id → scene id
        self.items: dict[str, list] = {}             # drawing id → the items of its last read
        self._watched: set[str] = set()
        self._gone: collections.deque[str] = collections.deque()   # scenes let go, still to forget

    def root(self, scene_id: str) -> Path:
        """The scene's own folder for drawings (made on first use)."""
        folder = self.base / scene_id
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def watch(self, scene_id: str, scene: object) -> None:
        """Delete the scene's drawings once `scene` (the scene object) is garbage: it was evicted or closed."""
        with self.lock:
            if scene_id in self._watched:
                return
            self._watched.add(scene_id)
        weakref.finalize(scene, _let_go, self._gone, self.base / scene_id, scene_id)

    def _sweep(self) -> None:
        while self._gone:
            self._forget(self._gone.popleft())

    def _forget(self, scene_id: str) -> None:
        with self.lock:
            for did in self.scenes.pop(scene_id, []):
                self.drawings.pop(did, None)
                self.scene_of.pop(did, None)
                self.items.pop(did, None)
            self._watched.discard(scene_id)
        shutil.rmtree(self.base / scene_id, ignore_errors=True)

    def prune(self, live: Iterable[str]) -> None:
        """Forget (and delete) the drawings of every scene not in `live` (the scenes open now)."""
        live = set(live)
        self._sweep()
        with self.lock:
            stale = [sid for sid in self.scenes if sid not in live]
        for sid in stale:
            self._forget(sid)

    def room(self, scene_id: str) -> int:
        """How many more drawings the scene may hold."""
        self._sweep()
        with self.lock:
            return max(0, MAX_PER_SCENE - len(self.scenes.get(scene_id, [])))

    def add(self, scene_id: str, drawing: Drawing) -> Drawing:
        self._sweep()
        with self.lock:
            self.scenes.setdefault(scene_id, []).append(drawing.id)
            self.drawings[drawing.id] = drawing
            self.scene_of[drawing.id] = scene_id
        return drawing

    def discard(self, scene_id: str, drawing_id: str) -> None:
        """Remove one drawing (an upload that failed part-way) and its files."""
        with self.lock:
            ids = self.scenes.get(scene_id, [])
            if drawing_id in ids:
                ids.remove(drawing_id)
            self.drawings.pop(drawing_id, None)
            self.scene_of.pop(drawing_id, None)
            self.items.pop(drawing_id, None)
        shutil.rmtree(self.base / scene_id / drawing_id, ignore_errors=True)

    def list(self, scene_id: str) -> list[Drawing]:
        self._sweep()
        with self.lock:
            return [self.drawings[d] for d in self.scenes.get(scene_id, []) if d in self.drawings]

    def get(self, drawing_id: str) -> Drawing:
        """The drawing (KeyError when no open scene holds it)."""
        self._sweep()
        with self.lock:
            return self.drawings[drawing_id]

    def scene(self, drawing_id: str) -> str:
        self._sweep()
        with self.lock:
            return self.scene_of[drawing_id]

    def folder(self, drawing_id: str) -> Path:
        return self.base / self.scene(drawing_id) / drawing_id

    def page_png(self, drawing_id: str, index: int) -> Path:
        """A page's image (KeyError: no such drawing; IndexError: no such page)."""
        return page_path(self.get(drawing_id), index)

    def pdf(self, drawing_id: str) -> Path:
        return self.folder(drawing_id) / "source.pdf"

    def set_items(self, drawing_id: str, items: list) -> None:
        with self.lock:
            if drawing_id in self.drawings:
                self.items[drawing_id] = list(items)

    def items_of(self, drawing_id: str) -> list:
        """The items of the drawing's last read ([] before one). KeyError: no such drawing."""
        self.get(drawing_id)
        with self.lock:
            return list(self.items.get(drawing_id, []))

    def scene_items(self, scene_id: str) -> list:
        """Every item read on the scene's drawings, drawing by drawing."""
        out = []
        for d in self.list(scene_id):
            with self.lock:
                out.extend(self.items.get(d.id, []))
        return out


def _let_go(gone: collections.deque, folder: Path, scene_id: str) -> None:
    """A scene object was garbage-collected: delete its drawings' files now, forget them on the store's next call (a
    finalizer may run anywhere, so it never takes the store's lock)."""
    shutil.rmtree(folder, ignore_errors=True)
    gone.append(scene_id)


# A level as a title says it: "LEVEL 02", "L02", "LVL 3", "FLOOR 1", or a named one.
LEVEL = re.compile(r"\b(?:(?:LEVEL|LVL|STOREY|FLOOR)\s*[-.]?\s*\d{1,3}|L\s*-?\s*\d{1,3}|GROUND\s+(?:FLOOR|LEVEL)"
                   r"|BASEMENT(?:\s*\d{1,2})?|MEZZANINE|ROOF)\b", re.I)


def storey_of(title: dict) -> str | None:
    """The level a drawing's title block names in its title ("LEVEL 02 MEP PLAN" → "LEVEL 02"), as printed; None when
    it names none."""
    m = LEVEL.search(str((title or {}).get("title") or ""))
    return re.sub(r"\s+", " ", m.group(0)).strip() if m else None


def compare_scene(scene, held: list[Drawing], items_of, compare, model_index=None) -> dict:
    """Each read drawing's items against the model, drawing by drawing (`compare(scene, items, storey=, index=)`),
    with the level from its title block (`storey_of`) and the model's index built once. Every match, mismatch and
    unmatched item carries its `drawing`; an element one drawing leaves out but another shows is not missing, and one
    left out by several is listed once. `drawings`: each drawing's level and the comparison's scope; a drawing not
    read yet is listed with `read` False and compared with nothing."""
    index = model_index(scene) if model_index is not None else None
    out: dict = {"matches": [], "mismatches": [], "unmatched": [], "drawings": []}
    for d in held:
        items = items_of(d.id)
        storey = storey_of(d.title)
        row = {"drawing": d.id, "name": d.name, "storey": storey, "read": bool(items), "scope": None}
        out["drawings"].append(row)
        if not items:
            continue
        kwargs = {"storey": storey} if index is None else {"storey": storey, "index": index}
        result = plain(compare(scene, items, **kwargs))
        row["scope"] = result.get("scope")
        for key in ("matches", "mismatches", "unmatched"):
            out[key].extend({**r, "drawing": d.id} for r in result.get(key) or [] if isinstance(r, dict))
    shown = {m.get("element") for m in out["matches"] if m.get("element")}
    listed: set = set()
    mismatches = []
    for m in out["mismatches"]:
        if m.get("kind") == "missing_in_drawing":
            if m.get("element") in shown or m.get("element") in listed:
                continue
            listed.add(m.get("element"))
        mismatches.append(m)
    out["mismatches"] = mismatches
    return out


def item_page(item) -> int | None:
    """An item's page (`Item.page`), whether it is an Item or a plain dict."""
    page = item.get("page") if isinstance(item, dict) else getattr(item, "page", None)
    return page if isinstance(page, int) and not isinstance(page, bool) else None


def merge_items(old: list, new: list, pages: list[int] | None) -> list:
    """A drawing's items after a read of `pages` (None: every page): the new ones, plus the old ones of pages this read
    did not cover."""
    if pages is None:
        return list(new)
    covered = set(pages)
    return [i for i in old if item_page(i) not in covered] + list(new)


def plain(value):
    """Dataclasses (an Item, a Mismatch) as plain dicts, recursively, for JSON."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return dataclasses.asdict(value)
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    return value


STORE = Store()
