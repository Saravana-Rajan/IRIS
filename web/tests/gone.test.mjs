import assert from "node:assert/strict";
import test from "node:test";
import { appHost, compiled, hasText, option, projectOf } from "./app-host.mjs";

const { api, goneOf, setGoneHandler, setRequirements } = await import(await compiled("../src/api.ts"));
const LOST = "Model not loaded. Open it again.";

test("a 404 naming a scene or report the server let go of reaches the page once, with the server's words", async () => {
  const told = [];
  setGoneHandler((g) => told.push(g));
  const answers = [
    new Response(JSON.stringify({ detail: LOST }), { status: 404, headers: { "X-Iris-Gone": "scene:00f9ee9f67ff" } }),
    new Response(JSON.stringify({ detail: "No such element in these models." }), { status: 404 }),
  ];
  globalThis.fetch = async () => answers.shift();
  await assert.rejects(api.classes("00f9ee9f67ff"), new RegExp(LOST));
  await assert.rejects(api.properties("00f9ee9f67ff", "g"), /No such element/);
  assert.deepEqual(told, [{ kind: "scene", id: "00f9ee9f67ff", detail: LOST }]);
  setGoneHandler(null);

  const headers = (v) => new Headers({ "X-Iris-Gone": v });
  assert.deepEqual(goneOf({ status: 404, headers: headers("report:ab12") }), { kind: "report", id: "ab12" });
  assert.equal(goneOf({ status: 200, headers: headers("scene:ab12") }), null);   // only on a 404
  assert.equal(goneOf({ status: 404, headers: headers("model:ab12") }), null);
  assert.equal(goneOf({ status: 404, headers: new Headers() }), null);
});

test("after a restart the requirements are forgotten too: the 404 naming the models comes on the retry, and reaches the page", async () => {
  const told = [], asked = [];
  setGoneHandler((g) => told.push(g));
  setRequirements("req-old", { version: 1 });
  const answers = [
    new Response(JSON.stringify({ detail: "requirements_unknown" }), { status: 409 }),
    new Response(JSON.stringify({ id: "req-new" }), { status: 200 }),
    new Response(JSON.stringify({ detail: LOST }), { status: 404, headers: { "X-Iris-Gone": "scene:00f9ee9f67ff" } }),
  ];
  globalThis.fetch = async (url, init) => { asked.push([String(url), init?.headers?.["X-Iris-Requirements"] ?? null]); return answers.shift(); };
  await assert.rejects(api.proposeStream("00f9ee9f67ff", "a", "b", undefined, () => {}), (e) => e.status === 404 && e.message === LOST);
  assert.deepEqual(asked.map(([u]) => u.replace(/^.*\/api/, "/api")), ["/api/scenes/00f9ee9f67ff/propose/stream", "/api/requirements", "/api/scenes/00f9ee9f67ff/propose/stream"]);
  assert.equal(asked[2][1], "req-new");
  assert.deepEqual(told, [{ kind: "scene", id: "00f9ee9f67ff", detail: LOST }]);
  setRequirements(null, null); setGoneHandler(null);
});

const accepted = { status: "accepted", title: "Raise the duct", kind: "move", edit: "", clearance: "", clearance_m: .05, rationale: "",
  also_needs: "", moved: ["duct"] };
const detected = (id) => ({ type: "done", report: { id, title: "Run", clashes: [], origin: "iris", sources: ["model.ifc"] },
  coverage: {}, diff: null, elements: 2, seconds: 1 });

