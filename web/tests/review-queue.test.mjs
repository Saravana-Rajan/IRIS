import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { appHost, compiled, find, option as hostOption } from "./app-host.mjs";

/** The review queue (docs/review-queue.md): prepared fixes, one clash per screen. AI proposes, geometry proves, the
 * engineer decides: nothing is kept without Accept, and Accept goes through the keep route with who and which clash. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const kinds = await compiled("../src/fixKinds.ts");
const stateUrl = await compiled("../src/proposalState.ts", { "./fixKinds": kinds });
const apiUrl = await compiled("../src/api.ts");   // the real calls: every request goes through globalThis.fetch
const coordUrl = await compiled("../src/coordination.ts");
const modelUrl = await compiled("../src/reviewQueueModel.ts", { "./api": apiUrl, "./coordination": coordUrl, "./proposalState": stateUrl });
const M = await import(modelUrl);
const A = await import(apiUrl);
const C = await import(coordUrl);

// A React stand-in: hooks in call order, effects with their cleanups, an external store that marks the render dirty.
const reactUrl = url(`const h = () => globalThis.__rqHooks;
export const useState = (...a) => h().useState(...a), useRef = (...a) => h().useRef(...a), useMemo = (...a) => h().useMemo(...a),
  useEffect = (...a) => h().useEffect(...a), useSyncExternalStore = (...a) => h().useSyncExternalStore(...a);`);
const icons = url(["Check", "ChevronLeft", "ChevronRight", "Info", "RotateCcw", "Sparkles", "X"].map((n) => `export function ${n}(){return null;}`).join("\n"));
async function components() {
  let src = await readFile(new URL("../src/ReviewQueue.tsx", import.meta.url), "utf8");
  src = src.replace(/^import "\.\/review-queue\.css";$/m, "");   // a stylesheet is Vite's business, not node's
  let { outputText } = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const deps = { react: reactUrl, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons, "./api": apiUrl,
    "./coordination": coordUrl, "./fixKinds": kinds, "./proposalState": stateUrl, "./reviewQueueModel": modelUrl };
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return import(url(outputText));
}
const Q = await components();

function mount(Component, props) {
  const cells = [];
  let cursor = 0, pending = [], dirty = false, tree;
  const hooks = {
    useState(init) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = { v: typeof init === "function" ? init() : init };
      const c = cells[i];
      return [c.v, (n) => { const next = typeof n === "function" ? n(c.v) : n; if (!Object.is(next, c.v)) { c.v = next; dirty = true; } }];
    },
    useRef(init) { const i = cursor++; return (cells[i] ??= { current: init }); },
    useMemo(fn, deps) {
      const i = cursor++, old = cells[i];
      if (!old || deps.some((d, k) => !Object.is(d, old.deps[k]))) cells[i] = { deps, value: fn() };
      return cells[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++, old = cells[i];
      if (old && deps && deps.every((d, k) => Object.is(d, old.deps?.[k]))) return;
      const cell = (cells[i] = { deps, cleanup: old?.cleanup });
      pending.push(() => { old?.cleanup?.(); const c = effect(); cell.cleanup = typeof c === "function" ? c : undefined; });
    },
    useSyncExternalStore(subscribe, get) { const i = cursor++; cells[i] ??= { unsub: subscribe(() => { dirty = true; }) }; return get(); },
  };
  const host = {
    props,
    render(next) {
      if (next) host.props = { ...host.props, ...next };
      let passes = 0;
      do {
        dirty = false; cursor = 0; pending = []; globalThis.__rqHooks = hooks;
        tree = Component(host.props);
        for (const fn of pending) fn();
        if (++passes > 30) throw new Error("render loop");
      } while (dirty);
      return tree;
    },
    get tree() { return tree; },
    find: (p) => find(tree, p),
    text: () => textOf(tree),
    button: (t) => find(tree, (n) => n.type === "button" && textOf(n).includes(t)),
    unmount() { for (const c of cells) { c?.cleanup?.(); c?.unsub?.(); } },
  };
  host.render();
  return host;
}
const textOf = (n) => typeof n === "string" || typeof n === "number" ? String(n)
  : !n || typeof n !== "object" ? "" : [n.props?.children].flat(Infinity).map(textOf).join("");
const settle = async (host) => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); host?.render(); };

// ------------------------------------------------------------------------------------------------- fixtures

const side = (id, name, cls) => ({ global_id: id, ifc_class: cls, name, level: "Level 02", file: "m.ifc", system: null, description: null, part_of: null });
const clashOf = (n, id, a, aName, d, extra = {}) => ({ id, name: `Clash${n}`, guid: null, test: "Hard", test_type: "hard", tolerance_m: null,
  status: null, distance_m: d, point: null, grid: null, a: side(a, aName, "IfcDuctSegment"), b: side("girder", "Transfer girder TB-L02-01", "IfcBeam"),
  images: [], source: "iris", number: n, title: `${aName} through the transfer girder`, ref: null, ...extra });
const clashes = [clashOf(42, "c1", "duct", "Supply air main", -0.3), clashOf(57, "c2", "tray", "Cable tray", -0.4), clashOf(61, "c3", "cw", "Cold water main", -0.4)];
const opt = (title, moved, extra = {}) => ({ title, kind: "move", moved: [moved], delta_m: [0, 0, 0.4], rationale: "The web opening leaves room above.",
  also_needs: "", min_clearance_m: 0.05, split_m: null, preview: [], before: [], checked_against: 214, model: "Gemini Pro",
  pair: [moved, "girder"], ...extra });
const startItems = [
  { key: "k1", clash_ids: ["c1"], element_a: "duct", element_b: "girder", label: "#42", distance_m: -0.3, saved: true },
  { key: "k2", clash_ids: ["c2"], element_a: "tray", element_b: "girder", label: "#57", distance_m: -0.4, saved: false },
  { key: "k3", clash_ids: ["c3"], element_a: "cw", element_b: "girder", label: "#61", distance_m: -0.4, saved: false }];
const prepared = (key, i, extra = {}) => ({ type: "prepared", key, clash_ids: startItems[i].clash_ids, element_a: startItems[i].element_a,
  element_b: "girder", status: "ready", source: "live", options: [opt(`Raise ${startItems[i].element_a} 400 mm`, startItems[i].element_a)],
  understanding: "It runs through the girder.", tried: 2, model: "Gemini Pro", done: i + 1, total: 3, ...extra });
const saved = { label: "Saved AI proposals for this sample", model: "Gemini Pro", made: "2026-11-22" };
const runEvents = (over = {}) => [
  { type: "prepare_start", total: 3, items: startItems, skipped: 0, saved },
  over.k1 ?? prepared("k1", 0), over.k2 ?? prepared("k2", 1), over.k3 ?? prepared("k3", 2),
  { type: "done", ready: 3, failed: 0, total: 3, seconds: 4 }];

const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
const ndjson = (events) => new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 });
/** A fake server behind globalThis.fetch: each request recorded with its parsed body. */
function server(routes = {}) {
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const path = String(u), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method ?? "GET", body });
    for (const [part, fn] of Object.entries(routes)) if (path.includes(part)) return fn(body, calls);
    if (path.endsWith("/fix/apply")) return json({ files: [], pieces: [], decisions: [{ ...body, decision: "accepted", at: 1 }] });
    if (path.endsWith("/decisions")) return json({ decision: { ...body, at: 1 }, decisions: [{ ...body, at: 1 }] });
    return json({ detail: "Not found" }, 404);
  };
  return calls;
}
const fakeViewer = () => {
  const calls = [];
  return { calls, viewer: { setFocus: (...a) => calls.push(["setFocus", ...a]), focusClash: (...a) => calls.push(["focusClash", ...a]),
    showOption: (...a) => calls.push(["showOption", ...a]), preview: (...a) => calls.push(["preview", ...a]), mountIn: (...a) => calls.push(["mountIn", ...a]) } };
};
let keys = [];
globalThis.window = { addEventListener: (t, fn) => { if (t === "keydown") keys.push(fn); },
  removeEventListener: (t, fn) => { keys = keys.filter((k) => k !== fn); } };
