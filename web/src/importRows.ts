// Per-file import rows (docs/engineer-workflow.md, step 2 "Import"): the existing upload stream's events
// (api.streamUpload, docs/uploads.md) reduced to one row per chosen file, with its type, stage, progress and error.
// Pure: the page keeps the rows in state and passes every event through `applyEvent`; ImportPanel draws them.
//
// What is measured, and so what a row may claim:
// - The upload is one request whose parts go up in the order the files were chosen, so its bytes are split over the
//   files in that order. Files under PACK_MIN are sent as they are (their share is exact); bigger ones are gzipped
//   first and share the rest of the request by their size (the packed sizes are not reported).
// - A STEP file's conversion is reported per file (`reading`, `classifying`, `meshing`, `converted`) with no
//   percentage, so its row shows none until it is converted.
// - Opening and measuring the elements (`opening`, `boxes`) cover all the files together: every row shows the same
//   batch figure, marked `shared`, never a number of its own.
// - The server opens the batch all or nothing: one failure fails every file, and Retry sends them all again.
import type { UploadEvent } from "./api";

export type ImportKind = "IFC" | "STEP" | "Navisworks" | "Unsupported";
export type ImportStage = "queued" | "packing" | "uploading" | "converting" | "processing" | "drawing" | "ready" | "failed";

export interface ImportRow {
  name: string;
  kind: ImportKind;
  /** Bytes as chosen, before packing. */
  size: number;
  stage: ImportStage;
  /** 0–100; absent when nothing is measured for this stage (the bar is indeterminate). */
  pct?: number;
  /** `pct` is the whole batch's (the server measures all the files together), not this file's own. */
  shared?: boolean;
  error?: string;
  note?: string;
}

export interface ImportSummary {
  /** Rows, model files (IFC, STEP), and those ready, failed, refused (not a model) and still going. */
  total: number; models: number; ready: number; failed: number; refused: number; active: number;
  /** A model file failed and nothing is running: Retry sends the batch again. */
  retry: boolean;
  text: string;
}

/** Files at least this big are gzipped before they are sent (api.ts, `pack`); smaller ones go as they are. */
export const PACK_MIN = 1 << 20;

export const PDF_REFUSAL = "A PDF drawing is not a model: add it on the Drawings step, where Iris reads it against the models";

const MODEL_KINDS: readonly ImportKind[] = ["IFC", "STEP"];
const NAMING = "The AI is naming";

export function importKind(name: string): ImportKind {
  if (/\.ifc$/i.test(name)) return "IFC";
  if (/\.(step|stp)$/i.test(name)) return "STEP";
  if (/\.(nwd|nwc|nwf)$/i.test(name)) return "Navisworks";
  return "Unsupported";
}

