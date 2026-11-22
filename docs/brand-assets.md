# Iris brand assets

Iris by Techjays has a deliberately small kit in [`assets/brand/iris/`](../assets/brand/iris/): hand-written SVGs and
colour tokens, no build step. The app carries its own copies of what it uses (`web/public/brand/`, `web/public/favicon.svg`,
`web/src/Brand.tsx`), so the kit is the reference, not a dependency.

## The mark

An eye seen front-on: a **ring** (the iris) round a solid **pupil** with a **six-bladed aperture** cut through it, the
hexagonal opening of a camera stop. It reads at 16 px as a ringed dot and at full size as a lens, which is the
question Iris asks: does AI truly see? The wordmark sets the mark beside the word "Iris"; "by Techjays" is set as plain
supporting text next to it (in the app's header and footer), not drawn into the artwork.

| Colour | Value | Use |
| --- | --- | --- |
| Navy | `#052640` | The mark and wordmark on light backgrounds; the app's accent |
| White | `#FFFFFF` | The mark and wordmark on dark backgrounds |
| Ink | `#11161B` | Body text |
| Paper | `#F5F7F8` | Light surface |
| Line | `#DDE3E7` | Dividers |
| Muted | `#52636E` | Supporting copy |

Clear space round the artwork is a quarter of its height. Supporting text uses the system sans-serif; no font files
are shipped.

## Files

| File (`assets/brand/iris/`) | What it is |
| --- | --- |
| `svg/iris-mark-light.svg`, `svg/iris-mark-dark.svg` | The mark: navy for light backgrounds, white for dark |
| `svg/iris-mark-currentcolor.svg` | The mark in `currentColor`, for inline use that inherits text colour |
| `svg/iris-wordmark-light.svg`, `svg/iris-wordmark-dark.svg`, `svg/iris-wordmark-currentcolor.svg` | Mark plus "Iris", in the same three variants |
| `svg/favicon.svg` | The favicon (adapts to light and dark) |
| `svg/app-icon.svg`, `svg/app-icon-maskable.svg` | App icons; the maskable one keeps the mark inside the safe area |
| `svg/safari-pinned-tab.svg` | Single-colour pinned-tab icon |
| `svg/spinner.svg` | The loading spinner (used as a CSS mask) |
| `svg/og.svg` | The social card source |
| `tokens/iris-colours.json`, `tokens/iris-tokens.css` | The colours above as JSON and CSS custom properties |

"Light" and "dark" name the background the file is meant for.

## In the app

- **Header and footer:** the wordmark with "by Techjays" beside it (`web/src/Brand.tsx`, `About.tsx`). On the desktop the
  wordmark hangs from the model's top edge in a notch; phones and tablets keep a compact bar.
- **Loading:** every `.spinner` is `web/public/brand/iris-spinner.svg` as a CSS mask. Loading states read live state;
  nothing advances on a timer, and no animation stands in for a geometry result.
- **Icons:** `web/public/favicon.svg` and `web/public/brand/` (ICO, Apple touch, Android, maskable, manifest, pinned tab,
  `og.png`); theme colour navy.
- **Report:** the PDF cover carries the wordmark in navy.
- Reduced motion stills the spinner.

## Other people's logos

The landing names the formats and tools Iris works with by their own logos. They are their owners' trademarks, not
Iris's:

| Logo | Whose | File (`web/public/logos/`) |
| --- | --- | --- |
| IFC | buildingSMART International | `ifc.png` |
| BCF | buildingSMART International | `bcf.png` |
| Navisworks | Autodesk | `navisworks.png` |
| MCP | the Model Context Protocol | `mcp.png` |
| STEP | none of its own: drawn for Iris, a staircase block in isometric | `step.svg` |
| PDF | none of its own: drawn for Iris, a page with its corner folded | `pdf.svg` |

Each sits beside words that say the same, so each has an empty `alt`. The footer says whose they are and that Iris is
not affiliated with or endorsed by them. The list is `web/src/landing/logos.ts`; a web test checks every file is there.
