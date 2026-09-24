# Security and privacy

Jevry is a developer preview. It is not a hardened environment for arbitrary untrusted websites or high-impact autonomous transactions.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/michaelswissa/jevry/security/advisories/new). Do not publish exploitable details, credentials, or personal data in a public issue. If private reporting is unavailable, open a minimal issue requesting a private contact without including the vulnerability itself.

## Data flow

- Jevry stores connection settings, conversations, and tab archives locally using Electron safeStorage and the operating system's encryption facilities. Browser cookies persist in Jevry's own Chromium profile.
- Connected inference providers receive prompts and relevant page context. Supported visual tasks may send screenshots or cropped images to a vision-capable provider. Provider terms, retention, and pricing apply.
- Local OCR reads supported numeric tiles locally. This does not make the entire agent local or offline.
- Jevry does not import Chrome sessions. Disconnecting a model or deleting a conversation does not erase website cookies.
- Native tabs disable Node integration and use sandboxing and context isolation. Stop/redirect controls and guarded action checks reduce mistakes; they do not establish immunity to prompt injection or malicious pages.

Keep credentials in the app's connection UI. Never commit `.env` files, private keys, profiles, session cookies, logs, or `connections.enc`. Review screenshots and run exports before sharing them.

See the [historical production review](docs/PRODUCTION_READINESS.md) for outstanding distribution and security work. Signing, notarization, and automated updates remain release gates.
