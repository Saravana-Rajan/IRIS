import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Box, Boxes, ChevronDown, CircleHelp, Clapperboard, ClipboardList, CornerDownLeft, Crosshair, FileText, FolderKanban, FolderOpen,
  History, House, LayoutDashboard, Menu, PanelLeft, Radar, Search, Settings, X, type LucideIcon,
} from "lucide-react";
import { ApertureMark } from "./Brand";
import { PROJECT_STEPS, isProjectStep, ownClick, type ProjectStep } from "./projectRoute";
import { groupHits, isSearchKey, type NavId, type SearchHit } from "./shellNav";
import "./appShell.css";

export type { NavId, SearchHit } from "./shellNav";

/**
 * The app shell (style brief §3): the sidebar on the left (expanded, the 64 px icon rail, or a drawer on phones and
 * tablets), the top bar over the page and its search box. Props only: App owns the route, the rail state
 * (shellNav.readRail / writeRail) and what each item does. Every item is a real link (`hrefOf`)
 * whose plain click goes to `onNav`, so a new tab still works. Layout classes: appShell.css.
 */

const STEP_ICON: Record<ProjectStep, LucideIcon> = {
  overview: LayoutDashboard, models: Boxes, drawings: FileText, coordination: Radar, clash: Crosshair,
  reports: ClipboardList, activity: History,
};
const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = { project: FolderKanban, clash: Crosshair, element: Box, page: FileText };
const FOCUSABLE = 'a[href]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled])';
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Iris's mark in the shell: the Aperture (six holographic blades around an ink pupil), on its own. */
export function LogoTile({ size = 32 }: { size?: number }) {
  return (
    <span className="shell-logo" aria-hidden style={{ width: size, height: size }}>
      <ApertureMark size={size} />
    </span>
  );
}

export interface SideLinkProps {
  label: string;
  icon: LucideIcon;
  /** Its address: an `<a>` whose plain click calls `onSelect`; none makes it a button. */
  href?: string;
  active?: boolean;
  rail: boolean;
  /** A live count, shown as a small pill (in the rail only in the tooltip). */
  count?: number;
  /** The count is something open to deal with (open clashes): a red-tinted pill while above 0. */
  alert?: boolean;
  /** A project step, indented under its group. */
  sub?: boolean;
  onSelect(): void;
}

/** One sidebar row: a 20 px outline icon and the label, or in the rail the icon alone with an aria-label and a tip. */
export function SideLink({ label, icon: Icon, href, active = false, rail, count: n, alert = false, sub = false, onSelect }: SideLinkProps) {
  const shown = n === undefined ? undefined : n.toLocaleString();
  const tip = shown === undefined ? label : `${label} (${shown})`;
  const className = `side-item${sub ? " sub" : ""}${active ? " active" : ""}`;
  const a11y = {
    "aria-current": active ? ("page" as const) : undefined,
    "aria-label": rail ? tip : undefined,
    "data-tip": rail ? tip : undefined,
    "data-tip-side": rail ? "right" : undefined,
  };
  const body = (
    <>
      <Icon className="side-icon" size={sub ? 18 : 20} strokeWidth={1.75} aria-hidden />
      {!rail && <span className="side-label">{label}</span>}
      {!rail && shown !== undefined && <span className={`side-badge${alert && n! > 0 ? " alert" : ""}`}>{shown}</span>}
    </>
  );
  if (href === undefined) return <button type="button" className={className} {...a11y} onClick={() => onSelect()}>{body}</button>;
  return (
    <a className={className} href={href} {...a11y}
      onClick={(e) => { if (!ownClick(e)) return; e.preventDefault(); onSelect(); }}>{body}</a>
  );
}

export interface SidebarProps {
  /** The page shown. */
  active: NavId | null;
  /** The open project: its group of steps, with live counts where known (Clash review's is the open clashes). */
  project?: { id: string; name: string; counts?: Partial<Record<ProjectStep, number>>; sample?: boolean } | null;
  /** A session open outside a project: a "Workspace" item under Projects. */
  workspace?: { label: string } | null;
  /** Desktop: collapsed to the 64 px icon rail. */
  rail: boolean;
  /** Phones and tablets: a drawer from the left (leave undefined on desktop). */
  drawer?: "open" | "closed";
  /** The scrim, Escape, the close button or a click on an item closes the drawer. */
  onCloseDrawer?(): void;
  /** A plain click on an item. */
  onNav(id: NavId): void;
  /** Each item's real address (links, so a new tab works); undefined makes the item a button. */
  hrefOf(id: NavId): string | undefined;
  /** The reviewer's name (localStorage `iris.reviewer`) is asked for where decisions are made (the proposals, the review
   *  queue, Settings), not shown in the sidebar: these are kept so a caller that still passes them compiles. */
  reviewer?: string;
  onReviewer?(name: string): void;
  onHelp(): void;
  onSettings(): void;
}

