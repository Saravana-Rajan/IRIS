import assert from "node:assert/strict";
import test from "node:test";
import { appHost, find, hasText } from "./app-host.mjs";

/** The app shell wired into the actual App (docs/architecture/12-web-app.md, "The app shell"): the sidebar's pages and
 * their addresses, the collapse to the rail (kept apart for the 3D workspace and the other pages), Home over an open
 * session, the top bar's primary action per page, and Settings and Help from the sidebar. */

const sidebar = (host) => host.component("Sidebar");
const topBar = (host) => host.component("TopBar");
/** The top bar's primary action (after the owner's settings). */
const primary = (host) => [topBar(host).props.actions.props.children].flat()[1];

test("the sidebar's pages: Home over the open session, the projects, back to the workspace, each at its address", async () => {
  const host = await appHost({ path: "/workspace" });
  await host.settle();
  assert.equal(sidebar(host).props.active, "workspace", "models open, no project: the workspace is the page");
  assert.deepEqual(sidebar(host).props.workspace, { label: "Workspace" }, "a session outside a project has its own item");
  assert.equal(sidebar(host).props.hrefOf("home"), "/home");
  assert.equal(sidebar(host).props.hrefOf("projects"), "/projects");
  assert.equal(host.component("StartScreen"), undefined);
  assert.equal(primary(host).props.className, "work-actions", "the workspace's actions: Export and the rest");

  sidebar(host).props.onNav("home"); host.render();
  assert.equal(host.location.pathname, "/home");
  assert.equal(sidebar(host).props.active, "home");
  assert.ok(host.component("StartScreen"), "Home is shown over the open session");
  assert.equal(host.state.sceneId, "scene", "the session stays open behind it");
  assert.equal(primary(host).props["data-shell"], "new-project");
  await host.settle();
  assert.ok(host.projects.calls.some((c) => c[0] === "list"), "Home lists the recent projects");

  sidebar(host).props.onNav("projects"); host.render();
  assert.equal(host.location.pathname, "/projects");
  assert.equal(sidebar(host).props.active, "projects");
  assert.ok(host.component("ProjectsHome"));
  assert.equal(host.component("StartScreen"), undefined);

  sidebar(host).props.onNav("workspace"); host.render();
  assert.equal(host.location.pathname, "/workspace");
  assert.equal(sidebar(host).props.active, "workspace");
  assert.equal(host.component("ProjectsHome"), undefined);
  assert.equal(host.component("StartScreen"), undefined);
  host.unmount();
});

test("the sidebar's Demos: the Demos page at /videos, over the open session; marked active; Back and the other pages leave it", async () => {
  const host = await appHost({ path: "/workspace" });
  await host.settle();
  assert.equal(sidebar(host).props.hrefOf("demos"), "/videos", "not /demos: that is the video files' folder");
  assert.equal(host.component("DemosPage"), undefined);

  sidebar(host).props.onNav("demos"); host.render();
  assert.equal(host.location.pathname, "/videos");
  assert.equal(sidebar(host).props.active, "demos");
  assert.ok(host.component("DemosPage"), "the Demos page is shown");
  assert.equal(host.component("StartScreen"), undefined, "not Home");
  assert.equal(host.component("NotFound"), undefined, "a page of the app's own");
  assert.equal(host.state.sceneId, "scene", "the session stays open behind it");

  sidebar(host).props.onNav("home"); host.render();
  assert.equal(host.location.pathname, "/home");
  assert.equal(sidebar(host).props.active, "home");
  assert.equal(host.component("DemosPage"), undefined);
  assert.ok(host.component("StartScreen"));

  sidebar(host).props.onNav("demos"); host.render();
  sidebar(host).props.onNav("projects"); host.render();
  assert.equal(sidebar(host).props.active, "projects");
  assert.equal(host.component("DemosPage"), undefined);
  sidebar(host).props.onNav("demos"); host.render();
  sidebar(host).props.onNav("workspace"); host.render();
  assert.equal(sidebar(host).props.active, "workspace");
  assert.equal(host.component("DemosPage"), undefined);
  host.unmount();
});

test("/videos opened as it is: the Demos page with nothing open, never Home or Page not found", async () => {
  const host = await appHost({ path: "/videos", initial: { sceneId: null, stats: null, report: null, clash: null } });
  await host.settle();
  assert.ok(host.component("DemosPage"));
  assert.equal(sidebar(host).props.active, "demos");
  assert.equal(host.component("StartScreen"), undefined);
  assert.equal(host.component("NotFound"), undefined);
  host.unmount();
});

test("the collapse: the 3D workspace starts on the rail, the other pages expanded, each remembered on its own", async () => {
  const host = await appHost({ path: "/workspace" });
  await host.settle();
  assert.equal(sidebar(host).props.rail, true, "the workspace needs the width");
  assert.equal(topBar(host).props.rail, true);
  topBar(host).props.onToggle(); host.render();
  assert.equal(sidebar(host).props.rail, false, "expanded by hand");

  sidebar(host).props.onNav("projects"); host.render();
  assert.equal(sidebar(host).props.rail, false, "a page starts expanded");
  topBar(host).props.onToggle(); host.render();
  assert.equal(sidebar(host).props.rail, true, "collapsed on the pages");

  sidebar(host).props.onNav("workspace"); host.render();
  assert.equal(sidebar(host).props.rail, false, "the workspace keeps its own choice");
  host.unmount();
});

