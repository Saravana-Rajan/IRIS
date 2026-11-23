// Navigating the 3D view for anyone (docs/views.md, "Navigate like a CAD tool"; owner, Nov 23: "user-friendly to move and
// zoom in / zoom out"). The rules are pure and tested here: how far the camera may come in or go out, how a zoom eases to
// its goal, the wheel's and the keys' steps, what a drag does in Rotate or Move mode, and the first-use hint's memory.
// `NavPad` is the small cluster over the 3D view (zoom in and out with press-and-hold, Fit, Rotate / Move, "?"); the
// Viewer owns it and does the moving.
import { MOUSE, TOUCH } from "three";

/** What a plain left drag (and one finger) does: turn the view, or move it sideways. */
export type NavMode = "rotate" | "pan";

/** How near and how far the camera may be from what it looks at. */
export interface Limits { min: number; max: number }

/** One press of + or − (a button, a key): a fifth closer, or as much farther. */
export const ZOOM_STEP = 1.25;
/** Holding + or −: the distance shrinks or grows by e (2.7×) every `1 / HOLD_RATE` seconds, steady, never a jump. */
export const HOLD_RATE = 1.4;
/** How quickly a zoom or a key's pan eases to its goal: about two thirds of the way in this many milliseconds. */
export const EASE_MS = 90;
/** One arrow key: this share of the distance to what the camera looks at. */
export const PAN_STEP = 0.12;
/** The first-use hint's words, and where this browser remembers it was seen. */
export const HINT_TEXT = "Drag to rotate · Right-drag or Shift-drag to move · Scroll or pinch to zoom · Double-click to focus";
export const HINT_KEY = "iris.viewer.hint";

/** Near and far for a scene this size across (its diagonal, metres): near enough to read a fitting, never inside the
 * near plane's reach (it sits at a 200th of the distance), and never so far the model is a speck you can lose (five
 * times across; Fit frames at 1.1). With nothing open, no limits. */
export function distanceLimits(sceneDiag: number): Limits {
  if (!(sceneDiag > 0) || !Number.isFinite(sceneDiag)) return { min: 0.0005, max: Infinity };
  const min = Math.min(Math.max(sceneDiag * 0.001, 0.002), 0.25);
  return { min, max: Math.max(sceneDiag * 5, min * 20) };
}

export const clampDistance = (d: number, l: Limits) => Math.min(Math.max(d, l.min), l.max);

/** A new goal kept within the limits, and never the other way from the old one: zooming in from nearer than the
 * limit (a flight to a tiny part) stays put rather than backing out. */
export function towards(goal: number, next: number, l: Limits): number {
  const c = clampDistance(next, l);
  return next < goal ? Math.min(goal, c) : Math.max(goal, c);
}

/** The goal after one press: `dir` 1 comes in, −1 goes out, kept within the limits. */
export function stepGoal(goal: number, dir: 1 | -1, l: Limits, step = ZOOM_STEP): number {
  return towards(goal, dir > 0 ? goal / step : goal * step, l);
}

/** The goal after holding + or − for `dtMs`: a steady rate in log distance, kept within the limits. */
export function holdGoal(goal: number, dir: 1 | -1, dtMs: number, l: Limits, rate = HOLD_RATE): number {
  return towards(goal, goal * Math.exp(-dir * rate * Math.max(dtMs, 0) / 1000), l);
}

/** Where the distance is after `dtMs` of easing toward its goal: exponential in log distance, so a zoom feels the same
 * from 1 m and from 100 m, settles without overshoot and never steps. */
export function easeDistance(d: number, goal: number, dtMs: number, tauMs = EASE_MS): number {
  if (!(d > 0) || !(goal > 0)) return goal;
  const k = 1 - Math.exp(-Math.max(dtMs, 0) / tauMs);
  return Math.exp(Math.log(d) + (Math.log(goal) - Math.log(d)) * k);
}

/** A wheel event as a scale of the distance (above 1 farther): lines and pages made pixels, a trackpad's pinch (the
 * browser sends it with Ctrl) made more sensitive, one event never more than about a third either way. */
export function wheelScale(deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const k = pinch ? 0.01 : 0.0016;
  const log = Math.max(-0.3, Math.min(0.3, px * k));
  return Math.exp(log);
}

/** What a key does while the 3D view has the focus: zoom in or out, move the view, or Fit and Home (App's own keys,
 * listed here so the map is in one place). */
export type NavKey = { zoom: 1 | -1 } | { pan: [number, number] } | { fit: true } | { home: true };
export function navKey(key: string): NavKey | null {
  switch (key) {
    case "+": case "=": case "Add": return { zoom: 1 };
    case "-": case "_": case "Subtract": return { zoom: -1 };
    case "ArrowLeft": return { pan: [-1, 0] };
    case "ArrowRight": return { pan: [1, 0] };
    case "ArrowUp": return { pan: [0, 1] };
    case "ArrowDown": return { pan: [0, -1] };
    case "f": case "F": return { fit: true };
    case "h": case "H": return { home: true };
    default: return null;
  }
}

/** The mouse buttons for a mode: in Rotate a left drag turns (Shift, Ctrl or Cmd with it moves, the controls' own rule),
 * in Move (or with Space held) a left drag moves; the right button always moves, the middle always zooms. */
