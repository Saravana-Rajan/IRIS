import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";

/** The Demos page (DemosPage.tsx, `/videos`, the sidebar's Demos): its header, then the same three demo cards as Home's
 * row in a responsive grid, each opening its lightbox; and its address (shellNav.ts: `/videos`, never `/demos`, the
 * video files' folder). Static markup with React itself. */

const url = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const base = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "react-dom": import.meta.resolve("react-dom"), "lucide-react": import.meta.resolve("lucide-react") };
/** A .ts/.tsx module compiled for Node, its stylesheet left out (Vite bundles it), its imports from `deps`. */
async function compile(path, deps = {}) {
  const input = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/^import "\.\/[\w-]+\.css";$/m, "");
  let { outputText } = ts.transpileModule(input, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  for (const [name, target] of Object.entries({ ...base, ...deps })) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return url(outputText);
}
const videoUrl = await compile("../src/DemoVideo.tsx");
const video = await import(videoUrl);
const headerUrl = await compile("../src/PageHeader.tsx", { "./projectRoute": await compile("../src/projectRoute.ts") });
const page = await import(await compile("../src/DemosPage.tsx", { "./DemoVideo": videoUrl, "./PageHeader": headerUrl }));
const nav = await import(await compile("../src/shellNav.ts"));

test("the Demos page: a page header (Demos, the demos' line), then the three demo cards in the responsive grid", () => {
  const html = renderToStaticMarkup(h(page.DemosPage));
  assert.match(html, /^<div class="proj-page demos-page"><div class="proj-scroll"><div class="proj-body"><header class="page-head">/);
  assert.match(html, /<h1 class="page-title">Demos<\/h1><p class="page-sub">Three short narrated videos, from the problem to the solution\. Captions on\.<\/p>/);
  assert.ok(html.indexOf('class="page-head"') < html.indexOf('<ul class="demos-grid">'), "the header, then the grid");
  assert.equal(html.match(/<ul class="demos-grid">/g)?.length, 1);
  const cards = html.match(/<li class="home-demo-item">.*?<\/li>/g) ?? [];
  assert.equal(cards.length, 3, "three cards");
  assert.deepEqual(cards.map((c) => c.match(/data-video="(\w+)"/)[1]), ["full", "3d", "2d"], "the same three as Home: Full demo, 3D, 2D");
  for (const [i, c] of video.DEMO_CARDS.entries()) {
    assert.ok(cards[i].includes(`aria-haspopup="dialog" aria-label="Play ${c.title} (${video.DEMO_VIDEOS[c.id].duration}, captions on)"`),
      `${c.id}: a button that opens its lightbox`);
    assert.ok(cards[i].includes(`<span class="home-demo-meta">${video.DEMO_META}</span>`));
  }
  assert.doesNotMatch(html, /<video|\.mp4|\.vtt/, "nothing of a video until one is opened");
});

test("the Demos page's address is /videos (/demos/ is the video files' folder); a trailing slash too, nothing else", () => {
  assert.equal(nav.DEMOS_PATH, "/videos");
  for (const p of ["/videos", "/videos/", " /videos "]) assert.equal(nav.isDemosPath(p), true, p);
  for (const p of ["/demos", "/demos/iris-3d-demo.mp4", "/videos/x", "/video", "/home", "", null, undefined]) assert.equal(nav.isDemosPath(p), false, String(p));
  for (const v of Object.values(video.DEMO_VIDEOS)) assert.match(v.src, /^\/demos\//, "the files stay under /demos/");
});
