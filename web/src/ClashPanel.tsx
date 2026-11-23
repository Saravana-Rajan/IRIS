import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, type Matches, type Measure, type ReportClash, type TriageVerdict } from "./api";
import { mm } from "./ReportList";
import { oneElement, sameWhy } from "./noClash";
import { drawOverlay, focusSquare, readClashImage, type Box, type ClashRead } from "./clashImage";
import { TRIAGE } from "./Triage";
import { aiName } from "./aiNames";

const VIEW_NAMES: Record<string, string> = { A: "A · pair", B: "B · context", C: "C · second angle" };

/** Whether the open model has an element, and how it was found (by GlobalId, or by name). */
function inModel(found: string | null | undefined, how: string | null | undefined) {
  return found ? (how === "name" ? "in model, by name" : "in model") : "not in model";
}

const BASIS: Record<NonNullable<TriageVerdict["basis"]>, string> = {
  non_physical: "settled: not physical", touch: "settled: a touch", same_element: "settled: one element",
  no_overlap: "settled: no overlap measured", reviewed: "marked by you",
  requirement: "settled: by a requirements rule", strictness: "kept by strictness",
};

/** What the clash header (ClashHeader.tsx) does not show: the A/B/C pictures, the distance Iris measures now, whether
 * the open model has each element, the "one element" note and the triage reading (folded to one line). The number,
 * title, status, the report's distance and A and B are the header's, shown once. Compact, so Propose fixes stays on
 * screen; a fixed clash says so calmly, with Undo and proposing again. */
