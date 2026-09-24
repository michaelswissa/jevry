# Competitive review and measurable acceptance criteria

Audited 2026-09-22 after the user rejected the first packaged build. The central defect was real: the app presented an agent composer, but each submission created an independent action run. It could not interpret the next message using the preceding conversation. A fast DOM executor does not provide a conversational browser by itself.

This review separates **the rejected baseline**, **what the supplied upstream source actually implements**, and **measured fixture results**. Repair work can change the current files while this review is being written; the baseline references below describe the code inspected at the beginning of this audit, not a claim that all defects remain in the repaired build.

## Latest measured candidate: 0.4.0-beta.1

The fresh study on 2026-09-22 measured the frozen beta.1 candidate at commit **`924e2206a1f9957633eb90cabaf74c41eea8b17c`**. All 46 recorded project source files available in that commit match the study's hashes. Source and loaded-build hashes were unchanged throughout the run (`sourceDrift: []`). Evidence is retained in the raw comparison (local artifact: `artifacts/matched-v040-beta1/comparison.json`), the semantic review (local artifact: `artifacts/matched-v040-beta1/semantic-review.json`), and the timing summary (local artifact: `artifacts/matched-v040-beta1/timing-summary.json`).

Three five-turn sessions per implementation ran sequentially in J/F, F/J, J/F order, using the same fixed fixtures and prompts as v0.3. Both resolved **`claude-fable-5-1`**, low effort, with separate conversation-scoped workers and no model override. Jevry also used real `jev-latest` for action selection. Every recorded attempt is included below, including turns that the automatic checker flagged.

| Shared task | Jevry median (all-attempt range), seconds | Firecrawl source graph median (all-attempt range), seconds | Jevry median relative to Firecrawl |
| --- | --- | --- | --- |
| Paris / two guests | 10.772 (10.753–11.705) | 14.690 (13.997–15.421) | 26.67% lower |
| London / retain two guests | 7.715 (7.526–10.051) | 9.504 (9.431–9.684) | 18.82% lower |
| Read-only result follow-up | 5.482 (4.430–9.111) | 6.002 (4.184–6.045) | 8.66% lower |
| Discover and compare two policies | 17.139 (16.412–17.303) | 16.765 (16.218–17.217) | 2.23% higher |
| Cancellation follow-up | 4.916 (4.795–5.132) | 6.107 (4.817–6.587) | 19.50% lower |
| Sum of all five turn durations per session | **48.341 (45.205–49.696)** | **52.782 (50.592–53.295)** | **8.414% lower** |

The last row is the median of three complete session totals, not a sum of the five task medians. These totals exclude initial browser setup and fixture navigation; they include all measured turn planning, provider calls, tool execution and final-answer generation.

Both implementations met **15/15 requested task criteria after assistant semantic review**. The unchanged automatic scores are **Jevry 15/15 and Firecrawl 13/15**. In Firecrawl repetitions 1 and 3, the cancellation deadline appeared in a separate paragraph after mentioning Orbit; the answer still clearly selected Cedar and correctly gave its 24-hour deadline, supported by the Cedar policy reference and source URL. The checker did not resolve that reference. Both failed flags, runner exit codes of 1 and driver warnings remain intact. The review covered all twelve research answers, actual source reads and citation mappings, plus all eighteen form turns and submission receipts. It was performed by the assistant that launched the study, with a separate parent-assistant review of the research answers; it was not blinded or external review. It records extra-wording caveats rather than treating every sentence as perfect: notably, one Jevry explanation gave the correct EUR 5 breakfast-inclusive price difference without clearly stating that Orbit becomes more expensive.

All three Jevry reports record successful stop and native app shutdown. Firecrawl's runner completed its `finally` path, but it has no explicit cleanup-success receipt and catches browser-close errors; process completion alone does not prove every cleanup step succeeded. Automatic task outcomes and lifecycle evidence remain separate.

**The machine was not otherwise idle.** The user's packaged browser remained running. Two short separate native Google test-widget probes overlapped Firecrawl sessions: 13:28:29.799–13:28:34.862 UTC during repetition 2, and 13:31:09.806–13:31:15.970 UTC during repetition 3. Those probes made no paid model calls or source/build changes. Lightweight metadata/documentation inspection also occurred. Their resource impact was not quantified, so the observed difference cannot be cleanly attributed to the implementations alone. The semantic-review artifact preserves both overlap disclosures; no run was discarded or repeated to hide them.

As in v0.3, this compares Jevry against **actual Firecrawl source orchestration with a declared local browser toolkit and Claude protocol bridge**, not Firecrawl's hosted service. Jevry ran Electron 44.4.3 / Chromium 152.0.7977.130 at 1024×764 (DPR 2); Firecrawl's adapter ran headless Chromium 151.0.7922.34 at 1120×780. Three repetitions and five small local-fixture tasks do not establish statistical significance, population p95, zero latency, a whole-product win, or a win over genuine Ego. This study contains no CAPTCHA task.

There is **no consistent improvement over the historical v0.3 study**. Jevry task medians changed by −11.79%, −1.92%, +16.81%, +8.05% and +0.04%, respectively, in the table's task order. These are descriptive comparisons across separate time windows, not causal measurements of the beta changes. The subsequent **0.4.0-beta.2 pending-checkbox wait fix is not measured by this beta.1 study** and must not inherit its exact build measurements.

## Historical v0.3 measured result

The completed study in `artifacts/matched-v030-verified/` ran three five-turn sessions for each implementation, sequentially in J/F, F/J, J/F order. Source and loaded-build hashes remained unchanged. Both sides resolved to **claude-fable-5-1**, low effort, with conversation-scoped workers. Jevry also used real `jev-latest` for browser action choices.

