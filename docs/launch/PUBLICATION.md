# Public snapshot and publication record

Prepared September 24, 2026. Public repository: https://github.com/michaelswissa/jevry

## What is published

A fresh source snapshot including the current working-tree UI/brand changes, source code, tests, pinned dependency lockfile, third-party notices, an MIT license for original code, documentation, and selected public demo assets. Private development history is retained locally and is not pushed.

The original developer checkout and beta.4 packaged app remain intact. The public snapshot uses current-user home resolution in four opt-in macOS live-test harnesses instead of the developer's absolute home path. No game-control logic was changed for the launch.

## Exclusions

No `.env` files, connection archives, browser profiles, cookies, user conversations, local logs, private raw benchmark artifacts, upstream clones, dependency directories, generated build directories, or existing installers are published. Historical reports retain descriptions of failed and interrupted attempts; links to private local artifacts are rendered as clearly labeled local references instead of broken public download links.

Public benchmark fixture credentials in the WebArena localhost configuration are synthetic fixture defaults, not personal service credentials. Example credential-bearing URLs in tests are deliberate negative test cases.

## Security checks

Gitleaks inspected 15 local historical commits. One generic-key detection was an ordinary sentence about unverified API inference and Firecrawl/Ego comparisons, not a secret. The public snapshot rewrites that sentence to remove scanner ambiguity. A fresh Gitleaks directory scan found no leaks. This is a scoped automated scan plus manual review, not an absolute guarantee that no security issue exists.

Selected published screenshots and the video framing were visually reviewed. The supplied original full-screen recording stays private.

## Launch destinations

Published repository: https://github.com/michaelswissa/jevry

Published source-preview release with demo assets: https://github.com/michaelswissa/jevry/releases/tag/v0.4.0-beta.13

GitHub secret scanning, push protection, vulnerability alerts, and private vulnerability reporting are enabled. Other channels require a confirmed publication URL before they are listed as posted.

LinkedIn was signed in as Michael Swissa during preparation. X, Hacker News, and Product Hunt showed login requirements. A browser-owned notification prompt subsequently returned browser control to the user; publishing through that browser remains pending until the user resolves it and confirms resumption.

Hacker News requires the founder to write their own submission and comments under its current prohibition on generated/AI-edited text. Ready-to-adapt copy for other channels and a sourced seven-day plan are included in this folder.

## Frozen snapshot checks

`npm ci` completed with zero reported dependency vulnerabilities. `npm test` passed 571 tests with 100 default opt-in skips; `npm run build` passed; `npm run test:engine-browser` passed all 120 selected Chromium checks. The real Electron desktop workflow passed nine checks, and native research passed eight checks. Providers in these acceptance workflows are deterministic local fixtures, not a live quality measurement.

The native verification-assistance smoke workflow also passed on owned, intercepted local fixtures. This does not establish success against live verification providers. The GitHub macOS/Windows matrix started after publication; local checks above are distinct from hosted CI.

## First hosted Windows run

The first Windows CI run failed five provider tests: four fixtures mixed hard-coded POSIX expected paths with host-native path construction, and one asserted POSIX permission bits on Windows. The fixture paths now use the host path helper. The POSIX-only mode assertion runs on POSIX hosts; real file contents, cancellation drainage, and deletion are still checked on Windows. Windows ACL isolation is not established by that test. No production provider or game logic changed. The original failed CI run remains available in GitHub Actions.
