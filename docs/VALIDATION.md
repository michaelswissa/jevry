# Validation record — 22 September 2026, 0.4.0-beta.2

**Developer preview; not a production release.** The beta has an Apple Silicon macOS DMG/ZIP and a cross-built Windows x64 NSIS installer. The release manifest (local artifact: `artifacts/release-v0.4.0-beta.2.json`) records the exact source/build identities, package hashes, runtime versions and limits. Neither platform has a distribution signature, and Windows execution remains untested.

- The final TypeScript, renderer and desktop build passed.
- **284/284 tests across 12 files passed with no skips**, with real Chromium enabled. The machine-readable report (local artifact: `artifacts/beta2-final-tests.json`) includes provider, conversation, encrypted-store, cancellation-ownership, engine, research and verification cases. Challenge coverage includes 17 actual Chromium fixtures.
- Five checks of the shared benchmark evaluator passed, including false-positive and failure-denominator regressions.
- The **actual packaged Mac application** passed 9 conversation, 8 research and 12 verification checks. Workflow output (local artifact: `artifacts/packaged-beta2-mac.log`) includes its version and build-identity result. These use deterministic local provider fixtures, not live service success claims.
- Packaged verification checks exercise real process-isolated frames, cropped image coordinates, transparent-frame backing/restoration, stale-frame refusal, manual continuation, hidden research handoff, inspection errors and shutdown.
- Both packaged applications embed the current version, main/preload bundles and renderer entry. An earlier beta.1 disposable-profile probe confirmed user data, default session and persistent browser-partition storage stay inside the temporary directory.
- A single real Claude image request located a synthetic visual target correctly in **6,588 ms**, with no retry or model substitution. Recorded result (local artifact: `artifacts/live-vision-beta.json`). This establishes one image transport/recognition path, not external CAPTCHA acceptance or a success-rate estimate.
- The idle local application was upgraded normally from v0.3.0 through beta.1 to beta.2. The final beta.2 renderer path, selected conversation and all eight visible user messages, existing tab and exact unsent draft were restored. No message/model request was submitted for the upgrades.

The first beta.2 packaged smoke attempt timed out after five seconds waiting for the initial onboarding heading while Windows packaging and a separate native provider test were active. The failure log is preserved (local artifact: `artifacts/packaged-beta2-mac.attempt1.log`). An unchanged serial rerun passed all 29 native checks. The first failure’s cause was not established; it is not presented as an uninterrupted pass.

The official Google test-mode integration (local artifact: `artifacts/official-recaptcha-beta2.json`) passed once with one click and zero vision calls. Google confirmed its test response. The two beta.1 attempts that exposed early handoff remain preserved; production image-challenge acceptance is still untested.

Follow-up context now includes bounded action receipts and terminal outcomes. Redirects wait for owned verification cleanup to drain, and unreadable connection/workspace/history archives are preserved. [Verification coverage](VERIFICATION.md) distinguishes a newly observed widget response from downstream server acceptance and overall task success.

The earlier v0.3.0 and beta.1 live comparisons are retained unchanged and do not measure beta.2. The latter met 15/15 requested criteria on both sides and had a lower Jevry median total, but higher research median and two disclosed overlapping native probes. Native Windows validation, clean two-platform CI, signing/notarization, update delivery and external CAPTCHA acceptance remain open in [production readiness](PRODUCTION_READINESS.md). There is no measured Ego performance result or established global speed win.

## Historical v0.2 snapshot

The following record describes the earlier v0.2 build only; its counts and unverified items are not the current candidate's status.

Development host: macOS on Apple Silicon. Windows process/path behavior has mocked coverage and a checked-in CI matrix; An unsigned Windows x64 NSIS installer was cross-built successfully on macOS; Windows runtime execution has not been performed here.

- TypeScript and production renderer/desktop builds pass.
- 92 default tests pass; eight browser tests are opt-in. All 27 engine tests pass when run with real Chromium, including shadow controls, search Enter, nested scrolling, same-origin frames, frame navigation invalidation and isolation guards.
- Conversation tests exercise serialized cancellation, superseded pending turns, late callback suppression, restart history, context retention, full latest-message preservation, planned field validation and factual changed-status answers.
- Storage tests ensure an unreadable archive is preserved rather than overwritten with empty history.
- The development runtime and packaged macOS v0.2 app both pass the Electron test using actual renderer/preload/main/native Chromium. It passes onboarding, encrypted secrets/history, two successive action turns, page-aware questions without actions, cited research, interruption by follow-up, history selection, and reopening tabs and conversations after restart. Provider responses are deterministic in this test.
- Actual saved Claude + Jev connections separately passed Paris/two → London/same guests → read-only follow-up. Each trial used a disposable profile containing only a copy of encrypted app settings; no keys were exposed. Six messages survived restart. Final trial times: 15.0s, 11.1s, 10.6s. Configuration and single-trial limits are recorded in [Competitive review](COMPETITIVE_REVIEW.md).
- Shared actual-source Jev execution fixtures passed 15/15 for Jevry and 6/15 for upstream Jev. Deterministic inference isolates supported control coverage; it does not establish reasoning quality or total speed superiority.
- The conversation renderer passed 16 interaction/accessibility checks at desktop and compact widths, with zero console errors. Screenshots were visually inspected.

Fresh private CLI installation, login flow, live inference through API providers, and live comparisons with Firecrawl/Ego, Windows runtime validation, signing, notarization and a production security audit remain unverified. The app has no fake connection or fabricated latency metrics.


_Public snapshot note: local run artifacts referenced above are retained by the maintainer and are not distributed in this repository. Their descriptions are historical reports, not independently downloadable evidence._
