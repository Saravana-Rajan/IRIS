import { Brain, Radar } from "lucide-react";
import "./coordination.css";
import { CLASS_INFO, CLASSES, SEVERITY_LABEL, STATUS_INFO, type ClashClass, type ClashStatus, type CoordinationFilter,
  type CoordinationSummary, type overview } from "./coordination";

/** The coordination overview (docs/engineer-workflow.md, step 4): every clash on the list by class, by triage
 * severity (AI-assessed) and by where it stands, each number a filter on the list. Props only: App aggregates with
 * `overview` and owns the filter. The detector's touching and meant-to-meet pairs are counts only: they have no rows. */
export function CoordinationOverview({ summary: s, onFilter, onRunChecks, onTriage, triaged }: {
  summary: ReturnType<typeof overview>;
  onFilter: (f: CoordinationFilter) => void;
  onRunChecks: () => void;   // run the kept checks again (proves kept fixes; refreshes the counts)
  onTriage: () => void;      // triage the clashes not read yet
  triaged: boolean;          // a triage has run (or is following one) for this list
}) {
  const unread = s.total - s.triaged;
  const severities = (["high", "medium", "low"] as const).map((k) => s.bySeverity[k]);
  const assessed = severities.reduce((a, b) => a + b, 0) + s.bySeverity.none;
  if (s.total === 0) return (
    <section className="coord empty" aria-label="Coordination overview">
      <Head s={s} onRunChecks={onRunChecks} />
      <p className="coord-empty">{s.checks
        ? <>No clashes on the list from the last run.</>
        : <>No checks have run on the open models yet.</>}</p>
      {s.checks > 0 && <p className="hint small">{countOnly(s.touchingCount, "touching pair")} and {countOnly(s.meantToMeetCount, "pair")} meant to
        meet were set aside by the detector's rules{s.resolvedByGeometry ? `; ${s.resolvedByGeometry} resolved since the run before` : ""}.</p>}
    </section>);
  return (
    <section className="coord" aria-label="Coordination overview">
      <Head s={s} onRunChecks={onRunChecks} />
      <div className="coord-totals">
        <Total n={s.total} label={s.total === 1 ? "clash" : "clashes"} tip="Show every clash" onClick={() => onFilter({})} />
        <Total n={s.byStatus.open} label="open" tip="Show the open clashes" onClick={() => onFilter({ status: "open" })} />
        <Total n={s.byClass.actual} label="actual" tone="bad" tip="Show the actual clashes" onClick={() => onFilter({ cls: "actual" })} />
        <Total n={s.triaged} label={`of ${s.total.toLocaleString()} triaged`} tip={unread ? `${unread.toLocaleString()} not triaged yet` : "Every clash has a triage reading"} />
      </div>

      <Group title="Class" note={triaged ? "From triage and the measure" : "From the measure and test type only: not triaged yet"}>
        {CLASSES.map((k) => <ClassRows key={k} k={k} s={s} onFilter={onFilter} />)}
      </Group>

      <Group title="Severity" badge="AI-assessed (triage)"
        note={triaged ? "The triage model's reading, not a measure" : undefined}>
        {!triaged ? <div className="coord-untriaged">
          <p>Not triaged yet: no severity is shown until triage has read the clashes.</p>
          <button type="button" className="btn small primary" onClick={onTriage}><Brain size={14} aria-hidden /> Triage all</button>
        </div> : <>
          {(["high", "medium", "low"] as const).map((k) => (
            <Row key={k} label={SEVERITY_LABEL[k]} n={s.bySeverity[k]} total={s.total} tone={k === "high" ? "bad" : k === "medium" ? "warn" : ""}
              onClick={() => onFilter({ severity: k })} what={`${SEVERITY_LABEL[k]} severity`} />))}
          <Row label="None" n={s.bySeverity.none} total={s.total} tone="muted" sub="Read as no problem to fix"
            onClick={() => onFilter({ severity: "none" })} what="No severity" />
          {s.total - assessed > 0 && <p className="coord-foot">{(s.total - assessed).toLocaleString()} without a severity
            {unread ? <> · <button type="button" className="coord-link" onClick={onTriage}>Triage the {unread.toLocaleString()} not read</button></> : null}</p>}
        </>}
      </Group>

      <Group title="Status">
        <StatusRow k="open" s={s} onFilter={onFilter} />
        <StatusRow k="fix_kept_pending_recheck" s={s} onFilter={onFilter}
          sub={s.byStatus.fix_kept_pending_recheck ? <>Not proven until the check runs again · <button type="button" className="coord-link" onClick={onRunChecks}>Run checks again</button></> : undefined} />
        <div className="coord-row">
          <span className="coord-label">{STATUS_INFO.resolved_geometry.label}
            <span className="coord-sub">{s.resolvedByGeometry == null
              ? s.checks ? "No check has run again yet" : "Imported report: Iris has not checked it"
              : "Gone from the latest re-run, so no longer on the list"}</span>
            {s.byStatus.resolved_geometry > 0 && <button type="button" className="coord-link" onClick={() => onFilter({ status: "resolved_geometry" })}>
              {s.byStatus.resolved_geometry.toLocaleString()} still listed by a check not run again</button>}</span>
          <span className="coord-n ok static" data-tip={STATUS_INFO.resolved_geometry.tip} data-tip-side="left">{s.resolvedByGeometry == null ? "—" : s.resolvedByGeometry.toLocaleString()}</span>
        </div>
        <StatusRow k="reviewed_by_design" s={s} onFilter={onFilter} />
        <StatusRow k="sent_to_author" s={s} onFilter={onFilter} />
      </Group>
    </section>
  );
}

function Head({ s, onRunChecks }: { s: CoordinationSummary; onRunChecks: () => void }) {
  return (
    <div className="coord-head">
      <div><h3>Coordination</h3>
        <span className="coord-sub">{s.checks ? `${s.checks} kept check${s.checks === 1 ? "" : "s"}` : "Imported report: no checks run by Iris"}</span></div>
      <button type="button" className="btn small ghost" onClick={onRunChecks}><Radar size={14} aria-hidden /> {s.checks ? "Run checks again" : "Run checks"}</button>
    </div>
  );
}

const countOnly = (n: number | null, what: string) => n == null ? `no count of ${what}s` : `${n.toLocaleString()} ${what}${n === 1 ? "" : "s"}`;

function Total({ n, label, tip, tone = "", onClick }: { n: number; label: string; tip: string; tone?: string; onClick?: () => void }) {
  const body = <><b className={tone}>{n.toLocaleString()}</b><span>{label}</span></>;
  return onClick
    ? <button type="button" className="coord-total" data-tip={tip} data-tip-side="bottom" onClick={onClick} disabled={!n}>{body}</button>
    : <span className="coord-total static" data-tip={tip} data-tip-side="bottom">{body}</span>;
}

function Group({ title, badge, note, children }: { title: string; badge?: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="coord-group" role="group" aria-label={title}>
      <h4>{title}{badge && <span className="chip small accent">{badge}</span>}</h4>
      {note && <p className="coord-note">{note}</p>}
      {children}
    </div>
  );
}

/** One count that filters the list: its label, its share of the list as a bar, and the number. */
function Row({ label, n, total, tone = "", sub, onClick, what }: {
  label: string; n: number; total: number; tone?: string; sub?: React.ReactNode; onClick: () => void; what: string;
}) {
  const share = total ? Math.round((n / total) * 1000) / 10 : 0;
  return (
    <div className="coord-row">
      <span className="coord-label">{label}{sub && <span className="coord-sub">{sub}</span>}</span>
      <span className="coord-bar" aria-hidden><i className={tone} style={{ width: `${share}%` }} /></span>
      <button type="button" className={`coord-n ${tone}`} disabled={!n} onClick={onClick}
        aria-label={`Show ${what}: ${n.toLocaleString()}`}>{n.toLocaleString()}</button>
    </div>
  );
}

/** A count with no rows behind it (the detector set those pairs aside): shown, never a filter. */
function CountOnly({ label, n, tip }: { label: string; n: number | null; tip: string }) {
  return (
    <div className="coord-row count-only">
      <span className="coord-label">{label}<span className="chip small">count only</span></span>
      <span className="coord-n static" data-tip={n == null ? "An imported report gives no detector coverage" : tip} data-tip-side="left">
        {n == null ? "—" : n.toLocaleString()}</span>
    </div>
  );
}

function ClassRows({ k, s, onFilter }: { k: ClashClass; s: CoordinationSummary; onFilter: (f: CoordinationFilter) => void }) {
  const info = CLASS_INFO[k];
  const pending = k !== "untriaged" ? s.untriagedByClass[k] : 0;
  const row = <Row label={info.label} n={s.byClass[k]} total={s.total} tone={info.tone} onClick={() => onFilter({ cls: k })}
    what={info.label} sub={pending ? `${pending.toLocaleString()} not triaged yet` : undefined} />;
  if (k === "touching") return <>{row}<CountOnly label="Touching pairs set aside" n={s.touchingCount}
    tip="Pairs the detector found only touching (within the tolerance): counted, never reported" /></>;
  if (k === "by_design") return <>{row}<CountOnly label="Meant to meet (detector rules)" n={s.meantToMeetCount}
    tip="Pairs a rule set aside before measuring: joined by ports, one assembly, a door in its wall, not physical, same element" /></>;
  return row;
}

function StatusRow({ k, s, onFilter, sub }: { k: ClashStatus; s: CoordinationSummary; onFilter: (f: CoordinationFilter) => void; sub?: React.ReactNode }) {
  const info = STATUS_INFO[k];
  return <Row label={info.label} n={s.byStatus[k]} total={s.total} tone={k === "open" ? "" : k === "fix_kept_pending_recheck" ? "warn" : "muted"}
    sub={sub} onClick={() => onFilter({ status: k })} what={info.label} />;
}
