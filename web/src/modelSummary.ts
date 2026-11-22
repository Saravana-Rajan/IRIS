import type { FacetIndex } from "./filters";

/** Model understanding (docs/engineer-workflow.md, step 3 "Understand"): what the open models contain, by discipline,
 * class, system and model file, read from the filters' index (`api.facets`, docs/filters.md). Pure: no React, no IO.
 *
 * Two kinds of grouping, labelled as such on the page:
 * - **existing**: Structure, Architecture and Site are Iris's own class lists: the frame Iris keeps in place when it
 *   proposes a fix (`server/iris/domains.py` `_FRAME`, by IFC subtype as `is_a` reads it) and the classes the report
 *   uses to guess each model's team (`server/iris/document.py` `_class_team`). Where the two disagree (a standard-case
 *   wall) the frame wins: a wall stays in place, so it counts as Structure. Walls, slabs, members and plates are the
 *   frame classes `_class_team` leaves to every discipline: they count with the model they are in (`modelTeams`, the
 *   same vote as `document.guess_team`), so an architectural model's partitions and curtain-wall mullions are
 *   Architecture, not Structure (measured on Northbank: 491 of the Architecture model's 694 elements otherwise).
 * - **ifc-class**: the HVAC / Plumbing & piping / Electrical split is a new mapping from IFC4 class, not something the
 *   models state. IFC2X3's generic distribution classes (IfcFlowSegment, IfcFlowFitting, IfcFlowTerminal…) do not say
 *   which service they are, so they are grouped by the system the model puts them in ("MEP by system"); those in none
 *   are "MEP (unspecified)".
 *
 * Openings are not in the index (it holds what the page draws and the checks see), so they are not counted. */

export type DisciplineId = "hvac" | "plumbing" | "electrical" | "mep" | "structure" | "architecture" | "site" | "other";
export type Mapping = "existing" | "ifc-class";

/** Elements of one class, one system or one model file. */
export interface ClassRow { cls: string; count: number; ids: string[] }
export interface SystemRow { name: string; count: number; ids: string[] }
export interface FileCount { file: string; count: number; ids: string[] }
export interface Discipline {
  id: DisciplineId; label: string; mapping: Mapping;
  count: number; ids: string[];
  classes: ClassRow[];
  /** Per model file, in the index's file order; files with none left out. */
  perFile: FileCount[];
  /** The systems its elements are in (IfcDistributionSystem, IFC2X3 IfcSystem…), largest first; the rest last as "No
   * system" ("MEP (unspecified)" for MEP by system). Absent when none of its elements is in a system. An element in
   * two systems counts in both. */
  systems?: SystemRow[];
}
export interface FileRow { name: string; count: number; ids: string[]; byDiscipline: Partial<Record<DisciplineId, number>> }
export interface ModelSummary { disciplines: Discipline[]; files: FileRow[]; total: number }

/** A discipline's rule: exact classes, class prefixes (a prefix covers every class that starts with it), and the
 * frame's classes, which also take their `StandardCase` / `ElementedCase` subtypes. */
export interface DisciplineRule { id: DisciplineId; label: string; short: string; mapping: Mapping; classes: string[]; prefixes?: string[]; frame?: string[] }

/** `server/iris/domains.py` `_FRAME`: the classes that stay in place (`tests/model-summary.test.mjs` keeps them equal). */
export const FRAME = ["IfcBeam", "IfcColumn", "IfcSlab", "IfcWall", "IfcFooting", "IfcPile", "IfcMember", "IfcPlate"];
const SUBTYPES = ["", "StandardCase", "ElementedCase"];
/** The frame classes `document._class_team` gives no team (every discipline models them): they follow their model. */
export const SHARED_FRAME = ["IfcWall", "IfcSlab", "IfcMember", "IfcPlate"];
export const isSharedFrame = (cls: string) => SHARED_FRAME.some((f) => SUBTYPES.some((s) => cls === f + s));

