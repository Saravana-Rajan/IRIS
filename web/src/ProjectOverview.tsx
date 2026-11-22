import { ArrowRight, ChevronRight, Save, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PROJECT_STEPS, ownClick, stepBeside, type Step } from "./projectRoute";
import {
  REVIEW_LABEL, closedText, fullTime, knownCounts, lastSaved, modelMix, nextAction, plural, projectReportUrl, reviewTally, sizeText, whenText,
  type ActivityItem, type CoordCounts, type Project, type ReviewStatus,
} from "./projectsApi";
import "./projects.css";

/** How long "Saved ✓" (and a failed save's "Not saved") stays on the button before it reads "Save" again. */
export const SAVED_MS = 2000;
const NOT_SAVED_MS = 5000;

/**
 * The project's Save button (the overview's header and the workspace's step bar). It says how the save went: "Saving…"
 * while it runs, "Saved ✓" for about two seconds after, or "Not saved" (the reason in its tip) when `onSave` resolves
 * `false` or throws.
 */
export function SaveButton({ onSave, saving = false, disabled = false, tip }: {
  onSave(): Promise<boolean | void> | boolean | void;
  saving?: boolean;          // a save started elsewhere (App's project work)
  disabled?: boolean;
  tip: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const timer = useRef(0);
  useEffect(() => () => { window.clearTimeout(timer.current); }, []);
  async function save() {
    window.clearTimeout(timer.current);
    setState("saving");
    let next: "saved" | { error: string };
    try { next = (await onSave()) === false ? { error: "The project was not saved: see the message, then try again." } : "saved"; }
    catch (e) { next = { error: `The project was not saved: ${(e as Error).message}` }; }
    setState(next);
    timer.current = window.setTimeout(() => setState("idle"), next === "saved" ? SAVED_MS : NOT_SAVED_MS);
  }
  const busy = saving || state === "saving";
  const failed = typeof state === "object" ? state.error : null;
  return (
    <button type="button" className={`btn small${failed ? " danger" : ""}`} onClick={() => void save()} disabled={busy || disabled}
      data-tip={failed ?? tip} data-tip-side="bottom" aria-live="polite">
      {busy ? <><span className="spinner" aria-hidden /> Saving…</>
        : state === "saved" ? <>Saved <span className="ok" aria-hidden>✓</span></>
        : failed ? "Not saved"
        : <><Save size={14} aria-hidden /> Save</>}
    </button>
  );
}

/**
 * The project's step bar: Overview · Models · Coordination · Clash review · Reports · Activity. Shown above the
 * project overview and, by App, above the workspace; `#project/<pid>/<step>` follows it (projectRoute.ts). Left and
 * right arrow keys move between steps. Counts on a step come from what is passed: models and reports from `project`,
 * open clashes from `counts`.
 */
export function ProjectSteps({ step, onStep, project, counts, onProjects, actions, hrefOf, projectsHref }: {
  step: Step;
  onStep(step: Step): void;
  project?: Pick<Project, "name" | "files" | "reports"> | null;
  counts?: CoordCounts | null;
  onProjects?(): void;      // "Projects" crumb back to the list
  actions?: ReactNode;      // controls at the right end (Save, Open workspace…)
  /** Each step's address: the steps are then links (a new tab opens one), a plain click handled by `onStep`. */
  hrefOf?: (step: Step) => string;
  projectsHref?: string;
}) {
  const buttons = useRef<Partial<Record<Step, HTMLElement | null>>>({});
  const badge: Partial<Record<Step, { n: number; tone?: "open" }>> = {
    ...(project?.files.length ? { models: { n: project.files.length } } : {}),
    ...(counts && counts.open > 0 ? { clash: { n: counts.open, tone: "open" as const } } : {}),
    ...(project?.reports.length ? { reports: { n: project.reports.length } } : {}),
  };
  function key(e: KeyboardEvent<HTMLElement>) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const s = stepBeside(step, d);
    onStep(s);
    buttons.current[s]?.focus();
  }
  return (
    <div className="proj-stepbar">
      {(onProjects || project) && (
        <div className="proj-crumbs">
          {onProjects && <>
            {projectsHref
              ? <a className="proj-crumb" href={projectsHref} onClick={(e) => { if (!ownClick(e)) return; e.preventDefault(); onProjects(); }}>Projects</a>
              : <button type="button" className="proj-crumb" onClick={onProjects}>Projects</button>}
            <ChevronRight size={13} aria-hidden className="proj-crumb-sep" />
          </>}
          {project && <b className="proj-crumb-name" title={project.name}>{project.name || "Untitled project"}</b>}
        </div>
      )}
      <nav className="proj-steps" aria-label="Project steps">
        {PROJECT_STEPS.map((s) => {
          const b = badge[s.id];
          const body = <>{s.label}{b && <span className={`proj-step-n${b.tone ? ` ${b.tone}` : ""}`}>{b.n}</span>}</>;
          const common = { className: `proj-step${s.id === step ? " on" : ""}`, "aria-current": s.id === step ? "page" as const : undefined,
            onKeyDown: key };
          return hrefOf
            ? <a key={s.id} {...common} ref={(el) => { buttons.current[s.id] = el; }} href={hrefOf(s.id)}
              onClick={(e) => { if (!ownClick(e)) return; e.preventDefault(); onStep(s.id); }}>{body}</a>
            : <button key={s.id} type="button" {...common} ref={(el) => { buttons.current[s.id] = el; }} onClick={() => onStep(s.id)}>{body}</button>;
        })}
      </nav>
      {actions && <div className="proj-stepbar-actions">{actions}</div>}
    </div>
  );
}