| Shared task | Jevry median (range), seconds | Firecrawl source graph median (range), seconds | Lower Jevry median |
| --- | --- | --- | --- |
| Paris / two guests | 12.212 (10.155–12.437) | 14.752 (14.500–17.996) | 17.2% |
| London / retain two guests | 7.866 (7.532–8.679) | 9.995 (9.951–14.338) | 21.3% |
| Read-only result follow-up | 4.693 (4.546–7.692) | 6.128 (5.787–7.202) | 23.4% |
| Discover and compare two policies | 15.862 (15.859–18.202) | 17.948 (17.841–21.943) | 11.6% |
| Cancellation follow-up | 4.914 (4.454–6.722) | 5.222 (4.983–6.380) | 5.9% |

Both implementations completed **15/15 correct turns after semantic review**. The unchanged automatic evaluator reported 15/15 for Jevry and 14/15 for Firecrawl: Firecrawl's second cancellation follow-up put Cedar's deadline in a separate paragraph after mentioning the rejected Orbit option. The sentence was correct; the source-section regular expression misattributed it. Raw reports, automatic scores and the resulting nonzero runner exit remain intact. The separate `semantic-review.json` records assistant review of all twelve research answers against the fixture pages; this is not a claimed human review or a success-rate advantage for Jevry.

All three Jevry runs also completed native shutdown cleanly. Earlier shutdown and missing-browser attempts remain preserved in separate directories, described below. Validation at this historical v0.3 milestone passed **174 tests**, including real Chromium execution/extraction regressions, plus native Electron conversation and research smoke workflows.

This establishes a descriptive latency advantage on these five local tasks against **Firecrawl's actual source graph with its public injected browser toolkit and a buffered Claude protocol bridge**. It does not measure Firecrawl's proprietary cloud browser. Jevry used Electron 44.4.3 / Chromium 152.0.7977.130 at 1024×764 (DPR 2); the adapter used headless Chromium 151.0.7922.34 at 1120×780. Initial launch/fixture navigation was excluded; all turn planning, provider calls, source navigation/reading, actions and answer generation were included. Batching, protocol translation and worker retirement differ as detailed below. Three repetitions, overlapping ranges and narrow fixtures cannot establish general superiority, statistical significance, p95 latency, or zero latency.

The separate deterministic control comparison remains **15/15 Jevry versus 6/15 upstream Jev** on its five declared coverage fixtures. Ego's genuine app has been acquired and inspected, but the native launch experiment did not establish disposable profile and launcher containment. Introduced integration files were moved into reversible rollback and the downloaded image was detached. No win over Ego is claimed.

## Source versions and scope

| Product/source | Audited commit | What is available |
| --- | --- | --- |
| Jev Ultrafast | `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` | Python agent, TypeSafe choice protocol, DOM observation, browser-harness/CDP execution, demo and examples. |
| Firecrawl Web Agent | `f023adf1cd1f731e27fdc844af62996f6c2a41c4` | Agent SDK plus app templates, research tools, model orchestration and conversation UI. Default tools depend on Firecrawl services. |
| ego-lite | `dca7003349c5f7132189ba00547cbbd7ff8e597e` | Open-source agent harness and skills. The browser supplying `globalThis.ego` is closed source and absent from the repository, but a public macOS binary is linked from its README. |

The source tree for Jevry had no Git commit at audit time. The comparison runner records SHA-256 hashes of its engine, snapshot and provider source in the result artifact so later runtime changes cannot silently inherit old measurements.

## Why the rejected build failed

1. **It discarded conversational context.** `desktop/main.ts:405–445` accepted a single `goal`, cleared `events`, created a new `AgentEngine`, and passed only that string to `engine.run`. `desktop/engine.ts:339` initialized `history = []` inside every run. `src/App.tsx:1197–1199` called either `bridge.run(goal)` or `bridge.research(goal)`; there was no role-based transcript in either call. “Open the second one” had no preceding list to resolve.
2. **It had no general assistant answer.** `desktop/engine.ts:369–375` converted `DONE` into a generic status message. The text model generated field values or one research JSON object; it did not handle normal conversation or explain the resulting page.
3. **It treated an empty tab as a search box for every intent.** `desktop/main.ts:426–437` opened a URL found in the latest string, otherwise searched Google for the entire string. A greeting, clarification or correction could become an unwanted web search.
4. **Research was limited to existing tabs.** `desktop/research.ts:122–126` required already-open websites; `:166–175` explicitly prohibited the synthesis model from using tools or navigating. It could compare excerpts but could not discover sources, inspect a missing fact and return to answer.
5. **There was no continuation through user intervention.** `desktop/main.ts:406–407` rejected another message while a run was active. Stopping left the page but no durable task state. “Continue” started a fresh objective; no approved handoff/resume state preserved the earlier intention.
6. **The fastest component was used for the wrong level of the problem.** Jev is a choice model over observed controls. It is not the conversational planner or answer writer. Running every utterance directly through that action loop loses the capabilities provided by Firecrawl’s conversational orchestration and ego’s host agent.

## Capability comparison

“Source support” is distinct from successful execution against a live product. A feature exposed by a type or skill is not automatically a measured success.

