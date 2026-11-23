import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { appHost, compiled, projectOf } from "./app-host.mjs";

/** Home (StartScreen.tsx) and its ways in: the greeting, the start tiles ("Try the sample drawings" opens the sample
 * building as a project on its Drawings step with the sample PDF sheets attached, POST .../drawings/samples, in the order
 * sampleDrawings.ts keeps), the demo videos' Watch buttons (DemoVideo.tsx: on the two sample tiles and in the hero),
 * Iris's eight steps (HowIrisWorks.tsx, stubbed here; its own test is how-iris-works) and
 * the recent projects. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const react = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": import.meta.resolve("lucide-react") };
/** A .tsx/.ts module compiled for Node with its own stylesheet left out (Vite bundles it; Node cannot import CSS). */
async function moduleUrl(path, css, deps = {}) {
  const input = await readFile(new URL(path, import.meta.url), "utf8");
  const line = new RegExp(`^import "\\./${css.replace(".", "\\.")}";$`, "m");
  assert.match(input, line, `${path} brings its own stylesheet`);
  let { outputText } = ts.transpileModule(input.replace(line, ""), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  for (const [name, target] of Object.entries({ ...react, ...deps })) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`)
    .replaceAll(`import("${name}")`, `import(${JSON.stringify(target)})`);
  return url(outputText);
}
const glassUrl = await compiled("../src/glassModel.ts");
const holoUrl = await moduleUrl("../src/Holo.tsx", "holo.css", { "./glassModel": glassUrl });
const holo = await import(holoUrl);
const videoUrl = await moduleUrl("../src/DemoVideo.tsx", "demoVideo.css", { "react-dom": import.meta.resolve("react-dom") });
const videos = (await import(videoUrl)).DEMO_VIDEOS;
const FLOW = ["Import", "Understand", "Detect", "Investigate", "Propose", "Validate", "Review", "Report"];
/** HowIrisWorks stands in as one section that names the steps in order, so Home's order shows in its markup. */
const howStub = url(`import { jsx } from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))};
export function HowIrisWorks() { return jsx("section", { className: "hiw", children: "How Iris works: ${FLOW.join(", ")}" }); }`);
/** HeroGlass (three.js) never loads here: a lazy stand-in that never resolves, so the static render shows the still. */
const heroStub = url("export default function HeroGlass() { return null; }; await new Promise(() => {});");
const start = await import(await moduleUrl("../src/StartScreen.tsx", "home.css", { "./HowIrisWorks": howStub, "./Holo": holoUrl,
  "./glassModel": glassUrl, "./HeroGlass": heroStub, "./DemoVideo": videoUrl,
  "./About": url("export const projectName = (files) => files.join(' + ');"),
  "./projectRoute": await compiled("../src/projectRoute.ts"),
  "./projectsApi": await compiled("../src/projectsApi.ts", {
    "./api": url("export class ApiError extends Error {}; export const apiFetch = async () => null; export const apiUrl = (p) => p;") }) }));
const sd = await import(await compiled("../src/sampleDrawings.ts", {}));
const noop = () => {};
/** 15:10 local time on 22 Nov 2026: an afternoon wherever the test runs. */
const NOW = new Date(2026, 10, 22, 15, 10).getTime();
const props = (p = {}) => ({ onProjects: noop, onNewProject: noop, now: NOW, ...p });
const markup = (p) => renderToStaticMarkup(h(start.StartScreen, props(p)));
const startButton = (html, which) => html.match(new RegExp(`<button[^>]*data-start="${which}"[^>]*>.*?</button>`))?.[0];
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The elements StartScreen returns (its own, not its children components'), to call their handlers without a DOM. */
function elements(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) elements(n, out); return out; }
  if (!node || typeof node !== "object" || !node.props) return out;
  out.push(node);
  elements(node.props.children, out);
  return out;
}
const tree = (p) => elements(start.StartScreen(props(p)));
const byStart = (p, which) => tree(p).find((e) => e.props["data-start"] === which);
const plainClick = () => { const e = { button: 0, prevented: false, preventDefault() { e.prevented = true; } }; return e; };
const P = (id, name, fields = {}) => projectOf({ id, name, updated: (NOW - 12 * 60000) / 1000, ...fields });
const kinds = (n) => Array.from({ length: n }, (_, i) => ({ name: `m${i}.ifc`, kind: "IFC", size: 1, sha256: "0" }));

test("the greeting: the time of day and the reviewer's name, or 'there' without one", () => {
  const at = (h) => new Date(2026, 10, 22, h, 5).getTime();
  assert.deepEqual([at(5), at(11), at(12), at(17), at(18), at(23), at(2)].map(start.greetingFor),
    ["Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good evening"]);
  assert.match(markup({ name: "Priya", now: at(9) }), /<p class="home-greeting"><span[^>]*>Good morning, Priya<\/span><\/p>/);
  assert.match(markup({ name: "  " }), /<p class="home-greeting">.*?Good afternoon, there.*?<\/p>/);
  assert.match(markup({}), /<p class="home-greeting">.*?Good afternoon, there.*?<\/p>/, "no name at all");
});

test("the hero: the principle in two lines beside the 3D glass aperture (its still until three loads), the cue down", async () => {
  const html = markup({});
  assert.match(html, /^(<link rel="preload" as="image" href="[^"]+"\/>)*<div class="home">/, "React may hint the stills");
  assert.deepEqual(start.TAGLINE, ["AI proposes. Geometry proves.", "The engineer decides."]);
  assert.match(html, /<h1 class="home-tagline"><span class="home-tagline-line">.*?AI proposes\. Geometry proves\..*?<\/span><span class="home-tagline-line">.*?The engineer decides\..*?<\/span><\/h1>/);
  assert.match(text(html), /Coordinate IFC and STEP models: find the clashes, review fixes the geometry has checked, and report what was decided\./);
  assert.match(html, /<div class="home-hero-text">.*?<\/div><div class="home-art" aria-hidden="true"><div class="hero-glass home-glass"><img class="hero-glass-still" src="\/hero\/aperture\.webp" alt=""\/><\/div><\/div>/,
    "the aperture beside the words, decorative: the still while the live one loads");
  assert.doesNotMatch(html, /holo-ribbon|holo-fan/, "no striped CSS ribbon on Home");
  assert.match(html, /<button type="button" class="home-cue" aria-label="Down to start"><svg/, "the square ↓ cue");
  assert.ok(html.indexOf("home-cue") < html.indexOf("home-body"), "the cue sits in the hero, above the tiles");
  const src = await readFile(new URL("../src/StartScreen.tsx", import.meta.url), "utf8");
  assert.match(src, /lazy\(\(\) => import\("\.\/HeroGlass"\)\)/, "three.js loads after the first paint");
  assert.doesNotMatch(src, /from "\.\/HeroGlass"|from "\.\/glass"|from "three"/, "nothing three.js in Home's own module");
  assert.doesNotMatch(html, /wordmark|by Techjays|start-brand/i, "the shell has the brand");
  const css = await readFile(new URL("../src/home.css", import.meta.url), "utf8");
  assert.match(css, /\.home \{[^}]*height: 100%;[^}]*overflow: hidden auto;/, "scrolls inside the main panel, never sideways");
  assert.doesNotMatch(css, /prefers-color-scheme|\bdark\b/i, "light only");
});

test("three start tiles, styled alike: New project, the sample building, the sample drawings, each with a line", async () => {
  const html = markup({ onSample: noop, onSampleDrawings: noop });
  const order = ["new-project", "sample", "sample-drawings"].map((k) => html.indexOf(`data-start="${k}"`));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `in order: ${order}`);
  const made = startButton(html, "new-project");
  assert.match(made, /class="home-tile home-tile-new"/);
  assert.match(made, /New project/);
  assert.match(made, /<span class="home-tile-line">[^<]+<\/span>/);
  assert.match(startButton(html, "sample"), /Try the sample building.*home-tile-line/);
  assert.match(startButton(html, "sample-drawings"), /^<button type="button" class="home-tile" data-start="sample-drawings".*Try the sample drawings.*home-tile-line/,
    "no tile wears a holo edge or a tint of its own");
  assert.doesNotMatch(html, /holo-edge/);
  const css = await readFile(new URL("../src/home.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.home-tile-new \{[^}]*(dashed|background)/, "New project is not dashed or tinted");
  assert.match(css, /\.home-tile:hover:not\(:disabled\) \{[^}]*border-color/, "the highlight comes on hover only");
  assert.match(html, /<section class="home-tiles" aria-label="Start" style="--tiles:3">/);
  assert.match(markup({}), /style="--tiles:1"/, "no samples listed: New project alone");
  let made2 = 0;
  byStart({ onNewProject: () => made2++ }, "new-project").props.onClick();
  assert.equal(made2, 1, "the tile asks for a new project");
});

test("Watch the demos: a section of its own after the start tiles, before How Iris works; the three cards", () => {
  const html = markup({ onSample: noop, onSampleDrawings: noop });
  const at = (k) => html.indexOf(k);
  assert.ok(at('class="home-tiles"') < at('class="home-section home-demos"') && at('class="home-section home-demos"') < at('class="hiw"'),
    "after the tiles, before How Iris works");
  const section = html.slice(at('class="home-section home-demos"'), at('class="hiw"'));
  assert.match(section, /<h2 class="home-h2" id="home-demos-title">Watch the demos<\/h2>/);
  assert.equal(section.match(/<button type="button" class="home-demo"/g)?.length, 3);
  assert.doesNotMatch(section, /holo-edge/);
});

test("Watch the demo: the 3D video on the sample building's tile, the 2D on the drawings', the full demo under the tagline; nothing loaded until asked", () => {
  const html = markup({ onSample: noop, onSampleDrawings: noop });
  const wraps = html.match(/<div class="home-tile-wrap">.*?<\/div>/g);
  assert.equal(wraps?.length, 2, "the two sample tiles, each in a wrapper");
  for (const [wrap, tile, id, time] of [[wraps[0], "sample", "3d", videos["3d"].duration], [wraps[1], "sample-drawings", "2d", videos["2d"].duration]]) {
    assert.match(wrap, new RegExp(`^<div class="home-tile-wrap"><button type="button" class="home-tile[^"]*" data-start="${tile}"[^>]*>.*?</button>`
      + `<button type="button" class="watch-demo" data-video="${id}"[^>]*>.*?</button></div>$`), `${tile}: the tile, then its Watch button`);
    assert.match(text(wrap), new RegExp(`Watch the demo · ${time}`));
    assert.equal(startButton(html, tile).match(/<button/g).length, 1, `${tile}: no button inside the tile`);
  }
  assert.match(html, /<section class="home-tiles"[^>]*><button type="button" class="home-tile home-tile-new"/, "New project is still a tile of its own");
  const full = html.match(/<button type="button" class="watch-demo watch-demo-hero" data-video="full"[^>]*>.*?<\/button>/)?.[0];
  assert.ok(full, "the full demo in the hero, the larger button (no holo edge: none on Home)");
  assert.ok(text(full).includes(`Watch the full demo · ${videos.full.duration}`));
  const hero = html.slice(html.indexOf('<div class="home-hero-text">'), html.indexOf('<div class="home-body">'));
  assert.ok(hero.indexOf('class="home-tagline"') < hero.indexOf('data-video="full"') && hero.indexOf('data-video="full"') < hero.indexOf('class="home-what"'),
    "under the tagline");
  assert.doesNotMatch(html, /<video|\.mp4|iris-\w+-demo\.vtt/, "no video or captions until one is opened");
  const posters = html.match(/<img [^>]*iris-\w+-demo\.webp[^>]*>/g) ?? [];
  assert.equal(posters.length, 3, "only the Watch the demos cards' posters");
  assert.ok(posters.every((img) => img.includes('loading="lazy"')), "lazy posters");
  assert.deepEqual(markup({}).match(/data-video="\w+"/g), ['data-video="full"', 'data-video="full"', 'data-video="3d"', 'data-video="2d"'],
    "no samples listed: the hero's and the three demo cards");
  let opened = 0;
  byStart({ onSample: () => opened++ }, "sample").props.onClick();
  assert.equal(opened, 1, "the tile's own click is unchanged");
});

