# Research

`desktop/main.ts` coordinates source acquisition in `source-discovery.ts`, native evidence extraction in `page-evidence.ts`, and synthesis in `research.ts`. Research can use supplied URLs, open pages, observed index links, or Google searches. Sources open in background Chromium tabs; research does not click controls or submit forms.

This local implementation draws on Firecrawl Web Agent's bounded workers, progress events, and structured results. It does not use Firecrawl's hosted service or SDK; see [attribution](UPSTREAM.md).

## Scope and acquisition

The message's `sourceTabIds` overrides model-proposed scope:

| Value | Behavior |
| --- | --- |
| Omitted | Automatic: relevant existing pages and discovery as needed. |
| `[]` | Web-only discovery, excluding existing tabs. |
| 1–8 distinct IDs | Only those open pages; no additional URLs, searches, or link following. |

A closed selected page produces an error. Otherwise, the planner can propose three queries, eight direct URLs, existing tab IDs, and one level of link following. Addresses are deduplicated, fragments removed, and only HTTP(S) destinations without embedded credentials accepted.

Navigation uses at most three concurrent workers and retains up to eight sources. Search pages supply observed links. A ranking request selects at most five IDs from the first 45 candidates, within remaining capacity; invented IDs are rejected before navigation. A supplied index with no search queries and at most five links that fit the remaining capacity skips ranking and reads those links together. Destination links are not followed recursively. Successfully used search tabs close; source tabs remain available.

## Native evidence and synthesis

Navigation proceeds at DOM readiness, with a 25-second deadline. A cached Chromium DevTools Protocol isolated world reads the document while slow images or other subresources may still be loading; its context refreshes after document/frame changes.

Extraction includes rendered text below the fold, background tabs, open shadow roots, and accessible same-origin frames. It excludes hidden/inert content, scripts, editable form values, suppressed slot fallback, and closed-detail contents. Cross-origin frames, closed shadow roots, and content arriving after the read are outside that evidence.

| Bound | Limit |
| --- | --- |
| Source pages / concurrent navigation or reads | 8 / 3 |
| Raw document text / synthesis excerpt per source | 30,000 / 7,500 characters |
| Extracted links per page | 120 |
| Traversal | 20,000 elements, 40,000 text nodes, 80 roots, 16 frames |
| Goal / source title / source URL | 12,000 / 240 / 4,096 characters |

Full-document extraction removes viewport clipping, not excerpt limits. Synthesis receives up to 60,000 characters of page text plus metadata and instructions.

`researchTabs({goal, tabs, textConfig, signal, emit})` reads sources and makes one synthesis request, returning `{summary, findings: [{text, sourceIds}], sources: [{id, title, url}]}`. Planning and discovery may make additional model calls. The normal answer is one or two sentences with one to six compact findings; hard limits allow a 4,000-character summary and 20 findings.

## Citations, interruption, and history

The reader assigns IDs `S1`–`S8` and captures actual observed titles/URLs. Summaries must cite known IDs, and findings must identify valid, unique sources. Unknown citations, generated URLs or Markdown links, extra fields, malformed JSON, and oversized output are rejected. The renderer builds links from validated IDs and observed addresses, without executing model HTML. Citation validation establishes destinations, not factual correctness; completion remains `verified: false`.

Discovery failures appear in activity. Unreadable sources are excluded with a coverage statement; no synthesis runs if every read fails. Cancellation stops new work, aborts inference/native navigation, removes a cancelled owned navigation tab, and ignores late reads. Already opened sources and completed actions remain. Stopped partial text is preserved. Saved source addresses and bounded findings can inform follow-ups; see [Conversations](CONVERSATIONS.md).

## Verification

- The focused suites pass **64 tests**: 35 conversation/planner, seven discovery, and 22 synthesis checks, including scope, concurrency, cancellation, citations, history, and rollback.
- The current default suite passes **147 tests**, with 15 opt-in skips. Actual Chromium passes **34 tests**, including seven extraction checks covering below-fold/background content, shadow roots, frames, hidden/editable content, and links.
- Actual Electron research smoke passes seven checks: background discovery, evidence/citations, selected scope, closed-source rejection, DOM readiness despite a stalled image, cancellation, and rename/delete IPC. Desktop workflow smoke separately passes nine. These integration checks use deterministic local model responses.

Live-provider records retain an initial failed attempt (local artifact: `artifacts/jevry-research-first.json`) and successful single samples of 38.7 seconds (local artifact: `artifacts/jevry-research-second.json`) and 15.9 seconds (local artifact: `artifacts/jevry-research-third.json`) on the local linked-source fixture. Each used one repetition and a different code snapshot; they establish neither a repeatable speedup nor superiority over another browser.


_Public snapshot note: local run artifacts referenced above are retained by the maintainer and are not distributed in this repository. Their descriptions are historical reports, not independently downloadable evidence._
