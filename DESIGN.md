---
name: Jevry
description: "Intent, in motion."
colors:
  ink: "#20221f"
  porcelain: "#f5f3ed"
  paper: "#fffefa"
  citron: "#d6ef83"
  muted: "#64665f"
  border: "#d8d9d0"
  silver: "#b9bcb5"
  dark: "#191b18"
  dark-raised: "#2b2e28"
  dark-muted: "#b0b5a8"
  success: "#386239"
  danger: "#a33d2d"
  warning: "#805916"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(66px, 7.6vw, 112px)"
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(29px, 3.4vw, 46px)"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "13px"
    lineHeight: 1.8
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "12px"
rounded:
  sm: "6px"
  md: "12px"
  lg: "20px"
  pill: "999px"
spacing:
  '1': "4px"
  '2': "8px"
  '3': "12px"
  '4': "16px"
  '6': "24px"
  '8': "32px"
  '12': "48px"
  '16': "64px"
components:
  button-primary:
    backgroundColor: "{colors.citron}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
---

# Design System: Jevry

## Overview

**Creative North Star: "Intent, in motion"**

Intent becomes a clear next action. Warm porcelain, dense ink structure and a small citron signal make a capable browser feel approachable. The signature is a long, sweeping J with a detached upper arrow. A sculpted chrome display image introduces the identity; a separate flat vector translates its silhouette for compact controls and exported lockups.

Controls remain familiar and compact. Spacious editorial typography belongs to introductions and the brand book; browser chrome and conversation stay efficient. Color, text and actual product state carry meaning before animation does.

This document captures the implementation, rather than replacing it. `src/tokens.css` owns reusable visual primitives; `src/brand.tsx` owns flat mark geometry, `DisplayMark`, the metal demonstration and shared controls; `src/redesign.css` and `src/brandbook.css` own surface composition. `src/BrandBook.tsx` owns the interactive guide, `public/brand/` the exported artwork, and `docs/BRAND_ASSETS.md` the asset manifest. Refresh this snapshot and `.impeccable/design.json` when those sources change. `PRODUCT.md` remains the product truth; `docs/brand/DIRECTION.md` records the chosen direction.

**Key Characteristics:**

- Warm neutral work surfaces and dark browser structure.
- One expressive family, Manrope, with a compact operational hierarchy.
- Sculpted chrome display artwork and a related flat vector identity.
- Semantic controls and state-bound motion.

## Colors

Warm neutrals establish space; citron calls attention to an action; silver is material, not a status signal. Frontmatter values map directly to the `--j-` CSS tokens.

### Primary

- **Citron:** primary actions and signature marks against ink.
- **Ink:** primary text, strong controls, identity backgrounds.

### Neutral

- **Porcelain:** setup, conversation and editorial work surfaces.
- **Paper:** fields, content surfaces and specimen panels.
- **Muted / Border:** supporting text and quiet boundaries on light surfaces.
- **Dark / Dark raised / Dark muted:** browser frame, raised chrome and its secondary text.
- **Silver:** decorative material and the underlying metal mark.

### Semantic

Success, danger and warning are separate semantic tokens. Status includes text and, where implemented, a meaningful icon. Do not substitute citron for an error or warning.

**The Readable Signal Rule.** Put ink on citron or porcelain; reserve citron lettering for dark backgrounds.

## Typography

**Display Font:** Manrope, with sans-serif fallback.
**Body Font:** Manrope; the root stack continues through Apple system, BlinkMacSystemFont, Segoe UI and sans-serif. Individual surface declarations use the shorter Manrope/sans-serif stack.

The active UI loads the locally hosted variable TTF at `public/fonts/Manrope-Variable.ttf`, with weights 200–800 and `font-display: swap`. The kit’s `manrope-latin-variable.woff2` is an alternative Latin subset, not the active UI source. Supplied wordmarks are weight-650 glyph outlines and do not need a live font.

### Hierarchy

Frontmatter display and headline roles describe the brand book. Product surfaces intentionally use smaller contextual scales: setup headline 34–54 px at weight 500; new-tab headline 40–76 px at weight 500; conversation empty-state headline 30 px; most operational body and input text 12–13 px. Book body copy is 13 px with generous 1.8 line height. Supporting labels run 10–12 px, with some compact chrome below that range. This is an implementation inventory, not a blanket readability approval.

Headline tracking is generally −0.04 em. Body text uses natural tracking. The book’s printed type-scale labels are illustrative roles; actual rendered CSS is the implementation reference.

## Layout

Spacing follows the eight-step frontmatter scale. Density responds to purpose: compact browser chrome, comfortable forms, generous book spreads.

Setup uses a 43% story column beside a light form, within a 1500 px maximum shell; the story narrows to 38% at 1100 px. Workspace uses a 350 px conversation rail, reduced to 320 px at that breakpoint, beside the native browser page. Browser title bar and toolbar are 42 px and 51 px respectively. Preserve the native page measurement contract when changing surrounding chrome.

The desktop window minimum is 950 × 660 px in `desktop/main.ts`. Small-width CSS is a preview accommodation; it does not turn the Electron browser into a mobile product. Below 760 px the workspace retains a 290 px rail plus a page minimum of 300 px and can scroll horizontally.

The titlebar entry to the book is disabled during a running browser task, preserving the active native page. The brand book is independently responsive: an 80 px header, 184 px contents rail and asymmetrical hero on wide screens; at 1150 px the rail becomes 150 px; below 760 px it disappears and the content stacks. Mobile book navigation wraps, cards become single-column and the hero mark becomes faint decoration. Print removes fixed navigation and keeps specimens together.

## Elevation & Depth

Tonal separation and fine borders do most of the work. Shadows are ambient accents on search and compose surfaces; the metal demonstration uses a decorative drop shadow. Avoid treating every panel as a floating card.

