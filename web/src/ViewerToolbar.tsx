import { ArrowLeft, ArrowRight, Bookmark, Box, Camera, Columns2, Crop, Ellipsis, Home, Layers, LayoutGrid, ListFilter, LocateFixed, Maximize, Radar, Ruler, ScanEye, Shapes, SlidersHorizontal, Square, Target, Trash2, Waypoints } from "lucide-react";
import { EditIcon } from "./editIcons";
import { useState } from "react";
import { IconButton, Popover } from "./ui";
import type { Preset, ViewMode, VisualStyle } from "./viewer/Viewer";
import type { DrawingsShow, Filters, Layout } from "./viewer/views";

const LAYOUTS: { id: Layout; label: string; hint: string; icon: typeof Square }[] = [
  { id: "single", label: "3D only", hint: "one view", icon: Square },
  { id: "two", label: "Plan and 3D", hint: "side by side", icon: Columns2 },
  { id: "quad", label: "Four views", hint: "plan, 3D, section, elevation", icon: LayoutGrid },
];

const MODES = [
  { id: "shaded", icon: Box, label: "Shaded: every element in its own colour", key: "V" },
  { id: "xray", icon: ScanEye, label: "X-ray: see the clash through what stands in front of it", key: "X" },
  { id: "context", icon: Radar, label: "Context: only what is close to the clash", key: "C" },
  { id: "isolate", icon: Target, label: "Isolate: only the clashing elements", key: "I" },
] as const;
const VIEWS: { id: Preset; label: string; key: string }[] = [
  { id: "top", label: "Top", key: "1" }, { id: "front", label: "Front", key: "2" },
  { id: "right", label: "Right", key: "3" }, { id: "iso", label: "Isometric", key: "4" },
];
/** Visual styles (docs/views.md): how the 3D view draws what is solid, apart from the mode round the focus. */
export const STYLES: { id: VisualStyle; label: string; hint: string }[] = [
  { id: "shaded", label: "Shaded", hint: "lit, each element in its own colour" },
  { id: "consistent", label: "Consistent colours", hint: "no shading: disciplines read by colour" },
  { id: "edges", label: "Shaded with edges", hint: "dark outlines on every element" },
  { id: "hidden", label: "Hidden line", hint: "paper and lines, like a drawing" },
  { id: "xray", label: "X-ray", hint: "everything see-through, with or without a clash" },
];

export interface ToolbarState {
  mode: ViewMode;
  style: VisualStyle;
  ortho: boolean;
  /** With a clash in Shaded, the rest in grey (else in its own colours). */
  grey: boolean;
  edges: boolean;
  section: boolean;
  measure: boolean;
  /** The Edit tool: push/pull, align, move and the rest, checked before kept (docs/manual-edits.md). */
  edit?: boolean;
  /** The connection highlight: pointing at an element (or tapping it) lights what it is linked to. */
  links: boolean;
  hiddenModels: number[];
}

/** What the camera, visibility and saved-views menus show and do (App keeps the state; the viewer draws it). */
export interface ViewsControls {
  canBack: boolean; canForward: boolean; fly: boolean; hasHome: boolean;
  onBack: () => void; onForward: () => void; onFly: (on: boolean) => void; onSetHome: () => void; onClearHome: () => void;
  saved: string[]; onSave: (name: string) => void; onApply: (i: number) => void; onDelete: (i: number) => void;
  levels: [string, number][]; classes: [string, number][]; filters: Filters; onFilters: (f: Filters) => void;
  temporary: number; onResetTemporary: () => void;
  /** Filters on (docs/filters.md), and opening their panel. */
  rulesOn?: number; onOpenFilters?: () => void;
  layout: Layout; layouts: Layout[]; onLayout: (l: Layout) => void; drawings: DrawingsShow; onDrawings: (d: DrawingsShow) => void;
}

type Toggle = "edges" | "section" | "measure" | "edit" | "links" | "ortho" | "grey";

