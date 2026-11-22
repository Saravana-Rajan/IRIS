import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compiled, find, hasText } from "./app-host.mjs";

/** Model understanding (docs/engineer-workflow.md, step 3): the open models by discipline, class, system and file, read
 * from the filters' index, each row a click to isolate. HVAC / Plumbing & piping / Electrical are a new IFC-class
 * mapping (labelled so); Structure, Architecture and Site are Iris's existing lists (server domains._FRAME and
 * document._class_team, kept equal below). */

const ms = await import(await compiled("../src/modelSummary.ts", {}));

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
/** ModelSummaryPanel.tsx with its stylesheet left out (Vite bundles it; Node cannot import CSS). */
async function component(react = import.meta.resolve("react"), icons = import.meta.resolve("lucide-react")) {
  const input = await readFile(new URL("../src/ModelSummaryPanel.tsx", import.meta.url), "utf8");
  assert.match(input, /^import "\.\/model-summary\.css";$/m, "the component brings its own stylesheet");
  let { outputText } = ts.transpileModule(input.replace(/^import "\.\/model-summary\.css";$/m, ""), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const deps = { react, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), "lucide-react": icons,
    "./modelSummary": await compiled("../src/modelSummary.ts", {}) };
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return import(url(outputText + `\n// ${Math.random()}`));
}

// ------------------------------------------------------------------------------------------------- a Northbank-like index

/** Elements as [file, class, systems?, zone?]; the index is built as the server's facets.py sends it (inverted). */
const SPECS = [];
const add = (file, cls, n, systems = [], zone = null) => { for (let i = 0; i < n; i++) SPECS.push({ file, cls, systems, zone }); };
const S = "Northbank-Structure.ifc", M = "Northbank-MEP.ifc", A = "Northbank-Architecture.ifc", SITE = "Northbank-Site.ifc", OLD = "Legacy-Services-2x3.ifc";
add(S, "IfcBeam", 4); add(S, "IfcColumn", 3); add(S, "IfcMechanicalFastener", 2); add(S, "IfcPlate", 1); add(S, "IfcMember", 1); add(S, "IfcSlab", 2);
add(M, "IfcDuctSegment", 3, ["Supply air"]); add(M, "IfcDuctSegment", 2, ["Return air"]); add(M, "IfcDuctFitting", 2, ["Supply air"]);
add(M, "IfcAirTerminal", 2, ["Supply air"]); add(M, "IfcDamper", 1, ["Supply air"]); add(M, "IfcUnitaryEquipment", 1, ["Supply air", "Return air"]);
add(M, "IfcFan", 1, ["Toilet extract"]);
add(M, "IfcPipeSegment", 2, ["Domestic cold water"]); add(M, "IfcPipeSegment", 1, ["Soil and waste"]); add(M, "IfcPipeFitting", 1, ["Domestic cold water"]);
add(M, "IfcValve", 1, ["Domestic cold water"]); add(M, "IfcFlowMeter", 1, ["Domestic cold water"]); add(M, "IfcTank", 1, ["Domestic hot water"]);
add(M, "IfcSanitaryTerminal", 1, ["Soil and waste"]);
add(M, "IfcCableCarrierSegment", 2, ["LV power distribution"]); add(M, "IfcCableCarrierFitting", 1); add(M, "IfcLightFixture", 3, ["Lighting"]);
add(M, "IfcElectricDistributionBoard", 1, ["LV power distribution"]); add(M, "IfcSensor", 2, ["Fire alarm"]); add(M, "IfcAlarm", 1, ["Fire alarm"]);
add(M, "IfcUnitaryControlElement", 1);
add(A, "IfcWall", 2); add(A, "IfcDoor", 2); add(A, "IfcWindow", 1); add(A, "IfcCurtainWall", 1); add(A, "IfcMember", 3); add(A, "IfcPlate", 2);
add(A, "IfcCovering", 1); add(A, "IfcRailing", 1); add(A, "IfcStairFlight", 1); add(A, "IfcSpace", 2, [], "Workspace"); add(A, "IfcFurniture", 1);
add(A, "IfcTransportElement", 1);
add(SITE, "IfcGeographicElement", 2); add(SITE, "IfcCivilElement", 1); add(SITE, "IfcLightFixture", 1); add(SITE, "IfcBuildingElementProxy", 1);
add(SITE, "IfcWall", 1);
// IFC2X3 (Revit's export): generic flow classes, a chilled water IfcSystem for some, none for the rest
add(OLD, "IfcFlowSegment", 2, ["Chilled water"]); add(OLD, "IfcFlowSegment", 1); add(OLD, "IfcFlowTerminal", 1, ["Chilled water"]);
add(OLD, "IfcFlowFitting", 1); add(OLD, "IfcWallStandardCase", 1); add(OLD, "IfcBeam", 1);

