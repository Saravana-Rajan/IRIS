# Iris brand assets

Iris by Techjays has a deliberately small kit in [`assets/brand/iris/`](../assets/brand/iris/): hand-written SVGs and
colour tokens, no build step. The app carries its own copies of what it uses (`web/public/brand/`, `web/public/favicon.svg`,
`web/src/Brand.tsx`), so the kit is the reference, not a dependency.

## The mark

**Aperture** (the owner's choice, Nov 22): an iris diaphragm drawn to exact geometry, six **holographic blades**
(the `--holo` gradient: #8f9bff, #b07af2, #ff5cd6, #7dd3fc) closing around an **ink hexagonal pupil** (#1a1a1a), so the
camera's iris and the eye's iris become one mark. The lockup sets the mark beside "Iris" in live text (IBM Plex Sans
500); Techjays is never drawn into the artwork: the sidebar's footer says "Built by Techjays" beside the small mark. The app draws it
inline (`web/src/Brand.tsx`: `ApertureMark`, `Lockup`, `AppIcon`); a one-colour version is the spinner's mask. The
earlier split-O (a ring round a pupil with a six-bladed cut) remains in the kit below for reference; the app no longer
shows it.

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

- **The app shell:** the mark and "Iris" at the top of the sidebar (the mark alone on its collapsed rail) and in the
  phone's and tablet's top bar (the name hidden there when the top bar has a middle); at the sidebar's foot the small
  mark and "Built by Techjays" (`BuiltBy`; the mark alone, with that tip, on the rail) (`web/src/AppShell.tsx`). While Iris works, the status line's mark opens
  and closes its blades.
- **Loading:** every `.spinner` is `web/public/brand/iris-spinner.svg` (the Aperture in one colour) as a CSS mask, filled with the
  `--holo` gradient (`frame.css`), so it turns in the holo colours; the
  boot splash in `web/index.html` draws the mark with its blades opening and closing. Loading states read live state;
  nothing advances on a timer, and no animation stands in for a geometry result.
- **Icons:** `web/public/favicon.svg` and `web/public/brand/` (`favicon.svg`, `favicon-32.png`, `favicon.ico`, the Apple
  touch icon, the Android and maskable icons rendered from the mark, the pinned tab, the manifest); theme colour white.
  `og.png` still shows the earlier mark.
- **Report:** the PDF cover carries the Aperture lockup (`document.LOCKUP`).
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
