import { ApiError, apiSend, type AgentEvent, type Option, type Proposal, type ReportClash, type TriageVerdict } from "./api";
import { testKind } from "./coordination";
import type { Rejection } from "./fixKinds";
import { stateOf } from "./proposalState";

/** The review queue's logic (docs/review-queue.md): which clashes "Prepare fixes" sends, the prepare stream, the shared
 * prepare store (it outlives the queue being closed, so the entry point can say "Preparing fixes: 3 of 8"), the
 * progress words, the keyboard map and auto-advance. No React here. AI proposes, geometry proves, the engineer
 * decides: nothing here keeps a fix; Accept in the queue goes through the keep route. */

/** At most this many clashes per run (the server's `plans.MAX_ITEMS`). */
export const MAX_ITEMS = 8;

// ------------------------------------------------------------------------------------------------- the pick

export type PickSource = "ticked" | "triage" | "deepest";
export interface ReviewPick {
  clash_ids: string[];
  pick: "ids" | "deepest";
  source: PickSource;
  /** How many the run is for (for "deepest", at most this many: the server picks them). */
  count: number;
  /** How many there were before the cap. */
  of: number;
  /** The source in words, for the entry's one-line why: "the 5 you ticked". */
  why: string;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const severityRank = (t?: TriageVerdict) => SEVERITY_RANK[t?.severity ?? ""] ?? 3;
const depth = (c: ReportClash) => (typeof c.distance_m === "number" && Number.isFinite(c.distance_m) ? c.distance_m : 0);

/** Which clashes to prepare: the ticked ones still open; else the open clashes triage read as real (high → medium →
 * low severity, then deepest); else the deepest open hard clashes, picked by the server (no triage yet). */
export function pickForReview({ clashes, triage, ticked, fixed, max = MAX_ITEMS }: {
  clashes: readonly ReportClash[]; triage: Record<string, TriageVerdict> | null | undefined;
  ticked: Iterable<string> | null | undefined; fixed: Iterable<string> | null | undefined; max?: number;
}): ReviewPick {
  const done = new Set(fixed ?? []);
  const open = clashes.filter((c) => !done.has(c.id));
  const mine = new Set(ticked ?? []);
  const chosen = open.filter((c) => mine.has(c.id));
  if (chosen.length) {
    const ids = chosen.slice(0, max).map((c) => c.id);
    const n = ids.length, of = chosen.length;
    return { clash_ids: ids, pick: "ids", source: "ticked", count: n, of,
      why: n < of ? `the first ${n} of the ${of} you ticked` : n === 1 ? "the clash you ticked" : `the ${n} you ticked` };
  }
  const verdicts = triage ?? {};
  const real = open.filter((c) => { const t = verdicts[c.id]; return !!t && !t.error && t.verdict === "real_clash"; })
    .sort((x, y) => severityRank(verdicts[x.id]) - severityRank(verdicts[y.id]) || depth(x) - depth(y));
  if (real.length) {
    const ids = real.slice(0, max).map((c) => c.id);
    const n = ids.length, of = real.length;
    return { clash_ids: ids, pick: "ids", source: "triage", count: n, of,
      why: n < of ? `the ${n} most severe of the ${of} real clashes triage found`
        : n === 1 ? "the real clash triage found" : `the ${n} real clashes triage found` };
  }
  const deep = open.filter((c) => testKind(c) === "hard" && depth(c) < 0).length;
  return { clash_ids: [], pick: "deepest", source: "deepest", count: Math.min(max, deep), of: deep,
    why: "the deepest open clashes (no triage yet)" };
}

// ------------------------------------------------------------------------------------------------- the stream

export interface PrepareBody { report_id: string; clash_ids: string[]; pick: "ids" | "deepest"; fixed: string[] }
export interface PrepStartItem {
  key: string; clash_ids: string[]; element_a: string; element_b: string; label?: string; distance_m?: number | null; saved?: boolean;
}
/** The saved set in use (server: prepare.Saved.info): its label, the model's label, when it was made. */
export interface SavedSet { label?: string; model?: string; made?: string | number }
export type PrepareEvent =
  | { type: "prepare_start"; total?: number; items?: PrepStartItem[]; skipped?: number | unknown[]; saved?: SavedSet | null }
  | { type: "item"; key: string; status?: string; title?: string; passed?: boolean; ok?: boolean; reason?: string }
  | { type: "prepared"; key: string; clash_ids?: string[]; element_a?: string; element_b?: string; label?: string;
      distance_m?: number | null; status?: "ready" | "failed"; source?: "live" | "saved"; options?: Option[];
      understanding?: string; why?: string; tried?: number; model?: string; done?: number; total?: number; clearance_m?: number | null }
  | { type: "done"; ready?: number; failed?: number; total?: number; seconds?: number }
  | { type: "error"; detail?: string };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The server's words in a refusal: `detail` as a string, or FastAPI's list of field errors. */
function detailOf(body: unknown): string | null {
  const d = (body as { detail?: unknown } | null)?.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d)) return d.map((x) => (x as { msg?: string })?.msg ?? String(x)).filter(Boolean).join("; ") || null;
  return null;
}

