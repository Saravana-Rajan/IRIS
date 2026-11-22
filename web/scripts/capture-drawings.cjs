// The start screen's "2D drawing reader" clip, and (--clash) the 3D clash check as a video: recorded in Iris's own app
// the way a visitor tries it, as an animated WebP time-lapse and an MP4 for the hackathon video.
//
// Drawings (the default): the start screen, "Try the sample drawings", the sample building opening (sped up), the
// Drawings step with its two sample sheets; the clean sheet read with AI (its boxes on the sheet, the items, the
// status chips), then the sheet with planted mismatches read, its Mismatches tab, and one mismatch shown on the sheet
// (zoomed in on). Reading a sample sheet replays its saved Gemini reading ($0, no model call). The sample project's
// check runs meanwhile, as it does for a visitor (its clash titles come from Gemini Flash).
// --clash: "Try the sample building", its models opened and checked (sped up), the clashes found in 3D, the first one
// in the list picked.
// Each run uses a fresh browser (no saved projects), so it starts as a first visit and makes a new sample project.
// A pointer is drawn on the page (the recording has none) and glides to what is clicked. The encoder (`timelapse.py`,
// Pillow from the server's environment, ffmpeg for the MP4) speeds every wait for the app up, stamps the speed on
// those frames, cuts the moments the screenshots took, and holds the end.
//
//   cd web && npm run build
//   cd server && uv run uvicorn iris.app:app --port 8765 --reload --reload-dir iris      (serves web/dist)
//   node web/scripts/capture-drawings.cjs [--url http://localhost:8765] [--out-mp4 <dir>] [--shots <dir>]
//        [--webp <path>] [--keep] [--gpu] [--clash] [--size 1280x800] [--scale 2] [--no-pointer]
//   node web/scripts/capture-drawings.cjs [--clash] --from <kept folder>      (encode a kept recording again)
//
// Writes web/public/demos/drawings.webp (1000 px wide, 16:10) and drawings-still.webp (its last frame, for people who
// ask for less motion; --webp <path> writes them elsewhere, the still beside it) and <out-mp4>/iris-drawings.mp4
// (1920 px wide, H.264; default folder ~/Downloads/Iris-demo). --clash writes <out-mp4>/iris-3d-clash.mp4 (its WebP
// goes to the recording's temporary folder unless --webp names one). --shots <dir> saves a screenshot of each step
// (01-start.png …). --keep keeps the frames and the times, and --from encodes them again (another pace) without
// recording. --size and --scale set the window (CSS pixels) and its pixel ratio: 1280x800 at 2 keeps the words
// readable at 1000 px and sharp in the MP4. --gpu draws the 3D models with the machine's graphics card instead of
// SwiftShader (Metal on a Mac: smooth 3D, and shorter stalls). Playwright comes from web/node_modules, or NODE_PATH.
// The browser console's errors and failed requests are printed at the end.
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const URL = arg("--url", "http://localhost:8765");
const CLASH = process.argv.includes("--clash"), KEEP = process.argv.includes("--keep"), FROM = arg("--from", "");
const POINTER = !process.argv.includes("--no-pointer");
const SHOTS = arg("--shots", "");
const ROOT = path.resolve(__dirname, "..", "..");
const MP4_DIR = arg("--out-mp4", path.join(os.homedir(), "Downloads", "Iris-demo"));
const NAME = CLASH ? "clash" : "drawings";
const MP4 = path.join(MP4_DIR, CLASH ? "iris-3d-clash.mp4" : "iris-drawings.mp4");
const WEBP = arg("--webp", CLASH ? "" : path.join(ROOT, "web", "public", "demos", "drawings.webp"));
const GL = process.argv.includes("--gpu")
  ? ["--enable-gpu", "--ignore-gpu-blocklist", `--use-angle=${{ win32: "d3d11", darwin: "metal" }[process.platform] ?? "vulkan"}`]
  : ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];
// The window (a desktop layout), its pixel ratio, the clip's width (the start screen's player, 16:10), the WebP's and
// the MP4's frames a second and widths, and where the speed sits (fractions; y is the badge's bottom edge).
const [VW, VH] = arg("--size", "1280x800").split("x").map(Number);
const VIEW = { width: VW, height: VH }, SCALE = Number(arg("--scale", "2"));
const WIDTH = 1000, FPS = 10, MP4_WIDTH = 1920, MP4_FPS = 30, BADGE = "0.015,0.975";
const GRAB_MS = 1000 / 12;   // a frame every 83 ms while recording
// A wait for the app longer than its `target` (seconds on screen) is sped up to about that; shorter ones play as
// they happened. A target of 0 cuts the moment (a screenshot being taken).
const SPEEDS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200];

