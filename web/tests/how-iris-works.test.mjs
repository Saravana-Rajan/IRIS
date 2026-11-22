import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled } from "./app-host.mjs";

/** Home's "How Iris works" (HowIrisWorks.tsx): PROJECT_FLOW's eight steps as cards in four phases, each with its icon,
 * step number, line and measured proof chip; Propose the AI's, Validate the geometry's; each card a button to its step
 * on the sample building when Home can open it. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const jsxRuntime = import.meta.resolve("react/jsx-runtime");
/** PROJECT_FLOW's eight names and lines, read from ProjectsHome.tsx (which needs the whole projects page to compile). */
const projectsHome = await readFile(new URL("../src/ProjectsHome.tsx", import.meta.url), "utf8");
const PROJECT_FLOW = [...projectsHome.matchAll(/\{ name: "([^"]+)", text: "([^"]+)" \}/g)].map((m) => ({ name: m[1], text: m[2] }));
/** HowIrisWorks compiled for Node, its stylesheet left out (Vite bundles it), Brand and Holo standing in. */
const source = await readFile(new URL("../src/HowIrisWorks.tsx", import.meta.url), "utf8");
const cssLine = /^import "\.\/howIrisWorks\.css";$/m;
const compiledUrl = await compiled("../src/HowIrisWorks.tsx", {
  react: import.meta.resolve("react"), "react/jsx-runtime": jsxRuntime, "lucide-react": import.meta.resolve("lucide-react"),
  "./Brand": url(`import { jsx } from ${JSON.stringify(jsxRuntime)};
    export const ApertureMark = ({ size }) => jsx("svg", { className: "aperture-mark", width: size, height: size, "aria-hidden": true });`),
  "./Holo": url("export const useReducedMotion = () => true;"),
  "./ProjectsHome": url(`export const PROJECT_FLOW = ${JSON.stringify(PROJECT_FLOW)};`) });
const how = await import(url(Buffer.from(compiledUrl.slice(compiledUrl.indexOf(",") + 1), "base64").toString("utf8").replace(cssLine, "")));

const NAMES = ["Import", "Understand", "Detect", "Investigate", "Propose", "Validate", "Review", "Report"];
const PROOFS = ["IFC · STEP", "4 models · 1,732 elements", "464 clashes in 11 s", "#1 · −300 mm", "Gemini 3.8 Flash",
  "Clash gone · 50 mm clear · nothing new hit", "8 of 8 fixes ready to review", "PDF + BCF"];
const STEPS = ["models", "models", "coordination", "clash", "clash", "clash", "clash", "reports"];
const render = (p = {}) => renderToStaticMarkup(h(how.HowIrisWorks, p));
const items = (html) => html.match(/<li class="hiw-item"[^>]*>.*?<\/li>/g) ?? [];
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const amp = (t) => t.replaceAll("&", "&amp;");
/** Every element in a tree (through children and fragments), to call handlers without a DOM. */
function elements(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) elements(n, out); return out; }
  if (!node || typeof node !== "object" || !node.props) return out;
  out.push(node);
  elements(node.props.children, out);
  return out;
}

test("PROJECT_FLOW is the eight steps the cards show, in order; HowIrisWorks brings its own stylesheet", () => {
  assert.deepEqual(PROJECT_FLOW.map((s) => s.name), NAMES);
  assert.match(source, cssLine);
});

test("the heading: the kicker, a regular-weight title and one line", () => {
  const html = render();
  assert.match(html, /^<section class="hiw" aria-labelledby="hiw-title">/);
  assert.match(html, /<p class="hiw-kicker"><svg class="aperture-mark"[^>]*><\/svg> How Iris works<\/p>/);
  assert.match(html, /<h2 class="hiw-title" id="hiw-title">From tangled models to verified fixes<\/h2>/);
  assert.match(html, /<p class="hiw-line">[^<]+<\/p>/);
  assert.doesNotMatch(html, /hiw-glass|<img/, "no glass image unless one is given");
  assert.match(render({ glass: "/glass/prism.webp" }), /<img class="hiw-glass" src="\/glass\/prism\.webp" alt="" aria-hidden="true"\/>/);
});

