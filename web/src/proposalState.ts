import type { Attempt, Option, PlanItem, Recommendation } from "./api";
import { editText, hostRows, kindLabel, needsText, recEditText, reviewText } from "./fixKinds";

/** One proposal on its way to the engineer: AI proposes, geometry proves, the engineer decides
 * (docs/engineer-workflow.md, steps 6, 7 and 9). Pure: no React, no network. */

/** Where a proposal stands. Only the geometry gate's own fields make one `geometry_validated`: an option from the
 * proposal's `options` (nothing reaches that list without passing `verify.check`), or an attempt the check passed.
 * Nothing the model wrote (title, rationale, advice) is ever read to decide it. */
export type ProposalState = "ai_proposed" | "geometry_validated" | "failed_validation" | "unverified";
export type DecisionKind = "accepted" | "rejected" | "modified" | "requested_another";

/** A decision on one proposal, as the journal keeps it (docs/engineer-workflow.md, "Decisions (journal)"). */
export interface Decision {
  clash_id: string; clash_key: string; number?: number;
  option: { title: string; kind: string; moved: string[]; delta_m?: [number, number, number] | null; rationale?: string };
  state: ProposalState;
  decision: DecisionKind;
  reason?: string; reviewer?: string; at: number;
  check?: { verified: boolean; min_clearance_m?: number | null; checked_against?: number | null; reason?: string };
}

/** An idea the model has put forward that geometry has not tried yet: an `ideas` event's candidate, a `checking`
 * event, or a `trial` in place while the check runs. */
export interface Idea { title: string; kind: string; model?: string; rationale?: string; delta_m?: number[]; moved?: string[] }
/** Anything carrying its own check, like a plan item: `geometry: false` means it was never tried on the geometry
 * ("as designed"), so it is never shown as validated. */
export interface Checked { title?: string; kind?: string; check: { passed?: boolean; geometry?: boolean; reason?: string } }

/** What a card shows: an option, a failed or passed attempt, a recommendation, an unchecked idea, or a checked item
 * like an "as designed" plan item. */
export type ProposalItem = Option | Attempt | Recommendation | Idea | Checked;
export type StateInput = ProposalItem | PlanItem | null | undefined;

export const STATE_LABEL: Record<ProposalState, string> = {
  ai_proposed: "AI-proposed",
  geometry_validated: "Geometry-validated ✓",
  failed_validation: "Failed validation ✕",
  unverified: "Unverified",
};

/** Each state in one line, for the chip's caption. */
export const STATE_MEANING: Record<ProposalState, string> = {
  ai_proposed: "The model's idea. Geometry has not checked it yet.",
  geometry_validated: "Geometry checked it on the model: the clash is gone and nothing new is hit.",
  failed_validation: "Geometry checked it and refused it. Kept for the record; it cannot be accepted.",
  unverified: "Never tried on the model. There is no geometry evidence, so it cannot be accepted as a fix.",
};

/** The Expected outcome row when there are no geometry numbers to show. */
export const EXPECTED_NONE: Record<Exclude<ProposalState, "geometry_validated">, string> = {
  ai_proposed: "Not known until geometry checks it",
  failed_validation: "None: the geometry check refused it",
  unverified: "Not measured: nothing was tried on the model",
};

type Loose = Record<string, unknown>;
const isObj = (x: unknown): x is Loose => typeof x === "object" && x !== null;

/** The state of a proposal, from its shape alone (see ProposalState). */
export function stateOf(x: StateInput): ProposalState {
  if (!isObj(x)) return "unverified";
  const check = isObj(x.check) ? x.check : null;
  if (check?.geometry === false) return "unverified";                        // "as designed": never tried
  if ("blocked_by" in x || x.recommended === true) return "unverified";       // a recommendation: never tried
  if (check?.passed === false) return "failed_validation";
  if (typeof x.passed === "boolean") return x.passed ? "geometry_validated" : "failed_validation";   // an Attempt
  if ("option" in x) return isObj(x.option) ? stateOf(x.option as unknown as Option) : "unverified";          // a plan item
  if (Array.isArray(x.moved) && "min_clearance_m" in x) return "geometry_validated";               // an Option
  return typeof x.title === "string" || typeof x.kind === "string" ? "ai_proposed" : "unverified";   // an idea, a trial
}

/** The state to show and record. The item's own shape decides; a caller's state can only lower a validated one (say,
 * an option shown as unverified once the model changed under it), never raise one or hide a failed check. */
export function safeState(x: StateInput, claimed?: ProposalState | null): ProposalState {
  const own = stateOf(x);
  return own === "geometry_validated" && claimed ? claimed : own;
}

// ------------------------------------------------------------------------------------------------- in words

const AXES = [["east", "west"], ["north", "south"], ["up", "down"]] as const;

/** A move's parts on the model's axes (+X east, +Y north, +Z up, as `fixKinds.moveWords`), whole millimetres; parts
 * under half a millimetre are left out. */
export function moveParts(delta: readonly number[] | null | undefined): { word: string; mm: number }[] {
  if (!delta) return [];
  return delta.slice(0, 3).flatMap((v, k) => Number.isFinite(v) && Math.abs(v) >= 0.0005
    ? [{ word: AXES[k][v > 0 ? 0 : 1], mm: Math.abs(Math.round(v * 1000)) }] : []);
}

