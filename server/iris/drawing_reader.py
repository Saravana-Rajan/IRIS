"""The 2D drawing reader (docs/drawings.md): Gemini reads each sheet, the PDF's own text layer checks what it read.

AI reads, data checks, the engineer decides. Per page:

1. **Read** (`GeminiReader`, the fast model): the page PNG goes to Gemini at `media_resolution` HIGH with a strict JSON
   schema (`schema`), each image after an "Image k:" label and the instructions last. A large sheet (longest side over
   `TILE_ABOVE_PX`) also sends its four quarters (`tiles`: 2 x 2, overlapping by `TILE_OVERLAP`), so small labels are
   read at full detail; each item names the image its box is on, and `to_page` maps that box back to page pixels.
   The prompt is `domain_packs/drawing_reader.md`: read only what is printed, never guess, copy text exactly. The page's
   text layer is never sent: it is the check, so the model must not see it.
2. **Reconcile** (`reconcile`, no AI): each item's tag and size are looked for in the page's text layer within a
   radius of its box (`radius_px`), compared after normalising ("600 x 300" = "600×300" = "600x300"; "Ø150" = "150Ø"
   = "150 dia"; `parse_size`, `canon_tag`). Found, both of them: `confirmed`, with the words and the distance in its
   evidence. Otherwise `ai_only` ("AI-read: check"), with any text printed nearby that says something else. Words in
   the text layer that look like an MEP tag or size and that no item claimed become `text_only` items (`scan_text`).
   A page with no text layer confirms nothing.
3. **Cache and spend**: a page's reply is kept as JSON on disk, keyed by the drawing's sha256, the page, the model and
   the prompt's hash (`prompt_hash`), so a sheet is paid for once; reconciling runs again on every read. A page not
   cached is refused before any call when the day's budget (spend.py, `IRIS_ESCALATION_MAX_USD_DAY`) or a run's own
   cap (`budget=` USD) cannot cover its estimate (`ReadRefused`), and each call's real cost is charged as it lands.

`FakeReader` reads a page from its own text layer with deterministic mistakes, so the whole pipeline runs offline in
tests. `read_drawing` yields the stream the route sends: `page` progress, one `item` per item, then `done`.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
import re
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterator, Protocol

from . import model_client, spend

PROMPT = Path(__file__).parent / "domain_packs" / "drawing_reader.md"
VERSION = "1"            # part of the prompt hash: bump when the reply is read differently
KINDS = ("duct", "pipe", "tray", "diffuser", "unit", "equipment", "other")
STATUSES = ("confirmed", "ai_only", "text_only")
TILE_ABOVE_PX = 2000     # a page whose longest side is over this is also sent as four quarters
TILE_OVERLAP = 0.10      # neighbouring quarters overlap by this share of the page (each reaches half of it past the middle)
RADIUS_FRAC = 0.03       # text counts as "near" an item within this share of the page's longest side
RADIUS_MIN_PX = 40.0
THINKING = "high"        # fixed, as the picture judges' are: dense visual reading (docs/research, Gemini settings)
TIMEOUT_S = 240
# The estimate a page is held at before its call (the real cost is charged when it lands): HIGH media resolution is
# 1,120 tokens an image, the prompt and schema about 1,500, the reply with HIGH thinking about 6,000 output tokens.
IMAGE_TOKENS, TEXT_TOKENS, OUTPUT_TOKENS = 1120, 1500, 6000
CACHE = Path(tempfile.gettempdir()) / "iris-drawing-reads"
QUARTERS = ("top left", "top right", "bottom left", "bottom right")
PAGE_TEXT = "Image 1 is the whole sheet. List its items and read its title block."
TILE_TEXT = ("Image 1 is the whole sheet; Images 2 to 5 are its top-left, top-right, bottom-left and bottom-right "
             "quarters, overlapping by {pct}% of the sheet. List the sheet's items once each and read its title block.")


# ------------------------------------------------------------------------------------------------- the contract

class WordLike(Protocol):          # drawings.Word
    text: str
    x0: float
    y0: float
    x1: float
    y1: float


class PageLike(Protocol):          # drawings.Page
    index: int
    width_px: int
    height_px: int
    dpi: int
    png: str
    words: list
    has_text_layer: bool


class DrawingLike(Protocol):       # drawings.Drawing
    id: str
    name: str
    sha256: str
    pages: list
    title: dict


@dataclass
class Item:
    """One thing read on a sheet (docs/drawings.md)."""
    id: str
    page: int
    tag: str | None
    kind: str                      # KINDS
    size: str | None               # as printed: "600x300", "Ø150"
    size_mm: list[float] | None    # [600, 300]; [150]; inches converted (evidence["unit"] says which)
    box: list[float]               # [x0, y0, x1, y1] pixels on the page image
    source: str                    # "ai" | "text"
    status: str                    # STATUSES
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class ReadRefused(RuntimeError):
    """A read that today's budget (or the run's cap) cannot cover; nothing was called."""


# ------------------------------------------------------------------------------------------------- sizes and tags

_DASHES = "‐‑‒–—―−"
_NUM = r"\d+(?:\.\d+)?(?:-\d+/\d+)?|\d+/\d+"          # 150, 12.5, 1-1/2, 3/4
_UNIT = r"mm|in|\""
_RECT = re.compile(rf"^({_NUM})\s*({_UNIT})?\s*x\s*({_NUM})\s*({_UNIT})?$", re.I)
_ROUND_PRE = re.compile(rf"^(Ø|DIA\.?|DN)\s*({_NUM})\s*({_UNIT})?$", re.I)
_ROUND_POST = re.compile(rf"^({_NUM})\s*({_UNIT})?\s*(?:Ø|DIA\.?|DIAM\.?)$", re.I)
_PLAIN = re.compile(rf"^({_NUM})\s*({_UNIT})?$", re.I)
_TAG = re.compile(r"^[A-Z]{1,4}(?:-[A-Z0-9]{1,8}){0,4}-?\d{1,4}[A-Z]?$")


@dataclass(frozen=True)
class Size:
    dims_mm: tuple[float, ...]
    shape: str          # "rect" | "round" | "plain" (a bare number, accepted from the model only)
    unit: str           # "mm" | "in"
    unit_assumed: bool  # no unit printed: millimetres assumed

    def same(self, other: "Size", tol_mm: float = 0.5) -> bool:
        """Same printed size: the same dimensions in the same order, a bare number matching a round one."""
        if len(self.dims_mm) != len(other.dims_mm):
            return False
        if self.shape != other.shape and "plain" not in (self.shape, other.shape):
            return False
        return all(abs(a - b) <= tol_mm for a, b in zip(self.dims_mm, other.dims_mm))


def _norm_size_text(text: str) -> str:
    t = text.strip().strip(",;:()[]")
    for q in ("″", "”", "“", "''", "’’"):
        t = t.replace(q, '"')
    for c in "ø⌀Φφ∅":     # ø ⌀ Φ φ ∅
        t = t.replace(c, "Ø")
    t = re.sub(r"\s*[x×X✕✖*]\s*(?=\d)", "x", t)   # "600 X 300", "600 × 300" → "600x300"
    return re.sub(r"\s+", " ", t)


def _number(text: str) -> float:
    if "/" in text:
        whole, _, frac = text.rpartition("-") if "-" in text else ("0", "", text)
        num, den = frac.split("/")
        return float(whole or 0) + float(num) / max(float(den), 1e-9)
    return float(text)


def parse_size(text: str | None, *, strict: bool = True) -> Size | None:
    """A printed size: "600x300", "600 × 300", "Ø150", "150Ø", "150 dia", "DN150", '24"x12"', '6" dia'. Unitless is
    millimetres (`unit_assumed`); inches (" ″ in) are converted to millimetres. `strict=False` also takes a bare number
    ("150", what a model may give for a round size); the text layer is scanned strictly (a bare number is a dimension,
    a level or a count far more often than a size)."""
    if not text:
        return None
    t = _norm_size_text(text)
    m = _RECT.match(t)
    if m:
        raw, units, shape = [m.group(1), m.group(3)], [m.group(2), m.group(4)], "rect"
    elif (m := _ROUND_PRE.match(t)):
        raw, units, shape = [m.group(2)], [m.group(3)], "round"
        if m.group(1).upper() == "DN":
            units = ["mm"]
    elif (m := _ROUND_POST.match(t)):
        raw, units, shape = [m.group(1)], [m.group(2)], "round"
    elif not strict and (m := _PLAIN.match(t)):
        raw, units, shape = [m.group(1)], [m.group(2)], "plain"
    else:
        return None
    units = [(u or "").lower() for u in units]
    inches = any(u in ('"', "in") for u in units)
    try:
        dims = tuple(round(_number(r) * (25.4 if inches else 1.0), 2) for r in raw)
    except (ValueError, ZeroDivisionError):
        return None
    if not all(d > 0 for d in dims):
        return None
    return Size(dims, shape, "in" if inches else "mm", unit_assumed=not any(units))


def canon_tag(text: str | None) -> str:
    """A tag compared as printed, without case, odd dashes or spaces: "ahu – 1" → "AHU-1"."""
    t = (text or "").upper().strip().strip(",.;:()[]")
    for d in _DASHES:
        t = t.replace(d, "-")
    return re.sub(r"\s+", "", t)


def looks_like_tag(text: str) -> bool:
    """An MEP tag in the text layer: letters, then digits, with hyphens between parts ("AHU-1", "VAV3", "SA-MAIN-L02-5").
    One letter with digits and no hyphen ("A1", "L02") is a grid or a level, and a size is not a tag."""
    t = canon_tag(text)
    if not _TAG.match(t) or parse_size(t) is not None:
        return False
    return "-" in t or len(re.match(r"[A-Z]+", t).group()) >= 2


# Kind from a tag's first letters, for text-only items (the model's own kind wins for what it read).
TAG_KINDS = {
    "duct": ("SA", "RA", "EA", "OA", "FA", "TA", "MA", "SAD", "RAD", "EAD", "KE", "DUCT"),
    "pipe": ("CW", "HW", "CHW", "CHWS", "CHWR", "HHW", "LTHW", "MTHW", "DCW", "DHW", "HWS", "HWR", "CWS", "CWR", "SAN",
             "SW", "RW", "FW", "FP", "SPR", "GAS", "CD", "CO", "VP", "WP", "PIPE"),
    "tray": ("CT", "LV", "HV", "ELV", "TRAY", "CTR", "LAD", "BT"),
    "diffuser": ("SD", "RD", "LD", "ED", "TD", "GR", "RG", "SG", "EG", "DIF"),
    "unit": ("AHU", "FCU", "VAV", "CAV", "HP", "RTU", "MAU", "ERV", "HRU", "MVHR", "CU", "FC"),
    "equipment": ("P", "PU", "PMP", "CH", "CHL", "BLR", "B", "TK", "T", "DB", "MCC", "PNL", "EF", "SF", "F"),
}
_KIND_OF = {prefix: kind for kind, prefixes in TAG_KINDS.items() for prefix in prefixes}


def kind_of_tag(tag: str | None) -> str:
    """The kind a tag's letters suggest ("AHU-1" → unit, "SA-MAIN-L02-5" → duct, "LV-TRAY-1" → tray), else other."""
    t = canon_tag(tag)
    if not t:
        return "other"
    parts = t.split("-")
    if "TRAY" in parts:
        return "tray"
    letters = re.match(r"[A-Z]*", parts[0]).group()
    return _KIND_OF.get(letters, "other")


# ------------------------------------------------------------------------------------------------- tiles and boxes

@dataclass(frozen=True)
class Tile:
    """One image sent for a page: `index` is its k in "Image k:", its rectangle in page pixels."""
    index: int
    name: str
    x0: float
    y0: float
    x1: float
    y1: float


def tiles(width: float, height: float, *, tile_above: float = TILE_ABOVE_PX, overlap: float = TILE_OVERLAP) -> list[Tile]:
    """The images for a page `width` x `height`: the whole page (Image 1), and for a large page its four quarters
    (Images 2-5: top left, top right, bottom left, bottom right), neighbours overlapping by `overlap` of the page (each
    reaches half of it past the middle line), so a label on the middle line is whole in at least one quarter."""
    out = [Tile(1, "whole sheet", 0.0, 0.0, float(width), float(height))]
    if max(width, height) <= tile_above:
        return out
    tw, th = width * (0.5 + overlap / 2), height * (0.5 + overlap / 2)
    for k, (ix, iy) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
        x0 = 0.0 if ix == 0 else width - tw
        y0 = 0.0 if iy == 0 else height - th
        out.append(Tile(k + 2, f"{QUARTERS[k]} quarter", round(x0, 2), round(y0, 2), round(x0 + tw, 2),
                        round(y0 + th, 2)))
    return out


def to_page(box_2d, tile: Tile) -> list[float]:
    """A model box ([ymin, xmin, ymax, xmax], 0-1000 on `tile`'s image) as [x0, y0, x1, y1] page pixels."""
    ymin, xmin, ymax, xmax = (min(1000.0, max(0.0, float(v))) for v in box_2d)
    ymin, ymax = sorted((ymin, ymax))
    xmin, xmax = sorted((xmin, xmax))
    w, h = tile.x1 - tile.x0, tile.y1 - tile.y0
    return [round(tile.x0 + xmin / 1000 * w, 1), round(tile.y0 + ymin / 1000 * h, 1),
            round(tile.x0 + xmax / 1000 * w, 1), round(tile.y0 + ymax / 1000 * h, 1)]


def to_tile(box: list[float], tile: Tile) -> list[int]:
    """`to_page` backwards: page pixels as [ymin, xmin, ymax, xmax], 0-1000 on the tile (the model's form)."""
    w, h = tile.x1 - tile.x0, tile.y1 - tile.y0
    x0, y0, x1, y1 = box
    return [round((y0 - tile.y0) / h * 1000), round((x0 - tile.x0) / w * 1000),
            round((y1 - tile.y0) / h * 1000), round((x1 - tile.x0) / w * 1000)]


def gap(a, b) -> float:
    """The distance between two boxes [x0, y0, x1, y1] (0 when they touch or overlap)."""
    dx = max(0.0, a[0] - b[2], b[0] - a[2])
    dy = max(0.0, a[1] - b[3], b[1] - a[3])
    return math.hypot(dx, dy)


def _union(boxes) -> list[float]:
    boxes = list(boxes)
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def radius_px(width: float, height: float) -> float:
    """How near text must be to an item's box to be its text: `RADIUS_FRAC` of the page, at least `RADIUS_MIN_PX`."""
    return max(RADIUS_MIN_PX, RADIUS_FRAC * max(width, height))


# ------------------------------------------------------------------------------------------------- the text layer

@dataclass(frozen=True)
class Phrase:
    """One to three neighbouring words on a line of the text layer."""
    text: str
    words: tuple[int, ...]
    box: tuple[float, float, float, float]


def _lines(words) -> list[list[int]]:
    """Word indexes grouped into lines by their vertical centres, each line left to right."""
    lines: list[list[int]] = []
    mids: list[tuple[float, float]] = []
    for i in sorted(range(len(words)), key=lambda i: ((words[i].y0 + words[i].y1) / 2, words[i].x0)):
        w = words[i]
        mid, h = (w.y0 + w.y1) / 2, max(w.y1 - w.y0, 1.0)
        if lines and abs(mids[-1][0] - mid) < 0.5 * max(mids[-1][1], h):
            lines[-1].append(i)
        else:
            lines.append([i])
            mids.append((mid, h))
    for line in lines:
        line.sort(key=lambda i: words[i].x0)
    return lines


def phrases(words, max_words: int = 3) -> list[Phrase]:
    """Every run of 1 to `max_words` words next to each other on a line ("600", "x", "300" → "600 x 300")."""
    out = []
    for line in _lines(words):
        for a in range(len(line)):
            run = [line[a]]
            for n in range(max_words):
                if n:
                    if a + n >= len(line):
                        break
                    prev, nxt = words[line[a + n - 1]], words[line[a + n]]
                    if nxt.x0 - prev.x1 > 1.5 * max(prev.y1 - prev.y0, nxt.y1 - nxt.y0, 1.0):
                        break
                    run.append(line[a + n])
                ws = [words[i] for i in run]
                out.append(Phrase(" ".join(w.text for w in ws), tuple(run),
                                  tuple(_union([(w.x0, w.y0, w.x1, w.y1) for w in ws]))))
    return out


def scan_text(words, *, claimed: set[int] | None = None, radius: float = RADIUS_MIN_PX * 2,
              exclude: tuple[str, ...] = ()) -> list[dict]:
    """The tags and sizes printed in the text layer, not in `claimed` (word indexes): sizes first (longest phrase
    first), then tags; a tag and the nearest size within `radius` pair into one item. `exclude`: tags that are not
    items (the sheet's own number). Each: {tag, size, kind, box, words: [{text, box}], word_ids}."""
    claimed = set(claimed or ())
    taken = set(claimed)
    skip = {canon_tag(e) for e in exclude if e}
    found_sizes, found_tags = [], []
    ordered = sorted(phrases(words), key=lambda p: (-len(p.words), p.box[1], p.box[0]))
    for p in ordered:
        if taken & set(p.words) or parse_size(p.text) is None:
            continue
        taken.update(p.words)
        found_sizes.append(p)
    for p in ordered:
        if taken & set(p.words) or not looks_like_tag(p.text) or canon_tag(p.text) in skip:
            continue
        taken.update(p.words)
        found_tags.append(p)
    pairs = sorted((gap(t.box, s.box), ti, si) for ti, t in enumerate(found_tags) for si, s in enumerate(found_sizes)
                   if gap(t.box, s.box) <= radius)
    tag_size: dict[int, int] = {}
    used = set()
    for _, ti, si in pairs:
        if ti not in tag_size and si not in used:
            tag_size[ti] = si
            used.add(si)
    out = []
    for ti, t in enumerate(found_tags):
        s = found_sizes[tag_size[ti]] if ti in tag_size else None
        out.append(_text_item(t, s, words))
    for si, s in enumerate(found_sizes):
        if si not in used:
            out.append(_text_item(None, s, words))
    out.sort(key=lambda d: (d["box"][1], d["box"][0]))
    return out


def _text_item(tag: Phrase | None, size: Phrase | None, words) -> dict:
    ps = [p for p in (tag, size) if p is not None]
    ids = [i for p in ps for i in p.words]
    return {"tag": tag.text if tag else None, "size": size.text if size else None,
            "kind": kind_of_tag(tag.text) if tag else "other", "box": [round(v, 1) for v in _union(p.box for p in ps)],
            "words": [{"text": words[i].text, "box": [words[i].x0, words[i].y0, words[i].x1, words[i].y1]} for i in ids],
            "word_ids": ids}


# ------------------------------------------------------------------------------------------------- reconcile

def _merge_duplicates(items: list[dict], radius: float) -> list[dict]:
    """One entry for a label the model gave twice (on the whole sheet and a quarter, or on two overlapping quarters):
    same tag, or no tag and the same size and kind, with boxes within `radius`. The quarter's box is kept (finer)."""
    ordered = sorted(items, key=lambda it: (it.get("image", 1) == 1, it.get("image", 1)))
    kept: list[dict] = []
    for it in ordered:
        twin = None
        for k in kept:
            if gap(k["box"], it["box"]) > radius:
                continue
            if it["tag"] and k["tag"]:
                same = canon_tag(it["tag"]) == canon_tag(k["tag"])
            elif not it["tag"] and not k["tag"]:
                a, b = parse_size(it["size"], strict=False), parse_size(k["size"], strict=False)
                same = it.get("kind") == k.get("kind") and bool(
                    (a and b and a.same(b)) or (not it["size"] and not k["size"] and gap(k["box"], it["box"]) == 0))
            else:
                same = False
            if same:
                twin = k
                break
        if twin is None:
            kept.append(dict(it, images=[it.get("image", 1)]))
        else:
            twin["images"].append(it.get("image", 1))
            twin["size"] = twin["size"] or it["size"]
    kept.sort(key=lambda it: (it["box"][1], it["box"][0]))
    return kept


def reconcile(ai_items: list[dict], words, *, width: float, height: float, has_text_layer: bool = True,
              radius: float | None = None, exclude: tuple[str, ...] = ()) -> list[dict]:
    """Check what the model read against the page's text layer (no AI). `ai_items`: {tag, kind, size, box (page
    pixels), image} each. Returns the page's items as dicts (no id or page yet), the model's first, then the text
    layer's own (`text_only`).

    An item is `confirmed` when every field it printed (tag, size) is found, normalised, in a phrase of the text layer
    within `radius` pixels of its box; each phrase confirms one item (nearest first). Otherwise it is `ai_only`, and
    a tag or size printed nearby that says something else is kept in its evidence as `text_says`. Tags and sizes in
    the text layer that nothing claimed become `text_only` items."""
    r = radius if radius is not None else radius_px(width, height)
    words = list(words or []) if has_text_layer else []
    items = _merge_duplicates(ai_items, r)
    ps = phrases(words)
    tags = [canon_tag(p.text) for p in ps]
    sizes = [parse_size(p.text) for p in ps]
    cands = []
    for i, it in enumerate(items):
        want_tag = canon_tag(it.get("tag")) if it.get("tag") else None
        want_size = parse_size(it.get("size"), strict=False) if it.get("size") else None
        for j, p in enumerate(ps):
            d = gap(it["box"], p.box)
            if d > r:
                continue
            if want_tag and tags[j] == want_tag:
                cands.append((d, i, "tag", -len(p.words), j))
            if want_size and sizes[j] is not None and want_size.same(sizes[j]):
                cands.append((d, i, "size", -len(p.words), j))
    cands.sort()
    claimed: set[int] = set()
    found: dict[tuple[int, str], tuple[int, float]] = {}
    for d, i, what, _, j in cands:
        if (i, what) in found or claimed & set(ps[j].words):
            continue
        found[(i, what)] = (j, d)
        claimed.update(ps[j].words)

    def words_of(j: int) -> list[dict]:
        return [{"text": words[w].text, "box": [words[w].x0, words[w].y0, words[w].x1, words[w].y1]}
                for w in ps[j].words]

    out = []
    for i, it in enumerate(items):
        fields = [f for f in ("tag", "size") if it.get(f)]
        ev: dict[str, Any] = {"images": it["images"], "radius_px": round(r, 1)}
        for f in fields:
            if (i, f) in found:
                j, d = found[(i, f)]
                ev[f] = {"text": ps[j].text, "words": words_of(j), "distance_px": round(d, 1)}
        confirmed = bool(fields) and all((i, f) in found for f in fields)
        if not has_text_layer:
            ev["why"] = "no text layer: read by the AI only"
        elif not fields:
            ev["why"] = "nothing printed to check (no tag or size read)"
        elif not confirmed:
            missing = [f for f in fields if (i, f) not in found]
            ev["why"] = f"{' and '.join(missing)} not found in the text layer within {r:.0f} px"
            says = {}
            for f in missing:   # what the text layer prints there instead, if anything
                best = None
                for j, p in enumerate(ps):
                    if claimed & set(p.words):
                        continue
                    if f == "size" and sizes[j] is None or f == "tag" and not looks_like_tag(p.text):
                        continue
                    d = gap(it["box"], p.box)
                    if d <= r and (best is None or (d, -len(p.words)) < (best[0], -len(ps[best[1]].words))):
                        best = (d, j)
                if best is not None:
                    claimed.update(ps[best[1]].words)
                    says[f] = {"text": ps[best[1]].text, "words": words_of(best[1]), "distance_px": round(best[0], 1)}
            if says:
                ev["text_says"] = says
        parsed = parse_size(it.get("size"), strict=False)
        if parsed:
            ev["unit"] = parsed.unit
            ev["unit_assumed"] = parsed.unit_assumed
        out.append({"tag": it.get("tag"), "kind": it.get("kind") or "other", "size": it.get("size"),
                    "size_mm": list(parsed.dims_mm) if parsed else None, "box": it["box"], "source": "ai",
                    "status": "confirmed" if confirmed and has_text_layer else "ai_only", "evidence": ev})
    for t in scan_text(words, claimed=claimed, radius=r, exclude=exclude):
        parsed = parse_size(t["size"]) if t["size"] else None
        ev = {"words": t["words"], "why": "printed in the text layer; the AI did not read it"}
        if parsed:
            ev["unit"] = parsed.unit
            ev["unit_assumed"] = parsed.unit_assumed
        out.append({"tag": t["tag"], "kind": t["kind"], "size": t["size"],
                    "size_mm": list(parsed.dims_mm) if parsed else None, "box": t["box"], "source": "text",
                    "status": "text_only", "evidence": ev})
    return out


# ------------------------------------------------------------------------------------------------- the model

def schema(n_images: int = 5) -> dict:
    """The strict reply: the items read (each on one of `n_images` images) and the title block."""
    text_or_null = {"type": ["string", "null"]}
    return {
        "type": "object",
        "properties": {
            "items": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "image": {"type": "integer", "minimum": 1, "maximum": n_images,
                              "description": "k of the 'Image k:' the box is on"},
                    "tag": {**text_or_null, "description": "the printed identifier, exactly; null when none"},
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "size": {**text_or_null, "description": "the printed size, exactly; null when none"},
                    "box_2d": {"type": "array", "items": {"type": "number", "minimum": 0, "maximum": 1000},
                               "minItems": 4, "maxItems": 4,
                               "description": "[ymin, xmin, ymax, xmax], 0-1000 on that image"}},
                "required": ["image", "tag", "kind", "size", "box_2d"],
                "additionalProperties": False}},
            "title": {"type": "object",
                      "properties": {"sheet": text_or_null, "scale": text_or_null, "title": text_or_null},
                      "required": ["sheet", "scale", "title"], "additionalProperties": False}},
        "required": ["items", "title"],
        "additionalProperties": False,
    }


