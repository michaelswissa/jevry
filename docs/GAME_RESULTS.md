# Game controller validation

## Supremacy 1914 — map controls, popups and construction

The beta.11 live run in the existing user session built **Workshop Level I in Burgos** with ordinary resources. The agent dismissed the Starter Pack offer and an unexpected Verify Email reminder, selected the province on the map, opened construction, and clicked the observed Workshop hammer control. The resulting construction panel offered Workshop Level II, and independent UI inspection showed the Workshop I building icon in Burgos. Goldmark remained **2,500**. No email, purchase or war declaration was part of this test.

This was an actual game action, not an injected-model fixture or a full-match win. The local result screenshot (local artifact: `artifacts/supremacy-map-beta11/workshop-burgos-built.png`) and attempt record (local artifact: `artifacts/supremacy-map-beta11/live-attempts.json`) preserve the evidence. The run was stopped at 333.8 seconds and eight actions because, after achieving the objective, it closed the evidence panels and repeatedly reviewed the changing map instead of completing. This remains a slow, partially successful run, not a clean completion or speed claim.

Beta.12 addresses that completion loop: visual success triggers the evidence check before another input, and exact stable result citations can survive an unrelated changing HUD. Native Chromium regressions reproduce one ordinary-resource construction while the HUD changes on every observation and inference, then check completion without another order. Separate cases remove the cited result, change its level, or navigate during verification; each rejects the old assessment. These regressions inject model responses and prove execution/verification mechanics, not live-model strategy quality.

The subsequent beta.12 live inspection dismissed the offer and opened Burgos with two actions, but the contract checker could not cite the Workshop I icon because it had only DOM text. The timer fix allowed real completion checks; the missing visual evidence still caused repeated reviews. This run was stopped at 240.8 seconds without another order. Beta.13 offers current, scene-bound screenshot observations as labeled model readings. Two additional native fixtures verify completion for a canvas-only result (`verified:false`) and rejection when its observed control scene changes during the check. These visual replies are deterministic fixtures, not live recognition measurements.

Earlier failed and interrupted live attempts remain in `artifacts/supremacy-map-beta6` through `beta10`. They exposed planner routing, free-form point schema, animation freshness, icon labeling and DOM-only panel problems. The repairs are generic controller changes, not scripts containing this game's province names or purchase targets.

## beta.4 — fast numeric moves and corrected keyboard focus

The controller now keeps a reusable visual calibration, reads unfamiliar numbered tiles with bundled local OCR, captures the board rather than the full page, and retries animated frames locally. For a validated 4×4 equal-value merge game, bounded lookahead supplies legal transitions and ranked position estimates. Jev chooses every actual move through one compact operation question. A same-game `continue` reuses calibration and learned appearances.

A normal 2048 move therefore does not need another general-purpose visual reasoning call. Unreadable appearances or incompatible layouts can still require one; initial visual setup also remains slower than the move loop. These are measured limits, not a guarantee of continuous subsecond input or wins in arbitrary games.

### Completed public 2048 run on the packaged game controller

The final public-game run (local artifact: `artifacts/live-game-fast-2048-packaged-v6.json`) passed. The page displayed **You Win**, **20,840 points**, **986 game-counted moves**, and **No powerups used**. Its final screenshot (local artifact: `artifacts/live-game-fast-2048-packaged-v6-turn-2.png`) also shows the 2048 tile. The agent stopped at victory without selecting Keep Going or Start Over.

| Turn | Native key receipts | First key | Median Jev decision | Median interval between keys | 95th percentile interval | Visual reviews |
|---|---:|---:|---:|---:|---:|---:|
| `try to win this game` (deliberately stopped after 80 keys) | 80 | 30.934 s | 331 ms | 628 ms | 736 ms | 1 initial setup |
| `continue` (ran to victory) | 916 | 538 ms | 343 ms | 652 ms | 770 ms | 0 |

The two turns took 11 minutes 47 seconds combined, including initial planning/calibration and the final answer. The game was already open for this acceptance scenario. The 996 dispatched keys differ from the game's 986 move counter: a key receipt is not proof of a legal state change. Jev 1.13.0 selected every move; every recorded finite forecast choice matched a highest-ranked candidate. Both turns measured one canvas focus and one cleanup blur, not a focus transition on each key. The longest follow-up key interval was 2.498 seconds.

