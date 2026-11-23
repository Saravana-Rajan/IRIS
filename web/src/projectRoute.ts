/** A project's address (docs/engineer-workflow.md, "Web contract"), as a path: `/projects` is the list,
 *  `/projects/<pid>` a project's overview, `/projects/<pid>/<step>` one step (`clashes` for Clash review, and
 *  `/projects/<pid>/clashes/<n>` with clash #n open). The first addresses were hashes (`#projects`,
 *  `#project/<pid>/<step>`): they are still read, and the page replaces them with the path (`legacyPath`). Pure, like
 *  aboutRoute.ts: nothing here reads App state. */
export const PROJECT_STEPS = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "drawings", label: "Drawings" },
  { id: "coordination", label: "Coordination" },
  { id: "clash", label: "Clash review" },
  { id: "reports", label: "Reports" },
  { id: "activity", label: "Activity" },
] as const;

export type ProjectStep = (typeof PROJECT_STEPS)[number]["id"];
export type Step = ProjectStep;

/** `clash`: the clash #N open on Clash review (`/projects/<pid>/clashes/<n>`). */
export type ProjectRoute = { view: "projects" } | { view: "project"; pid: string; step: ProjectStep; clash?: number };

/** Project ids are `secrets.token_hex(12)` on the server; anything word-like is accepted, nothing with a slash. */
const PID = /^[\w-]{1,64}$/;

export const isProjectStep = (s: unknown): s is ProjectStep => PROJECT_STEPS.some((t) => t.id === s);
export const isProjectId = (s: unknown): s is string => typeof s === "string" && PID.test(s);

/** The route a location hash asks for, or null when the hash is not a project's. A project without a step, or with
 *  an unknown one, opens on Overview. */
export function parseProjectHash(hash: string): ProjectRoute | null {
  const h = hash.trim();
  if (/^#projects\/?$/.test(h)) return { view: "projects" };
  const m = /^#project\/([\w-]{1,64})(?:\/([\w-]*))?\/?$/.exec(h);
  if (!m) return null;
  return { view: "project", pid: m[1], step: isProjectStep(m[2]) ? m[2] : "overview" };
}

/** The hash for a route: `#projects`, or `#project/<pid>/<step>` (the step is always written, Overview too). */
export function formatProjectHash(route: ProjectRoute): string {
  return route.view === "projects" ? "#projects" : `#project/${route.pid}/${route.step}`;
}

/** Shorthand for one project's address. */
export const projectHash = (pid: string, step: ProjectStep = "overview") => formatProjectHash({ view: "project", pid, step });
export const PROJECTS_HASH = "#projects";

/** The step `delta` places from `step` (arrow keys in the step bar), wrapping round. */
export function stepBeside(step: ProjectStep, delta: number): ProjectStep {
  const i = PROJECT_STEPS.findIndex((t) => t.id === step);
  const n = PROJECT_STEPS.length;
  return PROJECT_STEPS[(((i + delta) % n) + n) % n].id;
}

export const stepLabel = (step: ProjectStep) => PROJECT_STEPS.find((t) => t.id === step)?.label ?? step;

/** A step's segment in a path: Clash review is `clashes`, Overview has none. */
const SEGMENT: Partial<Record<ProjectStep, string>> = { overview: "", clash: "clashes" };
const segmentOf = (step: ProjectStep) => SEGMENT[step] ?? step;
const stepOfSegment = (seg: string): ProjectStep | null =>
  seg === "clashes" ? "clash" : seg === "" ? "overview" : isProjectStep(seg) && seg !== "clash" ? seg : null;

/** The route a path asks for, or null when the path is not a project's. An unknown step opens Overview. */
export function parseProjectPath(path: string): ProjectRoute | null {
  const p = path.trim().replace(/\/+$/, "");
  if (p === "/projects") return { view: "projects" };
  const m = /^\/projects\/([\w-]{1,64})(?:\/([\w-]+)(?:\/(\d{1,6}))?)?$/.exec(p);
  if (!m) return null;
  const step = stepOfSegment(m[2] ?? "") ?? "overview";
  const n = m[3] && step === "clash" ? Number(m[3]) : 0;
  return n > 0 ? { view: "project", pid: m[1], step, clash: n } : { view: "project", pid: m[1], step };
}

/** The path for a route: `/projects`, `/projects/<pid>` (Overview), `/projects/<pid>/<step>`, `/projects/<pid>/clashes/<n>`. */
export function formatProjectPath(route: ProjectRoute): string {
  if (route.view === "projects") return "/projects";
  const seg = segmentOf(route.step);
  const base = `/projects/${route.pid}${seg ? `/${seg}` : ""}`;
  return route.step === "clash" && route.clash ? `${base}/${route.clash}` : base;
}

/** One project's path. */
export const projectPath = (pid: string, step: ProjectStep = "overview") => formatProjectPath({ view: "project", pid, step });
export const PROJECTS_PATH = "/projects";

/** The page's hash, or "" where there is no location (tests). */
export function currentHash(): string {
  return typeof window !== "undefined" ? window.location?.hash ?? "" : "";
}

/** The page's path, or "" where there is no location (tests). */
export function currentPath(): string {
  return typeof window !== "undefined" ? window.location?.pathname ?? "" : "";
}

/** The project route the page is on now (its path; an old project hash too), or null. */
export const currentProjectRoute = (): ProjectRoute | null => parseProjectPath(currentPath()) ?? parseProjectHash(currentHash());

/** The path an old address stands for: `#projects` and `#project/<pid>/<step>`, `#about` and `#about/<tab>`,
 *  `#owner`; null for any other hash. */
export function legacyPath(hash: string): string | null {
  const route = parseProjectHash(hash);
  if (route) return formatProjectPath(route);
  const about = /^#about(?:\/([\w-]+))?$/.exec(hash.trim());
  if (about) return about[1] && about[1] !== "overview" ? `/about/${about[1]}` : "/about";
  return /^#owner\b/.test(hash.trim()) ? "/settings" : null;
}

/** Go to a path: a new history entry when `push` (Back returns), else in place; nothing where there is no history. */
export function showPath(path: string, push: boolean): void {
  if (typeof window === "undefined" || !window.history || !window.location) return;
  const next = path + window.location.search;
  if (window.location.pathname + window.location.search + (window.location.hash ?? "") === next) return;
  if (push) window.history.pushState(window.history.state, "", next);
  else window.history.replaceState(window.history.state, "", next);
}

/** Put a project route in the address bar, or (null) `fallback`: the workspace or the first screen. */
export function showProjectRoute(route: ProjectRoute | null, push: boolean, fallback = "/home"): void {
  showPath(route ? formatProjectPath(route) : fallback, push);
}

/** A plain click on a link the page handles itself (not one meant for a new tab or window). */
export function ownClick(e: { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): boolean {
  return !e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** Whether a path is one of the app's own pages: "/", Home, the workspace, Settings, About and its tabs, the projects
 *  (`parseProjectPath`). Any other shows "Page not found" (NotFound.tsx); "" (no location: tests) is the app's. */
export function isAppPath(path: string): boolean {
  const p = path.trim().replace(/\/+$/, "");
  return /^(\/index\.html|\/home|\/workspace|\/settings|\/about(\/[\w-]+)?)?$/.test(p) || parseProjectPath(p) !== null;
}