/**
 * One project (`#project/<pid>/<step>`): the step bar, then the step's body. Overview shows the models, the
 * coordination numbers (unresolved against resolved), the review decisions, the reports, recent activity and the next
 * step, decided from the project's real state. Reports and Activity are full lists here; Models, Coordination and
 * Clash review show what the project holds and send the engineer to the workspace, where that work happens.
 */
export function ProjectOverview({ project, step, onStep, counts, reports, activity = [], onImport, onOpenWorkspace,
  onSave, saving, onProjects, children, stepHref, projectsHref }: {
  project: Project;
  step: Step;
  onStep(step: Step): void;
  counts?: CoordCounts | null;           // the open page's numbers; else the project's last known are shown, labelled
  reports: Project["reports"];
  activity?: ActivityItem[];
  onImport(): void;
  onOpenWorkspace(): void;
  /** Resolves `false` (or throws) when the project was not saved: the button then says so. */
  onSave(): Promise<boolean | void> | boolean | void;
  saving?: boolean;
  onProjects?(): void;
  /** More for the step shown, after its own body (App: building a report on Reports, the decisions on Activity). */
  children?: ReactNode;
  /** The steps' and the projects' addresses (the step bar's links). */
  stepHref?: (step: Step) => string;
  projectsHref?: string;
}) {
  const known = knownCounts(project, counts);
  const view = { ...project, reports };
  const saved = lastSaved(project);
  const hasModels = project.files.length > 0;
  const actions = (
    <>
      <SaveButton onSave={onSave} saving={saving} disabled={!hasModels}
        tip={hasModels ? "Save the edited models, journal and decisions as a new saved state" : "Import models first"} />
      <button type="button" className="btn primary small" onClick={hasModels ? onOpenWorkspace : onImport}>
        {hasModels ? <>Open workspace <ArrowRight size={14} aria-hidden /></> : <><Upload size={14} aria-hidden /> Import models</>}
      </button>
    </>
  );

  return (
    <div className="proj-page">
      <ProjectSteps step={step} onStep={onStep} project={view} counts={known?.counts} onProjects={onProjects} actions={actions}
        hrefOf={stepHref} projectsHref={projectsHref} />
      <div className="proj-scroll">
        <div className="proj-body">
          <header className="proj-headrow">
            <div className="proj-title">
              <h1>{project.name || "Untitled project"}</h1>
              <p className="proj-meta">
                <span title={fullTime(project.created)}>Created {whenText(project.created)}</span>
                <span title={fullTime(project.updated)}>Updated {whenText(project.updated)}</span>
                {saved
                  ? <span title={fullTime(saved.at)}>Saved state {saved.n}, {whenText(saved.at)} ({plural(saved.edits, "edit")})</span>
                  : <span>Not saved yet</span>}
              </p>
            </div>
          </header>

          {step === "overview" && <>
            <NextStep project={view} counts={known?.counts ?? null} onImport={onImport} onOpenWorkspace={onOpenWorkspace} onStep={onStep} />
            <div className="proj-grid">
              <div className="proj-col">
                <ModelsCard project={project} onImport={onImport} />
                <ReportsCard pid={project.id} reports={reports} limit={5} onAll={() => onStep("reports")} />
              </div>
              <div className="proj-col">
                <CoordinationCard project={project} known={known} onOpenWorkspace={onOpenWorkspace} onMore={() => onStep("coordination")} />
                <ActivityCard activity={activity} limit={6} onAll={() => onStep("activity")} />
              </div>
            </div>
          </>}

          {step === "models" && <ModelsCard project={project} onImport={onImport} />}

          {step === "coordination" && (
            <CoordinationCard project={project} known={known} onOpenWorkspace={onOpenWorkspace} />
          )}

          {step === "clash" && (
            <Card title="Clash review">
              <p className="proj-text">Each clash opens in the workspace in 3D, with its structured header, the AI's proposals and
                their geometry validation. Decisions made there are recorded on the project.</p>
              <Tally known={known} />
              <div className="proj-card-foot">
                <button type="button" className="btn primary small" disabled={!hasModels} onClick={onOpenWorkspace}>
                  Open workspace <ArrowRight size={14} aria-hidden /></button>
              </div>
            </Card>
          )}

          {step === "reports" && (
            <ReportsCard pid={project.id} reports={reports} footer={hasModels && (
              <div className="proj-card-foot">
                <span className="hint">PDF and BCF reports are exported from the clash review in the workspace.</span>
                <button type="button" className="btn small" onClick={onOpenWorkspace}>Open workspace <ArrowRight size={14} aria-hidden /></button>
              </div>
            )} />
          )}

          {step === "activity" && <>
            <ActivityCard activity={activity} />
            <SavedCard project={project} />
          </>}

          {children}
        </div>
      </div>
    </div>
  );
}

