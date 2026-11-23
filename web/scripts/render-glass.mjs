// Renders Iris's glass stills with the same three.js code as the live hero (src/glass.ts, through
// scripts/render-glass.html on a Vite dev server) in headless Chromium on the real GPU (SwiftShader if that fails):
//   web/public/hero/aperture.webp the hero's poster and no-WebGL picture: the aperture on its pedestal (white, < 200 KB)
//   web/public/glass/<shape>.webp aperture, ring, pill (transparent, 2x, under 120 KB each)
// Usage (from web/): node scripts/render-glass.mjs [--only ring,pill] [--preview <dir>] [--t <seconds>]
// Playwright comes from PLAYWRIGHT_FROM (a package.json whose node_modules has playwright) or this package.
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const web = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt("--only")?.split(",");
const preview = opt("--preview");
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${web}package.json`);
const { chromium } = require("playwright");

/** What to render: [file, shape, hero, width, height, transparent, max bytes]. The hero's aspect is GLASS_EXTENT.hero's. */
const JOBS = [
  ["public/hero/aperture.webp", "aperture", true, 1056, 1200, false, 200_000],
  ["public/glass/aperture.webp", "aperture", false, 480, 480, true, 120_000],
  ["public/glass/ring.webp", "ring", false, 480, 480, true, 120_000],
  ["public/glass/pill.webp", "pill", false, 480, 480, true, 120_000],
].filter(([file, shape]) => !only || only.includes(shape) || only.some((o) => file.includes(o)));
const at = Number(opt("--t") ?? 0);

const GPU = [["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]];

const server = await createServer({ root: web, logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
let browser;
for (const flags of GPU) {
  try {
    browser = await chromium.launch({ headless: true, args: flags });
    const p = await browser.newPage();
    const gl = await p.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    await p.close();
    if (gl) { console.log("GPU flags:", flags.join(" ")); break; }
    await browser.close(); browser = undefined;
  } catch (e) { console.warn("launch failed with", flags.join(" "), String(e).split("\n")[0]); browser = undefined; }
}
if (!browser) { await server.close(); throw new Error("no WebGL in headless Chromium"); }
try {
  for (const [file, shape, hero, w, h, transparent, max] of JOBS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error(shape, e.message));
    await page.goto(`${base}/scripts/render-glass.html?shape=${shape}&hero=${hero ? 1 : 0}&t=${at}&w=${w}&h=${h}&transparent=${transparent ? 1 : 0}`);
    await page.waitForFunction(() => window.glassStill, null, { timeout: 60_000 });
    let bytes;
    for (let q = 0.9; q >= 0.3; q -= 0.06) {
      const url = await page.evaluate((qq) => window.glassStill.snapshot("image/webp", qq), q);
      bytes = Buffer.from(url.split(",")[1], "base64");
      if (bytes.length <= max) { console.log(file, `${w}x${h}`, `q=${q.toFixed(2)}`, `${(bytes.length / 1024).toFixed(0)} KB`); break; }
    }
    if (bytes.length > max) throw new Error(`${file} stays over ${max} bytes`);
    await writeFile(`${web}${file}`, bytes);
    if (preview) {
      const url = await page.evaluate(() => window.glassStill.snapshot("image/png"));
      await writeFile(`${preview}/${file.split("/").slice(1).join("-").replace(".webp", ".png")}`, Buffer.from(url.split(",")[1], "base64"));
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
