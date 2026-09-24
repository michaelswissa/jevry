# Contributing to Jevry

**Pull requests are welcome.** Start with a small, reproducible browser task. Open an issue before a large change so we can agree on scope. Pull requests that fix a documented failure are welcome.

## Local setup

Use Node 22.12+ and `npm ci`, then `npm run dev`. Text and Jev connections are configured inside the desktop app. The UI-only preview is `npm run dev:web`.

Before submitting code, run `npm test` and `npm run build`. For browser control changes, install Chromium with `npx playwright install chromium` and run `npm run test:engine-browser`. Run the native desktop/research checks when those paths change. Tests must use disposable profiles, not personal browsing sessions.

## Browser and game changes

Read [engine design](docs/ENGINE.md), [game constraints](docs/GAMES.md), and [recorded results](docs/GAME_RESULTS.md). Preserve canvas focus, native input receipts, and non-replay of uncertain actions. Success requires observed evidence of the requested objective.

For benchmark work, retain all attempts and use the unchanged official evaluator. Keep reference answers and evaluator state out of the acting model. Report development reruns separately from a frozen final evaluation.

## Useful reports

Include OS, source commit/version, reproduction steps, expected and actual behavior, and whether the provider was live or mocked. Redact account names, secrets, private URLs, page content, and exported conversation data. Do not upload browser profiles or connection archives.

Security reports belong in GitHub's private vulnerability reporting flow; see [SECURITY.md](SECURITY.md).

## Pull requests

Explain the user-visible change and the checks you ran, including skips and limitations. Keep third-party attribution intact. Contributions to original project code are under the MIT license.

## Your first contribution

1. Fork the repository on GitHub and clone your fork.
2. Create a focused branch: `git switch -c fix/describe-the-problem`.
3. Reproduce the issue with a public or local fixture and make the smallest useful change.
4. Run the relevant checks above. Explain any skipped or unavailable checks.
5. Push your branch and open a pull request against `michaelswissa/jevry:main`.

For documentation-only changes, check links, setup commands, and technical claims; a full runtime test run is usually unnecessary. For benchmark summaries, keep every attempt and preserve missing/incomplete results. For decision-schema changes, inspect both action quality and total task time.

Useful starting areas include installation instructions, accessible control names, reproducible browser fixtures, state-size reduction, completion coverage, and benchmark setup. Open a discussion if you want to explore a larger architectural change.