const press = (key, target = { tagName: "BODY" }, extra = {}) => {
  let prevented = false;
  for (const fn of [...keys]) fn({ key, target, preventDefault: () => { prevented = true; }, ...extra });
  return prevented;
};

let scene = 0;
/** A queue open on a run the shared store has prepared (each test its own scene, so the store starts again). */
async function openQueue({ events = runEvents(), routes = {}, reviewer = "Asha Rao", onKept, extra = {} } = {}) {
  const sceneId = `scene${++scene}`;
  const calls = server({ "/prepare/stream": () => ndjson(events), ...routes });
  await M.prepareStore.start(sceneId, { report_id: "rep", clash_ids: ["c1", "c2", "c3"], pick: "ids", fixed: [] });
  const { viewer: base, calls: seen } = fakeViewer();
  const viewer = { ...base, ...Object.fromEntries(Object.entries(extra).map(([k, fn]) => [k, (...a) => { seen.push([k, ...a]); return fn(...a); }])) };
  const kept = [], decisions = [], names = [];
  let closed = 0;
  const host = mount(Q.ReviewQueue, { sceneId, reportId: "rep", reportTitle: "Coordination check", clashes, viewer, reviewer,
    onReviewer: (n) => names.push(n), onKept: onKept ?? ((k, info) => { kept.push([k, info]); }), onDecisions: (d) => decisions.push(d),
    onClose: () => { closed++; } });
  return { host, calls, seen, kept, decisions, names, sceneId, closed: () => closed,
    applied: () => calls.filter((c) => c.path.endsWith("/fix/apply")), decided: () => calls.filter((c) => c.path.endsWith("/decisions")) };
}
const titleOf = (host) => textOf(host.find((n) => n.props?.className === "rq-clash-title"));