export function mouseFor(mode: NavMode, space = false) {
  return { LEFT: mode === "pan" || space ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
}

/** Touch: one finger turns (moves, in Move mode), two fingers move and pinch to zoom. */
export function touchesFor(mode: NavMode) {
  return { ONE: mode === "pan" ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
}

type Store = Pick<Storage, "getItem" | "setItem"> | null | undefined;
const storage = (): Store => { try { return globalThis.localStorage; } catch { return null; } };

/** Whether this browser has seen the first-use hint (no storage, a private window: say seen, never nag). */
export function hintSeen(store: Store = storage()): boolean {
  try { return !store || store.getItem(HINT_KEY) === "1"; } catch { return true; }
}
export function markHintSeen(store: Store = storage()) {
  try { store?.setItem(HINT_KEY, "1"); } catch { /* a private window */ }
}

/** Lucide's outlines (ISC), inline: the viewer's DOM is not React. */
const ICON: Record<string, string> = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  rotate: '<path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 13.707 3.814 1.86-1.86 3.814"/><path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"/>',
  move: '<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
const svg = (name: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

export interface NavPadActions {
  /** A press of + (1) or − (−1). */
  zoomStep(dir: 1 | -1): void;
  /** Holding it: start with a direction, stop with null. */
  zoomHold(dir: 1 | -1 | null): void;
  fit(): void;
  setMode(mode: NavMode): void;
  showHint(): void;
}

/** How long a press of + or − waits before it zooms on by itself. */
const HOLD_AFTER_MS = 280;

/** The cluster over the 3D view, beside the view cube: zoom in, zoom out (press and hold to keep going), Fit, Rotate /
 * Move, and "?" for the hint again. Its presses never reach the model's controls. */
export class NavPad {
  readonly el: HTMLDivElement;
  private modeButtons: Record<NavMode, HTMLButtonElement>;
  private holdTimer = 0;
  private holding = false;

  constructor(private act: NavPadActions) {
    const el = this.el = document.createElement("div");
    el.className = "nav-pad";
    el.setAttribute("role", "toolbar");
    el.setAttribute("aria-label", "Move and zoom the 3D view");
    const button = (cls: string, icon: string, label: string, tip: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `nav-btn ${cls}`;
      b.setAttribute("aria-label", label);
      b.dataset.tip = tip;
      b.dataset.tipSide = "left";
      b.innerHTML = svg(icon);
      return b;
    };
    const help = button("nav-help", "help", "How to move around", "How to move around");
    help.addEventListener("click", () => this.act.showHint());
    const rotate = button("nav-mode", "rotate", "Rotate: a drag turns the view", "Rotate: drag turns the view");
    const move = button("nav-mode", "move", "Move: a drag moves the view", "Move: drag moves the view (or right-drag, Shift-drag)");
    this.modeButtons = { rotate, pan: move };
    rotate.addEventListener("click", () => this.act.setMode("rotate"));
    move.addEventListener("click", () => this.act.setMode("pan"));
    const modes = document.createElement("div");
    modes.className = "nav-group nav-modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "What a drag does");
    modes.append(rotate, move);
    const zin = button("nav-zoom", "plus", "Zoom in", "Zoom in  ·  +  (hold to keep going)");
    const zout = button("nav-zoom", "minus", "Zoom out", "Zoom out  ·  −  (hold to keep going)");
    this.holdable(zin, 1);
    this.holdable(zout, -1);
    const fit = button("nav-fit", "fit", "Fit the whole model", "Fit the whole model  ·  F");
    fit.addEventListener("click", () => this.act.fit());
    const zoom = document.createElement("div");
    zoom.className = "nav-group";
    zoom.append(zin, zout, fit);
    el.append(help, modes, zoom);
    // Never to the 3D view's controls or the page's click and double-click (selection, A / B).
    const stop = (e: Event) => e.stopPropagation();
    for (const type of ["pointerdown", "click", "dblclick", "wheel", "contextmenu"]) el.addEventListener(type, stop);
    this.setMode("rotate");
  }

  /** + and −: a press zooms one step at once; held, it goes on smoothly until let go. The keyboard's Enter or Space
   * (a click with no pointer) is one step. */
  private holdable(b: HTMLButtonElement, dir: 1 | -1) {
    const end = () => {
      window.clearTimeout(this.holdTimer);
      if (this.holding) { this.holding = false; this.act.zoomHold(null); }
    };
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* an old browser */ }
      this.act.zoomStep(dir);
      window.clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => { this.holding = true; this.act.zoomHold(dir); }, HOLD_AFTER_MS);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(type, end);
    b.addEventListener("click", (e) => { if (e.detail === 0) this.act.zoomStep(dir); });
  }

  setMode(mode: NavMode) {
    for (const [m, b] of Object.entries(this.modeButtons)) {
      b.classList.toggle("on", m === mode);
      b.setAttribute("aria-pressed", String(m === mode));
    }
  }

  dispose() { window.clearTimeout(this.holdTimer); this.el.remove(); }
}

/** The first-use hint: one light card over the 3D view, shown once per browser (and again from "?"); ✕ or any move
 * of the view puts it away. */
export class NavHint {
  readonly el: HTMLDivElement;
  constructor(onClose: () => void) {
    const el = this.el = document.createElement("div");
    el.className = "nav-hint";
    el.setAttribute("role", "note");
    el.hidden = true;
    const text = document.createElement("p");
    text.className = "nav-hint-text";
    // One line per gesture on a narrow view; the dots between them on a wide one.
    text.innerHTML = HINT_TEXT.split(" · ").map((t) => `<span>${t}</span>`).join('<i aria-hidden="true"> · </i>');
    const close = document.createElement("button");
    close.type = "button";
    close.className = "nav-hint-close";
    close.setAttribute("aria-label", "Got it: hide the tip");
    close.innerHTML = svg("close", 14);
    close.addEventListener("click", () => onClose());
    el.append(text, close);
    const stop = (e: Event) => e.stopPropagation();
    for (const type of ["pointerdown", "click", "dblclick", "wheel"]) el.addEventListener(type, stop);
  }
  get shown() { return !this.el.hidden; }
  show(on: boolean) { this.el.hidden = !on; }
  dispose() { this.el.remove(); }
}
