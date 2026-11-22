import type { CheckSummary, ReportClash, TriageVerdict } from "./api";
import type { Review } from "./ReportList";

/** Coordination overview (docs/engineer-workflow.md, "Classification", "Severity", "Status"): a clash's class,
 * severity and status from the fields the page already holds, and the counts the overview card shows. Pure: no
 * state, no calls. Nothing here is measured or asked anew; every rule reads an existing field. */

export type ClashClass = "actual" | "clearance" | "touching" | "by_design" | "non_conflict" | "modelling_error" | "untriaged";
export type Severity = NonNullable<TriageVerdict["severity"]>;
export type ClashStatus = "open" | "fix_kept_pending_recheck" | "resolved_geometry" | "reviewed_by_design" | "sent_to_author";
/** What the overview's numbers filter the list by (each field optional; none: every clash). */
export interface CoordinationFilter { cls?: ClashClass; severity?: Severity; status?: ClashStatus }

/** In the contract's order. */
export const CLASSES: readonly ClashClass[] = ["actual", "clearance", "touching", "by_design", "non_conflict", "modelling_error", "untriaged"];
export const SEVERITIES: readonly Severity[] = ["high", "medium", "low", "none"];
export const STATUSES: readonly ClashStatus[] = ["open", "fix_kept_pending_recheck", "resolved_geometry", "reviewed_by_design", "sent_to_author"];

export const CLASS_INFO: Record<ClashClass, { label: string; tip: string; tone: "bad" | "warn" | "muted" | "" }> = {
  actual: { label: "Actual clash", tone: "bad",
    tip: "An overlap on a hard or clearance test, read as real by triage or not triaged yet" },
  clearance: { label: "Clearance issue", tone: "warn", tip: "Closer than the clearance test requires, without overlapping" },
  touching: { label: "Touching / boundary", tone: "muted", tip: "Faces that only meet: settled as a touch" },
  by_design: { label: "Intentional (by design)", tone: "",
    tip: "Read as by design: by a requirements rule, by the triage model, or marked not a clash" },
  non_conflict: { label: "Non-conflict", tone: "muted", tip: "Not physical, one element, or no overlap measured in the open model" },
  modelling_error: { label: "Modelling error", tone: "warn", tip: "For the model's author: read as a modelling error, or found by the duplicates test" },
  untriaged: { label: "Not triaged", tone: "muted", tip: "No triage reading yet, and the measure alone does not place it" },
};
export const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low", none: "None" };
export const STATUS_INFO: Record<ClashStatus, { label: string; tip: string }> = {
  open: { label: "Open", tip: "No fix kept and not reviewed" },
  fix_kept_pending_recheck: { label: "Fix kept, awaiting re-check", tip: "A fix was kept; the check that lists this clash has not run again since" },
  resolved_geometry: { label: "Resolved by geometry", tip: "The check, run again, no longer finds it with both elements still checked" },
  reviewed_by_design: { label: "Reviewed: by design", tip: "Marked not a clash: no model edit needed" },
  sent_to_author: { label: "Sent to author", tip: "Flagged for the model's author (a modelling error)" },
};

/** The test a clash came from, as the server reads it: no type is a hard test (triage.py, titles.py), and Navisworks
 * writes "hard_conservative" for its conservative hard test. */
export function testKind(c: Pick<ReportClash, "test_type">): "hard" | "clearance" | "duplicate" | "other" {
  const t = (c.test_type ?? "hard").toLowerCase();
  return t.startsWith("hard") ? "hard" : t.startsWith("clearance") ? "clearance" : t.startsWith("duplicate") ? "duplicate" : "other";
}

/** A usable triage reading: none, a failed read (asked again), or the model giving no answer is no reading. */
function reading(t?: TriageVerdict | null): TriageVerdict | null {
  return t && !t.error && t.verdict !== "unknown" ? t : null;
}

