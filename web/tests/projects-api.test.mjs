import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled, flush } from "./app-host.mjs";

const apiUrl = await compiled("../src/api.ts");
const { ApiError } = await import(apiUrl);
const routeUrl = await compiled("../src/projectRoute.ts");
const projectsUrl = await compiled("../src/projectsApi.ts", { "./api": apiUrl });
const p = await import(projectsUrl);

/** A fetch that records each call and answers from `reply(url, init)`. */
function serve(reply = () => ({})) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers });
    const out = reply(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}
const fail = (status, body) => new Response(body === undefined ? "oops" : JSON.stringify(body), { status });

/** A browser's localStorage, enough for the helpers: a Map behind the Storage methods. */
function storage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

const NOW = new Date(2026, 10, 22, 15, 0, 0).getTime();
const sec = (ms) => Math.floor(ms / 1000);
const project = (over = {}) => ({
  id: "3f9a1c0b2d4e5f6a7b8c9d0e", name: "Riverside Block C", created: sec(NOW - 9 * 86400000), updated: sec(NOW - 2 * 3600000),
  files: [
    { name: "Structure.ifc", kind: "IFC", size: 14_900_000, sha256: "a".repeat(64) },
    { name: "MEP.ifc", kind: "IFC", size: 8_400_000, sha256: "b".repeat(64) },
    { name: "Pump.step", kind: "STEP", size: 900_000, sha256: "c".repeat(64) },
  ],
  scene_id: null,
  saved: [{ n: 1, at: sec(NOW - 86400000 * 2), files: ["MEP.ifc"], edits: 1 }, { n: 2, at: sec(NOW - 3 * 3600000), files: ["MEP.ifc"], edits: 4 }],
  reviews: { "hard|g1|g2": { status: "by_design", at: sec(NOW) }, "hard|g3|g4": { status: "resolved", at: sec(NOW) },
    "clearance|g5|g6": { status: "author", at: sec(NOW) }, "hard|g7|g8": { status: "open", at: sec(NOW) } },
  reports: [{ doc_id: "d1", name: "Level 02 clashes", at: sec(NOW - 3600000), kind: "pdf" }],
  counts: { clashes: 12, open: 5, resolved: 4, reviewed: 3 },
  ...over,
});

/* ---------------------------------------------------------------------------------------------------------------- */

test("each route of the contract is called with its method, path and body", async () => {
  const calls = serve((url) => (url.endsWith("/open") ? { scene_id: "s1", project: { id: "pid" } } : { id: "pid" }));
  await p.createProject("  Block C  ");
  await p.getProject("pid");
  await p.patchProject("pid", { name: "B", counts: { clashes: 3, open: 1, resolved: 2, reviewed: 0 } });
  await p.renameProject("pid", " New name ");
  await p.attachScene("pid", "s1");
  assert.deepEqual(await p.openProject("pid"), { scene_id: "s1", project: { id: "pid" } });
  await p.saveProject("pid", "s1");
  await p.setReview("pid", { key: "hard|a|b", status: "by_design", note: "Sleeve detailed", by: "MEP lead", number: 42, title: "Duct through girder" });
  await p.addReport("pid", { doc_id: "d1", name: "Level 02", kind: "bcf" });
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
    ["POST", "/api/projects", { name: "Block C" }],
    ["GET", "/api/projects/pid", undefined],
    ["PATCH", "/api/projects/pid", { name: "B", counts: { clashes: 3, open: 1, resolved: 2, reviewed: 0 } }],
    ["PATCH", "/api/projects/pid", { name: "New name" }],
    ["POST", "/api/projects/pid/attach", { scene_id: "s1" }],
    ["POST", "/api/projects/pid/open", undefined],
    ["POST", "/api/projects/pid/save", { scene_id: "s1" }],
    ["PUT", "/api/projects/pid/reviews", { key: "hard|a|b", status: "by_design", note: "Sleeve detailed", by: "MEP lead", number: 42, title: "Duct through girder" }],
    ["POST", "/api/projects/pid/reports", { doc_id: "d1", name: "Level 02", kind: "bcf" }],
  ]);
  assert.ok(calls.every((c) => c.headers["Content-Type"] === "application/json"));
  assert.equal(p.projectsApi.saveProject, p.saveProject);
});

