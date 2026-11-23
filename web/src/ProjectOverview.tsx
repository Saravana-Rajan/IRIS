import { ArrowRight, Save, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { CountUp, EmptyState } from "./Holo";
import { PageHeader, type Crumb } from "./PageHeader";
import { ownClick, stepLabel, type Step } from "./projectRoute";
import {
  REVIEW_LABEL, closedText, fullTime, knownCounts, lastSaved, modelMix, nextAction, plural, projectReportUrl, reviewTally, sizeText, toMs, whenText,
  type ActivityItem, type CoordCounts, type Project, type ReviewStatus,
} from "./projectsApi";
import { STATE_LABEL, decisionWords, type Decision } from "./proposalState";
import "./projects.css";

type Known = ReturnType<typeof knownCounts>;

/** How long "Saved ✓" (and a failed save's "Not saved") stays on the button before it reads "Save" again. */
export const SAVED_MS = 2000;
const NOT_SAVED_MS = 5000;

/**
 * The project's Save button (the overview's header, the workspace's header). It says how the save went: "Saving…"
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
 * One project (`/projects/<pid>/<step>`), inside the app shell: the shell's sidebar holds the steps and its top bar the
 * page's primary action, so this page is the header (breadcrumb, title, the project's dates, Save) and the step's body.
 * Overview: four stat cards (models, clashes, open, resolved), the models and the coordination tally on the left, the
 * next step (decided from the project's real state) and recent activity on the right. Reports and Activity are full
 * lists here (Activity: the activity, the saved states and, when `decisions` is given, the decisions); Models,
 * Coordination and Clash review are drawn by the workspace, with a simple body here as a fallback.
 * `children` (App's cards for the step) follow the step's body.
 */
export function ProjectOverview({ project, step, onStep, counts, reports, activity = [], decisions, onImport, onOpenWorkspace,
  onSave, saving, onProjects, children, stepHref, projectsHref }: {
  project: Project;
  step: Step;
  onStep(step: Step): void;
  counts?: CoordCounts | null;           // the open page's numbers; else the project's last known are shown, labelled
  reports: Project["reports"];
  activity?: ActivityItem[];
  /** The open session's decisions, for the Activity page's Decisions card; `null` when the models are not open (the
   *  decisions come back with them). Left out, there is no Decisions card. */
  decisions?: Decision[] | null;
  onImport(): void;
  onOpenWorkspace(): void;
  /** Resolves `false` (or throws) when the project was not saved: the button then says so. */
  onSave(): Promise<boolean | void> | boolean | void;
  saving?: boolean;
  onProjects?(): void;
  /** More for the step shown, after its own body (App: drawings, building a report, the decisions, the edit log). */
  children?: ReactNode;
  /** The steps' and the projects' addresses (the breadcrumb's and the "View all" links). */
  stepHref?: (step: Step) => string;
  projectsHref?: string;
}) {
  const known = knownCounts(project, counts);
  const view = { ...project, reports };
  const saved = lastSaved(project);
  const hasModels = project.files.length > 0;
  const name = project.name || "Untitled project";
  const overview = step === "overview";

  const crumbs: Crumb[] = [
    ...(onProjects || projectsHref ? [{ label: "Projects", href: projectsHref, onClick: onProjects }] : []),
    overview ? { label: name } : { label: name, href: stepHref?.("overview"), onClick: () => onStep("overview") },
    ...(overview ? [] : [{ label: stepLabel(step) }]),
  ];
  const sub = (
    <span className="proj-meta"><span className="proj-meta-in">
      <span title={fullTime(project.created)}>Created {whenText(project.created)}</span>
      <span title={fullTime(project.updated)}>Updated {whenText(project.updated)}</span>
      {saved
        ? <span title={fullTime(saved.at)}>Saved state {saved.n}, {whenText(saved.at)} ({plural(saved.edits, "edit")})</span>
        : <span>Not saved yet</span>}
    </span></span>
  );
  const actions = (
    <SaveButton onSave={onSave} saving={saving} disabled={!hasModels}
      tip={hasModels ? "Save the edited models, journal and decisions as a new saved state" : "Import models first"} />
  );
  const toStep = (s: Step) => ({ href: stepHref?.(s), go: () => onStep(s) });

  return (
    <div className="proj-page">
      <div className="proj-scroll">
        <div className="proj-body">
          <PageHeader crumbs={crumbs} title={overview ? name : stepLabel(step)} sub={sub} actions={actions} />

          {overview && <div className="proj-overview">
            <StatCards project={project} known={known} />
            <div className="proj-grid">
              <div className="proj-col">
                <ModelsCard project={project} onImport={onImport} />
                {(hasModels || known) && (
                  <CoordinationCard project={project} known={known} onOpenWorkspace={onOpenWorkspace} more={toStep("coordination")} />
                )}
              </div>
              <div className="proj-col">
                <NextStep project={view} counts={known?.counts ?? null} onImport={onImport} onOpenWorkspace={onOpenWorkspace} onStep={onStep} />
                <ActivityCard activity={activity} limit={6} all={toStep("activity")} />
                {reports.length > 0 && <ReportsCard pid={project.id} reports={reports} limit={4} all={toStep("reports")} />}
              </div>
            </div>
          </div>}

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
                <button type="button" className="btn" disabled={!hasModels} onClick={onOpenWorkspace}>
                  Open workspace <ArrowRight size={15} aria-hidden /></button>
              </div>
            </Card>
          )}

          {step === "reports" && (
            <ReportsCard pid={project.id} reports={reports}
              empty={<EmptyState compact title="No reports yet"
                line="PDF and BCF reports made from the clash review are listed here."
                action={hasModels && <button type="button" className="btn primary" onClick={onOpenWorkspace}>
                  Open workspace <ArrowRight size={15} aria-hidden /></button>} />}
              footer={hasModels && reports.length > 0 && (
                <div className="proj-card-foot">
                  <span className="hint">PDF and BCF reports are exported from the clash review in the workspace.</span>
                  <button type="button" className="btn small" onClick={onOpenWorkspace}>Open workspace <ArrowRight size={14} aria-hidden /></button>
                </div>
              )} />
          )}

          {step === "activity" && <>
            <ActivityCard activity={activity} />
            <SavedCard project={project} />
            {decisions !== undefined && <DecisionsCard decisions={decisions} />}
          </>}

          {children}
        </div>
      </div>
    </div>
  );
}

