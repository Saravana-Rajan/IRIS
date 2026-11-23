import { ArrowDown, Building2, FileText, FolderKanban, History, Plus } from "lucide-react";
import { lazy, Suspense, type CSSProperties, type MouseEvent } from "react";
import { projectName, type Resume } from "./About";
import { WatchDemoButton, WatchDemos } from "./DemoVideo";
import { HERO_POSTER } from "./glassModel";
import { MarkBadge, TextReveal } from "./Holo";
import { HowIrisWorks } from "./HowIrisWorks";
import { ownClick, projectPath, type ProjectStep } from "./projectRoute";
import { isSample, plural, whenText, type Project } from "./projectsApi";
import "./home.css";

/** How many recent projects Home shows. */
export const RECENT_MAX = 4;

/** "Sample": the sample building's project, never the visitor's own (index.css `.sample-pill`). */
export function SamplePill() {
  return <span className="sample-pill" data-tip="The sample building: try Iris on it; it is not your own project">Sample</span>;
}

/** "Good morning" (5:00 to 11:59), "Good afternoon" (to 17:59) or "Good evening", by the local clock at `now` (ms). */
export function greetingFor(now: number): string {
  const h = new Date(now).getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

/** The hero's live 3D glass aperture (three.js), loaded after the first paint; its still shows until then. */
const HeroGlass = lazy(() => import("./HeroGlass"));
/** The area whose hover makes the aperture open a little more: the hero. */
const heroArea = () => (typeof document === "undefined" ? null : document.querySelector(".home-hero"));

/** The tagline, in two lines beside the aperture. */
export const TAGLINE = ["AI proposes. Geometry proves.", "The engineer decides."] as const;

/** The scroll cue: down to the body, the demos then the start tiles (instantly under reduced motion). No hooks, so tests can call StartScreen. */
function toTiles(e: MouseEvent<HTMLButtonElement>) {
  const body = e.currentTarget.closest(".home")?.querySelector(".home-body");
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  body?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
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
 * Home (`/home`, docs/ui-design.md §10.1): the first page inside the app shell, light and calm, Synthesia-like. The
 * hero: the greeting, Iris's principle in large regular type and what it does, revealed word by word, beside our logo as
 * a 3D glass aperture floating over a white pedestal, breathing and leaning toward the pointer (HeroGlass, lazy; its
 * still until it loads), and a square "↓" cue down to the rest; then the last session to resume; the three demo videos
 * in one row of cards under the heading "See Iris in action" (WatchDemos: posters only until one is opened); three ways
 * to start (a new project, the sample building, the sample drawings), all styled alike; Iris's eight steps as cards
 * (HowIrisWorks); and the recent projects. No brand header or chrome of its own: the shell has them. It scrolls inside its container. Props only;
 * nothing here calls the server.
 */
export function StartScreen({
  now = Date.now(), onNewProject, onProjects, projectsHref = "/projects",
  onSample, sampleBusy = false, onSampleDrawings, sampleDrawingsBusy = false, onSampleStep,
  recent = [], recentLoading = false, onOpenProject, projectHref = projectPath, resume,
}: {
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
  /** "How Iris works": a step's card opens that step on the sample building. Absent: the cards are static. */
  onSampleStep?: (step: ProjectStep) => void;
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
  // Just the time of day: the reviewer name (`iris.reviewer`) is what decisions are signed with, often a test name,
  // never a greeting (owner, 23 Nov).
  const hello = greetingFor(now);
  const helloMs = 90 * hello.split(/\s+/).length + 120;
  const shown = recent.slice(0, RECENT_MAX);
  const anyBusy = sampleBusy || sampleDrawingsBusy;
  const tiles = 1 + (onSample ? 1 : 0) + (onSampleDrawings ? 1 : 0);
  return (
    <div className="home">
      <header className="home-hero">
        <div className="home-hero-in">
          <div className="home-hero-text">
            <p className="home-greeting"><TextReveal text={hello} once="home-greeting" step={90} /></p>
            <h1 className="home-tagline">
              <span className="home-tagline-line"><TextReveal text={TAGLINE[0]} once="home-tagline" delay={helloMs} step={80} /></span>
              <span className="home-tagline-line"><TextReveal text={TAGLINE[1]} once="home-tagline-2" delay={helloMs + 80 * 4} step={80} /></span>
            </h1>
            <WatchDemoButton id="full" label="Watch the full demo" className="watch-demo-hero" thumb />
            <p className="home-what">Coordinate IFC and STEP models: find the clashes, review fixes the geometry has checked,
              and report what was decided.</p>
          </div>
          <div className="home-art" aria-hidden="true">
            <Suspense fallback={<div className="hero-glass home-glass"><img className="hero-glass-still" src={HERO_POSTER} alt="" /></div>}>
              <HeroGlass className="home-glass" track={heroArea} />
            </Suspense>
          </div>
        </div>
        <button type="button" className="home-cue" aria-label="Down to start" onClick={toTiles}><ArrowDown size={16} /></button>
      </header>

      <div className="home-body">
        {resume && (
          <div className="home-resume" role="region" aria-label="Your last session">
            <span className="home-resume-icon" aria-hidden><History size={16} /></span>
            <p className="home-resume-text">
              Resume <b>{resume.sample ? "the sample building" : projectName(resume.files)}</b>
              {resume.sample && <> <SamplePill /></>}
              {resume.fixed ? ` · ${plural(resume.fixed, "fix", "fixes")} kept` : ""}
              {resume.clashes != null ? ` · ${plural(resume.clashes, "clash", "clashes")}` : ""}
              {` · saved ${whenText(resume.savedAt, now)}`}</p>
            <span className="home-resume-actions">
              <button type="button" className="btn primary small" onClick={resume.onResume}>Resume</button>
              <button type="button" className="btn ghost small" onClick={resume.onFresh}>Start fresh</button>
            </span>
          </div>)}
        {/* The demos first (owner, 23 Nov: "before these [the start tiles], the demo videos in one single line") */}
        <WatchDemos />

        <section className="home-tiles" aria-label="Start" style={{ "--tiles": tiles } as CSSProperties}>
          <button type="button" className="home-tile home-tile-new" data-start="new-project" onClick={onNewProject}>
            <span className="home-tile-icon" aria-hidden><Plus size={20} /></span>
            <span className="home-tile-text"><span className="home-tile-title">New project</span>
              <span className="home-tile-line">Import your IFC or STEP models and check them for clashes.</span></span>
          </button>
          {onSample && (
            <div className="home-tile-wrap">
              <button type="button" className="home-tile" data-start="sample" disabled={anyBusy} aria-busy={sampleBusy || undefined}
                onClick={onSample}>
                <span className="home-tile-icon" aria-hidden>{sampleBusy ? <i className="spinner" /> : <Building2 size={20} />}</span>
                <span className="home-tile-text"><span className="home-tile-title">Try the sample building</span>
                  <span className="home-tile-line">A sample building's models, opened on their clash review. Nothing to upload.</span></span>
              </button>
              <WatchDemoButton id="3d" />
            </div>)}
          {onSampleDrawings && (
            <div className="home-tile-wrap">
              <button type="button" className="home-tile" data-start="sample-drawings" disabled={anyBusy}
                aria-busy={sampleDrawingsBusy || undefined} onClick={onSampleDrawings}>
                <span className="home-tile-icon" aria-hidden>{sampleDrawingsBusy ? <i className="spinner" /> : <FileText size={20} />}</span>
                <span className="home-tile-text"><span className="home-tile-title">Try the sample drawings</span>
                  <span className="home-tile-line">Its PDF sheets, read by AI and compared with the 3D model.</span></span>
              </button>
              <WatchDemoButton id="2d" />
            </div>)}
        </section>

        <HowIrisWorks onStep={onSampleStep} />

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
                      {isSample(p) && <SamplePill />}
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
              <MarkBadge size={40} className="home-recent-art" />
              <p>No projects yet. A project keeps your models, checks and decisions together.</p>
              <button type="button" className="home-textbtn" onClick={onNewProject}>Create one</button>
            </div>
          )}
          {recentLoading && !shown.length && <span className="home-sr" role="status">Loading your projects…</span>}
        </section>
      </div>
    </div>
  );
}
