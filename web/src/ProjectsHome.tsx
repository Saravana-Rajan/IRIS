import { ArrowRight, FolderOpen, Plus, TriangleAlert } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ownClick } from "./projectRoute";
import {
  fullTime, lastSaved, modelMix, plural, reviewTally, whenText, type Project,
} from "./projectsApi";
import "./projects.css";

/** The engineer's workflow, in order (docs/engineer-workflow.md): what each step does, in Iris as built. */
export const PROJECT_FLOW = [
  { name: "Import", text: "IFC and STEP models, one row per file, with retry." },
  { name: "Understand", text: "Models summarised by discipline and system." },
  { name: "Detect", text: "Hard, clearance and duplicate tests across every pair." },
  { name: "Investigate", text: "Each clash with its elements, level and distance." },
  { name: "Propose", text: "AI proposes fixes that edit real model elements." },
  { name: "Validate", text: "Geometry re-checks every proposal before you see it." },
  { name: "Review", text: "Accept, reject or ask for another, with a reason." },
  { name: "Report", text: "PDF and BCF with GlobalIds and the decision history." },
] as const;

const NAME_MAX = 120;

/**
 * Projects home (`#projects`): the projects this browser knows, newest first, one row each (models and their kinds,
 * the last known open / resolved numbers, the last save) and an inline form to create one. With none yet, the
 * workflow a project follows and a way into the sample building. Props only: App fetches, creates and routes.
 */
