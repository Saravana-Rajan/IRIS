// Iris Bench renderer, the page side: builds a spec.Scene (server/iris_bench/spec.py) in three.js and renders the
// named views of a focus pair. render.mjs drives it headless (SwiftShader) and calls window.benchRender(job).
//
// World is Z up (metres); three is Y up: a world point (x, y, z) is drawn at (x, z, -y), the viewer's delta rule.
// Every picture is deterministic for a given job: the colours, letters and camera come from job.seed only.
import * as THREE from "three";

const BG = "#dfe6ee";                       // Iris viewer background
const GREY = "#9aa3ad";                     // context elements
// Well-separated hues, so any two picked together read as different (no pink next to purple).
const PALETTE = ["#e6194b", "#1f6fd1", "#2ca02c", "#ff8c00", "#8e44ad", "#00a6a6"];
const FOV = 35;
const SEE_THROUGH = 0.6;                    // focus opacity in A / C / before / after (40% see-through)
const CONTEXT_OPACITY = 0.15;               // grey context in B (85% transparent)
const CONTEXT_MARGIN = 2.5;                 // metres around the focus pair that count as context

// ---------- small helpers ----------
function rng(seed) {                        // mulberry32
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const w2t = (v) => new THREE.Vector3(v[0], v[2], -v[1]);

/** World axis-aligned box of an element (after an optional world offset). */
function worldBox(e, off = [0, 0, 0]) {
  let lo, hi;
  if (e.shape === "box") { lo = e.min; hi = e.max; }
  else {
    const r = e.radius;
    lo = [0, 1, 2].map((i) => Math.min(e.start[i], e.end[i]) - r);
    hi = [0, 1, 2].map((i) => Math.max(e.start[i], e.end[i]) + r);
    // the axis direction carries no radius
    for (let i = 0; i < 3; i++) if (e.start[i] !== e.end[i]) { lo[i] += r; hi[i] -= r; }
  }
  return { min: lo.map((v, i) => v + off[i]), max: hi.map((v, i) => v + off[i]) };
}
/** three-space Box3 of a world box. */
function tBox(b) { return new THREE.Box3().setFromPoints([w2t(b.min), w2t(b.max)]); }

// ---------- geometry ----------
/** A box with rectangular through-holes, as the boundary of a grid of cells: openings are real holes and there are
 * no internal faces (so see-through looks right). Built in world coordinates, then mapped to three. */
function boxWithOpenings(min, max, openings) {
  const cuts = [0, 1, 2].map((i) => {
    const s = new Set([min[i], max[i]]);
    for (const o of openings) for (const v of [o.min[i], o.max[i]]) if (v > min[i] && v < max[i]) s.add(v);
    return [...s].sort((a, b) => a - b);
  });
  const [nx, ny, nz] = cuts.map((c) => c.length - 1);
  const solid = new Uint8Array(nx * ny * nz);
  const idx = (i, j, k) => (i * ny + j) * nz + k;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const c = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
    const inHole = openings.some((o) => [0, 1, 2].every((a) => c[a] > o.min[a] && c[a] < o.max[a]));
    solid[idx(i, j, k)] = inHole ? 0 : 1;
  }
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? 0 : solid[idx(i, j, k)];
  const pos = [], nrm = [];
  const quad = (p, n) => {           // p: 4 world corners counter-clockwise seen from outside
    for (const t of [0, 1, 2, 0, 2, 3]) { const v = w2t(p[t]); pos.push(v.x, v.y, v.z); const m = w2t(n); nrm.push(m.x, m.y, m.z); }
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!at(i, j, k)) continue;
    const x0 = cuts[0][i], x1 = cuts[0][i + 1], y0 = cuts[1][j], y1 = cuts[1][j + 1], z0 = cuts[2][k], z1 = cuts[2][k + 1];
    if (!at(i - 1, j, k)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    if (!at(i + 1, j, k)) quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    if (!at(i, j - 1, k)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    if (!at(i, j + 1, k)) quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]);
    if (!at(i, j, k - 1)) quad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
    if (!at(i, j, k + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function cylinderGeometry(e) {
  const a = w2t(e.start), b = w2t(e.end);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(e.radius, e.radius, len, 32, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function elementGeometry(e) {
  if (e.shape === "cylinder") return cylinderGeometry(e);
  return boxWithOpenings(e.min, e.max, e.openings || []);
}

// ---------- renderer (one per page, reused across jobs) ----------
let renderer = null, size = 0;
function ensureRenderer(w) {
  if (renderer && size === w) return renderer;
  if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(w, w, false);
  document.body.appendChild(renderer.domElement);
  size = w;
  return renderer;
}

// ---------- the job ----------
/**
 * job = { scene, focus: [ids], views: ["A","B","C","before_A","after_A","before_C","after_C"], style, seed, fix, width }
 * A view named before* / after* draws the scene before / after job.fix (the element translated); a name ending in
 * "C" (C, before_C, after_C) looks from 90° round from A. Openings of focus elements get letters from P on.
 * returns [{ name, png, id_png, labels, colors, visible_px, focus }] with PNGs as base64 (no data: prefix).
 */
window.benchRender = function benchRender(job) {
  const W = job.width || 1024;
  const r = ensureRenderer(W);
  const style = job.style || "shaded";
  const scene = job.scene;
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const focus = job.focus.filter((id) => byId.has(id));
  if (focus.length !== job.focus.length) throw new Error(`unknown focus id in ${job.focus}`);
  const rand = rng(job.seed ?? 0);

  // Letters A, B, C … to the focus elements in a seeded order; distinct seeded colours.
  const order = shuffle(focus, rand);
  const labels = {}, colors = {};
  order.forEach((id, i) => { labels[id] = String.fromCharCode(65 + i); });
  const pal = shuffle(PALETTE, rand);
  focus.forEach((id, i) => { colors[id] = pal[i % pal.length]; });
  // Openings of the focus elements: letters P, Q, R … (element letters stay A–O), seeded order.
  const openings = [];
  for (const id of focus) for (const o of (byId.get(id).openings || [])) openings.push({ ...o, owner: id });
  shuffle(openings, rand).forEach((o, i) => { labels[o.id] = String.fromCharCode(80 + i); });
  const baseAz = rand() * Math.PI * 2;
  const baseEl = (22 + rand() * 16) * Math.PI / 180;

  // Unique id colours per element for the object-ID pass (exact bytes: linear, no tone mapping, no AA).
  const idColor = new Map(), idOf = new Map();
  scene.elements.forEach((e, i) => {
    const h = (i * 0.618033988749895) % 1;
    const c = new THREE.Color().setHSL(h, 0.85, 0.5);
    let rgb = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    while (rgb.every((v) => v < 8) || idOf.has(rgb.join(","))) rgb = [(rgb[0] + 7) % 256, (rgb[1] + 13) % 256, (rgb[2] + 29) % 256];
    idColor.set(e.id, rgb); idOf.set(rgb.join(","), e.id);
  });

  const fix = job.fix || null;
  const views = job.views || ["A", "B", "C"];
  const out = [];

  // Framing for the pair (and the moved element too when a fix is drawn).
  const frameBox = new THREE.Box3();
  for (const id of focus) frameBox.union(tBox(worldBox(byId.get(id))));
  const phase = (n) => n.startsWith("before") ? "before" : n.startsWith("after") ? "after" : n;
  if (fix && views.some((n) => phase(n) !== n))
    frameBox.union(tBox(worldBox(byId.get(fix.element), [fix.dx || 0, fix.dy || 0, fix.dz || 0])));
  const worldFocusBox = { min: [0, 0, 0], max: [0, 0, 0] };
  {
    const bs = focus.map((id) => worldBox(byId.get(id)));
    worldFocusBox.min = [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.min[i])));
    worldFocusBox.max = [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.max[i])));
  }
  const near = (e) => {           // within CONTEXT_MARGIN of the focus pair's box
    const b = worldBox(e);
    let d2 = 0;
    for (let i = 0; i < 3; i++) { const g = Math.max(0, b.min[i] - worldFocusBox.max[i], worldFocusBox.min[i] - b.max[i]); d2 += g * g; }
    return Math.sqrt(d2) <= CONTEXT_MARGIN;
  };
  const contextIds = scene.elements.filter((e) => !focus.includes(e.id) && near(e)).map((e) => e.id);

  for (const name of views) {
    const ph = phase(name);
    if ((ph === "before" || ph === "after") && !fix) throw new Error(`view ${name} needs a fix`);
    const az = baseAz + (name.endsWith("C") ? Math.PI / 2 : 0);
    const shownContext = name === "B" ? contextIds : (ph === "before" || ph === "after") ? contextIds : [];
    const offsets = {};
    if (ph === "after") offsets[fix.element] = [fix.dx || 0, fix.dy || 0, fix.dz || 0];
    out.push(renderView(r, W, {
      name, style, focus, contextIds: shownContext, byId, labels, colors, idColor, idOf, offsets, az, el: baseEl, frameBox, openings,
      seeThrough: name !== "B", contextOpacity: name === "B" ? CONTEXT_OPACITY : 0.12, grid: name !== "B",
    }));
  }
  return out;
};

function makeMaterials(style, color, opacity, isContext) {
  const transparent = opacity < 1;
  const common = { side: THREE.DoubleSide, transparent, opacity, depthWrite: !transparent,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  let face, edge;
  if (style === "hidden-line") {
    const tint = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), isContext ? 0.85 : 0.7);
    face = new THREE.MeshBasicMaterial({ ...common, color: tint });
    edge = new THREE.LineBasicMaterial({ color: isContext ? "#7b828a" : new THREE.Color(color).multiplyScalar(0.7), transparent, opacity: isContext ? Math.max(opacity, 0.5) : 1 });
  } else if (style === "xray") {
    face = new THREE.MeshStandardMaterial({ ...common, color, metalness: 0, roughness: 1, transparent: true, depthWrite: false,
      opacity: isContext ? 0.1 : 0.3 });
    edge = new THREE.LineBasicMaterial({ color: isContext ? "#8a929b" : color, transparent: true, opacity: isContext ? 0.4 : 1 });
  } else {
    face = new THREE.MeshStandardMaterial({ ...common, color, metalness: 0, roughness: 0.85, flatShading: true });
    edge = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(isContext ? 0.75 : 0.55), transparent: true,
      opacity: isContext ? Math.min(1, opacity * 2.5) : 0.9 });
  }
  return { face, edge };
}

