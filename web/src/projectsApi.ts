import { ApiError, apiFetch, apiUrl, type SceneInfo } from "./api";
import type { ProjectStep } from "./projectRoute";

/* Projects (docs/engineer-workflow.md, "Server contract"): typed calls for /api/projects*, the ids this browser keeps,
 * and the plain facts the Projects pages show (model mix, last saved, next step). No React, no App state. */

export type ModelKind = "IFC" | "STEP";
export interface ProjectFile { name: string; kind: ModelKind; size: number; sha256: string }
export interface SavedState { n: number; at: number; files: string[]; edits: number }
export type ReviewStatus = "open" | "by_design" | "author" | "resolved";
export interface Review { status: ReviewStatus; note?: string; by?: string; at: number; number?: number; title?: string }
export type ReportKind = "pdf" | "bcf";
export interface ProjectReport { doc_id: string; name: string; at: number; kind: ReportKind }
/** Last known coordination numbers: the page sends them (PATCH), the server only keeps them. */
export interface CoordCounts { clashes: number; open: number; resolved: number; reviewed: number }

export interface Project {
  id: string; name: string; created: number; updated: number;
  files: ProjectFile[];
  scene_id: string | null;            // the open session, if any
  saved: SavedState[];
  reviews: Record<string, Review>;    // key = clash key (`${kind}|${[gidA, gidB].sort().join("|")}`)
  reports: ProjectReport[];
  counts?: CoordCounts | null;
  /** Made by "Try the sample building" (or the sample drawings): shown with a "Sample" pill, never as the visitor's own. */
  sample?: boolean;
}

/** `scene` is GET /api/scenes/{id}'s answer for the scene just opened. */
export interface OpenedProject { scene_id: string; project: Project; scene?: SceneInfo }
export interface ProjectPatch { name?: string; counts?: CoordCounts | null }
export interface ReviewUpdate { key: string; status: ReviewStatus; note?: string; by?: string; number?: number; title?: string }
export interface ReportEntry { doc_id: string; name: string; kind: ReportKind }

/** An activity line the page keeps (decisions, saves, imports): `at` in seconds or milliseconds. */
export interface ActivityItem { at: number; text: string }

/* ---------------------------------------------------------------------------------------------------------------- */
/* Calls                                                                                                            */

/** FastAPI's detail: a sentence, or a validation error's list of `{msg}`. */
function detailOf(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d)) {
    const msgs = d.map((x) => (x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string" ? (x as { msg: string }).msg : ""))
      .filter(Boolean);
    if (msgs.length) return msgs.join("; ");
  }
  return null;
}

/** One JSON call to `/api<path>`; a failure throws api.ts's ApiError with the server's words and status. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await apiFetch(`/api${path}`, {
    ...init, headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  if (!r.ok) throw new ApiError(detailOf(await r.json().catch(() => null)) ?? `Request failed (${r.status})`, r.status);
  return (await r.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, body: JSON.stringify(body) };
const at = (pid: string) => `/projects/${encodeURIComponent(pid)}`;

/** Ids one listing may ask for (the server's PROJECT_IDS_MAX; it ignores any past that). */
export const LIST_IDS_MAX = 200;

/** The projects with these ids (the ones this browser created), newest change first. An empty list asks nothing;
 *  more ids than one listing takes are asked in batches, so none is dropped unseen; leaving `ids` out asks for every
 *  project, which the server allows the owner only (403 otherwise). */
export async function listProjects(ids?: readonly string[]): Promise<Project[]> {
  if (!ids) return request<Project[]>("/projects");
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += LIST_IDS_MAX) batches.push(unique.slice(i, i + LIST_IDS_MAX));
  const lists = await Promise.all(batches.map((b) => request<Project[]>(`/projects?ids=${b.map(encodeURIComponent).join(",")}`)));
  return lists.length === 1 ? lists[0] : lists.flat().sort((a, b) => b.updated - a.updated);
}

