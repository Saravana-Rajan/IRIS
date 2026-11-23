import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { compiled, viewerModule } from "./app-host.mjs";

// Moving and zooming the 3D view for anyone (viewer/navigate.ts; docs/architecture/13-3d-viewer.md, "Moving and
// zooming"; owner, Nov 23: "user-friendly to move and zoom in / zoom out").
const n = await import(await compiled("../src/viewer/navigate.ts", { three: import.meta.resolve("three") }));
const { Viewer } = await viewerModule();
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test("the zoom is clamped: near enough to read a fitting, never inside the near plane, never so far the model is lost", () => {
  const building = n.distanceLimits(60);
  assert.ok(close(building.min, 0.06) && close(building.max, 300), "a 60 m building: 60 mm to 300 m");
  assert.ok(building.min / 200 > 0.0002, "the near plane (a 200th of the distance) stays well in front");
  const part = n.distanceLimits(0.15);
  assert.ok(close(part.min, 0.002) && part.max >= part.min * 20, "a 150 mm part: 2 mm, and still room to back out");
  assert.equal(n.distanceLimits(5000).min, 0.25, "never more than 250 mm, however big");
  assert.equal(n.distanceLimits(0).max, Infinity, "nothing open: no limits");
  assert.equal(n.distanceLimits(Number.NaN).max, Infinity);
  // Steps and holds stay inside, and never back out from beyond a limit
  let goal = 10;
  for (let i = 0; i < 200; i++) goal = n.stepGoal(goal, 1, building);
  assert.equal(goal, building.min, "a hundred presses of + stop at the near limit");
  for (let i = 0; i < 200; i++) goal = n.stepGoal(goal, -1, building);
  assert.equal(goal, building.max, "and of − at the far limit");
  assert.ok(close(n.stepGoal(10, 1, building), 8) && close(n.stepGoal(8, -1, building), 10), "one press: a fifth closer, or back");
  assert.equal(n.stepGoal(0.01, 1, building), 0.01, "already nearer than the limit (a flight to a tiny part): + stays put");
  assert.equal(n.stepGoal(1000, -1, building), 1000, "already farther: − stays put");
  assert.equal(n.stepGoal(0.01, -1, building), building.min, "and − from there backs out to the limit, not past it the other way");
  assert.ok(close(n.holdGoal(10, 1, 1000, building), 10 * Math.exp(-n.HOLD_RATE)), "held for a second: e^rate nearer");
  assert.equal(n.holdGoal(10, 1, 60_000, building), building.min, "held a minute: at the limit, no further");
  assert.equal(n.holdGoal(10, -1, -5, building), 10, "no time, no move");
});

test("a zoom eases to its goal: no overshoot, the same feel near and far, settled within a few frames' time", () => {
  let d = 10;
  const seen = [];
  for (let i = 0; i < 30; i++) { d = n.easeDistance(d, 5, 16); seen.push(d); }
  assert.ok(seen.every((x, i) => x < (i ? seen[i - 1] : 10) && x > 5), "monotone, never past the goal");
  assert.ok(Math.abs(d - 5) < 0.02, "within half a second, at rest (under 0.5%)");
  const first = 10 - n.easeDistance(10, 5, 16);
  assert.ok(first < 1.2, "the first frame moves a little, not a jump");
  assert.ok(close(n.easeDistance(100, 50, 16) / 100, n.easeDistance(1, 0.5, 16) / 1), "scale-free: 100 m to 50 m feels like 1 m to 0.5 m");
  assert.equal(n.easeDistance(0, 3, 16), 3);
});

test("the wheel: a notch is a gentle step, lines and pages made pixels, a pinch more sensitive, never a jump", () => {
  const notch = n.wheelScale(100);
  assert.ok(notch > 1.1 && notch < 1.25, "a mouse notch (100 px down) backs out 10–25%");
  assert.ok(close(n.wheelScale(-100) * notch, 1), "up is the same step in");
  assert.ok(close(n.wheelScale(3, 1), n.wheelScale(48)), "three lines = 48 px");
  assert.ok(n.wheelScale(5, 0, true) > n.wheelScale(5, 0, false), "a trackpad pinch (Ctrl) is more sensitive");
  assert.ok(n.wheelScale(100_000) <= Math.exp(0.3) + 1e-12 && n.wheelScale(-100_000) >= Math.exp(-0.3) - 1e-12, "one event at most ~35%");
});

