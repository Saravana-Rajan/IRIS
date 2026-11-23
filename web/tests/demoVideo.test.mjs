import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { find } from "./app-host.mjs";

/** The demo videos (DemoVideo.tsx): the list, the light lightbox (lazy, captions on, a modal dialog with a focus trap,
 * Escape and the scrim close it, focus goes back) and the Watch button that opens it. Static markup with React itself;
 * the behaviour with a React stand-in (hooks in call order, effects with their cleanups) over a stand-in document. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const CSS = /^import "\.\/demoVideo\.css";$/m;
/** DemoVideo.tsx compiled for Node with its stylesheet left out (Vite bundles it), its imports from `deps`. */
async function load(deps) {
  const src = await readFile(new URL("../src/DemoVideo.tsx", import.meta.url), "utf8");
  assert.match(src, CSS, "DemoVideo.tsx brings its own stylesheet");
  let { outputText } = ts.transpileModule(src.replace(CSS, ""), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return import(url(outputText));
}
const jsx = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") };
/** With React itself, for static markup (no document: the dialog renders in place, not in a portal). */
const V = await load({ ...jsx, react: import.meta.resolve("react"), "react-dom": import.meta.resolve("react-dom"),
  "lucide-react": import.meta.resolve("lucide-react") });
/** With the stand-ins: hooks from `globalThis.__dvHooks`, a portal that records where it went, icons that draw nothing. */
const S = await load({ ...jsx,
  react: url(`const h = () => globalThis.__dvHooks;
    export const useState = (...a) => h().useState(...a), useRef = (...a) => h().useRef(...a), useEffect = (...a) => h().useEffect(...a),
      useId = () => "dv-title";`),
  "react-dom": url("export const createPortal = (node, into) => { globalThis.__dvPortal = into; return node; };"),
  "lucide-react": url("export function Play(){return null;} export function X(){return null;}") });

const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walk(node, fn) {
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return; }
  if (!node || typeof node !== "object" || !node.props) return;
  fn(node);
  walk(node.props.children, fn);
}
/** `Component` run with the stand-in hooks; `ref(element)` gives each element with a ref its stand-in node, as React's
 * commit would, before the effects run. */
function mount(Component, props, ref = () => ({})) {
  const cells = [];
  let cursor = 0, pending = [], dirty = false, tree;
  const hooks = {
    useState(init) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = { v: typeof init === "function" ? init() : init };
      const c = cells[i];
      return [c.v, (n) => { const next = typeof n === "function" ? n(c.v) : n; if (!Object.is(next, c.v)) { c.v = next; dirty = true; } }];
    },
    useRef(init) { const i = cursor++; return (cells[i] ??= { current: init }); },
    useEffect(effect, deps) {
      const i = cursor++, old = cells[i];
      if (old && deps && deps.every((d, k) => Object.is(d, old.deps?.[k]))) return;
      const cell = (cells[i] = { deps, cleanup: old?.cleanup });
      pending.push(() => { cell.cleanup?.(); const c = effect(); cell.cleanup = typeof c === "function" ? c : undefined; });
    },
  };
  const host = {
    props,
    render(next) {
      if (next) host.props = { ...host.props, ...next };
      let passes = 0;
      do {
        dirty = false; cursor = 0; pending = []; globalThis.__dvHooks = hooks;
        tree = Component(host.props);
        walk(tree, (n) => { const r = n.props.ref; if (r && typeof r === "object" && "current" in r) r.current = ref(n); });
        for (const fn of pending) fn();
        if (++passes > 30) throw new Error("render loop");
      } while (dirty);
      return tree;
    },
    get tree() { return tree; },
    find: (p) => find(tree, p),
    unmount() { for (const c of cells) c?.cleanup?.(); },
  };
  host.render();
  return host;
}

/** A document as the dialog uses it (its keydown listeners, the body's style, the focused element), set as
 * `globalThis.document` while `fn` runs; and the dialog's stand-in nodes: the card, Close and the video. */