function buildIndex(specs, files = [S, M, A, SITE, OLD]) {
  const elements = specs.map((_, i) => `gid${String(i).padStart(3, "0")}`);
  const facet = (key, of) => {
    const by = new Map();
    specs.forEach((s, i) => { for (const v of of(s)) { if (!by.has(v)) by.set(v, []); by.get(v).push(i); } });
    const values = [...by.keys()].sort();
    return { key, kind: "text", values, items: values.map((v) => by.get(v)) };
  };
  const facets = [facet("file", (s) => [s.file]), facet("class", (s) => [s.cls]),
    facet("storey", (s) => [s.file === SITE ? "Site" : "Level 01"]),
    facet("group:IfcDistributionSystem", (s) => (s.file === OLD ? [] : s.systems)),
    facet("group:IfcSystem", (s) => (s.file === OLD ? s.systems : [])),
    facet("group:IfcZone", (s) => (s.zone ? [s.zone] : []))].filter((f) => f.values.length);
  return { revision: 3, files, elements, file: specs.map((s) => files.indexOf(s.file)), facets };
}
const index = buildIndex(SPECS);
const sum = ms.summarize(index);
const D = Object.fromEntries(sum.disciplines.map((d) => [d.id, d]));
const counts = (rows, key = "cls") => Object.fromEntries(rows.map((r) => [r[key] ?? r.name ?? r.file, r.count]));
const gidsOf = (pred) => SPECS.flatMap((s, i) => (pred(s) ? [index.elements[i]] : [])).sort();

test("every element counts once, under the discipline of its class, in the page's order and with honest mapping labels", () => {
  assert.equal(sum.total, SPECS.length);
  assert.deepEqual(sum.disciplines.map((d) => [d.id, d.label, d.mapping]), [
    ["hvac", "HVAC", "ifc-class"], ["plumbing", "Plumbing & piping", "ifc-class"], ["electrical", "Electrical", "ifc-class"],
    ["mep", "MEP by system", "ifc-class"], ["structure", "Structure", "existing"], ["architecture", "Architecture", "existing"],
    ["site", "Site", "existing"], ["other", "Other", "existing"]]);
  assert.equal(sum.disciplines.reduce((n, d) => n + d.count, 0), sum.total, "the disciplines add up to the models");
  const all = sum.disciplines.flatMap((d) => d.ids);
  assert.equal(new Set(all).size, all.length, "no element in two disciplines");
  assert.deepEqual(Object.fromEntries(sum.disciplines.map((d) => [d.id, d.count])),
    { hvac: 12, plumbing: 8, electrical: 12, mep: 5, structure: 15, architecture: 17, site: 4, other: 2 });
});

test("HVAC: its classes largest first, its systems from IfcDistributionSystem (an AHU in two is in both), by model", () => {
  const h = D.hvac;
  assert.deepEqual(h.classes.map((c) => [c.cls, c.count]), [["IfcDuctSegment", 5], ["IfcAirTerminal", 2], ["IfcDuctFitting", 2],
    ["IfcDamper", 1], ["IfcFan", 1], ["IfcUnitaryEquipment", 1]]);
  assert.deepEqual(h.systems.map((s) => [s.name, s.count]), [["Supply air", 9], ["Return air", 3], ["Toilet extract", 1]]);
  assert.ok(h.systems[0].ids.includes(gidsOf((s) => s.cls === "IfcUnitaryEquipment")[0]) && h.systems[1].ids.includes(gidsOf((s) => s.cls === "IfcUnitaryEquipment")[0]));
  assert.deepEqual(h.perFile.map((f) => [f.file, f.count]), [[M, 12]]);
  assert.deepEqual([...h.classes[0].ids].sort(), gidsOf((s) => s.cls === "IfcDuctSegment"));
});

