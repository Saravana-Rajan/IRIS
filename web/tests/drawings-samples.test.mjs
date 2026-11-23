import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled, find, flush } from "./app-host.mjs";

/* The sample drawings and their saved readings (docs/drawings.md): the sample building's sheets come with a saved Gemini
 * reading that the server replays at no cost. The page offers the samples when there are no drawings, and says plainly
 * that a replayed reading is a saved one, never a live one. */

const apiUrl = await compiled("../src/api.ts");
const { ApiError } = await import(apiUrl);
const drawingsUrl = await compiled("../src/drawingsApi.ts", { "./api": apiUrl });
const d = await import(drawingsUrl);

/** DrawingsPanel.tsx with its stylesheet import dropped (Vite's job, not Node's); `react` may be a stand-in. */
async function component(react = import.meta.resolve("react"), labels = false) {
  const url = await compiled("../src/DrawingsPanel.tsx", { react, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "lucide-react": import.meta.resolve("lucide-react"), "./drawingsApi": drawingsUrl }, labels);
  const src = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString();
  return import(`data:text/javascript;base64,${Buffer.from(src.replace('import "./drawings.css";', "")).toString("base64")}`);
}
const ui = await component();
/** The same panel on hooks kept in `globalThis.__dwgState` by name, so a test can click, then render again. */
const hooks = `const s = () => globalThis.__dwgState;
export function useState(name, init) { if (!(name in s())) s()[name] = typeof init === "function" ? init() : init;
  return [s()[name], (v) => { s()[name] = typeof v === "function" ? v(s()[name]) : v; }]; }
export const useId = () => "id"; export const useRef = (_name, v) => ({ current: v }); export const useEffect = () => {};
export const useLayoutEffect = () => {};`;
const live = await component(`data:text/javascript;base64,${Buffer.from(hooks).toString("base64")}`, true);
/** The same, with each effect run as it is declared (a render, then its effects), to see what opening the page does. */
const effects = await component(`data:text/javascript;base64,${Buffer.from(hooks.replace("export const useEffect = () => {};",
  "export const useEffect = (f) => { f(); };")).toString("base64")}`, true);
