import { Clapperboard, Play, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import "./demoVideo.css";

/** Which demo video: the 3D clash fix, the 2D drawing check, or the whole story. */
export type DemoVideoId = "3d" | "2d" | "full";

/** A demo video in web/public/demos/: the mp4, its English captions (WebVTT), its poster (a still) and its length as
 * shown on the Watch button. */
export interface DemoVideoInfo {
  id: DemoVideoId;
  title: string;
  src: string;
  vtt: string;
  poster: string;
  /** "m:ss", shown in mono beside the label. */
  duration: string;
}

/**
 * The demo videos (docs/architecture/19-demo-data.md, "Demo videos"): recorded from the sample with saved data (no live
 * AI calls), narrated, captioned. The durations are the assembled videos' lengths (timing.json of the demo-video build).
 */
/** Bumped whenever the demo files change: the files keep their names and are cached for an hour (firebase.json),
 *  so the query makes every browser fetch the new video, captions and poster. */
export const DEMO_VERSION = "20261123c";

export const DEMO_VIDEOS: Readonly<Record<DemoVideoId, DemoVideoInfo>> = {
  "3d": { id: "3d", title: "Fix clashes in your building models", duration: "1:30",
    src: `/demos/iris-3d-demo.mp4?v=${DEMO_VERSION}`, vtt: `/demos/iris-3d-demo.vtt?v=${DEMO_VERSION}`, poster: `/demos/iris-3d-demo.webp?v=${DEMO_VERSION}` },
  "2d": { id: "2d", title: "Check drawings against the model", duration: "0:58",
    src: `/demos/iris-2d-demo.mp4?v=${DEMO_VERSION}`, vtt: `/demos/iris-2d-demo.vtt?v=${DEMO_VERSION}`, poster: `/demos/iris-2d-demo.webp?v=${DEMO_VERSION}` },
  full: { id: "full", title: "Iris: does AI truly see?", duration: "2:17",
    src: `/demos/iris-full-demo.mp4?v=${DEMO_VERSION}`, vtt: `/demos/iris-full-demo.vtt?v=${DEMO_VERSION}`, poster: `/demos/iris-full-demo.webp?v=${DEMO_VERSION}` },
};

/** The demo cards, in order (the full demo first): each card's title and one line. Home's "See Iris in action" row and
 *  the Demos page (`/videos`, DemosPage.tsx) show the same three. */
export const DEMO_CARDS: readonly { id: DemoVideoId; title: string; line: string }[] = [
  { id: "full", title: "Full demo: problem to solution",
    line: "The problem, the 3D clash fixes, the drawing check and VisionBench, in one short story." },
  { id: "3d", title: "Fix clashes in your building models",
    line: "464 clashes; Gemini proposes fixes, geometry verifies them, the engineer accepts." },
  { id: "2d", title: "Check drawings against the model",
    line: "AI reads a PDF sheet; Iris checks it and finds the 4 planted mistakes." },
];

/** The meta line under each demo card's title. */
export const DEMO_META = "Gemini voice · Captions on";

/** The line under the demos' heading: Home's "See Iris in action" and the Demos page's header. */
export const DEMOS_LINE = "Three short narrated videos, from the problem to the solution. Captions on.";

/** What Tab reaches inside the dialog (the video's own controls are inside the video). */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), '
  + 'video[controls], [tabindex]:not([tabindex="-1"])';

/** The first (or last) place Tab reaches in `root`, else `root` itself. */
function edge(root: HTMLElement | null, last: boolean): HTMLElement | null {
  const all = root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  return (last ? all[all.length - 1] : all[0]) ?? root;
}

/** Captions on: `default` alone is ignored by some browsers on a track added after the page loaded. */
function captionsOn(video: HTMLVideoElement) {
  const track = video.textTracks?.[0];
  if (track && track.mode !== "showing") track.mode = "showing";
}