// ------------------------------------------------------------------------------------------------- the pick

test("pick: the ticked clashes still open come first, in the list's order, at most 8", () => {
  const all = Array.from({ length: 10 }, (_, i) => clashOf(i + 1, `x${i}`, `e${i}`, `Duct ${i}`, -0.1 * (i + 1)));
  const p = M.pickForReview({ clashes: all, triage: {}, ticked: new Set(["x3", "x1", "x2"]), fixed: ["x2"] });
  assert.deepEqual(p, { clash_ids: ["x1", "x3"], pick: "ids", source: "ticked", count: 2, of: 2, why: "the 2 you ticked" });
  const many = M.pickForReview({ clashes: all, triage: {}, ticked: all.map((c) => c.id), fixed: [] });
  assert.equal(many.count, 8); assert.equal(many.clash_ids.length, 8);
  assert.equal(many.why, "the first 8 of the 10 you ticked");
  assert.equal(M.pickForReview({ clashes: all, triage: {}, ticked: ["x4"], fixed: [] }).why, "the clash you ticked");
});

test("pick: else triage's real clashes, high → medium → low, then deepest; ticked but fixed ones fall through", () => {
  const all = [clashOf(1, "a", "e1", "A", -0.1), clashOf(2, "b", "e2", "B", -0.5), clashOf(3, "c", "e3", "C", -0.2), clashOf(4, "d", "e4", "D", -0.9),
    clashOf(5, "e", "e5", "E", -0.3), clashOf(6, "f", "e6", "F", -0.4), clashOf(7, "g", "e7", "G", -0.6)];
  const triage = { a: { verdict: "real_clash", severity: "low", source: "model" }, b: { verdict: "real_clash", severity: "medium", source: "model" },
    c: { verdict: "real_clash", severity: "high", source: "model" }, d: { verdict: "by_design", source: "rule" },
    e: { verdict: "real_clash", severity: "medium", source: "model", error: "timed out" }, f: { verdict: "real_clash", severity: "medium", source: "model" },
    g: { verdict: "real_clash", severity: "high", source: "model" } };
  const p = M.pickForReview({ clashes: all, triage, ticked: ["g"], fixed: ["g"] });
  assert.deepEqual(p.clash_ids, ["c", "b", "f", "a"], "high, then medium deepest first, then low; by design, failed reads and fixed left out");
  assert.equal(p.source, "triage"); assert.equal(p.pick, "ids");
  assert.equal(p.why, "the 4 real clashes triage found");
  assert.equal(M.pickForReview({ clashes: all, triage, ticked: [], fixed: [], max: 2 }).why, "the 2 most severe of the 5 real clashes triage found");
});

test("pick: else the deepest open hard clashes, picked by the server", () => {
  const all = [clashOf(1, "a", "e1", "A", -0.1), clashOf(2, "b", "e2", "B", 0.01), clashOf(3, "c", "e3", "C", -0.2, { test_type: "clearance" }),
    clashOf(4, "d", "e4", "D", -0.3)];
  const p = M.pickForReview({ clashes: all, triage: {}, ticked: new Set(), fixed: ["d"] });
  assert.deepEqual(p, { clash_ids: [], pick: "deepest", source: "deepest", count: 1, of: 1, why: "the deepest open clashes (no triage yet)" });
});

// ------------------------------------------------------------------------------------------------- words, keys, moving

const reduce = (events, s = M.emptyPrep("s|r")) => events.reduce(M.reducePrepare, s);

test("prepare and review words follow the run", () => {
  assert.equal(M.prepareText(null, 8), "Prepare fixes (8)");
  let s = reduce([{ type: "prepare_start", total: 3, items: startItems, skipped: 0, saved: null }]);
  assert.equal(M.prepareText(s, 8), "Preparing fixes: 0 of 3");
  s = reduce([prepared("k1", 0), prepared("k2", 1, { status: "failed", options: [], why: "Nothing kept 25 mm." })], s);
  assert.equal(M.prepareText(s), "Preparing fixes: 2 of 3");
  s = reduce([prepared("k3", 2), { type: "done", ready: 2, failed: 1, total: 3, seconds: 3 }], s);
  assert.equal(M.prepareText(s), "Review fixes (2 ready)");
  assert.equal(M.reviewText(s), "0 of 3 reviewed");
  const eight = { ...s, items: Array.from({ length: 8 }, (_, i) => ({ ...s.items[0], key: `k${i}`,
    decision: i < 2 ? "accepted" : i === 2 ? "rejected" : "pending" })) };
  assert.equal(M.reviewText(eight), "3 of 8 reviewed · 2 accepted · 1 rejected");
  assert.equal(M.prepareText(eight), "Review fixes (5 ready)", "decided ones are no longer waiting for review");
});

