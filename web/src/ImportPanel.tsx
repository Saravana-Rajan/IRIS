import { FolderOpen, RotateCcw, Upload, X } from "lucide-react";
import { useState, type DragEvent } from "react";
import "./import.css";
import { extension, summary, type ImportRow, type ImportStage } from "./importRows";

/** The formats the import reads, said once wherever files are chosen. */
export const FORMATS = "IFC (IFC4, IFC2X3), STEP (AP203/214/242). PDF drawings go to the Drawings step.";

const STAGE: Record<ImportStage, string> = {
  queued: "Queued", packing: "Packing", uploading: "Uploading", converting: "Converting", processing: "Processing",
  drawing: "Drawing", ready: "Ready", failed: "Failed",
};

const isModel = (r: ImportRow) => r.kind === "IFC" || r.kind === "STEP";
const stageLabel = (r: ImportRow) => (r.stage === "failed" && !isModel(r) ? "Not supported" : STAGE[r.stage]);
const badge = (r: ImportRow) => (isModel(r) ? r.kind : r.kind === "Navisworks" ? "NW" : extension(r.name).slice(0, 5).toUpperCase() || "?");
const kindClass = (r: ImportRow) => ({ IFC: "k-ifc", STEP: "k-step", Navisworks: "k-nw", Unsupported: "k-other" })[r.kind];

/** Bytes as people read them: kB under a megabyte, one decimal under ten. */
export function fileSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1e3)).toLocaleString()} kB`;
  return `${bytes / 1e6 >= 10 ? Math.round(bytes / 1e6).toLocaleString() : (bytes / 1e6).toFixed(1)} MB`;
}

/** The import as an engineer's file table (docs/engineer-workflow.md, step 2): each chosen file with its type, size,
 * stage and progress, why it failed, and Retry. The server opens the files together, all or none, so Retry sends the
 * whole batch again; a failure stays until it is retried or dismissed. Props only: the page owns the rows
 * (importRows.ts) and the files. */
export function ImportPanel({ rows, onRetry, onRemove, onPick, onDrop, onClose, busy }: {
  rows: ImportRow[];
  /** Send the same files again (the whole batch). */
  onRetry: () => void;
  /** Take one file out of the list (and out of the next Retry). */
  onRemove?: (name: string) => void;
  /** Open the file chooser. */
  onPick: () => void;
  /** Files dropped on the panel. Without it the panel offers the chooser only. */
  onDrop?: (files: File[]) => void;
  /** Dismiss the panel (a failure stays until retried or dismissed). */
  onClose?: () => void;
  busy: boolean;
}) {
  const [over, setOver] = useState(false);
  const s = summary(rows);
  const failed = rows.filter((r) => isModel(r) && r.stage === "failed");
  // One reason for every file (the batch failed as one): said once above the button, not on each row.
  const reasons = [...new Set(failed.map((r) => r.error ?? ""))];
  const batchError = failed.length > 1 && reasons.length === 1 && reasons[0] ? reasons[0] : null;
  const drop = onDrop ? {
    onDragOver: (e: DragEvent) => { e.preventDefault(); if (!busy) setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); if (!busy && e.dataTransfer.files.length) onDrop([...e.dataTransfer.files]); },
  } : {};
  return (
    <section className="imp" aria-label="Import models">
      <header className="imp-head">
        <div><h3>Import</h3><span className="hint" aria-live="polite">{s.text}</span></div>
        {onClose && <button type="button" className="btn ghost small imp-close" onClick={onClose} disabled={busy}
          aria-label="Close the import list" data-tip="Close"><X size={14} aria-hidden /></button>}
      </header>
      {rows.length > 0 && (
        <table className="imp-table">
          <colgroup><col className="c-type" /><col /><col className="c-size" /><col className="c-stage" /><col className="c-prog" />
            {onRemove && <col className="c-x" />}</colgroup>
          <thead>
            <tr><th scope="col">Type</th><th scope="col">File</th><th scope="col" className="num c-size">Size</th>
              <th scope="col">Stage</th><th scope="col" className="c-prog">Progress</th>
              {onRemove && <th scope="col"><span className="imp-sr">Remove</span></th>}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}:${i}`} className={`imp-row st-${r.stage}`}>
                <td><span className={`imp-type ${kindClass(r)}`} title={r.kind === "Unsupported" ? "Not a model file" : r.kind}>{badge(r)}</span></td>
                <td className="imp-name">
                  <span className="mono" title={r.name}>{r.name}</span>
                  {r.error && !(batchError && isModel(r)) ? <span className="imp-error">{r.error}</span>
                    : r.note ? <span className="hint">{r.note}</span> : null}
                </td>
                <td className="num mono c-size">{fileSize(r.size)}</td>
                <td><span className={`chip small imp-stage st-${r.stage}`}>{stageLabel(r)}</span></td>
                <td className="c-prog"><Progress row={r} /></td>
                {onRemove && <td>{(!isModel(r) || !busy) && (
                  <button type="button" className="btn ghost small imp-x" aria-label={`Remove ${r.name}`} data-tip="Remove"
                    onClick={() => onRemove(r.name)}><X size={13} aria-hidden /></button>)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.retry && (
        <div className="imp-retry" role="alert">
          {batchError && <p className="imp-error">{batchError}</p>}
          <button type="button" className="btn primary small" onClick={onRetry} disabled={busy}>
            <RotateCcw size={14} aria-hidden /> Retry import</button>
          <span className="hint">Retry sends every model file again: the server opens them together, all or none.</span>
        </div>
      )}
      <div className={`imp-drop${over ? " over" : ""}${busy ? " busy" : ""}`} {...drop}>
        <Upload size={16} aria-hidden />
        <span>{busy ? "Importing…" : onDrop ? "Drop model files here, or" : "Add model files:"}</span>
        <button type="button" className="btn small" onClick={onPick} disabled={busy}><FolderOpen size={14} aria-hidden /> Choose files</button>
      </div>
      <p className="hint imp-formats">{FORMATS}</p>
    </section>
  );
}

/** The row's bar: its own share, the batch's (marked shared), or moving with no number when nothing is measured. */
function Progress({ row }: { row: ImportRow }) {
  const label = `${row.name}: ${stageLabel(row)}`;
  if (row.stage === "ready") return <span className="imp-bar done" aria-hidden><i /></span>;
  if (row.stage === "failed" || (row.stage === "queued" && row.pct == null)) return <span className="imp-bar" aria-hidden />;
  if (row.pct == null) return <span className="imp-bar busy" role="progressbar" aria-label={label}><i /></span>;
  return (
    <span className="imp-prog" title={row.shared ? "All files together: the server measures the batch, not each file" : undefined}>
      <span className={`imp-bar${row.shared ? " shared" : ""}`} role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.pct}><i style={{ width: `${row.pct}%` }} /></span>
      <span className="imp-pct mono">{row.pct}%{row.shared ? " batch" : ""}</span>
    </span>
  );
}