/** Where the 3D view's own tools go when the stage shows several panes: inside the 3D pane (its rectangle in the stage),
 * or nowhere while a drawing is maximised. Null: one rail for everything, at the stage's left. */
export interface Rail3d { shown: boolean; x: number; y: number; h: number }

/** Taking a model out of the open scene (docs/add-and-remove-models.md): what does it, and why it can't now (Iris is
 * working: "Wait for the proposal to finish."), or null. */
export interface RemoveModel { onRemove: (i: number) => void; blocked: string | null }

/** The viewer's tools as a vertical icon rail of the six people reach for most (Home view, Go to the clash, Section box,
 * Measure, Visibility, Screenshot), then More tools: a menu with the rest by name (modes, styles, outlines, connections,
 * camera, saved views, the Edit tool, the views beside the 3D). Every icon has a tooltip. On a phone (`compact`) a touch
 * screen shows no tooltips, so the tools sit in one labelled Tools menu (a sheet from the bottom), beside Go to the
 * clash and Fit. */
export function ViewerToolbar({ compact = false, state, models, hasFocus, views, split = null, remove, onMode, onStyle, onToggle, onView, onFit, onFocus, onModel, onShot }: {
  compact?: boolean; state: ToolbarState; models: string[]; hasFocus: boolean; views: ViewsControls; split?: Rail3d | null;
  remove?: RemoveModel;
  onMode: (m: ViewMode) => void; onStyle: (s: VisualStyle) => void; onToggle: (k: Toggle) => void; onView: (p: Preset) => void;
  onFit: () => void; onFocus: () => void; onModel: (i: number, visible: boolean) => void; onShot: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (compact) return (
    <nav className="rail compact" aria-label="Viewer tools" onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
      <Popover icon={SlidersHorizontal} label="View tools" text="Tools" tip="bottom">
        {(close) => (<>
          <p className="pop-title">Show</p>
          <div className="tool-modes" role="group" aria-label="View mode">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={state.mode === m.id ? "on" : ""} aria-pressed={state.mode === m.id}
                onClick={() => { onMode(m.id); close(); }}>
                <m.icon size={18} strokeWidth={1.8} aria-hidden /><b>{m.label.split(":")[0]}</b><small>{m.label.split(": ")[1]}</small></button>))}
          </div>
          <p className="pop-title">Style</p>
          <div className="tool-views" role="group" aria-label="Visual style">
            {STYLES.map((s) => <button key={s.id} type="button" className={`btn small ${state.style === s.id ? "on" : ""}`} aria-pressed={state.style === s.id}
              onClick={() => { onStyle(s.id); close(); }}>{s.label}</button>)}
          </div>
          <p className="pop-title">Tools</p>
          <button type="button" className={`pop-item ${state.section ? "on" : ""}`} aria-pressed={state.section}
            onClick={() => { onToggle("section"); close(); }}><Crop size={16} aria-hidden /> Section box{check(state.section)}</button>
          <button type="button" className={`pop-item ${state.edges ? "on" : ""}`} aria-pressed={state.edges}
            onClick={() => { onToggle("edges"); close(); }}><Shapes size={16} aria-hidden /> Outline the pair through walls{check(state.edges)}</button>
          <button type="button" className={`pop-item ${state.measure ? "on" : ""}`} aria-pressed={state.measure}
            onClick={() => { onToggle("measure"); close(); }}><Ruler size={16} aria-hidden /> Measure between two points{check(state.measure)}</button>
          <button type="button" className={`pop-item ${state.links ? "on" : ""}`} aria-pressed={state.links}
            onClick={() => { onToggle("links"); close(); }}><Waypoints size={16} aria-hidden /> Show connections: tap an element{check(state.links)}</button>
          <button type="button" className="pop-item" onClick={() => { onShot(); close(); }}><Camera size={16} aria-hidden /> Save a screenshot</button>
          <p className="pop-title">Camera</p>
          <div className="tool-views" role="group" aria-label="Standard views">
            {VIEWS.map((v) => <button key={v.id} type="button" className="btn small" onClick={() => { onView(v.id); close(); }}>{v.label}</button>)}
          </div>
          <CameraItems state={state} views={views} onToggle={onToggle} close={close} fly />
          <VisibilityItems models={models} state={state} views={views} onModel={onModel} remove={remove} close={close} />
        </>)}
      </Popover>
      <button type="button" className="btn rail-btn" disabled={!hasFocus} onClick={onFocus}><LocateFixed size={16} aria-hidden /> Go to clash</button>
      <button type="button" className="btn rail-btn" aria-label="Home view" onClick={onFit}><Maximize size={16} aria-hidden /></button>
    </nav>
  );
  const home = <IconButton icon={Home} label={views.hasHome ? "Home view" : "Home view: the whole model"} shortcut="H" onClick={onFit} />;
  const focus = <IconButton icon={LocateFixed} label="Go to the clash, or frame the selected element" shortcut="F" disabled={!hasFocus} onClick={onFocus} />;
  const section = <IconButton icon={Crop} label="Section box: round the clash, the selected element or what is in view; drag a face's grip" shortcut="S" active={state.section} onClick={() => onToggle("section")} />;
  const measure = <IconButton icon={Ruler} label="Measure: in the 3D view or any drawing, snapping to corners and edges" shortcut="M" active={state.measure} onClick={() => onToggle("measure")} />;
  const visibility = models.length > 0 && (
    <Popover icon={Layers} label="Visibility: models, levels, classes">
      {(close) => <VisibilityItems models={models} state={state} views={views} onModel={onModel} remove={remove} close={close} />}
    </Popover>);
  const shot = <IconButton icon={Camera} label="Save a screenshot" onClick={onShot} />;
  /** The rest, by name, in one menu at the rail's end (owner: "too congested"): the 3D view's own (modes, styles,
   * outlines, connections, camera, saved views) and what acts on every view (the Edit tool, the views beside the 3D). */
  const more = (label: string, items: (close: () => void) => React.ReactNode) => (
    <div className="rail-more"><Popover icon={Ellipsis} label={label}>{items}</Popover></div>);
  const threeD = { state, views, onMode, onStyle, onToggle, onView };
  const extras = state.edit !== undefined || views.layouts.length > 1;
  const everyView = (close: () => void) => (<>
    {state.edit !== undefined && <EditItem on={state.edit} onToggle={onToggle} close={close} />}
    {views.layouts.length > 1 && <LayoutItems views={views} close={close} />}
  </>);
  if (!split) return (
    <nav className="rail" aria-label="Viewer tools" onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
      <div className="rail-group" role="group" aria-label="Core tools">
        {home}{focus}{section}{measure}{visibility}{shot}
        {more("More tools", (close) => (
          <div className="more-menu two">
            <div className="more-col"><ModeItems {...threeD} close={close} /><StyleItems {...threeD} close={close} /><ToolItems {...threeD} />
              {state.edit !== undefined && <EditItem on={state.edit} onToggle={onToggle} close={close} />}</div>
            <div className="more-col"><CameraSection {...threeD} close={close} /><SavedViewsItems views={views} close={close} />
              {views.layouts.length > 1 && <LayoutItems views={views} close={close} />}</div>
          </div>))}
      </div>
    </nav>);
  // Several panes: the 3D view's own tools in the 3D pane, under its header; what acts on every view stays here.
  return (<>
    <nav className="rail" aria-label="Tools for every view" onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
      <div className="rail-group" role="group" aria-label="Every view">
        {focus}{measure}{visibility}{shot}
        {extras && more("More tools", (close) => <div className="more-menu">{everyView(close)}</div>)}
      </div>
    </nav>
    {split.shown && (
      <nav className="rail rail-3d" aria-label="3D view tools" style={{ left: split.x + 8, top: split.y + 50 }} onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
        <div className="rail-group" role="group" aria-label="3D view">
          {home}{section}
          {more("More 3D tools", (close) => (
            <div className="more-menu two">
              <div className="more-col"><ModeItems {...threeD} close={close} /><StyleItems {...threeD} close={close} /><ToolItems {...threeD} /></div>
              <div className="more-col"><CameraSection {...threeD} close={close} /><SavedViewsItems views={views} close={close} /></div>
            </div>))}
        </div>
      </nav>)}
  </>);
}

