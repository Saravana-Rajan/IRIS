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
  (`IRIS_ESCALATION_MAX_USD_DAY`); a sheet is read once and cached by file hash + page. A sample sheet ships with its
  saved reading, which is replayed instead of a call (below).
- **Across drawings**, an element one drawing leaves out but another sheet shows is not missing, and one left out by
  several is listed once. Two drawings with the same sheet number (`drawings.sheet_key`: the title block's sheet
  number, else its drawing number, without case, spaces or punctuation) are two issues of one sheet, each a whole
  sheet: one showing an element does not excuse the other leaving it out. The clean and the mismatch sample are both
  M-201, so with both attached the run the mismatch sheet leaves out (`SA-BR-L02-N2-2`) is still reported, though the
  clean sheet shows it. A drawing with neither number is a sheet of its own.

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
| `POST /api/scenes/{sid}/drawings/samples` | | `Drawing[]`: the open demo's sample sheets, attached as an upload is; 409 when the open models have none |
| `GET /api/scenes/{sid}/drawings` | | `Drawing[]` |
| `GET /api/drawings/{did}/pages/{n}.png` | | the page image |
| `POST /api/drawings/{did}/read` | `{pages?: int[]}` | NDJSON stream: `page` progress (`saved` when replayed), `item` events, `done {items, cost_usd, saved}` |
| `GET /api/drawings/{did}/items` | | `Item[]` |
| `GET /api/scenes/{sid}/drawings/compare` | | `{matches: [{item, element, by}], mismatches: Mismatch[]}` |

Every `Drawing` these routes return also carries `saved_reading`: `{model, label, at}` when every page has a saved
reading (a sample sheet), else null. The full contract is in
[10 · HTTP API and streams](architecture/10-http-api-and-streams.md).

Projects: drawings uploaded inside a project are copied to `drawings/` in the project folder (same rules as models).

## Web contract

`web/src/drawingsApi.ts`, `web/src/DrawingsPanel.tsx`, `web/src/drawings.css`:
`DrawingsPanel({ sceneId, drawings, items, compare, onUpload(files), onRead(did), onFocusElement(gid) })` shows the
sheet with item boxes (colour by status), a table of items (tag, kind, size, status), and the mismatch list; clicking a
mismatch focuses the element in 3D. It is the **Drawings** step of a project, between Models and Coordination.
With the sample building open and no drawings yet, it offers **Add the sample drawings** (`onSamples`, which App
wires to `addSampleDrawings`).

## Sample data

No public MEP drawing set exists (see `docs/research/drawing-datasets.md`). `evals/make_drawings.py` generates plan PDFs
from the Northbank sample (Level 02 MEP), with tags and size labels taken from the model and a text layer, plus a
variant with **planted mismatches** (a changed size, a removed tag, an extra tag) and `truth.json`, so the reader and
the comparison are scored exactly. Both sheets go with the Northbank demo (`demos.Demo.drawings`): `GET /api/samples`
lists them with it, and `POST /api/scenes/{sid}/drawings/samples` attaches them to a scene whose open models are
Northbank's.

## Saved readings (the sample sheets)

A visitor can try the reader on the sample sheets with no upload and no Gemini spend. Each sample PDF ships with the
model's reply to it, saved once: `samples/drawings/<stem>.reading.json`. Reading the sheet replays that reply instead
of calling the model. The text-layer check and the comparison still run on every read, as for any drawing.

- **Keying.** `drawing_reader.saved_reading` replays a page only when three things match: the file's
  `drawing_sha256` is the PDF's sha256, its `prompt_hash` is `prompt_hash()` now, and its saved whole-sheet tile is
  the page's pixel size. Otherwise it returns None and the page is read by the model as before: cached, budgeted and
  charged. Any other PDF never matches; an upload of a sample sheet's exact bytes does.
- **What a replay does.** No call, no budget check, nothing charged: `done.cost_usd` counts 0 for a replayed page.
  The stream says so: the `page` event has `saved: true`, each AI item's `evidence.saved_reading` is
  `{model, label, at}`, and `done.saved` is `{model, label, at, pages}` (null when no page was replayed). `label` is
  the model id as people read it (`model_name`: "gemini-3.8-flash" → "Gemini 3.8 Flash").
