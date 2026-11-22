import { useId } from "react";
import "./demoClips.css";

/** The clips "See it work" plays (web/public/demos/): each an animated WebP of 1000 × 625 with a still of the same
 * size, shown instead when the visitor asks for reduced motion. */
export const DEMO_CLIPS = [
  { id: "check", label: "3D clash check", src: "/demos/check.webp", still: "/demos/check-still.webp",
    caption: "Northbank's check: the clashes found, numbered and listed.",
    alt: "Northbank's building models checked in Iris: each pair of models and each model against itself, then the clashes listed, numbered and grouped by check, beside the models in 3D." },
  { id: "drawings", label: "2D drawing reader", src: "/demos/drawings.webp", still: "/demos/drawings-still.webp",
    caption: "The sample sheets read by Gemini, checked against the PDF's own text, then compared with the 3D model.",
    alt: "Iris's 2D drawing reader on Northbank's sample mechanical sheet: the items Gemini read boxed on the page, marked as confirmed by the PDF's text or read by AI only, and the mismatches with the 3D model listed beside it." },
] as const;
export type DemoClip = (typeof DEMO_CLIPS)[number];

/**
 * "See it work": the two demo clips side by side, the 3D clash check and the 2D drawing reader, each with its label and
 * a one-line caption; stacked where there is no room for both (a phone, a narrow column); their stills under reduced
 * motion. Loaded lazily, sized so nothing shifts. Self-contained: no props, its own stylesheet; place it anywhere.
 */
export function DemoClips() {
  const id = useId();
  return (
    <figure className="demo-clips" data-start="see-it-work" aria-labelledby={`${id}-title`}>
      <h2 className="demo-clips-title" id={`${id}-title`}>See it work</h2>
      <div className="demo-clips-row">
        {DEMO_CLIPS.map((c) => (
          <figure key={c.id} className="demo-clip" data-clip={c.id}>
            <p className="demo-clip-label">{c.label}</p>
            <picture className="demo-clip-frame">
              <source media="(prefers-reduced-motion: reduce)" srcSet={c.still} />
              <img src={c.src} width={1000} height={625} loading="lazy" decoding="async" alt={c.alt} />
            </picture>
            <figcaption className="demo-clip-caption">{c.caption}</figcaption>
          </figure>))}
      </div>
    </figure>
  );
}
