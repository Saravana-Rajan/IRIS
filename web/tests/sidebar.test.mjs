import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h, Fragment } from "react";
import { compiled } from "./app-host.mjs";

/* The app shell (AppShell.tsx, shellNav.ts): server-rendered with the real React and lucide, and walked as an element
   tree (hooks stubbed) to press its links. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const source = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString();
const jsx = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") };

const routeUrl = await compiled("../src/projectRoute.ts");
const navUrl = await compiled("../src/shellNav.ts");
const brandUrl = await compiled("../src/Brand.tsx", { ...jsx, react: import.meta.resolve("react"), "./Holo": url("export function HoloRibbon(){return null;}") });
const nav = await import(navUrl);

/** AppShell compiled with its own modules and `react` as given; its stylesheet import is dropped (Vite's job). */
async function shell(react) {
  const out = await compiled("../src/AppShell.tsx", { react, ...jsx, "lucide-react": import.meta.resolve("lucide-react"),
    "./projectRoute": routeUrl, "./shellNav": navUrl, "./Brand": brandUrl });
  return import(url(source(out).replace('import "./appShell.css";', "")));
}
const real = await shell(import.meta.resolve("react"));
/** Hooks that keep their first value, so a component can be called as a plain function and its tree read. */
const still = await shell(url(`export const useState=(v)=>[typeof v==="function"?v():v,()=>{}];
  export const useRef=(v)=>({current:v}); export const useEffect=()=>{}; export const useId=()=>"id";
  export const useMemo=(f)=>f(); export const useCallback=(f)=>f;`));

/** Every host element of a component's tree, function components called in place (lucide's icons are leaves). */
function walk(node, out = []) {
  if (node == null || typeof node === "boolean" || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node.type === "function") return walk(node.type(node.props), out);
  if (typeof node.type === "string") out.push(node);
  if (node.type === Fragment || typeof node.type === "string") walk(node.props?.children, out);
  return out;
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const noop = () => {};
const PID = "3f9a1c0b2d4e5f6a7b8c9d0e";
const SEG = { overview: "", clash: "/clashes" };
const hrefOf = (id) => ({ home: "/home", projects: "/projects", workspace: "/workspace" })[id] ?? `/projects/${PID}${SEG[id] ?? `/${id}`}`;
const props = (over = {}) => ({ active: "home", rail: false, onNav: noop, hrefOf, reviewer: "Priya Raman", onReviewer: noop,
  onHelp: noop, onSettings: noop, ...over });
const sidebar = (over) => renderToStaticMarkup(h(real.Sidebar, props(over)));
const project = { id: PID, name: "Riverside Block C", counts: { models: 4, clash: 463 } };
/** Each `<a …>` or `<button …>` opening tag. */
const tags = (html) => html.match(/<(a|button)\b[^>]*>/g) ?? [];
const hrefs = (html) => tags(html).map((t) => /href="([^"]*)"/.exec(t)?.[1]).filter(Boolean);
const STEPS = ["Overview", "Models", "Drawings", "Coordination", "Clash review", "Reports", "Activity"];

/* ---------------------------------------------------------------------------------------------------------------- */

test("the sidebar is the Main nav with the logo, Home and Projects as real links, Help, Settings and no log out", () => {
  const html = sidebar();
  assert.match(html, /^<nav class="sidebar" aria-label="Main">/);
  const t = text(html);
  assert.match(t, /^Iris Home Projects Help Settings Built by Techjays$/);
  assert.deepEqual(hrefs(html), ["/home", "/home", "/projects"]);   // the logo (mouse only), then the items
  assert.match(html, /<a class="side-brand" href="\/home" tabindex="-1" aria-hidden="true">/);
  assert.doesNotMatch(t, /log ?out|sign ?out/i);
  assert.doesNotMatch(html, /side-drawer|side-scrim|Workspace|side-group/);
  // Help and Settings are buttons, not links
  assert.equal(tags(html).filter((tag) => /^<button/.test(tag) && /side-item/.test(tag)).length, 2);
});

test("a session open outside a project adds a Workspace item under Projects", () => {
  const html = sidebar({ workspace: { label: "Workspace" }, active: "workspace" });
  assert.match(text(html), /Home Projects Workspace Help/);
  assert.deepEqual(hrefs(html), ["/home", "/home", "/projects", "/workspace"]);
  assert.match(html, /<a class="side-item active" href="\/workspace" aria-current="page">/);
});