/** Prepare fixes on the server (POST /api/scenes/{sceneId}/prepare/stream) and read its NDJSON events. A refusal (404,
 * 422 nothing to prepare, 429 the proposal cap) throws an ApiError with the server's words. */
export async function prepareFixes(sceneId: string, body: PrepareBody, onEvent: (e: PrepareEvent) => void,
  signal?: AbortSignal, fetchImpl: FetchLike = apiSend): Promise<void> {
  const r = await fetchImpl(`/api/scenes/${sceneId}/prepare/stream`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw new ApiError(detailOf(await r.json().catch(() => null)) ?? `Request failed (${r.status})`, r.status);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0 || (done && buffer.trim())) {
        const line = (nl >= 0 ? buffer.slice(0, nl) : buffer).trim();
        buffer = nl >= 0 ? buffer.slice(nl + 1) : "";
        if (signal?.aborted) return;
        if (!line) continue;
        let e: PrepareEvent;
        try { e = JSON.parse(line) as PrepareEvent; } catch { continue; }   // a line that is not JSON is not an event
        if (e && typeof e === "object" && typeof e.type === "string") onEvent(e);
      }
      if (done) return;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

// ------------------------------------------------------------------------------------------------- the store

export type ItemStatus = "waiting" | "preparing" | "ready" | "failed";
export type ItemDecision = "pending" | "accepted" | "rejected" | "requested" | "no_longer_passes";
export interface PrepItem {
  key: string; clash_ids: string[]; element_a: string; element_b: string; label: string; distance_m: number | null;
  /** The saved set holds this pair (replayed, then checked by geometry here). */
  saved: boolean;
  status: ItemStatus;
  /** What is happening to it now, in words ("Checking … on the geometry"). */
  stage: string | null;
  source: "live" | "saved" | null;
  /** Only options whose shape says geometry passed them (proposalState.stateOf); the best first. */
  options: Option[];
  understanding: string; why: string; tried: number; model: string; clearance_m: number | null;
  decision: ItemDecision;
  /** The reviewer's reason (rejected), the server's words (no longer passes), or why another was not prepared. */
  note: string;
  /** Fixes set aside for this clash: told to the model when the reviewer requests another. */
  rejections: Rejection[];
}
export interface PrepState {
  /** `sceneId|reportId`: a different scene or clash list starts again. */
  scope: string;
  started: boolean; running: boolean; error: string | null;
  items: PrepItem[];
  saved: SavedSet | null; skipped: number; total: number; seconds: number | null;
}

export const scopeOf = (sceneId: string, reportId: string) => `${sceneId}|${reportId}`;
export const emptyPrep = (scope = ""): PrepState =>
  ({ scope, started: false, running: false, error: null, items: [], saved: null, skipped: 0, total: 0, seconds: null });

const STAGE: Record<string, string> = { thinking: "Iris is working out a fix", checking: "Geometry is checking the ideas" };
const str = (x: unknown, or = "") => (typeof x === "string" ? x : or);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function newItem(x: PrepStartItem): PrepItem {
  return { key: String(x.key), clash_ids: Array.isArray(x.clash_ids) ? x.clash_ids.map(String) : [], element_a: str(x.element_a),
    element_b: str(x.element_b), label: str(x.label), distance_m: num(x.distance_m), saved: !!x.saved, status: "waiting",
    stage: null, source: null, options: [], understanding: "", why: "", tried: 0, model: "", clearance_m: null,
    decision: "pending", note: "", rejections: [] };
}

function patch(s: PrepState, key: string, fn: (it: PrepItem) => PrepItem): PrepState {
  const i = s.items.findIndex((it) => it.key === key);
  if (i < 0) return s;
  const next = fn(s.items[i]);
  if (next === s.items[i]) return s;
  const items = s.items.slice();
  items[i] = next;
  return { ...s, items };
}

/** Items the run left unfinished: failed, with why. */
function settle(s: PrepState, why: string): PrepState {
  if (!s.items.some((it) => it.status === "waiting" || it.status === "preparing")) return s;
  return { ...s, items: s.items.map((it) => (it.status === "waiting" || it.status === "preparing" ? { ...it, status: "failed", stage: null, why } : it)) };
}

/** One stream event into the state. Pure. */
export function reducePrepare(s: PrepState, e: PrepareEvent): PrepState {
  switch (e.type) {
    case "prepare_start": {
      const items = (Array.isArray(e.items) ? e.items : []).filter((x) => x && x.key != null).map(newItem);
      const skipped = Array.isArray(e.skipped) ? e.skipped.length : num(e.skipped) ?? 0;
      return { ...s, started: true, running: true, error: null, items, saved: e.saved ?? null, skipped, total: num(e.total) ?? items.length, seconds: null };
    }
    case "item":
      return patch(s, String(e.key), (it) => {
        if (it.status === "ready" || it.status === "failed") return it;
        const raw = str(e.status);
        const stage = raw === "checking" && e.title ? `Checking “${e.title}” on the geometry` : STAGE[raw] ?? it.stage;
        return { ...it, status: "preparing", stage };
      });
    case "prepared": {
      const key = String(e.key);
      const s2 = s.items.some((it) => it.key === key) ? s
        : { ...s, items: [...s.items, newItem({ key, clash_ids: e.clash_ids ?? [], element_a: str(e.element_a), element_b: str(e.element_b), label: e.label, distance_m: e.distance_m })] };
      return patch(s2, key, (it) => {
        const options = (Array.isArray(e.options) ? e.options : []).filter((o) => stateOf(o) === "geometry_validated");
        const ready = e.status !== "failed" && options.length > 0;
        const why = ready ? "" : str(e.why) || (e.status === "ready" ? "No option came back verified by geometry." : "No fix passed the geometry check.");
        return { ...it, status: ready ? "ready" : "failed", stage: null, options, why, decision: "pending",
          source: e.source === "saved" || e.source === "live" ? e.source : it.source,
          understanding: str(e.understanding, it.understanding), tried: num(e.tried) ?? it.tried, model: str(e.model, it.model),
          clearance_m: num(e.clearance_m) ?? it.clearance_m,
          element_a: str(e.element_a, it.element_a) || it.element_a, element_b: str(e.element_b, it.element_b) || it.element_b,
          clash_ids: Array.isArray(e.clash_ids) && e.clash_ids.length ? e.clash_ids.map(String) : it.clash_ids };
      });
    }
    case "done":
      return settle({ ...s, running: false, seconds: num(e.seconds) }, "The run ended before this clash was prepared.");
    case "error": {
      const detail = str(e.detail) || "Preparing stopped.";
      return settle({ ...s, running: false, error: detail }, `Preparing stopped: ${detail}`);
    }
    default:
      return s;
  }
}

export interface PrepareStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PrepState;
  /** Show this scene's clash list: a different one starts empty (and stops a run for the old one). */
  use(sceneId: string, reportId: string): void;
  /** Prepare fixes, once at a time. Resolves when the run ends (its outcome is in the state). */
  start(sceneId: string, body: PrepareBody): Promise<void>;
  /** A decision on one item (only within the scope it was made in). */
  decide(scope: string, key: string, decision: ItemDecision, note?: string): void;
  update(scope: string, key: string, fn: (it: PrepItem) => PrepItem): void;
}

