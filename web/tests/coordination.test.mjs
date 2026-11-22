import assert from "node:assert/strict";
import test from "node:test";
import { compiled, find } from "./app-host.mjs";

/** Coordination overview and clash header (docs/engineer-workflow.md, "Classification", severity, status): every class,
 * severity and status comes from a field the page already holds. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const co = await import(await compiled("../src/coordination.ts"));

// The components, their stylesheet left out (node has no loader for it) and their icons stubbed.
const coordUrl = await compiled("../src/coordination.ts");
const icons = url(["Brain", "Radar", "Check", "ChevronLeft", "ChevronRight", "Copy", "LocateFixed"].map((n) => `export function ${n}(){return null;}`).join("\n"));
const deps = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons, "./coordination": coordUrl };
const noCss = (u) => url(Buffer.from(u.slice(u.indexOf(",") + 1), "base64").toString().replace(/^import "\.\/coordination\.css";$/m, ""));
const { CoordinationOverview } = await import(noCss(await compiled("../src/CoordinationOverview.tsx", deps)));
const { ClashHeader } = await import(noCss(await compiled("../src/ClashHeader.tsx", deps)));

/** Draw a component's tree, calling the hook-free components inside it (CopyId keeps its state, so it stays an element). */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function" && node.type.name !== "CopyId") return expand(node.type(node.props));
  const children = node.props?.children;
  return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } };
}
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";
const findAll = (node, predicate, out = []) => {
  if (Array.isArray(node)) { for (const n of node) findAll(n, predicate, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
};

const el = (name, gid, extra = {}) => ({ global_id: gid, ifc_class: "IfcBeam", name, level: "Level 02", file: "Structure.ifc", system: null,
  description: null, part_of: null, ...extra });
let seq = 0;
const clash = (over = {}) => ({ id: `s${++seq}`, name: "Duct with beam", guid: null, test: "MEP vs Structure", test_type: "hard", tolerance_m: 0.001,
  status: "new", distance_m: -0.3, point: [0, 0, 0], grid: null, a: el("Beam", "GA"), b: el("Duct", "GB", { ifc_class: "IfcDuctSegment", file: "MEP.ifc", system: "Supply air" }),
  images: [], source: "iris", number: seq, title: null, ref: null, ...over });
const verdict = (v, over = {}) => ({ verdict: v, source: "model", severity: v === "real_clash" ? "high" : "none", ...over });

test("classification: an overlap read as real, or not triaged yet, is an actual clash", () => {
  assert.equal(co.classify(clash(), verdict("real_clash")), "actual");
  assert.equal(co.classify(clash()), "actual", "hard overlap, no triage");
  assert.equal(co.classify(clash({ test_type: "clearance", distance_m: -0.01 })), "actual", "an overlap on a clearance test");
  assert.equal(co.classify(clash({ test_type: null })), "actual", "no test type is a hard test, as the server reads it");
  assert.equal(co.classify(clash({ test_type: "hard_conservative", source: "c.xml" })), "actual", "Navisworks' conservative hard test");
  assert.equal(co.classify(clash(), verdict("real_clash", { basis: "strictness", model_verdict: "by_design" })), "actual",
    "strictness kept a low-confidence by design as real");
});

test("classification: a clearance gap is a clearance issue, whatever triage made of the overlap it is not", () => {
  assert.equal(co.classify(clash({ test_type: "clearance", distance_m: 0.012, tolerance_m: 0.025 })), "clearance");
  assert.equal(co.classify(clash({ test_type: "clearance", distance_m: 0 })), "clearance", "zero gap");
  assert.equal(co.classify(clash({ test_type: "clearance", distance_m: 0.012 }), verdict("real_clash")), "clearance");
});

test("classification: settled facts and verdicts place the rest; a duplicate is a modelling error", () => {
  assert.equal(co.classify(clash({ distance_m: -0.0005 }), verdict("by_design", { basis: "touch", source: "rule" })), "touching");
  assert.equal(co.classify(clash(), verdict("by_design", { basis: "requirement", rule: 0, source: "rule" })), "by_design");
  assert.equal(co.classify(clash(), verdict("by_design", { basis: "reviewed", source: "rule" })), "by_design", "marked not a clash");
  assert.equal(co.classify(clash(), verdict("by_design")), "by_design", "the triage model's own reading");
  assert.equal(co.classify(clash(), verdict("non_physical", { basis: "non_physical", source: "rule" })), "non_conflict");
  assert.equal(co.classify(clash(), verdict("non_physical")), "non_conflict");
  assert.equal(co.classify(clash(), verdict("by_design", { basis: "same_element", source: "rule" })), "non_conflict");
  assert.equal(co.classify(clash(), verdict("by_design", { basis: "no_overlap", source: "rule" })), "non_conflict");
  assert.equal(co.classify(clash(), verdict("modelling_error", { severity: "medium" })), "modelling_error");
  assert.equal(co.classify(clash({ test_type: "duplicate", distance_m: -0.2 })), "modelling_error", "duplicates test, not triaged");
  assert.equal(co.classify(clash({ test_type: "duplicate" }), verdict("real_clash")), "modelling_error", "its own bucket, not actual");
  assert.equal(co.classify(clash({ test_type: "duplicate" }), verdict("by_design", { basis: "reviewed" })), "by_design", "a review stands");
});

test("classification: nothing to place it by is not triaged; a failed or empty reading is no reading", () => {
  assert.equal(co.classify(clash({ distance_m: null })), "untriaged");
  assert.equal(co.classify(clash({ distance_m: 0.004 })), "untriaged", "a gap on a hard test");
  assert.equal(co.classify(clash({ distance_m: null }), verdict("unknown")), "untriaged", "the model gave no answer");
  assert.equal(co.classify(clash({ distance_m: null }), verdict("by_design", { error: "timeout" })), "untriaged", "a failed read");
  assert.equal(co.classify(clash(), verdict("unknown")), "actual", "no answer: the overlap places it, as if not triaged");
  assert.equal(co.classify(clash({ distance_m: null }), verdict("real_clash")), "actual", "triage's word when there is no measure");
});

test("severity is triage's, with no critical tier", () => {
  for (const s of ["high", "medium", "low", "none"]) assert.equal(co.severityOf(verdict("real_clash", { severity: s })), s);
  assert.equal(co.severityOf(undefined), null);
  assert.equal(co.severityOf(verdict("unknown", { severity: undefined })), null);
  assert.equal(co.severityOf(verdict("real_clash", { severity: "critical" })), null);
  assert.equal(co.severityOf(verdict("real_clash", { error: "failed" })), null);
  assert.deepEqual(co.SEVERITIES, ["high", "medium", "low", "none"]);
});

test("status: geometry's proof, then a kept fix, then a review, else open", () => {
  const c = clash();
  const s = (fixes, reviewed, resolvedIds) => co.statusOf(c, { fixes, reviewed, resolvedIds });
  assert.equal(s({}, {}), "open");
  assert.equal(s({}, { [c.id]: { kind: "author", note: "" } }), "sent_to_author");
  assert.equal(s({}, { [c.id]: { kind: "by_design", note: "" } }), "reviewed_by_design");
  assert.equal(s({ [c.id]: "Raise the duct" }, { [c.id]: { kind: "by_design", note: "" } }), "fix_kept_pending_recheck", "a fix outranks a review");
  assert.equal(s({ [c.id]: "Raise the duct" }, {}, new Set([c.id])), "resolved_geometry", "the re-run outranks the fix mark");
  assert.equal(s({}, {}, [c.id]), "resolved_geometry", "an array of ids does too");
  assert.equal(s({}, {}, new Set(["other"])), "open");
});

const FIRST = { new: [], resolved: [], no_longer_checked: [], first: true };
const cov = (touching, excluded) => ({ test: "t", name: "t", kind: "hard", elements_a: 1, elements_b: 1, candidate_pairs: 9, clashes: 1,
  touching, excluded, partial: false, seconds: 1 });

test("overview: classes, severity and status counted per clash; the detector's counts summed over the checks", () => {
  const cs = [clash(), clash(), clash({ test_type: "clearance", distance_m: 0.01 }), clash({ distance_m: 0 }), clash(),
    clash({ test_type: "duplicate" }), clash({ distance_m: null }), clash()];
  const [real, untri, gap, touch, design, dup, nothing, author] = cs;
  const triage = {
    [real.id]: verdict("real_clash", { severity: "high" }),
    [gap.id]: verdict("real_clash", { severity: "medium" }),
    [touch.id]: verdict("by_design", { basis: "touch", source: "rule" }),
    [design.id]: verdict("by_design", { basis: "reviewed", source: "rule" }),
    [author.id]: verdict("modelling_error", { severity: "low" }),
  };
  const fixes = { [real.id]: "Raise the duct" };
  const reviewed = { [design.id]: { kind: "by_design", note: "" }, [author.id]: { kind: "author", note: "" }, [real.id]: { kind: "by_design", note: "" } };
  const models = { coverage: [cov(3, { connected: 4, host: 1 }), cov(2, {})], diff: { ...FIRST, first: false, resolved: [{ id: "gone1", test: "t", a: "x", b: "y" }] } };
  const ducts = { coverage: [cov(1, { assembly: 2 })], diff: { ...FIRST, first: false, resolved: [{ id: "gone1", test: "t", a: "x", b: "y" }, { id: untri.id, test: "t", a: "x", b: "y" }] } };
  const s = co.overview(cs, triage, { fixes, reviewed, checks: [models, ducts] });
  assert.equal(s.total, 8);
  assert.equal(s.triaged, 5);
  assert.deepEqual(s.byClass, { actual: 2, clearance: 1, touching: 1, by_design: 1, non_conflict: 0, modelling_error: 2, untriaged: 1 });
  assert.deepEqual(s.untriagedByClass, { actual: 1, clearance: 0, touching: 0, by_design: 0, non_conflict: 0, modelling_error: 1, untriaged: 1 });
  assert.deepEqual(s.bySeverity, { high: 1, medium: 1, low: 1, none: 2 });
  assert.deepEqual(s.byStatus, { open: 4, fix_kept_pending_recheck: 1, resolved_geometry: 1, reviewed_by_design: 1, sent_to_author: 1 });
  assert.equal(Object.values(s.byStatus).reduce((a, b) => a + b, 0), s.total, "every listed clash has one status");
  assert.equal(s.touchingCount, 6);
  assert.equal(s.meantToMeetCount, 7);
  assert.equal(s.resolvedByGeometry, 2, "unique ids across checks");
  assert.equal(s.checks, 2);
});

test("overview: no checks (an imported report) gives no detector counts; a first run proves nothing resolved yet", () => {
  const cs = [clash({ source: "nw.xml" })];
  const imported = co.overview(cs, {}, { fixes: {}, reviewed: {} });
  assert.equal(imported.touchingCount, null);
  assert.equal(imported.meantToMeetCount, null);
  assert.equal(imported.resolvedByGeometry, null);
  assert.equal(imported.triaged, 0);
  const first = co.overview(cs, {}, { fixes: {}, reviewed: {}, checks: [{ coverage: [cov(0, {})], diff: FIRST }] });
  assert.equal(first.touchingCount, 0);
  assert.equal(first.resolvedByGeometry, null);
  assert.equal(co.overview([], {}, { fixes: {}, reviewed: {}, checks: [] }).total, 0);
});

test("filter: class, severity and status together", () => {
  const c = clash();
  const t = verdict("real_clash", { severity: "high" });
  assert.ok(co.passes(c, t, "open", {}));
  assert.ok(co.passes(c, t, "open", { cls: "actual", severity: "high", status: "open" }));
  assert.ok(!co.passes(c, t, "open", { severity: "low" }));
  assert.ok(!co.passes(c, t, "sent_to_author", { status: "open" }));
  assert.ok(!co.passes(c, undefined, "open", { severity: "high" }), "no reading, no severity");
});

test("clash key: test type and sorted GlobalIds for Iris; Navisworks by report title and its clash name", () => {
  const a = clash({ a: el("A", "zz9"), b: el("B", "aa1") });
  const b = clash({ a: el("B", "aa1"), b: el("A", "zz9") });
  assert.equal(co.clashKey(a), "hard|aa1|zz9");
  assert.equal(co.clashKey(b), co.clashKey(a), "the same pair either way round");
  assert.equal(co.clashKey(clash({ test_type: "clearance", a: el("A", "zz9"), b: el("B", "aa1") })), "clearance|aa1|zz9");
  assert.equal(co.clashKey(clash({ source: "nb.xml", ref: "Clash39" }), "northbank"), "nw|northbank|Clash39");
  assert.equal(co.clashKey(clash({ source: "nb.xml", ref: null, name: "Duct with beam" }), "northbank"), "nw|northbank|Duct with beam");
});

test("distance, limit and location as the header reads them", () => {
  assert.deepEqual(co.distanceText({ distance_m: -0.3 }), { label: "Overlap", value: "300 mm" });
  assert.deepEqual(co.distanceText({ distance_m: 0.012 }), { label: "Gap", value: "12 mm" });
  assert.deepEqual(co.distanceText({ distance_m: 0 }), { label: "Touching", value: "0 mm" });
  assert.deepEqual(co.distanceText({ distance_m: -0.0002 }), { label: "Overlap", value: "0.2 mm" });
  assert.deepEqual(co.distanceText({ distance_m: null }), { label: "Distance", value: "—" });
  assert.deepEqual(co.limitText({ test_type: "clearance", tolerance_m: 0.025 }), { label: "Required clearance", value: "25 mm" });
  assert.deepEqual(co.limitText({ test_type: "hard", tolerance_m: 0.001 }), { label: "Tolerance", value: "1 mm" });
  assert.equal(co.limitText({ test_type: "hard", tolerance_m: null }), null);
  assert.equal(co.locationText(clash()), "Level 02");
  assert.equal(co.locationText(clash({ grid: "C/3", b: el("D", "g", { level: "Level 03" }) })), "A Level 02 · B Level 03 · grid C/3");
  assert.equal(co.locationText(clash({ a: el("A", "1", { level: null }), b: el("B", "2", { level: null }) })), null);
});

const summary = (over = {}) => ({ total: 10, triaged: 0, checks: 1, touchingCount: 4, meantToMeetCount: 9, resolvedByGeometry: null,
  byClass: { actual: 6, clearance: 1, touching: 0, by_design: 0, non_conflict: 0, modelling_error: 1, untriaged: 2 },
  untriagedByClass: { actual: 6, clearance: 1, touching: 0, by_design: 0, non_conflict: 0, modelling_error: 1, untriaged: 2 },
  bySeverity: { high: 0, medium: 0, low: 0, none: 0 },
  byStatus: { open: 9, fix_kept_pending_recheck: 1, resolved_geometry: 0, reviewed_by_design: 0, sent_to_author: 0 }, ...over });
const board = (s, triaged) => {
  const calls = { filter: [], run: 0, triage: 0 };
  const tree = expand(CoordinationOverview({ summary: s, triaged, onFilter: (f) => calls.filter.push(f), onRunChecks: () => calls.run++, onTriage: () => calls.triage++ }));
  return { tree, calls };
};
const button = (tree, label) => find(tree, (n) => n.type === "button" && (n.props["aria-label"] === label || text(n).includes(label)));

test("the overview before triage says so: no severity numbers, a Triage button; the count-only rows are not filters", () => {
  const { tree, calls } = board(summary(), false);
  const all = text(tree);
  assert.ok(all.includes("Not triaged yet"));
  assert.ok(all.includes("AI-assessed (triage)"));
  assert.ok(!/critical/i.test(all), "no critical tier");
  assert.ok(!findAll(tree, (n) => n.type === "button" && /severity:/.test(n.props["aria-label"] ?? "")).length, "no severity rows yet");
  button(tree, "Triage all").props.onClick();
  assert.equal(calls.triage, 1);
  const counts = findAll(tree, (n) => n.props?.className === "coord-row count-only");
  assert.equal(counts.length, 2, "touching pairs and meant to meet");
  for (const row of counts) {
    assert.ok(text(row).includes("count only"));
    assert.ok(!find(row, (n) => n.type === "button"), "a count with no rows is not a filter");
  }
  assert.ok(text(counts[0]).includes("4") && text(counts[1]).includes("9"));
  assert.ok(all.includes("6 not triaged yet"), "the actual clashes say how many are placed by geometry alone");
  assert.ok(all.includes("No check has run again yet"), "resolved by geometry: unknown, not zero");
});

test("each number filters the list: totals, classes, severity and status", () => {
  const { tree, calls } = board(summary({ triaged: 10, bySeverity: { high: 3, medium: 2, low: 1, none: 4 },
    untriagedByClass: { actual: 0, clearance: 0, touching: 0, by_design: 0, non_conflict: 0, modelling_error: 0, untriaged: 0 },
    resolvedByGeometry: 2 }), true);
  button(tree, "Show Actual clash: 6").props.onClick();
  button(tree, "Show High severity: 3").props.onClick();
  button(tree, "Show Open: 9").props.onClick();
  button(tree, "Show Fix kept, awaiting re-check: 1").props.onClick();
  find(tree, (n) => n.type === "button" && n.props["data-tip"] === "Show every clash").props.onClick();
  assert.deepEqual(calls.filter, [{ cls: "actual" }, { severity: "high" }, { status: "open" }, { status: "fix_kept_pending_recheck" }, {}]);
  assert.ok(button(tree, "Show Touching / boundary: 0").props.disabled, "an empty class is not a filter");
  button(tree, "Run checks again").props.onClick();
  assert.equal(calls.run, 1);
  assert.ok(text(tree).includes("Gone from the latest re-run"));
});

test("an empty list says what ran, without numbers it does not have", () => {
  const none = text(expand(CoordinationOverview({ summary: summary({ total: 0, checks: 0, touchingCount: null, meantToMeetCount: null }), triaged: false,
    onFilter() {}, onRunChecks() {}, onTriage() {} })));
  assert.ok(none.includes("No checks have run"));
  const ran = text(expand(CoordinationOverview({ summary: summary({ total: 0 }), triaged: false, onFilter() {}, onRunChecks() {}, onTriage() {} })));
  assert.ok(ran.includes("No clashes on the list") && ran.includes("4 touching pairs") && ran.includes("9 pairs meant to"));
});

test("the clash header: its number and id, class, AI-assessed severity, status, both elements and the measure", () => {
  const c = clash({ number: 42, id: "s9f", title: "Supply main clips the girder", grid: "C/3", test_type: "hard", distance_m: -0.3 });
  const calls = [];
  const tree = expand(ClashHeader({ clash: c, triage: verdict("real_clash", { severity: "high" }), status: "fix_kept_pending_recheck",
    onFocus: () => calls.push("focus"), onNext: () => calls.push("next") }));
  const all = text(tree);
  for (const s of ["#42", "s9f", "Supply main clips the girder", "Actual clash", "High severity", "AI-assessed", "Fix kept, awaiting re-check",
    "Overlap", "300 mm", "Tolerance", "1 mm", "Level 02 · grid C/3", "A · IfcBeam", "B · IfcDuctSegment", "Supply air", "MEP.ifc"])
    assert.ok(all.includes(s), s);
  const ids = findAll(tree, (n) => typeof n.type === "function" && n.type.name === "CopyId").map((n) => n.props.id);
  assert.deepEqual(ids, ["GA", "GB"], "each GlobalId can be copied");
  const systems = findAll(tree, (n) => n.type === "dt" && text(n) === "System");
  assert.equal(systems.length, 1, "A has no system: the row is left out, not invented");
  button(tree, "Focus in 3D").props.onClick();
  button(tree, "Next clash").props.onClick();
  assert.ok(button(tree, "Previous clash").props.disabled, "no previous clash");
  assert.deepEqual(calls, ["focus", "next"]);
});

test("the clash header before triage and on a clearance test: no severity claimed, the required clearance shown", () => {
  const c = clash({ test_type: "clearance", distance_m: 0.012, tolerance_m: 0.025, a: el("Pipe", null), title: null });
  const tree = expand(ClashHeader({ clash: c, status: "open", onFocus() {} }));
  const all = text(tree);
  assert.ok(all.includes("Severity not assessed") && !all.includes("AI-assessed"));
  assert.ok(all.includes("Clearance issue") && all.includes("Gap") && all.includes("12 mm") && all.includes("Required clearance") && all.includes("25 mm"));
  assert.ok(!find(tree, (n) => n.type === "button" && n.props["aria-label"] === "Next clash"), "no list to step through");
  assert.deepEqual(findAll(tree, (n) => typeof n.type === "function" && n.type.name === "CopyId").map((n) => n.props.id), ["GB"], "no GlobalId, no copy");
  const settled = text(expand(ClashHeader({ clash: clash(), triage: verdict("by_design", { basis: "touch", source: "rule" }), status: "open", onFocus() {} })));
  assert.ok(settled.includes("No severity") && settled.includes("by rule") && settled.includes("Touching / boundary"));
});
