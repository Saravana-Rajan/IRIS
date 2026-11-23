import assert from "node:assert/strict";
import test from "node:test";
import { appHost, compiled } from "./app-host.mjs";

const r = await import(await compiled("../src/projectRoute.ts"));

test("#projects opens the list and #project/<pid>/<step> opens that project on that step", () => {
  assert.deepEqual(r.parseProjectHash("#projects"), { view: "projects" });
  assert.deepEqual(r.parseProjectHash("#projects/"), { view: "projects" });
  assert.deepEqual(r.parseProjectHash(" #projects "), { view: "projects" });
  assert.deepEqual(r.parseProjectHash("#project/3f9a1c0b2d4e5f6a7b8c9d0e/clash"), { view: "project", pid: "3f9a1c0b2d4e5f6a7b8c9d0e", step: "clash" });
  for (const { id } of r.PROJECT_STEPS) assert.deepEqual(r.parseProjectHash(`#project/abc/${id}`), { view: "project", pid: "abc", step: id });
});

test("a project without a step, or with an unknown one, opens on Overview", () => {
  for (const hash of ["#project/abc", "#project/abc/", "#project/abc/nonsense", "#project/abc/Overview"]) {
    assert.deepEqual(r.parseProjectHash(hash), { view: "project", pid: "abc", step: "overview" }, hash);
  }
});

test("other hashes are not a project's", () => {
  for (const hash of ["", "#", "#about", "#about/fixes", "#owner", "#projectsx", "#project", "#project/", "#projects/abc",
    "#project/a b/overview", "#project/../x", "#project/abc/clash/more", "#project/abc%2Fdef/overview", `#project/${"a".repeat(65)}`]) {
    assert.equal(r.parseProjectHash(hash), null, hash);
  }
});

test("every route's address leads back to it, and the step is always written", () => {
  assert.equal(r.formatProjectHash({ view: "projects" }), "#projects");
  assert.equal(r.PROJECTS_HASH, "#projects");
  assert.equal(r.projectHash("abc"), "#project/abc/overview");
  assert.equal(r.projectHash("abc", "reports"), "#project/abc/reports");
  for (const { id } of r.PROJECT_STEPS) {
    const route = { view: "project", pid: "0a1b2c", step: id };
    assert.deepEqual(r.parseProjectHash(r.formatProjectHash(route)), route);
  }
});

test("the steps are the contract's six, in order, with their labels", () => {
  assert.deepEqual(r.PROJECT_STEPS.map((s) => s.id), ["overview", "models", "drawings", "coordination", "clash", "reports", "activity"]);
  assert.equal(r.stepLabel("clash"), "Clash review");
  assert.ok(r.isProjectStep("models"));
  assert.ok(!r.isProjectStep("workspace"));
  assert.ok(r.isProjectId("3f9a1c0b2d4e"));
  assert.ok(!r.isProjectId("a/b"));
  assert.ok(!r.isProjectId(""));
});

test("arrow keys move through the steps and wrap round", () => {
  assert.equal(r.stepBeside("overview", 1), "models");
  assert.equal(r.stepBeside("overview", -1), "activity");
  assert.equal(r.stepBeside("activity", 1), "overview");
  assert.equal(r.stepBeside("clash", 7), "clash");
});

test("without a window there is no address, and showing one is a no-op", () => {
  assert.equal(r.currentHash(), "");
  assert.equal(r.currentPath(), "");
  assert.equal(r.currentProjectRoute(), null);
  r.showProjectRoute({ view: "projects" }, true);
  r.showProjectRoute(null, false);
  r.showPath("/home", true);
});

test("a window without a location reads as no address", () => {
  globalThis.window = {};
  try { assert.equal(r.currentHash(), ""); assert.equal(r.currentPath(), ""); } finally { delete globalThis.window; }
});

test("paths: /projects, /projects/<pid> (Overview), /projects/<pid>/<step>, /projects/<pid>/clashes/<n>", () => {
  assert.deepEqual(r.parseProjectPath("/projects"), { view: "projects" });
  assert.deepEqual(r.parseProjectPath("/projects/"), { view: "projects" });
  assert.deepEqual(r.parseProjectPath("/projects/abc"), { view: "project", pid: "abc", step: "overview" });
  assert.deepEqual(r.parseProjectPath("/projects/abc/clashes"), { view: "project", pid: "abc", step: "clash" });
  assert.deepEqual(r.parseProjectPath("/projects/abc/clashes/42"), { view: "project", pid: "abc", step: "clash", clash: 42 });
  assert.deepEqual(r.parseProjectPath("/projects/abc/drawings"), { view: "project", pid: "abc", step: "drawings" });
  assert.deepEqual(r.parseProjectPath("/projects/abc/nonsense"), { view: "project", pid: "abc", step: "overview" });
  for (const p of ["", "/", "/home", "/workspace", "/about", "/projectsx", "/projects/a b", "/projects/abc/clashes/x/y", `/projects/${"a".repeat(65)}`]) {
    assert.equal(r.parseProjectPath(p), null, p);
  }
  for (const { id } of r.PROJECT_STEPS) {
    const route = { view: "project", pid: "0a1b2c", step: id };
    assert.deepEqual(r.parseProjectPath(r.formatProjectPath(route)), route);
  }
  assert.equal(r.formatProjectPath({ view: "project", pid: "abc", step: "overview" }), "/projects/abc");
  assert.equal(r.formatProjectPath({ view: "project", pid: "abc", step: "clash", clash: 7 }), "/projects/abc/clashes/7");
  assert.equal(r.projectPath("abc", "reports"), "/projects/abc/reports");
});

