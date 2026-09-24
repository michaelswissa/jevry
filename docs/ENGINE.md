# Jevry's browser engine

The engine is a TypeScript/Electron adaptation of the small loop in [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/README.md): observe one live page, offer a finite action space to Jev, validate its selected operation and target, then execute against the observed DOM node.

`desktop/snapshot.ts` directly adapts Browser Use's MIT-licensed `snapshot.js`; the module preserves the license. `desktop/engine.ts` ports its action indexing, speculative operation/target question construction, strict probability validation, freshness checks, and text-helper handoff. Firecrawl's streaming worker model and ego-lite's observed-reference/CDP architecture inform the structure, but neither runtime is bundled into this engine. Their cloned repositories and licenses remain available under `upstream/`.

## Actual model protocol

Jev uses `POST https://api.typesafe.ai/v1/systemone`, authenticated with a TypeSafe API key, with `model: "jev-latest"` by default. It is **not** an OpenAI Chat Completions endpoint. One request contains structured page state and all currently supported operation-specific target questions. Only the target head belonging to the chosen operation can execute. Probabilities must cover exactly the offered choices, be finite and normalized, and select a maximal-probability choice.

The default DOM loop sends visible text and an indexed table of controls without screenshots. Its text connection prepares unknown field values and reviews a task only when Jev reports an obstacle; routine action choices remain on Jev. Explicit [game mode](GAMES.md) adds occasional visual strategy and grid calibration; a local pixel reader supplies fresh board state, and Jev still chooses every move. No model output becomes a selector, JavaScript or shell command. Board clicks must belong to an observed surface and pass native geometry checks.

## Fast path and timing

- One atomic DOM observation per iteration, preserving actual node identity in an isolated Electron world, including open shadow roots.
- One network round trip for the operation and its target heads.
- Game keys on a single observed board omit redundant target heads. Calibrated grids use local screenshot matching between Jev decisions; the larger model is outside the normal move loop.
- A persistent CDP connection rather than spawning a browser process per action.
- App-owned input operations with current geometry and occlusion checks immediately before execution. Visible target regions account for ancestor clipping and shadow-root hit testing; five candidate points avoid false failures on partially covered controls.
- Two rendering frames or 50ms of post-action settling; comboboxes wait for suggestions up to 200ms. There are no multi-second fixed interaction sleeps.
- Readable pages proceed immediately. Destroyed or empty documents during navigation use adaptive read retries (20–200ms, up to five seconds), rather than failing after the old 200ms window. Cancellation stops waiting on a pending read; a late result cannot resume input.
- A generated field value may survive a stale retry only while the entire text-helper context is identical.
- Each observation, decision, execution, and terminal status is emitted immediately to the UI. Model and input durations are measured with a monotonic clock.

These mechanisms reduce avoidable overhead. Network inference, page loading and rendering still take time. No zero-latency or world-fastest claim has been verified. API-backed text models generally avoid the per-call CLI process startup cost when filling many fields.

## Browser adapter

The Electron host supplies:

```ts
interface BrowserAdapter {
  evaluate<T = unknown>(expression: string): Promise<T>;
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
  url(): string | Promise<string>;
  navigate(url: string): Promise<void>;
}
```

`evaluate` must await promises and execute in a persistent isolated world belonging to the owned tab. Page JavaScript must not be able to rewrite the engine's cached references and guard functions. Only application source constructs evaluated expressions; selected node IDs are locally observed integers, and data is serialized with JSON.

The native host uses `desktop/native-evaluator.ts`: a named isolated world, per-document loader checks and Chromium's unique execution-context IDs. Reads can run at DOM readiness even if subresources have stalled. Context destruction, navigation and debugger detachment invalidate cached worlds; a failed evaluation is not retried because some app-owned expressions perform input. The transport retains its debugger reference before teardown so closing observed tabs never accesses a destroyed WebContents getter. Twelve lifecycle unit tests and a native multi-tab close regression cover this path.

## Goal, progress and recovery

The conversation planner produces a reusable task contract: atomic observable success conditions, user constraints and signals that mean progress only. It preserves quantities and units rather than conflating a score, tile value, level or count. This contract accompanies Jev's choices and survives same-game follow-ups. Older plans without a contract remain compatible.

On an ordinary website, a proposed DONE with a contract triggers one additional Jev request to match each success condition to finite evidence from current and earlier observations: text excerpts, address/title, whole collection items, rendered tables, form values, selected labels and control states. The same request includes a separate coverage Choice so a matching record does not imply that every requested page or record was read. The check asks Jev to distinguish explicitly observed empty sets from missing data. Recent page context receives reserved memory space so old collections cannot crowd out sort/filter evidence. Offered select options are not confused with the actual selected value. Missing evidence returns the task to the action loop with the missing conditions named. Evidence is discarded if the page changes during the check; repeated unsupported completion attempts are bounded. This is a grounded model assessment, not independent verification. Game completion retains its separate visual objective gate. A numeric board reports its measured largest tile and target in the live answer, separately from score, and stops offering moves when the target appears while checking victory.

Ordinary link choices include compact prior-observation hints for up to 128 exact URLs seen during the current turn. Counts increase on observed URL transitions, not repeated reads or attempted clicks. Query strings and fragments remain exact. Hints neither hide links nor establish completion; Jev may reinspect when useful. They are app-owned action context and are excluded from page evidence and the game schema.