| Capability | Rejected Jevry baseline | Jev Ultrafast source | Firecrawl Web Agent source | ego-lite source | Required Jevry behavior |
| --- | --- | --- | --- | --- | --- |
| Follow-up messages | Latest string only; events overwritten. | One task and action history per `Agent` instance. No chat interface across tasks (`agent.py:13–39`). | Next template accepts complete `messages[]`, converts/sanitizes history and forwards it to the graph (`app/(agent)/api/agent/route.ts:71–73,152,180–182`). Core `run(prompt)` alone is one-shot (`agent-core/src/agent.ts:173–186`). | Conversation belongs to the surrounding coding agent; harness preserves Page/ref state across rounds (`package/ego-browser/README.md:90–94`). | Persist user/assistant turns and action receipts; resolve “that”, numbered results and corrections before acting. |
| Durable conversation | None. | No durable cross-task transcript. | Template conversation endpoint returns HTTP 501 (`app/(agent)/api/conversations/route.ts:6`); in-session history still works. | Browser Page ledger persists refs; durability of host conversation is outside this repo. | Reopening the same task retains the conversation, completed work, sources and current objective. |
| Intent and tool choice | Manual Agent/Research toggle; no chat reasoning. | Chooses click/type/select/scroll/wait/DONE/BLOCKED (`model.py:81–147`). | Text model selects search, scrape, interact, mapping/crawl and workers; has final formatted output (`agent-core/src/agent.ts:37–40,421–480`). | Host agent can choose Page operations, JS/CDP, HTTP and site tools (`package/ego-browser/README.md:60–81`). | One composer routes chat, read, navigate, multi-tab comparison and page actions; Jev stays the action executor. |
| Live answers | Status log; research appears when JSON completes. | Structured inspector state, not streaming natural-language answers. | Token stream plus tool events (`agent-core/src/agent.ts:225–255`); template streams values and messages (`api/agent/route.ts:156–182`). | Host agent supplies answer stream; harness supplies tool results. | Immediate submission receipt, visible assistant answer streaming, useful activity tied to the correct turn. |
| User control | Abort and start another unrelated run. | Demo consumes one decision before mutation; no task-space ownership (`agent.py:86–100`). | Abortable tool boundary; interact timeout (`agent-core/src/toolkit.ts:50–99`). Not equivalent to local user/agent tab ownership. | Explicit `waitForControl` and `handOff`; ledger reconciles user changes (`page-model.ts:949–1024`). | User can stop, inspect or edit the page, then continue with earlier intent and a fresh observation. |
| Multi-tab work | User can open tabs; engine binds one active tab. Research reads first bounded group. | One owned target (`browser.py:20–28`); popup tabs excluded. | Parallel research subagents and remote interact sessions (`agent-core/src/agent.ts:437–463`). | Managed/unmanaged inventories, Page labels, child discovery, explicit retention (`page-model.ts:930–1040`). | Stable task-owned tab IDs, explicit source scope, switch/open/compare tools, no accidental unrelated-tab context. |
| Research | Synthesis of already-open excerpts. | Navigation/action task, no research orchestration. | Search and data gathering, parallel workers, schema validation and reusable skills (`agent.ts:37–40,83–115,437–480`; `toolkit.ts:148–176`). | Host reasoning plus `browserFetch`/`serverFetch` and learned site procedures. | Acquire sources when needed, preserve citations, answer follow-ups against actual findings. |
| Control coverage | Common top-document DOM/ARIA controls. | Frames, shadow roots, canvas, uploads, popup tabs, nested scrolling and arbitrary keyboard widgets explicitly excluded (`README.md:126`). | Remote interact tool capability depends on the service, not fully inspectable in this repo. | Frame-aware selectors; hover, drag, keyboard, upload and read/write helpers (`package/ego-browser/README.md:71–81,95–110`). | Keep the fast path for common controls; add frame/keyboard/advanced-control fallback and disclose unsupported operations. |
| Stale target handling | Observed nodes and freshness checks before input. | Same central design; consume before action, record before next observation (`agent.py:90–145`). | Tool-specific/service behavior; not directly equivalent. | Frame/document/backend-node refs with invalidation; Page checks and receipts (`AGENTS.md:20–22`). | Never replay uncertain mutations; refresh stale observations; preserve action receipts for future turns. |
| Completion evidence | Generic model DONE; production had no supplied verifier. | README explicitly says DONE needs independent checking (`README.md:126`). Example Flights adds a task-specific verifier. | Data-gathering gate and JSON schema repair; these verify presence/shape, not factual truth (`agent.ts:83–115`). | `fill()` checks editing took effect; business postconditions stay explicit (`README.md:109–111`). | Report concrete outcome with page evidence. Distinguish verified state from a model’s completion claim. |
| Speed design | Jev direct loop; CLI text process starts for each request (`providers.ts:422–428`). | One choice request per cycle, atomic DOM snapshot, capped settle, text helper only when filling (`README.md:94–105`). | Parallel independent research; broader text reasoning stack and remote service calls. No shared live benchmark established. | Session caching, persistent Page state and reusable site knowledge; no comparable live timing measured. | Avoid text planning on every DOM step; measure total successful task time, responsiveness, tool overhead and provider startup separately. |

Firecrawl references in the table are relative to `upstream/web-agent/`; the template API paths are under `agent-templates/next/`. Jev references are under `upstream/jev-ultrafast/jev_ultrafast/` unless labeled README. ego references are relative to `upstream/ego-lite/`.

## Repair order and acceptance gates

| Priority | Work | Observable pass condition |
| --- | --- | --- |
| P0 | Conversation state and intent routing | Ask for a numbered list, then “open the second one”, then “why that one?” All turns use the right prior context and remain readable. Greeting/read-only questions do not navigate. |
| P0 | Real assistant answers and turn-scoped activity | User messages, assistant text, source links and action progress are distinct and persist. No raw JSON is shown as the final answer. |
| P0 | Interrupt, correction and continuation | Stop ends further input; a correction uses prior constraints; “continue” preserves completed steps and re-observes changed pages. |
| P1 | Research and task-owned tabs | The agent opens missing sources, compares only intended tabs, cites observations and resolves follow-up references. |
| P1 | Broader controls and recovery | Frame, shadow-root, custom keyboard widget and popup cases either succeed through a supported fallback or surface a precise limitation without false completion. |
| P1 | Performance instrumentation | Capture time to first visible response, first useful action, provider startup, inference, browser I/O, recovery and successful final outcome. |
| P2 | Durable learned procedures | Proven repeat workflows can avoid rediscovery while validating fresh page identity and current user intent. |

“Win all three” should mean matching their relevant capabilities and then producing better **measured successful task outcomes** under a shared protocol. Styling, importing repositories, mocked tests, or a lower time for one unsupported subset cannot establish that result.

## Current repair and remaining coverage