const check = (on: boolean) => on && <b className="tick">✓</b>;
type Section = { state: ToolbarState; views: ViewsControls; onMode: (m: ViewMode) => void; onStyle: (s: VisualStyle) => void;
  onToggle: (k: Toggle) => void; onView: (p: Preset) => void; close: () => void };

/** The 3D view's modes, by name, with their keys. */
function ModeItems({ state, onMode, close }: Pick<Section, "state" | "onMode" | "close">) {
  return (<>
    <p className="pop-title">Mode</p>
    {MODES.map((m) => (
      <button key={m.id} type="button" role="menuitemradio" aria-checked={state.mode === m.id} className={`pop-item ${state.mode === m.id ? "on" : ""}`}
        onClick={() => { onMode(m.id); close(); }}><m.icon size={15} aria-hidden /><span><b>{m.label.split(":")[0]}</b> <small className="why">{m.label.split(": ")[1]}</small></span><kbd>{m.key}</kbd></button>))}
  </>);
}

/** Visual styles (G steps through them), and greying the rest round a clash in Shaded. */
function StyleItems({ state, onStyle, onToggle, close }: Pick<Section, "state" | "onStyle" | "onToggle" | "close">) {
  return (<>
    <p className="pop-title">Visual style <kbd>G</kbd></p>
    <div className="more-chips" role="group" aria-label="Visual style">
      {STYLES.map((x) => (
        <button key={x.id} type="button" role="menuitemradio" aria-checked={state.style === x.id} className={`btn small ${state.style === x.id ? "on" : ""}`}
          title={x.hint} onClick={() => { onStyle(x.id); close(); }}>{x.label}</button>))}
    </div>
    <label className="pop-item check"><input type="checkbox" checked={state.grey} onChange={() => onToggle("grey")} /> With a clash, grey the rest in Shaded</label>
  </>);
}

