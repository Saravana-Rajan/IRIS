import assert from "node:assert/strict";
import test from "node:test";
import { appHost, option, projectOf } from "./app-host.mjs";

/** The engineer-first workflow wired into the actual App (docs/engineer-workflow.md, "Web contract"): the project pages
 * by address, the step bar over the workspace, and decisions recorded once, by the right route. */

async function completed(host) {
  const work = host.button("Propose fixes").props.onClick(); host.render();
  host.requests.at(-1).resolve({ understanding: "A fix", options: [option], attempts: [], clearance_m: .025 });
  await work; host.render();
}

test("/projects shows the projects home; creating one keeps its id and opens its overview", async () => {
  const host = await appHost({ path: "/projects", projects: { ids: ["p-old"],
    getProject: async (id) => projectOf({ id, name: id === "p-new" ? "Tower B" : "Old" }) } });
  await host.settle();
  const home = host.component("ProjectsHome");
  assert.ok(home, "the projects home is the page");
  assert.deepEqual(host.projects.calls[0], ["list", ["p-old"]], "the ids this browser keeps are asked for");
  home.props.onCreate("Tower B");
  await host.settle();
  assert.deepEqual(host.projects.calls.find((c) => c[0] === "create"), ["create", "Tower B"]);
  assert.equal(host.location.pathname, "/projects/p-new");
  assert.deepEqual(host.state.route, { view: "project", pid: "p-new", step: "overview" });
  assert.deepEqual(host.projects.ids, ["p-new", "p-old"], "the new id is kept first");
  const overview = host.component("ProjectOverview");
  assert.ok(overview, "the project's overview is the page");
  assert.equal(overview.props.step, "overview");
  assert.equal(overview.props.project.name, "Tower B");
  assert.equal(host.component("ProjectsHome"), undefined);
  host.unmount();
});

test("/projects/<pid>/<step>: the step bar over the workspace, each step on its real panel", async () => {
  const files = [{ name: "model.ifc", kind: "IFC", size: 1, sha256: "0" }];
  const asked = [];
  const host = await appHost({ path: "/projects/p1/coordination",
    projects: { getProject: async (id) => { asked.push(id); return projectOf({ id, files, scene_id: "scene" }); } } });
  await host.settle();
  assert.deepEqual(asked, ["p1"]);
  assert.equal(host.projects.calls.some((c) => c[0] === "open"), false, "its models are the ones open: not opened again");
  const bar = host.component("ProjectSteps");
  assert.ok(bar, "the step bar is over the workspace");
  assert.equal(bar.props.step, "coordination");
  assert.equal(host.component("ProjectOverview"), undefined, "Coordination is the workspace, not a page");
  const lead = [host.component("ReportList").props.triageCard.props.children].flat();
  assert.equal(lead[0].type.name, "CoordinationOverview", "the list leads with the coordination overview");
  assert.equal(lead[0].props.summary.total, 1);
  lead[0].props.onFilter({ status: "open" }); host.render();
  assert.equal(host.component("ReportList").props.coord.label, "Open", "a number filters the list");
  assert.equal(host.component("ReportList").props.coord.keep(host.state.report.clashes[0]), true);
  // Models: the import and the model summary take the left pane.
  bar.props.onStep("models");
  host.render();
  assert.equal(host.location.pathname, "/projects/p1/models");
  assert.ok(host.component("ImportPanel"), "import rows and Retry");
  assert.ok(host.component("ModelSummary"), "disciplines from the facet index");
  assert.equal(host.component("ReportList"), undefined);
  // Overview, Reports and Activity are the project's pages.
  host.component("ProjectSteps").props.onStep("reports");
  host.render();
  assert.equal(host.location.pathname, "/projects/p1/reports");
  assert.equal(host.component("ProjectOverview").props.step, "reports");
  host.unmount();
});

test("a project whose models are not open is opened from the server on a workspace step", async () => {
  const files = [{ name: "model.ifc", kind: "IFC", size: 1, sha256: "0" }];
  const host = await appHost({ path: "/projects/p2/models", initial: { sceneId: null, stats: null, report: null, clash: null },
    projects: { getProject: async (id) => projectOf({ id, files, scene_id: "elsewhere" }) },
    api: { detect: async () => { throw new Error("no detection in this test"); } } });
  await host.settle(); await host.settle();
  assert.deepEqual(host.projects.calls.filter((c) => c[0] === "open"), [["open", "p2"]]);
  assert.equal(host.state.sceneId, "scene-p", "the project's scene is adopted, as a resumed session is");
  host.unmount();
});

