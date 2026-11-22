import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Info, RotateCcw, Sparkles, X } from "lucide-react";
import { api, ApiError, type Kept, type Option, type Piece, type ReportClash, type TriageVerdict } from "./api";
import { clashKey } from "./coordination";
import { editText, optionKey, rejectionNotes, type Rejection } from "./fixKinds";
import { describe, STATE_LABEL, stateOf, toDecision, type ClashRef, type Decision } from "./proposalState";
import {
  anotherStage, distanceText, emptyPrep, failedWhy, firstOpen, keyAction, nextIndex, pickForReview, pillOf, prepareStore,
  prepareText, reviewText, savedLabel, scopeOf, type KeyAction, type PrepItem, type PrepState,
} from "./reviewQueueModel";
import "./review-queue.css";

/** The review queue (docs/review-queue.md): Iris prepares a verified fix for each clash that needs one, in the
 * background; the reviewer walks the queue one clash per screen, the fix on the left and the 3D before / after on the
 * right. AI proposes, geometry proves, the engineer decides: nothing is kept without Accept, and Accept goes through
 * the keep route (the server tries it again first). */

type Mode = "before" | "after" | "both";
const MODES: Mode[] = ["before", "after", "both"];
const MODE_LABEL: Record<Mode, string> = { before: "Before", after: "After", both: "Both" };
const SIDE_A = "#d0342c", SIDE_B = "#1f9d3a";   // the 3D view's element A red, element B green

/** What the queue needs of the 3D viewer (viewer/Viewer.ts). `mountIn` brings its canvas into the queue's right pane
 * (null: back where it was). */
export interface ReviewViewer {
  setFocus(focus: { a: string | null; b: string | null }): void;
  focusClash(ids: string[], point: null, label?: string, fly?: boolean): unknown;
  showOption(opt: { kind: string; moved: string[]; deltaM: number[]; pieces: Piece[] | null; before: Piece[] | null }, mode: Mode, color: string): void;
  preview(moves: { globalIds: string[]; deltaM: number[] }[]): void;
  mountIn?(el: HTMLElement | null): void;
}

/** The prepare state for this scene and clash list (empty for another one). */
function usePrepare(sceneId: string, reportId: string): PrepState {
  const snap = useSyncExternalStore(prepareStore.subscribe, prepareStore.getSnapshot);
  useEffect(() => { prepareStore.use(sceneId, reportId); }, [sceneId, reportId]);
  const scope = scopeOf(sceneId, reportId);
  return snap.scope === scope ? snap : emptyPrep(scope);
}

// ------------------------------------------------------------------------------------------------- the entry point

export interface ReviewFixesEntryProps {
  sceneId: string; reportId: string; reportTitle?: string | null;
  clashes: ReportClash[]; triage: Record<string, TriageVerdict>;
  /** The clashes ticked in the list. */
  ticked: Set<string> | string[];
  /** Clash ids already fixed or reviewed: never prepared. */
  fixed: string[];
  onOpen(): void;
}

/** The one entry point on Clash review: "Prepare fixes (8)", then "Preparing fixes: 3 of 8", then "Review fixes (6
 * ready)". Starting opens the queue at once: the reviewer can begin on the first ready clash while the rest prepare. */