function Card({ title, count, aside, className = "", children }: {
  title: string; count?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`proj-card${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="proj-card-head">
        <h2 id={id}>{title}{count != null && <span className="proj-count">{count}</span>}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** "View all" to a step: a link when the step has an address (a new tab opens it), a plain click to `onStep`. */
function AllLink({ to, label }: { to: { href?: string; go(): void }; label: string }) {
  return to.href
    ? <a className="proj-link" href={to.href} onClick={(e: MouseEvent) => { if (!ownClick(e)) return; e.preventDefault(); to.go(); }}>{label}</a>
    : <button type="button" className="proj-link" onClick={to.go}>{label}</button>;
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** Models, Clashes, Open, Resolved: what is known, and where it comes from; "—" (never 0) for a number not known. */
function StatCards({ project, known }: { project: Project; known: Known }) {
  const mix = modelMix(project.files);
  const c = known?.counts;
  const from = known ? (known.live ? "from the open session" : "last known") : "not checked yet";
  const stats: { key: string; label: string; value: number | null; sub: string; tone?: string }[] = [
    { key: "models", label: "Models", value: project.files.length,
      sub: mix.length ? mix.map((k) => `${k.n} ${k.kind}`).join(" · ") : "none imported yet" },
    { key: "clashes", label: "Clashes", value: c ? c.clashes : null, sub: from },
    { key: "open", label: "Open", value: c ? c.open : null, sub: from, tone: c && c.open > 0 ? "open" : undefined },
    { key: "resolved", label: "Resolved", value: c ? c.resolved : null,
      sub: c && c.reviewed > 0 ? `${from} · ${c.reviewed} reviewed` : from, tone: c && c.resolved > 0 ? "resolved" : undefined },
  ];
  return (
    <ul className="proj-stats" aria-label="Project numbers">
      {stats.map((s) => (
        <li key={s.key} className={`proj-stat ${s.key}${s.tone ? ` tone-${s.tone}` : ""}`}>
          <span className="proj-stat-label">{s.label}</span>
          <span className="proj-stat-value mono">{s.value == null ? <span aria-label="not known">—</span> : <CountUp value={s.value} />}</span>
          <span className="proj-stat-sub">{s.sub}</span>
        </li>
      ))}
    </ul>
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
      <span className="proj-eyebrow">Next step</span>
      <b className="proj-next-title">{next.title}</b>
      <span className="proj-text">{next.detail}</span>
      <div className="proj-next-act">
        <button type="button" className="btn primary" onClick={go}>{next.action} <ArrowRight size={15} aria-hidden /></button>
      </div>
    </section>
  );
}

function ModelsCard({ project, onImport }: { project: Project; onImport(): void }) {
  const mix = modelMix(project.files);
  const total = project.files.reduce((s, f) => s + (f.size || 0), 0);
  if (!project.files.length) {
    return (
      <Card title="Models">
        <EmptyState compact title="No models yet"
          line="Import the IFC or STEP models to coordinate: structure, services and architecture together."
          action={<button type="button" className="btn primary" onClick={onImport}><Upload size={15} aria-hidden /> Import models</button>} />
      </Card>
    );
  }
  return (
    <Card title="Models" count={project.files.length}
      aside={<span className="proj-sub">{mix.map((k) => `${k.n} ${k.kind}`).join(" · ")} · {sizeText(total)}</span>}>
      <table className="proj-mini">
        <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col" className="num">Size</th><th scope="col" className="proj-hash">SHA-256</th></tr></thead>
        <tbody>
          {project.files.map((f) => (
            <tr key={`${f.name}|${f.sha256}`}>
              <td className="proj-file" title={f.name}>{f.name}</td>
              <td><span className="proj-kind">{f.kind}</span></td>
              <td className="num mono">{sizeText(f.size)}</td>
              <td className="mono proj-hash" title={f.sha256}>{f.sha256.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="proj-card-foot">
        <button type="button" className="btn small" onClick={onImport}><Upload size={14} aria-hidden /> Import models</button>
      </div>
    </Card>
  );
}

/** Unresolved against resolved: open, resolved by geometry and reviewed (by design, sent to author), as one bar. */
function Tally({ known }: { known: Known }) {
  if (!known) return <p className="proj-text proj-empty-line">Not checked yet. Run the clash tests in the workspace; the numbers appear here.</p>;
  const c = known.counts;
  if (!c.clashes) return <p className="proj-text proj-tally-none"><span className="pchip clear">No clashes</span> The last check found none.</p>;
  const total = Math.max(c.clashes, c.open + c.resolved + c.reviewed) || 1;
  const pct = (n: number) => `${(100 * n) / total}%`;
  const closed = c.resolved + c.reviewed;
  return (
    <div className="proj-tally">
      <dl className="proj-tally-nums">
        <div><dt>Clashes</dt><dd className="mono">{c.clashes}</dd></div>
        <div className="open"><dt>Unresolved</dt><dd className="mono">{c.open}</dd></div>
        <div className="resolved"><dt>Resolved</dt><dd className="mono">{c.resolved}</dd></div>
        <div className="reviewed"><dt>Reviewed</dt><dd className="mono">{c.reviewed}</dd></div>
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

function CoordinationCard({ project, known, onOpenWorkspace, more }: {
  project: Project; known: Known; onOpenWorkspace(): void; more?: { href?: string; go(): void };
}) {
  const tally = reviewTally(project.reviews);
  const recorded = REVIEW_ORDER.reduce((s, k) => s + tally[k], 0);
  return (
    <Card title="Coordination" aside={more && known && <AllLink to={more} label="Details" />}>
      <Tally known={known} />
      {recorded > 0 && (
        <div className="proj-reviews">
          <h3>Review decisions <span className="proj-count">{recorded}</span></h3>
          <ul>
            {REVIEW_ORDER.filter((k) => tally[k] > 0).map((k) => (
              <li key={k}><span className={`pchip ${REVIEW_TONE[k]}`}>{REVIEW_LABEL[k]}</span><span className="proj-num mono">{tally[k]}</span></li>
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

function ReportsCard({ pid, reports, limit, all, empty, footer }: {
  pid: string; reports: Project["reports"]; limit?: number; all?: { href?: string; go(): void }; empty?: ReactNode; footer?: ReactNode;
}) {
  const sorted = [...reports].sort((a, b) => b.at - a.at);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <Card title={limit ? "Recent reports" : "Reports"} count={reports.length || undefined}
      aside={all && limit && reports.length > limit && <AllLink to={all} label={`View all ${reports.length}`} />}>
      {shown.length ? (
        <ul className="proj-list">
          {shown.map((r) => (
            <li key={`${r.doc_id}|${r.kind}|${r.at}`}>
              <span className="proj-kind">{r.kind.toUpperCase()}</span>
              <a className="proj-list-text proj-report" href={projectReportUrl(pid, r.doc_id)} title={`Download ${r.name}`}
                download>{r.name}</a>
              <span className="proj-when mono" title={fullTime(r.at)}>{whenText(r.at)}</span>
            </li>
          ))}
        </ul>
      ) : empty ?? <p className="proj-text proj-empty-line">No reports yet. PDF and BCF reports made from the clash review are listed here.</p>}
      {footer}
    </Card>
  );
}

function ActivityCard({ activity, limit, all }: { activity: ActivityItem[]; limit?: number; all?: { href?: string; go(): void } }) {
  const sorted = [...activity].sort((a, b) => b.at - a.at);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <Card title={limit ? "Recent activity" : "Activity"} count={activity.length || undefined}
      aside={all && activity.length > 0 && <AllLink to={all} label={activity.length > (limit ?? 0) ? `View all ${activity.length}` : "View all"} />}>
      {shown.length ? (
        <ul className="proj-list proj-activity">
          {shown.map((a, i) => (
            <li key={`${a.at}|${i}`}>
              <span className="proj-dot" aria-hidden />
              <span className="proj-list-text">{a.text}</span>
              <span className="proj-when mono" title={fullTime(a.at)}>{whenText(a.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact title="No activity yet" line="Imports, checks, decisions and saves are listed here." />
      )}
    </Card>
  );
}

/**
 * A decision's time for a narrow column, in one line: "Nov 22, 14:05" in the current year, "Nov 22, 2025" in another,
 * "—" when not known. Always en-US so the column's width holds; the cell's title has the full time. Server seconds or
 * page milliseconds.
 */
export function shortWhen(t: number, now = Date.now()): string {
  const d = new Date(toMs(t));
  if (!Number.isFinite(d.getTime())) return "—";
  return d.getFullYear() === new Date(now).getFullYear()
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SavedCard({ project }: { project: Project }) {
  const saved = [...project.saved].sort((a, b) => b.n - a.n);
  return (
    <Card title="Saved states" count={saved.length || undefined}>
      {saved.length ? (
        <div className="proj-table-scroll"><table className="proj-mini proj-saved-states">
          <colgroup><col className="c-n" /><col className="c-saved" /><col className="c-edits" /><col /></colgroup>
          <thead><tr><th scope="col" className="num">#</th><th scope="col">Saved</th><th scope="col" className="num">Edits</th><th scope="col">Files</th></tr></thead>
          <tbody>
            {saved.map((s) => (
              <tr key={s.n}>
                <td className="num mono">{s.n}</td>
                <td className="proj-clip" title={fullTime(s.at)}>{whenText(s.at)}</td>
                <td className="num mono">{s.edits}</td>
                <td>{s.files.length
                  ? <ul className="proj-files">{s.files.map((f, i) => <li key={`${i}|${f}`}>{f}</li>)}</ul>
                  : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <p className="proj-text proj-empty-line">Not saved yet. Saving keeps the edited models, the edit journal and the decisions; reopening
          the project starts from the latest saved state.</p>
      )}
    </Card>
  );
}

/**
 * The decisions on the open session's proposals, newest first; `null` when the models are not open. The short columns
 * (when, clash, state, decision, reviewer) hold one line at fixed widths, the proposal and why share the rest and wrap;
 * on a narrow screen the table scrolls sideways inside its card.
 */
function DecisionsCard({ decisions }: { decisions: Decision[] | null }) {
  return (
    <Card title="Decisions" count={decisions?.length || undefined}>
      {decisions?.length ? (
        <div className="proj-table-scroll">
          <table className="proj-mini proj-decisions">
            <colgroup>
              <col className="c-when" /><col className="c-clash" /><col /><col className="c-state" /><col className="c-decision" />
              <col className="c-reviewer" /><col />
            </colgroup>
            <thead><tr><th scope="col">When</th><th scope="col">Clash</th><th scope="col">Proposal</th><th scope="col">State</th>
              <th scope="col">Decision</th><th scope="col">Reviewer</th><th scope="col">Why</th></tr></thead>
            <tbody>{[...decisions].reverse().map((d, k) => {
              const at = toMs(d.at);
              const state = STATE_LABEL[d.state] ?? d.state;
              const reviewer = d.reviewer || "not recorded";
              const verb = decisionWords({ ...d, at }).verb;
              return (
                <tr key={`${k}|${d.clash_id}|${d.at}`}>
                  <td className="proj-clip mono" title={fullTime(at)}>{shortWhen(at)}</td>
                  <td className="proj-clip mono" title={d.number ? undefined : d.clash_id}>{d.number ? `#${d.number}` : d.clash_id}</td>
                  <td className="proj-wrap">{d.option.title}</td>
                  <td className="proj-clip" title={state}>{state}</td>
                  <td className="proj-clip" title={verb}>{verb}</td>
                  <td className="proj-clip" title={reviewer}>{reviewer}</td>
                  <td className="proj-wrap">{d.reason ?? ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : (
        <p className="proj-text proj-empty-line">{decisions
          ? "No decisions yet. Accepting, rejecting, modifying or asking for another proposal records one here, with the reviewer and why."
          : "Open the workspace to read the decisions: a saved project's decisions come back with its models."}</p>
      )}
    </Card>
  );
}