/**
 * A demo video in a light lightbox: a white card on a frosted white scrim (never a dark overlay), its title, a close
 * button and the 16:9 video with English captions on. Lazy: closed, it renders nothing, so neither the video nor its
 * poster is fetched until it opens; open, it plays (the click that opened it is the user's gesture; if the browser
 * refuses, the controls are there). A file that can't load says so. A native modal `<dialog>` (`showModal`, so the page
 * behind is inert and the dialog sits in the top layer, where no container or transform on the page clips it) that is
 * itself the scrim: focus moves to the close button, Tab and Shift+Tab stay inside (focus guards either side of the
 * card, so the video's own controls are reached too), Escape or a click on the scrim closes it, focus goes back to
 * `opener` (else to what had it), and the page behind doesn't scroll. Escape is caught on the document (and stopped
 * there, before App's own Escape on window) and as the dialog's `cancel`: with focus inside the video's own controls,
 * Chrome sends the page no key event, only the dialog's close request. Portalled to the body.
 */
export function DemoVideo({ id, open, onClose, opener }: {
  id: DemoVideoId;
  open: boolean;
  onClose: () => void;
  /** Where focus goes back on close: the button that opened it. Without one, whatever had focus when it opened. */
  opener?: RefObject<HTMLElement | null>;
}) {
  const video = DEMO_VIDEOS[id];
  const titleId = useId();
  const scrim = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const pressedScrim = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const back = opener?.current ?? (document.activeElement as HTMLElement | null);
    const body = document.body, overflow = body.style.overflow;
    body.style.overflow = "hidden";
    const d = scrim.current;
    if (d && !d.open) d.showModal?.();
    closeButton.current?.focus({ preventScroll: true });
    const v = player.current;
    if (v) {
      captionsOn(v);
      v.play()?.catch(() => {});
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();   // before App's own Escape on window
        close.current();
      } else if (e.key === "Tab" && !card.current?.contains(document.activeElement)) {
        e.preventDefault();   // focus had left the card (a press on the scrim leaves it on the body): bring it back in
        edge(card.current, e.shiftKey)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (d?.open) d.close();
      body.style.overflow = overflow;
      if (back && back.isConnected !== false) back.focus?.({ preventScroll: true });
      setFailed(false);   // reset on close, so the next open renders the video before its effect looks for it
    };
  }, [open]);

  if (!open) return null;
  /** Focus reached a guard: from inside the card it wraps round to the other end; from outside (the dialog's first
   * focus, the browser's own bar) it enters at the guard's end. */
  const guard = (from: EventTarget | null, atStart: boolean) => {
    const inside = !!from && !!card.current?.contains(from as Node);
    edge(card.current, atStart ? inside : !inside)?.focus();
  };
  const dialog = (
    <dialog ref={scrim} className="demo-video" data-video={id} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); close.current(); }}
      onPointerDown={(e) => { pressedScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const onScrim = e.target === e.currentTarget && pressedScrim.current;
        pressedScrim.current = false;
        if (onScrim) close.current();
      }}>
      <span className="demo-video-guard" tabIndex={0} data-guard="start" onFocus={(e) => guard(e.relatedTarget, true)} />
      <div className="demo-video-card" ref={card} tabIndex={-1}>
        <div className="demo-video-head">
          <h2 className="demo-video-title" id={titleId}>{video.title}</h2>
          <button ref={closeButton} type="button" className="demo-video-close" aria-label="Close" onClick={() => close.current()}>
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="demo-video-frame">
          {failed ? <p className="demo-video-error" role="alert">The video couldn't load.</p> : (
            <video ref={player} src={video.src} poster={video.poster} controls playsInline preload="none"
              onLoadedMetadata={(e) => captionsOn(e.currentTarget)}
              onError={(e) => { if (e.target === e.currentTarget) setFailed(true); }}>
              <track kind="captions" src={video.vtt} srcLang="en" label="English" default />
            </video>)}
        </div>
      </div>
      <span className="demo-video-guard" tabIndex={0} data-guard="end" onFocus={(e) => guard(e.relatedTarget, false)} />
    </dialog>
  );
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

/**
 * "Watch the demo · 2:35": a play mark, the label and the video's length in mono. It opens its video in the lightbox
 * and holds that state itself, so a page needs one line per place (Home: the two sample tiles and the hero).
 */