test("Plumbing & piping takes valves, meters and tanks; Electrical takes fire alarm and controls and the site's lights", () => {
  assert.deepEqual(counts(D.plumbing.classes), { IfcPipeSegment: 3, IfcFlowMeter: 1, IfcPipeFitting: 1, IfcSanitaryTerminal: 1, IfcTank: 1, IfcValve: 1 });
  assert.deepEqual(D.plumbing.systems.map((s) => [s.name, s.count]), [["Domestic cold water", 5], ["Soil and waste", 2], ["Domestic hot water", 1]]);
  assert.deepEqual(counts(D.electrical.classes), { IfcLightFixture: 4, IfcCableCarrierSegment: 2, IfcSensor: 2, IfcAlarm: 1,
    IfcCableCarrierFitting: 1, IfcElectricDistributionBoard: 1, IfcUnitaryControlElement: 1 });
  assert.deepEqual(D.electrical.systems.map((s) => [s.name, s.count]),
    [["Fire alarm", 3], ["Lighting", 3], ["LV power distribution", 3], ["No system", 3]], "the rest last, as No system");
  assert.deepEqual(D.electrical.perFile.map((f) => [f.file, f.count]), [[M, 11], [SITE, 1]]);
});

test("IFC2X3's IfcFlow* classes: grouped by their system, else MEP (unspecified)", () => {
  const m = D.mep;
  assert.deepEqual(counts(m.classes), { IfcFlowSegment: 3, IfcFlowFitting: 1, IfcFlowTerminal: 1 });
  assert.deepEqual(m.systems.map((s) => [s.name, s.count]), [["Chilled water", 3], ["MEP (unspecified)", 2]]);
  assert.deepEqual([...m.systems[1].ids].sort(), gidsOf((s) => s.file === OLD && s.cls.startsWith("IfcFlow") && !s.systems.length));
  assert.deepEqual(m.perFile.map((f) => [f.file, f.count]), [[OLD, 5]]);
});

test("Structure is the frame (subtypes too); walls, slabs, members and plates follow their model's team; zones are not systems", () => {
  assert.deepEqual(Object.fromEntries(ms.modelTeams(index)), { [S]: "structure", [M]: "services", [A]: "architecture", [SITE]: "site", [OLD]: "services" },
    "each model's team, voted by its classes as document.guess_team does");
  assert.deepEqual(counts(D.structure.classes), { IfcBeam: 5, IfcColumn: 3, IfcMechanicalFastener: 2, IfcSlab: 2, IfcMember: 1, IfcPlate: 1,
    IfcWallStandardCase: 1 });
  assert.deepEqual(D.structure.perFile.map((f) => [f.file, f.count]), [[S, 13], [OLD, 2]], "a services model's wall stays Structure");
  assert.deepEqual(counts(D.architecture.classes), { IfcMember: 3, IfcDoor: 2, IfcPlate: 2, IfcSpace: 2, IfcWall: 2, IfcCovering: 1,
    IfcCurtainWall: 1, IfcFurniture: 1, IfcRailing: 1, IfcStairFlight: 1, IfcWindow: 1 }, "the architect's partitions and mullions");
  assert.equal(D.architecture.systems, undefined, "IfcZone groups are not systems");
  assert.equal(D.structure.systems, undefined);
  assert.deepEqual(counts(D.site.classes), { IfcGeographicElement: 2, IfcCivilElement: 1, IfcWall: 1 });
  assert.deepEqual(counts(D.other.classes), { IfcBuildingElementProxy: 1, IfcTransportElement: 1 });

  const literal = Object.fromEntries(ms.summarize(index, { frameByModel: false }).disciplines.map((d) => [d.id, d]));
  assert.deepEqual(literal.structure.perFile.map((f) => [f.file, f.count]), [[S, 13], [A, 7], [SITE, 1], [OLD, 2]], "the frame list alone");
  assert.equal(literal.architecture.count, 10);
  const tie = buildIndex([{ file: A, cls: "IfcDoor", systems: [] }, { file: A, cls: "IfcBeam", systems: [] }, { file: A, cls: "IfcWall", systems: [] }], [A]);
  assert.deepEqual(ms.summarize(tie).disciplines.find((d) => d.id === "structure").classes.map((c) => c.cls), ["IfcBeam", "IfcWall"], "a tie: Structure");
});