async function withPage(fn) {
  const keys = new Set();
  const doc = { activeElement: null, body: null,
    addEventListener(type, f) { if (type === "keydown") keys.add(f); },
    removeEventListener(type, f) { if (type === "keydown") keys.delete(f); } };
  const node = (name, extra = {}) => ({ name, isConnected: true, focus() { doc.activeElement = this; }, ...extra });
  doc.body = node("body", { style: { overflow: "scroll" } });
  doc.activeElement = doc.body;
  const press = (key, more = {}) => {
    const e = { key, shiftKey: false, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, ...more };
    for (const f of [...keys]) f(e);
    return e;
  };
  const track = { mode: "disabled" }, played = [];
  const close = node("close");
  // A refused play() (the browser's autoplay rule) must be caught: the controls are there
  const video = node("video", { textTracks: [track], play() { played.push(1); return Promise.reject(new Error("NotAllowedError")); } });
  const card = node("card", { querySelectorAll: () => [close, video], contains: (x) => x === card || x === close || x === video });
  const dialog = node("dialog", { open: false, shown: 0, showModal() { this.open = true; this.shown++; }, close() { this.open = false; } });
  const ref = (n) => n.type === "video" ? video : n.type === "dialog" ? dialog : n.props.className === "demo-video-card" ? card
    : n.props.className === "demo-video-close" ? close : node(n.props.className ?? n.type);
  globalThis.document = doc;
  try { await fn({ doc, node, press, keys, track, played, close, video, card, dialog, ref }); }
  finally { delete globalThis.document; delete globalThis.__dvPortal; }
}

test("three demo videos, each an mp4 with English captions and a poster in /demos/, a title and its length", () => {
  assert.deepEqual(Object.keys(V.DEMO_VIDEOS), ["3d", "2d", "full"]);
  assert.deepEqual(Object.values(V.DEMO_VIDEOS).map((v) => v.title),
    ["Fix clashes in your building models", "Check drawings against the model", "Iris: does AI truly see?"]);
  for (const [id, v] of Object.entries(V.DEMO_VIDEOS)) {
    assert.equal(v.id, id);
    assert.deepEqual([v.src, v.vtt, v.poster], [`/demos/iris-${id}-demo.mp4?v=20261123b`, `/demos/iris-${id}-demo.vtt?v=20261123b`, `/demos/iris-${id}-demo.webp?v=20261123b`]);
    assert.match(v.duration, /^\d{1,2}:[0-5]\d$/, `${id}: m:ss`);
  }
});

test("closed, nothing renders: no video, no poster, no listener, the page still scrolls (lazy)", async () => {
  assert.equal(renderToStaticMarkup(h(V.DemoVideo, { id: "3d", open: false, onClose: noop })), "");
  for (const id of ["3d", "2d", "full"])
    assert.doesNotMatch(renderToStaticMarkup(h(V.WatchDemoButton, { id })), /<video|\.mp4|\.webp|\.vtt/, `${id}: only the button`);
  await withPage(async (p) => {
    const host = mount(S.DemoVideo, { id: "3d", open: false, onClose: noop }, p.ref);
    assert.equal(host.tree, null);
    assert.equal(p.keys.size, 0);
    assert.equal(p.doc.body.style.overflow, "scroll");
    assert.equal(p.played.length, 0);
  });
});

