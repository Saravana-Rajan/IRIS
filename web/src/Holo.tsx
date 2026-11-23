import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { glassStill, type GlassShape } from "./glassModel";
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
 * Iris's mark in a soft pink circle (the Aperture's blades in the holo colours, drawn through a CSS mask of
 * `/brand/iris-spinner.svg`): the small art of empty states, the loading card and Home's quiet lines. Decorative.
 */
export function MarkBadge({ size = 64, className = "" }: { size?: number; className?: string }) {
  return <span className={`mark-badge ${className}`.trim()} style={{ "--mb": `${size}px` } as CSSProperties} aria-hidden />;
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
 * An empty page or panel (Synthesia-like): the mark in a soft pink circle, a title, one line and one primary action,
 * centred. `compact` is the smaller one for a card or a side panel. `glass`: one of the pre-rendered 3D glass stills
 * (`glassStill`, web/public/glass/) in place of the mark; at most one per view, so the main empty states only.
 */
export function EmptyState({ title, line, action, compact = false, className = "", glass }: {
  title: string; line?: ReactNode; action?: ReactNode; compact?: boolean; className?: string; glass?: GlassShape;
}) {
  const size = compact ? 72 : 104;
  return (
    <div className={`empty-state${compact ? " compact" : ""} ${className}`}>
      {glass
        ? <img className="empty-state-art empty-state-glass" src={glassStill(glass)} width={size} height={size} alt="" aria-hidden />
        : <MarkBadge size={compact ? 56 : 72} className="empty-state-art" />}
      <h2 className="empty-state-title">{title}</h2>
      {line && <p className="empty-state-line">{line}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