export function ReviewFixesEntry({ sceneId, reportId, clashes, triage, ticked, fixed, onOpen }: ReviewFixesEntryProps) {
  const state = usePrepare(sceneId, reportId);
  const pick = useMemo(() => pickForReview({ clashes, triage, ticked, fixed }), [clashes, triage, ticked, fixed]);
  const empty = !state.running && !state.items.length;
  const start = () => {
    void prepareStore.start(sceneId, { report_id: reportId, clash_ids: pick.clash_ids, pick: pick.pick, fixed: [...fixed] });
  };
  const open = () => {
    if (empty) { if (!pick.count) return; start(); }
    onOpen();
  };
  const ready = state.items.filter((it) => it.status === "ready" && it.decision === "pending").length;
  const failed = state.items.filter((it) => it.status === "failed").length;
  const line = state.running
    ? (ready ? `${ready} ready to review now; Iris is preparing the rest` : "Iris proposes each fix and geometry checks it before you see it")
    : empty ? (pick.count ? `For ${pick.why}. Nothing is kept until you accept.` : "No open clashes left to prepare.")
      : [reviewText(state), failed ? `${failed} without a verified fix` : ""].filter(Boolean).join(" · ");
  return (
    <section className="rq-entry" aria-label="Review fixes">
      <button type="button" className="rq-btn rq-primary" disabled={empty && !pick.count} onClick={open}>{prepareText(state, pick.count)}</button>
      <p className={`rq-entry-line${state.running ? " rq-shimmer" : ""}`} role="status">{line}</p>
      {state.error && <p className="rq-entry-error" role="alert">{state.error}</p>}
      {!state.running && !empty && pick.count > 0 &&
        <button type="button" className="rq-link rq-entry-again" onClick={start}>{`Prepare again (${pick.count})`}</button>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- the queue

export interface ReviewQueueProps {
  sceneId: string; reportId: string; reportTitle?: string | null;
  clashes: ReportClash[];
  viewer: ReviewViewer | null;
  /** Who decides: recorded with each decision. */
  reviewer: string;
  onReviewer(name: string): void;
  /** A fix the server kept (it tried it again first): the page brings its model up to it. */
  onKept(kept: Kept & { decisions?: Decision[] }, info: { option: Option; pair: string[]; clashIds: string[] }): void | Promise<void>;
  /** The journal's decisions after one was recorded (all of them). */
  onDecisions(decisions: Decision[]): void;
  onClose(): void;
}

const message = (e: unknown) => (e as Error)?.message || String(e);
const noLongerPasses = (detail: string) => (/^no longer passes/i.test(detail) ? detail : `No longer passes: ${detail}`);

export function ReviewQueue({ sceneId, reportId, reportTitle, clashes, viewer, reviewer, onReviewer, onKept, onDecisions, onClose }: ReviewQueueProps) {
  const state = usePrepare(sceneId, reportId);
  const scope = scopeOf(sceneId, reportId);
  const items = state.items;
  const [index, setIndex] = useState(() => Math.max(0, firstOpen(items)));
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("after");
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(reviewer);
  const [busy, setBusy] = useState<null | "accept" | "reject">(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const view = useRef<HTMLDivElement | null>(null);
  /** Waiting for a clash to become ready: "start" (nothing reviewed yet) or the key of the item decided last. */
  const waiting = useRef<string | null>("start");

  const byId = useMemo(() => new Map(clashes.map((c) => [c.id, c] as const)), [clashes]);
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of clashes) for (const side of [c.a, c.b]) {
      if (side?.global_id && !out[side.global_id]) out[side.global_id] = side.name || side.ifc_class || side.global_id;
    }
    return out;
  }, [clashes]);
  const clashOf = (it: PrepItem): ReportClash | null => it.clash_ids.map((id) => byId.get(id)).find((c): c is ReportClash => !!c) ?? null;
  const numberOf = (it: PrepItem, i: number) => { const c = clashOf(it); return c ? `#${c.number}` : it.label || `${i + 1}`; };
  const refFor = (it: PrepItem): ClashRef => {
    const c = clashOf(it);
    return c ? { id: c.id, key: clashKey(c, reportTitle), number: c.number } : { id: it.clash_ids[0] ?? it.key, key: it.key };
  };

  const at = items.length ? Math.min(index, items.length - 1) : -1;
  const item = at >= 0 ? items[at] : null;
  const options = item?.status === "ready" ? item.options : [];
  const oi = item ? Math.min(chosen[item.key] ?? 0, Math.max(0, options.length - 1)) : 0;
  const option: Option | null = options[oi] ?? null;
  const clash = item ? clashOf(item) : null;
  const label = item ? numberOf(item, at) : "";
  const a = item?.element_a || null, b = item?.element_b || null, key = item?.key ?? null;
  const accepted = item?.decision === "accepted";
  const canAccept = !!item && !!option && item.status === "ready" && item.decision === "pending" && stateOf(option) === "geometry_validated";
  const canReject = !!item && !!option && item.status === "ready" && item.decision === "pending";
  const another = !!item && (item.decision === "requested" || item.status === "preparing");

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // The 3D view comes into the right pane while the queue is open, and goes back as it was when it closes.
  useEffect(() => {
    const v = viewer;
    if (!v) return;
    v.mountIn?.(view.current);
    return () => { v.preview([]); v.setFocus({ a: null, b: null }); v.mountIn?.(null); };
  }, [viewer]);
  // Each clash: its pair in focus, the camera at it.
  useEffect(() => {
    if (!viewer || !a || !b) return;
    viewer.setFocus({ a, b });
    viewer.focusClash([a, b], null, label);
  }, [viewer, key, a, b]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Its fix, previewed only (Before | After | Both): nothing is applied but through Accept. A kept fix is in the model.
  useEffect(() => {
    if (!viewer) return;
    if (!option || accepted) { viewer.preview([]); return; }
    viewer.showOption({ kind: option.kind, moved: option.moved, deltaM: option.delta_m, pieces: option.preview, before: option.before },
      mode, option.moved.includes(a ?? "") ? SIDE_A : SIDE_B);
  }, [viewer, key, option, mode, accepted, a]);
  // Nothing ready yet (or everything ready decided): go to the first clash that becomes ready.
  useEffect(() => {
    const from = waiting.current;
    if (!from || at < 0) return;
    const current = items[at];
    if (from === "start" && current.status === "ready" && current.decision === "pending") { waiting.current = null; return; }
    if (from !== "start" && current.key !== from) { waiting.current = null; return; }
    const next = current.status === "ready" && current.decision === "pending" ? at : nextIndex(items, at);
    if (next !== at) { waiting.current = null; setIndex(next); }
  }, [items, at]);

  /** To another clash, by hand. */
  function go(i: number) {
    if (!items.length) return;
    const to = Math.max(0, Math.min(items.length - 1, i));
    waiting.current = null;
    if (to === at) return;
    setIndex(to); setRejecting(false); setWhy(""); setError(null);
  }
  /** After a decision: the next clash ready to review, or stay and take the next one that becomes ready. */
  function advance(fromKey: string) {
    const now = prepareStore.getSnapshot();
    if (now.scope !== scope) return;
    const from = now.items.findIndex((it) => it.key === fromKey);
    const next = from < 0 ? at : nextIndex(now.items, from);
    if (next === from) waiting.current = fromKey;
    else { waiting.current = null; setIndex(next); }
  }

  async function accept() {
    const it = item, o = option;
    if (!it || !o || busy || !canAccept) return;
    const ref = refFor(it);
    const pair = o.pair?.length ? o.pair : [it.element_a, it.element_b];
    setBusy("accept"); setError(null);
    let kept: Kept & { decisions?: Decision[] };
    try {
      // The server tries it again (plans.apply), keeps it and records the "accepted" decision with who and which clash.
      kept = await api.accept(sceneId, o, [it.element_a, it.element_b], it.clash_ids[0] ?? null,
        { reviewer, clash_key: ref.key, number: ref.number ?? null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) prepareStore.decide(scope, it.key, "no_longer_passes", noLongerPasses(message(e)));
      else if (mounted.current) setError(`Not kept: ${message(e)}`);
      if (mounted.current) setBusy(null);
      return;
    }
    prepareStore.decide(scope, it.key, "accepted", reviewer.trim());
    try { await onKept(kept, { option: o, pair, clashIds: it.clash_ids }); }
    catch (e) { if (mounted.current) setError(`Kept in the model, but this page did not catch up: ${message(e)}`); }
    if (!mounted.current) return;
    setBusy(null);
    advance(it.key);
  }

  async function reject(reason: string) {
    const it = item, o = option, text = reason.trim();
    if (!it || !o || busy || !canReject || !text) return;   // a reason is required
    setBusy("reject"); setError(null);
    try {
      const r = await api.decide(sceneId, toDecision(o, stateOf(o), "rejected", text, reviewer, refFor(it)));
      onDecisions(r.decisions);
      const set: Rejection = { title: o.title, kind: o.kind, edit: editText(o), why: text };
      prepareStore.update(scope, it.key, (x) => ({ ...x, decision: "rejected", note: text, rejections: [...x.rejections, set] }));
    } catch (e) {
      if (mounted.current) { setError(`The rejection was not recorded: ${message(e)}`); setBusy(null); }
      return;
    }
    if (!mounted.current) return;
    setRejecting(false); setWhy(""); setBusy(null);
    advance(it.key);
  }

  /** A different fix for this clash: recorded, then asked for with what was set aside, and checked by geometry. */
  async function requestAnother() {
    const it = item;
    if (!it || another || it.decision === "accepted" || busy) return;
    const o = option;
    setError(null);
    if (o) {
      try {
        const r = await api.decide(sceneId, toDecision(o, stateOf(o), "requested_another", null, reviewer, refFor(it)));
        onDecisions(r.decisions);
      } catch (e) { if (mounted.current) setError(`The request was not recorded: ${message(e)}`); return; }
    }
    const asked: Rejection[] = [...it.rejections];
    for (const x of it.options) if (!asked.some((r) => optionKey(r) === optionKey(x))) {
      asked.push({ title: x.title, kind: x.kind, edit: editText(x), why: "the reviewer asked for a different fix" });
    }
    const notes = rejectionNotes(Object.fromEntries(asked.map((r) => [optionKey(r), r])));
    const before = it;
    prepareStore.update(scope, it.key, (x) => ({ ...x, status: "preparing", decision: "requested", stage: "Iris is preparing another fix…", note: "" }));
    try {
      const p = await api.proposeStream(sceneId, it.element_a, it.element_b, { report_id: reportId, clash_id: it.clash_ids[0] ?? "" },
        (e) => { const s = anotherStage(e); if (s) prepareStore.update(scope, it.key, (x) => ({ ...x, stage: s })); }, false, notes);
      const verified = (p.options ?? []).filter((x) => stateOf(x) === "geometry_validated");
      prepareStore.update(scope, it.key, (x) => ({ ...x, status: verified.length ? "ready" : "failed", decision: "pending", options: verified,
        why: verified.length ? "" : failedWhy(p), stage: null, source: "live", note: "", rejections: asked,
        understanding: p.understanding || x.understanding, model: p.model || x.model, tried: p.attempts?.length ?? x.tried,
        clearance_m: typeof p.clearance_m === "number" ? p.clearance_m : x.clearance_m }));
      if (mounted.current) setChosen((c) => ({ ...c, [it.key]: 0 }));
    } catch (e) {
      prepareStore.update(scope, it.key, () => ({ ...before, note: `Another fix was not prepared: ${message(e)}` }));
    }
  }

  // The keys (window-wide while open; never while typing): A accept, R reject, → next, ← previous, Escape close.
  const act = useRef<(k: KeyAction) => void>(() => {});
  act.current = (k) => {
    if (k === "accept") { if (!rejecting) void accept(); }
    else if (k === "reject") { if (canReject && !busy) setRejecting(true); }
    else if (k === "next") go(at + 1);
    else if (k === "prev") go(at - 1);
    else if (rejecting) { setRejecting(false); setWhy(""); }
    else onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyAction(e);
      if (!k) return;
      e.preventDefault();
      act.current(k);
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);

  const saveName = () => { onReviewer(name.trim()); setNaming(false); };
  const cancelReject = () => { setRejecting(false); setWhy(""); };

  // ------------------------------------------------------------------------------------------- the left pane
  const card = (o: Option, it: PrepItem) => {
    const d = describe(o, names, { requiredClearanceMm: it.clearance_m != null ? it.clearance_m * 1000 : null });
    const valid = d.state === "geometry_validated";
    const hit = d.expected.find((e) => e.startsWith("nothing new hit"));
    const model = d.model || it.model;
    return (
      <article className="rq-card" data-state={d.state} aria-label={`${d.title}: ${STATE_LABEL[d.state]}`}>
        <header className="rq-card-head">
          <span className="rq-chip rq-ai"><Sparkles size={12} aria-hidden /> AI-proposed</span>
          {valid ? <span className="rq-chip rq-valid">{STATE_LABEL.geometry_validated}</span>
            : <span className="rq-chip rq-unchecked">{STATE_LABEL[d.state]}</span>}
          <span className="rq-kind">{d.kind}</span>
          {model && <span className="rq-model">{`Proposed by ${model}`}</span>}
        </header>
        {d.title && <h3 className="rq-card-title">{d.title}</h3>}
        <dl className="rq-rows">
          {d.element && <>
            <dt>{d.direction ? "What moves" : "What changes"}</dt>
            <dd><span title={d.element.id}>{d.element.name}</span>
              {d.element.carried > 0 && ` + ${d.element.carried} joined part${d.element.carried === 1 ? "" : "s"}`}</dd>
          </>}
          {d.direction && <><dt>Direction</dt><dd>{d.direction}</dd></>}
          {d.distance && <><dt>Distance</dt><dd className="mono">{d.distance}</dd></>}
          {d.change && <><dt>Edit</dt><dd>{d.change}</dd></>}
          {d.constraints.flatMap((c) => [<dt key={`t${c.label}`}>{c.label}</dt>, <dd key={`d${c.label}`}>{c.value}</dd>])}
        </dl>
        <ul className="rq-evidence" aria-label="Evidence">
          {valid ? <>
            <li>Clash gone</li>
            {d.evidence[0] && d.evidence[0] !== "checked against the model" && <li>{d.evidence[0]}</li>}
            <li>{hit ?? "nothing new hit"}</li>
            <li className="rq-recheck">re-checked by geometry on accept</li>
          </> : <li className="rq-recheck">{d.evidence.join(" · ")}</li>}
        </ul>
        {d.reason && <p className="rq-why"><span className="rq-ai-label" title={`Written by ${d.reason.by ?? "the AI"}; geometry does not check words`}>
          {d.reason.label}</span>{d.reason.text}</p>}
        {it.source === "saved" && <p className="rq-source">From the saved AI proposals for this sample; checked by geometry in this run.</p>}
      </article>
    );
  };

  const decided = (it: PrepItem) => {
    const by = it.decision === "accepted" && it.note ? ` by ${it.note}` : "";
    if (it.decision === "accepted") return (
      <div className="rq-decided is-accepted" role="status"><Check size={14} aria-hidden /> {`Accepted${by}. Geometry checked it again and it is kept in the model.`}</div>);
    if (it.decision === "rejected") return <div className="rq-decided is-rejected" role="status">{`Rejected: ${it.note}`}</div>;
    if (it.decision === "no_longer_passes") return <div className="rq-stale" role="alert">{it.note}</div>;
    return null;
  };

  const anotherButton = (it: PrepItem) => it.decision !== "accepted" && (
    <button type="button" className="rq-btn rq-text" disabled={!!busy || another} onClick={() => void requestAnother()}>
      <RotateCcw size={14} aria-hidden /> Request another</button>);

  let left: ReactNode;
  if (!item) {
    left = state.running
      ? <div className="rq-waiting" role="status"><p className="rq-shimmer">Iris is choosing the clashes to prepare…</p></div>
      : state.error ? <div className="rq-error" role="alert">{state.error}</div>
        : <div className="rq-empty">Nothing prepared yet. Use Prepare fixes on the clash list.</div>;
  } else {
    const dist = distanceText(item.distance_m ?? clash?.distance_m);
    const title = clash?.title || item.label || clash?.name || "";
    const header = (
      <header className="rq-clash">
        <h2 className="rq-clash-title"><span className="rq-num">{label}</span> {title}
          {dist && <span className="rq-dist" title="How far the two overlap">{dist}</span>}</h2>
        {a && b && <p className="rq-pair">{`${names[a] ?? clash?.a.name ?? a} ↔ ${names[b] ?? clash?.b.name ?? b}`}</p>}
        {item.clash_ids.length > 1 && <p className="rq-more">{`One fix for ${item.clash_ids.length} clashes on this pair`}</p>}
      </header>);
    let body: ReactNode;
    if (another || item.status === "preparing") {
      body = (
        <div className="rq-waiting" role="status">
          <p className="rq-shimmer">{item.decision === "requested" ? "Iris is preparing another fix…" : "Iris is preparing this fix…"}</p>
          {item.stage && <p className="rq-source">{item.stage}</p>}
          <p>Geometry checks every idea before you see it. You can review another clash meanwhile.</p>
        </div>);
    } else if (item.status === "waiting") {
      body = <div className="rq-waiting" role="status"><p>Waiting its turn: Iris prepares a few clashes at a time.</p></div>;
    } else if (item.status === "failed") {
      body = (
        <div className="rq-failed">
          <h3>No verified fix found</h3>
          <p>{item.why}</p>
          {item.understanding && <p className="rq-source">{`Iris read it as: ${item.understanding}`}</p>}
          {item.note && <p className="rq-error" role="alert">{item.note}</p>}
          <div className="rq-actions">{anotherButton(item)}</div>
        </div>);
    } else if (option) {
      body = <>
        {options.length > 1 && (
          <div className="rq-switch" role="group" aria-label="Verified options">
            {options.map((x, i) => (
              <button key={i} type="button" className={`rq-opt${i === oi ? " is-on" : ""}`} aria-pressed={i === oi} title={x.title}
                onClick={() => setChosen((c) => ({ ...c, [item.key]: i }))}>{i === 0 ? "Option 1 · best" : `Option ${i + 1}`}</button>))}
          </div>)}
        {card(option, item)}
        {decided(item)}
        {item.decision === "pending" && item.note && <p className="rq-error" role="alert">{item.note}</p>}
        {item.decision === "pending" ? <>
          <div className="rq-reviewer">{naming
            ? <form className="rq-reviewer-form" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
              <input className="rq-input" value={name} maxLength={120} autoFocus autoComplete="name" aria-label="Your name" placeholder="Your name"
                onChange={(e) => setName(e.target.value)} onBlur={saveName}
                onKeyDown={(e) => { if (e.key === "Escape") { setName(reviewer); setNaming(false); } }} />
            </form>
            : <>Reviewing as <b>{reviewer.trim() || "no name yet"}</b> · <button type="button" className="rq-link"
              onClick={() => { setName(reviewer); setNaming(true); }}>{reviewer.trim() ? "change" : "add your name"}</button></>}</div>
          {rejecting
            ? <form className="rq-reject" onSubmit={(e) => { e.preventDefault(); void reject(why); }}>
              <input className="rq-input" value={why} maxLength={200} autoFocus aria-label="Why reject it" placeholder="Why reject it? (required)"
                onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") cancelReject(); }} />
              <button type="submit" className="rq-btn rq-secondary rq-small" disabled={!why.trim() || !!busy}><X size={14} aria-hidden /> Reject</button>
              <button type="button" className="rq-btn rq-text rq-small" onClick={cancelReject}>Cancel</button>
            </form>
            : <div className="rq-actions">
              <button type="button" className="rq-btn rq-primary" disabled={!canAccept || !!busy} onClick={() => void accept()}
                title={canAccept ? "Geometry checks it again before it is kept" : "Only a geometry-validated fix can be accepted"}>
                <Check size={15} aria-hidden /> {busy === "accept" ? "Accepting…" : "Accept"}</button>
              <button type="button" className="rq-btn rq-secondary" disabled={!canReject || !!busy} onClick={() => setRejecting(true)}>
                <X size={15} aria-hidden /> Reject</button>
              {anotherButton(item)}
            </div>}
          <p className="rq-keys"><span><kbd>A</kbd> accept</span><span><kbd>R</kbd> reject</span><span><kbd>←</kbd> <kbd>→</kbd> move</span></p>
        </> : <div className="rq-actions">{anotherButton(item)}</div>}
      </>;
    }
    left = <>{header}{body}{error && <p className="rq-error" role="alert">{error}</p>}</>;
  }

  return (
    <div className="rq" role="dialog" aria-modal="true" aria-label="Review fixes">
      <header className="rq-top">
        <div className="rq-title"><b>Review fixes</b>{reportTitle && <span className="rq-report">{reportTitle}</span>}</div>
        {items.length > 0 && <span className="rq-progress" role="status">{reviewText(state)}</span>}
        {state.running && <span className="rq-preparing rq-shimmer" role="status">{prepareText(state)}</span>}
        <nav className="rq-pills" aria-label="Clashes in the queue">
          {items.map((x, i) => {
            const p = pillOf(x), n = numberOf(x, i);
            return <button key={x.key} type="button" className={`rq-pill is-${p.cls}${i === at ? " is-current" : ""}`}
              aria-current={i === at ? "true" : undefined} aria-label={`${n}: ${p.label}`} title={`${n}: ${p.label}`} onClick={() => go(i)}>{n}</button>;
          })}
        </nav>
        <div className="rq-nav">
          <button type="button" className="rq-icon-btn" aria-label="Previous clash" disabled={at <= 0} onClick={() => go(at - 1)}>
            <ChevronLeft size={16} aria-hidden /></button>
          <button type="button" className="rq-icon-btn" aria-label="Next clash" disabled={at < 0 || at >= items.length - 1} onClick={() => go(at + 1)}>
            <ChevronRight size={16} aria-hidden /></button>
        </div>
        <button type="button" className="rq-btn rq-secondary rq-small rq-close" onClick={onClose}><X size={14} aria-hidden /> Close</button>
      </header>
      <div className="rq-notices">
        {state.saved && <p className="rq-notice">{savedLabel(state.saved)}</p>}
        <p className="rq-hint"><Info size={14} aria-hidden /> AI-proposed: check before accepting</p>
      </div>
      <div className="rq-body">
        <section className="rq-left" aria-label="The proposed fix">{left}</section>
        <section className="rq-right" aria-label="3D view">
          <div className="rq-view">
            {!viewer?.mountIn && <p className="rq-view-empty">The 3D view is not available here.</p>}
            <div className="rq-canvas" ref={view} />
            <div className="rq-seg" role="group" aria-label="Before or after the fix" style={{ "--rq-seg-i": MODES.indexOf(mode) } as CSSProperties}>
              <span className="rq-seg-thumb" aria-hidden />
              {MODES.map((m) => (
                <button key={m} type="button" className={m === mode ? "is-on" : ""} aria-pressed={m === mode} disabled={!option || accepted}
                  onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
