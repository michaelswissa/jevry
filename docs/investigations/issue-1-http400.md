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