- **Honesty in the page.** A saved reading is never shown as a live one. A sheet with one carries `saved_reading`
  (`saved_info`, set only when every page has one) and a **Saved reading** badge. While it runs the read says
  "Replaying the saved reading of page n of N"; after it, the cost reads "$0 (saved reading)" and the sheet says
  "Saved AI reading of this sample (Gemini 3.8 Flash): replayed at no cost, not read live." The model named is the
  one in the file. The thinking level it was read at is in the file's `settings`, not on the page.
- **Making them.** `cd server && uv run python ../evals/save_drawing_readings.py` takes each sample PDF in as an
  upload is (`drawings.ingest`), reads it with the reader's own Gemini call (the fast model, the prompt, schema and
  images as they are now) and writes the file with `drawing_reader.write_saved`, from the reader's own cache. It
  needs Gemini credentials. Spend is capped hard: `--max-usd` (default 0.30) stops the run before a sheet or page
  that could take it past the cap, and `--max-output-tokens` (default 18,000, thinking included) bounds what one
  page can cost. The reader's own thinking level (high) did not finish the A1 sample sheet within its 240 s
  deadline, so the saved readings are made at `--thinking low` (the default) with `--timeout 300`; the file records
  both in `settings`. `--only <name>.pdf` does one sheet. A sheet with a page whose reply failed is not saved. A
  reply already in the reader's cache is used again at no cost. The files hold the replies, the hashes, the model id
  and those settings; no secret.
- **Checking them.** `--check` calls no model: it replays each saved reading, opens the sample building, and prints
  per sheet the items by status, how many of its printed labels (its `.truth.json`) were confirmed, and the
  comparison with the model next to the planted mismatches; then both sheets compared together as the Drawings step
  compares them. It exits 4 when a sheet has no saved reading, 1 when a sheet's mismatches are not exactly the
  planted ones.
- **What makes one stale.** A new PDF (`evals/make_drawings.py` after a model or generator change: new bytes, new
  sha256), a change to the prompt, the per-page text, the schema, the tiling or `VERSION` (a new `prompt_hash`), or
  pages rendered at another size (`drawings.DPI`). A stale file is not an error: the sheet loses its badge and is read
  live, at the usual cost. Run the save script again after any of these. A different fast model or thinking level
  does not make one stale (neither is in the key): the replay still names the model that made it.

## The demo path

From the first screen, **Try the sample drawings** opens the sample project (Northbank), opens its models, attaches
the two sample sheets (`POST .../drawings/samples`) and lands on `/projects/<pid>/drawings`. In a project with the
sample building open and no drawings, the Drawings step offers **Add the sample drawings** instead. Reading either
sheet replays its saved reading; the comparison with the model then runs as after any read. Uploading your own PDFs
reads them live.

**The sample sheets open already read.** When the page has fetched a sheet's items and found none, and the sheet has a
saved reading (`Drawing.saved_reading`), `DrawingsPanel` replays it by itself (`autoReplays`: once per sheet, after
the page stops being busy; a failure waits for Retry): the same `POST .../read` stream, free and instant, so the items
and the comparison's mismatches (four on the two sample sheets) show with no click, under the honest "Saved AI reading
of this sample (Gemini 3.8 Flash)" note. Its card says "Opening the saved reading…" until then, never "Not read yet",
and its button reads **Replay the reading**. A sheet without a saved reading (the user's own PDFs) is never read
until **Read with AI** is clicked, since a live reading costs.

**The sheet viewer** opens fitted to its width and says its zoom against that fit ("Fit", then 125 %, …), not against
the page image's pixels (an A1 sheet rendered for reading opened at "6 %"). The zoom buttons and the key sit in one row
under the sheet, never over it; on a phone the stage takes the sheet's shape (`--dwg-sheet-ar`), so the fitted sheet
fills it. The read button, the saved note and the reading line each keep their own line above the sheet.

**Colours (white and pink).** The page is white; the selected readings tab is the pink accent (`--accent-ink` word,
`--pink` underline, its count on `--accent-soft`), the others grey until hovered. A mismatch is **red when the drawing
differs from the model** (size or type, `mk-differs`) and **amber when an element is missing** on one side
(`mk-missing`): the same two colours on the sheet's highlight, the list's edge and badge, and the key. The key under
the sheet lists the reading statuses (confirmed, AI-read, text only) on one row and "Differs from the model" and
"Missing" on the next.
