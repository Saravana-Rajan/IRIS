import { ArrowUpRight, EllipsisVertical, FolderOpen, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode,
} from "react";
import { EmptyState } from "./Holo";
import { PageHeader } from "./PageHeader";
import { ownClick } from "./projectRoute";
import {
  fullTime, lastSaved, modelMix, plural, reviewTally, whenText, type Project,
} from "./projectsApi";
import "./projects.css";

/** The engineer's workflow, in order (docs/engineer-workflow.md): what each step does, in Iris as built. */
export const PROJECT_FLOW = [
  { name: "Import", text: "IFC and STEP models, one row per file, with retry." },
  { name: "Understand", text: "Models summarised by discipline and system." },
  { name: "Detect", text: "Hard, clearance and duplicate tests across every pair." },
  { name: "Investigate", text: "Each clash with its elements, level and distance." },
  { name: "Propose", text: "AI proposes fixes that edit real model elements." },
  { name: "Validate", text: "Geometry re-checks every proposal before you see it." },
  { name: "Review", text: "Accept, reject or ask for another, with a reason." },
  { name: "Report", text: "PDF and BCF with GlobalIds and the decision history." },
] as const;

const NAME_MAX = 120;
const untitled = (name: string) => name || "Untitled project";
const words = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");

/* ---------------------------------------------------------------------------------------------------------------- */
/* Status: what is known about a project, never more                                                                */

export type ProjectStatusKey = "none" | "unchecked" | "open" | "clear" | "resolved" | "review";
export interface ProjectStatus { key: ProjectStatusKey; label: string }

/**
 * A project's status pill, from what it holds: no models; the last known numbers (open clashes, none found, all
 * resolved or reviewed); else the review decisions recorded (in review); else not checked.
 */
export function projectStatus(p: Pick<Project, "files" | "counts" | "reviews">): ProjectStatus {
  const c = p.counts;
  if (c) {
    if (c.open > 0) return { key: "open", label: "Open issues" };
    if (!c.clashes) return { key: "clear", label: "All clear" };
    return { key: "resolved", label: "Resolved" };
  }
  if (!p.files.length) return { key: "none", label: "No models" };
  const t = reviewTally(p.reviews);
  if (t.open + t.by_design + t.author + t.resolved > 0) return { key: "review", label: "In review" };
  return { key: "unchecked", label: "Not checked" };
}

/** The list's tabs: each project is in All and in exactly one of the others. */
type Filter = "all" | "needs" | "clear" | "unchecked";
const FILTERS: { id: Filter; label: string; test(p: Project): boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "needs", label: "Needs review", test: (p) => !!p.counts && p.counts.open > 0 },
  { id: "clear", label: "Clear", test: (p) => !!p.counts && p.counts.open === 0 },
  { id: "unchecked", label: "Not checked", test: (p) => !p.counts },
];

/* ---------------------------------------------------------------------------------------------------------------- */

/**
 * Projects (`/projects`): the projects this browser knows, newest first, as one table (name, models, clashes, open,
 * status, last save and a row menu: open, rename, remove from this browser), with tabs that filter by status. None
 * yet: an empty state with New project and the sample building. Props only: App fetches, creates (its dialog,
 * `onNew`), renames, forgets and routes; the shell's top bar holds the page's primary action.
 */