test("open: a modal dialog named by its title, Close, then the 16:9 video with its poster, captions in English by default", () => {
  const html = renderToStaticMarkup(h(V.DemoVideo, { id: "2d", open: true, onClose: noop }));
  const scrim = html.match(/^<dialog class="demo-video" data-video="2d"[^>]*>/)?.[0];
  assert.ok(scrim, "a <dialog>, itself the scrim");
  assert.match(scrim, /role="dialog"/);
  assert.match(scrim, /aria-modal="true"/);
  assert.match(html, /<div class="demo-video-card" tabindex="-1">/i);
  const named = scrim.match(/aria-labelledby="([^"]+)"/)[1];
  assert.match(html, new RegExp(`<h2 class="demo-video-title" id="${escape(named)}">Check drawings against the model</h2>`));
  assert.match(html, /<button type="button" class="demo-video-close" aria-label="Close">/);
  const video = html.match(/<video[^>]*>/)?.[0];
  assert.ok(video, "the video, once open");
  for (const attr of ['src="/demos/iris-2d-demo.mp4?v=20261123b"', 'poster="/demos/iris-2d-demo.webp?v=20261123b"', 'controls=""', 'playsInline=""', 'preload="none"'])
    assert.ok(video.includes(attr), attr);
  assert.match(html, /<video[^>]*><track kind="captions" src="\/demos\/iris-2d-demo\.vtt\?v=20261123b" srcLang="en" label="English" default=""\/><\/video>/);
  assert.ok(html.indexOf("demo-video-title") < html.indexOf("<video"), "the title above the video");
  assert.doesNotMatch(html, /couldn/, "no error before one");
});

test("opening: portalled to the body, the page stops scrolling, focus on Close, captions showing, the video plays; closing undoes it", async () => {
  await withPage(async (p) => {
    const opener = { current: p.node("opener") };
    const host = mount(S.DemoVideo, { id: "full", open: false, onClose: noop, opener }, p.ref);
    assert.equal(p.dialog.shown, 0, "closed: never shown");
    host.render({ open: true });
    assert.equal(globalThis.__dvPortal, p.doc.body, "into the body, out of Home's container");
    assert.deepEqual([p.dialog.open, p.dialog.shown], [true, 1], "shown as a modal (the page behind inert, the dialog in the top layer)");
    assert.equal(p.doc.body.style.overflow, "hidden");
    assert.equal(p.doc.activeElement, p.close, "focus moves into the dialog");
    assert.equal(p.track.mode, "showing", "captions on, whatever the browser made of `default`");
    assert.equal(p.played.length, 1, "it plays");
    await new Promise((r) => setImmediate(r));   // the refused play() was caught (no unhandled rejection)
    p.track.mode = "disabled";
    host.find((n) => n.type === "video").props.onLoadedMetadata({ currentTarget: p.video });
    assert.equal(p.track.mode, "showing", "and again once the video's data loads");
    host.render({ open: false });
    assert.equal(host.tree, null);
    assert.equal(p.dialog.open, false, "the modal closed");
    assert.equal(p.doc.body.style.overflow, "scroll", "the page's own overflow back");
    assert.equal(p.doc.activeElement, opener.current, "focus back on the opener");
    assert.equal(p.keys.size, 0, "its key listener gone");
  });
  await withPage(async (p) => {
    const before = p.node("was-focused");
    p.doc.activeElement = before;
    const host = mount(S.DemoVideo, { id: "3d", open: true, onClose: noop }, p.ref);
    assert.equal(p.doc.activeElement, p.close);
    host.render({ open: false });
    assert.equal(p.doc.activeElement, before, "no opener given: back to what had focus");
  });
});

test("Escape closes it, before App's own Escape (stopped there); other keys don't", async () => {
  await withPage(async (p) => {
    let closed = 0;
    const host = mount(S.DemoVideo, { id: "3d", open: true, onClose: () => closed++ }, p.ref);
    const esc = p.press("Escape");
    assert.equal(closed, 1);
    assert.equal(esc.prevented, 1);
    assert.equal(esc.stopped, 1);
    p.press("Enter"); p.press(" ");
    assert.equal(closed, 1);
    // With focus inside the video's own controls Chrome sends no key event, only the dialog's close request
    let kept = 0;
    host.tree.props.onCancel({ preventDefault() { kept++; } });
    assert.equal(closed, 2, "the dialog's cancel closes it too");
    assert.equal(kept, 1, "through onClose, not the browser's own close");
  });
});

