# Jevry 0.4.0-beta.13 — public source preview

Jevry is a desktop browser you can give tasks to: work through supported website controls, research sources with citations, and play supported games with visible actions and stop/redirect controls.

This release publishes the MIT-licensed source, a new README and identity, contribution/security guides, and a real-time 2048 demo.

## Try it

Requires Node 22.12+, npm, a text-model connection, and a TypeSafe Jev API key. Provider usage may incur charges.

```sh
git clone https://github.com/michaelswissa/jevry.git
cd jevry
npm ci
npm run dev
```

This is a **source preview**, not a signed installer release. Native verification is on macOS. Windows CI/build configuration is included; native Windows acceptance is pending. Signing, notarization, and automatic updates remain outstanding.

## Demo

The attached MP4 is 30 seconds of uninterrupted real-time footage from the creator's September 23 recording. It ends with a 2048 tile, “You Win,” 20,708 points, 1,013 moves, and no powerups used. Desktop surroundings are cropped; there is no audio or speed-up. The clip shows an earlier interface and is separate from the instrumented beta.4 latency study. See the demo editing notes for timestamps.

## Validation

The frozen public source snapshot was installed with `npm ci` and passed:

- `npm test`: 571 passed, 100 skipped by the default browser opt-in configuration.
- `npm run build`: strict TypeScript, renderer, and desktop builds.
- `npm run test:engine-browser`: 120 passed with real Chromium, after installing its required binary.
- Gitleaks scan of the curated source: no findings after rewriting a prose false positive.

The initial extended Chromium attempt failed because the expected browser binary was missing. Installing it resolved those environment failures. Unit and browser test totals overlap and must not be added into a unique-test count. Native workflow results are recorded in `docs/launch/PUBLICATION.md`.

Historical evaluations remain labeled by build. No recognized benchmark score, leaderboard position, broad win rate, or market speed superiority is claimed.