function renderView(r, W, v) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const items = [];   // { id, mesh, edges, transparent, isFocus }
  const add = (id, isFocus) => {
    const e = v.byId.get(id);
    const g = elementGeometry(e);
    const off = v.offsets[id];
    if (off) { const t = w2t(off); g.translate(t.x, t.y, t.z); }
    const color = isFocus ? v.colors[id] : GREY;
    let opacity = isFocus ? (v.seeThrough ? SEE_THROUGH : 1) : v.contextOpacity;
    if (v.style === "xray") opacity = isFocus ? 0.3 : 0.1;
    const m = makeMaterials(v.style, color, opacity, !isFocus);
    const mesh = new THREE.Mesh(g, m.face);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), m.edge);
    mesh.renderOrder = isFocus ? 2 : 1; edges.renderOrder = 3;
    scene.add(mesh, edges);
    const idc = v.idColor.get(id);
    const idMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: new THREE.Color().setRGB(idc[0] / 255, idc[1] / 255, idc[2] / 255, THREE.LinearSRGBColorSpace) });
    items.push({ id, mesh, edges, idMat, faceMat: m.face, transparent: m.face.transparent, isFocus, geometry: g });
  };
  for (const id of v.contextIds) add(id, false);
  for (const id of v.focus) add(id, true);

  // Camera: outside the focus pair's bounding sphere, at a seeded azimuth / elevation.
  const sphere = v.frameBox.getBoundingSphere(new THREE.Sphere());
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 5000);
  const dir = new THREE.Vector3(Math.cos(v.el) * Math.cos(v.az), Math.sin(v.el), Math.cos(v.el) * Math.sin(v.az));
  // Fit: start outside the bounding sphere, then dolly in until the pair's box corners fill ~80% of the frame,
  // never so close that the camera ends up inside a focus element.
  let dist = Math.max(sphere.radius, 0.3) / Math.sin((FOV / 2) * Math.PI / 180) * 1.08;
  const corners = [];
  for (const x of [v.frameBox.min.x, v.frameBox.max.x]) for (const y of [v.frameBox.min.y, v.frameBox.max.y])
    for (const z of [v.frameBox.min.z, v.frameBox.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const focusBoxes = v.focus.map((id) => tBox(worldBox(v.byId.get(id), v.offsets[id] || [0, 0, 0])).expandByScalar(0.15));
  const place = (d) => { cam.position.copy(sphere.center).addScaledVector(dir, d); cam.lookAt(sphere.center); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); };
  for (let i = 0; i < 8; i++) {
    place(dist);
    let m = 0;
    for (const c of corners) { const p = c.clone().project(cam); if (p.z < 1) m = Math.max(m, Math.abs(p.x), Math.abs(p.y)); else m = 9; }
    const next = Math.max(0.5, dist * (m > 5 ? 1.5 : 0.35 + 0.65 * m / 0.88));
    const pos = sphere.center.clone().addScaledVector(dir, next);
    if (focusBoxes.some((b) => b.containsPoint(pos))) break;
    dist = next;
  }
  place(dist);
  cam.near = Math.max(0.02, dist - sphere.radius * 6 - 50); cam.far = dist + sphere.radius * 4 + 200;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  // A context element the camera sits inside would blank the picture: leave it out.
  for (const it of items) if (!it.isFocus) {
    const b = new THREE.Box3().setFromBufferAttribute(it.geometry.attributes.position);
    if (b.containsPoint(cam.position)) { it.mesh.visible = false; it.edges.visible = false; it.skip = true; }
  }

  // Grid (A, C, before, after): 0.5 m lines on the floor just under the pair, faint.
  let grid = null;
  if (v.grid) {
    const span = Math.max(4, Math.ceil(sphere.radius * 4));
    grid = new THREE.GridHelper(span, Math.round(span / 0.5), 0x9fb0c2, 0xb9c6d3);
    grid.material.transparent = true; grid.material.opacity = 0.55; grid.material.depthWrite = false;
    grid.position.set(sphere.center.x, v.frameBox.min.y - 0.002, sphere.center.z);
    grid.renderOrder = 0;
    scene.add(grid);
  }

  // ---- visual pass ----
  r.setRenderTarget(null);
  r.autoClear = true;
  r.render(scene, cam);

  // ---- object-ID passes (no AA, flat colours) ----
  const rt = new THREE.WebGLRenderTarget(W, W, { samples: 0, depthBuffer: true, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const buf = new Uint8Array(W * W * 4);
  const saved = items.map((it) => ({ vis: it.mesh.visible }));
  const bg = scene.background;
  scene.background = null;
  if (grid) grid.visible = false;
  for (const it of items) { it.edges.visible = false; it.mesh.material = it.idMat; }
  r.setClearColor(0x000000, 1);
  r.setRenderTarget(rt);
  const read = () => { r.readRenderTargetPixels(rt, 0, 0, W, W, buf); return buf; };
  const live = items.filter((it) => !it.skip);

  // (1) id image: focus and solid elements as opaque, nearest wins; see-through grey context only fills what is left
  // (a ghost slab in front must not hide the pair in the id image).
  const ghost = (it) => !it.isFocus && it.transparent;
  for (const it of live) it.mesh.visible = !ghost(it);
  r.autoClear = true; r.render(scene, cam);
  const idPixels = read().slice();
  if (live.some(ghost)) {
    for (const it of live) it.mesh.visible = ghost(it);
    r.render(scene, cam);
    const g = read();
    for (let o = 0; o < idPixels.length; o += 4)
      if (idPixels[o] === 0 && idPixels[o + 1] === 0 && idPixels[o + 2] === 0) { idPixels[o] = g[o]; idPixels[o + 1] = g[o + 1]; idPixels[o + 2] = g[o + 2]; }
  }
  // (2) visible pixels: opaque elements by nearest; see-through ones by their own footprint in front of the opaque.
  const opaque = live.filter((it) => !it.transparent), clear = live.filter((it) => it.transparent);
  const counts = {}, sums = {};
  const tally = (pix, onlyId) => {
    for (let p = 0, n = W * W; p < n; p++) {
      const o = p * 4; if (pix[o] === 0 && pix[o + 1] === 0 && pix[o + 2] === 0) continue;
      const id = v.idOf.get(`${pix[o]},${pix[o + 1]},${pix[o + 2]}`);
      if (!id || (onlyId && id !== onlyId)) continue;
      counts[id] = (counts[id] || 0) + 1;
      const x = p % W, y = W - 1 - Math.floor(p / W);
      const s = sums[id] || (sums[id] = { x: 0, y: 0, pts: [] });
      s.x += x; s.y += y; if ((p & 7) === 0) s.pts.push([x, y]);
    }
  };
  for (const it of live) it.mesh.visible = opaque.includes(it);
  r.autoClear = false; r.clear(true, true, true); r.render(scene, cam);
  tally(read(), null);
  for (const c of clear) {   // depth of the opaque ones only, then this element alone against it
    for (const it of live) it.mesh.visible = opaque.includes(it);
    r.clear(true, true, true); if (opaque.length) r.render(scene, cam);
    for (const it of live) it.mesh.visible = it === c;
    r.clear(true, false, false); r.render(scene, cam);
    tally(read(), c.id);
  }
  r.autoClear = true;
  r.setRenderTarget(null);
  scene.background = bg;
  items.forEach((it, i) => { it.mesh.visible = saved[i].vis; it.mesh.material = it.faceMat; });
  rt.dispose();

  const visible_px = {};
  for (const it of items) visible_px[it.id] = counts[it.id] || 0;

  // ---- compose: picture + letters + scale bar ----
  const cv = document.createElement("canvas"); cv.width = W; cv.height = W;
  const ctx = cv.getContext("2d");
  ctx.drawImage(r.domElement, 0, 0);
  const k = W / 1024;
  // opening anchors: the opening's centre on screen (moved with its beam if the fix moves the beam)
  const openAnchors = v.openings.map((o) => {
    const off = v.offsets[o.owner] || [0, 0, 0];
    const c = w2t([0, 1, 2].map((i) => (o.min[i] + o.max[i]) / 2 + off[i])).project(cam);
    return { id: o.id, x: (c.x + 1) / 2 * W, y: (1 - c.y) / 2 * W, inFront: c.z < 1 };
  }).filter((a) => a.inFront && a.x >= 0 && a.x < W && a.y >= 0 && a.y < W);
  drawLabels(ctx, W, k, v, sums, openAnchors);
  // scale at the pair's depth: pixels per metre for a length across the screen at the focus centre
  const depth = sphere.center.clone().applyMatrix4(cam.matrixWorldInverse).z * -1;
  const ppm = (W / 2) / Math.tan((FOV / 2) * Math.PI / 180) / depth;
  drawScaleBar(ctx, W, k, ppm);
  const png = cv.toDataURL("image/png").split(",")[1];

  const idc = document.createElement("canvas"); idc.width = W; idc.height = W;
  const ictx = idc.getContext("2d");
  const img = ictx.createImageData(W, W);
  for (let y = 0; y < W; y++) img.data.set(idPixels.subarray((W - 1 - y) * W * 4, (W - y) * W * 4), y * W * 4);
  for (let p = 3; p < img.data.length; p += 4) img.data[p] = 255;
  ictx.putImageData(img, 0, 0);
  const id_png = idc.toDataURL("image/png").split(",")[1];

  for (const it of items) { it.geometry.dispose(); it.edges.geometry.dispose(); it.faceMat.dispose(); it.edges.material.dispose(); it.idMat.dispose(); }
  if (grid) { grid.geometry.dispose(); grid.material.dispose(); }

  const labels = {}, colors = {};
  for (const id of v.focus) { labels[id] = v.labels[id]; colors[id] = v.colors[id]; }
  for (const o of v.openings) labels[o.id] = v.labels[o.id];
  for (const id of v.contextIds) if (visible_px[id] !== undefined) colors[id] = GREY;
  return { name: v.name, png, id_png, labels, colors, visible_px, focus: v.focus.slice(), px_per_m: ppm };
}

function drawLabels(ctx, W, k, v, sums, openAnchors) {
  // Elements: anchored on the element itself, at its visible pixel nearest the centroid of what shows of it.
  // Openings: anchored at the opening's centre, drawn as a dark square tag (elements get a tag in their colour).
  const tags = [];
  for (const id of v.focus) {
    const pts = sums[id] && sums[id].pts; if (!pts || !pts.length) continue;   // every 8th visible pixel
    const mx = pts.reduce((p, c) => p + c[0], 0) / pts.length, my = pts.reduce((p, c) => p + c[1], 0) / pts.length;
    // nearest the centroid, but clear of anchors already taken (so two leaders never end on the same spot)
    const taken = tags.map((t) => [t.ax, t.ay]), gap = (45 * k) ** 2;
    let best = null, bd = Infinity;
    for (const pass of [true, false]) {
      for (const p of pts) {
        if (pass && taken.some((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < gap)) continue;
        const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p; }
      }
      if (best) break;
    }
    tags.push({ id, ax: best[0], ay: best[1], cx: mx, cy: my, color: v.colors[id], opening: false });
  }
  for (const o of openAnchors) tags.push({ id: o.id, ax: o.x, ay: o.y, cx: o.x, cy: o.y, color: "#1d2228", opening: true });
  if (!tags.length) return;
  const gx = tags.reduce((p, t) => p + t.cx, 0) / tags.length, gy = tags.reduce((p, t) => p + t.cy, 0) / tags.length;
  const box = 46 * k, placed = [];
  tags.forEach((t, i) => {
    // push the tag away from the middle of everything labelled; openings go straight up/down by default
    let dx = t.cx - gx, dy = t.cy - gy; const L = Math.hypot(dx, dy);
    if (t.opening) { dx = 0.35 * Math.sign(dx || 1); dy = -1; }
    else if (L < 1) { dx = i % 2 ? 1 : -1; dy = -0.6; } else { dx /= L; dy /= L; }
    const n = Math.hypot(dx, dy); dx /= n; dy /= n;
    // Try the preferred spot, then spots on rings round the anchor (turning away from the preferred direction
    // a step at a time), until the tag clears every tag already placed.
    const clamp = (x, y) => [Math.min(W - box, Math.max(box, x)), Math.min(W - box * 2.2, Math.max(box, y))];
    const free = ([x, y]) => !placed.some((p) => Math.abs(p[0] - x) < box * 1.5 && Math.abs(p[1] - y) < box * 1.5);
    const a0 = Math.atan2(dy, dx);
    let spot = clamp(t.ax + dx * 95 * k, t.ay + dy * 95 * k);
    search: for (const rad of [95, 140, 190, 250]) for (let s = 0; s < 16; s++) {
      const ang = a0 + (s % 2 ? 1 : -1) * Math.ceil(s / 2) * (Math.PI / 8);
      const c = clamp(t.ax + Math.cos(ang) * rad * k, t.ay + Math.sin(ang) * rad * k);
      if (free(c)) { spot = c; break search; }
    }
    const [lx, ly] = spot;
    placed.push([lx, ly]);
    ctx.save();
    ctx.strokeStyle = "#1d2228"; ctx.lineWidth = 2.5 * k;
    if (t.opening) ctx.setLineDash([6 * k, 4 * k]);
    ctx.beginPath(); ctx.moveTo(t.ax, t.ay); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#1d2228"; ctx.beginPath(); ctx.arc(t.ax, t.ay, 5 * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = t.opening ? "#ffffff" : t.color; ctx.beginPath(); ctx.arc(t.ax, t.ay, 3 * k, 0, Math.PI * 2); ctx.fill();
    const half = box / 2;
    if (t.opening) { ctx.fillStyle = "#1d2228"; roundRect(ctx, lx - half, ly - half, box, box, 2 * k); ctx.fill(); }
    else {   // dark outer ring so the coloured border reads even over its own element
      ctx.fillStyle = "#1d2228"; roundRect(ctx, lx - half - 4 * k, ly - half - 4 * k, box + 8 * k, box + 8 * k, 10 * k); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = t.color; ctx.lineWidth = 5 * k; roundRect(ctx, lx - half, ly - half, box, box, 8 * k); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = t.opening ? "#ffffff" : "#111111"; ctx.font = `bold ${Math.round(32 * k)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(v.labels[t.id], lx, ly + 1 * k);
    ctx.restore();
  });
}

function roundRect(ctx, x, y, w, h, rr) {
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr); ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
}

function drawScaleBar(ctx, W, k, ppm) {
  const choices = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  const target = 200 * k;
  let L = choices[0];
  for (const c of choices) if (Math.abs(c * ppm - target) < Math.abs(L * ppm - target)) L = c;
  const len = L * ppm;
  const x0 = 28 * k, y0 = W - 40 * k;
  const text = L >= 1 ? `${L} m` : `${Math.round(L * 1000)} mm`;
  ctx.save();
  ctx.font = `bold ${Math.round(24 * k)}px Helvetica, Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, x0 - 14 * k, y0 - 46 * k, len + tw + 46 * k, 64 * k, 8 * k); ctx.fill();
  ctx.strokeStyle = "#111111"; ctx.lineWidth = 4 * k; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.stroke();
  ctx.lineWidth = 3 * k;
  for (const t of [0, 0.5, 1]) { const h = t === 0.5 ? 9 : 16; ctx.beginPath(); ctx.moveTo(x0 + len * t, y0 + 2 * k); ctx.lineTo(x0 + len * t, y0 - h * k); ctx.stroke(); }
  ctx.fillStyle = "#111111"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + len + 14 * k, y0 - 12 * k);
  ctx.restore();
}

window.benchReady = true;
