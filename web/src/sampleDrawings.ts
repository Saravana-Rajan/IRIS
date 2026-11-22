// "Try the sample drawings" (docs/drawings.md): the sample building as a project, on its Drawings step with the sample
// PDF sheets attached. Pure: the page passes its own calls (`SampleDrawingsPage`), so App and any other shell run the
// same steps in the same order. Types only are imported.
import type { Demo } from "./api";
import type { Drawing } from "./drawingsApi";
import type { Project } from "./projectsApi";

/** What the page says while "Try the sample drawings" starts (the first screen spins its button on it). */
export const SAMPLE_DRAWINGS_BUSY = "Opening the sample drawings…";
/** What the page says while the sheets are attached to the open models. */
export const ADDING_SAMPLE_DRAWINGS = "Adding the sample drawings…";

/** The demo these open files are: each of them among its files and context, by name, case aside (server
 * `demos.find`). A demo with `drawings` is one the Drawings step can offer its sample sheets for. */
export function demoOfFiles(files: readonly string[], demos: readonly Demo[]): Demo | undefined {
  if (!files.length) return undefined;
  const key = (f: string) => (f.split(/[\\/]/).pop() ?? f).toLowerCase();
  return demos.find((d) => { const set = new Set([...d.files, ...d.context].map(key)); return files.every((f) => set.has(key(f))); });
}

/** The page's own calls, which `openSampleDrawings` runs in its order. */
export interface SampleDrawingsPage {
  /** The sample building's project of this browser's: found again by name, else made now (`made`). */
  sampleProject(): Promise<{ p: Project; made: boolean }>;
  /** Show the project on its Drawings step (`/projects/<pid>/drawings`), its models marked as opened by this page. */
  show(p: Project): void;
  /** The scene open on the page now, if any. */
  sceneId: string | null;
  /** Open these sample models: the new scene's id, or null (the page has said why). */
  open(names: string[]): Promise<string | null>;
  /** Open a saved project as the page does; `opened` runs with its scene before any check, and its false skips the
   * check. The scene's id, or null. */
  openProject(p: Project, opened: (sid: string) => Promise<boolean>): Promise<string | null>;
  /** Attach the sample sheets to the scene (`drawingsApi.addSampleDrawings`; one held already is not added again). */
  attach(sid: string): Promise<Drawing[]>;
  /** Keep the scene's models, and with them its drawings, with the project (`projectsApi.attachScene`). */
  keep(pid: string, sid: string): Promise<unknown>;
  /** Check the models for clashes, for Clash review. It must not hold up the Drawings step (App's `runDetect` sets
   * `detecting`, never `busy`). */
  check(sid: string): Promise<unknown>;
  /** The scene's sheets changed: list them again. */
  listed(): void;
  /** What the page is doing, in words; null when done. */
  busy(label: string | null): void;
  /** An error line for the page. */
  fail(message: string): void;
}

/**
 * Open the sample drawings: `names` are the sample building's default models. The sheets come first.
 * - A new sample project: its models opened, the sheets attached and listed, both kept with the project, and only
 *   then the clash check.
 * - The sample project found again, not open here: opened as the page opens a project, the sheets attached before its
 *   check (`openProject`'s `opened`).
 * - Found again and open here: the sheets attached at once; no check.
 * A refused attach says "Could not open the sample drawings: …" and runs no check (a check clears the page's error
 * line; Clash review checks later). Resolves with the scene the sheets went to, or null.
 */
export async function openSampleDrawings(names: readonly string[], page: SampleDrawingsPage): Promise<string | null> {
  if (!names.length) return null;
  page.busy(SAMPLE_DRAWINGS_BUSY);
  const failed = (e: unknown) => page.fail(`Could not open the sample drawings: ${(e as Error).message}`);
  const attach = async (sid: string) => {
    try { await page.attach(sid); return true; } catch (e) { failed(e); return false; }
    finally { page.listed(); }
  };
  let found: { p: Project; made: boolean };
  try { found = await page.sampleProject(); }
  catch (e) { failed(e); page.busy(null); return null; }
  const { p, made } = found;
  page.show(p);
  const here = page.sceneId;
  if (!made && here && p.scene_id === here) {   // its models are the ones open
    page.busy(ADDING_SAMPLE_DRAWINGS);
    await attach(here);
    page.busy(null);
    return here;
  }
  page.busy(null);   // opening shows its own progress
  if (!made) return page.openProject(p, attach);
  const sid = await page.open([...names]);
  if (!sid) return null;
  page.busy(ADDING_SAMPLE_DRAWINGS);
  const ok = await attach(sid);
  await page.keep(p.id, sid);
  page.busy(null);
  if (ok) await page.check(sid);
  return sid;
}
