import { useEffect, useRef, useState } from "react";
import { createGlassStage, type GlassStage } from "./glass";
import { capPixelRatio, follow, HERO_POSTER, pointerAim, pointerFollows, shouldAnimate } from "./glassModel";
import { useReducedMotion } from "./Holo";
import "./heroGlass.css";

export { aperturePose, capPixelRatio, LOOP_S, pointerAim, shouldAnimate } from "./glassModel";

/** A fine pointer (mouse or pen) and hover: the pointer's tilt follows only then. */
const finePointer = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * The hero's 3D glass Aperture (our logo brought to life, rendered live with three.js in glass.ts): six thick glass
 * blades floating over a white pedestal, turning slowly and breathing open and closed like an eye's iris (8 s), leaning
 * toward the pointer (about ±12°, eased in the render loop, no React state per frame) and opening a little more while
 * the pointer is over `track` (the hero). It fills its container. Lazy-loaded (StartScreen), so three is not in the
 * first paint. It draws only while on screen (IntersectionObserver) and the tab is showing, at most at 2x pixels; under
 * `prefers-reduced-motion`, or `paused`, it holds one still frame; on touch screens it moves on its own only. Without
 * WebGL (or if the context is lost) it shows the pre-rendered still (`HERO_POSTER`), which is also the poster under the
 * canvas until the first frame. Decorative: aria-hidden. Everything it made is freed on unmount.
 */
export function HeroGlass({ className = "", paused = false, track }: {
  className?: string;
  /** Hold the current frame (it resumes from the same pose). */
  paused?: boolean;
  /** The element whose area the pointer's attention counts over (default: this one). */
  track?: () => Element | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<"poster" | "live" | "still">("poster");
  const want = useRef({ reduced, paused, track });
  want.current = { reduced, paused, track };
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    let stage: GlassStage;
    try { stage = createGlassStage(cv, { shape: "aperture", hero: true }); } catch { setMode("still"); return; }
    let visible = true, hidden = document.hidden;
    let frame = 0, last = 0, t = 0, drawn = false, gone = false;
    const aim = { tiltX: 0, tiltY: 0, attention: 0 }, goal = { tiltX: 0, tiltY: 0, attention: 0 };
    const draw = () => { stage.render(t, aim); if (!drawn) { drawn = true; setMode("live"); } };
    const animate = () => !gone && shouldAnimate({ reduced: want.current.reduced, visible, hidden, paused: want.current.paused });
    const loop = (now: number) => {
      frame = 0;
      if (!animate()) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      aim.tiltX = follow(aim.tiltX, goal.tiltX, dt, 3);
      aim.tiltY = follow(aim.tiltY, goal.tiltY, dt, 3);
      aim.attention = follow(aim.attention, goal.attention, dt, 1.6);
      draw();
      frame = requestAnimationFrame(loop);
    };
    const update = () => {
      if (animate()) { if (!frame) { last = 0; frame = requestAnimationFrame(loop); } }
      else if (frame) { cancelAnimationFrame(frame); frame = 0; }
    };
    kick.current = update;
    const size = () => {
      const r = el.getBoundingClientRect();
      stage.resize(r.width, r.height, capPixelRatio(window.devicePixelRatio));
      if (!frame && visible) draw(); // a still frame stays right after a resize
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !drawn) size(); update(); });
    io.observe(el);
    const onVis = () => { hidden = document.hidden; update(); };
    document.addEventListener("visibilitychange", onVis);
    // the pointer: the stage's box gives the lean, the tracked area the attention; a frame only stores the goal
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !pointerFollows({ reduced: want.current.reduced, coarse: !finePointer() })) return;
      const lean = pointerAim(e.clientX, e.clientY, el.getBoundingClientRect());
      const area = want.current.track?.() ?? el;
      goal.tiltX = lean.tiltX; goal.tiltY = lean.tiltY;
      goal.attention = pointerAim(e.clientX, e.clientY, area.getBoundingClientRect()).attention;
    };
    const onLeave = () => { goal.tiltX = 0; goal.tiltY = 0; goal.attention = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    const onLost = (e: Event) => { e.preventDefault(); gone = true; update(); setMode("still"); };
    cv.addEventListener("webglcontextlost", onLost);
    size();
    update();
    return () => {
      gone = true;
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("webglcontextlost", onLost);
      kick.current = () => {};
      stage.dispose();
    };
  }, []);

  useEffect(() => { kick.current(); }, [reduced, paused]);

  return (
    <div ref={host} className={`hero-glass ${className}`.trim()} data-mode={mode} aria-hidden>
      <img className="hero-glass-still" src={HERO_POSTER} alt="" decoding="async" />
      <canvas ref={canvas} className="hero-glass-canvas" />
    </div>
  );
}

export default HeroGlass;
