# Text connections

The Electron main process owns `desktop/providers.ts`. It never sends API keys to the browser page, launches shell commands from a model response, or reads CLI credential files. The application supplies API credentials from its own settings store. The user's Connect action can install a missing CLI into Jevry's private tools directory before starting authentication.

## Connection behavior

| Connection | Connect button | Validation | Model when blank |
| --- | --- | --- | --- |
| Codex CLI | Installs privately if missing, then runs `codex login`; reuses saved authentication | `codex login status` | CLI default |
| Claude Code | Installs privately if missing, then runs `claude auth login`; reuses saved authentication | `claude auth status --json` | CLI default |
| OpenAI / compatible | Uses the entered key and base URL | Tiny streamed inference with the selected model | `gpt-4.1-mini` |
| Anthropic | Uses the entered key and base URL | Tiny streamed inference with the selected model | `claude-sonnet-4-6` |

Authentication is completed in the provider's browser flow. Login has a ten-minute deadline; repeated clicks share the same pending login. The application receives sanitized progress text. CLI status checks have a ten-second deadline and do not expose account identifiers. A successful CLI status check confirms saved authentication, not available quota or model entitlement. API validation consumes a small amount of API usage because it checks actual inference access.

Native CLI executables are discovered from PATH, common user installation directories, macOS Codex/ChatGPT application bundles, and conventional Windows per-user or Program Files app resource directories. An existing app-bundled CLI qualifies without a separate CLI install. An absent CLI produces an install-or-use-API-key message. CLI versions must support the isolation flags below; unsupported flags produce an update message. The local development versions inspected were Codex `0.154.0-alpha.6.2` and Claude Code `2.1.259`.

Windows npm installations are supported without executing `.cmd` wrappers or enabling a shell. Discovery checks PATH entries, the configured npm prefix, and `%APPDATA%\\npm`; it prefers Codex's x64 or ARM64 vendored native executable, including nested optional-dependency layouts. If only `@openai/codex/bin/codex.js` is found, it is launched as a separate argument through the running executable with `ELECTRON_RUN_AS_NODE=1`. This uses Electron's embedded Node runtime, so a second Node install is unnecessary. Paths containing spaces or shell metacharacters remain literal arguments. Claude's native `%USERPROFILE%\\.local\\bin\\claude.exe` is supported. Discovery does not install or update packages, and does not enumerate protected Microsoft Store package directories.

## Private installation and shutdown

Set `process.env.JEVRY_TOOLS_DIR` to an absolute app-owned directory (normally `app.getPath('userData')/tools`) before calling provider functions. `installProvider(provider, onProgress)` supports only the fixed official package names `@openai/codex` and `@anthropic-ai/claude-code`. It invokes npm's JavaScript entrypoint using Electron's embedded Node runtime, never `npm.cmd`, a shell, or a downloaded install script. npm installs into the private prefix with the official registry, exact saved dependency versions, optional native platform dependencies, lifecycle scripts disabled, and a ten-minute deadline. Installs are serialized so adding one provider preserves the other. The installed binary must pass `--version` before installation succeeds. No global packages or PATH settings are changed.

Private discovery prefers native optional packages on macOS, Windows, and Linux, then documented JavaScript launchers and Unix `.bin` entries. Claude's current npm postinstall copies its optional native package into a wrapper location; resolving that package directly avoids running the postinstall. npm must already be present, normally through a Node.js installation. When it cannot be found, the error directs the user to [Node.js LTS](https://nodejs.org/en/download) or the API-key connection. Jevry does not silently install a system Node runtime.

Call `stopProviderProcesses()` from Electron's `before-quit` handler. It rejects pending subprocess requests, prevents new subprocesses from starting, and terminates spawned process groups on Unix or the specific spawned process tree with Windows `taskkill.exe`. This covers active login, installation, and CLI inference work.

## Planning and boundaries

`generatePlan(config, prompt, signal, onText?)` returns model text. The browser engine is responsible for validating its action schema before acting. `generateFieldText` adds an exact `{ "text": string }` contract, rejects extra fields, bounds output size, and marks page observations as untrusted. `getProviderDiagnostics()` exposes only the last successful request's provider, transport mode and reported model name when available; it excludes session IDs, account data and credentials.

CLI prompts go through stdin rather than process arguments. Calls without an explicit conversation scope get a disposable working directory and ephemeral session settings. Codex uses `--sandbox read-only`, `--ignore-user-config`, disabled shell/execution, browser, app, plugin, hook and MCP features, and no web search. Claude uses `--tools ''`, deny-all tools, `--safe-mode`, an empty strict MCP configuration, no Chrome, and no session persistence. Reported tool-action events stop the request. CLI policy implementations and administrator policies remain owned by the installed provider; these flags are not a separate OS security boundary around the entire CLI. In particular, read-only mode alone is not equivalent to disabling every tool.

## Scoped Claude workers

The host can supply `TextConfig.sessionScope` as an ephemeral conversation identifier. This field is never saved with model account settings. Scoped Claude requests reuse one serial `--input-format stream-json` process for that conversation and selected model. Unscoped calls, Codex calls and API calls keep their existing transport. Changing the scope, executable or model drains and destroys the previous worker before starting another. The worker is also retired after eight requests, after processing 200,000 prompt characters, or after two idle minutes.