This is one successful trial, not a general win-rate or market comparison. Initial setup still takes tens of seconds; the measured sustained loop is subsecond. That run's compiled bundle SHA-256 is `6ed1fbff07eb797b79acb65e6c3bc40c25feb533a08740c3bb3aab2624c0da90`. The release was subsequently rebuilt to include current form values in ordinary website completion checks. The release manifest records both bundle identities and confirms unchanged game-controller source hashes; the final release also receives a shorter public input regression. The full victory is evidence for that unchanged game controller, not a second full victory on the later bundle.

### Other tasks and completion checks

The mixed-game run (local artifact: `artifacts/live-game-mixed-beta4-final.json`), on the same bundle as the full 2048 win, reached both actual fixture victory states:

| Fixture | Result | Total response | Visual reviews |
|---|---|---:|---:|
| Three in a row, seeded winning position | One winning board click | 29.613 s | 1 |
| Cross the road, traffic advances on input | Goal reached after 5 keys | 64.942 s | 2 |

The arcade run needed a further 23.367-second visual review. Its median key interval was 490 ms, but the longest interval was 23.798 seconds. Numeric 2048 performance therefore does not establish uniformly fast decisions in other game families.

An initial ordinary-site run (local artifact: `artifacts/live-conversation-beta4-final.json`) changed Paris to London, kept two guests and preserved the conversation, but the engine still rejected completion. Its first harness checked page outcomes and message status while missing the engine's blocked events. It must not be counted as a clean pass. The completion checker now includes observed field values, selected labels and control states, and the harness rejects blocked/error events. The final ordinary-site run (local artifact: `artifacts/live-conversation-beta4-final-v3.json`) checks the corrected behavior and persistence in the packaged app, recording the running bundle hash.

Background guide lookup is covered with controlled sources and cancellation tests. The successful 2048 run did not need external help; no live-guide benefit is claimed for that result.

### Focus regression

Beta.3 called `focus()` on canvases without `tabindex`. That call did not move focus from a previously selected button or field. The focus check then failed inside the native-input error handler, incorrectly reporting that input had begun even though no key had been dispatched. Earlier public 2048 acceptance covered demonstration mode after closing a tutorial; winning fixtures had focusable canvases. That coverage missed the regression.

Two native tests reproduced the exact zero-action error before the fix, with prior button/field focus and a page change during visual analysis. They pass after the fix. The executor temporarily makes the observed canvas focusable, verifies focus before dispatch, restores its attribute, and refreshes page guards after visual analysis. Preparation failures and uncertain native-input failures have separate handling; a possibly dispatched move is never replayed.

The initial packaged replay (local artifact: `artifacts/live-game-win-focus-packaged.json`) uncovered another failure: LEFT and DOWN did nothing, and Jev stopped despite a readable board and alternatives. Requests now distinguish tactical preferences from actual rules and keep other supported inputs available. Numeric merge requests additionally exclude predicted no-op moves.

### Verification coverage

The native Chromium suite passes **333 tests**; the packaged Mac app passes **29 native workflow checks**. Coverage includes focus theft, preparation recovery, Stop before dispatch, held-key release, attribute cleanup and non-replay after key-down/key-up transport failures. Numeric tests exercise same-color numeral differences, OCR learning, cached follow-ups, moved/resized grids, full/cropped screenshots, legal forecasts and expected merge/spawn transitions. Existing CI runs the browser regressions. Release evidence (local artifact: `artifacts/release-v0.4.0-beta.4.json`) records the final build identity and acceptance boundaries.

Development reports preserve failed and interrupted attempts:

