import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./holo.css";

/**
 * Iris's motion (docs/architecture/12-web-app.md, "Theme and motion"): the holographic ribbon, the text reveal, the
 * count-up and the AI shimmer (a CSS class, `.ai-shimmer`, in holo.css). All of it is still under
 * `prefers-reduced-motion`, and where there is no window (a test's static render) everything shows its final state.
 */

/** Less motion asked for (or no window to animate in): the motion here is then still. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; }
}

/** `prefersReducedMotion`, following the setting while the page is open. */
export function useReducedMotion(): boolean {
  const [still, setStill] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setStill(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return still;
}

/**
 * The holographic ribbon (lifemed-like): a loop of fine threads in the `--holo` colours that share one diameter and fan
 * apart around it, so together they read as one iridescent ribbon twisted at two points. It turns slowly in its own
 * plane (the twist travels round, a 28 s loop) and sways in 3D (26 s), over a blurred glow, with a glassy spark. CSS
 * only: every moving layer is a transform the compositor animates, painted once. Still under reduced motion.
 * Decorative (aria-hidden). `size` is its width and height: pixels, or any CSS length (e.g. "clamp(240px, 40cqi,
 * 520px)", which keeps the full detail); under 160 px it draws fewer, thicker threads.
 */
export function HoloRibbon({ size = 320, className = "" }: { size?: number | string; className?: string }) {
  const small = typeof size === "number" && size < 160;
  const n = typeof size !== "number" || size >= 200 ? 11 : small ? (size < 100 ? 4 : 5) : 8;
  return (
    <div className={`holo-ribbon${small ? " holo-small" : ""} ${className}`.trim()}
      style={{ "--hr": typeof size === "number" ? `${size}px` : size } as CSSProperties} aria-hidden>
      <div className="holo-glow" />
      <div className="holo-stage">
        <div className="holo-sway">
          <div className="holo-fan">
            {Array.from({ length: n }, (_, k) => <span key={k} style={{ "--t": +(k / (n - 1)).toFixed(3) } as CSSProperties} />)}
          </div>
        </div>
      </div>
      <div className="holo-spark" />
    </div>
  );
}

/** Texts already revealed in this page load (TextReveal's `once`): seen again, they are simply there. */
const revealed = new Set<string>();

/**
 * Words that fade in from a lavender blur to ink, one after another (the Home greeting and tagline). Under less motion,
 * or with no window, the text is simply there. Screen readers get the whole text once, as one string. With `once` (a key),
 * it plays on the first view in a page load only: coming back to the page shows it at rest.
 */
export function TextReveal({ text, className = "", delay = 0, step = 70, once }: {
  text: string; className?: string;
  /** Milliseconds before the first word. */
  delay?: number;
  /** Milliseconds between words. */
  step?: number;
  /** Play once per page load under this key. */
  once?: string;
}) {
  const reduced = useReducedMotion();
  const [seen] = useState(() => once !== undefined && revealed.has(once));
  useEffect(() => { if (once !== undefined) revealed.add(once); }, [once]);
  if (reduced || seen) return <span className={className}>{text}</span>;
  const words = text.split(/(\s+)/);
  let n = 0;
  return (
    <span className={`text-reveal ${className}`.trim()}>
      <span className="text-reveal-sr">{text}</span>
      {words.map((w, i) => (/^\s+$/.test(w) ? w
        : <span key={i} className="text-reveal-word" aria-hidden style={{ animationDelay: `${delay + step * n++}ms` }}>{w}</span>))}
    </span>
  );
}

/**
 * A number that counts up from 0 the first time it shows, with a slight lavender blur that clears as it lands. Under
 * less motion, or with no window, it shows the number. Later changes move straight to the new value.
 */
export function CountUp({ value, ms = 900, className = "" }: { value: number; ms?: number; className?: string }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  const done = useRef(false);
  useEffect(() => {
    if (still || done.current || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(value * eased));
      if (k < 1) frame = window.requestAnimationFrame(tick);
      else done.current = true;
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, ms, still]);
  const landing = !still && !done.current && shown !== value;
  return <span className={`count-up${landing ? " counting" : ""} ${className}`}>{shown.toLocaleString()}</span>;
}

/**
 * An empty page or panel (Synthesia-like): a small holographic ribbon, a title, one line and one primary action,
 * centred. `compact` is the smaller one for a card or a side panel.
 */
export function EmptyState({ title, line, action, compact = false, className = "" }: {
  title: string; line?: ReactNode; action?: ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <div className={`empty-state${compact ? " compact" : ""} ${className}`}>
      <HoloRibbon size={compact ? 72 : 120} className="empty-state-art" />
      <h2 className="empty-state-title">{title}</h2>
      {line && <p className="empty-state-line">{line}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
