# Latency and benchmark boundaries

Jevry records observation, Jev inference, text generation and action duration in the event stream. The panel shows total elapsed time, action count and mean Jev decision duration. Export the run as JSON for comparisons. Research has separate read and synthesis timings.

The architecture avoids the slowest unnecessary hops: no backend HTTP hop from renderer to a server, no repeated browser startup, no screenshot capture/upload in each action cycle, no text planner for every click, no subprocess per browser command, no fixed multi-second sleep, no full page load wait after each click. Native views reuse Chromium and CDP sessions. Indexed targets and speculative choice heads come from jev-ultrafast. Text-helper cache reuse and short state-aware settling preserve its low-overhead design.

API text generation reuses the process network stack. Claude requests with an explicit conversation scope now reuse a bounded streaming worker; Codex and unscoped CLI requests remain separate processes. Workers drain on cancellation, scope/model changes, connection changes and conversation deletion, and retire after eight requests, 200,000 prompt characters or two idle minutes. See [provider isolation and limits](PROVIDERS.md). The initial planner prepares unambiguous values for currently observed fields. Simple tasks quote a newly changed page status directly. Both avoid unnecessary model calls. Chat replies need only the answer and intent; research normally returns a concise answer and compact cited facts. Claude uses the compact browser prompt and low effort; configured model selection is preserved.

Native source navigation begins reading at DOM readiness. Isolated CDP evaluation avoids Electron's full-load script wait, so a stalled image cannot hold up page evidence. Source opens and reads are bounded to three concurrent pages and eight total sources. When an explicitly supplied index has at most five available links, those observed pages are read directly in a bounded batch; larger indexes and web search results still require model selection. No URLs are invented by that selection step. Regional inference routing, speculative browser input and independent generic outcome verification remain future work.

## Beta.5 Jev path

Suitable first-turn retrieval requests use one bounded Jev classification request to validate exact user clauses. The shortcut has a shared three-second deadline and retains the general planner for ambiguous or unsupported requests. A controlled 42-request replay accepted 17/21 candidate plans at the unchanged confidence thresholds, compared with 0/21 original plans; median API times were 349 and 389 ms. This measures classification, not browser task completion.

Ordinary web decisions combine operation and observed target into one finite Choice. Current field values remain attached to alternatives, and completion evidence is requested only on a proposed DONE. Literal values copied from the user still require Jev validation. Large dropdowns remain bounded and grouped. The game control path retains its separate schemas and objective checks.

A first inference without response headers after ten seconds may start one replacement inference under the same 25-second deadline. The original remains eligible, the loser is cancelled, and overload disables later replacement attempts. This can consume a second inference; it never duplicates browser input. Live benefit has not yet been established.

End-to-end timing includes planning, all browser actions, recovery and the final answer. Faster classification or fewer schema tokens alone is insufficient: development traces still show costly reviews and incomplete tasks. [Benchmark records](BENCHMARKS.md) retain each attempt, its official score and the timing limitations.

## Fair comparison protocol

1. Pin source revisions and hardware, browser version/profile, viewport and network region.
2. Use matching Jev/text models, keys, budgets, reasoning settings, and starting state.
3. Cover search, forms, dynamic autocomplete, dropdowns, navigation, long content and multi-source research. Include hard and unsuccessful cases.
4. Start timing when the user submits a task; separately report warm and cold startup. Include navigation, all inference, generated text, retries and loading.
5. Verify final task conditions independently. Measure success rate before speed. Report p50/p95 total duration, decision latency, protocol calls, cost, retries and failure categories over enough repeated runs.
6. Preserve all trials, not only the fastest success. A lower median on one task does not prove general superiority.

Current evidence includes encrypted multi-turn restart tests, eight real Chromium engine fixtures, and three live-model conversation trial sets using saved Claude and Jev connections. In the final single trial, Paris/two took 15.0 seconds, London/same guests took 11.1 seconds, and the read-only follow-up took 10.6 seconds. Planning still dominated. Those trial configurations changed; the question turn became slower. They establish neither repeatable latency gains nor superiority.

The shared actual-source control comparison passed 15/15 for Jevry and 6/15 for upstream Jev across five fixture families. Inference was deterministic; it measures selected execution coverage, not live reasoning or model speed. The actual Firecrawl source graph also passed the five shared live tasks using its public injected-toolkit API and a real Claude protocol bridge. That comparison covers open-source orchestration with a local browser adapter, not Firecrawl's proprietary cloud product. Ego's signed native app has been acquired; its isolated runtime evaluation is still in progress. See [Competitive review](COMPETITIVE_REVIEW.md) for current matched results, source revisions and limitations.

The completed v0.3 repeated study used three sessions per implementation and the same resolved Claude model. Both passed 15/15 turns after semantic review corrected one automatic-checker false negative. Jevry's medians were lower by 5.9–23.4% across the five shared tasks; individual runs overlapped and some follow-ups were slower. The median five-turn total was 47.960 seconds for Jevry and 58.403 seconds for the adapted Firecrawl graph. These are descriptive fixture measurements, not a native-product speed ranking. Raw reports and reviewed evidence are in `artifacts/matched-v030-verified/`.
