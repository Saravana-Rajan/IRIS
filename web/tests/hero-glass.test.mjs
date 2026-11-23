import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { compiled } from "./app-host.mjs";

/** Home's 3D glass Aperture and the glass family (glassModel.ts, the pure parts; three.js and WebGL stay out of Node):
 * the mark's blades and pupil from its paths, the breathing pose, the pointer's lean, when it animates, the pixel-ratio
 * cap, the ring's swept mesh, and the stills it ships. */
const g = await import(await compiled("../src/glassModel.ts"));
const brand = await readFile(new URL("../src/Brand.tsx", import.meta.url), "utf8");
const BLADES = brand.match(/APERTURE_BLADES = "([^"]+)"/)[1];
const PUPIL = brand.match(/APERTURE_PUPIL = "([^"]+)"/)[1];
const r = ([x, y]) => Math.hypot(x, y);

test("the Aperture from the logo's paths: six blades out to radius 1 round a hexagonal pupil, centred", () => {
  const { blades, pupil, hexagon } = g.apertureParts(BLADES, PUPIL, 24);
  assert.equal(blades.length, 6);
  for (const b of blades) {
    assert.equal(b.outline.length, 3 * 24, "three arcs from the tip, closed");
    assert.ok(b.outline.every((p) => p.every(Number.isFinite)));
    const far = Math.max(...b.outline.map(r));
    assert.ok(far > 0.98 && far < 1.02, `outer edge on radius 1 (${far})`);
    assert.ok(Math.abs(r(b.pivot) - 1) < 0.02, "the pin is on the outer edge");
    assert.ok(r(b.tip) < 0.4, "the tip is at the pupil");
    assert.ok(Math.abs(r(b.out) - 1) < 1e-9);
  }
  // the six blades are the same blade turned by 60°
  const angle = (b) => Math.atan2(b.tip[1], b.tip[0]);
  const steps = blades.map((b, i) => ((angle(blades[(i + 1) % 6]) - angle(b) + 4 * Math.PI) % (2 * Math.PI)));
  for (const s of steps) assert.ok(Math.abs(Math.abs(s - Math.PI) - 2 * Math.PI / 3) < 0.02 || Math.abs(s - Math.PI / 3) < 0.02
    || Math.abs(s - 5 * Math.PI / 3) < 0.02, `60° apart (${s})`);
  assert.ok(pupil.length > 6 && pupil.every((p) => r(p) < 0.4));
  assert.equal(hexagon.length, 6);
  const rr = hexagon.map(r);
  assert.ok(Math.max(...rr) - Math.min(...rr) < 0.01, "a regular hexagon");
  assert.equal(new Set(hexagon.map((p) => p.map((v) => v.toFixed(3)).join())).size, 6, "six distinct corners");
});

test("breathing: the blades slide out and turn so the opening grows, and the pupil grows with it", () => {
  const { blades } = g.apertureParts(BLADES, PUPIL, 16);
  for (const b of blades) {
    const shut = g.bladeMove(b, 0);
    assert.deepEqual(shut.pin, b.pivot);
    assert.equal(Math.abs(shut.turn), 0);
    const tipAt = (o) => {
      const { pin, turn } = g.bladeMove(b, o);
      const [x, y] = g.turnAbout(b.tip, b.pivot, turn);
      return r([x + pin[0] - b.pivot[0], y + pin[1] - b.pivot[1]]);
    };
    assert.ok(tipAt(1) > tipAt(0.5) && tipAt(0.5) > tipAt(0), "the tip moves away from the centre");
  }
  assert.equal(g.pupilScale(blades[0], 0), 1);
  const open = g.pupilScale(blades[0], 1);
  assert.ok(open > 1.1 && open < 1.6, `the opening grows by ${open}`);
});

