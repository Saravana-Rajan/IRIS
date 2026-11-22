import { ArrowRight, Bot, Boxes, Brain, Building2, Check, ChevronRight, CircleCheck, ClipboardCheck, ClipboardPlus, Download, FileSpreadsheet, FileText, FolderOpen, Hand, LayoutPanelLeft, List, LocateFixed, MessageSquare, Move, Navigation, Network, Plug, Plus, Radar, RotateCcw, Sparkles, Trash2, TriangleAlert, Upload, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ActivityLine, statusLine, type ActivityView, type Progress } from "./Activity";
import { BuiltView, builtStep, cutText, type BuiltRun } from "./BuiltView";
import { changeText, clearanceText, editText, framePieces, isAiReading, kindLabel, needsText, optionKey, recEditText, rejectionNotes, reviewText, type Rejection } from "./fixKinds";
import { ChatPanel } from "./Chat";
import { ChatRequestOwner } from "./chatRequest";
import { ReportDialog, ReviewBlock } from "./ReportDoc";
import type { AddedModels, AgentLink, BuiltResult, EditCheck, EditKept, EscalationInfo, Journal, JournalEntry, Stepped, LinkEvent, OpenedScene, OwnerSettings, Patch, Piece, SavedSession, SceneInfo, TriageModel } from "./api";
import { OwnerSettingsMenu } from "./Owner";
import { CELL, Tour, TOUR, TOUR_QUESTION, type TourActions, type TourState } from "./Tour";
import { RequirementsDialog } from "./Requirements";
import { ProjectStart } from "./ProjectStart";
import { localFile, uploadRefusal, uploadStatus } from "./uploads";
import { addableSamples, addRefusal, clashesWith, editsIn, isMachine, removalWarning, shiftHidden, waitFor } from "./sceneModels";
import { countsText, highlightGroups, indexGraph, LINK_COLOURS, type LinkIndex } from "./links";
import { loadSignoffs, migrateTitleKeyed, saveSignoffs, signoffScope } from "./signoffs";
import { addByDesign, addPenetration, hasByDesign, hasPenetration, load as loadRequirements, save as saveRequirements, shortLabel, type Saved as SavedRequirements } from "./reqFile";
import { setGoneHandler, setRequirements, type Recommendation, type Requirements, type RuleAudit } from "./api";
import { api, ApiError, type Demo, type ElementProperties, type CheckSummary, type DetectEvent, type DetectSetup, type DetectTest, type ContextEvent, type ContextObjective, type ContextProposal, type Evidence, type Signoff, type Team, type AgentEvent, type ChatEvent, type Matches, type Measure, type Option, type Pattern, type PatternVerdict, type Plan, type PlanEvent, type PlanItem, type Proposal, type Report, type ReportClash, type RootCause, type TriageKind, type TriageVerdict, type Verdict } from "./api";
import { projectName } from "./About";
import { StartScreen } from "./StartScreen";
import { aboutTabNow, type AboutTab } from "./aboutRoute";
import { AgentDialog, timeLeft, type AgentLogEntry } from "./Agent";
import { ClashPanel, Lightbox } from "./ClashPanel";
import { PlanPanel, type PlanRun } from "./PlanPanel";
import { ContextPlan, contextStep, type ContextRun } from "./ContextPlan";
import { Insights } from "./Insights";
import { TriageCard, type TriageRun } from "./Triage";
import { CheckPicker, DetectSetupCard, DetectSummary, type DetectProgress } from "./Detect";
import { narrow, pruneFixes, sameClash } from "./checks";
import { ReportList, clashLabel, mm, type Review } from "./ReportList";
import { noClash, shownVerdicts } from "./noClash";
import { Tooltips } from "./ui";
import { Pilot, type PilotStatus } from "./pilot";
import { Viewer, serverPointToViewer, type BuiltPasses, type Mesh, type Preset, type Side, type Staged, type ViewMode, type VisualStyle } from "./viewer/Viewer";
import { ViewerToolbar, STYLES, type ToolbarState, type ViewsControls } from "./ViewerToolbar";
import { escStep, type DrawingsShow, type Filters, type Layout, type Pose, type Temporary } from "./viewer/views";
import { ViewPanes } from "./ViewPanes";
import { MeasurePanel } from "./MeasurePanel";
import { EditPanel } from "./EditPanel";
import { EditTool, type EditToolHandle } from "./EditTool";
import { follow, useCoarse, useLayout, type Happening, type Snap } from "./layout";
import { SheetBar } from "./Sheet";
import { MenuSheet } from "./AppMenu";
import { shortNames } from "./names";
import { DEFAULT_AI_NAMES, setAiNames, type AiNames } from "./aiNames";
import { ApertureMark, KeptToast, LoadCard, serverLine, type LoadProgress, type NotchStatus } from "./Brand";
import { DockHost, SlotHost, inSlot, usePanelSlots, type DockHandle } from "./dock";
import { FiltersPanel, blankRule } from "./FiltersPanel";
import { ElementCard, type CardActions } from "./ElementCard";
import { EMPTY as NO_FILTERS, applied, complete, evaluate, legend, matching, migrate, prepare, shareable, withBy, zoomTarget, type FacetIndex, type FilterState, type Rule } from "./filters";
import { CLASSIC_KEY, PANE, PANELS, isPanel, type PanelId } from "./dockLayout";
import { runs, type Origin, type RunHandle, type RunKind } from "./runlog";
import type { Peek } from "./workingsGraph";
import { ImportPanel } from "./ImportPanel";
import { applyDraw, applyEvent, drawnUpTo, failAll, initRows, removeRow, sendableFiles, type ImportRow } from "./importRows";
import { ModelSummary } from "./ModelSummaryPanel";
import { CoordinationOverview } from "./CoordinationOverview";
import { ClashHeader } from "./ClashHeader";
import { CLASS_INFO, SEVERITY_LABEL, STATUS_INFO, clashKey as coordClashKey, overview as coordOverview, passes, resolvedIdsOf, statusOf, undoableFix, type CoordinationFilter } from "./coordination";
import { ProposalCard } from "./ProposalCard";
import { ReviewFixesEntry, ReviewQueue } from "./ReviewQueue";
import { STATE_LABEL, decisionWords, stateOf, toDecision, type Decision, type DecisionKind, type ProposalItem } from "./proposalState";
import { NewProjectDialog, PROJECT_FLOW, ProjectsHome } from "./ProjectsHome";
import { ProjectOverview, SaveButton } from "./ProjectOverview";
import { PROJECTS_PATH, currentPath, currentProjectRoute, legacyPath, projectPath, showPath, showProjectRoute, stepLabel, type ProjectRoute, type ProjectStep } from "./projectRoute";
import { addReport, attachScene, createProject, forgetProject, getProject, listProjects, myProjectIds, openProject, patchProject, plural, pruneProjectIds, rememberProject, saveProject, toMs, type ActivityItem, type CoordCounts, type Project } from "./projectsApi";
import { SearchBox, Sidebar, TopBar, type SearchHit } from "./AppShell";
import { browserStorage, readRail, writeRail, type NavId } from "./shellNav";
import { PageHeader, type Crumb } from "./PageHeader";
import { EmptyState } from "./Holo";
import { DrawingsPanel } from "./DrawingsPanel";
import { addSampleDrawings, compareDrawings, drawingItems, listDrawings, readDrawing, uploadDrawings, type Comparison, type Drawing, type Item as DrawingItem } from "./drawingsApi";
import { demoOfFiles, openSampleDrawings, SAMPLE_DRAWINGS_BUSY } from "./sampleDrawings";
import type * as THREE from "three";

type Stats = { elements: number; triangles: number; parseMs: number };
/** Workings in the Activity panel (docs/workings.md): on or off, and the view the panel shows (Workings by default). */
const WORKINGS_KEY = "iris.workings";
type WorkingsSetting = { on: boolean; view: ActivityView };
function readWorkings(): WorkingsSetting {
  try {
    const w = JSON.parse(localStorage.getItem(WORKINGS_KEY) ?? "null") as WorkingsSetting | null;
    if (w && typeof w.on === "boolean" && (w.view === "steps" || w.view === "work")) return w;
  } catch { /* a private window: the default */ }
  return { on: true, view: "work" };
}
/** The bottom bar's height for Workings: it grows to this for a run when it is shorter than WORKINGS_SHORT. */
const WORKINGS_HEIGHT = 380, WORKINGS_SHORT = 240;
/** A saved view (docs/views.md): camera, projection, style, mode, visibility and section box. */
type SavedView = { name: string; pose: Pose; ortho: boolean; style: VisualStyle; mode: ViewMode; filters: Filters;
  section: [number[], number[]] | null; rules?: FilterState };
type ViewsStore = { home: Pose | null; saved: SavedView[] };
const viewsKey = (files: string[]) => `iris.views.${projectName(files)}`;
/** Each set of models keeps its filters (docs/filters.md). */
const filtersKey = (files: string[]) => `iris.filters.${projectName(files)}`;
function loadViews(files: string[]): ViewsStore {
  try { return { home: null, saved: [], ...JSON.parse(localStorage.getItem(viewsKey(files)) ?? "{}") }; } catch { return { home: null, saved: [] }; }
}
function saveViews(files: string[], store: ViewsStore) {
  try { localStorage.setItem(viewsKey(files), JSON.stringify(store)); } catch { /* private window: views last this visit */ }
}
type Tab = "clash" | "plan" | "chat";
/** Text to the clipboard: the Clipboard API, else a hidden text area and the copy command (an older browser, or a page
 * the API is not allowed on). */
async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}
/** A fix as Show it built's capture takes it (Viewer.captureBuilt). */
type BuiltFix = Parameters<Viewer["captureBuilt"]>[0];

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  // Side panel widths: dragged by their inner edge, remembered in this browser, double-click to reset.
  const [widths, setWidths] = useState(() => ({ left: stored("iris.left-w", 310), right: stored("iris.right-w", 380) }));
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  // Phones and tablets (layout.ts, docs/mobile.md): the clash list in a bottom sheet's tab (phone) or a drawer (tablet),
  // how far the phone's sheet is pulled up, and the header's menu. The sheet follows what happens (see `followed`).
  const layout = useLayout();
  const compact = layout === "phone" || layout === "tablet";
  const coarse = useCoarse();
  const [listOpen, setListOpen] = useState(false);
  const [snap, setSnap] = useState<Snap>("half");
  const [menuOpen, setMenuOpen] = useState(false);
  // The left pane's tab over a report: the clash list, or Insights (the run, root causes, patterns).
  const [leftView, setLeftView] = useState<"clashes" | "insights">("clashes");
  const [toast, setToast] = useState<string | null>(null);
  const longPress = useRef<{ x: number; y: number; timer: number; fired: boolean } | null>(null);
  // While the agent works it drives the viewer (pilot.ts); touching the view takes it back.
  const [pilotStatus, setPilotStatus] = useState<PilotStatus | null>(null);
  const sides = useRef<string[]>([]);
  const pilot = useRef<Pilot | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [samples, setSamples] = useState<string[]>([]);
  // The demos among the samples (server: demos.py): their default files, the start button's words, their tours.
  const [demos, setDemos] = useState<Demo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [stepFiles, setStepFiles] = useState<string[]>([]);  // open models that came from STEP (Export gives STEP back)
  const modelInput = useRef<HTMLInputElement>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolbarState>({ mode: "xray", style: "shaded", ortho: false, grey: true, edges: true, section: false, measure: false, edit: false, links: false, hiddenModels: [] });
  const editTool = useRef<EditToolHandle | null>(null);
  // A hand edit Gemini or an agent checked, for the Edit tool to preview; and the element and face the tool has chosen
  // (chat's context: "this face").
  const [incomingEdit, setIncomingEdit] = useState<{ check: EditCheck; n: number } | null>(null);
  const editPick = useRef<{ element: string; face: string | null; pick?: { point: number[]; normal: number[] } } | null>(null);
  // Free navigation (docs/views.md): every clash picked takes the views to it unless turned off; visibility filters and
  // what is hidden for now (viewing only); saved views and Home per project, in this browser.
  const [fly, setFly] = useState(() => { try { return localStorage.getItem("iris.views.fly") !== "0"; } catch { return true; } });
  const [filters, setFilters] = useState<Filters>({ classes: [], levels: [] });
  const [temporary, setTemporary] = useState<Temporary>({ hidden: [], isolated: null });
  // A row's Isolate: only the clashing elements are drawn, and each clash opened after is isolated in turn, until the
  // user shows everything again (`isolatedFor`: the clash whose pair is isolated now).
  const [isolating, setIsolating] = useState(false);
  const [isolatedFor, setIsolatedFor] = useState<number | null>(null);
  // Filters (docs/filters.md): the server's index of what each element is, the filters, and the one being edited.
  const [facetIndex, setFacetIndex] = useState<FacetIndex | null>(null);
  const [filterState, setFilterState] = useState<FilterState>(NO_FILTERS);
  const [filterDraft, setFilterDraft] = useState<Rule | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);   // the Filters sheet, where there is no dock
  const [facetsError, setFacetsError] = useState<string | null>(null);
  const [facetsTry, setFacetsTry] = useState(0);            // Try again, after the index failed to arrive
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsTick, setViewsTick] = useState(0);
  const [infoRev, setInfoRev] = useState(0);
  // The viewer's history, Home, panes or hides changed: redraw the menus and pane headers, at most once a frame (a handle
  // drag changes a pane on every pointer move).
  const viewsQueued = useRef(false);
  const viewsChanged = () => {
    if (viewsQueued.current) return;
    viewsQueued.current = true;
    const tick = () => { viewsQueued.current = false; setViewsTick((n) => n + 1); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick); else tick();
  };
  const sectionTo = useRef<THREE.Box3 | null>(null);
  // Views beside the 3D one (docs/views.md): Single, Two or Quad, kept per browser; a phone shows one, a tablet two.
  const [viewLayout, setViewLayout] = useState<Layout>(() => { try { return (localStorage.getItem("iris.views.layout") as Layout) || "single"; } catch { return "single"; } });
  const [drawingsShow, setDrawingsShow] = useState<DrawingsShow>("filtered");
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ globalId: string; info: Record<string, unknown> | null } | null>(null);
  // What the model says about the selected element (properties.py): the Properties panel, or the card's All properties.
  const [elementProps, setElementProps] = useState<{ gid: string; data: ElementProperties | null; loading: boolean } | null>(null);
  // Measuring (docs/measure.md): the viewer keeps the measurements; snapping is kept in this browser.
  const [snapping, setSnapping] = useState(() => { try { return localStorage.getItem("iris.measure.snap") !== "0"; } catch { return true; } });
  const measureFrame = useRef(0);
  const [measureAt, setMeasureAt] = useState<{ x: number; y: number } | null>(() => {
    try { const v = JSON.parse(localStorage.getItem("iris.measure.at") ?? "null"); return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null; } catch { return null; }
  });
  const down = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Opening models, step by step (Brand.tsx LoadCard and the notch); null when nothing is opening.
  const [loading, setLoading] = useState<LoadProgress | null>(null);
  // The opening that has just succeeded, as its card ended: the cover keeps it while the dock arrives (App, "dockCover").
  const openedLoad = useRef<LoadProgress | null>(null);
  // A fix the server kept (markFixed): the mark settles once beside it.
  const [kept, setKept] = useState<{ text: string; detail?: string; n: number } | null>(null);
  const keptTimer = useRef<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  // A check hovered or pinned in Workings: its trial in the viewer, over the chosen option (docs/workings.md).
  const [peek, setPeek] = useState<{ p: Peek; pin: boolean } | null>(null);
  // Options the person rejected for this pair (by `optionKey`), with why if they said. The next proposal for the pair
  // tells Gemini, and an option it finds again stays rejected (docs/edits.md, "Rejecting a fix").
  const [rejected, setRejected] = useState<Record<string, Rejection>>({});
  const [manualDz, setManualDz] = useState(-0.25);
  const [manual, setManual] = useState<Verdict | null>(null);
  const [manualPreview, setManualPreview] = useState<{ element: string; delta: number[]; moved: string[]; pieces: Piece[] | null } | null>(null);
  const previewRequest = useRef(0);
  // Clash reports (Navisworks XML).
  const [reportSamples, setReportSamples] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [matches, setMatches] = useState<Matches | null>(null);
  const [clash, setClash] = useState<ReportClash | null>(null);
  // The report and clash on screen now, for work that resumes after an await (a run, a chat turn).
  const reportNow = useRef<Report | null>(null);
  reportNow.current = report;
  const clashRef = useRef<ReportClash | null>(null);
  clashRef.current = clash;
  const [measure, setMeasure] = useState<Measure | null | "busy">(null);
  // Iris's own detection (server: detect.py): what it would run on the open models, a run in progress, the checks it
  // keeps (each one's latest run; docs/detection.md, "Kept checks"), and the A/B/C views taken in the browser of the
  // clashes it found (by clash id).
  const [detectSetup, setDetectSetup] = useState<DetectSetup | null>(null);
  const [detecting, setDetecting] = useState<DetectProgress | null>(null);
  // The checks kept for the open models, the one the list shows (null: all of them), and the one that ran last (its
  // summary shows when the list shows them all). `unionSerial`: the list of their clashes on screen (a later is higher).
  const [checks, setChecks] = useState<CheckSummary[]>([]);
  const [viewCheck, setViewCheck] = useState<string | null>(null);
  const [ranCheck, setRanCheck] = useState<string | null>(null);
  const unionSerial = useRef(0);
  const [views, setViews] = useState<Record<string, string[]>>({});
  const [capturing, setCapturing] = useState<string | null>(null);
  // Gemini's titles for the open report's clashes (server: titles.py), as they stream in, and how many are still coming.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState(0);
  const captures = useRef(new Map<string, Promise<void>>());
  // List thumbnails of detected clashes (no pictures until opened), drawn by the viewer as rows scroll into view.
  // "" marks a clash the viewer could not draw.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbQueue = useRef<{ report: string; clash: ReportClash }[]>([]);
  const thumbPaused = useRef(false);
  const lastTests = useRef<DetectTest[] | null>(null);
  // The chat starts over when the user opens another report, not when the chat itself opened one (Detect from chat).
  const [chatReport, setChatReport] = useState<string | null>(null);
  // The image dialog: a clash's Navisworks views, opened from the clash panel or a row's thumbnail.
  // About Iris (AboutIris.tsx): open on a tab, or null. The address carries it (#about, #about/fixes), so it can be shared.
  const [aboutTab, setAboutTab] = useState<AboutTab | null>(aboutTabNow);
  const aboutPushed = useRef(false);   // this page added the #about history entry, so closing goes Back over it
  // Gemini Pro's reasoning summaries for the current proposal, as they stream in.
  const [thoughts, setThoughts] = useState<{ round: number; text: string }[]>([]);
  // A proposal runs on in the background for its own clash while others are opened (one at a time): the clash it is
  // for (`run`: its tracker), its own progress, proposal and thoughts as they stand, and each clash's last finished
  // proposal, kept for the session so going back shows it without proposing again.
  const [running, setRunningState] = useState<{ id: string; number: number; run: number } | null>(null);
  const runningNow = useRef<{ id: string; number: number; run: number } | null>(null);
  const setRunning = (v: { id: string; number: number; run: number } | null) => { runningNow.current = v; setRunningState(v); };
  const runState = useRef<{ id: string | null; progress: Progress; proposal: Proposal | null; thoughts: { round: number; text: string }[] } | null>(null);
  const [doneProposals, setDoneProposals] = useState<Record<string, { proposal: Proposal; progress: Progress; thoughts: { round: number; text: string }[] }>>({});
  const [lightbox, setLightbox] = useState<{ clash: ReportClash; index: number } | null>(null);
  useEffect(() => { setLightbox(null); }, [report]);
  const [remeasure, setRemeasure] = useState(0);
  // Accepted fixes. `edits`: element GlobalId → pieces an offset added to it (shown with that element from then on).
  // `fixes`: report clash id → the fix accepted for it.
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [fixes, setFixes] = useState<Record<string, string>>({});
  // The scene's edit log (journal.py): every kept edit, by whom and for which clash; undo and redo walk it.
  const [journal, setJournal] = useState<Journal | null>(null);
  const journalAsk = useRef(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [now, setNow] = useState(Date.now());
  const [compare, setCompare] = useState<"before" | "after" | "both">("after");
  const [tab, setTabState] = useState<Tab>("clash");
  // Desktop panels (dock.tsx, docs/panels.md): each panel's content is drawn into a slot of its own, which the dock or
  // the classic layout places. The dock shows the panel App asks for; the classic layout is a switch away.
  const slots = usePanelSlots();
  const dock = useRef<DockHandle | null>(null);
  const dockedNow = useRef(false);
  const [classic, setClassic] = useState(() => { try { return localStorage.getItem(CLASSIC_KEY) === "1"; } catch { return false; } });
  const [popouts, setPopouts] = useState<Window[]>([]);
  /** Switch the right-hand panel: on a desktop the dock shows it too (opens its side bar, brings its window forward). */
  const setTab = (t: Tab) => { setTabState(t); if (dockedNow.current) dock.current?.show(t); };
  // What the viewer shows: the selected clash, or the plan. It follows the latest activity, not the open tab: a plan
  // started from Chat takes the view while the chat stays open; picking a clash or proposing gives it back.
  const [viewPlan, setViewPlan] = useState(false);
  // Several clashes at once.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rootCauses, setRootCauses] = useState<RootCause[] | null>(null);
  // Report-wide: patterns of the same clash, Gemini Pro's verdict on each, and clashes reviewed without an edit.
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, PatternVerdict> | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, Review>>({});
  // Coordination requirements (Requirements.tsx; server: requirements.py): the file kept in this browser and whether it
  // is in use, the id the server registered it under (sent with every call), and the dialog.
  const [reqSaved, setReqSaved] = useState<SavedRequirements | null>(() => loadRequirements());
  const [reqId, setReqId] = useState<string | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  // A blank project: the workspace without a demo, waiting for the visitor's own models (ProjectStart.tsx).
  const [blank, setBlank] = useState(false);
  // Projects (docs/engineer-workflow.md): the address says the page (`#projects`, `#project/<pid>/<step>`); the projects
  // this browser knows, the one the address names, and what the page is doing with it (opening, saving).
  const [route, setRoute] = useState<ProjectRoute | null>(() => currentProjectRoute());
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState<string | null>(null);
  // The project whose models this page opened by itself (a workspace step with them not open): once per visit.
  const autoOpened = useRef<string | null>(null);
  // Per-file import rows (importRows.ts, ImportPanel.tsx) and the files behind them, for Retry.
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const importBatch = useRef<{ files: File[]; mode: "open" | "add" } | null>(null);
  // 2D drawings of the open models (DrawingsPanel.tsx, drawingsApi.ts): the sheets, what reading found on each, and the
  // comparison with the models; read on the Drawings step, again after an upload or a reading (`drawingsTry`).
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawingItemsBy, setDrawingItemsBy] = useState<Record<string, DrawingItem[]>>({});
  const [drawingCompare, setDrawingCompare] = useState<Comparison | null>(null);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const [drawingsTry, setDrawingsTry] = useState(0);
  // The model summary's row isolated now (ModelSummaryPanel.tsx), and the coordination overview's filter on the list.
  const [summaryIsolated, setSummaryIsolated] = useState<string | null>(null);
  const [coordFilter, setCoordFilter] = useState<CoordinationFilter | null>(null);
  // Who decides (docs/engineer-workflow.md, step 9): a name kept in this browser, sent with every decision and keep.
  const [reviewer, setReviewerState] = useState<string>(() => { try { return localStorage.getItem("iris.reviewer") ?? ""; } catch { return ""; } });
  const setReviewer = (name: string) => {
    setReviewerState(name);
    try { if (name.trim()) localStorage.setItem("iris.reviewer", name.trim()); else localStorage.removeItem("iris.reviewer"); } catch { /* private window */ }
  };
  // The review queue (docs/review-queue.md): prepared fixes, one clash per screen, over the workspace.
  const [reviewOpen, setReviewOpen] = useState(false);
  useEffect(() => { setReviewOpen(false); }, [sceneId, report?.id]);
  // "Modify" on a proposal opened the Edit tool for this clash: a hand edit kept for it records a "modified" decision.
  const modifying = useRef<{ item: ProposalItem; clash: { id: string; key: string; number?: number | null }; scene: string } | null>(null);
  const pid = route?.view === "project" ? route.pid : null;
  const projStep: ProjectStep | null = route?.view === "project" ? route.step : null;
  /** Models, Coordination and Clash review happen in the workspace, under the step bar; the other steps are pages. */
  const workStep = projStep === "models" || projStep === "coordination" || projStep === "clash";
  const projectHere = project && project.id === pid ? project : null;
  /** The models on screen are the project's (opened from it, or kept with it). */
  const projectOpen = !!projectHere && !!sceneId && projectHere.scene_id === sceneId;
  /** Where the page is when it is on no project's page: the open session (`/workspace`), else the first screen. */
  const homePath = () => (sceneId || report ? "/workspace" : "/home");
  /** Go to a project page (`push`: a new history entry, so Back returns), or back to the workspace (null). */
  const goRoute = (next: ProjectRoute | null, push = true) => { showProjectRoute(next, push, homePath()); setRoute(next); setHomeAsked(false); };
  /** Home (`/home`), asked for: shown even while a session is open, which stays open behind it (the sidebar's Home). */
  const [homeAsked, setHomeAsked] = useState(() => /^\/(home\/?)?$/.test(currentPath()));
  const goHome = () => { showPath("/home", true); setRoute(null); setHomeAsked(true); };
  /** The open session outside any project (`/workspace`). */
  const goWorkspace = () => { showPath(sceneId || report ? "/workspace" : "/home", true); setRoute(null); setHomeAsked(false); };
  // The app shell (AppShell.tsx): the sidebar collapsed to its rail (remembered apart for the 3D workspace, where it
  // starts collapsed, and the other pages), the phone and tablet drawer, and the dialogs it opens.
  const [rails, setRails] = useState(() => ({ pages: readRail(browserStorage(), "pages"), workspace: readRail(browserStorage(), "workspace") }));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);   // New project's create call is out: the dialog waits
  const [createError, setCreateError] = useState<string | null>(null);
  const goStep = (s: ProjectStep, id: string | null = pid) => { if (id) goRoute({ view: "project", pid: id, step: s }); };
  const goProjects = () => goRoute({ view: "projects" });
  useEffect(() => {   // Back, Forward or an edited address moves between the project pages
    // An old address (#projects, #project/<pid>/<step>, #about, #owner) becomes its path; "/" is the first screen.
    const old = typeof window !== "undefined" && window.location ? legacyPath(window.location.hash ?? "") : null;
    if (old) showPath(old, false);
    else if (typeof window !== "undefined" && window.location && /^\/?(index\.html)?$/.test(currentPath())) showPath("/home", false);
    const read = () => { setRoute(currentProjectRoute()); setHomeAsked(currentPath() === "/home"); setDrawerOpen(false); };
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, []);
  // The projects this browser created or opened (by id: there are no accounts), newest first: the projects home's list,
  // and Home's recent projects.
  const listedHere = route?.view === "projects" || (homeAsked && !route);
  useEffect(() => {
    if (!listedHere) return;
    let live = true;
    const asked = myProjectIds();
    setProjectsLoading(true); setProjectsError(null);
    listProjects(asked).then((list) => { if (!live) return; setProjects(list); pruneProjectIds(asked, list); })
      .catch((e: unknown) => { if (live) setProjectsError(`Could not read the projects: ${(e as Error).message}`); })
      .finally(() => { if (live) setProjectsLoading(false); });
    return () => { live = false; };
  }, [listedHere]);
  // The project the address names: read from the server (kept in this browser's list once it answers).
  useEffect(() => {
    if (!pid) return;
    let live = true;
    setProjectError(null);
    if (autoOpened.current !== pid) autoOpened.current = null;
    getProject(pid).then((p) => {
      if (!live) return;
      setProject((was) => (was && was.id === p.id && was.updated > p.updated ? was : p));   // never an older copy over a newer
      rememberProject(p.id);
    })
      .catch((e: unknown) => {
        if (!live) return;
        setProject(null);
        setProjectError(e instanceof ApiError && e.status === 404 ? "No project with this address on this server. It may have been removed."
          : `Could not read the project: ${(e as Error).message}`);
      });
    return () => { live = false; };
  }, [pid]);
  // Gemini Pro's audit of the by-design rules after a triage under requirements, and whether the triage shown was
  // read under other requirements (a level, strictness or guidance since changed).
  const [triageAudit, setTriageAudit] = useState<Record<string, RuleAudit>>({});
  const [triageStale, setTriageStale] = useState(false);
  // Bulk triage of the open report (shared on the server: a run someone else started is followed, not repeated).
  const [triage, setTriage] = useState<Record<string, TriageVerdict>>({});
  const [triageRun, setTriageRun] = useState<TriageRun | null>(null);
  // What the triage model is writing right now, per clash being read (its reasoning, newest 600 characters).
  const [triageLive, setTriageLive] = useState<Record<string, string>>({});
  // The coordination report: which team owns each model (guessed, then confirmed), the fixes to show with their
  // before/after pictures, and the teams' reviews (kept in this browser per report).
  const [modelTeams, setModelTeams] = useState<Record<string, Team>>({});
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [signoffs, setSignoffs] = useState<Record<string, Signoff[]>>({});
  const [docOpen, setDocOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  // The guided tour and the About dialog are no longer offered (docs/ui-design.md §10); an /about address shows nothing
  // of its own and a tour starts only from code (the tour's hooks stay).
  const [tourWhich] = useState<"northbank" | "cell">("northbank");
  useEffect(() => {   // Back, Forward or an edited address opens, switches or closes the About page
    const read = () => { const t = aboutTabNow(); if (!t) aboutPushed.current = false; setAboutTab(t); };
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener("popstate", read); };
  }, []);
  // An agent connected over MCP (Agent.tsx; server: agents.py, mcp_server.py). It is part of the saved session below.
  const [agentLink, setAgentLinkState] = useState<AgentLink | null>(null);
  /** Keep a link, measuring how far this browser's clock is from the server's when the server just sent its time. */
  const setAgentLink = (l: AgentLink | null) => setAgentLinkState(l && (l.server_time
    ? { ...l, clock_offset: l.server_time - Date.now() / 1000, server_time: 0 } : l));
  // This browser's last session (models, clashes, fixes, agent link), kept so a reload or a closed tab can resume it
  // while the server still holds it. One per browser: opening other models replaces it.
  const [sceneFiles, setSceneFiles] = useState<string[]>([]);
  const [resumable, setResumable] = useState<{ saved: SavedSession; info: SceneInfo; clashes: number | null } | null>(null);
  // The server let go of the open models or clash report (a restart or a redeploy, or room for other visitors: the
  // 404's X-Iris-Gone): one notice that offers to open them again, in place of each call's own error. Kept by id,
  // so it counts only while those models or that report are the ones on screen.
  const [goneIds, setGoneIds] = useState<{ scene: string | null; report: string | null }>({ scene: null, report: null });
  const goneScene = !!sceneId && goneIds.scene === sceneId, goneReport = !!report && goneIds.report === report.id;
  const gone = goneScene || goneReport ? { scene: goneScene, report: goneReport } : null;
  const sceneUploaded = useRef(false);   // the open models are the visitor's own files: only they can pick them again
  // Adding and removing models (docs/add-and-remove-models.md). The server's layout of the open models (bumped by each
  // add or remove): a reply on another layout means another tab or an agent changed the list, so the files are loaded
  // again. `layoutRev` re-reads what depends on the file list; `adding`: samples ticked to add; `removing`: the model
  // asked about before it goes; `pickFor`: what the model file input's files are for.
  const sceneLayout = useRef<number | null>(null);
  const [layoutRev, setLayoutRev] = useState(0);
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<{ index: number; name: string; text: string; edits: number } | null>(null);
  const pickFor = useRef<"open" | "add" | "project">("open");
  const sampleReports = useRef<Record<string, string>>({});   // report id → the sample report it was opened from
  const goneWords = useRef(new Set<string>());   // the server's words for it: the notice says them, never the error line
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [ownerSettings, setOwnerSettingsState] = useState<OwnerSettings | null>(null);
  // Which model titles and triage use now, for the copy (asked again when the owner changes their own settings).
  const [triageModel, setTriageModel] = useState<TriageModel | null>(null);
  // Whether a clash Gemini Pro could not fix may go to Gemini Pro (deep think) for a second try (docs/escalation.md).
  const [escalation, setEscalation] = useState<EscalationInfo | null>(null);
  const [modelsAsked, setModelsAsked] = useState(0);   // ask again after the owner changes a setting for everyone
  // The model behind each role (server: model_client.labels), for the words on screen; and triage's calls at a time.
  const [labels, setLabels] = useState<AiNames>(DEFAULT_AI_NAMES);
  const [triageWorkers, setTriageWorkers] = useState<number | null>(null);
  useEffect(() => {
    api.models().then((m) => {
      setTriageModel(m.triage); setUploadMax(m.model_upload_max_mb ?? null); setEscalation(m.escalation ?? null);
      setLabels(setAiNames(m.labels)); setTriageWorkers(m.triage_workers ?? null);
      setBuiltOn(!!m.built_views);
    }).catch(() => undefined);
  }, [ownerSettings, modelsAsked]);
  const canEscalate = !!escalation?.available && escalation.mode !== "off";
  // Show it built (docs/show-it-built.md): pictures of fixes, only while the switch is on for this visitor.
  const [builtOn, setBuiltOn] = useState(false);
  const wonder = escalation?.label ?? labels.escalation;
  // How much a visitor may upload, from the server (checked here before anything is sent).
  const [uploadMax, setUploadMax] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [docReady, setDocReady] = useState(false);
  const [chatAsk, setChatAsk] = useState<{ text: string; send: boolean; n: number } | undefined>(undefined);
  // Each agent run gets a number: a run that was replaced (by a recorded replay) can no longer change the page.
  const agentRun = useRef(0);
  const golden = useRef(false);
  const [triageFilter, setTriageFilterState] = useState<TriageKind | null>(null);
  // The list filtered to one pattern's or root cause's clashes (Insights). One filter at a time: either clears the other.
  const [listFocus, setListFocusState] = useState<{ label: string; ids: string[] } | null>(null);
  // A clash row the tour points at: the list draws only the rows on screen, so it scrolls there first.
  const [listReveal, setListReveal] = useState<string | null>(null);
  const setTriageFilter = (k: TriageKind | null) => { setTriageFilterState(k); if (k) setListFocusState(null); };
  const setListFocus = (f: { label: string; ids: string[] } | null) => { setListFocusState(f); if (f) setTriageFilterState(null); };
  useEffect(() => { setListFocusState(null); setLeftView("clashes"); }, [report?.id]);
  const [planRun, setPlanRun] = useState<PlanRun | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [context, setContext] = useState<ContextRun | null>(null);
  const [contextChosen, setContextChosen] = useState<string | null>(null);
  const [contextNames, setContextNames] = useState<Record<string, Record<string, unknown>>>({});
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [planKind, setPlanKind] = useState<"batch" | "context">("batch");
  const [viewContext, setViewContext] = useState(false);
  // Invalidate callbacks immediately when replacement starts, before the new scene ID arrives.
  const sceneEpoch = useRef(0);
  // The server's revision of the open scene this page's model shows: a kept fix is patched in place only from here.
  const sceneRevision = useRef<number | null>(null);
  const planRevision = useRef<number | null>(null);   // the scene's revision when the plan on screen was checked
  // A fix kept since the plan was checked (say, one item's own second try): its joint check no longer holds.
  const planStale = !!plan && planRevision.current != null && sceneRevision.current != null
    && planRevision.current !== sceneRevision.current;
  const workspaceEpoch = useRef(0);
  const chatOwner = useRef(new ChatRequestOwner());
  const contextRequest = useRef(0);
  const planRequest = useRef(0);
  const directAgent = useRef<ReturnType<typeof trackAgent> | null>(null);
  const directPlan = useRef<ReturnType<typeof trackPlan> | null>(null);
  const directContext = useRef<ReturnType<typeof trackContext> | null>(null);
  const contextProposal = context?.result?.proposals.find((p) => p.id === contextChosen) ?? null;
  const contextWorking = !!context && context.phase !== "done";
  const activeContext = viewContext && !context?.accepted;
  const renderedSceneEpoch = sceneEpoch.current;
  const renderedWorkspaceEpoch = workspaceEpoch.current;

  useEffect(() => {
    if (!sceneId || !contextProposal) return;
    const epoch = sceneEpoch.current;
    let live = true;
    const roots = [...new Set(contextProposal.edits.map((e) => e.element))].filter((gid) => !contextNames[gid]);
    void Promise.all(roots.map(async (gid) => [gid, await api.element(sceneId, gid).catch(() => ({}))] as const)).then((entries) => {
      if (live && sceneEpoch.current === epoch && entries.length) setContextNames((old) => ({ ...old, ...Object.fromEntries(entries) }));
    });
    return () => { live = false; };
    // Fetch only the chosen proposal's edit roots; long run members remain available as IDs in details.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, contextProposal]);

  useEffect(() => {
    if (!host.current) return;
    const v = new Viewer(host.current);
    viewer.current = v;
    pilot.current = new Pilot(() => viewer.current,
      (t) => frameFix({ kind: t.kind, moved: t.moved, preview: t.pieces }, sides.current), setPilotStatus);
    v.onUserCamera = () => pilot.current?.takeOver();
    v.onChange = viewsChanged;
    api.samples().then(({ files, demos: listed }) => {
      setSamples(files); setDemos(listed);
      // Default to the first demo's own set (its context files, a grid or a later revision, stay unticked), else the
      // first sample.
      setPicked(listed[0]?.files ?? files.slice(0, 1));
    }).catch((e) => setError(`Can't reach the Iris server: ${e.message}`));
    api.reportSamples().then(setReportSamples).catch(() => undefined);
    // Wake the server while the first screen is read (Cloud Run scales to zero; a cold start takes 20–40 s): a request
    // that nothing waits for. A server without /api/health answers 404, awake; the samples are asked then.
    try {
      void api.wake?.();
    } catch { /* no fetch here (tests) */ }
    return () => {
      ++sceneEpoch.current; ++workspaceEpoch.current; ++previewRequest.current;
      directContext.current?.retire(); pilot.current?.cancel(); chatOwner.current.invalidate(); v.dispose();
    };
  }, []);

  // Pieces accepted offsets added to A or B are part of that side: coloured, and kept when isolating.
  const [standIns, setStandIns] = useState<Record<string, Side>>({});
  sides.current = [a, b, ...Object.keys(standIns)].filter((g): g is string => !!g);
  const group = useMemo(() => {
    const g: Record<string, Side> = { ...standIns };
    for (const p of (b && edits[b]) || []) g[p] = "b";
    for (const p of (a && edits[a]) || []) g[p] = "a";
    return g;
  }, [a, b, edits, standIns]);
  // While a plan is on screen, its elements are the focus: what moves in green, what stays in red.
  const planGroup = useMemo(() => {
    if (!plan || !viewPlan) return null;
    const g: Record<string, "a" | "b"> = {};
    if (plan.hub) {  // the element behind the clashes in red, everything it meets in green
      g[plan.hub.hub.global_id] = "a";
      for (const p of plan.hub.partners) g[p.global_id] = "b";
    }
    for (const it of plan.items) {
      const moved = new Set(it.option?.moved ?? []);
      for (const gid of [it.element_a, it.element_b, ...(it.others ?? [])]) g[gid] = moved.has(gid) ? "b" : "a";
      for (const gid of moved) g[gid] = "b";
    }
    return g;
  }, [plan, viewPlan]);
  const contextGroup = useMemo(() => {
    if (!activeContext) return null;
    const objective = contextProposal?.objective ?? context?.objective;
    const g: Record<string, Side> = {};
    if (objective) { g[objective.element_a] = "a"; g[objective.element_b] = "a"; }
    for (const edit of contextProposal?.edits ?? []) {
      for (const gid of edit.moved) {
        g[gid] = "b";
        for (const piece of edits[gid] ?? []) g[piece] = "b";
      }
    }
    return g;
  }, [activeContext, contextProposal, context?.objective, edits]);
  useEffect(() => {
    // A plan on screen: its elements. A plan still being worked out: nothing yet (the old clash would mislead).
    viewer.current?.setFocus(contextGroup ? { a: null, b: null, group: contextGroup }
      : planGroup ? { a: null, b: null, group: planGroup } : viewPlan ? { a: null, b: null } : { a, b, group });
  }, [a, b, group, planGroup, viewPlan, contextGroup]);
  useEffect(() => { if (viewPlan || activeContext) viewer.current?.setMarker(null); }, [viewPlan, activeContext]);
  useEffect(() => { viewer.current?.setMode(tool.mode); }, [tool.mode]);
  useEffect(() => { viewer.current?.setStyle(tool.style); }, [tool.style]);
  useEffect(() => { viewer.current?.setProjection(tool.ortho ? "orthographic" : "perspective"); }, [tool.ortho]);
  useEffect(() => { viewer.current?.setGreyContext(tool.grey); }, [tool.grey]);
  useEffect(() => { viewer.current?.setSelection(selected?.globalId ?? null); }, [selected?.globalId]);
  useEffect(() => {
    const gid = selected?.globalId;
    if (!gid || !sceneId) { setElementProps(null); return; }
    let live = true;
    // Read again after every keep, undo and redo (`infoRev`): an edit, a fix or a property change may have changed what
    // the model says about it. The values shown stay until the new ones come.
    setElementProps((p) => (p?.gid === gid && p.data ? { ...p, loading: false } : { gid, data: null, loading: true }));
    api.properties(sceneId, gid).then((data) => { if (live) setElementProps({ gid, data, loading: false }); })
      .catch(() => { if (live) setElementProps((p) => (p?.gid === gid && p.data ? p : { gid, data: null, loading: false })); });
    return () => { live = false; };
  }, [selected?.globalId, sceneId, infoRev]);
  useEffect(() => { viewer.current?.setFilters(filters); }, [filters]);
  // The filters, with the one being edited shown live (in its place, or on top while new), drawn in every view.
  const prepared = useMemo(() => (facetIndex ? prepare(facetIndex) : null), [facetIndex]);
  const facetKeys = useMemo(() => new Set(prepared?.byKey.keys() ?? []), [prepared]);
  // The page's filters as chat and an agent know them, by name (docs/filters.md, "Checks").
  const sharedFilters = useMemo(() => shareable(filterState.rules), [filterState]);
  // How they show together (Hide the rest, colours), for a check of what the filters show from chat or an agent.
  const filterView = useMemo(() => ({ hide_rest: !!filterState.hideRest, colours: filterState.colours }), [filterState.hideRest, filterState.colours]);
  // A check on filters from the Filters panel: kept as a check of its own, its clashes join the list (docs/filters.md,
  // "Checks"; docs/detection.md, "Kept checks").
  const filterCheck = { defaults: detectSetup?.check ?? null, busy: !!busy || !!detecting,
    onCheck: (t: DetectTest) => { setFiltersOpen(false); void runDetect([t]); } };
  // The filter being edited counts by what it does, not its name: typing a name redraws nothing.
  const draftKey = filterDraft ? JSON.stringify({ ...filterDraft, name: "" }) : "";
  const ruleView = useMemo(() => {
    const d = filterDraft, shown = d && (d.when.some(complete) || d.invert || d.action === "byValue") ? { ...withBy(d), on: true } : null;
    const rules = !d ? filterState.rules : filterState.rules.some((r) => r.id === d.id)
      ? filterState.rules.map((r) => (r.id === d.id ? shown ?? { ...r, on: false } : r)) : shown ? [shown, ...filterState.rules] : filterState.rules;
    return evaluate({ ...filterState, rules }, prepared);
  }, [filterState, draftKey, prepared]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Applying a filter (the panel, Colour by…, a value's row, chat or an agent) frames what it acts on in every view,
  // once the viewer shows it (docs/filters.md, "Zoom"). Filters read back with a project or a saved view do not.
  const lastFilters = useRef<FilterState>(NO_FILTERS);
  const restoredFilters = useRef<FilterState | null>(null);
  useEffect(() => {
    viewer.current?.setRules(ruleView);
    const prev = lastFilters.current;
    if (prev === filterState) return;
    lastFilters.current = filterState;
    if (restoredFilters.current === filterState) return;
    const v = viewer.current, rules = applied(prev, filterState);
    if (!v || !prepared || !rules.length) return;
    const ids = zoomTarget(prepared, rules, (g) => v.isShown(g));
    if (ids.length) v.frameEverywhere(ids);
  }, [ruleView]);  // eslint-disable-line react-hooks/exhaustive-deps
  // The key to the colours on screen, over the model.
  const filterKey = useMemo(() => legend(filterState, prepared), [filterState, prepared]);
  // A filter that takes the selected element off screen clears the selection, as a hide does.
  useEffect(() => {
    const gid = selected?.globalId;
    if (gid && viewer.current?.isShown(gid) === false) setSelected(null);
  }, [ruleView]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!modelNames.length) return;
    try { localStorage.setItem(filtersKey(modelNames), JSON.stringify(filterState)); } catch { /* kept for this visit */ }
  }, [filterState]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { viewer.current?.setTemporary(temporary); }, [temporary]);
  useEffect(() => { try { localStorage.setItem("iris.views.fly", fly ? "1" : "0"); } catch { /* kept for this visit */ } }, [fly]);
  const shownLayout: Layout = layout === "phone" ? "single" : layout === "tablet" && viewLayout === "quad" ? "two" : viewLayout;
  useEffect(() => { viewer.current?.setLayout(shownLayout); }, [shownLayout, stats]);
  useEffect(() => { try { localStorage.setItem("iris.views.layout", viewLayout); } catch { /* kept for this visit */ } }, [viewLayout]);
  useEffect(() => { try { localStorage.setItem(CLASSIC_KEY, classic ? "1" : "0"); } catch { /* kept for this visit */ } }, [classic]);
  const [workings, setWorkings] = useState<WorkingsSetting>(readWorkings);
  useEffect(() => { try { localStorage.setItem(WORKINGS_KEY, JSON.stringify(workings)); } catch { /* kept for this visit */ } }, [workings]);
  // The tour reads the main page: panels in their own windows come back for it.
  useEffect(() => { if (touring) dock.current?.gather(); }, [touring]);
  useEffect(() => { viewer.current?.setDrawingsShow(drawingsShow); }, [drawingsShow]);
  // Each set of models has its own Home and saved views.
  useEffect(() => {
    if (!modelNames.length) return;
    const store = loadViews(modelNames);
    setSavedViews(store.saved);
    viewer.current?.setHome(store.home);
    let kept: unknown = null;
    try { kept = JSON.parse(localStorage.getItem(filtersKey(modelNames)) ?? "null"); } catch { /* none kept */ }
    const restored = migrate(kept);
    restoredFilters.current = restored;
    setFilterState(restored);
    setFilterDraft(null);
  }, [modelNames]);
  // What the filters read: each element's class (the server's) and storey (datums). Read again after a kept fix (same
  // scene, new elements: `infoRev`); filters and hides start clean only with a new scene.
  useEffect(() => { setFilters({ classes: [], levels: [] }); setTemporary({ hidden: [], isolated: null }); setIsolating(false); setFacetIndex(null); }, [sceneId]);
  useEffect(() => { setJournal(null); if (sceneId) void refreshJournal(sceneId); }, [sceneId]);
  useEffect(() => {
    if (!sceneId) return;
    let live = true;
    // Each on its own: a failed datums request keeps the classes, and the other way round.
    void api.classes(sceneId).then((classes) => {
      if (!live) return;
      sceneClasses.current = { scene: sceneId, map: classes };
      viewer.current?.setInfo(Object.fromEntries(Object.keys(classes).map((g) => [g, classes[g][0]])), null);
      viewsChanged();
    }).catch(() => undefined);
    void api.datums(sceneId).then((datums) => {
      if (!live) return;
      viewer.current?.setInfo(null, datums.storeys);
      viewer.current?.setDatums(datums);
      viewsChanged();
    }).catch(() => undefined);
    return () => { live = false; };
  }, [sceneId, infoRev]);
  // The filters' index, read again after a kept fix; a failure says so in the panel, with Try again.
  useEffect(() => {
    if (!sceneId) return;
    let live = true;
    setFacetsError(null);
    void api.facets(sceneId).then((index) => { if (live) setFacetIndex(index); })
      .catch((e: unknown) => { if (live) setFacetsError(e instanceof Error ? e.message : "The server did not answer."); });
    return () => { live = false; };
  }, [sceneId, infoRev, facetsTry]);
  useEffect(() => { viewer.current?.setEdges(tool.edges); }, [tool.edges]);
  // A section box follows the focus: re-cut it when the pair changes, drop it when there is none.
  useEffect(() => {
    if (!tool.section) { viewer.current?.setSection(false); return; }
    const box = sectionTo.current;
    sectionTo.current = null;
    if (!(box ? viewer.current?.setSection(true, 0, box) : viewer.current?.setSection(true))) setTool((t) => ({ ...t, section: false }));
  }, [tool.section, a, b, contextGroup, planGroup]);
  useEffect(() => { viewer.current?.setMeasuring(tool.measure); viewsChanged(); }, [tool.measure]);
  useEffect(() => {
    viewer.current?.setSnap(snapping);
    try { localStorage.setItem("iris.measure.snap", snapping ? "1" : "0"); } catch { /* kept for this visit */ }
  }, [snapping]);
  useEffect(() => { try { if (measureAt) localStorage.setItem("iris.measure.at", JSON.stringify(measureAt)); } catch { /* kept for this visit */ } }, [measureAt]);

  // A clock for the live status lines while an agent works.
  const working = (!!progress && progress.phase !== "done") || !!running || (!!planRun && planRun.phase !== "done")
    || (!!triageRun && !triageRun.done) || contextWorking || !!loading;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [working]);

  // Link the report to the open model whenever either changes.
  useEffect(() => {
    setMatches(null);
    if (!report || !sceneId) return;
    let live = true;
    api.match(report.id, sceneId).then((m) => { if (live) setMatches(m); }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [report, sceneId, layoutRev]);

  // Root causes and patterns, over the clashes still open (not fixed, not reviewed). Nothing jumps while the user
  // works through them: patterns are read once per report, and Insights shows each one's open clashes from `resolved`;
  // root causes are read again as clashes are resolved, but each stays in its place (a resolved hub as a done row).
  const resolved = useMemo(() => [...new Set([...Object.keys(fixes), ...Object.keys(reviewed)])], [fixes, reviewed]);
  const resolvedSet = useMemo(() => new Set(resolved), [resolved]);
  const resolvedNow = useRef(resolved);
  resolvedNow.current = resolved;
  useEffect(() => {
    setRootCauses(null); setPatterns(null);
    if (!report || !sceneId || !matches) return;
    let live = true;
    api.patterns(report.id, sceneId, resolvedNow.current).then((r) => { if (live) setPatterns(r); }).catch(() => { if (live) setPatterns([]); });
    return () => { live = false; };
  }, [report, sceneId, matches]);
  useEffect(() => {
    if (!report || !sceneId || !matches) return;
    let live = true;
    api.rootCauses(report.id, sceneId, resolved).then((r) => { if (live) setRootCauses((prev) => keepPlaces(prev, r)); })
      .catch(() => { if (live) setRootCauses((prev) => prev ?? []); });
    return () => { live = false; };
  }, [report, sceneId, matches, resolved]);

  /** Gemini Pro reads every pattern (one call, cached per report on the server): its verdicts bring each pattern's
   * mark, flag and fix buttons. `quiet` (the automatic reading) leaves a failure to the Explain button, not a banner. */
  async function explainPatterns(quiet = false) {
    if (!report || !sceneId) return;
    const rid = report.id;
    setExplaining(true);
    try { const v = await api.triagePatterns(rid, sceneId, resolved); if (reportRef.current === rid) setVerdicts(v); }
    catch (e) { if (!quiet) setError((e as Error).message); } finally { setExplaining(false); }
  }
  const reportRef = useRef<string | null>(null);
  reportRef.current = report?.id ?? null;
  const explained = useRef<string | null>(null);

  /** Run the bulk triage, or follow the run already going for this report. */
  async function runTriage(rerun = false, origin: Origin = "you") {
    if (!report) return;
    const rid = report.id;
    const trace = traceStart("triage", origin, report.title, { names: Object.fromEntries(report.clashes.map((c) => [c.id, clashLabel(c)])) });
    if (rerun) { setTriage({}); setTriageFilter(null); setTriageAudit({}); }
    setTriageStale(false);
    setTriageLive({});
    setTriageRun((r) => r ?? { model: "", total: report.clashes.length, started: Date.now(), done: false });
    // Iris's checks: readings follow their clashes, so triage reads only the unread ones in the check on screen.
    const scope = report.origin === "iris" ? viewCheck : null;
    try {
      await api.triageStream(rid, sceneId, (e) => {
        if (e.type !== "ping") trace.add(e);
        if (e.type === "done") trace.end(e.error ?? null);
        if (e.type === "start") setTriageRun({ model: e.model, note: e.note, images: e.images, total: e.total, started: Date.now(), done: false, requirements: e.requirements?.label ?? null,
          queued: !!e.queued, following: e.following ?? null, canStop: !!e.can_stop });
        else if (e.type === "asking") setTriageRun((r) => r && { ...r, queued: false });
        else if (e.type === "audit") setTriageAudit(e.rules);
        else if (e.type === "clash") {
          const { type: _t, id, ...v } = e;
          setTriage((t) => ({ ...t, [id]: v }));
          setTriageLive((l) => { if (!(id in l)) return l; const { [id]: _done, ...rest } = l; return rest; });
        }
        else if (e.type === "reasoning") setTriageLive((l) => ({ ...l, [e.id]: ((l[e.id] ?? "") + e.text).slice(-600) }));
        else if (e.type === "done") { setTriageRun((r) => r && { ...r, done: true, seconds: e.seconds, error: e.error, stopped: !!e.stopped }); setTriageLive({}); }
      }, rerun, scope);
    } catch (e) { setError((e as Error).message); trace.add({ type: "error", detail: (e as Error).message }); trace.end((e as Error).message); setTriageRun((r) => (r && r.model ? { ...r, done: true } : null)); }
    trace.end("The stream ended before triage finished");   // nothing if it ended with its done event
  }

  /** Stop the triage under way: its stream ends with a "done" that says stopped; what was read stays. */
  async function stopTriage() {
    if (!report) return;
    try { await api.triageStop(report.id); } catch (e) { setError((e as Error).message); }
  }

  // The requirements in use: registered with the server (content-addressed), then their id goes with every call.
  useEffect(() => {
    saveRequirements(reqSaved);
    if (!reqSaved?.enabled) { setRequirements(null, null); setReqId(null); return; }
    let live = true;
    api.registerRequirements(reqSaved.doc).then((r) => {
      if (!live) return;
      setRequirements(r.id, r.doc); setReqId(r.id);
    }).catch((e) => { if (live) setError(`Requirements not in use: ${(e as Error).message}`); });
    return () => { live = false; };
  }, [reqSaved]);
  const reqLabel = reqSaved?.enabled && reqId ? shortLabel(reqSaved.doc) : null;

  /** Keep a requirements file (null: forget it); with `again`, check the models again under it. */
  function applyRequirements(doc: Requirements | null, enabled: boolean, again: boolean) {
    setReqSaved(doc ? { doc, enabled } : null);
    setReqOpen(false);
    if (again) pendingDetect.current = true;
  }
  const pendingDetect = useRef(false);
  useEffect(() => {
    if (!pendingDetect.current || !reqId) return;
    pendingDetect.current = false;
    void runDetect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqId]);

  /** An opening's host reading becomes the rule for the host's group (a file is started from the models when there is
   * none: the option names the group in that file). */
  async function addPenRule(o: Option) {
    let doc = reqSaved?.doc ?? null;
    if (!doc && sceneId) doc = (await api.requirementsDefault(sceneId).catch(() => null))?.doc ?? null;
    if (!doc || !o.edit) return;
    setReqSaved({ doc: addPenetration(doc, o.edit, o.review ?? null), enabled: true });
  }

  /** A pattern Gemini read as by design becomes a by-design rule (a file is started from the models when there is none):
   * its clashes are settled at once, without asking the model again. */
  async function addRule(p: Pattern, v?: PatternVerdict) {
    let doc = reqSaved?.doc ?? null;
    if (!doc && sceneId) doc = (await api.requirementsDefault(sceneId).catch(() => null))?.doc ?? null;
    if (!doc) return;
    setReqSaved({ doc: addByDesign(doc, p, v), enabled: true });
  }

  // A newly opened report, or other requirements: pick up a triage that already exists for it (finished, or still
  // running). Under requirements that only changed rules, the server carries the readings over at once; under
  // another level, strictness or guidance it returns the last run marked stale until the triage is run again.
  // A new list of Iris's checks keeps what is already shown for the clashes it still lists (the server carries those
  // readings over too), so nothing flickers while it answers.
  const triageFor = useRef<Report | null>(null);
  useEffect(() => {
    const was = triageFor.current;
    triageFor.current = report;
    const same = !!report && !!was && report.origin === "iris" && was.origin === "iris" && report.scene_id === was.scene_id;
    if (same) {   // a verdict holds only for a clash that did not change (same pair, depth within 1 mm)
      const before = new Map(was.clashes.map((c) => [c.id, c] as const));
      const held = new Set(report.clashes.filter((c) => { const o = before.get(c.id); return !!o && sameClash(o, c); }).map((c) => c.id));
      setTriage((t) => Object.fromEntries(Object.entries(t).filter(([id]) => held.has(id))));
    } else { setTriage({}); setTriageRun(null); setTriageFilter(null); }
    setTriageAudit({}); setTriageStale(false);
    if (!report) return;
    let live = true;
    api.triage(report.id, sceneId).then((s) => {
      if (!live) return;
      if (!s.model) { if (same) { setTriage({}); setTriageRun(null); } return; }
      setTriageAudit(s.audit ?? {}); setTriageStale(!!s.stale);
      if (s.done || s.stale) {
        setTriage(s.results);
        setTriageRun({ model: s.model, note: s.note, total: s.total ?? 0, started: Date.now(), done: true, seconds: s.seconds ?? undefined, error: s.error ?? undefined, requirements: s.requirements?.label ?? null, stopped: !!s.stopped });
      } else runTriage();
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, reqId]);

  // Models opened after a triage: the server corrects what the open model settles (one element on both sides).
  const triageDone = !!triageRun?.done;
  useEffect(() => {
    if (!report || !sceneId || !matches || !triageDone) return;
    let live = true;
    api.triage(report.id, sceneId).then((s) => { if (live && s.done) setTriage(s.results); }).catch(() => {});
    return () => { live = false; };
  }, [report, sceneId, matches, triageDone]);

  useEffect(() => {
    if (!report) return;
    let live = true;
    api.teams(report.id, sceneId).then((r) => {
      // A fresh guess once the models are open (they say more than the report does); the dialog confirms it.
      if (live) setModelTeams(Object.fromEntries(r.models.map((m) => [m.file, m.guess])));
    }).catch(() => {});
    return () => { live = false; };
  }, [report, sceneId]);
  const signoffKey = signoffScope(report);
  useEffect(() => { setEvidence({}); }, [signoffKey]);
  // Each report sees its own sign-offs (signoffs.ts): a detection run's by clash id, so a rerun or a rule change keeps
  // them; the old title-keyed ones move over for the clashes this report has.
  useEffect(() => {
    migrateTitleKeyed(report);
    setSignoffs(loadSignoffs(signoffKey, report?.clashes?.map((c) => c.id) ?? []));
  }, [signoffKey, report?.id]);
  function changeSignoffs(id: string, f: (s: Signoff[]) => Signoff[]) {
    setSignoffs((all) => {
      const next = { ...all, [id]: f(all[id] ?? []) };
      saveSignoffs(signoffKey, next);
      return next;
    });
  }

  const addSignoff = (id: string, so: Signoff) => changeSignoffs(id, (l) => [...l, so]);
  const removeSignoff = (id: string, i: number) => changeSignoffs(id, (l) => l.filter((_, k) => k !== i));

  /** Report clash ids of these element pairs (one pair can be reported by several tests). */
  function clashIdsOf(pairs: (readonly [string | null, string | null])[]): string[][] {
    if (!report || !matches) return pairs.map(() => []);
    const key = (x: string | null | undefined, y: string | null | undefined) => [x, y].sort().join("|");
    return pairs.map((p) => report.clashes.filter((c) => key(matches[c.id]?.a, matches[c.id]?.b) === key(p[0], p[1])).map((c) => c.id));
  }

  /** The view as it is and with the fix(es), for the report. Draws both states in turn, then puts the view back. */
  function captureFix(options: Option[], color: string): { before_img?: string; after_img?: string } {
    const v = viewer.current;
    if (!v || !options.length) return {};
    const shapes = options.map((o) => ({ kind: o.kind, moved: o.moved, deltaM: o.delta_m, pieces: o.preview, before: o.before, color }));
    v.showOptions(shapes, "before");
    const before_img = v.capture();
    v.showOptions(shapes, "after");
    const after_img = v.capture();
    v.showOptions(shapes, compare);
    return { before_img, after_img };
  }

  /** Gemini's recommendation where the requirements allow no edit: the report shows it on the clash's page. */
  function noteRecommendation(r: Recommendation, pair: readonly [string | null, string | null]) {
    const ids = clashIdsOf([pair])[0];
    if (!ids.length) return;
    const ev: Evidence = { status: "recommended", title: r.title, kind: r.kind, edit: recEditText(r), clearance: "", clearance_m: null,
      rationale: r.rationale, also_needs: r.also_needs, moved: [r.element], blocked_by: r.blocked_by };
    setEvidence((all) => ({ ...all, ...Object.fromEntries(ids.filter((id) => !all[id] || all[id].status === "recommended").map((id) => [id, ev])) }));
  }

  function evidenceOf(o: Option, status: Evidence["status"], pics: { before_img?: string; after_img?: string }): Evidence {
    return { status, title: o.title, kind: o.kind, edit: editText(o), moved: o.moved,
      clearance: clearanceText(o), clearance_m: o.min_clearance_m ?? null, ...(o.review ? { review: o.review } : {}),
      rationale: o.rationale, also_needs: needsText(o.also_needs), ...(o.meets?.length ? { meets: o.meets } : {}), ...pics };
  }

  // ------------------------------------------------------------------ Show it built (docs/show-it-built.md)
  // A fix's picture, drawn by Gemini Image from Iris's view and checked against the model. Runs are keyed by the pair and
  // the fix's title, so an option's picture is still there once it is accepted.
  const [builtRuns, setBuiltRuns] = useState<Record<string, BuiltRun>>({});
  // What is on screen now, for work that lands after the render it started in (chat's show_it_built).
  const latest = useRef({ proposal, chosen, a, b });
  latest.current = { proposal, chosen, a, b };
  const sceneClasses = useRef<{ scene: string; map: Record<string, [string, string]> } | null>(null);
  // Accepted fixes as the viewer can frame them again (a report's missing pictures), by clash id; finished results by
  // key; pictures still being drawn.
  const builtFixes = useRef<Record<string, { key: string; title: string; fix: BuiltFix; pair: [string, string] }>>({});
  const builtDone = useRef<Record<string, BuiltResult>>({});
  const builtPending = useRef(new Map<string, Promise<BuiltResult | null>>());
  useEffect(() => {
    if (!builtOn || !sceneId || sceneClasses.current?.scene === sceneId) return;
    api.classes(sceneId).then((map) => { sceneClasses.current = { scene: sceneId, map }; }).catch(() => undefined);
  }, [builtOn, sceneId]);
  useEffect(() => {
    builtFixes.current = {}; builtDone.current = {}; builtPending.current = new Map(); setBuiltRuns({});
  }, [sceneId]);
  /** A picture's key: the pair and the fix itself (kind, numbers, its edit), never just its title, which two
   * different fixes can share. */
  const builtKey = (pair: readonly [string | null, string | null], o: Option) => [[pair[0], pair[1]].sort().join("|"), o.kind, o.title,
    JSON.stringify([o.delta_m, o.split_m ?? null, o.trim ?? null, o.edit?.key ?? o.edit?.summary ?? null])].join("|");
  /** Show it built is for fixes big enough to see at the view's scale: not a trim, a seat or a cleanup. */
  const buildable = (o: Option) => o.kind !== "trim" && o.kind !== "seat" && !o.cleanup;
  const canBuild = (o: Option) => builtOn && buildable(o);
  /** A fix as the viewer frames it; `ids`: an applied fix's pieces (the original first), in its preview's order. */
  const builtFix = (o: Option, applied: boolean, ids?: string[]): BuiltFix => ({ kind: o.kind, moved: o.moved, deltaM: o.delta_m,
    pieces: o.preview?.map((m, i) => (ids?.[i] ? { ...m, global_id: ids[i] } : m)) ?? null, applied });

  /** Iris's view of a fix in the passes the picture and its check need (Viewer.captureBuilt: one task, view put back). */
  function builtPasses(fix: BuiltFix, pair: [string, string]): BuiltPasses | null {
    const known = sceneClasses.current?.scene === sceneId ? sceneClasses.current.map : null;
    const v = viewer.current;
    if (!v) return null;
    // "" for what the server lists as not physical (a space, a provision for void): not drawn in the picture.
    try { return v.captureBuilt(fix, pair, (g) => known ? (known[g]?.[0] ?? "") : undefined); } catch { return null; }
  }

  /** Draw a fix's picture from its passes; the run shows under `key`. Resolves with the result, null when the request
   * failed (switched off, capped: a report can try again). */
  function drawBuilt(key: string, passes: BuiltPasses | null, kind: string, title = "", origin: Origin = "you"): Promise<BuiltResult | null> {
    const sid = sceneId, map = sceneClasses.current?.map ?? {}, epoch = sceneEpoch.current;
    const already = builtPending.current.get(key);
    if (already) return already;   // being drawn: one request, one charge
    if (!sid || !passes) {
      setBuiltRuns((r) => ({ ...r, [key]: { status: "failed", step: "", look: "", cut: "", error: "Nothing of the fix is in view to draw." } }));
      return Promise.resolve(null);
    }
    const cut = cutText(passes.cut, passes.sectioned, (g) => map[g]?.[0]);
    const set = (patch: Partial<BuiltRun>) => {
      if (sceneEpoch.current !== epoch) return;   // another scene now: this picture belongs to none of it
      setBuiltRuns((r) => ({ ...r, [key]: { ...(r[key] ?? { status: "working", step: "", look: passes.look, cut }), ...patch } }));
    };
    set({ status: "working", step: `${labels.image} is drawing two pictures from Iris's view…`, look: passes.look, cut, result: undefined, error: undefined });
    // Several pictures can be drawn at once (a plan's): each is a run of its own, and none grows the panel.
    const trace = traceStart("built", origin, title, {}, { alone: false, grow: false });
    const work = api.built(sid, { look: passes.look, ids: passes.ids, normals: passes.normals }, kind, (e) => { trace.add(e); set({ step: builtStep(e) }); })
      .then((res) => {
        trace.add({ ...res, type: "result" }); trace.end();
        if (sceneEpoch.current !== epoch) return null;
        builtDone.current[key] = res; set({ status: res.status === "done" ? "done" : "failed", result: res }); return res;
      })
      .catch((e) => { trace.add({ type: "error", detail: (e as Error).message }); trace.end((e as Error).message); set({ status: "failed", error: (e as Error).message }); return null; })
      .finally(() => { if (builtPending.current.get(key) === work) builtPending.current.delete(key); });
    builtPending.current.set(key, work);
    return work;
  }

  /** A kept fix's picture again (or for the first time), framed on the model as it now is. */
  function redrawKept(clashId: string) {
    const f = builtFixes.current[clashId];
    if (!f) return;
    const ids = Object.entries(builtFixes.current).filter(([, g]) => g.key === f.key).map(([id]) => id);
    void drawBuilt(f.key, builtPasses(f.fix, f.pair), f.fix.kind, f.title).then((res) => noteBuilt(ids, f.title, res));
  }

  /** Chat's show_it_built: the chosen option of the clash on screen, else its kept fix. */
  function builtFromChat(clashId: string) {
    const { proposal: p, chosen: k, a: x, b: y } = latest.current;
    const o = p && k != null ? p.options[k] : null;
    const m = matches?.[clashId];
    const same = !!m && !!x && !!y && [m.a, m.b].sort().join("|") === [x, y].sort().join("|");   // the option is this clash's
    if (o && same && canBuild(o)) { void drawBuilt(builtKey([x!, y!], o), builtPasses(builtFix(o, false), [x!, y!]), o.kind, o.title, "chat"); return; }
    if (builtFixes.current[clashId]) { redrawKept(clashId); return; }
    setError("Nothing to draw for that clash yet: propose fixes and pick one, or accept one, then ask again.");
  }

  /** The chosen option's picture (the button on its card). */
  function showBuilt(o: Option) {
    if (!a || !b || !canBuild(o)) return;
    void drawBuilt(builtKey([a, b], o), builtPasses(builtFix(o, false), [a, b]), o.kind, o.title);
  }

  /** A kept fix's picture (or why there is none) on its clashes' evidence: the PDF's third picture. */
  function builtEvidence(ev: Evidence, res: BuiltResult | null | undefined): Evidence {
    if (!res) return ev;
    return res.status === "done" && res.image_url ? { ...ev, built_img: res.image_url, built_note: undefined }
      : { ...ev, built_note: res.why ?? `${labels.image} couldn't keep to the model here.` };
  }
  function noteBuilt(ids: string[], title: string, res: BuiltResult | null) {
    if (res) setEvidence((ev) => ({ ...ev, ...Object.fromEntries(ids.filter((id) => ev[id]?.title === title).map((id) => [id, builtEvidence(ev[id], res)])) }));
  }

  /** At accept: the fix's picture in the background, from the passes taken before it was applied (or the option's own
   * picture, if one was drawn), and the fix kept so a report can frame it again. */
  function buildAccepted(o: Option, pair: [string, string], ids: string[], passes: BuiltPasses | null, pieces?: string[]) {
    if (!buildable(o)) return;
    const key = builtKey(pair, o);
    const runs = o.kind === "offset" || o.kind === "route" || o.kind === "resize";
    // Kept whether or not the switch is on, so a report drawn after it goes on can frame this fix again.
    for (const id of ids) builtFixes.current[id] = { key, title: o.title, fix: builtFix(o, true, runs ? pieces : undefined), pair };
    if (!builtOn) return;
    const made = builtDone.current[key], drawing = builtPending.current.get(key);
    if (made?.status === "done") noteBuilt(ids, o.title, made);
    else if (drawing) void drawing.then((res) => noteBuilt(ids, o.title, res));
    else if (passes) void drawBuilt(key, passes, o.kind, o.title).then((res) => noteBuilt(ids, o.title, res));
  }

  /** Before a report: the pictures still drawing, and those of accepted fixes that have none (switched on later, or
   * capped then), at most 10 at once. Returns the evidence with every picture that came. */
  async function prepareReport(onStep: (done: number, total: number) => void): Promise<Record<string, Evidence>> {
    if (!builtOn) return evidence;
    const keys = new Map<string, string[]>();
    for (const id of Object.keys(evidence)) {
      const ev = evidence[id], f = builtFixes.current[id];
      if (ev.status === "accepted" && f && !ev.built_img && !ev.built_note && !builtDone.current[f.key])
        keys.set(f.key, [...(keys.get(f.key) ?? []), id]);
    }
    const waiting = [...keys].filter(([key]) => !builtPending.current.has(key));
    const todo = waiting.slice(0, 10);
    const later = waiting.slice(10).flatMap((entry) => entry[1]);   // at most 10 drawn for one report: the rest say so
    const withLater = (all: Record<string, Evidence>) => ({ ...all, ...Object.fromEntries(later.map((id) => [id,
      { ...all[id], built_note: "Not drawn for this report (at most 10 at once); building the report again draws the next ones." }])) });
    const pending = [...builtPending.current.values()];
    const total = todo.length + pending.length;
    if (!total) return withLater(withBuilt(evidence));
    let done = 0;
    onStep(0, total);
    await Promise.all([
      ...pending.map((w) => w.then(() => onStep(++done, total))),
      ...todo.map(([key, ids]) => {
        const f = builtFixes.current[ids[0]];
        return drawBuilt(key, builtPasses(f.fix, f.pair), f.fix.kind, f.title).then((res) => { noteBuilt(ids, f.title, res); onStep(++done, total); });
      }),
    ]);
    return withLater(withBuilt(evidence));
  }
  /** Evidence with every finished picture of its kept fix (state may not have caught up with the last ones yet). */
  function withBuilt(all: Record<string, Evidence>): Record<string, Evidence> {
    return Object.fromEntries(Object.entries(all).map(([id, ev]) => {
      const f = builtFixes.current[id];
      return [id, f && ev.status === "accepted" && ev.title === f.title ? builtEvidence(ev, builtDone.current[f.key]) : ev];
    }));
  }

  function captureContext(p: ContextProposal): { before_img?: string; after_img?: string } {
    const v = viewer.current;
    if (!v) return {};
    try {
      v.showOptions(contextShapes(p), "before"); const before_img = v.capture();
      v.showOptions(contextShapes(p), "after"); const after_img = v.capture();
      return { before_img, after_img };
    } catch { return {}; }
    finally { v.showOptions(contextShapes(p), compare); }
  }

  // Triage as shown (noClash.shownVerdicts): what is settled in this browser over the model's verdict; a fixed clash
  // keeps its own.
  const shownTriage = useMemo(() => (report
    ? shownVerdicts(report.clashes, triage, reviewed, matches, clash?.id ?? null, measure, fixes) : triage),
  [report, triage, reviewed, matches, clash, measure, fixes]);

  // A selected report clash that needs no fix (one element, not physical, a touch, no overlap, by design per triage):
  // the panel says why instead of offering a fix, unless someone asks for one anyway.
  const [fixAnyway, setFixAnyway] = useState(false);
  useEffect(() => { setFixAnyway(false); }, [clash]);
  const notAClash = clash && !fixes[clash.id] && !proposal && !progress ? noClash(clash, matches?.[clash.id], measure, shownTriage[clash.id]) : null;
  const hideFix = !!notAClash && !fixAnyway;

  function review(ids: string[], kind: Review["kind"], note: string) {
    setReviewed((r) => ({ ...r, ...Object.fromEntries(ids.filter((id) => !fixes[id]).map((id) => [id, { kind, note }])) }));
    setChecked((s) => { const n = new Set(s); for (const id of ids) n.delete(id); return n; });
  }

  /** Take the camera to a report clash: where its elements meet, or its reported point. */
  /** Take the views to a clash (every pick does, unless Fly to clash is off; `force`: F, Go to clash). */
  function goToClash(c: ReportClash, m = matches?.[c.id], force = false) {
    const ids = [m?.show?.[0] ?? m?.a, m?.show?.[1] ?? m?.b].filter((g): g is string => !!g);
    const point = c.point && c.point.every((v) => v != null) ? serverPointToViewer(c.point as number[]) : null;
    if (!viewer.current?.focusClash(ids, point, `#${c.number}`, fly || force)) setError("This clash has no geometry or point to show in the open model.");
  }

  /** A row's Isolate: only that clash's elements are drawn, and every clash opened after goes straight to its own pair,
   * isolated, until the user shows everything again; on the clash already isolated, it shows everything again. */
  function isolateClash(c: ReportClash) {
    if (isolating && clash?.id === c.id) { endIsolation(); return; }
    setIsolating(true);
    if (clash?.id !== c.id) selectClash(c);
  }
  /** Everything drawn again: the clash isolation (or any "for now" hide or isolate) ends. */
  function endIsolation() {
    setIsolating(false); setIsolatedFor(null);
    setTemporary({ hidden: [], isolated: null });
  }
  // What the kept edits for the clash on screen changed or made, from the edit log (fixes, plans, hand edits, chat and
  // agents; an edit undone leaves it): isolated, a fix's carried fittings and stretched segments stay with the pair,
  // or a moved drain would end in mid-air. An entry is the clash's by its id, or by its pair when kept without one.
  const keptFor = useMemo(() => {
    const m = clash ? matches?.[clash.id] : undefined;
    if (!clash || !journal) return "";
    const out = new Set<string>();
    for (const e of journal.entries) {
      if (e.state !== "kept" || !e.clashes.some((c) => c.id === clash.id
        || (!!m?.a && !!m?.b && c.pair.length === 2 && c.pair.includes(m.a) && c.pair.includes(m.b)))) continue;
      for (const g of [...e.elements, ...e.created]) out.add(g);
    }
    return [...out].join("\n");   // a key: the isolation is set again only when the parts change
  }, [clash, matches, journal]);
  // While isolating, the clash on screen: its pair as the views draw it (stand-ins first), with the pieces a kept fix
  // added to either element and what the kept edits for it changed, and every view taken straight to it once (the
  // parts changing leaves the camera where the user has it). A clash with nothing in the model leaves the last
  // isolation (isolating nothing would blank the model).
  const isolationFlown = useRef<string | null>(null);
  useEffect(() => {
    if (!isolating) { isolationFlown.current = null; return; }
    if (!clash || !matches) return;
    const m = matches[clash.id];
    const pair = [m?.show?.[0] ?? m?.a, m?.show?.[1] ?? m?.b].filter((g): g is string => !!g);
    if (!pair.length) return;
    const ids = [...new Set([...pair, ...pair.flatMap((g) => edits[g] ?? []), ...(keptFor ? keptFor.split("\n") : [])])];
    setTemporary({ hidden: [], isolated: ids });
    setIsolatedFor(clash.number);
    if (isolationFlown.current !== clash.id) { isolationFlown.current = clash.id; goToClash(clash, m, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isolating, clash?.id, matches, edits, keptFor]);

  /** Leave the clash (Esc, or ✕ on its chip): no pair, marker or preview; the camera, style and visibility stay. Not
   * while Iris works on it. Fixes, reviews and triage are untouched. */
  function leaveClash() {
    if (clashBusy) return;
    clearManual();
    setClash(null); setA(null); setB(null); resetWork(); setStandIns({});
    viewer.current?.setMarker(null);
  }

  // A selected report clash: its pair in the viewer, and Iris's own measure of it.
  useEffect(() => {
    setMeasure(null);
    if (!clash || !report || !sceneId || !matches) return;
    const m = matches[clash.id];
    setA(m?.a ?? null); setB(m?.b ?? null);
    // Draw what can be drawn: a port's pipe or valve stands in for the port itself.
    const shownA = m?.show?.[0], shownB = m?.show?.[1];
    // Both ports of one pipe stand in for both sides: that element is A and B at once (drawn purple).
    const ins: Record<string, Side> = {};
    if (shownA && shownA !== m?.a) ins[shownA] = "a";
    if (shownB && shownB !== m?.b) ins[shownB] = ins[shownB] === "a" ? "ab" : "b";
    setStandIns(ins);
    if (!m?.a || !m?.b) return;
    let live = true;
    setMeasure("busy");
    api.measure(report.id, clash.id, sceneId).then((x) => live && setMeasure(x)).catch(() => live && setMeasure(null));
    return () => { live = false; };
  }, [clash, report, sceneId, matches, remeasure]);
  // When the model link arrives after a clash was picked, go to it then.
  useEffect(() => { if (clash && matches && !viewPlan && !activeContext) goToClash(clash); }, [matches]);  // eslint-disable-line react-hooks/exhaustive-deps

  // What the viewer previews: the chosen option of a single proposal, else every fix of a plan.
  const option = viewPlan || activeContext || chosen == null ? null : proposal?.options[chosen] ?? null;
  // The chosen option is never one the person rejected (a new proposal can find it again): the first still open.
  useEffect(() => {
    const o = chosen == null ? undefined : proposal?.options[chosen];
    if (!proposal || !o || !rejected[optionKey(o)]) return;
    const open = proposal.options.findIndex((x) => !rejected[optionKey(x)]);
    setChosen(open >= 0 ? open : null);
  }, [proposal, chosen, rejected]);
  const planOptions = useMemo(() => (plan?.items.filter((i) => i.option).map((i) => i.option!) ?? []), [plan]);
  const peeked = useRef(false);   // a trial lit its hits: clear them when it goes
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (peek && !activeContext) {   // a trial from Workings: in place, teal when it passed, amber with its hits when not
      const t = peek.p;
      v.showOption({ kind: t.kind, moved: t.moved, deltaM: t.delta_m, pieces: t.pieces as Mesh[] | null, before: null }, "after",
        t.passed === false ? "#f5a623" : "#12b5cb");
      v.setHits(t.passed === false ? t.hit_ids : []);
      return;
    }
    if (peeked.current) { v.setHits([]); peeked.current = false; }
    if (activeContext && contextProposal) {
      v.showOptions(contextShapes(contextProposal), compare);
    } else if (activeContext) v.preview([]);
    else if (option) {
      v.showOption({ kind: option.kind, moved: option.moved, deltaM: option.delta_m, pieces: option.preview, before: option.before },
        compare, option.moved.includes(a ?? "") ? "#d0342c" : "#1f9d3a");
    } else if (plan && viewPlan) {
      v.showOptions(planOptions.map((o) => ({ kind: o.kind, moved: o.moved, deltaM: o.delta_m, pieces: o.preview, before: o.before, color: "#1f9d3a" })), compare);
    } else if (manualPreview) {
      if (manualPreview.pieces?.length) {   // it takes parts along and stretches segments to keep its joints
        v.showOption({ kind: "move", moved: manualPreview.moved, deltaM: manualPreview.delta, pieces: manualPreview.pieces,
          before: null }, "after", "#1f9d3a");
      } else {
        v.preview([{ globalIds: manualPreview.moved, deltaM: manualPreview.delta }]);
      }
    } else v.preview([]);
    // A move that keeps its joints: what it takes along lit as joined, under the option's own colour.
    const carried = option?.kind === "move" && compare !== "before" ? ((option.edit?.carried as string[] | undefined) ?? []) : [];
    const base = carried.length ? [{ color: LINK_COLOURS.joint, ids: carried }] : [];
    if (base.length || baseLinks.current.length) {   // only when it changes: nothing else draws the link layer
      baseLinks.current = base;
      if (!hover.current.gid) restoreLinks();
    }
  }, [option, plan, planOptions, compare, a, viewPlan, activeContext, contextProposal, manualPreview, peek]);
  useEffect(() => {
    if (!peek) return;
    peeked.current = true;
    // Pinned: the camera goes to it, as the pilot's would.
    if (peek.pin) { const t = peek.p; frameFix({ kind: t.kind, moved: t.moved, preview: t.pieces as Mesh[] | null }, [a, b].filter((g): g is string => !!g)); }
  }, [peek?.p.key, peek?.pin]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** Workings' hover and pin: shown while the pilot isn't driving the viewer; a pin takes the view from it. Only a
   *  trial from the models open now. */
  function peekTrial(p: Peek | null, pin: boolean) {
    if (!p) { setPeek(null); return; }
    if (p.scene && p.scene !== sceneId) return;
    if (pilotStatus?.driving) { if (!pin) return; pilot.current?.takeOver(); }
    setPeek({ p, pin });
  }

  useEffect(() => {
    if (activeContext && contextProposal) viewer.current?.frameMeshes(contextProposal.edits.flatMap((e) => [...e.before, ...e.preview]), 1.4);
  }, [contextProposal, activeContext]);

  // Zoom to what the chosen option changes: an offset's risers and middle piece, or where a moved element now
  // meets the other side of the clash (not the whole moved element: a raised 16 m run would fill the screen).
  useEffect(() => {
    if (!option) return;
    const sides = [a, b, ...Object.keys(standIns)].filter((g): g is string => !!g);
    if (!frameFix(option, sides) && option.before?.length) viewer.current?.frameMeshes(option.before, 1.6);
    // Once the camera has arrived: the pictures the report shows for this proposed fix (accepting replaces them).
    const o = option, pair = [a, b] as const, request = previewRequest.current;
    const timer = window.setTimeout(() => {
      if (previewRequest.current !== request) return;
      const ids = clashIdsOf([pair])[0];
      if (!ids.length) return;
      const pics = captureFix([o], o.moved.includes(pair[0] ?? "") ? "#d0342c" : "#1f9d3a");
      setEvidence((ev) => ({ ...ev, ...Object.fromEntries(ids.filter((id) => ev[id]?.status !== "accepted").map((id) => [id, evidenceOf(o, "proposed", pics)])) }));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [option]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A finished plan: frame everything it changes, or (nothing to change) the cluster it is about.
  useEffect(() => {
    const v = viewer.current;
    if (!v || !plan || !viewPlan) return;
    const meshes = planOptions.flatMap((o) => framePieces(o));  // moves and trims: their pairs
    const pairs = plan.items.flatMap((it) => it.option && !framePieces(it.option).length
      ? movedPairs(it.option.moved, [it.element_a, it.element_b, ...(it.others ?? [])]) : []);
    if (meshes.length || pairs.length) v.frameFix(meshes, pairs);
    else if (plan.hub) v.frame([plan.hub.hub.global_id, ...plan.hub.partners.map((p) => p.global_id)]);
  }, [planOptions, plan, viewPlan]);

  function frameFix(o: { kind: string; moved: string[]; preview: Mesh[] | null }, sides: string[]) {
    // A split run: its new pieces. A move: where it now meets the other side. A trim: the joint it changes.
    const meshes = framePieces(o);
    return !!viewer.current?.frameFix(meshes, meshes.length ? [] : movedPairs(o.moved, sides));
  }

  /** Set an option aside (with why, when said): the next one still open is chosen, and the report stops proposing it. */
  function reject(o: Option, i: number, why = "") {
    const next = { ...rejected, [optionKey(o)]: { title: o.title, kind: o.kind, edit: editText(o), why } };
    setRejected(next);
    const open = proposal?.options.map((x, j) => (next[optionKey(x)] ? -1 : j)).filter((j) => j >= 0) ?? [];
    setChosen(open.find((j) => j > i) ?? open[0] ?? null);
    const ids = clashIdsOf([[a, b]])[0];
    setEvidence((ev) => {
      const out = { ...ev };
      for (const id of ids) if (out[id]?.status === "proposed" && out[id].kind === o.kind && out[id].title === o.title) delete out[id];
      return out;
    });
  }
  function unreject(o: Option) { setRejected((r) => { const { [optionKey(o)]: _gone, ...rest } = r; return rest; }); }

  // ------------------------------------------------------------------ decisions (docs/engineer-workflow.md, step 9)

  /** The clash a decision is about, as the journal keys it: its id, its stable key and its #N. */
  function clashRefFor(id: string | null | undefined) {
    const c = id ? report?.clashes.find((x) => x.id === id) : null;
    return c ? { id: c.id, key: coordClashKey(c, report?.title), number: c.number } : null;
  }
  /** Decisions from a reply, into the edit log the page shows (the next read of the log has them too). */
  function noteDecisions(add: Decision[], all = false) {
    setJournal((j) => {
      if (!j) return j;
      const have = all ? [] : j.decisions ?? [];
      const seen = new Set(have.map(decisionId));
      return { ...j, decisions: [...have, ...add.filter((d) => !seen.has(decisionId(d)))] };
    });
  }
  /** Record a decision that is not a keep: rejected, modified or another requested. Accepting goes through the keep. */
  async function recordDecision(item: ProposalItem, kind: Exclude<DecisionKind, "accepted">, reason: string | null,
    ref: { id: string; key: string; number?: number | null } | null = clashRefFor(clashRef.current?.id)): Promise<void> {
    const sid = sceneId;
    if (!sid || !ref) return;   // a pair picked by hand: no clash to record it against
    const epoch = sceneEpoch.current;
    try {
      const r = await api.decide(sid, toDecision(item, stateOf(item), kind, reason, reviewer, ref));
      if (sceneEpoch.current === epoch) noteDecisions(r.decisions, true);
    } catch (e) { if (sceneEpoch.current === epoch) setError(`The decision was not recorded: ${(e as Error).message}`); }
  }
  /** Reject an option, with the reason the card asks for: set aside here, and recorded. */
  function rejectOption(o: Option, i: number, why: string) {
    reject(o, i, why);
    void recordDecision(o, "rejected", why);
  }
  /** Modify: the Edit tool opens on the fix's element; the hand edit kept for this clash records the proposal as modified. */
  function modifyOption(o: Option) {
    const ref = clashRefFor(clashRef.current?.id);
    if (!sceneId || !ref) return;
    modifying.current = { item: o, clash: ref, scene: sceneId };
    if (o.moved[0]) setSelected({ globalId: o.moved[0], info: null });
    setTool((t) => (t.edit ? t : { ...t, edit: true, measure: false }));
    flash("Edit by hand: keeping the edit records this proposal as modified.");
  }
  /** Another proposal, this one kept: a second, longer look when there is one (it keeps these options), else a new try. */
  function requestAnother(item: ProposalItem) {
    void recordDecision(item, "requested_another", null);
    void (canEscalate && proposal && !proposal.escalated ? escalate() : propose());
  }
  /** The newest decision of `kind` about an option of the clash, its time in milliseconds (the server's is seconds). */
  function lastDecision(key: string | null | undefined, title: string, kind: DecisionKind): Decision | null {
    if (!key) return null;
    const list = journal?.decisions ?? [];
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k];
      if (d.clash_key === key && d.decision === kind && d.option.title === title) return { ...d, at: toMs(d.at) };
    }
    return null;
  }

  function clearManual() { ++previewRequest.current; setManual(null); setManualPreview(null); }
  function resetWork(keepContext = false, keepStandIns = false) { clearManual(); setProposal(null); setChosen(null); setProgress(null); setCompare("after"); setPeek(null); setRejected({}); if (!keepStandIns) setStandIns({}); if (!keepContext) setViewContext(false); }

  function retireDirectWork() {
    directAgent.current?.retire(); directPlan.current?.retire(); directContext.current?.retire();
    directAgent.current = null; directPlan.current = null; directContext.current = null;
    ++agentRun.current; ++planRequest.current; pilot.current?.cancel(); setRunning(null);
    setReplaying(false);
  }

  /** Open models: the picked samples, other sample names, or files the visitor chose (uploaded). A STEP model is
   * converted to IFC on the server; Export gives it back as STEP too. */
  /** Open models: samples, uploads, or (`existing`) a scene the server still holds, to resume a session. */
  async function open(source: string[] | File[] = picked, existing?: OpenedScene) {
    const upload = source[0] instanceof File;
    // Chosen files, one row each (importRows.ts): a file that is not a model is refused in its row and not sent.
    if (upload && !existing) {
      importBatch.current = { files: source as File[], mode: "open" };
      setImportRows(initRows(source as File[]));
      source = sendableFiles(source as File[]);
    } else if (!existing) setImportRows([]);
    if (!source.length) return;
    const names = (source as (string | File)[]).map((x) => (typeof x === "string" ? x : x.name));
    const hasStep = names.some((n) => /\.(step|stp)$/i.test(n));
    ++workspaceEpoch.current; replaceChatWork(); retireDirectWork();
    runs.stopAll("The models were opened again");
    const epoch = ++sceneEpoch.current;
    ++contextRequest.current; ++agentRun.current; ++planRequest.current;
    pilot.current?.cancel();
    setChatAsk(undefined);
    setContext(null); setContextChosen(null); setContextNames({}); setAcknowledged([]); setViewContext(false); setViewPlan(false);
    const title = existing ? "Reopening your session…" : upload ? `Uploading ${names.length} model${names.length > 1 ? "s" : ""}${hasStep ? " and converting the STEP" : ""}…`
      : hasStep ? "Opening the STEP model…" : `Loading ${names.length} model${names.length > 1 ? "s" : ""}…`;
    setBusy(title);
    let load: LoadProgress = { title: title.replace(/…$/, ""), files: shortNames(names), step: "server", fetched: 0, bytes: 0, drawn: 0, elements: 0, started: Date.now(), ends: {} };
    const step = (next: Partial<LoadProgress>) => { load = { ...load, ...next }; if (sceneEpoch.current === epoch) setLoading(load); };
    step({}); setNow(Date.now());
    setError(null); resetWork(false, true);
    // An upload of IFC files is parsed while it goes up and the server opens it (in the viewer's worker: the page goes
    // on), so the models are ready when the server is, not six seconds after on a big model.
    let early: Promise<Staged | null> | null = null, handed = false;
    try {
      if (upload && !existing) {
        const refusal = uploadRefusal(source as File[], uploadMax);
        if (refusal) throw new Error(refusal);
        if (names.every((n) => /\.ifc$/i.test(n)) && viewer.current) {
          const v = viewer.current;
          early = Promise.all((source as File[]).map(async (f) => new Uint8Array(await f.arrayBuffer())))
            .then((bytes) => v.stage(bytes, () => sceneEpoch.current === epoch, (drawn, elements) => step({ drawn, elements })));
          early.catch(() => undefined);   // a file that will not parse: parsed again below, which says why
        }
      }
      const { id, files, step: stepMap, revision, layout: opened } = existing ?? (upload
        ? await api.uploadModelsStream(source as File[], (e) => {
          const line = uploadStatus(e, hasStep);
          if (line && sceneEpoch.current === epoch) { setBusy(line); step({ line }); }
          if (sceneEpoch.current === epoch) setImportRows((r) => applyEvent(r, e));
        })
        : await api.open(source as string[]));
      if (sceneEpoch.current !== epoch) return;
      if (upload) { setBusy("Drawing the models…"); setImportRows((r) => applyEvent(r, { type: "done" })); }
      step({ step: "download", files: shortNames(files), ends: { server: Date.now() - load.started } });
      // The early parse, if the server kept the files as sent (same names, same order); else (or it failed) as below.
      const same = files.length === (source as File[]).length
        && files.every((_, i) => localFile(source as File[], files, stepMap, i) === (source as File[])[i]);
      const staged = early && same ? await early.catch(() => null) : null;
      if (sceneEpoch.current !== epoch) return;
      // An uploaded IFC is parsed from the visitor's own file; a STEP comes back converted, samples come from the server.
      const bytes = staged ? [] : await Promise.all(files.map(async (_, i) => {
        const local = upload ? localFile(source as File[], files, stepMap, i) : null;
        const got = local ? new Uint8Array(await local.arrayBuffer()) : await api.file(id, i);
        step({ fetched: load.fetched + 1, bytes: load.bytes + got.byteLength });
        return got;
      }));
      if (sceneEpoch.current !== epoch) return;
      step({ step: "draw", ends: { ...load.ends, download: Date.now() - load.started } });
      handed = !!staged;   // the viewer shows it, or disposes it if this open is superseded
      const stats = await viewer.current!.load(bytes, files, () => sceneEpoch.current === epoch,
        (drawn, elements) => { step({ drawn, elements }); if (upload) setImportRows((r) => applyDraw(r, drawnUpTo(files, drawn), false)); },
        staged ? Promise.resolve(staged) : undefined);
      if (sceneEpoch.current !== epoch || !stats) return;
      if (upload) setImportRows((r) => applyDraw(r, drawnUpTo(files, files.length)));
      sceneRevision.current = revision ?? null;
      sceneLayout.current = opened ?? null;
      setAdding([]); setRemoving(null);
      setModelNames(shortNames(files));
      setTool((t) => ({ ...t, hiddenModels: [] }));
      setEdits({}); setFixes({}); setReviewed({}); setVerdicts(null); setPlan(null); setPlanRun(null); setPlanError(null); setChecked(new Set());
      setChecks([]); setViewCheck(null); setRanCheck(null); unionSerial.current = 0;
      setDoneProposals({}); runState.current = null; setRunning(null);
      openedLoad.current = load;
      setStats(stats); setSceneId(id); setA(null); setB(null); setStandIns({}); setSelected(null);
      setStepFiles(Object.values(stepMap ?? {})); setSceneFiles(files); setResumable(null); sceneUploaded.current = upload;
      return id;
    } catch (e) {
      if (sceneEpoch.current === epoch) {
        setError((e as Error).message);
        if (upload && !existing) setImportRows((r) => failAll(r, (e as Error).message));
      }
    } finally {
      if (sceneEpoch.current === epoch) { setBusy(null); setLoading(null); }
      // Parsed early and never shown (the upload failed, the server renamed or reordered the files): let it go.
      if (early && !handed) { const v = viewer.current; early.then((s) => v?.drop(s), () => undefined); }
    }
  }

  /** Cancel on the loading card: this page stops waiting for the models it was opening (the server may still open
   * them; nothing here uses them), and the import rows say so, with Retry. */
  function cancelOpen() {
    ++sceneEpoch.current;
    golden.current = false;
    setBusy(null); setLoading(null); setProjectBusy(null);
    setImportRows((r) => (r.length ? failAll(r, "Cancelled: the page stopped waiting for these models.") : r));
  }
  async function openDemo(source?: string[] | File[]) {
    const id = await open(source);
    if (id) await runDetect(null, id);
    return id;
  }
  /** Retry on the import list: the same files again, the whole batch (the server opens them together, all or none). */
  function retryImport() {
    const b = importBatch.current;
    if (!b) return;
    if (projectHere && pid) void importToProject(b.files);
    else void (b.mode === "add" ? addModels(b.files) : openDemo(b.files));
  }

  /** Add models to the open scene (docs/add-and-remove-models.md): samples by name, or the visitor's own files. Only the
   * new files are fetched (an uploaded IFC is read from the visitor's own file) and drawn beside the others; fixes,
   * edits, checks and triage stay. Then every kept check runs again, as opening checks. */
  async function addModels(source: string[] | File[]): Promise<boolean> {
    const sid = sceneId;
    if (!sid || !source.length) return false;
    const upload = source[0] instanceof File;
    if (upload) {
      importBatch.current = { files: source as File[], mode: "add" };
      setImportRows(initRows(source as File[]));
      source = sendableFiles(source as File[]);
      if (!source.length) return false;
    }
    const names = (source as (string | File)[]).map((x) => (typeof x === "string" ? x : x.name));
    const refusal = modelsWait() ?? addRefusal(names, sceneFiles, stepFiles) ?? (upload ? uploadRefusal(source as File[], uploadMax) : null);
    if (refusal) { setError(refusal); if (upload) setImportRows((r) => failAll(r, refusal)); return false; }
    const hasStep = names.some((n) => /\.(step|stp)$/i.test(n));
    const epoch = sceneEpoch.current, live = () => sceneEpoch.current === epoch;
    setBusy(`Adding ${names.length === 1 ? shortNames(names)[0] : `${names.length} models`}${hasStep ? " and converting the STEP" : ""}…`);
    setError(null);
    try {
      const added: AddedModels = upload
        ? await api.addModelsStream(sid, source as File[], (e) => {
          const line = uploadStatus(e, hasStep); if (line && live()) setBusy(line);
          if (live()) setImportRows((r) => applyEvent(r, e));
        })
        : await api.addModels(sid, source as string[]);
      if (!live()) return false;
      if (upload) setImportRows((r) => applyEvent(r, { type: "done" }));
      sceneUploaded.current ||= upload;   // a sample scene with an upload added can only be picked again by hand
      setAdding([]);
      if (!nextLayout(added.layout)) await reloadModels(sid, live);   // another tab or an agent changed the list meanwhile
      else {
        setBusy("Drawing the new models…");
        const bytes = await Promise.all(added.added.map(async (i) => {
          const local = upload ? localFile(source as File[], added.files, added.step, i) : null;
          return local ? new Uint8Array(await local.arrayBuffer()) : api.file(sid, i);
        }));
        if (!live()) return false;
        const drawn = await viewer.current!.add(bytes, added.added.map((i) => added.files[i]), live);
        if (!live() || !drawn) return false;
        adoptFiles(added, drawn);
      }
      if (upload) setImportRows((r) => applyDraw(r, drawnUpTo(names, names.length)));
    } catch (e) {
      if (live()) { setError((e as Error).message); if (upload) setImportRows((r) => failAll(r, (e as Error).message)); }
      return false;
    } finally { if (live()) setBusy(null); }
    await runDetect(null, sid, { all: true });
    return true;
  }

  // ------------------------------------------------------------------ projects (docs/engineer-workflow.md)

  /** PDFs among chosen files are drawings (the Drawings step), not models: [models, drawings]. */
  function splitDrawings(files: File[]): [File[], File[]] {
    const pdf = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    return [files.filter((f) => !pdf.includes(f)), pdf];
  }
  /** Add PDF drawings to the open models' scene (they are read there against the models). */
  async function addDrawings(sid: string | null, pdfs: File[]) {
    if (!pdfs.length) return;
    if (!sid) { setError("Open or import the models first: a drawing is read against the open models."); return; }
    try {
      const added = await uploadDrawings(sid, pdfs);
      flash(`${added.length} drawing${added.length === 1 ? "" : "s"} added: see Drawings.`);
      setDrawingsTry((n) => n + 1);
    } catch (e) { setError(`The drawings were not added: ${(e as Error).message}`); }
  }
  /** Files chosen anywhere outside a project: models opened (or added to those open), PDFs to the drawings. */
  async function importFiles(files: File[], adding = !!sceneId) {
    const [models, pdfs] = splitDrawings(files);
    let sid: string | null = sceneId;
    if (models.length) sid = adding && sceneId ? ((await addModels(models)) ? sceneId : null) : (await openDemo(models)) ?? null;
    await addDrawings(sid, pdfs);
  }

  /** Keep the open scene's models with the project (the server copies their original files into it). */
  async function keepModels(id: string, sid: string): Promise<boolean> {
    try { setProject(await attachScene(id, sid)); return true; }
    catch (e) { setError(`The models are open, but could not be kept with the project: ${(e as Error).message}`); return false; }
  }
  /** Files chosen on a project's Models step: added to the project's open models, or opened as its models; then kept
   * with the project, and checked. */
  async function importToProject(chosen: File[]) {
    const p = projectHere;
    if (!p) return;
    const [files, pdfs] = splitDrawings(chosen);
    autoOpened.current = p.id;   // this page is opening its models: never twice
    if (!files.length) { await addDrawings(projectOpen ? sceneId : null, pdfs); return; }
    if (projectOpen && sceneId) {
      const sid = sceneId;
      if (await addModels(files)) { await keepModels(p.id, sid); await addDrawings(sid, pdfs); }
      return;
    }
    const id = await open(files);
    if (!id) return;
    await keepModels(p.id, id);
    await addDrawings(id, pdfs);
    await runDetect(null, id);
  }
  /** The sample building (or `names`) as the project's models: opened, kept with the project, checked. */
  async function samplesToProject(names: string[]) {
    if (projectHere) await samplesInto(projectHere, names);
  }
  async function samplesInto(p: Project, names: string[]) {
    if (!names.length) return;
    autoOpened.current = p.id;
    const id = await open(names);
    if (!id) return;
    await keepModels(p.id, id);
    await runDetect(null, id);
  }
  /** Open the project: its last saved state (else its original models) as a new scene, adopted as a resumed session
   * is; its clashes come back numbered and titled as before once checked. `opened`: what the caller came for, done
   * with the new scene once its kept list is read and before any check (the sample drawings); when it says it failed
   * (false), no check runs, so its error stays on screen (the Clash step's setup card checks later). Resolves with the
   * scene id. */
  async function openProjectScene(p: Project, opened?: (sid: string) => Promise<boolean>): Promise<string | null> {
    if (busy || projectBusy) return null;
    autoOpened.current = p.id;
    setProjectBusy("Opening the project…"); setError(null);
    let id: string | null = null;
    try {
      const o = await openProject(p.id);
      setProject(o.project);
      const info = o.scene ?? await api.sceneInfo(o.scene_id);
      id = await open(info.files, { id: o.scene_id, files: info.files, step: info.step, revision: info.revision, layout: info.layout }) ?? null;
      if (!id) return null;
      sceneUploaded.current = true;   // the project's own files: opened again from the project, never by a sample's name
      if (info.report_id) {
        const rep = await loadReport(() => api.report(info.report_id!), "the project's clashes");
        if (rep) {
          unionSerial.current = rep.serial ?? 0;
          setChecks(info.checks ?? []); setRanCheck(null); setViewCheck(null);
          lastTests.current = (info.checks ?? []).find((c) => c.key === "models")?.tests ?? null;
        }
      }
      const done = opened ? await opened(id) : true;
      if (!info.report_id && done) await runDetect(null, id);
    } catch (e) { setError(`Could not open the project: ${(e as Error).message}`); } finally { setProjectBusy(null); }
    return id;
  }
  /** Save: the edited models, the edit log and the decisions as the project's next saved state. Whether it saved, for
   * the Save button ("Saved ✓" or "Not saved"). */
  async function saveProjectNow(): Promise<boolean> {
    const p = projectHere;
    if (!p || !sceneId || !projectOpen || projectBusy) return false;
    setProjectBusy("Saving…");
    try { setProject(await saveProject(p.id, sceneId)); flash("Saved: the edited models, the edit log and the decisions."); return true; }
    catch (e) { setError(`Could not save the project: ${(e as Error).message}`); return false; } finally { setProjectBusy(null); }
  }
  /** The sample building's project of this browser's: found again by name (one holding models), else made now
   * (`made`) and its id kept in this browser. */
  async function sampleProject(): Promise<{ p: Project; made: boolean }> {
    const mine = await listProjects(myProjectIds()).catch(() => [] as Project[]);
    const found = mine.find((x) => x.name === SAMPLE_PROJECT && x.files.length > 0);
    if (found) return { p: found, made: false };
    const p = await createProject(SAMPLE_PROJECT);
    rememberProject(p.id);
    return { p, made: true };
  }
  /** The first screen's "Try the sample building": the sample as a project of this browser's (made once, then found
   * again), opened on its Clash review. Opening and checking it call no model. */
  async function trySample() {
    const names = demos.find((d) => d.tour === "northbank")?.files ?? demos[0]?.files ?? [];
    if (busy || projectBusy || !names.length) return;
    setProjectBusy("Opening the sample building…"); setError(null);
    let p: Project | null = null;
    try {
      const got = await sampleProject();
      p = got.p;
      if (!got.made) { setProject(p); goStep("clash", p.id); return; }   // its models open on the step (the effect above)
      autoOpened.current = p.id;
      setProject(p);
      goStep("clash", p.id);
    } catch (e) { setError(`Could not open the sample building: ${(e as Error).message}`); return; }
    finally { setProjectBusy(null); }
    if (p) await samplesInto(p, names);
  }
  /** The first screen's "Try the sample drawings": the same sample project, on its Drawings step with the sample PDF
   * sheets attached; each has a saved Gemini reading the server replays, so trying them calls no model. The steps and
   * their order are `openSampleDrawings`'s (sampleDrawings.ts): the sheets first, the clash check after them. */
  async function trySampleDrawings() {
    const demo = demos.find((d) => d.tour === "northbank");
    if (busy || projectBusy || !demo?.files.length || !demo.drawings?.length) return;
    setError(null);
    await openSampleDrawings(demo.files, {
      sampleProject, sceneId,
      show: (p) => { autoOpened.current = p.id; setProject(p); goStep("drawings", p.id); },
      open: async (names) => (await open(names)) ?? null,
      openProject: openProjectScene,
      attach: addSampleDrawings,
      keep: keepModels,
      check: (sid) => runDetect(null, sid),
      listed: () => setDrawingsTry((n) => n + 1),
      busy: setProjectBusy,
      fail: setError,
    });
  }
  /** Create a project, keep its id in this browser and open its overview. */
  async function newProject(name: string) {
    if (creating) return;
    setCreateError(null); setCreating(true);
    try {
      const p = await createProject(name);
      rememberProject(p.id);
      setProjects((l) => [p, ...l.filter((x) => x.id !== p.id)]);
      setProject(p);
      setNewOpen(false);
      goStep("overview", p.id);
    } catch (e) { setCreateError(`Could not create the project: ${(e as Error).message}`); } finally { setCreating(false); }
  }
  /** Rename a project (PATCH name): the list, and the open project, take the server's answer. */
  async function renameProjectNow(id: string, name: string) {
    setProjectsError(null);
    try {
      const p = await patchProject(id, { name: name.trim().slice(0, 120) });
      setProjects((l) => l.map((x) => (x.id === p.id ? p : x)));
      setProject((was) => (was?.id === p.id ? p : was));
    } catch (e) { setProjectsError(`Could not rename the project: ${(e as Error).message}`); }
  }
  /** Remove a project from this browser's list (the server has no delete: its address still opens it). */
  function removeProjectHere(id: string) {
    forgetProject(id);
    setProjects((l) => l.filter((x) => x.id !== id));
    if (project?.id === id && route?.view !== "project") setProject(null);
  }

  /** Whether a reply's layout is the one after this page's (its own add or remove), so it may update in place. */
  function nextLayout(layout: number | undefined): boolean {
    return layout == null || sceneLayout.current == null || layout === sceneLayout.current + 1;
  }

  /** The open models' list as the server has it now (after adding or removing here, or loading them again): names,
   * STEP files, the revision and layout drawn, and what is read from the file list read again (classes, levels, the
   * filters' index, the clash matches, the tests a check would run). The filters on screen carry over to the new set. */
  function adoptFiles(scene: OpenedScene, drawn: Stats | null) {
    const files = scene.files;
    try { localStorage.setItem(filtersKey(shortNames(files)), JSON.stringify(filterState)); } catch { /* kept for this visit */ }
    setSceneFiles(files); setModelNames(shortNames(files)); setStepFiles(Object.values(scene.step ?? {}));
    sceneRevision.current = scene.revision ?? null; sceneLayout.current = scene.layout ?? null;
    if (drawn) setStats(drawn);
    setInfoRev((n) => n + 1); setLayoutRev((n) => n + 1);
  }

  /** Draw the open models again from the server's list, as after a restart: a layout this page doesn't know (another
   * tab or an agent added or removed a model). Iris's list on screen is read again too. */
  async function reloadModels(sid: string, live: () => boolean) {
    const info = await api.sceneInfo(sid);
    if (!live()) return;
    const bytes = await Promise.all(info.files.map((_, i) => api.file(sid, i)));
    if (!live()) return;
    const drawn = await viewer.current!.load(bytes, info.files, live);
    if (!live() || !drawn) return;
    setTool((t) => ({ ...t, hiddenModels: [] }));
    adoptFiles(info, drawn);
    if ((!reportNow.current || reportNow.current.origin === "iris") && info.report_id !== reportNow.current?.id) {
      const r = info.report_id ? await api.report(info.report_id).catch(() => null) : null;
      if (live()) await adoptRun(r, info.checks ?? [], null, []);
    }
  }

  /** The toolbar's remove button: ask first, saying what goes with the model (its kept edits, its clashes in the list). */
  function askRemove(i: number) {
    const name = sceneFiles[i];
    if (!sceneId || !name) return;
    const wait = modelsWait();
    if (wait) { setError(wait); return; }
    const clashes = report?.origin === "iris" ? clashesWith(report.clashes, name) : 0;
    const edits = editsIn(journal?.entries ?? [], i);
    setRemoving({ index: i, name, edits, text: removalWarning(name, clashes, edits) });
  }

  /** Take the model asked about out of the open scene: the server first (its clashes leave every kept check), then the
   * viewer, the list (Iris's checks; an imported report stays, matched again), and whatever pointed into the model. */
  async function removeModel() {
    const r = removing, sid = sceneId;
    setRemoving(null);
    if (!r || !sid) return;
    const wait = modelsWait();
    if (wait) { setError(wait); return; }
    const epoch = sceneEpoch.current, live = () => sceneEpoch.current === epoch;
    setBusy(`Removing ${shortNames([r.name])[0]}…`); setError(null);
    try {
      const out = await api.removeModel(sid, r.index, r.name);
      if (!live()) return;
      viewer.current?.preview([]);
      if (!nextLayout(out.layout)) await reloadModels(sid, live);
      else {
        const drawn = viewer.current?.remove(r.index) ?? null;
        setTool((t) => ({ ...t, hiddenModels: shiftHidden(t.hiddenModels, r.index) }));
        adoptFiles(out, drawn);
        if (!reportNow.current || reportNow.current.origin === "iris") await adoptRun(out.report, out.checks, null, []);
      }
      if (!live()) return;
      const here = (g: string | null) => (g && viewer.current?.has(g) ? g : null);
      setA(here); setB(here);
      setSelected((x) => (x && viewer.current?.has(x.globalId) ? x : null));
      setStandIns({});
      void refreshJournal(sid);
    } catch (e) {
      if (!live()) return;
      if (e instanceof ApiError && e.status === 409) await reloadModels(sid, live).catch(() => undefined);   // the list changed
      setError((e as Error).message);
    } finally { if (live()) setBusy(null); }
  }
  // The second demo: the palletising cell, opened from its STEP file.
  const cellDemo = demos.find((d) => d.tour === "cell");
  const cellSample = cellDemo?.files[0];

  /** A clash of the cell tour, by its parts' names (the STEP's own): one of `names` on each side. */
  function clashOfNames(a: readonly string[], b: readonly string[], r: Report | null = report): ReportClash[] {
    return (r?.clashes ?? []).filter((c) => (a.includes(c.a.name) && b.includes(c.b.name)) || (a.includes(c.b.name) && b.includes(c.a.name)));
  }

  /** A clash the tour or the golden path is about, by its two elements: the same in a check or an imported report. */
  function clashOfPair(pair: readonly string[], r: Report | null = report): ReportClash | undefined {
    return r?.clashes.find((c) => pair.includes(c.a.global_id ?? "") && pair.includes(c.b.global_id ?? "")
      && c.a.global_id !== c.b.global_id);
  }

  useEffect(() => {
    if (!golden.current || !report || !sceneId || !matches) return;
    const target = clashOfPair(TOUR.duct) ?? [...report.clashes].sort((x, y) => (x.distance_m ?? 0) - (y.distance_m ?? 0))[0];
    if (!target) { golden.current = false; return; }
    if (clash?.id !== target.id) { selectClash(target); return; }
    if (a && b && !proposal && !proposing) { golden.current = false; void propose(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, sceneId, matches, clash, a, b]);

  // Each clash's finished proposal, as its row says it: how many verified fixes (0: none found).
  const readyCounts = useMemo(() => Object.fromEntries(Object.entries(doneProposals).map(([id, d]) => [id, d.proposal.options.length])),
    [doneProposals]);
  /** A row's View: its clash on screen with the Clash panel in front, scrolled to its options. */
  function viewProposal(c: ReportClash) {
    if (c.id !== clash?.id) selectClash(c);
    setTab("clash");
    landed.current = null;
    setTimeout(() => { if (optionsHead.current) scrollInPane(optionsHead.current); }, 80);
  }

  // A row's Propose fixes (the list's quick actions): select it, then propose once its pair is picked, as the panel's
  // button would. On the clash already proposed for, it only shows that proposal.
  const [proposeNext, setProposeNext] = useState<string | null>(null);
  function proposeFromList(c: ReportClash) {
    if (busy || planning || runningNow.current) return;
    setTab("clash");
    if (c.id === clash?.id && (proposal || proposing)) return;
    setProposeNext(c.id);
    selectClash(c);
  }
  async function loadReport(get: () => Promise<Report>, what: string) {
    // Report replacement changes callback ownership; defer it until committed model reloads finish.
    if (busy) return;
    const workspace = ++workspaceEpoch.current;
    replaceChatWork(); retireDirectWork(); ++agentRun.current; ++planRequest.current; ++contextRequest.current; ++sceneEpoch.current;
    pilot.current?.cancel(); resetWork(); setContext(null); setContextChosen(null); setAcknowledged([]); setPlanKind("batch"); setChatAsk(undefined);
    setBusy(`Reading ${what}…`); setError(null);
    try {
      const r = await get(); if (workspaceEpoch.current !== workspace) return;
      setReport(r); setChatReport(r.id); setClash(null); resetWork(); setChecked(new Set()); setPlan(null); setPlanRun(null); setPlanError(null); setFixes({}); setReviewed({}); setVerdicts(null);
      setViews({}); captures.current.clear();
      return r;
    }
    catch (e) { if (workspaceEpoch.current === workspace) setError((e as Error).message); } finally { if (workspaceEpoch.current === workspace) setBusy(null); }
  }

  // Every report's clashes get titles: "#39 Cold-water main clips the transfer girder", not "Clash39".
  useEffect(() => {
    setTitles({}); setNaming(0);
    if (!report) return;
    const missing = report.clashes.filter((c) => !c.title).length;
    if (!missing) return;
    let live = true, other = false;
    setNaming(missing);
    const rid = report.id;
    const ask = () => api.titles(rid, (e) => {
      if (!live) return;
      if (e.type === "start") other = !!e.report_id && e.report_id !== rid;
      if (e.type === "titles") {
        setTitles((t) => ({ ...t, ...e.items }));
        setNaming((n) => Math.max(0, n - Object.keys(e.items).length));
      }
      if (e.type === "done") setNaming(0);
    }, sceneId);
    // A run titling an earlier list of the same checks is followed, not repeated; once it ends, what this list adds
    // is titled (asked once more).
    ask().then(() => { if (live && other) { other = false; return ask(); } })
      .catch(() => { if (live) setNaming(0); });  // no titles (no key, cap reached): the plain names stay
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  // ------------------------------------------------------------------ Iris detection (docs/detection.md)

  useEffect(() => {
    setDetectSetup(null);
    if (!sceneId) return;
    let live = true;
    api.detectTests(sceneId).then((s) => { if (live) setDetectSetup(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [sceneId, reqId, layoutRev]);

  function onDetectEvent(e: DetectEvent) {
    const trace = traces.current.detect;
    trace?.add(e.type === "done" ? { ...e, report: undefined } : e);   // the report itself is the clash list's
    if (e.type === "done" || e.type === "error") trace?.end(e.type === "error" ? e.detail : null);
    setDetecting((p) => {
      const cur = p ?? { phase: "Starting…", tests: [] };
      if (e.type === "phase") return { ...cur, phase: e.text };
      if (e.type === "start") return { ...cur, phase: `Checking ${e.elements.toLocaleString()} elements`, tests: e.tests.map((t) => ({ name: t.name })) };
      if (e.type === "test") return { ...cur, running: e.index };
      if (e.type === "test_done") return { ...cur, tests: cur.tests.map((t, i) => (i === e.index ? { ...t, coverage: e.coverage } : t)) };
      return cur;
    });
  }

  /** Find the clashes in the open models and open them as the report. `tests` null: the server's defaults. Marks on
   * clashes that are still there (by design, for the author) survive a rerun: their ids stay the same. */
  async function runDetect(tests: DetectTest[] | null, sid: string | null = sceneId, again: { check?: string; all?: boolean; after_edit?: string } = {}) {
    if (!sid || busy || detecting) return;
    const epoch = sceneEpoch.current;
    const keep = report?.origin === "iris" ? reviewed : {};
    const selected = report?.origin === "iris" ? clash?.id : undefined;
    const kept = again.check ? checks.find((c) => c.key === again.check) : undefined;
    if (!again.all) lastTests.current = kept ? kept.tests ?? null : tests;
    // A check on filters is one test of its own (docs/filters.md, "Checks"): its name says what was checked.
    const onFilters = tests?.length === 1 && !!(tests[0].a.filter || tests[0].a.view || tests[0].b?.filter || tests[0].b?.view);
    traceStart("detect", "you", again.all ? "Every kept check" : kept ? kept.name : onFilters && tests ? tests[0].name : "The open models");
    setDetecting({ phase: "Starting…", tests: [] }); setError(null);
    try {
      const done = await api.detect(sid, again.check || again.all ? null : tests, onDetectEvent, again);
      if (sceneEpoch.current !== epoch) return;
      const now = reportNow.current;
      const light = now?.origin === "iris" && !!done.report.scene_id && now.scene_id === done.report.scene_id;
      const r = await adoptRun(done.report, done.checks, done.check, done.ran);
      if (!r || light) return;
      // A list opened afresh: marks on clashes that are still there (by design, for the author) and the selected clash
      // come back, their ids being the same.
      const ids = new Set(r.clashes.map((c) => c.id));
      setReviewed(Object.fromEntries(Object.entries(keep).filter(([id]) => ids.has(id))));
      const still = selected && r.clashes.find((c) => c.id === selected);
      if (still) selectClash(still);
    } catch (e) { traces.current.detect?.end((e as Error).message); if (sceneEpoch.current === epoch) setError((e as Error).message); }
    finally { setDetecting(null); }
  }

  /** Iris's kept checks after a run, or a check removed (docs/detection.md, "Kept checks"): the list of every kept
   * check's clashes. From an imported report (or none) it opens afresh, as a report does; otherwise the work on the list
   * stays: the selected clash, marks, plans, views and the chat, and a fix's mark until the check that lists its clash
   * runs again (`pruneFixes`). An older list arriving late is ignored. Resolves with the list it shows. */
  async function adoptRun(r: Report | null, kept: CheckSummary[], ran: string | null, ranKeys: string[]): Promise<Report | null> {
    kept = kept ?? []; ranKeys = ranKeys ?? [];
    const was = reportNow.current;
    if (r && r.serial != null && r.serial < unionSerial.current && !!r.scene_id && was?.scene_id === r.scene_id) return was;
    const light = !!r && !!was && !!r.scene_id && was.origin === "iris" && was.scene_id === r.scene_id && r.origin === "iris";
    if (!r) {   // nothing kept any more: back to the setup card
      setReport(null); setClash(null); resetWork(); setChecked(new Set()); setFixes({}); setVerdicts(null);
    } else if (light) {
      const ids = new Set(r.clashes.map((c) => c.id));
      setReport(r);
      setFixes((f) => pruneFixes(f, r, ranKeys));
      setReviewed((rv) => Object.fromEntries(Object.entries(rv).filter(([id]) => ids.has(id))));
      setChecked((cs) => new Set([...cs].filter((id) => ids.has(id))));
      setVerdicts(null);
      const cur = clashRef.current;
      if (cur) { const still = r.clashes.find((c) => c.id === cur.id); if (still) setClash(still); else { setClash(null); resetWork(); } }
    } else if (!await loadReport(async () => r, "the clashes Iris found")) return null;
    unionSerial.current = r?.serial ?? 0;
    setChecks(kept); setRanCheck(ran);
    // The list shows what just ran (all of them after Run all again, or when it is the only check).
    setViewCheck(ran && kept.length > 1 ? ran : null);
    return r;
  }

  /** The chat or an agent ran a check: show the list without ending the chat turn that is still answering about it. */
  async function adoptChatReport(reportId: string, kept: CheckSummary[] | undefined, ran: string | null | undefined) {
    const workspace = workspaceEpoch.current;
    try {
      const r = await api.report(reportId);
      if (workspaceEpoch.current !== workspace) return;
      const list = kept ?? r.checks ?? [];
      const ranKeys = ran ? [ran] : list.map((c) => c.key);
      const now = reportNow.current;
      if (now?.origin === "iris" && !!r.scene_id && now.scene_id === r.scene_id) await adoptRun(r, list, ran ?? null, ranKeys);
      else {   // from an import or nothing: open it without ending the chat's turn
        setReport(r); setClash(null); setChecked(new Set()); setPlan(null); setPlanRun(null); setPlanError(null); setFixes({}); setReviewed({});
        setVerdicts(null); setViews({}); captures.current.clear();
        unionSerial.current = r.serial ?? 0;
        setChecks(list); setRanCheck(ran ?? null); setViewCheck(ran && list.length > 1 ? ran : null);
      }
      // Run again repeats what chat or the agent ran: a check on filters stays that check.
      const k = list.find((c) => c.key === ran);
      lastTests.current = k ? k.tests ?? null : null;
    } catch (e) { setError((e as Error).message); }
    finally { setDetecting(null); }
  }

  /** From an imported report back to the list of Iris's kept checks (made again if the server let it go). */
  async function backToChecks() {
    if (!sceneId) return;
    try {
      const info = await api.checks(sceneId);
      if (!info.report_id) { setChecks([]); return; }
      const r = await api.report(info.report_id);
      await adoptRun(r, info.checks, null, []);
    } catch (e) { setError((e as Error).message); }
  }

  /** Drop a check on filters: its clashes leave the list unless another check found them too. */
  async function removeCheck(key: string) {
    if (!sceneId || busy || detecting) return;
    try {
      const out = await api.removeCheck(sceneId, key);
      await adoptRun(out.report, out.checks, null, []);
    } catch (e) { setError((e as Error).message); }
  }

  /** A clash Iris found has no pictures: take its A/B/C views in the viewer and keep them on the server, where the
   * fix agent, triage and the PDF use them as they use Navisworks views. Once per clash. */
  function captureViews(reportId: string, clashId: string, ga: string, gb: string): Promise<void> {
    const pending = captures.current.get(clashId);
    if (pending) return pending;
    const shots = viewer.current?.captureClash(ga, gb);
    if (!shots) return Promise.resolve();
    setCapturing(clashId);
    const p = (async () => {
      let labels: string[] = [];
      for (const label of ["A", "B", "C"] as const) labels = await api.saveView(reportId, clashId, label, await (await fetch(shots[label])).blob());
      setViews((v) => ({ ...v, [clashId]: labels }));
    })().catch(() => undefined).finally(() => setCapturing((c) => (c === clashId ? null : c)));
    captures.current.set(clashId, p);
    return p;
  }

  function upload(list: FileList | File[] | null) {
    if (busy) return;
    const files = [...(list ?? [])].filter((f) => /\.(xml|png|jpe?g)$/i.test(f.name));
    if (!files.length) return setError("Choose a Navisworks XML report, or the folder it was exported to.");
    loadReport(() => api.uploadReport(files), `${files.length} file${files.length > 1 ? "s" : ""}`);
  }

  /** Select a report clash and take the view to it, or (`keepPlan`) only select it while a plan stays on screen. */
  function selectClash(c: ReportClash, keepPlan = false) {
    if (!keepPlan) clearManual();
    if (c.id !== clash?.id) {
      setClash(c); clashRef.current = c; resetWork(keepPlan); setLightbox(null);
      // Its own work comes back: the proposal running for it, else the one it finished (kept for the session). A run
      // for another clash goes on in the background, without driving the view.
      const live = runningNow.current?.id === c.id ? runState.current : null;
      const done = doneProposals[c.id];
      if (live) { setProgress(live.progress); setProposal(live.proposal); setThoughts(live.thoughts); }
      else if (done) { setProgress(done.progress); setProposal(done.proposal); setThoughts(done.thoughts); setChosen(done.proposal.options.length ? 0 : null); }
      if (runningNow.current && runningNow.current.id !== c.id) pilot.current?.cancel();
    }
    if (keepPlan) return;
    setViewPlan(false); setViewContext(false);
    if (tab === "plan" && !planRun) setTab("clash");
    if (!matches) { setA(null); setB(null); return; }
    goToClash(c);  // every click navigates, also on the clash already selected
  }

  /** Single click: measure, or show the element's properties. Double click: pick element A, then B. A drag is an
   * orbit, never a pick. */
  function onClick(ev: React.MouseEvent) {
    const d = down.current;
    if (d && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > (coarse ? 10 : 5)) return;
    if (longPress.current?.fired) { longPress.current = null; return; }  // the long press already picked
    const hit = viewer.current?.pickAt(ev.nativeEvent);
    if (ev.detail === 2) {
      if (!hit || hit.globalId === a) return;
      pickSide(hit.globalId);
      return;
    }
    if (tool.measure) {
      viewer.current?.measureClick(ev.nativeEvent);
      viewsChanged();   // the panel says what to click next
      return;
    }
    if (tool.edit) { editTool.current?.click(ev.nativeEvent); return; }
    // Any element can be selected: in a see-through view a click that meets nothing in focus takes what is behind.
    const picked = hit ?? viewer.current?.pickAt(ev.nativeEvent, { ghosts: true }) ?? null;
    if (!picked) { setSelected(null); return; }
    if (tool.links || ev.altKey) void pinLinks(picked.globalId, ev.shiftKey);   // a tap on a touch screen, too
    const epoch = sceneEpoch.current;
    setSelected({ globalId: picked.globalId, info: null });
    if (sceneId) api.element(sceneId, picked.globalId)
      .then((info) => { if (sceneEpoch.current === epoch) setSelected((s) => (s?.globalId === picked.globalId ? { ...s, info } : s)); })
      .catch(() => undefined);
  }

  /** Pick element A, then B (a double click, a long press, or Set as A / B on its card). */
  function pickSide(gid: string, side: "a" | "b" = !a || (a && b) ? "a" : "b") {
    if (side === "a") { setA(gid); setB(null); } else setB(gid);
    setClash(null); resetWork();
    if (compact) {  // say what comes next, and show the pair once it is whole
      setSelected(null);
      flash(side === "a" ? "A set. Now pick element B: tap it, then Set as B." : "B set. Propose fixes, below.");
      if (side === "b") { setListOpen(false); if (tab === "chat") setTab("clash"); if (snap === "peek") setSnap("half"); }
    }
  }

  function flash(text: string) {
    setToast(text);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setToast(null), 2800);
  }
  const flashTimer = useRef(0);

  /** A long press (half a second, finger still) on a touch screen picks A then B, as a double click does. */
  function pressStart(e: React.PointerEvent) {
    down.current = { x: e.clientX, y: e.clientY };
    if (e.pointerType !== "touch" || tool.measure) return;
    window.clearTimeout(longPress.current?.timer);
    const at = { clientX: e.clientX, clientY: e.clientY } as MouseEvent;
    const press = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
    press.timer = window.setTimeout(() => {
      const hit = viewer.current?.pickAt(at);
      if (!hit || hit.globalId === a) return;
      press.fired = true;
      navigator.vibrate?.(10);
      pickSide(hit.globalId);
    }, 500);
    longPress.current = press;
  }
  function pressMove(e: React.PointerEvent) {
    const p = longPress.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { window.clearTimeout(p.timer); longPress.current = null; }
  }
  function pressEnd() {
    const p = longPress.current;
    if (p && !p.fired) { window.clearTimeout(p.timer); longPress.current = null; }
  }

  function toggle(k: "edges" | "section" | "measure" | "edit" | "links" | "ortho" | "grey") {
    // Editing and measuring each take the clicks: one at a time.
    setTool((t) => ({ ...t, [k]: !t[k], ...(k === "edit" && !t.edit ? { measure: false } : k === "measure" && !t.measure ? { edit: false } : {}) }));
    if (k === "links") clearHover();
  }

  // The connection highlight (docs/connections.md): what an element is linked to, lit by kind. The graph comes from
  // the server once per scene revision (and report: a check's contacts); pointing picks at most once a frame.
  const linkIx = useRef<{ key: string; ix: LinkIndex } | null>(null);
  const linkLoad = useRef<Promise<LinkIndex | null> | null>(null);
  const hover = useRef<{ gid: string | null; wide: boolean }>({ gid: null, wide: false });
  const hoverAt = useRef<{ clientX: number; clientY: number; wide: boolean } | null>(null);
  const hoverFrame = useRef(0);
  const hoverLabel = useRef<HTMLDivElement | null>(null);
  const labelAt = useRef({ left: 0, top: 0 });   // where the label goes when it first shows; moves set it directly
  const baseLinks = useRef<{ color: string; ids: string[] }[]>([]);   // what a shown option takes along
  const pinned = useRef<{ gid: string | null; groups: { color: string; ids: string[] }[] }>({ gid: null, groups: [] });
  const [hoverInfo, setHoverInfo] = useState<{ name: string | null; counts: string } | null>(null);

  function ensureLinks(): Promise<LinkIndex | null> {
    if (!sceneId) return Promise.resolve(null);
    const key = `${sceneId}:${sceneRevision.current ?? ""}:${report?.id ?? ""}`;
    if (linkIx.current?.key === key) return Promise.resolve(linkIx.current.ix);
    if (!linkLoad.current) {
      linkLoad.current = api.connections(sceneId)
        .then((g) => { const ix = indexGraph(g); linkIx.current = { key, ix }; return ix; })
        .catch(() => null)
        .finally(() => { linkLoad.current = null; });
    }
    return linkLoad.current;
  }

  async function lightLinks(gid: string, wide: boolean): Promise<{ name: string | null; counts: string } | null> {
    hover.current = { gid, wide };
    const ix = await ensureLinks();
    if (!ix || hover.current.gid !== gid) return null;
    const groups = highlightGroups(ix, gid, wide);
    viewer.current?.setLinks(groups);
    return { name: ix.graph.names?.[gid] ?? null, counts: countsText(groups) + (wide ? " · whole run" : "") };
  }

  /** What shows when nothing is pointed at: a shown option's carried parts and the selected element's pinned links. */
  function restoreLinks() {
    viewer.current?.setLinks([...baseLinks.current, ...pinned.current.groups]);
  }

  /** A click (a tap) with the toggle on or Alt held, or the card's Light them up: the links stay lit while the element
   *  is selected, under any hover. */
  async function pinLinks(gid: string, wide: boolean) {
    pinned.current = { gid, groups: [] };
    const ix = await ensureLinks();
    if (!ix || pinned.current.gid !== gid) return;
    pinned.current = { gid, groups: highlightGroups(ix, gid, wide) };
    if (!hover.current.gid) restoreLinks();
  }

  function unpin() {
    if (!pinned.current.gid) return;
    pinned.current = { gid: null, groups: [] };
    if (!hover.current.gid) restoreLinks();
  }

  function clearHover() {
    hover.current = { gid: null, wide: false };
    hoverAt.current = null;
    restoreLinks();
    setHoverInfo(null);
  }

  /** Pointing with Alt (Option) held, or with the Connections toggle on, lights what the element under the pointer is
   *  linked to; Shift widens it to the whole run. Never on touch (a tap does it), never while dragging. */
  function stageMove(e: React.PointerEvent) {
    pressMove(e);
    // On a touch screen a tap does it (some browsers also send a mouse-type move with the tap): hover only with Alt.
    if (e.pointerType === "touch" || e.buttons || (coarse && !e.altKey)) return;
    if (tool.edit) editTool.current?.hover(e.nativeEvent);
    if (tool.measure) {   // what the pointer snaps to, once a frame
      const at = { clientX: e.clientX, clientY: e.clientY } as MouseEvent;
      cancelAnimationFrame(measureFrame.current);
      measureFrame.current = requestAnimationFrame(() => viewer.current?.measureHover(at));
    }
    if (!(e.altKey || tool.links) || tool.measure) {
      if (hover.current.gid) clearHover();
      return;
    }
    hoverAt.current = { clientX: e.clientX, clientY: e.clientY, wide: e.shiftKey };
    const box = host.current?.getBoundingClientRect();
    if (box) {
      labelAt.current = { left: e.clientX - box.left + 14, top: e.clientY - box.top + 14 };
      if (hoverLabel.current) { hoverLabel.current.style.left = `${labelAt.current.left}px`; hoverLabel.current.style.top = `${labelAt.current.top}px`; }
    }
    if (hoverFrame.current) return;
    hoverFrame.current = window.requestAnimationFrame(() => {
      hoverFrame.current = 0;
      const at = hoverAt.current, v = viewer.current;
      if (!at || !v) return;
      const gid = v.pickAt({ clientX: at.clientX, clientY: at.clientY } as MouseEvent, { ghosts: true })?.globalId ?? null;
      if (gid === hover.current.gid && at.wide === hover.current.wide) return;
      if (!gid) { hover.current = { gid: null, wide: at.wide }; restoreLinks(); setHoverInfo(null); return; }
      void lightLinks(gid, at.wide).then((info) => { if (info && hover.current.gid === gid) setHoverInfo(info); });
    });
  }

  // Alt alone must not open the browser's menu bar (Windows), except while typing (Option composes characters on a
  // Mac); letting go of it, or leaving the window, ends the highlight unless the toggle keeps it on.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement
      && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    const onDown = (e: KeyboardEvent) => { if (e.key === "Alt" && !typing(e)) e.preventDefault(); };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      if (!typing(e)) e.preventDefault();
      if (!tool.links && hover.current.gid) clearHover();
    };
    const onBlur = () => { if (hover.current.gid) clearHover(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", onBlur); };
  }, [tool.links]);

  // Pinned links go with the selection that pinned them.
  useEffect(() => {
    if (pinned.current.gid && pinned.current.gid !== selected?.globalId) unpin();
  }, [selected?.globalId]);

  /** Keep the saved views and Home for these models. */
  function storeViews(next: Partial<ViewsStore>) {
    const store = { ...loadViews(modelNames), ...next };
    saveViews(modelNames, store);
    if (next.saved) setSavedViews(next.saved);
  }
  function saveView(name: string) {
    const v = viewer.current;
    if (!v) return;
    const box = v.section;
    const view: SavedView = { name, pose: v.pose(), ortho: tool.ortho, style: tool.style, mode: tool.mode, filters,
      section: box ? [box.min.toArray(), box.max.toArray()] : null, rules: filterState };
    storeViews({ saved: [...savedViews, view] });
  }
  function applyView(view: SavedView) {
    const v = viewer.current;
    if (!v) return;
    v.applyPose(view.pose);
    setFilters(view.filters);
    if (view.rules) { const restored = migrate(view.rules); restoredFilters.current = restored; setFilterState(restored); setFilterDraft(null); }
    setTool((t) => ({ ...t, ortho: view.ortho, style: view.style, mode: view.mode, section: !!view.section }));
    if (view.section) {
      const box = v.boxOf([]);
      box.min.fromArray(view.section[0]); box.max.fromArray(view.section[1]);
      if (tool.section) v.setSection(true, 0, box); else sectionTo.current = box;
    }
  }
  /** A section box round the selected element (its card), on or moved. */
  function sectionRound(gid: string) {
    const box = viewer.current?.boxOf([gid]);
    if (!box || box.isEmpty()) return;
    if (tool.section) viewer.current?.setSection(true, undefined, box);
    else { sectionTo.current = box.expandByScalar(0.5); setTool((t) => ({ ...t, section: true })); }
  }
  const temporaryCount = temporary.hidden.length + (temporary.isolated ? 1 : 0);
  // The Visibility menu's levels and classes, with counts, read again when the viewer learns them.
  const counts = useMemo(() => viewer.current?.infoCounts() ?? { classes: [], levels: [] }, [viewsTick, stats]);  // eslint-disable-line react-hooks/exhaustive-deps
  const viewsControls: ViewsControls = {
    canBack: !!viewer.current?.canBack, canForward: !!viewer.current?.canForward, fly, hasHome: !!viewer.current?.homeView,
    onBack: () => viewer.current?.back(), onForward: () => viewer.current?.forward(), onFly: setFly,
    onSetHome: () => { const p = viewer.current?.pose() ?? null; viewer.current?.setHome(p); storeViews({ home: p }); },
    onClearHome: () => { viewer.current?.setHome(null); storeViews({ home: null }); },
    saved: savedViews.map((v) => v.name), onSave: saveView, onApply: (i) => applyView(savedViews[i]),
    onDelete: (i) => storeViews({ saved: savedViews.filter((_, k) => k !== i) }),
    levels: counts.levels, classes: counts.classes, filters, onFilters: setFilters,
    temporary: temporaryCount, onResetTemporary: () => endIsolation(),
    rulesOn: filterState.rules.filter((r) => r.on).length, onOpenFilters: () => openFilters(),
    layout: shownLayout, layouts: layout === "phone" ? ["single"] : layout === "tablet" ? ["single", "two"] : ["single", "two", "quad"],
    onLayout: setViewLayout, drawings: drawingsShow, onDrawings: setDrawingsShow,
  };

  /** The Filters panel, with a new filter in the editor when one is given (from a property, or chat). */
  function openFilters(start?: Rule) {
    if (start) setFilterDraft(start);
    if (dockedNow.current) dock.current?.show("filters"); else setFiltersOpen(true);
  }

  function setModelVisible(i: number, visible: boolean) {
    viewer.current?.setModelVisible(i, visible);
    setTool((t) => ({ ...t, hiddenModels: visible ? t.hiddenModels.filter((x) => x !== i) : [...t.hiddenModels, i] }));
  }

  function screenshot() {
    const url = viewer.current?.snapshot();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `iris-${clash ? `clash-${clash.number}` : "view"}.png`;
    link.click();
  }

  /** Where the 3D view's own tools go (docs/measure.md, "The rail"): with several panes, into the 3D pane (none while a
   * drawing is maximised); with one view, null: one rail at the stage's left. */
  function rail3d(): { shown: boolean; x: number; y: number; h: number } | null {
    const v = viewer.current;
    if (!v || v.panes.length < 2) return null;
    const shown = v.visiblePanes();
    if (shown.length === 1 && shown[0].spec.kind === "3d") return null;
    const r = v.rect3d();
    return { shown: shown.some((p) => p.spec.kind === "3d"), x: r.x, y: r.y, h: r.h };
  }

  /** F: frame the selected element, else go to the clash. */
  function focusNow() {
    if (selected) viewer.current?.frame([selected.globalId]);
    else if (clash) goToClash(clash, undefined, true);
    else if (a || b) viewer.current?.frame([a, b].filter((g): g is string => !!g));
  }

  // Keyboard: 1-4 views, H home, F selection or clash, X/C/I/V modes, G style, O projection, Q layout, [ ] back and
  // forward, S section, E edges, M measure, L links, Esc one thing at a time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && !document.querySelector('[aria-modal="true"]')) {
        const key = e.key.toLowerCase();   // Ctrl+Z undoes the newest kept edit; Ctrl+Shift+Z or Ctrl+Y redoes it
        if (key === "z" || key === "y") { e.preventDefault(); void stepEdit(key === "z" && !e.shiftKey ? "undo" : "redo"); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing) return;
      // A modal over the page (About Iris, the report, the agent link, requirements) has its own keys: Esc closes it,
      // and must not also leave the clash underneath.
      if (document.querySelector('[aria-modal="true"]')) return;
      const views: Record<string, Preset> = { "1": "top", "2": "front", "3": "right", "4": "iso" };
      const modes: Record<string, ViewMode> = { x: "xray", c: "context", i: "isolate", v: "shaded" };
      const k = e.key.toLowerCase();
      if (tool.edit && k !== "p" && k !== "escape" && editTool.current?.key(k)) { e.preventDefault(); return; }
      if (views[k]) viewer.current?.view(views[k]);
      else if (k === "h") viewer.current?.home();
      else if (k === "g") setTool((t) => ({ ...t, style: STYLES[(STYLES.findIndex((s) => s.id === t.style) + 1) % STYLES.length].id }));
      else if (k === "o") toggle("ortho");
      else if (k === "q" && layout !== "phone") setViewLayout((l) => (l === "single" ? "two" : l === "two" && layout !== "tablet" ? "quad" : "single"));
      else if (k === "[") viewer.current?.back();
      else if (k === "]") viewer.current?.forward();
      else if (k === "f") focusNow();
      else if (modes[k]) setTool((t) => ({ ...t, mode: modes[k] }));
      else if (k === "s") toggle("section");
      else if (k === "e") toggle("edges");
      else if (k === "m") toggle("measure");
      else if (k === "p" && sceneId) toggle("edit");
      else if (k === "n" && tool.measure) setSnapping((on) => !on);
      else if (k === "l") toggle("links");
      else if (k === "w" && workings.on && !compact) setActivityView(workings.view === "work" ? "steps" : "work");
      else if (k === "escape") {
        // One thing at a time: the measure, the image dialog, the selected element, then the clash.
        unpin(); clearHover();
        // The clash is left only where its chip shows: a clash plan or a wider fix keeps it (their own panels close them).
        const step = escStep({ editing: !!tool.edit, measuring: tool.measure, lightbox: !!lightbox, selection: !!selected,
          clash: !!(clash || a || b) && !viewPlan && !activeContext, working: clashBusy });
        if (step === "edit") { if (!editTool.current?.escape()) toggle("edit"); }
        else if (step === "measure") { if (viewer.current?.measureCancel()) viewsChanged(); else toggle("measure"); }
        else if (step === "lightbox") setLightbox(null);
        else if (step === "selection") setSelected(null);
        else if (step === "clash") leaveClash();
      }
      else return;
      e.preventDefault();
    };
    // A panel in its own window (dock.tsx) takes the same keys.
    const windows = [window, ...popouts];
    for (const w of windows) w.addEventListener("keydown", onKey);
    return () => { for (const w of windows) w.removeEventListener("keydown", onKey); };
  });

  /** Start showing the agent's progress; returns the handler for its events and a function to call when done. With
   * `first` (a second try), the first try's ideas stay in the activity table and the second's are numbered after them. */
  function trackAgent(first: Proposal | null = null, origin: Origin = "you", title = "", forClash: ReportClash | null = clashRef.current) {
    directContext.current?.retire();
    clearManual();
    const trace = traceStart("propose", origin, title, { second: !!first, scene: sceneId });
    setPeek(null);
    const run = ++agentRun.current;
    const epoch = sceneEpoch.current;
    const live = () => agentRun.current === run && sceneEpoch.current === epoch;
    // The run is for one clash: its progress, proposal and thoughts are its own (`runState`) and reach the panel only
    // while that clash is on screen, so opening another clash meanwhile shows that one's work, not this run's.
    const forId = forClash?.id ?? null;
    const here = () => forId === null || (clashRef.current?.id ?? null) === forId;
    setError(null); setChosen(null); setViewPlan(false); setViewContext(false); setReplaying(false);
    const t = Date.now();
    let p: Progress = { started: t, round: 1, phase: "thinking", thinkingSince: t, modelSeconds: [], ideas: 0, checking: null,
      ...(first ? { model: wonder, offset: first.attempts.length } : {}) };
    let q: Proposal | null = first ? { understanding: first.understanding, options: [], attempts: first.attempts, advice: first.advice }
      : { understanding: "", options: [], attempts: [] };
    let th: { round: number; text: string }[] = [];
    const own: { id: string | null; progress: Progress; proposal: Proposal | null; thoughts: { round: number; text: string }[] } =
      { id: forId, progress: p, proposal: q, thoughts: th };
    runState.current = own;
    const keep = () => { own.progress = p; own.proposal = q; own.thoughts = th; };
    setRunning(forClash ? { id: forClash.id, number: forClash.number, run } : null);
    setProgress(p); setNow(t); setProposal(q); setThoughts(th);
    pilot.current?.start(first ? wonder : undefined);
    const update = (next: Partial<Progress>) => { p = { ...p, ...next }; keep(); if (here()) setProgress(p); };
    const setQ = (f: (x: Proposal) => Proposal) => { if (!q) return; q = f(q); keep(); if (here()) setProposal(q); };
    const setTh = (f: (x: { round: number; text: string }[]) => { round: number; text: string }[]) => { th = f(th); keep(); if (here()) setThoughts(th); };
    const ended = () => { const r = runningNow.current; if (r && r.run === run) setRunning(null); };
    let attempts = first?.attempts.length ?? 0;
    // Work that took over ends this run's record too (a plan, a wider fix, other models), whichever of these sees it first.
    const superseded = () => { if (live()) return false; trace.end("Stopped when newer work took over"); ended(); return true; };
    const onEvent = (e: AgentEvent) => {
      if (superseded()) return;
      trace.add(e);
      if (here()) pilot.current?.event(e);
      // A second try starting in the same stream (automatic): its ideas are numbered after the first's.
      if (e.type === "escalating") {
        const seed = !first && !attempts && e.first_try?.attempts.length ? e.first_try : null;
        if (seed) {   // a try the page didn't watch (a plan's item): its ideas lead the table
          attempts = seed.attempts.length;
          setQ((x) => ({ ...x, understanding: seed.understanding, advice: seed.advice, attempts: seed.attempts }));
        }
        update({ model: e.model, offset: attempts, round: 1, modelSeconds: [] }); setTh(() => []);
        if (here()) pilot.current?.model(e.model, attempts);
      }
      else if (e.model && e.model !== p.model && p.offset == null) update({ model: e.model });
      if (e.type === "attempt") attempts += 1;
      if (e.type === "note") setTh((x) => [...x, { round: p.round, text: e.text }]);   // e.g. why no second try
      if (e.type === "reasoning") setTh((x) => [...x, { round: e.round, text: e.text }]);
      if (e.type === "thinking") update({ round: e.round, phase: "thinking", thinkingSince: Date.now(), checking: null });
      if (e.type === "ideas") {
        update({ phase: "checking", modelSeconds: [...p.modelSeconds, e.seconds], ideas: e.count });
        setQ((x) => ({ ...x, understanding: e.understanding }));
      }
      if (e.type === "checking") update({ checking: { index: e.index, title: e.title, kind: e.kind } });
      if (e.type === "attempt") {
        const { type: _t, index: _i, ...attempt } = e;
        setQ((x) => ({ ...x, attempts: [...x.attempts, attempt] }));
      }
    };
    const finish = (result: Proposal | null) => {
      if (superseded()) return;
      if (result) trace.add({ ...result, type: "result" });
      trace.end(result ? null : "Stopped before a result");
      const show = () => {
        if (!live()) { ended(); return; }
        // A second try that failed or was refused: the first try's fixes stand.
        const final = result ?? first;
        if (final) q = final;
        if (result?.recommendation) noteRecommendation(result.recommendation, [a, b] as const);
        p = { ...p, phase: "done", checking: null }; keep();
        // Kept for its clash (a result, or the first try's that stands): its row says it is ready, and opening it
        // again shows it.
        if (forId && final) { const doneP = p, doneTh = th; setDoneProposals((k) => ({ ...k, [forId]: { proposal: final, progress: doneP, thoughts: doneTh } })); }
        ended();
        if (here()) { if (final) { setProposal(final); setChosen(final.options.length ? 0 : null); } setProgress(p); }
        setNow(Date.now());
      };
      if (pilot.current && here()) pilot.current.finish(show); else show();
    };
    const retire = () => {
      if (superseded()) return;
      trace.end("Stopped");
      ++agentRun.current; pilot.current?.cancel(); ended();
      const owned = p;
      if (owned.phase !== "done") {
        const retired: Progress = { ...owned, phase: "done", checking: null };
        setProgress((current) => current === owned ? retired : current);
      }
    };
    return { onEvent, finish, live, retire, trace };
  }

  /** Each run the page watches, logged for Workings (docs/workings.md): one of each kind at a time, a new one ending the
   * one it replaces. Workings needs more room than the table, so the bottom bar grows for a run when it is short. */
  const traces = useRef<Partial<Record<RunKind, RunHandle>>>({});
  const chatTitle = useRef("");   // the clash the chat's propose_fixes named, for its run's title
  const grownFrom = useRef<number | null>(null);
  function traceStart(kind: RunKind, origin: Origin, title: string, meta: Record<string, unknown> = {},
                      { alone = true, grow = true }: { alone?: boolean; grow?: boolean } = {}) {
    if (alone) traces.current[kind]?.end("Another run took its place");
    const trace = runs.start(kind, { origin, title, meta });
    if (alone) traces.current[kind] = trace;
    void grow;   // a run no longer opens the Activity bar by itself: the page header's status line says what is happening
    return trace;
  }
  /** An element's name, from the open report's clashes (for a run's title). */
  const elementName = (id: string) => { for (const c of report?.clashes ?? []) for (const e of [c.a, c.b]) if (e.global_id === id) return e.name; return ""; };
  /** A proposal's title: its clash, else the pair by name. */
  const pairTitle = (c: ReportClash | null | undefined, x?: string | null, y?: string | null) => c ? clashLabel(c)
    : x && y ? `${elementName(x) || "Element A"} × ${elementName(y) || "Element B"}` : "";
  function growActivity() {
    const was = dock.current?.fitBar("activity", WORKINGS_HEIGHT, { below: WORKINGS_SHORT }) ?? null;
    if (was != null && grownFrom.current == null) grownFrom.current = was;
  }
  /** Steps or Workings in the Activity panel; back on Steps, a bar Workings grew is given back. */
  function setActivityView(view: ActivityView) {
    setWorkings((w) => ({ ...w, view }));
    if (!docked) return;
    if (view === "work") growActivity();
    // Only from the height Workings set: a bar the person has resized since stays as they left it.
    else if (grownFrom.current != null) { dock.current?.fitBar("activity", grownFrom.current, { at: WORKINGS_HEIGHT }); grownFrom.current = null; }
  }
  function setWorkingsOn(on: boolean) {
    if (!on && workings.view === "work") setActivityView("steps");
    setWorkings((w) => ({ on, view: on ? "work" : w.view === "work" ? "steps" : w.view }));
    if (on && docked) growActivity();
  }

  /** Propose fixes for the pair (Gemini Pro, up to three rounds). */
  function propose() { return runProposal(false); }
  /** A second, longer try on Gemini Pro (deep think), reading this try (docs/escalation.md): after no fix, or for a better one. */
  function escalate() { return runProposal(true); }

  /** A failed Fix-together item: its clash, then a second try on it (reading the plan's try at that pair). */
  function escalateItem(it: PlanItem) {
    const c = report?.clashes.find((x) => it.clash_ids.includes(x.id)) ?? null;
    if (c) selectClash(c); else { resetWork(); setA(it.element_a); setB(it.element_b); }
    setViewPlan(false); showClashTab();
    void runProposal(true, { a: it.element_a, b: it.element_b, clash: c });
  }

  /** `pick`: a pair other than the one shown (a plan's item; the page's selection catches up as this runs). */
  async function runProposal(second: boolean, pick?: { a: string; b: string; clash: ReportClash | null }) {
    const ea = pick ? pick.a : a, eb = pick ? pick.b : b, on = pick ? pick.clash : clash;
    if (!sceneId || !ea || !eb || busy || runningNow.current) return;   // one proposal at a time
    replaceChatWork();
    const tracker = trackAgent(second && !pick ? proposal : null, "you", pairTitle(on, ea, eb), on); directAgent.current = tracker;
    const { onEvent, finish } = tracker;
    const run = agentRun.current;
    const from = on && report ? { report_id: report.id, clash_id: on.id } : undefined;
    // A clash Iris found: give the agent its views, as a Navisworks report would (waiting a few seconds at most).
    if (on && report?.origin === "iris" && !on.images.length && !views[on.id])
      await Promise.race([captureViews(report.id, on.id, ea, eb), new Promise((r) => setTimeout(r, 4000))]);
    let result: Proposal | null = null;
    const notes = pick ? "" : rejectionNotes(rejected);   // what the person set aside for this pair, and why
    try { result = await api.proposeStream(sceneId, ea, eb, from, onEvent, second, notes); }
    catch (e) { if (agentRun.current === run) { setError((e as Error).message); tracker.trace.add({ type: "error", detail: (e as Error).message }); } }
    finally { finish(result); }
  }

  /** Play a recorded proposal (the tour's fallback when the live one fails or is slow) through the same viewer and
   * pilot, at the pace it was recorded. Accepting its fix edits the model for real, like a live one. */
  async function replayPropose(which: "duct" | "joint" | "ladder") {
    const c = which === "ladder" ? clashOfNames(CELL.ladder, CELL.post)[0] : clashOfPair(TOUR[which]);
    if (!c || !sceneId) return;
    replaceChatWork();
    if (clash?.id !== c.id) selectClash(c);
    const epoch = sceneEpoch.current;
    // Recorded on Oct 27 from the imported report, where these were c0053 and c0051.
    const rec: { events: { t: number; event: AgentEvent | ({ type: "result" } & Proposal) }[] } =
      await (await fetch(`/tour/${{ duct: "c0053", joint: "c0051", ladder: "cell-ladder" }[which]}.json`)).json();
    if (sceneEpoch.current !== epoch) return;
    const tracker = trackAgent(null, "replay", clashLabel(c)); directAgent.current = tracker;
    const { onEvent, finish } = tracker;
    const run = agentRun.current;
    setReplaying(true);
    const start = Date.now();
    for (const { t, event } of rec.events) {
      const wait = start + t * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (agentRun.current !== run) { tracker.trace.end("Stopped when newer work took over"); return; }
      if (event.type === "result") { finish(event as Proposal); setReplaying(false); return; }
      onEvent(event as AgentEvent);
    }
    finish(null); setReplaying(false);
  }

  /** Play a recorded plan (the tour's fallback), at the pace it was recorded: the girder's root cause (Northbank) or
   * the air pipe through both conveyor rails, fixed together (the cell). */
  async function replayPlan(which: "girder" | "pipe" = "girder") {
    replaceChatWork();
    const epoch = sceneEpoch.current;
    const rec: { events: { t: number; event: PlanEvent }[] } =
      await (await fetch(which === "girder" ? "/tour/girder-plan.json" : "/tour/cell-pipe-plan.json")).json();
    if (sceneEpoch.current !== epoch) return;
    // It was recorded on the imported report: point its clash ids at this report's clashes of the same element pairs
    // (a fix item names its pair; a hub partner pairs with the hub).
    const pairIds = (x: string, y: string) => (report?.clashes ?? [])
      .filter((c) => [c.a.global_id, c.b.global_id].sort().join("|") === [x, y].sort().join("|")).map((c) => c.id);
    const remap = (o: unknown): unknown => {
      if (Array.isArray(o)) return o.map(remap);
      if (!o || typeof o !== "object") return o;
      const out: Record<string, unknown> = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remap(v)]));
      const pair = typeof out.element_a === "string" && typeof out.element_b === "string" ? [out.element_a, out.element_b]
        : typeof out.global_id === "string" && "in_report" in out ? [out.global_id, TOUR.girder] : null;
      if (pair && Array.isArray(out.clash_ids)) {
        // a merged item (one element, several partners) stands for the clashes with every partner
        const partners = [pair[1], ...(Array.isArray(out.others) ? out.others as string[] : [])];
        out.clash_ids = partners.flatMap((p) => pairIds(pair[0], p));
        out.in_report = (out.clash_ids as string[]).length > 0;
      }
      if (Array.isArray(out.partners)) {
        const partners = out.partners as { clash_ids: string[]; in_report?: boolean }[];
        out.clash_ids = [...new Set(partners.flatMap((x) => x.clash_ids))];
        out.not_in_report = partners.filter((x) => !x.in_report).length;
      }
      return out;
    };
    rec.events = rec.events.map((e) => ({ ...e, event: remap(e.event) as PlanEvent }));
    const tracker = trackPlan(which === "girder" ? "root_cause" : "batch", "replay",
      which === "girder" ? "Transfer plate girder 1000 deep - grid 3" : "The air pipe through both rails"); directPlan.current = tracker;
    const { onEvent, finish, live } = tracker;
    setReplaying(true);
    const start = Date.now();
    for (const { t, event } of rec.events) {
      const wait = start + t * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!live()) { tracker.trace.end("Stopped when newer work took over"); return; }
      if (event.type === "plan") { finish(event); setReplaying(false); return; }
      if (event.type !== "error") onEvent(event);
    }
    finish(null); setReplaying(false);
  }

  /** Start showing a plan being built; returns the handler for its events and a function to call when done. */
  function trackPlan(kind: "batch" | "root_cause", origin: Origin = "you", title = "") {
    directContext.current?.retire();
    const trace = traceStart("plan", origin, title, { kind });
    const epoch = sceneEpoch.current, request = ++planRequest.current;
    const live = () => sceneEpoch.current === epoch && planRequest.current === request;
    ++agentRun.current; pilot.current?.cancel(); setRunning(null);
    resetWork(); setPlan(null); setError(null); setPlanError(null);
    setViewPlan(true); setViewContext(false); setPlanKind("batch");
    const t = Date.now();
    let run: PlanRun = { kind, started: t, phase: kind === "root_cause" ? "cause" : "fixing", rootCause: "", items: [], status: {} };
    setPlanRun(run); setNow(t);
    const update = (f: (r: PlanRun) => PlanRun) => { run = f(run); setPlanRun(run); };
    const superseded = () => { if (live()) return false; trace.end("Stopped when newer work took over"); return true; };
    const onEvent = (e: PlanEvent) => {
      if (superseded()) return;
      trace.add(e);
      if (e.type === "root_cause") update((r) => ({ ...r, rootCause: e.root_cause, phase: "fixing" }));
      if (e.type === "plan_items") update((r) => ({ ...r, phase: "fixing", items: e.items,
        status: Object.fromEntries(e.items.map((i) => [i.key, { state: "waiting" as const }])) }));
      if (e.type === "item") update((r) => ({ ...r, status: { ...r.status, [e.key]: {
        state: e.status, ok: e.ok, note: e.status === "thinking" ? `${labels.proposal} is looking…` : e.status === "checking" ? `checked: ${e.attempt}` : e.title } } }));
      if (e.type === "checking_plan") update((r) => ({ ...r, phase: "checking" }));
    };
    const finish = (p: Plan | null) => {
      if (superseded()) return;
      if (p) trace.add({ ...p, type: "plan" });
      trace.end(p ? null : "Stopped before a plan");
      if (p) { setPlan(p); planRevision.current = sceneRevision.current; }   // what its joint check was made on
      update((r) => ({ ...r, phase: "done" })); setNow(Date.now());
    };
    const retire = () => {
      if (superseded()) return;
      trace.end("Stopped when newer work took over");
      const retiredRequest = ++planRequest.current, owned = run;
      if (owned.phase !== "done") {
        const note = "Stopped when newer work took over.";
        const retired: PlanRun = { ...owned, phase: "done", status: Object.fromEntries(Object.entries(owned.status).map(([key, value]) =>
          [key, value.state === "done" ? value : { ...value, state: "done", ok: false, note }])) };
        setPlanRun((current) => current === owned ? retired : current);
        setPlanError((current) => planRequest.current === retiredRequest ? note : current);
      }
    };
    return { onEvent, finish, live, retire, trace };
  }

  /** Build a plan: several ticked clashes together, or the root cause around one element. */
  async function runPlan(body: { clash_ids?: string[]; hub?: string }) {
    if (!sceneId || !report || busy) return;
    replaceChatWork();
    setTab("plan");
    const tracker = trackPlan(body.hub ? "root_cause" : "batch", "you",
      body.hub ? elementName(body.hub) : `${body.clash_ids?.length ?? 0} clashes`); directPlan.current = tracker;
    const { onEvent, finish, live } = tracker;
    let p: Plan | null = null;
    try { p = await api.planStream(sceneId, { report_id: report.id, fixed: resolved, ...body }, onEvent); }
    catch (e) { if (live()) { setPlanError((e as Error).message); tracker.trace.add({ type: "error", detail: (e as Error).message }); } }
    finally { finish(p); }
  }

  async function acceptPlan() {
    if (!sceneId || !plan || busy || planStale) return;
    replaceChatWork(); retireDirectWork(); clearManual();
    const epoch = sceneEpoch.current;
    const live = () => sceneEpoch.current === epoch;
    const items = plan.items.filter((i) => i.option && (plan.check.passed || plan.check.items[i.key]?.passed));
    setBusy(`Applying ${items.length} fix${items.length > 1 ? "es" : ""}…`);
    const pics = captureFix(items.map((i) => i.option!), "#1f9d3a");
    const built = items.map((i) => {
      const key = builtKey([i.element_a, i.element_b], i.option!);
      return canBuild(i.option!) && builtDone.current[key]?.status !== "done" && !builtPending.current.has(key)
        ? builtPasses(builtFix(i.option!, false), [i.element_a, i.element_b]) : null;
    });
    try {
      // Each fix names its clash: the server tries them again, alone and together, before keeping any.
      const refs = items.map((i) => clashRefFor(i.clash_ids?.[0] ?? null));
      const kept = await api.applyPlan(sceneId, items.map((i) => ({ ...i.option!, pair: [i.element_a, i.element_b], others: i.others ?? [] })),
        items.map((i) => i.clash_ids?.[0] ?? null),
        { reviewer, clash_keys: refs.map((r) => r?.key ?? null), numbers: refs.map((r) => r?.number ?? null) });
      const pieces = kept.pieces;
      if (!live()) return;
      if (kept.decisions?.length) noteDecisions(kept.decisions);
      staleContext();
      viewer.current?.preview([]);
      await applyToViewer(sceneId, kept, pieces, live);
      if (!live()) return;
      setEdits((e) => {
        const next = { ...e };
        for (const ps of pieces) if (ps.length) { const [first, ...added] = ps; next[first] = [...(next[first] ?? []), ...added]; }
        return next;
      });
      // A merged item (one pipe through two rails) fixes its clashes with every partner. A penetration its host's team
      // must cut was only asked for: its clashes stay open.
      const pairsOf = (i: PlanItem) => [i.element_b, ...(i.others ?? [])].map((o) => [i.element_a, o] as const);
      const requested = new Map((kept.not_cut ?? []).map((n) => [n.index, n.blocked_by] as const));
      const done = items.filter((_, k) => !requested.has(k));
      markFixed(done.flatMap(pairsOf), done.flatMap((i) => pairsOf(i).map(() => i.option!.title)));
      const groups = items.map((i) => clashIdsOf(pairsOf(i)).flat());
      setEvidence((ev) => {
        const next = { ...ev };
        items.forEach((it, k) => {
          const why = requested.get(k);
          for (const id of new Set([...groups[k], ...it.clash_ids])) {
            next[id] = why == null ? evidenceOf(it.option!, "accepted", pics) : { ...evidenceOf(it.option!, "recommended", pics), blocked_by: why };
          }
        });
        return next;
      });
      items.forEach((it, k) => { if (!requested.has(k)) buildAccepted(it.option!, [it.element_a, it.element_b],
        [...new Set([...groups[k], ...it.clash_ids])], built[k], kept.groups?.[k]?.[0]); });
      setPlan(null); setPlanRun(null); setChecked(new Set()); setRemeasure((n) => n + 1);
    } catch (e) { if (live()) setError((e as Error).message); } finally { if (live()) setBusy(null); }
  }

  /** Bring the viewer up to a kept fix: patch the changed elements in place when the server sent them and this page's
   * model is at the revision the fix started from (viewer/patch.ts); otherwise reload the files it changed. */
  async function applyToViewer(sid: string, kept: { files: number[] } & Patch, pieces: string[][] | undefined, live: () => boolean) {
    // File indexes hold only within one layout: a model added or removed elsewhere means loading the files again.
    if (kept.layout != null && sceneLayout.current != null && kept.layout !== sceneLayout.current) {
      await reloadModels(sid, live);
      if (live()) void refreshJournal(sid);
      return;
    }
    const origin = new Map((pieces ?? []).flatMap((ps) => ps.slice(1).map((g) => [g, ps[0]] as const)));
    if (kept.meshes && kept.scene_id === sid && kept.revision_before != null && kept.revision_before === sceneRevision.current
        && viewer.current?.patch(kept.meshes, origin, kept.removed ?? [])) {
      sceneRevision.current = kept.revision ?? null;
      setInfoRev((n) => n + 1);   // the fix's new pieces: their classes and storeys for the filters
      void refreshJournal(sid);
      return;
    }
    // Reload this fix's files, and any file changed by an edit this page missed (after the revision it last drew; all of
    // them when it doesn't know), so it never jumps to a revision whose edits it hasn't drawn.
    const drawn = sceneRevision.current;
    const missed = (kept.history ?? []).filter(([rev]) => drawn == null || rev > drawn).flatMap(([, files]) => files);
    for (const i of [...new Set([...kept.files, ...missed])].sort((x, y) => x - y)) {
      const bytes = await api.file(sid, i);
      if (!live()) return;
      await viewer.current!.replace(i, bytes, live);
    }
    if (live()) { sceneRevision.current = kept.revision ?? null; setInfoRev((n) => n + 1); void refreshJournal(sid); }
  }

  /** Read the scene's edit log again (after any keep, undo or redo). The Edits panel comes into its side bar, behind
   * the tab in front, the first time there is something in it. */
  async function refreshJournal(sid: string) {
    const ask = ++journalAsk.current;
    try {
      const j = await api.journal(sid);
      if (ask !== journalAsk.current) return;
      setJournal(j);
      if (j.entries.length) dock.current?.place("edits");
    } catch { /* the scene went: the next one starts its own log */ }
  }

  /** Undo or redo the newest edit in the log (Ctrl+Z, Ctrl+Shift+Z, the Edits panel). A fix undone leaves its clash
   * open again; redone, fixed again. */
  async function stepEdit(dir: "undo" | "redo", entry?: string): Promise<boolean> {
    if (!sceneId || busy) return false;
    const sid = sceneId, epoch = sceneEpoch.current;
    const live = () => sceneEpoch.current === epoch;
    setBusy(dir === "undo" ? "Undoing…" : "Redoing…"); setError(null);
    try {
      const r = dir === "undo" ? await api.undo(sid, entry) : await api.redo(sid, entry);
      if (!live()) return false;
      return await afterStep(r);
    } catch (e) { if (live()) setError((e as Error).message); return false; } finally { if (live()) setBusy(null); }
  }

  /** What follows an undo or redo, from this page, chat or an agent: the model patched, a fix's clash open again (or
   * fixed again), the log read again. */
  async function afterStep(r: Stepped): Promise<boolean> {
    if (!sceneId) return false;
    const sid = sceneId, epoch = sceneEpoch.current;
    const live = () => sceneEpoch.current === epoch;
    viewer.current?.preview([]);
    if (selected && (r.removed ?? []).includes(selected.globalId)) setSelected(null);
    await applyToViewer(sid, r, [], live);
    if (!live()) return false;
    // Each clash as the server measured it after the step, whoever kept the entry: open again, or fixed (again)
    const states = r.clash_states ?? [];
    const open = states.filter((c) => !c.resolved).map((c) => [c.pair[0] ?? null, c.pair[1] ?? null] as const);
    const fixed = states.filter((c) => c.resolved).map((c) => [c.pair[0] ?? null, c.pair[1] ?? null] as const);
    if (open.length) {
      const ids = new Set(clashIdsOf(open).flat());
      setFixes((f) => Object.fromEntries(Object.entries(f).filter(([id]) => !ids.has(id))));
      setEvidence((ev) => Object.fromEntries(Object.entries(ev).map(([id, x]) => [id, ids.has(id) && x.status === "accepted" ? { ...x, status: "proposed" } : x])));
    }
    if (fixed.length) markFixed(fixed, fixed.map(() => r.entry.summary || r.entry.title));
    staleContext(); setRemeasure((n) => n + 1);
    return true;
  }

  /** A hand edit kept (the Edit tool): the model patched, the log read again, a clash it resolved marked fixed, and
   * the kept checks run again when it was kept with clashes, so they join the list. */
  async function keptEdit(k: EditKept) {
    if (!sceneId) return;
    const sid = sceneId, epoch = sceneEpoch.current;
    const live = () => sceneEpoch.current === epoch;
    if (selected && (k.removed ?? []).includes(selected.globalId)) setSelected(null);
    await applyToViewer(sid, k, k.pieces?.length ? [k.pieces] : [], live);
    if (!live()) return;
    if (k.entry) {   // the edit as it now looks, for the report ("After the edits")
      const pic = viewer.current?.capture(560);
      if (pic) void api.editPicture(sid, k.entry.id, pic).catch(() => undefined);
    }
    staleContext(); setRemeasure((n) => n + 1);
    const st = k.entry?.status as (JournalEntry["status"] & { pair?: string[] }) | null | undefined;
    if (st?.resolved && st.pair?.length === 2) markFixed([[st.pair[0], st.pair[1]]], [k.entry?.summary ?? "Edited by hand"]);
    // "Modify" sent the engineer here from a proposal: the edit kept for that clash is the proposal, modified by hand.
    const m = modifying.current;
    if (m && m.scene === sid && k.entry && (k.entry.clashes.some((c) => c.id === m.clash.id) || clashRef.current?.id === m.clash.id)) {
      modifying.current = null;
      void recordDecision(m.item, "modified", `Kept a hand edit instead: ${k.entry.summary || k.entry.title}`, m.clash);
    }
    setKept({ text: "Edit kept in the model", detail: k.entry ? `${k.entry.id}: ${k.entry.summary}` : "Checked again first", n: Date.now() });
    window.clearTimeout(keptTimer.current);
    keptTimer.current = window.setTimeout(() => setKept(null), 3200);
    if ((k.check?.clashes ?? 0) > 0) {
      if (report?.origin === "iris") void runDetect(null, sid, { all: true, ...(k.entry ? { after_edit: k.entry.id } : {}) });
      else flash("Kept with its clashes. Run Iris's check to list them.");
    }
  }

  /** Undo every edit newer than `e`, then `e` itself, newest first. */
  async function undoTo(e: JournalEntry) {
    const newer = (journal?.entries ?? []).filter((x) => x.state === "kept" && x.seq >= e.seq).sort((x, y) => y.seq - x.seq);
    for (const x of newer) if (!(await stepEdit("undo", x.id))) return;
  }

  /** The label the clash list shows for a clash id ("#042"), for the log's rows. */
  function clashTag(id: string): string | null {
    const c = report?.clashes.find((x) => x.id === id);
    return c ? clashLabel(c) : null;
  }

  /** Mark every report clash of these element pairs as fixed (one pair can be reported by several tests). */
  function markFixed(pairs: (readonly [string | null, string | null])[], titles: string[]) {
    if (!report || !matches) return;
    const byPair = new Map(pairs.map((p, i) => [[p[0], p[1]].sort().join("|"), titles[i]]));
    const fixed: Record<string, string> = {};
    for (const c of report.clashes) {
      const title = byPair.get([matches[c.id]?.a, matches[c.id]?.b].sort().join("|"));
      if (title) fixed[c.id] = title;
    }
    setFixes((f) => ({ ...f, ...fixed }));
    // Only here, after the server kept the fix: the mark settles once (docs/brand-assets.md, "Motion semantics").
    const n = Object.keys(fixed).length;
    if (n) {
      const one = report.clashes.find((c) => fixed[c.id]);
      setKept({ text: n === 1 ? "Fix kept in the model" : `${n} fixes kept in the model`, detail: n === 1 && one ? `${clashLabel(one)}: checked again` : "Each checked again", n: Date.now() });
      window.clearTimeout(keptTimer.current);
      keptTimer.current = window.setTimeout(() => setKept(null), 3200);
    }
  }

  function focusItem(it: PlanItem) {
    clearManual();
    const c = report?.clashes.find((x) => it.clash_ids.includes(x.id));
    setA(it.element_a); setB(it.element_b);
    if (c) goToClash(c, { a: it.element_a, b: it.element_b, how: [] });
    else viewer.current?.focusClash([it.element_a, it.element_b], null, it.in_report ? "" : "not in the report");
  }

  /** Context events own their objective and request generation, independent of later clash selection. */
  function trackContext(objective: ContextObjective | null) {
    directContext.current?.retire();
    const controller = new AbortController();
    const epoch = sceneEpoch.current, request = ++contextRequest.current;
    const live = () => sceneEpoch.current === epoch && contextRequest.current === request;
    ++agentRun.current; pilot.current?.cancel(); setRunning(null);
    resetWork(); setViewPlan(false); setViewContext(true); setPlanKind("context"); setCompare("after");
    setContextChosen(null); setAcknowledged([]);
    const started = Date.now(); setNow(started);
    let run: ContextRun = { objective, started, phase: "inspecting", messages: [], result: null, error: null, stale: false };
    setContext(run);
    const onEvent = (event: ContextEvent) => {
      if (!live()) return;
      run = contextStep(run, event); setContext(run);
      if (event.type === "context_result") {
        setContextChosen(event.proposals[0]?.id ?? null); setAcknowledged([]);
      }
    };
    const fail = (message: string) => onEvent({ type: "error", detail: message });
    const retire = () => {
      controller.abort();
      if (!live()) return;
      ++contextRequest.current;
      const owned = run;
      if (owned.phase !== "done") {
        const retired: ContextRun = { ...owned, phase: "done", error: "Search stopped when newer work took over. Regenerate for the original objective to continue." };
        setContext((current) => current === owned ? retired : current);
      }
    };
    return { onEvent, fail, live, retire, signal: controller.signal };
  }

  async function exploreContext(objective?: ContextObjective) {
    if (!sceneId || busy) return;
    const target = objective ?? (a && b ? { element_a: a, element_b: b,
      ...(clash && report && samePair(matches?.[clash.id]?.a, matches?.[clash.id]?.b, a, b)
        ? { report_id: report.id, clash_id: clash.id } : {}) } : null);
    if (!target) return;
    replaceChatWork();
    setTab("plan");
    const tracker = trackContext(target); directContext.current = tracker;
    try { await api.contextStream(sceneId, target, tracker.onEvent, tracker.signal); }
    catch (e) { if (!tracker.signal.aborted) tracker.fail((e as Error).message); }
  }

  function staleContext() {
    // The server alone decides revisions; local mutation only disables reuse of the old proposal.
    directContext.current?.retire(); ++contextRequest.current;
    setAcknowledged([]);
    setContext((r) => r && !r.accepted ? { ...r, phase: "done", stale: true } : r);
  }

  async function acceptContext() {
    if (!sceneId || !contextProposal || context?.stale || context?.accepted || contextWorking || busy) return;
    if (!contextProposal.review_conditions.every((c) => acknowledged.includes(c.id))) return;
    replaceChatWork(); retireDirectWork(); clearManual();
    const p = contextProposal, sid = sceneId, epoch = sceneEpoch.current, request = contextRequest.current;
    const live = () => sceneEpoch.current === epoch && contextRequest.current === request;
    setBusy("Rechecking and applying the complete proposal…");
    setContext((r) => r && { ...r, error: null });
    let committed = false;
    const pics = captureContext(p);
    try {
      const applied = await api.applyContext(sid, p.id, acknowledged);
      if (!live()) return;
      committed = true;
      // Every source in a moved group maps to its actual committed pieces, never trial mesh IDs.
      setEdits((old) => {
        const next = { ...old };
        for (const edit of applied.edits) for (const source of edit.moved)
          next[source] = [...new Set([...(next[source] ?? []), ...edit.pieces.filter((g) => g !== source)])];
        return next;
      });
      markFixed(applied.resolved_pairs.map((pair) => [pair.element_a, pair.element_b] as const), applied.resolved_pairs.map(() => p.title));
      const ids = clashIdsOf(applied.resolved_pairs.map((pair) => [pair.element_a, pair.element_b] as const)).flat();
      const accepted = contextEvidence(p, applied.checks, pics);
      setEvidence((ev) => ({ ...ev, ...Object.fromEntries(ids.map((id) => [id, accepted])) }));
      // Server commit is the boundary: none of the old single/batch options can still be accepted.
      setProposal(null); setChosen(null); setPlan(null); setPlanRun(null); setChecked(new Set());
      setContext((r) => r && { ...r, accepted: true });
      viewer.current?.preview([]);
      await applyToViewer(sid, applied, applied.pieces, live);
      if (!live()) return;
      setContext((r) => r && { ...r, accepted: true });
      setViewContext(false); setChosen(null); setPlan(null); setPlanRun(null); setChecked(new Set()); setRemeasure((n) => n + 1);
    } catch (e) {
      if (!live()) return;
      const conflict = e instanceof ApiError && (e.status === 409 || e.status === 404);
      setContext((r) => r && { ...r, accepted: committed, stale: conflict,
        error: committed ? `The proposal was accepted on the server, but the viewer could not show it: ${(e as Error).message}. ${stepFiles.length ? "Export STEP + IFC" : "Export IFC"} includes the accepted edits.`
          : conflict ? `Revision conflict or fresh checks failed: ${(e as Error).message}` : (e as Error).message });
      if (committed) setViewContext(false);
      if (conflict) setAcknowledged([]);
    } finally { if (sceneEpoch.current === epoch) setBusy(null); }
  }

  // The chat drives the page through events: select a clash, change the view, show the fix agent's work.
  const chatAgent = useRef<ReturnType<typeof trackAgent> | null>(null);
  const chatContext = useRef<ReturnType<typeof trackContext> | null>(null);
  function replaceChatWork() {
    // Close the turn boundary before starting direct work; old tool events cannot create a fresh tracker.
    chatOwner.current.invalidate();
    chatAgent.current?.retire(); chatPlan.current?.retire(); chatContext.current?.retire();
    chatAgent.current = null; chatPlan.current = null; chatContext.current = null; planThisTurn.current = false;
    chatEscalating.current = false;
    traces.current.chat?.end("Stopped when newer work took over");
  }
  /** A chat turn in Workings: the question, each model call, each tool and what the page did for it, the answer. The
   *  work a tool starts (a proposal, a plan, a check) is a run of its own. */
  function traceChat(e: ChatEvent) {
    if (e.type === "asked") {
      const t = traceStart("chat", "you", e.text.length > 60 ? `${e.text.slice(0, 59)}…` : e.text);
      t.add(e);
      return;
    }
    const turn = traces.current.chat;
    if (!turn) return;
    if (e.type === "thinking" || e.type === "tool" || e.type === "tool_result" || e.type === "message") turn.add(e);
    else if (e.type === "ui" && e.action === "filters")
      turn.add({ type: "ui", action: "filters", mode: e.mode, count: e.filters?.length ?? 0, names: (e.filters ?? []).map((r) => r.name || (r.by ? `colour by ${r.by.facet.replace(/^[a-z]+:/, "").split("/").pop()}` : r.action)).filter(Boolean),
        grey_rest: e.grey_rest, hide_rest: e.hide_rest });
    else if (e.type === "ui" && e.action === "open_report") turn.add({ type: "ui", action: "open_report" });
    else if (e.type === "ui") turn.add(e);
    else if (e.type === "error") { turn.add(e); turn.end(e.detail); }
    else if (e.type === "done") turn.end(null);
  }
  function onChatEvent(e: ChatEvent, origin: Origin = "chat") {
    if (origin === "chat") traceChat(e);
    if (e.type === "asked") return;
    if (e.type === "thinking") directContext.current?.retire();
    if (e.type === "tool" && e.name === "propose_fixes") {
      const c = report?.clashes.find((x) => x.id === e.args.clash_id);
      chatTitle.current = c ? clashLabel(c) : "";
    }
    if (e.type === "tool" && e.name === "explore_wider_fix") {
      const c = report?.clashes.find((x) => x.id === e.args.clash_id), pair = c && matches?.[c.id];
      chatContext.current = trackContext(c && pair?.a && pair.b ? { element_a: pair.a, element_b: pair.b, report_id: report!.id, clash_id: c.id } : null);
      planThisTurn.current = true;
    }
    if (e.type === "context_event") {
      const tracker = chatContext.current ?? trackContext(null);
      chatContext.current = tracker; tracker.onEvent(e.event); planThisTurn.current = true;
    }
    if (e.type === "ui" && e.action === "edit_preview") { setTool((t) => ({ ...t, edit: true, measure: false })); setIncomingEdit({ check: e.check, n: Date.now() }); }
    if (e.type === "ui" && e.action === "edit_kept") { setIncomingEdit(null); void keptEdit(e.kept); }
    if (e.type === "ui" && e.action === "edit_stepped") void afterStep(e.step);
    if (e.type === "ui" && e.action === "select_clash") {
      const c = report?.clashes.find((x) => x.id === e.clash_id);
      // Pointing at a clash after building a plan in the same reply: select it, but the plan keeps the view.
      if (c) selectClash(c, planThisTurn.current);
    }
    // Chat's check is titled as chat named it (a check on filters), and ends with the tool: chat's run sends no done.
    if (e.type === "tool" && e.name === "detect_clashes") {
      const named = typeof e.args?.name === "string" && e.args.name ? e.args.name : e.args?.a ? "A check on filters" : "The open models";
      traceStart("detect", origin, named); setDetecting({ phase: "Starting…", tests: [] });
    }
    if (e.type === "detect_event") onDetectEvent(e.event);
    if (e.type === "tool_result" && e.name === "detect_clashes") { traces.current.detect?.end(null); setDetecting(null); }
    if (e.type === "ui" && e.action === "open_report") void adoptChatReport(e.report_id, e.checks, e.check);
    // After select_clash has had a render to land (the chat names a clash, then asks for its picture).
    if (e.type === "ui" && e.action === "show_it_built") { const id = e.clash_id; setTimeout(() => builtFromChat(id), 80); }
    if (e.type === "ui" && e.action === "filters") {
      // Chat's filters replace its own; the user's that were on pause while they show, and come back when it clears.
      setFilterState((st) => {
        const mine = st.rules.filter((r) => r.origin !== "chat");
        if (e.mode === "clear") return { ...st, rules: mine.map((r) => (r.paused ? { ...r, on: true, paused: undefined } : r)) };
        const paused = mine.map((r) => (r.on ? { ...r, on: false, paused: true } : r));
        // Grey the rest and Hide the rest are one or the other: the one chat asks for turns the other off.
        const rest = e.hide_rest ? { hideRest: true, greyRest: false } : e.grey_rest ? { greyRest: true, hideRest: false }
          : { ...(e.grey_rest != null ? { greyRest: false } : {}), ...(e.hide_rest != null ? { hideRest: false } : {}) };
        return { ...st, colours: true, ...rest,
          rules: [...(e.filters ?? []).map((r) => ({ ...r, origin: "chat" as const })), ...paused] };
      });
      setFilterDraft(null);
      if (e.mode === "replace") openFilters();   // the views go to what they act on, as any filter applied
    }
    if (e.type === "ui" && e.action === "set_view") {
      setTool((t) => ({ ...t, ...(e.mode ? { mode: e.mode as ViewMode } : {}), ...(e.section_box != null ? { section: e.section_box } : {}) }));
    }
    if (e.type === "agent") {
      // A second try from chat: the first try's ideas stay; its own round 1 is not a new proposal.
      // Seeded from the server's own first try (the page's may be another clash's, or older than this turn).
      if (e.event.type === "escalating" && !chatAgent.current) {
        const f = e.event.first_try;
        chatAgent.current = trackAgent(f ? { understanding: f.understanding, advice: f.advice, attempts: f.attempts, options: f.options ?? [] }
          : { understanding: "", attempts: [], options: [] }, origin, chatTitle.current);
        chatEscalating.current = true;
      } else if (e.event.type === "escalating") chatEscalating.current = true;
      if (e.event.type === "thinking" && e.event.round === 1 && !chatEscalating.current) chatAgent.current = trackAgent(null, origin, chatTitle.current);
      chatAgent.current?.onEvent(e.event);
    }
    if (e.type === "proposal") {
      setA(e.element_a); setB(e.element_b);
      (chatAgent.current ?? trackAgent(null, origin, chatTitle.current)).finish(e);
      chatAgent.current = null; chatEscalating.current = false;
    }
    if (e.type === "plan_started") { chatPlan.current = trackPlan(e.kind, origin); planThisTurn.current = true; }
    if (e.type === "error") chatContext.current?.fail(e.detail);
    if (e.type === "tool_result" && e.name === "explore_wider_fix" && chatContext.current?.live()) {
      setContext((r) => r && r.phase !== "done" ? { ...r, phase: "done", error: e.summary } : r);
    }
    // A proposal tool that ended without its proposal (a second try that failed): put back what stood before.
    if (e.type === "tool_result" && e.name === "propose_fixes" && chatAgent.current) {
      chatAgent.current.finish(null); chatAgent.current = null;
    }
    if (e.type === "tool_result" && e.name === "propose_fixes") chatEscalating.current = false;
    if (e.type === "done" || e.type === "error") chatEscalating.current = false;
    if (e.type === "done") { planThisTurn.current = false; chatContext.current = null; }
    if (e.type === "plan_event") chatPlan.current?.onEvent(e.event);
    if (e.type === "plan") { (chatPlan.current ?? trackPlan(e.kind, origin)).finish(e); chatPlan.current = null; }
  }
  const chatPlan = useRef<ReturnType<typeof trackPlan> | null>(null);
  const chatEscalating = useRef(false);
  const planThisTurn = useRef(false);

  // ------------------------------------------------------------------ an agent over MCP
  async function connectAgent() {
    setAgentBusy(true); setAgentError(null);
    try {
      setAgentLink(await api.createLink({ scene_id: sceneId, report_id: report?.id ?? null, clash_id: clash?.id ?? null, fixed: resolved, filters: sharedFilters, filter_view: filterView, check: viewCheck }));
      setAgentLog([]);
    } catch (e) { setAgentError((e as Error).message); } finally { setAgentBusy(false); }
  }
  async function disconnectAgent() {
    if (agentLink) await api.revokeLink(agentLink.token).catch(() => undefined);
    setAgentLink(null); setAgentLog([]);
  }
  // The agent sees what this page has open: keep the link's context current.
  useEffect(() => {
    if (!agentLink) return;
    const t = setTimeout(() => {
      api.linkContext(agentLink.token, { scene_id: sceneId, report_id: report?.id ?? null, clash_id: clash?.id ?? null, fixed: resolved, filters: sharedFilters, filter_view: filterView, check: viewCheck })
        .catch((e) => { if (e instanceof ApiError && e.status === 404) setAgentLink(null); });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentLink?.token, sceneId, report?.id, clash?.id, resolved, reqId, sharedFilters, filterView, viewCheck]);
  /** What the agent does, carried out here: the chat's ui events, opened models, applied fixes, pictures. */
  async function onAgentEvent(e: LinkEvent) {
    if (!agentLink) return;
    if (e.type === "hello") {
      agentStream.current = e.stream;
      setAgentLinkState((l) => l && { ...l, expires_at: e.expires_at, max_expires_at: e.max_expires_at,
        clock_offset: e.server_time - Date.now() / 1000, calls: e.calls, last_call: e.last_call ?? l.last_call });
      return;
    }
    if (e.type === "heartbeat") return;
    if (e.type === "revoked") { setAgentLink(null); return; }
    if (e.type === "agent_call") {
      setAgentLinkState((l) => l && { ...l, last_call: { tool: e.tool, at: Date.now() / 1000 }, expires_at: e.expires_at ?? l.expires_at });
      setAgentLog((log) => [...log.slice(-40), { at: Date.now() / 1000, tool: e.tool, text: "…" }]);
      return;
    }
    if (e.type === "agent_result") {
      setAgentLog((log) => {
        const i = log.map((x) => x.tool).lastIndexOf(e.tool);
        if (i < 0) return [...log, { at: Date.now() / 1000, tool: e.tool, text: e.summary }];
        const next = [...log]; next[i] = { ...next[i], text: e.summary }; return next;
      });
      return;
    }
    if (e.type === "capture_request") {
      let png: Blob | null = null;
      try {
        if (e.what === "view") {
          const url = viewer.current?.capture(1024);
          png = url ? await (await fetch(url)).blob() : null;
        } else if (e.report_id && e.clash_id && e.a && e.b) {
          await captureViews(e.report_id, e.clash_id, e.a, e.b);  // saved on the report, where the agent reads them
        }
      } finally { await api.linkCapture(agentLink.token, e.id, png).catch(() => undefined); }
      return;
    }
    if (e.type === "ui" && e.action === "open_models") { if (!busy) void openDemo(e.names); return; }
    if (e.type === "ui" && e.action === "follow_triage") { if (!triageRun || triageRun.done) void runTriage(false, "agent"); return; }
    if (e.type === "ui" && e.action === "applied") {
      if (!sceneId) return;
      const epoch = sceneEpoch.current, live = () => sceneEpoch.current === epoch;
      staleContext(); viewer.current?.preview([]);
      await applyToViewer(sceneId, e, e.pieces, live);
      if (!live()) return;
      setEdits((ed) => {
        const next = { ...ed };
        for (const ps of e.pieces) if (ps.length) { const [first, ...added] = ps; next[first] = [...(next[first] ?? []), ...added]; }
        return next;
      });
      markFixed(e.pairs, e.titles);
      resetWork(); setRemeasure((n) => n + 1);  // as when the person accepts: the options are spent
      return;
    }
    onChatEvent(e as ChatEvent, "agent");
  }
  // When the tab closes, tell the server at once (a proxy may hold a dropped stream open for a while), so the agent
  // is not told a browser is following.
  const agentStream = useRef<string | null>(null);
  useEffect(() => {
    if (!agentLink) return;
    const token = agentLink.token;
    const bye = () => { if (agentStream.current) api.leaveLink(token, agentStream.current); };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [agentLink?.token]);
  const agentHandler = useRef(onAgentEvent);
  agentHandler.current = onAgentEvent;
  // Follow the link while it lives: the server ends each stream after a few minutes, so reconnect.
  useEffect(() => {
    if (!agentLink) return;
    const token = agentLink.token, stop = new AbortController();
    void (async () => {
      for (let tries = 0; !stop.signal.aborted; tries++) {
        try {
          await api.linkEvents(token, (e) => { void agentHandler.current(e); }, stop.signal);
          tries = 0;
        } catch (e) {
          if (stop.signal.aborted) return;
          if (e instanceof ApiError && e.status === 404) { setAgentLink(null); return; }
        }
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** Math.min(tries, 4))));
      }
    })();
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentLink?.token]);
  // A clock for "last call 4 s ago" and the time left, and the link's state from the server once a minute (its expiry
  // renews as it is used; a link that expired or was revoked elsewhere is dropped).
  useEffect(() => {
    if (!agentLink) return;
    const token = agentLink.token;
    const tick = setInterval(() => setNow(Date.now()), 2000);
    const poll = setInterval(() => {
      api.linkState(token).then((s) => setAgentLinkState((l) => l && l.token === token ? {
        ...l, expires_at: s.expires_at, max_expires_at: s.max_expires_at, calls: s.calls,
        clock_offset: s.server_time - Date.now() / 1000 } : l))
        .catch((e) => { if (e instanceof ApiError && e.status === 404) setAgentLink(null); });
    }, 60000);
    return () => { clearInterval(tick); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentLink?.token]);

  // ------------------------------------------------------------------ the saved session (resume after a reload)
  const SESSION_KEY = "iris.session";
  useEffect(() => {  // on arrival: is there a session the server still holds?
    let saved: SavedSession | null = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { saved = null; }
    if (!saved?.scene_id) return;
    const s = saved;
    void (async () => {
      try {
        const info = await api.sceneInfo(s.scene_id);
        // The report it had open, else the list of the scene's kept checks (a list the server made since).
        const r = (s.report_id ? await api.report(s.report_id).catch(() => null) : null)
          ?? (info.report_id ? await api.report(info.report_id).catch(() => null) : null);
        // The link, if it still lives, and the fixes its agent applied while no page was open.
        const state = s.link ? await api.linkState(s.link.token).catch(() => null) : null;
        const link = state && s.link ? { ...s.link, expires_at: state.expires_at, max_expires_at: state.max_expires_at,
                                         clock_offset: state.server_time - Date.now() / 1000 } : null;
        setResumable({ saved: { ...s, link, fixes: { ...s.fixes, ...(state?.applied ?? {}) } },
                       info, clashes: r ? r.clashes.length : null });
      } catch { try { localStorage.removeItem(SESSION_KEY); } catch { /* private window */ } }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {  // keep it current while working
    if (!sceneId) return;
    const s: SavedSession = { scene_id: sceneId, report_id: report?.id ?? null, files: sceneFiles, fixes,
                              link: agentLink, saved_at: Date.now() / 1000, check: viewCheck };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private window: no resume */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, report?.id, sceneFiles, fixes, agentLink?.token, viewCheck]);
  /** Reopen the saved session: the same models (with the fixes applied on the server), its clashes, its fixes, and
   * the agent link, which the page follows again. */
  async function resumeSession() {
    const r = resumable;
    if (!r || busy) return;
    const { saved, info } = r;
    const id = await open(info.files, { id: info.id, files: info.files, step: info.step, revision: info.revision, layout: info.layout });
    if (!id) return;
    // An imported report it had open comes back as it was; Iris's checks as the list they make now, on the check it showed.
    const imported = saved.report_id ? await api.report(saved.report_id).then((x) => (x.origin === "iris" ? null : x), () => null) : null;
    const rid = imported ? imported.id : info.report_id;
    if (rid) {
      const rep = await loadReport(() => (imported ? Promise.resolve(imported) : api.report(rid)), "your clashes");
      if (rep) {
        setFixes(saved.fixes ?? {});
        unionSerial.current = rep.serial ?? 0;
        setChecks(info.checks ?? []);
        const k = (info.checks ?? []).find((c) => c.key === saved.check);
        setRanCheck(null); setViewCheck(!imported && k ? k.key : null);
        const models = (info.checks ?? []).find((c) => c.key === "models");
        lastTests.current = (k ?? models)?.tests ?? null;
      }
    }
    if (saved.link) setAgentLinkState(saved.link);
  }
  /** Forget the saved session here, and end its agent link: nothing would follow it any more. */
  function startFresh() {
    const link = resumable?.saved.link;
    if (link) void api.revokeLink(link.token).catch(() => undefined);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* private window */ }
    setResumable(null);
  }

  // ------------------------------------------------------------------ models the server let go of (gone)
  const holding = useRef({ scene: sceneId, report: report?.id ?? null });
  holding.current = { scene: sceneId, report: report?.id ?? null };
  useEffect(() => {
    setGoneHandler((g) => {
      if (g.detail) goneWords.current.add(g.detail);
      if (g.id !== holding.current[g.kind]) return;   // a late answer about models or a report since replaced
      setGoneIds((was) => ({ ...was, [g.kind]: g.id }));
      // A restart drops both: ask after the models too, so the notice says what is really gone.
      const sid = holding.current.scene;
      if (g.kind === "report" && sid) api.sceneInfo(sid).catch(() => undefined);
    });
    return () => { setGoneHandler(null); };
  }, []);
  useEffect(() => {  // the fixes kept went with the models: the list and the report's evidence stop claiming them
    if (!goneScene) return;
    setFixes({});
    setEvidence((ev) => Object.fromEntries(Object.entries(ev).filter(([, e]) => e.status !== "accepted")));
  }, [goneScene]);
  /** The open models can be opened again by name: samples, not the visitor's own files. */
  const reopenable = () => !sceneUploaded.current && sceneFiles.length > 0 && sceneFiles.every((f) => samples.includes(f));
  const reopenLabel = gone?.scene ? (reopenable() ? "Open them again" : "Pick your files again") : "Open it again";
  // A picture cannot be drawn again on models the server let go of: Show it built offers to open them instead.
  const builtReopen = gone?.scene ? { label: reopenLabel, onClick: () => void reopenGone() } : undefined;
  /** Open again what the server let go of: the same sample models, then the same clashes (Iris's check run again, or
   * the same sample report). The visitor's own files cannot be fetched again, so they pick them. */
  async function reopenGone() {
    const g = gone, r = report;
    if (!g || busy) return;
    let sid = sceneId;
    if (g.scene) {
      if (!reopenable()) { modelInput.current?.click(); return; }
      sid = await open(sceneFiles) ?? null;
      if (!sid) return;
    }
    if (!r) return;
    if (r.origin === "iris") {
      // The models are still held: the list of their kept checks is made again, no check is run.
      const held = !g.scene && sid ? await api.checks(sid).catch(() => null) : null;
      if (held?.report_id) {
        const again = await api.report(held.report_id).catch(() => null);
        if (again) { await adoptRun(again, held.checks, null, []); return; }
      }
      const k = checks.find((c) => c.key === viewCheck) ?? checks.find((c) => c.key === "models");
      await runDetect(k ? k.tests ?? null : lastTests.current, sid);
      return;
    }
    // A Navisworks report outlives the models it was matched to unless it was let go of too.
    if (!g.report && await api.report(r.id).then(() => true, () => false)) return;
    const sample = sampleReports.current[r.id];
    if (sample) {
      const again = await loadReport(() => api.openReport(sample), sample);
      if (again) sampleReports.current[again.id] = sample;
    } else setError("Import your clash report again: Coordinate, then Import.");
  }

  async function accept(o: Option) {
    if (!sceneId || busy) return;
    replaceChatWork(); retireDirectWork(); clearManual();
    const epoch = sceneEpoch.current;
    const live = () => sceneEpoch.current === epoch;
    setBusy("Applying the fix…"); setError(null);
    const ids = clashIdsOf([[a, b]])[0];
    const pics = ids.some((id) => evidence[id]?.after_img && evidence[id]?.title === o.title)
      ? { before_img: evidence[ids[0]]?.before_img, after_img: evidence[ids[0]]?.after_img }
      : captureFix([o], o.moved.includes(a ?? "") ? "#d0342c" : "#1f9d3a");
    // Show it built: the view of the fix as proposed, taken now (once applied, the preview is gone).
    const pair: [string, string] | null = a && b ? [a, b] : null;
    const built = pair && canBuild(o) && builtDone.current[builtKey(pair, o)]?.status !== "done"
      && !builtPending.current.has(builtKey(pair, o)) ? builtPasses(builtFix(o, false), pair) : null;
    try {
      // Who accepts it: the server re-checks it, keeps it and records the "accepted" decision itself (the reply's
      // `decisions`); the page never posts one as well.
      const ref = clashRefFor(ids[0] ?? null);
      const kept = await api.accept(sceneId, o, pair, ids[0] ?? null, { reviewer, clash_key: ref?.key ?? null, number: ref?.number ?? null });
      // Each split run's pieces, the original first (a combined fix can split several runs).
      const groups = kept.groups ?? (kept.pieces?.length ? [kept.pieces] : []);
      if (!live()) return;
      if (kept.decisions?.length) noteDecisions(kept.decisions);
      staleContext();
      // A penetration the host's team must cut: asked for (its provision for void is in the model), not yet fixed.
      const requested = kept.cut === false;
      setEvidence((ev) => ({ ...ev, ...Object.fromEntries(ids.map((id) => [id, requested
        ? { ...evidenceOf(o, "recommended", pics), blocked_by: kept.blocked_by ?? "" } : evidenceOf(o, "accepted", pics)])) }));
      viewer.current?.preview([]);
      await applyToViewer(sceneId, kept, groups, live);
      if (!live()) return;
      setEdits((e) => {
        const next = { ...e };
        for (const ps of groups) if (ps.length) { const [first, ...added] = ps; next[first] = [...(next[first] ?? []), ...added]; }
        return next;
      });
      if (!requested) markFixed([[a, b]], [o.title]);
      if (!requested && pair) buildAccepted(o, pair, ids, built, groups[0]);
      resetWork(); setRemeasure((n) => n + 1);
    } catch (e) { if (live()) setError((e as Error).message); } finally { if (live()) setBusy(null); }
  }

  async function checkManual() {
    if (!sceneId || !a || busy) return;
    replaceChatWork(); retireDirectWork(); clearManual();
    ++agentRun.current; pilot.current?.cancel();
    const epoch = sceneEpoch.current, workspace = workspaceEpoch.current, request = previewRequest.current;
    const element = a, delta = [0, 0, manualDz];
    const live = () => sceneEpoch.current === epoch && workspaceEpoch.current === workspace && previewRequest.current === request;
    try {
      const v = await api.verify(sceneId, [element], delta, b && b !== element ? [b] : []);
      if (!live()) return;
      setViewContext(false); setViewPlan(false); setChosen(null);
      const moved = Object.keys(v.placements ?? {});
      setManual(v); setManualPreview({ element, delta, moved: moved.length ? moved : [element], pieces: v.preview ?? null });
    } catch (e) { if (live()) setError((e as Error).message); }
  }

  const proposing = !!progress && progress.phase !== "done";
  // A row's Propose fixes (proposeFromList): once the clash is selected and its own pair picked, propose.
  useEffect(() => {
    if (!proposeNext || clash?.id !== proposeNext || !matches) return;
    const m = matches[clash.id];
    if (!a || !b || a !== m?.a || b !== m?.b || proposal || proposing) return;   // its own pair, picked
    setProposeNext(null);
    void propose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposeNext, clash, matches, a, b, proposal, proposing]);
  // A proposal landed: bring its options into view in the Clash panel (once per result; the panel scrolls, not the page).
  const optionsHead = useRef<HTMLHeadingElement | null>(null);
  const landed = useRef<Proposal | null>(null);
  useEffect(() => {
    if (!proposal || proposing || landed.current === proposal) return;
    landed.current = proposal;
    if (optionsHead.current) scrollInPane(optionsHead.current);
  }, [proposal, proposing]);
  // Iris working on the clash on screen: it can't be left until that finishes.
  const clashBusy = proposing || (!!planRun && planRun.phase !== "done") || contextWorking || replaying;
  // While Iris works on the clash, a drag with nothing selected orbits round it (the viewer's own orbit does too).
  // A drag with nothing selected orbits round the clash in focus (its chip shows), and round the one Iris works on.
  const orbitClash = clashBusy || (!!(clash || a || b) && !viewPlan && !activeContext);
  useEffect(() => { viewer.current?.setOrbitClash(orbitClash); }, [orbitClash]);
  // A detected clash's views, taken once the camera has reached it (selecting a clash flies there first).
  useEffect(() => {
    if (!clash || !report || report.origin !== "iris" || clash.images.length || views[clash.id] || !a || !b) return;
    if (viewPlan || activeContext || proposing) return;
    const rid = report.id, cid = clash.id;
    const t = setTimeout(() => { void captureViews(rid, cid, a, b); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clash, report, a, b, views, viewPlan, activeContext, proposing]);
  // What the list and the panel show: each clash with its title and, for a detected clash, the views taken of it.
  const shown = (c: ReportClash) => (views[c.id] || (titles[c.id] && !c.title)
    ? { ...c, images: views[c.id] ?? c.images, title: c.title ?? titles[c.id] ?? null } : c);
  const shownReport = useMemo(() => (report && (Object.keys(views).length || Object.keys(titles).length)
    ? { ...report, clashes: report.clashes.map(shown) } : report),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, views, titles]);
  const shownClash = clash ? shown(clash) : clash;
  // The list as the check picker shows it: one kept check's clashes, or all of them (docs/detection.md, "Kept checks").
  const listReport = useMemo(() => (shownReport ? narrow(shownReport, viewCheck) : null), [shownReport, viewCheck]);
  useEffect(() => { if (viewCheck && !checks.some((c) => c.key === viewCheck)) setViewCheck(null); }, [checks, viewCheck]);
  // The check whose run the summary shows: the one on screen, else the one that ran last, else the open models.
  const shownCheck = checks.find((c) => c.key === viewCheck) ?? checks.find((c) => c.key === ranCheck)
    ?? checks.find((c) => c.key === "models") ?? checks[0] ?? null;
  const listTriage = useMemo(() => {
    if (!listReport || listReport === shownReport) return shownTriage;
    const ids = new Set(listReport.clashes.map((c) => c.id));
    return Object.fromEntries(Object.entries(shownTriage).filter(([id]) => ids.has(id)));
  }, [listReport, shownReport, shownTriage]);
  // Not read yet (a check run since, or a triage stopped part way), or a read that failed (asked again): what
  // "Triage N unread" / "Continue · N left" reads. The server keeps every reading, so only these are asked.
  const unread = listReport ? listReport.clashes.filter((c) => !listTriage[c.id] || listTriage[c.id].error).length : 0;
  // The coordination overview (docs/engineer-workflow.md, step 4): the list's clashes by class, severity and status,
  // from the kept checks behind the list (an imported report has none), and its filter on the list.
  const coordChecks = useMemo(() => (report?.origin === "iris" ? (viewCheck ? checks.filter((k) => k.key === viewCheck) : checks) : []),
    [report?.origin, checks, viewCheck]);
  const coordSummary = useMemo(() => (listReport ? coordOverview(listReport.clashes, listTriage, { fixes, reviewed, checks: coordChecks }) : null),
    [listReport, listTriage, fixes, reviewed, coordChecks]);
  const resolvedIds = useMemo(() => resolvedIdsOf(coordChecks), [coordChecks]);
  const coordList = useMemo(() => (coordFilter && listReport ? {
    label: coordFilterLabel(coordFilter),
    keep: (c: ReportClash) => passes(c, listTriage[c.id], statusOf(c, { fixes, reviewed, resolvedIds }), coordFilter),
  } : null), [coordFilter, listReport, listTriage, fixes, reviewed, resolvedIds]);
  useEffect(() => { setCoordFilter(null); }, [report?.id]);
  /** One of the overview's numbers: the list filtered to it (all of them: no filter), on the Clashes tab. */
  const filterCoord = (f: CoordinationFilter) => {
    setCoordFilter(f.cls || f.severity || f.status ? f : null);
    setLeftView("clashes"); setListFocusState(null); setTriageFilterState(null);
    if (compact) setListOpen(true);
  };
  // The numbers a project keeps (PATCH counts): its open models' clashes, open, resolved (a fix kept, re-checked by
  // geometry when kept, or gone from a re-run) and reviewed (by design, sent to the author).
  const liveCounts: CoordCounts | null = coordSummary && projectOpen ? {
    clashes: coordSummary.total, open: coordSummary.byStatus.open,
    resolved: coordSummary.byStatus.fix_kept_pending_recheck + coordSummary.byStatus.resolved_geometry,
    reviewed: coordSummary.byStatus.reviewed_by_design + coordSummary.byStatus.sent_to_author } : null;
  const countsKey = liveCounts ? JSON.stringify(liveCounts) : "";
  useEffect(() => {
    const p = projectHere;
    if (!countsKey || !p || !projectOpen) return;
    const k = p.counts;
    if (k && JSON.stringify({ clashes: k.clashes, open: k.open, resolved: k.resolved, reviewed: k.reviewed }) === countsKey) return;
    const counts = JSON.parse(countsKey) as CoordCounts;
    const t = window.setTimeout(() => {
      patchProject(p.id, { counts }).then((next) => setProject((was) => (was?.id === next.id ? next : was))).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [countsKey, projectHere?.id, projectOpen]);  // eslint-disable-line react-hooks/exhaustive-deps
  // A project's models step with its models not open here: open them (once a visit; the overview's button any time).
  useEffect(() => {
    const p = projectHere;
    if (!workStep || !p || projectOpen || busy || projectBusy || !p.files.length || autoOpened.current === p.id) return;
    void openProjectScene(p);
  }, [workStep, projectHere?.id, projectOpen, busy, projectBusy]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDrawings((d) => (d.length ? [] : d)); setDrawingItemsBy({}); setDrawingCompare(null); }, [sceneId]);
  useEffect(() => {
    if (!sceneId || projStep !== "drawings") return;
    let live = true;
    setDrawingsError(null);
    void (async () => {
      const list = await listDrawings(sceneId);
      if (!live) return;
      setDrawings(list);
      const items = await Promise.all(list.map(async (d) => [d.id, await drawingItems(d.id).catch(() => [] as DrawingItem[])] as const));
      if (!live) return;
      setDrawingItemsBy(Object.fromEntries(items));
      const cmp = list.length ? await compareDrawings(sceneId).catch(() => null) : null;
      if (live) setDrawingCompare(cmp);
    })().catch((e: unknown) => { if (live) setDrawingsError(`Could not read the drawings: ${(e as Error).message}`); });
    return () => { live = false; };
  }, [sceneId, projStep, drawingsTry]);
  // Clash review's address names the clash open (/projects/<pid>/clashes/<n>): opened from the address once the list
  // has it, and written (in place) as clashes are picked and left.
  const clashFromPath = useRef<string | null>(null);
  useEffect(() => {
    if (route?.view !== "project" || route.step !== "clash" || !route.clash || !report) return;
    const key = `${report.id}#${route.clash}`;
    if (clashFromPath.current === key) return;
    const c = report.clashes.find((x) => x.number === route.clash);
    if (!c) return;
    clashFromPath.current = key;
    if (clash?.id !== c.id) selectClash(c);
  }, [route, report?.id, matches]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (route?.view !== "project" || route.step !== "clash" || !projectOpen) return;
    const n = clash?.number;
    if (route.clash === n) return;
    if (!n && route.clash && clashFromPath.current !== `${report?.id}#${route.clash}`) return;   // not opened from it yet
    const next: ProjectRoute = n ? { view: "project", pid: route.pid, step: "clash", clash: n } : { view: "project", pid: route.pid, step: "clash" };
    showProjectRoute(next, false); setRoute(next);
  }, [clash?.number, route, projectOpen]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Outside a project the address says whether a session is open: /workspace once models or a report open, else /home.
  useEffect(() => {
    if (route || aboutTab || homeAsked) return;
    if ((sceneId || report) && currentPath() === "/home") showPath("/workspace", false);
  }, [route, aboutTab, homeAsked, sceneId, report?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  // What happened to the project, newest first: the open session's decisions and kept edits, saves and reports.
  const projectActivity = useMemo((): ActivityItem[] => {
    const out: ActivityItem[] = [];
    if (projectOpen) {
      for (const d of journal?.decisions ?? []) out.push({ at: toMs(d.at), text: decisionLine(d) });
      for (const e of journal?.entries ?? []) {
        const at = Date.parse(e.when);
        if (Number.isFinite(at)) out.push({ at, text: `${e.state === "undone" ? "Edit undone" : "Edit kept"}: ${e.title || e.summary}${e.actor ? ` · ${e.actor}` : ""}` });
      }
    }
    for (const sv of projectHere?.saved ?? []) out.push({ at: toMs(sv.at), text: `Saved state ${sv.n}: ${sv.edits} edit${sv.edits === 1 ? "" : "s"}, ${sv.files.length} model${sv.files.length === 1 ? "" : "s"}` });
    for (const r of projectHere?.reports ?? []) out.push({ at: toMs(r.at), text: `Report kept: ${r.name}` });
    return out;
  }, [projectOpen, journal, projectHere]);
  // Until a report or the models are open, the page is the landing: no panels, just what Iris is and the demo.
  // A project's workspace step with nothing open yet is a blank workspace (its import), never the landing.
  const blankish = blank || (!!pid && workStep);
  const landing = !stats && !report && !blankish;
  // A blank project before anything opens: the drop zone has the whole stage (no sheet on a phone).
  const starting = blankish && !stats && !report;
  // The dock is the desktop's; the landing, phones, tablets and the Classic layout switch use the classic layout.
  const docked = layout === "desktop" && !landing && !classic;
  dockedNow.current = docked;
  // Into the dock (the first models drawn, a report, the dock chosen again) the page would be blank for a few frames:
  // dockview lays out its panels in an effect, then each panel takes its slot. A cover holds the loading stage's look
  // until the model has its panel and has drawn there, then fades. Opening the first models from the start page it is
  // the loading screen itself, so the new models never show behind the card before the switch either.
  const [dockWas, setDockWas] = useState(docked);
  const [dockCover, setDockCover] = useState<"on" | "out" | null>(null);
  // The card the cover keeps while the dock arrives: the opening that has just ended, if one has (not one long past).
  const [coverLoad, setCoverLoad] = useState<LoadProgress | null>(null);
  if (docked !== dockWas) {
    setDockWas(docked); setDockCover(docked ? "on" : null); setCoverLoad(docked ? openedLoad.current : null);
  }
  // Read in the render that switched (or not, in the classic layout): never a card for a later switch.
  useEffect(() => { openedLoad.current = null; }, [stats]);
  const coverLoading = layout === "desktop" && !classic && !docked && !!loading && !stats;
  const coverCard = coverLoading ? loading : coverLoad;
  useEffect(() => {
    if (dockCover !== "on") return;
    if (typeof requestAnimationFrame !== "function") { setDockCover(null); return; }
    const started = performance.now();
    let raf = 0, placed = 0;
    const tick = () => {
      const stage = host.current;
      // In its dock panel, laid out, and three frames drawn there (the viewer takes its new size on the first).
      placed = stage?.isConnected && !!stage.closest(".dock-host") && stage.clientWidth > 0 ? placed + 1 : 0;
      if (placed >= 3 || performance.now() - started > 6000) { setDockCover("out"); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dockCover]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dockCover !== "out") return;
    const t = window.setTimeout(() => setDockCover(null), 200);
    return () => window.clearTimeout(t);
  }, [dockCover]);
  // Selecting an element shows its Properties panel (floating at first, wherever the user put it after).
  useEffect(() => { if (selected?.globalId && docked) dock.current?.show("properties"); }, [selected?.globalId, docked]);
  // The Edit tool works over the model: a Properties panel floating there closes (one docked in a side bar stays), and
  // the next selection brings it back.
  useEffect(() => { if (tool.edit && docked) dock.current?.closeFloating("properties"); }, [tool.edit, docked]);
  const planning = !!planRun && planRun.phase !== "done";
  /** What adding or removing a model must wait for (sceneModels.waitFor), in words, or null. */
  const modelsWait = () => waitFor({ busy, detecting: !!detecting, proposing: proposing || !!runningNow.current, planning,
    triage: !!triageRun && !triageRun.done });
  // Phones and tablets: the sheet (or drawer) follows what happens, so the panel people need is the one showing. The
  // list when a report or the models open, the clash once one is picked, out of the way while Iris drives the model,
  // back up with the result. Moving the sheet by hand always wins until the next thing happens.
  const followed = useRef<{ report: string | null; models: boolean; clash: string | null; working: boolean }>({ report: null, models: false, clash: null, working: false });
  const fixing = proposing || planning || contextWorking;
  useEffect(() => {
    const f = followed.current, seen: Happening[] = [];
    if (report && report.id !== f.report) seen.push("report");
    else if (stats && !f.models && !report) seen.push("models");
    if (clash && clash.id !== f.clash) seen.push("select");
    if (fixing && !f.working) seen.push("work");
    if (!fixing && f.working) seen.push("result");
    followed.current = { report: report?.id ?? null, models: !!stats, clash: clash?.id ?? null, working: fixing };
    if (!compact) return;
    let list: boolean | null = null, next = snap;
    for (const what of seen) {
      const r = follow(what, next);
      if (r.list != null) list = r.list;
      if (r.snap) next = r.snap;
    }
    if (list != null) setListOpen(list);
    if (next !== snap) setSnap(next);
    // With a result, the options come into view in the pane (only the pane scrolls, never the page).
    if (seen.includes("result")) requestAnimationFrame(() => {
      const pane = document.querySelector<HTMLElement>(".pane.right"), el = pane?.querySelector<HTMLElement>(".card, .nofix, .recommended");
      if (!pane || !el) return;
      const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
      if (top < 0 || top > pane.clientHeight - 80) pane.scrollTo({ top: pane.scrollTop + top - 12, behavior: "smooth" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, report?.id, stats, clash?.id, fixing]);
  // Read the patterns as soon as they are found, once per report and models, unless a proposal or plan is running then
  // (it is tried again when that ends). A failure leaves the Explain button for a manual try.
  useEffect(() => {
    const key = report && sceneId ? `${report.id}:${sceneId}` : null;
    if (!key || !patterns?.length || verdicts || explaining || explained.current === key) return;
    if (proposing || planning || replaying || busy) return;
    explained.current = key;
    void explainPatterns(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, sceneId, patterns, verdicts, explaining, proposing, planning, replaying, busy]);
  // Thumbnails wait while the models or the list are changing (a load, a reload, a check). Not while Iris works on a
  // clash (a proposal, a plan, a replay): each is drawn in one task with the view put back and no preview in it, and the
  // rows on screen should fill while people watch (the golden path proposes straight after its check).
  thumbPaused.current = !!busy || !!detecting;
  useEffect(() => { setThumbs({}); thumbQueue.current = []; }, [report?.id]);
  useEffect(() => { if (!thumbPaused.current && thumbQueue.current.length) pumpThumbs(); });  // eslint-disable-line react-hooks/exhaustive-deps
  const thumbSource = useRef({ report, matches });
  thumbSource.current = { report, matches };
  function needThumb(c: ReportClash) {
    if (!report || c.id in thumbs || thumbQueue.current.some((q) => q.clash.id === c.id)) return;
    thumbQueue.current.push({ report: report.id, clash: c });
    pumpThumbs();
  }
  const thumbTimer = useRef<number | null>(null);
  /** Draw one queued thumbnail every 60 ms or so, newest request first (the rows on screen now), so scrolling and the
   * viewer's own frames stay smooth. */
  function pumpThumbs() {
    if (thumbTimer.current != null) return;
    thumbTimer.current = window.setTimeout(() => {
      thumbTimer.current = null;
      if (thumbPaused.current || !viewer.current) return;
      if (viewer.current.lost) { thumbTimer.current = window.setTimeout(() => { thumbTimer.current = null; pumpThumbs(); }, 1000); return; }   // no context: wait for it
      // The camera moving (a drag, a wheel, a flight): each thumbnail is a frame's work, so they wait until it rests.
      if (viewer.current.moving) { thumbTimer.current = window.setTimeout(() => { thumbTimer.current = null; pumpThumbs(); }, 250); return; }
      const next = thumbQueue.current.pop();
      if (!next) return;
      const { report: r, matches: ms } = thumbSource.current;
      if (next.report === r?.id) {
        const m = ms?.[next.clash.id];
        let url = "";
        try { url = (m?.a && m.b && viewer.current.thumbClash(m.a, m.b)) || ""; } catch { /* drawn as an empty box */ }
        setThumbs((t) => ({ ...t, [next.clash.id]: url }));
      }
      if (thumbQueue.current.length) pumpThumbs();
    }, 60);
  }
  const fixedCount = Object.keys(fixes).length;
  const tourDuct = clashOfPair(TOUR.duct), tourJoint = clashOfPair(TOUR.joint);
  const cellOpen = !!cellDemo && stepFiles.some((f) => [...cellDemo.files, ...cellDemo.context].includes(f));
  const tourLadder = cellOpen ? clashOfNames(CELL.ladder, CELL.post)[0] : undefined;
  const tourPipes = cellOpen ? clashOfNames(CELL.pipe, CELL.rails) : [];
  const tourState: TourState = {
    busy: !!busy, reportOpen: !!report, modelsOpen: !!stats,
    triageStarted: !!triageRun, triageDone: !!triageRun?.done, triageCount: Object.keys(triage).length,
    triageTotal: report?.clashes.length ?? 0, realCount: Object.values(shownTriage).filter((v) => v.verdict === "real_clash").length,
    filter: triageFilter, clashId: clash?.id ?? null, tab, fixHidden: hideFix,
    proposing, proposingFor: progress && proposing ? (now - progress.started) / 1000 : 0,
    options: proposal?.options.length ?? 0, optionKinds: proposal?.options.map((o) => o.kind) ?? [],
    proposalDone: progress?.phase === "done", error, replaying,
    compare, fixed: Object.keys(fixes),
    planRunning: planning, planFor: planRun ? (now - planRun.started) / 1000 : 0, planReady: !!plan, planError,
    patternsRead: !!verdicts, reviewedCount: Object.keys(reviewed).length, signoffs: tourDuct ? signoffs[tourDuct.id]?.length ?? 0 : 0,
    docOpen, docReady,
    reqOpen, requirements: reqLabel, reqRules: reqSaved?.enabled ? reqSaved.doc.by_design.length : 0,
    duct: tourDuct ? { id: tourDuct.id, number: tourDuct.number } : null,
    cellOpen, ladder: tourLadder ? { id: tourLadder.id, number: tourLadder.number } : null,
    pipes: tourPipes.map((c) => ({ id: c.id, number: c.number })),
    joint: tourJoint ? { id: tourJoint.id, number: tourJoint.number } : null,
  };
  const tourActions: TourActions = {
    filterReal: () => setTriageFilter("real_clash"), clearFilter: () => setTriageFilter(null),
    selectClash: (which) => { const c = { duct: tourDuct, joint: tourJoint, ladder: tourLadder }[which]; if (c) { setTab("clash"); selectClash(c); } },
    openCell: () => { if (cellSample) void openDemo([cellSample]); },
    fixPipe: () => { if (tourPipes.length) { setTab("plan"); void runPlan({ clash_ids: tourPipes.map((c) => c.id) }); } },
    compare: setCompare,
    overview: () => { setViewPlan(false); viewer.current?.preview([]); viewer.current?.fitAll(); },
    reveal: (sel, el) => {
      const row = /data-clash="([^"]+)"/.exec(sel)?.[1];
      if (row && row !== "none") { setListReveal(row); setLeftView("clashes"); }
      const view = el?.closest("[data-left-view]")?.getAttribute("data-left-view");
      if (view === "clashes" || view === "insights") setLeftView(view);
      // Requirements and Report are in the menu on a desktop and a phone (a tablet keeps Report in its bar).
      if (!el && /data-tour=["']?(report|export|requirements)\b/.test(sel) && (!compact || layout === "phone")) { setMenuOpen(true); return; }
      if (docked) {  // the panel it is in, open and in this window
        const id = el?.closest("[data-panel]")?.getAttribute("data-panel") ?? el?.closest("[data-panel-tab]")?.getAttribute("data-panel-tab");
        if (id && isPanel(id)) dock.current?.show(id, { dock: true });
        return;
      }
      if (!compact) return;
      if (!el) return;
      if (el.closest(".pane.left")) { setListOpen(true); if (snap === "peek") setSnap("half"); }
      else if (el.closest(".pane.right")) {
        setListOpen(false);
        if (el.closest(".chat-slot")) setTab("chat");
        if (layout === "phone" && snap === "peek") setSnap("half");
      }
    },
    closeReport: () => setDocOpen(false),
    replay: (what) => { if (what === "plan") void replayPlan(); else if (what === "pipe") void replayPlan("pipe"); else void replayPropose(what); },
    ask: (send) => { setTab("chat"); setChatAsk((q) => ({ text: TOUR_QUESTION, send, n: (q?.n ?? 0) + 1 })); },
    signoff: () => {
      let name = "Guest reviewer";
      try { name = localStorage.getItem("iris.reviewer") || name; } catch { /* private window */ }
      if (tourDuct) addSignoff(tourDuct.id, { team: "MEP", name, decision: "approve", note: "Reviewed in the guided tour", at: new Date().toISOString() });
    },
  };

  const compareBar = (option || (plan && viewPlan && planOptions.length > 0) || (activeContext && contextProposal)) && (
    <div className="compare" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="seg" role="group" aria-label="Compare before and after">
        {(["before", "after", "both"] as const).map((m) => (
          <button key={m} className={compare === m ? "on" : ""} onClick={() => setCompare(m)} aria-pressed={compare === m}>
            {m === "before" ? "Before" : m === "after" ? "After" : "Both"}</button>))}
      </div>
      {option ? (
        <dl className="diff">
          <dt>Before</dt><dd>{measure && measure !== "busy" && measure.distance_m != null ? `overlap ${mm(measure.distance_m)}` : "clashing"}</dd>
          <dt>After</dt><dd className="ok">{option.kind === "trim" ? "clear: the two now butt at the joint"
            : option.kind === "seat" ? "clear: it now bears on the other's top"
            : `clear${option.min_clearance_m != null ? `, nearest ${mm(option.min_clearance_m)}` : ""}`}</dd>
          <dt>Change</dt><dd>{changeText(option)}</dd>
        </dl>
      ) : activeContext && contextProposal ? (
        <dl className="diff"><dt>Wider fix</dt><dd>{contextProposal.edits.length} coordinated edits shown together</dd>
          <dt>Checks</dt><dd className="ok">Geometry and model checks passed; designer review conditions apply</dd></dl>
      ) : plan && (
        <dl className="diff">
          <dt>Plan</dt><dd>{planOptions.length} fix{planOptions.length === 1 ? "" : "es"} shown together</dd>
          <dt>Check</dt><dd className={plan.check.passed ? "ok" : "bad"}>{plan.check.geometry === false || plan.strategy === "as_designed"
            ? "unverified: nothing was tried on the geometry" : plan.check.passed ? "all clear, checked as one" : "not all clear"}</dd>
        </dl>
      )}
      {compare === "both" && <p className="hint"><i className="sw ghost" />orange ghost: as it is now</p>}
    </div>
  );

  // What is still open in Insights, for its tab: root causes not done, patterns with an open clash.
  const insightsOpen = rootCauses && patterns
    ? rootCauses.filter((r) => !r.done).length + patterns.filter((p) => p.clash_ids.some((id) => !resolvedSet.has(id))).length : null;
  // The right pane's tabs, also the phone sheet's Fix / Plan / Chat.
  const showClashTab = () => { setListOpen(false); setTab("clash"); setViewPlan(false); setViewContext(false); };
  const showPlanTab = () => {
    setListOpen(false); clearManual();
    setTab("plan"); setViewContext(planKind === "context" && !!context); setViewPlan(planKind === "batch" && !!(plan || planRun));
  };
  const showChatTab = () => { setListOpen(false); setTab("chat"); };
  /** A panel picked on the desktop (its tab, or the Layout menu): Clash, Plan and Chat as their classic tabs, the
   *  others just shown. */
  const showPanel = (id: PanelId) => {
    if (id === "clash") showClashTab(); else if (id === "plan") showPlanTab(); else if (id === "chat") showChatTab();
    else dock.current?.show(id);
  };
  // What the Clash and Plan tabs say beside their titles (a count, a spinner): the classic tabs, the phone sheet's and
  // the dock's show the same.
  const clashBadge = proposal?.options.length ? <span className="badge-n">{proposal.options.length}</span> : null;
  const planBadge = planning || contextWorking ? <i className="spinner" aria-hidden />
    : planKind === "context" && context?.result?.proposals.length ? <span className="badge-n">{context.result.proposals.length}</span>
    : planOptions.length ? <span className="badge-n">{planOptions.length}</span> : null;
  const rulesOn = filterState.rules.filter((r) => r.on).length;
  // The collapsed Activity strip says, in one calm line, what the last run is doing (dock.tsx shows it only there).
  const dockTabs: Partial<Record<PanelId, React.ReactNode>> = { clash: clashBadge, plan: planBadge,
    filters: rulesOn ? <span className="badge-n">{rulesOn}</span> : null,
    activity: <ActivityLine attempts={proposal?.attempts ?? []} progress={progress} now={now} /> };
  const raise = () => { if (snap === "peek") setSnap("half"); };
  // The next clash still open after the selected one (the report's order), for "Next clash" once one is done.
  const nextClash = (() => {
    if (!report || !clash || !matches) return null;
    const list = shownReport?.clashes ?? report.clashes, at = list.findIndex((c) => c.id === clash.id);
    const open = (c: ReportClash) => c.id !== clash.id && !fixes[c.id] && !reviewed[c.id] && !!matches[c.id]?.a && !!matches[c.id]?.b;
    return list.slice(at + 1).find(open) ?? list.slice(0, Math.max(0, at)).find(open) ?? null;
  })();
  // The notch over the model (desktop): what Iris is doing now, from the same live state as the peek line. While the
  // first models open, the card in the middle says it in full and the notch keeps the logo.
  const notchStatus: NotchStatus | null = loading
    ? (stats ? { title: loading.title, parts: loading.step === "draw" ? { done: loading.drawn, total: loading.files.length } : undefined,
        detail: loading.step === "server" ? serverLine(loading, now)?.text ?? "Opening the models"
          : loading.step === "download" ? `Downloading ${loading.fetched} of ${loading.files.length}`
          : loading.drawn < loading.files.length ? `Drawing model ${loading.drawn + 1} of ${loading.files.length}: ${loading.files[loading.drawn]}` : "Fitting the view" }
      : null)
    : busy ? { title: busy.replace(/…$/, "") }
    : detecting ? { title: "Checking the models", detail: detecting.phase }
    : proposing || running ? { title: running ? `Fixing #${running.number}` : clash ? `Fixing #${clash.number}` : "Proposing fixes",
      detail: proposing ? statusLine(progress, now, proposal?.attempts ?? []) : statusLine(runState.current?.progress ?? null, now, runState.current?.proposal?.attempts ?? []) }
    : planning ? { title: "Building a plan" }
    : contextWorking ? { title: "Exploring a wider fix" }
    : triageRun && !triageRun.done ? { title: "Triage is sorting the clashes" }
    : null;
  const exportable = !!sceneId && !gone?.scene;
  const ownerNote = ownerSettings ? `on for you: effort ${ownerSettings.effort ?? "default"}${ownerSettings.no_caps !== false ? " · no caps" : ""}${
    ownerSettings.escalation ? ` · second try ${ownerSettings.escalation}` : ""}` : undefined;
  const exportLabel = stepFiles.length ? "Export STEP + IFC" : "Export IFC";
  const keptNote = fixedCount > 0 ? ` · ${fixedCount} ${fixedCount === 1 ? "fix" : "fixes"} kept` : "";
  // The open session's actions at the right of the top bar (docs/architecture/12-web-app.md, "The app shell"): the
  // requirements in use, a connected agent, Save and Report, and Export, the workspace's primary action, which counts
  // the fixes kept. The owner's settings are mounted on every page (they apply on load) and show only to the owner.
  const ownerPop = <span className="owner-pop"><OwnerSettingsMenu onChange={setOwnerSettingsState} onEveryone={() => setModelsAsked((n) => n + 1)} note={ownerNote} /></span>;
  /** Review fixes (docs/review-queue.md): the one entry point, Clash review's primary action in the workspace's header. */
  const reviewEntry = sceneId && report && <ReviewFixesEntry sceneId={sceneId} reportId={report.id} reportTitle={report.title}
    clashes={report.clashes} triage={listTriage} ticked={checked} fixed={[...Object.keys(fixes), ...Object.keys(reviewed)]}
    onOpen={() => setReviewOpen(true)} />;
  /** Review fixes leads on Clash review (and on a session outside a project); Export is its secondary there. */
  const reviewLeads = !!sceneId && !!report && !compact && (!pid || projStep === "clash");
  const workActions = (
    <div className="work-actions" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {reqLabel && !landing && !compact && <button className="btn small req-pill" onClick={() => setReqOpen(true)} data-tip-side="bottom"
        data-tip={`Checking, triage and fixes follow "${reqSaved!.doc.name}" (${reqLabel})`}><ClipboardCheck size={15} aria-hidden /><span className="req-pill-label"> {reqLabel}</span></button>}
      {agentLink && <button className="btn small agent-pill" onClick={() => setAgentOpen(true)} aria-label="Agent connected" data-tip-side="bottom"
        data-tip={`An agent works on this session over MCP · the link has ${timeLeft(agentLink, now)} left`}>
        <Bot size={15} aria-hidden /><span className="lbl"> {agentLink.last_call ? `Agent · ${agentLink.last_call.tool}` : "Agent · waiting"}</span></button>}
      {layout === "tablet" && !landing && (report || sceneId) && <button className={`btn small ${listOpen ? "on" : ""}`} data-tour="drawer"
        aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
        <List size={15} aria-hidden /> Clashes{report ? <span className="badge-n">{(listReport ?? report).clashes.length}</span> : null}</button>}
      {projectBusy && projectBusy !== "Saving…" && layout !== "phone" && <span className="hint work-busy"><i className="spinner" aria-hidden /> {projectBusy}</span>}
      {pid && projectHere && layout !== "phone" && <SaveButton onSave={saveProjectNow} saving={projectBusy === "Saving…"} disabled={!projectOpen || !!projectBusy || !!busy}
        tip={projectOpen ? "Save the edited models, the edit log and the decisions as the project's next saved state" : "Open the project's models first"} />}
      {report && layout !== "phone" && <button type="button" className="btn small" data-tour="report" onClick={() => { setDocOpen(true); setDocReady(false); }}>
        <FileText size={14} aria-hidden /> Report</button>}
      {reviewLeads && reviewEntry}
      {exportable && <a className={`btn ${reviewLeads ? "" : "primary "}export`} data-tour="export" href={api.exportUrl(sceneId!)} data-tip-side="bottom" aria-label={`${exportLabel}${keptNote}`}
        data-tip={`${stepFiles.length ? "Download the changed models: the STEP with its fixes, and the IFC" : "Download the changed IFC files"}${keptNote}`}>
        <Download size={15} aria-hidden /><span className="export-label">{compact ? "Export" : exportLabel}</span>
        {fixedCount > 0 && <span className="export-n"><Check size={11} strokeWidth={3} aria-hidden />{fixedCount}</span>}</a>}
    </div>
  );
  // The phone sheet's peek line: what is happening now, and the one next step, so the sheet is useful folded down.
  const peekLine: { text: React.ReactNode; live?: boolean; action?: { label: string; run: () => void; disabled?: boolean; tour?: string } } =
    busy ? { text: busy, live: true }
      : detecting ? { text: detecting.phase, live: true }
      : proposing ? { text: statusLine(progress, now, proposal?.attempts ?? []), live: true }
      : running ? { text: `#${running.number}: ${statusLine(runState.current?.progress ?? null, now, runState.current?.proposal?.attempts ?? [])}`, live: true }
      : planning ? { text: "Iris is building a plan…", live: true }
      : contextWorking ? { text: "Exploring a wider fix…", live: true }
      : viewPlan && plan ? { text: planOptions.length ? `Plan: ${planOptions.length} fix${planOptions.length === 1 ? "" : "es"} ready to review` : "Plan: nothing to accept yet",
        action: { label: "Review", run: () => { showPlanTab(); raise(); } } }
      : option && clash ? { text: <><b>{chosen! + 1}</b> · {option.title}</>,
        action: { label: option.cleanup ? "Accept cleanup" : "Accept", run: () => void accept(option), disabled: !!busy, tour: "accept" } }
      : proposal && progress?.phase === "done" && !proposal.options.length ? { text: "No verified fix: see why",
        action: canEscalate && !proposal.escalated && !proposal.recommendation
          ? { label: "Ask for a deep think", run: () => { showClashTab(); void escalate(); }, disabled: !!busy }
          : { label: "See why", run: () => { showClashTab(); raise(); } } }
      : clash && shownClash && (fixes[clash.id] || reviewed[clash.id]) ? {
        text: <><CircleCheck size={15} aria-hidden className="ok" /> <b>#{shownClash.number}</b> {fixes[clash.id] ? "fixed" : "reviewed"}{nextClash ? "" : ": nothing left open"}</>,
        action: nextClash ? { label: "Next clash", run: () => { setTab("clash"); selectClash(nextClash); } } : undefined }
      : clash && shownClash ? { text: <><b>#{shownClash.number}</b> {shownClash.title ?? shownClash.name}</>,
        action: hideFix ? { label: "Not a clash", run: () => { showClashTab(); raise(); } }
          : { label: "Propose fixes", run: () => { showClashTab(); void propose(); }, disabled: !a || !b || !sceneId || !!busy, tour: "propose" } }
      : a && b ? { text: "A and B picked", action: { label: "Propose fixes", run: () => { showClashTab(); void propose(); }, disabled: !sceneId || !!busy } }
      : a ? { text: "A set: now tap element B, then Set as B" }
      : report ? { text: `${report.clashes.length} clash${report.clashes.length === 1 ? "" : "es"} · pick one to fix it`,
        action: listOpen ? undefined : { label: "Clashes", run: () => { setListOpen(true); raise(); } } }
      : sceneId ? { text: "Models open", action: { label: "Check for clashes", run: () => void runDetect(null), disabled: !!busy } }
      : { text: "Open models from the menu" };
  // iOS cannot pick a folder: the export-folder upload is left out there (XML files still upload).
  const noFolders = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  // The header's two menus, as popovers on a desktop and as sections of the menu on phones and tablets.
  const addable = sceneId && !gone?.scene ? addableSamples(samples, sceneFiles, stepFiles) : null;
  const addWait = addable ? modelsWait() : null;
  const modelsMenu = (close: () => void) => (<>
    {addable && <>
      <p className="pop-title">Add to the open models</p>
      {addable.map((f) => (
        <label key={f} className="pop-item check">
          <input type="checkbox" value={f} checked={adding.includes(f)}
            onChange={(e) => setAdding(e.target.checked ? [...adding, f] : adding.filter((x) => x !== f))} /> {f}
        </label>))}
      {!addable.length && <p className="hint">{isMachine(sceneFiles, stepFiles) ? "No other STEP sample to add." : "Every sample model is open."}</p>}
      <button className="btn primary small" data-add-models disabled={!adding.length || !!addWait} onClick={() => { close(); void addModels(adding); }}>
        <Plus size={14} aria-hidden /> Add {adding.length} model{adding.length === 1 ? "" : "s"}</button>
      <button className="pop-item" disabled={!!addWait} onClick={() => { close(); pickFor.current = "add"; modelInput.current?.click(); }}>
        <Upload size={14} aria-hidden /> Upload models to add…</button>
      <p className="hint">{addWait ?? "They draw beside the open models and every kept check runs again; fixes, edits and checks stay."}</p>
      <p className="pop-title">Open instead</p>
    </>}
    {!addable && <p className="pop-title">Models to open together</p>}
    {samples.map((f) => (
      <label key={f} className="pop-item check">
        <input type="checkbox" value={f} checked={picked.includes(f)}
          onChange={(e) => setPicked(e.target.checked ? [...picked, f] : picked.filter((x) => x !== f))} /> {f}
      </label>
    ))}
    {!samples.length && <p className="hint">No models in samples/</p>}
    <button id="open" className="btn primary small" disabled={!picked.length || !!busy} onClick={() => { close(); open(); }}>
      <FolderOpen size={14} aria-hidden /> Open {picked.length} model{picked.length === 1 ? "" : "s"}</button>
    <p className="pop-title">Or your own</p>
    <button className="pop-item" disabled={!!busy} onClick={() => { close(); modelInput.current?.click(); }}>
      <Upload size={14} aria-hidden /> Upload models (IFC or STEP)…</button>
    <p className="hint">{uploadMax ? `Up to ${uploadMax} MB together.` : "Several files open together."} A STEP machine is converted to IFC to check; Export gives your STEP back
      with the fixes.</p>
  </>);
  const coordinateMenu = (close: () => void) => (<>
    <p className="pop-title">Coordinate the open models</p>
    <button className="pop-item" disabled={!sceneId || !!busy || !!detecting} onClick={() => { close(); void runDetect(null); }}>
      <Radar size={14} aria-hidden /> Check the open models</button>
    {checks.length > 1 && <button className="pop-item" disabled={!sceneId || !!busy || !!detecting} onClick={() => { close(); void runDetect(null, sceneId, { all: true }); }}>
      <RotateCcw size={14} aria-hidden /> {`Run all ${checks.length} checks again`}</button>}
    {checks.length > 0 && report?.origin !== "iris" && <button className="pop-item" disabled={!sceneId || !!busy || !!detecting}
      onClick={() => { close(); void backToChecks(); }}>
      <Radar size={14} aria-hidden /> {`Back to Iris's checks (${checks.length})`}</button>}
    {!sceneId && <p className="hint">Open the models first.</p>}
    <p className="pop-title">Or import a Navisworks clash report (XML)</p>
    {reportSamples.map((s) => (
      <button key={s} className="pop-item" disabled={!!busy} onClick={() => { close(); void loadReport(() => api.openReport(s), s).then((r) => { if (r) sampleReports.current[r.id] = s; }); }}>
        <FileSpreadsheet size={14} aria-hidden /> {s}</button>
    ))}
    {!noFolders && <button className="pop-item" disabled={!!busy} onClick={() => { close(); folderInput.current?.click(); }}><Upload size={14} aria-hidden /> Upload an export folder…</button>}
    <button className="pop-item" disabled={!!busy} onClick={() => { close(); filesInput.current?.click(); }}><Upload size={14} aria-hidden /> Upload XML files…</button>
    {!noFolders && <p className="hint">Upload the whole export folder to get each clash's images.</p>}
  </>);
  // The desktop's panels: show one (also a closed one), go back to the default layout, or to the classic one.
  const layoutMenu = (close: () => void) => (<>
    <p className="pop-title">Panels</p>
    {docked ? PANELS.filter((p) => p.id !== "model").map((p) => (
      <button key={p.id} className="pop-item" onClick={() => { close(); showPanel(p.id); }}>
        {p.title}{dock.current && !dock.current.isOpen(p.id) ? <span className="why"> closed</span> : null}</button>))
      : <p className="hint">The list on the left, Clash, Plan and Chat on the right, Activity below.</p>}
    {docked && <button className="pop-item" onClick={() => { close(); dock.current?.reset(); }}><RotateCcw size={14} aria-hidden /> Reset the layout</button>}
    <label className="pop-item check"><input type="checkbox" checked={workings.on} onChange={(e) => { close(); setWorkingsOn(e.target.checked); }} /> Workings in Activity</label>
    <label className="pop-item check"><input type="checkbox" checked={classic} onChange={(e) => { close(); setClassic(e.target.checked); }} /> Classic layout (fixed panels)</label>
  </>);

  // The selected element's card (ElementCard.tsx): what it is, where it sits, what to do with it, its links and everything
  // its model says. The classic card over the model and the dock's Properties panel both show it (docs/panels.md).
  const idsWith = (facet: string, value: string | number | boolean) => {
    if (!prepared) return [];
    return [...matching(prepared, { facet, op: "is", values: [value] })].map((i) => prepared.index.elements[i]);
  };
  /** Isolate these for now and take every view to them; an empty list does nothing (isolating nothing would blank the
   * model). */
  const isolateNow = (ids: string[]) => {
    if (!ids.length) return;
    setIsolating(false);   // another isolation replaces the clash's
    setTemporary({ hidden: [], isolated: ids });
    viewer.current?.frameEverywhere(ids);
  };
  const cardActions = (gid: string): CardActions => {
    const cls = String(selected?.info?.ifc_class ?? elementProps?.data?.ifc_class ?? "");
    return {
      onPick: (other) => {
        const epoch = sceneEpoch.current;
        setSelected({ globalId: other, info: null });
        viewer.current?.frame([other]);
        if (sceneId) api.element(sceneId, other)
          .then((info) => { if (sceneEpoch.current === epoch) setSelected((s) => (s?.globalId === other ? { ...s, info } : s)); })
          .catch(() => undefined);
      },
      onShowLinks: () => void pinLinks(gid, false),
      onSide: (side) => pickSide(gid, side),
      canB: !!a && a !== gid,
      onZoom: () => viewer.current?.frame([gid]),
      onHide: () => { setIsolating(false); setTemporary((t) => ({ ...t, hidden: [...t.hidden, gid] })); setSelected(null); },
      onIsolate: () => { setIsolating(false); setTemporary({ hidden: [], isolated: [gid] }); },
      onSection: () => sectionRound(gid),
      onHideClass: () => { const ids = viewer.current?.ofClass(cls) ?? []; setIsolating(false); setTemporary((t) => ({ ...t, hidden: [...new Set([...t.hidden, ...ids])] })); setSelected(null); },
      onIsolateClass: () => isolateNow(viewer.current?.ofClass(cls) ?? []),
      onFilterClass: () => openFilters(blankRule([{ facet: "class", op: "is", values: [cls] }], "isolate")),
      onLevel: (name, how) => {
        if (how === "filter") { openFilters(blankRule([{ facet: "storey", op: "is", values: [name] }], "isolate")); return; }
        // The viewer's own storeys (the datums), so this works before the filters' index arrives; nothing found, nothing done.
        const level = viewer.current?.ofLevel(name) ?? [];
        const ids = level.length ? level : idsWith("storey", name);
        if (!ids.length) return;
        if (how === "isolate") isolateNow(ids);
        else { setIsolating(false); setTemporary((t) => ({ ...t, hidden: [...new Set([...t.hidden, ...ids])] })); if (ids.includes(gid)) setSelected(null); }
      },
      load: (ref) => (sceneId && ref.global_id ? api.properties(sceneId, ref.global_id, ref.file) : Promise.reject(new Error("No scene"))),
      // What the model says about it, changed and kept in the edit log (docs/editing-parity.md, Tier 3): no shape
      // changes, so the page only moves its drawn revision on, shows the new properties and reads the log again.
      editor: sceneId ? {
        choices: () => api.propertyChoices(sceneId, gid),
        save: async (change) => {
          const r = await api.editProperty(sceneId, gid, change);
          setElementProps({ gid, data: r.properties, loading: false });
          if (sceneRevision.current === r.revision_before) sceneRevision.current = r.revision;
          setInfoRev((n) => n + 1);
          void refreshJournal(sceneId);
        },
      } : undefined,
      rows: prepared ? {
        facets: facetKeys,
        onFilter: (row) => openFilters(blankRule([{ facet: row.facet!, op: "is", values: [row.raw!] }], "colour")),
        onColourBy: (row) => {
          setFilterState((st) => ({ ...st, colours: true, rules: [{ ...blankRule([], "byValue"), by: { facet: row.facet! }, name: `By ${row.name}` }, ...st.rules] }));
          openFilters();
        },
        onIsolate: (row) => isolateNow(idsWith(row.facet!, row.raw!)),
      } : undefined,
    };
  };
  // ------------------------------------------------------------------ the project shell (docs/engineer-workflow.md)
  /** GlobalId → name for what a proposal card names: the open models' own names, else the report's. */
  const namesFor = (ids: readonly (string | null | undefined)[]) => Object.fromEntries(ids.filter((g): g is string => !!g)
    .map((g) => [g, sceneClasses.current?.map[g]?.[1] || elementName(g)] as const).filter(([, n]) => !!n));
  // The clash before and after the one on screen, in the list's order (the investigation header's arrows).
  const listAt = clash && listReport ? listReport.clashes.findIndex((c) => c.id === clash.id) : -1;
  const listPrev = listAt > 0 ? listReport!.clashes[listAt - 1] : null;
  const listNext = listAt >= 0 && listReport && listAt + 1 < listReport.clashes.length ? listReport.clashes[listAt + 1] : null;
  const importPanel = (
    <ImportPanel rows={importRows} onRetry={retryImport} busy={!!busy || !!projectBusy}
      onRemove={(n) => { setImportRows((r) => removeRow(r, n)); if (importBatch.current) importBatch.current.files = importBatch.current.files.filter((f) => f.name !== n); }}
      onPick={() => { pickFor.current = pid && projectHere ? "project" : sceneId ? "add" : "open"; modelInput.current?.click(); }}
      onDrop={(fs) => void (pid && projectHere ? importToProject(fs) : importFiles(fs))}
      onClose={importRows.length ? () => setImportRows([]) : undefined} />);
  const coordCard = coordSummary && (
    <CoordinationOverview summary={coordSummary} onFilter={filterCoord}
      onRunChecks={() => void (checks.length ? runDetect(null, sceneId, { all: true }) : runDetect(null))}
      onTriage={() => void runTriage(false)} triaged={!!triageRun || Object.keys(listTriage).length > 0} />);
  /** On the Coordination step the overview leads the Clashes tab, above triage. */
  const withCoord = (card: React.ReactNode) => (projStep === "coordination" && coordCard ? <>{coordCard}{card}</> : card);
  const sampleSet = demos.find((d) => d.tour === "northbank")?.files ?? demos[0]?.files ?? [];
  /** The sample building has sample PDF drawings (GET /api/samples lists them): the first screen offers them. */
  const sampleDrawings = !!demos.find((d) => d.tour === "northbank")?.drawings?.length;
  // A project's Models step (left pane): import with per-file rows, the models open and the model summary.
  const modelsStep = projectHere && (
    <div className="proj-work">
      {importPanel}
      {!projectOpen && !projectBusy && (
        <div className="proj-work-note">
          {sceneId && stats ? <>
            <p className="hint">The models open now are not this project's{projectHere.files.length ? "" : " (it has none yet)"}.</p>
            <button className="btn small" disabled={!!busy} onClick={() => void (autoOpened.current = projectHere.id, keepModels(projectHere.id, sceneId))}>
              <Boxes size={14} aria-hidden /> Keep the open models in this project</button>
          </> : null}
          {projectHere.files.length > 0
            ? <button className="btn small primary" disabled={!!busy} onClick={() => void openProjectScene(projectHere)}>
              <FolderOpen size={14} aria-hidden /> Open the project's models</button>
            : sampleSet.length > 0 && <button className="btn small" disabled={!!busy} onClick={() => void samplesToProject(sampleSet)}
              data-tip={`Synthetic sample models: ${shortNames(sampleSet).join(", ")}`}>
              <FolderOpen size={14} aria-hidden /> Use the sample building</button>}
        </div>)}
      {projectBusy && <p className="live-line"><i className="spinner" aria-hidden /> {projectBusy}</p>}
      {projectOpen && modelNames.length > 0 && (
        <section className="proj-open-models" aria-label="Models open in the workspace">
          <h3>Models in the workspace</h3>
          <ul>{modelNames.map((n, i) => (
            <li key={`${n}:${i}`}>
              <label className="check" data-tip="Show or hide it in the views"><input type="checkbox" checked={!tool.hiddenModels.includes(i)}
                onChange={(e) => setModelVisible(i, e.target.checked)} /> <span className="mono">{n}</span></label>
              {!gone?.scene && <button type="button" className="ibtn" aria-label={`Remove ${n}`} data-tip={addWait ?? "Remove it from the open models"}
                disabled={!!addWait} onClick={() => askRemove(i)}><Trash2 size={13} aria-hidden /></button>}
            </li>))}</ul>
        </section>)}
      {projectOpen && <ModelSummary index={facetIndex} isolated={temporary.isolated ? summaryIsolated : null}
        onIsolate={(ids, label) => { isolateNow(ids); setSummaryIsolated(label); }}
        onClear={() => { endIsolation(); setSummaryIsolated(null); }} />}
      {projectOpen && !facetIndex && facetsError && <p className="hint">The model summary could not be read: {facetsError}
        <button className="btn small ghost" onClick={() => setFacetsTry((n) => n + 1)}>Try again</button></p>}
    </div>);
  const decisionsList = journal?.decisions ?? [];
  // GlobalId → name for the Drawings step's model side (the open models' own names).
  const drawingNames = projStep === "drawings" ? Object.fromEntries(Object.entries(sceneClasses.current?.map ?? {}).map(([g, cn]) => [g, cn[1]])) : {};
  // The open models are a demo's set with sample drawings: the Drawings step offers them (POST .../drawings/samples).
  const sceneSampleDrawings = projStep === "drawings" && !!demoOfFiles(sceneFiles, demos)?.drawings?.length;
  // The project pages (the projects home, and a project's Overview, Reports and Activity) over the workspace.
  // An error on a page over the workspace (Home, the projects, a project's page): one line at its top.
  const errorShown = error && !goneWords.current.has(error) ? error : null;
  const pageAlert = errorShown && (
    <div className="proj-shell-alert" role="alert" onClick={() => setError(null)}><TriangleAlert size={14} aria-hidden /> <span>{errorShown}</span> <X size={13} aria-hidden /></div>);
  // The project pages (the projects home, and a project's Overview, Drawings, Reports and Activity) over the workspace.
  const projectPage = route?.view === "projects" ? (
    <div className="proj-shell" role="region" aria-label="Projects">
      {pageAlert}
      <ProjectsHome projects={projects} loading={projectsLoading} error={projectsError ?? undefined}
        onNew={() => setNewOpen(true)} onOpen={(id) => goStep("overview", id)} hrefOf={(id) => projectPath(id)}
        onRename={(id, n) => renameProjectNow(id, n)} onRemove={removeProjectHere}
        onDemo={sampleSet.length ? () => void trySample() : undefined} />
    </div>)
    : pid && (!workStep || !projectHere) ? (
    <div className="proj-shell" role="region" aria-label="Project">
      {pageAlert}
      {projectHere ? (
        <ProjectOverview project={projectHere} step={projStep ?? "overview"} onStep={(st) => goStep(st)} onProjects={goProjects}
          stepHref={(st) => projectPath(projectHere.id, st)} projectsHref={PROJECTS_PATH}
          counts={liveCounts} reports={projectHere.reports} activity={projectActivity}
          onImport={() => goStep("models")} saving={projectBusy === "Saving…"}
          onOpenWorkspace={() => { if (!projectOpen && projectHere.files.length) void openProjectScene(projectHere); goStep(projectHere.files.length ? "coordination" : "models"); }}
          onSave={() => { if (projectOpen) return saveProjectNow(); setError("Open the project's models first: nothing of it is open to save."); return false; }}>
          {projStep === "drawings" && (projectOpen && sceneId ? (
            <section className="proj-drawings" aria-label="Drawings">
              <DrawingsPanel sceneId={sceneId} drawings={drawings} items={drawingItemsBy} compare={drawingCompare} busy={!!busy}
                names={drawingNames} error={drawingsError} onRetry={() => setDrawingsTry((n) => n + 1)}
                onUpload={(files, progress) => uploadDrawings(sceneId, files, progress).then((r) => { setDrawingsTry((n) => n + 1); return r; })}
                onRead={(did, onEvent) => readDrawing(did, { onEvent }).then((r) => { setDrawingsTry((n) => n + 1); return r; })}
                onSamples={sceneSampleDrawings ? () => addSampleDrawings(sceneId).then((r) => { setDrawingsTry((n) => n + 1); return r; }) : undefined}
                onFocusElement={(gid) => { goStep("models"); setSelected({ globalId: gid, info: null }); isolateNow([gid]); }} />
            </section>
          ) : (
            <section className="proj-card" aria-label="Drawings">
              {busy || projectBusy
                ? <p className="live-line ai-shimmer" data-drawings="opening" role="status"><i className="spinner" aria-hidden /> {projectBusy ?? busy}</p>
                : <EmptyState compact title={projectHere.files.length ? "Open the models to read drawings" : "No models yet"}
                  line={projectHere.files.length ? "Each PDF drawing is read against the open models, then compared with them."
                    : "Import the models first: each PDF drawing is read against them."}
                  action={projectHere.files.length > 0
                    ? <button type="button" className="btn primary" disabled={!!busy || !!projectBusy} onClick={() => void openProjectScene(projectHere)}>
                      <FolderOpen size={15} aria-hidden /> Open the project's models</button>
                    : <button type="button" className="btn primary" onClick={() => goStep("models")}><Upload size={15} aria-hidden /> Import models</button>} />}
            </section>))}
          {projStep === "reports" && (
            <section className="proj-card" aria-label="Build a report">
              <div className="proj-card-head"><h2>Build a report</h2></div>
              {projectOpen && report ? <>
                <p className="proj-text">A PDF for the design teams, with the project's name on the cover, and BCF issues. Each report built
                  here is kept with the project and listed above.</p>
                <div className="proj-card-foot"><button type="button" className="btn primary small" onClick={() => { setDocOpen(true); setDocReady(false); }}>
                  <FileText size={14} aria-hidden /> Build the report (PDF, BCF)</button></div>
              </> : <p className="proj-text proj-empty-line">{projectHere.files.length
                ? "Open the workspace and run the clash tests first: a report is built from the open clash list."
                : "Import the models and run the clash tests first."}</p>}
            </section>)}
          {projStep === "activity" && (
            <section className="proj-card" aria-label="Decisions">
              <div className="proj-card-head"><h2>Decisions{decisionsList.length > 0 && <span className="proj-count">{decisionsList.length}</span>}</h2></div>
              {projectOpen && decisionsList.length ? (
                <table className="proj-mini">
                  <thead><tr><th scope="col">When</th><th scope="col">Clash</th><th scope="col">Proposal</th><th scope="col">State</th>
                    <th scope="col">Decision</th><th scope="col">Reviewer</th><th scope="col">Why</th></tr></thead>
                  <tbody>{[...decisionsList].reverse().map((d, k) => {
                    const w = decisionWords({ ...d, at: toMs(d.at) });
                    return <tr key={k}><td title={w.iso}>{w.when}</td><td className="mono">{d.number ? `#${d.number}` : d.clash_id}</td>
                      <td className="proj-file" title={d.option.title}>{d.option.title}</td><td>{STATE_LABEL[d.state] ?? d.state}</td>
                      <td>{w.verb}</td><td>{d.reviewer || "not recorded"}</td><td>{d.reason ?? ""}</td></tr>;
                  })}</tbody>
                </table>
              ) : <p className="proj-text proj-empty-line">{projectOpen
                ? "No decisions yet. Accepting, rejecting, modifying or asking for another proposal records one here, with the reviewer and why."
                : "Open the workspace to read the decisions: a saved project's decisions come back with its models."}</p>}
            </section>)}
          {projStep === "activity" && projectOpen && journal && journal.entries.length > 0 && (
            <section className="proj-card" aria-label="Edit log">
              <div className="proj-card-head"><h2>Edit log<span className="proj-count">{journal.entries.length}</span></h2></div>
              <EditPanel journal={journal} busy={!!busy} csvUrl={sceneId ? api.journalCsvUrl(sceneId) : null}
                clashLabel={clashTag} onUndo={() => void stepEdit("undo")} onRedo={() => void stepEdit("redo")} onUndoTo={(e) => void undoTo(e)}
                onShow={(e) => { goStep("clash"); const v = viewer.current; v?.frameEverywhere([...e.elements, ...e.created].filter((g) => v.isShown(g))); }} />
            </section>)}
        </ProjectOverview>
      ) : (
        <div className="proj-page"><div className="proj-scroll"><div className="proj-body">
          <p className="proj-eyebrow">Project</p>
          {projectError
            ? <div className="proj-alert" role="alert">{projectError}</div>
            : <div className="proj-loading" aria-live="polite"><span className="spinner" aria-hidden /> Loading the project…</div>}
          <div><button type="button" className="btn small" onClick={goProjects}>All projects</button></div>
        </div></div></div>)}
    </div>) : null;

  // The clash tab's actions, right under its header so Propose fixes shows without scrolling: Propose fixes (unless the
  // clash reads as not one), a wider fix, and the way back to the clash in 3D.
  const fixedHere = !!clash && (!!fixes[clash.id] || resolvedIds.has(clash.id));
  const clashActions = (
    <div className="actions">
      {!hideFix && <button className="btn primary big" data-tour="propose" disabled={!a || !b || !sceneId || !!busy || proposing || (!!running && running.id !== clash?.id)} onClick={propose}>
        {proposing ? <><i className="spinner" aria-hidden /> Working…</>
          : running && running.id !== clash?.id ? <><i className="spinner" aria-hidden /> {`Waiting for #${running.number}`}</>
          : <><Sparkles size={16} aria-hidden /> Propose fixes</>}</button>}
      <button className="btn" disabled={!a || !b || a === b || !sceneId || !!busy || contextWorking || proposing || planning}
        onClick={() => void exploreContext()}><Network size={15} aria-hidden /> Explore wider fix</button>
      <button className="btn ghost" disabled={!a && !b} onClick={focusNow}><LocateFixed size={15} aria-hidden /> Go to the clash</button>
    </div>);
  // Home (StartScreen.tsx): asked for at /home (the session, if any, stays open behind it), or the page with nothing
  // open and no project's page asked for.
  const showHome = !route && (homeAsked || (!stats && !report && !blankish && !busy && !loading));
  const homePage = showHome && (
    <div className="proj-shell home-shell" role="region" aria-label="Home">
      {pageAlert}
      <StartScreen name={reviewer} onNewProject={() => setNewOpen(true)} onProjects={goProjects} projectsHref={PROJECTS_PATH}
        onSample={sampleSet.length ? () => void trySample() : undefined} sampleBusy={!!projectBusy && projectBusy !== SAMPLE_DRAWINGS_BUSY}
        onSampleDrawings={sampleDrawings ? () => void trySampleDrawings() : undefined} sampleDrawingsBusy={projectBusy === SAMPLE_DRAWINGS_BUSY}
        recent={projects} recentLoading={projectsLoading} onOpenProject={(id) => goStep("overview", id)} projectHref={(id) => projectPath(id)}
        resume={resumable ? { files: resumable.info.files, clashes: resumable.clashes, fixed: Object.keys(resumable.saved.fixes ?? {}).length,
          agent: !!resumable.saved.link, agentLeft: resumable.saved.link ? timeLeft(resumable.saved.link, now) : null, savedAt: resumable.saved.saved_at,
          onResume: () => { setHomeAsked(false); void resumeSession(); }, onFresh: startFresh } : undefined} />
    </div>);
  // ------------------------------------------------------------------ the app shell (AppShell.tsx)
  /** The open session (models or a clash report) outside the project shown in the sidebar. */
  const sessionOpen = !!(sceneId || report);
  const sessionName = sceneFiles.length ? projectName(sceneFiles) : report && !sceneId ? "Clash report" : "Workspace";
  /** A page over the workspace (Home, the projects, a project's page): else the workspace itself is the page. */
  const onPage = !!homePage || !!projectPage;
  const navActive: NavId = homePage ? "home" : route?.view === "projects" ? "projects" : route?.view === "project" ? route.step : "workspace";
  const navProject = project ? { id: project.id, name: project.name || "Untitled project", counts: {
    ...(project.files.length ? { models: project.files.length } : {}),
    ...(projectOpen && drawings.length ? { drawings: drawings.length } : {}),
    ...(((project.id === pid ? liveCounts : null) ?? project.counts)?.open ? { clash: ((project.id === pid ? liveCounts : null) ?? project.counts)!.open } : {}),
    ...(project.reports.length ? { reports: project.reports.length } : {}),
  } } : null;
  const navWorkspace = (sessionOpen && !projectOpen) || (blank && !pid) ? { label: "Workspace" } : null;
  const navHref = (id: NavId): string | undefined => (id === "home" ? "/home" : id === "projects" ? PROJECTS_PATH
    : id === "workspace" ? "/workspace" : navProject ? projectPath(navProject.id, id) : undefined);
  const nav = (id: NavId) => {
    setDrawerOpen(false);
    if (id === "home") goHome();
    else if (id === "projects") goProjects();
    else if (id === "workspace") goWorkspace();
    else if (navProject) goStep(id, navProject.id);
  };
  const rail = !compact && (onPage ? rails.pages : rails.workspace);
  // The workspace's width changes with the sidebar (its width eases over 180 ms): dockview lays its panels out again on
  // a window resize, not on its box's (a side bar that kept its width stayed drawn where it was), so the page says so
  // once the sidebar has settled. The 3D view and the classic layout follow their own boxes.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    const t = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 240);
    return () => window.clearTimeout(t);
  }, [rail]);
  const toggleRail = () => {
    const where = onPage ? "pages" : "workspace", next = !rail;
    setRails((r) => ({ ...r, [where]: next }));
    writeRail(browserStorage(), where, next);
  };
  // The search in the top bar: projects by name, the open clash list by number, title or element, the open models'
  // elements by name or GlobalId, and the pages.
  const searchHits = (q: string): SearchHit[] => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const hits: SearchHit[] = [];
    const known = project && !projects.some((x) => x.id === project.id) ? [project, ...projects] : projects;
    for (const x of known) {
      if (hits.length >= 4) break;
      if ((x.name || "Untitled project").toLowerCase().includes(s)) hits.push({ id: `p:${x.id}`, kind: "project", label: x.name || "Untitled project",
        sub: plural(x.files.length, "model"), href: projectPath(x.id), run: () => goStep("overview", x.id) });
    }
    const list = report ? (shownReport ?? report).clashes : [];
    const num = /^#?(\d+)$/.exec(s)?.[1];
    for (const c of list) {
      if (hits.length >= 10) break;
      const words = `${c.title ?? ""} ${c.name} ${c.a.name ?? ""} ${c.b.name ?? ""}`.toLowerCase();
      if (num ? String(c.number) === num : words.includes(s)) hits.push({ id: `c:${c.id}`, kind: "clash", label: clashLabel(c),
        sub: c.distance_m != null ? mm(c.distance_m) : undefined,
        href: pid ? projectPath(pid, "clash") : "/workspace",
        run: () => { if (pid) goStep("clash"); else goWorkspace(); setTab("clash"); selectClash(c); } });
    }
    const named = sceneClasses.current?.map;
    if (named && s.length >= 2) {
      let n = 0;
      for (const g of Object.keys(named)) {
        if (n >= 5) break;
        const [cls, name] = named[g];
        if (g.toLowerCase() === s || (name ?? "").toLowerCase().includes(s)) {
          n++;
          hits.push({ id: `e:${g}`, kind: "element", label: name || g, sub: `${cls} · ${g}`,
            run: () => { if (onPage) { if (pid) goStep("clash"); else goWorkspace(); } setSelected({ globalId: g, info: null }); viewer.current?.frame([g]); } });
        }
      }
    }
    for (const page of [{ id: "home", label: "Home" }, { id: "projects", label: "Projects" }] as const) {
      if (page.label.toLowerCase().startsWith(s)) hits.push({ id: `n:${page.id}`, kind: "page", label: page.label, href: navHref(page.id), run: () => nav(page.id) });
    }
    return hits;
  };
  // The workspace's one status line in its header (desktop): an error, the server letting go of the models, the agent
  // driving the view, or what Iris is doing now (the AI shimmer while a model works); else a quiet summary.
  const aiWorking = proposing || !!running || planning || contextWorking || (!!triageRun && !triageRun.done);
  const headerStatus = errorShown ? (
      <span className="status-line status-error" role="alert"><TriangleAlert size={14} aria-hidden /><span className="status-text" title={errorShown}>{errorShown}</span>
        <button type="button" className="ibtn" aria-label="Dismiss" onClick={() => setError(null)}><X size={13} aria-hidden /></button></span>)
    : gone && !busy && !detecting ? (
      <span className="status-line status-gone" role="alert">
        <span className="status-text" data-tip={`It restarted, or made room for other visitors.${gone.scene ? " The fixes you kept went with them." : ""}`}>
          The server no longer holds your {gone.scene ? "models" : "clash report"}</span>
        <button type="button" className="btn small" onClick={() => void reopenGone()}><RotateCcw size={13} aria-hidden /> {reopenLabel}</button></span>)
    : pilotStatus ? (
      <span className={`status-line status-pilot ${pilotStatus.state}${pilotStatus.driving ? " ai-shimmer" : ""}`}>
        {pilotStatus.driving ? <Navigation size={14} aria-hidden /> : <Hand size={14} aria-hidden />}<span className="status-text">{pilotStatus.text}</span>
        {pilotStatus.driving
          ? <button type="button" className="btn small" onClick={() => pilot.current?.takeOver()}>Take the view</button>
          : <button type="button" className="btn small" onClick={() => pilot.current?.resume()}>Let Iris drive</button>}</span>)
    : notchStatus ? (
      <span className={`status-line status-work${aiWorking ? " ai-shimmer" : ""}`}><ApertureMark size={18} working /><b>{notchStatus.title}</b>
        {notchStatus.detail && <span className="status-text">{notchStatus.detail}</span>}</span>)
    : report ? (
      <span className="status-line status-idle">{plural((listReport ?? report).clashes.length, "clash", "clashes")}
        {fixedCount > 0 && <> · <CircleCheck size={13} aria-hidden className="ok" /> {fixedCount} fixed</>}</span>)
    : null;
  const workCrumbs: Crumb[] = pid && projectHere ? [{ label: "Projects", href: PROJECTS_PATH, onClick: goProjects },
    { label: projectHere.name || "Untitled project", href: projectPath(projectHere.id), onClick: () => goStep("overview") }] : [];
  const workHeader = !compact && !onPage && (
    <PageHeader slim crumbs={workCrumbs} title={projStep ? stepLabel(projStep) : sessionName} status={headerStatus} />);
  // The top bar's primary action: a new project (Home, the projects), the project's workspace (its pages), Export (the
  // workspace, with Save and Report beside it).
  const projectFiles = projectHere?.files.length ?? 0;
  const topActions = (<>
    {ownerPop}
    {homePage || route?.view === "projects"
      ? <button type="button" className="btn primary" data-shell="new-project" onClick={() => setNewOpen(true)}><Plus size={16} aria-hidden /> New project</button>
      : projectPage && projectHere
        ? <button type="button" className="btn primary" data-shell="open-workspace" disabled={!!projectBusy && !projectFiles}
          onClick={() => { if (!projectFiles) { goStep("models"); return; } if (!projectOpen) void openProjectScene(projectHere); goStep("clash"); }}>
          {projectFiles ? <>Open workspace <ArrowRight size={15} aria-hidden /></> : <><Upload size={15} aria-hidden /> Import models</>}</button>
        : !onPage && workActions}
  </>);

  const elementCard = (fold: boolean, closable: boolean) => selected && (
    <ElementCard key={selected.globalId} gid={selected.globalId} info={selected.info}
      props={elementProps?.gid === selected.globalId ? elementProps.data : null}
      loading={elementProps?.gid !== selected.globalId || !!elementProps?.loading} fold={fold}
      actions={{ ...cardActions(selected.globalId), ...(closable ? { onClose: () => setSelected(null) } : {}) }} />);

  return (
    <div className={`shell${rail ? " shell-rail" : ""}${compact ? ` shell-compact shell-${layout}` : ""}`}>
      <Sidebar active={navActive} project={navProject} workspace={navWorkspace} rail={rail}
        drawer={compact ? (drawerOpen ? "open" : "closed") : undefined} onCloseDrawer={() => setDrawerOpen(false)}
        onNav={nav} hrefOf={navHref}
        onHelp={() => { setDrawerOpen(false); setHelpOpen(true); }} onSettings={() => { setDrawerOpen(false); setMenuOpen(true); }} />
      <div className="shell-main">
        <TopBar rail={rail} onToggle={toggleRail} compact={compact} onMenu={() => setDrawerOpen(true)}
          search={layout !== "phone" ? <SearchBox search={searchHits} placeholder={onPage ? "Search projects, clashes, elements" : "Search clashes, elements"} /> : undefined}
          actions={topActions}>{workHeader || null}</TopBar>
        <div className="shell-body">
          <div className={`app ${compact ? "" : "notched"} ${docked ? "docked" : ""} ${resizing ? "resizing" : ""} ${landing ? "landing" : ""} ${starting ? "starting" : ""} ${compact ? `${layout} snap-${snap}` : ""} ${compact && listOpen ? "list-open" : ""}`}
            style={{ "--left-w": `${widths.left}px`, "--right-w": `${widths.right}px` } as React.CSSProperties}>
            <input ref={modelInput} type="file" hidden multiple accept=".ifc,.step,.stp,.pdf" disabled={!!busy}
              onChange={(e) => {
                // A PDF can be chosen so its row says plainly that 2D drawings are not supported yet (importRows.ts).
                const files = [...(e.target.files ?? [])], forWhat = pickFor.current;
                e.target.value = ""; pickFor.current = "open";
                if (files.length) void (forWhat === "project" ? importToProject(files) : importFiles(files, forWhat === "add"));
              }} />
            <input ref={folderInput} type="file" hidden multiple disabled={!!busy} {...{ webkitdirectory: "" }} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            <input ref={filesInput} type="file" hidden multiple disabled={!!busy} accept=".xml,.png,.jpg,.jpeg" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />

            {inSlot(slots.clashes, <aside className="pane left">
              {projStep === "models" && projectHere ? modelsStep : <>
              {importRows.length > 0 && !pid && importPanel}
              {report
                ? <ReportList report={listReport ?? shownReport ?? report} naming={naming} matches={matches}
                    coord={coordList} onClearCoord={() => setCoordFilter(null)}
                    thumbs={report.origin === "iris" && matches ? thumbs : undefined} onThumb={needThumb}
                    focus={listFocus} onClearFocus={() => setListFocus(null)} reveal={listReveal} selected={viewPlan || activeContext ? null : clash?.id ?? null} onSelect={(c) => { if (compact && tab === "chat") setTab("clash"); selectClash(c); }} onImage={(c, index) => setLightbox({ clash: c, index })} fixes={fixes}
                    reviewed={reviewed} checked={checked} busy={planning || proposing || !!running} triage={listTriage} triageFilter={triageFilter}
                    proposing={running?.id ?? null} ready={readyCounts} panel={tab === "clash"} onViewProposal={viewProposal}
                    isolating={isolating} onIsolate={isolateClash}
                    onCheck={(ids, on) => setChecked((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; })}
                    onFixChecked={() => runPlan({ clash_ids: [...checked] })}
                    onPropose={sceneId ? proposeFromList : undefined} onSetAside={(c, note) => review([c.id], "by_design", note)}
                    onFocus={(f) => setListFocus(f)}
                    view={leftView} onView={setLeftView} insightsCount={insightsOpen}
                    status={detecting && <p className="live-line"><i className="spinner" aria-hidden /> {detecting.phase}</p>}
                    picker={report.origin === "iris" && checks.length > 1 && <CheckPicker checks={checks} total={report.clashes.length}
                      value={viewCheck} onPick={setViewCheck} disabled={!!busy || !!detecting || !sceneId}
                      onAgain={(key) => void runDetect(null, sceneId, { check: key })} onAll={() => void runDetect(null, sceneId, { all: true })}
                      onRemove={(key) => void removeCheck(key)} />}
                    triageCard={withCoord(<TriageCard run={triageRun} active={triageModel} workers={triageWorkers} forceCompact={!!listFocus} results={listTriage} now={now} filter={triageFilter} onFilter={setTriageFilter}
                      live={Object.entries(triageLive).map(([id, text]) => ({ id, text, name: (() => { const c = shownReport?.clashes.find((x) => x.id === id); return c ? clashLabel(c) : id; })() }))}
                      onOpen={(id) => { const c = report.clashes.find((x) => x.id === id); if (c) selectClash(c); }}
                      total={(listReport ?? report).clashes.length} unread={unread} resolved={(id) => !!fixes[id] || !!reviewed[id]} onRun={runTriage} onStop={stopTriage}
                      onSetAside={(ids) => review(ids, "by_design", "Triage: by design or not physical")}
                      onFlag={(ids) => review(ids, "author", "Triage: modelling error")}
                      requirements={reqLabel} stale={triageStale} onRequirements={() => setReqOpen(true)} />)}
                    insights={<>{projStep !== "coordination" && coordCard}{(detecting || (report.origin === "iris" && shownCheck)) && <DetectSummary
                      detection={shownCheck ?? { coverage: [], diff: { new: [], resolved: [], no_longer_checked: [], first: true }, elements: 0, seconds: 0 }}
                      progress={detecting} disabled={!!busy || !sceneId}
                      onAgain={() => void (shownCheck ? runDetect(null, sceneId, { check: shownCheck.key }) : runDetect(lastTests.current))}
                      onWhole={checks.some((c) => c.key === "models") ? undefined : () => void runDetect(null)}
                      requirementsId={reqSaved?.enabled ? reqId : null} onRequirements={() => setReqOpen(true)} />}
                      <Insights rootCauses={rootCauses} patterns={patterns} verdicts={verdicts} explaining={explaining}
                      resolved={resolvedSet} focus={listFocus?.label ?? null} onFocus={(f) => { setListFocus(f); if (f) { setLeftView("clashes"); setViewCheck(null); } }}
                      busy={planning || proposing} onFixRoot={(hub) => runPlan({ hub })} onExplain={() => void explainPatterns()}
                      onSelect={(ids) => { setChecked((s) => new Set([...s, ...ids.filter((id) => !fixes[id] && !reviewed[id])])); setLeftView("clashes"); }}
                      onReview={review} onFixAll={(ids) => runPlan({ clash_ids: ids })}
                      onAddRule={sceneId ? (p, v) => void addRule(p, v) : undefined} hasRule={(p) => !!reqSaved?.enabled && hasByDesign(reqSaved.doc, p)} /></>} />
                : sceneId
                  ? <div className="detect-slot"><DetectSetupCard setup={detectSetup} progress={detecting} disabled={!!busy}
                      onRun={(tests) => void runDetect(tests)} requirements={reqLabel} onRequirements={() => setReqOpen(true)} />
                      <p className="hint small">{coarse ? "Or tap element A in the model, then element B, and set each from its card."
                        : "Or double-click element A, then element B, in the model."}</p></div>
                  : pid && projectHere
                  ? <EmptyState compact className="empty-left"
                    title={projectBusy ?? (projectHere.files.length ? "The project's models are not open" : "No models in this project yet")}
                    line={projectHere.files.length ? "Open them to run the clash tests." : "Import the IFC or STEP models first."}
                    action={projectHere.files.length > 0
                      ? <button className="btn primary" disabled={!!busy || !!projectBusy} onClick={() => void openProjectScene(projectHere)}>
                        <FolderOpen size={15} aria-hidden /> Open the project's models</button>
                      : <button className="btn primary" onClick={() => goStep("models")}><Upload size={15} aria-hidden /> Import models</button>} />
                  : !importRows.length && <EmptyState compact className="empty-left" title="Nothing to coordinate yet"
                    line="Open the models: Iris checks them for clashes." />}
              </>}
            </aside>)}

            {inSlot(slots.model, <main className={`stage ${tool.measure ? "measuring" : ""} ${tool.edit ? "editing" : ""} ${temporaryCount ? "temp-on" : ""}`} ref={host} onClick={onClick}
              onPointerDown={pressStart} onPointerMove={stageMove} onPointerUp={pressEnd} onPointerCancel={pressEnd}
              onPointerLeave={() => { if (hover.current.gid) clearHover(); if (tool.measure) viewer.current?.measureHover(null); }}
              onContextMenu={(e) => { if (coarse) e.preventDefault(); }}>
              {stats && <ViewerToolbar compact={layout === "phone"} state={tool} models={modelNames} hasFocus={!!(a || b || selected)} views={viewsControls} split={rail3d()}
                onMode={(mode) => setTool((t) => ({ ...t, mode }))} onStyle={(style) => setTool((t) => ({ ...t, style }))} onToggle={toggle}
                onView={(p) => viewer.current?.view(p)} onFit={() => viewer.current?.home()} onFocus={focusNow} onModel={setModelVisible} onShot={screenshot}
                remove={sceneId && !gone?.scene ? { onRemove: askRemove, blocked: addWait } : undefined} />}
              {stats && <ViewPanes viewer={viewer.current} offset={layout === "phone" ? 8 : 64} compact={layout === "phone"} clear={0} chip={(clash || a || b) && !viewPlan && !activeContext ? (
                <div className="clash-chip">
                  <span className="sw-pair"><i className="sw red" /><i className="sw green" /></span>
                  <span className="clash-chip-text">{clashBusy ? `Iris is working on ${clash ? `#${clash.number}` : "this pair"}` : clash ? clashLabel(clash) : "Your pair"}</span>
                  <button className="ibtn" disabled={clashBusy} onClick={leaveClash} aria-label="Leave this clash" data-tip={clashBusy ? "Iris is working on it" : "Leave this clash  ·  Esc"} data-tip-side="bottom"><X size={14} aria-hidden /></button>
                </div>) : null} />}
              {!docked && filtersOpen && stats && (
                <div className="filters-sheet" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  <div className="filters-sheet-head"><b>Filters</b>
                    <button type="button" className="ibtn" aria-label="Close" onClick={() => setFiltersOpen(false)}><X size={15} aria-hidden /></button></div>
                  <FiltersPanel index={prepared} loading={!!sceneId && !facetIndex && !facetsError} error={facetIndex ? null : facetsError} onRetry={() => setFacetsTry((n) => n + 1)} state={filterState} onState={setFilterState}
                    draft={filterDraft} onDraft={setFilterDraft} onZoom={(ids) => { const v = viewer.current; v?.frameEverywhere(ids.filter((g) => v.isShown(g))); }} check={filterCheck}
                  drawingsWhole={drawingsShow === "whole"} onDrawingsWhole={shownLayout === "single" ? undefined : (whole) => setDrawingsShow(whole ? "whole" : "filtered")} />
                </div>)}
              {stats && filterKey.length > 0 && (
                <button type="button" className="filter-chip" onClick={(e) => { e.stopPropagation(); openFilters(); }} onPointerDown={(e) => e.stopPropagation()}
                  data-tip="Filters by property: open them" data-tip-side="top">
                  {filterKey.slice(0, 6).map((k) => <span key={k.colour}><i className="fswatch" style={{ background: k.colour }} aria-hidden />{k.label}</span>)}
                  {filterKey.length > 6 && <span className="why">and more</span>}
                </button>)}
              {stats && temporaryCount > 0 && (
                <div className="temp-chip" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  {isolating && isolatedFor != null ? `Clash #${isolatedFor} isolated` : temporary.isolated ? "Isolated for now" : `${temporary.hidden.length} hidden for now`}
                  <button className="btn small" onClick={endIsolation}>{isolating ? "Show all" : "Reset"}</button>
                </div>)}
              {!stats && !report && blankish && (
                <ProjectStart busy={!!busy || !!projectBusy} maxMb={uploadMax}
                  onModels={(files) => void (pid && projectHere ? importToProject(files) : importFiles(files, false))} onReport={(files) => upload(files)}
                  onReportFolder={() => folderInput.current?.click()} onBack={() => (pid ? goStep("overview") : setBlank(false))} />
              )}
              {hoverInfo && <div className="link-label" ref={hoverLabel} role="status" style={labelAt.current}>
                {hoverInfo.name && <b>{hoverInfo.name}</b>}<span>{hoverInfo.counts}</span>
                {!hoverInfo.counts.endsWith("whole run") && <small>Shift: the whole run</small>}</div>}
              {tool.measure && viewer.current && <MeasurePanel measures={viewer.current.measurements} open={viewer.current.measureOpen} snap={snapping} coarse={coarse}
                at={layout === "phone" ? null : measureAt} onMove={setMeasureAt} onSnap={setSnapping} onCopy={(text, what) => void copyToClipboard(text).then((ok) => flash(ok ? `Copied ${what}.` : "Could not copy: the browser said no."))}
                onRemove={(id) => viewer.current?.removeMeasurement(id)} onClear={() => viewer.current?.clearMeasurements()} onClose={() => toggle("measure")} />}
              {tool.edit && sceneId && <EditTool ref={editTool} viewer={() => viewer.current} sceneId={sceneId} busy={!!busy} coarse={coarse}
                clash={clash ? { id: clash.id, pair: a && b ? [a, b] : null } : a && b ? { id: null, pair: [a, b] } : null}
                journal={journal} csvUrl={api.journalCsvUrl(sceneId)} clashLabel={clashTag} showLog={!docked}
                onKept={keptEdit} onUndo={() => void stepEdit("undo")} onRedo={() => void stepEdit("redo")} onUndoTo={(e) => void undoTo(e)}
                onShow={(e) => { const v = viewer.current; v?.frameEverywhere([...e.elements, ...e.created].filter((g) => v.isShown(g))); }}
                incoming={incomingEdit} onFace={(f) => { editPick.current = f; }}
                onError={(m) => setError(m)} onClose={() => { editPick.current = null; toggle("edit"); }} />}
              {!docked && selected && !tool.measure && (
                <div className="props" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  {elementCard(true, true)}
                </div>
              )}
              {loading && !stats && !coverLoading && <LoadCard load={loading} now={now} onCancel={cancelOpen} />}
              {compact && busy && <div className="overlay live"><i className="spinner" aria-hidden />{busy}</div>}
              {compact && proposing && <div className="overlay live"><i className="spinner" aria-hidden />{statusLine(progress, now, proposal?.attempts ?? [])}</div>}
              <div className={`pilot-glow ${pilotStatus?.driving ? "on" : ""}`} aria-hidden />
              {compact && pilotStatus && (
                <div className={`pilot ${pilotStatus.state}`} role="status" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  {pilotStatus.driving ? <Navigation size={14} aria-hidden /> : <Hand size={14} aria-hidden />}
                  <span>{pilotStatus.text}</span>
                  {pilotStatus.driving
                    ? <button className="btn small" onClick={() => pilot.current?.takeOver()}>Take the view</button>
                    : <button className="btn small" onClick={() => pilot.current?.resume()}>Let Iris drive</button>}
                </div>
              )}
              {compareBar}
              {compact && gone && !busy && !detecting && (   // a reopen's check may still ask after the old report: not news
                <div className="overlay gone" role="alert">
                  <span><b>The server no longer holds your {gone.scene ? "models" : "clash report"}</b> (it restarted, or made
                    room for other visitors).{gone.scene ? " The fixes you kept went with them." : ""}</span>
                  <button className="btn small primary" onClick={() => void reopenGone()}><RotateCcw size={13} aria-hidden /> {reopenLabel}</button>
                </div>
              )}
              {compact && !onPage && errorShown && <div className="overlay error" role="alert" onClick={() => setError(null)}>{errorShown}<X size={14} aria-hidden /></div>}
              {toast ? <div className="toast" role="status">{toast}</div> : kept && <KeptToast key={kept.n} text={kept.text} detail={kept.detail} />}
            </main>)}

            {docked ? <div className="dock-area"><DockHost slots={slots} sizes={widths} tabs={dockTabs} onReady={(d) => { dock.current = d; }}
              onGone={(d) => { if (dock.current === d) dock.current = null; }} onShown={setTabState} onTab={showPanel}
              onWindows={setPopouts} /></div> : <>
              <SlotHost slot={slots.clashes} />
              <SlotHost slot={slots.model} />
              <aside className={`pane right ${tab === "chat" ? "chatting" : ""}`}>
                <div className="tabs" role="tablist">
                  <button role="tab" aria-selected={tab === "clash"} className={tab === "clash" ? "on" : ""} onClick={showClashTab}>
                    <LocateFixed size={14} aria-hidden /> Clash{clashBadge}</button>
                  <button role="tab" data-tour="tab-plan" aria-selected={tab === "plan"} className={tab === "plan" ? "on" : ""} onClick={showPlanTab}>
                    <Network size={14} aria-hidden /> Plan{planBadge}</button>
                  <button role="tab" data-tour="tab-chat" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={showChatTab}>
                    <MessageSquare size={14} aria-hidden /> Chat</button>
                </div>
                <SlotHost slot={slots.chat} />
                <SlotHost slot={slots.plan} />
                <SlotHost slot={slots.clash} />
              </aside>
              {(["left", "right"] as const).map((side) => (
                <div key={side} className={`resizer ${side} ${resizing === side ? "on" : ""}`} role="separator" aria-orientation="vertical"
                  aria-label={`Resize the ${side} panel`} aria-valuenow={widths[side]} aria-valuemin={PANE[side][0]} aria-valuemax={PANE[side][1]}
                  tabIndex={0} title="Drag to resize · double-click to reset"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    setResizing(side);
                  }}
                  onPointerMove={(e) => {
                    if (resizing !== side) return;
                    // From the workspace's own edges: the sidebar sits to its left.
                  const box = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
                  const w = side === "left" ? e.clientX - box.left : box.right - e.clientX;
                    setWidths((ws) => ({ ...ws, [side]: clampPane(side, w, ws[side === "left" ? "right" : "left"]) }));
                  }}
                  onPointerUp={() => { setResizing(null); remember(side, widths[side]); }}
                  onDoubleClick={() => { setWidths((ws) => ({ ...ws, [side]: PANE[side][2] })); remember(side, PANE[side][2]); }}
                  onKeyDown={(e) => {
                    const step = e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0;
                    if (!step) return;
                    e.preventDefault();
                    const w = clampPane(side, widths[side] + (side === "left" ? step : -step), widths[side === "left" ? "right" : "left"]);
                    setWidths((ws) => ({ ...ws, [side]: w })); remember(side, w);
                  }} />
              ))}
              {!compact && <SlotHost slot={slots.activity} />}
            </>}
            {inSlot(slots.chat, <div className="chat-slot" hidden={!docked && tab !== "chat"}>
                {context && <button className="context-chat-link btn" onClick={() => { clearManual(); setTab("plan"); setPlanKind("context"); setViewContext(true); setViewPlan(false); }}>
                  <Network size={14} aria-hidden /> {contextWorking ? "Wider fix: inspecting and checking…" : context.accepted ? "Wider fix accepted" : `Review wider fix · ${context.result?.proposals.length ?? 0} alternatives`}</button>}
                <ChatPanel key={`${sceneId}:${chatReport}`} voiceModel={labels.voice} owner={chatOwner.current} ready={!!(sceneId || report) && !busy}
                  onEvent={(e) => { if (sceneEpoch.current === renderedSceneEpoch && workspaceEpoch.current === renderedWorkspaceEpoch) onChatEvent(e); }} ask={chatAsk}
                  context={() => ({ scene_id: sceneId, report_id: report?.id ?? null, clash_id: clash?.id ?? null, fixed: resolved, filters: sharedFilters, filter_view: filterView, check: viewCheck,
                    selected: editPick.current ?? (selected ? { element: selected.globalId, face: null } : null) })} />
              </div>)}
            {inSlot(slots.plan, <div className="plan-slot" hidden={!docked && tab !== "plan"}>
              {(docked || tab === "plan") && <>
                {context && (plan || planRun) && <div className="seg plan-switch" role="group" aria-label="Plan type">
                  <button className={planKind === "context" ? "on" : ""} onClick={() => { clearManual(); setPlanKind("context"); setViewContext(true); setViewPlan(false); }}>Wider fix</button>
                  <button className={planKind === "batch" ? "on" : ""} onClick={() => { clearManual(); setPlanKind("batch"); setViewContext(false); setViewPlan(true); }}>Clash plan</button>
                </div>}
                {planKind === "context" && context ? <ContextPlan exportLabel={stepFiles.length ? "Export STEP + IFC" : "Export IFC"} run={context} names={contextNames} chosen={contextChosen} acknowledged={acknowledged} busy={!!busy} now={now}
                  onChoose={(id) => { clearManual(); setContextChosen(id); setAcknowledged([]); setViewContext(true); setViewPlan(false); }}
                  onAcknowledge={(id, checked) => setAcknowledged((ids) => checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id))}
                  onAccept={acceptContext} onRegenerate={() => { if (context.objective) void exploreContext(context.objective); }}
                  onDiscard={() => { directContext.current?.retire(); ++contextRequest.current; clearManual(); setContext(null); setContextChosen(null); setAcknowledged([]); setViewContext(false); setPlanKind("batch"); }} /> :
                <PlanPanel run={planRun} plan={plan} now={now} busy={!!busy} onAccept={acceptPlan} error={planError}
                  onEscalate={canEscalate ? escalateItem : undefined} wonder={wonder} stale={planStale}
                  built={(it) => it.option ? builtRuns[builtKey([it.element_a, it.element_b], it.option)] : undefined}
                  onBuild={builtOn ? (it) => { if (it.option && canBuild(it.option)) void drawBuilt(builtKey([it.element_a, it.element_b], it.option),
                    builtPasses(builtFix(it.option, false), [it.element_a, it.element_b]), it.option.kind); } : undefined}
                  onDiscard={() => { setPlan(null); setPlanRun(null); }} onFocus={focusItem}
                  onAsDesigned={(ids, note) => { review(ids, "by_design", note); setPlan(null); setPlanRun(null); setViewPlan(false); setTab("clash"); }} />}
              </>}
            </div>)}
            {inSlot(slots.clash, <div className="tab-body" hidden={!docked && tab !== "clash"}>
                {clash && report
                  ? (<><ClashHeader clash={shownClash ?? clash} triage={shownTriage[clash.id]} status={statusOf(clash, { fixes, reviewed, resolvedIds })}
                    onFocus={() => goToClash(clash, matches?.[clash.id], true)}
                    onPrev={listPrev ? () => selectClash(listPrev) : undefined} onNext={listNext ? () => selectClash(listNext) : undefined} />
                    {/* A fixed clash shows "Fixed ✓" in its panel (ClashPanel: what was kept, Undo, Propose a different fix) in
                        place of these actions, and the way on to the next open clash. */}
                    {!fixedHere && clashActions}
                    <ClashPanel reportId={report.id} clash={shownClash ?? clash} match={matches?.[clash.id]} measure={measure} onImage={(index) => setLightbox({ clash: shownClash ?? clash, index })} fix={fixes[clash.id]} triage={shownTriage[clash.id]}
                    origin={report.origin} capturing={capturing === clash.id} resolved={resolvedIds.has(clash.id)} busy={!!busy || proposing}
                    onUndo={undoableFix(journal, clash.id, [matches?.[clash.id]?.a, matches?.[clash.id]?.b]) ? () => void stepEdit("undo") : undefined}
                    onProposeAgain={a && b && sceneId && !(running && running.id !== clash.id) ? () => void propose() : undefined} />
                    {fixedHere && nextClash && <div className="actions fixed-next">
                      <button type="button" className="btn small" onClick={() => { setTab("clash"); selectClash(nextClash); }}>
                        Next clash <ArrowRight size={13} aria-hidden /></button></div>}
                    {evidence[clash.id]?.status === "recommended" && evidence[clash.id].kind === "penetration" &&
                      <div className="recommended">
                        <h3>Opening requested</h3>
                        <p><b>{evidence[clash.id].title}</b> · <span className="mono">{evidence[clash.id].edit}</span></p>
                        <p className="hint">The provision for void is in the model; the opening is not cut yet: {evidence[clash.id].blocked_by}.
                          This clash stays open until it is.</p>
                      </div>}
                    {builtOn && evidence[clash.id]?.status === "accepted" && builtFixes.current[clash.id] && (() => {
                      const f = builtFixes.current[clash.id], run = builtRuns[f.key];
                      return <div className="built-kept">
                        <h3>As it could look built</h3>
                        {run ? <BuiltView run={run} onRetry={() => redrawKept(clash.id)} reopen={builtReopen} />
                          : <button className="btn small" disabled={!!busy} onClick={() => redrawKept(clash.id)}
                            data-tip={`${labels.image} draws Iris's view of the kept fix as a presentation render, checked against the model. About a minute.`}>
                            <Building2 size={13} aria-hidden /> Show it built</button>}
                      </div>;
                    })()}
                    {(evidence[clash.id] || triage[clash.id]?.verdict === "real_clash" || (signoffs[clash.id]?.length ?? 0) > 0) &&
                      <ReviewBlock clash={clash} teams={modelTeams} signoffs={signoffs[clash.id] ?? []}
                        onAdd={(so) => addSignoff(clash.id, so)} onRemove={(i) => removeSignoff(clash.id, i)} />}
                    </>)
                  : (a || b) ? (<>
                    <dl className="kv pair">
                      <dt><i className="sw red" />A</dt><dd className="mono">{a ?? "—"}</dd>
                      <dt><i className="sw green" />B</dt><dd className="mono">{b ?? "—"}</dd>
                    </dl>
                    {clashActions}
                  </>) : <p className="hint">{coarse ? "Pick a clash from the list, or tap an element in the model and set it as A, then B."
                    : "Pick a clash from the list, or double-click two elements in the model."}</p>}
                {hideFix && clash && (
                  <div className="noclash-card" role="status">
                    <b><CircleCheck size={15} aria-hidden /> {notAClash!.title}</b>
                    <p>{notAClash!.why}</p>
                    {reviewed[clash.id]
                      ? <p className="hint">Marked {reviewed[clash.id].kind === "by_design" ? "as by design" : "for the model's author"}.</p>
                      : <button className="btn primary" onClick={() => review([clash.id], "by_design", notAClash!.why)}>
                        <CircleCheck size={15} aria-hidden /> Mark as not a clash</button>}
                    <button className="link" data-tour="fix-anyway" onClick={() => setFixAnyway(true)}>Propose a fix anyway</button>
                  </div>
                )}

                {(proposal?.understanding || proposing) && <>
                  <h2>Understanding</h2>
                  {(proposal?.understanding || !thoughts.length) &&
                    <p className="understanding">{proposal?.understanding || `${progress?.model ?? labels.proposal} is reading the clash…`}</p>}
                </>}
                <Thinking notes={thoughts} live={proposing} thinking={proposing && progress?.phase === "thinking"}
                  model={progress?.model ?? proposal?.model ?? labels.proposal} />
                {proposing && progress?.checking && <ProposalCard item={{ title: progress.checking.title, kind: progress.checking.kind, model: progress.model }}
                  state="ai_proposed" names={{}} />}
                {proposal && !proposing && <h2 ref={optionsHead}>Verified options</h2>}
                {proposal && !proposing && (proposal.options.length > 0 || proposal.recommendation) && (
                  <label className="field reviewer-field">Your name, recorded with each decision
                    <input value={reviewer} maxLength={120} placeholder="Reviewer (no sign-in: a name you type)" autoComplete="name"
                      onChange={(e) => setReviewer(e.target.value)} /></label>)}
                {proposal && !proposing && proposal.recommendation && <Recommended rec={proposal.recommendation} advice={proposal.advice} model={proposal.model || labels.proposal} requirements={proposal.requirements ?? null}
                  onRequirements={() => setReqOpen(true)}
                  card={<ProposalCard item={proposal.recommendation} state="unverified" names={namesFor([proposal.recommendation.element])} busy={!!busy}
                    onReject={(why) => void recordDecision(proposal.recommendation!, "rejected", why)} onAnother={() => requestAnother(proposal.recommendation!)}
                    decided={lastDecision(clashRefFor(clash?.id)?.key, proposal.recommendation.title, "rejected")} />} />}
                {proposal && !proposing && !proposal.options.length && !proposal.recommendation && <NoFix proposal={proposal} onRetry={propose}
                  onEscalate={canEscalate && !proposal.escalated ? () => void escalate() : undefined} wonder={wonder}
                  onFlag={clash ? () => review([clash.id], "author", "No verified fix: needs the model's author") : undefined} />}
                {clash && proposal && !proposing && proposal.options.length > 0 && proposal.options.every((o) => o.cleanup) && (
                  <div className="cleanup-note">
                    <b>Model cleanup, not a coordination clash</b>
                    <p>Both elements are in the same model, and they overlap where one frames into the other. That is often how
                      they are built (a beam cast into its footing, a transom into its mullion). Tidy the joint if the model goes
                      to fabrication or quantities; otherwise mark it as not a clash.</p>
                    {proposal.advice && <p className="why">{proposal.model || labels.proposal}: {proposal.advice}</p>}
                    {reviewed[clash.id]
                      ? <span className="chip ok"><CircleCheck size={12} aria-hidden /> marked {reviewed[clash.id].kind === "by_design" ? "by design" : "for the author"}</span>
                      : <button className="btn small" onClick={() => review([clash.id], "by_design", "A joint inside one model: built as modelled")}>
                        <CircleCheck size={13} aria-hidden /> Mark as not a clash</button>}
                  </div>)}
                {proposal?.options.map((o, i) => {
                  const rej = rejected[optionKey(o)];
                  const key = clashRefFor(clash?.id)?.key;
                  const chips = <span className="chips">
                    {o.cleanup && <span className="chip" title="Tidies a joint inside one model; optional">model cleanup</span>}
                    {o.review && <span className="chip warn" data-tip={reviewText(o.review)}>{o.review} review</span>}
                    {proposal!.escalated && <span className={`chip model ${o.model === wonder ? "wonder" : ""}`}
                      data-tip={o.model === wonder ? `Found on the second try, by ${wonder}` : "Found on the first try"}>{o.model || labels.proposal}</span>}
                  </span>;
                  if (rej) {   // set aside: who decided, when and why; Undo puts it back with the others (the record stays)
                    const d = lastDecision(key, o.title, "rejected");
                    const w = d ? decisionWords(d) : null;
                    return (
                      <div key={i} className="card rejected" data-option={i}>
                        <span className="opt-head">
                          <span className="opt-rank">{i + 1}</span><span className="opt-kind">{kindLabel(o.kind)} · rejected</span>
                          <button type="button" className="btn small ghost undo" onClick={() => unreject(o)} data-tip="Put it back with the other options">
                            <RotateCcw size={13} aria-hidden /> Undo</button></span>
                        <b className="opt-title">{o.title}</b>
                        <span className="hint">{w ? `${w.verb} by ${w.who} · ${w.when}` : "Rejected"}{rej.why ? ` · Why: ${rej.why}` : ""}</span>
                      </div>);
                  }
                  return (
                    <div key={i} className={`card pcard-slot ${chosen === i ? "pick" : ""}`} data-option={i}>
                      <span className="opt-head">
                        <span className="opt-rank">{i + 1}</span>{chips}
                        <button type="button" className={`btn small ghost pcard-show ${chosen === i ? "on" : ""}`} aria-pressed={chosen === i}
                          onClick={() => { clearManual(); setChosen(chosen === i ? null : i); }}
                          data-tip={chosen === i ? "Shown in the model: click to hide it" : "Show this fix in the model"}>{chosen === i ? "Shown in 3D" : "Show in 3D"}</button>
                      </span>
                      <ProposalCard item={o} state={stateOf(o)} names={namesFor([...o.moved])}
                        requiredClearanceMm={Math.round((proposal!.clearance_m ?? 0.025) * 1000)} busy={!!busy}
                        acceptTour={chosen === i ? "accept" : undefined} onAccept={() => accept(o)} onReject={(why) => rejectOption(o, i, why)}
                        onModify={sceneId && clash ? () => modifyOption(o) : undefined} onAnother={() => requestAnother(o)}
                        onShowBeforeAfter={() => { clearManual(); setChosen(i); setCompare("both"); }} />
                      <ProofStrip o={o} rank={i} options={proposal!.options} before={measure && measure !== "busy" ? measure.distance_m : null} need={proposal!.clearance_m} />
                      {chosen === i && canBuild(o) && a && b && (() => {
                        const run = builtRuns[builtKey([a, b], o)];
                        return run ? <BuiltView run={run} onRetry={() => showBuilt(o)} reopen={builtReopen} />
                          : <button className="btn small" data-tour="show-built" disabled={!!busy} onClick={() => showBuilt(o)}
                            data-tip={`${labels.image} draws Iris's view of this fix as a presentation render, checked against the model before you see it. About a minute.`}>
                            <Building2 size={13} aria-hidden /> Show it built</button>;
                      })()}
                      {chosen === i && o.kind === "penetration" && o.edit && isAiReading(o.edit.reading_source) && sceneId && (
                        hasPenetration(reqSaved?.enabled ? reqSaved.doc : null, o.edit.host_group, o.edit.host_kind)
                          ? <span className="chip ok"><Check size={11} aria-hidden /> in the requirements</span>
                          : <button className="btn small" onClick={() => void addPenRule(o)}
                            data-tip="Make this reading a rule for the host's group in the coordination requirements"><ClipboardPlus size={13} aria-hidden /> Add to requirements</button>)}
                    </div>);
                })}
                {proposal && !proposing && proposal.attempts.some((t) => !t.passed) && (
                  <details className="tried">
                    <summary>What was tried · {proposal.attempts.filter((t) => !t.passed).length} refused by the geometry check</summary>
                    {proposal.attempts.filter((t) => !t.passed).map((t, k) => (
                      <ProposalCard key={k} item={t} state={stateOf(t)} names={namesFor(t.hit_ids ?? [])} />))}
                  </details>)}
                {proposal && !proposing && !hideFix && proposal.options.some((o) => rejected[optionKey(o)]) && (() => {
                  const all = proposal.options.every((o) => rejected[optionKey(o)]);
                  return <div className={`rejected-note${all ? " all" : ""}`}>
                    <span>{all ? "You rejected every option." : `${proposal.options.filter((o) => rejected[optionKey(o)]).length} rejected.`}
                      {" "}A new proposal tells {proposal.model || labels.proposal} what you rejected and why, so it looks for something else.</span>
                    <button type="button" className="btn small" disabled={!!busy} onClick={() => void propose()}><RotateCcw size={13} aria-hidden /> Propose again</button>
                  </div>;
                })()}

                {proposal && !proposing && proposal.options.length > 0 && canEscalate && !proposal.escalated && !hideFix && (
                  <button className="better-fix" data-tour="better-fix" disabled={!!busy} onClick={() => void escalate()}
                    data-tip="It starts from everything this try learned: each idea, why it failed and what it hit.">
                    <span className="bf-icon" aria-hidden><Sparkles size={15} /></span>
                    <span className="bf-text"><b>Look for a better fix</b>
                      <span>{wonder} takes a second, longer look · about a minute · these options stay</span></span>
                    <ChevronRight size={16} className="bf-go" aria-hidden /></button>)}
                {proposal?.escalated && !proposing && proposal.usage && ownerSettings && (
                  <p className="hint mono">{wonder}: {proposal.usage.calls} call{proposal.usage.calls === 1 ? "" : "s"},
                    {" "}{Math.round(proposal.usage.input_tokens / 1000)}k in, {Math.round(proposal.usage.output_tokens / 1000)}k out
                    {" "}({Math.round(proposal.usage.reasoning_tokens / 1000)}k reasoning) · ${proposal.usage.usd.toFixed(2)}</p>)}
                {compact && (proposing || (proposal?.attempts.length ?? 0) > 0) && <details className="activity-fold">
                  <summary>Agent activity · {proposal?.attempts.length ?? 0} checked</summary>
                  <Activity attempts={proposal?.attempts ?? []} progress={progress} now={now} />
                </details>}
                {!hideFix && <details className="try">
                  <summary><Move size={14} aria-hidden /> Try a move yourself</summary>
                  <label className="field">Move A vertically (m)
                    <input id="manual-dz" type="number" step="0.05" value={manualDz} onChange={(e) => setManualDz(Number(e.target.value))} />
                  </label>
                  <button className="btn" disabled={!a || !sceneId || !!busy} onClick={checkManual}>Check this move</button>
                  {manual && <p className={manual.passed ? "ok" : "bad"}>{manual.passed ? `Clear · nearest ${mm(manual.min_clearance_m)}` : manual.reason ? (manual.joints?.refused_at ? `Not tried: ${manual.reason}` : manual.reason) : manual.hits.map((h) => `${h.kind} with ${h.other_class} ${mm(h.distance_m)}`).join("; ")}</p>}
                </details>}
                {checked.size === 0 && report && matches && !proposal && !hideFix && (
                  <p className="hint tipline"><Wand2 size={13} aria-hidden /> Tick several clashes in the list to fix them together.</p>
                )}
              </div>)}
            {docked && inSlot(slots.filters, <div className="filters-slot">
              <FiltersPanel index={prepared} loading={!!sceneId && !facetIndex && !facetsError} error={facetIndex ? null : facetsError} onRetry={() => setFacetsTry((n) => n + 1)} state={filterState} onState={setFilterState}
                draft={filterDraft} onDraft={setFilterDraft} onZoom={(ids) => { const v = viewer.current; v?.frameEverywhere(ids.filter((g) => v.isShown(g))); }} check={filterCheck}
                drawingsWhole={drawingsShow === "whole"} onDrawingsWhole={shownLayout === "single" ? undefined : (whole) => setDrawingsShow(whole ? "whole" : "filtered")} />
            </div>)}
            {docked && inSlot(slots.edits, <EditPanel journal={journal} busy={!!busy} csvUrl={sceneId ? api.journalCsvUrl(sceneId) : null}
              clashLabel={clashTag} onUndo={() => void stepEdit("undo")} onRedo={() => void stepEdit("redo")} onUndoTo={(e) => void undoTo(e)}
              onShow={(e) => { const v = viewer.current; v?.frameEverywhere([...e.elements, ...e.created].filter((g) => v.isShown(g))); }} />)}
            {docked && inSlot(slots.properties, <div className="props in-panel">
              {selected ? elementCard(false, false) : <p className="hint">Click any element in the model to see its properties.</p>}
            </div>)}
            {!compact && inSlot(slots.activity, <footer className={`dock${workings.on && workings.view === "work" ? " working" : ""}`}>
              <Activity attempts={proposal?.attempts ?? []} progress={progress} now={now} workings={workings.on} view={workings.view}
                onView={setActivityView} onHide={() => setWorkingsOn(false)} onTurnOn={workings.on ? undefined : () => setWorkingsOn(true)}
                inView={pilotStatus?.step ?? null} onPeek={peekTrial} />
            </footer>)}
            {layout === "tablet" && listOpen && !landing && <div className="drawer-scrim" aria-hidden onClick={() => setListOpen(false)} />}
            {layout === "phone" && !landing && !starting && (
              <SheetBar snap={snap} onSnap={setSnap}>
                <div className={`sheet-peek ${peekLine.live ? "live" : ""} ${peekLine.action || peekLine.live ? "" : "quiet"}`} role="status">
                  <button type="button" className="sheet-peek-text" onClick={raise}>
                    {peekLine.live && <i className="spinner" aria-hidden />}<span>{peekLine.text}</span></button>
                  {peekLine.action && <button type="button" className="btn primary" data-tour={peekLine.action.tour}
                    disabled={peekLine.action.disabled} onClick={peekLine.action.run}>{peekLine.action.label}</button>}
                </div>
                <div className="sheet-tabs" role="tablist" aria-label="Panels">
                  <button role="tab" aria-selected={listOpen} className={listOpen ? "on" : ""} data-tour="sheet-list"
                    onClick={() => { setListOpen(true); raise(); }}>
                    <List size={17} aria-hidden /><span>Clashes</span>{report ? <span className="badge-n">{report.clashes.length}</span> : null}</button>
                  <button role="tab" aria-selected={!listOpen && tab === "clash"} className={!listOpen && tab === "clash" ? "on" : ""} data-tour="sheet-fix"
                    onClick={() => { showClashTab(); raise(); }}>
                    <LocateFixed size={17} aria-hidden /><span>Fix</span>{clashBadge}</button>
                  <button role="tab" aria-selected={!listOpen && tab === "plan"} className={!listOpen && tab === "plan" ? "on" : ""} data-tour="tab-plan"
                    onClick={() => { showPlanTab(); raise(); }}>
                    <Network size={17} aria-hidden /><span>Plan</span>{planBadge}</button>
                  <button role="tab" aria-selected={!listOpen && tab === "chat"} className={!listOpen && tab === "chat" ? "on" : ""} data-tour="tab-chat"
                    onClick={() => { showChatTab(); raise(); }}>
                    <MessageSquare size={17} aria-hidden /><span>Chat</span></button>
                </div>
              </SheetBar>
            )}
            {/* Settings (the sidebar's): what the old menu held, in the order of the work: models, coordinate, this
                session's outputs and requirements, the agent, the panels (docs/architecture/12-web-app.md, "The app shell"). */}
            {menuOpen && <MenuSheet title="Settings" onClose={() => setMenuOpen(false)}>
        <section className="menu-section"><h3>Your name for review decisions</h3>
          <label className="field reviewer-field">Recorded with each accept, reject or request, and in the reports
            <input value={reviewer} maxLength={120} placeholder="Your name (no sign-in)" autoComplete="name"
              onChange={(e) => setReviewer(e.target.value)} /></label>
        </section>
              <section className="menu-section"><h3><Boxes size={15} aria-hidden /> Models{stats && <span className="mono why"
                title={`${modelNames.join(", ")}: ${stats.elements} elements, ${Math.round(stats.triangles / 1000)}k triangles, parsed in ${(stats.parseMs / 1000).toFixed(1)} s`}>
                {stats.elements.toLocaleString()} elements</span>}</h3>{modelsMenu(() => setMenuOpen(false))}</section>
              <section className="menu-section"><h3><Radar size={15} aria-hidden /> Coordinate</h3>{coordinateMenu(() => setMenuOpen(false))}</section>
              {!landing && <section className="menu-section"><h3>This session</h3>
                {sceneId && <button className="pop-item" data-tour="requirements" onClick={() => { setMenuOpen(false); setReqOpen(true); }}>
                  <ClipboardCheck size={16} aria-hidden /> Requirements{reqLabel ? <span className="chip accent">{reqLabel}</span> : <span className="why">optional</span>}</button>}
                {report && <button className="pop-item" data-tour="report" onClick={() => { setMenuOpen(false); setDocOpen(true); setDocReady(false); }}>
                  <FileText size={16} aria-hidden /> Report: PDF and BCF</button>}
                {sceneId && !gone?.scene && <a className="pop-item" data-tour="export" href={api.exportUrl(sceneId)} onClick={() => setMenuOpen(false)}>
                  <Download size={16} aria-hidden /> {stepFiles.length ? "Export STEP + IFC" : "Export IFC"}</a>}
                <button className="pop-item" onClick={() => { setMenuOpen(false); setAgentOpen(true); }}>
                  {agentLink ? <><Bot size={16} aria-hidden /> Agent connected · {timeLeft(agentLink, now)} left</> : <><Plug size={16} aria-hidden /> Connect an agent</>}</button>
              </section>}
              {!compact && !landing && <section className="menu-section"><h3><LayoutPanelLeft size={15} aria-hidden /> Panels and layout</h3>{layoutMenu(() => setMenuOpen(false))}</section>}
            </MenuSheet>}
            {helpOpen && <MenuSheet title="Help" onClose={() => setHelpOpen(false)}>
              <section className="menu-section"><h3>How Iris works</h3>
                <p className="hint">AI proposes. Geometry proves. The engineer decides.</p>
                <ol className="help-flow">{PROJECT_FLOW.map((f, i) => (
                  <li key={f.name}><span className="help-n mono">{i + 1}</span><span><b>{f.name}</b> <span className="why">{f.text}</span></span></li>))}</ol>
              </section>
              {(sampleSet.length > 0 || sampleDrawings) && <section className="menu-section"><h3>Try it</h3>
                {sampleSet.length > 0 && <button className="pop-item" disabled={!!busy || !!projectBusy} onClick={() => { setHelpOpen(false); void trySample(); }}>
                  <Building2 size={16} aria-hidden /> Try the sample building</button>}
                {sampleDrawings && <button className="pop-item" disabled={!!busy || !!projectBusy} onClick={() => { setHelpOpen(false); void trySampleDrawings(); }}>
                  <FileText size={16} aria-hidden /> Try the sample drawings</button>}
              </section>}
              <section className="menu-section"><h3>Good to know</h3>
                <p className="hint">Projects are private to this browser by an unguessable id; there are no accounts yet. The name under the
                  sidebar is recorded with each decision you make.</p>
                <p className="hint">Press <kbd>/</kbd> to search, <kbd>Esc</kbd> to leave a clash.</p>
              </section>
            </MenuSheet>}

            {(coverLoading || dockCover) && (
              <div className={`load-cover ${dockCover === "out" ? "out" : ""}`}>
                {coverCard && <LoadCard load={coverCard} now={now} onCancel={coverLoading ? cancelOpen : undefined} />}
              </div>)}
            <Tooltips />
            {popouts.map((w, i) => <Tooltips key={i} doc={w.document} />)}
            {homePage}
            {projectPage}
            {removing && (
              <div className="about-dialog" role="dialog" aria-modal="true" aria-label="Remove a model" onClick={() => setRemoving(null)}>
                <div className="report-dialog remove-dialog" onClick={(e) => e.stopPropagation()}>
                  <div className="row"><h2><Trash2 size={18} aria-hidden /> Remove a model</h2>
                    <button className="ibtn" aria-label="Close" onClick={() => setRemoving(null)}><X size={16} aria-hidden /></button></div>
                  <p>{removing.text}</p>
                  <p className="hint">Edits in the other models stay, fixes made for its clashes too. Nothing is checked again.</p>
                  <div className="actions">
                    {removing.edits > 0 && sceneId && <a className="btn" href={api.exportUrl(sceneId)}><Download size={15} aria-hidden /> Export first</a>}
                    <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
                    <button className="btn primary" data-remove-model onClick={() => void removeModel()}><Trash2 size={15} aria-hidden /> Remove</button>
                  </div>
                </div>
              </div>)}
            {agentOpen && <AgentDialog link={agentLink} log={agentLog} now={now} creating={agentBusy} error={agentError}
              canCreate={!!sceneId} onCreate={() => void connectAgent()} onRevoke={() => void disconnectAgent()} onClose={() => setAgentOpen(false)} />}
            {touring && <Tour key={tourWhich} which={tourWhich} state={tourState} actions={tourActions} onClose={() => setTouring(false)} />}
            {reqOpen && <RequirementsDialog sceneId={sceneId} initial={reqSaved?.doc ?? null} enabled={!!reqSaved?.enabled}
              audit={triageAudit} canDetectAgain={!!sceneId} onApply={applyRequirements} onClose={() => setReqOpen(false)} />}
            {docOpen && report && <ReportDialog report={report} sceneId={sceneId} triage={shownTriage} triageDone={!!triageRun?.done}
              check={report.origin === "iris" ? checks.find((c) => c.key === viewCheck) ?? null : null}
              prepare={builtOn ? prepareReport : undefined}
              teams={modelTeams} onTeams={setModelTeams} evidence={evidence} signoffs={signoffs} reviewed={reviewed}
              triageRunning={!!triageRun && !triageRun.done} onRunTriage={() => runTriage(false)} onClose={() => setDocOpen(false)} onReady={() => setDocReady(true)}
              projectId={projectOpen ? pid : null} projectName={projectHere?.name ?? null}
              onBuilt={projectOpen && projectHere ? (doc) => {
                const id = projectHere.id;
                addReport(id, { doc_id: doc.url, name: doc.name, kind: /\.pdf$/i.test(doc.name) || !doc.bcf ? "pdf" : "bcf" })
                  .then((next) => setProject((was) => (was?.id === next.id ? next : was)))
                  .catch((e: unknown) => setError(`The report was built, but not kept with the project: ${(e as Error).message}`));
              } : undefined} />}
            {lightbox && report && lightbox.clash.images[lightbox.index] &&
              <Lightbox reportId={report.id} clash={lightbox.clash} index={lightbox.index} onClose={() => setLightbox(null)}
                onMove={(index) => setLightbox((l) => l && { ...l, index })} />}
            {/* The review queue (docs/review-queue.md): two panes over the workspace, the 3D view moved into its right one. */}
            {reviewOpen && sceneId && report && <ReviewQueue sceneId={sceneId} reportId={report.id} reportTitle={report.title} clashes={report.clashes}
              viewer={viewer.current} reviewer={reviewer} onReviewer={setReviewer} onDecisions={(d) => noteDecisions(d, true)}
              onClose={() => setReviewOpen(false)}
              onKept={async (kept, { option: o, pair }) => {
                // As accept() after its keep: the queue made the keep request (the server tried the fix again first).
                const sid = sceneId, epoch = sceneEpoch.current;
                const live = () => sceneEpoch.current === epoch;
                const groups = kept.groups ?? (kept.pieces?.length ? [kept.pieces] : []);
                if (kept.decisions?.length) noteDecisions(kept.decisions);
                staleContext();
                viewer.current?.preview([]);
                await applyToViewer(sid, kept, groups, live);
                if (!live()) return;
                setEdits((e) => {
                  const next = { ...e };
                  for (const ps of groups) if (ps.length) { const [first, ...added] = ps; next[first] = [...(next[first] ?? []), ...added]; }
                  return next;
                });
                if (kept.cut !== false) markFixed([[pair[0] ?? null, pair[1] ?? null]], [o.title]);
                if (a && b && samePair(a, b, pair[0] ?? "", pair[1] ?? "")) resetWork();
                setRemeasure((n) => n + 1);
              }} />}
          </div>
        </div>
      </div>
      {newOpen && <NewProjectDialog onCreate={(n) => void newProject(n)} onClose={() => { setNewOpen(false); setCreateError(null); }}
        busy={creating} error={createError ?? undefined} />}
    </div>
  );
}

/** Each moved element with every clash element that stays put: where they meet is what a move changes. */
function movedPairs(moved: string[], sides: string[]): [string, string][] {
  const still = sides.filter((g) => !moved.includes(g));
  return moved.flatMap((m) => still.map((g) => [m, g] as [string, string]));
}

/** All context previews are evaluator world meshes, including moves; originals are hidden once. */
function contextShapes(p: ContextProposal) {
  return p.edits.map((edit) => ({ kind: edit.kind, moved: edit.moved, deltaM: [0, 0, 0],
    pieces: edit.preview, before: edit.before, worldMeshes: true, color: "#1f9d3a" }));
}

function samePair(a: string | null | undefined, b: string | null | undefined, x: string, y: string) {
  return (a === x && b === y) || (a === y && b === x);
}

/** Existing report/BCF fields carry the complete coordinated change; checks come from the server commit. */
function contextEvidence(p: ContextProposal, checks: ContextProposal["checks"], pics: { before_img?: string; after_img?: string }): Evidence {
  const g = checks.geometry, integrity = checks.integrity;
  const edit = p.edits.map((e, i) => `${i + 1}. ${e.label} (${e.element}; sources ${e.moved.join(", ")}): ${e.kind} ${e.kind === "trim"
    ? `${e.end} end by ${e.by_m} m` : `delta [${e.delta_m?.join(", ")}] m${e.split_m ? `; split [${e.split_m.join(", ")}] m` : ""}`}`).join("\n");
  const rationale = [...p.edits.map((e, i) => `${i + 1}. ${e.reason}`),
    `Fresh geometry checks ${g.passed ? "passed" : "failed"}; original objective ${g.target_resolved ? "resolved" : "unresolved"}.`,
    `Fresh model integrity checks ${integrity.passed ? "passed" : "failed"}.`, ...integrity.errors, ...integrity.warnings,
    ...g.existing_conflicts.map((h) => `Unchanged baseline ${h.kind}: ${h.element} / ${h.other}, ${h.distance_m} m.`),
    ...g.hits.map((h) => `${h.kind}: ${h.element} / ${h.other}, ${h.distance_m} m.`)].join("\n");
  return { status: "accepted", title: p.title, kind: "context", edit, rationale,
    moved: [...new Set(p.edits.flatMap((e) => e.moved))],
    clearance: g.min_clearance_m == null ? "No measured nearest clearance returned" : mm(g.min_clearance_m),
    clearance_m: g.min_clearance_m, also_needs: p.review_conditions.map((c) => c.message).join("\n"), ...pics };
}

/** Within the side's limits, leaving the viewer at least 360 px beside the other panel (`other`). */
const clampPane = (side: "left" | "right", w: number, other = 0) =>
  Math.round(Math.max(Math.min(w, PANE[side][1], window.innerWidth - other - 360), PANE[side][0]));

function stored(key: string, fallback: number) {
  try { const v = Number(localStorage.getItem(key)); return v > 0 ? clampPane(key.includes("left") ? "left" : "right", v) : fallback; } catch { return fallback; }
}

function remember(side: "left" | "right", w: number) {
  try { localStorage.setItem(`iris.${side}-w`, String(w)); } catch { /* private window: not remembered */ }
}


function ProofStrip({ o, rank, options, before, need = 0.025 }: { o: Option; rank: number; options: Option[]; before: number | null; need?: number }) {
  const change = options.map((x) => x.delta_m.reduce((s, v) => s + Math.abs(v), 0));
  const smallest = change[rank] === Math.min(...change);
  const comfy = o.min_clearance_m == null || o.min_clearance_m >= 2 * need;
  const why = rank === 0 ? (comfy && smallest ? "ranked first: comfortable clearance, smallest change" : comfy ? "ranked first: comfortable clearance" : smallest ? "ranked first: smallest change that clears" : "ranked first: best clearance of the verified fixes") : `option ${rank + 1} of ${options.length}`;
  return <span className="proof-strip"><span className="ok">✓ Clash gone</span>{before != null && <span>{before < 0 ? `was ${Math.round(-before * 1000)} mm overlap` : `was ${Math.round(before * 1000)} mm apart`}</span>}<span>{o.checked_against ? `checked vs ${o.checked_against} elements` : "checked vs the model"}</span><span className="why">{why}</span></span>;
}
/** The requirements allow no edit here: Gemini Pro's recommendation for the designer, never tried or applied. */
function Recommended({ rec, advice, requirements, onRequirements, model, card }: { rec: Recommendation; advice?: string; requirements: string | null; onRequirements: () => void; model: string;
  /** The recommendation as a proposal card (Unverified: never tried on the model), in place of its own lines. */
  card?: React.ReactNode }) {
  const change = recEditText(rec);
  return (
    <div className="recommended">
      <h3>Recommended for the designer</h3>
      {card ?? <>
        <p><b>{rec.title}</b>{change ? <> · <span className="mono">{change}</span></> : null}</p>
        {rec.rationale && <p>{rec.rationale}</p>}
        {rec.also_needs && <p><b>Also needs:</b> {rec.also_needs}</p>}
      </>}
      {advice && <p><b>What decides it:</b> {advice}</p>}
      {rec.others.length > 0 && <p className="hint">{model} also considered: {rec.others.join("; ")}</p>}
      <p className="hint">Not edited: {rec.blocked_by}{requirements ? ` (requirements ${requirements})` : ""}. Nothing was tried
        on the model. <button className="btn small ghost" onClick={onRequirements}>Requirements</button></p>
    </div>
  );
}

/** Scroll the panel `el` is in (its nearest scrolling box, never the page) to bring `el` near its top, unless it is
 *  near the top already. Works in a popped-out window: everything is read from the element's own window. */
function scrollInPane(el: HTMLElement) {
  const win = el.ownerDocument.defaultView ?? window;
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = win.getComputedStyle(box);
    if ((overflowY !== "auto" && overflowY !== "scroll") || box.scrollHeight <= box.clientHeight) continue;
    const at = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (at >= 0 && at < box.clientHeight * 0.4) return;
    box.scrollTo({ top: box.scrollTop + at - 8, behavior: win.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return;
  }
}

/** When nothing passed: what Iris learned, so the clash reaches a person with a head start, not a dead end. */
function NoFix({ proposal, onRetry, onFlag, onEscalate, wonder }: {
  proposal: Proposal; onRetry?: () => void; onFlag?: () => void; onEscalate?: () => void; wonder: string;
}) {
  const n = proposal.attempts.length;
  const second = proposal.escalated ? proposal.attempts.filter((t) => t.model === wonder).length : 0;
  const counts = new Map<string, number>();
  for (const t of proposal.attempts) {
    for (const cls of new Set([...t.reason.matchAll(/(?:collision|clearance) with (Ifc\w+)/g)].map((m) => m[1]))) {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
  const blockers = proposal.attempts.filter((t) => !t.passed).slice(0, 3);
  const kinds = new Set(proposal.attempts.map((t) => t.kind));
  const lesson = kinds.has("offset") && !kinds.has("trim") ? "Whole moves and offsets are blocked along this run. A local trim, a different element, or a design change is likely needed." : kinds.has("trim") ? "Even cutting back at the joint still hits something. This needs a person to decide which element gives way." : "Every direction tried hits something else. Try the other element, or a smaller move by hand below.";
  const next = proposal.advice ? "Follow the advice below, then propose again." : lesson;
  return (
    <div className="nofix">
      <h3>No edit passed the geometry check</h3>
      <p>
        Iris tried {n} idea{n === 1 ? "" : "s"} and left the model unchanged.
        {second > 0 && <> {wonder} took a second, longer look and tried {second} of them.</>}
        {top.length > 0 && <> What stood in the way: {top.map(([cls, k], i) => (
          <span key={cls}>{i ? ", and " : ""}<b>{cls.replace(/^Ifc/, "")}</b> elements in {k === n ? "every attempt" : `${k} of ${n}`}</span>))}.</>}
      </p>
      {proposal.advice && <p><b>What decides it:</b> {proposal.advice}</p>}
      {blockers.length > 0 && <ul className="nofix-blockers">{blockers.map((t, i) => <li key={i}><b>{t.title}</b> — {t.reason}</li>)}</ul>}
      <p><b>What this teaches:</b> {next}</p>
      {onEscalate && <div className="escalate-card">
        <button className="btn primary" data-tour="escalate" onClick={onEscalate}><Sparkles size={15} aria-hidden /> Ask for a deep think</button>
        <span className="hint">A larger model takes a second, longer look, with everything this try learned. It may move a
          neighbouring service too. About a minute.</span>
      </div>}
      <div className="row nofix-actions">{onRetry && <button className="btn small" onClick={onRetry}>Propose again</button>}{onFlag && <button className="btn small" onClick={onFlag}>Flag for the model's author</button>}<span className="hint">Full detail in the activity table below.</span></div>
    </div>
  );
}


/** The model's reasoning (Gemini Pro, or Gemini Pro (deep think) on a second try), summarised as it thinks: live while it works,
 * then folded away. */
function Thinking({ notes, live, thinking, model }: { notes: { round: number; text: string }[]; live: boolean; thinking: boolean; model: string }) {
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [notes.length]);
  if (!notes.length && !live) return null;
  const list = (
    <ol className="thoughts">
      {notes.map((n, i) => (
        <li key={i} ref={i === notes.length - 1 ? end : undefined}>
          {(i === 0 || notes[i - 1].round !== n.round) && n.round > 1 && <span className="round">Round {n.round}, with what failed</span>}
          {n.text}
        </li>
      ))}
      {thinking && <li className="pending"><i className="dots" aria-hidden><span /><span /><span /></i></li>}
    </ol>
  );
  if (live) return (
    <div className="thinking live" aria-live="polite">
      <h3><Brain size={14} aria-hidden /> {thinking ? `${model} is thinking` : `${model}'s thinking so far`}</h3>{list}
    </div>
  );
  return (
    <details className="thinking">
      <summary><Brain size={14} aria-hidden /> How {model} reasoned <span className="hint">· {notes.length} note{notes.length === 1 ? "" : "s"}</span></summary>
      {list}
    </details>
  );
}

/** What an offset adds, from its piece count: square corners make 5 straights; bends add four fittings (7 or 9 pieces). */
/** The new root causes in the order already on screen (new ones after), with any that dropped out kept as done rows. */
function keepPlaces(prev: RootCause[] | null, next: RootCause[]): RootCause[] {
  if (!prev) return next;
  const now = new Map(next.map((r) => [r.hub.global_id, r]));
  const out = prev.map((r) => now.get(r.hub.global_id) ?? { ...r, done: true });
  const seen = new Set(prev.map((r) => r.hub.global_id));
  return [...out, ...next.filter((r) => !seen.has(r.hub.global_id))];
}

/** A decision's identity, to merge a reply's decisions into the log without doubles. */
function decisionId(d: Decision): string {
  return [d.clash_key, d.decision, d.at, d.option.title, d.option.kind].join("|");
}

/** The coordination overview's filter in words, for the list's chip. */
function coordFilterLabel(f: CoordinationFilter): string {
  return [f.cls && CLASS_INFO[f.cls].label, f.severity && `${SEVERITY_LABEL[f.severity]} severity (AI-assessed)`,
    f.status && STATUS_INFO[f.status].label].filter(Boolean).join(" · ") || "Every clash";
}

/** One decision as the project's activity says it: "#42: Rejected "Raise the duct" (Geometry-validated ✓), by Ana: too low". */
function decisionLine(d: Decision): string {
  const w = decisionWords({ ...d, at: toMs(d.at) });
  return `${d.number ? `#${d.number}: ` : ""}${w.verb} "${d.option.title}" (${STATE_LABEL[d.state] ?? d.state}), by ${w.who}${w.why ? `: ${w.why}` : ""}`;
}

/** The sample building's project name (the first screen's "Try the sample building" finds it again by this name). */
const SAMPLE_PROJECT = "Northbank sample building";
