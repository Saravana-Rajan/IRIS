import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
 * The holographic ribbon: an iridescent torus of layered, blurred gradients in the `--holo` colours, slowly turning
 * (a 24 s loop), with a glassy highlight. SVG and CSS only. Decorative (aria-hidden). `size` is its width in pixels.
 */
export function HoloRibbon({ size = 320, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <div className={`holo-ribbon ${className}`} style={{ width: size, height: size }} aria-hidden>
      <div className="holo-glow" />
      <svg className="holo-svg" viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8f9bff" />
            <stop offset=".4" stopColor="#b07af2" />
            <stop offset=".75" stopColor="#ff5cd6" />
            <stop offset="1" stopColor="#7dd3fc" />
          </linearGradient>
          <linearGradient id={`${id}-b`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7dd3fc" />
            <stop offset=".45" stopColor="#ff5cd6" />
            <stop offset="1" stopColor="#8f9bff" />
          </linearGradient>
          <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-soft`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <g className="holo-turn">
          <ellipse cx="100" cy="100" rx="70" ry="34" fill="none" stroke={`url(#${id}-a)`} strokeWidth="26" opacity=".9"
            filter={`url(#${id}-soft)`} transform="rotate(-24 100 100)" />
          <ellipse cx="100" cy="100" rx="62" ry="46" fill="none" stroke={`url(#${id}-b)`} strokeWidth="14" opacity=".7"
            transform="rotate(38 100 100)" className="holo-morph" />
          <ellipse cx="100" cy="100" rx="70" ry="34" fill="none" stroke={`url(#${id}-shine)`} strokeWidth="5" opacity=".75"
            transform="rotate(-24 100 92)" />
        </g>
      </svg>
    </div>
  );
}

/**
 * Words that fade in from a lavender blur to ink, one after another, once (the Home greeting and tagline). Under less
 * motion, or with no window, the text is simply there. The whole text stays one string for screen readers.
 */
export function TextReveal({ text, className = "", delay = 0, step = 70 }: {
  text: string; className?: string;
  /** Milliseconds before the first word. */
  delay?: number;
  /** Milliseconds between words. */
  step?: number;
}) {
  const still = useReducedMotion();
  const words = text.split(/(\s+)/);
  if (still) return <span className={className}>{text}</span>;
  let n = 0;
  return (
    <span className={`text-reveal ${className}`} aria-label={text}>
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
