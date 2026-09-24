# Upstream integration audit

Audited on 2026-09-22 against the local clones in `upstream/`. The commit IDs below identify the source that was inspected; upstream marketing and benchmark claims are not Jevry benchmark results.

| Source | Pinned commit | Declared license | Useful material |
| --- | --- | --- | --- |
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` | MIT, Copyright (c) 2026 Browser Use | Atomic DOM observations, indexed controls, one-request operation/target selection, target freshness guards, bounded settling, small text helper |
| [firecrawl/web-agent](https://github.com/firecrawl/web-agent) | `f023adf1cd1f731e27fdc844af62996f6c2a41c4` | MIT, Copyright (c) 2026 Firecrawl | Streaming event vocabulary, bounded orchestrator/worker tasks, structured results, on-demand skills |
| [citrolabs/ego-lite](https://github.com/citrolabs/ego-lite) | `dca7003349c5f7132189ba00547cbbd7ff8e597e` | MIT, Copyright (c) 2026 CitroLabs | Open-source CDP harness, task ownership and handoff, document-scoped observed references, site learning structures |
| [Jakubantalik/Libraries.dev](https://github.com/Jakubantalik/Libraries.dev) | `6464670cd96a9faaaf47b8e85590c51c29dbdf13` | MIT, Copyright (c) 2026 Jakub Antalik, with a separate Paper Shaders notice in metal-fx | Six public React effect packages |
| [aydinnyunus/ai-captcha-bypass](https://github.com/aydinnyunus/ai-captcha-bypass) | `29228c0d08ab3f7425fb7edad085a8ff74b2fd39` | Custom license prohibits commercial use | Inspected only; no code or prompts incorporated. Jevry's verification module is independently written. |

The upstream repositories remain separate clones. Their original LICENSE files have not been changed. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) retains the notices for this integration.

## Scope of reuse

Jevry ports Jev Ultrafast's snapshot and decision-loop logic into its desktop runtime. Firecrawl's bounded streaming orchestration and ego-lite's observed references and tab ownership inform the app architecture; their full runtimes are separate integrations, not requirements of the direct Jev action loop.

### Jev Ultrafast

The relevant implementation is `jev_ultrafast/snapshot.js`, `model.py`, `browser.py`, `agent.py`, and `questions.py`. Its main performance property is a small decision loop:

1. Read the visible page and compatible actions atomically, retaining references to the observed DOM nodes.
2. Call TypeSafe once with an `operation` head and speculative operation-specific target heads.
3. Validate and consume only the target head belonging to the chosen operation.
4. For `TYPE_TEXT`, ask a separate text model for a strict `{ "text": "..." }` result.
5. Recheck target freshness and occlusion, execute once, and observe the result.

The audited default decision model is `jev-latest`, posted to `https://api.typesafe.ai/v1/systemone`. A decision response contains `answers`, whose selected choice must belong to the offered criteria; probabilities must cover that choice set, be finite numbers in `[0,1]`, sum to approximately one, and select a maximum-probability answer. Do not treat a malformed or unavailable model response as permission to guess a browser action.

Keep the expensive text helper out of click, select, and scroll decisions. Cache a generated field value across a stale observation only while its entire helper input is identical. Browser mutations must not be retried automatically: a transport error can occur after the page has already accepted an action. Emit the execution event before waiting for the new page state.

The upstream performance report covers a few repeated tasks on one profile, not a general benchmark. Its README reports a 7,073 ms Flights run and a median improvement from 9.450 s to 7.092 s across three repeats per variant. These timings start after initial observation. They neither establish zero latency nor predict this application's end-to-end timing.

The upstream MVP explicitly excludes general shadow roots, frames, canvas controls, uploads, popup tabs, nested scrolling, and arbitrary keyboard widgets. A direct port does not acquire support for these automatically. A model's `DONE` choice is a completion claim; independent outcome verification is still needed.

### Firecrawl Web Agent

`agent-core/src/agent.ts` exposes `createAgent`, and `stream-helpers.ts` normalizes events into text, tool-call, tool-result, done, and error. The framework uses LangChain Deep Agents, Firecrawl tools, skills, parallel workers, and context compaction. The SDK entry point requires a Firecrawl API key plus its chosen model provider credentials.

Its streaming lifecycle and worker limits are reusable without putting the complete research stack in every browser action. Importing the full framework adds LangChain, Deep Agents, AI SDK, Firecrawl SDK tooling, Zod, and a virtual bash environment. Keep that optional and separate from the direct Jev navigation loop. The repo does not include the proprietary Spark model service advertised by Firecrawl.

Useful future extension points include source-linked research results, worker-specific browser tabs, schema validation, and skills discovered only when needed. Concurrency should be bounded and apply to independent work; dependent actions in the same page remain sequential.

### ego-lite

The repository contains the `ego-browser` Node/CDP harness and the agent skill package. **It does not contain the ego lite browser engine.** Its own `AGENTS.md` states that the closed-source app injects `globalThis.ego`. `browser-runtime.ts` relies on bindings including `sendCDPMessage`; task handoff depends on native runtime methods. Installing this package alone does not reproduce the browser or its customized frame snapshots.

Reusable patterns are explicit agent/user ownership, dedicated task tabs, handoff, bounded event buffers, CDP session reuse, and references tied to frame/document/backend-node identity. `page-ref-registry.ts` invalidates references when documents change instead of silently resolving a stale ID against a different node. These concepts can be implemented against Electron's browser contents without depending on the proprietary app.

## Libraries.dev public package API

