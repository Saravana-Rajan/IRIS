import assert from "node:assert/strict";
import test from "node:test";
import { compiled } from "./app-host.mjs";

/** The 3D toolbar, decluttered (owner, Nov 22: "too congested"): six core tools on the rail (Home view, Go to the clash,
 * Section box, Measure, Visibility, Screenshot), and the rest by name under More tools. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const stub = (names) => url(names.map((n) => `export function ${n}(){return null;}`).join("\n"));
const react = url("export const useState=(v)=>[typeof v==='function'?v():v,()=>{}];export const useMemo=(fn)=>fn();"
  + "export const useEffect=()=>{};export const useRef=(v)=>({current:v ?? null});");
const ICONS = ["ArrowLeft", "ArrowRight", "Bookmark", "Box", "Camera", "Columns2", "Crop", "Ellipsis", "Home", "Layers", "LayoutGrid",
  "ListFilter", "LocateFixed", "Maximize", "Radar", "Ruler", "ScanEye", "Shapes", "SlidersHorizontal", "Square", "Target", "Trash2", "Waypoints"];
const { ViewerToolbar } = await import(await compiled("../src/ViewerToolbar.tsx", { react, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": stub(ICONS), "./ui": stub(["IconButton", "Popover"]), "./editIcons": stub(["EditIcon"]) }));

const state = (over = {}) => ({ mode: "xray", style: "shaded", ortho: false, grey: false, edges: false, section: false, measure: false,
  links: false, hiddenModels: [], ...over });
const views = (over = {}) => ({ canBack: false, canForward: false, fly: false, hasHome: false, onBack() {}, onForward() {}, onFly() {},
  onSetHome() {}, onClearHome() {}, saved: [], onSave() {}, onApply() {}, onDelete() {}, levels: [], classes: [],
  filters: { classes: [], levels: [] }, onFilters() {}, temporary: 0, onResetTemporary() {}, layout: "single", layouts: ["single"],
  onLayout() {}, drawings: "filtered", onDrawings() {}, ...over });
const props = (over = {}) => ({ state: state(), models: ["Structure", "MEP"], hasFocus: true, views: views(), onMode() {}, onStyle() {},
  onToggle() {}, onView() {}, onFit() {}, onFocus() {}, onModel() {}, onShot() {}, ...over });

/** Draw the toolbar: the file's own components called, IconButtons and Popovers (stubs) kept as they are. */
function draw(node) {
  if (Array.isArray(node)) return node.map(draw);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function" && !["IconButton", "Popover", "EditIcon"].includes(node.type.name) && !ICONS.includes(node.type.name)) {
    return draw(node.type(node.props));
  }
  const children = node.props?.children;
  return children === undefined || typeof children === "function" ? node : { ...node, props: { ...node.props, children: draw(children) } };
}
const all = (node, predicate, out = []) => {
  if (Array.isArray(node)) { for (const n of node) all(n, predicate, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  const children = node.props?.children;
  if (typeof children !== "function") all(children, predicate, out);
  return out;
};
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";
const navs = (tree) => all(tree, (n) => n.type === "nav");
/** What a rail shows (its IconButtons' and menus' labels), not what is inside the menus. */
const onRail = (nav) => all(nav, (n) => typeof n.type === "function" && ["IconButton", "Popover"].includes(n.type.name)).map((n) => n.props.label);
const menu = (nav, label) => {
  const pop = all(nav, (n) => typeof n.type === "function" && n.type.name === "Popover" && n.props.label === label)[0];
  return pop && draw(pop.props.children(() => {}));
};
const items = (m) => all(m, (n) => n.type === "button" || n.type === "label").map(text);

test("one view: six core tools on the rail, then More tools; nothing else outside the menu", () => {
  const tree = draw(ViewerToolbar(props({ state: state({ edit: false }), views: views({ layouts: ["single", "two", "quad"] }) })));
  const [rail, ...rest] = navs(tree);
  assert.equal(rest.length, 0, "one rail");
  const labels = onRail(rail);
  const core = ["Home view", "Go to the clash", "Section box", "Measure", "Visibility", "Save a screenshot", "More tools"];
  assert.equal(labels.length, core.length, labels.join(" | "));
  core.forEach((c, i) => assert.ok(labels[i].startsWith(c), `${i}: ${labels[i]} is ${c}`));
  const outside = all(rail, (n) => n.type === "button").map(text);
  assert.deepEqual(outside, [], "no mode, style, outline, connections, camera, saved views, edit or views button outside a menu");
});

test("More tools lists the rest by name: modes, styles, outlines, connections, camera, saved views, Edit and Views", () => {
  const tree = draw(ViewerToolbar(props({ state: state({ edit: false }), views: views({ layouts: ["single", "two", "quad"] }) })));
  const list = items(menu(navs(tree)[0], "More tools")).join(" | ");
  for (const s of ["Shaded", "X-ray", "Context", "Isolate", "Consistent colours", "Shaded with edges", "Hidden line", "grey the rest",
    "Outline the pair through walls", "Connections", "Top", "Front", "Right", "Iso", "Orthographic", "Back", "Forward",
    "Set this view as Home", "Save this view", "Edit the model", "3D only", "Plan and 3D", "Four views", "The whole model",
    "Take every view to the clash I pick"]) assert.ok(list.includes(s), s);
  const titles = all(menu(navs(tree)[0], "More tools"), (n) => n.props?.className === "pop-title").map(text);
  assert.deepEqual(titles.map((t) => t.replace(/G$/, "").trim()), ["Mode", "Visual style", "3D tools", "Edit", "Camera", "Projection",
    "Where you have been", "Home", "Saved views", "Views", "Drawings show", "Picking a clash"]);
  const plain = items(menu(navs(draw(ViewerToolbar(props())))[0], "More tools")).join(" | ");
  assert.ok(!plain.includes("Edit the model"), "no Edit tool here: none in the menu");
  assert.ok(!plain.includes("Plan and 3D"), "one layout: no Views");
});

test("a menu pick does what the rail's button did, and closes the menu", () => {
  const calls = [];
  const tree = draw(ViewerToolbar(props({ state: state({ edit: false }), onMode: (m) => calls.push(["mode", m]), onToggle: (k) => calls.push(["toggle", k]),
    onStyle: (s) => calls.push(["style", s]), onView: (v) => calls.push(["view", v]) })));
  const pop = all(navs(tree)[0], (n) => typeof n.type === "function" && n.type.name === "Popover" && n.props.label === "More tools")[0];
  const m = draw(pop.props.children(() => calls.push(["close"])));
  const press = (label) => all(m, (n) => n.type === "button" && text(n).includes(label))[0].props.onClick();
  press("Context"); press("Edit the model"); press("Outline the pair"); press("Hidden line"); press("Top");
  assert.deepEqual(calls, [["mode", "context"], ["close"], ["toggle", "edit"], ["close"], ["toggle", "edges"], ["style", "hidden"], ["close"],
    ["view", "top"], ["close"]]);
  const context = all(m, (n) => n.type === "button" && text(n).includes("Context"))[0];
  assert.equal(context.props.role, "menuitemradio");
  assert.equal(all(m, (n) => n.type === "button" && text(n).includes("X-ray"))[0].props["aria-checked"], true, "the mode on now is checked");
});

test("the core tools still act: Home, Go to the clash (only with something to go to), Section, Measure, Screenshot", () => {
  const calls = [];
  const tree = draw(ViewerToolbar(props({ hasFocus: false, onFit: () => calls.push("fit"), onFocus: () => calls.push("focus"),
    onToggle: (k) => calls.push(k), onShot: () => calls.push("shot"), state: state({ section: true }) })));
  const btn = (prefix) => all(navs(tree)[0], (n) => n.type?.name === "IconButton" && n.props.label.startsWith(prefix))[0].props;
  btn("Home view").onClick(); btn("Section box").onClick(); btn("Measure").onClick(); btn("Save a screenshot").onClick();
  assert.deepEqual(calls, ["fit", "section", "measure", "shot"]);
  assert.equal(btn("Go to the clash").disabled, true);
  assert.equal(btn("Section box").active, true);
  assert.equal(btn("Home view").shortcut, "H");
  const noModels = onRail(navs(draw(ViewerToolbar(props({ models: [] }))))[0]);
  assert.ok(!noModels.some((l) => l.startsWith("Visibility")), "no models: no Visibility");
});

test("several panes: every view's tools at the stage's left, the 3D view's in its pane, each with its own More", () => {
  const split = { shown: true, x: 400, y: 0, h: 300 };
  const tree = draw(ViewerToolbar(props({ split, state: state({ edit: false }), views: views({ layouts: ["single", "two"] }) })));
  const [every, three] = navs(tree);
  assert.equal(every.props["aria-label"], "Tools for every view");
  const left = onRail(every);
  assert.ok(!left.some((l) => l.startsWith("Home view") || l.startsWith("Section box")), left.join(" | "));
  assert.deepEqual(left.map((l) => l.split(":")[0].split(",")[0]), ["Go to the clash", "Measure", "Visibility", "Save a screenshot", "More tools"]);
  const extras = items(menu(every, "More tools")).join(" | ");
  assert.ok(extras.includes("Edit the model") && extras.includes("Plan and 3D") && !extras.includes("X-ray"), extras);
  assert.equal(three.props["aria-label"], "3D view tools");
  assert.deepEqual(three.props.style, { left: 408, top: 50 });
  assert.deepEqual(onRail(three).map((l) => l.split(":")[0]), ["Home view", "Section box", "More 3D tools"]);
  const threeD = items(menu(three, "More 3D tools")).join(" | ");
  assert.ok(["X-ray", "Hidden line", "Outline the pair", "Connections", "Orthographic", "Save this view"].every((s) => threeD.includes(s)), threeD);
  assert.ok(!threeD.includes("Edit the model"), "the Edit tool acts on every view: on the left");
  const hidden = navs(draw(ViewerToolbar(props({ split: { ...split, shown: false } }))));
  assert.equal(hidden.length, 1, "a drawing maximised: no 3D rail");
  assert.ok(!onRail(hidden[0]).includes("More tools"), "nothing extra (no Edit tool, one layout): no empty menu");
});

test("a phone keeps its Tools sheet, Go to clash and Home view", () => {
  const tree = draw(ViewerToolbar(props({ compact: true })));
  const [rail] = navs(tree);
  assert.ok(rail.props.className.includes("compact"));
  assert.ok(text(rail).includes("Go to clash"));
  assert.ok(all(rail, (n) => n.type === "button" && n.props["aria-label"] === "Home view").length === 1);
  const sheet = items(menu(rail, "View tools")).join(" | ");
  assert.ok(["Section box", "Measure between two points", "Save a screenshot", "Orthographic"].every((s) => sheet.includes(s)), sheet);
});