/** The class a clash is shown in (docs/engineer-workflow.md, "Classification"). Settled facts first (not physical,
 * one element, no overlap, a touch), then the verdict, then the test and its measure:
 * - Non-conflict: verdict non_physical, or basis same_element / no_overlap.
 * - Touching: basis touch.
 * - By design: verdict by_design (basis requirement, reviewed, or the model's own).
 * - Modelling error: verdict modelling_error, or a duplicate test.
 * - Actual: distance < 0 on a hard or clearance test, verdict real_clash or not triaged.
 * - Clearance issue: a clearance test with distance >= 0.
 * - Not triaged: no reading, and nothing above places it.
 * A real_clash the rows above do not place (no distance, or a test of another kind) stays an actual clash: triage's
 * word is the only one there is. */
export function classify(c: ReportClash, triage?: TriageVerdict | null): ClashClass {
  const t = reading(triage);
  if (t) {
    if (t.verdict === "non_physical" || t.basis === "non_physical" || t.basis === "same_element" || t.basis === "no_overlap") return "non_conflict";
    if (t.basis === "touch") return "touching";
    if (t.verdict === "by_design") return "by_design";
    if (t.verdict === "modelling_error") return "modelling_error";
  }
  const kind = testKind(c);
  if (kind === "duplicate") return "modelling_error";
  const d = c.distance_m;
  if (d != null && d < 0 && (kind === "hard" || kind === "clearance")) return "actual";   // here t is real_clash or none
  if (kind === "clearance" && d != null && d >= 0) return "clearance";
  return t ? "actual" : "untriaged";
}

/** Triage's severity (AI-assessed); null when there is no reading. There is no "critical" tier. */
export function severityOf(triage?: TriageVerdict | null): Severity | null {
  const s = triage && !triage.error ? triage.severity : undefined;
  return s && (SEVERITIES as readonly string[]).includes(s) ? s : null;
}

export interface StatusInputs {
  fixes: Record<string, string>;                 // App `fixes`: clash id → the fix kept for it
  reviewed: Record<string, Pick<Review, "kind">>; // App `reviewed`: clash id → { kind: "by_design" | "author" }
  resolvedIds?: ReadonlySet<string> | readonly string[];  // clash ids in a re-run check's diff.resolved
}

/** Where a clash stands. Geometry's proof first (the re-run check's diff.resolved), then a kept fix (its mark stays in
 * `fixes` until the check that lists the clash runs again: checks.pruneFixes), then a review (by design, else sent to
 * the author), else open. */
export function statusOf(c: Pick<ReportClash, "id">, { fixes, reviewed, resolvedIds }: StatusInputs): ClashStatus {
  if (resolvedIds && (resolvedIds instanceof Set ? resolvedIds.has(c.id) : (resolvedIds as readonly string[]).includes(c.id))) return "resolved_geometry";
  if (fixes[c.id]) return "fix_kept_pending_recheck";
  const rv = reviewed[c.id];
  if (rv?.kind === "by_design") return "reviewed_by_design";
  if (rv?.kind === "author") return "sent_to_author";
  return "open";
}

type CheckLike = Pick<CheckSummary, "coverage" | "diff">;