/** The pace, [from, to, speed]: real time, except each wait for the app sped up to about its target length. */
function paceOf(at) {
  const segs = [];
  let t = at.start;
  for (const [a0, b0, target] of at.waits) {
    if (b0 <= t) continue;
    if (target === 0) {
      if (a0 > t) segs.push([t, a0, 1]);
      t = b0;
      continue;
    }
    const a = Math.max(t, a0 + 0.5), b = b0 - 0.2;   // the wait seen starting, and ending as it happens
    if (b - a <= target * 1.5) continue;
    const speed = SPEEDS.find((s) => (b - a) / s <= target) ?? SPEEDS[SPEEDS.length - 1];
    if (a > t) segs.push([t, a, 1]);
    segs.push([a, b, speed]);
    t = b;
  }
  segs.push([t, at.end, 1]);
  return segs.filter(([a, b]) => b - a > 0.05);
}

/** The frames: the whole window at full scale (a screencast sends it at its CSS size), about 12 a second, each named
 * with the time it shows. */
async function grab(ctx, page, dir, t0) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page); let n = 0, on = true;
  const clip = { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: SCALE };
  const loop = (async () => {
    while (on) {
      const a = Date.now();
      try {
        const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, clip });
        const t = ((a + Date.now()) / 2 - t0) / 1000;
        fs.writeFileSync(path.join(dir, `f${String(n++).padStart(5, "0")}_${t.toFixed(3)}.jpg`), Buffer.from(data, "base64"));
      } catch { break; }   // the page closed
      await new Promise((r) => setTimeout(r, Math.max(0, GRAB_MS - (Date.now() - a))));
    }
  })();
  return async () => { on = false; await loop; };
}

/** A pointer drawn on the page (headless has none): an arrow that glides to where the mouse goes and dips on a click. */
const POINTER_JS = `(() => {
  const add = () => {
    if (document.getElementById("rec-pointer")) return;
    const p = document.createElement("div");
    p.id = "rec-pointer";
    p.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.6 15 Z" fill="#0f1e32" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    p.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;margin:-2px 0 0 -3px;pointer-events:none;z-index:2147483647;"
      + "transition:transform .42s cubic-bezier(.3,.7,.3,1);transform:translate(-60px,-60px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))";
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;"
      + "border:3px solid rgba(37,99,235,.85);pointer-events:none;z-index:2147483646;opacity:0;transform:scale(.4)";
    document.documentElement.append(ring, p);
    let x = -60, y = -60;
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; p.style.transform = "translate(" + x + "px," + y + "px)"; }, true);
    addEventListener("mousedown", () => {
      ring.style.left = x + "px"; ring.style.top = y + "px";
      ring.animate([{ opacity: 1, transform: "scale(.4)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 650, easing: "ease-out" });
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
})()`;

/** The browser's complaints: console errors and warnings, page errors, failed requests and error responses. */
function watch(page) {
  const seen = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") seen.push(`console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => seen.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => seen.push(`requestfailed: ${r.method()} ${r.url()} (${r.failure()?.errorText ?? "?"})`));
  page.on("response", (r) => { if (r.status() >= 400) seen.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });
  return seen;
}

/** Stop at an error line on the page, with what it says. */
async function noAlert(page, where) {
  const alert = page.locator('.proj-shell-alert[role="alert"], .dwg-alert[role="alert"]');
  if (await alert.count()) throw new Error(`${where}: the page shows an error: ${(await alert.first().innerText()).trim()}`);
}

const words = (s) => s.replace(/\s+/g, " ").trim();

