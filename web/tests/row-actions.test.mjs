import assert from "node:assert/strict";
import test from "node:test";
import { appHost, compiled, find } from "./app-host.mjs";

/** A clash row's quick actions (owner request, Nov 1: "when we hover on a clash in the list of clashes, i want to see
 * control icons button to quickly propose fixes", "additional capability to see clashes with the same elements"):
 * Propose fixes, Mark as not a clash, and the clashes sharing an element with it. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const stub = (names) => url(names.map((n) => `export function ${n}(){return null;}`).join("\n"));
const react = url("export const useState=(v)=>[typeof v==='function'?v():v,()=>{}];export const useMemo=(fn)=>fn();"
  + "export const useEffect=()=>{};export const useRef=(v)=>({current:v ?? null});");
const TRIAGE = url(`export const TRIAGE={${["real_clash", "modelling_error", "by_design", "non_physical", "unknown"]
  .map((k) => `${k}:{label:"${k}",cls:"",tip:"",colour:"",long:"${k}"}`).join(",")}};`);
const list = await import(await compiled("../src/ReportList.tsx", { react, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": stub(["CircleCheck", "EllipsisVertical", "Eye", "Focus", "Network", "Search", "Sparkles", "Wand2", "X"]), "./api": url("export const api={imageUrl:()=>''};"),
  "./ClashPanel": stub(["ClashThumb"]), "./Triage": TRIAGE, "./noClash": await compiled("../src/noClash.ts", {}),
  "./aiNames": await compiled("../src/aiNames.ts", {}) }));

const el = (name, gid) => ({ name, global_id: gid, ifc_class: "IfcBeam", level: null, file: null, system: null, description: null, part_of: null });
const clash = (id, number, a, b) => ({ id, number, name: `${a.name} × ${b.name}`, title: null, test: "MEP vs Structure", a, b, images: [],
  guid: id, test_type: "hard", tolerance_m: 0.001, status: "active", distance_m: -0.3, point: null, grid: null, source: "iris", ref: null });
const GIRDER = el("Transfer plate girder 1000 deep - grid 3", "girder");
const c1 = clash("c1", 1, el("Supply air main", "duct"), GIRDER);
const c2 = clash("c2", 2, el("Cable tray", "tray"), GIRDER);
const c3 = clash("c3", 3, el("Cold water main", "cw"), GIRDER);
const c9 = clash("c9", 9, el("Strut S1", "strut"), el("Beam B1", "beam"));
const report = { id: "r", title: "Coordination", sources: [], origin: "iris", clashes: [c1, c2, c3, c9] };
const matches = Object.fromEntries(report.clashes.map((c) => [c.id, { a: c.a.global_id, b: c.b.global_id, how: ["globalid", "globalid"] }]));

test("the clashes sharing an element, either one, with each clash", () => {
  const related = list.sameElements(report.clashes, matches);
  assert.deepEqual(related.get("c1"), ["c2", "c3"], "the three girder clashes");
  assert.deepEqual(related.get("c9"), []);
  const unmatched = list.sameElements(report.clashes, null);
  assert.deepEqual(unmatched.get("c2"), ["c1", "c3"], "without the open models, by the report's GlobalIds");
});

/** The list with its own components drawn (not the icons), so a row's buttons can be found and pressed. */
function draw(node) {
  if (Array.isArray(node)) return node.map(draw);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function" && /^[A-Z]/.test(node.type.name) && node.type.name === "RowActions") {
    const out = node.type(node.props);
    return out === null ? null : draw(out);
  }
  return node.props?.children === undefined ? node : { ...node, props: { ...node.props, children: draw(node.props.children) } };
}
function rowButtons(tree, id) {
  const row = find(tree, (n) => n.props?.["data-clash"] === id);
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "button" && n.props["aria-label"]) out.push(n);
    [n.props?.children].flat(Infinity).forEach(walk);
  };
  walk(row);
  return out;
}

