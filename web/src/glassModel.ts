/**
 * The pure parts of Iris's 3D glass (HeroGlass.tsx draws them with three.js in glass.ts): the Aperture mark's blades
 * and pupil from its SVG paths, the hero aperture's pose over its loop (it floats, turns and breathes, opening and
 * closing like an eye's iris), the pointer's tilt, the swept-band ring, when to animate and the pixel-ratio cap. No
 * three, no DOM, so Node tests load it. Our own shapes and maths, in our palette; nothing comes from another site.
 */

/** An indexed triangle mesh: xyz positions, unit normals (smooth across the seam), triangle indices. */
export type GlassMesh = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** The glass shapes we render: the hero aperture (live, on a pedestal) and the small family (pre-rendered stills in
 * `web/public/glass/`, no pedestal). */
export type GlassShape = "aperture" | "ring" | "pill";
export const GLASS_SHAPES: readonly GlassShape[] = ["aperture", "ring", "pill"];

/** The hero's still: the poster while three loads, and the picture when there is no WebGL. */
export const HERO_POSTER = "/hero/aperture.webp";
/** A shape's pre-rendered still (transparent WebP at 2x). */
export const glassStill = (shape: GlassShape) => `/glass/${shape}.webp`;

/** One full loop of the hero's motion, in seconds: a sixth of a turn (the blades' symmetry), three breaths. */
export const LOOP_S = 24;
/** One breath of the iris (open and close), in seconds. */
export const BREATH_S = 8;
/** The device pixel ratio is capped here: sharper costs four times the pixels for little gain. */
export const MAX_DPR = 2;
/** The pointer tilts the aperture at most this far each way (radians, about 12°). */
export const MAX_TILT = 0.21;

/** Each shape's half-extent in view (width, height) with a margin, centred: the live stage fits this box ("contain")
 * and the still is rendered at its aspect, so the two line up in any container. The hero includes its pedestal. */
export const GLASS_EXTENT: Record<GlassShape | "hero", [number, number]> = {
  hero: [1.32, 1.5], aperture: [1.22, 1.22], ring: [1.45, 1.45], pill: [1.1, 1.1] };

export type Vec3 = [number, number, number];

export type SweepOptions = {
  /** Rings along the loop. */
  segments: number;
  /** Points around the cross-section (even, so a half-twisted seam can stitch). */
  sides: number;
  /** Half the band's width and half its thickness. */
  halfWidth: number;
  halfThickness: number;
  /** The cross-section's superellipse exponent: 2 an ellipse, higher a rounded rectangle. */
  roundness: number;
  /** Half-turns of twist along the loop: 1 is a Möbius band. */
  twists: number;
  /** The loop's centre line, for u in [0, 2π): periodic, and never along z (the frame's reference axis). */
  center: (u: number) => Vec3;
  /** The width along the loop, a factor of `halfWidth` (default 1). */
  widthAt?: (u: number) => number;
  /** The twist's starting angle (radians). */
  phase?: number;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const spow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

/**
 * A rounded band swept along a closed loop with `twists` half-turns: a superellipse cross-section (wide and thin, edges
 * rounded) carried by a frame of the loop's tangent and the z axis, rotated by twists·u/2. With an odd number of
 * half-turns the last ring meets the first one turned over, so the seam stitches to the point half-way round it; the
 * mesh is closed and has no duplicate seam vertices, so its normals are smooth everywhere.
 */
export function sweepMesh(o: SweepOptions): GlassMesh {
  const { segments: n, sides: m, halfWidth, halfThickness, roundness, twists, center } = o;
  if (m % 2 || m < 4 || n < 3) throw new Error("sweepMesh: sides must be even and at least 4, segments at least 3");
  const widthAt = o.widthAt ?? (() => 1);
  const phase = o.phase ?? 0;
  const positions = new Float32Array(n * m * 3);
  const e = 2 / roundness;
  const du = 1e-4;
  for (let i = 0; i < n; i++) {
    const u = (i / n) * Math.PI * 2;
    const c = center(u);
    const t = unit(sub(center(u + du), center(u - du)));
    const nrm = unit(cross([0, 0, 1], t)); // in the loop's plane, across the tangent
    const bin = cross(t, nrm);
    const th = (twists * u) / 2 + phase;
    const ct = Math.cos(th), st = Math.sin(th);
    const w: Vec3 = [ct * nrm[0] + st * bin[0], ct * nrm[1] + st * bin[1], ct * nrm[2] + st * bin[2]];
    const h: Vec3 = [-st * nrm[0] + ct * bin[0], -st * nrm[1] + ct * bin[1], -st * nrm[2] + ct * bin[2]];
    const hw = halfWidth * widthAt(u);
    for (let j = 0; j < m; j++) {
      const s = (j / m) * Math.PI * 2;
      const x = hw * spow(Math.cos(s), e), y = halfThickness * spow(Math.sin(s), e);
      const k = (i * m + j) * 3;
      positions[k] = c[0] + x * w[0] + y * h[0];
      positions[k + 1] = c[1] + x * w[1] + y * h[1];
      positions[k + 2] = c[2] + x * w[2] + y * h[2];
    }
  }
  const indices = new Uint32Array(n * m * 6);
  const shift = twists % 2 ? m / 2 : 0;
  let q = 0;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const i1 = last ? 0 : i + 1;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const a = i * m + j, b = i * m + j1;
      const c = i1 * m + (last ? (j + shift) % m : j), d = i1 * m + (last ? (j1 + shift) % m : j1);
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }
  return { positions, normals: vertexNormals(positions, indices), indices };
}