/** The 3D view's own toggles that are not on the rail. */
function ToolItems({ state, onToggle }: Pick<Section, "state" | "onToggle">) {
  return (<>
    <p className="pop-title">3D tools</p>
    <button type="button" className={`pop-item ${state.edges ? "on" : ""}`} aria-pressed={state.edges} onClick={() => onToggle("edges")}>
      <Shapes size={15} aria-hidden /> Outline the pair through walls{check(state.edges)}<kbd>E</kbd></button>
    <button type="button" className={`pop-item ${state.links ? "on" : ""}`} aria-pressed={state.links} onClick={() => onToggle("links")}
      title="Point at an element to light what it is joined to (or hold Alt / Option); Shift for the whole run">
      <Waypoints size={15} aria-hidden /> Connections: light what an element joins{check(state.links)}<kbd>L</kbd></button>
  </>);
}

/** The standard views, then projection, back and forward, and Home. */
function CameraSection({ state, views, onToggle, onView, close }: Pick<Section, "state" | "views" | "onToggle" | "onView" | "close">) {
  return (<>
    <p className="pop-title">Camera</p>
    <div className="tool-views more-views" role="group" aria-label="Standard views">
      {VIEWS.map((v) => <button key={v.id} type="button" role="menuitem" className="btn small" title={`${v.label} (${v.key})`}
        onClick={() => { onView(v.id); close(); }}>{v.label === "Isometric" ? "Iso" : v.label}<kbd>{v.key}</kbd></button>)}
    </div>
    <CameraItems state={state} views={views} onToggle={onToggle} close={close} />
  </>);
}

