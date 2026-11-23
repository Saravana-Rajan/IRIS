import assert from "node:assert/strict";
import test from "node:test";
import { compiled, viewerModule } from "./app-host.mjs";

const { webglAvailable, NoWebGL } = await import(await compiled("../src/webgl.ts"));

/** A page whose canvases answer `getContext(kind)` with `answer(kind)`; what was asked, and what was given back. */
function page(answer) {
  const asked = [], lost = [];
  const canvas = () => ({ style: {}, getContext(kind) { asked.push(kind); return answer(kind, lost); }, addEventListener() {}, removeEventListener() {} });
  return { asked, lost, document: { createElement: canvas, createElementNS: canvas } };
}
const context = (kind, lost) => ({ kind, getExtension: (name) => (name === "WEBGL_lose_context" ? { loseContext: () => lost.push(kind) } : null) });

function withDocument(document, run) {
  const had = "document" in globalThis, old = globalThis.document;
  globalThis.document = document;
  try { return run(); } finally { if (had) globalThis.document = old; else delete globalThis.document; }
}

test("no page at all (node): WebGL counts as there, so the check never stands in a test's way", () => {
  assert.equal("document" in globalThis, false);
  assert.equal(webglAvailable(), true);
});

test("a canvas with no WebGL context (turned off, blocklisted): not available, after asking for 2 then 1", () => {
  const p = page(() => null);
  assert.equal(withDocument(p.document, webglAvailable), false);
  assert.deepEqual(p.asked, ["webgl2", "webgl"]);
});

test("a canvas that throws on getContext, or a page that throws making one: not available, and nothing thrown", () => {
  const p = page(() => { throw new Error("Error creating WebGL context"); });
  assert.equal(withDocument(p.document, webglAvailable), false);
  assert.equal(withDocument({ createElement() { throw new Error("no canvas"); } }, webglAvailable), false);
  assert.equal(withDocument({ createElement: () => ({}) }, webglAvailable), false, "a canvas with no getContext at all");
});

test("WebGL 2, or WebGL 1 where there is no 2: available, and the probe's context is given back at once", () => {
  const two = page(context);
  assert.equal(withDocument(two.document, webglAvailable), true);
  assert.deepEqual(two.asked, ["webgl2"], "WebGL 2 answers: WebGL 1 is never asked");
  assert.deepEqual(two.lost, ["webgl2"]);
  const one = page((kind, lost) => (kind === "webgl" ? context(kind, lost) : null));
  assert.equal(withDocument(one.document, webglAvailable), true);
  assert.deepEqual(one.lost, ["webgl"]);
  const bare = page(() => ({}));
  assert.equal(withDocument(bare.document, webglAvailable), true, "a context without getExtension still counts");
});

test("NoWebGL says why and keeps three's own error as its cause", () => {
  const cause = new Error("Error creating WebGL context.");
  const e = new NoWebGL(cause);
  assert.ok(e instanceof Error);
  assert.equal(e.name, "NoWebGL");
  assert.match(e.message, /WebGL/);
  assert.equal(e.cause, cause);
});

const { Viewer } = await viewerModule();
// The viewer's fields (made before its constructor runs) watch the stage's size: a browser has this, node does not.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
const stage =() => ({ children: [], appendChild(n) { this.children.push(n); return n; }, addEventListener() {} });

test("the viewer, with no WebGL, throws NoWebGL before it makes anything, so the page can say so instead", () => {
  const p = page(() => null), host = stage();
  const thrown = withDocument(p.document, () => assert.throws(() => new Viewer(host), (e) => e.name === "NoWebGL"));
  assert.equal(thrown, undefined);
  assert.deepEqual(host.children, [], "nothing put on the stage");
});

test("the viewer turns three's own failure to make a context into NoWebGL too", () => {
  // The probe gets a context; three's renderer then gets none (as when the browser refuses a second one).
  let probes = 0;
  const p = page((kind, lost) => (probes++ === 0 ? context(kind, lost) : null)), host = stage();
  withDocument(p.document, () => assert.throws(() => new Viewer(host), (e) => e.name === "NoWebGL" && /Error creating WebGL context/.test(e.cause?.message)));
  assert.deepEqual(host.children, []);
});
