// Iris Bench renderer, the page side: builds a spec.Scene (server/iris_bench/spec.py) in three.js and renders the
// named views of a focus pair. render.mjs drives it headless (SwiftShader) and calls window.benchRender(job).
//
// World is Z up (metres); three is Y up: a world point (x, y, z) is drawn at (x, z, -y), the viewer's delta rule.
// Every picture is deterministic for a given job: the colours, letters and seeded camera come from job.seed only.
//
// Cameras (spec.Camera): azimuth_deg is measured in the world XY plane from +X (east) towards +Y (north) and says
// where the camera stands relative to the focus (0 = east side looking west, -90 = south side looking north);
// elevation_deg is up from the horizon (90 = straight down). A straight-down (|elevation| >= 89.9) view is a plan:
// north up, east right, whatever the azimuth. "orthographic" views have an exact scale bar everywhere.
//
// Locked elements (Element.locked) are hatched with dashed edges in every view, their letter tag carries a padlock,
// and the scale-bar panel gets a "padlock = fixed" legend whenever a locked element is drawn.
import * as THREE from "three";

const BG = "#dfe6ee";                       // Iris viewer background
const GREY = "#9aa3ad";                     // context elements
// Well-separated hues, so any two picked together read as different (no pink next to purple).
const PALETTE = ["#e6194b", "#1f6fd1", "#2ca02c", "#ff8c00", "#8e44ad", "#00a6a6"];
const FOV = 35;
const SEE_THROUGH = 0.6;                    // focus opacity in A / C / before / after (40% see-through)
const CONTEXT_OPACITY = 0.15;               // grey context in B (85% transparent)
const CONTEXT_MARGIN = 2.5;                 // metres around the focus pair that count as context
const INK = "#1d2228";                      // tags, leaders, badges
const LOCK_GOLD = "#f2b600";                // padlock glyph fill
const PLAN_DEG = 89.9;                      // |elevation| at or above this is a plan (north up)
// Letter pools (server/iris_bench/render.py ELEMENT_LETTERS / OPENING_LETTERS sends the same in job.letters). No E, N
// (the compass), U (its "up"), I or O (1 and 0); openings take what the elements leave from P on, so the two never meet.
const ELEMENT_LETTERS = "ABCDFGHJKLMRST";
const OPENING_LETTERS = "PQVWXYZ";
/** The i-th letter of a pool; past its end the pool repeats with a number (A2, B2, …). */
const letter = (pool, i) => pool[i % pool.length] + (i < pool.length ? "" : String(Math.floor(i / pool.length) + 1));

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

// ---------- views and cameras ----------
const SEEDED = new Set(["A", "B", "C"]);

/** The job's views as objects { name, phase: "now"|"before"|"after", camera, fix, badge, mode }.
 * A string view is "[before_|after_]<camera>" ("before"/"after" alone mean camera A) and takes job.fix; <camera> is a
 * camera of job.cameras (else scene.cameras) by name, or the seeded A / B / C. With no views: one per job camera, else
 * one per scene camera, else A, B, C. An object view is taken as given (camera: a spec.Camera dict, a name or null =
 * seeded A). mode: "pair" (pair see-through, grid), "context" (pair solid + grey context, no grid), "fix" (pair
 * see-through + faint context, grid); by default "fix" for before/after, "context" for camera B, else "pair". */
function resolveViews(job, scene) {
  const jobCams = job.cameras && job.cameras.length ? job.cameras : null;
  const sceneCams = scene.cameras && scene.cameras.length ? scene.cameras : null;
  const cams = jobCams || sceneCams || [];
  const byName = new Map(cams.map((c) => [c.name, c]));
  let names = job.views && job.views.length ? job.views : (jobCams || sceneCams || ["A", "B", "C"].map((n) => ({ name: n })))
    .map((c) => c.name);
  const seen = new Set();
  return names.map((v) => {
    let o;
    if (typeof v === "string") {
      const m = /^(before|after)(?:_(.+))?$/.exec(v);
      o = { name: v, phase: m ? m[1] : "now", camera: m ? (m[2] || "A") : v, fix: m ? (job.fix || null) : null };
      if (m && !o.fix) throw new Error(`view ${v} needs a fix`);
    } else o = { phase: "now", fix: null, ...v };
    if (seen.has(o.name)) throw new Error(`duplicate view name ${o.name}`);
    seen.add(o.name);
    const camName = typeof o.camera === "string" ? o.camera : o.camera ? o.camera.name : "A";
    if (typeof o.camera === "string" || o.camera == null) {
      const c = byName.get(camName);
      if (c) o.camera = c;
      else if (SEEDED.has(camName)) o.camera = { seeded: true, name: camName };
      else throw new Error(`view ${o.name}: unknown camera ${camName}`);
    }
    o.mode = o.mode || (o.phase !== "now" ? "fix" : camName === "B" ? "context" : "pair");
    return o;
  });
}

