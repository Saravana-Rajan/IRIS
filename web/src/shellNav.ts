/** The app shell's pure parts (AppShell.tsx draws them): the sidebar's item ids, the remembered collapsed-to-rail state,
 *  the avatar's initial, the search's grouping and the "/" shortcut's test. Nothing here touches React or the page. */
import type { ProjectStep } from "./projectRoute";

/** A sidebar item: the main pages (Home, Projects, the workspace, Demos), then the open project's steps (their ids are
 *  the project group's items). */
export type NavId = "home" | "projects" | "workspace" | "demos" | ProjectStep;

/** The Demos page's address. Not `/demos`: that is the folder of the video files (web/public/demos/). */
export const DEMOS_PATH = "/videos";

/** Whether a path is the Demos page's (`/videos`, a trailing slash too): the sidebar's Demos is the active item there. */
export function isDemosPath(path: string | null | undefined): boolean {
  return /^\/videos\/?$/.test((path ?? "").trim());
}

/** Where the rail state is remembered: ordinary pages, or the 3D workspace pages. */
export type RailWhere = "pages" | "workspace";

/** localStorage key: `{"pages": false, "workspace": true}`, true meaning collapsed to the icon rail. */
export const SIDEBAR_KEY = "iris.sidebar";

/** Expanded on ordinary pages; collapsed to the rail on the 3D workspace pages, which need the width. */
export const RAIL_DEFAULT: Readonly<Record<RailWhere, boolean>> = { pages: false, workspace: true };

/** The slice of Storage the helpers use (a test passes a Map behind these two). */
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The browser's localStorage, or null where there is none or it refuses (a private window, blocked site data). */
export function browserStorage(): StorageLike | null {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
}

function readAll(storage: StorageLike | null | undefined): Partial<Record<RailWhere, boolean>> {
  try {
    const raw = storage?.getItem(SIDEBAR_KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Partial<Record<RailWhere, boolean>> = {};
    for (const k of ["pages", "workspace"] as const) {
      const b = (v as Record<string, unknown>)[k];
      if (typeof b === "boolean") out[k] = b;
    }
    return out;
  } catch { return {}; }
}

/** Whether the sidebar is collapsed to the rail `where`: the remembered choice, else the default. Never throws. */
export function readRail(storage: StorageLike | null | undefined, where: RailWhere): boolean {
  return readAll(storage)[where] ?? RAIL_DEFAULT[where];
}

/** Remember the rail state for `where`, keeping the other one. A storage that is missing or throws is ignored. */
export function writeRail(storage: StorageLike | null | undefined, where: RailWhere, rail: boolean): void {
  try {
    if (!storage) return;
    storage.setItem(SIDEBAR_KEY, JSON.stringify({ ...readAll(storage), [where]: rail }));
  } catch { /* private window or full storage: the choice lasts for this page only */ }
}

/** The avatar's letter: the name's first character, upper-cased; "?" when there is no name. */
export function initials(name: string | null | undefined): string {
  const first = Array.from((name ?? "").trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

/** The longest reviewer name the sidebar's inline edit accepts. */
export const NAME_MAX = 120;

/** What the inline edit saves: trimmed and cut to NAME_MAX characters. */
export const cleanName = (name: string) => Array.from(name.trim()).slice(0, NAME_MAX).join("").trim();

/** One search result (the lead's `search(q)` returns them, best first). `href`: its address, so a new tab works. */
export interface SearchHit {
  id: string;
  kind: "project" | "clash" | "element" | "page";
  label: string;
  sub?: string;
  href?: string;
  run(): void;
}

export const HIT_KIND_LABEL: Readonly<Record<SearchHit["kind"], string>> =
  { project: "Projects", clash: "Clashes", element: "Elements", page: "Pages" };

/** The most results the popover lists. */
export const MAX_HITS = 8;

export interface HitGroup<T> { kind: SearchHit["kind"]; label: string; items: { hit: T; index: number }[] }

/** The first `max` hits grouped by kind, the groups in the order their first hit came, each hit keeping its order;
 *  `index` is its place in the list as shown (what the arrow keys walk). */
export function groupHits<T extends { kind: SearchHit["kind"] }>(hits: readonly T[], max = MAX_HITS): HitGroup<T>[] {
  const groups: HitGroup<T>[] = [];
  for (const hit of hits.slice(0, Math.max(0, max))) {
    let g = groups.find((x) => x.kind === hit.kind);
    if (!g) groups.push(g = { kind: hit.kind, label: HIT_KIND_LABEL[hit.kind] ?? hit.kind, items: [] });
    g.items.push({ hit, index: -1 });
  }
  let i = 0;
  for (const g of groups) for (const item of g.items) item.index = i++;
  return groups;
}

/** Whether a key press happened while typing (an input, a text area, a select, editable text), where "/" is a
 *  character and not the search shortcut. */
export function inField(target: unknown): boolean {
  const el = target as { closest?: (s: string) => unknown; tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el !== "object") return false;
  if (typeof el.closest === "function") return !!el.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])");
  return el.isContentEditable === true || (typeof el.tagName === "string" && /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName));
}

/** Whether a key press asks for the search: "/" (outside a field), or Ctrl/⌘+K anywhere. */
export function isSearchKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }): boolean {
  if (e.altKey) return false;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") return true;
  return e.key === "/" && !e.ctrlKey && !e.metaKey && !inField(e.target);
}

/** The sheets the sidebar opens, each with an address of its own (`/settings`, `/help`): shown over the page they were
 *  opened from, or over Home when the address is opened as it is. */
export type SheetId = "settings" | "help";

/** The sheet a path asks for, or null. */
export function sheetOfPath(path: string): SheetId | null {
  const m = /^\/(settings|help)\/?$/.exec((path ?? "").trim());
  return m ? (m[1] as SheetId) : null;
}

/** The address a sheet was opened from, to go back to when it closes. */
let sheetFrom: string | null = null;

/** Put a sheet's address in the bar (push: Back closes it), or (null) go back, in place, to the address it was opened
 *  from (else `fallback`). Switching from one sheet to the other keeps where the first was opened from. No-op without
 *  a window. */
export function showSheetPath(sheet: SheetId | null, push: boolean, fallback = "/home"): void {
  if (typeof window === "undefined" || !window.history || !window.location) return;
  const here = window.location.pathname, search = window.location.search ?? "";
  const on = sheetOfPath(here);
  if (sheet === null) {
    if (on) window.history.replaceState(window.history.state, "", (sheetFrom ?? fallback) + search);
    sheetFrom = null;
    return;
  }
  if (!on) sheetFrom = here;
  if (on === sheet) return;
  const next = `/${sheet}${search}`;
  if (push && !on) window.history.pushState(window.history.state, "", next);
  else window.history.replaceState(window.history.state, "", next);
}
