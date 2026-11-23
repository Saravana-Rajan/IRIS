import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compiled } from "./app-host.mjs";

const dock = await import(await compiled("../src/dockLayout.ts"));

/** A layout as dockview's toJSON writes it: the model in the grid, the side bars, and what floats or pops out. */
function layout({ grid = ["model"], left = ["clashes"], right = ["clash", "plan", "chat"], bottom = ["activity"], floating = [], popout = [] } = {}) {
  const ids = [...grid, ...left, ...right, ...bottom, ...floating, ...popout];
  const edge = (views, id) => ({ size: 300, visible: true, group: { id, views, activeView: views[0] } });
  return {
    grid: { root: { type: "branch", data: [{ type: "leaf", data: { views: grid, id: "1" } }] }, width: 800, height: 600, orientation: "HORIZONTAL" },
    panels: Object.fromEntries(ids.map((id) => [id, { id, contentComponent: "panel", title: id }])),
    floatingGroups: floating.length ? [{ data: { views: floating, id: "2" }, position: { top: 0, left: 0, width: 300, height: 300 } }] : [],
    popoutGroups: popout.length ? [{ data: { views: popout, id: "3" }, url: "/popout.html" }] : [],
    edgeGroups: { left: edge(left, "edge-left"), right: edge(right, "edge-right"), bottom: edge(bottom, "edge-bottom") },
  };
}

test("every panel has a home, and only the model lives in the middle", () => {
  assert.deepEqual(dock.PANEL_IDS, ["model", "clashes", "filters", "clash", "plan", "chat", "edits", "activity", "properties"]);
  assert.equal(dock.homeOf("properties"), "float", "Properties floats, and appears on a selection");
  assert.equal(dock.homeOf("model"), "centre");
  assert.equal(dock.homeOf("clashes"), "left");
  for (const id of ["clash", "plan", "chat"]) assert.equal(dock.homeOf(id), "right");
  assert.equal(dock.homeOf("activity"), "bottom");
  assert.ok(dock.isPanel("chat") && !dock.isPanel("viewer"));
});

test("the default layout as saved loads; floating panels and closed ones too", () => {
  assert.ok(dock.validLayout(layout()));
  assert.ok(dock.validLayout(layout({ right: ["plan", "chat"], floating: ["clash"] })));
  assert.ok(dock.validLayout(layout({ bottom: [] })), "a closed panel is simply absent");
  assert.ok(dock.validLayout(layout({ grid: ["model", "chat"], right: ["clash", "plan"] })), "a panel docked beside the model");
  assert.ok(dock.validLayout(layout({ floating: ["properties"] })), "Properties floating over the model");
});

test("a layout that can't be Iris's gives way to the default", () => {
  assert.ok(!dock.validLayout(null) && !dock.validLayout("x") && !dock.validLayout({}));
  assert.ok(!dock.validLayout(layout({ grid: ["clash"], right: ["model", "plan", "chat"] })), "the model must stay in the grid");
  assert.ok(!dock.validLayout(layout({ grid: [], floating: ["model"] })), "the model never floats");
  const twice = layout(); twice.edgeGroups.left.group.views = ["clashes", "chat"];
  assert.ok(!dock.validLayout(twice), "a panel in two places");
  const stranger = layout(); stranger.panels.viewer = { id: "viewer", contentComponent: "panel" }; stranger.edgeGroups.left.group.views.push("viewer");
  assert.ok(!dock.validLayout(stranger), "a panel Iris doesn't have");
  const unplaced = layout(); unplaced.edgeGroups.bottom.group.views = [];
  assert.ok(!dock.validLayout(unplaced), "a panel listed but placed nowhere");
  const other = layout(); other.panels.chat.contentComponent = "default";
  assert.ok(!dock.validLayout(other), "drawn by another component");
});

test("a floating or pop-out window split into several groups still counts its panels", () => {
  // dockview writes a window holding more than one group as { grid, position }, with no data.
  const split = (views) => ({ grid: { root: { type: "branch", data: views.map((v, i) => ({ type: "leaf", data: { views: v, id: `w${i}` } })) } }, position: {} });
  const floating = layout({ right: ["plan"] });
  floating.panels.clash = { id: "clash", contentComponent: "panel" }; floating.panels.chat = { id: "chat", contentComponent: "panel" };
  floating.floatingGroups = [split([["clash"], ["chat"]])];
  assert.deepEqual(dock.placedViews(floating).sort(), ["activity", "chat", "clash", "clashes", "model", "plan"]);
  assert.ok(dock.validLayout(floating), "a reload keeps it rather than falling back to the default");
  const popped = layout({ right: ["plan"] });
  popped.panels.clash = { id: "clash", contentComponent: "panel" }; popped.panels.chat = { id: "chat", contentComponent: "panel" };
  popped.popoutGroups = [split([["clash"], ["chat"]])];
  const saved = dock.withoutPopouts(popped);
  assert.deepEqual(saved.edgeGroups.right.group.views, ["plan", "clash", "chat"], "both groups' panels go home");
  assert.ok(dock.validLayout(saved));
});