/** The prepare state, kept outside React so it outlives the queue (useSyncExternalStore reads it). */
export function createPrepareStore(fetchImpl?: FetchLike): PrepareStore {
  let state = emptyPrep();
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PrepState) => {
    if (next === state) return;
    state = next;
    for (const fn of [...listeners]) fn();
  };
  const store: PrepareStore = {
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    use(sceneId, reportId) {
      const scope = scopeOf(sceneId, reportId);
      if (state.scope === scope) return;
      controller?.abort();
      controller = null;
      set(emptyPrep(scope));
    },
    async start(sceneId, body) {
      const scope = scopeOf(sceneId, body.report_id);
      store.use(sceneId, body.report_id);
      if (state.running) return;
      const mine = new AbortController();
      controller = mine;
      set({ ...emptyPrep(scope), started: true, running: true });
      const live = () => controller === mine && state.scope === scope;
      try {
        await prepareFixes(sceneId, body, (e) => { if (live()) set(reducePrepare(state, e)); }, mine.signal, fetchImpl ?? apiSend);
        if (live() && state.running) set(reducePrepare(state, { type: "error", detail: "The server stopped before every clash was prepared." }));
      } catch (err) {
        if (!live() || mine.signal.aborted) return;
        const detail = (err as Error)?.message || "Preparing failed.";
        set({ ...settle(state, `Preparing stopped: ${detail}`), running: false, error: detail });
      } finally {
        if (controller === mine) controller = null;
      }
    },
    decide(scope, key, decision, note = "") {
      if (state.scope === scope) set(patch(state, key, (it) => ({ ...it, decision, note })));
    },
    update(scope, key, fn) {
      if (state.scope === scope) set(patch(state, key, fn));
    },
  };
  return store;
}