test("an old #project address becomes its path; Clash review's address names the clash open", async () => {
  const files = [{ name: "model.ifc", kind: "IFC", size: 1, sha256: "0" }];
  const c = { id: "clash", name: "Clash", number: 7, a: {}, b: {}, images: [] };
  const host = await appHost({ hash: "#project/p1/clash", initial: { clash: null, report: { id: "report", title: "Report", clashes: [c] } },
    projects: { getProject: async (id) => projectOf({ id, files, scene_id: "scene" }) } });
  await host.settle();
  assert.equal(host.location.pathname, "/projects/p1/clashes"); assert.equal(host.location.hash, "");
  host.component("ReportList").props.onSelect(c); await host.settle();
  assert.equal(host.location.pathname, "/projects/p1/clashes/7", "the clash picked is in the address");
  host.unmount();
  const again = await appHost({ path: "/projects/p1/clashes/7", initial: { clash: null, report: { id: "report", title: "Report", clashes: [c] } },
    projects: { getProject: async (id) => projectOf({ id, files, scene_id: "scene" }) } });
  await again.settle();
  assert.equal(again.state.clash?.id, "clash", "a shared link opens on that clash");
  again.unmount();
});

test("accept sends who accepts it and never posts an accepted decision of its own", async () => {
  const accepted = [], decided = [];
  const host = await appHost({ initial: { reviewer: "Ana" }, api: {
    accept: async (...args) => { accepted.push(args); return { files: [], pieces: [],
      decisions: [{ clash_id: "clash", clash_key: "nw|Report|Clash", option: { title: "Single fix", kind: "move", moved: ["duct"] },
        state: "geometry_validated", decision: "accepted", reviewer: "Ana", at: 1700000000 }] }; },
    decide: async (sid, d) => { decided.push(d); return { decision: d, decisions: [d] }; } } });
  await completed(host);
  await host.component("ProposalCard").props.onAccept();
  await host.settle();
  assert.equal(accepted.length, 1);
  const [, sent, pair, clashId, review] = accepted[0];
  assert.equal(sent.title, "Single fix"); assert.deepEqual(pair, ["duct", "beam"]); assert.equal(clashId, "clash");
  assert.equal(review.reviewer, "Ana");
  assert.equal(review.clash_key, "nw|Report|Clash", "an imported clash's key, which the server cannot work out");
  assert.deepEqual(decided, [], "the server records the accepted decision with the keep");
  host.unmount();
});

test("reject records the decision with its reason, reviewer and clash", async () => {
  const decided = [];
  const host = await appHost({ initial: { reviewer: "Ana" }, api: {
    decide: async (sid, d) => { decided.push([sid, d]); return { decision: { ...d, at: 1700000000 }, decisions: [{ ...d, at: 1700000000 }] }; } } });
  await completed(host);
  host.component("ProposalCard").props.onReject("Blocks the sprinkler main");
  await host.settle();
  assert.equal(decided.length, 1);
  const [sid, d] = decided[0];
  assert.equal(sid, "scene");
  assert.equal(d.decision, "rejected"); assert.equal(d.reason, "Blocks the sprinkler main"); assert.equal(d.reviewer, "Ana");
  assert.equal(d.clash_id, "clash"); assert.equal(d.clash_key, "nw|Report|Clash");
  assert.equal(d.state, "geometry_validated"); assert.equal(d.option.title, "Single fix");
  assert.equal(Object.values(host.state.rejected)[0].why, "Blocks the sprinkler main", "set aside here too, with why");
  assert.equal(host.component("ProposalCard"), undefined, "a rejected option shows as decided, not as a card to decide");
  host.unmount();
});

test("request another records it and asks again; the reviewer's name is kept in the page", async () => {
  const decided = [];
  const host = await appHost({ api: { decide: async (sid, d) => { decided.push(d); return { decision: d, decisions: [d] }; } } });
  await completed(host);
  host.find((n) => n.type === "input" && n.props.autoComplete === "name").props.onChange({ target: { value: "Ravi" } });
  host.render();
  assert.equal(host.state.reviewer, "Ravi");
  host.component("ProposalCard").props.onAnother();
  await host.settle();
  assert.equal(decided[0].decision, "requested_another"); assert.equal(decided[0].reviewer, "Ravi");
  assert.equal(host.requests.length, 2, "another proposal was asked for");
  host.unmount();
});