async function record(browser, tmp) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
  if (POINTER) await ctx.addInitScript(POINTER_JS);
  const page = await ctx.newPage();
  const seen = watch(page);
  const t0 = Date.now(), at = { run: NAME, waits: [], log: {} };
  const now = () => (Date.now() - t0) / 1000;
  const mark = (m) => { at[m] = now(); console.log(`  ${at[m].toFixed(1)} s ${m}`); };
  /** Wait for the app (sped up in the clip when long): about `target` seconds on screen. */
  const wait = async (label, target, fn) => {
    const a = now(); const out = await fn(); const b = now();
    at.waits.push([a, b, target]); console.log(`  ${a.toFixed(1)}–${b.toFixed(1)} s waited: ${label}`);
    return out;
  };
  const pause = (s) => page.waitForTimeout(s * 1000);
  const shot = (name) => SHOTS ? wait(`screenshot ${name}`, 0, () => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })) : null;
  /** Glide the pointer to `loc` (at `dx` px from its left edge when given, else its middle) and click it. */
  const clickOn = async (loc, dx) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`nothing to click: ${loc}`);
    await page.mouse.move(b.x + (dx ?? b.width / 2), b.y + b.height / 2);
    await pause(0.5);   // the drawn pointer's glide
    await page.mouse.down(); await page.mouse.up();
  };
  /** Rest the pointer somewhere harmless (no tooltip, no hover). */
  const rest = async (x, y) => { await page.mouse.move(x, y); await pause(0.45); };

  await page.goto(URL);
  const startBtn = page.locator(CLASH ? '[data-start="sample"]' : '[data-start="sample-drawings"]');
  await startBtn.waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.mouse.move(VIEW.width * 0.62, VIEW.height * 0.82);
  await pause(0.8);
  const stop = await grab(ctx, page, path.join(tmp, "app"), t0);
  mark("start");
  await shot("01-start");
  await pause(1.0);
  await clickOn(startBtn); mark("click");

  if (CLASH) {
    // The models open and are checked (sped up); the clashes found in 3D; the first one in the list picked.
    await pause(1.0);
    await rest(VIEW.width * 0.5, VIEW.height * 0.9);
    await shot("02-loading");
    await wait("open and check the sample building", 5, () =>
      page.waitForSelector("button.clash-main", { timeout: 300000, state: "attached" }));
    await noAlert(page, "after the check");
    mark("listed"); await pause(2.5);
    await shot("03-clashes");
    const first = page.locator("button.clash-main").first();
    at.log.clash = words(await first.innerText());
    await clickOn(first, 50); mark("clash");
    await pause(0.6);
    const right = await page.locator("main.stage").first().boundingBox().catch(() => null);
    await rest(right ? right.x + right.width * 0.82 : VIEW.width * 0.6, right ? right.y + 90 : 90);   // off the list, clear of the model
    await pause(4.5);
    await shot("04-clash");
    await noAlert(page, "after picking the clash");
    await pause(0.8);
    mark("end");
  } else {
    // Loading: the sample project is made, its models opened (WebGL), the sheets attached; the step shows a spinner.
    await page.locator('[data-drawings="opening"], section.proj-drawings').first().waitFor({ timeout: 60000 }).catch(() => {});
    await pause(1.0);
    await rest(VIEW.width * 0.5, VIEW.height * 0.92);
    await shot("02-loading");
    const sheets = page.locator("nav.dwg-sheets button.dwg-sheet");
    const sheet = (name) => sheets.filter({ has: page.locator(".dwg-sheet-name", { hasText: new RegExp(`^${name.replace(/[.-]/g, "\\$&")}$`) }) }).first();
    await wait("open the sample building and attach the sheets", 4, async () => {
      await page.waitForFunction(() => document.querySelectorAll("nav.dwg-sheets button.dwg-sheet").length >= 2, null, { timeout: 300000, polling: 250 });
      await page.locator('[data-dwg="saved-badge"]').first().waitFor({ timeout: 60000 });
      await page.locator(".dwg-stage-note").first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
    });
    await noAlert(page, "after opening");
    mark("ready"); await pause(1.4);
    await shot("03-drawings");

    const readBtn = page.locator(".dwg-view-head button.btn", { hasText: /Read with AI|Read again|Reading/ }).first();
    const readSheet = async (name, n) => {
      if ((await sheet(name).getAttribute("aria-current")) !== "true") { await clickOn(sheet(name), 60); await pause(0.9); }
      await wait(`the page image of ${name}`, 1, () => page.locator(".dwg-stage-note").first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => {}));
      await wait("the read button free", 1, () => page.waitForFunction(() => {
        const b = [...document.querySelectorAll(".dwg-view-head button.btn")].find((x) => /Read with AI|Read again/.test(x.textContent ?? ""));
        return b && !b.disabled;
      }, null, { timeout: 300000, polling: 250 }));
      // A read lists the drawings again and runs the comparison with the model: wait for its answer too.
      const compared = page.waitForResponse((r) => /\/drawings\/compare/.test(r.url()) && r.request().method() === "GET", { timeout: 300000 });
      await clickOn(readBtn); mark(`read${n}`);
      await wait(`read ${name}`, 1.5, () => page.locator(".dwg-run.done").first().waitFor({ timeout: 300000 }));
      await noAlert(page, `after reading ${name}`);
      mark(`read${n}done`);
      await wait("the comparison", 1.2, () => compared.then(() => pause(0.3)));
      at.log[`read${n}`] = {
        sheet: name,
        line: words(await page.locator(".dwg-run.done").first().innerText()),
        saved: (await page.locator('[data-dwg="saved"]').count()) ? words(await page.locator('[data-dwg="saved"]').first().innerText()) : null,
        chips: (await page.locator(".dwg-chip").allInnerTexts()).map(words),
        tabs: (await page.locator('.dwg-tabs [role="tab"]').allInnerTexts()).map(words),
        rows: await page.locator(".dwg-table tbody tr").count(),
        boxes: await page.locator(".dwg-svg rect.dwg-box").count(),
      };
      console.log(`  ${JSON.stringify(at.log[`read${n}`])}`);
    };

    // The clean sheet: read, its boxes and items; the status chips: the items to check, then All again.
    await readSheet("Northbank-M-201.pdf", 1);
    await rest(VIEW.width * 0.55, VIEW.height * 0.12);
    await pause(1.6);
    const chips = page.locator(".dwg-chip");
    const toCheck = chips.filter({ hasText: /AI-read/ });
    if (await toCheck.count()) {
      await clickOn(toCheck.first()); await pause(1.6);
      await clickOn(chips.first()); await pause(0.7);
    }
    await shot("04-read-clean");

    // The sheet with planted mismatches: read, then its Mismatches tab.
    await readSheet("Northbank-M-201-mismatch.pdf", 2);
    await pause(1.2);
    await shot("05-read-mismatch");
    await clickOn(page.locator('[role="tab"][data-tab="mismatches"]')); mark("mismatches");
    await wait("the mismatch list", 1, () => page.locator("ul.dwg-mms li").first().waitFor({ timeout: 60000 }));
    await rest(VIEW.width * 0.55, VIEW.height * 0.12);
    await pause(2.0);
    const mms = page.locator("ul.dwg-mms li.dwg-mm");
    at.log.mismatches = (await mms.allInnerTexts()).map(words);
    console.log(`  ${at.log.mismatches.length} mismatch(es):\n    ${at.log.mismatches.join("\n    ")}`);
    await shot("06-mismatches");

    // One mismatch on the sheet: a size that differs (else the first that has a place on a sheet), zoomed in on.
    const onSheet = mms.filter({ has: page.getByRole("button", { name: "Show on sheet" }) });
    const differs = onSheet.filter({ hasText: /Size differs/ });
    const pick = (await differs.count()) ? differs.first() : onSheet.first();
    if (await pick.count()) {
      at.log.shown = words(await pick.innerText());
      await clickOn(pick.getByRole("button", { name: "Show on sheet" })); mark("show");
      await pause(1.0);
      const picked = page.locator(".dwg-svg rect.dwg-box.picked").first();
      const box = await picked.boundingBox().catch(() => null);
      if (box) {
        // Zoom in about the item with the wheel (the sheet zooms about the pointer), a step at a time.
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pause(0.6);
        for (let i = 0; i < 12 && ((await picked.boundingBox())?.width ?? 999) < 0.22 * VIEW.width; i++) {
          await page.mouse.wheel(0, -160); await pause(0.16);
        }
        const b = await picked.boundingBox();
        if (b) await rest(b.x + b.width + 40, b.y + b.height + 50);   // beside the box, so its tooltip stays shut
      }
      await pause(0.9);
      await shot("07-show-on-sheet");
    } else console.log("  no mismatch has a place on a sheet: nothing to show");
    await noAlert(page, "at the end");
    await pause(0.3);
    mark("end");
  }
  await stop();
  await ctx.close();
  at.console = seen;
  return at;
}