/** The one store the page uses. */
export const prepareStore = createPrepareStore();

// ------------------------------------------------------------------------------------------------- words

const finished = (it: PrepItem) => it.status === "ready" || it.status === "failed";
const toReview = (it: PrepItem) => it.status === "ready" && it.decision === "pending";

/** The entry point's words: "Prepare fixes (8)", then "Preparing fixes: 3 of 8", then "Review fixes (6 ready)". */
export function prepareText(s: PrepState | null | undefined, count = 0): string {
  const items = s?.items ?? [];
  if (s?.running) return items.length ? `Preparing fixes: ${items.filter(finished).length} of ${items.length}` : "Preparing fixes…";
  if (!items.length) return `Prepare fixes (${count})`;
  return `Review fixes (${items.filter(toReview).length} ready)`;
}

/** The queue's progress: "3 of 8 reviewed · 2 accepted · 1 rejected". */
export function reviewText(s: PrepState | null | undefined): string {
  const items = s?.items ?? [];
  const accepted = items.filter((it) => it.decision === "accepted").length;
  const rejected = items.filter((it) => it.decision === "rejected").length;
  return [`${accepted + rejected} of ${items.length} reviewed`, accepted ? `${accepted} accepted` : "", rejected ? `${rejected} rejected` : ""]
    .filter(Boolean).join(" · ");
}