export function ProjectsHome({ projects, loading, error, onNew, onOpen, onRename, onRemove, onDemo, hrefOf }: {
  projects: Project[];
  loading: boolean;
  error?: string;
  /** New project: App opens `NewProjectDialog`. */
  onNew(): void;
  onOpen(pid: string): void;
  /** Rename from the row menu; a promise keeps the field busy until it settles (a rejection shows its message). */
  onRename?(pid: string, name: string): void | Promise<unknown>;
  /** Forget it in this browser (`forgetProject`): the server keeps it, its address still opens it. */
  onRemove?(pid: string): void;
  onDemo?(): void;
  /** A project's address: its name and Open are then links (a new tab opens one), a plain click handled by `onOpen`. */
  hrefOf?: (pid: string) => string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const sorted = [...projects].sort((a, b) => b.updated - a.updated);
  const empty = !loading && !projects.length;
  const first = loading && !projects.length;

  const sub = first ? "Loading the projects in this browser…" : (
    <>{plural(projects.length, "project")} in this browser
      {loading && <span className="spinner proj-sub-spin" role="status" aria-label="Refreshing" />}</>
  );

  return (
    <div className="proj-page">
      <div className="proj-scroll">
        <div className="proj-body">
          <PageHeader title="Projects" sub={sub}
            actions={onDemo && !empty ? (
              <button type="button" className="btn" onClick={onDemo}><FolderOpen size={15} aria-hidden /> Open the sample building</button>
            ) : undefined} />

          {error && (
            <div className="proj-alert" role="alert"><TriangleAlert size={15} aria-hidden /> <span>{error}</span></div>
          )}

          {first && (
            <div className="proj-loading" aria-live="polite"><span className="spinner" aria-hidden /> Loading projects…</div>
          )}

          {sorted.length > 0 && <>
            <FilterTabs projects={sorted} filter={filter} onFilter={setFilter} />
            <ProjectTable projects={sorted.filter(FILTERS.find((f) => f.id === filter)!.test)} filter={filter}
              onOpen={onOpen} onRename={onRename} onRemove={onRemove} hrefOf={hrefOf} />
            <p className="proj-foot-note">Projects are kept by an unguessable id in this browser; there are no accounts yet.</p>
          </>}

          {empty && (
            <div className="proj-empty">
              <EmptyState title="Start your first project"
                line="A project keeps the models, the clash results, every review decision and the reports together, so the work can be closed and picked up again."
                action={<>
                  <button type="button" className="btn primary" onClick={onNew}><Plus size={15} aria-hidden /> New project</button>
                  {onDemo && <button type="button" className="btn" onClick={onDemo}>Try the sample building</button>}
                </>} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Segmented tabs with counts (a soft grey track, the active one a white pill). Left and right arrows move along. */
function FilterTabs({ projects, filter, onFilter }: { projects: Project[]; filter: Filter; onFilter(f: Filter): void }) {
  const tabs = useRef<Partial<Record<Filter, HTMLButtonElement | null>>>({});
  function key(e: KeyboardEvent<HTMLButtonElement>) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = FILTERS.findIndex((f) => f.id === filter);
    const next = FILTERS[(i + d + FILTERS.length) % FILTERS.length].id;
    onFilter(next);
    tabs.current[next]?.focus();
  }
  return (
    <div className="proj-tabs" role="tablist" aria-label="Filter projects by status">
      {FILTERS.map((f) => {
        const n = projects.filter(f.test).length;
        const on = f.id === filter;
        return (
          <button key={f.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            className={`proj-tab${on ? " on" : ""}`} ref={(el) => { tabs.current[f.id] = el; }}
            onClick={() => onFilter(f.id)} onKeyDown={key}>
            {f.label}<span className="proj-tab-n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

type RowMode = "idle" | "rename" | "remove";

function ProjectTable({ projects, filter, onOpen, onRename, onRemove, hrefOf }: {
  projects: Project[]; filter: Filter;
  onOpen(pid: string): void; onRename?(pid: string, name: string): void | Promise<unknown>; onRemove?(pid: string): void;
  hrefOf?: (pid: string) => string;
}) {
  // One row at a time is renamed or asks to be removed.
  const [active, setActive] = useState<{ pid: string; mode: RowMode } | null>(null);
  return (
    <div className="proj-tablewrap" role="tabpanel" aria-label={FILTERS.find((f) => f.id === filter)!.label}>
      <table className="proj-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Models</th>
            <th scope="col" className="num">Clashes</th>
            <th scope="col" className="num">Open</th>
            <th scope="col">Status</th>
            <th scope="col">Last saved</th>
            <th scope="col" className="proj-c-act"><span className="proj-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p, i) => (
            <ProjectRow key={p.id} p={p} mode={active?.pid === p.id ? active.mode : "idle"}
              onMode={(mode) => setActive(mode === "idle" ? null : { pid: p.id, mode })}
              menuUp={projects.length > 3 && i >= projects.length - 2}
              onOpen={onOpen} onRename={onRename} onRemove={onRemove} hrefOf={hrefOf} />
          ))}
          {!projects.length && (
            <tr className="proj-none-row"><td colSpan={7}>No projects here.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One project's row (and, while it asks, the row confirming its removal). `mode` is kept by the table: "rename"
 * puts an input in the name cell (Enter saves, Escape cancels), "remove" asks before forgetting it in this browser.
 */
export function ProjectRow({ p, mode = "idle", onMode = () => {}, menuUp = false, onOpen, onRename, onRemove, hrefOf }: {
  p: Project;
  mode?: RowMode;
  onMode?(mode: RowMode): void;
  /** Open the row menu upwards (the last rows of a long list). */
  menuUp?: boolean;
  onOpen(pid: string): void;
  onRename?(pid: string, name: string): void | Promise<unknown>;
  onRemove?(pid: string): void;
  hrefOf?: (pid: string) => string;
}) {
  const mix = modelMix(p.files);
  const saved = lastSaved(p);
  const status = projectStatus(p);
  const c = p.counts;
  const name = untitled(p.name);
  const href = hrefOf?.(p.id);
  const follow = (e: MouseEvent) => { if (!ownClick(e)) return; e.preventDefault(); onOpen(p.id); };
  const confirmId = useId();

  const items: MenuItem[] = [
    { key: "open", label: "Open", icon: <ArrowUpRight size={15} aria-hidden />, href, onSelect: () => onOpen(p.id) },
    ...(onRename ? [{ key: "rename", label: "Rename", icon: <Pencil size={15} aria-hidden />, onSelect: () => onMode("rename") }] : []),
    ...(onRemove ? [{ key: "remove", label: "Remove from this browser", icon: <Trash2 size={15} aria-hidden />, danger: true,
      onSelect: () => onMode("remove") }] : []),
  ];

  return (
    <>
      <tr className={`proj-row${mode !== "idle" ? ` ${mode}` : ""}`}>
        <td className="proj-c-name" data-label="Name">
          {mode === "rename" && onRename ? (
            <RenameField name={p.name} onSave={(n) => onRename(p.id, n)} onDone={() => onMode("idle")} />
          ) : <>
            {href ? <a className="proj-name" href={href} onClick={follow} title={name}>{name}</a>
              : <button type="button" className="proj-name" onClick={() => onOpen(p.id)} title={name}>{name}</button>}
            <span className="proj-sub" title={fullTime(p.updated)}>Updated {whenText(p.updated)}</span>
          </>}
        </td>
        <td data-label="Models">
          {p.files.length ? (
            <span className="proj-cell">
              <span className="proj-num mono">{p.files.length}</span>
              <span className="proj-kinds">{mix.map((k) => <span key={k.kind} className="proj-kind">{k.kind} {k.n}</span>)}</span>
            </span>
          ) : <span className="proj-none">—</span>}
        </td>
        <td data-label="Clashes" className="num">
          {c ? <span className="proj-num mono">{c.clashes}</span> : <span className="proj-none">—</span>}
        </td>
        <td data-label="Open" className="num">
          {c ? <span className={`proj-num mono proj-open${c.open > 0 ? " has" : ""}`}>{c.open}</span> : <span className="proj-none">—</span>}
        </td>
        <td data-label="Status"><span className={`pchip ${status.key}`}>{status.label}</span></td>
        <td data-label="Last saved">
          {saved ? (
            <span className="proj-saved" title={fullTime(saved.at)}>
              {whenText(saved.at)}{saved.edits > 0 && <span className="proj-sub"> · {plural(saved.edits, "edit")}</span>}
            </span>
          ) : <span className="proj-none">Not saved</span>}
        </td>
        <td className="proj-c-act">
          <RowMenu label={`Actions for ${name}`} items={items} up={menuUp} />
        </td>
      </tr>
      {mode === "remove" && onRemove && (
        <tr className="proj-confirm-row">
          <td colSpan={7}>
            <div className="proj-confirm" role="alertdialog" aria-labelledby={confirmId}>
              <p id={confirmId}><b>Remove “{name}” from this browser?</b> <span className="proj-sub">The project stays on the
                server and its address still opens it; it is only no longer listed here.</span></p>
              <div className="proj-confirm-actions">
                <button type="button" className="btn small" onClick={() => onMode("idle")}>Cancel</button>
                <button type="button" className="btn small danger proj-remove" autoFocus
                  onClick={() => { onMode("idle"); onRemove(p.id); }}>Remove</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The name, editable in place: Enter (or leaving the field) saves a changed name, Escape cancels. */
function RenameField({ name, onSave, onDone }: { name: string; onSave(name: string): void | Promise<unknown>; onDone(): void }) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const settled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  function close() { settled.current = true; onDone(); }
  function commit() {
    if (settled.current || busy) return;
    const n = draft.trim().slice(0, NAME_MAX);
    if (!n || n === name) { close(); return; }
    let out: void | Promise<unknown>;
    try { out = onSave(n); } catch (e) { setErr(words(e)); return; }
    if (out && typeof (out as Promise<unknown>).then === "function") {
      setBusy(true);
      setErr(null);
      (out as Promise<unknown>).then(close, (e: unknown) => { setBusy(false); setErr(words(e)); input.current?.focus(); });
    } else close();
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }
  return (
    <form className="proj-rename" onSubmit={(e: FormEvent) => { e.preventDefault(); commit(); }}>
      <label htmlFor={id} className="proj-sr">Project name</label>
      <input id={id} ref={input} className="proj-input" value={draft} maxLength={NAME_MAX} required disabled={busy}
        autoComplete="off" spellCheck={false} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={key} onBlur={commit} />
      {busy && <span className="spinner proj-sub-spin" aria-label="Saving" />}
      {err ? <span id={`${id}-e`} className="proj-field-error" role="alert">{err}</span>
        : <span className="proj-sub">Enter to save · Esc to cancel</span>}
    </form>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* The row menu (⋮): a button and a menu of links/buttons. Escape or a click outside closes it; arrows move.        */

interface MenuItem { key: string; label: string; icon?: ReactNode; href?: string; danger?: boolean; onSelect(): void }

function RowMenu({ label, items, up = false }: { label: string; items: MenuItem[]; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function shut(refocus: boolean) { setOpen(false); if (refocus) trigger.current?.focus(); }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); shut(true); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % all.length : e.key === "ArrowUp" ? (i - 1 + all.length) % all.length
      : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    all[to].focus();
  }
  function pick(item: MenuItem, e: MouseEvent) {
    if (item.href && !ownClick(e)) { setOpen(false); return; }   // a new tab: the link does it
    e.preventDefault();
    setOpen(false);
    item.onSelect();
  }

  return (
    <div className="proj-menu-wrap" ref={wrap} onKeyDown={key}>
      <button type="button" ref={trigger} className="proj-menu-btn" aria-label={label} aria-haspopup="menu"
        aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <EllipsisVertical size={16} aria-hidden />
      </button>
      <div id={menuId} className={`proj-menu${up ? " up" : ""}`} role="menu" aria-label={label} hidden={!open}>
        {items.map((it) => {
          const body = <>{it.icon}<span>{it.label}</span></>;
          const cls = `proj-menu-item${it.danger ? " danger" : ""}`;
          return it.href
            ? <a key={it.key} role="menuitem" tabIndex={-1} className={cls} href={it.href} onClick={(e) => pick(it, e)}>{body}</a>
            : <button key={it.key} type="button" role="menuitem" tabIndex={-1} className={cls} onClick={(e) => pick(it, e)}>{body}</button>;
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/**
 * New project: a light modal over a pale veil (never dark). One name (required, at most 120 characters); Enter
 * creates, Escape or Cancel closes. `busy` while App creates it; `error` is the server's words.
 */
export function NewProjectDialog({ onCreate, onClose, busy = false, error }: {
  onCreate(name: string): void;
  onClose(): void;
  busy?: boolean;
  error?: string;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null;
    input.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); before?.focus?.(); };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim().slice(0, NAME_MAX);
    if (!n) { input.current?.focus(); return; }
    if (!busy) onCreate(n);
  }
  /** Tab stays inside the dialog. */
  function trap(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const all = [...(card.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)") ?? [])];
    if (!all.length) return;
    const first = all[0], last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="proj-veil" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="proj-dialog" ref={card} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
        onKeyDown={trap}>
        <form onSubmit={submit}>
          <h2 id={`${id}-t`} className="proj-dialog-title">New project</h2>
          <p id={`${id}-d`} className="proj-dialog-line">A project keeps the models, the clash results, the review decisions and the
            reports together.</p>
          <label htmlFor={`${id}-n`} className="proj-label">Project name</label>
          <input id={`${id}-n`} ref={input} className="proj-input" value={name} maxLength={NAME_MAX} required autoFocus
            placeholder="e.g. Riverside Block C" autoComplete="off" spellCheck={false} disabled={busy}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined}
            onChange={(e) => setName(e.target.value)} />
          {error && <p id={`${id}-e`} className="proj-field-error" role="alert">{error}</p>}
          <div className="proj-dialog-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
              {busy ? <span className="spinner" aria-hidden /> : null} {busy ? "Creating…" : "Create project"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
