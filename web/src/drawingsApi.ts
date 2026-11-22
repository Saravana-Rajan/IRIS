import { ApiError, apiFetch, apiUrl } from "./api";

/* 2D drawing reader (docs/drawings.md): typed calls for the drawings routes, and the plain facts the Drawings step
 * shows (status words and styles, mismatch words, cost, page labels, zoom). AI reads, data checks, the engineer
 * decides. No React, no App state. */

/* ---------------------------------------------------------------------------------------------------------------- */
/* Types (mirror server/iris/drawings.py, drawing_reader.py, drawing_compare.py)                                     */

/** A word of the PDF's own text layer, in pixels on the rendered page (origin top-left). */
export interface Word { text: string; x0: number; y0: number; x1: number; y1: number }
/** One rendered page. `png` is relative to the drawing's folder; the browser asks `pageUrl` for it. */
export interface Page {
  index: number; width_px: number; height_px: number; dpi: number; png: string;
  words: Word[]; has_text_layer: boolean;
}
/** Title-block fields when found on the sheet (sheet, scale, title). */
export type TitleBlock = Partial<Record<"sheet" | "scale" | "title", string>> & Record<string, string | undefined>;
export interface Drawing { id: string; name: string; sha256: string; pages: Page[]; title: TitleBlock }

export type ItemKind = "duct" | "pipe" | "tray" | "diffuser" | "unit" | "equipment" | "other";
export type ItemSource = "ai" | "text";
/** confirmed: the AI's tag/size is also in the text layer near its box; ai_only: the AI's alone; text_only: the text
 *  layer's alone. */
export type ItemStatus = "confirmed" | "ai_only" | "text_only";
export interface Item {
  id: string;
  /** The Page.index it was read on. */
  page: number;
  tag: string | null; kind: ItemKind; size: string | null; size_mm: number[] | null;
  /** [x0, y0, x1, y1] pixels on the page. */
  box: number[];
  source: ItemSource; status: ItemStatus;
  /** Matched words, distance in px, model, cost. */
  evidence: Record<string, unknown>;
}

export type MismatchKind = "missing_in_model" | "missing_in_drawing" | "size_differs" | "type_differs";
export interface Mismatch {
  kind: MismatchKind;
  /** The drawing item's id (none for missing_in_drawing). */
  item: string | null;
  /** The model element's IFC GlobalId (none for missing_in_model). */
  element: string | null;
  drawing_value: string | null; model_value: string | null;
  /** How the match was made (tag / name / Pset key) and the numbers compared. */
  evidence: Record<string, unknown>;
}
export interface Match { item: string; element: string; by: string }
export interface Comparison { matches: Match[]; mismatches: Mismatch[] }

/** The read stream's events, as this module hands them on (see `toReadEvent`). */
export type ReadEvent =
  | { type: "page"; page: number; total: number }
  | { type: "item"; item: Item }
  | { type: "done"; items: number; cost_usd: number | null }
  | { type: "error"; detail: string; status: number };
/** What a finished reading returns: every item the stream sent, and what it cost (null when not reported). */
export interface ReadResult { items: Item[]; count: number; cost_usd: number | null }
export interface ReadOptions { pages?: number[]; onEvent?(e: ReadEvent): void; signal?: AbortSignal }

/* ---------------------------------------------------------------------------------------------------------------- */
/* Calls                                                                                                            */

const enc = encodeURIComponent;
const sceneAt = (sid: string) => apiUrl(`/api/scenes/${enc(sid)}/drawings`);
const drawingAt = (did: string) => apiUrl(`/api/drawings/${enc(did)}`);

/** FastAPI's detail: a sentence, or a validation error's list of `{msg}`. */
export function detailOf(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d)) {
    const msgs = d.map((x) => (x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string" ? (x as { msg: string }).msg : ""))
      .filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return null;
}

async function failure(r: Response): Promise<ApiError> {
  return new ApiError(detailOf(await r.json().catch(() => null)) ?? `Request failed (${r.status})`, r.status);
}

async function getJson<T>(url: string): Promise<T> {
  const r = await apiFetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw await failure(r);
  return (await r.json()) as T;
}

/** Upload progress: bytes sent of the total. */
export type UploadProgress = (loaded: number, total: number) => void;

/** Upload PDF drawings to a scene: pages rendered, text layer read, the new drawings returned. Sent with
 *  XMLHttpRequest when the browser has it (for upload progress), else fetch. Multipart field `files`, as models. */
export function uploadDrawings(sceneId: string, files: readonly File[], onProgress?: UploadProgress): Promise<Drawing[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const url = sceneAt(sceneId);
  if (typeof XMLHttpRequest === "undefined") {
    return apiFetch(url, { method: "POST", body: form }).then(async (r) => {
      if (!r.ok) throw await failure(r);
      return (await r.json()) as Drawing[];
    });
  }
  return new Promise<Drawing[]>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (/^https?:/.test(url)) xhr.withCredentials = true;   // the server on another origin: its cookie goes too
    xhr.setRequestHeader("Accept", "application/json");
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : 0);
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(detailOf(body) ?? `Upload failed (${xhr.status})`, xhr.status));
      } else if (!Array.isArray(body)) {
        reject(new ApiError("The server's answer to the upload was not a list of drawings.", xhr.status));
      } else resolve(body as Drawing[]);
    };
    xhr.onerror = () => reject(new ApiError("The upload stopped: the connection dropped.", 0));
    xhr.onabort = () => reject(new ApiError("The upload was cancelled.", 0));
    xhr.send(form);
  });
}

