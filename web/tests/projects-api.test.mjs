import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled } from "./app-host.mjs";

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

/** A component compiled with its own modules; its stylesheet import is dropped (Vite's job, not Node's). */
async function component(path) {
  const url = await compiled(path, { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "lucide-react": import.meta.resolve("lucide-react"), "./projectsApi": projectsUrl, "./projectRoute": routeUrl });
  const js = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString().replace('import "./projects.css";', "");
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const { ProjectsHome, PROJECT_FLOW } = await component("../src/ProjectsHome.tsx");
const { ProjectOverview, ProjectSteps } = await component("../src/ProjectOverview.tsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = () => {};

test("the projects home lists each project's models, numbers and last save, and claims nothing it doesn't know", () => {
  const fresh = project({ id: "bb", name: "Empty site", files: [], counts: null, reviews: {}, saved: [], updated: sec(NOW + 60_000) });   // fixed time, not the clock: newest regardless of time zone
  const html = renderToStaticMarkup(h(ProjectsHome, { projects: [project(), fresh], loading: false, onCreate: noop, onOpen: noop, onDemo: noop }));
  const t = text(html);
  assert.match(t, /2 projects in this browser/);
  assert.ok(t.indexOf("Empty site") < t.indexOf("Riverside Block C"), "most recently updated first");
  assert.match(t, /IFC 2 .*STEP 1/);
  assert.match(t, /5 open .*4 resolved .*3 reviewed .*of 12/);
  assert.match(t, /No models/);
  assert.match(t, /Not saved/);
  assert.match(t, /4 edits/);
  assert.match(t, /Open the sample building/);
  assert.doesNotMatch(t, /No projects yet/);
});

test("with no projects the home explains the workflow and offers the sample building", () => {
  const t = text(renderToStaticMarkup(h(ProjectsHome, { projects: [], loading: false, error: "Server unreachable", onCreate: noop, onOpen: noop, onDemo: noop })));
  assert.match(t, /No projects yet/);
  assert.match(t, /Server unreachable/);
  assert.deepEqual(PROJECT_FLOW.map((s) => s.name), ["Import", "Understand", "Detect", "Investigate", "Propose", "Validate", "Review", "Report"]);
  for (const s of PROJECT_FLOW) assert.ok(t.includes(s.name), s.name);
  assert.match(t, /Open the sample building/);
  const loading = text(renderToStaticMarkup(h(ProjectsHome, { projects: [], loading: true, onCreate: noop, onOpen: noop })));
  assert.match(loading, /Loading projects/);
  assert.doesNotMatch(loading, /No projects yet|sample building/);
});

test("the overview shows models, unresolved against resolved, reports, activity, the next step and the future row", () => {
  const props = { project: project(), step: "overview", onStep: noop, reports: project().reports,
    activity: [{ at: Date.now() - 60000, text: "Accepted fix for #42" }], onImport: noop, onOpenWorkspace: noop, onSave: noop };
  const t = text(renderToStaticMarkup(h(ProjectOverview, props)));
  for (const s of ["Overview", "Models", "Coordination", "Clash review", "Reports", "Activity"]) assert.ok(t.includes(s), s);
  assert.match(t, /Structure\.ifc .*MEP\.ifc .*Pump\.step/);
  assert.match(t, /Unresolved 5 .*Resolved 4 .*Reviewed 3/);
  assert.match(t, /last known/);
  assert.match(t, /Next step Review clashes 5 of 12 clashes are open/);
  assert.match(t, /Level 02 clashes/);
  assert.match(renderToStaticMarkup(h(ProjectOverview, props)), /href="\/api\/projects\/3f9a1c0b2d4e5f6a7b8c9d0e\/reports\/d1"/);
  assert.match(t, /Accepted fix for #42/);
  assert.doesNotMatch(t, /Not yet supported/, "PDF drawings are read on the Drawings step");
  assert.match(t, /Saved state 2/);
  const live = text(renderToStaticMarkup(h(ProjectOverview, { ...props, counts: { clashes: 12, open: 0, resolved: 12, reviewed: 0 } })));
  assert.match(live, /Next step Create report/);
  assert.match(live, /from the open session/);
  const empty = text(renderToStaticMarkup(h(ProjectOverview, { ...props, project: project({ files: [], counts: null, reviews: {}, saved: [] }), reports: [], activity: [] })));
  assert.match(empty, /Next step Import models/);
  assert.match(empty, /Not checked yet/);
  assert.match(empty, /No reports yet/);
  assert.match(empty, /Not saved yet/);
});

test("the step bar marks the current step and counts models, open clashes and reports", () => {
  const html = renderToStaticMarkup(h(ProjectSteps, { step: "clash", onStep: noop, project: project(), counts: project().counts, onProjects: noop }));
  assert.match(html, /aria-current="page"[^>]*>Clash review<span class="proj-step-n open">5</);
  assert.match(html, />Models<span class="proj-step-n">3</);
  assert.match(html, />Reports<span class="proj-step-n">1</);
  assert.match(text(html), /Projects .*Riverside Block C/);
  for (const step of ["reports", "activity", "models", "coordination"]) {
    const t = text(renderToStaticMarkup(h(ProjectOverview, { project: project(), step, onStep: noop, reports: project().reports,
      onImport: noop, onOpenWorkspace: noop, onSave: noop, saving: true })));
    assert.match(t, /Saving…/, step);
  }
});