def system_prompt() -> str:
    """The reader's system prompt (read from disk on each call, so an edit takes effect without a restart)."""
    return PROMPT.read_text(encoding="utf-8").strip()


def page_text(tile_list: list[Tile]) -> str:
    return PAGE_TEXT if len(tile_list) == 1 else TILE_TEXT.format(pct=round(TILE_OVERLAP * 100))


def prompt_hash() -> str:
    """What the reply depends on besides the page and the model: the prompt, the per-page text, the schema, the tiling."""
    blob = json.dumps([VERSION, system_prompt(), PAGE_TEXT, TILE_TEXT, schema(), TILE_ABOVE_PX, TILE_OVERLAP],
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


class Reader(Protocol):
    model: str
    priced: bool

    def estimate_usd(self, n_images: int) -> float: ...

    def read(self, page: PageLike, images: list[tuple[Tile, bytes]], system: str, text: str,
             schema: dict) -> tuple[dict, dict]: ...


def _transient(e: Exception) -> bool:
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    return code in (429, 500, 502, 503, 504)


class GeminiReader:
    """Reads a page with Gemini (the fast model, `GEMINI_FAST_MODEL`, unless `model` says): the images each after an
    "Image k:" label, the instructions last; `media_resolution` HIGH, strict JSON schema, thinking `THINKING`, no
    temperature (Gemini 3 and later ignore it and warn against lowering it). Retries only a transport error (429,
    5xx), `retries` times; a reply that is not valid JSON is a failed page, never a retry."""

    def __init__(self, model: str | None = None, *, client: Any = None, thinking_level: str | None = THINKING,
                 timeout_s: float = TIMEOUT_S, retries: int = 1):
        model_client.load_env()
        self.model = model or model_client.model_id("fast")
        self._client = client
        self.thinking_level = thinking_level
        self.timeout_s = timeout_s
        self.retries = retries
        self.usage = model_client.Usage()

    @property
    def client(self):
        if self._client is None:
            self._client = model_client.make_client()
        return self._client

    @property
    def priced(self) -> bool:
        return model_client.cost(self.model, 1, 1) > 0

    def estimate_usd(self, n_images: int) -> float:
        return model_client.cost(self.model, n_images * IMAGE_TOKENS + TEXT_TOKENS, OUTPUT_TOKENS)

    def config(self, system: str, schema: dict):
        types = model_client._types()
        level = (self.thinking_level or "").strip().upper()
        return types.GenerateContentConfig(
            system_instruction=system, response_mime_type="application/json", response_json_schema=schema,
            media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
            thinking_config=types.ThinkingConfig(thinking_level=level) if level else None,
            http_options=types.HttpOptions(timeout=int(self.timeout_s * 1000)))

    def contents(self, images: list[tuple[Tile, bytes]], text: str) -> list:
        types = model_client._types()
        parts = []
        for tile, png in images:
            parts.append(types.Part.from_text(text=f"Image {tile.index}:"))
            parts.append(types.Part.from_bytes(data=png, mime_type="image/png"))
        parts.append(types.Part.from_text(text=text))
        return [types.Content(role="user", parts=parts)]

    def read(self, page: PageLike, images: list[tuple[Tile, bytes]], system: str, text: str,
             schema: dict) -> tuple[dict, dict]:
        contents, config = self.contents(images, text), self.config(system, schema)
        for attempt in range(self.retries + 1):
            try:
                response = self.client.models.generate_content(model=self.model, contents=contents, config=config)
                break
            except Exception as e:   # noqa: BLE001 — the SDK's errors carry a status code
                if attempt >= self.retries or not _transient(e):
                    raise
                time.sleep(2 ** attempt)
        raw = getattr(response, "usage_metadata", None)
        tin, tout, thinking = self.usage.add(raw)
        candidates = getattr(response, "candidates", None) or []
        finish = getattr(candidates[0], "finish_reason", None) if candidates else None
        usage = {"model": self.model, "model_version": getattr(response, "model_version", None),
                 "input_tokens": tin, "output_tokens": tout, "reasoning_tokens": thinking,
                 "usd": round(model_client.cost(self.model, tin, tout), 6),
                 "finish_reason": str(getattr(finish, "name", finish)) if finish is not None else None}
        try:
            reply = model_client._parse_json(model_client._response_text(response))
        except ValueError as e:
            reply = {"items": [], "title": None, "error": f"the reply was not valid JSON ({e})"}
        return reply, usage


class FakeReader:
    """Reads a page from its own text layer, no model and (by default) no cost, making the same kinds of mistakes a
    model makes, deterministically, so reconcile has something to catch: every 7th label (from the 4th) is missed,
    every 5th (from the 2nd) has its first size number read 50 too high, and one item that is not on the sheet is
    invented. Boxes come back as a model's would: on the quarter that holds the label, 0-1000 [ymin, xmin, ymax, xmax].
    `usd_per_call` prices it (budget tests)."""

    def __init__(self, *, perturb: bool = True, model: str = "fake-reader", usd_per_call: float = 0.0):
        self.model = model
        self.perturb = perturb
        self.usd_per_call = usd_per_call
        self.calls = 0

    @property
    def priced(self) -> bool:
        return self.usd_per_call > 0

    def estimate_usd(self, n_images: int) -> float:
        return self.usd_per_call

    @staticmethod
    def misread(size: str) -> str:
        return re.sub(r"\d+", lambda m: str(int(m.group()) + 50), size, count=1)

    def read(self, page: PageLike, images: list[tuple[Tile, bytes]], system: str, text: str,
             schema: dict) -> tuple[dict, dict]:
        self.calls += 1
        tile_list = [t for t, _ in images]
        out = []
        words = page.words if page.has_text_layer else []
        for n, found in enumerate(scan_text(words, radius=radius_px(page.width_px, page.height_px))):
            if self.perturb and n % 7 == 3:
                continue
            size = found["size"]
            if self.perturb and size and n % 5 == 1:
                size = self.misread(size)
            box = found["box"]
            inside = [t for t in tile_list if t.x0 <= box[0] and t.y0 <= box[1] and box[2] <= t.x1 and box[3] <= t.y1]
            tile = (sorted(inside, key=lambda t: (t.index == 1, t.index)) or tile_list)[0]
            out.append({"image": tile.index, "tag": found["tag"], "kind": found["kind"], "size": size,
                        "box_2d": to_tile(box, tile)})
        if self.perturb:
            out.append({"image": 1, "tag": "ZZ-999", "kind": "other", "size": None, "box_2d": [5, 5, 15, 25]})
        return ({"items": out, "title": {"sheet": None, "scale": None, "title": None}},
                {"model": self.model, "input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0,
                 "usd": self.usd_per_call})


# ------------------------------------------------------------------------------------------------- budget and cache

class DayBudget:
    """The day's budget (spend.py): refused past `IRIS_ESCALATION_MAX_USD_DAY`, the estimate held while a page is read,
    each call charged as it lands. `exempt`: the owner's own reads (owner.is_owner() when not given)."""

    def __init__(self, exempt: bool | None = None):
        if exempt is None:
            from . import owner
            exempt = owner.is_owner()
        self.exempt = exempt

    def refused(self, estimate: float) -> str | None:
        why = spend.refused(estimate, self.exempt)
        if why:
            return (f"Reading this drawing needs about ${estimate:.2f} of AI time, and today's AI budget "
                    f"(${spend.limit():.2f}) is used up; it resets at midnight UTC. Pages already read stay readable.")
        return None

    def hold(self, estimate: float):
        return spend.held(estimate)

    def charge(self, usd: float) -> None:
        spend.charge(usd)


class RunBudget:
    """A cap on one run (`budget=` USD) on top of the day's budget."""

    def __init__(self, max_usd: float, day: DayBudget | None = None):
        self.max_usd = float(max_usd)
        self.spent = 0.0
        self.day = day if day is not None else DayBudget()

    def refused(self, estimate: float) -> str | None:
        if self.spent + estimate > self.max_usd + 1e-12:
            return (f"Reading this drawing needs about ${estimate:.2f} of AI time, past this read's cap of "
                    f"${self.max_usd:.2f} (${self.spent:.2f} spent).")
        return self.day.refused(estimate)

    def hold(self, estimate: float):
        return self.day.hold(estimate)

    def charge(self, usd: float) -> None:
        self.spent += max(0.0, usd)
        self.day.charge(usd)


def _budget(budget) -> Any:
    if budget is None:
        return DayBudget()
    if isinstance(budget, (int, float)) and not isinstance(budget, bool):
        return RunBudget(float(budget))
    return budget


def cache_key(sha256: str, page: int, model: str, phash: str) -> str:
    return hashlib.sha256(f"{sha256}|{page}|{model}|{phash}".encode()).hexdigest()


def _cache_read(path: Path | None) -> dict | None:
    if path is None or not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and "reply" in data else None


def _cache_write(path: Path | None, data: dict) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)   # whole or not at all