The baseline matrix above remains a record of the rejected build. The current source has substantially changed:

| Area | Current implementation | Evidence and remaining limit |
| --- | --- | --- |
| Conversation | `desktop/conversation.ts` preserves role-based turns, previous objective, compact memory and research findings; it drains canceled work before a replacement runs. `desktop/main.ts:297–329` plans each turn as chat, action or source research. | Real Claude/Jev Paris → London → result-question trials below passed. The native desktop smoke also checks redirection and reopening history, using deterministic models. Arbitrary long conversations and ambiguous references are not comprehensively measured. |
| Durable browser workspace | Conversations and tab URLs/IDs are saved and restored; history can be selected, renamed or deleted. | `scripts/smoke-desktop.mjs` checks saved conversation selection, encrypted history and tab reopening. A saved page URL does not restore a transient website DOM or make an earlier action safe to repeat. |
| Source research | `desktop/source-discovery.ts` follows supplied URLs and observed links, selects larger candidate sets, reads independent tabs in a bounded pool and respects explicit source scope. Research findings retain observed source IDs. | `scripts/smoke-research.mjs` checks actual native background pages, scope restrictions, cancellation and readable DOM while an image remains stalled. Its models are deterministic. The separate matched live study evaluates reasoning and answers. |
| Browser controls | Current observation traverses open shadow roots and eligible same-origin frames, supports Enter on search fields, and names scrollable panels. Frame coordinates and identity are validated before input. | The upstream executor comparison proves three added control fixtures. Frame-specific regressions are separate tests; they do not establish general cross-origin-frame, closed-shadow-root, canvas, upload or drag coverage. |
| Provider latency | Scoped Claude workers reuse a process within a conversation, planner-provided observed field values avoid redundant field generation, and a changed simple page status can supply the final answer. | Actual latency remains measured in seconds. Configured warm reuse and local executor speed cannot guarantee network/model responsiveness; worker retirement and provider variation remain visible. |

Several capabilities still prevent an overall superiority claim. A stopped task's prior action events are saved for display but are not explicitly included by `conversationContext` (`desktop/conversation.ts:130–145`); resumption depends on prior prose, previous goal and fresh page evidence rather than an Ego-like native action ledger. General cross-origin frames, arbitrary widgets, downloads/uploads, learned repeat workflows and intervention during irreversible transactions are outside the shared five-turn live protocol. The current live runs use macOS; Windows CLI discovery and process-handling tests do not substitute for running the packaged application on Windows. Native Ego behavior and Firecrawl cloud-interact behavior remain unmeasured here.

## Reproducible offline comparison

Run:

```sh
node scripts/benchmark-comparison.mjs --runs=5
```

Requires installed project dependencies, Python 3, and a Playwright Chromium binary. If the expected browser revision is not installed, either install it with `npx playwright install chromium` or set `JEVRY_BROWSER_EXECUTABLE` to an existing compatible Chromium executable. `JEVRY_PYTHON` can select the Python executable. `--output=path.json` chooses a report path.

The benchmark runs **actual Jevry `AgentEngine` code and actual upstream `Agent`, `model.choose`, `Browser`, snapshot, validation and execution code** against the same local Chromium form. Upstream daemon/CDP transport is adapted to a dedicated local fixture page. Both use the same deterministic policy and field values. The upstream Python process gets no model credentials and its HTTP client deliberately fails if used. All fixture pages reject external requests.

Five scenarios run in alternating product order:

1. Fill destination, choose cabin, reveal traveler field, fill name and review. Expected: five actions, six decisions, two field generations and the exact resulting values.
2. Replace an observed button after prediction but before input. Expected: fresh observation, seven decisions, the same five actual actions, and no duplicated add/review operation.
3. Type a search query and submit using Enter, on a form without a submit button. Expected: exactly one search with London and two actions.
4. Do the same through a search component's open shadow root. Expected: shadow controls and resulting text are observed; exactly one search with London.
5. Scroll a clipped results panel and open Destination 12. Expected: the panel scrolls and the target opens exactly once.

The expanded measured run passed **15/15 for Jevry and 6/15 for upstream Jev** (three repetitions of all five scenarios). Both passed the form and stale-target fixtures. Jevry additionally passed Enter-only search, open-shadow search, and nested scrolling; upstream Jev stopped because these controls are outside its supported action set or could not resolve the clipped target, reaching its decision budget. These are deliberately chosen coverage regressions, not a representative web task distribution. See `artifacts/benchmark-comparison.json` for fresh machine-readable details, source hashes, actual versions, raw repetitions and observation boundaries. This establishes executor parity on common fixtures and a concrete supported-control advantage on these three added fixtures. **It does not test model reasoning, conversational context, source acquisition, live API latency, or overall product superiority.**

Raw browser-loop timings are retained for regression investigation, not a winner ranking. Both measurements exclude initial page navigation; upstream excludes constructor observation/focus setup and includes Python↔Node IPC; Jevry runs in process and includes its own starting observation/focus work. Those overheads are not identical. The fixture finishes around a tenth of a second with zero model/network inference, which says nothing about the real time a provider takes to understand a task.

Firecrawl and ego are explicitly marked **not run** in the report, never assigned fabricated success or timing figures. Firecrawl’s default interact/research stack needs live services. ego’s open repository does not include its browser runtime. Substituting mocks for either would not compare their product behavior.

## Actual Firecrawl source graph with public adapters

Further inspection established a narrower real-model comparison that does not require a Firecrawl cloud key. `CreateAgentOptions.toolkit` explicitly overrides the default provider toolkit (`agent-core/src/types.ts:168–176`); `getToolkit()` respects that override (`agent-core/src/agent.ts:391–396`). The public `createRawAgent()` returns the actual Deep Agents graph (`agent.ts:383–384`), allowing the complete message history to be supplied as the Next template does. Model configuration accepts a base URL that is passed to LangChain's model factory (`agent.ts:139–145`).

