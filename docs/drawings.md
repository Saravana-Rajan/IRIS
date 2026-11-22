# 2D drawing reader (Iris Engineering)

**AI reads. Data checks. The engineer decides.**

An engineer uploads PDF drawings (HVAC, plumbing, electrical plans). Iris reads each sheet, shows what it found on the
sheet, and compares it with the 3D model: missing items, size differences. This file is the shared contract for the
slices that build it. Nothing here is claimed as built until its tests pass.

## Flow

```
PDF ─▶ [ingest] pages → PNG (+ tiles) + exact text layer (words with boxes)
          ─▶ [reader] Gemini 3.8 Flash reads items (tag, type, size, box) per sheet
          ─▶ [reconcile] each item checked against the PDF's own text layer
          ─▶ [compare] items ↔ 3D model elements (tag / name / size)
          ─▶ mismatches ─▶ the coordination report
```

### Accuracy rules

- The **text layer is exact** (no AI). A tag or size the AI reports is **confirmed** only if the same text is found in
  the text layer near the item's box. Otherwise it is **AI-read: check**.
- **Comparison with the model uses model data only** (IFC tag, name, `Pset_*` / `Mark`, profile sizes). It never asks the
  AI whether the model matches.
- A scanned PDF with no text layer is allowed; every item is then **AI-read: check**, and the UI says so.
- Cost guard: Gemini 3.8 Flash, `media_resolution` HIGH, strict JSON schema. Spend counts against the daily cap
  (`IRIS_ESCALATION_MAX_USD_DAY`); a sheet is read once and cached by file hash + page.

## Libraries (licence-safe)

`pypdfium2` (Apache-2.0 / BSD) to render pages, `pdfplumber` (MIT) for the text layer with coordinates, `reportlab`
(BSD) to write sample PDFs. **Not** PyMuPDF (AGPL).

## Server contract

```python
# server/iris/drawings.py
@dataclass
class Word:   text: str; x0: float; y0: float; x1: float; y1: float      # pixels on the rendered page (origin top-left)
@dataclass
class Page:   index: int; width_px: int; height_px: int; dpi: int; png: str   # png: path relative to the drawing folder
              words: list[Word]; has_text_layer: bool
@dataclass
class Drawing: id: str; name: str; sha256: str; pages: list[Page]; title: dict   # title block fields if found (sheet, scale, title)

# server/iris/drawing_reader.py
@dataclass
class Item:   id: str; page: int; tag: str | None; kind: str            # kind: "duct" | "pipe" | "tray" | "diffuser" | "unit" | "equipment" | "other"
              size: str | None; size_mm: list[float] | None             # e.g. "600x300" → [600, 300]; "Ø150" → [150]
              box: list[float]                                           # [x0, y0, x1, y1] pixels on the page
              source: str                                                # "ai" | "text"
              status: str                                                # "confirmed" | "ai_only" | "text_only"
              evidence: dict                                             # matched words, distance in px, model, cost

# server/iris/drawing_compare.py
@dataclass
class Mismatch: kind: str            # "missing_in_model" | "missing_in_drawing" | "size_differs" | "type_differs"
                item: str | None     # drawing item id
                element: str | None  # IFC GlobalId
                drawing_value: str | None; model_value: str | None
                evidence: dict       # how the match was made (tag / name / Pset key), numbers compared
```

| Route | Body | Returns |
|---|---|---|
| `POST /api/scenes/{sid}/drawings` | multipart PDF(s) | `Drawing[]` (pages rendered, text layer read) |
| `GET /api/scenes/{sid}/drawings` | | `Drawing[]` |
| `GET /api/drawings/{did}/pages/{n}.png` | | the page image |
| `POST /api/drawings/{did}/read` | `{pages?: int[]}` | NDJSON stream: `page` progress, `item` events, `done {items, cost_usd}` |
| `GET /api/drawings/{did}/items` | | `Item[]` |
| `GET /api/scenes/{sid}/drawings/compare` | | `{matches: [{item, element, by}], mismatches: Mismatch[]}` |

Projects: drawings uploaded inside a project are copied to `drawings/` in the project folder (same rules as models).

## Web contract

`web/src/drawingsApi.ts`, `web/src/DrawingsPanel.tsx`, `web/src/drawings.css`:
`DrawingsPanel({ sceneId, drawings, items, compare, onUpload(files), onRead(did), onFocusElement(gid) })` shows the
sheet with item boxes (colour by status), a table of items (tag, kind, size, status), and the mismatch list; clicking a
mismatch focuses the element in 3D. It is the **Drawings** step of a project, between Models and Coordination.

## Sample data

No public MEP drawing set exists (see `docs/research/drawing-datasets.md`). `evals/make_drawings.py` generates plan PDFs
from the Northbank sample (Level 02 MEP), with tags and size labels taken from the model and a text layer, plus a
variant with **planted mismatches** (a changed size, a removed tag, an extra tag) and `truth.json`, so the reader and
the comparison are scored exactly.