test("the focus trap: past the end back to Close, before the start to the video, focus outside brought back in", async () => {
  await withPage(async (p) => {
    const host = mount(S.DemoVideo, { id: "3d", open: true, onClose: noop }, p.ref);
    const [start, card, end] = host.tree.props.children;
    assert.deepEqual([start.props["data-guard"], card.props.className, end.props["data-guard"]], ["start", "demo-video-card", "end"],
      "a guard either side of the card");
    assert.deepEqual([start.props.tabIndex, card.props.tabIndex, end.props.tabIndex], [0, -1, 0]);
    end.props.onFocus({ relatedTarget: p.video });   // Tab from the video's last control
    assert.equal(p.doc.activeElement, p.close, "wraps to the first");
    start.props.onFocus({ relatedTarget: p.close });   // Shift+Tab from Close
    assert.equal(p.doc.activeElement, p.video, "wraps to the last");
    start.props.onFocus({ relatedTarget: null });   // the dialog's first focus, or Tab in from the browser's bar
    assert.equal(p.doc.activeElement, p.close, "enters at the start");
    end.props.onFocus({ relatedTarget: null });   // Shift+Tab in from the browser's bar
    assert.equal(p.doc.activeElement, p.video, "enters at the end");
    p.doc.activeElement = p.close;
    assert.equal(p.press("Tab").prevented, 0, "inside, the browser moves focus itself (the video's controls too)");
    p.doc.activeElement = p.doc.body;   // a click on the page behind
    assert.equal(p.press("Tab").prevented, 1);
    assert.equal(p.doc.activeElement, p.close);
    p.doc.activeElement = p.doc.body;
    p.press("Tab", { shiftKey: true });
    assert.equal(p.doc.activeElement, p.video);
  });
});

test("a click on the scrim closes it; Close too; a click in the card or a drag that ends on the scrim doesn't", async () => {
  await withPage(async (p) => {
    let closed = 0;
    const host = mount(S.DemoVideo, { id: "3d", open: true, onClose: () => closed++ }, p.ref);
    const scrim = host.tree, self = {}, inCard = {};
    scrim.props.onPointerDown({ target: inCard, currentTarget: self }); scrim.props.onClick({ target: inCard, currentTarget: self });
    assert.equal(closed, 0, "in the card");
    scrim.props.onPointerDown({ target: inCard, currentTarget: self }); scrim.props.onClick({ target: self, currentTarget: self });
    assert.equal(closed, 0, "pressed in the card, let go on the scrim");
    scrim.props.onPointerDown({ target: self, currentTarget: self }); scrim.props.onClick({ target: self, currentTarget: self });
    assert.equal(closed, 1, "on the scrim");
    host.find((n) => n.props?.className === "demo-video-close").props.onClick();
    assert.equal(closed, 2, "Close");
  });
});

test("a video that can't load says so in the dialog (its captions failing doesn't); opening again tries again", async () => {
  await withPage(async (p) => {
    const host = mount(S.DemoVideo, { id: "3d", open: true, onClose: noop }, p.ref);
    const video = () => host.find((n) => n.type === "video");
    video().props.onError({ target: { kind: "captions" }, currentTarget: p.video });
    host.render();
    assert.ok(video(), "a missing captions file leaves the video");
    video().props.onError({ target: p.video, currentTarget: p.video });
    host.render();
    assert.equal(video(), undefined);
    const error = host.find((n) => n.props?.className === "demo-video-error");
    assert.equal(error.type, "p");
    assert.equal(error.props.role, "alert");
    assert.equal(error.props.children, "The video couldn't load.");
    assert.ok(host.find((n) => n.props?.className === "demo-video-title"), "still titled, still closable");
    host.render({ open: false });
    host.render({ open: true });
    assert.ok(video(), "open again: the video again");
    assert.equal(p.played.length, 2, "and it plays");
  });
});

