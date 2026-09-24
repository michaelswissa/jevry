# Public benchmark summaries

These are maintainer-exported **development results**, scored with the unchanged official WebArena-Verified evaluator. They describe selected runs of earlier candidates, not the current source's full-suite performance.

The [JSON summary](development-results.json) includes every attempt listed below, the selected task IDs, task-level official scores/statuses, actor durations where available, bundle hashes, evaluator version/checksums, and the pinned benchmark revision. It is generated from an explicit field whitelist in retained local reports. Task prompts, reference answers, evaluator assertions, provider payloads, cookies, and session data are excluded.

| Attempt | Official passes / scored tasks | Planned tasks | Interpretation |
| --- | ---: | ---: | --- |
| `beta4-baseline-001` | 0/3 | 3 | Initial baseline. |
| `fix-001` | 2/3 | 3 | Development rerun. |
| `fix-002` | 2/3 | 3 | Different task failed; do not combine into 3/3. |
| `fix-003` | 4/6 | 6 | Expanded subset. |
| `fix-004` | 7/12 | 12 | Expanded to four benchmark sites. |
| `fix-005` | 7/12 | 12 | No aggregate score improvement. |
| `speed-001` | 9/12 | 12 | Complete development run; some tasks slowed down. |
| `speed-002` | No official scores available | 12 | Interrupted environment failure; not a 0/12 or completed run. |
| `speed-003` | 7/12 | 12 | Regression retained. |
| `speed-004` | 5/7 scored | 12 | Incomplete, host-disrupted run; no valid complete timing result. |
| `speed-005` | 7/12 | 12 | Complete development run. |
| `speed-006` | 10/12 | 12 | Complete development run; tasks 47 and 102 failed. |

The fixed 12-task matrix is `0, 11, 41, 27, 66, 399, 21, 47, 96, 44, 45, 102`. The full benchmark contains 812 tasks. Repeated use of these tasks makes this a development set; 10/12 is not an estimate of full-suite performance.

## Timing tradeoff

| Measurement | `speed-005` | `speed-006` |
| --- | ---: | ---: |
| Actor time across all 12 tasks | 456.707 s | 542.831 s |
| Median task time | 23.367 s | 44.169 s |
| Median Jev request | 443 ms | 392 ms |

Accuracy increased, while total actor time increased by about 18.9%. The lower decision median did not imply lower end-to-end task latency. Timing is descriptive of the local setup; disclosed environment compatibility changes prohibit treating it as a fair speed comparison against other benchmark implementations.

## What can be independently checked?

The summaries make the reported denominators, per-task scores, failures, and timing arithmetic inspectable. The public repository also includes the actor input filter and evaluation harness. Raw private traces are not distributed here, so the summary is **not** independent reproduction or a public full-trace audit. A fresh reproduction needs the official benchmark checkout, environments, reset procedure, and model connections described in the [methodology and failure history](../BENCHMARKS.md).

The actor receives public task inputs; reference answers and evaluator assertions stay outside its context. The evaluator runs afterward. An agent's completion message is not substituted for the official grade. A future final evaluation must freeze the implementation and use an untouched declared set, retaining failures and interruptions.