test("sample models the server let go of are reopened by themselves, once: the same models and check; a second loss soon after leaves the banner", async () => {
  const opened = [], checked = [];
  const host = await appHost({
    initial: { sceneFiles: ["model.ifc"], report: { id: "report", title: "Run", clashes: [], origin: "iris", sources: ["model.ifc"] } },
    api: { open: async (names) => { opened.push(names); return { id: `scene-${opened.length + 1}`, files: names }; },
           detect: async (sid) => { checked.push(sid); return detected(`report-${checked.length + 1}`); } } });
  await host.settle();
  host.state.fixes = { clash: "Raise the duct" };
  host.state.evidence = { clash: accepted, other: { ...accepted, status: "proposed" } };
  host.state.error = LOST; host.render();
  const errorLine = () => host.find((n) => String(n.props?.className).includes("status-error"));
  const goneLine = () => host.find((n) => String(n.props?.className).includes("status-gone"));
  const reconnectLine = () => host.find((n) => String(n.props?.className).includes("status-reconnect"));
  assert.ok(errorLine());

  host.gone({ kind: "scene", id: "another-scene", detail: LOST });   // a late answer about models since replaced
  assert.deepEqual(host.state.fixes, { clash: "Raise the duct" });
  assert.deepEqual(opened, []);

  host.gone({ kind: "scene", id: "scene", detail: LOST });
  assert.deepEqual(Object.keys(host.state.evidence), ["other"]);   // the fixes kept went with the models
  assert.equal(host.state.reconnecting, true);
  assert.ok(hasText(reconnectLine(), "Reconnecting your models…"), "a calm status while it works");
  assert.ok(hasText(reconnectLine(), "(the server restarted)"));
  assert.equal(errorLine(), undefined);   // the call that failed said so too: never its own error line
  assert.equal(goneLine(), undefined, "no banner while it reconnects");
  await host.settle();
  assert.deepEqual(opened, [["model.ifc"]]);
  assert.deepEqual(checked, ["scene-2"]);
  assert.equal(host.state.sceneId, "scene-2");
  assert.equal(host.state.report.id, "report-2");
  assert.equal(host.state.reconnecting, false);
  assert.equal(goneLine(), undefined);
  assert.equal(reconnectLine(), undefined);
  host.gone({ kind: "report", id: "report", detail: "Clash report not loaded. Open it again." });   // the old one, late
  host.state.error = "Clash report not loaded. Open it again."; host.render();   // and the call that asked says so
  await host.settle();
  assert.equal(goneLine(), undefined);
  assert.equal(errorLine(), undefined);

  // Lost again within the minute: no second automatic try (no loop), the banner and its button instead.
  host.gone({ kind: "scene", id: "scene-2", detail: LOST });
  await host.settle();
  assert.deepEqual(opened, [["model.ifc"]]);
  assert.ok(hasText(goneLine(), "The server restarted, so your open models were closed."));
  assert.equal(host.find((n) => n.props?.["data-tour"] === "export"), undefined);   // nothing left to export from
  host.button("Reopen them").props.onClick();
  await host.settle();
  assert.deepEqual(opened, [["model.ifc"], ["model.ifc"]]);
  assert.equal(host.state.sceneId, "scene-3");
  assert.equal(goneLine(), undefined);
  host.unmount();
});

const IFC = [{ name: "model.ifc", kind: "IFC", size: 1, sha256: "0" }];
const restartClash = { id: "c1", number: 119, name: "Clash", a: { global_id: "duct" }, b: { global_id: "beam" }, images: ["a.png"] };
const pairs = Object.fromEntries(["c1", "c7", "c9"].map((id) => [id, { a: "duct", b: "beam", how: [] }]));
async function projectHost({ openProject } = {}) {
  const opened = [], checked = [];
  let host = null;
  host = await appHost({ path: "/projects/p1/clashes/119",
    initial: { project: projectOf({ id: "p1", scene_id: "scene", files: IFC }), sceneFiles: ["model.ifc"],
      report: { id: "report", title: "Run", clashes: [restartClash], origin: "iris", sources: ["model.ifc"] }, clash: restartClash, matches: pairs },
    api: { match: async () => pairs, detect: async (sid) => { checked.push(sid);
      return { ...detected("report-2"), report: { id: "report-2", title: "Run", origin: "iris", sources: ["model.ifc"],
        clashes: [{ ...restartClash, id: "c7", number: 4, a: { global_id: "pipe" } }, { ...restartClash, id: "c9", a: { global_id: "beam" }, b: { global_id: "duct" } }] } }; } },
    projects: { getProject: async (id) => projectOf({ id, scene_id: host?.state.sceneId ?? "scene", files: IFC }),
      openProject: openProject ?? (async (id) => { opened.push(id);
      return { scene_id: "scene-p", project: projectOf({ id, scene_id: "scene-p", files: IFC }),
        scene: { id: "scene-p", files: ["model.ifc"], checks: [], report_id: null } }; }) } });
  await host.settle();
  return { host, opened, checked };
}
const settleAll = async (host) => { for (let i = 0; i < 6; i++) await host.settle(); };

test("in a project, a propose that meets a restart reconnects from the project's saved models: the clash comes back, with why and Try again, never 'tried 0 ideas'", async () => {
  const { host, opened, checked } = await projectHost();
  assert.deepEqual(host.state.route, { view: "project", pid: "p1", step: "clash", clash: 119 });
  assert.equal(host.state.clash.id, "c1");
  host.button("Propose fixes").props.onClick(); host.render();
  assert.equal(host.requests.length, 1);
  // api.send tells the page first (the 404's X-Iris-Gone), then the stream's call rejects with the same words.
  host.gone({ kind: "scene", id: "scene", detail: LOST });
  assert.equal(host.state.reconnecting, true);
  assert.equal(host.state.projectBusy, "Reconnecting your models… (the server restarted)");
  assert.ok(hasText(host.find((n) => String(n.props?.className).includes("status-reconnect")), "Reconnecting your models…"));
  host.requests[0].reject(Object.assign(new Error(LOST), { status: 404 }));
  await settleAll(host);
  assert.deepEqual(opened, ["p1"], "the project's own open, once");
  assert.deepEqual(checked, ["scene-p"]);
  assert.equal(host.state.sceneId, "scene-p");
  assert.equal(host.state.reconnecting, false);
  assert.equal(host.state.clash.id, "c9", "the same pair, whichever side is A");
  assert.equal(host.component("NoFix"), undefined, "nothing was tried: never 'No edit passed the geometry check'");
  const failed = host.component("ProposeFailed");
  assert.match(failed.props.proposal.error, /server restarted before Iris could propose fixes/);
  assert.equal(failed.props.proposal.attempts.length, 0);
  assert.equal(typeof failed.props.onRetry, "function", "Try again, now the models are back");
  assert.equal(host.find((n) => String(n.props?.className).includes("status-gone")), undefined);
  failed.props.onRetry(); host.render();
  assert.equal(host.requests.length, 2);
  assert.equal(host.requests[1].args[0], "scene-p");
  host.unmount();
});