# ------------------------------------------------------------------------------------------------- the read

def page_png(drawing: DrawingLike, page: PageLike, folder: Path | None = None) -> Path:
    """Where a page's image is: under `folder` when given, else as drawings.STORE keeps it, else `page.png` itself."""
    if folder is not None:
        return Path(folder) / page.png
    try:
        from .drawings import STORE
        return STORE.folder(drawing.id) / page.png
    except (ImportError, KeyError):
        return Path(page.png)


def _images(png: Path, page: PageLike) -> tuple[list[Tile], list[tuple[Tile, bytes]]]:
    """The page's tiles in page pixels and each one's PNG (the page file itself for Image 1, crops for quarters)."""
    from PIL import Image
    data = png.read_bytes()
    with Image.open(io.BytesIO(data)) as im:
        iw, ih = im.size
        pw, ph = (page.width_px or iw), (page.height_px or ih)
        tile_list = tiles(pw, ph)
        out = [(tile_list[0], data)]
        sx, sy = iw / pw, ih / ph
        for t in tile_list[1:]:
            crop = im.crop((int(t.x0 * sx), int(t.y0 * sy), int(math.ceil(t.x1 * sx)), int(math.ceil(t.y1 * sy))))
            buf = io.BytesIO()
            crop.save(buf, format="PNG")
            out.append((t, buf.getvalue()))
    return tile_list, out