/** Camera direction (three space, from the target towards the camera), up vector and projection of a view. */
function cameraPose(cam, baseAz, baseEl) {
  if (cam.seeded) {   // the seeded A / B / C camera (C turned 90° round); unchanged maths, so old jobs give old bytes
    const az = baseAz + (cam.name === "C" ? Math.PI / 2 : 0), el = baseEl;
    return { dir: new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)), up: null,
      ortho: false, df: 1 };
  }
  const elDeg = cam.elevation_deg ?? 30, az = (cam.azimuth_deg ?? 45) * Math.PI / 180;
  const el = Math.max(-90, Math.min(90, elDeg)) * Math.PI / 180;
  const dir = w2t([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]).normalize();
  const up = Math.abs(elDeg) >= PLAN_DEG ? w2t([0, 1, 0]) : null;   // plan: north up
  return { dir, up, ortho: (cam.projection || "perspective") === "orthographic", df: cam.distance_factor || 1 };
}

// ---------- the job ----------
/**
 * job = { scene, focus: [ids], views, cameras, style, seed, fix, width, grid }
 * views: see resolveViews (strings like "A", "before_A", "top", or view objects with their own fix and badge).
 * A view in phase "after" draws its fix applied (the element translated); every view of a job shares one framing
 * (the focus plus every fix's moved element), so before / after / candidate pictures compare directly.
 * grid = { name, views: [names] }: a contact sheet of those views (2 x 2 for up to four), with its own id image.
 * Focus elements are lettered from the element pool, their openings from the opening pool (job.letters overrides).
 * returns [{ name, png, id_png, labels, colors, visible_px, focus, px_per_m }] with PNGs as base64 (no data: prefix).
 */
window.benchRender = function benchRender(job) {
  const W = job.width || 1024;
  const r = ensureRenderer(W);
  const style = job.style || "shaded";
  const scene = job.scene;
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  const focus = job.focus.filter((id) => byId.has(id));
  if (focus.length !== job.focus.length) throw new Error(`unknown focus id in ${job.focus}`);
  const views = resolveViews(job, scene);
  for (const v of views) if (v.fix && !byId.has(v.fix.element)) throw new Error(`view ${v.name}: unknown fix element ${v.fix.element}`);
  const rand = rng(job.seed ?? 0);

  // Letters to the focus elements in a seeded order (from the element pool: A, B, C, D, F, …); distinct seeded colours.
  const pools = { elements: (job.letters && job.letters.elements) || ELEMENT_LETTERS,
    openings: (job.letters && job.letters.openings) || OPENING_LETTERS };
  const order = shuffle(focus, rand);
  const labels = {}, colors = {};
  order.forEach((id, i) => { labels[id] = letter(pools.elements, i); });
  const pal = shuffle(PALETTE, rand);
  focus.forEach((id, i) => { colors[id] = pal[i % pal.length]; });
  // Openings of the focus elements: letters from the opening pool (P, Q, V, …), seeded order.
  const openings = [];
  for (const id of focus) for (const o of (byId.get(id).openings || [])) openings.push({ ...o, owner: id });
  shuffle(openings, rand).forEach((o, i) => { labels[o.id] = letter(pools.openings, i); });
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

  const out = [];
  const offOf = (f) => [f.dx || 0, f.dy || 0, f.dz || 0];

  // Framing for the pair (and every moved element too when fixes are drawn).
  const frameBox = new THREE.Box3();
  for (const id of focus) frameBox.union(tBox(worldBox(byId.get(id))));
  for (const v of views) if (v.fix && v.phase !== "now") frameBox.union(tBox(worldBox(byId.get(v.fix.element), offOf(v.fix))));
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
  // context: elements near the pair, plus any element a fix moves (drawn before and after, wherever it is)
  const moved = new Set(views.filter((v) => v.fix && v.phase !== "now").map((v) => v.fix.element));
  const contextIds = scene.elements.filter((e) => !focus.includes(e.id) && (near(e) || moved.has(e.id))).map((e) => e.id);

  const locked = new Set(scene.elements.filter((e) => e.locked).map((e) => e.id));
  for (const view of views) {
    const ctxMode = view.mode === "context";
    const shownContext = view.mode === "pair" ? [] : contextIds;
    const offsets = {};
    if (view.phase === "after" && view.fix) offsets[view.fix.element] = offOf(view.fix);
    out.push(renderView(r, W, {
      name: view.name, style, focus, contextIds: shownContext, byId, labels, colors, idColor, idOf, offsets,
      cam: cameraPose(view.camera, baseAz, baseEl), frameBox, openings, locked, badge: view.badge != null ? String(view.badge) : null,
      compass: job.compass !== false,
      seeThrough: !ctxMode, contextOpacity: ctxMode ? CONTEXT_OPACITY : 0.12, grid: !ctxMode,
    }));
  }
  if (job.grid) out.push(contactSheet(W, job.grid, out));
  for (const o of out) { delete o.canvas; delete o.idImage; }
  return out;
};

