import assert from "node:assert/strict";
import test from "node:test";
import { appHost, compiled, find, hasText } from "./app-host.mjs";

/** A fixed clash (a fix kept, or the re-run check no longer finds it) shows a calm "Fixed ✓" state: what was kept,
 * Undo when the newest kept edit is this fix, and "Propose a different fix" as a secondary. Never the big primary
 * "Propose fixes" with "Explore wider fix" and "Go to the clash". */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const co = await import(await compiled("../src/coordination.ts"));
const stub = (src) => url(src);
const { ClashPanel } = await import(await compiled("../src/ClashPanel.tsx", {
  react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "lucide-react": stub("export function RotateCcw(){return null;}"),
  "./api": stub("export const api={imageUrl:()=>'/img'};"), "./ReportList": stub("export const mm=(v)=>String(v);"),
  "./noClash": stub("export const oneElement=()=>false,sameWhy=()=>'';"), "./clashImage": stub("export const drawOverlay=()=>{},focusSquare=()=>null,readClashImage=async()=>null;"),
  "./Triage": stub("export const TRIAGE={};"), "./aiNames": stub("export const aiName=()=>'Model';"),
}));

/** The panel's tree with its hook-free inner components drawn. */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return expand(node.type(node.props));
  const children = node.props?.children;
  return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
}
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";
const button = (tree, label) => find(tree, (n) => n.type === "button" && hasText(n, label));

const el = (name) => ({ global_id: null, ifc_class: "IfcBeam", name, level: null, file: null, system: null, description: null, part_of: null });
const clash = { id: "c1", number: 42, name: "Duct with beam", title: null, test: "MEP vs Structure", a: el("Duct"), b: el("Beam"), images: [] };
const entry = (id, clashes, state = "kept") => ({ id, seq: Number(id.slice(1)), state, clashes });

test("undoableFix: only the newest kept edit, and only when it is this clash's fix (by id or by pair)", () => {
  const log = (undo, entries, can_undo = true) => ({ entries, can_undo, undo });
  const byId = entry("E2", [{ id: "c1", pair: ["duct", "beam"] }]);
  assert.equal(co.undoableFix(log("E2", [entry("E1", []), byId]), "c1"), byId);
  const byPair = entry("E3", [{ id: null, pair: ["beam", "duct"] }]);
  assert.equal(co.undoableFix(log("E3", [byPair]), "c1", ["duct", "beam"]), byPair, "an imported clash is tied by its pair");
  assert.equal(co.undoableFix(log("E4", [byId, entry("E4", [{ id: "other", pair: ["x", "y"] }])]), "c1", ["duct", "beam"]), null,
    "a newer edit for another clash: Undo would take that one back, so it is not offered here");
  assert.equal(co.undoableFix(log(null, [byId], false), "c1"), null);
  assert.equal(co.undoableFix(null, "c1"), null);
});

test("a fixed clash's panel: Fixed ✓, what was kept, Undo and Propose a different fix as a secondary", () => {
  const calls = [];
  const tree = expand(ClashPanel({ reportId: "r", clash, match: undefined, measure: null, onImage() {}, fix: "Raised the duct 400 mm",
    origin: "iris", onUndo: () => calls.push("undo"), onProposeAgain: () => calls.push("propose") }));
  const all = text(tree);
  assert.ok(all.includes("Fixed ✓") && all.includes("Kept in this session: Raised the duct 400 mm."), all);
  button(tree, "Undo").props.onClick();
  const again = button(tree, "Propose a different fix");
  assert.equal(again.props.className, "link", "a secondary text button, not the primary");
  again.props.onClick();
  assert.deepEqual(calls, ["undo", "propose"]);
  assert.equal(button(tree, "Propose fixes"), undefined);

  const older = expand(ClashPanel({ reportId: "r", clash, match: undefined, measure: null, onImage() {}, fix: "Raised", onProposeAgain() {}, busy: true }));
  assert.equal(button(older, "Undo"), undefined, "no Undo when the newest kept edit is not this fix");
  assert.equal(button(older, "Propose a different fix").props.disabled, true, "busy: nothing to press");

  const gone = text(expand(ClashPanel({ reportId: "r", clash, match: undefined, measure: null, onImage() {}, resolved: true })));
  assert.ok(gone.includes("Fixed ✓") && gone.includes("no longer finds it"), "resolved by geometry is fixed too");
  const open = text(expand(ClashPanel({ reportId: "r", clash, match: undefined, measure: null, onImage() {} })));
  assert.ok(!open.includes("Fixed ✓"), "an open clash has no fixed state");
});

test("the workspace: a fixed clash has no Propose fixes, Explore wider fix or Go to the clash; the panel holds Undo and proposing again", async () => {
  const kept = { ...entry("E1", [{ id: "clash", pair: ["duct", "beam"] }]), when: "", source: "agent", kind: "move", title: "Raise",
    summary: "Raised the duct 400 mm", actor: null, elements: ["duct"], created: [], removed: [], names: {}, files: [0], revision: 1,
    follows: [], check: null, warnings: [], status: null, has_picture: false, params: {} };
  const journal = { entries: [kept], can_undo: true, can_redo: false, undo: "E1", redo: null, decisions: [] };
  const undone = [];
  const host = await appHost({ initial: { fixes: { clash: "Raised the duct 400 mm" }, journal },
    api: { journal: async () => journal, undo: (sid, id) => { undone.push([sid, id]); return Promise.reject(new Error("stop here")); } } });
  for (const label of ["Propose fixes", "Explore wider fix", "Go to the clash"]) assert.equal(host.button(label), undefined, label);
  const panel = host.component("ClashPanel");
  assert.equal(panel.props.fix, "Raised the duct 400 mm");
  panel.props.onUndo(); await host.settle();
  assert.deepEqual(undone, [["scene", undefined]], "Undo is the edit log's own undo of the newest edit");
  host.component("ClashPanel").props.onProposeAgain(); host.render();
  assert.equal(host.requests.length, 1, "Propose a different fix runs the same proposal");
  host.unmount();

  const open = await appHost();
  assert.ok(open.button("Propose fixes"), "an open clash keeps the primary Propose fixes");
  assert.equal(open.component("ClashPanel").props.onUndo, undefined);
  open.unmount();
});