/** "Saved AI proposals for this sample (Gemini Pro, 22 Nov 2026)". Empty when no saved set is in use. */
export function savedLabel(saved: SavedSet | null | undefined): string {
  if (!saved) return "";
  const label = str(saved.label).trim();
  const own = /^saved\b/i.test(label);
  const model = (own ? "" : label) || str(saved.model).trim();
  const inner = [model, madeDate(saved.made)].filter(Boolean).join(", ");
  return `${own ? label : "Saved AI proposals for this sample"}${inner ? ` (${inner})` : ""}`;
}
function madeDate(made: unknown): string {
  if (made == null || made === "") return "";
  const ms = typeof made === "number" ? (made < 1e12 ? made * 1000 : made) : Date.parse(String(made));
  if (!Number.isFinite(ms)) return String(made);
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A clash's overlap as the list shows it: "−300 mm" (a true minus), or the gap ("20 mm"). */
export function distanceText(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "";
  const v = Math.round(m * 1000);
  return v < 0 ? `−${-v} mm` : `${v} mm`;
}

/** A status pill per clash: its class and its words. */
export function pillOf(it: Pick<PrepItem, "status" | "decision">): { cls: string; label: string } {
  if (it.decision === "accepted") return { cls: "accepted", label: "Accepted" };
  if (it.decision === "rejected") return { cls: "rejected", label: "Rejected" };
  if (it.decision === "no_longer_passes") return { cls: "stale", label: "No longer passes" };
  if (it.decision === "requested") return { cls: "preparing", label: "Preparing another" };
  return { waiting: { cls: "waiting", label: "Waiting" }, preparing: { cls: "preparing", label: "Preparing" },
    ready: { cls: "ready", label: "Ready" }, failed: { cls: "failed", label: "No verified fix" } }[it.status];
}

/** What a second proposal is doing, in words (from api.proposeStream's events); null for events not worth a line. */
export function anotherStage(e: AgentEvent): string | null {
  switch (e.type) {
    case "thinking": return `Iris is working out another fix (round ${e.round})`;
    case "ideas": return `${e.count} idea${e.count === 1 ? "" : "s"}: geometry is checking them`;
    case "checking": return `Checking “${e.title}” on the geometry`;
    case "attempt": return e.passed ? `“${e.title}” passed the geometry check` : `“${e.title}” did not pass: ${e.reason}`;
    default: return null;
  }
}

/** What went wrong, in plain words. A server error (a Python exception's `RuntimeError: …`, a traceback, a model's
 * status code) or a browser one ("Failed to fetch") becomes a sentence a reviewer can act on, with the raw words kept
 * as `detail` (for a tooltip, never printed). Plain words (geometry's why, the requirements, the saved set's miss)
 * pass through with no detail. A lead such as "Preparing stopped: " is kept. `model`: the AI model's name, if known. */
export function plainError(raw: string | null | undefined, model?: string | null): { text: string; detail: string } {
  const all = String(raw ?? "").trim();
  const lead = /^((?:Preparing stopped|Another fix was not prepared|Not kept|The rejection was not recorded|The request was not recorded)[^:\n]*: )/.exec(all)?.[1] ?? "";
  const rest = all.slice(lead.length);
  const technical = /Traceback \(most recent call last\)|(?:^|[\s(])[A-Z]\w*(?:Error|Exception|Exceeded|Timeout|Miss)\b|Failed to fetch|NetworkError|\b(?:status|code|HTTP) ?[45]\d\d\b|\b[45]\d\d (?:[A-Z][a-z]+ ?)+\b/.test(rest);
  if (!technical) return { text: all, detail: "" };
  const who = (model ?? "").trim() || "The AI model";
  const lines = rest.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = /^Traceback/.test(lines[0] ?? "") ? lines[lines.length - 1] ?? "" : lines.join(" ");
  const detail = last.length > 300 ? `${last.slice(0, 299)}…` : last;
  const rules: [RegExp, string][] = [
    [/no model configured|GEMINI_API_KEY|GOOGLE_CLOUD_PROJECT|DefaultCredentials|credentials were not found|no model client may be built/i,
      "No AI model is configured on this server, so no fix was prepared."],
    [/timed? ?out|timeout|deadline|\b504\b/i, `${who} didn't answer in time.`],
    [/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i, `${who} is busy (too many requests): try again in a minute.`],
    [/\b40[13]\b|PERMISSION_DENIED|UNAUTHENTICATED|permission denied/i, "This server is not allowed to use the AI model."],
    [/JSONDecodeError|Expecting value|could not parse|invalid json/i, `${who}'s answer could not be read.`],
    [/\b50[023]\b|UNAVAILABLE|ServiceUnavailable|ServerError|InternalServerError/i, `${who} had a problem answering: try again.`],
    [/Failed to fetch|NetworkError|network/i, "The server could not be reached."],
  ];
  const text = rules.find(([re]) => re.test(rest))?.[1] ?? "Something went wrong on the server.";
  return { text: `${lead}${text}`, detail };
}

/** Why a second proposal found no verified fix, honestly: the requirements, else what geometry refused. */
export function failedWhy(p: Pick<Proposal, "attempts" | "advice" | "recommendation">): string {
  if (p.recommendation?.blocked_by) return `The requirements allow no edit here: ${p.recommendation.blocked_by}.`;
  const attempts = Array.isArray(p.attempts) ? p.attempts : [];
  const last = [...attempts].reverse().find((a) => !a.passed && a.reason)?.reason;
  const head = attempts.length ? `None of the ${attempts.length} fixes tried passed the geometry check` : "No fix passed the geometry check";
  return `${head}${last ? `: ${last}` : "."}${p.advice ? ` ${p.advice}` : ""}`;
}

// ------------------------------------------------------------------------------------------------- moving through

/** The first item ready to review, or -1. */
export function firstOpen(items: readonly Pick<PrepItem, "status" | "decision">[]): number {
  return items.findIndex((it) => it.status === "ready" && it.decision === "pending");
}

/** After a decision: the next item ready and not yet decided, after `from`, wrapping round; failed, waiting and decided
 * items are skipped. Stays at `from` when there is none. */
export function nextIndex(items: readonly Pick<PrepItem, "status" | "decision">[], from: number): number {
  const n = items.length;
  for (let k = 1; k < n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (items[i].status === "ready" && items[i].decision === "pending") return i;
  }
  return from;
}

export type KeyAction = "accept" | "reject" | "next" | "prev" | "close";
export interface KeyLike {
  key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean;
  defaultPrevented?: boolean; target?: unknown;
}

/** Whether a key went to something the person is typing in. */
function typing(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown; closest?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  return typeof el.closest === "function" && !!(el.closest as (s: string) => unknown).call(el, "[contenteditable]:not([contenteditable=false])");
}

/** The queue's keys: A accept, R reject, → next, ← previous, Escape close. Never with a modifier, a held key (A, R) or
 * while typing in a field. */
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || typing(e.target)) return null;
  switch (e.key) {
    case "a": case "A": return e.repeat ? null : "accept";
    case "r": case "R": return e.repeat ? null : "reject";
    case "ArrowRight": return "next";
    case "ArrowLeft": return "prev";
    case "Escape": return "close";
    default: return null;
  }
}
