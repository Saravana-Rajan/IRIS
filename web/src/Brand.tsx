// Iris's identity in the app (docs/brand-assets.md): the mark, the wordmark, the notch at the top of the model and the
// loading card. The geometry is the kit's (assets/brand/iris/svg): an eye's ring and pupil with a six-bladed aperture,
// and "Iris" drawn in strokes; index.html's boot splash draws the same lockup.

import { HoloRibbon } from "./Holo";

/** The pupil with its hexagonal aperture cut out (even-odd), in the mark's 100 x 100 box. */
const PUPIL = "M 26 50 A 24 24 0 1 0 74 50 A 24 24 0 1 0 26 50 Z M 60 50 L 55 58.66 L 45 58.66 L 40 50 L 45 41.34 L 55 41.34 Z";
const LETTERS = ["M 128 8 L 128 92", "M 156 92 L 156 40 M 156 62 C 156 48 166 40 182 40", "M 200 40 L 200 92"];
const S = "M 250 48 C 246 42 239 40 232 40 C 222 40 216 45 216 52 C 216 60 224 63 232 66 C 241 69 248 72 248 80 C 248 88 241 92 232 92 C 224 92 217 89 214 84";

function MarkShapes() {
  return <><circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="9" /><path fillRule="evenodd" d={PUPIL} /></>;
}

/** The Iris lockup (the mark and "Iris") in the current text colour; `height` in px. */
export function Wordmark({ height = 28, title = "Iris" }: { height?: number; title?: string }) {
  return (
    <svg className="wordmark" width={Math.round(height * 2.6)} height={height} viewBox="0 0 260 100" fill="currentColor"
      role="img" aria-label={title}>
      <MarkShapes />
      <g fill="none" stroke="currentColor" strokeWidth="14">{LETTERS.map((d) => <path key={d} d={d} />)}</g>
      <circle cx="200" cy="17" r="8" /><path d={S} fill="none" stroke="currentColor" strokeWidth="12" />
    </svg>
  );
}

/** The mark. `motion`: orbit (indeterminate work), settle (once, after a confirmed action) or none. */
export function IrisMark({ size = 24, motion = "none" }: { size?: number; motion?: "none" | "orbit" | "settle" }) {
  return (
    <svg className={`iris-mark ${motion}`} width={size} height={size} viewBox="0 0 100 100" fill="currentColor" aria-hidden>
      <g><MarkShapes /></g>
    </svg>
  );
}

/** The app icon: the white mark on a navy tile (phones and tablets, where the wordmark has no room). */
export function AppIcon({ size = 30 }: { size?: number }) {
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Iris">
      <rect width="100" height="100" rx="22" fill="var(--navy)" />
      <g transform="translate(20 20) scale(.6)" fill="#fff" color="#fff"><MarkShapes /></g>
    </svg>
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
        <HoloRibbon size={48} className="load-ribbon" />
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

/** A confirmed, completed action (a fix kept in the model): the mark settles once beside the words. */
export function KeptToast({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="toast kept" role="status">
      <IrisMark size={28} motion="settle" />
      <span><b>{text}</b>{detail && <><br /><span className="why">{detail}</span></>}</span>
    </div>
  );
}