test("eight cards in order: the step pill, the name, PROJECT_FLOW's line unchanged and exactly the measured proof chip", () => {
  const cards = items(render());
  assert.equal(cards.length, 8);
  cards.forEach((c, i) => {
    assert.match(c, new RegExp(`data-name="${NAMES[i]}"`));
    assert.ok(c.includes(`<span class="hiw-n mono">${String(i + 1).padStart(2, "0")}</span>`), `${NAMES[i]}: its pill`);
    assert.ok(c.includes(`<span class="hiw-name">${NAMES[i]}</span>`), `${NAMES[i]}: its name`);
    assert.ok(c.includes(`<span class="hiw-text">${amp(PROJECT_FLOW[i].text)}</span>`), `${NAMES[i]}: its line`);
    assert.equal(c.match(/<span class="hiw-chip mono">([^<]*)<\/span>/g).length, 1, `${NAMES[i]}: one chip`);
    assert.ok(c.includes(`<span class="hiw-chip mono">${amp(PROOFS[i])}</span>`), `${NAMES[i]}: ${PROOFS[i]}`);
    assert.match(c, /<span class="hiw-icon" aria-hidden="true"><svg[^>]*class="lucide/, `${NAMES[i]}: its icon`);
  });
  assert.deepEqual(how.HIW_CARDS.map((c) => c.proof), PROOFS, "no other values");
});

test("four phases, each above the first card of its phase: Bring in, Find, Fix, Share", () => {
  const cards = items(render());
  const phases = cards.map((c) => c.match(/<span class="hiw-phase-label">([^<]+)<\/span>/)?.[1] ?? null);
  assert.deepEqual(phases, ["Bring in", null, "Find", null, "Fix", null, null, "Share"]);
  cards.forEach((c, i) => assert.equal(/class="hiw-phase hiw-phase-none"/.test(c), phases[i] === null && i !== 5, `${NAMES[i]}: phase row`));
});

test("Propose wears the AI's holo edge and badge, Validate the geometry's check, and the bridge sits between them", () => {
  const html = render();
  const cards = items(html);
  assert.match(cards[4], /class="hiw-card hiw-ai holo-edge"/);
  assert.match(cards[4], /<span class="hiw-badge hiw-badge-ai">AI<\/span>/);
  assert.match(cards[5], /class="hiw-card hiw-proof-step"/);
  assert.match(cards[5], /<span class="hiw-badge hiw-badge-ok">✓ Geometry<\/span>/);
  assert.equal((html.match(/hiw-badge /g) ?? []).length, 2, "only those two badges");
  assert.equal((html.match(/holo-edge/g) ?? []).length, 1, "only Propose has the AI edge");
  assert.equal((html.match(/<span class="hiw-bridge">AI proposes → geometry proves<\/span>/g) ?? []).length, 1);
  assert.ok(html.indexOf('data-name="Propose"') < html.indexOf("hiw-bridge"));
  assert.ok(html.indexOf("hiw-bridge") < html.indexOf("✓ Geometry"));
});

test("static without onStep: no buttons; with it each card is a button that opens its step on the sample building", () => {
  const still = render();
  assert.doesNotMatch(still, /<button/);
  assert.deepEqual([...still.matchAll(/<div class="hiw-card[^"]*" data-step="([^"]+)"/g)].map((m) => m[1]), STEPS);
  const opened = [];
  const onStep = (s) => opened.push(s);
  const html = render({ onStep });
  const buttons = [...html.matchAll(/<button type="button" class="hiw-card hiw-open[^"]*" data-step="([^"]+)" title="Open (\w+) on the sample building">/g)];
  assert.deepEqual(buttons.map((m) => m[1]), STEPS);
  assert.deepEqual(buttons.map((m) => m[2]), NAMES);
  const tree = elements(how.HiwCards({ onStep }));
  const clickable = tree.filter((e) => e.type === "button");
  assert.equal(clickable.length, 8);
  for (const b of clickable) b.props.onClick();
  assert.deepEqual(opened, STEPS);
});

test("everything shows in a static render (no window): no reveal armed", () => {
  const html = render();
  assert.doesNotMatch(html, /hiw-armed|hiw-shown/);
  assert.match(text(html), /From tangled models to verified fixes/);
  assert.equal((html.match(/style="--i:\d"/g) ?? []).length, 8, "each card's place in the stagger");
});

test("the stylesheet: light, container-sized (4, 2 and 1 columns), a dashed line, a 150 ms lift, still under reduced motion", async () => {
  const css = await readFile(new URL("../src/howIrisWorks.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /prefers-color-scheme|\bdark\b/i, "light only");
  assert.match(css, /\.hiw \{[^}]*container: hiw \/ inline-size;/);
  assert.match(css, /\.hiw-grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container hiw \(max-width: 980px\) \{\s*\.hiw-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container hiw \(max-width: 560px\) \{[^@]*\.hiw-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.hiw-card \{[^}]*border: 1px solid var\(--line\);[^}]*border-radius: 16px;[^}]*background: var\(--surface\);[^}]*transition: transform \.15s/);
  assert.match(css, /\.hiw-card:hover \{ transform: translateY\(-2px\);/);
  assert.match(css, /\.hiw-icon \{[^}]*width: 48px; height: 48px;/);
  assert.match(css, /\.hiw-item::after \{[^}]*border-top: 1px dashed/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.hiw-armed \.hiw-item \{ opacity: 1; transform: none; transition: none; \}/);
});