def _text(value) -> str | None:
    """A text field of the reply: stripped, None when empty."""
    if value is None:
        return None
    return str(value).strip() or None


def _ai_items(reply: dict, tile_list: list[Tile]) -> tuple[list[dict], int]:
    """The reply's items with their boxes in page pixels; and how many were dropped (no usable box or image)."""
    by_index = {t.index: t for t in tile_list}
    out, dropped = [], 0
    for raw in reply.get("items") or []:
        if not isinstance(raw, dict):
            dropped += 1
            continue
        tile = by_index.get(raw.get("image")) or (tile_list[0] if len(tile_list) == 1 else None)
        box = raw.get("box_2d")
        if tile is None or not isinstance(box, (list, tuple)) or len(box) != 4:
            dropped += 1
            continue
        try:
            page_box = to_page(box, tile)
        except (TypeError, ValueError):
            dropped += 1
            continue
        kind = raw.get("kind") if raw.get("kind") in KINDS else "other"
        out.append({"tag": _text(raw.get("tag")), "kind": kind, "size": _text(raw.get("size")), "box": page_box,
                    "image": tile.index})
    return out, dropped


def read_drawing(drawing: DrawingLike, pages: list[int] | None = None, *, model: Any = None, client: Any = None,
                 cache_dir: Path | str | bool | None = None, budget: Any = None,
                 folder: Path | None = None) -> Iterator[dict]:
    """Read a drawing's pages (all, or those whose index is in `pages`) and check each against its text layer.

    Yields `{type: "page", index, total, cached}` before each page, `{type: "item", item}` for each of its items, and
    finally `{type: "done", items, cost_usd, titles, errors}` (`cost_usd`: what this run's calls cost; cached pages
    are free). `model`: a reader (`GeminiReader`, `FakeReader`) or a model id (default: the fast model); `client`: the
    google-genai client for a model id. `cache_dir`: where replies are kept (default `CACHE`; False: not kept).
    `budget`: None for the day's budget, a number for a cap on this run (USD) as well, or an object with
    `refused(estimate)`, `hold(estimate)` and `charge(usd)`. `folder`: the drawing's folder, when drawings.STORE does
    not hold it. Raises ReadRefused before reading a page the budget cannot cover (before anything is yielded when
    the whole read cannot be covered)."""
    reader = model if model is not None and not isinstance(model, str) else GeminiReader(model, client=client)
    guard = _budget(budget)
    store = None if cache_dir is False else Path(cache_dir) if cache_dir else CACHE
    phash = prompt_hash()
    system = system_prompt()
    wanted = None if pages is None else set(pages)
    chosen = [p for p in drawing.pages if wanted is None or p.index in wanted]
    cached = {p.index: _cache_read(store / f"{cache_key(drawing.sha256, p.index, reader.model, phash)}.json"
                                   if store else None) for p in chosen}
    exclude = tuple(v for k, v in (drawing.title or {}).items() if k in ("sheet", "drawing_no") and v)

    def estimate(p) -> float:
        big = max(p.width_px, p.height_px) > TILE_ABOVE_PX
        return reader.estimate_usd(5 if big else 1)
    if reader.priced:
        todo = sum(estimate(p) for p in chosen if cached[p.index] is None)
        why = guard.refused(todo) if todo else None
        if why:
            raise ReadRefused(why)

    all_items: list[dict] = []
    titles: dict[str, dict] = {}
    errors: dict[str, str] = {}
    cost = 0.0
    for p in chosen:
        hit = cached[p.index]
        yield {"type": "page", "index": p.index, "total": len(chosen), "cached": hit is not None}
        if hit is not None:
            tile_list = [Tile(**t) for t in hit["tiles"]]
            reply, usage = hit["reply"], hit.get("usage") or {}
        else:
            png = page_png(drawing, p, folder)
            tile_list, images = _images(png, p)
            if reader.priced:
                est = estimate(p)
                why = guard.refused(est)
                if why:
                    raise ReadRefused(why)
                hold = guard.hold(est) if hasattr(guard, "hold") else contextlib.nullcontext()
            else:
                hold = contextlib.nullcontext()
            with hold:
                reply, usage = reader.read(p, images, system, page_text(tile_list), schema(len(tile_list)))
            usd = float(usage.get("usd") or 0.0)
            if reader.priced and usd:
                guard.charge(usd)
            cost += usd
            if not reply.get("error") and store is not None:
                _cache_write(store / f"{cache_key(drawing.sha256, p.index, reader.model, phash)}.json",
                             {"version": VERSION, "drawing_sha256": drawing.sha256, "page": p.index,
                              "model": reader.model, "prompt_hash": phash, "tiles": [asdict(t) for t in tile_list],
                              "reply": reply, "usage": usage,
                              "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        if reply.get("error"):
            errors[str(p.index)] = reply["error"]
        if isinstance(reply.get("title"), dict):
            titles[str(p.index)] = {k: reply["title"].get(k) for k in ("sheet", "scale", "title")}
        ai, dropped = _ai_items(reply, tile_list)
        found = reconcile(ai, p.words, width=p.width_px, height=p.height_px, has_text_layer=p.has_text_layer,
                          exclude=exclude + tuple(v for v in (titles.get(str(p.index)) or {}).values() if v))
        for n, f in enumerate(found):
            ev = f["evidence"]
            if f["source"] == "ai":
                ev.update({"model": usage.get("model", reader.model), "page_cost_usd": usage.get("usd", 0.0),
                           "cached": hit is not None})
                if dropped:
                    ev["page_dropped"] = dropped
            item = Item(id=f"{drawing.id}-p{p.index}-{n + 1:03d}", page=p.index, **f)
            all_items.append(item.to_dict())
            yield {"type": "item", "item": item.to_dict()}
    yield {"type": "done", "items": all_items, "cost_usd": round(cost, 6), "titles": titles, "errors": errors}