`scripts/benchmark-firecrawl.mjs` uses those public paths without changing upstream source:

- The **real source graph** handles message history, tool choice, tool execution, continuation and final answers.
- A **generic local browser toolkit** runs real Chromium. Observation yields visible/enabled input, select, button and link labels, values, options and references backed by retained DOM ElementHandles. `fill`, `select` and `click` act only on those observed handles and reject disconnected or unknown references. The model receives no fixture-specific selector or prebuilt “submit stay” action. A generic ordered batch can contain up to six atomic operations; this differs from Jev's operation-per-choice loop and is disclosed in the report.
- The **model protocol bridge** exposes an OpenAI-compatible endpoint and forwards the actual full graph conversation and offered tool schemas to Jevry's real authenticated Claude CLI text adapter. The real model returns JSON declarations that the bridge translates into tool calls. Responses and actions are never invented. This is a buffered JSON protocol adapter, not native Anthropic/OpenAI function calling or a first-token streaming measurement.
- Browser navigation is restricted to declared local fixture pages. Source reads open real independent Chromium tabs. A fixed-corpus search adapter is available, though the successful research trial directly navigated the supplied index and followed its observed sources rather than using search.
- The graph's skills directory is disposable; cloud tracing is disabled for the benchmark. No Firecrawl cloud calls, API-key file reads or proprietary interact runtime are used.

Dependencies were installed under the ignored upstream subtree with `pnpm install --frozen-lockfile --ignore-scripts`. Source commit is `f023adf1cd1f731e27fdc844af62996f6c2a41c4`; resolved versions include Deep Agents 1.9.0, LangChain 1.3.1, `@langchain/openai` 1.4.4, AI SDK 6.0.158 and `firecrawl-aisdk` 0.12.0-beta.2. The provider is the same authenticated Claude CLI, low effort and no model override; provider source hash is recorded. The adapter therefore tests **actual open-source orchestration plus a real model and injected browser**, not the complete Firecrawl product or cloud browser.

First real-model source-graph trial:

| Shared task | Independent result | Elapsed | Model calls | Browser/research tool calls |
| --- | --- | --- | --- | --- |
| Paris / two guests | Exact result and one submit | 18,554 ms | 3 | 2 |
| London / preserve two | Exact result and second submit | 12,092 ms | 2 | 1 |
| Ask result / guest count | London/two; zero mutations | 6,258 ms | 1 | 0 |
| Compare two policies | Reads both actual sources, cites both, identifies Cedar as refundable | 20,937 ms | 3 | 3 |
| Follow up on cancellation | Cedar; 24 hours before check-in | 9,211 ms | 1 | 0 |

All five passed. `artifacts/firecrawl-source-live.json` contains the actual answers, complete tool observations, model-call durations and source metadata. In the individual observed form trials, Jevry finished the action turns sooner while the Firecrawl graph answered the read-only follow-up sooner. Different tool batching and model protocol layers, variable live-provider latency, and one sample prevent a native-product speed ranking.

`tests/benchmarks/firecrawl-task-protocol.json` supplies shared route mappings, exact user prompts, facts and success conditions for matched repetitions. Both live runners now consume that same file. The source adapter also requires navigation/scrape URLs to have been supplied by the user or returned by an actual page/search observation; knowing a fixture route internally does not authorize the model to read it.

The shared evaluator (`tests/benchmarks/firecrawl-evaluate.mjs`) checks the exact Paris/two and London/two submit receipts, preserved fields and result after the read-only question, and zero additional mutations. Research checks associate prices and cancellation text with the named vendor, require both actual source reads, and count only explicitly cited URLs or referenced Jevry source IDs. A source listed in metadata without an answer/finding reference does not count as a citation. Deterministic checks still cannot establish the semantics of arbitrary prose; every research answer is flagged for manual review of price attribution, the Cedar refundable recommendation, deadline and citation support. Regression checks cover swapped prices, wrong recommendations, unreferenced metadata, absent source reads, altered fields and missing/failed trials.

The matched driver (`scripts/benchmark-matched.mjs`) is prepared for three repetitions per implementation. It runs Jevry/Firecrawl, then Firecrawl/Jevry, then Jevry/Firecrawl, always sequentially. Each child runs all five prompts once. Nonzero exits, missing tasks and failures remain in the expected denominator. It saves all six original reports and an aggregate containing raw values, minimum, median and maximum; failed-attempt timings and pass-only timings are separate. Three repetitions cannot support a meaningful p95, significance claim or overall product ranking.

The first matched attempt stopped after its initial Jevry session passed all five task checks but the app failed during shutdown: the native evaluator accessed the debugger after its web contents had been destroyed. Its task results remain in `artifacts/matched-final/1-jevry.json`; they must not be pooled into a completed matched study. After that lifecycle repair, the next attempt in `artifacts/matched-v030/` encountered an infrastructure failure: Playwright's default Chromium revision was unavailable, and the explicit installed-browser override had been omitted. Those reports are also retained rather than erased or counted as model-reasoning failures. Neither interrupted attempt is a completed matched study.

The driver now flags every nonzero runner exit and explicit `cleanup.ok === false` independently of task success, so five successful task outcomes cannot conceal a broken shutdown. Before any live runner starts, it imports Chromium from the same Playwright package as the Firecrawl runner, checks the explicit `JEVRY_BROWSER_EXECUTABLE` or default executable, launches a disposable browser, reads `about:blank`, and closes it. Failure writes a preflight-only report with zero model requests. The available Chromium 151.0.7922.34 passed this actual launch/read/close check in 520 ms; the intentionally missing path was rejected before launch. Every live rerun must use a fresh output directory.

Both sides use case-scoped Claude CLI sessions, the same low effort configuration, and no model override. The actual resolved model must be recorded and agree; configuration or source/build drift is reported. Each case gets a unique scope, shared only across that case's follow-up messages and cleared afterward. The provider retires a worker at eight requests or 200k input characters, so the substantially larger Firecrawl graph transcript can trigger recycling before the final turn. A “warm” session setting does not guarantee that every call reuses a process. The earlier five-turn result above used one-shot calls and must not be pooled with scoped-worker trials.