function encode(at, tmp) {
  const segments = paceOf(at);
  const webp = WEBP || path.join(tmp, `${NAME}.webp`);
  fs.mkdirSync(path.dirname(webp), { recursive: true });
  fs.mkdirSync(MP4_DIR, { recursive: true });
  console.log(`pace: ${segments.map(([a, b, s]) => `${a.toFixed(1)}–${b.toFixed(1)} s ×${s}`).join(", ")}`);
  execFileSync("uv", ["run", "-q", "python", path.join(__dirname, "timelapse.py"), path.join(tmp, "app"), webp, String(WIDTH), String(FPS),
    ...segments.map(([a, b, s]) => `${a.toFixed(2)}:${b.toFixed(2)}:${s}`)],
    { cwd: path.join(ROOT, "server"), stdio: "inherit",
      env: { ...process.env, BADGE, CROP: "", STILL: webp.replace(/\.webp$/, "-still.webp"), MP4, MP4_WIDTH: String(MP4_WIDTH), MP4_FPS: String(MP4_FPS) } });
}

(async () => {
  if (FROM) {
    const at = JSON.parse(fs.readFileSync(path.join(FROM, "times.json"), "utf8"));
    encode(at, FROM);
    return;
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium } = require("playwright");   // only to record: --from needs Pillow and ffmpeg alone
  const browser = await chromium.launch({ args: GL });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `iris-${NAME}-`));
  console.log(`${NAME}: recording ${URL} at ${VIEW.width}x${VIEW.height} x${SCALE}`);
  let at;
  try { at = await record(browser, tmp); } finally { await browser.close(); }
  fs.writeFileSync(path.join(tmp, "times.json"), JSON.stringify(at, null, 1));
  encode(at, tmp);
  console.log(at.console.length ? `browser console (${at.console.length}):\n  ${at.console.join("\n  ")}` : "browser console: clean");
  if (KEEP || !WEBP) console.log(`frames and times kept in ${tmp} (--from to encode again)`);
  else fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