/** A contact sheet of some rendered views (the candidates): tiles in reading order, 2 x 2 for up to four, each tile
 * the view's picture scaled to fit (its number badge comes with it). The id image is the tiles' id images sampled
 * nearest-neighbour, laid out the same way. */
function contactSheet(W, grid, rendered) {
  const tiles = grid.views.map((n) => {
    const t = rendered.find((o) => o.name === n);
    if (!t) throw new Error(`grid: no view ${n}`);
    return t;
  });
  const n = tiles.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const k = W / 1024, g = Math.round(10 * k);
  const tile = Math.floor((W - (cols + 1) * g) / cols);
  const H = rows * tile + (rows + 1) * g;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const ids = new Uint8ClampedArray(W * H * 4);
  for (let p = 3; p < ids.length; p += 4) ids[p] = 255;
  const at = (i) => [g + (i % cols) * (tile + g), g + Math.floor(i / cols) * (tile + g)];
  tiles.forEach((t, i) => {
    const [x0, y0] = at(i);
    ctx.drawImage(t.canvas, x0, y0, tile, tile);
    const src = t.idImage.data, S = t.idImage.width;
    for (let y = 0; y < tile; y++) {
      const sy = Math.min(S - 1, Math.floor((y + 0.5) * S / tile));
      for (let x = 0; x < tile; x++) {
        const sx = Math.min(S - 1, Math.floor((x + 0.5) * S / tile));
        const s = (sy * S + sx) * 4, d = ((y0 + y) * W + x0 + x) * 4;
        ids[d] = src[s]; ids[d + 1] = src[s + 1]; ids[d + 2] = src[s + 2];
      }
    }
  });
  // visible_px: per element, the fewest pixels it shows in any one tile (that tile's count scaled to the tile), so the
  // evidence gate on the sheet holds for every candidate in it.
  const visible_px = {}, area = (tile / W) ** 2;
  for (const t of tiles) for (const id of Object.keys(t.visible_px)) visible_px[id] = Infinity;
  for (const id of Object.keys(visible_px)) visible_px[id] = Math.min(...tiles.map((t) => Math.floor((t.visible_px[id] || 0) * area)));
  const idc = document.createElement("canvas"); idc.width = W; idc.height = H;
  idc.getContext("2d").putImageData(new ImageData(ids, W, H), 0, 0);
  const labels = {}, colors = {};
  for (const t of tiles) { Object.assign(labels, t.labels); Object.assign(colors, t.colors); }
  return { name: grid.name || "grid", png: cv.toDataURL("image/png").split(",")[1], id_png: idc.toDataURL("image/png").split(",")[1],
    labels, colors, visible_px, focus: tiles[0].focus.slice(), px_per_m: tiles[0].px_per_m * tile / W };
}

/** Hatching for locked elements: dark diagonal stripes in screen space, the same in every view and style. */
function hatch(material, step) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHatch = { value: step };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uHatch;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n"
        + "  if (mod(gl_FragCoord.x + gl_FragCoord.y, uHatch) < uHatch * 0.4) {\n"
        + "    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.08, 0.09, 0.1), 0.6);\n"
        + "    gl_FragColor.a = max(gl_FragColor.a, 0.8);\n  }");
  };
  material.customProgramCacheKey = () => "iris-hatch";
}

