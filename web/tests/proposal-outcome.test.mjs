import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { appHost, compiled, find, hasText } from "./app-host.mjs";

/** When nothing passed the geometry check: one calm outcome (App.tsx NoFix), never a wall of red. A designed joint
 * reads as that, with Mark as intentional (a `by_design` decision); otherwise "No safe move found". The refused ideas
 * fold away under "What was tried", and a refused card has no Accept at all. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const S = await import(await compiled("../src/proposalState.ts", { "./fixKinds": await compiled("../src/fixKinds.ts") }));

// The live case (#108): the run worked, and the model said why no move would do.
const UNDERSTANDING = "The ground beam at grid 1 runs 150 mm into pad footing B1. The beam and footing are designed to "
  + "interface (an intentional bearing joint, best resolved as a cast or stepped joint, not a move).";
const refused = (title, other = "IfcFooting") => ({ title, kind: "move", delta_m: [0, 0, -0.15], passed: false, split_m: null,
  reason: `collision with ${other} 'B1' (-150 mm)`, hit_ids: ["footing"], model: "Gemini Pro" });
const clash = { id: "clash", name: "Clash108", number: 108, a: {}, b: {}, images: [] };
const report = { id: "report", title: "Report", clashes: [clash] };
const KEY = "nw|Report|Clash108";   // coordination.clashKey of an imported clash: the report's title and the clash's name

async function noFixHost({ proposal, initial = {}, api = {} }) {
  const host = await appHost({ initial: { report, clash, reviewer: "Ana", ...initial, proposal: { options: [], ...proposal } }, api });
  await host.settle();
  return host;
}
/** NoFix as the page renders it (App's own component, with the props App gives it). */
function noFix(host) {
  const el = host.component("NoFix");
  assert.ok(el, "the no-fix outcome is on the page");
  return el.type(el.props);
}
const button = (tree, text) => find(tree, (n) => n.type === "button" && hasText(n, text));
const textOf = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(textOf).join("");

// ---------------------------------------------------------------------------------------------- the reading

test("a designed joint is read from the triage verdict first, else the model's own plain words; never a hedge or a 'not'", () => {
  const live = S.designedJoint({ understanding: UNDERSTANDING });
  assert.equal(live.by, "model");
  assert.match(live.text, /^The beam and footing are designed to interface/);
  assert.equal(S.designedJoint({ understanding: "The duct runs 300 mm into the girder.", advice: "This overlap is by design: the beam bears on the footing." }).text,
    "This overlap is by design: the beam bears on the footing.", "the advice is read too");
  for (const said of ["The overlap is intentional.", "This is not a real clash: the transom frames into the mullion.",
    "An intentional connection: the post is cast into the plinth."]) assert.ok(S.designedJoint({ understanding: said }), said);
  for (const said of ["The clash is not by design; the duct was modelled too low.", "The overlap is not intentional.",
    "If the overlap is by design, mark it as not a clash; otherwise lower the beam.", "The duct's intentional fall must be kept.",
    "An unintentional overlap between the beam and the footing.", "Confirm whether the beam is designed to bear on the footing.",
    "It isn't designed to bear on the slab.", "The supply duct runs 300 mm into the girder.", ""]) {
    assert.equal(S.designedJoint({ understanding: said }), null, said);
  }
  const triage = { verdict: "by_design", understanding: "The beam bears on the footing." };
  assert.deepEqual(S.designedJoint({ understanding: "Nothing said." }, triage), { by: "triage", text: "The beam bears on the footing." });
  assert.equal(S.designedJoint({ understanding: "Nothing said." }, { verdict: "real_clash" }), null);
  assert.equal(S.stateOf(S.DESIGNED_JOINT), "unverified", "the joint as designed is never geometry-validated");
  assert.throws(() => S.toDecision(S.DESIGNED_JOINT, "geometry_validated", "accepted", "", "", { id: "c", key: "k" }));
});

// ---------------------------------------------------------------------------------------------- the outcome card