test("the classic panes and the dock's side bars share one set of widths", () => {
  assert.deepEqual([...dock.EDGE_SIZE.left], [...dock.PANE.left]);
  assert.deepEqual([...dock.EDGE_SIZE.right], [...dock.PANE.right]);
});

test("a saved layout puts what was in its own window back in its side bar", () => {
  const saved = dock.withoutPopouts(layout({ right: ["clash", "plan"], popout: ["chat"] }));
  assert.deepEqual(saved.popoutGroups, []);
  assert.deepEqual(saved.edgeGroups.right.group.views, ["clash", "plan", "chat"]);
  assert.ok(dock.validLayout(saved));
  const noBar = layout({ bottom: [], popout: ["activity"] }); delete noBar.edgeGroups.bottom;
  const back = dock.withoutPopouts(noBar);
  assert.deepEqual(back.edgeGroups.bottom.group, { id: "edge-bottom", views: ["activity"], activeView: "activity" });
  assert.ok(dock.validLayout(back));
  const emptied = layout({ left: [], popout: ["clashes"] }); emptied.edgeGroups.left.visible = false;
  assert.equal(dock.withoutPopouts(emptied).edgeGroups.left.visible, true, "the bar it emptied, hidden then, shows again");
  const plain = layout();
  assert.equal(dock.withoutPopouts(plain), plain, "nothing to move: the same layout");
  const props = dock.withoutPopouts(layout({ popout: ["properties"] }));
  assert.ok(!("properties" in props.panels), "Properties is left closed: the next selection brings it back");
  assert.ok(dock.validLayout(props));
});

test("the layout is kept per browser, versioned, and a bad one reads as none", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  dock.writeLayout(storage, layout({ right: ["clash", "plan"], popout: ["chat"] }));
  const read = dock.readLayout(storage);
  assert.deepEqual(read.edgeGroups.right.group.views, ["clash", "plan", "chat"]);
  store.set(dock.LAYOUT_KEY, JSON.stringify({ v: 1, layout: layout() }));
  assert.equal(dock.readLayout(storage), null, "another version");
  store.set(dock.LAYOUT_KEY, "{not json");
  assert.equal(dock.readLayout(storage), null);
  assert.equal(dock.readLayout(null), null);
  assert.doesNotThrow(() => dock.writeLayout({ setItem() { throw new Error("quota"); } }, layout()));
});

test("version 2: Activity starts collapsed, and a layout kept before (Activity open) gives way to the new default once", () => {
  assert.equal(dock.LAYOUT_KEY, "iris.dock.v2");
  assert.equal(dock.LAYOUT_VERSION, 2);
  assert.deepEqual([...dock.DEFAULT_COLLAPSED], ["bottom"], "only Activity's bar: a slim strip the user opens");
  assert.equal(dock.homeOf("activity"), "bottom", "the bar collapsed is Activity's");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set("iris.dock.v1", JSON.stringify({ v: 1, layout: layout() }));
  assert.equal(dock.readLayout(storage), null, "the old key is not read: the default (Activity collapsed) is built");
  dock.writeLayout(storage, layout());
  const kept = JSON.parse(store.get("iris.dock.v2"));
  assert.equal(kept.v, 2, "written as version 2, under the new key");
  assert.ok(dock.validLayout(kept.layout));
  assert.ok(dock.readLayout(storage), "and read back from there");
  assert.equal(JSON.parse(store.get("iris.dock.v1")).v, 1, "the old entry is left as it was");
});

test("the default layout collapses the bottom bar to its strip, Reset uses the same build, and the tour still opens every bar", async () => {
  const source = await readFile(new URL("../src/dock.tsx", import.meta.url), "utf8");
  const build = source.slice(source.indexOf("function build("), source.indexOf("function wireEdges("));
  assert.match(build, /for \(const edge of DEFAULT_COLLAPSED\)[\s\S]*collapseEdge\(bar, edge\)/, "build() collapses the default's bars");
  const reset = source.slice(source.indexOf("reset() {"), source.indexOf("gather() {"));
  assert.match(reset, /build\(api, /, "Reset the layout: the same default");
  const gather = source.slice(source.indexOf("gather() {"), source.indexOf("isOpen:"));
  assert.match(gather, /g\?\.isCollapsed\(\)\) g\.expand\(\)/, "the tour reads the main page: every bar open");
  assert.match(source, /className=\{`dock-tab \$\{short \? "short" : ""\} \$\{strip \? "strip" : ""\}`\}/, "a tab on a collapsed strip says so (its status line shows there only)");
});

