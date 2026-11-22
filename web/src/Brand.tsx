// Iris's identity in the app (docs/brand-assets.md): the mark, the wordmark, the notch at the top of the model and the
// loading card. The geometry is the kit's (assets/brand/iris/svg): an eye's ring and pupil with a six-bladed aperture,
// and "Iris" drawn in strokes; index.html's boot splash draws the same lockup.

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

/** The checklist card in the middle of an empty model while the first models open. */
export function LoadCard({ load, now }: { load: LoadProgress; now: number }) {
  const at = STEPS.indexOf(load.step);
  const n = load.files.length;
  const secs = (ms?: number) => (ms == null ? "" : `${(ms / 1000).toFixed(1)} s`);
  const rows: { text: string; aside: string; extra?: React.ReactNode }[] = [
    { text: at > 0 ? "Opened on the server" : load.line ?? "Opening on the server", aside: at > 0 ? secs(load.ends.server) : "" },
    { text: at > 1 ? `Downloaded ${n} of ${n} model${n === 1 ? "" : "s"}` : `Downloading model${n === 1 ? "" : "s"}: ${load.fetched} of ${n}`,
      aside: load.bytes ? `${(load.bytes / 1e6).toFixed(1)} MB` : "" },
    { text: at === 2 && load.drawn < n ? `Drawing model ${load.drawn + 1} of ${n}: ${load.files[load.drawn]}` : `Drawing the model${n === 1 ? "" : "s"}`,
      aside: load.elements ? `${load.elements.toLocaleString()} elements` : "",
      extra: at === 2 && n > 1 ? <><Parts done={load.drawn} total={n} />
        <p className="hint">{load.files.map((f, i) => `${f}${i < load.drawn ? " ✓" : ""}`).join(" · ")}</p></> : null },
  ];
  return (
    <section className="load-card" role="status" aria-live="polite" onClick={(e) => e.stopPropagation()}>
      <div className="load-head">
        <IrisMark size={44} motion="orbit" />
        <div><h2>{load.title}</h2>
          <p className="hint">{n} model{n === 1 ? "" : "s"} · {Math.max(0, Math.round((now - load.started) / 1000))} s</p></div>
      </div>
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