test("'Try the sample drawings' shows only when the page can open them, beside 'Try the sample building'", () => {
  const without = markup({ onSample: noop });
  assert.ok(startButton(without, "sample"), "the sample building");
  assert.equal(startButton(without, "sample-drawings"), undefined, "no sample drawings listed: no tile");
  assert.match(without, /style="--tiles:2"/);
  const html = markup({ onSample: noop, onSampleDrawings: noop });
  const b = startButton(html, "sample-drawings");
  assert.ok(b, "the tile, by data-start");
  assert.match(b, /Try the sample drawings/);
  assert.doesNotMatch(b, /disabled/);
  assert.ok(html.indexOf('data-start="sample"') < html.indexOf('data-start="sample-drawings"'), "after the sample building");
});

test("the entry opening spins; both sample tiles wait", () => {
  for (const [busy, p] of [["sample", { sampleBusy: true }], ["drawings", { sampleDrawingsBusy: true }]]) {
    const html = markup({ onSample: noop, onSampleDrawings: noop, ...p });
    const sample = startButton(html, "sample"), drawings = startButton(html, "sample-drawings");
    assert.match(sample, /disabled/); assert.match(drawings, /disabled/);
    assert.equal(/spinner/.test(busy === "sample" ? sample : drawings), true, `${busy}: its tile spins`);
    assert.equal(/aria-busy="true"/.test(busy === "sample" ? sample : drawings), true, `${busy}: and says it is busy`);
    assert.equal(/spinner|aria-busy/.test(busy === "sample" ? drawings : sample), false, `${busy}: the other does not`);
    assert.doesNotMatch(startButton(html, "new-project"), /disabled/, "a new project is still there to make");
  }
  const idle = markup({ onSample: noop, onSampleDrawings: noop });
  assert.doesNotMatch(startButton(idle, "sample-drawings") + startButton(idle, "sample"), /disabled|spinner/);
});

