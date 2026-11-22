// Iris's identity in the app (docs/brand-assets.md): the Aperture mark (six holographic blades closing around an ink
// hexagonal pupil: the camera's iris and the eye's in one), the lockup with "Iris" in live text, the app icon, the
// loading card and the kept-fix toast. web/public/favicon.svg and web/public/brand/ carry the same mark; index.html's
// boot splash draws the same lockup. The older split-O (`IrisMark`, `MarkShapes`) is kept for the notch and the old
// landing only, which App no longer shows.


/** The pupil with its hexagonal aperture cut out (even-odd), in the mark's 100 x 100 box. */
const PUPIL = "M 26 50 A 24 24 0 1 0 74 50 A 24 24 0 1 0 26 50 Z M 60 50 L 55 58.66 L 45 58.66 L 40 50 L 45 41.34 L 55 41.34 Z";

function MarkShapes() {
  return <><circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="9" /><path fillRule="evenodd" d={PUPIL} /></>;
}

/** The Aperture mark's paths in its 100 × 100 box: the ink hexagonal pupil and the six blades around it. */
export const APERTURE_PUPIL = "M42.29 36.65L42.83 36.6L42.51 37.03L46.49 36.73L46.81 36.32A73.9 73.9 0 0 1 57.71 36.65L58.02 37.09L57.49 37.03L59.73 40.33L60.26 40.4A73.9 73.9 0 0 1 65.41 50L65.19 50.49L64.97 50L63.25 53.59L63.44 54.08A73.9 73.9 0 0 1 57.71 63.35L57.17 63.4L57.49 62.97L53.51 63.27L53.19 63.68A73.9 73.9 0 0 1 42.29 63.35L41.98 62.91L42.51 62.97L40.27 59.67L39.74 59.6A73.9 73.9 0 0 1 34.59 50L34.81 49.51L35.03 50L36.75 46.41L36.56 45.92A73.9 73.9 0 0 1 42.29 36.65Z";
export const APERTURE_BLADES = "M46.49 36.73A70.5 70.5 0 0 1 76.62 14.34A44.5 44.5 0 0 1 94.47 51.63A73.5 73.5 0 0 0 46.49 36.73ZM59.73 40.33A70.5 70.5 0 0 1 94.19 55.22A44.5 44.5 0 0 1 70.82 89.33A73.5 73.5 0 0 0 59.73 40.33ZM63.25 53.59A70.5 70.5 0 0 1 67.58 90.88A44.5 44.5 0 0 1 26.35 87.7A73.5 73.5 0 0 0 63.25 53.59ZM53.51 63.27A70.5 70.5 0 0 1 23.38 85.66A44.5 44.5 0 0 1 5.53 48.37A73.5 73.5 0 0 0 53.51 63.27ZM40.27 59.67A70.5 70.5 0 0 1 5.81 44.78A44.5 44.5 0 0 1 29.18 10.67A73.5 73.5 0 0 0 40.27 59.67ZM36.75 46.41A70.5 70.5 0 0 1 32.42 9.12A44.5 44.5 0 0 1 73.65 12.3A73.5 73.5 0 0 0 36.75 46.41Z";
let apertures = 0;
const HOLO_STOPS: [string, string][] = [["0", "#8f9bff"], [".4", "#b07af2"], [".75", "#ff5cd6"], ["1", "#7dd3fc"]];

/** The blades' holographic gradient, under an id of the caller's (several marks can share a page). */
function HoloGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="9.54" y1="26.64" x2="90.46" y2="73.36">
      {HOLO_STOPS.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
    </linearGradient>
  );
}

/**
 * The Aperture mark. `working`: the blades open and close (the "Iris is working" indicator), still under reduced motion.
 * `mono`: one colour (the current text colour) for small or single-colour places. Decorative unless given a `title`.
 */
