import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Box, ChevronLeft, ChevronRight, FileUp, History, Maximize2, RotateCcw, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import {
  centreOn, costText, findItem, fitWidth, kindLabel, mismatchStyle, pageNumber, pageUrl, plural, savedModel, savedOfItems,
  savedReadingOf, savedText, sizeText, statusStyle, statusTally, TEXT_LAYER_LABEL, textLayerOf, zoomAt,
  type Comparison, type Drawing, type Item, type ItemStatus, type Mismatch, type ReadEvent, type ReadResult,
  type SavedReading, type UploadProgress, type View,
} from "./drawingsApi";
import "./drawings.css";

/** The Drawings step of a project (docs/drawings.md, "Web contract"): AI reads the sheets, data checks each reading
 * (the PDF's own text layer, then the model's data), the engineer decides. Props only: the page owns the drawings,
 * their items and the comparison, and runs the calls (drawingsApi.ts). */
export interface DrawingsPanelProps {
  sceneId: string | null;
  drawings: readonly Drawing[];
  /** Items by drawing id (GET /api/drawings/{did}/items): absent until fetched, [] when not read yet. A sample sheet
   *  (`saved_reading`) fetched with [] replays its saved reading at once (`autoReplays`); other sheets wait for a click. */
  items: Readonly<Record<string, readonly Item[]>>;
  /** GET /api/scenes/{sid}/drawings/compare, or null before it has run. */
  compare: Comparison | null;
  /** The page is busy elsewhere: uploads and readings wait. */
  busy?: boolean;
  /** GlobalId → element name, for the model side of a mismatch. */
  names?: Readonly<Record<string, string>>;
  /** Loading the drawings or the comparison failed: shown with Retry. */
  error?: string | null;
  onRetry?(): void;
  /** Upload PDFs. Return the call's promise (drawingsApi.uploadDrawings) to have its progress and errors shown here. */
  onUpload(files: File[], onProgress?: UploadProgress): Promise<unknown> | void;
  /** Read a drawing with AI. Return drawingsApi.readDrawing's promise, passing `onEvent` on, for live progress and cost. */
  onRead(did: string, onEvent?: (e: ReadEvent) => void): Promise<ReadResult | void> | void;
  /** Show a model element in 3D (the page's go-to-element / isolate). */
  onFocusElement(gid: string): void;
  onSelectItem?(item: Item, drawing: Drawing): void;
  /** The open models are the sample building: with no drawings yet, offer its sample drawings (drawingsApi
   *  .addSampleDrawings). Return the call's promise to have its progress and errors shown here. */
  onSamples?(): Promise<unknown> | void;
}

/** A reading's state. `reading.saved`: the page in hand replays its saved reading; `done.saved`: the saved reading the
 *  read replayed (null when read live). */
export type ReadState =
  | { state: "reading"; page: number | null; total: number; items: number; saved?: boolean }
  | { state: "done"; count: number; cost_usd: number | null; saved?: SavedReading | null }
  | { state: "error"; message: string };
type UploadState =
  | { state: "sending"; loaded: number; total: number; names: string[] }
  | { state: "error"; message: string; files: File[] };
type SamplesState = { state: "adding" } | { state: "error"; message: string };
type Tab = "items" | "mismatches";

const area = (b: readonly number[]) => (b.length < 4 ? 0 : Math.abs((b[2] - b[0]) * (b[3] - b[1])));
const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : "Something went wrong.");
const isPromise = <T,>(v: unknown): v is Promise<T> => !!v && typeof (v as { then?: unknown }).then === "function";
const RULE = "AI reads, data checks, the engineer decides.";
const HOW = "Iris reads each sheet with AI, then checks every tag and size against the PDF's own text layer and compares "
  + "them with the 3D model's data. Nothing is changed for you: you decide what to fix.";

