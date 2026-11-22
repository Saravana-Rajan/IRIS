import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled, find, hasText } from "./app-host.mjs";

/* The Drawings step (docs/drawings.md): drawingsApi.ts calls every route of the contract and reads the read stream;
 * DrawingsPanel.tsx shows sheets, item boxes in the proof grammar, items and mismatches. AI reads, data checks, the
 * engineer decides. */

const apiUrl = await compiled("../src/api.ts");
const { ApiError } = await import(apiUrl);
const drawingsUrl = await compiled("../src/drawingsApi.ts", { "./api": apiUrl });
const d = await import(drawingsUrl);

/** DrawingsPanel.tsx with its own modules; its stylesheet import is dropped (Vite's job, not Node's). */
async function component() {
  const url = await compiled("../src/DrawingsPanel.tsx", { react: import.meta.resolve("react"),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": import.meta.resolve("lucide-react"),
    "./drawingsApi": drawingsUrl });
  const src = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString();
  assert.ok(src.includes('import "./drawings.css";'), "the panel brings its own stylesheet");
  const js = src.replace('import "./drawings.css";', "");
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const ui = await component();
const css = await readFile(new URL("../src/drawings.css", import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const noop = () => {};

/** A fetch that records each call and answers from `reply(url, init)`. */
function serve(reply = () => ({})) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body, headers: init.headers ?? {} });
    const out = reply(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

/** A Response whose body arrives in these byte chunks (as a slow network splits it). */
function streamed(chunks, status = 200) {
  const enc = new TextEncoder();
  const parts = chunks.map((c) => (typeof c === "string" ? enc.encode(c) : c));
  return new Response(new ReadableStream({ pull(ctl) { const next = parts.shift(); if (next) ctl.enqueue(next); else ctl.close(); } }),
    { status, headers: { "content-type": "application/x-ndjson" } });
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Fixtures (shaped like the server contract)                                                                       */

const pageOf = (index, has_text_layer = true) => ({ index, width_px: 2000, height_px: 1400, dpi: 150, png: `pages/${index}.png`, words: [], has_text_layer });
const D1 = { id: "d1", name: "M-201 Level 02 HVAC.pdf", sha256: "a".repeat(64), pages: [pageOf(0), pageOf(1)], title: { sheet: "M-201", title: "Level 02 ductwork" } };
const D2 = { id: "d2", name: "P-201 scan.pdf", sha256: "b".repeat(64), pages: [pageOf(0, false)], title: {} };
const itemOf = (id, over = {}) => ({ id, page: 0, tag: id.toUpperCase(), kind: "duct", size: "600x300", size_mm: [600, 300], box: [100, 100, 300, 160],
  source: "ai", status: "confirmed", evidence: {}, ...over });
const ITEMS = {
  d1: [
    itemOf("sa-1", { evidence: { words: [{ text: "SA-1" }, "600x300"], distance_px: 11.6, model: "Gemini Flash" } }),
    itemOf("sa-2", { status: "ai_only", size: "800x400", box: [400, 300, 600, 340] }),
    itemOf("cw-1", { kind: "pipe", status: "text_only", source: "text", size: "Ø150", page: 1, box: [50, 50, 90, 70] }),
  ],
};
const COMPARE = {
  matches: [{ item: "sa-1", element: "gidSA1", by: "tag" }],
  mismatches: [
    { kind: "size_differs", item: "sa-1", element: "gidSA1", drawing_value: "600x300", model_value: "600x400", evidence: { by: "tag" } },
    { kind: "missing_in_model", item: "sa-2", element: null, drawing_value: "SA-2", model_value: null, evidence: {} },
    { kind: "missing_in_drawing", item: null, element: "gidEX9", drawing_value: null, model_value: "EX-9", evidence: { tag: "EX-9" } },
    { kind: "type_differs", item: "cw-1", element: "gidCW1", drawing_value: "pipe", model_value: "duct", evidence: {} },
  ],
};
const panel = (over = {}) => h(ui.DrawingsPanel, { sceneId: "s1", drawings: [D1, D2], items: ITEMS, compare: COMPARE,
  onUpload: noop, onRead: noop, onFocusElement: noop, ...over });

/* ---------------------------------------------------------------------------------------------------------------- */
/* The api module                                                                                                   */

test("each read route of the contract is called with its method and path, ids encoded", async () => {
  const calls = serve((url) => (url.endsWith("/compare") ? { matches: [], mismatches: [] } : []));
  assert.deepEqual(await d.listDrawings("s 1"), []);
  await d.drawingItems("d/1");
  assert.deepEqual(await d.compareDrawings("s1"), { matches: [], mismatches: [] });
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ["GET", "/api/scenes/s%201/drawings"], ["GET", "/api/drawings/d%2F1/items"], ["GET", "/api/scenes/s1/drawings/compare"],
  ]);
  assert.equal(d.pageUrl("d/1", 0), "/api/drawings/d%2F1/pages/0.png");
  assert.equal(d.pageUrl("d1", 3), "/api/drawings/d1/pages/3.png");
  for (const k of ["uploadDrawings", "addSampleDrawings", "listDrawings", "pageUrl", "readDrawing", "drawingItems", "compareDrawings"]) assert.equal(typeof d.drawingsApi[k], "function", k);
});

test("a failed call throws api.ts's ApiError with the server's words and status", async () => {
  serve(() => new Response(JSON.stringify({ detail: "No such scene" }), { status: 404 }));
  await assert.rejects(d.listDrawings("gone"), (e) => e instanceof ApiError && e.status === 404 && e.message === "No such scene");
  serve(() => new Response(JSON.stringify({ detail: [{ msg: "pages must be ints" }, { msg: "too many" }] }), { status: 422 }));
  await assert.rejects(d.drawingItems("d1"), (e) => e instanceof ApiError && e.message === "pages must be ints; too many");
  serve(() => new Response("oops", { status: 502 }));
  await assert.rejects(d.compareDrawings("s1"), (e) => e instanceof ApiError && e.status === 502 && /Request failed \(502\)/.test(e.message));
});

/** XMLHttpRequest as far as the upload uses it; the answer is set on the class before sending. */
class FakeXhr {
  static status = 200; static body = "[]"; static last = null; static fail = false;
  upload = {}; headers = {};
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(form) {
    FakeXhr.last = this; this.form = form;
    queueMicrotask(() => {
      if (FakeXhr.fail) { this.onerror(); return; }
      this.upload.onprogress?.({ loaded: 40, total: 100, lengthComputable: true });
      this.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
      this.status = FakeXhr.status; this.responseText = FakeXhr.body; this.onload();
    });
  }
}

test("upload sends each PDF as `files` with progress and resolves with the drawings; errors carry the server's words", async () => {
  const saved = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  try {
    const files = [new File(["%PDF-1.7 a"], "M-201.pdf", { type: "application/pdf" }), new File(["%PDF-1.7 b"], "P-201.pdf", { type: "application/pdf" })];
    Object.assign(FakeXhr, { status: 200, body: JSON.stringify([D1, D2]), fail: false });
    const progress = [];
    const out = await d.uploadDrawings("s1", files, (loaded, total) => progress.push([loaded, total]));
    assert.deepEqual(out.map((x) => x.id), ["d1", "d2"]);
    assert.deepEqual([FakeXhr.last.method, FakeXhr.last.url], ["POST", "/api/scenes/s1/drawings"]);
    assert.deepEqual(FakeXhr.last.form.getAll("files").map((f) => f.name), ["M-201.pdf", "P-201.pdf"]);
    assert.deepEqual(progress, [[40, 100], [100, 100]]);

    Object.assign(FakeXhr, { status: 413, body: JSON.stringify({ detail: "Drawings are limited to 50 MB" }) });
    await assert.rejects(d.uploadDrawings("s1", files), (e) => e instanceof ApiError && e.status === 413 && e.message === "Drawings are limited to 50 MB");
    Object.assign(FakeXhr, { status: 200, body: "{\"not\": \"a list\"}" });
    await assert.rejects(d.uploadDrawings("s1", files), /not a list of drawings/);
    Object.assign(FakeXhr, { fail: true });
    await assert.rejects(d.uploadDrawings("s1", files), (e) => e instanceof ApiError && e.status === 0 && /connection dropped/.test(e.message));
  } finally { if (saved) globalThis.XMLHttpRequest = saved; else delete globalThis.XMLHttpRequest; }

  // Without XMLHttpRequest (a worker, a test) the same form goes by fetch.
  const calls = serve(() => [D1]);
  const out = await d.uploadDrawings("s1", [new File(["%PDF"], "M-201.pdf")]);
  assert.deepEqual(out, [D1]);
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].body instanceof FormData);
  assert.deepEqual(calls[0].body.getAll("files").map((f) => f.name), ["M-201.pdf"]);
});