The repository README lists six public libraries. These are effect components, not a license to reuse every photo, brand mark, commercial Studio export, or Pro recipe on its website. Use the shipped public presets and retain their package licenses. The README explicitly describes Pro content as separately licensed to the purchasing person or team.

Versions below are from the audited source tree; installed versions are recorded by the application lockfile.

| npm package | Audited version | Import | Suggested role |
| --- | --- | --- | --- |
| `border-beam` | `1.4.0` | `BorderBeam` | Active composer edge or connection activity |
| `thinking-orbs` | `0.3.2` | `ThinkingOrb` | Compact, truthful agent state |
| `liquid-gooey` | `0.2.2` | `Liquid` | Small moving navigation indicator or expanding control |
| `voice-glow` | `0.2.0` | `VoiceBeam`, `useMicrophone` | Voice input meter or explicit processing state |
| `metal-fx` | `2.0.10` | `MetalFx` | One restrained primary action or brand detail |
| `img-fx` | `0.5.1` | `ImageGeneration` | Optional preview reveal, loaded on demand |

All require React 18 or later. `img-fx` also requires the `three` peer dependency. The examples below use the exports and props found in each package's README and source types. State variables are supplied by the host application.

```tsx
import { BorderBeam } from 'border-beam';

<BorderBeam
  size="line"
  colorVariant="mono"
  theme="dark"
  active={busy && !reducedMotion}
  strength={0.45}
>
  <div className="composer">{children}</div>
</BorderBeam>
```

```tsx
import { ThinkingOrb } from 'thinking-orbs';

<ThinkingOrb
  state={connecting ? 'connecting' : 'working'}
  size={20}
  theme="dark"
  paused={!busy}
  aria-label={connecting ? 'Connecting' : 'Agent working'}
/>
```

```tsx
import { Liquid } from 'liquid-gooey';

<Liquid blur={5} contrast={18} fill="#34352f">
  <Liquid.Item x={expanded ? 44 : 0} transition="smooth">
    <button type="button" onClick={toggleExpanded}>Tools</button>
  </Liquid.Item>
</Liquid>
```

```tsx
import { VoiceBeam, useMicrophone } from 'voice-glow';

const mic = useMicrophone();
// mic.start must run from a user's explicit gesture.
<VoiceBeam
  stream={mic.stream}
  active={mic.state === 'live'}
  idle={0}
  distortion={0}
  theme="dark"
>
  <button onClick={mic.state === 'live' ? mic.stop : mic.start}>
    {mic.state === 'live' ? 'Stop microphone' : 'Start microphone'}
  </button>
</VoiceBeam>
```

`VoiceBeam` also accepts `level={numberOrGetter}` for an existing audio meter and `processing={boolean}` for actual processing. It does not provide speech transcription; do not imply that microphone visualization alone implements dictation.

```tsx
import { MetalFx } from 'metal-fx';

<MetalFx
  variant="circle"
  preset="silver"
  theme="dark"
  paused={!busy || reducedMotion}
  strength={0.6}
>
  <button type="submit" aria-label="Run task">↑</button>
</MetalFx>
```

```tsx
import { useRef } from 'react';
import { ImageGeneration, setFrameRate, type ImageGenerationHandle } from 'img-fx';

setFrameRate(10); // Set once in this lazily loaded feature.
const imageEffect = useRef<ImageGenerationHandle>(null);
<ImageGeneration
  ref={imageEffect}
  preset="sweep-gradient"
  images={[previewUrl]}
  paused={reducedMotion}
  theme="dark"
>
  <div style={{ width: 240, height: 150, borderRadius: 12 }} />
</ImageGeneration>
// Reveal only when the actual preview is available; keep it visible.
// imageEffect.current?.triggerReveal({ hold: 'manual' });
```

### Rendering budget

Effects must never delay navigation, model requests, page input, or event delivery. Scope them to the desktop chrome, not remote page documents. Use a static UI under reduced motion and mount expensive effects only where they are visible and useful.

- `ThinkingOrb` uses a 2D canvas, caps device pixel ratio, and handles hidden/offscreen/reduced-motion states internally.
- `BorderBeam` pulse variants have a shared capped loop and reduced-motion handling. Its rotating variants require the consumer to disable motion for `prefers-reduced-motion`.
- `Liquid` separates filtered silhouettes from crisp interactive content and sleeps when idle. Avoid large dissolve regions and repeated layout animation.
- `VoiceBeam` uses one shared audio context and pauses inactive/offscreen instances. Feed actual microphone data or truthful processing state, keep distortion off on large hosts, and never request the microphone on mount.
- `MetalFx` shares a WebGL2 context and pauses offscreen copies. Unsupported browsers retain the plain child. Use `paused` or unmount when idle; reducing `strength` alone reduces opacity, not shader work.
- `ImageGeneration` shares a Three.js WebGL renderer and defaults to 10 fps. Lazy-load this package and `three`, keep previews small, pause or unmount when idle, and avoid autoplay reveal loops in the main browsing view. Supply useful accessible image text outside the decorative canvas.

The `metal-fx` package embeds unmodified `liquidMetal` and sizing vertex shaders from Paper Design's `@paper-design/shaders` under Apache-2.0. Its NOTICE and the corresponding license are included in the application notices.

## Measurement requirements

Report actual timings from monotonic clocks: initial navigation, observation, Jev request, text generation where needed, validation/execution, and end-to-end task time. Include failure rate, cold versus warm runs, task set, model identifiers, hardware, network, and whether page loading is included. Do not display upstream benchmark numbers as live measurements or claim superiority before running comparable successful tasks. A fast local UI can respond immediately while the real network/model work remains asynchronous.