test("a row offers Propose fixes, Mark as not a clash and its same-element clashes, each only when it applies", () => {
  const calls = [];
  const tree = draw(list.ReportList({ report, matches, selected: null, onSelect() {}, onImage() {}, fixes: { c3: "Raise it" },
    reviewed: { c9: { kind: "by_design", note: "joint" } }, checked: new Set(), onCheck() {}, onFixChecked() {}, insights: null, busy: false,
    triage: {}, triageFilter: null, onPropose: (c) => calls.push(["propose", c.id]), onSetAside: (c, note) => calls.push(["aside", c.id, note]),
    onFocus: (f) => calls.push(["focus", f.label, f.ids]) }));
  const labels = (id) => rowButtons(tree, id).map((b) => b.props["aria-label"]).filter((l) => !l.startsWith("Open the images") && !l.startsWith("More actions"));
  assert.deepEqual(labels("c1"), ["Propose fixes for #1 Supply air main × Transfer plate girder 1000 deep - grid 3",
    "Mark #1 Supply air main × Transfer plate girder 1000 deep - grid 3 as not a clash",
    "2 more clashes with the same elements as #1 Supply air main × Transfer plate girder 1000 deep - grid 3"]);
  assert.deepEqual(labels("c3"), ["2 more clashes with the same elements as #3 Cold water main × Transfer plate girder 1000 deep - grid 3"],
    "fixed: nothing to propose or set aside");
  assert.deepEqual(labels("c9"), [], "reviewed and sharing nothing: no actions");
  const [propose, aside, same] = rowButtons(tree, "c1").filter((b) => !/^(Open the images|More actions)/.test(b.props["aria-label"]));
  propose.props.onClick(); aside.props.onClick(); same.props.onClick();
  assert.deepEqual(calls, [["propose", "c1"], ["aside", "c1", "Set aside from the clash list"],
    ["focus", "Clashes with Supply air main or Transfer plate girder 1000 deep", ["c1", "c2", "c3"]]]);
  const unlinked = draw(list.ReportList({ report, matches: { ...matches, c2: { a: "tray", b: null, how: [] } }, selected: null, onSelect() {},
    onImage() {}, fixes: {}, reviewed: {}, checked: new Set(), onCheck() {}, onFixChecked() {}, insights: null, busy: false, triage: {},
    triageFilter: null, onPropose() {}, onSetAside() {}, onFocus() {} }));
  assert.ok(!rowButtons(unlinked, "c2").some((b) => b.props["aria-label"].startsWith("Propose")), "one side not in the model: no proposal");
});

test("a row's actions are not inline: icons at its end on hover, or a ⋮ menu that names them (touch screens)", () => {
  const tree = draw(list.ReportList({ report, matches, selected: null, onSelect() {}, onImage() {}, fixes: { c3: "Raise it" },
    reviewed: { c9: { kind: "by_design", note: "joint" } }, checked: new Set(), onCheck() {}, onFixChecked() {}, insights: null, busy: false,
    triage: {}, triageFilter: null, onPropose() {}, onSetAside() {}, onFocus() {} }));
  const row = find(tree, (n) => n.props?.["data-clash"] === "c1");
  const group = find(row, (n) => n.props?.role === "group");
  assert.equal(group.props.className.trim(), "row-actions", "one group, closed: the CSS shows it on hover and focus only");
  const more = find(group, (n) => n.type === "button" && n.props["aria-label"] === "More actions for #1 Supply air main × Transfer plate girder 1000 deep - grid 3");
  assert.ok(more, "⋮ opens them on a touch screen");
  assert.equal(more.props["aria-expanded"], false);
  const acts = find(group, (n) => n.props?.className === "row-acts");
  assert.ok(find(acts, (n) => n.props?.className === "ra-label" && n.props.children === "Propose fixes"), "named in the menu");
  assert.equal(rowButtons(tree, "c9").length, 0, "nothing to do: no ⋮ either");
  // The main button holds only the number, the title and the distance (and a pill when there is something to say).
  const main = find(row, (n) => n.props?.className === "clash-main");
  const badge = find(main, (n) => typeof n.props?.className === "string" && n.props.className.includes("dist-badge"));
  assert.equal(badge.props.children, "−300 mm", "the distance with a true minus");
  assert.ok(badge.props.className.includes("over"), "an overlap: the red badge");
  const fixed = find(find(tree, (n) => n.props?.["data-clash"] === "c3"), (n) => n.props?.className === "fixed-label pill");
  assert.equal(fixed.props.children, "Fixed");
});