/** The Edit tool (docs/manual-edits.md): push/pull, align, move and the rest, checked before kept. */
function EditItem({ on, onToggle, close }: { on: boolean; onToggle: (k: Toggle) => void; close: () => void }) {
  return (<>
    <p className="pop-title">Edit</p>
    <button type="button" className={`pop-item ${on ? "on" : ""}`} aria-pressed={on} onClick={() => { onToggle("edit"); close(); }}>
      <EditIcon size={15} aria-hidden /><span><b>Edit the model</b> <small className="why">push, pull, align, move; checked before kept</small></span>
      {check(on)}<kbd>P</kbd></button>
  </>);
}

function CameraItems({ state, views, onToggle, close, fly = false }: { state: ToolbarState; views: ViewsControls; onToggle: (k: Toggle) => void; close: () => void; fly?: boolean }) {
  return (<>
    <p className="pop-title">Projection</p>
    <button role="menuitemcheckbox" aria-checked={state.ortho} className={`pop-item ${state.ortho ? "on" : ""}`} onClick={() => onToggle("ortho")}>
      <span>Orthographic</span><kbd>O</kbd></button>
    <p className="pop-title">Where you have been</p>
    <div className="pop-row">
      <button className="btn small" disabled={!views.canBack} onClick={() => views.onBack()}><ArrowLeft size={14} aria-hidden /> Back <kbd>[</kbd></button>
      <button className="btn small" disabled={!views.canForward} onClick={() => views.onForward()}>Forward <kbd>]</kbd> <ArrowRight size={14} aria-hidden /></button>
    </div>
    {fly && <label className="pop-item check"><input type="checkbox" checked={views.fly} onChange={(e) => views.onFly(e.target.checked)} /> Take every view to the clash I pick</label>}
    <p className="pop-title">Home</p>
    <button className="pop-item" onClick={() => { views.onSetHome(); close(); }}><Home size={14} aria-hidden /> Set this view as Home</button>
    {views.hasHome && <button className="pop-item" onClick={() => views.onClearHome()}>Home back to the whole model</button>}
  </>);
}

/** What the drawing views show (docs/filters.md, "Drawings"). */
const DRAWINGS: { id: DrawingsShow; label: string; hint: string }[] = [
  { id: "filtered", label: "What the filters leave", hint: "(their colours too)" },
  { id: "follow", label: "What the 3D view shows", hint: "(Context, Isolate)" },
  { id: "whole", label: "The whole model", hint: "(no filters)" },
];

function LayoutItems({ views, close }: { views: ViewsControls; close: () => void }) {
  return (<>
    <p className="pop-title">Views</p>
    {LAYOUTS.filter((l) => views.layouts.includes(l.id)).map((l) => (
      <button key={l.id} role="menuitemradio" aria-checked={views.layout === l.id} className={`pop-item ${views.layout === l.id ? "on" : ""}`}
        onClick={() => { views.onLayout(l.id); close(); }}><l.icon size={15} aria-hidden /><span><b>{l.label}</b> <small className="why">{l.hint}</small></span>{views.layout === l.id && <b className="tick">✓</b>}</button>))}
    <p className="pop-title">Drawings show</p>
    {DRAWINGS.map((d) => (
      <button key={d.id} role="menuitemradio" aria-checked={views.drawings === d.id} className={`pop-item ${views.drawings === d.id ? "on" : ""}`}
        onClick={() => views.onDrawings(d.id)}><span>{d.label} <small className="why">{d.hint}</small></span>{views.drawings === d.id && <b className="tick">✓</b>}</button>))}
    <p className="pop-title">Picking a clash</p>
    <label className="pop-item check"><input type="checkbox" checked={views.fly} onChange={(e) => views.onFly(e.target.checked)} /> Take every view to the clash I pick</label>
  </>);
}