/** Area-weighted vertex normals of an indexed mesh, oriented outward for a closed mesh (flipped if they point in). */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const nr = new Float32Array(positions.length);
  const p = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]];
    const fn = cross(sub(p(b), p(a)), sub(p(c), p(a)));
    for (const v of [a, b, c]) { nr[v * 3] += fn[0]; nr[v * 3 + 1] += fn[1]; nr[v * 3 + 2] += fn[2]; }
  }
  // outward: a closed mesh's signed volume is positive with outward faces
  let vol = 0;
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [p(indices[f]), p(indices[f + 1]), p(indices[f + 2])];
    vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  const sign = vol < 0 ? -1 : 1;
  if (sign < 0) for (let f = 0; f < indices.length; f += 3) { const t = indices[f + 1]; indices[f + 1] = indices[f + 2]; indices[f + 2] = t; }
  for (let v = 0; v < nr.length; v += 3) {
    const l = Math.hypot(nr[v], nr[v + 1], nr[v + 2]) || 1;
    nr[v] = (sign * nr[v]) / l; nr[v + 1] = (sign * nr[v + 1]) / l; nr[v + 2] = (sign * nr[v + 2]) / l;
  }
  return nr;
}

/** The ring: a thick, rounded glass band round a soft three-lobed loop, twisted through a full turn. */
export function ringMesh(detail = 1): GlassMesh {
  return sweepMesh({
    segments: Math.round(420 * detail), sides: 2 * Math.round(24 * detail), halfWidth: 0.2, halfThickness: 0.085,
    roundness: 2.6, twists: 2, phase: 0.4,
    center: (u) => { const r = 1 + 0.16 * Math.cos(3 * u); return [r * Math.cos(u), r * Math.sin(u), 0.22 * Math.sin(3 * u + 0.5)]; },
    widthAt: (u) => 1 + 0.25 * Math.sin(3 * u + 1.1),
  });
}

/** Animate only when motion is allowed, the stage is on screen, the tab is showing and nobody paused it. */
export function shouldAnimate(s: { reduced: boolean; visible: boolean; hidden: boolean; paused: boolean }): boolean {
  return !s.reduced && s.visible && !s.hidden && !s.paused;
}

/** The device pixel ratio to render at: at least 1, at most MAX_DPR (a missing or odd value is 1). */
export function capPixelRatio(dpr: number | undefined): number {
  return Number.isFinite(dpr) && (dpr as number) > 1 ? Math.min(dpr as number, MAX_DPR) : 1;
}