test("listing asks for the browser's ids once each, nothing for none, and everything when left out", async () => {
  const calls = serve(() => [project()]);
  assert.deepEqual(await p.listProjects([]), []);
  assert.equal(calls.length, 0, "no ids: no call");
  assert.equal((await p.listProjects(["a1", "b2", "a1"])).length, 1);
  await p.listProjects();
  assert.deepEqual(calls.map((c) => c.url), ["/api/projects?ids=a1,b2", "/api/projects"]);
});

test("more ids than one listing takes are asked in batches, none dropped, newest change first", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
  const calls = serve((url) => new URL(url, "http://x").searchParams.get("ids").split(",").slice(0, 1)
    .map((id) => ({ id, updated: Number(id.slice(2)) })));
  const got = await p.listProjects(ids);
  assert.equal(p.LIST_IDS_MAX, 200);
  assert.deepEqual(calls.map((c) => new URL(c.url, "http://x").searchParams.get("ids").split(",").length), [200, 200, 50]);
  assert.deepEqual(got.map((x) => x.id), ["id400", "id200", "id0"]);
});

test("a report kept with the project downloads from its own route", () => {
  assert.equal(p.projectReportUrl("pid", "d1"), "/api/projects/pid/reports/d1");
  assert.equal(p.projectReportUrl("pid", "a/b"), "/api/projects/pid/reports/a%2Fb");
});

test("an id is sent encoded, so it can never change the path", async () => {
  const calls = serve(() => ({}));
  await p.getProject("a/b?c");
  await p.listProjects(["x,y"]);
  assert.deepEqual(calls.map((c) => c.url), ["/api/projects/a%2Fb%3Fc", "/api/projects?ids=x%2Cy"]);
});

test("a failure is an ApiError with the server's words and status", async () => {
  serve(() => fail(404, { detail: "No such project" }));
  await assert.rejects(p.getProject("gone"), (e) => e instanceof ApiError && e.status === 404 && e.message === "No such project");
  serve(() => fail(422, { detail: [{ loc: ["body", "name"], msg: "Field required" }, { msg: "Too long" }] }));
  await assert.rejects(p.createProject(""), (e) => e.status === 422 && e.message === "Field required; Too long");
  serve(() => fail(500));
  await assert.rejects(p.listProjects(["a"]), (e) => e instanceof ApiError && e.status === 500 && e.message === "Request failed (500)");
  serve(() => fail(429, { detail: { cap: 50 } }));
  await assert.rejects(p.createProject("x"), (e) => e.status === 429 && e.message === "Request failed (429)");
});

/* ---------------------------------------------------------------------------------------------------------------- */

test("the browser keeps its project ids under iris.projects, newest first, once each", () => {
  globalThis.localStorage = storage();
  try {
    assert.deepEqual(p.myProjectIds(), []);
    p.rememberProject("aa");
    p.rememberProject("bb");
    assert.deepEqual(p.rememberProject("aa"), ["aa", "bb"]);
    assert.equal(localStorage.getItem("iris.projects"), JSON.stringify(["aa", "bb"]));
    assert.equal(p.PROJECTS_KEY, "iris.projects");
    assert.deepEqual(p.forgetProject("aa"), ["bb"]);
    assert.deepEqual(p.rememberProject("not/an/id"), ["bb"], "nothing path-like is kept");
  } finally { delete globalThis.localStorage; }
});

test("what is kept is checked when read: junk, other types and duplicates are dropped", () => {
  for (const [raw, want] of [["{not json", []], ['{"a":1}', []], ['["aa", 3, null, "aa", "b/c", "bb"]', ["aa", "bb"]]]) {
    globalThis.localStorage = storage({ "iris.projects": raw });
    try { assert.deepEqual(p.myProjectIds(), want, raw); } finally { delete globalThis.localStorage; }
  }
});

test("without storage (tests, a private window) nothing throws", () => {
  assert.deepEqual(p.myProjectIds(), []);
  assert.deepEqual(p.rememberProject("aa"), ["aa"]);
  globalThis.localStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  try {
    assert.deepEqual(p.myProjectIds(), []);
    assert.deepEqual(p.forgetProject("aa"), []);
  } finally { delete globalThis.localStorage; }
});