### Shadow Vocabulary

- **Search ambient:** `0 8px 28px #20221f0c`.
- **Compose ambient:** `0 5px 18px #20221f08`.
- **Material mark:** `drop-shadow(0 14px 12px #0002)`.

## Shapes

Use small, medium and large radii from frontmatter, with deliberate contextual exceptions: setup shell and compose/specimen panels use 16 px; setup inputs use 8 px; tabs use 9 px upper corners. Pill forms identify actions and search. Lucide provides familiar line icons; the book specimen uses 20 px icons with 1.7 px strokes, while individual operational icons vary by role.

The flat mark occupies a 64-unit viewBox. Its tall J sweeps into a softened curved foot, with a smaller detached arrow above. Both path definitions live in `src/brand.tsx` and the exported SVG masters. Preserve those paths. The chrome display asset is a visual reference for this translation, not geometrically identical artwork. Clear space is one quarter of the master width (16 units); minimum standalone use is 20 CSS px or 7 mm in print. Use the supplied favicon below 20 px. Flat assets stay upright. Preserve the composition of the supplied sculpted display image. Do not rotate one path independently.

## Components

### Buttons

Confident, familiar pill controls. `BrandButton` exposes primary, secondary and quiet tones over native button semantics. Primary uses citron with ink and darkens to `#c7e36c` on hover. Secondary uses paper with a fine border; quiet is transparent. Disabled controls remain native disabled controls. Setup connect targets are at least 48 px high; secondary buttons default to 44 px, with deliberate smaller specimen overrides.

### Cards / Containers

Paper panels on porcelain, one-pixel borders and limited ambient depth. Provider cards use the medium radius and a 118 px minimum height; selected providers combine a pale green surface with a stronger border. Specimen panels use a 16 px radius, a visual stage and a separate descriptive caption.

### Inputs / Fields

Fields use paper, ink, a muted border and an 8 px radius. Search is a pill with a separate circular submit control. Global keyboard focus uses a 2 px olive outline with 4 px offset; search groups use their own focus-within treatment. Labels and error descriptions must remain semantic and readable. Do not infer complete accessibility compliance from the presence of a focus ring.

### Navigation

The browser uses ordinary tabs and an address bar. Brand book navigation uses named anchor regions, a skip link and a contents rail on desktop. Active mode buttons expose `aria-pressed`; the selection state remains a solid pill with motion disabled. Workspace tags use fine borders and restrained supporting text.

### Identity and motion

`DisplayMark` renders `public/brand/display-logo-chrome.png` in introductory placements. This static sculpted display asset was generated directly from the user-supplied chrome screenshot: a long sweeping J with the upper arrow. It is the source for the display appearance.

`Mark` is the separate aria-hidden flat vector for labeled compact contexts. Its softened curved foot translates the sculpture silhouette for small sizes; it is not an exact contour extraction. Standalone SVG downloads include titles; meaningful unlabeled instances require an accessible name. `MetalMark` is reserved for the interactive libraries.dev metal demonstration. It masks the real `metal-fx` shader with the flat vector path, keeps vector content underneath, and removes the library’s button substrate. That demonstration does not generate or replace the sculpted display image.

Installed package versions were read from `node_modules`, not inferred from version ranges:

| Package | Version | Implemented role |
| --- | --- | --- |
| `border-beam` | 1.4.0 | Connection activity and the running conversation composer; labeled book demonstration. |
| `thinking-orbs` | 0.3.2 | Working indicator beside readable status; selectable book demonstration. |
| `metal-fx` | 2.0.10 | Interactive demonstration: silver shader masked to the flat vector logo. |
| `bot-avatars` | 0.1.1 | Pebble companion in the empty conversation and book specimens. |
| `liquid-gooey` | 0.2.2 | Moving selection pill in the book’s Auto / Act / Research demonstration. |
| `voice-glow` | 0.2.0 | Slider-controlled simulated level in the book. No microphone capture. |
| `img-fx` | 0.5.1 | Lazy-loaded reveal of supplied social artwork in the book. |

These seven packages are integrated; not every demonstration is an operational browser feature. The book starts paused, offers Play/Pause and obeys both system reduced motion and the saved app reduced-effects setting. Reduced motion pauses canvas effects, disables the beam, substitutes a static mode pill and displays the image directly. Lazy image loading has a plain image fallback. Shared timing tokens are 160 ms, 440 ms and `cubic-bezier(.16,1,.3,1)`; individual libraries retain their own effect timing. The global reduced-motion CSS shortens transitions and CSS animations. Pause offscreen and idle animation when extending effects; do not claim that every library’s visibility behavior has been audited.

### Voice and accessibility

Copy is clear, warm and direct. Name the current state and next action: “Connection failed. Check your key and try again.” Avoid magical error language, superlatives and unverifiable guarantees. Example copy is guidance, not evidence that a specific runtime action has occurred.

The book provides native buttons/forms, named navigation, a skip link, labeled demo inputs, status announcements and explicit simulation descriptions. Pair status with words, preserve keyboard focus, and keep all effect meaning available without motion. Review screenshots and findings live in `docs/brand/`; documentation does not itself certify review completion or WCAG conformance.

## Do's and Don'ts

### Do:

- Do use the supplied outlined lockups and exact mark geometry.
- Do pair animated or colored status with readable text.
- Do preserve native browser bounds, connections, and user control.
- Do provide a still, usable result when motion is paused or reduced.

### Don't:

- Don’t use citron text on porcelain.
- Don’t stretch the mark, reconnect its two shapes, or independently rotate the arrow.
- Don’t imply that a labeled demonstration is a working service or microphone capture.
- Don’t invent speed, privacy, benchmark, or completion claims.