function makeMaterials(style, color, opacity, isContext, lock = null) {
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
  if (lock) {   // locked: hatched faces, dashed dark edges
    hatch(face, lock.step);
    const ec = edge.color.clone().multiplyScalar(0.6);
    const eo = Math.max(edge.opacity, isContext ? 0.6 : 1);
    edge.dispose();
    edge = new THREE.LineDashedMaterial({ color: ec, dashSize: lock.dash, gapSize: lock.dash * 0.6, transparent: eo < 1, opacity: eo });
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

  const sphere = v.frameBox.getBoundingSphere(new THREE.Sphere());
  const k = W / 1024;
  const lock = { step: Math.max(6, Math.round(14 * k)), dash: Math.max(0.03, sphere.radius * 0.05) };
  const items = [];   // { id, mesh, edges, transparent, isFocus }
  const add = (id, isFocus) => {
    const e = v.byId.get(id);
    const g = elementGeometry(e);
    const off = v.offsets[id];
    if (off) { const t = w2t(off); g.translate(t.x, t.y, t.z); }
    const color = isFocus ? v.colors[id] : GREY;
    let opacity = isFocus ? (v.seeThrough ? SEE_THROUGH : 1) : v.contextOpacity;
    if (v.style === "xray") opacity = isFocus ? 0.3 : 0.1;
    const isLocked = v.locked.has(id);
    const m = makeMaterials(v.style, color, opacity, !isFocus, isLocked ? lock : null);
    const mesh = new THREE.Mesh(g, m.face);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), m.edge);
    if (isLocked) edges.computeLineDistances();
    mesh.renderOrder = isFocus ? 2 : 1; edges.renderOrder = 3;
    scene.add(mesh, edges);
    const idc = v.idColor.get(id);
    const idMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, color: new THREE.Color().setRGB(idc[0] / 255, idc[1] / 255, idc[2] / 255, THREE.LinearSRGBColorSpace) });
    items.push({ id, mesh, edges, idMat, faceMat: m.face, transparent: m.face.transparent, isFocus, geometry: g, locked: isLocked });
  };
  for (const id of v.contextIds) add(id, false);
  for (const id of v.focus) add(id, true);

  // Camera: outside the focus pair's bounding sphere, along the view's direction (seeded or a spec.Camera).
  const dir = v.cam.dir;
  const corners = [];
  for (const x of [v.frameBox.min.x, v.frameBox.max.x]) for (const y of [v.frameBox.min.y, v.frameBox.max.y])
    for (const z of [v.frameBox.min.z, v.frameBox.max.z]) corners.push(new THREE.Vector3(x, y, z));
  let cam, ppm;
  if (!v.cam.ortho) {
    cam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 5000);
    if (v.cam.up) cam.up.copy(v.cam.up);
    // Fit: start outside the bounding sphere, then dolly in until the pair's box corners fill ~80% of the frame,
    // never so close that the camera ends up inside a focus element.
    let dist = Math.max(sphere.radius, 0.3) / Math.sin((FOV / 2) * Math.PI / 180) * 1.08;
    const focusBoxes = v.focus.map((id) => tBox(worldBox(v.byId.get(id), v.offsets[id] || [0, 0, 0])).expandByScalar(0.15));
    const place = (d) => { cam.position.copy(sphere.center).addScaledVector(dir, d); cam.lookAt(sphere.center); cam.updateMatrixWorld(); cam.updateProjectionMatrix(); };
    const inside = (d) => { const pos = sphere.center.clone().addScaledVector(dir, d); return focusBoxes.some((b) => b.containsPoint(pos)); };
    for (let i = 0; i < 8; i++) {
      place(dist);
      let m = 0;
      for (const c of corners) { const p = c.clone().project(cam); if (p.z < 1) m = Math.max(m, Math.abs(p.x), Math.abs(p.y)); else m = 9; }
      const next = Math.max(0.5, dist * (m > 5 ? 1.5 : 0.35 + 0.65 * m / 0.88));
      if (inside(next)) break;
      dist = next;
    }
    if (v.cam.df !== 1 && !inside(dist * v.cam.df)) dist *= v.cam.df;
    place(dist);
    cam.near = Math.max(0.02, dist - sphere.radius * 6 - 50); cam.far = dist + sphere.radius * 4 + 200;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // scale at the pair's depth: pixels per metre for a length across the screen at the focus centre
    const depth = sphere.center.clone().applyMatrix4(cam.matrixWorldInverse).z * -1;
    ppm = (W / 2) / Math.tan((FOV / 2) * Math.PI / 180) / depth;
  } else {
    // Orthographic: stand beyond everything drawn, frame the pair's box corners to ~88% of the half-width; one
    // metre is the same number of pixels everywhere, so the scale bar is exact.
    const all = new THREE.Box3();
    for (const it of items) { it.geometry.computeBoundingBox(); all.union(it.geometry.boundingBox); }
    all.union(v.frameBox);
    const allS = all.getBoundingSphere(new THREE.Sphere());
    const D = sphere.center.distanceTo(allS.center) + allS.radius + 1;
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2 * D + 1);
    if (v.cam.up) cam.up.copy(v.cam.up);
    cam.position.copy(sphere.center).addScaledVector(dir, D); cam.lookAt(sphere.center); cam.updateMatrixWorld();
    let half = 0.3;
    for (const c of corners) { const p = c.clone().applyMatrix4(cam.matrixWorldInverse); half = Math.max(half, Math.abs(p.x), Math.abs(p.y)); }
    half = half / 0.88 * v.cam.df;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    ppm = (W / 2) / half;
  }
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

  // ---- compose: picture + letters + scale bar (+ lock legend) + compass + candidate badge ----
  const cv = document.createElement("canvas"); cv.width = W; cv.height = W;
  const ctx = cv.getContext("2d");
  ctx.drawImage(r.domElement, 0, 0);
  // opening anchors: the opening's centre on screen (moved with its beam if the fix moves the beam)
  const openAnchors = v.openings.map((o) => {
    const off = v.offsets[o.owner] || [0, 0, 0];
    const c = w2t([0, 1, 2].map((i) => (o.min[i] + o.max[i]) / 2 + off[i])).project(cam);
    return { id: o.id, x: (c.x + 1) / 2 * W, y: (1 - c.y) / 2 * W, inFront: c.z < 1 };
  }).filter((a) => a.inFront && a.x >= 0 && a.x < W && a.y >= 0 && a.y < W);
  // Fixed corners: candidate badge top-left, compass top-right, scale bar (and lock legend) bottom-left. Letter tags
  // keep clear of all of them.
  const legend = items.some((it) => it.locked && !it.skip);
  const scale = scaleLayout(ctx, W, k, ppm, legend);
  const compass = v.compass ? compassLayout(W, k, cam) : null;
  const badge = v.badge ? badgeLayout(k) : null;
  const reserved = [legend ? scale.rect : null, compass && compass.rect, badge && badge.rect].filter(Boolean);
  drawLabels(ctx, W, k, v, sums, openAnchors, reserved);
  drawScaleBar(ctx, k, scale);
  if (compass) drawCompass(ctx, k, compass);
  if (badge) drawBadge(ctx, k, badge, v.badge);
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
  // canvas / idImage are for the contact sheet only; benchRender drops them before returning
  return { name: v.name, png, id_png, labels, colors, visible_px, focus: v.focus.slice(), px_per_m: ppm, canvas: cv, idImage: img };
}

