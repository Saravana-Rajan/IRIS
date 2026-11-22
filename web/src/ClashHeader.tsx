import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, LocateFixed } from "lucide-react";
import "./coordination.css";
import type { ReportClash, ReportElement, TriageVerdict } from "./api";
import { CLASS_INFO, SEVERITY_LABEL, STATUS_INFO, classify, distanceText, limitText, locationText, severityOf, type ClashStatus } from "./coordination";

/** The investigation header for one clash (docs/engineer-workflow.md, step 5): #N and id, title, its class, triage
 * severity (AI-assessed) and status, A and B as the report gives them, the signed distance against the test's limit,
 * where it is, and Focus in 3D. Every value is a field the clash or its triage already holds; a missing one is left
 * out, never guessed. */
export function ClashHeader({ clash, triage, status, onFocus, onPrev, onNext }: {
  clash: ReportClash;
  triage?: TriageVerdict;
  status: ClashStatus;      // statusOf(clash, { fixes, reviewed, resolvedIds })
  onFocus: () => void;      // take the views to the clash
  onPrev?: () => void; onNext?: () => void;   // the list's previous / next clash, when there is one
}) {
  const cls = CLASS_INFO[classify(clash, triage)];
  const sev = severityOf(triage);
  const dist = distanceText(clash);
  const limit = limitText(clash);
  const where = locationText(clash);
  const found = clash.source === "iris";
  return (
    <header className="clash-head" aria-label={`Clash #${clash.number}`}>
      <div className="clash-head-top">
        <span className="clash-head-num">#{clash.number}</span>
        <span className="clash-head-id mono" data-tip={found ? "Iris's id for this clash: the same on every run" : "The clash's id in this report"}>{clash.id}</span>
        {clash.ref && <span className="clash-head-ref">Navisworks {clash.ref}</span>}
        {(onPrev || onNext) && <span className="clash-head-nav">
          <button type="button" className="ibtn small" aria-label="Previous clash" data-tip="Previous clash" data-tip-side="bottom" disabled={!onPrev} onClick={onPrev}><ChevronLeft size={16} aria-hidden /></button>
          <button type="button" className="ibtn small" aria-label="Next clash" data-tip="Next clash" data-tip-side="bottom" disabled={!onNext} onClick={onNext}><ChevronRight size={16} aria-hidden /></button>
        </span>}
      </div>
      <h2 className="clash-head-title">{clash.title ?? clash.name}</h2>
      <p className="clash-head-test">{clash.title ? `${clash.name} · ` : ""}{clash.test}</p>
      <div className="clash-head-chips">
        <span className={`chip ${cls.tone}`} data-tip={cls.tip} data-tip-side="bottom">{cls.label}</span>
        <span className={`chip sev ${sev ?? "unset"}`} data-tip-side="bottom"
          data-tip={sev ? triage?.source === "rule" ? "Settled by a rule, not read by the triage model" : "AI-assessed by triage: the model's reading, not a measure" : "Not triaged yet: no severity"}>
          {sev ? `${sev === "none" ? "No" : SEVERITY_LABEL[sev]} severity` : "Severity not assessed"}
          {sev && <span className="clash-head-ai">{triage?.source === "rule" ? "by rule" : "AI-assessed"}</span>}</span>
        <span className={`chip status ${status}`} data-tip={STATUS_INFO[status].tip} data-tip-side="bottom">{STATUS_INFO[status].label}</span>
      </div>
      <dl className="clash-head-measure">
        <div><dt>{dist.label}</dt><dd className={`mono ${clash.distance_m != null && clash.distance_m < 0 ? "bad" : ""}`}
          data-tip={found ? "As Iris's detection measured it" : "As the imported report gives it"}>{dist.value}</dd></div>
        {limit && <div><dt>{limit.label}</dt><dd className="mono">{limit.value}</dd></div>}
        {where && <div><dt>Location</dt><dd>{where}</dd></div>}
      </dl>
      <div className="clash-head-sides">
        <Side side="A" e={clash.a} />
        <Side side="B" e={clash.b} />
      </div>
      <button type="button" className="btn small primary clash-head-focus" onClick={onFocus}><LocateFixed size={14} aria-hidden /> Focus in 3D</button>
    </header>
  );
}

/** One element as the report gives it: class, name, and file, level and system when known; its GlobalId to copy. */
function Side({ side, e }: { side: "A" | "B"; e: ReportElement }) {
  const facts = ([["File", e.file], ["Level", e.level], ["System", e.system]] as const).filter(([, v]) => !!v);
  return (
    <div className={`clash-head-side side-${side.toLowerCase()}`}>
      <div className="clash-head-side-top">
        <b><i className={`sw ${side === "A" ? "red" : "green"}`} />{side} · {e.ifc_class ?? "class not given"}</b>
        {e.global_id && <CopyId id={e.global_id} />}
      </div>
      <div className="clash-head-name">{e.name}{e.part_of && <span className="why"> · part of {e.part_of}</span>}</div>
      {facts.length > 0 && <dl className="clash-head-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </div>
  );
}

/** Text to the clipboard of the window the button is in (a panel may be popped out): the Clipboard API, else a hidden
 * text area and the copy command. */
async function copyText(text: string, from: HTMLElement): Promise<boolean> {
  const doc = from.ownerDocument;
  try { await doc.defaultView!.navigator.clipboard.writeText(text); return true; } catch { /* the old way */ }
  try {
    const area = doc.createElement("textarea");
    area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
    doc.body.appendChild(area); area.select();
    const ok = doc.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="clash-head-gid mono" aria-label={`Copy GlobalId ${id}`} data-tip={copied ? "Copied" : "Copy GlobalId"} data-tip-side="left"
      onClick={(ev) => { void copyText(id, ev.currentTarget).then((ok) => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1200); } }); }}>
      <span>{id}</span>{copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}</button>
  );
}