test("Watch the demo: a play mark, the label and the length in mono; it opens its own video, and focus comes back to it", () => {
  const t2 = V.DEMO_VIDEOS["2d"].duration, tf = V.DEMO_VIDEOS.full.duration;
  assert.match(t2, /^\d+:\d\d$/);
  const html = renderToStaticMarkup(h(V.WatchDemoButton, { id: "2d" }));
  assert.ok(html.startsWith(`<button type="button" class="watch-demo" data-video="2d" aria-haspopup="dialog" aria-label="Watch the demo: Check drawings against the model (${t2})">`));
  assert.match(html, /<span class="watch-demo-play" aria-hidden="true"><svg/);
  assert.ok(html.includes(`<span class="watch-demo-time mono">${t2}</span>`));
  assert.equal(text(html).trim(), `Watch the demo · ${t2}`);
  const hero = renderToStaticMarkup(h(V.WatchDemoButton, { id: "full", label: "Watch the full demo", className: "watch-demo-hero" }));
  assert.match(hero, /^<button type="button" class="watch-demo watch-demo-hero" data-video="full"/);
  assert.ok(hero.includes(`aria-label="Watch the full demo: Iris: does AI truly see? (${tf})"`));
  for (const id of ["3d", "2d", "full"]) {
    const host = mount(S.WatchDemoButton, { id });
    const video = () => host.find((n) => n.type === S.DemoVideo);
    const button = () => host.find((n) => n.type === "button");
    assert.deepEqual([video().props.id, video().props.open], [id, false]);
    button().props.onClick();
    host.render();
    assert.deepEqual([video().props.id, video().props.open], [id, true], `${id}: opens its own video`);
    assert.equal(video().props.opener, button().props.ref, `${id}: focus goes back to this button`);
    video().props.onClose();
    host.render();
    assert.equal(video().props.open, false);
  }
});

test("Home's Watch the demos: three video cards, the full demo first and featured; thumbnail (lazy), play button, length, title, line, meta", () => {
  const html = renderToStaticMarkup(h(V.WatchDemos));
  assert.match(html, /^<section class="home-section home-demos" aria-labelledby="home-demos-title">/);
  assert.match(html, /<h2 class="home-h2" id="home-demos-title">Watch the demos<\/h2>/);
  const cards = html.match(/<li class="home-demo-item[^"]*">.*?<\/li>/g);
  assert.equal(cards?.length, 3, "three cards");
  assert.deepEqual(cards.map((c) => c.match(/data-video="(\w+)"/)[1]), ["full", "3d", "2d"], "the full demo first");
  assert.deepEqual(V.DEMO_CARDS.map((c) => c.title),
    ["Full demo: problem to solution", "Fix clashes in your building models", "Check drawings against the model"]);
  assert.match(cards[0], /^<li class="home-demo-item featured">/, "the full demo featured");
  assert.ok(cards.slice(1).every((c) => c.startsWith('<li class="home-demo-item">')));
  V.DEMO_CARDS.forEach((c, i) => {
    const card = cards[i], v = V.DEMO_VIDEOS[c.id];
    assert.ok(card.includes(`<button type="button" class="home-demo" data-video="${c.id}" aria-haspopup="dialog" aria-label="Play ${c.title} (${v.duration}, captions on)">`));
    assert.ok(card.includes(`<span class="home-demo-poster"><img src="${v.poster}" alt="" width="1920" height="1080" loading="lazy" decoding="async"/>`),
      `${c.id}: its poster as the thumbnail, lazy`);
    assert.match(card, /<span class="home-demo-play" aria-hidden="true"><svg/, `${c.id}: a play button on the thumbnail`);
    assert.ok(card.includes(`<span class="home-demo-len mono" aria-hidden="true">${v.duration}</span>`), `${c.id}: its length on the thumbnail`);
    assert.ok(card.indexOf("home-demo-poster") < card.indexOf("home-demo-title"), `${c.id}: the title under the thumbnail`);
    assert.ok(card.includes(`<span class="home-demo-title">${c.title}</span><span class="home-demo-line">${c.line}</span>`
      + `<span class="home-demo-meta">${V.DEMO_META}</span>`), `${c.id}: title, line, meta`);
    assert.equal(card.match(/<button/g).length, 1, `${c.id}: one button`);
  });
  assert.equal(V.DEMO_META, "Gemini voice · Captions on");
  assert.doesNotMatch(html, /<video|\.mp4|\.vtt/, "nothing of a video until one is opened");
  assert.doesNotMatch(html, /holo-edge/, "no holo edge on Home");
});