export const listDrawings = (sceneId: string) => getJson<Drawing[]>(sceneAt(sceneId));
/** Where page `n` (its Page.index) of a drawing is drawn from. */
export const pageUrl = (did: string, n: number) => `${drawingAt(did)}/pages/${n}.png`;
export const drawingItems = (did: string) => getJson<Item[]>(`${drawingAt(did)}/items`);
export const compareDrawings = (sceneId: string) => getJson<Comparison>(`${sceneAt(sceneId)}/compare`);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One stream line as a ReadEvent, or null for one this page does not use (a keep-alive, a future event). Tolerant of
 *  the page event's field names (`page`/`index`, `total`/`pages`/`of`) and of `done.items` as a count or a list. */
export function toReadEvent(raw: unknown): ReadEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.type) {
    case "page": {
      const page = num(e.page) ?? num(e.index), total = num(e.total) ?? num(e.pages) ?? num(e.of);
      return page === null ? null : { type: "page", page, total: total ?? 0 };
    }
    case "item":
      return e.item && typeof e.item === "object" ? { type: "item", item: e.item as Item } : null;
    case "done":
      return { type: "done", items: Array.isArray(e.items) ? e.items.length : num(e.items) ?? 0, cost_usd: num(e.cost_usd) };
    case "error":
      return { type: "error", detail: (typeof e.detail === "string" && e.detail) || (typeof e.message === "string" && e.message)
        || "The reading failed.", status: num(e.status) ?? 500 };
    default: return null;
  }
}

/** Split buffered NDJSON text into parsed lines and the unfinished rest. A line that is not JSON throws. */
export function splitNdjson(buffer: string): { lines: unknown[]; rest: string } {
  const lines: unknown[] = [];
  let start = 0;
  for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n", start)) {
    const line = buffer.slice(start, nl).trim();
    start = nl + 1;
    if (line) lines.push(JSON.parse(line));
  }
  return { lines, rest: buffer.slice(start) };
}

/** Read a drawing (all pages, or `pages`) as an NDJSON stream: `page` progress, `item` events, then `done` with the
 *  cost. Resolves with the items sent and the cost; an `error` event, a failed request or a stream that ends without
 *  `done` rejects (ApiError). Every event goes to `onEvent` as it arrives. */