export function ClashPanel({ reportId, clash, match, measure, onImage, fix, resolved = false, onUndo, onProposeAgain, busy = false,
  triage, origin = "navisworks", capturing = false }: {
  reportId: string; clash: ReportClash; match: Matches[string] | undefined; measure: Measure | null | "busy";
  onImage: (index: number) => void; fix?: string; triage?: TriageVerdict; origin?: "navisworks" | "iris";
  capturing?: boolean;  // the A/B/C views of a clash Iris found are being taken
  /** Fixed (a fix kept, `fix`, or the re-run check no longer finds it, `resolved`): a calm "Fixed ✓" state in place of
   * the propose actions, with Undo when the newest kept edit is this fix (coordination.undoableFix) and proposing
   * again as a secondary. */
  resolved?: boolean; onUndo?: () => void; onProposeAgain?: () => void; busy?: boolean;
}) {
  const found = origin === "iris";  // Iris detected it: its depth is how far one must move to clear the other
  const now = measure === "busy" ? "measuring…"
    : !measure ? "open the models to measure"
      : !measure.matched ? "not in the open model"
        : measure.physical === false ? "not a physical element"
          : measure.distance_m == null ? "no overlap here" : mm(measure.distance_m);
  // A disputed rule or a failed reading is worth seeing at once: the note opens for those.
  const alert = !!triage && (triage.audit === "disputed" || !!triage.error);
  return (
    <section className="clash-panel">
      {(fix || resolved) && (
        <div className="noclash-card fixed-state" role="status">
          <b>Fixed ✓</b>
          <p>{fix ? <>Kept in this session: {fix}.</> : "Iris's check, run again, no longer finds it."} The {found
            ? "views show the clash as found" : "Navisworks images show the clash as reported"}.</p>
          {(onUndo || onProposeAgain) && <span className="fixed-actions">
            {onUndo && <button type="button" className="btn small" disabled={busy} onClick={onUndo}
              data-tip="Take this fix back out of the model (the newest kept edit)"><RotateCcw size={13} aria-hidden /> Undo</button>}
            {onProposeAgain && <button type="button" className="link" disabled={busy} onClick={onProposeAgain}>Propose a different fix</button>}
          </span>}
        </div>)}
      <div className="clash-glance">
        {clash.images.length > 0 && (
          <div className={`thumbs n${clash.images.length}`}>
            {clash.images.map((label, i) => (
              <button key={label} className="thumb" onClick={() => onImage(i)} title={`Open ${VIEW_NAMES[label] ?? label}`}>
                <ClashThumb url={api.imageUrl(reportId, clash.id, i)} alt={`#${clash.number}, view ${label}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <dl className="kv clash-now">
          <dt>{found ? "Now" : "Iris measures"}</dt><dd className="mono">{now}</dd>
          {!found && clash.status && <><dt>In the report</dt><dd>{clash.status}</dd></>}
          {match && <><dt>Open model</dt><dd className="clash-match">
            <span className={`chip small ${match.a ? "ok" : "warn"}`}><i className="sw red" />A {inModel(match.a, match.how[0])}</span>
            <span className={`chip small ${match.b ? "ok" : "warn"}`}><i className="sw green" />B {inModel(match.b, match.how[1])}</span>
          </dd></>}
        </dl>
      </div>
      {capturing && <p className="hint small">Taking the A/B/C views of this clash…</p>}
      {oneElement(match) && (
        <p className="hint"><i className="sw purple" />A and B are one element in this model, drawn purple: Navisworks
          clashed {sameWhy(clash)}.</p>
      )}
      {triage && (
        <details className="triage-note" open={alert || undefined}>
          <summary>
            <span className={`chip small ${TRIAGE[triage.verdict].cls}`} data-tip={TRIAGE[triage.verdict].tip}>{TRIAGE[triage.verdict].label}</span>
            {triage.responsible && triage.responsible !== "none" && <span className="chip small">{triage.responsible}</span>}
            <span className="why tn-basis">{triage.basis ? BASIS[triage.basis] : triage.source === "rule" ? "by rule" : "triage model"}</span>
            {triage.understanding && <span className="tn-line">{triage.understanding}</span>}
          </summary>
          {triage.understanding && <p>{triage.understanding}</p>}
          {triage.fix_hint && <p className="why">{triage.action === "exclude_with_rule" ? "Stop it coming back: " : "Fix: "}{triage.fix_hint}</p>}
          {triage.model_reading && <p className="why small">The triage model read it as {triage.model_reading}</p>}
          {triage.audit === "disputed" && <p className="bad small">{aiName("proposal")} checked this requirements rule and thinks it may hide real
            clashes: {triage.audit_note}</p>}
          {triage.alike && <p className="why small">Read once for {triage.alike} alike clashes: the same kinds of element,
            named alike and about as deep{triage.alike_of ? ". This one shares that reading" : ""}.</p>}
          {triage.reasoning && <details className="triage-reasoning">
            <summary>How the triage model reasoned</summary>
            <p>{triage.reasoning}</p>
          </details>}
          {triage.error && <p className="bad small">{triage.error}</p>}
        </details>
      )}
    </section>
  );
}


export function Lightbox({ reportId, clash, index, onClose, onMove }: {
  reportId: string; clash: ReportClash; index: number; onClose: () => void; onMove: (index: number) => void;
}) {
  const n = clash.images.length;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onMove((index + 1) % n);
      if (e.key === "ArrowLeft") onMove((index + n - 1) % n);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, n, onClose, onMove]);
  const label = clash.images[index];
  const url = api.imageUrl(reportId, clash.id, index);
  const [read, setRead] = useState<ClashRead | null>(null);
  const [marks, setMarks] = useState(true);
  const [zoom, setZoom] = useState(false);
  const overlay = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let live = true;
    setRead(null);
    readClashImage(url).then((r) => { if (live) setRead(r); });
    return () => { live = false; };
  }, [url]);
  // Redraw the outlines at the picture's display size, and again when the window resizes.
  useEffect(() => {
    const c = overlay.current;
    if (!c || !read || !marks) return;
    const draw = () => { drawOverlay(c, read); };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => { ro.disconnect(); };
  }, [read, marks]);
  const focus = zoom && read ? focusSquare(read, 2.4, 0.3) : null;
  // A swipe across the picture goes to the next or previous view (touch screens; the arrow keys do it on a keyboard).
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <div className="lightbox" role="dialog" aria-label={`#${clash.number}, view ${label}`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <div className="lb-frame" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => {
            const from = swipe.current; swipe.current = null;
            if (!from || n < 2) return;
            const dx = e.clientX - from.x, dy = e.clientY - from.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) onMove((index + (dx < 0 ? 1 : n - 1)) % n);
          }}>
          <div className="lb-zoom" style={focus ? zoomStyle(focus) : undefined}>
            <img src={url} alt={`#${clash.number}, view ${label}`} />
            {marks && read && <canvas ref={overlay} className="lb-overlay" aria-hidden />}
          </div>
        </div>
        <figcaption>
          <span><b>#{clash.number} {clash.title ?? clash.name}</b> · {VIEW_NAMES[label] ?? label} · red {clash.a.ifc_class}, green {clash.b.ifc_class}
            {marks && read?.zone && <span className="lb-key"> · <i className="sw zone" />where they meet</span>}</span>
          <span className="lb-nav">
            <button className={`btn ${marks ? "on" : ""}`} aria-pressed={marks} onClick={() => setMarks(!marks)} disabled={!read}>Outlines</button>
            <button className={`btn ${zoom ? "on" : ""}`} aria-pressed={zoom} onClick={() => setZoom(!zoom)} disabled={!read?.pair}>Zoom to the clash</button>
            {n > 1 && clash.images.map((l, i) => <button key={l} className={`btn ${i === index ? "primary" : ""}`} onClick={() => onMove(i)}>{l}</button>)}
            <button className="btn" onClick={onClose}>Close</button>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

/** A clash picture in a small square, zoomed to where the two elements meet (read from its colours once it scrolls
 * into view). Until then, or if nothing is found, the whole picture. */
export function ClashThumb({ url, alt }: { url: string; alt: string }) {
  const el = useRef<HTMLSpanElement | null>(null);
  const [crop, setCrop] = useState<Box | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      readClashImage(url).then((r) => { if (live && r) setCrop(focusSquare(r)); });
    }, { rootMargin: "200px" });
    io.observe(node);
    return () => { live = false; io.disconnect(); };
  }, [url]);
  return (
    <span ref={el} className="clash-thumb" role="img" aria-label={alt}
      style={{ backgroundImage: `url("${url}")`, ...(crop ? cropStyle(crop) : { backgroundSize: "cover", backgroundPosition: "center" }) }} />
  );
}

/** CSS background placement that shows `b` (fractions of the picture) filling the box. */
function cropStyle(b: Box): React.CSSProperties {
  const side = b.x1 - b.x0;
  const pos = (start: number) => (side >= 1 ? 0 : (start / (1 - side)) * 100);
  return { backgroundSize: `${100 / side}% ${100 / (b.y1 - b.y0)}%`, backgroundPosition: `${pos(b.x0)}% ${pos(b.y0)}%` };
}

/** A transform that brings `b` (fractions of the picture) to fill the frame. */
function zoomStyle(b: Box): React.CSSProperties {
  const scale = 1 / (b.x1 - b.x0);
  return { transform: `scale(${scale}) translate(${-b.x0 * 100}%, ${-b.y0 * 100}%)`, transformOrigin: "0 0" };
}