test("the pose: a sixth of a turn per loop (seamless by symmetry), a gentle float, an 8 s breath eased in and out", () => {
  assert.ok(g.LOOP_S >= 20 && g.LOOP_S <= 30);
  assert.ok(g.BREATH_S >= 6 && g.BREATH_S <= 10 && g.LOOP_S % g.BREATH_S === 0, "whole breaths per loop");
  const p0 = g.aperturePose(0), p1 = g.aperturePose(g.LOOP_S - 1e-9);
  assert.ok(Math.abs(Math.abs(p1.spin - p0.spin) - Math.PI / 3) < 1e-6, "a sixth of a turn per loop");
  for (const t of [1, 5.5, 13]) {
    const a = g.aperturePose(t), b = g.aperturePose(t + g.LOOP_S);
    for (const k of ["tiltX", "tiltY", "lift", "open"]) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k} periodic at ${t}`);
  }
  assert.equal(p0.open, 0, "closed (the logo) at the start: the still is the logo");
  assert.ok(Math.abs(g.aperturePose(g.BREATH_S / 2).open - 1) < 1e-9, "open at half a breath");
  assert.ok(Math.abs(g.aperturePose(0.01).open) < 1e-3, "eased: slow out of closed");
});

test("the pointer: a lean of up to about 12° toward it, attention only over the area, eased frame-rate free", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(g.pointerAim(300, 150, rect), { tiltX: 0, tiltY: 0, attention: 1 });
  const corner = g.pointerAim(500, 250, rect);
  assert.ok(Math.abs(corner.tiltY - g.MAX_TILT) < 1e-9 && Math.abs(corner.tiltX - g.MAX_TILT) < 1e-9);
  assert.ok(Math.abs(g.MAX_TILT * 180 / Math.PI - 12) < 0.5, "about 12°");
  const far = g.pointerAim(-900, 2000, rect);
  assert.deepEqual([far.tiltX, far.tiltY, far.attention], [g.MAX_TILT, -g.MAX_TILT, 0], "clamped outside, no attention");
  assert.equal(g.follow(0, 1, 0), 0);
  assert.ok(Math.abs(g.follow(0, 1, 0.5) - g.follow(g.follow(0, 1, 0.25), 1, 0.25)) < 1e-12, "the same in one step or two");
  assert.ok(g.follow(0, 1, 10) > 0.999);
  assert.equal(g.pointerFollows({ reduced: false, coarse: false }), true);
  assert.equal(g.pointerFollows({ reduced: true, coarse: false }), false, "still under reduced motion");
  assert.equal(g.pointerFollows({ reduced: false, coarse: true }), false, "not on touch");
});

test("motion: only when allowed, on screen, the tab showing and not paused; at most 2x pixels", () => {
  const on = { reduced: false, visible: true, hidden: false, paused: false };
  assert.equal(g.shouldAnimate(on), true);
  for (const k of ["reduced", "hidden", "paused"]) assert.equal(g.shouldAnimate({ ...on, [k]: true }), false, k);
  assert.equal(g.shouldAnimate({ ...on, visible: false }), false, "off screen");
  assert.deepEqual([0.5, 1, 1.5, 2, 3, NaN, undefined].map(g.capPixelRatio), [1, 1, 1.5, 2, 2, 1, 1]);
});

test("the ring: a closed swept band, twisted, smooth across its seam; odd half-turns stitch turned over", () => {
  const closed = (m, label) => {
    const verts = m.positions.length / 3;
    assert.equal(m.normals.length, m.positions.length);
    for (let v = 0; v < verts; v++) assert.ok(Math.abs(r([r([m.normals[v * 3], m.normals[v * 3 + 1]]), m.normals[v * 3 + 2]]) - 1) < 1e-4);
    const edges = new Set();
    for (let f = 0; f < m.indices.length; f += 3)
      for (let k = 0; k < 3; k++) edges.add(`${m.indices[f + k]}>${m.indices[f + ((k + 1) % 3)]}`);
    for (const e of edges) { const [a, b] = e.split(">"); assert.ok(edges.has(`${b}>${a}`), `${label}: no hole at ${e}`); }
  };
  closed(g.ringMesh(0.2), "ring");
  const base = { segments: 24, sides: 8, halfWidth: 0.2, halfThickness: 0.05, roundness: 3, center: (u) => [Math.cos(u), Math.sin(u), 0] };
  for (const twists of [0, 1, 2, 3]) closed(g.sweepMesh({ ...base, twists }), `${twists} half-turns`);
  assert.throws(() => g.sweepMesh({ ...base, twists: 1, sides: 7 }), /even/);
});

test("the stills: the hero's under 200 KB, each glass shape's under 120 KB, all WebP", async () => {
  assert.equal(g.HERO_POSTER, "/hero/aperture.webp");
  assert.deepEqual([...g.GLASS_SHAPES], ["aperture", "ring", "pill"]);
  for (const [path, max] of [[g.HERO_POSTER, 200_000], ...g.GLASS_SHAPES.map((s) => [g.glassStill(s), 120_000])]) {
    const file = new URL(`../public${path}`, import.meta.url);
    const { size } = await stat(file);
    assert.ok(size > 2_000 && size <= max, `${path}: ${size} bytes`);
    assert.equal((await readFile(file)).subarray(8, 12).toString("latin1"), "WEBP", `${path} is WebP`);
  }
});

test("the component: lazy on Home, still under reduced motion, only while visible, pointer without React state, frees the GPU", async () => {
  const src = await readFile(new URL("../src/HeroGlass.tsx", import.meta.url), "utf8");
  for (const p of ["IntersectionObserver", "visibilitychange", "useReducedMotion", "stage.dispose()", "webglcontextlost",
    "pointermove", "removeEventListener(\"pointermove\"", "export default HeroGlass"]) assert.ok(src.includes(p), p);
  assert.doesNotMatch(src, /set[A-Z]\w*\((?:aim|goal)/, "the pointer never sets React state");
  const glass = await readFile(new URL("../src/glass.ts", import.meta.url), "utf8");
  for (const p of ["transmission", "thickness", "iridescence", "iridescenceIOR", "iridescenceThicknessRange", "clearcoat",
    "ACESFilmicToneMapping", "SRGBColorSpace", "PMREMGenerator", "antialias: true", "ExtrudeGeometry"]) assert.ok(glass.includes(p), p);
});