test("each model: its elements and their disciplines, largest first", () => {
  assert.deepEqual(sum.files.map((f) => [f.name, f.count]), [[S, 13], [M, 31], [A, 18], [SITE, 6], [OLD, 7]]);
  const mep = sum.files[1];
  assert.deepEqual(mep.byDiscipline, { hvac: 12, plumbing: 8, electrical: 11 });
  assert.equal(ms.fileMix(mep), "HVAC 12 · Electrical 11 · Plumbing 8");
  assert.equal(ms.fileMix(sum.files[2]), "Architecture 17 · Other 1");
  assert.equal(ms.fileMix(sum.files[3], 2), "Site 4 · Electrical 1 · others 1", "past the most shown, the rest together");
  assert.deepEqual([...sum.files[4].ids].sort(), gidsOf((s) => s.file === OLD));
});

test("a discipline the models lack still shows (as none); MEP, Site and Other only when there; no index, nothing", () => {
  const only = buildIndex([{ file: S, cls: "IfcBeam", systems: [] }, { file: S, cls: "IfcColumn", systems: [] }], [S]);
  const s = ms.summarize(only);
  assert.deepEqual(s.disciplines.map((d) => [d.id, d.count]), [["hvac", 0], ["plumbing", 0], ["electrical", 0], ["structure", 2], ["architecture", 0]]);
  assert.deepEqual(s.disciplines[0].perFile, []);
  assert.deepEqual(ms.summarize(null), { disciplines: [], files: [], total: 0 });
  const noClass = ms.summarize({ revision: 0, files: [S], elements: ["x"], file: [0], facets: [] });
  assert.deepEqual(noClass.disciplines.find((d) => d.id === "other").classes.map((c) => c.cls), ["(no class)"]);
});

test("the class mapping: specific classes before the generic IfcFlow / IfcDistribution prefixes; curtain walls are not walls", () => {
  const cases = { IfcDuctSilencer: "hvac", IfcAirTerminalBox: "hvac", IfcAirToAirHeatRecovery: "hvac", IfcCoil: "hvac",
    IfcPump: "plumbing", IfcFlowMeter: "plumbing", IfcDistributionChamberElement: "plumbing", IfcFireSuppressionTerminal: "plumbing",
    IfcCableSegment: "electrical", IfcCableFitting: "electrical", IfcOutlet: "electrical", IfcSwitchingDevice: "electrical",
    IfcProtectiveDevice: "electrical", IfcElectricAppliance: "electrical", IfcFlowInstrument: "electrical",
    IfcFlowController: "mep", IfcFlowMovingDevice: "mep", IfcEnergyConversionDevice: "mep", IfcDistributionControlElement: "mep",
    IfcSlabStandardCase: "structure", IfcWallElementedCase: "structure", IfcColumnStandardCase: "structure", IfcFooting: "structure",
    IfcPile: "structure", IfcCurtainWall: "architecture", IfcDoorStandardCase: "architecture", IfcRoof: "other",
    IfcBuildingElementProxy: "other", IfcOpeningElement: "other" };
  for (const [cls, id] of Object.entries(cases)) assert.equal(ms.disciplineOf(cls), id, cls);
  assert.deepEqual(ms.ruleClasses("hvac").slice(0, 3), ["IfcDuct…", "IfcAirTerminal…", "IfcDamper"]);
  assert.deepEqual(ms.ruleClasses("structure").slice(0, 2), ["IfcBeam*", "IfcColumn*"]);
});