function drawLabels(ctx, W, k, v, sums, openAnchors, reserved = []) {
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
    const R = box / 2 + 16 * k;   // a tag with its ring and padlock
    const free = ([x, y]) => !placed.some((p) => Math.abs(p[0] - x) < box * 1.5 && Math.abs(p[1] - y) < box * 1.5)
      && !reserved.some((q) => x + R > q.x0 && x - R < q.x1 && y + R > q.y0 && y - R < q.y1);
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
    // a locked element's tag carries a padlock on its top-right corner
    if (!t.opening && v.locked.has(t.id)) drawPadlock(ctx, lx + half + 3 * k, ly - half - 3 * k, 18 * k);
  });
}

/** A padlock glyph (drawn, not text) centred at (cx, cy); s is the body width. Gold body, steel shackle, dark rim. */
function drawPadlock(ctx, cx, cy, s) {
  const bw = s, bh = 0.8 * s, sr = 0.3 * s, sw = Math.max(1.5, 0.17 * s), o = Math.max(1.2, 0.1 * s);
  const H = sw / 2 + sr + 0.35 * s + bh, top = cy - H / 2;
  const ay = top + sw / 2 + sr, by = ay + 0.35 * s;
  const shackle = () => { ctx.beginPath(); ctx.moveTo(cx - sr, by + 1); ctx.lineTo(cx - sr, ay); ctx.arc(cx, ay, sr, Math.PI, 0); ctx.lineTo(cx + sr, by + 1); };
  ctx.save();
  ctx.lineCap = "butt"; ctx.lineJoin = "round";
  shackle(); ctx.strokeStyle = INK; ctx.lineWidth = sw + 2 * o; ctx.stroke();
  roundRect(ctx, cx - bw / 2 - o, by - o, bw + 2 * o, bh + 2 * o, 0.18 * s + o); ctx.fillStyle = INK; ctx.fill();
  shackle(); ctx.strokeStyle = "#c9ced4"; ctx.lineWidth = sw; ctx.stroke();
  roundRect(ctx, cx - bw / 2, by, bw, bh, 0.18 * s); ctx.fillStyle = LOCK_GOLD; ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(cx, by + bh * 0.42, bw * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - bw * 0.055, by + bh * 0.42, bw * 0.11, bh * 0.34);
  ctx.restore();
}

