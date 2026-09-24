# Jevry brand assets

The identity pairs a full-height J stem and hook with a smaller detached northeast arrow: direction and action, with a recognizable initial. The 64-unit master keeps the full-height J stem intact and places a smaller, detached arrow above it. All marks are original SVG geometry; wordmarks use genuine Manrope glyph outlines. No generated raster logo, external rendering dependency, or live font is needed to display the SVG assets.

## Files

All public URLs below begin with `/brand/`.

| Asset | Use |
| --- | --- |
| `mark-ink.svg` | Standalone mark on porcelain or citron surfaces |
| `mark-porcelain.svg` | Standalone mark on dark surfaces |
| `mark-citron.svg` | Signature mark on ink surfaces |
| `wordmark-{ink,porcelain,citron}.svg` | Lowercase outlined wordmark, without symbol |
| `lockup-{ink,porcelain,citron}.svg` | Horizontal symbol and outlined wordmark |
| `app-icon.svg` | 1024 × 1024 vector app icon, ink tile and citron mark |
| `app-icon.png` | 1024 × 1024 RGBA app icon; identical to `build/icon.png` |
| `favicon.svg` | Compact ink tile with citron mark |
| `social-card.svg` | 1200 × 630 vector sharing artwork; all type outlined |
| `social-card.png` | 1200 × 630 sharing artwork for platforms requiring raster images |
| `manrope-latin-variable.woff2` | Self-hosted Manrope variable font, weights 200–800, basic Latin/Latin-1 subset |
| `Manrope-OFL.txt` | Manrope's SIL Open Font License, included with the font and derived outlines |

## Color and typography

- Porcelain: `#f5f3ed`
- Ink: `#20221f`
- Citron: `#d6ef83`
- Wordmark: lowercase Manrope, weight 650, tightened tracking, converted to paths.
- Product UI: full Manrope variable TTF at `/fonts/Manrope-Variable.ttf`, with a system sans-serif fallback. The WOFF2 in this kit is an alternate Latin subset.

Use ink on citron or porcelain. Reserve citron and porcelain marks for ink backgrounds. Citron on porcelain does not have sufficient contrast for meaningful UI. Keep clear space of at least 16 units around the 64-unit master, outside its viewBox when necessary. Use the favicon tile at very small sizes; use the standalone mark at 20 CSS pixels or larger when space permits. Do not stretch the symbol, add outlines, reconnect its two parts, or rotate the arrow independently.

## Shared React geometry

Use `viewBox="0 0 64 64"` and `fill="currentColor"` with these two paths, in this order:

```svg
<path d="M31 26H45V43C45 56 36 62 22 62H7V49H21C28 49 31 46 31 40Z" />
<path d="M44 2H62V20H55V14L45 24L38 17L48 7H44Z" />
```

For an ornamental mark inside a labeled control, set `aria-hidden="true"`. For a standalone meaningful logo, give the SVG an accessible name. The file assets include their own SVG title.

## Sources, verification, and limitations

Manrope was sourced from the Google Fonts `ofl/manrope` directory at `https://github.com/google/fonts/tree/main/ofl/manrope`. Its variable outlines were instantiated with FontTools at weight 650 for wordmarks; social typography also uses 450. The alternate WOFF2 was subset to U+0020–U+00FF. Text outside that range requires a broader font such as the bundled full variable TTF or a suitable fallback. Original upstream font copyright and license information remains in the supplied OFL file.

PNG derivatives were rendered directly from the SVG masters with resvg. The 1024-pixel app icon and 1200 × 630 social card were visually inspected. SVG files were parsed and rendered as a batch; raster dimensions and equality of the two app-icon PNG files were checked. Outlined wordmark paths remove font availability risk in exported artwork. Live UI text uses the full variable TTF in `public/fonts/`, with a sans-serif fallback. The kit’s WOFF2 is a separate Latin subset.

These assets do not constitute a trademark registration or clearance search. `build/icon.png` affects future packaged builds. Existing app bundles and release artifacts have not been changed. Social artwork is ready to use but is not published or automatically wired to a public site's sharing metadata.