test("exactly the page shown is marked current", () => {
  for (const active of ["home", "projects"]) {
    const html = sidebar({ active });
    const current = tags(html).filter((tag) => tag.includes('aria-current="page"'));
    assert.equal(current.length, 1, active);
    assert.match(current[0], new RegExp(`class="side-item active" href="${hrefOf(active)}"`));
  }
  assert.doesNotMatch(sidebar({ active: null }), /aria-current|side-item active/);
  // A step of a project that is not open has no item to mark
  assert.doesNotMatch(sidebar({ active: "models" }), /aria-current/);
});

test("the open project's group: its name, the seven steps in order with their links, counts only where given", () => {
  const html = sidebar({ project, active: "projects" });
  const t = text(html);
  assert.match(t, /Projects Project : Riverside Block C Overview Models 4 Drawings Coordination Clash review 463 Reports Activity Help/);
  assert.match(html, /<button type="button" class="side-group-head" aria-expanded="true" aria-controls="[^"]+">/);
  assert.match(html, /<ul class="side-list side-steps" id="[^"]+" aria-label="Project: Riverside Block C">/);
  assert.deepEqual(hrefs(html).slice(3), ["/projects/" + PID, `/projects/${PID}/models`, `/projects/${PID}/drawings`,
    `/projects/${PID}/coordination`, `/projects/${PID}/clashes`, `/projects/${PID}/reports`, `/projects/${PID}/activity`]);
  assert.equal((html.match(/class="side-item sub/g) ?? []).length, 7);
  // Two counts, two pills: the open clashes tinted, nothing invented for the rest
  assert.deepEqual([...html.matchAll(/<span class="side-badge([^"]*)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]), [["", "4"], [" alert", "463"]]);
  assert.doesNotMatch(sidebar({ project: { id: PID, name: "Empty" } }), /side-badge/);
  // A name too long for the row carries it whole in a tip
  assert.match(sidebar({ project: { id: PID, name: "Northbank Tower, Level 02 transfer" } }),
    /class="side-group-head" aria-expanded="true" aria-controls="[^"]+" data-tip="Northbank Tower, Level 02 transfer" data-tip-side="right">/);
  assert.doesNotMatch(sidebar({ project: { id: PID, name: "Zero", counts: { clash: 0 } } }), /side-badge alert/);
  assert.match(sidebar({ project: { id: PID, name: "Zero", counts: { clash: 0 } } }), /<span class="side-badge">0<\/span>/);
  assert.doesNotMatch(sidebar({ project: { id: PID, name: "Bad", counts: { models: Number.NaN, clash: "9" } } }), /side-badge/);
});

test("a project step shown marks that step, opens the group and nothing else", () => {
  const html = sidebar({ project, active: "clash" });
  const current = tags(html).filter((tag) => tag.includes('aria-current="page"'));
  assert.deepEqual(current, [`<a class="side-item sub active" href="/projects/${PID}/clashes" aria-current="page">`]);
  assert.match(html, /<div class="side-group open has-active">/);
  assert.match(html, /aria-expanded="true"/);
});

test("the rail: icons only, every item keeps its name as an aria-label and a right-side tip", () => {
  const html = sidebar({ rail: true, project, active: "models", workspace: { label: "Workspace" } });
  assert.match(html, /^<nav class="sidebar sidebar-rail" aria-label="Main">/);
  assert.equal(text(html), "");                                     // no text: icons, and the footer's mark
  assert.doesNotMatch(html, /side-label|side-badge|side-group-head|side-brand-text|side-user-text|Edit/);
  const items = tags(html).filter((tag) => tag.includes("side-item"));
  const labels = items.map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1]);
  assert.deepEqual(labels, ["Home", "Projects", "Workspace", "Overview", "Models (4)", "Drawings", "Coordination",
    "Clash review (463)", "Reports", "Activity", "Help", "Settings"]);
  for (const tag of items) {
    assert.equal(/data-tip="([^"]*)"/.exec(tag)?.[1], /aria-label="([^"]*)"/.exec(tag)?.[1]);
    assert.match(tag, /data-tip-side="right"/);
  }
  assert.match(html, /<div class="side-group open has-active">/);  // the steps' icons, under their divider
  assert.match(html, /<a class="side-item sub active" href="\/projects\/[^"]+\/models" aria-current="page" aria-label="Models \(4\)"/);
  assert.match(html, /<div class="side-built" role="note" aria-label="Built by Techjays" data-tip="Built by Techjays" data-tip-side="right">/);
  // Expanded, no item carries a tip (its label is on show)
  assert.doesNotMatch(sidebar({ project }), /side-item[^>]*data-tip/);
});