/** Diagonal stripes like the locked-element hatch, clipped to a square. */
function hatchSwatch(ctx, x, y, s, k) {
  ctx.save();
  ctx.fillStyle = "#b8c0c8"; ctx.fillRect(x, y, s, s);
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  ctx.strokeStyle = "#2a2f35"; ctx.lineWidth = 3.5 * k;
  const step = 9 * k;
  for (let d = -s; d < 2 * s; d += step) { ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + s, y + s); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2 * k; ctx.setLineDash([5 * k, 3 * k]); ctx.strokeRect(x, y, s, s); ctx.restore();
}

function badgeLayout(k) {
  const x = 16 * k, y = 16 * k, s = 96 * k;
  return { x, y, s, rect: { x0: 0, y0: 0, x1: x + s + 10 * k, y1: y + s + 10 * k } };
}

/** The candidate number, big, in the top-left corner. */
function drawBadge(ctx, k, b, text) {
  ctx.save();
  ctx.fillStyle = "#ffffff"; roundRect(ctx, b.x - 4 * k, b.y - 4 * k, b.s + 8 * k, b.s + 8 * k, 16 * k); ctx.fill();
  ctx.fillStyle = INK; roundRect(ctx, b.x, b.y, b.s, b.s, 12 * k); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round((text.length > 1 ? 52 : 68) * k)}px Helvetica, Arial, sans-serif`;
  ctx.fillText(text, b.x + b.s / 2, b.y + b.s / 2 + 3 * k);
  ctx.restore();
}

/** Compass panel in the top-right corner: world +Y (N), +X (E) and +Z (up) as seen by this camera. An axis that
 * points mostly into or out of the picture (under 30% of its length on screen) is left out, so a plan shows N and E,
 * a section the two in its plane. The arrows are the projected axis directions at the picture centre, foreshortening
 * included. */
function compassLayout(W, k, cam) {
  const S = 140 * k, x = W - 16 * k - S, y = 16 * k;
  const axes = [["N", [0, 1, 0]], ["E", [1, 0, 0]], ["up", [0, 0, 1]]].map(([name, a]) => {
    const d = w2t(a).transformDirection(cam.matrixWorldInverse);
    return { name, x: d.x, y: -d.y, f: Math.hypot(d.x, d.y), z: d.z };
  }).filter((a) => a.f >= 0.3);
  return { x, y, S, cx: x + S / 2, cy: y + S / 2, axes, rect: { x0: x - 10 * k, y0: 0, x1: W, y1: y + S + 10 * k } };
}

function drawCompass(ctx, k, c) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)"; roundRect(ctx, c.x, c.y, c.S, c.S, 8 * k); ctx.fill();
  const L = 40 * k;
  // label radius per axis: just past the tip; a label that crowds another moves out along its own arrow
  const ax = c.axes.map((a) => ({ ...a, ux: a.x / a.f, uy: a.y / a.f, len: L * a.f, lr: Math.max(L * a.f, 26 * k) + 16 * k }));
  for (let pass = 0; pass < 8; pass++) for (const a of ax) for (const b of ax) {
    if (a === b || a.len > b.len || (a.len === b.len && a.name > b.name)) continue;
    if (Math.hypot(a.ux * a.lr - b.ux * b.lr, a.uy * a.lr - b.uy * b.lr) < 30 * k) a.lr = Math.min(a.lr + 6 * k, 60 * k);
  }
  // far-pointing axes first, so the nearer arrow is drawn on top
  for (const a of ax.sort((p, q) => p.z - q.z)) {
    const { ux, uy, len, lr } = a, head = Math.min(11 * k, len * 0.45);
    const tx = c.cx + ux * len, ty = c.cy + uy * len;
    ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = (a.name === "N" ? 4 : 3) * k; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(c.cx, c.cy); ctx.lineTo(tx - ux * head * 0.6, ty - uy * head * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ux * head - uy * head * 0.5, ty - uy * head + ux * head * 0.5);
    ctx.lineTo(tx - ux * head + uy * head * 0.5, ty - uy * head - ux * head * 0.5); ctx.closePath(); ctx.fill();
    ctx.font = `bold ${Math.round((a.name === "up" ? 19 : 22) * k)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(a.name, c.cx + ux * lr, c.cy + uy * lr);
  }
  ctx.beginPath(); ctx.arc(c.cx, c.cy, 4 * k, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, rr) {
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr); ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
}