test("an intentional result: one calm card, and Mark as intentional records a by_design decision and marks the clash reviewed", async () => {
  const decided = [];
  const host = await noFixHost({
    proposal: { understanding: UNDERSTANDING, attempts: [refused("Lower the ground beam 150 mm"), refused("Raise the footing")], model: "Gemini Pro" },
    api: { decide: async (sid, d) => { decided.push([sid, d]); return { decision: { ...d, at: 1700000000 }, decisions: [{ ...d, at: 1700000000 }] }; } } });
  let card = noFix(host);
  assert.ok(hasText(card, "Looks like a designed joint, not an error."));
  assert.equal(textOf(find(card, (n) => n.type === "p")),
    "Gemini Pro reads this as an intentional connection, and no move passed the geometry check without hitting something else.");
  assert.ok(!hasText(card, "No edit passed") && !hasText(card, "What this teaches"));
  for (const text of ["Propose again", "Flag for the model's author"]) assert.ok(button(card, text), text);

  button(card, "Mark as intentional").props.onClick();
  await host.settle();
  assert.equal(decided.length, 1, "one decision, through the decisions route");
  const [sid, d] = decided[0];
  assert.equal(sid, "scene");
  assert.equal(d.decision, "by_design");
  assert.equal(d.clash_key, KEY);
  assert.equal(d.clash_id, "clash");
  assert.equal(d.number, 108);
  assert.equal(d.reviewer, "Ana");
  assert.match(d.reason, /^Intentional: designed joint\. The beam and footing are designed to interface/);
  assert.deepEqual(d.option, { title: "Designed joint, no edit", kind: "as_designed", moved: [], delta_m: null });
  assert.equal(d.state, "unverified", "nothing was tried on the geometry: never validated");
  assert.equal(host.state.reviewed.clash.kind, "by_design", "Reviewed: out of the Open count");

  card = noFix(host);
  assert.equal(button(card, "Mark as intentional"), undefined, "marked: the chip instead of the button");
  assert.ok(hasText(card, "Marked as intentional"));
  host.unmount();
});

test("the triage verdict held for the clash says it too, and a by_design decision in the edit log marks the clash reviewed", async () => {
  const mark = { clash_id: "old-id", clash_key: KEY, option: { title: "Designed joint, no edit", kind: "as_designed", moved: [] },
    state: "unverified", decision: "by_design", reason: "Intentional: designed joint.", reviewer: "Ana", at: 1700000000 };
  const host = await noFixHost({
    proposal: { understanding: "The ground beam runs 150 mm into the footing.", attempts: [refused("Lower the beam")] },
    api: { triage: async () => ({ model: "m", done: true, results: { clash: { verdict: "by_design", source: "model", understanding: "The beam bears on the footing." } } }),
      journal: async () => ({ entries: [], can_undo: false, can_redo: false, undo: null, redo: null, decisions: [mark] }) } });
  const card = noFix(host);
  assert.ok(hasText(card, "Looks like a designed joint, not an error."));
  assert.match(textOf(card), /Triage reads this as an intentional connection/);
  assert.ok(hasText(card, "The beam bears on the footing."), "the reading that said so");
  assert.deepEqual(host.state.reviewed.clash, { kind: "by_design", note: "Intentional: designed joint." }, "a reopened mark comes back");
  assert.ok(hasText(card, "Marked as intentional") && !button(card, "Mark as intentional"));
  host.unmount();
});

test("a no-pass result that is not intentional reads 'No safe move found', with no 'What this teaches'", async () => {
  const host = await noFixHost({ proposal: { understanding: "The supply duct runs 300 mm into the transfer girder.",
    attempts: [refused("Drop the duct", "IfcWall"), refused("Raise the duct", "IfcWall")], advice: "The mechanical designer decides whether the duct can be flattened." } });
  let card = noFix(host);
  assert.ok(hasText(card, "No safe move found"));
  assert.ok(hasText(card, "Every idea Iris tried would hit something else."));
  assert.ok(hasText(card, "elements in "), "what stood in the way, in one line");
  assert.ok(hasText(card, "What decides it:") && hasText(card, "The mechanical designer decides"));
  for (const gone of ["What this teaches", "Follow the advice below", "No edit passed", "Looks like a designed joint"]) assert.ok(!hasText(card, gone), gone);
  assert.equal(button(card, "Mark as intentional"), undefined);
  assert.ok(button(card, "Propose again") && button(card, "Flag for the model's author"));
  host.state.proposal = { ...host.state.proposal, advice: "" }; host.render();
  card = noFix(host);
  assert.ok(!hasText(card, "What decides it"), "no advice: no line for it");
  button(card, "Flag for the model's author").props.onClick(); host.render();
  assert.equal(host.state.reviewed.clash.kind, "author");
  assert.ok(hasText(noFix(host), "Flagged for the model's author"));
  host.unmount();
});

