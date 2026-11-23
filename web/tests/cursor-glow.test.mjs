import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { compiled } from "./app-host.mjs";

/** The cursor's pink glow (CursorGlow.tsx): when it follows, when it is a still wash, when it is off. */
const url = await compiled("../src/CursorGlow.tsx", { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") });
const js = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString().replace('import "./cursorGlow.css";', "");
const glow = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("it follows a fine pointer over the pages; a coarse pointer or less motion gets the still wash; else it is off", () => {
  const env = { on: true, hasWindow: true, reducedMotion: false, coarsePointer: false };
  assert.equal(glow.glowMode(env), "follow");
  assert.equal(glow.glowMode({ ...env, reducedMotion: true }), "still", "less motion: still");
  assert.equal(glow.glowMode({ ...env, coarsePointer: true }), "still", "phones and tablets: still");
  assert.equal(glow.glowMode({ ...env, on: false }), "off", "the 3D workspace: none");
  assert.equal(glow.glowMode({ ...env, hasWindow: false }), "off");
});

test("it eases toward the cursor (the trailing glow more slowly) and never snaps", () => {
  assert.equal(glow.ease(0, 100, glow.LEAD_EASE), 10);
  assert.ok(glow.TRAIL_EASE < glow.LEAD_EASE && glow.LEAD_EASE >= 0.08 && glow.LEAD_EASE <= 0.12);
  let x = 0;
  for (let i = 0; i < 10; i++) x = glow.ease(x, 100, glow.LEAD_EASE);
  assert.ok(x > 60 && x < 70, `after ten frames: ${x}`);
  assert.equal(glow.SPOTLIGHT, ".home-tile, .hiw-card");
});

test("one decorative layer that takes no clicks, off by default until mounted; still under reduced motion", async () => {
  const html = renderToStaticMarkup(h(glow.CursorGlow, { on: true }));
  assert.equal(html, '<div class="cursor-glow on" data-mode="off" aria-hidden="true"><i class="cg-lead"><b></b></i><i class="cg-trail"><b></b></i></div>');
  const css = await readFile(new URL("../src/cursorGlow.css", import.meta.url), "utf8");
  assert.match(css, /\.cursor-glow \{[^}]*position: fixed;[^}]*pointer-events: none;/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  assert.match(css, /radial-gradient\(closest-side, rgba\(255, 92, 214, \.14\)/, "pink at about .14");
});