export function ProjectsHome({ projects, loading, error, onCreate, onOpen, onDemo, hrefOf }: {
  projects: Project[];
  loading: boolean;
  error?: string;
  onCreate(name: string): void;
  onOpen(pid: string): void;
  onDemo?(): void;
  /** A project's address: its name and Open are then links (a new tab opens one), a plain click handled by `onOpen`. */
  hrefOf?: (pid: string) => string;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const formId = useId();
  const sorted = [...projects].sort((a, b) => b.updated - a.updated);
  const empty = !loading && !projects.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) { input.current?.focus(); return; }
    onCreate(n.slice(0, NAME_MAX));
    setName("");
  }

  return (
    <div className="proj-page">
      <div className="proj-scroll">
        <div className="proj-body">
          <header className="proj-headrow">
            <div className="proj-title">
              <p className="proj-eyebrow">Iris Engineering</p>
              <h1>Projects</h1>
              <p className="proj-meta">
                {loading && !projects.length ? "Loading…" : plural(projects.length, "project")} in this browser
                {loading && projects.length > 0 && <span className="spinner" aria-label="Refreshing" />}
              </p>
            </div>
            <form className="proj-create" onSubmit={submit} aria-label="Create a project">
              <label htmlFor={`${formId}-n`} className="proj-sr">New project name</label>
              <input id={`${formId}-n`} ref={input} className="proj-input" value={name} maxLength={NAME_MAX}
                placeholder="New project name" autoComplete="off" spellCheck={false}
                onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn primary small" disabled={!name.trim()}>
                <Plus size={14} aria-hidden /> Create project</button>
              {onDemo && !empty && (
                <button type="button" className="btn ghost small" onClick={onDemo}>Open the sample building</button>
              )}
            </form>
          </header>

          {error && (
            <div className="proj-alert" role="alert"><TriangleAlert size={14} aria-hidden /> <span>{error}</span></div>
          )}

          {loading && !projects.length && (
            <div className="proj-loading" aria-live="polite"><span className="spinner" aria-hidden /> Loading projects…</div>
          )}

          {sorted.length > 0 && <ProjectTable projects={sorted} onOpen={onOpen} hrefOf={hrefOf} />}

          {empty && (
            <section className="proj-empty" aria-labelledby={`${formId}-e`}>
              <div className="proj-empty-head">
                <h2 id={`${formId}-e`}>No projects yet</h2>
                <p>A project keeps the models, the coordination results, every review decision and the reports together,
                  so the work can be closed and picked up again. Each project goes through the same steps:</p>
              </div>
              <ol className="proj-flow">
                {PROJECT_FLOW.map((s, i) => (
                  <li key={s.name}><span className="proj-flow-n mono">{i + 1}</span>
                    <b>{s.name}</b><span className="proj-flow-t">{s.text}</span></li>
                ))}
              </ol>
              <div className="proj-empty-actions">
                <button type="button" className="btn primary" onClick={() => input.current?.focus()}>
                  <Plus size={15} aria-hidden /> Create a project</button>
                {onDemo && (
                  <button type="button" className="btn" onClick={onDemo}>
                    <FolderOpen size={15} aria-hidden /> Open the sample building</button>
                )}
              </div>
              <p className="hint">Projects are private to this browser by an unguessable id; there are no accounts yet.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectTable({ projects, onOpen, hrefOf }: { projects: Project[]; onOpen(pid: string): void; hrefOf?: (pid: string) => string }) {
  return (
    <div className="proj-tablewrap">
      <table className="proj-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Models</th>
            <th scope="col">Coordination</th>
            <th scope="col">Last saved</th>
            <th scope="col"><span className="proj-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => <ProjectRow key={p.id} p={p} onOpen={onOpen} hrefOf={hrefOf} />)}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({ p, onOpen, hrefOf }: { p: Project; onOpen(pid: string): void; hrefOf?: (pid: string) => string }) {
  const mix = modelMix(p.files);
  const saved = lastSaved(p);
  const link = hrefOf ? { href: hrefOf(p.id), onClick: (e: MouseEvent) => { if (!ownClick(e)) return; e.preventDefault(); onOpen(p.id); } } : null;
  return (
    <tr>
      <td className="proj-c-name" data-label="Project">
        {link ? <a className="proj-name" {...link}>{p.name || "Untitled project"}</a>
          : <button type="button" className="proj-name" onClick={() => onOpen(p.id)}>{p.name || "Untitled project"}</button>}
        <span className="proj-sub" title={fullTime(p.updated)}>Updated {whenText(p.updated)}</span>
      </td>
      <td data-label="Models">
        {p.files.length ? (
          <span className="proj-cell">
            <span className="proj-num">{p.files.length}</span>
            <span className="proj-kinds">{mix.map((k) => <span key={k.kind} className="chip small">{k.kind} {k.n}</span>)}</span>
          </span>
        ) : <span className="proj-none">No models</span>}
      </td>
      <td data-label="Coordination"><CoordCell p={p} /></td>
      <td data-label="Last saved">
        {saved ? (
          <span className="proj-cell" title={fullTime(saved.at)}>
            {whenText(saved.at)}{saved.edits > 0 && <span className="proj-sub">· {plural(saved.edits, "edit")}</span>}
          </span>
        ) : <span className="proj-none">Not saved</span>}
      </td>
      <td className="proj-c-act">
        {link ? <a className="btn small" {...link} aria-label={`Open ${p.name}`}>Open <ArrowRight size={13} aria-hidden /></a>
          : <button type="button" className="btn small" onClick={() => onOpen(p.id)} aria-label={`Open ${p.name}`}>
            Open <ArrowRight size={13} aria-hidden /></button>}
      </td>
    </tr>
  );
}

/** The last known numbers (as the page last reported them), else the decisions recorded, else nothing claimed. */
function CoordCell({ p }: { p: Project }) {
  const c = p.counts;
  if (c) {
    if (!c.clashes) return <span className="pchip resolved">No clashes</span>;
    return (
      <span className="proj-cell proj-chips">
        {c.open > 0 && <span className="pchip open"><span className="proj-num">{c.open}</span> open</span>}
        {c.resolved > 0 && <span className="pchip resolved"><span className="proj-num">{c.resolved}</span> resolved</span>}
        {c.reviewed > 0 && <span className="pchip reviewed"><span className="proj-num">{c.reviewed}</span> reviewed</span>}
        <span className="proj-sub">of {c.clashes}</span>
      </span>
    );
  }
  const t = reviewTally(p.reviews), decided = t.by_design + t.author + t.resolved;
  if (decided) return <span className="proj-cell"><span className="pchip reviewed"><span className="proj-num">{decided}</span> reviewed</span></span>;
  return <span className="proj-none">{p.files.length ? "Not checked" : "—"}</span>;
}