test("reading streams NDJSON: lines split across chunks and inside a UTF-8 character, events in order, items and cost returned", async () => {
  const lines = [
    { type: "page", page: 0, total: 2 },
    { type: "item", item: itemOf("sa-1") },
    { type: "ping" },
    { type: "item", item: itemOf("cw-1", { size: "Ø150" }) },
    { type: "page", index: 1, of: 2 },
    { type: "item", item: itemOf("sa-2", { status: "ai_only" }) },
    { type: "done", items: 3, cost_usd: 0.0042 },
  ].map((x) => JSON.stringify(x) + "\n").join("");
  const bytes = new TextEncoder().encode(lines);
  const omega = bytes.indexOf(0xc3);   // "Ø" is two bytes: split between them
  assert.ok(omega > 0);
  const chunks = [bytes.slice(0, 17), bytes.slice(17, omega + 1), bytes.slice(omega + 1, omega + 40), bytes.slice(omega + 40)];
  const calls = serve(() => streamed(chunks));
  const seen = [];
  const out = await d.readDrawing("d1", { pages: [0, 1], onEvent: (e) => seen.push(e.type === "page" ? `page ${e.page}/${e.total}` : e.type) });
  assert.deepEqual(seen, ["page 0/2", "item", "item", "page 1/2", "item", "done"]);
  assert.deepEqual(out.items.map((i) => i.id), ["sa-1", "cw-1", "sa-2"]);
  assert.equal(out.items[1].size, "Ø150");
  assert.equal(out.count, 3);
  assert.equal(out.cost_usd, 0.0042);
  assert.deepEqual([calls[0].method, calls[0].url, JSON.parse(calls[0].body)], ["POST", "/api/drawings/d1/read", { pages: [0, 1] }]);
  assert.equal(calls[0].headers["Content-Type"], "application/json");

  // No pages asked: the whole drawing ({}); a last line without its newline still counts.
  const again = serve(() => streamed([JSON.stringify({ type: "done", items: [itemOf("x")], cost_usd: 0 })]));
  const all = await d.readDrawing("d1");
  assert.deepEqual(JSON.parse(again[0].body), {});
  assert.deepEqual([all.count, all.cost_usd], [1, 0]);
});