const css = await readFile(new URL("../src/drawings.css", import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const noop = () => {};

function serve(reply = () => ({})) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    const out = reply(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}
const streamed = (lines) => new Response(lines.map((x) => JSON.stringify(x) + "\n").join(""), { status: 200, headers: { "content-type": "application/x-ndjson" } });

const SAVED = { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", at: "2026-11-22T10:00:00Z" };
const pageOf = (index) => ({ index, width_px: 2000, height_px: 1400, dpi: 150, png: `pages/${index}.png`, words: [], has_text_layer: true });
const SHEET = { id: "m201", name: "Northbank M-201.pdf", sha256: "c".repeat(64), pages: [pageOf(0)], title: { sheet: "M-201" }, saved_reading: SAVED };
const LIVE = { ...SHEET, id: "u1", name: "Own sheet.pdf", saved_reading: null };
const itemOf = (id, evidence = {}) => ({ id, page: 0, tag: id.toUpperCase(), kind: "duct", size: "600x300", size_mm: [600, 300],
  box: [100, 100, 300, 160], source: "ai", status: "confirmed", evidence });
const panel = (over = {}) => h(ui.DrawingsPanel, { sceneId: "s1", drawings: [SHEET], items: {}, compare: null, onUpload: noop, onRead: noop,
  onFocusElement: noop, ...over });

/* ---------------------------------------------------------------------------------------------------------------- */
/* The api module                                                                                                   */

test("a saved reading is parsed tolerantly: a valid one is kept, anything else is null", () => {
  assert.deepEqual(d.savedReadingOf(SAVED), SAVED);
  assert.deepEqual(d.savedReadingOf({ ...SAVED, pages: [0, 1] }), SAVED, "only the fields the page shows");
  assert.deepEqual(d.savedReadingOf({ model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }), { ...SAVED, at: null });
  assert.deepEqual(d.savedReadingOf({ model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", at: 5 }), { ...SAVED, at: null });
  for (const junk of [null, undefined, true, 1, "Gemini", [], {}, { model: "" , label: "" }, { model: 3, label: "Gemini" }, { label: ["x"] }]) {
    assert.equal(d.savedReadingOf(junk), null, JSON.stringify(junk));
  }
});

test("the done event carries the saved reading replayed (or null); a page says when it replays", () => {
  assert.deepEqual(d.toReadEvent({ type: "done", items: 186, cost_usd: 0, saved: { ...SAVED, pages: [0] } }),
    { type: "done", items: 186, cost_usd: 0, saved: SAVED });
  assert.deepEqual(d.toReadEvent({ type: "done", items: 3, cost_usd: 0.004, saved: null }), { type: "done", items: 3, cost_usd: 0.004, saved: null });
  for (const junk of [undefined, "yes", 1, [], { model: 1 }]) {
    assert.equal(d.toReadEvent({ type: "done", items: 1, cost_usd: 0, saved: junk }).saved, null, JSON.stringify(junk));
  }
  assert.deepEqual(d.toReadEvent({ type: "page", page: 0, total: 1, saved: true }), { type: "page", page: 0, total: 1, saved: true });
  assert.deepEqual(d.toReadEvent({ type: "page", page: 0, total: 1, saved: false }), { type: "page", page: 0, total: 1 });
  assert.deepEqual(d.toReadEvent({ type: "page", page: 0, total: 1, saved: "true" }), { type: "page", page: 0, total: 1 });
});

test("readDrawing returns the saved reading it replayed, and null for a live reading", async () => {
  const ev = { saved_reading: SAVED, model: "gemini-3.8-flash" };
  serve(() => streamed([{ type: "page", page: 0, total: 1, saved: true }, { type: "item", item: itemOf("sa-1", ev) },
    { type: "done", items: 1, cost_usd: 0, saved: { ...SAVED, pages: [0] } }]));
  const seen = [];
  const out = await d.readDrawing("m201", { onEvent: (e) => seen.push(e.type === "page" ? `page ${e.saved ? "saved" : "live"}` : e.type) });
  assert.deepEqual(seen, ["page saved", "item", "done"]);
  assert.deepEqual([out.count, out.cost_usd, out.saved], [1, 0, SAVED]);
  serve(() => streamed([{ type: "done", items: 0, cost_usd: 0.0042 }]));
  assert.equal((await d.readDrawing("u1")).saved, null);
});

test("addSampleDrawings POSTs to the scene's samples route; a 409 throws ApiError with the server's sentence", async () => {
  const calls = serve(() => [SHEET]);
  assert.deepEqual(await d.addSampleDrawings("s 1"), [SHEET]);
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [["POST", "/api/scenes/s%201/drawings/samples"]]);
  assert.equal(d.drawingsApi.addSampleDrawings, d.addSampleDrawings);
  const detail = "The open models have no sample drawings.";
  serve(() => new Response(JSON.stringify({ detail }), { status: 409 }));
  await assert.rejects(d.addSampleDrawings("s1"), (e) => e instanceof ApiError && e.status === 409 && e.message === detail);
});

test("saved words: what it is, the model's label (else its id), and a replay's cost", () => {
  assert.equal(d.savedText(SAVED), "Saved AI reading of this sample (Gemini 3.8 Flash)");
  assert.equal(d.savedText({ ...SAVED, label: "" }), "Saved AI reading of this sample (gemini-3.8-flash)");
  assert.equal(d.costText(0, SAVED), "$0 (saved reading)");
  assert.equal(d.costText(0, true), "$0 (saved reading)");
  assert.equal(d.costText(0), "$0 (already read, cached)", "a live sheet read before still says cached");
  assert.equal(d.costText(0, null), "$0 (already read, cached)");
  assert.equal(d.costText(0.0042, SAVED), "$0.0042", "money spent is always shown as spent");
  assert.equal(d.costText(null, SAVED), "cost not reported");
});

test("savedOfItems finds the saved reading the items came from, else null", () => {
  assert.equal(d.savedOfItems([]), null);
  assert.equal(d.savedOfItems([itemOf("a"), itemOf("b", { model: "gemini-3.8-flash" })]), null);
  assert.equal(d.savedOfItems([itemOf("a", { saved_reading: "yes" }), itemOf("b", { saved_reading: { model: 1 } })]), null);
  assert.deepEqual(d.savedOfItems([itemOf("a"), itemOf("b", { saved_reading: SAVED }), itemOf("c", { saved_reading: { ...SAVED, label: "Other" } })]), SAVED);
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* The panel                                                                                                        */

test("the samples line shows only with onSamples and no drawings, and waits for a scene and for the page", () => {
  const empty = { drawings: [], items: {}, onSamples: () => Promise.resolve() };
  const html = renderToStaticMarkup(panel(empty));
  assert.match(text(html), /or drop them here .*No drawings to hand\? Add the sample drawings/, "one line, under the drop zone");
  assert.match(html, /<button type="button" class="btn" data-dwg="samples">Add the sample drawings<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(panel({ drawings: [], items: {} })), /data-dwg="samples"|No drawings to hand/);
  assert.doesNotMatch(renderToStaticMarkup(panel({ onSamples: empty.onSamples })), /data-dwg="samples"/, "drawings there: nothing to offer");
  assert.match(renderToStaticMarkup(panel({ ...empty, busy: true })), /data-dwg="samples"[^>]*disabled=""/);
  assert.match(renderToStaticMarkup(panel({ ...empty, sceneId: null })), /data-dwg="samples"[^>]*disabled=""/);
});

test("adding the samples: one call, says it is adding with the spinner, a failure shows the Alert whose Retry calls again", async () => {
  globalThis.__dwgState = {};
  const pending = [];
  const onSamples = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const props = { sceneId: "s1", drawings: [], items: {}, compare: null, onUpload: noop, onRead: noop, onFocusElement: noop, onSamples };
  const button = (tree) => find(tree, (n) => n.props?.["data-dwg"] === "samples");
  let tree = live.DrawingsPanel(props);
  assert.equal(button(tree).props.disabled, false);
  button(tree).props.onClick();
  tree = live.DrawingsPanel(props);
  assert.equal(pending.length, 1);
  assert.equal(button(tree).props.disabled, true);
  const adding = renderToStaticMarkup(tree);
  assert.match(adding, /<i class="spinner" aria-hidden="true"><\/i> Adding the sample drawings…/);
  assert.match(adding, /<input type="file"[^>]*disabled=""/, "no upload while the samples are being added");
  button(tree).props.onClick();
  assert.equal(pending.length, 1, "a second click while adding does nothing");

  pending[0].reject(new ApiError("The open models have no sample drawings.", 409));
  await flush();
  tree = live.DrawingsPanel(props);
  const failed = text(renderToStaticMarkup(tree));
  assert.match(failed, /Adding the sample drawings failed: The open models have no sample drawings\. Retry Dismiss/);
  assert.match(failed, /Add the sample drawings/);
  assert.equal(button(tree).props.disabled, false);
  find(tree, (n) => typeof n.props?.onRetry === "function" && /sample drawings failed/.test(n.props.message)).props.onRetry();
  assert.equal(pending.length, 2, "Retry adds them again");
  tree = live.DrawingsPanel(props);
  assert.doesNotMatch(text(renderToStaticMarkup(tree)), /failed/);
  pending[1].resolve([SHEET]);
  await flush();
  tree = live.DrawingsPanel(props);
  assert.equal(button(tree).props.disabled, false);
  assert.match(text(renderToStaticMarkup(tree)), /No drawings to hand\? Add the sample drawings/);

  // onSamples that returns nothing: the state is simply cleared.
  globalThis.__dwgState = {};
  let n = 0;
  const plain = { ...props, onSamples: () => { n++; } };
  button(live.DrawingsPanel(plain)).props.onClick();
  assert.equal(n, 1);
  assert.equal(button(live.DrawingsPanel(plain)).props.disabled, false);
  assert.doesNotMatch(renderToStaticMarkup(live.DrawingsPanel(plain)), /Adding the sample drawings/);
});

test("a saved sheet says so once under its header, carries a Saved reading badge, and its Read button replays", () => {
  const html = renderToStaticMarkup(panel({ drawings: [SHEET, LIVE] }));
  const t = text(html);
  assert.match(html, /<p class="dwg-saved" role="note" data-dwg="saved"/);
  assert.equal(html.match(/data-dwg="saved"/g)?.length, 1, "one note");
  assert.match(t, /Saved AI reading of this sample \(Gemini 3\.8 Flash\): replayed at no cost, not read live\./);
  assert.match(html, /<svg[^>]*lucide-history/, "with its small icon");
  assert.equal(html.match(/data-dwg="saved-badge"/g)?.length, 1, "the badge on the saved sheet only");
  assert.match(html, /class="dwg-badge dwg-saved-badge" data-dwg="saved-badge" title="A saved Gemini 3\.8 Flash reading of this sample[^"]*">Saved reading<\/span>/);
  assert.match(html, /<button type="button" class="btn small dwg-read" data-dwg="read" title="Replays the saved Gemini 3\.8 Flash reading of this sample: instant, no cost\.">Replay the reading<\/button>/,
    "a replay, never the paid Read with AI, and not the primary button");
  assert.ok(html.indexOf("dwg-view-head") < html.indexOf('data-dwg="saved"'), "under the sheet header");
});

test("a live sheet has no saved note or badge; items read from a saved reading bring the note back after a reload", () => {
  const html = renderToStaticMarkup(panel({ drawings: [LIVE] }));
  assert.doesNotMatch(html, /dwg-saved|Saved reading|saved reading/i);
  assert.match(html, /title="Gemini reads tags, types and sizes; the text layer checks them"/);
  const read = renderToStaticMarkup(panel({ drawings: [LIVE], items: { u1: [itemOf("sa-1", { model: "gemini-3.8-flash", saved_reading: SAVED })] } }));
  assert.match(text(read), /Saved AI reading of this sample \(Gemini 3\.8 Flash\): replayed at no cost, not read live\./);
  assert.doesNotMatch(read, /data-dwg="saved-badge"/, "the badge means the whole sheet replays: only from the sheet's own flag");
  assert.doesNotMatch(read, /Replays the saved/);
  assert.deepEqual(ui.evidenceLines({ model: "gemini-3.8-flash", saved_reading: SAVED }), ["Read by gemini-3.8-flash (saved reading, replayed)"]);
  assert.deepEqual(ui.evidenceLines({ saved_reading: SAVED }), ["Read by Gemini 3.8 Flash (saved reading, replayed)"]);
  assert.deepEqual(ui.evidenceLines({ model: "gemini-3.8-flash" }), ["Read by gemini-3.8-flash"]);
  // The reader's evidence: confirmed fields, what the PDF prints instead, a moved box, a shared label.
  assert.deepEqual(ui.evidenceLines({ tag: { text: "CW-R-9" }, text_says: { size: { text: "Ø54" } },
    box_shift: { dx: 0.4, dy: -966.2, anchors: 12 }, label_tags: 3 }), [
    "Text layer confirms “CW-R-9” (tag)", "The PDF prints “Ø54” (size) there",
    "Box moved 0, -966 px: the AI placed this part of the sheet off, measured from 12 tags printed once",
    "One of 3 tags on one label, sharing its size"]);
});

test("the reading line names a replay as the saved reading it is, with its cost", () => {
  const line = (read, drawing = SHEET) => text(renderToStaticMarkup(h(ui.ReadLine, { read, drawing, onRetry: noop })));
  assert.equal(line({ state: "done", count: 186, cost_usd: 0, saved: SAVED }).trim(),
    "Read 1 page: 186 items · Saved AI reading (Gemini 3.8 Flash) · Cost $0 (saved reading)");
  assert.equal(line({ state: "done", count: 3, cost_usd: 0.0042, saved: null }, LIVE).trim(), "Read 1 page: 3 items · Cost $0.0042");
  assert.equal(line({ state: "done", count: 3, cost_usd: 0 }, LIVE).trim(), "Read 1 page: 3 items · Cost $0 (already read, cached)");
  assert.match(line({ state: "reading", page: 0, total: 1, items: 0, saved: true }), /Replaying the saved reading of page 1 of 1/);
  assert.match(line({ state: "reading", page: 0, total: 1, items: 0 }), /Reading page 1 of 1/);
});

test("the saved styles use the AI tokens, light only", () => {
  const rule = (sel) => { const m = new RegExp(`${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(css); assert.ok(m, sel); return m[1]; };
  assert.match(rule(".dwg-saved"), /border-left: 2px dashed var\(--d-ai\)/);
  assert.match(rule(".dwg-saved"), /background: var\(--d-ai-soft\)/);
  assert.match(rule(".dwg-badge.dwg-saved-badge"), /color: var\(--muted\)/, "the badge is neutral");
  assert.ok(rule(".dwg-samples-line"));
});

test("the sample sheets open already read: a saved sheet fetched with no items replays its reading once, a user's PDF waits", () => {
  const none = {};
  assert.deepEqual(ui.autoReplays([SHEET, LIVE], { m201: [], u1: [] }, none).map((x) => x.id), ["m201"], "only the sheet with a saved reading");
  assert.deepEqual(ui.autoReplays([SHEET], {}, none), [], "not before its items are fetched: it may have been read already");
  assert.deepEqual(ui.autoReplays([SHEET], { m201: [itemOf("sa-1")] }, none), [], "read already: nothing to replay");
  assert.deepEqual(ui.autoReplays([SHEET], { m201: [] }, { m201: { state: "reading", page: null, total: 1, items: 0 } }), [], "replaying now");
  assert.deepEqual(ui.autoReplays([SHEET], { m201: [] }, { m201: { state: "error", message: "x" } }), [], "a failure waits for Retry");
  assert.deepEqual(ui.autoReplays([LIVE], { u1: [] }, none), [], "the user's own PDF: a live reading costs, so it waits for a click");

  // Opening the page: the saved sheet's reading starts by itself, once; the user's PDF is not read.
  globalThis.__dwgState = {};
  const calls = [];
  const onRead = (did) => { calls.push(did); return new Promise(() => {}); };
  const props = { sceneId: "s1", drawings: [SHEET, LIVE], items: { m201: [], u1: [] }, compare: null, onUpload: noop, onRead, onFocusElement: noop };
  effects.DrawingsPanel(props);
  effects.DrawingsPanel(props);
  assert.deepEqual(calls, ["m201"], "the sample sheet replayed once; the uploaded one left for Read with AI");
  const t = text(renderToStaticMarkup(live.DrawingsPanel(props)));
  assert.match(t, /Northbank M-201\.pdf .*Saved reading Opening the saved reading…/, "the card says it is opening, never 'Not read yet'");
  assert.match(t, /Replaying the saved reading|Starting the reading…/);
  assert.match(t, /Replaying…/);

  // The page busy elsewhere: the replay waits, then starts once it is free.
  globalThis.__dwgState = {};
  calls.length = 0;
  effects.DrawingsPanel({ ...props, busy: true });
  assert.deepEqual(calls, []);
  effects.DrawingsPanel(props);
  assert.deepEqual(calls, ["m201"]);

  // Before its items arrive the card still says it is opening; a user's PDF says it is not read yet.
  globalThis.__dwgState = {};
  const before = text(renderToStaticMarkup(live.DrawingsPanel({ ...props, items: {} })));
  assert.match(before, /Saved reading Opening the saved reading…/);
  assert.match(before, /Own sheet\.pdf .*Not read yet/);
  assert.doesNotMatch(before.slice(0, before.indexOf("Own sheet.pdf")), /Not read yet/, "never both Saved reading and Not read yet");
  assert.match(before, /Opening the saved reading: its items appear here\./);
});

test("phone and desktop: the read button keeps its line, the note sits on its own, the zoom sits under the sheet", () => {
  const rule = (sel) => { const m = new RegExp(`${sel.replace(/[.()>:]/g, "\\$&")} \\{([^}]*)\\}`).exec(css); assert.ok(m, sel); return m[1]; };
  assert.match(rule(".dwg-centre > :not(.dwg-viewer)"), /flex: none/, "nothing above the sheet is squeezed under the next line");
  assert.match(rule(".dwg-read"), /flex: none/);
  assert.match(rule(".dwg-view-head"), /flex-wrap: wrap/);
  assert.doesNotMatch(rule(".dwg-tools"), /position: absolute/, "the zoom never covers the sheet");
  const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(phone, /\.dwg-stage \{[^}]*aspect-ratio: var\(--dwg-sheet-ar/, "on a phone the stage takes the sheet's shape");
  const html = renderToStaticMarkup(panel({ drawings: [SHEET], items: { m201: [itemOf("sa-1")] } }));
  assert.ok(html.indexOf('data-dwg="read"') < html.indexOf('data-dwg="saved"'), "the button in the header, the note after it");
  assert.match(html, /style="--dwg-sheet-ar:2000 \/ 1400"/);
  assert.match(html, /<div class="dwg-foot"><ul class="dwg-legend"[^]*<div class="dwg-tools" role="toolbar" aria-label="Zoom">/);
});

test("white and pink: the selected tab in the pink accent, red for differs, amber for missing, the key in that order", () => {
  const rule = (sel) => { const m = new RegExp(`${sel.replace(/[.()>:"=[\]]/g, "\\$&")} \\{([^}]*)\\}`).exec(css); assert.ok(m, sel); return m[1]; };
  assert.match(rule(".dwg-tabs"), /background: var\(--surface\)/, "white tabs");
  const on = rule('.dwg-tabs [role="tab"][aria-selected="true"]');
  assert.match(on, /color: var\(--accent-ink\)/);
  assert.match(on, /border-bottom-color: var\(--pink, var\(--accent\)\)/);
  for (const part of ["dwg-mis", "dwg-badge", "dwg-mk", "dwg-swatch"]) {
    assert.match(rule(`.${part}.mk-differs`), /var\(--d-failed\)/, `${part}: differs is red`);
    assert.match(rule(`.${part}.mk-missing`), /var\(--warn\)/, `${part}: missing is amber`);
  }
  assert.match(rule(".dwg-mm.mk-differs"), /var\(--d-failed\)/);
  assert.match(rule(".dwg-mm.mk-missing"), /var\(--warn\)/);
  const key = text(renderToStaticMarkup(ui.Legend()));
  assert.match(key, /Confirmed.*AI-read.*Differs from the model Missing/);
  assert.match(renderToStaticMarkup(ui.Legend()), /<li class="dwg-legend-mk"><i class="dwg-swatch mk-differs"/);
  assert.match(rule(".dwg-legend::after"), /order: 1; flex-basis: 100%/, "the mismatches on a row of their own");
});
