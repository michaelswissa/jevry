# Next source-preview release checklist

Review baseline: public `main` at `78b0704` (September 30, 2026), compared with `v0.4.0-beta.13`. This is a working checklist, not a release announcement. The package version is still `0.4.0-beta.13`; no new version, installer, signing, or release is implied.

## Changes already on main since beta.13

| Change | Evidence and scope |
| --- | --- |
| Bounded HTTP rejection details retain HTTP status, redact credential-like content, and time out error-body reads after one second | `8fac503`, merged in #3; `desktop/jev-transport.test.ts`. Do not treat diagnostics as a guarantee that page/request content is private. |
| Parse TypeSafe nested `detail.message` and `detail.error_type`, including input-limit guidance | #4 and #5; `desktop/jev-transport.ts`. An unknown model and a context limit are distinct causes. |
| Share exactly repeated long form context without dropping choices or truncating content | #5; `desktop/jev-request-context.test.ts`. The recorded dense-form regression went from HTTP 400 to HTTP 200 with one trusted click. Unique large content can still exceed the model limit. |
| Stabilize test fixtures | Windows-native provider paths and POSIX-only mode assertion (`7fcad9a`); load the challenge document before delayed visibility (`bb24999` / #4); allow cold Chromium startup in browser tests (#5). These changes are not general runtime speed improvements. |
| Improve public orientation | Expanded setup/architecture/use-case docs, latest-design screenshots, and the 72-second introduction linked from the README. Screenshots are from a later local design; they do not prove that the tagged source contains that UI. |

See the [HTTP 400 investigation](../investigations/issue-1-http400.md) for retained failed attempts and the precise live regression. That evidence does **not** establish that issue #1’s original task is fixed. Do not rerun `test-live-http400.mjs --run-live` without approving model usage.

## Before tagging another preview

- [ ] Choose the exact candidate commit and version; reconcile package metadata and release notes. Preserve the beta.13 release record as historical evidence.
- [ ] Review open HTTP error work, including #2’s request-content suppression and JSON media-type handling. Preserve current TypeSafe nested errors, input-limit guidance, redaction ordering, and the one-second timeout when integrating it. Keep contributor credit and review separate from this checklist.
- [ ] Verify the reporter’s original issue #1 scenario, or explicitly leave it unresolved in release notes. Do not generalize the synthetic dense-form fix to every HTTP 400.
- [ ] On the candidate, run `npm ci`, `npm test`, and `npm run build`. Run `npm run test:engine-browser` with an already provisioned Chromium binary; record failures and default opt-in skips separately.
- [ ] Confirm macOS and Windows desktop, research, challenge, and packaged-app checks in the [desktop workflow](../../.github/workflows/desktop.yml). Deterministic fixtures establish runtime behavior, not live model quality. Avoid signing or publishing as part of validation.
- [ ] Manually check the [first-success path](../FIRST_SUCCESS.md) with a disposable profile and approved model usage; record platform, provider/model, commit, actual result, and failures. Do not use a personal browsing profile.
- [ ] Verify source-only release assets, model requirements, usage costs, and unsigned-package limitations. Do not present the web-only UI preview as a functioning agent browser.
- [ ] Recheck README links/media and visible private information. Keep the 72-second introduction and 30-second uninterrupted 1× game clip with their provenance; label derived excerpts and compression.
- [ ] Retain the evaluation caveat: **10/12 is a reused development subset of an 812-task benchmark**, not a held-out/full-suite result, leaderboard score, or measurement of the new release. Preserve failed and incomplete attempts.
- [ ] Have the owner review the candidate and release text before any tag, merge, or release publication.

## Lightweight demo export

`docs/media/jevry-web-preview.mp4` is a compressed copy of the existing public eight-second introduction GIF, retaining its 960 × 540 framing, 80 frames, and eight-second timeline. It is a promotional excerpt, not a browser latency measurement or a new task run. See [media provenance and reproduction](../media/README.md#lightweight-introduction-excerpt).

The 30-second game MP4 is already about 536 KiB; keep that existing real-time evidence rather than producing a new edit or speed claim. Original assets remain unchanged.
