import assert from "node:assert/strict";
import test from "node:test";
import { compiled, find } from "./app-host.mjs";

/** The report dialog (docs/architecture/14-files-in-and-out.md, "Coordination report"): triage is optional. A clash
 * with a fix gets its page without it, and the clashes nobody sorted are counted as not triaged. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
// Hooks by name (the test host labels each useState): the teams table as loaded, everything else its first value.
const react = url(`export const useState=(name,v)=>[name==="models"?globalThis.__reportModels:(typeof v==="function"?v():v),()=>{}];
export const useEffect=()=>{};`);
const icons = url(["CircleCheck", "CircleX", "Download", "FileText", "LoaderCircle", "X"].map((n) => `export function ${n}(){return null;}`).join("\n"));
const api = url(`export const api={teams:async()=>({models:[]})}; export const apiUrl=(p)=>p;`);
const { ReportDialog, reportCounts } = await import(await compiled("../src/ReportDoc.tsx", { react,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons, "./api": api,
  "./aiNames": await compiled("../src/aiNames.ts", {}) }, true));

const text = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";
const clash = (id) => ({ id, name: id, test: "MEP vs Structure", a: { file: "MEP.ifc" }, b: { file: "Structure.ifc" } });
const clashes = ["c1", "c2", "c3", "c4"].map(clash);
const accepted = { c1: { status: "accepted", title: "Raise the duct" } };
const marked = { c3: { kind: "by_design", note: "" } };
const noop = () => {};

function dialog(over = {}) {
  globalThis.__reportModels = "models" in over ? over.models : [{ file: "MEP.ifc", guess: "MEP", elements: 3 }];
  const runs = [];
  const tree = ReportDialog({ report: { id: "r", title: "Report", clashes }, sceneId: "s", triage: {}, triageDone: false,
    triageRunning: false, teams: {}, onTeams: noop, evidence: accepted, signoffs: {}, reviewed: marked,
    onRunTriage: () => runs.push("triage"), onClose: noop, ...over });
  const build = find(tree, (n) => n.props?.["data-tour"] === "build");
  const triageAll = find(tree, (n) => n.type === "button" && text(n) === "Triage all");
  return { tree, t: text(tree).replace(/\s+/g, " "), build, triageAll, runs };
}

test("a report's pages and untriaged clashes: a fix is a page without triage; triage only sorts the rest", () => {
  const none = reportCounts(clashes, {}, accepted, marked);
  assert.deepEqual(none.pages.map((c) => c.id), ["c1"]);
  assert.equal(none.untriaged, 2, "c2 and c4: no verdict, no fix, no mark (c3 is marked by design)");
  const sorted = reportCounts(clashes, { c2: { verdict: "real_clash" }, c4: { verdict: "by_design" } }, accepted, marked);
  assert.deepEqual(sorted.pages.map((c) => c.id), ["c1", "c2"]);
  assert.equal(sorted.untriaged, 0);
});

test("Build the report works without Triage all: the accepted fix gets its page, the rest are named not triaged", () => {
  const { t, build, triageAll, runs } = dialog();
  assert.equal(build.props.disabled, false, "no triage is needed to build");
  assert.match(t, /1 clash needs action · 2 not triaged \(listed by clash test\)/);
  assert.match(t, /Triage is optional/);
  assert.match(t, /the report will say DRAFT/, "untriaged clashes keep it a draft");
  assert.doesNotMatch(t, /after triage|Run it first/);
  assert.ok(triageAll, "triage stays offered, as a secondary");
  assert.match(triageAll.props.className, /ghost/);
  triageAll.props.onClick();
  assert.deepEqual(runs, ["triage"]);
});

test("while triage runs, the report can still be built; with the teams unread it waits for them", () => {
  const running = dialog({ triageRunning: true, triage: { c2: { verdict: "real_clash" } } });
  assert.equal(running.build.props.disabled, false);
  assert.match(running.t, /Triage is running \(1 of 4\)\. Build now/);
  assert.equal(running.triageAll, undefined);
  assert.equal(dialog({ models: null }).build.props.disabled, true, "the teams table is still loading");
  const done = dialog({ triageDone: true, triage: { c2: { verdict: "real_clash" }, c4: { verdict: "by_design" } } });
  assert.match(done.t, /2 clashes need action/);
  assert.doesNotMatch(done.t, /\d not triaged|Triage is optional/);
});