test("the footer: \"Built by Techjays\" with the small mark, and no person's name or avatar", () => {
  const html = sidebar({ reviewer: "Priya Raman" });
  assert.match(html, /<div class="side-built" role="note" aria-label="Built by Techjays">/);
  assert.match(text(html), /Built by Techjays$/);
  assert.doesNotMatch(html, /Priya|side-user|side-avatar|Add your name|Reviewer/);
  assert.doesNotMatch(html, /by Techjays<\/span><\/span><\/a>/, "the brand at the top is just Iris");
});

test("phones and tablets: the drawer is open or closed over a light scrim, with labels and a close button", () => {
  const open = sidebar({ drawer: "open", rail: true });
  assert.match(open, /^<div class="side-scrim open" aria-hidden="true"><\/div><nav class="sidebar side-drawer open" aria-label="Main">/);
  assert.match(open, /<button type="button" class="side-close" aria-label="Close the menu">/);
  assert.match(text(open), /Home Projects/);                          // the drawer never uses the rail
  const closed = sidebar({ drawer: "closed" });
  assert.match(closed, /^<div class="side-scrim closed" aria-hidden="true"><\/div><nav class="sidebar side-drawer closed" aria-label="Main">/);
});

test("a plain click on an item goes to it (and closes an open drawer); a click for a new tab is the browser's", () => {
  const calls = [];
  const tree = walk(still.Sidebar(props({ project, active: "overview", drawer: "open", onNav: (id) => calls.push(["nav", id]),
    onCloseDrawer: () => calls.push(["close"]), onHelp: () => calls.push(["help"]), onSettings: () => calls.push(["settings"]) })));
  const link = (href) => tree.find((n) => n.type === "a" && n.props.className?.startsWith("side-item") && n.props.href === href);
  const click = (el, over = {}) => { let prevented = false; el.props.onClick({ button: 0, preventDefault: () => { prevented = true; }, ...over }); return prevented; };

  assert.equal(click(link(`/projects/${PID}/clashes`)), true);
  assert.deepEqual(calls.splice(0), [["nav", "clash"], ["close"]]);
  assert.equal(click(link("/projects"), { metaKey: true }), false);
  assert.equal(click(link("/home"), { button: 1 }), false);
  assert.deepEqual(calls.splice(0), []);
  const button = (label) => tree.find((n) => n.type === "button" && walk(n.props.children).some((c) => c.props?.children === label));
  button("Help").props.onClick(); button("Settings").props.onClick();
  assert.deepEqual(calls.splice(0), [["help"], ["close"], ["settings"], ["close"]]);
  tree.find((n) => n.props.className === "side-scrim open").props.onClick();
  tree.find((n) => n.props.className === "side-close").props.onClick();
  assert.deepEqual(calls.splice(0), [["close"], ["close"]]);
  const logo = tree.find((n) => n.props.className === "side-brand");
  click(logo);
  assert.deepEqual(calls.splice(0), [["nav", "home"], ["close"]]);

  // On a desktop there is no drawer to close
  const desk = walk(still.Sidebar(props({ onNav: (id) => calls.push(["nav", id]), onCloseDrawer: () => calls.push(["close"]) })));
  desk.find((n) => n.type === "a" && n.props.href === "/projects").props.onClick({ button: 0, preventDefault: noop });
  assert.deepEqual(calls.splice(0), [["nav", "projects"]]);

  // An item without an address is a button
  const none = walk(still.Sidebar(props({ hrefOf: () => undefined, onNav: (id) => calls.push(["nav", id]) })));
  const home = none.find((n) => n.type === "button" && n.props.className === "side-item active");
  home.props.onClick();
  assert.deepEqual(calls.splice(0), [["nav", "home"]]);
});

