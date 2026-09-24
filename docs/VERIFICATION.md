# Verification assistance

This feature is experimental in 0.4.0-beta.2. It does not guarantee CAPTCHA completion, prevent sites from presenting challenges, or establish production readiness. No live CAPTCHA success rate or latency advantage has been measured.

The linked `ai-captcha-bypass` repository was cloned and inspected at commit `29228c0d08ab3f7425fb7edad085a8ff74b2fd39`. Its [custom license](https://github.com/aydinnyunus/ai-captcha-bypass/blob/main/LICENSE) prohibits commercial use. None of its solver code, prompts, Python dependencies or recorded challenge images are included in Jevry. Its selected success GIFs and absent advertised benchmark script do not establish production success rates.

## Browser behavior

Before an action decision or research source read, Jevry checks for recognized visible reCAPTCHA or hCaptcha widgets and known blocking verification pages. A standard recognized checkbox can be attempted without a vision request. After the one click, Jevry waits passively for up to ten seconds within the overall thirty-second budget. It stops immediately when the same widget returns a response or a visible image challenge appears. While the same checkbox remains pending, it takes no additional screenshots and sends no further click or model request. Other supported visible widgets receive at most three single-click image decisions within a 30-second verification window. Larger, dynamic, inaccessible or ambiguous challenges stop for the user.

The model receives a bounded PNG crop of a recognized widget. It can return one bounded click, wait or handoff; it cannot return executable code, arbitrary selectors, typing, navigation, links or outside coordinates. Native checks bind the widget to its actual document/frame, validate visibility, bounds and sampled occlusion, and check image freshness before input. The browser observes a new response on the same widget before resuming the ordinary task against a fresh page observation.

To prevent a transparent child document from exposing host-page pixels beneath it, Jevry temporarily paints the exact observed iframe's background opaque white with `background-color` and `background-clip:border-box` marked `!important`. It checks the resulting styles before screenshots and input. On completion, cancellation, error or `pagehide`, cleanup restores only properties that still match Jevry's owned values; concurrent page edits are preserved. This is a temporary visual change to the widget's background. It does not rewrite the provider's document or response.

Same-origin and cross-origin process-isolated transparent-frame fixtures establish this specific fix with actual screenshot pixels: the host's magenta marker is visible without the backdrop, white in the crop passed to inference, and visible again after restoration. Visibility checks still sample occlusion rather than proving every pixel unobstructed, so a tiny overlay between sample points remains a limitation. The feature does not claim perfect screenshot isolation for arbitrary page compositions.

A new widget response is **not server acceptance or overall task completion**. Tokens are never exported to the renderer, model or logs. Downstream task evidence must establish the actual result. Hiding a frame, disabling a Verify button, showing a preexisting response or a model saying “done” does not count as a newly solved challenge.

If verification remains unresolved, the page is brought forward and the answer offers **Continue task**. After manual completion, that button selects the same existing tab and continues the prior goal with its constraints and receipts. Closing the tab requires reopening the relevant page. Source-search tabs awaiting manual verification are retained rather than disposed with other temporary search pages. Uncertain inspection errors stop ordinary action inference.

A hidden research source can have too small a native viewport to inspect its widget safely. That case hands off: it captures no image, calls neither vision nor Jev, sends no native input, retains the source and brings its tab forward. It does not invent a response or finish the research task. The native regression proves this branch ran while the view was actually hidden; it does not establish automatic verification inside hidden views.

## Providers and data handling

The existing text connection must support image input. OpenAI-compatible and Anthropic APIs receive their native image message formats. Claude uses a fresh tool-disabled stream-JSON session; Codex requires the installed CLI's image attachment option. Unsupported image requests fail explicitly instead of silently using text alone or changing providers.

Images remain in memory for API/Claude paths. Codex requires a private temporary attachment, removed only after its process exits. Image sessions are not reused as normal conversation history. Cancellation drains the request; no screenshot, token or key is intentionally stored in challenge logs. Provider-side retention follows that provider's settings and terms.

Jevry retains its own ordinary browser sessions and avoids repeated unbounded challenge retries. It does not spoof fingerprints, rotate identities, fabricate verification tokens or claim to look indistinguishable from a human. Site challenge policies and network conditions remain external to the browser.

## Verification scope

`desktop/challenges.test.ts` exercises guards and real Chromium fixtures. The final module run passed 35 tests, including 17 actual Chromium fixtures. `scripts/smoke-challenges.mjs` passed 12 native Electron/provider/UI checks with local fixture documents and intercepted provider frame URLs. These are suite-specific deterministic implementation checks, not an overall release test total or execution against real CAPTCHA services. Coverage includes transparent-child pixel isolation, restoration on cancellation/error, concurrent style preservation, actual cross-process input routing, redirected-frame refusal, hidden-source handoff, continuation, and failed-inspection refusal. The packaged Mac beta.2 passed these checks as part of its 29 native workflow checks; authoritative counts belong in its release manifest.

The frozen beta's subsequent full source run (local artifact: `artifacts/beta2-final-tests.json`) passed **284/284 tests across 12 files with no skips**, including the actual Chromium cases. Its build and five shared benchmark-evaluator checks passed. This source evidence does not establish Windows native execution, final signed-package behavior or external CAPTCHA acceptance; those remain separately documented release gates.

One separate real Claude vision request (local artifact: `artifacts/live-vision-beta.json`) passed against an owned synthetic colored-shape crop: the default model resolved to `claude-fable-5-1` and returned a coordinate inside the known green square in 6,588 ms. There was one request, no retry or model override, no external CAPTCHA, and complete temporary-profile/provider-workspace cleanup. This verifies the live image protocol and one simple coordinate task; it supplies neither a CAPTCHA success rate nor a latency guarantee.

The official Google test-mode trial (local artifact: `artifacts/official-recaptcha-beta2.json`) passed on packaged beta.2: one checkbox click, a newly observed response at 3,040 ms, zero vision requests, no handoff, and a successful Google `siteverify` response. It used Google’s [documented public automated-test keys](https://developers.google.com/recaptcha/docs/faq), which are designed to pass without an image puzzle. This is provider integration evidence, not ordinary CAPTCHA difficulty or acceptance-rate evidence. The two earlier beta.1 attempts remain recorded: the second showed Google completing just after Jevry’s old wait expired, motivating the pending-response fix. Delayed completion, image transition, cancellation and replacement-widget fixtures now cover that defect.

Initially unsupported: general slider/audio/text-entry puzzles, arbitrary challenge providers, invisible risk scoring, challenges without an unambiguous response association, nested/transformed or inaccessible widget layouts, and large/dynamic grids exceeding the budget. General cross-origin browser interaction is still outside this feature's scope. See [production readiness](PRODUCTION_READINESS.md) for the live acceptance and distribution gates.


_Public snapshot note: local run artifacts referenced above are retained by the maintainer and are not distributed in this repository. Their descriptions are historical reports, not independently downloadable evidence._