/** The pointer's tilt and the iris's attention follow only with a fine pointer (a mouse or pen) and motion allowed. */
export function pointerFollows(s: { reduced: boolean; coarse: boolean }): boolean {
  return !s.reduced && !s.coarse;
}

/** Where the pointer asks the aperture to lean: x and y from −1 to 1 across `rect` (clamped outside it), as tilts of up
 * to MAX_TILT (it turns toward the pointer), and attention 1 while the pointer is over `rect`, else 0. */
export function pointerAim(x: number, y: number, rect: { left: number; top: number; width: number; height: number }):
  { tiltX: number; tiltY: number; attention: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const nx = clamp(((x - rect.left) / Math.max(1, rect.width)) * 2 - 1);
  const ny = clamp(((y - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  const inside = x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
  return { tiltX: ny * MAX_TILT, tiltY: nx * MAX_TILT, attention: inside ? 1 : 0 };
}

/** Ease `from` toward `to` over `dt` seconds (frame-rate independent; `rate` per second). */
export function follow(from: number, to: number, dt: number, rate = 4): number {
  return to + (from - to) * Math.exp(-Math.max(0, dt) * rate);
}

/** The hero aperture's pose at `t` seconds: a slow turn (a sixth per LOOP_S, so the loop is seamless by symmetry), a
 * gentle lean and float, and `open` from 0 (closed, the logo) to 1 (open), eased in and out over BREATH_S.
 * Periodic in LOOP_S. */
export function aperturePose(t: number): { spin: number; tiltX: number; tiltY: number; lift: number; open: number } {
  const a = ((t % LOOP_S) / LOOP_S) * Math.PI * 2;
  const b = ((t % BREATH_S) / BREATH_S) * Math.PI * 2;
  return {
    spin: -(a / 6),
    tiltX: 0.05 * Math.sin(a + 0.4),
    tiltY: 0.09 * Math.sin(a),
    lift: 0.035 * Math.sin(2 * a),
    open: 0.5 - 0.5 * Math.cos(b),
  };
}

type Pt = [number, number];

/**
 * An SVG path's closed outlines as points, for the commands the Aperture mark uses (M, L, A with a circular radius, Z;
 * absolute). Each arc is cut into `perArc` straight pieces. Outlines are in the path's own units (y down).
 */
export function pathOutlines(d: string, perArc = 32): Pt[][] {
  const tokens = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  let cmd = "";
  while (i < tokens.length) {
    if (/[MLAZ]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") { if (cur.length) out.push(cur); cur = [[num(), num()]]; cmd = "L"; }
    else if (cmd === "L") cur.push([num(), num()]);
    else if (cmd === "A") {
      const r0 = num(); num(); num(); const large = num(), sweep = num(); const to: Pt = [num(), num()];
      cur.push(...arcPoints(cur[cur.length - 1], to, r0, !!large, !!sweep, perArc));
    } else if (cmd === "Z") {
      const [f, l] = [cur[0], cur[cur.length - 1]];
      if (cur.length > 1 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) cur.pop();
      out.push(cur); cur = []; cmd = "";
    } else i++;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The points along a circular SVG arc from `p` to `q` (radius `r`, the large-arc and sweep flags), `q` included. */
function arcPoints(p: Pt, q: Pt, r0: number, large: boolean, sweep: boolean, n: number): Pt[] {
  const hx = (p[0] - q[0]) / 2, hy = (p[1] - q[1]) / 2;
  const r = Math.max(r0, Math.hypot(hx, hy));
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - hx * hx - hy * hy) / (hx * hx + hy * hy)));
  const cx = k * hy + (p[0] + q[0]) / 2, cy = -k * hx + (p[1] + q[1]) / 2;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  let da = Math.atan2(q[1] - cy, q[0] - cx) - a0;
  if (sweep && da < 0) da += 2 * Math.PI;
  if (!sweep && da > 0) da -= 2 * Math.PI;
  return Array.from({ length: n }, (_, j) => {
    const a = a0 + (da * (j + 1)) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
}

/** One blade: its outline (y up, the mark's centre at 0, outer radius 1), its pin (where its outer edge starts), its
 * inner tip, the way out from the centre through its middle, and which way it turns as it opens (+1 or −1, the way
 * that moves its tip away from the centre). */
export type Blade = { outline: Pt[]; pivot: Pt; tip: Pt; out: Pt; openSign: 1 | -1 };

/** Fully open, each blade slides this far out from the centre (outer radius 1) and turns this much on its pin, so
 * the slits between blades widen and the hexagon grows; they never overlap. */
export const BLADE_SLIDE = 0.05;
export const BLADE_TURN = 0.06;

/** Where a blade's pin goes and how far it turns at `open` (0 the logo, 1 open; a little more under attention). */
export function bladeMove(b: Blade, open: number): { pin: Pt; turn: number } {
  return { pin: [b.pivot[0] + b.out[0] * BLADE_SLIDE * open, b.pivot[1] + b.out[1] * BLADE_SLIDE * open],
    turn: b.openSign * BLADE_TURN * open };
}

/**
 * The Aperture mark's six blades and its hexagonal pupil, from the mark's paths (Brand.tsx's APERTURE_BLADES and
 * APERTURE_PUPIL, 100 × 100, centre 50,50, outer radius 44.5): centred, y up, outer radius 1. `hexagon` is the pupil's
 * six corners, a clean outline to make a solid of.
 */
export function apertureParts(bladesD: string, pupilD: string, perArc = 32): { blades: Blade[]; pupil: Pt[]; hexagon: Pt[] } {
  const R = 44.5;
  const norm = (p: Pt): Pt => [(p[0] - 50) / R, -(p[1] - 50) / R];
  const blades = pathOutlines(bladesD, perArc).map((raw) => {
    const outline = raw.map(norm);
    const tip = outline[0];
    const pivot = outline[perArc]; // the end of the first arc: where the outer edge starts
    const r = (s: number) => { const [x, y] = turnAbout(tip, pivot, s * 0.1); return Math.hypot(x, y); };
    const cx = outline.reduce((m, p) => m + p[0], 0) / outline.length, cy = outline.reduce((m, p) => m + p[1], 0) / outline.length;
    const out: Pt = [cx / Math.hypot(cx, cy), cy / Math.hypot(cx, cy)];
    return { outline, pivot, tip, out, openSign: (r(1) > r(-1) ? 1 : -1) as 1 | -1 };
  });
  const pupil = pathOutlines(pupilD, 6)[0].map(norm);
  // the pupil as a clean hexagon through its six corners (the farthest point in each sixth round one), to extrude
  const corners: Pt[] = Array.from({ length: 6 }, (_, k) => {
    const near = pupil.filter(([x, y]) => {
      const a = (Math.atan2(y, x) + 2 * Math.PI + Math.PI / 6) % (2 * Math.PI); // sixths centred on the corners
      return Math.floor(a / (Math.PI / 3)) === k;
    });
    return near.reduce((m, p) => (Math.hypot(...p) > Math.hypot(...m) ? p : m), near[0] ?? [0, 0]);
  });
  return { blades, pupil, hexagon: corners };
}

/** `p` turned by `a` radians about `c`. */
export function turnAbout(p: Pt, c: Pt, a: number): Pt {
  const [dx, dy] = [p[0] - c[0], p[1] - c[1]];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** How much wider the opening is at `open` (0 to 1): the ratio of a blade's tip distance from the centre, open vs closed.
 * The pupil grows with it, so the iris breathes like an eye's. */
export function pupilScale(blade: Blade, open: number): number {
  const { pin, turn } = bladeMove(blade, open);
  const [x, y] = turnAbout(blade.tip, blade.pivot, turn);
  return Math.hypot(x + pin[0] - blade.pivot[0], y + pin[1] - blade.pivot[1]) / Math.hypot(blade.tip[0], blade.tip[1]);
}