test("store events → statuses: waiting, preparing with a stage, ready (verified options only), failed with why", () => {
  let s = reduce([{ type: "prepare_start", total: 3, items: startItems, skipped: ["x"], saved }]);
  assert.equal(s.running, true); assert.equal(s.skipped, 1);
  assert.deepEqual(s.items.map((i) => [i.key, i.status, i.decision]), [["k1", "waiting", "pending"], ["k2", "waiting", "pending"], ["k3", "waiting", "pending"]]);
  assert.equal(M.savedLabel(s.saved), "Saved AI proposals for this sample (Gemini Pro, 22 Nov 2026)");
  s = reduce([{ type: "item", key: "k1", status: "thinking" }, { type: "item", key: "k2", status: "checking", title: "Drop the tray" }], s);
  assert.equal(s.items[0].status, "preparing"); assert.equal(s.items[0].stage, "Iris is working out a fix");
  assert.equal(s.items[1].stage, "Checking “Drop the tray” on the geometry");
  const unchecked = { title: "Only words", kind: "move", rationale: "It passed, trust me" };   // no geometry fields: never ready
  s = reduce([prepared("k1", 0, { options: [unchecked, opt("Raise it", "duct")] }), prepared("k2", 1, { options: [unchecked] })], s);
  assert.equal(s.items[0].status, "ready"); assert.deepEqual(s.items[0].options.map((o) => o.title), ["Raise it"]);
  assert.equal(s.items[1].status, "failed"); assert.equal(s.items[1].why, "No option came back verified by geometry.");
  const ended = reduce([{ type: "done", ready: 1, failed: 1, total: 3, seconds: 9 }], s);
  assert.equal(ended.running, false);
  assert.deepEqual([ended.items[2].status, ended.items[2].why], ["failed", "The run ended before this clash was prepared."]);
  const broke = reduce([{ type: "error", detail: "The model is busy" }], s);
  assert.equal(broke.error, "The model is busy"); assert.equal(broke.items[2].why, "Preparing stopped: The model is busy");
  assert.equal(M.savedLabel(null), "");
  assert.equal(M.savedLabel({ model: "Gemini Pro", made: Date.UTC(2026, 10, 2) / 1000 }), "Saved AI proposals for this sample (Gemini Pro, 2 Nov 2026)");
  assert.equal(M.distanceText(-0.3), "−300 mm"); assert.equal(M.distanceText(0.02), "20 mm"); assert.equal(M.distanceText(null), "");
});

test("nextIndex: the next ready, undecided clash, wrapping; skips failed, waiting and decided; stays when none", () => {
  const it = (status, decision = "pending") => ({ status, decision });
  const items = [it("ready"), it("failed"), it("ready", "accepted"), it("ready"), it("waiting"), it("ready", "rejected")];
  assert.equal(M.nextIndex(items, 0), 3);
  assert.equal(M.nextIndex(items, 3), 0, "wraps round");
  assert.equal(M.nextIndex(items.map((x) => ({ ...x, decision: "accepted" })), 2), 2, "none left: stays");
  assert.equal(M.nextIndex([it("ready")], 0), 0);
  assert.equal(M.firstOpen([it("waiting"), it("ready")]), 1);
});

test("keyAction: A, R, → and ←; never with a modifier, a held A or R, or while typing", () => {
  assert.equal(M.keyAction({ key: "a" }), "accept"); assert.equal(M.keyAction({ key: "A" }), "accept");
  assert.equal(M.keyAction({ key: "r" }), "reject"); assert.equal(M.keyAction({ key: "ArrowRight" }), "next");
  assert.equal(M.keyAction({ key: "ArrowLeft" }), "prev"); assert.equal(M.keyAction({ key: "Escape" }), "close");
  assert.equal(M.keyAction({ key: "x" }), null);
  for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) assert.equal(M.keyAction({ key: "a", [mod]: true }), null, mod);
  assert.equal(M.keyAction({ key: "a", repeat: true }), null, "holding A accepts once");
  assert.equal(M.keyAction({ key: "ArrowRight", repeat: true }), "next");
  assert.equal(M.keyAction({ key: "a", target: { tagName: "INPUT" } }), null);
  assert.equal(M.keyAction({ key: "r", target: { tagName: "textarea" } }), null);
  assert.equal(M.keyAction({ key: "ArrowLeft", target: { tagName: "SELECT" } }), null);
  assert.equal(M.keyAction({ key: "a", target: { tagName: "DIV", isContentEditable: true } }), null);
  assert.equal(M.keyAction({ key: "a", target: { tagName: "SPAN", closest: () => ({}) } }), null, "inside an editable block");
  assert.equal(M.keyAction({ key: "a", target: { tagName: "BUTTON", closest: () => null } }), "accept");
  assert.equal(M.keyAction({ key: "a", defaultPrevented: true }), null);
});

// ------------------------------------------------------------------------------------------------- the stream