test("'What was tried' is folded by default and says how many ideas the geometry check refused · Show", async () => {
  const host = await noFixHost({ proposal: { understanding: UNDERSTANDING, attempts: [refused("Lower the beam"), refused("Raise the footing"),
    { ...refused("Move the beam north"), passed: true }] } });
  const tried = host.find((n) => n.type === "details" && n.props.className === "tried");
  assert.ok(tried);
  assert.ok(!tried.props.open, "collapsed: nothing opens it");
  const summary = find(tried, (n) => n.type === "summary");
  assert.match(textOf(summary), /^2 ideas refused by the geometry check · Show/);
  assert.ok(find(summary, (n) => n.props?.className === "tried-hide"), "the word turns to Hide when open (CSS)");
  const cards = [tried.props.children].flat(Infinity).filter((n) => n?.type?.name === "ProposalCard");
  assert.equal(cards.length, 2, "only the refused ones");
  assert.ok(cards.every((c) => !c.props.onAccept && c.props.state === "failed_validation"), "nothing to accept");
  host.unmount();
});

// ---------------------------------------------------------------------------------------------- the refused card

const reactUrl = url(`const slots = []; let i = 0;
export const __render = (fn) => { i = 0; return fn(); };
export const __clear = () => { slots.length = 0; };
export const useState = (v) => { const k = i++; if (!(k in slots)) slots[k] = typeof v === "function" ? v() : v;
  return [slots[k], (n) => { slots[k] = typeof n === "function" ? n(slots[k]) : n; }]; };
export const useRef = (v) => ({ current: v ?? null }); export const useEffect = () => {};`);
const R = await import(reactUrl);
async function proposalCard() {
  let src = await readFile(new URL("../src/ProposalCard.tsx", import.meta.url), "utf8");
  src = src.replace(/^import "\.\/proposal\.css";$/m, "");
  let { outputText } = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const icons = url(["Check", "Columns2", "Info", "PencilRuler", "RotateCcw", "X"].map((n) => `export function ${n}(){return null;}`).join("\n"));
  const deps = { react: reactUrl, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons,
    "./proposalState": await compiled("../src/proposalState.ts", { "./fixKinds": await compiled("../src/fixKinds.ts") }) };
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return (await import(url(outputText))).ProposalCard;
}
const ProposalCard = await proposalCard();
const draw = (props) => { R.__clear(); return R.__render(() => ProposalCard(props)); };

test("a refused card has no Accept button, keeps its evidence, and has no empty action row", () => {
  const attempt = refused("Lower the ground beam 150 mm");
  for (const props of [{}, { onAccept() { throw new Error("must not accept"); } }]) {
    const card = draw({ item: attempt, state: "failed_validation", names: { footing: "Pad footing B1" }, ...props });
    assert.equal(button(card, "Accept"), undefined);
    assert.ok(hasText(card, "collision with IfcFooting 'B1' (-150 mm)"), "the reason stays");
    assert.ok(hasText(card, "Pad footing B1"), "what it hit, by name");
  }
  const bare = draw({ item: attempt, state: "failed_validation", names: {} });
  assert.equal(find(bare, (n) => n.props?.className === "pcard-actions"), undefined);
  const option = { title: "Raise the duct", kind: "move", moved: ["duct"], delta_m: [0, 0, 0.4], min_clearance_m: 0.05, rationale: "", also_needs: "" };
  assert.equal(button(draw({ item: option, state: "geometry_validated", names: {}, onAccept() {} }), "Accept").props.disabled, false,
    "a validated fix keeps its Accept");
});

test("a by_design decision reads 'Marked as intentional'", () => {
  assert.equal(S.decisionWords({ clash_id: "c", clash_key: "k", option: { title: "Designed joint, no edit", kind: "as_designed", moved: [] },
    state: "unverified", decision: "by_design", reviewer: "Ana", reason: "Intentional: designed joint.", at: 5 }).verb, "Marked as intentional");
  const d = S.toDecision(S.DESIGNED_JOINT, "unverified", "by_design", "Intentional: designed joint.", "Ana", { id: "c", key: "k", number: 108 }, 5);
  assert.deepEqual(d, { clash_id: "c", clash_key: "k", number: 108, option: { title: "Designed joint, no edit", kind: "as_designed", moved: [], delta_m: null },
    state: "unverified", decision: "by_design", at: 5, check: { verified: false }, reason: "Intentional: designed joint.", reviewer: "Ana" });
});