export function DrawingsPanel({ sceneId, drawings, items, compare, busy = false, names = {}, error, onRetry, onUpload, onRead,
  onFocusElement, onSelectItem, onSamples }: DrawingsPanelProps) {
  const [sel, setSel] = useState<string | null>(null);
  const [pageAt, setPageAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [filter, setFilter] = useState<ItemStatus | "all">("all");
  const [reads, setReads] = useState<Record<string, ReadState>>({});
  const [live, setLive] = useState<Record<string, Item[]>>({});
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [samples, setSamples] = useState<SamplesState | null>(null);
  // Sheets replayed on their own (`autoReplays`): each once, even when React runs an effect twice.
  const replayed = useRef<Set<string>>(new Set());

  const current = drawings.find((d) => d.id === sel) ?? drawings[0] ?? null;
  const itemsOf = (did: string): readonly Item[] => (items[did]?.length ? items[did] : live[did] ?? []);
  const shown = current ? itemsOf(current.id) : [];
  const pIdx = current ? Math.min(pageAt, Math.max(0, current.pages.length - 1)) : 0;
  const page = current?.pages[pIdx] ?? null;
  const mismatches = compare?.mismatches ?? [];
  const pickedItem = picked ? shown.find((it) => it.id === picked) ?? null : null;

  const choose = (did: string) => { if (did !== current?.id) { setSel(did); setPageAt(0); setPicked(null); } };
  const pick = (it: Item, d: Drawing | null = current) => {
    if (!d) return;
    if (d.id !== current?.id) setSel(d.id);
    const at = d.pages.findIndex((p) => p.index === it.page);
    if (at >= 0) setPageAt(at);
    setPicked(it.id);
    onSelectItem?.(it, d);
  };

  const send = (files: File[]) => {
    if (busy || upload?.state === "sending") return;
    const pdfs = files.filter(isPdf);
    setSkipped(files.filter((f) => !isPdf(f)).map((f) => f.name));
    if (!pdfs.length) return;
    const total = pdfs.reduce((n, f) => n + f.size, 0);
    setUpload({ state: "sending", loaded: 0, total, names: pdfs.map((f) => f.name) });
    let out: unknown;
    try {
      out = onUpload(pdfs, (loaded, t) => setUpload((u) => (u?.state === "sending" ? { ...u, loaded, total: t || u.total } : u)));
    } catch (e) { setUpload({ state: "error", message: messageOf(e), files: pdfs }); return; }
    if (!isPromise(out)) { setUpload(null); return; }
    out.then(() => setUpload(null), (e) => setUpload({ state: "error", message: messageOf(e), files: pdfs }));
  };

  const read = (d: Drawing) => {
    if (busy || reads[d.id]?.state === "reading") return;
    const did = d.id;
    setReads((r) => ({ ...r, [did]: { state: "reading", page: null, total: d.pages.length, items: 0 } }));
    setLive((l) => ({ ...l, [did]: [] }));
    const onEvent = (e: ReadEvent) => {
      if (e.type === "page") {
        setReads((r) => { const s = r[did]; return s?.state === "reading" ? { ...r, [did]: { ...s, page: e.page, total: e.total || s.total, saved: e.saved === true } } : r; });
      } else if (e.type === "item") {
        setLive((l) => ({ ...l, [did]: [...(l[did] ?? []), e.item] }));
        setReads((r) => { const s = r[did]; return s?.state === "reading" ? { ...r, [did]: { ...s, items: s.items + 1 } } : r; });
      }
    };
    let out: unknown;
    try { out = onRead(did, onEvent); } catch (e) { setReads((r) => ({ ...r, [did]: { state: "error", message: messageOf(e) } })); return; }
    if (!isPromise<ReadResult | void>(out)) { setReads((r) => { const { [did]: _gone, ...rest } = r; return rest; }); return; }
    out.then(
      (res) => setReads((r) => ({ ...r, [did]: { state: "done", count: res ? res.count : 0, cost_usd: res ? res.cost_usd : null,
        saved: res ? savedReadingOf(res.saved) : null } })),
      (e) => setReads((r) => ({ ...r, [did]: { state: "error", message: messageOf(e) } })),
    );
  };

  // The sample sheets open already read: one with a saved reading whose items came back empty replays it now, free and
  // instant (docs/drawings.md, "Saved readings"). The user's own PDFs wait for Read with AI: a live reading costs.
  useEffect(() => {
    if (busy) return;
    for (const d of autoReplays(drawings, items, reads)) {
      if (replayed.current.has(d.id)) continue;
      replayed.current.add(d.id);
      read(d);
    }
  }, [drawings, items, busy]);  // eslint-disable-line react-hooks/exhaustive-deps

  const addSamples = () => {
    if (!onSamples || busy || !sceneId || samples?.state === "adding" || upload?.state === "sending") return;
    setSamples({ state: "adding" });
    let out: unknown;
    try { out = onSamples(); } catch (e) { setSamples({ state: "error", message: messageOf(e) }); return; }
    if (!isPromise(out)) { setSamples(null); return; }
    out.then(() => setSamples(null), (e) => setSamples({ state: "error", message: messageOf(e) }));
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragOver(true); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setDragOver(false); send([...(e.dataTransfer?.files ?? [])]); },
  };

  const notices = <>
    {error && <Alert message={error} onRetry={onRetry} />}
    {upload && <UploadLine upload={upload} onRetry={() => upload.state === "error" && send(upload.files)} onDismiss={() => setUpload(null)} />}
    {skipped.length > 0 && <p className="dwg-hint" role="status">{`Skipped (not PDF): ${skipped.join(", ")}. Only PDF drawings are read.`}</p>}
  </>;

  if (!drawings.length) {
    const adding = samples?.state === "adding";
    return (
      <section className={`dwg dwg-empty${dragOver ? " drag" : ""}`} aria-label="Drawings" {...dropProps}>
        <RuleStrip />
        {notices}
        <DropZone big disabled={busy || !sceneId || upload?.state === "sending" || adding} onFiles={send} />
        {onSamples && (
          <div className="dwg-samples">
            <p className="dwg-samples-line" aria-live="polite">
              <span>No drawings to hand?</span>
              <button type="button" className="btn" data-dwg="samples" aria-busy={adding || undefined}
                disabled={busy || !sceneId || adding || upload?.state === "sending"} onClick={addSamples}>
                {adding ? <><i className="spinner" aria-hidden /> Adding the sample drawings…</> : "Add the sample drawings"}</button>
            </p>
            {samples?.state === "error" && <Alert message={`Adding the sample drawings failed: ${samples.message}`} onRetry={addSamples}
              onDismiss={() => setSamples(null)} />}
          </div>
        )}
        {!sceneId && <p className="dwg-hint">Open the project's models first: drawings are compared with them.</p>}
      </section>
    );
  }

  const readState = current ? reads[current.id] : undefined;
  const wasRead = !!(current && (items[current.id]?.length || readState?.state === "done"));
  // The sheet's saved reading (the sample sheets): its own, the one a read just replayed, or its items' (read earlier).
  const savedSheet = current ? savedReadingOf(current.saved_reading) : null;
  const saved = savedSheet ?? (readState?.state === "done" ? readState.saved ?? null : null) ?? savedOfItems(shown);
  const tally = statusTally(shown);
  const filtered = filter === "all" ? shown : shown.filter((it) => it.status === filter);
  // Largest first, so a small box drawn over a large one stays on top and can be clicked.
  const onPage = page ? shown.filter((it) => it.page === page.index).sort((a, b) => area(b.box) - area(a.box)) : [];
  const mismatchOf = new Map<string, Mismatch>();
  for (const m of mismatches) if (m.item && !mismatchOf.has(m.item)) mismatchOf.set(m.item, m);
  const matchOf = new Map((compare?.matches ?? []).map((m) => [m.item, m] as const));

  return (
    <section className={`dwg${dragOver ? " drag" : ""}`} aria-label="Drawings" {...dropProps}>
      <RuleStrip />
      {notices}
      <div className="dwg-grid">
        <nav className="dwg-sheets" aria-label="Sheets">
          <header className="dwg-col-head">
            <h3>Sheets <span className="dwg-count">{drawings.length}</span></h3>
            <DropZone disabled={busy || !sceneId || upload?.state === "sending"} onFiles={send} />
          </header>
          <ul>
            {drawings.map((d) => {
              const its = itemsOf(d.id), t = statusTally(its), layer = textLayerOf(d), rs = reads[d.id], sv = savedReadingOf(d.saved_reading);
              const pending = sheetPending(d, items, rs);
              return (
                <li key={d.id}>
                  <button type="button" className="dwg-sheet" aria-current={d.id === current?.id ? "true" : undefined} onClick={() => choose(d.id)}>
                    <span className="dwg-sheet-name mono" title={d.name}>{d.name}</span>
                    {(d.title.sheet || d.title.title) && <span className="dwg-sheet-title">{[d.title.sheet, d.title.title].filter(Boolean).join(" · ")}</span>}
                    <span className="dwg-sheet-meta">
                      <span className="mono">{plural(d.pages.length, "page")}</span>
                      <span className={`dwg-badge ${layer === "none" ? "st-ai" : "st-confirmed"}`}
                        title={layer === "none" ? "No text layer: every item is AI-read and needs checking" : "Readings are checked against the PDF's own text"}>
                        {TEXT_LAYER_LABEL[layer]}</span>
                      {sv && <span className="dwg-badge dwg-saved-badge" data-dwg="saved-badge"
                        title={`A saved ${savedModel(sv)} reading of this sample: reading the sheet replays it at no cost; it is not read live.`}>
                        Saved reading</span>}
                    </span>
                    <span className="dwg-sheet-meta">
                      {rs?.state === "reading" ? <span>{sv ? "Opening the saved reading…" : "Reading…"}</span>
                        : rs?.state === "error" ? <span className="dwg-bad">Reading failed</span>
                          : its.length ? <span><span className="mono">{its.length}</span> items{t.ai_only ? <> · <span className="mono">{t.ai_only}</span> to check</> : null}</span>
                            : pending ? <span className="dwg-faint">Opening the saved reading…</span>
                              : rs?.state === "done" ? <span className="dwg-faint">No items found</span>
                                : <span className="dwg-faint">Not read yet</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="dwg-centre">
          {current && <>
            <header className="dwg-col-head dwg-view-head">
              <h3 className="mono" title={current.name}>{current.name}</h3>
              {current.pages.length > 1 && (
                <span className="dwg-pager" role="group" aria-label="Page">
                  <button type="button" className="dwg-ibtn" disabled={pIdx === 0} aria-label="Previous page" onClick={() => { setPageAt(pIdx - 1); setPicked(null); }}>
                    <ChevronLeft size={16} aria-hidden /></button>
                  <span className="mono">{`Page ${pIdx + 1} of ${current.pages.length}`}</span>
                  <button type="button" className="dwg-ibtn" disabled={pIdx >= current.pages.length - 1} aria-label="Next page" onClick={() => { setPageAt(pIdx + 1); setPicked(null); }}>
                    <ChevronRight size={16} aria-hidden /></button>
                </span>
              )}
              <span className="dwg-spacer" />
              <button type="button" className={`btn small dwg-read${wasRead || savedSheet ? "" : " primary"}`} data-dwg="read"
                disabled={busy || readState?.state === "reading"} onClick={() => read(current)}
                title={savedSheet ? `Replays the saved ${savedModel(savedSheet)} reading of this sample: instant, no cost.`
                  : wasRead ? "Read the sheet again (a page already read is cached and costs nothing)" : "Gemini reads tags, types and sizes; the text layer checks them"}>
                {readState?.state === "reading" ? (savedSheet ? "Replaying…" : "Reading…") : savedSheet ? "Replay the reading"
                  : wasRead ? "Read again" : "Read with AI"}</button>
            </header>
            {saved && <SavedNote saved={saved} />}
            {/* A replay done says nothing the note above does not (saved, no cost); the Items tab counts the items */}
            {!(readState?.state === "done" && readState.saved && saved) && <ReadLine read={readState} drawing={current} onRetry={() => read(current)} />}
            {page && !page.has_text_layer && (
              <p className="dwg-notice st-ai" role="note"><b>No text layer on this page (scanned).</b> Every item on it is AI-read: check each one on the sheet.</p>
            )}
            {page && <SheetViewer key={`${current.id}:${page.index}`} drawing={current} page={page} items={onPage} picked={picked}
              mismatchOf={mismatchOf} onPick={(it) => pick(it)} />}
          </>}
        </div>

        <aside className="dwg-side" aria-label="Readings">
          <Tabs tab={tab} onTab={setTab} items={shown.length} mismatches={compare ? mismatches.length : null}>
            {{
              items: <>
                {shown.length > 0 && <StatusFilter tally={tally} total={shown.length} filter={filter} onFilter={setFilter} />}
                <ItemsTable drawing={current} items={filtered} picked={picked} mismatchOf={mismatchOf} onPick={(it) => pick(it)}
                  empty={shown.length ? "No items with this status."
                    : readState?.state === "reading" ? (savedSheet ? "Opening the saved reading: its items appear here." : "Items appear here as each page is read.")
                      : current && sheetPending(current, items, readState) ? "Opening the saved reading: its items appear here."
                        : readState?.state === "done" ? "No items found on this sheet."
                          : "Not read yet. Read the sheet with AI to list its items."} />
                {pickedItem && current && <ItemDetail item={pickedItem} drawing={current} match={matchOf.get(pickedItem.id) ?? null}
                  mismatch={mismatchOf.get(pickedItem.id) ?? null} names={names} onFocusElement={onFocusElement} />}
              </>,
              mismatches: <MismatchList compare={compare} items={items} drawings={drawings} names={names}
                onShowItem={(it, d) => pick(it, d)} onFocusElement={onFocusElement} />,
            }}
          </Tabs>
        </aside>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Parts                                                                                                            */

/** The sheets to replay on their own when the page shows them: each with a saved reading (`saved_reading`, the sample
 *  sheets: free, instant), its items fetched and empty (never read), and no reading of it here yet (one that failed
 *  waits for Retry). Never a sheet without one: reading the user's own PDFs costs, so it waits for Read with AI. */
export function autoReplays(drawings: readonly Drawing[], items: Readonly<Record<string, readonly Item[]>>,
  reads: Readonly<Record<string, ReadState>>): Drawing[] {
  return drawings.filter((d) => Object.prototype.hasOwnProperty.call(items, d.id) && sheetPending(d, items, reads[d.id]));
}
/** A sample sheet waiting for its saved reading: one is there, nothing read or reading yet, and no failure. */
function sheetPending(d: Drawing, items: Readonly<Record<string, readonly Item[]>>, read: ReadState | undefined): boolean {
  return !!savedReadingOf(d.saved_reading) && !items[d.id]?.length && !read;
}

/** The rule in the proof grammar: AI reads (dashed indigo), data checks (solid teal), the engineer decides (navy). */
export function RuleStrip() {
  return (
    <p className="dwg-rule" aria-label={RULE}>
      <span className="dwg-rule-step st-ai">AI reads</span>
      <span className="dwg-rule-step st-confirmed">Data checks</span>
      <span className="dwg-rule-step decided">The engineer decides</span>
    </p>
  );
}

function DropZone({ big = false, disabled, onFiles }: { big?: boolean; disabled: boolean; onFiles(files: File[]): void }) {
  const input = (
    <input type="file" className="dwg-sr" accept=".pdf,application/pdf" multiple disabled={disabled}
      onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; onFiles(files); }} />
  );
  if (!big) {
    return <label className={`btn small dwg-add${disabled ? " off" : ""}`}>{input}<FileUp size={14} aria-hidden /> Add PDFs</label>;
  }
  return (
    <label className={`dwg-drop${disabled ? " off" : ""}`}>
      {input}
      <FileUp size={28} aria-hidden className="dwg-drop-icon" />
      <b>Upload PDF drawings (HVAC, plumbing, electrical plans)</b>
      <span className="dwg-drop-how">{HOW}</span>
      <span className="btn primary" aria-hidden>Choose PDFs</span>
      <span className="dwg-faint">or drop them here</span>
    </label>
  );
}

function Alert({ message, onRetry, onDismiss }: { message: string; onRetry?(): void; onDismiss?(): void }) {
  return (
    <div className="dwg-alert" role="alert">
      <TriangleAlert size={16} aria-hidden />
      <span>{message}</span>
      {onRetry && <button type="button" className="btn small" onClick={() => onRetry()}><RotateCcw size={14} aria-hidden /> Retry</button>}
      {onDismiss && <button type="button" className="btn small ghost" onClick={() => onDismiss()}>Dismiss</button>}
    </div>
  );
}

function UploadLine({ upload, onRetry, onDismiss }: { upload: UploadState; onRetry(): void; onDismiss(): void }) {
  if (upload.state === "error") return <Alert message={`Upload failed: ${upload.message}`} onRetry={onRetry} onDismiss={onDismiss} />;
  const pct = upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0;
  const sent = upload.total > 0 && upload.loaded >= upload.total;
  return (
    <div className="dwg-run" role="status" aria-live="polite">
      <span>{sent ? "Rendering pages and reading the text layer…" : `Uploading ${upload.names.length === 1 ? upload.names[0] : plural(upload.names.length, "PDF")}`}</span>
      <span className="dwg-bar" aria-hidden><i style={{ width: `${sent ? 100 : pct}%` }} /></span>
      {!sent && <span className="mono">{pct}%</span>}
    </div>
  );
}

/** A saved reading said once, calmly: what it is, that it was replayed at no cost, and that it was not read live. */
export function SavedNote({ saved }: { saved: SavedReading }) {
  const when = saved.at ? saved.at.slice(0, 10) : null;
  return (
    <p className="dwg-saved" role="note" data-dwg="saved"
      title={`Read once with ${savedModel(saved)}${when ? ` on ${when}` : ""} and saved with this sample. Upload your own PDFs to read them live.`}>
      <History size={14} aria-hidden />
      <span>{`${savedText(saved)}: replayed at no cost, not read live.`}</span>
    </p>
  );
}

/** The reading's honest state: page n of N while it runs, items and cost when done (and the saved reading it replayed,
 * never called a live one), the error with Retry. */
export function ReadLine({ read, drawing, onRetry }: { read: ReadState | undefined; drawing: Drawing; onRetry(): void }) {
  if (!read) return null;
  if (read.state === "error") return <Alert message={`Reading failed: ${read.message}`} onRetry={onRetry} />;
  if (read.state === "done") {
    return (
      <p className="dwg-run done" role="status" aria-live="polite">
        <span>{`Read ${plural(drawing.pages.length, "page")}: `}<span className="mono">{read.count}</span>{` item${read.count === 1 ? "" : "s"}`}</span>
        {read.saved && <><span className="dwg-faint">·</span><span className="dwg-run-saved">{`Saved AI reading (${savedModel(read.saved)})`}</span></>}
        <span className="dwg-faint">·</span>
        <span>Cost <span className="mono">{costText(read.cost_usd, read.saved)}</span></span>
      </p>
    );
  }
  const n = read.page === null ? null : pageNumber(drawing, read.page);
  const total = read.total || drawing.pages.length;
  return (
    <div className="dwg-run reading" role="status" aria-live="polite">
      <span className="dwg-pulse" aria-hidden />
      <span>{n === null ? "Starting the reading…" : <>{read.saved ? "Replaying the saved reading of page " : "Reading page "}<span className="mono">{n}</span> of <span className="mono">{total}</span></>}</span>
      <span className="dwg-bar" aria-hidden><i style={{ width: `${n === null || !total ? 0 : Math.round((n / total) * 100)}%` }} /></span>
      <span className="dwg-faint"><span className="mono">{read.items}</span>{` item${read.items === 1 ? "" : "s"} so far`}</span>
    </div>
  );
}

function StatusFilter({ tally, total, filter, onFilter }: { tally: Record<ItemStatus, number>; total: number; filter: ItemStatus | "all"; onFilter(f: ItemStatus | "all"): void }) {
  const opts: (ItemStatus | "all")[] = ["all", "confirmed", "ai_only", "text_only"];
  return (
    <div className="dwg-filter" role="group" aria-label="Show items">
      {opts.map((o) => {
        const n = o === "all" ? total : tally[o];
        if (o !== "all" && !n) return null;
        return (
          <button key={o} type="button" className={`dwg-chip${o === "all" ? "" : ` ${statusStyle(o).cls}`}`} aria-pressed={filter === o} onClick={() => onFilter(o)}>
            {o === "all" ? "All" : statusStyle(o).label} <span className="dwg-count">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  const s = statusStyle(status);
  return <span className={`dwg-badge ${s.cls}`} title={s.meaning}><span aria-hidden>{s.glyph}</span> {s.label}</span>;
}

/** The items read on a sheet: tag, kind, size, status, page. ↑/↓ move the selection, Enter picks. */
export function ItemsTable({ drawing, items, picked, mismatchOf, onPick, empty }: {
  drawing: Drawing | null; items: readonly Item[]; picked: string | null; mismatchOf: ReadonlyMap<string, Mismatch>;
  onPick(it: Item): void; empty: string;
}) {
  if (!items.length) return <p className="dwg-hint dwg-pad">{empty}</p>;
  const key = (e: KeyboardEvent<HTMLTableRowElement>, it: Item) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const row = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
      row?.focus();
      row?.click();
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(it); }
  };
  return (
    <div className="dwg-table-wrap">
      <table className="dwg-table">
        <thead><tr><th scope="col">Tag</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Status</th><th scope="col" className="num">Page</th></tr></thead>
        <tbody>
          {items.map((it) => {
            const m = mismatchOf.get(it.id);
            return (
              <tr key={it.id} tabIndex={0} aria-selected={picked === it.id} className={`${statusStyle(it.status).cls}${picked === it.id ? " picked" : ""}`}
                onClick={() => onPick(it)} onKeyDown={(e) => key(e, it)}>
                <td className="mono">{it.tag ?? <span className="dwg-faint">no tag</span>}</td>
                <td>{kindLabel(it.kind)}</td>
                <td className="mono">{sizeText(it.size) || <span className="dwg-faint">—</span>}</td>
                <td><StatusBadge status={it.status} />{m && <span className={`dwg-mk ${mismatchStyle(m.kind).cls}`} title={mismatchStyle(m.kind).label}>
                  <span aria-hidden>{mismatchStyle(m.kind).glyph}</span><span className="dwg-sr">{mismatchStyle(m.kind).label}</span></span>}</td>
                <td className="mono num">{drawing ? pageNumber(drawing, it.page) : it.page}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What the reading of one item rests on, and whether the model has it. */
function ItemDetail({ item, drawing, match, mismatch, names, onFocusElement }: {
  item: Item; drawing: Drawing; match: { element: string; by: string } | null; mismatch: Mismatch | null;
  names: Readonly<Record<string, string>>; onFocusElement(gid: string): void;
}) {
  const s = statusStyle(item.status);
  const proof = evidenceLines(item.evidence);
  const gid = match?.element ?? mismatch?.element ?? null;
  return (
    <section className={`dwg-detail ${s.cls}`} aria-label={`Selected item ${item.tag ?? ""}`}>
      <header>
        <StatusBadge status={item.status} />
        <b className="mono">{item.tag ?? "no tag"}</b>
        <span>{kindLabel(item.kind)}</span>
        {item.size && <span className="mono">{sizeText(item.size)}</span>}
        <span className="dwg-faint">{`p. ${pageNumber(drawing, item.page)}`}</span>
      </header>
      <p className="dwg-hint">{s.meaning}</p>
      {proof.length > 0 && <ul className="dwg-proof">{proof.map((l) => <li key={l}>{l}</li>)}</ul>}
      {gid ? (
        <div className="dwg-detail-model">
          <span>{`In the model: ${names[gid] ?? gid}`}{match?.by ? <span className="dwg-faint">{` · matched by ${match.by}`}</span> : null}</span>
          <button type="button" className="btn small" onClick={() => onFocusElement(gid)}><Box size={14} aria-hidden /> Show in 3D</button>
        </div>
      ) : mismatch?.kind === "missing_in_model" ? <p className="dwg-hint dwg-bad">Not found in the model.</p> : null}
    </section>
  );
}

/** The evidence an item's status rests on, in words: matched text, distance, reader. */
export function evidenceLines(ev: Readonly<Record<string, unknown>> | null | undefined): string[] {
  if (!ev) return [];
  const out: string[] = [];
  const words = (Array.isArray(ev.words) ? ev.words : Array.isArray(ev.matched) ? ev.matched : [])
    .map((w) => (typeof w === "string" ? w : w && typeof w === "object" && typeof (w as { text?: unknown }).text === "string" ? (w as { text: string }).text : null))
    .filter((w): w is string => !!w);
  if (words.length) out.push(`Text layer: ${words.map((w) => `“${w}”`).join(", ")}`);
  const dist = typeof ev.distance_px === "number" ? ev.distance_px : typeof ev.distance === "number" ? ev.distance : null;
  if (dist !== null && Number.isFinite(dist)) out.push(`${Math.round(dist)} px from the box`);
  // The reader's own evidence: what the PDF's text confirmed (tag, size), what it prints there instead, a moved box.
  const textOf = (v: unknown) => (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" ? (v as { text: string }).text : null);
  const fields = (o: unknown) => (["tag", "size"] as const).map((f) => [f, textOf((o as Record<string, unknown> | null)?.[f])] as const)
    .filter(([, t]) => t).map(([f, t]) => `“${t}” (${f})`);
  const confirmed = fields(ev);
  if (confirmed.length) out.push(`Text layer confirms ${confirmed.join(", ")}`);
  const says = fields(ev.text_says);
  if (says.length) out.push(`The PDF prints ${says.join(", ")} there`);
  const shift = ev.box_shift as { dx?: unknown; dy?: unknown; anchors?: unknown } | undefined;
  if (shift && typeof shift.dx === "number" && typeof shift.dy === "number") {
    out.push(`Box moved ${Math.round(shift.dx)}, ${Math.round(shift.dy)} px: the AI placed this part of the sheet off, measured from ${
      typeof shift.anchors === "number" ? shift.anchors : "its"} tags printed once`);
  }
  if (typeof ev.label_tags === "number" && ev.label_tags > 1) out.push(`One of ${ev.label_tags} tags on one label, sharing its size`);
  const saved = savedReadingOf(ev.saved_reading);
  if (typeof ev.model === "string" && ev.model) out.push(`Read by ${ev.model}${saved ? " (saved reading, replayed)" : ""}`);
  else if (saved) out.push(`Read by ${savedModel(saved)} (saved reading, replayed)`);
  return out;
}

/** The drawing against the model: each mismatch with both values, a warning when the reading is not confirmed, and
 * the way to the item on the sheet and the element in 3D. */
export function MismatchList({ compare, items, drawings, names = {}, onShowItem, onFocusElement }: {
  compare: Comparison | null; items: Readonly<Record<string, readonly Item[]>>; drawings: readonly Drawing[];
  names?: Readonly<Record<string, string>>; onShowItem(it: Item, d: Drawing): void; onFocusElement(gid: string): void;
}) {
  if (!compare) return <p className="dwg-hint dwg-pad">Not compared yet. The comparison with the model runs after a sheet is read.</p>;
  if (!compare.mismatches.length) {
    return <p className="dwg-hint dwg-pad dwg-ok">{`No mismatches: ${plural(compare.matches.length, "item")} matched the model by its data.`}</p>;
  }
  return (
    <ul className="dwg-mms">
      {compare.mismatches.map((m, i) => {
        const st = mismatchStyle(m.kind);
        const found = findItem(items, m.item);
        const d = found ? drawings.find((x) => x.id === found.did) ?? null : null;
        const it = found?.item ?? null;
        const tag = it?.tag ?? (typeof m.evidence?.tag === "string" ? m.evidence.tag : null) ?? (m.element ? names[m.element] ?? null : null);
        const by = typeof m.evidence?.by === "string" ? m.evidence.by : null;
        const unconfirmed = !!it && it.status !== "confirmed";
        return (
          <li key={`${m.kind}:${m.item ?? ""}:${m.element ?? ""}:${i}`} className={`dwg-mm ${st.cls}`}>
            <div className="dwg-mm-head">
              <span className={`dwg-badge ${st.cls}`}><span aria-hidden>{st.glyph}</span> {st.label}</span>
              <b className="mono">{tag ?? "untagged"}</b>
              {it && d && <span className="dwg-faint">{`${d.title.sheet ?? d.name} · p. ${pageNumber(d, it.page)}`}</span>}
            </div>
            <dl className="dwg-mm-vals">
              <div><dt>Drawing</dt><dd className="mono">{sizeOrDash(m.drawing_value)}</dd></div>
              <div><dt>Model</dt><dd className="mono">{sizeOrDash(m.model_value)}</dd></div>
            </dl>
            {unconfirmed && <p className="dwg-note st-ai" role="note"><span aria-hidden>✦</span> AI-read, not confirmed by the PDF's text: check the reading first.</p>}
            {m.kind === "missing_in_drawing" && <p className="dwg-hint">Not found on any sheet read so far. A scanned or unread page can miss it.</p>}
            {by && <p className="dwg-hint">{`Matched by ${by}`}</p>}
            <div className="dwg-mm-actions">
              {it && d && <button type="button" className="btn small ghost" onClick={() => onShowItem(it, d)}>Show on sheet</button>}
              {m.element && <button type="button" className="btn small" onClick={() => onFocusElement(m.element!)}
                aria-label={`Show ${m.element ? names[m.element] ?? tag ?? "the element" : "the element"} in 3D`}><Box size={14} aria-hidden /> Show in 3D</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
const sizeOrDash = (v: string | null) => (v ? sizeText(v) : "—");

function Tabs({ tab, onTab, items, mismatches, children }: {
  tab: Tab; onTab(t: Tab): void; items: number; mismatches: number | null; children: Record<Tab, ReactNode>;
}) {
  const id = useId();
  const order: Tab[] = ["items", "mismatches"];
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = order[(order.indexOf(tab) + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    onTab(next);
    (e.currentTarget.parentElement?.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
  };
  return <>
    <div className="dwg-tabs" role="tablist" aria-label="Readings">
      {order.map((t) => (
        <button key={t} type="button" role="tab" data-tab={t} id={`${id}-${t}`} aria-controls={`${id}-${t}-panel`} aria-selected={tab === t}
          tabIndex={tab === t ? 0 : -1} onClick={() => onTab(t)} onKeyDown={key}>
          {t === "items" ? "Items" : "Mismatches"}{" "}
          {t === "items" ? <span className="dwg-count">{items}</span>
            : mismatches !== null && <span className={`dwg-count${mismatches ? " warn" : ""}`}>{mismatches}</span>}
        </button>
      ))}
    </div>
    {order.map((t) => (
      <div key={t} role="tabpanel" id={`${id}-${t}-panel`} aria-labelledby={`${id}-${t}`} hidden={tab !== t} className="dwg-tabpanel">
        {children[t]}
      </div>
    ))}
  </>;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The sheet: the page image with each item's box in the proof grammar; wheel or +/− zoom, drag or arrows pan       */

function SheetViewer({ drawing, page, items, picked, mismatchOf, onPick }: {
  drawing: Drawing; page: Drawing["pages"][number]; items: readonly Item[]; picked: string | null;
  mismatchOf: ReadonlyMap<string, Mismatch>; onPick(it: Item): void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [img, setImg] = useState<"loading" | "ok" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const dims = { w: page.width_px, h: page.height_px };
  // The view is the automatic fit until the reader zooms, pans or picks: until then it follows the stage's size.
  const fitted = useRef(true);
  const moveView = (f: (v: View | null) => View | null) => { fitted.current = false; setView(f); };

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Fit the width once the stage has a size (the viewer is keyed by page, so each page starts fitted), and again when
  // the stage settles at another size before the reader has moved the view (a note or the items arriving above it).
  useLayoutEffect(() => { if (size && size.w > 0) setView((v) => (v && !fitted.current ? v : fitWidth(size, dims))); }, [size]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * r.height : e.deltaY;
      const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      moveView((v) => v && zoomAt(v, f, e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // A picked item off screen is brought to the middle.
  const pickedItem = picked ? items.find((it) => it.id === picked) ?? null : null;
  useEffect(() => {
    if (!pickedItem || !size || pickedItem.box.length < 4) return;
    setView((v) => {
      if (!v) return v;
      const [x0, y0, x1, y1] = pickedItem.box;
      const inside = v.x + x0 * v.s >= 0 && v.y + y0 * v.s >= 0 && v.x + x1 * v.s <= size.w && v.y + y1 * v.s <= size.h;
      if (inside) return v;
      fitted.current = false;
      return centreOn(v, pickedItem.box, size);
    });
  }, [pickedItem, size]);

  const fit = () => { if (size) { fitted.current = true; setView(fitWidth(size, dims)); } };
  const zoom = (f: number) => { if (size) moveView((v) => v && zoomAt(v, f, size.w / 2, size.h / 2)); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const pan = (dx: number, dy: number) => moveView((v) => v && { ...v, x: v.x + dx, y: v.y + dy });
    const step = e.shiftKey ? 200 : 60;
    switch (e.key) {
      case "+": case "=": zoom(1.25); break;
      case "-": case "_": zoom(0.8); break;
      case "0": case "f": case "F": fit(); break;
      case "ArrowLeft": pan(step, 0); break;
      case "ArrowRight": pan(-step, 0); break;
      case "ArrowUp": pan(0, step); break;
      case "ArrowDown": pan(0, -step); break;
      default: return;
    }
    e.preventDefault();
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !view) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);   // only once it is a drag, so a click still reaches a box
    }
    moveView((v) => v && { ...v, x: d.vx + dx, y: d.vy + dy });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => { if (drag.current?.id === e.pointerId) drag.current = null; };

  const s = view?.s ?? 1;
  const pad = 5 / s;
  // The zoom said against the width fitted to the viewer (100%: the sheet's width fills it), not the page image's
  // pixels: a large sheet rendered at print resolution would otherwise open at "6%".
  const fitS = size && size.w > 0 ? fitWidth(size, dims).s : null;
  const zoomPct = view && fitS ? Math.round((view.s / fitS) * 100) : null;
  const tally = statusTally(items);
  const label = `${drawing.name}, page ${pageNumber(drawing, page.index)} of ${drawing.pages.length}: ${plural(items.length, "item")}`
    + (items.length ? ` (${tally.confirmed} confirmed, ${tally.ai_only} AI-read, ${tally.text_only} text only)` : "");
  return (
    <div className="dwg-viewer">
      <div ref={stage} className="dwg-stage" tabIndex={0} role="group" style={{ "--dwg-sheet-ar": `${dims.w} / ${dims.h}` } as CSSProperties}
        aria-label={`${label}. Drag or arrow keys to pan, wheel or + and − to zoom, 0 to fit the width.`}
        aria-keyshortcuts="+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown"
        onKeyDown={onKey} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <svg className="dwg-svg" role="img" aria-label={label} width="100%" height="100%"
          viewBox={view ? undefined : `0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMin meet">
          <g transform={view ? `translate(${view.x} ${view.y}) scale(${view.s})` : undefined}>
            <rect className="dwg-paper" width={dims.w} height={dims.h} />
            {img !== "error" && <image href={`${pageUrl(drawing.id, page.index)}${attempt ? `?retry=${attempt}` : ""}`} width={dims.w} height={dims.h}
              preserveAspectRatio="none" onLoad={() => setImg("ok")} onError={() => setImg("error")} />}
            <g aria-hidden>
              {items.map((it) => {
                if (it.box.length < 4) return null;
                const [x0, y0, x1, y1] = it.box, m = mismatchOf.get(it.id);
                return (
                  <g key={it.id}>
                    {m && <rect className={`dwg-mis ${mismatchStyle(m.kind).cls}`} x={x0 - pad} y={y0 - pad} width={x1 - x0 + 2 * pad} height={y1 - y0 + 2 * pad} />}
                    <rect className={`dwg-box ${statusStyle(it.status).cls}${picked === it.id ? " picked" : ""}`} x={x0} y={y0} width={Math.max(1, x1 - x0)}
                      height={Math.max(1, y1 - y0)} onClick={() => { if (!drag.current?.moved) onPick(it); }}>
                      <title>{`${it.tag ?? "no tag"} · ${kindLabel(it.kind)}${it.size ? ` · ${sizeText(it.size)}` : ""} · ${statusStyle(it.status).label}${m ? ` · ${mismatchStyle(m.kind).label}` : ""}`}</title>
                    </rect>
                    {picked === it.id && <rect className="dwg-halo" x={x0 - 2 * pad} y={y0 - 2 * pad} width={x1 - x0 + 4 * pad} height={y1 - y0 + 4 * pad} />}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
        {img === "loading" && <span className="dwg-stage-note" role="status">Loading the page…</span>}
        {img === "error" && (
          <div className="dwg-stage-note err" role="alert">
            <span>The page image did not load.</span>
            <button type="button" className="btn small" onClick={() => { setImg("loading"); setAttempt((n) => n + 1); }}><RotateCcw size={14} aria-hidden /> Retry</button>
          </div>
        )}
      </div>
      <div className="dwg-foot">
        <Legend />
        <div className="dwg-tools" role="toolbar" aria-label="Zoom">
          <button type="button" className="dwg-ibtn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom(0.8)} disabled={!view}><ZoomOut size={16} aria-hidden /></button>
          <span className="mono dwg-zoom" aria-live="off" data-dwg="zoom" title="Zoom against the sheet's width fitted to the viewer">
            {zoomPct === null || (fitted.current && zoomPct === 100) ? "Fit" : `${zoomPct}%`}</span>
          <button type="button" className="dwg-ibtn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1.25)} disabled={!view}><ZoomIn size={16} aria-hidden /></button>
          <button type="button" className="dwg-ibtn" aria-label="Fit to width" title="Fit to width (0)" onClick={fit} disabled={!size}><Maximize2 size={16} aria-hidden /></button>
        </div>
      </div>
    </div>
  );
}

/** The boxes' key: every state has its line, its colour and its word. */
export function Legend() {
  return (
    <ul className="dwg-legend" aria-label="Key">
      {(["confirmed", "ai_only", "text_only"] as const).map((st) => (
        <li key={st}><i className={`dwg-swatch ${statusStyle(st).cls}`} aria-hidden />{statusStyle(st).label}</li>
      ))}
      <li className="dwg-legend-mk"><i className="dwg-swatch mk-differs" aria-hidden />Differs from the model</li>
      <li><i className="dwg-swatch mk-missing" aria-hidden />Missing</li>
    </ul>
  );
}
