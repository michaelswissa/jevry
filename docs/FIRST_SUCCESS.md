# Your first task in Jevry

Start with one small, public, read-only task. This is a setup check you can judge yourself, not a benchmark or a guaranteed success.

## 1. Start the desktop app

Install Git and Node.js **22.12 or newer** with npm. In Terminal or PowerShell:

```sh
git clone https://github.com/michaelswissa/jevry.git
cd jevry
npm ci
npm run dev
```

Keep the terminal open. `npm run dev` launches Electron; `npm run dev:web` is only an interface preview and cannot control browser pages. The public release is a source preview; signed installers, notarization, and automatic updates are not available. The default branch includes fixes after the beta.13 tag.

## 2. Connect both models

In the app’s connection setup:

- **Jev:** enter a TypeSafe API key, model `jev-latest`, and endpoint `https://api.typesafe.ai/v1/systemone`. Use the [TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart) to obtain access.
- **Text model:** connect an authenticated Codex or Claude Code CLI, or configure an OpenAI-compatible / Anthropic API connection with a model your account can use. A CLI login does not guarantee quota or model entitlement. The Connect flow can install a missing supported CLI privately; npm is required.
- **Vision:** only needed for visual tasks; select an image-capable provider/model before trying games. The first task below does not require vision.

Enter credentials only in the app. Do not put them in source files or issue reports. See [provider behavior](PROVIDERS.md) and [security/data flow](../SECURITY.md).

**Costs:** the open-source app does not supply model credits. Jev uses your TypeSafe account; text/vision uses the chosen provider’s API billing or CLI plan/quota. API connection checks perform inference and may consume usage. Task cost varies with model, context, actions, and retries. Check usage in both accounts; begin with one short task before a long research or game run.

## 3. Check one answer against the page

1. Navigate to `https://example.com` in Jevry’s address bar and wait for the page to load.
2. Ask: **“What heading is visible on this page? Answer from the page only.”**
3. Compare the answer with the heading you can see. Success means the answer matches the actual page and Jevry finishes without unrelated actions. This checks conversation and page grounding; it does not establish browser-action quality.
4. To try navigation, open a public documentation site you know and ask: **“Find this site's installation instructions. Stop when they are visible and give me the page URL.”** Verify the destination yourself. Website structure and access restrictions can affect the outcome.

Watch the action feed. To cancel, press **Stop**, or Escape while the browser page has focus. A follow-up can redirect the task. If the page is blocked, the answer is unsupported, or the task loops, stop and report what happened rather than counting it as success.

## If setup fails

| Symptom | Check |
| --- | --- |
| Dependency/build error | `node --version` must be 22.12+; use the checked-in lockfile with `npm ci`. |
| UI opens but cannot browse | Start Electron with `npm run dev`, not the web-only preview. |
| Jev rejects a request | Check the intended TypeSafe model and System One endpoint. On current main, inspect the bounded server detail; an input-limit error is not necessarily a bad key. |
| Text connection fails | Check authentication, selected model access, and available quota with that provider. |
| Task stalls or gives an unsupported answer | Stop, save the public task/site and source commit, and describe the observed failure. |

For a bug report, include OS, `git rev-parse --short HEAD`, reproduction steps, expected/actual behavior, and a **manually redacted** error. Server details may contain page/request content: remove private values as well as credentials. Never upload connection archives, browser profiles, or private conversations. [Report a bug](https://github.com/michaelswissa/jevry/issues/new?template=bug_report.yml).
