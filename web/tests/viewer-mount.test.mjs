import assert from "node:assert/strict";
import test from "node:test";
import { viewerModule } from "./app-host.mjs";

/** Just enough DOM for moving elements about: children in order, a parent, listeners, a size. */
class El {
  constructor(name, size = {}) {
    Object.assign(this, { name, nodeType: 1, childNodes: [], parentNode: null, listeners: [], className: "", style: {}, clientWidth: 0, clientHeight: 0 }, size);
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(n) { n.remove(); this.childNodes.push(n); n.parentNode = this; return n; }
  insertBefore(n, ref) { n.remove(); this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); n.parentNode = this; return n; }
  replaceChild(n, old) { n.remove(); this.childNodes[this.childNodes.indexOf(old)] = n; n.parentNode = this; old.parentNode = null; return old; }
  remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, opts }); }
}
globalThis.document = { createElement: (tag) => new El(tag), createComment: () => Object.assign(new El("#comment"), { nodeType: 8 }) };

const { Viewer } = await viewerModule();
const names = (el) => el.children.map((n) => n.name);

/** A viewer made on the stage (`main`, 800 × 600) with its canvas, 3D pane, a label and the measure layer, the page's
 * toolbar before them and a chip React added after; `fit` runs for real against a renderer that records its size. */
function staged() {
  const main = new El("main", { clientWidth: 800, clientHeight: 600 });
  main.appendChild(new El("toolbar"));
  const v = Object.create(Viewer.prototype), calls = { observed: [], sized: [], fits: 0, redraws: 0 };
  const size = { x: 0, y: 0 };
  Object.assign(v, { host: main, homeHost: main, owned: [], marks: new Map(), pointerWoken: new WeakSet(),
    renderer: { getSize: (out) => out.set(size.x, size.y), setSize: (w, h) => { size.x = w; size.y = h; calls.sized.push([w, h]); } },
    resize: { observe: (el) => calls.observed.push(el.name), disconnect: () => calls.observed.push("-") },
    canvasStamp: 0, panes: [], maximised: null, layoutPanes() {}, drawFrame() { calls.fits++; }, redraw() { calls.redraws++; } });
  for (const name of ["canvas", "pane3d"]) v.own(new El(name));
  v.label("marker-label");
  main.appendChild(new El("chip"));   // the page's own, between the viewer's
  v.own(new El("measure"));
  v.redrawOnPointer(main);
  return { v, main, calls };
}

test("mountIn moves the viewer's own elements to another place, in order, and leaves the page's children of the stage", () => {
  const { v, main, calls } = staged();
  const right = new El("right", { clientWidth: 500, clientHeight: 400 });
  right.appendChild(new El("review-header"));
  v.mountIn(right);
  assert.deepEqual(names(main), ["toolbar", "chip"], "the toolbar and chip stay on the stage");
  assert.deepEqual(names(right), ["review-header", "canvas", "pane3d", "div", "measure"]);
  assert.equal(v.host, right);
  assert.deepEqual(calls.sized.at(-1), [500, 400], "the canvas takes the new place's size");
  assert.deepEqual(v.rect3d(), { x: 0, y: 0, w: 500, h: 400 }, "the 3D view is sized from the new place");
  assert.deepEqual(calls.observed, ["-", "right"], "the resize observer watches the new place only");
  assert.ok(calls.redraws > 0);
});

test("mountIn(null) puts every element back in its place on the stage, and one made while away at the end", () => {
  const { v, main } = staged();
  const right = new El("right", { clientWidth: 500, clientHeight: 400 });
  v.mountIn(right);
  const later = v.label("edit-label");   // made while away (a label, a drawing pane)
  later.name = "later";
  assert.equal(later.parentNode, right);
  v.mountIn(null);
  assert.deepEqual(names(main), ["toolbar", "canvas", "pane3d", "div", "chip", "measure", "later"]);
  assert.equal(main.childNodes.length, main.children.length, "no marker left behind");
  assert.deepEqual(names(right), []);
  assert.equal(v.host, main);
  assert.deepEqual(v.rect3d(), { x: 0, y: 0, w: 800, h: 600 });
});

test("an element the viewer took out while away does not come back, and leaves no marker", () => {
  const { v, main } = staged();
  const right = new El("right", { clientWidth: 500, clientHeight: 400 });
  v.mountIn(right);
  right.children.find((n) => n.name === "pane3d").remove();   // e.g. a drawing pane a new layout dropped
  v.mountIn(null);
  assert.deepEqual(names(main), ["toolbar", "canvas", "div", "chip", "measure"]);
  assert.equal(main.childNodes.length, main.children.length);
});

test("the same place twice, or null at home, does nothing", () => {
  const { v, main, calls } = staged();
  const before = { ...calls, sized: [...calls.sized], observed: [...calls.observed] };
  v.mountIn(null);
  assert.deepEqual(calls, before, "null at home");
  const right = new El("right", { clientWidth: 500, clientHeight: 400 });
  v.mountIn(right);
  const after = { ...calls, sized: [...calls.sized], observed: [...calls.observed] }, order = names(right);
  v.mountIn(right);
  assert.deepEqual(calls, after, "the same element again");
  assert.deepEqual(names(right), order);
  assert.deepEqual(names(main), ["toolbar", "chip"]);
});

test("a pointer over the new place draws, with its listeners added once", () => {
  const { v, calls } = staged();
  const right = new El("right", { clientWidth: 500, clientHeight: 400 });
  v.mountIn(right);
  v.mountIn(null);
  v.mountIn(right);
  assert.equal(right.listeners.length, 6, "pointer, wheel and touch, once");
  assert.ok(right.listeners.every((l) => l.opts.capture && l.opts.passive));
  const redraws = calls.redraws;
  right.listeners.find((l) => l.type === "pointerdown").fn();
  assert.equal(calls.redraws, redraws + 1);
});