When Jev reports BLOCKED on an ordinary website, the connected reasoning model can review current page state, recent action receipts and the user goal. It supplies concise advice, never executable code or direct native input. Jev then chooses from fresh supported controls. Two reviews are allowed; a real missing prerequisite is reported explicitly. When missing knowledge is the obstacle, the reviewer may request a public guide lookup: one background search, one Jev source choice and one bounded source read. The source is untrusted reference material. At most two distinct queries are allowed per turn, duplicates are cached, and owned background tabs close on success, failure or Stop. The foreground task remains selected. Sensitive-action boundaries, uncertain-input non-replay and Stop still apply. No extra reasoning call is added to every routine action. An interrupted dispatch never enters this recovery path.

These mechanisms apply across supported tasks, but they do not add arbitrary new input modalities or prove a universal success rate. Numeric merge lookahead is a rule-family adapter, not the general engine's intelligence. The action space and observed evidence still constrain what can be done.

## Execution boundaries

Before input, the executor checks the current document, form values, target semantics, surrounding context, visibility, enabled state, and occlusion. A stale decision is discarded. Once mutation begins, any interrupted input stops the run instead of replaying it. Execution is recorded before observing its result, so a navigation failure cannot turn a completed click into an unrecorded retry.

Password, payment-card, one-time-code, file, hidden, and recognizable secret fields are excluded from the action space. Deterministic guards stop on purchase/payment, send/publish, deletion, security, and suspicious submission controls for manual attention. Page content is labeled untrusted in both model prompts. These guards are conservative and label-based; they are not a complete semantic security guarantee for arbitrary hostile sites.

Ordinary runs are bounded to 60 executed actions and 120 decisions by default. Visual game runs seeking a win default to 400 actions; validated numeric merge games get 2,500, with an explicit maximum of 4,000. Cancellation aborts model requests and prevents a returned model response from causing input. Repeated actions without visible progress stop the run. Pending native navigation can still finish after cancellation; the host owns navigation lifecycle and tab ownership.

A Jev `DONE` choice triggers a fresh observation. The engine reports completion as **unverified** unless the caller supplies an independent `verifyOutcome(page, goal)` check. That hook must pass before the engine reports verified completion. Cancellation is checked again after the verifier returns. Every result also returns the last observed page URL, title and text, plus executed-action summaries, so the conversation layer can explain the actual outcome and retain it for follow-up instructions. The UI should keep the real page visible for user review.

## Supported page interactions

HTML/ARIA controls, native selects, contenteditable fields, open-shadow controls, same-origin iframe controls, viewport and nested panel scrolling, and waits are available as finite observed actions. Nested panels and same-origin frame viewports expose separate up/down actions tied to the actual observed element. Their current scroll position is included in freshness checks. Scrolls operate directly on the guarded element, so a wheel event cannot accidentally move a different panel underneath it.

Populated search fields offer `PRESS_ENTER` as an operation with its own target head. Execution focuses that exact observed field, confirms the active element through shadow roots, then dispatches native Enter down/up events. This covers search boxes whose submission is keyboard driven. The operation does not accept arbitrary keys or model-authored scripts. Non-search POST forms and sensitive contexts stop for manual attention; form method, destination and role are included in target guards so they cannot silently change after observation.

Open shadow roots share the same isolated reference registry as ordinary controls. Composed ancestry detects disabled/inert hosts, clipped descendants and slotted elements. Accessible label references are resolved within their own shadow root before the document. Closed shadow roots remain unsupported.

Same-origin iframe traversal is bounded to sixteen frame documents and four nesting levels. References remain in the parent isolated registry. Each observation and action guard checks frame-document identity, URL, scrolling, viewport size and frame geometry. Frame coordinates are translated into the top viewport and hit-tested through each frame and shadow root before native input. Detached or navigated frame references are discarded even if their old document still reports connected DOM nodes. Frames with CSS transforms, perspective, individual transform properties, zoom or padding are excluded because their coordinate mapping needs a separate transform-aware implementation. Cross-origin and sandboxed opaque-origin frames are excluded; the model receives the count of unsupported frames instead of fabricated controls.

## Limits and testing

Cross-origin or transformed frames, closed shadow roots, file uploads, drag-and-drop, horizontal panel scrolling and arbitrary keyboard-only widgets are not part of this engine's action space. Game mode adds bounded keyboard and pointer input on observed game surfaces; see [game strategy](GAMES.md) for its visual reasoning loop and limits. The Electron host follows task-owned GET popups in the same browser context after the current input finishes. A rejected off-site GET can return to the usable original document with bounded navigation feedback; only its exact observed source/link pair is suppressed for that turn. Ambiguous navigation, conflicting popups and popup POST submissions remain blocked. User-selected tabs and ordinary manual popup behavior remain independent of the task owner. This remains a bounded engine, not evidence of winning a general browser benchmark.

`desktop/engine.test.ts` uses injected Jev responses and a fake CDP adapter. It checks protocol validation, operation-specific target selection, stale reference handling, identical-context text caching, cancellation, safety stops, focus changes, action budgets, and the no-retry rule after mutations. The tests make no paid model calls.

Opt-in real Chromium tests exercise text replacement, native selection, Enter submission inside an open shadow root, nested panel scrolling until a clipped target becomes actionable, and exclusion of covered/disabled/secret shadow controls. Frame regressions cover nested bordered iframe offsets with shadow controls, stale-document replacement at the same URL, iframe viewport scrolling, and exclusion of opaque-origin, hidden, transformed and zoomed frames. They independently verify actual DOM outcomes and confirm that page scripts cannot overwrite the isolated reference registry. Run them with `JEVRY_BROWSER_TEST=1 npx vitest run desktop/engine.test.ts`; an existing Chromium executable can be selected with `JEVRY_BROWSER_EXECUTABLE=/absolute/path/to/chromium`. The Jev choices and generated field text are injected, so these validate browser execution mechanics, not model quality or network latency. Live account accuracy and comparative speed require separate measured runs using user-connected models.
