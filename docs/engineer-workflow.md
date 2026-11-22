# Engineer-first workflow (Iris Engineering)

**AI proposes. Geometry proves. The engineer decides.**

The workflow: **Import → Understand → Detect → Investigate → Propose → Validate → Review → Report**, organised
around a **project**. Iris VisionBench (the Track 2 benchmark) is a separate pipeline (`server/iris_bench`, branch
`feature/iris-bench`) and never appears in the engineer's project workflow.

This file is the shared contract for the slices that implement it. Anything not listed as built here is not claimed.

## What exists vs. what this adds

| Step | Exists today | This change |
|---|---|---|
| 1 Projects | Nothing; one in-memory workspace, a restart loses it | `projects.py` + `/api/projects*`; a Projects home and a project overview |
| 2 Import | IFC / STEP upload with streamed stage events; one busy line; no retry | Per-file rows (type, stage, progress, error) and **Retry** with the same files |
| 3 Understand | Facet index (class, file, storey, systems, psets); no discipline summary | Model summary by discipline/system from the facet index, click to isolate. The HVAC / plumbing / electrical split is a **new IFC-class mapping**, labelled as such |
| 4 Detect | hard / clearance / duplicate tests, triage verdicts, severity | Coordination overview: classes, severity, status (pure client aggregation) |
| 5 Investigate | Clash panel, A/B/C views | Structured clash header (id, severity, elements, types, level, distance, status) |
| 6 Propose | `agent.Option` (rationale, moved, delta, meets, also_needs) | Proposal card: element, direction, distance, reason, constraints, expected outcome |
| 7 Validate | Geometry gate at propose and at keep (`plans.apply` → `recheck`) | Card states: **AI-proposed / Geometry-validated / Failed validation / Unverified**; `checked_against` kept in the journal; "as designed" never shown as geometry-validated |
| 8 Before/after | Before / After / Both in 3D | Unchanged; linked from the card |
| 9 Review | Accept (keep) and undo; reject is browser-only; no actor | **Decisions** recorded on the server: accepted / rejected / modified / requested another, with reason and reviewer |
| 10 Report | PDF / BCF per clash | Project name on the cover, GlobalIds, rationale, moved element + delta, checked-against count, required clearance, proposal history with decisions; triage optional (clashes not triaged listed by clash test as such) |

## Server contract

### Projects (`server/iris/projects.py`)

Stored under `IRIS_PROJECTS_DIR` (default `server/.iris-projects`, git-ignored; on Cloud Run `/mnt/iris/projects`).
One folder per project: `project.json`, `models/` (original files), `saved/<n>/` (edited files written with
`Workspace.file`), `reports/`. Writes are atomic (temp file + `os.replace`) under a per-project lock. Project ids
are unguessable (`secrets.token_hex(12)`); the browser keeps the ids it created. `IRIS_PROJECTS_MAX` caps how many
exist (default 50). Project files are never registered in a scene's temp roots (eviction must not delete them).

```ts
type Project = {
  id: string; name: string; created: number; updated: number;
  files: { name: string; kind: "IFC" | "STEP"; size: number; sha256: string }[];
  scene_id: string | null;            // the open session, if any
  saved: { n: number; at: number; files: string[]; edits: number }[];
  reviews: Record<string, Review>;    // key = clash key (below)
  reports: { doc_id: string; name: string; at: number; kind: "pdf" | "bcf" }[];
  counts?: { clashes: number; open: number; resolved: number; reviewed: number } | null;  // last known, from the page
};
type Review = { status: "open" | "by_design" | "author" | "resolved"; note?: string; by?: string; at: number;
                number?: number; title?: string };
```

**Clash key** (stable across re-detection): `` `${kind}|${[gidA, gidB].sort().join("|")}` `` where kind is the test
type. Imported Navisworks clashes use `nw|<report title>|<clash name>`.