/** Saved views (docs/views.md): name and keep this view; apply or delete one kept before. */
function SavedViewsItems({ views, close }: { views: ViewsControls; close: () => void }) {
  const [name, setName] = useState("");
  return (<>
    <p className="pop-title">Saved views</p>
    <form className="pop-row" onSubmit={(e) => { e.preventDefault(); views.onSave(name.trim() || `View ${views.saved.length + 1}`); setName(""); }}>
      <input className="pop-input" placeholder={`View ${views.saved.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name for this view" />
      <button className="btn small" type="submit"><Bookmark size={13} aria-hidden /> Save this view</button>
    </form>
    {!views.saved.length && <p className="hint">The camera, style, mode, visibility and section box, kept in this browser for these models.</p>}
    {views.saved.map((n, i) => (
      <div key={`${n}-${i}`} className="pop-item saved-view">
        <button type="button" className="link" onClick={() => { views.onApply(i); close(); }}>{n}</button>
        <button type="button" className="ibtn" aria-label={`Delete ${n}`} data-tip="Delete" data-tip-side="left" onClick={() => views.onDelete(i)}><Trash2 size={13} aria-hidden /></button>
      </div>))}
  </>);
}

/** Models, levels and classes to show (viewing only: the check, triage and fixes never see these), and what is hidden
 * for now. */
function VisibilityItems({ models, state, views, onModel, remove, close }: { models: string[]; state: ToolbarState; views: ViewsControls;
  onModel: (i: number, visible: boolean) => void; remove?: RemoveModel; close?: () => void }) {
  const { filters, onFilters } = views;
  const flip = (key: keyof Filters, v: string, show: boolean) =>
    onFilters({ ...filters, [key]: show ? filters[key].filter((x) => x !== v) : [...filters[key], v] });
  const any = filters.classes.length + filters.levels.length > 0;
  return (<>
    {views.temporary > 0 && <div className="pop-row temp-row"><span>{views.temporary} hidden or isolated for now</span>
      <button className="btn small" onClick={views.onResetTemporary}>Reset</button></div>}
    <p className="pop-title">Models</p>
    {models.map((name, i) => (
      <div key={name} className="pop-item model-row">
        <label className="check">
          <input type="checkbox" checked={!state.hiddenModels.includes(i)} onChange={(e) => onModel(i, e.target.checked)} /> {name}
        </label>
        {remove && models.length > 1 && (
          <button type="button" className="ibtn" aria-label={`Remove ${name} from the open models`} disabled={!!remove.blocked}
            data-tip={remove.blocked ?? "Remove from the open models"} data-tip-side="left"
            onClick={() => { remove.onRemove(i); close?.(); }}><Trash2 size={13} aria-hidden /></button>)}
      </div>))}
    {views.levels.length > 0 && <>
      <p className="pop-title">Levels</p>
      {views.levels.map(([lv, n]) => (
        <label key={lv} className="pop-item check">
          <input type="checkbox" checked={!filters.levels.includes(lv)} onChange={(e) => flip("levels", lv, e.target.checked)} /> {lv} <small className="why">{n}</small>
        </label>))}
    </>}
    {views.classes.length > 0 && <>
      <p className="pop-title">Classes</p>
      <div className="pop-scroll">
        {views.classes.map(([c, n]) => (
          <label key={c} className="pop-item check">
            <input type="checkbox" checked={!filters.classes.includes(c)} onChange={(e) => flip("classes", c, e.target.checked)} /> {c.replace(/^Ifc/, "")} <small className="why">{n}</small>
          </label>))}
      </div>
    </>}
    {any && <button className="pop-item" onClick={() => onFilters({ classes: [], levels: [] })}>Show all levels and classes</button>}
    {views.onOpenFilters && <button className="pop-item" onClick={() => { views.onOpenFilters?.(); close?.(); }}>
      <ListFilter size={15} aria-hidden /> Filters by property{views.rulesOn ? ` (${views.rulesOn} on)` : ""}…</button>}
  </>);
}
