# Issue #1: HTTP 400 investigation

Date: 2026-09-28. Issue: https://github.com/michaelswissa/jevry/issues/1.

The reporter uses beta.13 on Windows 11. Their log shows successful text planning followed by a rejected Jev request. They have not supplied the task, website, model, endpoint, or connection-test result. Their failure has not been reproduced and the issue must remain open pending evidence.

## Live evidence

Tests used an isolated profile copied from the saved encrypted connections. Text inference used the saved Codex connection with `gpt-6-luna`; Jev used `jev-latest`. No user profile was changed and no credential values were logged.

- A minimal inference with the saved Jev model returned HTTP 200.
- The same connection with the deliberately invalid model `jevry-invalid-model-probe` returned HTTP 400 with this actual body:

  ```json
  {"detail":{"error_type":"api_usage_error","message":"Unknown model: jevry-invalid-model-probe"}}
  ```

- A 256-option boundary probe timed out at 35 seconds. It provides no evidence of an HTTP rejection or acceptance.
- The existing three-turn live conversation test was attempted. It stopped after turn one: the form reached Paris / 2 guests, but the executor blocked after repeated page states, so its acceptance assertion failed. No HTTP 400 was observed. This is a separate completion-detection failure, not a passing end-to-end test or proof that issue #1 is resolved.

Two initial API-probe harness attempts failed before network calls because Electron's evaluation context does not support dynamic import or `require`. The working harness passed encrypted bytes to Electron and decrypted them there; only sanitized response status/details left that context.

## Confirmed diagnostic defect

PR #3 read string `detail`, `message`, and `error.message`, but missed TypeSafe's actual nested `detail.message` shape. The follow-up adds that field without exposing the complete response object. Existing size/time bounds, credential redaction and no-retry behavior for HTTP 400 still apply. A regression case uses the observed response shape.

An unknown model is a demonstrated cause of HTTP 400, not an established diagnosis for the reporter. Do not silently replace a user's model or replay browser actions.

## Reporter verification

The beta.13 public release is a source preview, with no Windows installer asset. A source user can update with `git pull --ff-only`, `npm ci`, then `npm run dev` (or `npm run build` and `npm start`). Preserve local work and saved connections. In Connections, check the intended TypeSafe model and endpoint; the defaults are `jev-latest` and `https://api.typesafe.ai/v1/systemone`.

Request the new **Server detail**, whether the connection test succeeds, and the exact task/site (with private information omitted). Never request keys/tokens. Close the issue only after reproducing and verifying its cause or receiving reporter confirmation that the failing task now works.

## Reproduced request-builder failure and verified correction

Further investigation found a real runtime cause of HTTP 400 with a valid saved connection. Chromium observed a local form containing 200 report buttons. Jevry repeated the same 1,200-character form context in every choice. The unmodified request builder generated 292,742 bytes, and the live API returned:

```json
{"detail":{"error_type":"max_tokens_exceeded"}}
```

TypeSafe documents 64k tokens per request and 32k for state plus the longest question: https://docs.typesafe.ai/models. This response contains no `message`; diagnostics must recognize the code too.

The correction stores long, exactly repeated nearby text once in `state.sharedActionContexts`. Each option retains its original key and metadata and refers directly to that text. The question instructions explain the reference. Nothing is truncated and no candidate is omitted. Game requests retain their existing representation. Short or unique text stays inline, and fan-out requests beyond the joint-action limit use the same sharing.

The initial compact request (61,621 bytes) returned HTTP 200. The repeatable `scripts/test-live-http400.mjs --run-live` then exercised a served Chromium fixture, production request builder, compiler and decoder, the real API, and a trusted CDP mouse click:

| Phase | Request bytes | HTTP | Observed result |
| --- | ---: | ---: | --- |
| Expanded original representation | 292,761 | 400 | `max_tokens_exceeded` |
| Shared-context representation | 61,640 | 200 | Jev 1.13.0 chose `CLICK:180`, the observed button labeled `Open report 179` |
| Native input | — | — | Exactly one trusted click receipt for report 179; page output `Report 179 opened` |

The first harness launch failed before network calls because its temporary bundle could not resolve `pngjs`. Linking its disposable dependency directory fixed the harness. All attempts are retained locally under `artifacts/issue-1/`. The successful live regression started at 2026-09-28T14:09:20.840Z. It makes two explicit read-only API calls and dispatches only the actual decoded action to a local synthetic fixture. This is regression evidence, not a benchmark or proof of the reporter's particular configuration.

The fix removes the demonstrated duplication failure. Irreducibly large unique page content can still exceed a remote model's limit; that must report the actual input-limit reason rather than blaming credentials. The reporter's exact task and server response are still needed to establish that this reproduced cause is their cause.