const listWords = (w: string[]) => w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;

/** Direction and distance in words: "up" and "400 mm"; "west and up" and "412 mm (100 mm west, 400 mm up)". Nothing
 * for a zero move. */
export function directionWords(delta: readonly number[] | null | undefined): { direction?: string; distance?: string } {
  const parts = moveParts(delta);
  if (!parts.length) return {};
  const direction = listWords(parts.map((p) => p.word));
  if (parts.length === 1) return { direction, distance: `${parts[0].mm} mm` };
  const total = Math.round(Math.hypot(...parts.map((p) => p.mm)));
  return { direction, distance: `${total} mm (${parts.map((p) => `${p.mm} mm ${p.word}`).join(", ")})` };
}

export interface Row { label: string; value: string }
export interface Described {
  state: ProposalState;
  title: string;
  kind: string;                // the kind's name ("Move", "Offset", …)
  model?: string;              // whose idea it was
  /** The element it changes (a GlobalId, named from `names`), and how many joined parts go with it. */
  element?: { id: string; name: string; carried: number };
  direction?: string;
  distance?: string;
  /** The edit in a few words, when direction and distance do not say it all (an offset, a route, a seat, …). */
  change?: string;
  /** Why, in the model's words: always labelled AI-drafted. */
  reason?: { text: string; label: "AI-drafted"; by?: string };
  constraints: Row[];
  /** From geometry numbers only: empty unless the state is geometry_validated. */
  expected: string[];
  /** What backs it: the check's numbers when validated, otherwise a plain statement of what is missing. */
  evidence: string[];
  /** A failed check: the geometry's reason and what it hit, named. */
  failure?: { reason: string; hits: { id: string; name: string }[] };
}

const nameOf = (names: Record<string, string>, id: string) => names[id] || id;

/** One proposal in words for the card and the report. `requiredClearanceMm` is the clearance every option had to
 * keep (the proposal's `clearance_m`); `state` is the caller's state, never trusted beyond the item's shape. Fields
 * the item does not carry are left out, never guessed. */