test("recent projects: up to four cards, newest first, each a link with its models, open clashes (never guessed) and when", () => {
  const recent = [
    P("p1", "Tower", { files: kinds(3), counts: { clashes: 464, open: 463, resolved: 1, reviewed: 0 } }),
    P("p2", "Clinic", { files: kinds(1), counts: null }),
    P("p3", "Depot", { files: kinds(2), counts: { clashes: 12, open: 0, resolved: 12, reviewed: 0 } }),
    P("p4", "Empty", { files: [], counts: { clashes: 0, open: 0, resolved: 0, reviewed: 0 } }),
    P("p5", "Fifth", {})];
  const html = markup({ recent, projectHref: (pid) => `/projects/${pid}?x` });
  const cards = html.match(/<a class="home-project"[^>]*>.*?<\/a>/g);
  assert.equal(cards.length, 4, "the first four");
  assert.deepEqual(cards.map((c) => c.match(/data-project="([^"]+)"/)[1]), ["p1", "p2", "p3", "p4"]);
  assert.match(cards[0], /href="\/projects\/p1\?x"/);
  assert.match(text(cards[0]), /Tower 3 models 463 open clashes Updated 12 min ago/);
  assert.match(cards[0], /home-status open/);
  assert.match(text(cards[1]), /Clinic 1 model Not checked/, "no counts known: not checked, no number");
  assert.match(text(cards[2]), /Depot 2 models None open/);
  assert.match(text(cards[3]), /Empty No models yet No clashes/);
  assert.match(markup({ recent: [recent[0]] }), /href="\/projects\/p1"/, "the project's own address by default");
  const opened = [];
  const card = tree({ recent, onOpenProject: (pid) => opened.push(pid) }).find((e) => e.props["data-project"] === "p2");
  const click = plainClick();
  card.props.onClick(click);
  assert.deepEqual(opened, ["p2"]);
  assert.equal(click.prevented, true, "a plain click opens it here");
  card.props.onClick({ ...plainClick(), metaKey: true });
  assert.deepEqual(opened, ["p2"], "a new tab gets the address");
});

test("'All projects' is a link, its plain click handled by onProjects", () => {
  const html = markup({ projectsHref: "/projects?all" });
  assert.match(html, /<a class="home-link" data-start="projects" href="\/projects\?all">All projects<\/a>/);
  let went = 0;
  const link = byStart({ onProjects: () => went++ }, "projects");
  const click = plainClick();
  link.props.onClick(click);
  assert.equal(went, 1); assert.equal(click.prevented, true);
  link.props.onClick({ ...plainClick(), ctrlKey: true });
  assert.equal(went, 1, "ctrl-click: a new tab");
});

test("no projects yet: one inline line and 'Create one'; while listing: light placeholders, not the empty line", () => {
  let made = 0;
  const html = markup({ recent: [] });
  assert.match(text(html), /No projects yet\..*Create one/);
  assert.doesNotMatch(html, /home-skeleton/);
  const create = tree({ recent: [], onNewProject: () => made++ }).find((e) => e.props.className === "home-textbtn");
  create.props.onClick();
  assert.equal(made, 1, "'Create one' asks for a new project");
  const loading = markup({ recentLoading: true });
  assert.equal(loading.match(/home-skeleton/g).length, 3);
  assert.doesNotMatch(loading, /No projects yet/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status">Loading your projects…</);
  const listed = markup({ recentLoading: true, recent: [P("p1", "Tower")] });
  assert.doesNotMatch(listed, /home-skeleton|Loading your projects/, "cards already there stay while the list refreshes");
});

test("Home's order: the hero, the start tiles, Iris's eight steps (HowIrisWorks), then the recent projects", () => {
  const html = markup({});
  assert.doesNotMatch(html, /see-it-work|demo-clip|northbank\.webp|start-pic/, "no demo clips on Home");
  assert.match(html, /<section class="hiw">How Iris works: Import, Understand, Detect, Investigate, Propose, Validate, Review, Report<\/section>/);
  const at = (s) => { const n = html.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(at('class="home-hero"') < at('data-start="new-project"'));
  assert.ok(at('data-start="new-project"') < at('class="hiw"'));
  assert.ok(at('class="hiw"') < at("Recent projects"));
});

test("a step's card opens it on the sample building: onSampleStep goes to HowIrisWorks as onStep, absent without it", () => {
  const steps = [];
  const onSampleStep = (step) => steps.push(step);
  const how = (p) => tree(p).find((e) => e.type?.name === "HowIrisWorks");
  assert.equal(how({ onSampleStep }).props.onStep, onSampleStep);
  how({ onSampleStep }).props.onStep("coordination");
  assert.deepEqual(steps, ["coordination"]);
  assert.equal(how({}).props.onStep, undefined, "static cards without the sample");
});

test("the last session: Resume (primary) and Start fresh (ghost), with what was kept and when, in the server's seconds", () => {
  let resumed = 0, fresh = 0;
  const resume = { files: ["A-MEP.ifc", "A-Str.ifc"], clashes: 14, fixed: 2, agent: false, savedAt: (NOW - 12 * 60000) / 1000,
    onResume: () => resumed++, onFresh: () => fresh++ };
  const html = markup({ resume });
  const card = html.match(/<div class="home-resume" role="region" aria-label="Your last session">.*?<\/div>/)?.[0];
  assert.ok(card, "the card");
  assert.match(text(card), /Resume A-MEP\.ifc \+ A-Str\.ifc · 2 fixes kept · 14 clashes · saved 12 min ago/);
  assert.match(card, /<button type="button" class="btn primary small">Resume<\/button><button type="button" class="btn ghost small">Start fresh<\/button>/);
  assert.match(text(markup({ resume: { ...resume, fixed: 1, clashes: null } })), /Resume .* · 1 fix kept · saved 12 min ago/);
  assert.doesNotMatch(markup({}), /home-resume/, "none without a session");
  const buttons = tree({ resume }).filter((e) => e.type === "button" && /btn/.test(e.props.className ?? ""));
  buttons.find((b) => b.props.children === "Resume").props.onClick();
  buttons.find((b) => b.props.children === "Start fresh").props.onClick();
  assert.deepEqual([resumed, fresh], [1, 1]);
});

test("the mark badge (empty states, loading, Home's quiet lines) and the still motion where there is no window", async () => {
  assert.equal(renderToStaticMarkup(h(holo.MarkBadge, { size: 72 })), '<span class="mark-badge" style="--mb:72px" aria-hidden="true"></span>');
  assert.match(renderToStaticMarkup(h(holo.EmptyState, { title: "No reports yet" })), /<span class="mark-badge empty-state-art" style="--mb:72px" aria-hidden="true"><\/span>/);
  assert.match(renderToStaticMarkup(h(holo.EmptyState, { title: "No projects", glass: "aperture" })),
    /<div class="empty-state "><img class="empty-state-art empty-state-glass" src="\/glass\/aperture\.webp" width="104" height="104" alt="" aria-hidden="true"\/>/,
    "a main empty state may show one 3D glass still in place of the mark");
  assert.equal(holo.HoloRibbon, undefined, "no ribbon any more");
  assert.equal(holo.prefersReducedMotion(), true, "no window: still");
  assert.equal(renderToStaticMarkup(h(holo.TextReveal, { text: "Good morning, Ana", once: "t" })), "<span class=\"\">Good morning, Ana</span>");
  const css = await readFile(new URL("../src/holo.css", import.meta.url), "utf8");
  assert.match(css, /\.mark-badge::after \{[^}]*mask: url\("\/brand\/iris-spinner\.svg"\)/, "the Aperture's blades through a mask");
  assert.doesNotMatch(css, /holo-ribbon|holo-fan/);
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