export function ApertureMark({ size = 24, working = false, mono = false, title, className = "" }: {
  size?: number; working?: boolean; mono?: boolean; title?: string; className?: string;
}) {
  const id = `aperture-${++apertures}`;   // its own gradient id: several marks share a page (no hook: drawable anywhere)
  return (
    <svg className={`aperture-mark${working ? " working" : ""}${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 100 100"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {!mono && <defs><HoloGradient id={id} /></defs>}
      <path className="aperture-pupil" fill={mono ? "currentColor" : "#1a1a1a"} d={APERTURE_PUPIL} />
      <path className="aperture-blades" fill={mono ? "currentColor" : `url(#${id})`} d={APERTURE_BLADES} />
    </svg>
  );
}

/** The lockup: the Aperture mark, "Iris" in live text (IBM Plex Sans 500, the page's ink) and, with `by`, the small grey
 *  "by Techjays". `height` in px (the mark's size). */
export function Lockup({ height = 28, by = false, title = "Iris" }: { height?: number; by?: boolean; title?: string }) {
  return (
    <span className="lockup" role="img" aria-label={by ? `${title} by Techjays` : title} style={{ fontSize: Math.round(height * 0.74) }}>
      <ApertureMark size={height} />
      <span className="lockup-name" aria-hidden>{title}</span>
      {by && <span className="lockup-by" aria-hidden>by Techjays</span>}
    </span>
  );
}

/** The Iris lockup (the Aperture mark and "Iris") for the places that still ask for the wordmark; `height` in px. */
export function Wordmark({ height = 28, title = "Iris" }: { height?: number; title?: string }) {
  return <Lockup height={height} title={title} />;
}

/** The mark. `motion`: orbit (indeterminate work), settle (once, after a confirmed action) or none. */
export function IrisMark({ size = 24, motion = "none" }: { size?: number; motion?: "none" | "orbit" | "settle" }) {
  return (
    <svg className={`iris-mark ${motion}`} width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden>
      <g><MarkShapes /></g>
    </svg>
  );
}

/** The app icon: the Aperture mark on a white rounded tile (web/public/brand/apple-touch-icon.png is the same). */
export function AppIcon({ size = 30 }: { size?: number }) {
  return (
    <span className="app-icon" role="img" aria-label="Iris" style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}>
      <ApertureMark size={Math.round(size * 0.7)} />
    </span>
  );
}

/** What the notch says while Iris works: a title, a detail line and, when the work has countable parts (models
 *  drawn), one bar segment per part. Every value comes from a real event; nothing advances on a timer. */
export interface NotchStatus { title: string; detail?: string; parts?: { done: number; total: number } }

/** The logo hanging from the top edge of the model. While Iris works it grows to show what is happening, and folds
 *  back to the wordmark when the work ends. */
export function Notch({ status, onLogo }: { status: NotchStatus | null; onLogo: () => void }) {
  return (
    <div className={`notch ${status ? "working" : ""}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <span className="notch-shoulder left" aria-hidden />
      {status ? (
        <div className="notch-body" role="status" aria-live="polite">
          <div className="notch-line">
            <IrisMark size={24} motion="orbit" />
            <span className="notch-text"><b>{status.title}</b>{status.detail && <span>{status.detail}</span>}</span>
          </div>
          {status.parts && status.parts.total > 1 && <Parts {...status.parts} />}
        </div>
      ) : (
        <button type="button" className="notch-body notch-logo" onClick={onLogo} aria-label="About Iris" data-tip="About Iris" data-tip-side="bottom">
          <Wordmark height={20} />
        </button>
      )}
      <span className="notch-shoulder right" aria-hidden />
    </div>
  );
}

function Parts({ done, total }: { done: number; total: number }) {
  return (
    <div className="parts" aria-hidden style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < done ? "done" : i === done ? "now" : ""} />)}
    </div>
  );
}

/** Opening models, step by step: the server opens them, the page downloads each file, then draws each one. */
export interface LoadProgress {
  title: string;
  files: string[];
  step: "server" | "download" | "draw";
  /** The server's own words while it works (an upload's stages); else the step's. */
  line?: string;
  fetched: number;
  bytes: number;
  drawn: number;
  elements: number;
  /** When each step ended, ms since `started`. */
  started: number;
  ends: Partial<Record<"server" | "download", number>>;
}

const STEPS = ["server", "download", "draw"] as const;

/** How long the first step may run before the card says the server may be waking (Cloud Run scales to zero). */
export const WAKE_AFTER_MS = 3000;

/** What the card says for the server's step: the server's own words (an upload's stages), else opening, and once that
 * takes longer than WAKE_AFTER_MS, that the server may be waking (a first visit after a quiet spell). */
export function serverLine(load: LoadProgress, now: number): { text: string; waking: boolean } {
  if (load.line) return { text: load.line, waking: false };
  const waking = now - load.started > WAKE_AFTER_MS;
  return { text: waking ? "Waking up the server: the first visit can take up to 30 s" : "Opening the models", waking };
}

/** How far the whole opening is, 0–1, from what is measured: none while the server works (the bar moves without a
 * number), then the files downloaded and drawn. */
export function loadShare(load: LoadProgress): number | null {
  const n = Math.max(1, load.files.length);
  if (load.step === "server") return null;
  if (load.step === "download") return 0.35 + 0.35 * (load.fetched / n);
  return 0.7 + 0.3 * (load.drawn / n);
}

/** The checklist card in the middle of an empty model while the first models open: light, with a slim bar that never
 * stands still, the time so far, the step in words (waking the server, opening, downloading n of N, drawing) and
 * Cancel. */
export function LoadCard({ load, now, onCancel }: { load: LoadProgress; now: number; onCancel?: () => void }) {
  const at = STEPS.indexOf(load.step);
  const n = load.files.length;
  const secs = (ms?: number) => (ms == null ? "" : `${(ms / 1000).toFixed(1)} s`);
  const server = serverLine(load, now);
  const share = loadShare(load);
  const elapsed = Math.max(0, Math.round((now - load.started) / 1000));
  const rows: { text: string; aside: string; extra?: React.ReactNode }[] = [
    { text: at > 0 ? "Opened on the server" : server.text, aside: at > 0 ? secs(load.ends.server) : server.waking ? `${elapsed} s` : "" },
    { text: at > 1 ? `Downloaded the models ${n}/${n}` : `Downloading the models ${load.fetched}/${n}`,
      aside: load.bytes ? `${(load.bytes / 1e6).toFixed(1)} MB` : "" },
    { text: at === 2 && load.drawn < n ? `Drawing ${load.drawn + 1}/${n}: ${load.files[load.drawn]}` : "Drawing",
      aside: load.elements ? `${load.elements.toLocaleString()} elements` : "",
      extra: at === 2 && n > 1 ? <><Parts done={load.drawn} total={n} />
        <p className="hint">{load.files.map((f, i) => `${f}${i < load.drawn ? " ✓" : ""}`).join(" · ")}</p></> : null },
  ];
  return (
    <section className="load-card" role="status" aria-live="polite" onClick={(e) => e.stopPropagation()}>
      <div className="load-head">
        <span className="mark-badge load-mark" style={{ "--mb": "48px" } as React.CSSProperties} aria-hidden />
        <div><h2>{load.title}</h2>
          <p className="hint">{n} model{n === 1 ? "" : "s"} · {elapsed} s</p></div>
        {onCancel && <button type="button" className="btn small ghost load-cancel" onClick={onCancel}>Cancel</button>}
      </div>
      <div className={`load-bar${share == null ? " busy" : ""}`} role="progressbar" aria-label="Opening the models"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={share == null ? undefined : Math.round(share * 100)}>
        <i style={share == null ? undefined : { width: `${Math.round(share * 100)}%` }} /></div>
      <ol className="load-steps">
        {rows.map((r, i) => (
          <li key={i} className={i < at ? "done" : i === at ? "now" : "next"}>
            <span className="tick" aria-hidden />
            <div className="load-row">
              <div className="row"><span>{r.text}</span><span className="mono why">{i <= at ? r.aside : ""}</span></div>
              {i === at && r.extra}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A confirmed, completed action (a fix kept in the model): the mark beside the words. */
export function KeptToast({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="toast kept" role="status">
      <ApertureMark size={28} />
      <span><b>{text}</b>{detail && <><br /><span className="why">{detail}</span></>}</span>
    </div>
  );
}
