# Redesign validation — 2026-09-24

- `npm run build`: TypeScript, Vite renderer, and desktop bundle pass.
- `npm test`: 571 passed, 100 skipped in the existing suite (26 passed files, 4 skipped).
- `npm run test:desktop`: isolated disposable profile with deterministic local model stubs; onboarding, encrypted secrets and conversation storage, native navigation and sandbox, consecutive action turns, page-grounded follow-up, cited research, task redirection, conversation selection, restart persistence all pass. No live model quality or benchmark claim.
- Browser checks: setup, workspace, brand-book layouts; 390px brand book has no horizontal overflow; mode selection, sample search, orb states, play/pause controls work. No console errors observed during interaction checks.
- Original desktop smoke copy locators updated for the two intentionally redesigned headings. No assertions removed.
- Game-control, agent, authentication, evaluation and profile-persistence implementation unchanged. Existing release bundles untouched. New icon applies to future packaged builds.
- Full-page browser screenshot stitching produced artifacts. Use viewport captures for visual review, not the initial long captures.
- Image concept studies were generated with the built-in image tool; prompts and delegated design decision are recorded in `.impeccable/mocks/decision.json`. Production logos and social assets are vector-authored, with outlined font glyphs.
- User correction: restore the full tall J stem, replacing the initial abbreviated hook consistently in app and asset kit.