test("the project group: the open project's steps with their counts, and the step marked on its page", async () => {
  const files = [{ name: "a.ifc", kind: "IFC", size: 1, sha256: "0" }, { name: "b.ifc", kind: "IFC", size: 1, sha256: "1" }];
  const reports = [{ doc_id: "d1", name: "Report.pdf", at: 1700000000, kind: "pdf" }];
  const host = await appHost({ path: "/projects/p9/reports",
    projects: { getProject: async (id) => ({ ...(await import("./app-host.mjs")).projectOf({ id, name: "Tower B", files, reports,
      counts: { clashes: 12, open: 7, resolved: 5, reviewed: 0 } }) }) } });
  await host.settle();
  const side = sidebar(host);
  assert.equal(side.props.active, "reports");
  assert.equal(side.props.project.name, "Tower B");
  assert.deepEqual(side.props.project.counts, { models: 2, clash: 7, reports: 1 }, "models, the open clashes last known, reports");
  assert.equal(side.props.hrefOf("clash"), "/projects/p9/clashes");
  assert.equal(side.props.hrefOf("overview"), "/projects/p9");
  assert.equal(primary(host).props["data-shell"], "open-workspace", "a project's page leads to its workspace");

  side.props.onNav("overview"); host.render();
  assert.equal(host.location.pathname, "/projects/p9");
  assert.equal(sidebar(host).props.active, "overview");
  assert.equal(host.component("ProjectOverview").props.step, "overview");

  sidebar(host).props.onNav("home"); host.render();
  assert.equal(sidebar(host).props.project.id, "p9", "the project's group stays in the sidebar on Home");
  host.unmount();
});

test("Settings and Help open from the sidebar; the ☰ Menu button is gone", async () => {
  const host = await appHost();
  assert.equal(host.find((n) => n.props?.["data-tour"] === "menu"), undefined, "no menu button");
  const settings = host.menu();
  assert.ok(settings && hasText(settings, "Your name for review decisions"), "Settings holds the settings");
  assert.equal(hasText(settings, "Coordinate"), false, "the workspace's actions are in the workspace");
  settings.props.onClose(); host.render();
  sidebar(host).props.onHelp(); host.render();
  const help = host.find((n) => n.type?.name === "MenuSheet" && n.props.title === "Help");
  assert.ok(help && hasText(help, "How Iris works"));
  assert.ok(find(help, (n) => n.type === "ol" && n.props.className === "help-flow"), "the eight steps");
  host.unmount();
});

const nothingOpen = { sceneId: null, a: null, b: null, stats: null, clash: null, report: null, matches: null };
const sheet = (host, title) => host.find((n) => n.type?.name === "MenuSheet" && n.props.title === title);

test("/settings opens Settings over Home; the sidebar's Settings and Help have their address, closing puts the page's back", async () => {
  const fresh = await appHost({ path: "/settings", initial: nothingOpen });
  await fresh.settle();
  assert.ok(sheet(fresh, "Settings"), "the address opens Settings");
  assert.ok(fresh.component("StartScreen"), "over Home");
  assert.equal(fresh.location.pathname, "/settings");
  sheet(fresh, "Settings").props.onClose(); fresh.render();
  assert.equal(sheet(fresh, "Settings"), undefined);
  assert.equal(fresh.location.pathname, "/home", "opened as it is, closing leaves Home's address");
  fresh.unmount();

  const host = await appHost({ path: "/projects", initial: nothingOpen });
  await host.settle();
  sidebar(host).props.onSettings(); host.render();
  assert.equal(host.location.pathname, "/settings", "the sidebar's Settings is at /settings");
  assert.ok(host.component("ProjectsHome"), "over the page it was opened from");
  find(sheet(host, "Settings"), (n) => n.type === "button" && hasText(n, "How Iris works")).props.onClick(); host.render();
  assert.equal(sheet(host, "Settings"), undefined);
  assert.ok(sheet(host, "Help"), "Settings' Help opens Help");
  assert.equal(host.location.pathname, "/help");
  sheet(host, "Help").props.onClose(); host.render();
  assert.equal(host.location.pathname, "/projects", "closing goes back to where Settings was opened");
  sidebar(host).props.onHelp(); host.render();
  assert.equal(host.location.pathname, "/help");
  sheet(host, "Help").props.onClose(); host.render();
  assert.equal(host.location.pathname, "/projects");
  host.unmount();
});

test("every step of a project that is not there is the not-found page: no workspace, nothing opened, no clash picked", async () => {
  const c = { id: "five", name: "Clash", number: 5, a: {}, b: {}, images: [] };
  // Each host compiles App (seconds): the pages for every step are projectRoute.projectView's (project-route.test.mjs).
  const session = { clash: null, report: { id: "report", title: "Report", clashes: [c] } };
  for (const [path, initial] of [["/projects/gone123/clashes/5", nothingOpen], ["/projects/gone123/models", nothingOpen],
    ["/projects/gone123/clashes/5", session]]) {
    {
      const host = await appHost({ path, initial, projects: { getProject: async () => { throw new Error("404 Not Found"); } } });
      await host.settle(); await host.settle();
      const missing = host.find((n) => n.type?.name === "EmptyState" && n.props.className === "proj-missing");
      assert.ok(missing, `${path}: the not-found page`);
      assert.equal(missing.props.glass, "ring", `${path}: with its one glass still`);
      assert.ok(missing.props.action?.type === "button" && hasText(missing.props.action, "All projects"), `${path}: and the way back`);
      assert.equal(host.component("ProjectStart"), undefined, `${path}: never the workspace's import`);
      assert.deepEqual(host.projects.calls.filter((x) => x[0] === "open"), [], `${path}: nothing opens for it`);
      assert.equal(host.state.clash, null, `${path}: the open report's clash #5 is not picked`);
      assert.equal(host.location.pathname, path, `${path}: the address stays`);
      host.unmount();
    }
  }
});