test("old hashes become paths", () => {
  assert.equal(r.legacyPath("#projects"), "/projects");
  assert.equal(r.legacyPath("#project/abc/clash"), "/projects/abc/clashes");
  assert.equal(r.legacyPath("#project/abc/overview"), "/projects/abc");
  assert.equal(r.legacyPath("#about"), "/about");
  assert.equal(r.legacyPath("#about/fixes"), "/about/fixes");
  assert.equal(r.legacyPath("#owner"), "/settings");
  for (const h of ["", "#", "#demos", "#top"]) assert.equal(r.legacyPath(h), null, h);
});

test("in a page: the route is read from the path (an old hash too), pushed or replaced", () => {
  const calls = [];
  const location = { hash: "", pathname: "/projects/abc/models", search: "?x=1" };
  const go = (kind) => (state, _t, url) => { calls.push([kind, url, state]); const i = url.indexOf("?"); location.pathname = i < 0 ? url : url.slice(0, i); location.hash = ""; };
  globalThis.window = { location, history: { state: { s: 1 }, pushState: go("push"), replaceState: go("replace") } };
  try {
    assert.deepEqual(r.currentProjectRoute(), { view: "project", pid: "abc", step: "models" });
    r.showProjectRoute({ view: "project", pid: "abc", step: "clash", clash: 3 }, true);
    assert.deepEqual(calls.at(-1), ["push", "/projects/abc/clashes/3?x=1", { s: 1 }]);
    r.showProjectRoute({ view: "projects" }, false);
    assert.deepEqual(calls.at(-1), ["replace", "/projects?x=1", { s: 1 }]);
    r.showProjectRoute(null, false, "/workspace");
    assert.deepEqual(calls.at(-1), ["replace", "/workspace?x=1", { s: 1 }]);
    const n = calls.length;
    r.showPath("/workspace", true);
    assert.equal(calls.length, n, "the same address again is not a new entry");
    location.pathname = "/"; location.hash = "#project/xyz/reports";
    assert.deepEqual(r.currentProjectRoute(), { view: "project", pid: "xyz", step: "reports" }, "an old hash still reads");
  } finally { delete globalThis.window; }
});

test("a plain click is the page's; a click meant for a new tab or window is the browser's", () => {
  assert.equal(r.ownClick({ button: 0 }), true);
  for (const e of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) assert.equal(r.ownClick(e), false);
});

test("the app's own pages are known; any other path is not (it shows Page not found)", () => {
  for (const path of ["", "/", "/index.html", "/home", "/home/", "/workspace", "/videos", "/videos/", "/settings", "/help", "/about", "/about/fixes", "/projects",
    "/projects/", "/projects/abc", "/projects/abc/clashes/3", "/projects/abc/reports"]) assert.equal(r.isAppPath(path), true, path);
  for (const path of ["/nope-page", "/elsewhere", "/homes", "/home/x", "/projects/a b", "/about/a/b", "/Projects", "/settings/x",
    "/demos", "/videos/x", "/video"]) {
    assert.equal(r.isAppPath(path), false, path);
  }
});

test("an unknown address shows the app's Page not found, not Home, and its Home button goes Home", async () => {
  const host = await appHost({ path: "/nope-page", initial: { sceneId: null, stats: null, report: null, clash: null } });
  await host.settle();
  const lost = host.component("NotFound");
  assert.ok(lost, "Page not found is shown");
  assert.equal(host.component("StartScreen"), undefined, "not Home");
  lost.props.onHome(); host.render();
  assert.equal(host.location.pathname, "/home");
  assert.ok(host.component("StartScreen"));
  assert.equal(host.component("NotFound"), undefined);
});

test("a project's address shows the workspace only for a known project: a missing one's every step is the not-found page", () => {
  assert.deepEqual(r.PROJECT_STEPS.filter((t) => r.isWorkStep(t.id)).map((t) => t.id), ["models", "coordination", "clash"]);
  assert.equal(r.isWorkStep(null), false);
  for (const { id } of r.PROJECT_STEPS) {
    assert.equal(r.projectView(id, true, false), r.isWorkStep(id) ? "workspace" : "page", id);
    assert.equal(r.projectView(id, false, true), "missing", `${id}: a missing project's step is not found, never the workspace`);
    assert.equal(r.projectView(id, false, false), "loading", `${id}: read first`);
  }
  for (const path of ["/projects/doesnotexist123", "/projects/doesnotexist123/models", "/projects/doesnotexist123/coordination",
    "/projects/doesnotexist123/drawings", "/projects/doesnotexist123/clashes", "/projects/doesnotexist123/clashes/5",
    "/projects/doesnotexist123/reports", "/projects/doesnotexist123/activity", "/projects/doesnotexist123/nonsense"]) {
    const route = r.parseProjectPath(path);
    assert.equal(route.view, "project", path);
    assert.equal(r.projectView(route.step, false, true), "missing", path);
  }
});
