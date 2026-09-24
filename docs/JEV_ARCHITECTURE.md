# Jev inside a browser: the decision architecture

Jevry makes the browser's supported actions explicit, asks Jev to choose among them, and keeps the actual mutation in application code. This document describes the public beta.13 source, including its complete-action compiler. It is an implementation guide, not a claim about Jev's training internals.

## Model, application, runtime

TypeSafe supplies **Jev**, a System One decision model. Jevry supplies the observations, questions, action schema, state management, executor, and user interface. A separate connected text model supplies language generation and richer planning. Jevry does not train a browser foundation model.

TypeSafe documents Choice, Score, and Noul as model primitives. The browser action path uses **Choice**: a selected option, a distribution over the offered options, and confidence. Jevry calls `POST https://api.typesafe.ai/v1/systemone`, with `jev-latest` as the default model alias. [Official API](https://docs.typesafe.ai/api)

The normal DOM observation contains text and structured controls. Jev is not receiving a screenshot of every browser action. Supported game flows use a separate vision-capable provider for calibration, then convert pixels into textual/numeric state locally.

## 1. Make the available actions concrete

The snapshot reads compatible controls and their surrounding context atomically. Node references live in an application-owned isolated world and belong to the observed document. Each candidate describes such details as label, role, current value, selection state, observed destination, or relevant popup context.

For an eligible ordinary page, `compileJevWebActions` creates at most 240 complete choices. The operation and target travel together. Here is an **illustrative shortened request**, not a captured production trace:

```json
{
  "model": "jev-latest",
  "state": {
    "page": { "title": "Search", "text": "Destination: Paris. Guests: 2." },
    "recent_actions": []
  },
  "questions": {
    "web_action": {
      "type": "choice",
      "instructions": "Change the destination to London and retain two guests. Choose one next action.",
      "criteria": {
        "TYPE_TEXT:4": { "operation": "TYPE_TEXT", "target": "4", "element": "Destination", "current_value": "Paris" },
        "CLICK:17": { "operation": "CLICK", "target": "17", "element": "Search" },
        "DONE": { "description": "Every requested outcome is supported by current evidence." },
        "BLOCKED": { "description": "No supported action can progress." }
      }
    }
  }
}
```

A `TYPE_TEXT:4` selection points into the saved action map. It does not authorize an arbitrary selector or code fragment. The actual generated request contains additional page state and policies. User-supplied literals can be selected in companion questions; otherwise a text helper prepares the field value. That helper is separate from action selection.

Read: [complete-action compiler](../desktop/jev-web-actions.ts), [literal selection](../desktop/jev-literals.ts), [snapshot](../desktop/snapshot.ts).

## 2. Use one request where decisions can be batched

The fallback schema asks an operation question plus operation-specific target questions in one request. For example: which operation advances the goal; which observed button would be appropriate if clicking; which field would be appropriate if typing. The executor consumes only the target answer belonging to the selected operation.

These questions are **independent**, not a hidden chain of reasoning. A target head cannot see the operation head's answer. That is why its assumptions must be explicit, and why complete operation/target pairs are useful on ordinary pages. This follows the [official speculative fan-out pattern](https://docs.typesafe.ai/patterns/fan-out).

Large dropdowns require another boundary: the fallback splits more than 255 options into groups of 200, asks for a group and its conditional target choices together, and consumes the selected group only. Game keys on a single observed board do not need a redundant target question. Unsupported compiler inputs fall back to the established schema rather than dropping required context.

One request per routine action decision does **not** mean one request per task. Planning, text generation, completion checks, blocked-state review, and visual setup can require additional inference. The transport may also perform bounded inference recovery; that must never become a browser-input retry.

Read: [request builder and decoder](../desktop/engine.ts), [transport](../desktop/jev-transport.ts).

## 3. Treat probabilities as model output, not permission

The response validator checks that choices belong to the offered set, probability keys cover it exactly, numbers are finite and in range, the distribution approximately sums to one, and the selected option is maximal within the API's rounding tolerance. Invalid responses do not dispatch an action.

TypeSafe's confidence value summarizes the probability distribution; it is not an independently established probability of task success. A sharply peaked wrong choice remains possible. Jevry does not claim that every action uses a learned risk threshold or that structured output eliminates semantic mistakes. [Official confidence semantics](https://docs.typesafe.ai/confidence)

That distinction leaves room for useful research: evaluate calibration, abstention, and cost-sensitive escalation against actual browser outcomes rather than treating confidence as a safety certificate.

## 4. Recheck before mutating the page

Between observation and model response, a page can navigate, change a field, disable a button, or place a dialog over the target. Before dispatch, Jevry checks document identity and target freshness, semantics, visibility, current values, and occlusion.

A stale observation can be discarded and refreshed. An action that might already have started cannot safely be replayed: the page may have accepted input before the transport failed. Jevry records execution before waiting for the resulting page and stops on uncertain mutations.

Cancellation also has a lifetime. Aborting inference prevents its eventual reply from triggering input; active provider processes and owned tab/navigation work must drain or be retained appropriately. A user correction starts from the actual resulting browser state.

Read: [engine](../desktop/engine.ts), [native evaluator](../desktop/native-evaluator.ts), [owned navigation](../desktop/owned-navigation.ts), [turn lifecycle](../desktop/turn-work.ts).

## 5. Check completion and completeness separately

A goal becomes observable success conditions and constraints. A `DONE` proposal triggers fresh evidence assessment: page text, rendered records, current field values, selected labels, and prior observations can be relevant. Coverage is asked separately so a matching item does not imply that every requested item was read.

Observation memory preserves whole records, provenance, truncation signals, and recent filter/sort context. Bounded exact-URL visit counts help Jev notice revisits; they neither hide links nor serve as completion evidence.

These remain model-grounded assessments. The engine's independent `verifyOutcome` hook and a benchmark's official evaluator are separate sources of verification. In WebArena development, tasks sometimes passed official grading despite an internal agent error; other tasks were described as complete but failed the grader. Both outcomes remain recorded.

Read: [completion](../desktop/task-completion.ts), [memory](../desktop/observation-memory.ts), [visit history](../desktop/destination-visits.ts), [evaluation](BENCHMARKS.md).

## 6. Put exact game mechanics in code

For supported numeric merge games, the perception layer calibrates a grid and learns tile appearances. Local matching and bundled OCR produce a board. The forecast module calculates legal moves and bounded position estimates; Jev chooses the move to dispatch.

This architecture deliberately gives the model a useful representation. It does not demonstrate visual end-to-end learning or a universal game policy. It does demonstrate integration of perception, deterministic simulation, decision inference, native input, and objective checking in a running desktop browser.

Canvas focus stays stable for the run, captures preserve viewport geometry, and owned attributes are cleaned up. The objective is the actual target tile or victory condition; cumulative score is only progress. [Controller design](GAMES.md) · [Observed results](GAME_RESULTS.md)

## 7. Measure the system, not just the model call

The latest recorded 12-task development run had a 392 ms median Jev request, but 44.169 seconds median task time. It improved from 7/12 to 10/12 official passes while total actor time rose from 456.707 to 542.831 seconds.

The gap is the systems problem: task decomposition, repeated navigation, page state, completion checks, model calls, and answer generation all matter. A useful optimization must retain correctness and account for end-to-end time. The public [score summaries](benchmarks/development-results.json) and [attempt log](BENCHMARKS.md) expose that tradeoff rather than hiding it behind inference latency.