export async function readDrawing(did: string, { pages, onEvent, signal }: ReadOptions = {}): Promise<ReadResult> {
  const r = await apiFetch(`${drawingAt(did)}/read`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(pages && pages.length ? { pages: [...pages] } : {}),
  });
  if (!r.ok || !r.body) throw await failure(r);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const items: Item[] = [];
  let buffer = "";
  const take = (raw: unknown): ReadResult | null => {
    const e = toReadEvent(raw);
    if (!e) return null;
    if (e.type === "item") items.push(e.item);
    onEvent?.(e);
    if (e.type === "error") throw new ApiError(e.detail, e.status);
    return e.type === "done" ? { items, count: Math.max(e.items, items.length), cost_usd: e.cost_usd } : null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      if (done) buffer += "\n";
      const { lines, rest } = splitNdjson(buffer);
      buffer = rest;
      for (const raw of lines) {
        const result = take(raw);
        if (result) return result;
      }
      if (done) throw new ApiError("The reading stopped before it finished.", 0);
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

/** The same calls as one object, for a caller that passes them around (tests, the integration in App). */
export const drawingsApi = { uploadDrawings, listDrawings, pageUrl, readDrawing, drawingItems, compareDrawings };

/* ---------------------------------------------------------------------------------------------------------------- */
/* Facts the Drawings step shows                                                                                    */

/** The proof grammar for a reading: confirmed = solid teal (data checked it), AI-read = dashed indigo (the AI alone),
 *  text only = dotted grey (the PDF's text, no AI reading). `cls` is the CSS class (`st-…`) the box, badge and row use. */
export const STATUS_STYLE: Record<ItemStatus, { cls: string; line: "solid" | "dashed" | "dotted"; label: string; glyph: string; meaning: string }> = {
  confirmed: { cls: "st-confirmed", line: "solid", label: "Confirmed", glyph: "✓",
    meaning: "The AI's reading is also in the PDF's own text near the item." },
  ai_only: { cls: "st-ai", line: "dashed", label: "AI-read: check", glyph: "✦",
    meaning: "Only the AI read this; the PDF's text does not confirm it. Check it on the sheet." },
  text_only: { cls: "st-text", line: "dotted", label: "Text layer only", glyph: "T",
    meaning: "Found in the PDF's text; the AI did not read it as an item." },
};
export const statusStyle = (s: ItemStatus) => STATUS_STYLE[s] ?? STATUS_STYLE.ai_only;

/** Mismatch words, and their weight: a missing item is red, a difference amber. */
export const MISMATCH_STYLE: Record<MismatchKind, { cls: string; label: string; glyph: string }> = {
  missing_in_model: { cls: "mk-missing", label: "Missing in model", glyph: "✕" },
  missing_in_drawing: { cls: "mk-missing", label: "Missing in drawing", glyph: "✕" },
  size_differs: { cls: "mk-differs", label: "Size differs", glyph: "≠" },
  type_differs: { cls: "mk-differs", label: "Type differs", glyph: "≠" },
};
export const mismatchStyle = (k: MismatchKind) => MISMATCH_STYLE[k] ?? { cls: "mk-differs", label: String(k), glyph: "≠" };

export const KIND_LABEL: Record<ItemKind, string> = {
  duct: "Duct", pipe: "Pipe", tray: "Cable tray", diffuser: "Diffuser", unit: "Unit", equipment: "Equipment", other: "Other",
};
export const kindLabel = (k: string) => KIND_LABEL[k as ItemKind] ?? k;

/** A drawing size as printed: "600x300" → "600 × 300", "Ø150" kept. */
export const sizeText = (s: string | null | undefined) => (s ? s.replace(/(\d)\s*[xX×*]\s*(?=\d)/g, "$1 × ") : "");

/** What a reading cost: "$0.0042", "$1.20", "$0 (cached)", or "cost not reported". */
export function costText(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "cost not reported";
  if (usd === 0) return "$0 (already read, cached)";
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/** The sheet's text-layer state: every page has one, some do, or none (scanned: every item is AI-read). */
export type TextLayer = "all" | "some" | "none";
export function textLayerOf(d: Pick<Drawing, "pages">): TextLayer {
  const n = d.pages.filter((p) => p.has_text_layer).length;
  return n === 0 ? "none" : n === d.pages.length ? "all" : "some";
}
export const TEXT_LAYER_LABEL: Record<TextLayer, string> = {
  all: "Text layer ✓", some: "Text layer on some pages", none: "Scanned — AI only",
};

/** The 1-based page number people see for a Page.index (its place in the drawing), whatever base the server uses. */
export function pageNumber(d: Pick<Drawing, "pages">, index: number): number {
  const i = d.pages.findIndex((p) => p.index === index);
  return i >= 0 ? i + 1 : index + 1;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many items have each status. */
export function statusTally(items: readonly Pick<Item, "status">[]): Record<ItemStatus, number> {
  const t: Record<ItemStatus, number> = { confirmed: 0, ai_only: 0, text_only: 0 };
  for (const it of items) if (it.status in t) t[it.status]++;
  return t;
}

/** The item a mismatch names, wherever it was read (items by drawing id), with its drawing. */
export function findItem(items: Readonly<Record<string, readonly Item[]>>, id: string | null | undefined): { did: string; item: Item } | null {
  if (!id) return null;
  for (const did of Object.keys(items)) {
    const item = items[did]?.find((it) => it.id === id);
    if (item) return { did, item };
  }
  return null;
}

/* Zoom and pan: a view is the page's top-left on screen (x, y) and screen pixels per page pixel (s). */
export interface View { s: number; x: number; y: number }
export const ZOOM_MIN = 0.02, ZOOM_MAX = 8;

/** The view that fits the page's width to the stage (with a small margin), top aligned; centred when it is short. */
export function fitWidth(stage: { w: number; h: number }, page: { w: number; h: number }, margin = 8): View {
  if (stage.w <= 0 || page.w <= 0) return { s: 1, x: 0, y: 0 };
  const s = clamp((stage.w - 2 * margin) / page.w, ZOOM_MIN, ZOOM_MAX);
  const h = page.h * s;
  return { s, x: (stage.w - page.w * s) / 2, y: h < stage.h ? (stage.h - h) / 2 : margin };
}

/** Zoom by `factor` about the stage point (px, py): the page point under it stays under it. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const s = clamp(v.s * factor, ZOOM_MIN, ZOOM_MAX);
  const k = s / v.s;
  return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** The view that centres a page box [x0, y0, x1, y1] on the stage, zooming in only as far as `minScale`. */
export function centreOn(v: View, box: readonly number[], stage: { w: number; h: number }, minScale = v.s): View {
  const [x0, y0, x1, y1] = box;
  const s = clamp(Math.max(v.s, minScale), ZOOM_MIN, ZOOM_MAX);
  return { s, x: stage.w / 2 - ((x0 + x1) / 2) * s, y: stage.h / 2 - ((y0 + y1) / 2) * s };
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
