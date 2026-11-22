import { Building2, CircleCheck, FileText, FolderKanban, History, Plus } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { projectName, type Resume } from "./About";
import { DemoClips } from "./DemoClips";
import { HoloRibbon, TextReveal } from "./Holo";
import { PROJECT_FLOW } from "./ProjectsHome";
import { ownClick, projectPath } from "./projectRoute";
import { plural, whenText, type Project } from "./projectsApi";
import "./home.css";

/** How many recent projects Home shows. */
export const RECENT_MAX = 4;

/** "Good morning" (5:00 to 11:59), "Good afternoon" (to 17:59) or "Good evening", by the local clock at `now` (ms). */
export function greetingFor(now: number): string {
  const h = new Date(now).getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

/** A link the page opens itself on a plain click (a new tab or window still gets the address). */
const own = (go?: () => void) => (e: MouseEvent<HTMLAnchorElement>) => {
  if (!go || !ownClick(e)) return;
  e.preventDefault();
  go();
};

/** A project's line under its name: its open clashes when the last check is known (never a guess), else "Not checked". */
function ProjectStatus({ p }: { p: Project }) {
  const c = p.counts;
  const [tone, label] = !c ? ["none", "Not checked"]
    : c.open > 0 ? ["open", `${plural(c.open, "open clash", "open clashes")}`]
      : ["clear", c.clashes ? "None open" : "No clashes"];
  return <span className={`home-status ${tone}`}><i aria-hidden />{label}</span>;
}

/**
 * Home (`/home`, docs/ui-design.md §10.1): the first page inside the app shell, light and calm, Synthesia-like. A
 * greeting that reveals word by word beside the holographic ribbon, Iris's principle and what it does; the last session
 * to resume; three ways to start (a new project, the sample building, the sample drawings); the recent projects; the two
 * demo clips (DemoClips); and Iris's eight steps (PROJECT_FLOW). No brand header or chrome of its own: the shell has
 * them. It scrolls inside its container. Props only; nothing here calls the server.
 */
export function StartScreen({
  name = "", now = Date.now(), onNewProject, onProjects, projectsHref = "/projects",
  onSample, sampleBusy = false, onSampleDrawings, sampleDrawingsBusy = false,
  recent = [], recentLoading = false, onOpenProject, projectHref = projectPath, resume,
}: {
  /** The reviewer's name (localStorage `iris.reviewer`); the greeting says "there" without one. */
  name?: string;
  /** The clock (ms) for the greeting's time of day; tests pass a fixed one. */
  now?: number;
  /** The dashed "New project" tile (and "Create one" when there are no projects yet). */
  onNewProject: () => void;
  /** "All projects": a link to `projectsHref` (a new tab opens it), a plain click handled here. */
  onProjects: () => void;
  projectsHref?: string;
  /** The sample building as a project, opened on its clash review. Absent when the server lists no sample. */
  onSample?: () => void;
  sampleBusy?: boolean;
  /** The same sample project opened on its Drawings step with the sample PDF sheets attached (their saved Gemini
   * readings replay at no cost). Absent when the server lists no sample drawings. */
  onSampleDrawings?: () => void;
  sampleDrawingsBusy?: boolean;
  /** This browser's projects, newest first; the first RECENT_MAX show. */
  recent?: Project[];
  /** The projects are still being listed: light placeholder cards until the first arrive. */
  recentLoading?: boolean;
  /** A recent project's card: a link to `projectHref(pid)`, a plain click handled by `onOpenProject`. */
  onOpenProject?: (pid: string) => void;
  projectHref?: (pid: string) => string;
  /** This browser's last session, still on the server. */
  resume?: Resume;
}) {
  const who = name.trim() || "there";
  const hello = `${greetingFor(now)}, ${who}`;
  const tagline = "AI proposes. Geometry proves. The engineer decides.";
  const shown = recent.slice(0, RECENT_MAX);
  const anyBusy = sampleBusy || sampleDrawingsBusy;
  const tiles = 1 + (onSample ? 1 : 0) + (onSampleDrawings ? 1 : 0);
  return (
    <div className="home">
      <header className="home-hero">
        <div className="home-hero-in">
          <div className="home-art"><HoloRibbon size="clamp(220px, 42cqi, 500px)" /></div>
          <div className="home-hero-text">
            <h1 className="home-greeting"><TextReveal text={hello} once="home-greeting" step={90} /></h1>
            <p className="home-tagline">
              <TextReveal text={tagline} once="home-tagline" delay={90 * hello.split(/\s+/).length + 180} step={70} /></p>
            <p className="home-what">Coordinate IFC and STEP models: find the clashes, review fixes the geometry has checked,
              and report what was decided.</p>
            {resume && (
              <div className="home-resume" role="region" aria-label="Your last session">
                <span className="home-resume-icon" aria-hidden><History size={16} /></span>
                <p className="home-resume-text">
                  Resume <b>{projectName(resume.files)}</b>
                  {resume.fixed ? ` · ${plural(resume.fixed, "fix", "fixes")} kept` : ""}
                  {resume.clashes != null ? ` · ${plural(resume.clashes, "clash", "clashes")}` : ""}
                  {` · saved ${whenText(resume.savedAt, now)}`}</p>
                <span className="home-resume-actions">
                  <button type="button" className="btn primary small" onClick={resume.onResume}>Resume</button>
                  <button type="button" className="btn ghost small" onClick={resume.onFresh}>Start fresh</button>
                </span>
              </div>)}
          </div>
        </div>
      </header>

      <div className="home-body">
        <section className="home-tiles" aria-label="Start" style={{ "--tiles": tiles } as CSSProperties}>
          <button type="button" className="home-tile home-tile-new" data-start="new-project" onClick={onNewProject}>
            <span className="home-tile-icon" aria-hidden><Plus size={20} /></span>
            <span className="home-tile-text"><span className="home-tile-title">New project</span>
              <span className="home-tile-line">Import your IFC or STEP models and check them for clashes.</span></span>
          </button>
          {onSample && (
            <button type="button" className="home-tile" data-start="sample" disabled={anyBusy} aria-busy={sampleBusy || undefined}
              onClick={onSample}>
              <span className="home-tile-icon" aria-hidden>{sampleBusy ? <i className="spinner" /> : <Building2 size={20} />}</span>
              <span className="home-tile-text"><span className="home-tile-title">Try the sample building</span>
                <span className="home-tile-line">A sample building's models, opened on their clash review. Nothing to upload.</span></span>
            </button>)}
          {onSampleDrawings && (
            <button type="button" className="home-tile holo-edge" data-start="sample-drawings" disabled={anyBusy}
              aria-busy={sampleDrawingsBusy || undefined} onClick={onSampleDrawings}>
              <span className="home-tile-icon" aria-hidden>{sampleDrawingsBusy ? <i className="spinner" /> : <FileText size={20} />}</span>
              <span className="home-tile-text"><span className="home-tile-title">Try the sample drawings</span>
                <span className="home-tile-line">Its PDF sheets, read by AI and compared with the 3D model.</span></span>
            </button>)}
        </section>

        <section className="home-section" aria-labelledby="home-recent-title" aria-busy={recentLoading || undefined}>
          <div className="home-section-head">
            <h2 className="home-h2" id="home-recent-title">Recent projects</h2>
            <a className="home-link" data-start="projects" href={projectsHref} onClick={own(onProjects)}>All projects</a>
          </div>
          {shown.length ? (
            <ul className="home-recent">
              {shown.map((p) => (
                <li key={p.id}>
                  <a className="home-project" data-project={p.id} href={projectHref(p.id)}
                    onClick={own(onOpenProject && (() => onOpenProject(p.id)))}>
                    <span className="home-project-top">
                      <span className="home-project-icon" aria-hidden><FolderKanban size={16} /></span>
                      <span className="home-project-name">{p.name}</span>
                    </span>
                    <span className="home-project-meta">
                      <span>{p.files.length ? plural(p.files.length, "model") : "No models yet"}</span>
                      <ProjectStatus p={p} />
                    </span>
                    <span className="home-project-when">Updated {whenText(p.updated, now)}</span>
                  </a>
                </li>))}
            </ul>
          ) : recentLoading ? (
            <ul className="home-recent" aria-hidden>
              {[0, 1, 2].map((i) => (
                <li key={i}><span className="home-project home-skeleton"><i /><i /><i /></span></li>))}
            </ul>
          ) : (
            <div className="home-recent-empty">
              <HoloRibbon size={40} className="home-recent-art" />
              <p>No projects yet. A project keeps your models, checks and decisions together.</p>
              <button type="button" className="home-textbtn" onClick={onNewProject}>Create one</button>
            </div>
          )}
          {recentLoading && !shown.length && <span className="home-sr" role="status">Loading your projects…</span>}
        </section>

        <section className="home-section">
          <DemoClips />
        </section>

        <section className="home-section" aria-labelledby="home-how-title">
          <div className="home-section-head"><h2 className="home-h2" id="home-how-title">How Iris works</h2></div>
          <ol className="home-steps">
            {PROJECT_FLOW.map((s, i) => (
              <li key={s.name} className={`home-step${s.name === "Propose" ? " holo-edge" : ""}`} data-step={s.name}>
                <span className="home-step-n mono">{i + 1}</span>
                <b className="home-step-name">{s.name}{s.name === "Validate" && <CircleCheck size={14} className="home-step-ok" aria-hidden />}</b>
                <span className="home-step-t">{s.text}</span>
              </li>))}
          </ol>
        </section>
      </div>
    </div>
  );
}