test("the hero's chip: Watch the full demo with a small thumbnail of its poster, the length; it opens the video", () => {
  const tf = V.DEMO_VIDEOS.full.duration;
  const chip = renderToStaticMarkup(h(V.WatchDemoButton, { id: "full", label: "Watch the full demo", className: "watch-demo-hero", thumb: true }));
  assert.match(chip, /^(<link rel="preload" as="image" href="\/demos\/iris-full-demo\.webp\?v=20261123b"\/>)?<button type="button" class="watch-demo watch-demo-thumb watch-demo-hero" data-video="full" aria-haspopup="dialog"/,
    "React may hint the thumbnail");
  assert.ok(chip.includes('<span class="watch-demo-poster" aria-hidden="true"><img src="/demos/iris-full-demo.webp?v=20261123b" alt="" width="64" height="36" decoding="async"/>'));
  assert.equal(text(chip).trim(), `Watch the full demo · ${tf}`);
  assert.doesNotMatch(chip, /<video|\.mp4|\.vtt/);
  const host = mount(S.WatchDemoButton, { id: "full", thumb: true });
  host.find((n) => n.type === "button").props.onClick();
  host.render();
  assert.equal(host.find((n) => n.type === S.DemoVideo).props.open, true);
});

test("a demo card opens the lightbox with its own video and captions track; focus comes back to the card", () => {
  for (const c of V.DEMO_CARDS) {
    const host = mount(S.DemoCard, c);
    const video = () => host.find((n) => n.type === S.DemoVideo);
    const button = () => host.find((n) => n.type === "button");
    assert.deepEqual([video().props.id, video().props.open], [c.id, false]);
    button().props.onClick();
    host.render();
    assert.deepEqual([video().props.id, video().props.open], [c.id, true], `${c.id}: opens its own video`);
    assert.equal(video().props.opener, button().props.ref, `${c.id}: focus goes back to the card`);
    const box = renderToStaticMarkup(h(V.DemoVideo, { id: c.id, open: true, onClose: noop }));
    assert.ok(box.includes(`src="/demos/iris-${c.id}-demo.mp4?v=20261123b"`), `${c.id}: its mp4`);
    assert.match(box, new RegExp(`<track kind="captions" src="/demos/iris-${c.id}-demo\\.vtt\\?v=20261123b" srcLang="en" label="English" default=""/>`), `${c.id}: its captions`);
    video().props.onClose();
    host.render();
    assert.equal(video().props.open, false);
  }
});

test("the stylesheet is light: a frosted white scrim, a white card, the video 16:9; a 16 px gutter on a phone; no zoom under reduced motion", async () => {
  const css = (await readFile(new URL("../src/demoVideo.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /prefers-color-scheme|\bdark\b|rgba\(0, 0, 0|#000\b/i, "light only, no dark overlay");
  assert.match(css, /\.demo-video \{[^}]*position: fixed;[^}]*background: rgba\(255, 255, 255, \.72\);[^}]*backdrop-filter: blur\(10px\)/);
  assert.match(css, /\.demo-video-card \{[^}]*background: var\(--surface\)/);
  assert.match(css, /\.demo-video-frame \{[^}]*aspect-ratio: 16 \/ 9/);
  assert.match(css, /@media \(max-width: 600px\) \{[^}]*\.demo-video \{ padding: 16px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.demo-video-card \{ animation: none; \}/);
});