test("SideLink is a link with its count, or a button; aria-current only when active", () => {
  const icon = () => null;
  const a = renderToStaticMarkup(h(real.SideLink, { label: "Clash review", icon, href: "/x", rail: false, count: 1234, alert: true, active: true, sub: true, onSelect: noop }));
  assert.equal(a, '<a class="side-item sub active" href="/x" aria-current="page"><span class="side-label">Clash review</span><span class="side-badge alert">1,234</span></a>');
  const b = renderToStaticMarkup(h(real.SideLink, { label: "Help", icon, rail: true, onSelect: noop }));
  assert.equal(b, '<button type="button" class="side-item" aria-label="Help" data-tip="Help" data-tip-side="right"></button>');
});

/* ---------------------------------------------------------------------------------------------------------------- */

test("the top bar: the collapse toggle on desktop, the menu and logo on phones, then the middle, search and actions", () => {
  const desk = renderToStaticMarkup(h(real.TopBar, { rail: false, onToggle: noop, search: h("i", null, "S"), actions: h("b", null, "New project") }));
  assert.match(desk, /^<header class="topbar"><button type="button" class="topbar-btn" aria-pressed="false" aria-label="Collapse the sidebar"/);
  assert.match(desk, /<div class="topbar-search"><i>S<\/i><\/div><div class="topbar-actions"><b>New project<\/b><\/div><\/header>$/);
  assert.doesNotMatch(desk, /Open the menu|topbar-middle/);
  const railed = renderToStaticMarkup(h(real.TopBar, { rail: true, onToggle: noop }));
  assert.match(railed, /aria-pressed="true" aria-label="Expand the sidebar"/);
  assert.doesNotMatch(railed, /topbar-search|topbar-actions/);
  const phone = renderToStaticMarkup(h(real.TopBar, { rail: true, onToggle: noop, compact: true, onMenu: noop }, h("em", null, "Header")));
  assert.match(phone, /^<header class="topbar compact has-middle"><button type="button" class="topbar-btn" aria-label="Open the menu">/);
  assert.match(phone, /<span class="topbar-logo"><span class="shell-logo"[^>]*>.*<\/span><span class="topbar-logo-name">Iris<\/span><\/span><div class="topbar-middle"><em>Header<\/em><\/div><\/header>$/);
  assert.doesNotMatch(phone, /aria-pressed|Collapse the sidebar/);
});

test("the top bar's buttons call their handlers", () => {
  const calls = [];
  const desk = walk(still.TopBar({ rail: false, onToggle: () => calls.push("toggle") }));
  desk.find((n) => n.type === "button").props.onClick();
  const phone = walk(still.TopBar({ rail: false, onToggle: noop, compact: true, onMenu: () => calls.push("menu") }));
  phone.find((n) => n.type === "button").props.onClick();
  assert.deepEqual(calls, ["toggle", "menu"]);
});

test("the search box is a combobox with a '/' hint whose popover stays hidden until there is a query", () => {
  const html = renderToStaticMarkup(h(real.SearchBox, { search: () => { throw new Error("not asked without a query"); } }));
  assert.match(html, /<input class="search-input" type="search" role="combobox" placeholder="Search projects, clashes, elements" aria-label="Search" aria-autocomplete="list" aria-expanded="false" aria-controls="([^"]+)"/);
  const list = /aria-controls="([^"]+)"/.exec(html)[1];
  assert.match(html, new RegExp(`<div class="search-list" role="listbox" id="${list.replace(/[^\w]/g, "\\$&")}" aria-label="Search results"></div>`));
  assert.match(html, /<kbd class="search-key" aria-hidden="true">\/<\/kbd>/);
  assert.match(html, /<div class="search-pop" hidden="">/);
  assert.match(html, /<button type="button" class="topbar-btn search-open" aria-label="Search"/);
});

/* ---------------------------------------------------------------------------------------------------------------- */

