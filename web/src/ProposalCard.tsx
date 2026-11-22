import { useState } from "react";
import { Check, Columns2, PencilRuler, RotateCcw, X } from "lucide-react";
import {
  decisionWords, describe, EXPECTED_NONE, STATE_LABEL, STATE_MEANING,
  type Decision, type ProposalItem, type ProposalState,
} from "./proposalState";
import "./proposal.css";

/** One proposal for the engineer: AI proposes, geometry proves, the engineer decides (docs/engineer-workflow.md,
 * steps 6–9). Props only: the page owns the proposal, the edit tool and the journal. */
export interface ProposalCardProps {
  item: ProposalItem;
  /** The caller's state (proposalState.stateOf); never shown as more than the item's own shape supports. */
  state: ProposalState;
  /** GlobalId → name, for the moved element and what a failed check hit. */
  names: Record<string, string>;
  /** The clearance every option had to keep (the proposal's clearance_m, in mm). */
  requiredClearanceMm?: number;
  onAccept?(): void;
  onReject?(reason: string): void;
  /** Opens the existing edit tool with this fix as the start. */
  onModify?(): void;
  onAnother?(): void;
  onShowBeforeAfter?(): void;
  busy?: boolean;
  decided?: Decision | null;
  /** The guided tour's mark on the Accept button (`data-tour`), on the option the tour points at. */
  acceptTour?: string;
}

const CHIP: Record<ProposalState, string> = {
  ai_proposed: "s-ai", geometry_validated: "s-valid", failed_validation: "s-fail", unverified: "s-unverified",
};

export function ProposalCard({ item, state, names, requiredClearanceMm, onAccept, onReject, onModify, onAnother,
  onShowBeforeAfter, busy = false, decided = null, acceptTour }: ProposalCardProps) {
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const d = describe(item, names, { requiredClearanceMm, state });
  const valid = d.state === "geometry_validated";
  const reason = why.trim();
  const submit = () => {
    if (!reason || !onReject || busy) return;
    onReject(reason);
    setRejecting(false);
    setWhy("");
  };
  const cancel = () => { setRejecting(false); setWhy(""); };
  const done = decided ? decisionWords(decided) : null;

  return (
    <article className={`pcard ${CHIP[d.state]}`} data-state={d.state} aria-label={`${d.title}: ${STATE_LABEL[d.state]}`}>
      <header className="pcard-head">
        <span className={`pcard-state ${CHIP[d.state]}`}>{STATE_LABEL[d.state]}</span>
        <span className="pcard-kind">{d.kind}</span>
        {d.model && <span className="pcard-model">{d.model}</span>}
      </header>
      <p className="pcard-meaning">{STATE_MEANING[d.state]}</p>
      {d.title && <b className="pcard-title">{d.title}</b>}

      <dl className="pcard-rows">
        {d.element && <>
          <dt>{d.direction ? "Element to move" : "Element changed"}</dt>
          <dd><span data-tip={d.element.id}>{d.element.name}</span>
            {d.element.carried > 0 && <span className="pcard-sub">{` + ${d.element.carried} joined part${d.element.carried === 1 ? "" : "s"}`}</span>}</dd>
        </>}
        {d.direction && <><dt>Direction</dt><dd>{d.direction}</dd></>}
        {d.distance && <><dt>Distance</dt><dd className="mono">{d.distance}</dd></>}
        {d.change && <><dt>Edit</dt><dd>{d.change}</dd></>}
        {d.reason && <>
          <dt>Reason <span className="pcard-ai" data-tip={`Written by ${d.reason.by ?? "the AI"}; geometry does not check words`}>{d.reason.label}</span></dt>
          <dd className="pcard-why">{d.reason.text}</dd>
        </>}
        {d.constraints.length > 0 && <>
          <dt>Constraints considered</dt>
          <dd><ul className="pcard-list">{d.constraints.map((c) => <li key={c.label}><span className="pcard-sub">{c.label}:</span> {c.value}</li>)}</ul></dd>
        </>}
        <dt>Expected outcome</dt>
        <dd>{d.expected.length
          ? <ul className="pcard-list ok">{d.expected.map((e) => <li key={e}>{e}</li>)}</ul>
          : <span className="pcard-sub">{EXPECTED_NONE[d.state as keyof typeof EXPECTED_NONE]}</span>}</dd>
        <dt>Evidence</dt>
        <dd>{d.failure
          ? <div className="pcard-fail" role="note">
            <span><b>Geometry check:</b> {d.failure.reason}</span>
            {d.failure.hits.length > 0 && <span><b>Hit:</b> {d.failure.hits.map((h) => h.name).join(", ")}</span>}
          </div>
          : <span className={valid ? "pcard-proof mono" : "pcard-sub"}>{d.evidence.join(" · ")}</span>}</dd>
      </dl>

      {done && decided ? (
        <div className={`pcard-decided d-${decided.decision}`} role="status">
          <span><b>{done.verb}</b>{` by ${done.who}`} · <time dateTime={done.iso}>{done.when}</time></span>
          {done.why && <span className="pcard-sub">{`Why: ${done.why}`}</span>}
        </div>
      ) : rejecting && onReject ? (
        <form className="pcard-reject" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input value={why} maxLength={200} autoFocus aria-label={`Why reject ${d.title}`} placeholder="Why reject it? (required)"
            onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") cancel(); }} />
          <button type="submit" className="btn small" disabled={!reason || busy}><X size={13} aria-hidden /> Reject</button>
          <button type="button" className="btn small ghost" onClick={cancel}>Cancel</button>
        </form>
      ) : (
        <div className="pcard-actions">
          <button type="button" className="btn small primary" data-tour={acceptTour} disabled={!valid || busy || !onAccept} onClick={() => onAccept?.()}
            data-tip={valid ? "Geometry checks it again before it is kept" : "Only a geometry-validated fix can be accepted"}>
            <Check size={13} aria-hidden /> Accept</button>
          {onReject && <button type="button" className="btn small" disabled={busy} onClick={() => setRejecting(true)}
            data-tip="Set it aside, with a reason"><X size={13} aria-hidden /> Reject</button>}
          {onModify && <button type="button" className="btn small" disabled={busy} onClick={() => onModify()}
            data-tip="Open the edit tool with this fix as the start"><PencilRuler size={13} aria-hidden /> Modify</button>}
          {onAnother && <button type="button" className="btn small" disabled={busy} onClick={() => onAnother()}
            data-tip="Ask for a different fix; this one is kept"><RotateCcw size={13} aria-hidden /> Request another</button>}
          {onShowBeforeAfter && <button type="button" className="btn small ghost" disabled={busy} onClick={() => onShowBeforeAfter()}
            data-tip="Before and after in 3D"><Columns2 size={13} aria-hidden /> Before / after</button>}
        </div>
      )}
    </article>
  );
}