/** The disciplines in the order the page lists them. The first rule that claims a class wins. */
export const RULES: DisciplineRule[] = [
  { id: "structure", label: "Structure", short: "Structure", mapping: "existing", frame: FRAME,
    classes: ["IfcMechanicalFastener", "IfcReinforcingBar", "IfcReinforcingMesh", "IfcTendon", "IfcBearing"] },
  { id: "hvac", label: "HVAC", short: "HVAC", mapping: "ifc-class", prefixes: ["IfcDuct", "IfcAirTerminal"],
    classes: ["IfcDamper", "IfcFan", "IfcUnitaryEquipment", "IfcAirToAirHeatRecovery", "IfcCoil", "IfcChiller", "IfcBoiler",
      "IfcCoolingTower", "IfcCondenser", "IfcEvaporator", "IfcEvaporativeCooler", "IfcHumidifier", "IfcHeatExchanger",
      "IfcCooledBeam", "IfcSpaceHeater", "IfcCompressor", "IfcFilter", "IfcBurner", "IfcTubeBundle"] },
  { id: "plumbing", label: "Plumbing & piping", short: "Plumbing", mapping: "ifc-class", prefixes: ["IfcPipe"],
    classes: ["IfcSanitaryTerminal", "IfcValve", "IfcPump", "IfcTank", "IfcFlowMeter", "IfcWasteTerminal", "IfcInterceptor",
      "IfcFireSuppressionTerminal", "IfcStackTerminal", "IfcDistributionChamberElement"] },
  { id: "electrical", label: "Electrical", short: "Electrical", mapping: "ifc-class", prefixes: ["IfcCable", "IfcElectric"],
    classes: ["IfcLightFixture", "IfcLamp", "IfcOutlet", "IfcSwitchingDevice", "IfcProtectiveDevice",
      "IfcProtectiveDeviceTrippingUnit", "IfcJunctionBox", "IfcTransformer", "IfcSolarDevice", "IfcMotorConnection",
      "IfcCommunicationsAppliance", "IfcAudioVisualAppliance",
      // fire alarm and controls: detection and control devices are wired
      "IfcAlarm", "IfcSensor", "IfcController", "IfcActuator", "IfcFlowInstrument", "IfcUnitaryControlElement"] },
  { id: "mep", label: "MEP by system", short: "MEP", mapping: "ifc-class",
    // IFC2X3's generic classes (and IFC4's abstract ones) that do not say which service; checked after the three above.
    // An engine or a medical device could be on any of them.
    prefixes: ["IfcFlow", "IfcDistribution", "IfcEnergyConversion"], classes: ["IfcEngine", "IfcMedicalDevice"] },
  { id: "architecture", label: "Architecture", short: "Architecture", mapping: "existing",
    classes: ["IfcDoor", "IfcDoorStandardCase", "IfcWindow", "IfcWindowStandardCase", "IfcCurtainWall", "IfcCovering",
      "IfcRailing", "IfcStair", "IfcStairFlight", "IfcRamp", "IfcRampFlight", "IfcFurniture", "IfcFurnishingElement", "IfcSpace"] },
  { id: "site", label: "Site", short: "Site", mapping: "existing",
    classes: ["IfcGeographicElement", "IfcCivilElement", "IfcCourse", "IfcPavement", "IfcKerb", "IfcEarthworksFill"] },
  { id: "other", label: "Other", short: "Other", mapping: "existing", classes: [] },
];
/** The order the page lists them in (the services first, then the building, then the rest). */
export const ORDER: DisciplineId[] = ["hvac", "plumbing", "electrical", "mep", "structure", "architecture", "site", "other"];
/** Always listed, with a dash when the models have none: a missing discipline is worth seeing. */
const ALWAYS = new Set<DisciplineId>(["hvac", "plumbing", "electrical", "structure", "architecture"]);
const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export const disciplineLabel = (id: DisciplineId) => BY_ID.get(id)?.label ?? id;
export const disciplineShort = (id: DisciplineId) => BY_ID.get(id)?.short ?? id;
export const mappingOf = (id: DisciplineId): Mapping => BY_ID.get(id)?.mapping ?? "existing";