test("prepareFixes: posts the pick and reads NDJSON split anywhere; a refusal throws the server's words", async () => {
  const sent = [];
  const enc = new TextEncoder();
  const text = JSON.stringify({ type: "prepare_start", total: 1, items: [startItems[0]], saved: null }) + "\nnot json\n" + JSON.stringify({ type: "done", ready: 0 });
  const chunks = [text.slice(0, 7), text.slice(7, 60), text.slice(60)];
  const fetchImpl = async (u, init) => { sent.push([u, JSON.parse(init.body), init.method]);
    return new Response(new ReadableStream({ start(c) { for (const k of chunks) c.enqueue(enc.encode(k)); c.close(); } }), { status: 200 }); };
  const events = [];
  const body = { report_id: "rep", clash_ids: ["c1"], pick: "ids", fixed: ["c9"] };
  await M.prepareFixes("s1", body, (e) => events.push(e), undefined, fetchImpl);
  assert.deepEqual(sent, [["/api/scenes/s1/prepare/stream", body, "POST"]]);
  assert.deepEqual(events.map((e) => e.type), ["prepare_start", "done"], "a broken line is skipped; the last line needs no newline");
  const refuse = async () => json({ detail: "The proposal cap for today is reached." }, 429);
  await assert.rejects(M.prepareFixes("s1", body, () => {}, undefined, refuse),
    (e) => e instanceof A.ApiError && e.status === 429 && e.message === "The proposal cap for today is reached.");
});

test("the store: one run at a time, a refusal leaves it ready to try again, another list starts empty", async () => {
  let respond = () => json({ detail: "Nothing to prepare: every clash is fixed." }, 422);
  const store = M.createPrepareStore((u, init) => respond(u, init));
  await store.start("s", { report_id: "r", clash_ids: [], pick: "deepest", fixed: [] });
  let s = store.getSnapshot();
  assert.equal(s.scope, "s|r"); assert.equal(s.running, false); assert.equal(s.error, "Nothing to prepare: every clash is fixed.");
  assert.equal(M.prepareText(s, 3), "Prepare fixes (3)");
  let seen = 0; const off = store.subscribe(() => { seen++; });
  respond = () => ndjson(runEvents());
  await store.start("s", { report_id: "r", clash_ids: ["c1"], pick: "ids", fixed: [] });
  s = store.getSnapshot();
  assert.ok(seen > 2, "subscribers hear each event");
  assert.equal(s.error, null); assert.equal(s.items.length, 3); assert.equal(M.prepareText(s), "Review fixes (3 ready)");
  store.decide("other|scope", "k1", "accepted");
  assert.equal(store.getSnapshot().items[0].decision, "pending", "a decision for another list is not this one's");
  store.decide("s|r", "k1", "accepted");
  assert.equal(store.getSnapshot().items[0].decision, "accepted");
  store.use("s", "r2");
  assert.deepEqual(store.getSnapshot(), M.emptyPrep("s|r2"));
  let asked = 0;
  respond = () => { asked++; return ndjson(runEvents()); };
  await Promise.all([store.start("s", { report_id: "r2", clash_ids: ["c1"], pick: "ids", fixed: [] }),
    store.start("s", { report_id: "r2", clash_ids: ["c1"], pick: "ids", fixed: [] })]);
  assert.equal(asked, 1, "a second start while one runs does nothing");
  off();
});

// ------------------------------------------------------------------------------------------------- the entry point

test("entry: Prepare fixes (n) with why, then Preparing fixes: i of n with the shimmer, then Review fixes (n ready)", async () => {
  M.prepareStore.use("entry", "rep");
  let push;
  const calls = server({ "/prepare/stream": () => new Response(new ReadableStream({ start(c) {
    const enc = new TextEncoder(); push = (e) => (e ? c.enqueue(enc.encode(JSON.stringify(e) + "\n")) : c.close()); } }), { status: 200 }) });
  let opened = 0;
  const host = mount(Q.ReviewFixesEntry, { sceneId: "entry", reportId: "rep", reportTitle: "Coordination check", clashes, triage: {},
    ticked: new Set(["c1", "c2"]), fixed: ["c3"], onOpen: () => { opened++; } });
  assert.ok(host.button("Prepare fixes (2)"));
  assert.match(host.text(), /For the 2 you ticked\. Nothing is kept until you accept\./);
  host.button("Prepare fixes (2)").props.onClick();
  assert.equal(opened, 1, "the queue opens at once");
  await settle(host);
  assert.deepEqual(calls[0].body, { report_id: "rep", clash_ids: ["c1", "c2"], pick: "ids", fixed: ["c3"] });
  push(runEvents()[0]); push(prepared("k1", 0)); await settle(host);
  assert.ok(host.button("Preparing fixes: 1 of 3"));
  const line = host.find((n) => n.props?.className?.startsWith?.("rq-entry-line"));
  assert.match(line.props.className, /rq-shimmer/);
  assert.match(textOf(line), /1 ready to review now/);
  host.button("Preparing fixes").props.onClick();
  assert.equal(opened, 2); assert.equal(calls.length, 1, "a second click opens the queue; it does not start again");
  push(prepared("k2", 1)); push(prepared("k3", 2, { status: "failed", options: [], why: "Walls along its length." })); push(runEvents()[4]); push(null);
  await settle(host);
  assert.ok(host.button("Review fixes (2 ready)"));
  assert.match(host.text(), /0 of 3 reviewed · 1 without a verified fix/);
  host.unmount();
});