test("after a list, only ids asked for and not found are forgotten", () => {
  globalThis.localStorage = storage({ "iris.projects": JSON.stringify(["new1", "aa", "bb", "cc"]) });
  try {
    assert.deepEqual(p.pruneProjectIds(["aa", "bb", "cc"], [{ id: "aa" }, { id: "cc" }]), ["new1", "aa", "cc"]);
    assert.deepEqual(p.pruneProjectIds(["aa"], [{ id: "aa" }]), ["new1", "aa", "cc"]);
  } finally { delete globalThis.localStorage; }
});

/* ---------------------------------------------------------------------------------------------------------------- */

test("times read as seconds (server) or milliseconds (page) and show relative, then as dates", () => {
  assert.equal(p.toMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(p.toMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(p.whenText(NOW - 10_000, NOW), "just now");
  assert.equal(p.whenText(sec(NOW - 12 * 60000), NOW), "12 min ago");
  assert.equal(p.whenText(NOW - 3 * 3600000, NOW), "3 h ago");
  assert.equal(p.whenText(new Date(2026, 10, 21, 9).getTime(), NOW), "yesterday");
  assert.equal(p.whenText(new Date(2026, 10, 18, 9).getTime(), NOW), "4 days ago");
  assert.equal(p.whenText(new Date(2026, 9, 3, 9).getTime(), NOW), "3 Oct");
  assert.equal(p.whenText(new Date(2025, 11, 30, 9).getTime(), NOW), "30 Dec 2025");
});

test("sizes, plurals, the model mix and the clash key", () => {
  assert.deepEqual([512, 2048, 14_900_000, 3 * 1024 ** 3].map(p.sizeText), ["512 B", "2 KB", "14.2 MB", "3.0 GB"]);
  assert.equal(p.plural(1, "model"), "1 model");
  assert.equal(p.plural(3, "clash", "clashes"), "3 clashes");
  assert.deepEqual(p.modelMix(project().files), [{ kind: "IFC", n: 2 }, { kind: "STEP", n: 1 }]);
  assert.deepEqual(p.modelMix([]), []);
  assert.equal(p.clashKey("hard", "zz", "aa"), "hard|aa|zz");
});

test("last saved, the review tally and which numbers are shown", () => {
  assert.equal(p.lastSaved(project()).n, 2);
  assert.equal(p.lastSaved(project({ saved: [] })), null);
  assert.deepEqual(p.reviewTally(project().reviews), { open: 1, by_design: 1, author: 1, resolved: 1 });
  const live = { clashes: 1, open: 0, resolved: 1, reviewed: 0 };
  assert.deepEqual(p.knownCounts(project(), live), { counts: live, live: true });
  assert.deepEqual(p.knownCounts(project(), null), { counts: project().counts, live: false });
  assert.equal(p.knownCounts(project({ counts: null }), undefined), null);
});

test("the next step follows the project's real state", () => {
  const none = p.nextAction(project({ files: [] }), null);
  assert.deepEqual([none.kind, none.step, none.title], ["import", "models", "Import models"]);
  const unchecked = p.nextAction(project(), null);
  assert.deepEqual([unchecked.kind, unchecked.step, unchecked.title], ["detect", "coordination", "Run coordination"]);
  assert.match(unchecked.detail, /3 models imported/);
  const open = p.nextAction(project(), { clashes: 12, open: 5, resolved: 4, reviewed: 3 });
  assert.deepEqual([open.kind, open.step, open.title], ["review", "clash", "Review clashes"]);
  assert.match(open.detail, /^5 of 12 clashes are open/);
  assert.match(p.nextAction(project(), { clashes: 12, open: 1, resolved: 11, reviewed: 0 }).detail, /^1 of 12 clashes is open/);
  const done = p.nextAction(project(), { clashes: 12, open: 0, resolved: 9, reviewed: 3 });
  assert.deepEqual([done.kind, done.step, done.title], ["report", "reports", "Create report"]);
  assert.match(done.detail, /All 12 clashes are resolved or reviewed.*1 report so far/);
  assert.match(p.nextAction(project({ reports: [] }), { clashes: 0, open: 0, resolved: 0, reviewed: 0 }).detail, /found no clashes/);
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* The pages render real state (server render; React, lucide and the modules above are the real ones)              */


const REAL = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": import.meta.resolve("lucide-react"), "./projectsApi": projectsUrl, "./projectRoute": routeUrl };

/** A module compiled with its own modules (`deps` on top of the real ones above); its stylesheet imports are dropped
 *  (Vite's job, not Node's). Returns the module's URL. */
async function module(path, deps = {}) {
  const url = await compiled(path, { ...REAL, ...deps });
  const js = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString().replace(/^import "\.\/[\w.-]+\.css";$/gm, "");
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}
const pages = { "./Holo": await module("../src/Holo.tsx"), "./PageHeader": await module("../src/PageHeader.tsx") };
const { ProjectsHome, ProjectRow, NewProjectDialog, PROJECT_FLOW, projectStatus } = await import(await module("../src/ProjectsHome.tsx", pages));
const { ProjectOverview } = await import(await module("../src/ProjectOverview.tsx", pages));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};
const home = (over = {}) => renderToStaticMarkup(h(ProjectsHome, { projects: [], loading: false, onNew: noop, onOpen: noop, ...over }));

test("the workflow a project follows is still exported for Home", () => {
  assert.deepEqual(PROJECT_FLOW.map((s) => s.name), ["Import", "Understand", "Detect", "Investigate", "Propose", "Validate", "Review", "Report"]);
});

test("a project's status pill says only what is known: models, the last numbers, else the decisions", () => {
  const s = (over) => projectStatus(project(over));
  assert.deepEqual(s({}), { key: "open", label: "Open issues" });
  assert.deepEqual(s({ counts: { clashes: 0, open: 0, resolved: 0, reviewed: 0 } }), { key: "clear", label: "All clear" });
  assert.deepEqual(s({ counts: { clashes: 12, open: 0, resolved: 9, reviewed: 3 } }), { key: "resolved", label: "Resolved" });
  assert.deepEqual(s({ counts: null }), { key: "review", label: "In review" }, "decisions recorded, no numbers");
  assert.deepEqual(s({ counts: null, reviews: {} }), { key: "unchecked", label: "Not checked" });
  assert.deepEqual(s({ counts: null, reviews: {}, files: [] }), { key: "none", label: "No models" });
});

test("the projects table: newest first, models, clashes, open, a status pill, the last save; nothing it doesn't know", () => {
  const fresh = project({ id: "bb", name: "Empty site", files: [], counts: null, reviews: {}, saved: [], updated: sec(NOW + 60_000) });   // fixed time, not the clock: newest regardless of time zone
  const html = home({ projects: [project(), fresh], onDemo: noop, hrefOf: (id) => `/projects/${id}` });
  const t = text(html);
  assert.match(t, /Projects 2 projects in this browser/);
  assert.ok(t.indexOf("Empty site") < t.indexOf("Riverside Block C"), "most recently updated first");
  assert.match(t, /Name Models Clashes Open Status Last saved/);
  assert.match(t, /Riverside Block C Updated [^·]+? 3 IFC 2 STEP 1 12 5 Open issues [^·]+ · 4 edits/);   // times are relative to the clock
  assert.match(t, /Empty site Updated [^—]+ — — — No models Not saved/, "no numbers claimed: dashes, not zeros");
  assert.match(html, /<span class="pchip open">Open issues<\/span>/);
  assert.match(html, /<span class="proj-num mono proj-open has">5<\/span>/, "open shows red only above zero");
  assert.match(html, /<a class="proj-name" href="\/projects\/3f9a1c0b2d4e5f6a7b8c9d0e"/);
  assert.match(t, /Open the sample building/);
  assert.doesNotMatch(t, /Start your first project|Create project/, "no inline create form: the shell's top bar has New project");
});

test("tabs filter by status and count each one", () => {
  const clear = project({ id: "c1", name: "Clear one", counts: { clashes: 4, open: 0, resolved: 4, reviewed: 0 } });
  const unchecked = project({ id: "u1", name: "Unchecked", counts: null, reviews: {} });
  const html = home({ projects: [project(), clear, unchecked] });
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab" aria-selected="true"[^>]*>All<span class="proj-tab-n">3</);
  assert.match(text(html), /Needs review 1 Clear 1 Not checked 1/);
});

test("each row has a menu: Open (a link), Rename and Remove from this browser, closed until asked", () => {
  const html = home({ projects: [project()], onRename: noop, onRemove: noop, hrefOf: (id) => `/projects/${id}` });
  assert.match(html, /aria-label="Actions for Riverside Block C" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /role="menu" aria-label="Actions for Riverside Block C" hidden=""/);
  const items = [...html.matchAll(/role="menuitem"[^>]*>(.*?)<\/(a|button)>/g)].map((m) => text(m[1]).trim());
  assert.deepEqual(items, ["Open", "Rename", "Remove from this browser"]);
  assert.match(html, /<a role="menuitem" tabindex="-1" class="proj-menu-item" href="\/projects\/3f9a1c0b2d4e5f6a7b8c9d0e"/);
  const bare = home({ projects: [project()] });
  assert.deepEqual([...bare.matchAll(/role="menuitem"[^>]*>(.*?)<\/(a|button)>/g)].map((m) => text(m[1]).trim()), ["Open"],
    "no rename or remove without their handlers");
});

test("renaming puts the name in a field; removing asks first and says the server keeps it", () => {
  const row = (mode) => renderToStaticMarkup(h("table", null, h("tbody", null,
    h(ProjectRow, { p: project(), mode, onOpen: noop, onRename: noop, onRemove: noop }))));
  const renaming = row("rename");
  const field = renaming.match(/<input[^>]*class="proj-input"[^>]*>/)?.[0] ?? "";
  assert.match(field, /value="Riverside Block C"/);
  assert.match(field, /maxLength="120"/i);
  assert.match(text(renaming), /Enter to save · Esc to cancel/);
  const removing = text(row("remove"));
  assert.match(removing, /Remove “Riverside Block C” from this browser\? The project stays on the server/);
  assert.match(removing, /Cancel Remove/);
  assert.doesNotMatch(text(row("idle")), /from this browser\?/);
});

test("with no projects: an empty state with New project and the sample building", () => {
  const t = text(home({ error: "Server unreachable", onDemo: noop }));
  assert.match(t, /Start your first project/);
  assert.match(t, /Server unreachable/);
  assert.match(t, /New project Try the sample building/);
  assert.doesNotMatch(t, /Open the sample building/, "the header doesn't repeat the empty state's offer");
  assert.doesNotMatch(text(home()), /sample building/);
  const loading = text(home({ loading: true }));
  assert.match(loading, /Loading projects/);
  assert.doesNotMatch(loading, /Start your first project|sample building/);
});

test("the new project dialog: a light modal with one required name, Cancel and Create project", () => {
  const html = renderToStaticMarkup(h(NewProjectDialog, { onCreate: noop, onClose: noop }));
  assert.match(html, /class="proj-veil"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(text(html), /New project .*Project name/);
  assert.match(html, /<input[^>]*maxLength="120" required=""/i);
  assert.match(html, /type="button" class="btn"[^>]*>Cancel</);
  assert.match(html, /type="submit" class="btn primary" disabled="">\s*Create project/, "empty name: nothing to create");
  const busy = renderToStaticMarkup(h(NewProjectDialog, { onCreate: noop, onClose: noop, busy: true, error: "Too many projects" }));
  assert.match(text(busy), /Too many projects .*Creating…/);
  assert.match(busy, /role="alert"/);
});

const overview = (over = {}) => ({ project: project(), step: "overview", onStep: noop, reports: project().reports,
  activity: [{ at: Date.now() - 60000, text: "Accepted fix for #42" }], onImport: noop, onOpenWorkspace: noop, onSave: noop, ...over });

test("the overview header: breadcrumb, the project's name, its dates and Save; no step bar", () => {
  const html = renderToStaticMarkup(h(ProjectOverview, overview({ onProjects: noop, projectsHref: "/projects" })));
  assert.match(html, /<nav class="page-crumbs" aria-label="Breadcrumb">/);
  assert.match(html, /<a class="page-crumb" href="\/projects">Projects<\/a>/);
  assert.match(html, /<span class="page-crumb here" aria-current="page">Riverside Block C<\/span>/);
  assert.match(html, /<h1 class="page-title">Riverside Block C<\/h1>/);
  assert.match(text(html), /Created [^·]+? Updated [^·]+? Saved state 2, [^·]+? \(4 edits\)/);   // times are relative to the clock
  assert.match(text(html), /Save/);
  assert.doesNotMatch(html, /proj-step|Project steps/, "the sidebar has the steps");
  assert.doesNotMatch(text(html), /Open workspace →|Import models Open/, "the top bar has the primary action");
  const reports = renderToStaticMarkup(h(ProjectOverview, overview({ step: "reports", onProjects: noop, projectsHref: "/projects",
    stepHref: (s) => `/projects/x/${s}` })));
  assert.match(reports, /href="\/projects\/x\/overview">Riverside Block C<\/a>/);
  assert.match(reports, /<span class="page-crumb here" aria-current="page">Reports<\/span>/);
  assert.match(reports, /<h1 class="page-title">Reports<\/h1>/);
  for (const step of ["reports", "activity", "models", "coordination"]) {
    assert.match(text(renderToStaticMarkup(h(ProjectOverview, overview({ step, saving: true })))), /Saving…/, step);
  }
  const none = renderToStaticMarkup(h(ProjectOverview, overview({ project: project({ files: [] }) })));
  assert.match(none, /<button type="button" class="btn small" disabled=""[^>]*data-tip="Import models first"[^>]*>.*Save<\/button>/,
    "nothing to save without models");
});

test("the stat cards show the known numbers and where they come from, and a dash (never 0) when not known", () => {
  const stats = (o) => text(renderToStaticMarkup(h(ProjectOverview, overview(o))).match(/<ul class="proj-stats".*?<\/ul>/)[0]);
  assert.match(stats({}), /Models 3 2 IFC · 1 STEP Clashes 12 last known Open 5 last known Resolved 4 last known · 3 reviewed/);
  assert.match(stats({ counts: { clashes: 7, open: 2, resolved: 5, reviewed: 0 } }), /Clashes 7 from the open session Open 2 .*Resolved 5 from the open session/);
  assert.match(stats({ project: project({ counts: null }) }), /Clashes — not checked yet Open — not checked yet Resolved — not checked yet/);
  assert.match(stats({ project: project({ files: [], counts: null }) }), /Models 0 none imported yet/);
});

test("the overview body: models, the coordination tally, the next step, recent activity and recent reports", () => {
  const html = renderToStaticMarkup(h(ProjectOverview, overview()));
  const t = text(html);
  assert.match(t, /Structure\.ifc .*MEP\.ifc .*Pump\.step/);
  assert.match(t, /Unresolved 5 .*Resolved 4 .*Reviewed 3/);
  assert.match(t, /last known, as of the last session/);
  assert.match(t, /Next step Review clashes 5 of 12 clashes are open/);
  assert.match(t, /Recent activity 1 View all Accepted fix for #42/);
  assert.match(t, /Level 02 clashes/);
  assert.match(html, /href="\/api\/projects\/3f9a1c0b2d4e5f6a7b8c9d0e\/reports\/d1"/);
  assert.match(text(renderToStaticMarkup(h(ProjectOverview, overview({ counts: { clashes: 12, open: 0, resolved: 12, reviewed: 0 } })))),
    /Next step Create report/);
});

test("empty states: no models, no reports, no activity", () => {
  const bare = project({ files: [], counts: null, reviews: {}, saved: [] });
  const t = text(renderToStaticMarkup(h(ProjectOverview, overview({ project: bare, reports: [], activity: [] }))));
  assert.match(t, /Next step Import models/);
  assert.match(t, /No models yet .*Import models/);
  assert.match(t, /No activity yet/);
  assert.match(t, /Not saved yet/);
  assert.doesNotMatch(t, /Coordination/, "nothing to tally without models or numbers");
  const reports = text(renderToStaticMarkup(h(ProjectOverview, overview({ step: "reports", reports: [] }))));
  assert.match(reports, /No reports yet PDF and BCF reports .* Open workspace/);
  const noModels = text(renderToStaticMarkup(h(ProjectOverview, overview({ step: "reports", reports: [], project: bare }))));
  assert.doesNotMatch(noModels, /Open workspace/, "no workspace to open without models");
  const activity = text(renderToStaticMarkup(h(ProjectOverview, overview({ step: "activity", activity: [] }))));
  assert.match(activity, /No activity yet .*Saved states 2/);
  const kids = renderToStaticMarkup(h(ProjectOverview, overview({ step: "drawings" }), h("section", { className: "proj-card" }, "Drawings card")));
  assert.match(kids, /<section class="proj-card">Drawings card<\/section>/, "App's cards follow the step's body");
});

test("the share closed is never rounded to a claim that isn't true", () => {
  assert.equal(p.closedText(1, 464), "<1% closed", "1 of 464 is not 0% closed");
  assert.equal(p.closedText(0, 464), "0% closed");
  assert.equal(p.closedText(464, 464), "100% closed");
  assert.equal(p.closedText(463, 464), ">99% closed", "463 of 464 is not 100% closed");
  assert.equal(p.closedText(7, 12), "58% closed");
  const closed = (c) => text(renderToStaticMarkup(h(ProjectOverview, overview({ counts: c })))).replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .match(/\S+% closed/)?.[0];
  assert.equal(closed({ clashes: 464, open: 463, resolved: 1, reviewed: 0 }), "<1% closed", "1 of 464 is not 0% closed");
  assert.equal(closed({ clashes: 464, open: 464, resolved: 0, reviewed: 0 }), "0% closed");
  assert.equal(closed({ clashes: 464, open: 0, resolved: 464, reviewed: 0 }), "100% closed");
  assert.equal(closed({ clashes: 464, open: 1, resolved: 460, reviewed: 3 }), ">99% closed", "463 of 464 is not 100% closed");
  assert.equal(closed({ clashes: 12, open: 5, resolved: 4, reviewed: 3 }), "58% closed");
});

test("Save says \"Saved ✓\" for about two seconds, and \"Not saved\" with the reason when it fails", async () => {
  // SaveButton driven as a page would: its own hooks kept between renders, its real click handler, the window's timers.
  const fake = `const h=()=>globalThis.__saveHost; export const useState=(v)=>h().useState(v), useRef=(v)=>h().useRef(v), useEffect=()=>{}, useId=()=>"id";`;
  const { SaveButton, SAVED_MS } = await import(await module("../src/ProjectOverview.tsx",
    { ...pages, react: `data:text/javascript;base64,${Buffer.from(fake).toString("base64")}` }));
  const win = globalThis.window;
  let slots = [], i = 0, timers = [];
  globalThis.__saveHost = {
    useState: (v) => { const k = i++; if (!(k in slots)) slots[k] = v; return [slots[k], (n) => { slots[k] = typeof n === "function" ? n(slots[k]) : n; }]; },
    useRef: (v) => { const k = i++; return (slots[k] ??= { current: v }); },
  };
  globalThis.window = { setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {} };
  const mount = (props) => { slots = []; timers = []; return () => { i = 0; return SaveButton(props); }; };
  const face = (el) => ({ t: text(renderToStaticMarkup(el)).trim(), tip: el.props["data-tip"], cls: el.props.className, off: !!el.props.disabled });
  try {
    let resolve;
    const ok = mount({ onSave: () => new Promise((r) => { resolve = r; }), tip: "Save the project" });
    ok().props.onClick();
    assert.deepEqual(face(ok()), { t: "Saving…", tip: "Save the project", cls: "btn small", off: true });
    resolve(true); await flush();
    assert.equal(face(ok()).t, "Saved ✓");
    assert.equal(timers.at(-1).ms, SAVED_MS);
    assert.ok(SAVED_MS >= 1500 && SAVED_MS <= 3000, "about two seconds");
    timers.at(-1).fn();
    assert.equal(face(ok()).t, "Save", "back to Save after");

    const thrown = mount({ onSave: async () => { throw new Error("Server unreachable"); }, tip: "Save the project" });
    thrown().props.onClick(); await flush();
    const bad = face(thrown());
    assert.equal(bad.t, "Not saved");
    assert.match(bad.tip, /not saved: Server unreachable/);
    assert.match(bad.cls, /danger/);
    assert.equal(bad.off, false, "can try again");

    const refused = mount({ onSave: async () => false, tip: "Save the project" });
    refused().props.onClick(); await flush();
    assert.equal(face(refused()).t, "Not saved", "App's save resolves false when it failed");
  } finally { globalThis.window = win; delete globalThis.__saveHost; }
});