/** The file's extension, lower case, without the dot ("" when it has none). */
export function extension(name: string): string {
  return /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** Why a file that is not a model cannot be imported. */
function refusal(name: string, kind: ImportKind): string {
  if (kind === "Navisworks") {
    return "Navisworks files (.nwd, .nwc, .nwf) aren't opened as models — export IFC from the design tool; a Navisworks clash report (XML) goes in Coordinate › Import";
  }
  const ext = extension(name);
  if (ext === "pdf") return PDF_REFUSAL;
  if (ext === "dwg" || ext === "dxf") return `2D drawings (${ext.toUpperCase()}) aren't supported yet — import IFC or STEP models`;
  if (ext === "ifczip") return "Zipped IFC (.ifczip) isn't read yet — unzip it and import the .ifc";
  return `${ext ? `.${ext} files aren't` : "This file isn't"} a model Iris can open — import IFC (.ifc) or STEP (.step, .stp)`;
}

const isModel = (r: ImportRow) => MODEL_KINDS.includes(r.kind);
/** A model row the stream still moves (not yet ready, not failed). */
const live = (r: ImportRow) => isModel(r) && r.stage !== "failed" && r.stage !== "ready";

/** The files that go to the server: IFC and STEP, in the order chosen. */
export function sendableFiles<T extends { name: string }>(files: T[]): T[] {
  return files.filter((f) => MODEL_KINDS.includes(importKind(f.name)));
}

/** One row per chosen file: models queued, anything else refused at once with the reason. */
export function initRows(files: { name: string; size: number }[]): ImportRow[] {
  return files.map(({ name, size }) => {
    const kind = importKind(name);
    return MODEL_KINDS.includes(kind) ? { name, kind, size, stage: "queued" as const }
      : { name, kind, size, stage: "failed" as const, error: refusal(name, kind) };
  });
}

/** The row moved to `stage`: what the earlier stage said (progress, note, error) does not carry over. */
function set(r: ImportRow, stage: ImportStage, extra: Partial<Pick<ImportRow, "pct" | "shared" | "note" | "error">> = {}): ImportRow {
  const out: ImportRow = { name: r.name, kind: r.kind, size: r.size, stage };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

const count = (n: unknown) => (typeof n === "number" ? n.toLocaleString() : "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Each model row's span of the upload request, in the request's own bytes: [start, end) by row index, and the sum.
 * Small files are sent as they are; the rest of the request is shared by the packed files in proportion to size. */
function uploadSpans(rows: ImportRow[], total: number): { spans: Map<number, [number, number]>; sum: number } {
  const batch = rows.map((r, i) => [r, i] as const).filter(([r]) => isModel(r));
  const small = batch.reduce((n, [r]) => n + (r.size < PACK_MIN ? r.size : 0), 0);
  const large = batch.reduce((n, [r]) => n + (r.size < PACK_MIN ? 0 : r.size), 0);
  const rest = total - small;
  const weight = (r: ImportRow) => (r.size < PACK_MIN || rest <= 0 || !large ? r.size : (rest * r.size) / large);
  const spans = new Map<number, [number, number]>();
  let at = 0;
  for (const [r, i] of batch) { const w = weight(r); spans.set(i, [at, at + w]); at += w; }
  return { spans, sum: at };
}

/** The rows after one upload event (UploadEvent, plus `done` and `error`, which the page passes on itself). */
export function applyEvent(rows: ImportRow[], ev: UploadEvent): ImportRow[] {
  const e = ev as { type: string } & Record<string, unknown>;
  const each = (f: (r: ImportRow, i: number) => ImportRow) => rows.map((r, i) => (live(r) ? f(r, i) : r));
  const step = (file: unknown, f: (r: ImportRow) => ImportRow) =>
    rows.map((r) => (live(r) && r.kind === "STEP" && r.name === file ? f(r) : r));
  switch (e.type) {
    case "packing":
      return each((r) => (r.name === e.name
        ? set(r, "packing", { note: r.size >= PACK_MIN ? "Compressing for the upload" : "Adding to the upload" })
        : r.stage === "packing" ? set(r, "queued", { note: "Ready to send" }) : r));
    case "upload": {
      const loaded = Number(e.loaded) || 0, total = Number(e.total) || 0;
      if (total <= 0) return each((r) => set(r, "uploading"));   // no length: nothing measured
      const { spans, sum } = uploadSpans(rows, total);
      const pos = Math.min(loaded, total) * (sum / total);
      const all = loaded >= total;
      return each((r, i) => {
        const [start, end] = spans.get(i) ?? [0, 0];
        if (all || (pos >= end && end > start)) {
          return set(r, "uploading", { pct: 100, note: all ? "Sent; waiting for the server" : "Sent; the rest of the batch is still going up" });
        }
        if (pos < start || end <= start) return set(r, "queued", { note: "Waiting to send" });
        return set(r, "uploading", { pct: Math.min(99, Math.floor(((pos - start) / (end - start)) * 100 + 1e-9)) });
      });
    }
    case "received": {
      const converting = rows.some((r) => live(r) && r.kind === "STEP");
      return each((r) => (r.kind === "STEP" ? set(r, "converting", { note: "Received; waiting to convert" })
        : set(r, "processing", { note: converting ? "Received; opens after the STEP conversion" : "Received; opening" })));
    }
    case "reading":
      return step(e.file, (r) => set(r, "converting", { note: "Reading the STEP file" }));
    case "classifying":
      return step(e.file, (r) => set(r, "converting", { note: `${NAMING} ${typeof e.parts === "number" ? `${count(e.parts)} ` : "its "}parts` }));
    case "classify_failed":   // no file named: the one being named
      return rows.map((r) => (live(r) && r.kind === "STEP" && r.stage === "converting" && r.note?.startsWith(NAMING)
        ? set(r, "converting", { note: "The AI could not name the parts: they convert with their STEP names" }) : r));
    case "meshing":
      return step(e.file, (r) => set(r, "converting", { note: `Converting ${typeof e.parts === "number" ? `${count(e.parts)} ` : "the "}parts to IFC` }));
    case "converted": {
      const what = [typeof e.parts === "number" ? `${count(e.parts)} parts` : "", typeof e.seconds === "number" ? `in ${e.seconds} s` : ""]
        .filter(Boolean).join(" ");
      return step(e.file, (r) => set(r, "converting", { pct: 100,
        note: e.cached ? "Converted (the same file was converted before)" : `Converted${what ? ` ${what}` : ""}` }));
    }
    case "opening": {
      const n = typeof e.files === "number" ? e.files : rows.filter(live).length;
      return each((r) => set(r, "processing", { note: n > 1 ? `Opening ${n} models together` : "Opening the model" }));
    }
    case "boxes": {
      const done = Number(e.done) || 0, total = Number(e.total) || 0;
      const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : undefined;
      return each((r) => set(r, "processing", { pct, shared: true,
        note: `Measuring elements: ${count(done)} of ${count(total)}, all files together` }));
    }
    case "done":
      return each((r) => set(r, "drawing", { note: "Opened on the server; drawing" }));
    case "error":
      return failAll(rows, typeof e.detail === "string" && e.detail ? e.detail : "The import failed.");
    default:   // tick (a heartbeat) and anything new: nothing to show
      return rows;
  }
}

/** Files drawn so far, by the viewer's count over the server's file list (`files` in its order: an upload keeps the
 * names as chosen, a STEP included). */
export function drawnUpTo(files: string[], drawn: number): Record<string, boolean> {
  return Object.fromEntries(files.slice(0, Math.max(0, drawn)).map((f) => [f, true]));
}

/** The rows after drawing: with `shown` (the models are on screen) the files named are ready; without it (the viewer
 * parses every file off screen before it shows any) a file the server has opened is marked parsed, still drawing. */
export function applyDraw(rows: ImportRow[], drawnByFile: Record<string, boolean>, shown = true): ImportRow[] {
  return rows.map((r) => {
    if (!isModel(r) || r.stage === "failed" || !drawnByFile[r.name]) return r;
    if (shown) return set(r, "ready");
    return r.stage === "drawing" ? set(r, "drawing", { note: "Parsed; shown when every file is" }) : r;
  });
}

/** The whole batch failed (the server opens the files all or nothing). When the reason names one of the files, that
 * file carries it and the others say why they were not opened; refused files keep their own reason. */
export function failAll(rows: ImportRow[], detail: string): ImportRow[] {
  const named = rows.filter((r) => isModel(r) && detail.includes(r.name));
  const culprit = named.length === 1 ? named[0].name : null;
  return rows.map((r) => (!isModel(r) ? r : set(r, "failed", {
    error: !culprit || r.name === culprit ? detail : `Not opened: ${culprit} failed, and the files open together or not at all`,
  })));
}

/** Without one row (the first with that name). */
export function removeRow(rows: ImportRow[], name: string): ImportRow[] {
  const i = rows.findIndex((r) => r.name === name);
  return i < 0 ? rows : [...rows.slice(0, i), ...rows.slice(i + 1)];
}

export function summary(rows: ImportRow[]): ImportSummary {
  const models = rows.filter(isModel);
  const ready = models.filter((r) => r.stage === "ready").length;
  const failed = models.filter((r) => r.stage === "failed").length;
  const active = models.filter(live).length;
  const refused = rows.length - models.length;
  const parts = models.length ? [`${ready} of ${plural(models.length, "model")} ready`] : [];
  if (active) parts.push(`${active} in progress`);
  if (failed) parts.push(`${failed} failed`);
  if (refused) parts.push(`${plural(refused, "file")} not supported`);
  return { total: rows.length, models: models.length, ready, failed, refused, active, retry: failed > 0 && active === 0,
    text: parts.join(" · ") || "No files chosen" };
}