/** The groups whose names are systems: IFC4's distribution systems and circuits, IFC2X3's systems and circuits, and
 * IFC4's building systems. Zones and plain groups are not systems. */
export const SYSTEM_KEYS = ["group:IfcDistributionSystem", "group:IfcDistributionCircuit", "group:IfcSystem",
  "group:IfcElectricalCircuit", "group:IfcBuildingSystem", "group:IfcBuiltSystem"];
export const NO_SYSTEM = "No system";
export const MEP_UNSPECIFIED = "MEP (unspecified)";
const NO_CLASS = "(no class)";

const claims = (r: DisciplineRule, cls: string) => r.classes.includes(cls) || !!r.prefixes?.some((p) => cls.startsWith(p))
  || !!r.frame?.some((f) => SUBTYPES.some((s) => cls === f + s));
const cache = new Map<string, DisciplineId>();
/** The discipline an IFC class counts under, by its name as the index sends it (`is_a()`: "IfcDuctSegment"). */
export function disciplineOf(cls: string): DisciplineId {
  let id = cache.get(cls);
  if (!id) {
    id = RULES.find((r) => r.id !== "other" && claims(r, cls))?.id ?? "other";
    cache.set(cls, id);
  }
  return id;
}

/** How a rule reads in the page's note: its classes, a prefix as `IfcDuct…`, a frame class as `IfcWall*`. */
export function ruleClasses(id: DisciplineId): string[] {
  const r = BY_ID.get(id);
  if (!r) return [];
  return [...(r.frame ?? []).map((f) => `${f}*`), ...(r.prefixes ?? []).map((p) => `${p}…`), ...r.classes];
}

const byCount = <T extends { count: number }>(name: (t: T) => string) => (a: T, b: T) =>
  b.count - a.count || name(a).localeCompare(name(b));

/** The team each model file belongs to, as `document.guess_team` votes it: the discipline most of its elements have by
 * class, the shared frame classes not voting, the services voting together. A tie or no vote: Structure. */
export function modelTeams(index: FacetIndex): Map<string, "structure" | "architecture" | "site" | "services"> {
  const votes = new Map<string, Map<string, number>>();
  const classes = index.facets.find((f) => f.key === "class");
  classes?.values.forEach((v, k) => {
    const cls = String(v);
    if (isSharedFrame(cls)) return;
    const id = disciplineOf(cls);
    const team = id === "structure" || id === "architecture" || id === "site" ? id : id === "other" ? null : "services";
    if (!team) return;
    for (const i of classes.items[k] ?? []) {
      const file = index.files[index.file[i]];
      if (file === undefined) continue;
      const m = votes.get(file) ?? new Map<string, number>();
      m.set(team, (m.get(team) ?? 0) + 1);
      votes.set(file, m);
    }
  });
  const out = new Map<string, "structure" | "architecture" | "site" | "services">();
  for (const [file, m] of votes) {
    const ranked = [...m].sort((a, b) => b[1] - a[1]);
    const tie = ranked.length > 1 && ranked[0][1] === ranked[1][1];
    out.set(file, (tie ? "structure" : ranked[0][0]) as "structure" | "architecture" | "site" | "services");
  }
  return out;
}

export interface SummarizeOptions {
  /** Walls, slabs, members and plates count with their model's team (default), or always as Structure (the frame
   * list alone, `domains._FRAME`). */
  frameByModel?: boolean;
}

/** The summary of an index: every element counted once under its discipline (by class; the shared frame classes by
 * their model's team), each discipline's classes, systems and files, and each file's elements by discipline. */