/** Where the scale bar goes (bottom-left) and how long: a round length near 200 px at the pair's depth. With
 * legend, the panel grows a row above the bar: a hatched swatch with a padlock, and the word "fixed". */
function scaleLayout(ctx, W, k, ppm, legend) {
  const choices = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  const target = 200 * k;
  let L = choices[0];
  for (const c of choices) if (Math.abs(c * ppm - target) < Math.abs(L * ppm - target)) L = c;
  const len = L * ppm;
  const x0 = 28 * k, y0 = W - 40 * k;
  const text = L >= 1 ? `${L} m` : `${Math.round(L * 1000)} mm`;
  ctx.save();
  ctx.font = `bold ${Math.round(24 * k)}px Helvetica, Arial, sans-serif`;
  const tw = ctx.measureText(text).width, fw = ctx.measureText("fixed").width;
  ctx.restore();
  const p = { x: x0 - 14 * k, y: y0 - 46 * k, w: len + tw + 46 * k, h: 64 * k };
  if (legend) { p.w = Math.max(p.w, 76 * k + fw); p.y -= 44 * k; p.h += 44 * k; }
  return { len, x0, y0, text, legend, panel: p, rect: { x0: 0, y0: p.y - 10 * k, x1: p.x + p.w + 10 * k, y1: W } };
}

function drawScaleBar(ctx, k, s) {
  const { len, x0, y0, text, panel: p } = s;
  ctx.save();
  ctx.font = `bold ${Math.round(24 * k)}px Helvetica, Arial, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, p.x, p.y, p.w, p.h, 8 * k); ctx.fill();
  ctx.strokeStyle = "#111111"; ctx.lineWidth = 4 * k; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.stroke();
  ctx.lineWidth = 3 * k;
  for (const t of [0, 0.5, 1]) { const h = t === 0.5 ? 9 : 16; ctx.beginPath(); ctx.moveTo(x0 + len * t, y0 + 2 * k); ctx.lineTo(x0 + len * t, y0 - h * k); ctx.stroke(); }
  ctx.fillStyle = "#111111"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, x0 + len + 14 * k, y0 - 12 * k);
  ctx.restore();
  if (s.legend) {   // [hatched swatch + padlock] fixed
    const sy = y0 - 80 * k, sz = 28 * k;
    hatchSwatch(ctx, x0, sy, sz, k);
    drawPadlock(ctx, x0 + sz + 1 * k, sy + 2 * k, 15 * k);
    ctx.save();
    ctx.font = `bold ${Math.round(24 * k)}px Helvetica, Arial, sans-serif`;
    ctx.fillStyle = "#111111"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("fixed", x0 + sz + 20 * k, sy + sz / 2 + 1 * k);
    ctx.restore();
  }
}

window.benchReady = true;