/** IFC4 and IFC2X3 distribution element classes (concrete and the generic ones Revit's IFC2X3 export writes). */
const MEP_CLASSES = ["IfcActuator", "IfcAirTerminal", "IfcAirTerminalBox", "IfcAirToAirHeatRecovery", "IfcAlarm", "IfcAudioVisualAppliance",
  "IfcBoiler", "IfcBurner", "IfcCableCarrierFitting", "IfcCableCarrierSegment", "IfcCableFitting", "IfcCableSegment", "IfcChiller",
  "IfcCoil", "IfcCommunicationsAppliance", "IfcCompressor", "IfcCondenser", "IfcController", "IfcCooledBeam", "IfcCoolingTower",
  "IfcDamper", "IfcDistributionChamberElement", "IfcDistributionControlElement", "IfcDistributionElement", "IfcDistributionFlowElement",
  "IfcDuctFitting", "IfcDuctSegment", "IfcDuctSilencer", "IfcElectricAppliance", "IfcElectricDistributionBoard", "IfcElectricFlowStorageDevice",
  "IfcElectricGenerator", "IfcElectricMotor", "IfcElectricTimeControl", "IfcEnergyConversionDevice", "IfcEngine", "IfcEvaporativeCooler",
  "IfcEvaporator", "IfcFan", "IfcFilter", "IfcFireSuppressionTerminal", "IfcFlowController", "IfcFlowFitting", "IfcFlowInstrument",
  "IfcFlowMeter", "IfcFlowMovingDevice", "IfcFlowSegment", "IfcFlowStorageDevice", "IfcFlowTerminal", "IfcFlowTreatmentDevice",
  "IfcHeatExchanger", "IfcHumidifier", "IfcInterceptor", "IfcJunctionBox", "IfcLamp", "IfcLightFixture", "IfcMedicalDevice",
  "IfcMotorConnection", "IfcOutlet", "IfcPipeFitting", "IfcPipeSegment", "IfcProtectiveDevice", "IfcProtectiveDeviceTrippingUnit",
  "IfcPump", "IfcSanitaryTerminal", "IfcSensor", "IfcSolarDevice", "IfcSpaceHeater", "IfcStackTerminal", "IfcSwitchingDevice",
  "IfcTank", "IfcTransformer", "IfcTubeBundle", "IfcUnitaryControlElement", "IfcUnitaryEquipment", "IfcValve", "IfcWasteTerminal"];

test("every distribution class is a service: HVAC, plumbing, electrical, or MEP by system for the generic ones", () => {
  const generic = MEP_CLASSES.filter((c) => ms.disciplineOf(c) === "mep");
  assert.deepEqual(generic, ["IfcDistributionControlElement", "IfcDistributionElement", "IfcDistributionFlowElement", "IfcEnergyConversionDevice",
    "IfcEngine", "IfcFlowController", "IfcFlowFitting", "IfcFlowMovingDevice", "IfcFlowSegment", "IfcFlowStorageDevice", "IfcFlowTerminal",
    "IfcFlowTreatmentDevice", "IfcMedicalDevice"], "only the classes that do not say which service");
  for (const c of MEP_CLASSES) assert.notEqual(ms.disciplineOf(c), "other", `${c} is a service`);
});

test("the existing lists are the server's: domains._FRAME, and document._class_team's Structure, Architecture, Site and MEP", async () => {
  const domains = await readFile(new URL("../../server/iris/domains.py", import.meta.url), "utf8");
  const frame = domains.match(/^_FRAME = \(([^)]*)\)/m)[1].match(/"(Ifc\w+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(ms.FRAME, frame);
  const doc = await readFile(new URL("../../server/iris/document.py", import.meta.url), "utf8");
  const body = doc.slice(doc.indexOf("def _class_team"), doc.indexOf("def guess_team"));
  const lists = [...body.matchAll(/if cls(?:\.startswith\(| in )\(([^)]*)\)\)?:\s*return "(\w+)"/g)]
    .map(([, names, team]) => [team, names.match(/"(Ifc\w+)"/g).map((s) => s.slice(1, -1))]);
  assert.deepEqual(lists.map(([t]) => t), ["MEP", "Structure", "Architecture", "Site"]);
  const team = Object.fromEntries(lists);
  assert.deepEqual([...ms.SHARED_FRAME].sort(), frame.filter((c) => !team.Structure.includes(c)).sort(),
    "the frame classes the team guess leaves to every discipline follow their model");
  const want = { Structure: "structure", Architecture: "architecture", Site: "site" };
  for (const [team, names] of lists) {
    if (team === "MEP") {
      // prefixes there: every IFC distribution class one of them covers is a service here
      for (const prefix of names) {
        const covered = MEP_CLASSES.filter((c) => c.startsWith(prefix));
        assert.ok(covered.length, `${prefix} covers a class`);
        for (const cls of covered) assert.ok(["hvac", "plumbing", "electrical", "mep"].includes(ms.disciplineOf(cls)), `${cls} is MEP`);
      }
      continue;
    }
    for (const cls of names) {
      if (cls === "IfcWallStandardCase") {
        assert.equal(ms.disciplineOf(cls), "structure", "a wall stays in place (the frame wins over the team guess)");
      } else assert.equal(ms.disciplineOf(cls), want[team], `${cls} is ${team}`);
    }
  }
});

