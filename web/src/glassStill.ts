import { createGlassStage } from "./glass";
import { GLASS_SHAPES, type GlassShape } from "./glassModel";

/**
 * The page scripts/render-glass.mjs opens (scripts/render-glass.html, on the Vite dev server only; not in the app's
 * build): one glass shape drawn by the same stage as the live hero (glass.ts), `w` × `h` pixels, at `t` seconds (`hero=1`: the
 * hero's aperture on its pedestal),
 * white taken out to transparency with `transparent=1`. It sets `window.glassStill.snapshot(type, quality)` (a data URL) when drawn.
 */
const q = new URLSearchParams(location.search);
const shape = (GLASS_SHAPES as readonly string[]).includes(q.get("shape") ?? "") ? q.get("shape") as GlassShape : "aperture";
const hero = q.get("hero") === "1";
const w = Number(q.get("w")) || 800, h = Number(q.get("h")) || 800, t = Number(q.get("t")) || 0;
const canvas = document.createElement("canvas");
canvas.style.width = `${w}px`;
canvas.style.height = `${h}px`;
document.body.append(canvas);
const stage = createGlassStage(canvas, { shape, hero });
stage.resize(w, h, 1);
/** The frame drawn on white, then white taken out (colour to alpha): exact over white, natural over light greys. The
 * glass is drawn on opaque white as in the live hero, so its transmission sees what it will sit on. */
function clearWhite(): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width; out.height = canvas.height;
  const g = out.getContext("2d")!;
  g.drawImage(canvas, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height), px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = 1 - Math.min(px[i], px[i + 1], px[i + 2]) / 255;
    if (a <= 0) { px[i + 3] = 0; continue; }
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(255 - (255 - px[i + k]) / a);
    px[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return out;
}
const clear = q.get("transparent") === "1";
const snapshot = (type = "image/webp", quality?: number) => {
  stage.render(t);
  return clear ? clearWhite().toDataURL(type, quality) : stage.snapshot(type, quality);
};
stage.render(t);
(window as unknown as { glassStill: unknown }).glassStill = { shape, snapshot };