test("the whole row opens its clash; its actions never do (QA, Nov 22: on hover they took the row's middle)", () => {
  const opened = [], proposed = [];
  const tree = draw(list.ReportList({ report, matches, selected: null, onSelect: (c) => opened.push(c.id), onImage() {}, fixes: {},
    reviewed: {}, checked: new Set(), onCheck() {}, onFixChecked() {}, insights: null, busy: false, triage: {}, triageFilter: null,
    onPropose: (c) => proposed.push(c.id), onSetAside() {}, onFocus() {}, onIsolate() {} }));
  const row = find(tree, (n) => n.props?.["data-clash"] === "c1");
  // A press on `control` (or on none): the row asks the target whether it is inside a button, input, link or label.
  const at = (control) => ({ target: { closest: (sel) => (control && sel.split(/,\s*/).includes(control) ? {} : null) } });
  row.props.onClick(at(null));
  assert.deepEqual(opened, ["c1"], "a press on the row's edge or a gap opens it");
  for (const control of ["button", "input", "a", "label"]) row.props.onClick(at(control));
  assert.deepEqual(opened, ["c1"], "not through its own controls (the checkbox, the thumbnail, View, the actions)");
  find(row, (n) => n.props?.className === "clash-main").props.onClick();
  assert.deepEqual(opened, ["c1", "c1"], "the title opens it, once");
  const group = find(row, (n) => n.props?.role === "group");
  let stopped = 0;
  group.props.onClick({ stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 1, "a press in the actions (a button or between them) stops there");
  const icons = rowButtons(tree, "c1").filter((b) => find(group, (n) => n === b) && !b.props.className.includes("row-more"));
  assert.deepEqual(icons.map((b) => b.props["aria-label"].split(" ")[0]), ["Isolate", "Propose", "Mark", "2"], "four, each named");
  assert.ok(icons.every((b) => b.props["data-tip"] && b.props.className.includes("ibtn")), "icon buttons, each with its tip");
  icons[1].props.onClick();
  assert.deepEqual([proposed, opened], [["c1"], ["c1", "c1"]], "Propose proposes and opens nothing else");
});

test("the actions take the row's own last column, small and two to a column: never an overlay across the title", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const lines = css.split("\n").filter((l) => /\.row-actions\b/.test(l));
  assert.ok(lines.length > 0 && lines.every((l) => !/linear-gradient|right: 0; top: 0; bottom: 0/.test(l)),
    "no fade laid over the row's end");
  assert.match(css, /^\.row-actions \{ display: none; flex: none; align-self: center; \}$/m, "in the row's flow, its last item");
  const hover = css.slice(css.indexOf(".report .groups .clash-row:hover .row-actions"));
  assert.match(hover, /^[^}]*\.report \.groups \.clash-row\.pick:focus-within \.row-actions \{\s*display: grid; grid-template-rows: repeat\(2, auto\); grid-auto-flow: column;/,
    "on hover and focus (as specific as workspace.css's rules, and later): a grid two buttons high");
  assert.match(hover, /\.row-actions \.ibtn \{ width: 24px; height: 24px;/, "24 px icon buttons");
  assert.match(hover, /\.row-actions \.row-view \{ display: none; \}/, "the row's own View is the one on screen");
});

test("on the page: Propose fixes from a row proposes for it; Mark sets it aside; same elements narrow the list", async () => {
  const host = await appHost();
  await host.settle();
  const props = () => host.component("ReportList").props;
  const c = host.state.report.clashes[0];
  props().onPropose(c);
  await host.settle();
  assert.equal(host.requests.length, 1, "one proposal, for the clash and its own pair");
  assert.equal(host.state.clash.id, c.id);
  props().onSetAside(c, "Meant to meet");
  host.render();
  assert.deepEqual(host.state.reviewed[c.id], { kind: "by_design", note: "Meant to meet" });
  props().onFocus({ label: "Clashes with A or B", ids: [c.id] });
  host.render();
  assert.deepEqual(host.state.listFocus, { label: "Clashes with A or B", ids: [c.id] });
  host.unmount();
});

test("a row's Isolate: shown when an element is in the model, pressed on the selected row while isolating", () => {
  const calls = [];
  const draw2 = (selected, isolating, m = matches) => draw(list.ReportList({ report, matches: m, selected, onSelect() {}, onImage() {}, fixes: {},
    reviewed: {}, checked: new Set(), onCheck() {}, onFixChecked() {}, insights: null, busy: false, triage: {}, triageFilter: null,
    isolating, onIsolate: (c) => calls.push(c.id) }));
  const isolate = (tree, id) => rowButtons(tree, id).find((b) => /^Isolate the clashing elements|^Show everything again/.test(b.props["aria-label"]));
  const off = draw2("c1", false);
  assert.equal(isolate(off, "c1").props["aria-label"], "Isolate the clashing elements of #1 Supply air main × Transfer plate girder 1000 deep - grid 3");
  assert.equal(isolate(off, "c1").props["aria-pressed"], false);
  isolate(off, "c2").props.onClick();
  assert.deepEqual(calls, ["c2"]);
  const on = draw2("c1", true);
  assert.equal(isolate(on, "c1").props["aria-pressed"], true, "the clash isolated now");
  assert.equal(isolate(on, "c1").props["aria-label"], "Show everything again");
  assert.equal(isolate(on, "c2").props["aria-pressed"], false);
  const gone = draw2(null, false, { ...matches, c9: { a: null, b: null, how: [] } });
  assert.equal(isolate(gone, "c9"), undefined, "nothing of it in the model: nothing to isolate");
});
