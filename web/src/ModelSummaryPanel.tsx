import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { FacetIndex } from "./filters";
import { disciplineLabel, fileMix, mappingOf, ORDER, ruleClasses, summarize, type ModelSummary as Summary } from "./modelSummary";
import "./model-summary.css";

/** Model understanding (docs/engineer-workflow.md, step 3): what the open models contain, by discipline, with each
 * discipline's classes, systems and models a click away, and a click on any row isolating what it counts. Reads the
 * filters' index (`api.facets`); the grouping is `modelSummary.ts`, explained on the page under "How this is grouped". */

export interface ModelSummaryProps {
  /** The filters' index (App's `facetIndex`), or null while it is read or when no models are open. */
  index: FacetIndex | null;
  /** Isolate these elements for now; `label` names the row, and comes back as `isolated` while it holds. */
  onIsolate(ids: string[], label: string): void;
  /** Show everything again. */
  onClear(): void;
  /** The label of the row isolated now, if one is. */
  isolated?: string | null;
}

export function ModelSummary({ index, onIsolate, onClear, isolated = null }: ModelSummaryProps) {
  const summary = useMemo(() => summarize(index), [index]);
  const [open, setOpen] = useState<string[]>([]);
  const onToggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  return <SummaryView summary={summary} ready={!!index} open={open} onToggle={onToggle} onIsolate={onIsolate} onClear={onClear} isolated={isolated} />;
}