test("showing a panel: reopen, open its bar, bring its window forward, or bring it home for the tour", () => {
  assert.deepEqual(dock.showSteps({ open: false }), ["add", "expand", "activate"]);
  assert.deepEqual(dock.showSteps({ open: true, location: "edge", collapsed: true }), ["expand", "activate"]);
  assert.deepEqual(dock.showSteps({ open: true, location: "edge", collapsed: false }), ["activate"]);
  assert.deepEqual(dock.showSteps({ open: true, location: "floating" }), ["activate"]);
  assert.deepEqual(dock.showSteps({ open: true, location: "popout" }), ["window", "activate"]);
  assert.deepEqual(dock.showSteps({ open: true, location: "popout" }, true), ["home", "expand", "activate"]);
});

test("the dock uses dockview's free core only (the public repo must build for anyone)", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["dockview-react"], "8.5.1");
  assert.deepEqual(pkg.overrides, { dockview: "8.5.1", "dockview-core": "8.5.1" });
  assert.ok(!JSON.stringify(pkg).includes("dockview-enterprise"));
  const source = await readFile(new URL("../src/dock.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("dockview-enterprise"));
  for (const option of ["autoHideEdgeGroups", "dockToEdgeGroups", "layoutHistory", "smartGuides", "dndCompass", "keyboardNavigation"]) {
    assert.ok(!source.includes(option), `${option} needs the paid modules`);
  }
});

test("Properties floats unless it was last docked on the right", () => {
  const store = (v) => ({ getItem: (k) => (k === dock.PROPS_KEY ? v : null) });
  assert.equal(dock.readPropsHome(store(null)), "float");
  assert.equal(dock.readPropsHome(store("right")), "right");
  assert.equal(dock.readPropsHome(store("left")), "float", "only the right bar is offered");
  assert.equal(dock.readPropsHome({ getItem: () => { throw new Error("blocked"); } }), "float");
  assert.equal(dock.readPropsHome(null), "float");
});

// ---------------------------------------------------------------- the collapsed Activity bar's one line

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const stub = (names) => url(names.map((n) => `export function ${n}(){return null;}`).join("\n"));
const activity = await import(await compiled("../src/Activity.tsx", { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": stub(["Eye", "EyeOff", "ListChecks", "Workflow"]), "./fixKinds": await compiled("../src/fixKinds.ts"),
  "./Workings": stub(["Workings"]), "./aiNames": await compiled("../src/aiNames.ts") }));
const text = (n) => typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(text).join("")
  : n && typeof n === "object" ? text(n.props?.children) : "";

test("the collapsed Activity bar reads as one calm status line: nothing before a run, a spinner only while it runs", () => {
  const { ActivityLine, statusLine } = activity;
  assert.equal(ActivityLine({ attempts: [], progress: null, now: 0 }), null, "no run yet: the strip just says Activity");
  const progress = { started: 0, round: 1, phase: "thinking", thinkingSince: 0, modelSeconds: [], ideas: 0, checking: null, model: "Pro" };
  const live = ActivityLine({ attempts: [], progress, now: 12000 });
  assert.equal(live.type, "span");
  assert.equal(live.props.role, "status");
  assert.ok(live.props.className.split(" ").includes("activity-line") && live.props.className.includes("live"));
  assert.equal(text(live), statusLine(progress, 12000, []), "the same words as the open bar's head");
  assert.ok([live.props.children].flat().some((c) => c?.props?.className === "spinner"), "a small spinner while it runs");
  const done = ActivityLine({ attempts: [{ passed: true }, { passed: false }], progress: { ...progress, phase: "done" }, now: 30000 });
  assert.ok(!done.props.className.includes("live"));
  assert.ok(![done.props.children].flat().some((c) => c?.props?.className === "spinner"), "done: no spinner");
  assert.equal(text(done), "Done in 30 s: 1 of 2 ideas passed the geometry check");
});

test("the left panel's tab follows the project step it shows: Models, Coordination, Clashes", async () => {
  assert.deepEqual(dock.stepTitles("models"), { clashes: "Models" });
  assert.deepEqual(dock.stepTitles("clash"), { clashes: "Clashes" });
  for (const step of ["coordination", "overview", null, undefined]) assert.deepEqual(dock.stepTitles(step), {}, String(step));
  assert.equal(dock.titleOf("clashes"), "Coordination", "the panel's own name, on Coordination and outside a project");
  const source = await readFile(new URL("../src/dock.tsx", import.meta.url), "utf8");
  assert.match(source, /ctx\.titles\?\.\[id\] \?\? api\.title/, "the tab draws the step's name over the panel's own");
});