// ------------------------------------------------------------------------------------------------- the page

const html = (C, props) => renderToStaticMarkup(createElement(C, props));

test("the table: disciplines with counts and shares, the new mapping marked, the openings line and the grouping note", async () => {
  const { ModelSummary } = await component();
  const out = html(ModelSummary, { index, onIsolate() {}, onClear() {} });
  assert.ok(out.includes(`<h3>Model understanding</h3><span class="msum-total">${SPECS.length} elements · 5 models</span>`));
  assert.match(out, /<tr class="msum-row discipline" data-label="HVAC" data-mapping="ifc-class">/);
  assert.match(out, /data-label="Structure" data-mapping="existing">/);
  assert.equal((out.match(/class="msum-tag" title="A new mapping from IFC class/g) ?? []).length, 4, "HVAC, plumbing, electrical and MEP by system are marked");
  assert.match(out, /aria-pressed="false" title="Isolate 12 elements">HVAC<\/button>/);
  assert.match(out, /<td class="num">15<\/td><td class="num"><span class="msum-share"><span class="msum-bar" aria-hidden="true"><i style="width:20%"><\/i><\/span>20%<\/span><\/td>/,
    "a count and its share, the bar as wide as the share");
  assert.ok(out.includes("Openings are used in checks but not listed here yet."));
  assert.match(out, /<details class="msum-how"><summary>How this is grouped<\/summary>/);
  assert.ok(out.includes("new IFC-class mapping") && out.includes("IfcFlowSegment"), "the note names the mapping and the IFC2X3 case");
  assert.ok(out.includes("IfcBeam*, IfcColumn*, IfcSlab*, IfcWall*"), "the note lists the rules the code uses");
  assert.match(out, /data-label="Legacy-Services-2x3\.ifc"[^>]*>.*?<span class="msum-mix">MEP 5 · Structure 2<\/span>/, "each model's mix");
  assert.ok(!out.includes("Classes</th>"), "collapsed to start");
  const empty = html(ModelSummary, { index: buildIndex([{ file: S, cls: "IfcBeam", systems: [] }], [S]), onIsolate() {}, onClear() {} });
  assert.match(empty, /<tr class="msum-row discipline empty" data-label="HVAC" data-mapping="ifc-class"><td><div class="msum-cell"><span class="msum-pad" aria-hidden="true"><\/span>/,
    "a discipline with none: no expander, nothing to isolate");
  assert.match(empty, /disabled="" aria-pressed="false" title="None in the open models">HVAC<\/button><span class="msum-tag"[^>]*>by class<\/span><\/span><\/div><\/td><td class="num">–<\/td>/);
  assert.match(html(ModelSummary, { index: null, onIsolate() {}, onClear() {} }), /once the models&#x27; index has been read/);
});

test("a click on a row isolates what it counts; on the isolated row, or Show all, everything shows again", async () => {
  const { SummaryView } = await component();
  const calls = [];
  const view = (over = {}) => SummaryView({ summary: sum, ready: true, open: [], onToggle: (id) => calls.push(["toggle", id]),
    onIsolate: (ids, label) => calls.push(["isolate", label, ids.length]), onClear: () => calls.push(["clear"]), ...over });
  const tr = (tree, label) => find(tree, (n) => n.type === "tr" && n.props?.["data-label"] === label);
  tr(view(), "HVAC").props.onClick();
  tr(view(), "Northbank-MEP.ifc").props.onClick();
  const toggle = find(tr(view(), "Plumbing & piping"), (n) => n.type === "button" && n.props.className === "msum-toggle");
  let stopped = false;
  toggle.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.ok(stopped, "the expander does not isolate");
  assert.equal(toggle.props["aria-expanded"], false);
  assert.deepEqual(calls.splice(0), [["isolate", "HVAC", 12], ["isolate", "Northbank-MEP.ifc", 31], ["toggle", "plumbing"]]);

  const open = view({ open: ["hvac", "mep"], isolated: "HVAC · Supply air" });
  assert.ok(hasText(find(open, (n) => n.type === "tbody" && n.key === "hvac"), "By model"));
  for (const label of ["HVAC · IfcDuctSegment", "HVAC · Supply air", "HVAC · Northbank-MEP.ifc", "MEP by system · Chilled water",
    "MEP by system · MEP (unspecified)", "MEP by system · IfcFlowSegment"]) assert.ok(tr(open, label), label);
  assert.ok(!tr(open, "Plumbing & piping · IfcValve"), "a closed discipline shows no sub-rows");
  const on = tr(open, "HVAC · Supply air");
  assert.match(on.props.className, /\bsub on\b/);
  on.props.onClick();
  tr(open, "MEP by system · MEP (unspecified)").props.onClick();
  find(open, (n) => n.type === "button" && hasText(n, "Show all")).props.onClick();
  assert.deepEqual(calls.splice(0), [["clear"], ["isolate", "MEP by system · MEP (unspecified)", 2], ["clear"]]);
  assert.ok(hasText(find(open, (n) => n.props?.className === "msum-iso"), "HVAC · Supply air"), "what is isolated is named");
  const empty = SummaryView({ summary: ms.summarize(buildIndex([{ file: S, cls: "IfcBeam", systems: [] }], [S])), ready: true, open: [],
    onToggle() {}, onIsolate: () => calls.push(["no"]), onClear() {} });
  assert.equal(tr(empty, "HVAC").props.onClick, undefined, "nothing to isolate, no click");
});

test("the expander's state lives in the component: open, then closed again", async () => {
  const cells = [];
  let cursor = 0;
  globalThis.__msumHooks = {
    useState(init) { const i = cursor++; if (!(i in cells)) cells[i] = typeof init === "function" ? init() : init;
      return [cells[i], (v) => { cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
    useMemo: (fn) => fn(),
  };
  const react = url("export const useState=(...a)=>globalThis.__msumHooks.useState(...a), useMemo=(...a)=>globalThis.__msumHooks.useMemo(...a);");
  const icons = url("export const ChevronRight=()=>null;");
  const { ModelSummary } = await component(react, icons);
  const render = () => { cursor = 0; const el = ModelSummary({ index, onIsolate() {}, onClear() {} }); return el.type(el.props); };
  const toggleOf = (tree) => find(find(tree, (n) => n.type === "tr" && n.props?.["data-label"] === "Electrical"), (n) => n.props?.className === "msum-toggle");
  toggleOf(render()).props.onClick({ stopPropagation() {} });
  let tree = render();
  assert.equal(toggleOf(tree).props["aria-expanded"], true);
  assert.ok(find(tree, (n) => n.type === "tr" && n.props?.["data-label"] === "Electrical · Fire alarm"));
  toggleOf(tree).props.onClick({ stopPropagation() {} });
  tree = render();
  assert.equal(toggleOf(tree).props["aria-expanded"], false);
  assert.ok(!find(tree, (n) => n.type === "tr" && n.props?.["data-label"] === "Electrical · Fire alarm"));
});

test("the stylesheet uses the page's colour variables only, so light and dark follow the theme", async () => {
  const css = await readFile(new URL("../src/model-summary.css", import.meta.url), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(rules), "no colour written out");
  assert.match(rules, /font-variant-numeric: tabular-nums/);
});
