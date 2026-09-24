# Jevry

## Intent, in motion.

A little intent. A lot of possibility.

Jevry is a browser for doing: a place to explore the web, think with your models and turn a task into its next step. The identity is warm, clear and capable. Familiar controls carry the work; an original directional mark gives the browser its own presence.

## The identity

A long sweeping J meets a detached upper arrow. The introductory chrome sculpture is a supplied display image, generated directly from the user’s chrome reference. A separate flat vector translates its silhouette into a tall J with a softened curved foot and a smaller arrow. The two treatments are related visually, not geometrically identical.

Use `display-logo-chrome.png` for the sculpted introduction; use the supplied SVG artwork for flat identity and compact controls. The flat master uses a 64-unit square. Keep at least a quarter-mark width of clear space (16 units) and a minimum standalone size of 20 px digitally or 7 mm in print. Below 20 px, use the favicon tile.

Keep flat artwork upright and proportional. Do not reconnect the shapes, stretch the symbol, add an outline or rotate the arrow independently. The app icon is the approved enclosing tile. Preserve the composition of the sculpted display artwork. The interactive metal effect is a separate demonstration using the flat logo.

Lockups and wordmarks use genuine lowercase Manrope outlines at weight 650. Never retype a lockup. Vector outlines keep exported artwork independent of installed fonts.

## Color

| Color | Value | Purpose |
| --- | --- | --- |
| Ink | `#20221f` | Text, structure and dark identity backgrounds |
| Porcelain | `#f5f3ed` | Warm work surfaces |
| Citron | `#d6ef83` | Primary actions and marks on ink |
| Silver | `#b9bcb5` | Decorative material |
| Paper | `#fffefa` | Inputs and content panels |
| Muted | `#64665f` | Secondary text on light surfaces |
| Border | `#d8d9d0` | Quiet surface divisions |

Use ink on porcelain or citron; use porcelain or citron on ink. Citron lettering on porcelain is unsuitable for meaningful UI. Success, warning and error have separate semantic colors and readable labels. Silver never means success or progress.

## Typography and form

Manrope is the single expressive family. Large, tightly tracked headlines introduce the product; compact body text serves browsing. The active UI uses a locally hosted variable TTF, weights 200–800, with system sans-serif fallbacks. The included Latin WOFF2 is a smaller alternative subset. Font files and derived outlined artwork are supplied with Manrope’s SIL Open Font License.

Build with the spacing rhythm 4, 8, 12, 16, 24, 32, 48 and 64 px. Core radii are 6, 12 and 20 px, with pills for primary actions and search. Fine borders and changes of tone establish depth; shadows stay soft. Familiar Lucide line icons complement the custom identity.

## Surfaces

Setup combines a dark introduction and a light two-step connection form. The workspace places a light conversation rail beside a dark browser frame and native page. The new tab offers a left-aligned invitation and search field. The brand book is an editorial surface with contents navigation, identity specimens and interactive demonstrations.

Jevry is a desktop browser with a native minimum window of 950 × 660 px. The brand book separately adapts to mobile by stacking its content and removing the side index. Mobile brand-book behavior is not a claim of mobile browser support.

## Motion

Motion communicates a state or introduces the identity. All seven libraries.dev packages are present:

| Family | Installed version | Role |
| --- | --- | --- |
| Border beam | 1.4.0 | Connection and working-state boundaries |
| Thinking orbs | 0.3.2 | Small companion to a readable working label |
| Liquid metal | 2.0.10 | Interactive silver shader demonstration using the flat vector path |
| Bot avatars | 0.1.1 | Pebble companion and demonstration states |
| Liquid gooey | 0.2.2 | Book selection-control demonstration |
| Voice glow | 0.2.0 | Simulated level controlled by a slider |
| Image reveal | 0.5.1 | Book artwork reveal |

The voice demonstration does not open a microphone or capture audio. Image and selection demonstrations are not claims of operational browser capabilities. The book starts with effects paused. Play/Pause controls, system reduced motion and the saved app reduced-effects preference preserve a usable still presentation: vector mark, solid selection, readable status and ordinary image. Shared control and entrance timing tokens are 160 ms and 440 ms with exponential ease-out; effect libraries also have their own timing.

## Voice

Clear, warm, direct. Say what is happening and what someone can do next. Respect the user’s control.

- Say: “Connection failed. Check your key and try again.”
- Say: “I found three sources. Here’s where they agree.”
- Avoid: “Oops! Something magical went wrong.”
- Avoid: “The most powerful AI ever.”

Use completion language only after completion is observed. Do not promise privacy, speed or benchmark performance beyond the evidence.

## Accessible by design, verified in context

Use semantic controls, accessible names, keyboard focus and text alongside colored or animated status. Decorative artwork stays hidden from assistive technology; meaningful standalone identity gets a name. Motion must remain optional. These are implementation rules, not a blanket accessibility certification.

## Working files

The kit contains the sculpted chrome display image, standalone flat marks, outlined wordmarks, horizontal lockups, a 1024 px app icon, a 1200 × 630 social card, font assets and license, tokens and this guide. Use the ink, porcelain or citron variant that fits the background. Consult the asset manifest for individual filenames.

For implementation, `src/tokens.css` owns visual primitives, `src/brand.tsx` owns `DisplayMark`, the flat vector geometry and the separate metal demonstration, and the surface stylesheets own layout. `DESIGN.md` records the implemented system; `.impeccable/design.json` extends it with motion, breakpoints and component previews. `public/brand/` contains distributable artwork. The interactive book lives in `src/BrandBook.tsx`. Its titlebar entry is disabled while a browser task runs to preserve the active native page.

Review evidence belongs in `docs/brand/`; this guide makes no review-pass or leaderboard claim. Assets are original identity artwork, not a trademark clearance opinion. Existing packaged release bundles are separate from the source asset kit.
