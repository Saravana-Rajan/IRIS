#!/usr/bin/env node
// Iris Bench renderer: scene.json (spec.Scene) -> PNGs + views.json (spec.View list), headless and deterministic.
//
//   node bench/render/render.mjs scene.json --focus e1,e2 --out DIR [--views A,B,C] [--style shaded|hidden-line|xray]
//        [--seed N] [--fix '{"element":"e2","dz":0.4}'] [--width 1024] [--tag NAME]
//   node bench/render/render.mjs --jobs jobs.json [--result out.json]      (many jobs, one browser)
//
// A job is {scene_path, focus, out_dir, views, style, seed, fix, width, tag}. Per view it writes
// <tag>_<view>.png and <tag>_<view>.id.png into out_dir and merges the views into out_dir/views.json; image paths are
// relative to the scene's folder (spec.View). The result (stdout or --result) is one list of View dicts per job.
// Chromium runs with SwiftShader (--use-gl=swiftshader), so the same job gives the same bytes on the same machine.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THREE_DIR = path.join(HERE, "node_modules", "three");
const ORIGIN = "http://bench.local";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1]; i++; } else a._.push(argv[i]);
  }
  return a;
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => process.stderr.write(`page error: ${e.message}\n`));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const file = p.startsWith("/three/") ? path.join(THREE_DIR, p.slice("/three/".length)) : path.join(HERE, p.slice(1));
    if (!file.startsWith(HERE) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: fs.readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/render.html`);
  await page.waitForFunction(() => window.benchReady === true, null, { timeout: 60000 });
  return page;
}

async function runJob(page, job) {
  const scenePath = path.resolve(job.scene_path);
  const sceneDir = path.dirname(scenePath);
  const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
  const outDir = path.resolve(job.out_dir || path.join(sceneDir, "render"));
  fs.mkdirSync(outDir, { recursive: true });
  const tag = job.tag || job.focus.join("-");
  const res = await page.evaluate((j) => window.benchRender(j), {
    scene, focus: job.focus, views: job.views || ["A", "B", "C"], style: job.style || "shaded",
    seed: job.seed ?? scene.seed ?? 0, fix: job.fix || null, width: job.width || 1024,
  });
  const views = [];
  for (const v of res) {
    const img = path.join(outDir, `${tag}_${v.name}.png`), idImg = path.join(outDir, `${tag}_${v.name}.id.png`);
    fs.writeFileSync(img, Buffer.from(v.png, "base64"));
    fs.writeFileSync(idImg, Buffer.from(v.id_png, "base64"));
    views.push({ name: v.name, image: path.relative(sceneDir, img), id_image: path.relative(sceneDir, idImg),
      labels: v.labels, colors: v.colors, visible_px: v.visible_px, focus: v.focus });
  }
  // views.json next to the PNGs: replace this job's entries, keep the others (other focus pairs of the scene).
  const vj = path.join(outDir, "views.json");
  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(vj, "utf8")); } catch { prior = []; }
  const mine = new Set(views.map((v) => v.image));
  fs.writeFileSync(vj, JSON.stringify([...prior.filter((v) => !mine.has(v.image)), ...views], null, 2));
  return views;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let jobs;
  if (args.jobs) jobs = JSON.parse(fs.readFileSync(args.jobs, "utf8"));
  else {
    if (!args._[0] || !args.focus) { console.error("usage: render.mjs scene.json --focus e1,e2 --out DIR | --jobs jobs.json"); process.exit(2); }
    jobs = [{ scene_path: args._[0], focus: args.focus.split(","), out_dir: args.out, views: args.views ? args.views.split(",") : undefined,
      style: args.style, seed: args.seed !== undefined ? Number(args.seed) : undefined, fix: args.fix ? JSON.parse(args.fix) : null,
      width: args.width ? Number(args.width) : undefined, tag: args.tag }];
  }
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const results = [];
  try {
    const page = await openPage(browser);
    for (const job of jobs) {
      const t0 = Date.now();
      try { results.push(await runJob(page, job)); }
      catch (e) { results.push({ error: String(e && e.message || e) }); }
      process.stderr.write(`rendered ${job.scene_path} [${job.focus}] in ${Date.now() - t0} ms\n`);
    }
  } finally { await browser.close(); }
  const text = JSON.stringify(results);
  if (args.result) fs.writeFileSync(args.result, text); else process.stdout.write(text + "\n");
  if (results.some((r) => r && r.error)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