test("the key map: + − zoom, the arrows move, F fits, H goes home; anything else is not the viewer's", () => {
  for (const k of ["+", "=", "Add"]) assert.deepEqual(n.navKey(k), { zoom: 1 });
  for (const k of ["-", "_", "Subtract"]) assert.deepEqual(n.navKey(k), { zoom: -1 });
  assert.deepEqual(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].map(n.navKey), [{ pan: [-1, 0] }, { pan: [1, 0] }, { pan: [0, 1] }, { pan: [0, -1] }]);
  assert.deepEqual([n.navKey("f"), n.navKey("F"), n.navKey("h")], [{ fit: true }, { fit: true }, { home: true }]);
  for (const k of ["x", "Escape", " ", "Enter", "1"]) assert.equal(n.navKey(k), null);
});

test("the mode toggle: Rotate turns with a plain drag, Move (or Space held) moves; right always moves; touch follows", () => {
  const { MOUSE, TOUCH } = THREE;
  assert.deepEqual(n.mouseFor("rotate"), { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
  assert.deepEqual(n.mouseFor("pan"), { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
  assert.equal(n.mouseFor("rotate", true).LEFT, MOUSE.PAN, "Space held: a plain drag moves");
  assert.deepEqual(n.touchesFor("rotate"), { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }, "one finger turns, two move and pinch");
  assert.deepEqual(n.touchesFor("pan"), { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN });
});

test("the first-use hint is remembered, and storage that throws or is missing never shows it twice or breaks", () => {
  const kept = new Map(), store = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  assert.equal(n.hintSeen(store), false);
  n.markHintSeen(store);
  assert.equal(kept.get(n.HINT_KEY), "1");
  assert.equal(n.hintSeen(store), true);
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(n.hintSeen(broken), true, "storage that throws: treated as seen, never nagging");
  assert.doesNotThrow(() => n.markHintSeen(broken));
  assert.equal(n.hintSeen(null), true);
  assert.match(n.HINT_TEXT, /^Drag to rotate · Right-drag or Shift-drag to move · Scroll or pinch to zoom · Double-click to focus$/);
});

/** A viewer with a 60 m model open, the camera 20 m from the target, frames run by hand. */
function viewer() {
  const v = Object.create(Viewer.prototype);
  const camera = new THREE.PerspectiveCamera(45, 1.5, 0.05, 5000);
  camera.position.set(0, 0, 20);
  const controls = { target: new THREE.Vector3(), enabled: true, mouseButtons: null, touches: null, update() { camera.lookAt(this.target); camera.updateMatrixWorld(); } };
  controls.update();
  const classes = new Set();
  Object.assign(v, { camera, controls, models: [{}], projection: "perspective", flight: null, zoom: null, panLeft: new THREE.Vector3(), lastTick: 0,
    sceneDiag: () => 60, pane3d: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } });
  return { v, classes, dist: () => camera.position.distanceTo(controls.target) };
}
/** Run frames until the zoom or pan rests (or `ms` of frames), 16 ms apart. */
function settle(v, ms = 2000) {
  const real = performance.now;
  let now = real.call(performance);
  performance.now = () => now;
  try { for (let t = 0; t < ms && (v.zoom || v.panLeft.lengthSq() > 0); t += 16) { now += 16; v.navStep(); } }
  finally { performance.now = real; }
}

test("+ and − on the pad move the camera smoothly about the target, and a hold zooms on until let go", () => {
  const { v, dist } = viewer();
  const target = v.controls.target.clone();
  v.zoomStep(1);
  assert.ok(v.moving, "a zoom under way holds thumbnails back");
  settle(v);
  assert.ok(close(dist(), 16, 1e-3), "one press: 20 m → 16 m");
  assert.deepEqual(v.controls.target.toArray(), target.toArray(), "about what the view looks at");
  v.zoomStep(-1); v.zoomStep(-1);
  settle(v);
  assert.ok(close(dist(), 25, 1e-3), "two presses out add up: 16 → 25 m");
  v.zoomHold(1);
  const real = performance.now; let now = real.call(performance); performance.now = () => now;
  try { for (let i = 0; i < 60; i++) { now += 16; v.navStep(); } } finally { performance.now = real; }
  const held = dist();
  assert.ok(held < 25 * 0.5, "a second's hold comes well in");
  v.zoomHold(null);
  settle(v);
  assert.ok(dist() < held && dist() > 0.06, "let go: it eases to rest, inside the limit");
  for (let i = 0; i < 400; i++) v.zoomStep(1);
  settle(v, 20_000);
  assert.ok(close(dist(), 0.06, 1e-2), "it never comes nearer than the limit");
});

test("the wheel zooms toward the point under the pointer, eased, and never past the far limit", () => {
  const { v, dist } = viewer();
  const point = new THREE.Vector3(5, 0, 0);
  Object.assign(v, { pickAt: () => ({ globalId: "g", point }) });
  const ev = (deltaY) => ({ deltaY, deltaMode: 0, ctrlKey: false, clientX: 300, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
  const toPoint = v.camera.position.clone().sub(point).normalize();
  v.wheel(ev(-100)); v.wheel(ev(-100));
  settle(v);
  assert.ok(dist() < 20 * 0.85, "two notches in");
  assert.ok(v.camera.position.clone().sub(point).normalize().distanceTo(toPoint) < 1e-9, "straight toward the point: it stays where it is on screen");
  for (let i = 0; i < 200; i++) v.wheel(ev(100));
  settle(v, 30_000);
  assert.ok(dist() <= 300 + 1e-6, "backing out stops at five times the model's size");
});

test("Move mode: the controls' left button moves and one finger moves; a press there looks for no pivot", () => {
  const { v, classes } = viewer();
  v.setNavMode("pan");
  assert.equal(v.controls.mouseButtons.LEFT, THREE.MOUSE.PAN);
  assert.equal(v.controls.touches.ONE, THREE.TOUCH.PAN);
  assert.ok(classes.has("nav-pan"), "a hand for a cursor");
  let picked = 0;
  Object.assign(v, { cube: { el: { contains: () => false } }, gripAt: () => null, pickAt: () => { picked++; return null; }, selection: null, orbitClash: true,
    lastClash: { ids: [], zone: new THREE.Box3(new THREE.Vector3(1, 1, 1), new THREE.Vector3(3, 3, 3)), point: null } });
  v.press({ button: 0, pointerId: 1, clientX: 1, clientY: 1, pointerType: "mouse", target: null });
  assert.ok(!v.spin && picked === 0, "a plain drag moves: no orbit round the clash, no pick");
  v.setNavMode("rotate");
  assert.equal(v.controls.mouseButtons.LEFT, THREE.MOUSE.ROTATE);
  assert.ok(!classes.has("nav-pan"));
  v.press({ button: 0, pointerId: 2, clientX: 1, clientY: 1, pointerType: "mouse", target: null });
  assert.ok(v.spin, "Rotate again: the drag orbits round the clash, as before");
});

test("the arrow keys move the view and its target together, sideways on screen", () => {
  const { v } = viewer();
  const offset = v.camera.position.clone().sub(v.controls.target);
  let prevented = 0;
  v.navKeyDown({ key: "ArrowRight", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => prevented++, stopPropagation() {} });
  settle(v);
  assert.ok(close(v.controls.target.x, 20 * 0.12, 1e-3), "a step is an eighth of the distance, to the right");
  assert.ok(v.camera.position.clone().sub(v.controls.target).distanceTo(offset) < 1e-6, "the camera keeps its angle and distance");
  v.navKeyDown({ key: "x", preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(prevented, 1, "other keys are left to the page");
});