export const createProject = (name: string, opts: { sample?: boolean } = {}) =>
  request<Project>("/projects", json("POST", opts.sample ? { name: name.trim(), sample: true } : { name: name.trim() }));

/** The sample building's project name: "Try the sample building" makes it once and finds it again. */
export const SAMPLE_PROJECT = "Northbank sample building";
/** The sample project, marked "Sample" in the lists: the server's flag, or (made before the flag) its name. */
export const isSample = (p: { sample?: boolean; name?: string } | null | undefined): boolean =>
  !!p && (p.sample === true || p.name === SAMPLE_PROJECT);
export const getProject = (pid: string) => request<Project>(at(pid));
export const patchProject = (pid: string, patch: ProjectPatch) => request<Project>(at(pid), json("PATCH", patch));
export const renameProject = (pid: string, name: string) => patchProject(pid, { name: name.trim() });
/** Keep an open scene's models in the project (the server copies its original files into `models/`). */
export const attachScene = (pid: string, sceneId: string) =>
  request<Project>(`${at(pid)}/attach`, json("POST", { scene_id: sceneId }));
/** Open the project's saved state (else its originals) as a scene. */
export const openProject = (pid: string) => request<OpenedProject>(`${at(pid)}/open`, json("POST"));
/** Save the scene's edited files, edit journal and decisions as the project's next saved state. */
export const saveProject = (pid: string, sceneId: string) =>
  request<Project>(`${at(pid)}/save`, json("POST", { scene_id: sceneId }));
export const setReview = (pid: string, review: ReviewUpdate) => request<Project>(`${at(pid)}/reviews`, json("PUT", review));
/** Keep a built report (its document id, while the server still holds it) with the project. */
export const addReport = (pid: string, report: ReportEntry) => request<Project>(`${at(pid)}/reports`, json("POST", report));
/** Where a report kept with the project downloads from. */
export const projectReportUrl = (pid: string, docId: string) => apiUrl(`/api${at(pid)}/reports/${encodeURIComponent(docId)}`);

/** The same calls as one object, for a caller that passes them around (tests, the integration in App). */
export const projectsApi = {
  listProjects, createProject, getProject, patchProject, renameProject, attachScene, openProject, saveProject, setReview, addReport,
};

/** The clash key reviews are stored under: stable across re-detection (`kind|gidA|gidB`, the ids sorted). */
export const clashKey = (kind: string, a: string, b: string) => `${kind}|${[a, b].sort().join("|")}`;

/* ---------------------------------------------------------------------------------------------------------------- */
/* The ids this browser keeps (projects are private by unguessable id, not by login)                                */

export const PROJECTS_KEY = "iris.projects";
const ID = /^[\w-]{1,64}$/;

/** The project ids this browser created or opened, most recent first; [] when storage is unavailable. */
export function myProjectIds(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))] : [];
  } catch { return []; }
}

function writeIds(ids: string[]): string[] {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(ids)); } catch { /* private window: kept for this page only */ }
  return ids;
}

/** Keep `id` (first in the list); returns the list as now kept. */
export function rememberProject(id: string): string[] {
  if (!ID.test(id)) return myProjectIds();
  return writeIds([id, ...myProjectIds().filter((x) => x !== id)]);
}

export function forgetProject(id: string): string[] {
  return writeIds(myProjectIds().filter((x) => x !== id));
}

/** After a list call: forget the ids that were `asked` for and not `found` (removed on the server). Ids added while
 *  the call was out were not asked for and stay. */