The driver pins source files, loaded Electron build artifacts, fixture/protocol/evaluator files, runner scripts, upstream source and dependency lockfile. It stops subsequent runs on detected drift and preserves completed evidence. Browser versions are recorded separately: native Electron and injected headless Playwright Chromium remain different runtimes. The full Firecrawl graph uses a buffered JSON tool-call bridge and may batch six generic observed operations; those differences remain part of this narrow source-orchestration comparison, never evidence of native Firecrawl product latency.

```sh
pnpm --dir upstream/web-agent/agent-core install --frozen-lockfile --ignore-scripts
node --test tests/benchmarks/firecrawl-evaluate.checks.mjs
# Freeze and build the app before starting; choose a fresh output directory.
node scripts/benchmark-matched.mjs --run-live
```

The completed frozen study is retained in `artifacts/matched-v030-verified/`. It ran all 30 turns sequentially in the declared alternating order, resolved the same `claude-fable-5-1` model on both sides, and detected no source/build drift. Raw automatic outcomes were Jevry 15/15 and Firecrawl source 14/15. A separate assistant reviewed all 30 answers, page receipts and source traces: **15/15 for each implementation**. Firecrawl's second cancellation follow-up was a prose-attribution false negative in `cedarDeadline`; the raw score and nonzero-exit warning remain unchanged. `semantic-review.json` records the correction and its evidence without rewriting the underlying results. This is a review within the same development task, not a blinded external evaluation.

| Shared task, three runs each | Jevry median (range) | Firecrawl source median (range) | Text calls per turn, Jevry / source |
| --- | --- | --- | --- |
| Paris / two guests | 12,212 ms (10,155–12,437) | 14,752 ms (14,500–17,996) | 1 / 3 |
| London / preserve two | 7,866 ms (7,532–8,679) | 9,995 ms (9,951–14,338) | 1 / 2 |
| Ask latest result | 4,693 ms (4,546–7,692) | 6,128 ms (5,787–7,202) | 1 / 1 |
| Compare source policies | 15,862 ms (15,859–18,202) | 17,948 ms (17,841–21,943) | 2 / 3 |
| Cancellation follow-up | 4,914 ms (4,454–6,722) | 5,222 ms (4,983–6,380) | 1 / 1 |

Jevry had the lower observed median in all five fixture tasks, and individual timings overlapped or reversed on some turns. Its action turns additionally used real Jev choices; the text-call column does not imply equal total inference calls. These data establish a narrow improvement in measured fixture completion time against the declared Firecrawl source adapter while preserving the tested conversational outcomes. They do not establish a success-rate advantage, a general or statistically proven speedup, Firecrawl cloud-product superiority, an Ego comparison, or zero latency.

## What an Ego host adapter could and could not establish

The public `installEgoSdk(target, options)` entry point is real and embeddable (`package/ego-browser/src/index.ts:55–140`). However, the default helpers call native `globalThis.ego`; the source explicitly checks for `sendCDPMessage` (`browser-runtime.ts:335–343`) and binds response/error callbacks (`:369–375`). A custom host could translate this transport to real Playwright CDP sessions and exercise some actual executor functions.

CDP transport alone is insufficient for the full harness. Its snapshot driver directly calls the host's `ego.snapshot(options)` (`driver/observe.ts:53–55`). Page services also require tab inventory, user/agent ownership, task-space handoff/completion, clipboard and snapshot behavior (`page-model.ts:334–360,706–725`). The closed app supplies those semantics, including native snapshot/reference behavior. Replacing them with a homemade DOM reader and ownership model would substitute key parts of the product under comparison. The repository's fake-host/unit-test facilities do not establish compatibility with the closed browser or make such a host an officially supported Playwright backend.

Therefore a clearly labeled **Ego source executor + custom host** test is technically possible for a subset, but it cannot measure genuine Ego browser behavior, native snapshot quality, user handoff or product latency. No such shim result is recorded as an Ego product score. The absence of an installed app is not a blocker to trying the actual product: the repository README links public Apple Silicon and Intel installers. Native evaluation has not yet been performed and must be pursued through that genuine host before claiming the runtime is unavailable.

### Genuine host acquisition and isolation plan