export function summarize(index: FacetIndex | null, { frameByModel = true }: SummarizeOptions = {}): ModelSummary {
  if (!index) return { disciplines: [], files: [], total: 0 };
  const n = index.elements.length;
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
  const clsOf: (string | null)[] = new Array(n).fill(null);
  const classes = index.facets.find((f) => f.key === "class");
  classes?.values.forEach((v, k) => { for (const i of classes.items[k] ?? []) if (inRange(i) && clsOf[i] === null) clsOf[i] = String(v); });
  const systemsOf: string[][] = Array.from({ length: n }, () => []);
  for (const f of index.facets) {
    if (!SYSTEM_KEYS.includes(f.key)) continue;
    f.values.forEach((v, k) => {
      const name = String(v).trim();
      if (!name) return;
      for (const i of f.items[k] ?? []) if (inRange(i) && !systemsOf[i].includes(name)) systemsOf[i].push(name);
    });
  }
  const fileName = (i: number) => index.files[index.file[i]] ?? "(unknown model)";
  const teams = frameByModel ? modelTeams(index) : null;
  /** A shared frame class in an architectural or site model is that model's; anywhere else it is Structure. */
  const of = (cls: string, file: string): DisciplineId => {
    const id = disciplineOf(cls);
    if (id !== "structure" || !teams || !isSharedFrame(cls)) return id;
    const team = teams.get(file);
    return team === "architecture" || team === "site" ? team : "structure";
  };

  interface Acc { ids: string[]; classes: Map<string, string[]>; files: Map<string, string[]>; systems: Map<string, string[]>; none: string[] }
  const acc = new Map<DisciplineId, Acc>(ORDER.map((id) => [id, { ids: [], classes: new Map(), files: new Map(), systems: new Map(), none: [] }]));
  const files = new Map<string, FileRow>(index.files.map((name) => [name, { name, count: 0, ids: [], byDiscipline: {} }]));
  const push = (m: Map<string, string[]>, key: string, gid: string) => { const l = m.get(key); if (l) l.push(gid); else m.set(key, [gid]); };
  for (let i = 0; i < n; i++) {
    const gid = index.elements[i], cls = clsOf[i] ?? NO_CLASS, file = fileName(i);
    const id = clsOf[i] === null ? "other" : of(cls, file);
    const a = acc.get(id)!;
    a.ids.push(gid);
    push(a.classes, cls, gid);
    push(a.files, file, gid);
    if (systemsOf[i].length) for (const s of systemsOf[i]) push(a.systems, s, gid);
    else a.none.push(gid);
    let row = files.get(file);
    if (!row) { row = { name: file, count: 0, ids: [], byDiscipline: {} }; files.set(file, row); }
    row.count++; row.ids.push(gid);
    row.byDiscipline[id] = (row.byDiscipline[id] ?? 0) + 1;
  }

  const order = [...files.keys()];
  const disciplines: Discipline[] = [];
  for (const id of ORDER) {
    const a = acc.get(id)!;
    if (!a.ids.length && !ALWAYS.has(id)) continue;
    const d: Discipline = {
      id, label: disciplineLabel(id), mapping: mappingOf(id), count: a.ids.length, ids: a.ids,
      classes: [...a.classes].map(([cls, ids]) => ({ cls, count: ids.length, ids })).sort(byCount((c) => c.cls)),
      perFile: order.filter((f) => a.files.has(f)).map((file) => { const ids = a.files.get(file)!; return { file, count: ids.length, ids }; }),
    };
    if (a.systems.size || (id === "mep" && a.none.length)) {
      const systems = [...a.systems].map(([name, ids]) => ({ name, count: ids.length, ids })).sort(byCount((s) => s.name));
      if (a.none.length) systems.push({ name: id === "mep" ? MEP_UNSPECIFIED : NO_SYSTEM, count: a.none.length, ids: a.none });
      d.systems = systems;
    }
    disciplines.push(d);
  }
  return { disciplines, files: order.map((f) => files.get(f)!), total: n };
}

/** A file's largest disciplines, as the models table reads them: "HVAC 412 · Electrical 230". */
export function fileMix(row: FileRow, max = 3): string {
  const parts = (Object.entries(row.byDiscipline) as [DisciplineId, number][])
    .sort((a, b) => b[1] - a[1] || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const shown = parts.slice(0, max).map(([id, c]) => `${disciplineShort(id)} ${c.toLocaleString("en-US")}`);
  const rest = parts.slice(max).reduce((s, [, c]) => s + c, 0);
  return [...shown, ...(rest ? [`others ${rest.toLocaleString("en-US")}`] : [])].join(" · ");
}