/** The left sidebar: the logo, Home, Projects, the workspace, Demos (the demo videos' page), the open project's steps,
 *  then Help, Settings and the reviewer. A `nav` landmark labelled "Main". */
export function Sidebar({ active, project = null, workspace = null, rail: railPref, drawer, onCloseDrawer, onNav, hrefOf,
  onHelp, onSettings }: SidebarProps) {
  const inDrawer = drawer !== undefined;
  const isOpen = drawer === "open";
  const rail = railPref && !inDrawer;           // the drawer always shows the labels
  const stepActive = active !== null && isProjectStep(active);
  // The project group: open at first, and opened again whenever one of its steps becomes the page shown.
  const [groupOpen, setGroupOpen] = useState(true);
  const [seen, setSeen] = useState<NavId | null>(active);
  if (seen !== active) { setSeen(active); if (stepActive && !groupOpen) setGroupOpen(true); }
  const showSteps = rail || groupOpen;          // the rail always shows the step icons
  const groupId = useId();
  const nav = useRef<HTMLElement>(null);
  const close = useRef(onCloseDrawer);
  close.current = onCloseDrawer;

  const shut = () => { if (isOpen) onCloseDrawer?.(); };
  const go = (id: NavId) => { onNav(id); shut(); };

  // The drawer: focus moves into it when it opens (the page's item, else the first), Escape closes it, and focus goes
  // back where it was when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const el = nav.current;
    if (!el) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (el.querySelector<HTMLElement>('[aria-current="page"]') ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();  // before App's own Escape (leave the clash) on window
      close.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const now = document.activeElement;
      if (back?.isConnected && (!now || now === document.body || el.contains(now))) back.focus();
    };
  }, [isOpen]);

  /** Tab stays inside the open drawer. */
  const trap = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!isOpen || e.key !== "Tab") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const item = (id: NavId, label: string, icon: LucideIcon, more: Partial<SideLinkProps> = {}) => (
    <li key={id}>
      <SideLink label={label} icon={icon} href={hrefOf(id)} active={active === id} rail={rail} onSelect={() => go(id)} {...more} />
    </li>
  );
  const home = hrefOf("home");
  const cls = ["sidebar", rail ? "sidebar-rail" : "", inDrawer ? `side-drawer ${isOpen ? "open" : "closed"}` : ""].filter(Boolean).join(" ");

  return (
    <>
      {inDrawer && <div className={`side-scrim ${isOpen ? "open" : "closed"}`} aria-hidden onClick={() => onCloseDrawer?.()} />}
      <nav ref={nav} className={cls} aria-label="Main" onKeyDown={trap}>
        <div className="side-top">
          {/* The logo goes Home for the mouse; the Home item is the one keyboards and screen readers use. */}
          <a className="side-brand" href={home ?? "#"} tabIndex={-1} aria-hidden
            onClick={(e) => { if (!ownClick(e)) return; e.preventDefault(); go("home"); }}>
            <LogoTile size={32} />
            {!rail && <span className="side-brand-text"><span className="side-brand-name">Iris</span></span>}
          </a>
          {inDrawer && (
            <button type="button" className="side-close" aria-label="Close the menu" onClick={() => onCloseDrawer?.()}>
              <X size={18} aria-hidden />
            </button>
          )}
        </div>

        <div className="side-scroll">
          <ul className="side-list">
            {item("home", "Home", House)}
            {item("projects", "Projects", FolderKanban)}
            {workspace && item("workspace", workspace.label, Box)}
            {item("demos", "Demos", Clapperboard)}
          </ul>
          {project && (
            <div className={`side-group${showSteps ? " open" : ""}${stepActive ? " has-active" : ""}`}>
              {!rail && (
                <button type="button" className="side-group-head" aria-expanded={groupOpen} aria-controls={groupId}
                  data-tip={project.name.length > 22 ? project.name : undefined} data-tip-side={project.name.length > 22 ? "right" : undefined}
                  onClick={() => setGroupOpen((o) => !o)}>
                  <FolderOpen className="side-icon" size={20} strokeWidth={1.75} aria-hidden />
                  <span className="side-group-label"><span className="side-group-kicker">Project<span className="search-sr">:</span></span> <span className="side-group-name">{project.name}</span>{project.sample && <span className="sample-pill side-sample">Sample</span>}</span>
                  <ChevronDown className="side-chevron" size={16} aria-hidden />
                </button>
              )}
              {showSteps && (
                <ul className="side-list side-steps" id={groupId} aria-label={`Project: ${project.name}`}>
                  {PROJECT_STEPS.map((s) => item(s.id, s.label, STEP_ICON[s.id],
                    { count: count(project.counts?.[s.id]), alert: s.id === "clash", sub: true }))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="side-foot">
          <ul className="side-list">
            <li><SideLink label="Help" icon={CircleHelp} rail={rail} onSelect={() => { onHelp(); shut(); }} /></li>
            <li><SideLink label="Settings" icon={Settings} rail={rail} onSelect={() => { onSettings(); shut(); }} /></li>
          </ul>
          <hr className="side-divider" />
          <BuiltBy rail={rail} />
        </div>
      </nav>
    </>
  );
}

/** The sidebar's quiet footer: the small Aperture mark and "Built by Techjays"; in the rail, the mark alone with that as
 *  its tip. */
export function BuiltBy({ rail }: { rail: boolean }) {
  return (
    <div className="side-built" role="note" aria-label="Built by Techjays" data-tip={rail ? "Built by Techjays" : undefined}
      data-tip-side={rail ? "right" : undefined}>
      <ApertureMark size={rail ? 18 : 16} />
      {!rail && <span className="side-built-text" aria-hidden>Built by <b>Techjays</b></span>}
    </div>
  );
}

export interface TopBarProps {
  /** Desktop: the sidebar is collapsed to the rail; `onToggle` collapses or expands it. */
  rail: boolean;
  onToggle(): void;
  /** Phones and tablets: a hamburger that opens the drawer, then the small logo, instead of the toggle. */
  compact?: boolean;
  onMenu?(): void;
  /** The search box (SearchBox). */
  search?: ReactNode;
  /** The middle: the workspace's slim page header (search then sits after it, smaller). */
  children?: ReactNode;
  /** The right end: the page's primary action(s). */
  actions?: ReactNode;
}

/** The light bar over the page: the collapse toggle (or the hamburger and logo), the middle, the search, the actions. */
export function TopBar({ rail, onToggle, compact = false, onMenu, search, children, actions }: TopBarProps) {
  const middle = children !== undefined && children !== null && children !== false;
  return (
    <header className={`topbar${compact ? " compact" : ""}${middle ? " has-middle" : ""}`}>
      {compact ? (
        <>
          <button type="button" className="topbar-btn" aria-label="Open the menu" onClick={() => onMenu?.()}>
            <Menu size={20} strokeWidth={1.75} aria-hidden />
          </button>
          <span className="topbar-logo"><LogoTile size={26} /><span className="topbar-logo-name">Iris</span></span>
        </>
      ) : (
        <button type="button" className="topbar-btn" aria-pressed={rail} onClick={onToggle}
          aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar"}
          data-tip={rail ? "Expand the sidebar" : "Collapse the sidebar"} data-tip-side="bottom">
          <PanelLeft size={20} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      {middle && <div className="topbar-middle">{children}</div>}
      {search && <div className="topbar-search">{search}</div>}
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  );
}

export interface SearchBoxProps {
  /** The hits for a query, best first (the box shows the first eight, grouped by kind). */
  search(q: string): SearchHit[];
  placeholder?: string;
}

/** The top bar's search: a rounded field with a "/" hint; typing lists hits in a light popover (a combobox and its
 *  listbox); arrows and Enter run one, Escape closes, "/" (outside a field) or Ctrl/⌘+K focuses it. On narrow screens
 *  it is an icon that opens the field over the bar. */
export function SearchBox({ search, placeholder = "Search projects, clashes, elements" }: SearchBoxProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);   // narrow screens: the field is open over the bar
  const [at, setAt] = useState(0);
  const [focusAsk, setFocusAsk] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = q.trim();
  const hits = useMemo(() => {
    if (!query) return [];
    try { return search(query); } catch (err) { console.error("search failed", err); return []; }
  }, [query, search]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = groups.flatMap((g) => g.items.map((i) => i.hit));
  const shown = open && query !== "";
  const listed = shown && flat.length > 0;
  const current = listed ? Math.min(at, flat.length - 1) : -1;
  const optionId = (i: number) => `${listId}-o${i}`;

  // "/" or Ctrl/⌘+K focuses the field (opening it on narrow screens), unless a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchKey(e) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      setExpanded(true);
      setFocusAsk((n) => n + 1);
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (focusAsk) input.current?.focus(); }, [focusAsk]);

  const choose = (hit: SearchHit) => {
    hit.run();
    setQ(""); setOpen(false); setExpanded(false);
    input.current?.blur();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) { setOpen(true); setAt(0); return; }
      if (!flat.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setAt((((current < 0 ? 0 : current) + d) % flat.length + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (current >= 0) { e.preventDefault(); choose(flat[current]); }
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (shown) setOpen(false);
      else if (q) setQ("");
      else { setExpanded(false); input.current?.blur(); }
    }
  };

  return (
    <div className={`search${expanded ? " expanded" : ""}`}>
      <button type="button" className="topbar-btn search-open" aria-label="Search" data-tip="Search  ·  /" data-tip-side="bottom"
        onClick={() => { setExpanded(true); setFocusAsk((n) => n + 1); }}>
        <Search size={20} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="search-field">
        <Search className="search-icon" size={17} strokeWidth={1.75} aria-hidden />
        <input ref={input} className="search-input" type="search" role="combobox" placeholder={placeholder} value={q}
          aria-label="Search" aria-autocomplete="list" aria-expanded={listed} aria-controls={listId}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined} autoComplete="off" spellCheck={false}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }}
          onFocus={() => { if (query) setOpen(true); }}
          onBlur={() => { setOpen(false); setExpanded(false); }}
          onKeyDown={onKeyDown} />
        {!q && <kbd className="search-key" aria-hidden>/</kbd>}
      </div>
      <span className="search-sr" role="status" aria-live="polite">
        {shown ? (flat.length ? `${flat.length} result${flat.length === 1 ? "" : "s"}` : "No matches") : ""}
      </span>
      {/* Pressing on the popover keeps the focus in the field, so the click that follows still runs the hit. */}
      <div className="search-pop" hidden={!shown} onMouseDown={(e) => { if (e.button === 0) e.preventDefault(); }}>
        <div className="search-list" role="listbox" id={listId} aria-label="Search results">
          {listed && groups.map((g) => (
            <div key={g.kind} role="group" aria-labelledby={`${listId}-${g.kind}`} className="search-group">
              <div role="presentation" id={`${listId}-${g.kind}`} className="search-group-label">{g.label}</div>
              {g.items.map(({ hit, index }) => {
                const Icon = KIND_ICON[hit.kind] ?? Search;
                const props = {
                  id: optionId(index), role: "option" as const, "aria-selected": index === current,
                  className: `search-hit${index === current ? " active" : ""}`, onMouseEnter: () => setAt(index),
                };
                const body = (
                  <>
                    <span className="search-hit-icon"><Icon size={16} strokeWidth={1.75} aria-hidden /></span>
                    <span className="search-hit-text">
                      <span className="search-hit-label">{hit.label}</span>
                      {hit.sub && <span className="search-hit-sub">{hit.sub}</span>}
                    </span>
                    {index === current && <CornerDownLeft className="search-hit-enter" size={14} aria-hidden />}
                  </>
                );
                const key = `${hit.kind}:${hit.id}`;
                return hit.href
                  ? <a key={key} {...props} href={hit.href} tabIndex={-1}
                      onClick={(e) => { if (!ownClick(e)) return; e.preventDefault(); choose(hit); }}>{body}</a>
                  : <div key={key} {...props} onClick={() => choose(hit)}>{body}</div>;
              })}
            </div>
          ))}
        </div>
        {shown && !flat.length && <p className="search-none" aria-hidden>No matches for “{query}”</p>}
      </div>
    </div>
  );
}