export function describe(item: ProposalItem, names: Record<string, string>,
  opts: { requiredClearanceMm?: number | null; state?: ProposalState | null } = {}): Described {
  const x = item as unknown as Loose;
  const state = safeState(item, opts.state);
  const kind = typeof x.kind === "string" && x.kind ? x.kind : "move";
  const delta = Array.isArray(x.delta_m) ? (x.delta_m as number[]) : null;
  const edit = isObj(x.edit) ? (x.edit as Option["edit"]) : null;
  const rec = "blocked_by" in x ? (item as Recommendation) : null;
  const opt = Array.isArray(x.moved) && "min_clearance_m" in x ? (item as Option) : null;
  const out: Described = { state, title: String(x.title ?? ""), kind: kindLabel(kind), constraints: [], expected: [], evidence: [] };
  if (typeof x.model === "string" && x.model) out.model = x.model;

  const moved = opt?.moved ?? (rec?.element ? [rec.element] : []);
  if (moved.length) out.element = { id: moved[0], name: nameOf(names, moved[0]), carried: moved.length - 1 };

  const trim = isObj(x.trim) ? (x.trim as { by_m?: number }) : null;
  if (kind === "trim") {
    out.direction = "cut back at one end";
    if (trim && typeof trim.by_m === "number") out.distance = `${Math.round(trim.by_m * 1000)} mm`;
  } else Object.assign(out, directionWords(delta));

  // The edit in words: the server's summary, an offset's or a trim's own words; a plain move says it in direction and
  // distance. Never "move 0 mm" for a kind that does not move.
  const worded = !!edit?.summary || ((kind === "offset" || kind === "trim") && !!delta);
  const change = rec ? recEditText(rec) : worded ? editText({ kind: kind as Option["kind"], split_m: (x.split_m as number[] | null) ?? null,
    delta_m: delta ?? [0, 0, 0], trim: (trim as Option["trim"]) ?? null, edit }) : "";
  if (change && (kind !== "move" || edit?.summary)) out.change = change;

  if (typeof x.rationale === "string" && x.rationale.trim()) out.reason = { text: x.rationale.trim(), label: "AI-drafted", ...(out.model ? { by: out.model } : {}) };

  // Constraints considered: what the fix had to keep, meet and leave for someone else.
  const req = opts.requiredClearanceMm;
  if (req != null && Number.isFinite(req) && kind !== "trim" && kind !== "seat") out.constraints.push({ label: "Required clearance", value: `${Math.round(req)} mm` });
  if (rec?.blocked_by) out.constraints.push({ label: "Not edited because", value: rec.blocked_by });
  const meets = Array.isArray(x.meets) ? (x.meets as string[]).filter(Boolean) : [];
  if (meets.length) out.constraints.push({ label: "Requirements met", value: meets.join("; ") });
  const review = reviewText(typeof x.review === "string" ? x.review : null);
  if (review) out.constraints.push({ label: "Review needed", value: review });
  const needs = needsText(typeof x.also_needs === "string" ? x.also_needs : "");
  if (needs) out.constraints.push({ label: "Also needs", value: needs });
  if (opt) for (const [label, value] of hostRows(opt)) out.constraints.push({ label, value });

  if (state === "geometry_validated") {
    // An option always carries min_clearance_m (null: nothing within the 500 mm the check looks); an attempt does not,
    // and then no clearance is claimed.
    const measured = "min_clearance_m" in x;
    const min = typeof x.min_clearance_m === "number" ? Math.round(x.min_clearance_m * 1000) : null;
    const raw = x.checked_against ?? x.checked;
    const n = typeof raw === "number" && raw > 0 ? raw : null;
    const versus = req != null && Number.isFinite(req) && edit?.fit !== "fitted" ? ` vs ${Math.round(req)} mm required` : "";
    const [gap, proof] = kind === "trim" ? ["butt joint, no overlap", "butt joint: touching, not overlapping"]
      : kind === "seat" ? ["bears on its support", "bears on its support"]
      : !measured ? ["", ""]
      : min == null ? ["nothing within 500 mm", `nothing within 500 mm${versus}`]
      : [`${min} mm min clearance`, `min clearance ${min} mm${versus}`];
    out.expected = ["Clash gone", gap, n ? `nothing new hit in ${n} elements checked` : "nothing new hit"].filter(Boolean);
    out.evidence = [proof, n ? `checked against ${n} elements` : "checked against the model", "re-checked by geometry on accept"].filter(Boolean);
  } else if (state === "failed_validation") {
    const ids = Array.isArray(x.hit_ids) ? (x.hit_ids as string[]) : [];
    const reason = typeof x.reason === "string" ? x.reason : isObj(x.check) && typeof x.check.reason === "string" ? x.check.reason : "";
    out.failure = { reason: reason || "the geometry check refused it", hits: ids.map((id) => ({ id, name: nameOf(names, id) })) };
    out.evidence = ["refused by the geometry check"];
  } else {
    out.evidence = [state === "ai_proposed" ? "not checked by geometry yet" : "never tried on the model: no geometry evidence"];
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- decisions

/** The clash a decision is about: its id in the report, its stable key (`projectsApi.clashKey`, or `nw|<report>|<clash>`
 * for an imported one) and its #N. */
export interface ClashRef { id: string; key: string; number?: number | null }

const triple = (d: unknown): [number, number, number] | null =>
  Array.isArray(d) && d.length === 3 && d.every((v) => typeof v === "number" && Number.isFinite(v)) ? [d[0], d[1], d[2]] : null;

/** A decision for the journal (POST /api/scenes/{sid}/decisions). The state recorded is never more than the item's
 * own shape supports, and only a geometry-validated fix can be accepted (throws otherwise). */
export function toDecision(item: ProposalItem, state: ProposalState, decision: DecisionKind, reason: string | null | undefined,
  reviewer: string | null | undefined, clash: ClashRef, at: number = Date.now()): Decision {
  const x = item as unknown as Loose;
  const recorded = safeState(item, state);
  if (decision === "accepted" && recorded !== "geometry_validated") throw new Error("Only a geometry-validated fix can be accepted.");
  const moved = Array.isArray(x.moved) ? (x.moved as string[]) : typeof x.element === "string" && x.element ? [x.element] : [];
  const option: Decision["option"] = { title: String(x.title ?? ""), kind: typeof x.kind === "string" && x.kind ? x.kind : "move",
    moved: [...moved], delta_m: triple(x.delta_m) };
  if (typeof x.rationale === "string" && x.rationale.trim()) option.rationale = x.rationale.trim();
  const check: NonNullable<Decision["check"]> = { verified: recorded === "geometry_validated" };
  if (recorded === "geometry_validated") {
    check.min_clearance_m = typeof x.min_clearance_m === "number" ? x.min_clearance_m : null;
    const n = x.checked_against ?? x.checked;
    check.checked_against = typeof n === "number" ? n : null;
  } else if (recorded === "failed_validation" && typeof x.reason === "string" && x.reason) check.reason = x.reason;
  const out: Decision = { clash_id: clash.id, clash_key: clash.key, option, state: recorded, decision, at, check };
  if (clash.number != null) out.number = clash.number;
  if (reason?.trim()) out.reason = reason.trim();
  if (reviewer?.trim()) out.reviewer = reviewer.trim();
  return out;
}

const VERB: Record<DecisionKind, string> = {
  accepted: "Accepted", rejected: "Rejected", modified: "Modified by hand", requested_another: "Requested another",
};

/** A recorded decision in words: who, when, why. */
export function decisionWords(d: Decision): { verb: string; who: string; when: string; iso: string; why?: string } {
  const date = new Date(d.at);
  const ok = Number.isFinite(date.getTime());
  return {
    verb: VERB[d.decision] ?? d.decision,
    who: d.reviewer?.trim() || "reviewer not recorded",
    when: ok ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "time not recorded",
    iso: ok ? date.toISOString() : "",
    ...(d.reason?.trim() ? { why: d.reason.trim() } : {}),
  };
}