/** A browser's localStorage, enough for the helpers: a Map behind the Storage methods. */
function storage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test("the rail is remembered apart for pages (expanded by default) and the 3D workspace (the rail by default)", () => {
  assert.equal(nav.SIDEBAR_KEY, "iris.sidebar");
  const s = storage();
  assert.equal(nav.readRail(s, "pages"), false);
  assert.equal(nav.readRail(s, "workspace"), true);
  nav.writeRail(s, "pages", true);
  assert.deepEqual(JSON.parse(s.map.get("iris.sidebar")), { pages: true });
  assert.equal(nav.readRail(s, "pages"), true);
  assert.equal(nav.readRail(s, "workspace"), true);
  nav.writeRail(s, "workspace", false);
  assert.deepEqual(JSON.parse(s.map.get("iris.sidebar")), { pages: true, workspace: false });
  assert.equal(nav.readRail(s, "workspace"), false);
  nav.writeRail(s, "pages", false);
  assert.deepEqual([nav.readRail(s, "pages"), nav.readRail(s, "workspace")], [false, false]);
});

test("a missing, broken or throwing storage gives the defaults and never throws", () => {
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
  for (const st of [null, undefined, throwing, storage({ "iris.sidebar": "{not json" }), storage({ "iris.sidebar": "[true]" }),
    storage({ "iris.sidebar": '{"pages":"yes","workspace":1}' }), storage({ "iris.sidebar": "null" })]) {
    assert.equal(nav.readRail(st, "pages"), false);
    assert.equal(nav.readRail(st, "workspace"), true);
    assert.doesNotThrow(() => nav.writeRail(st, "pages", true));
  }
  // Writing over junk keeps only what is known
  const junk = storage({ "iris.sidebar": '{"pages":"yes","other":3}' });
  nav.writeRail(junk, "workspace", false);
  assert.deepEqual(JSON.parse(junk.map.get("iris.sidebar")), { workspace: false });
  assert.equal(nav.browserStorage(), null);   // no window in Node
});

test("the pure helpers: the initial, the saved name, the shortcut and the grouping of hits", () => {
  assert.deepEqual(["Priya", " amara ", "", "   ", null, undefined, "😀 Smile", "ßen"].map(nav.initials), ["P", "A", "?", "?", "?", "?", "😀", "SS"]);
  assert.equal(nav.cleanName("  Ana  "), "Ana");
  assert.equal(nav.cleanName("x".repeat(200)).length, nav.NAME_MAX);
  assert.equal(nav.NAME_MAX, 120);

  const field = (sel) => ({ closest: (s) => (s.includes(sel) ? {} : null) });
  assert.equal(nav.isSearchKey({ key: "/", target: { closest: () => null } }), true);
  assert.equal(nav.isSearchKey({ key: "/", target: field("input") }), false);
  assert.equal(nav.isSearchKey({ key: "/", target: { tagName: "TEXTAREA" } }), false);
  assert.equal(nav.isSearchKey({ key: "/", target: { tagName: "DIV", isContentEditable: true } }), false);
  assert.equal(nav.isSearchKey({ key: "/", ctrlKey: true, target: null }), false);
  assert.equal(nav.isSearchKey({ key: "k", metaKey: true, target: field("input") }), true);
  assert.equal(nav.isSearchKey({ key: "K", ctrlKey: true, target: null }), true);
  assert.equal(nav.isSearchKey({ key: "k", target: null }), false);
  assert.equal(nav.isSearchKey({ key: "k", ctrlKey: true, altKey: true, target: null }), false);

  const hit = (kind, id) => ({ kind, id, label: id, run: noop });
  const hits = [hit("clash", "c1"), hit("project", "p1"), hit("clash", "c2"), hit("element", "e1"), hit("page", "g1"),
    hit("project", "p2"), hit("clash", "c3"), hit("element", "e2"), hit("clash", "c4"), hit("project", "p3")];
  const groups = nav.groupHits(hits);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => `${i.hit.id}@${i.index}`)]), [
    ["Clashes", ["c1@0", "c2@1", "c3@2"]], ["Projects", ["p1@3", "p2@4"]], ["Elements", ["e1@5", "e2@6"]], ["Pages", ["g1@7"]]]);
  assert.equal(groups.flatMap((g) => g.items).length, nav.MAX_HITS);
  assert.deepEqual(nav.groupHits([]), []);
  assert.deepEqual(nav.groupHits(hits, 1).map((g) => g.items.length), [1]);
});