test("a reading that fails says why: an error event, a refused request, a stream cut short", async () => {
  serve(() => streamed([JSON.stringify({ type: "page", page: 0, total: 1 }) + "\n", JSON.stringify({ type: "error", detail: "Daily AI spend cap reached", status: 429 }) + "\n"]));
  const seen = [];
  await assert.rejects(d.readDrawing("d1", { onEvent: (e) => seen.push(e.type) }),
    (e) => e instanceof ApiError && e.status === 429 && e.message === "Daily AI spend cap reached");
  assert.deepEqual(seen, ["page", "error"]);
  serve(() => new Response(JSON.stringify({ detail: "Drawing not found" }), { status: 404 }));
  await assert.rejects(d.readDrawing("gone"), (e) => e instanceof ApiError && e.status === 404 && e.message === "Drawing not found");
  serve(() => streamed([JSON.stringify({ type: "page", page: 0, total: 3 }) + "\n"]));
  await assert.rejects(d.readDrawing("d1"), /stopped before it finished/);
});

test("stream lines become events: aliases accepted, unknown lines skipped, partial lines kept", () => {
  assert.deepEqual(d.splitNdjson('{"a":1}\n\n{"b":2}\n{"c"'), { lines: [{ a: 1 }, { b: 2 }], rest: '{"c"' });
  assert.deepEqual(d.toReadEvent({ type: "page", page: 2, total: 5 }), { type: "page", page: 2, total: 5 });
  assert.deepEqual(d.toReadEvent({ type: "page", index: 1, pages: 4 }), { type: "page", page: 1, total: 4 });
  assert.equal(d.toReadEvent({ type: "page" }), null);
  assert.deepEqual(d.toReadEvent({ type: "done", items: [1, 2], cost_usd: "x" }), { type: "done", items: 2, cost_usd: null, saved: null });
  assert.deepEqual(d.toReadEvent({ type: "error", message: "boom" }), { type: "error", detail: "boom", status: 500 });
  assert.equal(d.toReadEvent({ type: "heartbeat" }), null);
  assert.equal(d.toReadEvent(null), null);
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* Status → style, and the facts the step shows                                                                     */

test("each status maps to its line and colour in the proof grammar, and the stylesheet draws it so", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(d.STATUS_STYLE).map(([k, v]) => [k, [v.cls, v.line, v.label]])), {
    confirmed: ["st-confirmed", "solid", "Confirmed"],
    ai_only: ["st-ai", "dashed", "AI-read: check"],
    text_only: ["st-text", "dotted", "Text layer only"],
  });
  for (const s of Object.values(d.STATUS_STYLE)) assert.ok(s.glyph && s.meaning, "colour never stands alone: a glyph and a word");
  const rule = (sel) => { const m = new RegExp(`${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(css); assert.ok(m, sel); return m[1]; };
  // Confirmed by data: solid teal. AI-read: dashed indigo. Text only: dotted grey.
  assert.match(css, /--d-proved: var\(--proved, var\(--ok\)\)/);
  assert.match(css, /--d-ai: var\(--ai, var\(--spark\)\)/);
  assert.match(rule(".dwg-box.st-confirmed"), /stroke: var\(--d-proved\)/);
  assert.doesNotMatch(rule(".dwg-box.st-confirmed"), /dasharray/);
  assert.match(rule(".dwg-box.st-ai"), /stroke: var\(--d-ai\); stroke-dasharray: 5 3/);
  assert.match(rule(".dwg-box.st-text"), /stroke: var\(--d-control\); stroke-dasharray: 1 3/);
  assert.match(rule(".dwg-badge.st-ai"), /border-style: dashed/);
  assert.match(rule(".dwg-badge.st-text"), /border-style: dotted/);
  assert.match(rule(".dwg-rule-step.decided"), /background: var\(--accent\)/, "the engineer's step is navy, filled");
  assert.match(rule(".dwg-mis.mk-missing"), /stroke: var\(--d-failed\)/);
  assert.match(rule(".dwg-mis.mk-differs"), /stroke: var\(--warn\)/);
  for (const { cls } of Object.values(d.STATUS_STYLE)) for (const part of ["dwg-box", "dwg-badge", "dwg-swatch"]) assert.ok(css.includes(`.${part}.${cls}`), `${part}.${cls}`);
  for (const { cls } of Object.values(d.MISMATCH_STYLE)) for (const part of ["dwg-badge", "dwg-mis", "dwg-mk"]) assert.ok(css.includes(`.${part}.${cls}`), `${part}.${cls}`);
  assert.equal(d.statusStyle("bogus").cls, "st-ai", "an unknown status is shown as needing a check, never as confirmed");
});

test("the stylesheet uses the page's colour variables only, light theme only", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(rules), "no colour written out");
  assert.doesNotMatch(rules, /prefers-color-scheme|data-theme/, "no dark-mode block (owner decision: light only)");
  assert.match(rules, /font-variant-numeric: tabular-nums/);
  assert.match(rules, /@media \(max-width: 760px\)/, "stacks on a phone");
});

test("mismatch words, sizes, cost, pages, text layer, tallies and zoom", () => {
  assert.deepEqual(Object.values(d.MISMATCH_STYLE).map((m) => m.label), ["Missing in model", "Missing in drawing", "Size differs", "Type differs"]);
  assert.deepEqual([d.MISMATCH_STYLE.missing_in_model.cls, d.MISMATCH_STYLE.size_differs.cls], ["mk-missing", "mk-differs"]);
  assert.equal(d.sizeText("600x300"), "600 × 300");
  assert.equal(d.sizeText("1200 X 400 x 50"), "1200 × 400 × 50");
  assert.equal(d.sizeText("Ø150"), "Ø150");
  assert.equal(d.costText(0.0042), "$0.0042");
  assert.equal(d.costText(1.2), "$1.20");
  assert.equal(d.costText(0), "$0 (already read, cached)");
  assert.equal(d.costText(null), "cost not reported");
  assert.equal(d.pageNumber(D1, 1), 2);
  assert.equal(d.pageNumber({ pages: [pageOf(1), pageOf(2)] }, 1), 1, "1-based indexes read the same");
  assert.deepEqual([d.textLayerOf(D1), d.textLayerOf(D2), d.textLayerOf({ pages: [pageOf(0), pageOf(1, false)] })], ["all", "none", "some"]);
  assert.equal(d.TEXT_LAYER_LABEL.all, "Text layer ✓");
  assert.equal(d.TEXT_LAYER_LABEL.none, "Scanned — AI only");
  assert.deepEqual(d.statusTally(ITEMS.d1), { confirmed: 1, ai_only: 1, text_only: 1 });
  assert.deepEqual(d.findItem(ITEMS, "cw-1")?.did, "d1");
  assert.equal(d.findItem(ITEMS, "nope"), null);
  assert.equal(d.findItem(ITEMS, null), null);

  const fit = d.fitWidth({ w: 1016, h: 700 }, { w: 2000, h: 1400 });
  assert.equal(fit.s, 0.5);
  assert.deepEqual([fit.x, fit.y], [8, 8], "the width fills the stage less its margin, top aligned when it is as tall");
  assert.equal(d.fitWidth({ w: 1016, h: 1000 }, { w: 2000, h: 1400 }).y, 150, "a short page is centred");
  const z = d.zoomAt({ s: 1, x: 0, y: 0 }, 2, 100, 50);
  assert.deepEqual(z, { s: 2, x: -100, y: -50 }, "the point under the cursor stays put");
  assert.equal(d.zoomAt({ s: 1, x: 0, y: 0 }, 1e6, 0, 0).s, d.ZOOM_MAX);
  assert.deepEqual(d.centreOn({ s: 1, x: 0, y: 0 }, [100, 100, 300, 200], { w: 800, h: 600 }), { s: 1, x: 200, y: 150 });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* The panel (server render; React, lucide and drawingsApi are the real ones)                                       */

test("with no drawings the step offers the drop zone, says how readings are checked, and states the rule", () => {
  const html = renderToStaticMarkup(panel({ drawings: [], items: {}, compare: null }));
  const t = text(html);
  assert.match(t, /Upload PDF drawings \(HVAC, plumbing, electrical plans\)/);
  assert.match(t, /checks every tag and size against the PDF's own text layer/);
  assert.match(t, /AI reads .*Data checks .*The engineer decides/);
  assert.match(html, /<input type="file" class="dwg-sr" accept="\.pdf,application\/pdf" multiple=""/);
  const closed = renderToStaticMarkup(panel({ drawings: [], items: {}, compare: null, sceneId: null }));
  assert.match(closed, /disabled=""/);
  assert.match(text(closed), /Open the project's models first/);
});

test("sheets, the page with its boxes by status, the items table and the mismatches render from real state", () => {
  const html = renderToStaticMarkup(panel({ names: { gidSA1: "Supply air main SA-1" } }));
  const t = text(html);
  // Left: each sheet with its pages and text-layer state, read or not.
  assert.match(t, /M-201 Level 02 HVAC\.pdf M-201 · Level 02 ductwork 2 pages Text layer ✓ 3 items · 1 to check/);
  assert.match(t, /P-201 scan\.pdf 1 page Scanned — AI only Not read yet/);
  // Centre: the first page, its image and the boxes of its items only (cw-1 is on page 2).
  assert.match(html, /href="\/api\/drawings\/d1\/pages\/0\.png"/);
  assert.match(html, /viewBox="0 0 2000 1400"/);
  assert.match(html, /class="dwg-box st-confirmed" x="100" y="100" width="200" height="60"/);
  assert.match(html, /class="dwg-box st-ai" x="400"/);
  assert.ok(html.indexOf('class="dwg-box st-confirmed" x="100"') < html.indexOf('class="dwg-box st-ai" x="400"'), "the larger box (sa-1) is drawn first, the smaller on top");
  assert.doesNotMatch(html, /class="dwg-box st-text"/);
  assert.match(html, /class="dwg-mis mk-differs"/, "sa-1's size differs: highlighted");
  assert.match(html, /class="dwg-mis mk-missing"/, "sa-2 is missing in the model: highlighted");
  assert.match(t, /Page 1 of 2/);
  assert.match(t, /Read again/);
  // Right: items with tag, kind, size, status chip and page.
  assert.match(t, /Tag Kind Size Status Page SA-1 Duct 600 × 300 ✓ Confirmed/);
  assert.match(t, /SA-2 Duct 800 × 400 ✦ AI-read: check/);
  assert.match(t, /CW-1 Pipe Ø150 T Text layer only .* 2/);
  assert.match(t, /Items 3 Mismatches 4/);
  assert.match(t, /All 3 Confirmed 1 AI-read: check 1 Text layer only 1/);
  // Mismatches: kind chip, drawing value against model value, and the way to 3D.
  for (const w of ["Missing in model", "Missing in drawing", "Size differs", "Type differs"]) assert.ok(t.includes(w), w);
  assert.match(t, /Size differs SA-1 M-201 · p\. 1 Drawing 600 × 300 Model 600 × 400/);
  assert.match(t, /Missing in drawing EX-9 Drawing — Model EX-9/);
  assert.equal(t.match(/check the reading first/g)?.length, 2, "only the unconfirmed readings (sa-2 AI-read, cw-1 text only) carry the note");
  assert.equal(t.match(/Show in 3D/g)?.length, 3, "one per mismatch with a model element");
  assert.match(html, /aria-label="Show Supply air main SA-1 in 3D"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"[^>]*>Items/);
});

test("a scanned sheet says every item is AI-read; nothing read yet says what to do; busy holds the reading", () => {
  const t = text(renderToStaticMarkup(panel({ drawings: [D2], items: {}, compare: null })));
  assert.match(t, /Scanned — AI only/);
  assert.match(t, /No text layer on this page \(scanned\)\. Every item on it is AI-read: check each one on the sheet\./);
  assert.match(t, /Read with AI/);
  assert.match(t, /Not read yet\. Read the sheet with AI to list its items\./);
  assert.match(t, /Not compared yet/);
  const busy = renderToStaticMarkup(panel({ drawings: [D2], items: {}, compare: null, busy: true }));
  assert.match(busy, /<button type="button" class="btn small primary" disabled=""[^>]*>Read with AI/);
  const failed = text(renderToStaticMarkup(panel({ error: "The server restarted. Open the models again.", onRetry: noop })));
  assert.match(failed, /The server restarted\. Open the models again\. Retry/);
  assert.match(text(renderToStaticMarkup(panel({ compare: { matches: [{ item: "sa-1", element: "g", by: "tag" }], mismatches: [] } }))),
    /No mismatches: 1 item matched the model by its data\./);
});

test("Show in 3D hands the element to the page; Show on sheet hands the item and its drawing", () => {
  const focused = [], shown = [];
  const tree = ui.MismatchList({ compare: COMPARE, items: ITEMS, drawings: [D1, D2], onShowItem: (it, dr) => shown.push([it.id, dr.id]),
    onFocusElement: (gid) => focused.push(gid) });
  const rows = find(tree, (n) => n.type === "ul").props.children;
  const button = (row, label) => find(row, (n) => n.type === "button" && hasText(n, label));
  button(rows[0], "Show in 3D").props.onClick();
  button(rows[2], "Show in 3D").props.onClick();
  button(rows[3], "Show on sheet").props.onClick();
  assert.deepEqual(focused, ["gidSA1", "gidEX9"]);
  assert.deepEqual(shown, [["cw-1", "d1"]]);
  assert.equal(button(rows[1], "Show in 3D"), undefined, "missing in the model: nothing to show in 3D");
  assert.equal(button(rows[2], "Show on sheet"), undefined, "missing in the drawing: nothing to show on a sheet");
});

test("the reading line is honest: page n of N while it runs, items and cost after, the error with Retry", () => {
  const line = (read) => text(renderToStaticMarkup(h(ui.ReadLine, { read, drawing: D1, onRetry: noop })));
  assert.match(line({ state: "reading", page: 1, total: 2, items: 4 }), /Reading page 2 of 2 .*4 items so far/);
  assert.match(line({ state: "reading", page: null, total: 2, items: 0 }), /Starting the reading/);
  assert.match(line({ state: "reading", page: 0, total: 2, items: 1 }), /Reading page 1 of 2 .*1 item so far/);
  assert.match(line({ state: "done", count: 7, cost_usd: 0.0042 }), /Read 2 pages: 7 items · Cost \$0\.0042/);
  assert.match(line({ state: "done", count: 1, cost_usd: null }), /1 item · Cost cost not reported/);
  assert.match(line({ state: "error", message: "Daily AI spend cap reached" }), /Reading failed: Daily AI spend cap reached Retry/);
  assert.equal(renderToStaticMarkup(h(ui.ReadLine, { read: undefined, drawing: D1, onRetry: noop })), "");
});

test("the items table marks the picked row and shows each item's evidence in words", () => {
  const html = renderToStaticMarkup(h(ui.ItemsTable, { drawing: D1, items: ITEMS.d1, picked: "sa-2", mismatchOf: new Map(), onPick: noop, empty: "none" }));
  assert.match(html, /<tr tabindex="0" aria-selected="true" class="st-ai picked">/);
  assert.equal(html.match(/aria-selected="false"/g)?.length, 2);
  assert.match(text(renderToStaticMarkup(h(ui.ItemsTable, { drawing: D1, items: [], picked: null, mismatchOf: new Map(), onPick: noop, empty: "Nothing here." }))), /Nothing here\./);
  assert.deepEqual(ui.evidenceLines(ITEMS.d1[0].evidence), ["Text layer: “SA-1”, “600x300”", "12 px from the box", "Read by Gemini Flash"]);
  assert.deepEqual(ui.evidenceLines({}), []);
});
