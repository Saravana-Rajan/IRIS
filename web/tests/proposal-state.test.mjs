import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { compiled, find, hasText } from "./app-host.mjs";

/** The proposal card's states (docs/engineer-workflow.md): AI proposes, geometry proves, the engineer decides. Only the
 * geometry gate's own fields make a proposal geometry-validated; nothing the model wrote does. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const stateUrl = await compiled("../src/proposalState.ts", { "./fixKinds": await compiled("../src/fixKinds.ts") });
const S = await import(stateUrl);

// A React stand-in with real useState slots, so the card can be rendered, clicked and rendered again.
const reactUrl = url(`const slots = []; let i = 0;
export const __render = (fn) => { i = 0; return fn(); };
export const __clear = () => { slots.length = 0; };
export const useState = (v) => { const k = i++; if (!(k in slots)) slots[k] = typeof v === "function" ? v() : v;
  return [slots[k], (n) => { slots[k] = typeof n === "function" ? n(slots[k]) : n; }]; };
export const useRef = (v) => ({ current: v ?? null }); export const useEffect = () => {};`);
const R = await import(reactUrl);
const icons = url(["Check", "Columns2", "PencilRuler", "RotateCcw", "X"].map((n) => `export function ${n}(){return null;}`).join("\n"));
async function card() {
  let src = await readFile(new URL("../src/ProposalCard.tsx", import.meta.url), "utf8");
  src = src.replace(/^import "\.\/proposal\.css";$/m, "");   // a stylesheet is Vite's business, not node's
  let { outputText } = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX } });
  const deps = { react: reactUrl, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons, "./proposalState": stateUrl };
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return (await import(url(outputText))).ProposalCard;
}
const ProposalCard = await card();

const names = { duct: "Supply air main SA-MAIN-L02-5", girder: "Transfer girder TB-L02-01", wall: "Wall W-12", tray: "Cable tray LV-TRAY-L02-1" };
const option = { title: "Raise the duct over the girder", kind: "move", moved: ["duct", "bend1", "bend2"], delta_m: [0, 0, 0.4],
  rationale: "  The girder's web opening leaves room above.  ", also_needs: "re-hang the supports; none", min_clearance_m: 0.05,
  placements: {}, split_m: null, preview: null, before: null, checked_against: 214, meets: ["largest move 600 mm"],
  review: "services", model: "Pro model" };
const attempt = { title: "Drop the duct", delta_m: [0, 0, -0.3], passed: false, reason: "collision with IfcWall 'W-12' (-35 mm)",
  kind: "move", split_m: null, hit_ids: ["wall", "unknown-id"], model: "Pro model" };
const recommendation = { title: "Lower the tray 250 mm", kind: "move", element: "tray", delta_m: [0, 0, -0.25], split_m: null,
  rationale: "Below the girder there is room.", also_needs: "", blocked_by: "the requirements allow no edit to cable trays", others: [] };
const idea = { title: "Geometry-validated ✓: raise it, verified and passed", kind: "move",
  rationale: "This passed the geometry check; min clearance 50 mm; checked against 214 elements." };

test("stateOf: the four states, from the gate's own fields only", () => {
  assert.equal(S.stateOf(option), "geometry_validated", "an option from `options` passed the gate");
  assert.equal(S.stateOf(attempt), "failed_validation");
  assert.equal(S.stateOf({ ...attempt, passed: true, reason: "" }), "geometry_validated", "the check passed it");
  assert.equal(S.stateOf(idea), "ai_proposed", "words that claim a check are only words");
  assert.equal(S.stateOf({ index: 1, kind: "move", moved: ["duct"], delta_m: [0, 0, 0.4], pieces: null }), "ai_proposed",
    "a trial in place while the check runs is not yet checked");
  assert.equal(S.stateOf(recommendation), "unverified");
  assert.equal(S.stateOf({ title: "As designed", check: { passed: false, geometry: false } }), "unverified", "as designed");
  assert.equal(S.stateOf({ ...option, check: { passed: true, geometry: false } }), "unverified", "geometry: false wins over any shape");
  assert.equal(S.stateOf({ key: "k", option: null, alternatives: [], recommended: true }), "unverified");
  assert.equal(S.stateOf({ key: "k", option, alternatives: [] }), "geometry_validated", "a plan item with a verified option");
  assert.equal(S.stateOf({ key: "k", option: null, alternatives: [], error: "nothing passed" }), "unverified");
  assert.equal(S.stateOf({ title: "x", kind: "move", check: { passed: false } }), "failed_validation");
  assert.equal(S.stateOf(null), "unverified");
});

test("safeState never claims more than the item supports", () => {
  assert.equal(S.safeState(idea, "geometry_validated"), "ai_proposed");
  assert.equal(S.safeState(attempt, "geometry_validated"), "failed_validation");
  assert.equal(S.safeState(option, "geometry_validated"), "geometry_validated");
  assert.equal(S.safeState(option, "unverified"), "unverified", "a weaker claim stands");
  assert.equal(S.safeState(option), "geometry_validated");
  assert.equal(S.safeState(attempt, "ai_proposed"), "failed_validation", "a failed check is never hidden");
  assert.equal(S.safeState(recommendation, "ai_proposed"), "unverified");
});

test("direction and distance words from delta vectors", () => {
  assert.deepEqual(S.directionWords([0, 0, 0.4]), { direction: "up", distance: "400 mm" });
  assert.deepEqual(S.directionWords([0, 0, -0.15]), { direction: "down", distance: "150 mm" });
  assert.deepEqual(S.directionWords([-0.1, 0.25, 0.0002]), { direction: "west and north", distance: "269 mm (100 mm west, 250 mm north)" });
  assert.deepEqual(S.directionWords([0.3, -0.2, -0.15]),
    { direction: "east, south and down", distance: "391 mm (300 mm east, 200 mm south, 150 mm down)" });
  assert.deepEqual(S.directionWords([0, 0, 0]), {});
  assert.deepEqual(S.directionWords([0.0004, -0.0004, 0]), {}, "under half a millimetre is no move");
  assert.deepEqual(S.directionWords(null), {});
});

test("describe a geometry-validated option: element, direction, distance, AI-drafted reason, constraints, outcome", () => {
  const d = S.describe(option, names, { requiredClearanceMm: 25 });
  assert.equal(d.state, "geometry_validated");
  assert.equal(d.kind, "Move");
  assert.deepEqual(d.element, { id: "duct", name: "Supply air main SA-MAIN-L02-5", carried: 2 });
  assert.equal(d.direction, "up");
  assert.equal(d.distance, "400 mm");
  assert.equal(d.change, undefined, "a plain move is said by direction and distance");
  assert.deepEqual(d.reason, { text: "The girder's web opening leaves room above.", label: "AI-drafted", by: "Pro model" });
  assert.deepEqual(d.constraints, [
    { label: "Required clearance", value: "25 mm" },
    { label: "Requirements met", value: "largest move 600 mm" },
    { label: "Review needed", value: "Needs the services designer's review" },
    { label: "Also needs", value: "re-hang the supports" },
  ]);
  assert.deepEqual(d.expected, ["Clash gone", "50 mm min clearance", "nothing new hit in 214 elements checked"]);
  assert.deepEqual(d.evidence, ["min clearance 50 mm vs 25 mm required", "checked against 214 elements", "re-checked by geometry on accept"]);
  assert.equal(d.failure, undefined);
});

test("describe leaves out what the item does not carry", () => {
  const bare = { title: "Raise it", kind: "move", moved: ["nameless"], delta_m: [0, 0, 0.2], rationale: "", also_needs: "none",
    min_clearance_m: null, split_m: null, preview: null, before: null };
  const d = S.describe(bare, {});
  assert.equal(d.element.name, "nameless", "no name: the GlobalId");
  assert.equal(d.reason, undefined);
  assert.equal(d.model, undefined);
  assert.deepEqual(d.constraints, [], "no required clearance given, nothing met, no review, nothing else needed");
  assert.deepEqual(d.expected, ["Clash gone", "nothing within 500 mm", "nothing new hit"]);
  assert.deepEqual(d.evidence, ["nothing within 500 mm", "checked against the model", "re-checked by geometry on accept"]);
  const seat = S.describe({ ...bare, kind: "seat", delta_m: [0, 0, 0], min_clearance_m: 0, edit: { summary: "seat 40 mm into the slab" } }, {}, { requiredClearanceMm: 25 });
  assert.equal(seat.direction, undefined, "nothing moves");
  assert.equal(seat.distance, undefined);
  assert.equal(seat.change, "seat 40 mm into the slab");
  assert.ok(!seat.constraints.some((c) => c.label === "Required clearance"), "a seat bears on its support");
  assert.deepEqual(seat.expected, ["Clash gone", "bears on its support", "nothing new hit"]);
  const trim = S.describe({ ...bare, kind: "trim", delta_m: [0.06, 0, 0], trim: { end: "start", by_m: 0.06 } }, {});
  assert.equal(trim.direction, "cut back at one end");
  assert.equal(trim.distance, "60 mm");
  assert.equal(trim.change, "trim one end 60 mm");
  const offset = S.describe({ ...bare, kind: "offset", split_m: [2.6, 4.4], delta_m: [0, 0, 0.4] }, {});
  assert.equal(offset.change, "offset 2.60–4.40 m by +400 mm");
  const passed = S.describe({ ...attempt, passed: true, reason: "", checked: 90 }, names);
  assert.deepEqual(passed.expected, ["Clash gone", "nothing new hit in 90 elements checked"], "an attempt carries no clearance: none claimed");
});

test("describe a failed attempt, a recommendation and an idea: no geometry outcome claimed", () => {
  const f = S.describe(attempt, names, { requiredClearanceMm: 25 });
  assert.equal(f.state, "failed_validation");
  assert.equal(f.element, undefined);
  assert.equal(f.direction, "down");
  assert.equal(f.distance, "300 mm");
  assert.deepEqual(f.failure, { reason: "collision with IfcWall 'W-12' (-35 mm)",
    hits: [{ id: "wall", name: "Wall W-12" }, { id: "unknown-id", name: "unknown-id" }] });
  assert.deepEqual(f.expected, []);
  const r = S.describe(recommendation, names);
  assert.equal(r.state, "unverified");
  assert.deepEqual(r.element, { id: "tray", name: "Cable tray LV-TRAY-L02-1", carried: 0 });
  assert.equal(r.direction, "down");
  assert.ok(r.constraints.some((c) => c.label === "Not edited because" && c.value.includes("allow no edit")));
  assert.deepEqual(r.expected, []);
  assert.match(r.evidence[0], /never tried/);
  const i = S.describe(idea, names, { state: "geometry_validated" });
  assert.equal(i.state, "ai_proposed", "a claimed state is not trusted beyond the shape");
  assert.deepEqual(i.expected, []);
  assert.deepEqual(i.evidence, ["not checked by geometry yet"]);
  assert.equal(i.reason.label, "AI-drafted");
});

test("toDecision follows the journal contract", () => {
  const clash = { id: "c42", key: "hard|duct|girder", number: 42 };
  assert.deepEqual(S.toDecision(option, "geometry_validated", "rejected", "  clashes with the sprinkler zone ", " A. Engineer ", clash, 1700000000000), {
    clash_id: "c42", clash_key: "hard|duct|girder", number: 42,
    option: { title: "Raise the duct over the girder", kind: "move", moved: ["duct", "bend1", "bend2"], delta_m: [0, 0, 0.4],
      rationale: "The girder's web opening leaves room above." },
    state: "geometry_validated", decision: "rejected", reason: "clashes with the sprinkler zone", reviewer: "A. Engineer",
    at: 1700000000000, check: { verified: true, min_clearance_m: 0.05, checked_against: 214 },
  });
  const accepted = S.toDecision(option, "geometry_validated", "accepted", "", null, { id: "c1", key: "k" }, 5);
  assert.deepEqual(accepted.check, { verified: true, min_clearance_m: 0.05, checked_against: 214 });
  assert.equal("reason" in accepted || "reviewer" in accepted || "number" in accepted, false, "blank fields are left out");

  const failed = S.toDecision(attempt, "geometry_validated", "rejected", "", "", { id: "c1", key: "k" }, 5);
  assert.equal(failed.state, "failed_validation", "a claimed state never outranks the item");
  assert.deepEqual(failed.check, { verified: false, reason: "collision with IfcWall 'W-12' (-35 mm)" });
  assert.deepEqual(failed.option.moved, []);

  const rec = S.toDecision(recommendation, "unverified", "requested_another", "try the other side", "B", { id: "c2", key: "k2" }, 6);
  assert.deepEqual(rec.option.moved, ["tray"]);
  assert.deepEqual(rec.check, { verified: false });
  assert.equal(S.toDecision({ ...option, delta_m: [0, 0] }, "geometry_validated", "modified", "", "", { id: "c", key: "k" }, 1).option.delta_m, null);

  for (const [item, state] of [[attempt, "failed_validation"], [recommendation, "unverified"], [idea, "geometry_validated"]]) {
    assert.throws(() => S.toDecision(item, state, "accepted", "", "", { id: "c", key: "k" }), /geometry-validated/);
  }
  const words = S.decisionWords({ ...failed, reviewer: undefined, reason: "wrong side" });
  assert.equal(words.verb, "Rejected");
  assert.equal(words.who, "reviewer not recorded");
  assert.equal(words.why, "wrong side");
  assert.equal(words.iso, new Date(5).toISOString());
});

// ---------------------------------------------------------------------------------------------- the card

const render = (props) => { R.__clear(); const draw = () => R.__render(() => ProposalCard(props)); return draw; };
const button = (tree, text) => find(tree, (n) => n.type === "button" && hasText(n, text));

test("card: a validated fix shows its chip, rows and an enabled Accept", () => {
  const calls = [];
  const draw = render({ item: option, state: "geometry_validated", names, requiredClearanceMm: 25,
    onAccept: () => calls.push("accept"), onModify: () => calls.push("modify"), onAnother: () => calls.push("another"),
    onShowBeforeAfter: () => calls.push("before-after"), onReject: () => {} });
  const tree = draw();
  assert.equal(tree.props["data-state"], "geometry_validated");
  assert.ok(hasText(tree, "Geometry-validated ✓"));
  for (const label of ["Element to move", "Direction", "Distance", "Reason ", "Constraints considered", "Expected outcome", "Evidence"]) {
    assert.ok(hasText(tree, label), label);
  }
  assert.ok(hasText(tree, "AI-drafted"));
  assert.ok(hasText(tree, "min clearance 50 mm vs 25 mm required · checked against 214 elements · re-checked by geometry on accept"));
  const accept = button(tree, "Accept");
  assert.equal(accept.props.disabled, false);
  accept.props.onClick();
  button(tree, "Modify").props.onClick();
  button(tree, "Request another").props.onClick();
  button(tree, "Before / after").props.onClick();
  assert.deepEqual(calls, ["accept", "modify", "another", "before-after"]);
  const busy = render({ item: option, state: "geometry_validated", names, onAccept() {}, onReject() {}, onModify() {}, busy: true })();
  assert.ok(["Accept", "Reject", "Modify"].every((t) => button(busy, t).props.disabled), "busy: nothing can be pressed");
});

test("card: Accept is disabled for every state but geometry-validated, whatever the caller claims", () => {
  const cases = [[attempt, "failed_validation", "Failed validation ✕"], [recommendation, "unverified", "Unverified"],
    [idea, "geometry_validated", "AI-proposed"]];
  for (const [item, state, chip] of cases) {
    const tree = render({ item, state, names, onAccept() { throw new Error("must not accept"); } })();
    assert.ok(hasText(tree, chip), chip);
    assert.equal(button(tree, "Accept").props.disabled, true, chip);
  }
  const failed = render({ item: attempt, state: "failed_validation", names })();
  assert.ok(hasText(failed, "collision with IfcWall 'W-12' (-35 mm)"));
  assert.ok(hasText(failed, "Wall W-12, unknown-id"), "what it hit, by name");
  assert.ok(hasText(failed, "None: the geometry check refused it"));
});

test("card: Reject asks for a reason inline before it calls back", () => {
  const reasons = [];
  const draw = render({ item: option, state: "geometry_validated", names, onAccept() {}, onReject: (r) => reasons.push(r) });
  button(draw(), "Reject").props.onClick();
  let tree = draw();
  const input = find(tree, (n) => n.type === "input");
  assert.ok(input, "the reason field opens in the card");
  assert.ok(!button(tree, "Accept"), "the other actions wait");
  const form = find(tree, (n) => n.type === "form");
  assert.equal(button(form, "Reject").props.disabled, true, "no reason, no reject");
  form.props.onSubmit({ preventDefault() {} });
  assert.deepEqual(reasons, []);
  input.props.onChange({ target: { value: "  blocks the access panel " } });
  tree = draw();
  assert.equal(button(find(tree, (n) => n.type === "form"), "Reject").props.disabled, false);
  find(tree, (n) => n.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(reasons, ["blocks the access panel"]);
  assert.ok(button(draw(), "Accept"), "back to the actions");
  button(draw(), "Reject").props.onClick();
  button(draw(), "Cancel").props.onClick();
  assert.ok(button(draw(), "Accept"), "Cancel closes it");
});

test("card: a decided proposal says who, when and why, and offers no actions", () => {
  const decided = S.toDecision(option, "geometry_validated", "rejected", "blocks the access panel", "A. Engineer", { id: "c", key: "k" }, 1700000000000);
  const tree = render({ item: option, state: "geometry_validated", names, decided, onAccept() {}, onReject() {} })();
  assert.ok(hasText(tree, "Rejected"));
  assert.ok(hasText(tree, " by A. Engineer"));
  assert.ok(hasText(tree, "Why: blocks the access panel"));
  assert.ok(find(tree, (n) => n.type === "time" && n.props.dateTime === new Date(1700000000000).toISOString()));
  assert.ok(!button(tree, "Accept"));
});

test("card: an \"as designed\" plan item is Unverified, never validated", () => {
  const item = { title: "Connections, not conflicts: leave as designed", kind: "move", check: { passed: false, geometry: false } };
  const d = S.describe(item, names, { state: "geometry_validated" });
  assert.equal(d.state, "unverified");
  assert.equal(d.failure, undefined, "not a failed check: no check was run");
  const tree = render({ item, state: "geometry_validated", names, onAccept() {} })();
  assert.ok(hasText(tree, "Unverified"));
  assert.equal(button(tree, "Accept").props.disabled, true);
});
