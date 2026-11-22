import { Building2, FileText, FolderOpen } from "lucide-react";
import { projectName, type Resume } from "./About";
import { Wordmark } from "./Brand";
import { DemoClips } from "./DemoClips";

/** When a saved session was kept, in words ("12 min ago"). */
function ago(savedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/**
 * The first screen (docs/ui-design.md §10.1): light and lean. Iris's name and principle, two ways in (the projects,
 * and the sample building as a project, opened on its clash review with no live AI call, or on its Drawings step with
 * the sample PDF sheets), and the last session to resume when there is one. No 3D starts until a model opens; the
 * pictures are the two demo clips (DemoClips). Props only.
 */
export function StartScreen({ onProjects, projectsHref = "/projects", onSample, sampleBusy = false, onSampleDrawings, sampleDrawingsBusy = false, resume }: {
  onProjects: () => void;
  /** The projects' address: "Open projects" is a link (a new tab opens it), a plain click handled by `onProjects`. */
  projectsHref?: string;
  /** The Northbank sample as a project, opened on its clash review. Absent when the server lists no sample. */
  onSample?: () => void;
  sampleBusy?: boolean;
  /** The same sample project opened on its Drawings step with the sample PDF sheets attached (their saved Gemini
   * readings replay at no cost). Absent when the server lists no sample drawings. */
  onSampleDrawings?: () => void;
  sampleDrawingsBusy?: boolean;
  resume?: Resume;
}) {
  return (
    <div className="start" onClick={(e) => e.stopPropagation()}>
      <div className="start-col">
        <div className="start-text">
          <p className="start-brand"><Wordmark height={30} /><span>by Techjays</span></p>
          <h1 className="start-line">AI proposes. Geometry proves. The engineer decides.</h1>
          <p className="start-sub">Coordinate IFC and STEP models: find the clashes, review fixes the geometry has checked, and
            report what was decided.</p>
          <div className="start-actions">
            <a className="btn primary" data-start="projects" href={projectsHref}
              onClick={(e) => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onProjects(); }}>
              <FolderOpen size={15} aria-hidden /> Open projects</a>
            {onSample && <button type="button" className="btn" data-start="sample" disabled={sampleBusy || sampleDrawingsBusy} onClick={onSample}>
              {sampleBusy ? <i className="spinner" aria-hidden /> : <Building2 size={15} aria-hidden />} Try the sample building</button>}
            {onSampleDrawings && <button type="button" className="btn" data-start="sample-drawings" disabled={sampleBusy || sampleDrawingsBusy} onClick={onSampleDrawings}>
              {sampleDrawingsBusy ? <i className="spinner" aria-hidden /> : <FileText size={15} aria-hidden />} Try the sample drawings</button>}
          </div>
          {resume && (
            <p className="start-resume">
              <span>Resume <b>{projectName(resume.files)}</b>{resume.fixed ? ` · ${resume.fixed} fix${resume.fixed === 1 ? "" : "es"} kept` : ""}
                {resume.clashes != null ? ` · ${resume.clashes} clash${resume.clashes === 1 ? "" : "es"}` : ""} · saved {ago(resume.savedAt)}</span>
              <button type="button" className="btn small" onClick={resume.onResume}>Resume</button>
              <button type="button" className="btn small ghost" onClick={resume.onFresh}>Start fresh</button>
            </p>)}
        </div>
        <DemoClips />
      </div>
    </div>
  );
}
