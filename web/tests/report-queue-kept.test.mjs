import assert from "node:assert/strict";
import test from "node:test";
import { appHost, compiled, option } from "./app-host.mjs";

/** Fixes kept through the review queue (docs/review-queue.md) count in the coordination report like fixes accepted on
 * the clash panel: each kept clash gets its evidence (a page in the PDF, with the before and after pictures) and the
 * report dialog's "Fixes: n applied". QA once saw "2 fixed" in the header and "0 applied, 0 proposed" in the dialog. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const react = url(`export const useState=(name,v)=>[name==="models"?[]:(typeof v==="function"?v():v),()=>{}];
export const useEffect=()=>{};`);
const icons = url(["CircleCheck", "CircleX", "Download", "FileText", "LoaderCircle", "X"].map((n) => `export function ${n}(){return null;}`).join("\n"));
const reportApi = url(`export const api={teams:async()=>({models:[]})}; export const apiUrl=(p)=>p;`);
const { ReportDialog, reportCounts } = await import(await compiled("../src/ReportDoc.tsx", { react,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons, "./api": reportApi,
  "./aiNames": await compiled("../src/aiNames.ts", {}) }, true));
const text = (node) => typeof node === "string" || typeof node === "number" ? String(node)
  : Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : "";

const clash = (id) => ({ id, name: id, a: {}, b: {}, images: [] });
const report = { id: "report", title: "Report", clashes: [clash("clash"), clash("tray"), clash("open")] };
const matches = { clash: { a: "duct", b: "beam", how: [] }, tray: { a: "tray", b: "beam", how: [] }, open: { a: "pipe", b: "beam", how: [] } };
const trayFix = { ...option, title: "Offset the tray", kind: "offset", moved: ["tray"] };

test("App: two fixes kept through the review queue are the report's applied fixes, each with its page and pictures", async () => {
  const host = await appHost({ initial: { report, matches }, api: { match: async () => matches } });
  host.state.reviewOpen = true; host.render();
  const kept = (id, o, at) => ({ files: [], pieces: [], decisions: [{ clash_id: id, clash_key: id, decision: "accepted", at,
    option: { title: o.title, kind: o.kind, moved: o.moved }, state: "geometry_validated" }] });
  await host.component("ReviewQueue").props.onKept(kept("clash", option, 1),
    { option, pair: ["duct", "beam"], clashIds: ["clash"] });
  await host.settle();
  await host.component("ReviewQueue").props.onKept(kept("tray", trayFix, 2),
    { option: trayFix, pair: ["tray", "beam"], clashIds: ["tray"] });
  await host.settle();

  const { evidence } = host.state;
  assert.deepEqual(Object.keys(evidence).sort(), ["clash", "tray"], "only the kept clashes, not the open one");
  for (const [id, title] of [["clash", "Single fix"], ["tray", "Offset the tray"]]) {
    assert.equal(evidence[id].status, "accepted");
    assert.equal(evidence[id].title, title);
    assert.ok(evidence[id].before_img && evidence[id].after_img, "the before and after pictures for the PDF page");
  }
  assert.deepEqual(host.state.fixes, { clash: "Single fix", tray: "Offset the tray" }, "the header's fixed count agrees");

  // What the report dialog makes of it: a page for each kept fix, and "2 applied".
  assert.deepEqual(reportCounts(report.clashes, {}, evidence, {}).pages.map((c) => c.id), ["clash", "tray"]);
  const dialog = ReportDialog({ report, sceneId: "scene", triage: {}, triageDone: false, triageRunning: false, teams: {},
    onTeams: () => {}, evidence, signoffs: {}, reviewed: {}, onRunTriage: () => {}, onClose: () => {} });
  const t = text(dialog).replace(/\s+/g, " ");
  assert.match(t, /Fixes2 applied, 0 proposed/);
  assert.match(t, /2 clashes need action/);
  host.unmount();
});

test("App: a penetration kept through the queue but not cut is a recommendation on the report, not an applied fix", async () => {
  const host = await appHost({ initial: { report, matches }, api: { match: async () => matches } });
  host.state.reviewOpen = true; host.render();
  const hole = { ...option, title: "Sleeve through the beam", kind: "penetration" };
  await host.component("ReviewQueue").props.onKept({ files: [], pieces: [], cut: false, blocked_by: "structure must cut it" },
    { option: hole, pair: ["duct", "beam"], clashIds: ["clash"] });
  await host.settle();
  assert.equal(host.state.evidence.clash.status, "recommended");
  assert.equal(host.state.evidence.clash.blocked_by, "structure must cut it");
  assert.equal(host.state.fixes.clash, undefined, "not fixed: the host's team has yet to cut it");
  host.unmount();
});