/** Every clash a kept check's latest run lists as resolved (gone, with both elements still checked against each other). */
export function resolvedIdsOf(checks: readonly CheckLike[] | null | undefined): Set<string> {
  return new Set((checks ?? []).flatMap((k) => k.diff?.resolved?.map((r) => r.id) ?? []));
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export interface CoordinationSummary {
  total: number;
  /** Clashes with a usable triage reading. */
  triaged: number;
  byClass: Record<ClashClass, number>;
  /** Of each class, the clashes placed with no triage reading (geometry and test only). */
  untriagedByClass: Record<ClashClass, number>;
  /** Triage severity per clash (AI-assessed); clashes without one are not counted. */
  bySeverity: Record<Severity, number>;
  /** Per listed clash; adds up to `total`. */
  byStatus: Record<ClashStatus, number>;
  /** The detector's touching pairs and pairs meant to meet (every "never a clash" rule), summed over `checks`: counts
   * only, no rows. Null without a check (an imported report has no coverage). */
  touchingCount: number | null;
  meantToMeetCount: number | null;
  /** Clashes the checks, run again, list as resolved (they have left the list). Null until a check has run again. */
  resolvedByGeometry: number | null;
  /** How many checks the counts above come from. */
  checks: number;
}

/** The overview's numbers for the clashes on the list. `triageById`: the triage as shown (App `shownTriage`, so what is
 * settled in this browser counts); `checks`: the kept checks behind the list (their coverage and diff). */
export function overview(clashes: readonly ReportClash[], triageById: Record<string, TriageVerdict | undefined>,
                         { fixes, reviewed, checks }: { fixes: Record<string, string>; reviewed: Record<string, Pick<Review, "kind">>;
                           checks?: readonly CheckLike[] | null }): CoordinationSummary {
  const ks = checks ?? [];
  const resolvedIds = resolvedIdsOf(ks);
  const byClass = zero(CLASSES), untriagedByClass = zero(CLASSES), bySeverity = zero(SEVERITIES), byStatus = zero(STATUSES);
  let triaged = 0;
  for (const c of clashes) {
    const t = triageById[c.id];
    const cls = classify(c, t);
    byClass[cls]++;
    if (reading(t)) triaged++; else untriagedByClass[cls]++;
    const s = severityOf(t);
    if (s) bySeverity[s]++;
    byStatus[statusOf(c, { fixes, reviewed, resolvedIds })]++;
  }
  const sum = (f: (k: CheckLike) => number) => (ks.length ? ks.reduce((n, k) => n + f(k), 0) : null);
  return {
    total: clashes.length, triaged, byClass, untriagedByClass, bySeverity, byStatus,
    touchingCount: sum((k) => k.coverage.reduce((n, c) => n + c.touching, 0)),
    meantToMeetCount: sum((k) => k.coverage.reduce((n, c) => n + Object.values(c.excluded).reduce((x, y) => x + y, 0), 0)),
    resolvedByGeometry: ks.some((k) => k.diff && !k.diff.first) ? resolvedIds.size : null,
    checks: ks.length,
  };
}

/** Whether a clash passes the overview's filter (its class, severity and status, each when set). */
export function passes(c: ReportClash, triage: TriageVerdict | undefined, status: ClashStatus, f: CoordinationFilter): boolean {
  return (!f.cls || classify(c, triage) === f.cls) && (!f.severity || severityOf(triage) === f.severity) && (!f.status || status === f.status);
}

/** The clash key the project's reviews are stored under (docs/engineer-workflow.md, "Clash key"): stable across
 * re-detection. A clash Iris found: `<test type>|<GlobalId>|<GlobalId>` (sorted). An imported Navisworks clash:
 * `nw|<report title>|<clash name>`, the name being Navisworks' own ("Clash39", `ref`; else the plain name). */
export function clashKey(c: ReportClash, reportTitle?: string | null): string {
  if (c.source !== "iris") return `nw|${reportTitle ?? ""}|${c.ref ?? c.name}`;
  return `${c.test_type ?? "hard"}|${[c.a.global_id ?? "", c.b.global_id ?? ""].sort().join("|")}`;
}

/** "Overlap 300 mm", "Gap 12 mm", "Touching 0 mm": the clash's signed distance as an engineer reads it. */
export function distanceText(c: Pick<ReportClash, "distance_m">): { label: string; value: string } {
  const d = c.distance_m;
  if (d == null) return { label: "Distance", value: "—" };
  const mmAbs = Math.abs(d) * 1000;
  const value = mmAbs > 0 && mmAbs < 0.5 ? `${mmAbs.toFixed(1)} mm` : `${Math.round(mmAbs)} mm`;
  return { label: d < 0 ? "Overlap" : d > 0 ? "Gap" : "Touching", value };
}

/** The test's limit: the required clearance on a clearance test (Iris stores it in tolerance_m), else the tolerance. */
export function limitText(c: Pick<ReportClash, "test_type" | "tolerance_m">): { label: string; value: string } | null {
  if (c.tolerance_m == null) return null;
  return { label: testKind(c) === "clearance" ? "Required clearance" : "Tolerance", value: `${Math.round(c.tolerance_m * 1000)} mm` };
}

/** Where it is, from the report only: the level (one, or A's and B's when they differ) and the grid, when given. */
export function locationText(c: Pick<ReportClash, "a" | "b" | "grid">): string | null {
  const la = c.a.level, lb = c.b.level;
  const level = la && lb && la !== lb ? `A ${la} · B ${lb}` : la ?? lb ?? null;
  const parts = [level, c.grid ? `grid ${c.grid}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