- Initial OCR run (local artifact: `artifacts/live-game-fast-2048-packaged.json`): stopped at 63 inputs with five visual reviews; single-word OCR segmentation penalized otherwise correct digits. The reader now uses single-line segmentation.
- Second run (local artifact: `artifacts/live-game-fast-2048-packaged-v2.json`): 80 initial inputs and 166 follow-up inputs, reaching a 256 tile. Follow-up needed zero visual reviews, with a 1,007 ms median move interval. Deliberately stopped during performance work; this was not a win.
- Third run (local artifact: `artifacts/live-game-fast-2048-packaged-v3.json`): 80 initial inputs, a 708 ms median move interval and one setup review. The harness was closed during the follow-up while repairing its full-load navigation wait. This interrupted run is not a win or a completed acceptance check.

- Fourth run (local artifact: `artifacts/live-game-fast-2048-packaged-v4.json`): its initial 80 inputs had a 742 ms median move interval. The follow-up reached a 512 tile and was closed after at least 283 additional inputs. Initial setup and two later visual reviews occurred; no victory is claimed.
- Fifth run (local artifact: `artifacts/live-game-fast-2048-packaged-v5.json`): 80 initial inputs and 141 follow-up inputs, deliberately stopped to investigate the reported visual jumping. Median intervals were 725 ms and 709 ms, with no follow-up visual reviews. This is not a win.

A native regression reproduced eight focus transitions in eight moves. Holding owned canvas focusability until the run ends reduced this to one while preserving attribute cleanup and stable board geometry. The app now uses native surface copies instead of CDP clipping, and live tests use the actual app pane geometry instead of imposing a competing rectangle.

The public acceptance harness now waits for the visible board rather than a full-page load promise that ads can delay. A later short regression attempt (local artifact: `artifacts/live-game-input-beta4-final.json`) stalled before its first prompt because Electron's test-only `executeJavaScript` also waited for full load while ad frames were still loading. It was interrupted, and harness inspection was changed to direct CDP evaluation; this was not an agent input failure. The subsequent final input regression (local artifact: `artifacts/live-game-input-beta4-final-v2.json`) passed on the rebuilt release: eight keys per turn, median intervals of 627/620 ms, one setup review and none on `continue`, and one canvas focus per turn. It intentionally stopped at its input limit, not at victory.

The harness starts with focus on a non-game button and no canvas `tabindex`, submits the exact prompts `try to win this game` and `continue`, and independently checks the actual page for victory when the full-win option is enabled. It records timings, receipts, forecast estimates, Jev's choices and screenshots. Saved provider credentials stay in a disposable encrypted profile that is removed afterward.

## beta.3 — historical measurements

The final bundle passed 307 unit/Chromium tests and 29 packaged native workflow checks. Jev 1.13.0 selected every move in these live runs; the larger model supplied occasional visual setup. The packaged bundle matches both live evidence reports byte for byte.

| Scenario | Actual observed result | First game input | Median Jev decision | Visual reviews |
|---|---|---:|---:|---:|
| 2048: browse and demonstrate | Score 16 | 11.34 s | 331 ms | 0 |
| 2048: play follow-up | Score 60 | 0.54 s | 324.5 ms | 0 |
| Three in a row (rotated starting position) | You win! Three Xs in a row. | 34.49 s | 594 ms | 1 |
| Cross the road (discrete arcade) | You win! Reached the goal. Moves: 5 | 32.22 s | 334 ms | 1 |

First input includes planning, navigation and visual setup. Decision latency measures one Jev inference, excluding screenshot processing and input. New-game visual setup still takes tens of seconds. The 2048 follow-up reuses its demonstration objective and bypasses conversation planning. Both 2048 turns dispatched eight game keys; the follow-up increased score from 16 to 60. No 2048 win is claimed.

The board fixture is a seeded winning position; the arcade fixture advances traffic only on input. These are bounded acceptance checks, not a general game benchmark or evidence of a win rate across arbitrary games. Earlier failed development runs remain in artifacts.

Evidence: public 2048 (local artifact: `artifacts/live-game-2048-pass.json`), packaged mixed-game wins (local artifact: `artifacts/live-game-packaged-wins.json`), build checksums and verification (local artifact: `artifacts/release-v0.4.0-beta.3.json`). See [controller design and limits](GAMES.md).


_Public snapshot note: local run artifacts referenced above are retained by the maintainer and are not distributed in this repository. Their descriptions are historical reports, not independently downloadable evidence._