Each input receives a new UUID. The worker requires matching user acknowledgments and validates the final `user_message_uuid`, singleton `user_message_uuids`, and process session ID before reuse. Unexpected sessions, stale result IDs, tool events, malformed data, inconsistent streamed/final text and non-object JSON stop the worker. It checks that initialized tools, MCP servers, skills and slash commands are empty. Claude 2.1.259 reports installed plugin inventory even under `--safe-mode`; that inventory is metadata, and is not used as evidence that a plugin tool is enabled. All tool-disable and safe-mode flags remain active.

Cancellation kills the worker and waits for the process to close and its temporary directory to be cleaned before rejecting the request. Unix process groups and Windows process trees use the same termination path as one-shot CLI calls. A failed request is not automatically replayed. An unknown streaming-input startup flag permits a one-shot fallback only before initialization, acknowledgment or any text output. Older CLIs that return an uncorrelated result can complete their sole first request once; that process is then discarded and later calls use one-shot mode. Ambiguous responses never trigger a second inference.

`clearProviderSession(scope?)` drains and destroys the matching scoped worker; omit the argument to clear any worker. Call it after deleting a conversation and when disconnecting or changing account connections. A cleared scope also invalidates queued work so a deleted conversation cannot recreate its worker. App shutdown continues to use `stopProviderProcesses()`.

Streaming input retains provider-side conversation history in memory. The application still passes its explicit bounded transcript, so this adds prior internal planning/field requests within the same conversation. That history never crosses conversation scopes, is never resumed from disk, and is discarded at the limits above. Warm calls avoid process initialization and may reuse provider prompt caching; they still require model inference and network time. These tradeoffs are why reuse requires an explicit scope rather than a global shared session.

API requests contain no tool definitions. Both adapters stream incremental text, handle interrupted/truncated streams, and abort on cancellation or after 120 seconds. HTTP is accepted only for localhost; remote API URLs require HTTPS and cannot contain embedded credentials, query parameters, or fragments. Redirects are rejected to avoid forwarding credentials to a different endpoint. Error bodies are not shown to the renderer. Custom OpenAI-compatible endpoints must implement `/chat/completions`, streaming (or ordinary completion JSON), and `max_completion_tokens`. API model names are editable; availability and quota depend on the connected account.

CLI text planning uses low reasoning effort. Claude receives a compact browser-specific system prompt instead of the full coding system prompt; configured model selection is preserved. Conversation history is passed explicitly from the encrypted transcript.

Streaming makes progress visible as it arrives. It does not eliminate model inference, network, authentication, or CLI startup time. Codex JSON mode generally emits completed agent messages rather than individual text tokens. Text generation is separate from Jev's browser action selection, so the engine can avoid a text-model round trip when no text reasoning is needed.

## Verification

`desktop/providers.test.ts` uses mocked child processes and HTTP responses to check credential handling, isolation flags, stdin prompts, tool-action rejection, cancellation, SSE chunk boundaries, truncated streams, explicit model selection, and the field-text contract. Windows-injected tests cover x64 and ARM64 native packages, the npm launcher, custom prefixes with spaces and metacharacters, app-bundled Codex, and native Claude. Installer tests cover fixed arguments, script suppression, private paths, native Claude discovery, missing npm, duplicate/concurrent installs, and error sanitization; a shutdown test checks active-process cleanup. These checks run with mocked paths and processes, and do not install packages, spend model tokens, or authenticate an account. Execution on real Windows and end-to-end provider access still need platform validation and a successful user connection.

`desktop/cli-worker.test.ts` exercises request correlation, stale replies, tool-event rejection, process-draining cancellation, malformed output, idle expiry and bounded reuse. Provider integration tests cover conversation/model separation, fresh restart after cancellation, explicit disposal and queued-work invalidation. Local authenticated Claude 2.1.259 smoke probes used harmless JSON prompts and no tools. Two successive cold/warm pairs measured 4,451/2,901 ms and 4,579/4,808 ms; the latter reported the unchanged CLI default model as `claude-fable-5-1`, and explicit session disposal drained in 882 ms. These small samples show variable inference latency, not a controlled browser benchmark or a guaranteed speedup. Complete-task comparisons must give each competitor the same model and equivalent scoped/one-shot treatment, and disclose automatic worker retirement limits.

## Image requests

`generateVisionPlan` accepts one validated PNG/JPEG image, up to 5 MiB, with a 30-second deadline. OpenAI and Anthropic receive native multimodal message blocks. Claude uses a new single-use stream-JSON session with tools disabled; Codex verifies its installed `--image` capability and uses a private temporary attachment removed after process exit. Images do not enter the normal scoped conversation worker. Unsupported vision fails explicitly; the chosen provider/model is not silently replaced and no text-only fallback is sent.

The provider/worker suites cover image payloads, format/size validation, cancellation drainage, errors and temporary-file removal. One actual authenticated Claude image request on an owned synthetic target passed in 6,588 ms, resolving `claude-fable-5-1` without a model override. `artifacts/live-vision-beta.json` records its bounded evidence and cleanup. This verifies one real CLI image path, not a CAPTCHA solve rate or a general speed claim. See [verification assistance](VERIFICATION.md).

## Official references

- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) and [non-interactive mode](https://developers.openai.com/codex/noninteractive).
- [Codex configuration reference](https://developers.openai.com/codex/config-reference).
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference).
- [Claude streaming input and its retained session context](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode).
- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create).
- [Anthropic vision input](https://platform.claude.com/docs/en/build-with-claude/vision) and [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision).
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) and [Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview).