export function pruneProjectIds(asked: readonly string[], found: readonly Pick<Project, "id">[]): string[] {
  const have = new Set(found.map((p) => p.id)), gone = new Set(asked.filter((id) => !have.has(id)));
  return gone.size ? writeIds(myProjectIds().filter((x) => !gone.has(x))) : myProjectIds();
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Facts the pages show                                                                                             */

/** Server times are seconds (Python's time.time()); the page's own are milliseconds. Either reads as milliseconds. */
export const toMs = (t: number) => (t < 1e11 ? t * 1000 : t);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A short, relative time: "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", "12 Nov", "12 Nov 2025". */
export function whenText(t: number, now = Date.now()): string {
  const ms = toMs(t), s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(ms), today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** The full local date and time, for a tooltip. */
export const fullTime = (t: number) => new Date(toMs(t)).toLocaleString();

export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The share of clashes closed, never rounded to a claim that isn't true: 1 of 464 is "<1% closed" (not 0%), 463 of
 * 464 is ">99% closed" (not 100%). */
export function closedText(closed: number, total: number): string {
  const pct = total > 0 ? Math.round((100 * closed) / total) : 0;
  return `${closed > 0 && pct === 0 ? "<1" : closed < total && pct === 100 ? ">99" : pct}% closed`;
}

/** How many models of each kind, IFC first: [{kind: "IFC", n: 3}, {kind: "STEP", n: 1}]. */
export function modelMix(files: readonly Pick<ProjectFile, "kind">[]): { kind: ModelKind; n: number }[] {
  const order: ModelKind[] = ["IFC", "STEP"];
  return order.map((kind) => ({ kind, n: files.filter((f) => f.kind === kind).length })).filter((k) => k.n > 0);
}

/** The latest saved state, or null when the project was never saved. */
export function lastSaved(p: Pick<Project, "saved">): SavedState | null {
  return p.saved.reduce<SavedState | null>((best, s) => (!best || s.n > best.n ? s : best), null);
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  open: "Open", by_design: "By design", author: "Sent to author", resolved: "Resolved",
};

/** How many recorded reviews have each status. */
export function reviewTally(reviews: Project["reviews"]): Record<ReviewStatus, number> {
  const t: Record<ReviewStatus, number> = { open: 0, by_design: 0, author: 0, resolved: 0 };
  for (const key of Object.keys(reviews)) {
    const s = reviews[key]?.status;
    if (s && s in t) t[s]++;
  }
  return t;
}

/** The numbers to show: the open page's (live) first, else the project's last known, else none. */
export function knownCounts(p: Pick<Project, "counts">, live?: CoordCounts | null): { counts: CoordCounts; live: boolean } | null {
  if (live) return { counts: live, live: true };
  return p.counts ? { counts: p.counts, live: false } : null;
}

export type NextKind = "import" | "detect" | "review" | "report";
export interface NextAction { kind: NextKind; step: ProjectStep; title: string; detail: string; action: string }

/** What the engineer does next, from the project's real state: no models → import; models but no check → run
 *  coordination; open clashes → review them; nothing open → report. */
export function nextAction(p: Pick<Project, "files" | "reports">, counts: CoordCounts | null | undefined): NextAction {
  if (!p.files.length) return { kind: "import", step: "models", title: "Import models", action: "Import models",
    detail: "Add the IFC or STEP models to coordinate. Each file shows its own progress and can be retried." };
  if (!counts) return { kind: "detect", step: "coordination", title: "Run coordination", action: "Open workspace",
    detail: `${plural(p.files.length, "model")} imported and not checked yet. Open the workspace to run the clash tests.` };
  if (counts.open > 0) {
    const of = Math.max(counts.clashes, counts.open);
    return { kind: "review", step: "clash", title: "Review clashes", action: "Review clashes",
      detail: `${counts.open} of ${plural(of, "clash", "clashes")} ${counts.open === 1 ? "is" : "are"} open. `
        + "Investigate each one, then accept, reject or request another proposal." };
  }
  const made = p.reports.length ? ` ${plural(p.reports.length, "report")} so far.` : "";
  const done = counts.clashes === 0 ? "The last check found no clashes. Record the clean result in a report."
    : counts.clashes === 1 ? "The one clash is resolved or reviewed. Record the outcome as PDF or BCF."
      : `All ${counts.clashes} clashes are resolved or reviewed. Record the outcome as PDF or BCF.`;
  return { kind: "report", step: "reports", title: "Create report", action: "Create report", detail: done + made };
}