export interface SummaryViewProps extends Omit<ModelSummaryProps, "index"> {
  summary: Summary; ready: boolean;
  /** The disciplines shown expanded (by id). */
  open: string[]; onToggle(id: string): void;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
/** A share of the whole, as the table shows it: whole percents, "<1%" for a sliver. */
export const shareText = (n: number, total: number) => (!total || !n ? "" : n / total < 0.01 ? "<1%" : `${Math.round((n / total) * 100)}%`);

/** The summary itself, without state: the page's table (exported for the tests). */
export function SummaryView({ summary, ready, open, onToggle, onIsolate, onClear, isolated = null }: SummaryViewProps) {
  if (!ready) return <div className="msum"><p className="hint">The summary appears once the models' index has been read.</p></div>;
  const { disciplines, files, total } = summary;
  const pick = (ids: string[], label: string) => {
    if (!ids.length) return;
    if (isolated === label) onClear(); else onIsolate(ids, label);
  };
  /** One clickable row: isolates what it counts (or, isolated already, shows everything again). */
  const row = (key: string, kind: "discipline" | "sub" | "model", label: string, name: ReactNode, ids: string[],
    more: { share?: boolean; toggle?: { id: string; open: boolean; what: string }; tag?: ReactNode; mono?: boolean; extra?: ReactNode; mapping?: string } = {}) => {
    const count = ids.length, on = !!count && isolated === label;
    return (
      <tr key={key} className={`msum-row ${kind}${on ? " on" : ""}${count ? "" : " empty"}`} data-label={label} data-mapping={more.mapping}
        onClick={count ? () => pick(ids, label) : undefined}>
        <td>
          <div className="msum-cell">
            {more.toggle
              ? <button type="button" className="msum-toggle" aria-expanded={more.toggle.open}
                  aria-label={`${more.toggle.open ? "Hide" : "Show"} ${more.toggle.what}`}
                  onClick={(e) => { e.stopPropagation(); onToggle(more.toggle!.id); }}><ChevronRight size={13} aria-hidden /></button>
              : kind === "discipline" ? <span className="msum-pad" aria-hidden /> : null}
            <span className="msum-label">
              {/* No handler of its own: its click (and Enter or Space on it) reaches the row's. */}
              <button type="button" className={`msum-name${more.mono ? " mono" : ""}`} disabled={!count} aria-pressed={on}
                title={!count ? "None in the open models" : on ? "Show everything again" : `Isolate ${plural(count, "element")}`}>{name}</button>
              {more.tag}
              {more.extra}
            </span>
          </div>
        </td>
        <td className="num">{count ? fmt(count) : "–"}</td>
        <td className="num">{more.share && count ? (
          <span className="msum-share"><span className="msum-bar" aria-hidden><i style={{ width: `${Math.max(2, (count / total) * 100)}%` }} /></span>{shareText(count, total)}</span>
        ) : null}</td>
      </tr>
    );
  };
  const group = (key: string, title: string) => <tr key={key} className="msum-group"><th colSpan={3} scope="colgroup">{title}</th></tr>;
  const cols = <colgroup><col /><col className="c-num" /><col className="c-share" /></colgroup>;
  return (
    <div className="msum">
      <div className="msum-head">
        <h3>Model understanding</h3>
        <span className="msum-total">{plural(total, "element")} · {plural(files.length, "model")}</span>
      </div>
      {isolated && (
        <div className="msum-iso" role="status">
          <span>Isolated: <b>{isolated}</b></span>
          <button type="button" className="btn small" onClick={onClear}>Show all</button>
        </div>)}
      {!total ? <p className="hint">The open models have no elements to list.</p> : (<>
        <table className="msum-table" aria-label="Elements by discipline">
          {cols}
          <thead><tr><th scope="col">Discipline</th><th scope="col" className="num">Elements</th><th scope="col" className="num" title="Share of all elements">%</th></tr></thead>
          {disciplines.map((d) => {
            const expanded = !!d.count && open.includes(d.id);
            const tag = d.mapping === "ifc-class"
              ? <span className="msum-tag" title="A new mapping from IFC class to discipline, not something the models state (How this is grouped, below)">by class</span>
              : null;
            return (
              <tbody key={d.id} className={expanded ? "open" : undefined}>
                {row(d.id, "discipline", d.label, d.label, d.ids, { share: true, tag, mapping: d.mapping,
                  toggle: d.count ? { id: d.id, open: expanded, what: `${d.label}'s classes, systems and models` } : undefined })}
                {expanded && group(`${d.id}:c`, "Classes")}
                {expanded && d.classes.map((c) => row(`${d.id}:c:${c.cls}`, "sub", `${d.label} · ${c.cls}`, c.cls, c.ids, { mono: true }))}
                {expanded && d.systems && group(`${d.id}:s`, "Systems")}
                {expanded && d.systems?.map((s) => row(`${d.id}:s:${s.name}`, "sub", `${d.label} · ${s.name}`, s.name, s.ids))}
                {expanded && group(`${d.id}:f`, "By model")}
                {expanded && d.perFile.map((f) => row(`${d.id}:f:${f.file}`, "sub", `${d.label} · ${f.file}`, f.file, f.ids))}
              </tbody>
            );
          })}
        </table>
        <p className="hint msum-note">Openings are used in checks but not listed here yet.</p>
        <table className="msum-table msum-models" aria-label="Elements by model">
          {cols}
          <thead><tr><th scope="col">Model</th><th scope="col" className="num">Elements</th><th scope="col" className="num" title="Share of all elements">%</th></tr></thead>
          <tbody>
            {files.map((f) => row(`file:${f.name}`, "model", f.name, f.name, f.ids, { share: true,
              extra: f.count ? <span className="msum-mix">{fileMix(f)}</span> : null }))}
          </tbody>
        </table>
      </>)}
      <details className="msum-how">
        <summary>How this is grouped</summary>
        <p>Each element counts once, under the discipline of its IFC class. Systems are the models' own
          (IfcDistributionSystem; IfcSystem in IFC2X3); an element in two systems is listed under both.</p>
        <p><b>HVAC, Plumbing &amp; piping and Electrical</b> (marked <span className="msum-tag">by class</span>) are a new
          mapping from IFC4 class, not something the models state. Fire alarm and control devices count as Electrical;
          valves, pumps, tanks and meters as Plumbing &amp; piping, whichever service they are on.</p>
        <p><b>MEP by system:</b> IFC2X3's generic classes (IfcFlowSegment, IfcFlowFitting, IfcFlowTerminal…) do not say
          which service they are, so they are grouped by their system; those in none are MEP (unspecified).</p>
        <p><b>Structure, Architecture and Site</b> are Iris's existing lists: the frame Iris keeps in place when it
          proposes a fix (a <span className="mono">*</span> class takes its standard-case subtypes) and the classes it
          uses to guess each model's team. Walls, slabs, members and plates are modelled by every discipline, so they
          count with their model: Architecture or Site in a model that is mostly that (a curtain wall's mullions, a
          partition), Structure anywhere else. By model shows where each count comes from.</p>
        <dl className="msum-rules">
          {ORDER.filter((id) => id !== "other").map((id) => (
            <div key={id}>
              <dt>{disciplineLabel(id)}<span className="why"> · {id === "mep" ? "new IFC-class mapping, for what the three above leave"
                : mappingOf(id) === "ifc-class" ? "new IFC-class mapping" : "existing"}</span></dt>
              <dd className="mono">{ruleClasses(id).join(", ")}</dd>
            </div>))}
          <div><dt>Other<span className="why"> · the rest</span></dt><dd>Every class no list claims: proxies, roofs, transport elements…</dd></div>
        </dl>
      </details>
    </div>
  );
}