export function WatchDemoButton({ id, label = "Watch the demo", className = "", thumb = false }: {
  id: DemoVideoId;
  label?: string;
  /** Extra classes: `watch-demo-hero` for the larger one in Home's hero. */
  className?: string;
  /** A small 16:9 thumbnail of the video's poster with the play mark on it, in place of the round play mark (the hero's
   * chip); off by default, so a Watch button fetches nothing. */
  thumb?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const video = DEMO_VIDEOS[id];
  return (
    <>
      <button ref={button} type="button" className={`watch-demo ${thumb ? "watch-demo-thumb " : ""}${className}`.trim()} data-video={id}
        aria-haspopup="dialog" aria-label={`${label}: ${video.title} (${video.duration})`} onClick={() => setOpen(true)}>
        {thumb ? (
          <span className="watch-demo-poster" aria-hidden>
            <img src={video.poster} alt="" width={64} height={36} decoding="async" />
            <span className="watch-demo-play"><Play size={10} fill="currentColor" strokeWidth={0} /></span>
          </span>
        ) : <span className="watch-demo-play" aria-hidden><Play size={12} fill="currentColor" strokeWidth={0} /></span>}
        <span className="watch-demo-label">{label}</span>
        <span className="watch-demo-sep" aria-hidden>·</span>
        <span className="watch-demo-time mono">{video.duration}</span>
      </button>
      <DemoVideo id={id} open={open} onClose={() => setOpen(false)} opener={button} />
    </>
  );
}

/**
 * One demo card, as on a video site: a big 16:9 thumbnail (the video's poster, its title card with the glass aperture;
 * lazy, so the page fetches it only near the viewport) with a round white play button in the middle and the length in a
 * pill at the bottom right; under it the title (bold, two lines at most), one line and "Gemini voice · Captions on".
 * The whole card is one button that opens the video in the lightbox (nothing of the video loads before).
 */
export function DemoCard({ id, title, line }: { id: DemoVideoId; title: string; line: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const video = DEMO_VIDEOS[id];
  return (
    <li className="home-demo-item">
      <button ref={button} type="button" className="home-demo" data-video={id} aria-haspopup="dialog"
        aria-label={`Play ${title} (${video.duration}, captions on)`} onClick={() => setOpen(true)}>
        <span className="home-demo-poster">
          <img src={video.poster} alt="" width={1920} height={1080} loading="lazy" decoding="async" />
          <span className="home-demo-play" aria-hidden><Play size={22} fill="currentColor" strokeWidth={0} /></span>
          <span className="home-demo-len mono" aria-hidden>{video.duration}</span>
        </span>
        <span className="home-demo-text">
          <span className="home-demo-title">{title}</span>
          <span className="home-demo-line">{line}</span>
          <span className="home-demo-meta">{DEMO_META}</span>
        </span>
      </button>
      <DemoVideo id={id} open={open} onClose={() => setOpen(false)} opener={button} />
    </li>
  );
}

/** The three demo cards (DEMO_CARDS, the full demo first), as a list: Home's one row (`home-demos-row`) or the Demos
 *  page's grid (`demos-grid`). No hooks of its own. */
export function DemoCards({ className = "home-demos-row" }: { className?: string }) {
  return (
    <ul className={className}>
      {DEMO_CARDS.map((c) => <DemoCard key={c.id} {...c} />)}
    </ul>
  );
}

/** Home's demos, right under the hero and before the start tiles: a heading as How Iris works' (a small pink kicker
 *  "Demos", the title "See Iris in action", one line), then the three videos in one row of equal cards (on a tablet or
 *  a phone, a row that scrolls sideways and snaps to each card). */
export function WatchDemos() {
  return (
    <section className="home-section home-demos" aria-labelledby="home-demos-title">
      <header className="home-demos-head">
        <p className="home-kicker"><Clapperboard size={14} aria-hidden /> Demos</p>
        <h2 className="home-demos-title" id="home-demos-title">See Iris in action</h2>
        <p className="home-demos-line">{DEMOS_LINE}</p>
      </header>
      <DemoCards className="home-demos-row" />
    </section>
  );
}
