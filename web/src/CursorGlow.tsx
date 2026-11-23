import { useEffect, useRef } from "react";
import "./cursorGlow.css";

/**
 * The pink glow that follows the cursor over the pages (Home, the projects, a project's pages; never over the 3D
 * workspace): a large pink-to-lavender glow easing toward the pointer, a smaller periwinkle one trailing it a little
 * more slowly, both breathing gently when the mouse rests. One fixed layer above the page, `pointer-events: none`,
 * blended with `multiply`, so white turns faintly pink and cards stay calm. Moved by transform from a
 * `requestAnimationFrame` loop that runs only while it catches up (no React render per frame), paused in a hidden tab.
 * A touch or coarse pointer, or less motion asked for, shows a still soft pink wash instead. It also lights the cards
 * under the cursor (`.home-tile`, `.hiw-card`): `--mx` / `--my` say where, cursorGlow.css draws the spotlight.
 */

export type GlowMode = "follow" | "still" | "off";

/** How the glow behaves here: it follows a fine pointer; a coarse pointer or less motion gets the still wash; with no
 *  window (a test's static render) or nothing to show, none. */
export function glowMode(env: { on: boolean; hasWindow: boolean; reducedMotion: boolean; coarsePointer: boolean }): GlowMode {
  if (!env.on || !env.hasWindow) return "off";
  return env.reducedMotion || env.coarsePointer ? "still" : "follow";
}

/** The lead glow's and the trailing glow's easing per frame (a share of the distance left). */
export const LEAD_EASE = 0.1;
export const TRAIL_EASE = 0.055;
/** One frame's step from `at` toward `to`. */
export const ease = (at: number, to: number, k: number) => at + (to - at) * k;
/** Cards that take the spotlight under the cursor. */
export const SPOTLIGHT = ".home-tile, .hiw-card";

const media = (q: string) => {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches; } catch { return false; }
};

export function CursorGlow({ on }: { on: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLElement>(null);
  const trail = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    const mode = glowMode({ on, hasWindow: typeof window !== "undefined", reducedMotion: media("(prefers-reduced-motion: reduce)"),
      coarsePointer: media("(pointer: coarse)") });
    if (el) el.dataset.mode = mode;
    if (mode !== "follow" || !el) return;
    let tx = window.innerWidth * 0.72, ty = window.innerHeight * 0.28;
    let ax = tx, ay = ty, bx = tx, by = ty, raf = 0, rest = 0;
    const place = () => {
      if (lead.current) lead.current.style.transform = `translate3d(${ax}px, ${ay}px, 0)`;
      if (trail.current) trail.current.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
    };
    const tick = () => {
      ax = ease(ax, tx, LEAD_EASE); ay = ease(ay, ty, LEAD_EASE);
      bx = ease(bx, tx, TRAIL_EASE); by = ease(by, ty, TRAIL_EASE);
      place();
      const far = Math.abs(bx - tx) + Math.abs(by - ty) > 0.5;
      raf = far && !document.hidden ? window.requestAnimationFrame(tick) : 0;
    };
    const wake = () => { if (!raf && !document.hidden) raf = window.requestAnimationFrame(tick); };
    const move = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      tx = e.clientX; ty = e.clientY;
      el.classList.remove("resting");
      window.clearTimeout(rest);
      rest = window.setTimeout(() => el.classList.add("resting"), 1500);
      wake();
      // The card under the cursor: where it is, for its spotlight
      const card = (e.target as Element | null)?.closest?.(SPOTLIGHT) as HTMLElement | null;
      if (card) {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - box.left}px`);
        card.style.setProperty("--my", `${e.clientY - box.top}px`);
      }
    };
    const shown = () => { if (document.hidden) { window.cancelAnimationFrame(raf); raf = 0; } else wake(); };
    place();
    el.classList.add("resting");
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", shown);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", shown);
      window.cancelAnimationFrame(raf);
      window.clearTimeout(rest);
    };
  }, [on]);
  return (
    <div ref={root} className={`cursor-glow${on ? " on" : ""}`} data-mode="off" aria-hidden>
      <i ref={lead} className="cg-lead"><b /></i>
      <i ref={trail} className="cg-trail"><b /></i>
    </div>
  );
}