test("in a project, a reconnect that fails is not tried again by itself: the banner offers it", async () => {
  let tries = 0;
  const { host } = await projectHost({ openProject: async () => { tries++; throw new Error("No such project."); } });
  host.gone({ kind: "scene", id: "scene", detail: LOST });
  await settleAll(host);
  assert.equal(tries, 1);
  host.gone({ kind: "scene", id: "scene", detail: LOST });   // the same loss, told again by another call
  await settleAll(host);
  assert.equal(tries, 1, "one automatic try, no loop");
  const banner = host.find((n) => String(n.props?.className).includes("status-gone"));
  assert.ok(hasText(banner, "The server restarted, so your open models were closed."));
  host.button("Reopen them").props.onClick();
  await settleAll(host);
  assert.equal(tries, 2);
  host.unmount();
});

test("a propose that stops with nothing tried says why in plain words, never 'Iris tried 0 ideas'", async () => {
  const host = await appHost({ initial: { clash: { ...restartClash, id: "clash" } } });
  await host.settle();
  for (const [raw, plain] of [
    ["RuntimeError: No model configured: set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY.", /No AI model is configured/],
    ["Failed to fetch", /couldn't reach its server/],
    ["ServerError: 503 UNAVAILABLE", /couldn't reach the AI model/],
  ]) {
    host.button("Propose fixes").props.onClick(); host.render();
    host.requests.at(-1).reject(Object.assign(new Error(raw), raw === "Failed to fetch" ? {} : { status: 500 }));
    await host.settle();
    assert.equal(host.component("NoFix"), undefined, raw);
    const failed = host.component("ProposeFailed");
    assert.match(failed.props.proposal.error, plain, raw);
    assert.equal(typeof failed.props.onRetry, "function");
    assert.ok(!host.state.error, "the raw words never reach the header's error line");
    const list = host.component("ReportList");
    if (list) assert.equal(list.props.ready.clash, undefined, "its row says nothing, not 'No fix found'");
  }
  host.unmount();
});

test("the visitor's own models are picked again; a sample report is opened again; Show it built offers the reopen", async () => {
  const host = await appHost({ initial: { sceneFiles: ["mine.ifc"], builtOn: true, chosen: 0,
    proposal: { understanding: "", options: [option], attempts: [] } },
    api: { models: async () => ({ triage: { model: "m" }, built_views: true }) } });
  await host.settle();
  let picked = 0;
  host.refs.modelInput.current = { click() { picked++; } };
  host.state.builtRuns = { "beam|duct|move|Single fix|[[0,0,0.4],null,null,null]": { status: "failed", step: "", look: "", cut: "", error: LOST } };
  host.render();
  assert.equal(host.component("BuiltView").props.reopen, undefined);   // the models are there: Try again stands

  host.gone({ kind: "scene", id: "scene", detail: LOST });
  const built = host.component("BuiltView").props.reopen;
  assert.equal(built.label, "Pick your files again");   // not a sample: only the visitor has the files
  built.onClick();
  await host.settle();
  assert.equal(picked, 1);
  host.unmount();

  const reports = [], asked = [];
  const again = await appHost({ api: { openReport: async (s) => { reports.push(s); return { id: `r-${reports.length}`, title: s, clashes: [] }; },
    report: async () => { throw new Error("Clash report not loaded. Open it again."); },
    sceneInfo: async (sid) => { asked.push(sid); return { id: sid, files: [], detection: null }; } } });
  again.loadReport();
  await again.settle();
  const first = again.state.report.id;
  again.gone({ kind: "report", id: first, detail: "Clash report not loaded. Open it again." });
  assert.deepEqual(asked, ["scene"]);   // a restart drops both: the models are asked after first (here still held)
  await again.settle();   // then the sample report is opened again by itself
  assert.deepEqual(reports, ["sample", "sample"]);
  assert.notEqual(again.state.report.id, first);
  assert.equal(again.find((n) => String(n.props?.className).includes("status-gone")), undefined);
  again.unmount();
});