| Route | Body | Returns |
|---|---|---|
| `GET /api/projects?ids=a,b` | ids the browser knows (owner: all when omitted) | `Project[]` |
| `POST /api/projects` | `{name}` | `Project` |
| `GET /api/projects/{pid}` | | `Project` |
| `PATCH /api/projects/{pid}` | `{name?, counts?}` | `Project` |
| `POST /api/projects/{pid}/attach` | `{scene_id}` | `Project` (copies the scene's original files into `models/`) |
| `POST /api/projects/{pid}/open` | | `{scene_id, project}` (opens saved state, else originals; seeds clash numbers and titles) |
| `POST /api/projects/{pid}/save` | `{scene_id}` | `Project` (edited files + journal entries + decisions) |
| `PUT /api/projects/{pid}/reviews` | `{key, status, note?, by?, number?, title?}` | `Project` |
| `POST /api/projects/{pid}/reports` | `{doc_id, name, kind}` | `Project` |

### Decisions (journal)

```ts
type Decision = {
  clash_id: string; clash_key: string; number?: number;
  option: { title: string; kind: string; moved: string[]; delta_m?: [number, number, number] | null; rationale?: string };
  state: "ai_proposed" | "geometry_validated" | "failed_validation" | "unverified";
  decision: "accepted" | "rejected" | "modified" | "requested_another";
  reason?: string; reviewer?: string; at: number;
  check?: { verified: boolean; min_clearance_m?: number | null; checked_against?: number | null; reason?: string };
  entry?: string; session?: string;   // set by a keep: the edit-log entry and the scene (session) that kept it
};
```

`POST /api/scenes/{sid}/decisions` appends to `Journal.decisions`; `GET /api/scenes/{sid}/edits` includes
`decisions`. `FixApply` and `PlanApply` take optional `reviewer` and `reason`; the keep records
`actor = reviewer` and `check = {verified, min_clearance_m, checked_against}` and appends an `accepted` decision.
A plan item whose strategy is "as designed" carries `check = {passed: false, geometry: false}`: it is never shown or
reported as geometry-validated (the chat says "accepted as designed — no geometry check").

A saved state's entries carry `session` (the scene id that kept them): E-ids start again in every session. A reopened
project's report labels a fix kept before from its saved check, "Geometry-validated at keep (earlier session)", when
this session kept none for the clash. `POST /api/reports/{rid}/document/stream` takes `project_id`: the project's
name on the cover and, with no live edit log, its newest saved state's decisions.

## Web contract

Navigation lives in the path (the History API; the first version used hashes, still read and replaced): `/home` (the
first screen), `/projects` (the list), `/projects/<pid>` (Overview) and `/projects/<pid>/<step>` with step one of
`models | drawings | coordination | clashes | reports | activity` (`/projects/<pid>/clashes/<n>`: clash #n open),
`/workspace` (a session outside a project), `/about`, `/settings`. The existing workspace (viewer, dock panels, clash
panel) stays as is; the project shell adds a step bar and routes each step to the panel that already does the work.

New files (each self-contained, props only, no direct App state):

| File | Purpose |
|---|---|
| `web/src/projectsApi.ts` | Typed calls for the routes above (uses `api.ts`'s request helper) |
| `web/src/projectRoute.ts` | Parse/format `#projects` and `#project/<pid>/<step>` (pure; mirrors `aboutRoute.ts`) |
| `web/src/ProjectsHome.tsx` | List, create, open projects; per-project status (files, open / resolved, last saved) |
| `web/src/ProjectOverview.tsx` | One project: models, coordination counts, unresolved / resolved, reports, recent activity, next step |
| `web/src/importRows.ts` + `ImportPanel.tsx` | Per-file import rows from the existing upload events; Retry |
| `web/src/modelSummary.ts` + `ModelSummary.tsx` | Discipline / system summary from the facet index; click to isolate |
| `web/src/coordination.ts` + `CoordinationOverview.tsx` | Classes / severity / status aggregation and the overview card |
| `web/src/ClashHeader.tsx` | Structured header for the clash investigation |
| `web/src/ProposalCard.tsx` | One proposal: state chip, element, direction, distance, reason, constraints, expected outcome, decision buttons |

### Classification (grounded in existing fields only)

| Class shown | Rule |
|---|---|
| Actual clash | `distance_m < 0` on a hard or clearance test, verdict `real_clash` or not yet triaged |
| Clearance issue | `test_type === "clearance"` and `distance_m >= 0` |
| Touching / boundary | triage `basis === "touch"`, plus the detector's touching count (counts only, no rows) |
| Intentional (by design) | verdict `by_design` (basis requirement, model, or reviewed), plus the detector's "meant to meet" count |
| Non-conflict | verdict `non_physical`, or basis `same_element` / `no_overlap` |
| Modelling error | verdict `modelling_error`, or a duplicate test: kept as its own bucket, not forced into the five |
| Not triaged | no triage yet |

**Severity** is the triage severity (`high` / `medium` / `low` / `none`), shown as High / Medium / Low and labelled
"AI-assessed". There is no fourth "critical" tier in the code, so none is shown.

**Status**: *Open*; *Fix kept, awaiting re-check* (in `fixes`, check stale); *Resolved by geometry* (the re-run
check's `diff.resolved`); *Reviewed: by design*; *Sent to author*.

### Save, the share closed, a fixed clash and the report (Nov 22)

- **Save** (`SaveButton`, the Overview's header and the workspace's step bar) says how it went: "Saving…", then
  "Saved ✓" for about 2 s, or "Not saved" with the reason in its tip.
- **The share closed** on the Overview is never rounded to a false claim (`closedText`): 1 of 464 is "<1% closed",
  463 of 464 ">99% closed".
- **A fixed clash** shows "Fixed ✓" in its panel: what was kept, Undo when the newest kept edit is its fix, and
  "Propose a different fix" as a secondary; no primary Propose fixes.
- **The report does not need triage.** A clash with a fix, a kept edit or a decision gets its page; one with no
  verdict, fix, edit, decision or mark is listed by clash test as "not triaged" (never as noise or as needing action),
  and the report stays DRAFT while any is. Triage only sorts them.

## Not built (stated plainly)

- DWG and DXF drawings (PDF drawings are read on the Drawings step: [docs/drawings.md](drawings.md)).
- Accounts: projects are private by unguessable id, not by login.
- Undo history across a reopened project: a saved state becomes the new baseline.