function Card({ title, count, aside, children }: { title: string; count?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="proj-card" aria-labelledby={id}>
      <div className="proj-card-head">
        <h2 id={id}>{title}{count != null && <span className="proj-count">{count}</span>}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function NextStep({ project, counts, onImport, onOpenWorkspace, onStep }: {
  project: Pick<Project, "files" | "reports">; counts: CoordCounts | null;
  onImport(): void; onOpenWorkspace(): void; onStep(step: Step): void;
}) {
  const next = nextAction(project, counts);
  const go = () => {
    if (next.kind === "import") onImport();
    else if (next.kind === "detect") onOpenWorkspace();
    else onStep(next.step);
  };
  return (
    <section className={`proj-next ${next.kind}`} aria-label="Next step">
      <div className="proj-next-text">
        <span className="proj-eyebrow">Next step</span>
        <b>{next.title}</b>
        <span className="proj-text">{next.detail}</span>
      </div>
      <button type="button" className="btn primary small" onClick={go}>{next.action} <ArrowRight size={14} aria-hidden /></button>
    </section>
  );
}

function ModelsCard({ project, onImport }: { project: Project; onImport(): void }) {
  const mix = modelMix(project.files);
  const total = project.files.reduce((s, f) => s + (f.size || 0), 0);
  return (
    <Card title="Models" count={project.files.length || undefined}
      aside={mix.length > 0 && <span className="proj-sub">{mix.map((k) => `${k.n} ${k.kind}`).join(" · ")} · {sizeText(total)}</span>}>
      {project.files.length ? (
        <table className="proj-mini">
          <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col" className="num">Size</th><th scope="col" className="proj-hash">SHA-256</th></tr></thead>
          <tbody>
            {project.files.map((f) => (
              <tr key={`${f.name}|${f.sha256}`}>
                <td className="proj-file" title={f.name}>{f.name}</td>
                <td><span className="chip small">{f.kind}</span></td>
                <td className="num mono">{sizeText(f.size)}</td>
                <td className="mono proj-hash" title={f.sha256}>{f.sha256.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="proj-text proj-empty-line">No models yet. Import the IFC or STEP models to coordinate: structure, services and
          architecture together.</p>
      )}
      <div className="proj-card-foot">
        <button type="button" className="btn small" onClick={onImport}><Upload size={14} aria-hidden /> Import models</button>
      </div>
    </Card>
  );
}

/** Unresolved against resolved: open, resolved by geometry and reviewed (by design, sent to author), as one bar. */
function Tally({ known }: { known: ReturnType<typeof knownCounts> }) {
  if (!known) return <p className="proj-text proj-empty-line">Not checked yet. Run the clash tests in the workspace; the numbers appear here.</p>;
  const c = known.counts;
  if (!c.clashes) return <p className="proj-text"><span className="pchip resolved">No clashes</span> The last check found none.</p>;
  const total = Math.max(c.clashes, c.open + c.resolved + c.reviewed) || 1;
  const pct = (n: number) => `${(100 * n) / total}%`;
  const closed = c.resolved + c.reviewed;
  return (
    <div className="proj-tally">
      <dl className="proj-stats">
        <div><dt>Clashes</dt><dd className="proj-num">{c.clashes}</dd></div>
        <div className="open"><dt>Unresolved</dt><dd className="proj-num">{c.open}</dd></div>
        <div className="resolved"><dt>Resolved</dt><dd className="proj-num">{c.resolved}</dd></div>
        <div className="reviewed"><dt>Reviewed</dt><dd className="proj-num">{c.reviewed}</dd></div>
      </dl>
      <div className="proj-bar" role="img"
        aria-label={`${c.open} unresolved, ${c.resolved} resolved, ${c.reviewed} reviewed of ${c.clashes}`}>
        {c.resolved > 0 && <span className="resolved" style={{ width: pct(c.resolved) }} />}
        {c.reviewed > 0 && <span className="reviewed" style={{ width: pct(c.reviewed) }} />}
        {c.open > 0 && <span className="open" style={{ width: pct(c.open) }} />}
      </div>
      <p className="proj-sub">
        {closedText(closed, total)} · {known.live ? "from the open session" : "last known, as of the last session"}
      </p>
    </div>
  );
}

const REVIEW_ORDER: ReviewStatus[] = ["open", "resolved", "by_design", "author"];
const REVIEW_TONE: Record<ReviewStatus, string> = { open: "open", resolved: "resolved", by_design: "reviewed", author: "reviewed" };

function CoordinationCard({ project, known, onOpenWorkspace, onMore }: {
  project: Project; known: ReturnType<typeof knownCounts>; onOpenWorkspace(): void; onMore?(): void;
}) {
  const tally = reviewTally(project.reviews);
  const recorded = REVIEW_ORDER.reduce((s, k) => s + tally[k], 0);
  return (
    <Card title="Coordination" aside={onMore && known && <button type="button" className="proj-link" onClick={onMore}>Details</button>}>
      <Tally known={known} />
      {recorded > 0 && (
        <div className="proj-reviews">
          <h3>Review decisions <span className="proj-count">{recorded}</span></h3>
          <ul>
            {REVIEW_ORDER.filter((k) => tally[k] > 0).map((k) => (
              <li key={k}><span className={`pchip ${REVIEW_TONE[k]}`}>{REVIEW_LABEL[k]}</span><span className="proj-num">{tally[k]}</span></li>
            ))}
          </ul>
        </div>
      )}
      {!known && project.files.length > 0 && (
        <div className="proj-card-foot">
          <button type="button" className="btn small" onClick={onOpenWorkspace}>Open workspace <ArrowRight size={14} aria-hidden /></button>
        </div>
      )}
    </Card>
  );
}

function ReportsCard({ pid, reports, limit, onAll, footer }: {
  pid: string; reports: Project["reports"]; limit?: number; onAll?(): void; footer?: ReactNode;
}) {
  const sorted = [...reports].sort((a, b) => b.at - a.at);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <Card title="Reports" count={reports.length || undefined}
      aside={onAll && limit && reports.length > limit && <button type="button" className="proj-link" onClick={onAll}>All {reports.length}</button>}>
      {shown.length ? (
        <ul className="proj-list">
          {shown.map((r) => (
            <li key={`${r.doc_id}|${r.kind}|${r.at}`}>
              <span className="chip small">{r.kind.toUpperCase()}</span>
              <a className="proj-list-text proj-report" href={projectReportUrl(pid, r.doc_id)} title={`Download ${r.name}`}
                download>{r.name}</a>
              <span className="proj-when mono" title={fullTime(r.at)}>{whenText(r.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="proj-text proj-empty-line">No reports yet. PDF and BCF reports made from the clash review are listed here.</p>
      )}
      {footer}
    </Card>
  );
}

function ActivityCard({ activity, limit, onAll }: { activity: ActivityItem[]; limit?: number; onAll?(): void }) {
  const sorted = [...activity].sort((a, b) => b.at - a.at);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <Card title={limit ? "Recent activity" : "Activity"} count={activity.length || undefined}
      aside={onAll && limit && activity.length > limit && <button type="button" className="proj-link" onClick={onAll}>All {activity.length}</button>}>
      {shown.length ? (
        <ul className="proj-list">
          {shown.map((a, i) => (
            <li key={`${a.at}|${i}`}>
              <span className="proj-when mono" title={fullTime(a.at)}>{whenText(a.at)}</span>
              <span className="proj-list-text">{a.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="proj-text proj-empty-line">No activity recorded yet. Imports, checks, decisions and saves are listed here.</p>
      )}
    </Card>
  );
}

function SavedCard({ project }: { project: Project }) {
  const saved = [...project.saved].sort((a, b) => b.n - a.n);
  return (
    <Card title="Saved states" count={saved.length || undefined}>
      {saved.length ? (
        <table className="proj-mini">
          <thead><tr><th scope="col" className="num">#</th><th scope="col">Saved</th><th scope="col" className="num">Edits</th><th scope="col">Files</th></tr></thead>
          <tbody>
            {saved.map((s) => (
              <tr key={s.n}>
                <td className="num mono">{s.n}</td>
                <td title={fullTime(s.at)}>{whenText(s.at)}</td>
                <td className="num mono">{s.edits}</td>
                <td className="proj-file" title={s.files.join(", ")}>{s.files.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="proj-text proj-empty-line">Not saved yet. Saving keeps the edited models, the edit journal and the decisions; reopening
          the project starts from the latest saved state.</p>
      )}
    </Card>
  );
}