// ------------------------------------------------------------------------------------------------- the queue

test("queue: the first clash at the viewer, its fix in words; Before | After | Both and moving only preview", async () => {
  const q = await openQueue();
  const { host, seen } = q;
  assert.equal(titleOf(host).replace(/\s+/g, " "), "#42 Supply air main through the transfer girder−300 mm");
  assert.deepEqual(seen.slice(0, 4), [["mountIn", null], ["setFocus", { a: "duct", b: "girder" }], ["focusClash", ["duct", "girder"], null, "#42"],
    ["showOption", { kind: "move", moved: ["duct"], deltaM: [0, 0, 0.4], pieces: [], before: [] }, "after", "#d0342c"]]);
  const text = host.text();
  for (const words of ["AI-proposed", "Geometry-validated ✓", "What moves", "Supply air main", "Direction", "up", "Distance", "400 mm",
    "Clash gone", "min clearance 50 mm", "nothing new hit in 214 elements checked", "re-checked by geometry on accept",
    "AI-drafted", "The web opening leaves room above.", "Proposed by Gemini Pro", "Reviewing as", "Asha Rao",
    "Saved AI proposals for this sample (Gemini Pro, 22 Nov 2026)", "AI-proposed: check before accepting", "0 of 3 reviewed"]) {
    assert.ok(text.includes(words), `shows "${words}"`);
  }
  for (const mode of ["Before", "Both", "After"]) {
    host.find((n) => n.type === "button" && n.props["aria-pressed"] !== undefined && textOf(n) === mode).props.onClick(); host.render();
    assert.equal(seen.at(-1)[2], mode.toLowerCase());
  }
  host.button("Both").props.onClick(); host.render();
  press("ArrowRight"); host.render();
  assert.match(titleOf(host), /^#57/);
  assert.deepEqual(seen.at(-1).slice(0, 1).concat(seen.at(-1).slice(2)), ["showOption", "both", "#d0342c"], "the mode stays as chosen");
  host.find((n) => n.props?.["aria-label"] === "#61: Ready").props.onClick(); host.render();
  assert.match(titleOf(host), /^#61/);
  press("ArrowLeft"); host.render();
  assert.match(titleOf(host), /^#57/);
  assert.deepEqual(q.applied(), [], "nothing is applied without Accept");
  assert.deepEqual(q.decided(), [], "and nothing is recorded");
  host.unmount();
  assert.deepEqual(seen.slice(-3), [["preview", []], ["setFocus", { a: null, b: null }], ["mountIn", null]], "closing gives the view back");
  assert.equal(keys.length, 0, "the keys are let go");
});

test("queue: Accept keeps through fix/apply with the reviewer, clash key, number, clash id and pair; then the next clash", async () => {
  const q = await openQueue();
  q.host.button("Accept").props.onClick();
  await settle(q.host);
  const [apply] = q.applied();
  assert.equal(apply.path, `/api/scenes/${q.sceneId}/fix/apply`);
  assert.equal(apply.body.reviewer, "Asha Rao");
  assert.equal(apply.body.clash_key, C.clashKey(clashes[0], "Coordination check"));
  assert.equal(apply.body.clash_key, "hard|duct|girder");
  assert.equal(apply.body.number, 42);
  assert.equal(apply.body.clash_id, "c1");
  assert.deepEqual(apply.body.option.pair, ["duct", "girder"]);
  assert.equal(apply.body.option.preview, null, "meshes stay on the page");
  assert.equal(q.kept.length, 1);
  assert.deepEqual(q.kept[0][1], { option: q.kept[0][1].option, pair: ["duct", "girder"], clashIds: ["c1"] });
  assert.equal(q.kept[0][1].option.title, "Raise duct 400 mm");
  assert.equal(M.prepareStore.getSnapshot().items[0].decision, "accepted");
  assert.match(titleOf(q.host), /^#57/, "on to the next clash");
  assert.match(q.host.text(), /1 of 3 reviewed · 1 accepted/);
  assert.ok(q.host.find((n) => n.props?.["aria-label"] === "#42: Accepted"));
  q.host.unmount();
});

test("queue: Reject needs a reason and sends it to /decisions; then the next clash", async () => {
  const q = await openQueue();
  q.host.button("Reject").props.onClick(); q.host.render();
  const form = () => q.host.find((n) => n.type === "form" && n.props.className === "rq-reject");
  const input = () => q.host.find((n) => n.type === "input" && n.props["aria-label"] === "Why reject it");
  assert.ok(input(), "a reason field");
  form().props.onSubmit({ preventDefault() {} }); await settle(q.host);
  assert.deepEqual(q.decided(), [], "refused without a reason");
  input().props.onChange({ target: { value: "  Too close to the sprinkler main  " } }); q.host.render();
  form().props.onSubmit({ preventDefault() {} }); await settle(q.host);
  const [d] = q.decided();
  assert.equal(d.body.decision, "rejected");
  assert.equal(d.body.reason, "Too close to the sprinkler main");
  assert.equal(d.body.reviewer, "Asha Rao");
  assert.equal(d.body.clash_id, "c1"); assert.equal(d.body.clash_key, "hard|duct|girder"); assert.equal(d.body.number, 42);
  assert.equal(d.body.option.title, "Raise duct 400 mm");
  assert.equal(q.decisions.length, 1, "the journal hears it");
  assert.deepEqual(q.applied(), []);
  assert.match(titleOf(q.host), /^#57/);
  assert.match(q.host.text(), /1 of 3 reviewed · 1 rejected/);
  q.host.unmount();
});

test("queue keys: A accepts, R opens the reason field, → and ← move; none while typing", async () => {
  const q = await openQueue();
  assert.equal(press("a", { tagName: "INPUT" }), false, "typing an A is just typing");
  press("ArrowRight"); q.host.render(); assert.match(titleOf(q.host), /^#57/);
  press("ArrowLeft"); q.host.render(); assert.match(titleOf(q.host), /^#42/);
  press("r"); q.host.render();
  assert.ok(q.host.find((n) => n.type === "input" && n.props["aria-label"] === "Why reject it"), "R opens the reason field");
  assert.equal(q.host.find((n) => n.type === "input" && n.props["aria-label"] === "Why reject it").props.autoFocus, true);
  press("a"); await settle(q.host);
  assert.deepEqual(q.applied(), [], "A does not accept while a rejection is being written");
  press("Escape"); q.host.render();
  assert.equal(q.host.find((n) => n.type === "form" && n.props.className === "rq-reject"), undefined, "Escape puts the reason away");
  assert.equal(q.closed(), 0);
  assert.equal(press("a", { tagName: "BODY" }, { metaKey: true }), false, "a shortcut of the browser's");
  press("a"); await settle(q.host);
  assert.equal(q.applied().length, 1); assert.match(titleOf(q.host), /^#57/);
  press("Escape"); assert.equal(q.closed(), 1, "Escape closes");
  q.host.unmount();
});

test("queue: a 409 on accept shows the server's words and is not accepted; Request another is offered", async () => {
  const detail = "collision with IfcWall 'W-12' (-35 mm)";
  const q = await openQueue({ routes: { "/fix/apply": () => json({ detail }, 409) } });
  q.host.button("Accept").props.onClick();
  await settle(q.host);
  assert.equal(q.kept.length, 0, "the page is not told of a keep");
  const item = M.prepareStore.getSnapshot().items[0];
  assert.equal(item.decision, "no_longer_passes");
  assert.match(q.host.text(), /No longer passes: collision with IfcWall 'W-12' \(-35 mm\)/);
  assert.match(titleOf(q.host), /^#42/, "it stays on the clash");
  assert.equal(q.host.button("Accept"), undefined);
  assert.ok(q.host.button("Request another"));
  assert.ok(q.host.find((n) => n.props?.["aria-label"] === "#42: No longer passes"));
  assert.match(q.host.text(), /0 of 3 reviewed/);
  q.host.unmount();
});

test("queue: a failed clash says why, offers only Request another; another fix replaces it once geometry passes one", async () => {
  const why = "None of the 4 fixes tried passed the geometry check: walls and other services along its length.";
  const q = await openQueue({ events: runEvents({ k2: prepared("k2", 1, { status: "failed", options: [], why }) }),
    routes: { "/propose/stream": () => ndjson([{ type: "thinking", round: 1 },
      { type: "result", understanding: "Offset it", options: [opt("Offset the tray 250 mm", "tray", { kind: "offset", split_m: [2.6, 4.4], delta_m: [0, 0, 0.25] })],
        attempts: [], clearance_m: 0.025, model: "Gemini Pro" }]) } });
  q.host.find((n) => n.props?.["aria-label"] === "#57: No verified fix").props.onClick(); q.host.render();
  const text = q.host.text();
  assert.match(text, /No verified fix found/); assert.ok(text.includes(why));
  assert.equal(q.host.button("Accept"), undefined); assert.equal(q.host.button("Reject"), undefined);
  q.host.button("Request another").props.onClick();
  await settle(q.host);
  const ask = q.calls.find((c) => c.path.endsWith("/propose/stream"));
  assert.deepEqual([ask.body.element_a, ask.body.element_b, ask.body.report_id, ask.body.clash_id], ["tray", "girder", "rep", "c2"]);
  assert.deepEqual(q.decided(), [], "no proposal to record a decision on");
  const item = M.prepareStore.getSnapshot().items[1];
  assert.equal(item.status, "ready"); assert.equal(item.decision, "pending");
  assert.match(q.host.text(), /Offset the tray 250 mm/);
  assert.ok(q.host.button("Accept"));
  q.host.unmount();
});

test("queue: Request another on a fix records it, tells the model what was set aside, and shows the new verified fix", async () => {
  let release;
  const q = await openQueue({ routes: { "/propose/stream": () => new Promise((r) => { release = () => r(ndjson([
    { type: "checking", index: 0, title: "Lower it", kind: "move" },
    { type: "result", understanding: "Below", options: [opt("Lower duct 300 mm", "duct", { delta_m: [0, 0, -0.3] })], attempts: [] }])); }) } });
  q.host.button("Request another").props.onClick();
  await settle(q.host);
  const [d] = q.decided();
  assert.equal(d.body.decision, "requested_another"); assert.equal(d.body.reviewer, "Asha Rao");
  assert.match(q.host.text(), /Iris is preparing another fix…/);
  assert.ok(q.host.find((n) => n.props?.["aria-label"] === "#42: Preparing another"));
  const ask = q.calls.find((c) => c.path.endsWith("/propose/stream"));
  assert.match(ask.body.notes, /The reviewer rejected these fixes, so propose different ones: move "Raise duct 400 mm"/);
  release(); await settle(q.host);
  assert.match(q.host.text(), /Lower duct 300 mm/);
  assert.equal(q.seen.filter(([k]) => k === "showOption").at(-1)[1].deltaM[2], -0.3, "the new fix is what the view previews");
  assert.deepEqual(q.applied(), []);
  q.host.unmount();
});

test("queue: the reviewer's name is changed in place and kept through onReviewer", async () => {
  const q = await openQueue({ reviewer: "" });
  assert.match(q.host.text(), /Reviewing as no name yet · add your name/);
  q.host.button("add your name").props.onClick(); q.host.render();
  const input = q.host.find((n) => n.type === "input" && n.props["aria-label"] === "Your name");
  input.props.onChange({ target: { value: " Ben Ode " } }); q.host.render();
  q.host.find((n) => n.type === "form" && n.props.className === "rq-reviewer-form").props.onSubmit({ preventDefault() {} }); q.host.render();
  assert.deepEqual(q.names, ["Ben Ode"]);
  q.host.unmount();
});

// ------------------------------------------------------------------------------------------------- in the App

test("App: the entry sits in the clash list's head, opens the queue, and a kept fix marks the clash fixed", async () => {
  const host = await appHost();
  const head = host.component("ReportList").props.status;
  const entry = find(head, (n) => n.type?.name === "ReviewFixesEntry");
  assert.ok(entry, "Review fixes is on Clash review");
  assert.deepEqual([entry.props.sceneId, entry.props.reportId, entry.props.reportTitle], ["scene", "report", "Report"]);
  assert.equal(entry.props.clashes, host.state.report.clashes);
  assert.equal(host.component("ReviewQueue"), undefined);
  entry.props.onOpen(); host.render();
  const queue = host.component("ReviewQueue");
  assert.ok(queue, "the queue opens over the workspace");
  assert.equal(queue.props.viewer, host.viewer);
  queue.props.onReviewer("Asha Rao"); host.render();
  assert.equal(host.component("ReviewQueue").props.reviewer, "Asha Rao");
  const decision = { clash_id: "clash", clash_key: "k", decision: "accepted", at: 1, option: { title: "Single fix", kind: "move", moved: ["duct"] }, state: "geometry_validated" };
  await host.component("ReviewQueue").props.onKept({ files: [], pieces: [], decisions: [decision] },
    { option: hostOption, pair: ["duct", "beam"], clashIds: ["clash"] });
  await host.settle();
  assert.deepEqual(host.state.fixes, { clash: "Single fix" }, "the clash is fixed on the list");
  assert.ok(host.actions.some(([k, v]) => k === "preview" && Array.isArray(v) && v.length === 0), "the preview is cleared for the kept model");
  host.component("ReviewQueue").props.onClose(); host.render();
  assert.equal(host.component("ReviewQueue"), undefined);
  host.unmount();
});

test("queue: closing puts the camera back where it was and clears the clash marker; the pair is held after the page's effects", async () => {
  const q = await openQueue({ extra: { pose: () => "pose-at-open", applyPose: () => undefined, setMarker: () => undefined } });
  const { host, seen } = q;
  assert.deepEqual(seen[0], ["pose"], "the camera is read before the view moves into the queue");
  // The page sets its own focus after the queue's effects (say after a keep): the queue's pair comes back once they ran.
  seen.length = 0;
  host.render();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen.filter(([k]) => k === "setFocus").at(-1), ["setFocus", { a: "duct", b: "girder" }]);
  host.unmount();
  assert.deepEqual(seen.slice(-5), [["preview", []], ["setFocus", { a: null, b: null }], ["setMarker", null], ["mountIn", null],
    ["applyPose", "pose-at-open", false]], "the view goes back as it was");
});