The pinned README links the [Apple Silicon installer](https://cdn.ego.app/setup/macos/arm64/egolite-Y7MbxKIuhzFB.dmg) and says first launch offers optional Chrome migration (`README.md:49–76`). It also says the app installs its skill into every agent's skills directory (`:53`). The convenience installer is unsuitable for an isolated comparison: it points at an older DMG, may replace `/Applications/ego lite.app`, removes quarantine, and immediately launches the app (`skills/ego-browser/scripts/install.sh`). None of those global changes is necessary to exercise the native browser.

After the concurrent matched study finishes, download the README-linked DMG to a temporary directory, mount it read-only and inspect the app bundle and signature before launching. Invoke the bundled `Frameworks/ego Framework.framework/Versions/Current/Helpers/ego-browser` directly, as the repository's real-browser CLI resolver does. Build the pinned SDK under its ignored upstream subtree with install scripts disabled, and pass its absolute `dist/out/index.js` using the officially documented temporary `--sdk-path` option (`docs/local-runtime-development.md:29–46`). Do not use global `npm link`, the skills installer, or private Chrome data.

The open repository does **not** document a disposable native-profile launch flag, a switch disabling global skill installation, or native CLI routing to an alternate browser profile directory. A Chromium `--user-data-dir` launch plus OS-enforced access restrictions is a candidate to verify against the real binary, not an established supported flow. The macOS `sandbox-exec` tool is present; its process policy can prevent writes to agent configuration and reads of private browser profiles while allowing the temporary app/profile. Bundle/helper inspection and a bounded launch must establish which isolation controls the actual host honors. Decline browser import and keep all test pages local. The docs mention an internal authentication profile but do not establish that an account login is required; report the actual onboarding outcome instead of inferring either availability or a login blocker.

For runtime state, set `process.env.EGO_BROWSER_STATE_DIR` **inside each SDK script before the first `taskSpace()` call**, pointing into the disposable directory. The upstream E2E wrapper states that arbitrary shell environment variables are not forwarded into Ego's Node process (`scripts/real-browser-e2e/ego-source.mjs:29–33`); setting only the launch environment would fail to isolate the Page ledger. Create a uniquely named task space, run a small genuine-native snapshot/form check first, and close only its created tabs/space afterward. The repository's selected real-browser E2E path is the compatibility check; no homemade native snapshot shim should substitute for it.

The genuine ARM64 DMG was downloaded in **8.56 seconds** (135,397,248 bytes) and mounted read-only for inspection, then detached after the experiment below. Its SHA-256 is `7f33e5371e676ae4dcf92a7ef2cde0886decbba9ceb1462cbf0afe2a9da58b2d`. The app is version **0.5.1.11**, bundle ID `com.citrolabs.ego.lite`, requiring macOS 13 or newer. Normal `codesign --verify` checks passed for the app and bundled helper. Signature metadata identifies **CITRO LABS PTE. LIMITED (JGQLC6YQYJ)** with Apple's certificate chain and a stapled notarization ticket. A separate deep strict check failed on a disallowed `com.apple.FinderInfo` attribute in `app_mode_loader`; no attributes were removed or changed. These distinct results are preserved in `artifacts/ego-host-inspection.json`.

Static helper help text exposes `--ego-server-name=<name>` for connecting to a named browser service, and the framework contains both that option and `user-data-dir`. This makes a separate named service plus fresh profile a concrete next experiment, but string presence does not prove the launch works. The helper also contains automatic-launch/onboarding behavior, so even `--help` was not executed during acquisition. No graphical process, installer, browser import or global skill/agent configuration write occurred. Native runtime evaluation remains pending after the matched study.

`scripts/ego-inspect-launch.mjs` now provides the bounded experiment without launching Ego itself. Its default read-only inspection resolves the actual mounted app/helper paths and recorded signature result, and writes nothing. After model timings end, `--prepare` creates a temporary manifest, profile, native temporary directory, SDK state directory, policy and before-state metadata. The generated launch arrays call `sandbox-exec` directly with candidate `--user-data-dir`, unique `--ego-server-name` and `--startup-ego-browser-service` switches; they do not use `open`, a global CLI or the convenience installer. `HOME` and `CODEX_HOME` stay unchanged. Only `TMPDIR` points inside the disposable root.

The candidate policy denies all file writes outside that root (apart from `/dev/null`) and denies reads anywhere under the real home except the exact pinned SDK bundle. It also blocks preference/default-handler/keychain delegation services and permits only local fixture network traffic. No permissive fallback is automatic. `--policy-check=<manifest>` can test allowed temporary writes and denied outside writes/home reads using owned fixture files, without running Ego. Policy syntax and host compatibility still require this actual post-timing check; preparation alone does not establish isolation.

`--verify=<manifest> --pid=<nativePID>` performs a read-only after-check: it requires the exact profile and service command-line arguments, real profile files created inside the temporary directory, an open native-process file in that profile, and unchanged metadata for monitored global skills, CLI, shell, Ego and default-handler configuration. It opens no existing browser-profile or credential contents. Metadata stability supports the OS restrictions rather than replacing them. Recheck after shutdown. Only after isolation and minimal no-import/no-default-change onboarding succeed should the separately reviewed helper command run the generated native probe. That probe sets `EGO_BROWSER_STATE_DIR` inside the SDK script, creates one uniquely named task space, obtains the actual native browser version on `about:blank`, and finishes only that space. No login or signup is included.

The first functional attempt found a real setup limitation. After correcting the local-network policy syntax, its OS canary allowed a temporary write while denying an owned home-file read and a write outside the disposable root. The genuine app then started with the exact profile and service arguments, but created no profile files and exited with `FATAL base/path_service.cc:264: Failed to get the path for 1001`. Current Chromium identifies 1001 as `DIR_USER_DATA`, so it is not evidence of a generic macOS Application Support parent lookup. ([Chromium path enum](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_paths.h))

A subsequent LaunchServices process appeared from the mounted app without those isolation arguments. The filtered system log identifies `com.apple.coreservices.uiagent` as its launch originator; the initiating client was not established. The only Computer Use call made during this phase was app enumeration, not `get_app_state`, clicking or typing. The unexpected process was terminated. It had introduced global skill/CLI links and an Ego preference plist; each item proven absent in the baseline was moved into the disposable rollback directory, with its original path verified absent afterward. The small `.local/share/ego` directory was then checked to contain exactly two symlinks resolving into this task's unique mounted app resources, and it too was moved reversibly into rollback. The original directory is absent and no mounted-app processes remain. No Chrome import, account flow or native helper probe was performed by this agent. `artifacts/ego-isolation-attempt.json` preserves the baseline hash, process evidence, exact link targets, birth times and cleanup record.

One bounded static follow-up found native `MaybeSetupAgentsOnStartup` strings naming the observed skill/CLI integration and a possible Codex rule insertion. The actual `.codex/rules/default.rules` file contained no Ego rule and its modification time predated the test; it was left untouched. Future metadata baselines now include that file and `.local/share/ego`. The binary confirms generic Chromium `user-data-dir` and Ego named-service flags, but exposes no documented integration opt-out or SDK mechanism for selecting a disposable native user-data root. SDK `EGO_BROWSER_STATE_DIR` isolates only its own Page ledger. No reliable native-host isolation route was established by this inspection.

Cleanup finished at **2026-09-22 12:27 UTC**. A fresh process check found no executable running from the mounted image; its exact downloaded-image identity and read-only state were verified before `hdiutil detach`. Detachment succeeded and a second image inventory confirmed the mount was absent. The downloaded DMG, source SDK, evidence and reversible rollback files remain preserved. No further Ego app or helper was run.

This attempt **did not establish safe native profile routing or launcher containment**, and therefore produced no Ego functional or performance score. It also does not prove the product is unavailable or broken: the test's restrictions and launch path remain part of the unresolved setup. Further testing must establish the relaunch origin and preserve profile/global-state boundaries before executing the harness. No unsupported sandbox relaxation or repeated launch guessing follows from this result.

## Live evaluation status

At the initial source audit, the inherited shell environment exposed no `TYPESAFE_API_KEY`, `JEV_API_KEY`, `FIRECRAWL_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (presence booleans only were inspected). This did **not** establish the status of keys saved inside Jevry or a signed-in CLI. The `/Applications` name inventory contained no ego app.

The subsequent live validation found saved **Claude text + `jev-latest`** connections through the app's public status. `scripts/test-live-conversation.mjs --run-live` copied only the encrypted connection file to a disposable isolated profile; it did not print/decrypt credentials in the test script, open private browsing profiles, or access model account files. Actual provider calls then drove a local form through three conversational turns and verified persistence after restarting the app:

| Live turn | Verified result | First visible reply | First actual action | Total |
| --- | --- | --- | --- | --- |
| Find Paris stays for two | Paris / 2 guests; one submit | 4,574 ms | 15,524 ms | 25,982 ms |
| Change to London, same guests | London / 2 guests; one additional submit | 5,389 ms | 16,674 ms | 28,726 ms |
| Ask what result and guest count | Answer says London and 2; no page action | 3,604 ms | None | 8,490 ms |

All six messages were restored on app restart. `artifacts/live-conversation-before.json` preserves this first real-provider trial. This verifies the original continuity failure is repaired on one real three-turn task; its roughly 26–29 second action turns also reveal that the product is not yet acceptably fast. Provider/CLI overhead and final-answer generation dominate the subsecond local executor. Additional matched trials are needed before treating a timing change as a general speed improvement.

After moving exact observed-field values into the planner response and shortening the answer instructions, the same real-provider task passed again, including restart persistence. This second run used prepared field text for both action turns and made no separate field-generation call:

| Same live turn | Before total | After total | After planning | After browser execution and inference | After final answer |
| --- | --- | --- | --- | --- | --- |
| Paris / 2 guests | 25,982 ms | 21,699 ms | 11,632 ms | About 1,881 ms | 8,055 ms |
| London / preserve 2 | 28,726 ms | 20,214 ms | 9,838 ms | About 1,569 ms | 8,690 ms |
| Read-only follow-up | 8,490 ms | 8,236 ms | 8,043 ms | No actions | Included in planning |

`artifacts/live-conversation-after.json` includes phase events and the short actual replies. First actual action improved from 15,524 to 12,482 ms and from 16,674 to 10,705 ms. First visible text was **not consistently faster** (7,130/5,074/4,114 ms after, versus 4,574/5,389/3,604 ms before). The fixture was already open before each test sequence; these turn timings exclude launching the app and initial page loading. These are single matched observations under variable provider latency, not statistically established speedups or competitor timings.

At that second trial, the measured bottleneck was the Claude planning/answer path, consuming roughly 18–20 seconds of the action turns. Optimizing a 100 ms offline DOM loop alone could not solve it. The measured live Jev/browser portion was approximately 1.6–1.9 seconds on those simple tasks.

A final trial removed the answer-model call when the planner explicitly requested a simple form result and the browser observed a changed, concise status. It also replaced Claude's default coding-system prompt with the compact browser prompt and set CLI effort to `low`, without adding a model override. **The effort and prompt configuration changed**, so this trial does not isolate one optimization or prove that low effort is faster generally.

| Same live turn | Original trial | Final trial | Final planning | Final first visible text | Final first action |
| --- | --- | --- | --- | --- | --- |
| Paris / 2 guests | 25,982 ms | 15,023 ms | 12,523 ms | 7,382 ms | 13,746 ms |
| London / preserve 2 | 28,726 ms | 11,069 ms | 8,849 ms | 3,869 ms | 10,546 ms |
| Read-only follow-up | 8,490 ms | 10,563 ms | 10,551 ms | 6,189 ms | None |

All three final turns passed, with exactly the Paris/2 and London/2 submit receipts, no page action for the last question, and six messages restored after restart. The action answers directly quoted “Stays in Paris for 2 guests” and “Stays in London for 2 guests” from the observed page status. Both used prepared field text and `PAGE_STATUS`; neither made `FIELD_TEXT` or `ANSWER` model calls. Final browser execution and Jev inference occupied about 2.2 seconds after planning. `artifacts/live-conversation-fast.json` records every phase.

Action completion was faster in this trial, while the read-only turn and some first-visible timings were slower. Planning still took about 9–13 seconds and remained the dominant measured delay. No repeated statistical speed claim, zero-latency claim, or overall competitor win follows from these three trial sequences. Later scoped-worker and source-research work changed the runtime again; the matched protocol above records that configuration separately.

`tests/benchmarks/live-task-protocol.json` defines eight shared task families covering follow-ups, mixed chat/action, corrections, interruption, tab scope, stale targets, complex controls and source discovery. Run it against real providers/products with recorded model versions and at least ten repetitions per task/product before claiming an overall win. Keep failures and unsupported cases visible, include page loading in end-to-end timing, and publish success rate alongside median and p95 latency.

The upstream 7,073 ms Flights video and 25% optimization claim are evidence for its own specific run/variant comparison (`upstream/jev-ultrafast/README.md:120–124`), not timing measurements of Jevry and not a ranking of these four products.


_Public snapshot note: local run artifacts referenced above are retained by the maintainer and are not distributed in this repository. Their descriptions are historical reports, not independently downloadable evidence._
