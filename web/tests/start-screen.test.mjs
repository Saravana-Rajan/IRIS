import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { appHost, compiled, projectOf } from "./app-host.mjs";

/** The first screen (StartScreen.tsx) and its ways in: "Try the sample drawings" opens the sample building as a project
 * on its Drawings step with the sample PDF sheets attached (POST .../drawings/samples), in the order sampleDrawings.ts
 * keeps; "See it work" (DemoClips.tsx) plays the two demo clips side by side. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const react = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": import.meta.resolve("lucide-react") };
/** DemoClips.tsx with its stylesheet left out (Vite bundles it; Node cannot import CSS). */
async function demoClipsUrl() {
  const input = await readFile(new URL("../src/DemoClips.tsx", import.meta.url), "utf8");
  assert.match(input, /^import "\.\/demoClips\.css";$/m, "the clips bring their own stylesheet");
  let { outputText } = ts.transpileModule(input.replace(/^import "\.\/demoClips\.css";$/m, ""), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  for (const [name, target] of Object.entries(react)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return url(outputText);
}
const clipsUrl = await demoClipsUrl();
const clips = await import(clipsUrl);
const start = await import(await compiled("../src/StartScreen.tsx", { ...react, "./DemoClips": clipsUrl,
  "./About": url("export const projectName = (files) => files.join(' + ');"), "./Brand": url("export function Wordmark(){return null;}") }));
const sd = await import(await compiled("../src/sampleDrawings.ts", {}));
const noop = () => {};
const markup = (props) => renderToStaticMarkup(h(start.StartScreen, { onProjects: noop, ...props }));
const startButton = (html, which) => html.match(new RegExp(`<button[^>]*data-start="${which}"[^>]*>.*?</button>`))?.[0];
const entity = (t) => t.replaceAll("'", "&#x27;");

test("'Try the sample drawings' shows only when the page can open them, beside 'Try the sample building'", () => {
  const without = markup({ onSample: noop });
  assert.ok(startButton(without, "sample"), "the sample building");
  assert.equal(startButton(without, "sample-drawings"), undefined, "no sample drawings listed: no button");
  const html = markup({ onSample: noop, onSampleDrawings: noop });
  const b = startButton(html, "sample-drawings");
  assert.ok(b, "the button, by data-start");
  assert.match(b, /Try the sample drawings/);
  assert.doesNotMatch(b, /disabled/);
  assert.ok(html.indexOf('data-start="sample"') < html.indexOf('data-start="sample-drawings"'), "after the sample building");
});

test("the entry opening spins; both sample buttons wait", () => {
  for (const [busy, props] of [["sample", { sampleBusy: true }], ["drawings", { sampleDrawingsBusy: true }]]) {
    const html = markup({ onSample: noop, onSampleDrawings: noop, ...props });
    const sample = startButton(html, "sample"), drawings = startButton(html, "sample-drawings");
    assert.match(sample, /disabled/); assert.match(drawings, /disabled/);
    assert.equal(/spinner/.test(busy === "sample" ? sample : drawings), true, `${busy}: its button spins`);
    assert.equal(/spinner/.test(busy === "sample" ? drawings : sample), false, `${busy}: the other does not`);
  }
  const idle = markup({ onSample: noop, onSampleDrawings: noop });
  assert.doesNotMatch(startButton(idle, "sample-drawings") + startButton(idle, "sample"), /disabled|spinner/);
});

test("the first screen shows the demo clips where the Northbank still was", () => {
  const html = markup({});
  assert.match(html, /<figure[^>]*data-start="see-it-work"/);
  assert.doesNotMatch(html, /northbank\.webp|start-pic/, "the still it replaces is gone");
});

test("'See it work': the 3D check and the 2D reader side by side, each lazily, sized, captioned, its still under reduced motion", () => {
  assert.deepEqual(clips.DEMO_CLIPS.map((c) => [c.id, c.label, c.src, c.still]), [
    ["check", "3D clash check", "/demos/check.webp", "/demos/check-still.webp"],
    ["drawings", "2D drawing reader", "/demos/drawings.webp", "/demos/drawings-still.webp"]]);
  assert.equal(clips.DEMO_CLIPS[0].caption, "Northbank's check: the clashes found, numbered and listed.");
  assert.equal(clips.DEMO_CLIPS[1].caption, "The sample sheets read by Gemini, checked against the PDF's own text, then compared with the 3D model.");
  const html = renderToStaticMarkup(h(clips.DemoClips));
  assert.match(html, /^<figure[^>]*data-start="see-it-work"/);
  assert.match(html, />See it work</);
  assert.equal(html.match(/<img[^>]*>/g).length, 2, "both clips at once");
  for (const c of clips.DEMO_CLIPS) {
    const item = html.match(new RegExp(`<figure[^>]*data-clip="${c.id}"[^>]*>.*?</figure>`))?.[0];
    assert.ok(item, `${c.id}: its own figure, by data-clip`);
    assert.ok(item.includes(`>${c.label}<`), `${c.id}: its label`);
    assert.ok(item.includes(`<source media="(prefers-reduced-motion: reduce)" srcSet="${c.still}"/>`), `${c.id}: its still under reduced motion`);
    const img = item.match(/<img[^>]*>/)[0];
    for (const attr of [`src="${c.src}"`, 'width="1000"', 'height="625"', 'loading="lazy"', `alt="${entity(c.alt)}"`])
      assert.ok(img.includes(attr), `${c.id}: ${attr}`);
    assert.ok(c.alt.length > 60, `${c.id}: alt text that says what it shows`);
    assert.ok(item.includes(`<figcaption class="demo-clip-caption">${entity(c.caption)}</figcaption>`), `${c.id}: its caption`);
  }
  assert.ok(html.indexOf('data-clip="check"') < html.indexOf('data-clip="drawings"'), "3D first");
});

test("the clips' stylesheet is light, on the page's tokens: side by side, stacked when there is no room", async () => {
  const css = await readFile(new URL("../src/demoClips.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|prefers-color-scheme|\bdark\b/i, "colours only from tokens, no dark mode");
  assert.match(css, /\.demo-clips-row \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, \d+px\), 1fr\)\)/);
});

// ------------------------------------------------------------------------------------------------- sampleDrawings.ts

const SAMPLE_P = (fields = {}) => ({ id: "p", name: "Sample", scene_id: null, files: [], ...fields });
/** A page that logs every call in order; `over` replaces any of them. */
function fakePage(over = {}) {
  const log = [];
  const page = { sceneId: null, log,
    sampleProject: async () => { log.push(["project"]); return { p: SAMPLE_P(), made: true }; },
    show: (p) => log.push(["show", p.id]),
    open: async (names) => { log.push(["open", names]); return "s1"; },
    openProject: async (p, opened) => { log.push(["openProject", p.id]); const ok = await opened("s2"); log.push(["projectCheck", ok]); return "s2"; },
    attach: async (sid) => { log.push(["attach", sid]); return []; },
    keep: async (pid, sid) => { log.push(["keep", pid, sid]); },
    check: async (sid) => { log.push(["check", sid]); },
    listed: () => log.push(["listed"]),
    busy: (label) => log.push(["busy", label]),
    fail: (message) => log.push(["fail", message]),
    ...over };
  return page;
}

test("a new sample project: opened, sheets attached and listed, kept with the project, then checked", async () => {
  const page = fakePage();
  assert.equal(await sd.openSampleDrawings(["A.ifc", "B.ifc"], page), "s1");
  assert.deepEqual(page.log, [["busy", sd.SAMPLE_DRAWINGS_BUSY], ["project"], ["show", "p"], ["busy", null], ["open", ["A.ifc", "B.ifc"]],
    ["busy", sd.ADDING_SAMPLE_DRAWINGS], ["attach", "s1"], ["listed"], ["keep", "p", "s1"], ["busy", null], ["check", "s1"]]);
});

test("found again and not open here: opened as a project, the sheets attached before its check", async () => {
  const page = fakePage({ sceneId: "other", sampleProject: async () => ({ p: SAMPLE_P({ scene_id: "gone" }), made: false }) });
  assert.equal(await sd.openSampleDrawings(["A.ifc"], page), "s2");
  assert.deepEqual(page.log, [["busy", sd.SAMPLE_DRAWINGS_BUSY], ["show", "p"], ["busy", null], ["openProject", "p"],
    ["attach", "s2"], ["listed"], ["projectCheck", true]]);
});

test("found again and open here: the sheets attached at once, no opening, no check", async () => {
  const page = fakePage({ sceneId: "here", sampleProject: async () => ({ p: SAMPLE_P({ scene_id: "here" }), made: false }) });
  assert.equal(await sd.openSampleDrawings(["A.ifc"], page), "here");
  assert.deepEqual(page.log, [["busy", sd.SAMPLE_DRAWINGS_BUSY], ["show", "p"], ["busy", sd.ADDING_SAMPLE_DRAWINGS], ["attach", "here"],
    ["listed"], ["busy", null]]);
});

test("a refused attach is said, the models still kept, and no check runs over the error", async () => {
  const page = fakePage({ attach: async () => { throw new Error("The open models have no sample drawings."); } });
  assert.equal(await sd.openSampleDrawings(["A.ifc"], page), "s1");
  assert.deepEqual(page.log.filter(([k]) => ["fail", "keep", "check", "listed"].includes(k)),
    [["fail", "Could not open the sample drawings: The open models have no sample drawings."], ["listed"], ["keep", "p", "s1"]]);
  const opened = fakePage({ sampleProject: async () => ({ p: SAMPLE_P(), made: false }), attach: async () => { throw new Error("No room."); } });
  await sd.openSampleDrawings(["A.ifc"], opened);
  assert.deepEqual(opened.log.at(-1), ["projectCheck", false], "a project opened again skips its check too");
});

test("no sample project, no models opened, or no names: nothing more is done", async () => {
  const failing = fakePage({ sampleProject: async () => { throw new Error("Server unreachable"); } });
  assert.equal(await sd.openSampleDrawings(["A.ifc"], failing), null);
  assert.deepEqual(failing.log, [["busy", sd.SAMPLE_DRAWINGS_BUSY], ["fail", "Could not open the sample drawings: Server unreachable"], ["busy", null]]);
  const unopened = fakePage({ open: async () => null });
  assert.equal(await sd.openSampleDrawings(["A.ifc"], unopened), null);
  assert.equal(unopened.log.some(([k]) => k === "attach" || k === "check"), false);
  const none = fakePage();
  assert.equal(await sd.openSampleDrawings([], none), null);
  assert.deepEqual(none.log, []);
});

test("demoOfFiles: the demo whose set holds every open file, by name and case aside (server demos.find)", () => {
  const demos = [{ id: "a", files: ["A-Structure.ifc", "A-MEP.ifc"], context: ["A-Grids.ifc"], drawings: ["A-M-201.pdf"] },
    { id: "b", files: ["B.step"], context: [], drawings: [] }];
  assert.equal(sd.demoOfFiles(["a-structure.IFC", "A-Grids.ifc"], demos)?.id, "a", "a context file and another case");
  assert.equal(sd.demoOfFiles(["models/A-MEP.ifc"], demos)?.id, "a", "by file name");
  assert.equal(sd.demoOfFiles(["A-MEP.ifc", "B.step"], demos), undefined, "files of two sets");
  assert.equal(sd.demoOfFiles(["Tower.ifc"], demos), undefined);
  assert.equal(sd.demoOfFiles([], demos), undefined);
});

// ------------------------------------------------------------------------------------------------------ in the App

const SAMPLE = "Northbank sample building";
const DEMO = { id: "northbank", name: "Northbank", label: "Northbank", kind: "building",
  files: ["Northbank-Structure.ifc", "Northbank-MEP.ifc", "Northbank-Architecture.ifc"],
  context: ["Northbank-Grids.ifc", "Northbank-MEP-Rev04.ifc"], tour: "northbank",
  drawings: ["Northbank-M-201.pdf", "Northbank-M-201-mismatch.pdf"] };
const sheet = (id, name) => ({ id, name, sha256: id, pages: [{ index: 0, width: 1190, height: 842 }], title: {},
  saved_reading: { model: "m", label: "Gemini", at: null } });
const SHEETS = [sheet("d1", DEMO.drawings[0]), sheet("d2", DEMO.drawings[1])];
const kept = (names) => names.map((name) => ({ name, kind: "IFC", size: 1, sha256: "0" }));

/** The server as the page sees it: the samples (with or without drawings), opening, the projects, the drawings routes
 * (through fetch), and the check, which never ends here (so a test sees what the page does while it runs). Every call
 * is logged in order in `seq`. */
async function samplePage({ drawings = DEMO.drawings, mine = [], refuse = null, path = "/home", initial = {} } = {}) {
  const seq = [], held = new Map();
  const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const was = globalThis.fetch;
  globalThis.fetch = async (to, init = {}) => {
    const method = init.method ?? "GET", at = String(to);
    seq.push([method, at]);
    const sid = at.match(/^\/api\/scenes\/([^/]+)\/drawings/)?.[1];
    if (method === "POST" && at.endsWith("/drawings/samples")) {
      if (refuse) return answer(409, { detail: refuse });
      held.set(sid, SHEETS); return answer(200, SHEETS);
    }
    if (at.endsWith("/compare")) return answer(200, { matches: [], mismatches: [] });
    if (at.endsWith("/items")) return answer(200, []);
    if (sid) return answer(200, held.get(sid) ?? []);
    return answer(404, { detail: "Not here" });
  };
  const store = new Map(mine.map((p) => [p.id, p]));
  const host = await appHost({ path, initial: { sceneId: null, stats: null, report: null, clash: null, ...initial },
    api: { samples: async () => ({ files: [...DEMO.files, ...DEMO.context], demos: [{ ...DEMO, drawings }] }),
      open: async (names) => { seq.push(["open", names]); return { id: "scene-s", files: names, step: {}, revision: 1, layout: 1 }; },
      detect: (sid) => { seq.push(["detect", sid]); return new Promise(() => {}); },
      sceneInfo: async (sid) => ({ id: sid, files: DEMO.files, checks: [], report_id: null }) },
    projects: { ids: mine.map((p) => p.id),
      listProjects: async (ids) => { seq.push(["list", ids]); return ids.map((id) => store.get(id)).filter(Boolean); },
      getProject: async (id) => store.get(id) ?? projectOf({ id }),
      createProject: async (name) => { seq.push(["create", name]); const p = projectOf({ id: "p-new", name }); store.set(p.id, p); return p; },
      attachScene: async (id, sid) => { seq.push(["attach", id, sid]);
        const p = projectOf({ id, name: SAMPLE, scene_id: sid, files: kept(DEMO.files), updated: 1700000100 }); store.set(id, p); return p; },
      openProject: async (id) => { seq.push(["openProject", id]); const p = { ...store.get(id), scene_id: "scene-p" }; store.set(id, p);
        return { scene_id: "scene-p", project: p, scene: { id: "scene-p", files: DEMO.files, checks: [], report_id: null } }; } } });
  await host.settle();
  return { host, seq, restore() { host.unmount(); globalThis.fetch = was; } };
}
const settled = async (host) => { for (let i = 0; i < 8; i++) await host.settle(); };
const posted = (seq) => seq.filter(([m, at]) => m === "POST" && at.endsWith("/drawings/samples")).map(([, at]) => at);
const order = (seq, ...keys) => keys.map((k) => seq.findIndex((s) => (typeof k === "function" ? k(s) : s[0] === k)));

test("the first screen offers the sample drawings only when the samples list them", async () => {
  const none = await samplePage({ drawings: [] });
  assert.equal(none.host.component("StartScreen").props.onSampleDrawings, undefined);
  assert.equal(typeof none.host.component("StartScreen").props.onSample, "function", "the sample building still");
  none.restore();
  const page = await samplePage();
  const screen = page.host.component("StartScreen");
  assert.equal(typeof screen.props.onSampleDrawings, "function");
  assert.equal(screen.props.sampleBusy, false);
  assert.equal(screen.props.sampleDrawingsBusy, false);
  page.restore();
});

test("'Try the sample drawings' makes the sample project, attaches the sheets, keeps them, then checks: on its Drawings step", async () => {
  const { host, seq, restore } = await samplePage();
  host.component("StartScreen").props.onSampleDrawings();
  assert.equal(host.state.projectBusy, "Opening the sample drawings…");
  host.render();
  assert.equal(host.component("StartScreen").props.sampleDrawingsBusy, true, "its button spins");
  assert.equal(host.component("StartScreen").props.sampleBusy, false, "not the sample building's");
  await settled(host);
  assert.equal(host.location.pathname, "/projects/p-new/drawings");
  assert.deepEqual(host.state.route, { view: "project", pid: "p-new", step: "drawings" });
  assert.deepEqual(seq.find((s) => s[0] === "create"), ["create", SAMPLE]);
  assert.deepEqual(seq.find((s) => s[0] === "open"), ["open", DEMO.files], "the sample building's default models");
  assert.deepEqual(posted(seq), ["/api/scenes/scene-s/drawings/samples"]);
  const [opened, attached, keptAt, checked] = order(seq, "open", (s) => s[0] === "POST", "attach", "detect");
  assert.ok(opened < attached && attached < keptAt && keptAt < checked, `opened, sheets attached, kept, then checked: ${JSON.stringify(seq)}`);
  assert.deepEqual(seq[keptAt], ["attach", "p-new", "scene-s"]);
  // The Drawings step shows the sheets while the check runs, and nothing waits on it.
  const panel = host.component("DrawingsPanel");
  assert.ok(panel, "the drawings panel");
  assert.equal(panel.props.sceneId, "scene-s");
  assert.deepEqual(panel.props.drawings.map((d) => d.name), DEMO.drawings);
  assert.ok(host.state.detecting, "the check is running");
  assert.equal(panel.props.busy, false, "and reading is not held up by it");
  assert.equal(host.state.projectBusy, null);
  assert.equal(host.state.error, null);
  assert.equal(typeof panel.props.onSamples, "function", "the open models are the sample set: its drawings are offered");
  restore();
});

test("the sample project found again and opened here: the sheets attached before its check", async () => {
  const old = projectOf({ id: "p-old", name: SAMPLE, files: kept(DEMO.files), scene_id: "gone" });
  const { host, seq, restore } = await samplePage({ mine: [old] });
  host.component("StartScreen").props.onSampleDrawings();
  await settled(host);
  assert.equal(host.location.pathname, "/projects/p-old/drawings");
  assert.equal(seq.some((s) => s[0] === "create"), false, "found again, not made");
  assert.deepEqual(posted(seq), ["/api/scenes/scene-p/drawings/samples"]);
  const [openedAt, attached, checked] = order(seq, "openProject", (s) => s[0] === "POST", "detect");
  assert.ok(openedAt < attached && attached < checked, `opened, sheets attached, then checked: ${JSON.stringify(seq)}`);
  assert.equal(host.state.sceneId, "scene-p");
  assert.deepEqual(host.component("DrawingsPanel").props.drawings.map((d) => d.id), ["d1", "d2"]);
  assert.equal(host.component("DrawingsPanel").props.busy, false);
  restore();
});

test("a refused attach is said as the sample drawings', and no check runs over it (the Clash step checks later)", async () => {
  const { host, seq, restore } = await samplePage({ refuse: "The open models have no sample drawings: they go with the sample building." });
  host.component("StartScreen").props.onSampleDrawings();
  await settled(host);
  assert.equal(posted(seq).length, 1);
  assert.deepEqual(seq.filter((s) => s[0] === "attach"), [["attach", "p-new", "scene-s"]], "the models are kept with the project");
  assert.equal(seq.some((s) => s[0] === "detect"), false, "a check would clear the error line");
  assert.equal(host.state.error, "Could not open the sample drawings: The open models have no sample drawings: they go with the sample building.");
  assert.equal(host.state.projectBusy, null);
  restore();
});

test("the Drawings step offers the sample drawings only for a demo set that has them", async () => {
  const p = projectOf({ id: "p1", name: "Tower", files: kept(DEMO.files), scene_id: "scene" });
  const own = await samplePage({ path: "/projects/p1/drawings", mine: [p], initial: { sceneId: "scene", sceneFiles: ["Tower-MEP.ifc"] } });
  await settled(own.host);
  assert.ok(own.host.component("DrawingsPanel"));
  assert.equal(own.host.component("DrawingsPanel").props.onSamples, undefined, "the visitor's own models: none");
  own.restore();
  const demo = await samplePage({ path: "/projects/p1/drawings", mine: [p],
    initial: { sceneId: "scene", sceneFiles: ["northbank-structure.IFC", "Northbank-Grids.ifc"] } });
  await settled(demo.host);
  const panel = demo.host.component("DrawingsPanel");
  assert.equal(typeof panel.props.onSamples, "function", "a sample set, case aside and with a context file");
  const tries = demo.host.state.drawingsTry;
  const r = await panel.props.onSamples();
  assert.deepEqual(r.map((d) => d.id), ["d1", "d2"]);
  assert.deepEqual(posted(demo.seq), ["/api/scenes/scene/drawings/samples"]);
  assert.equal(demo.host.state.drawingsTry, tries + 1, "listed again");
  await settled(demo.host);
  assert.deepEqual(demo.host.component("DrawingsPanel").props.drawings.map((d) => d.id), ["d1", "d2"]);
  demo.restore();
});
