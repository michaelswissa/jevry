# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron desktop shell for macOS and Windows, Chromium WebContentsView browser tabs, React + TypeScript renderer. Selected to support local CLI authentication and real browsing with shared persistent sessions.

## Users

People delegating web tasks to AI while retaining direct control of their browser.

## Product Purpose

Jevry connects a text model and Jev in two steps, then opens a fast agentic browser. Speed and simple setup are the primary goals.

## Operating Context

A desktop workspace with ordinary browsing, local Codex or Claude Code authentication, or API key configuration. Both macOS and Windows are explicit targets.

## Capabilities and Constraints

Jev uses TypeSafe structured choice inference and indexed DOM observations. A separate text model interprets the persistent conversation and writes answers; known field values and explicit page results avoid redundant model calls. Network and inference latency remain real. No competitive speed claims before benchmarks. Native browsing requires the desktop runtime. Text and Jev connections must validate before agent access.

## Brand Commitments

Use libraries.dev public effects throughout the product: beam, orb, gooey, metal, image and voice. Jevry is inferred from the workspace name.

## Evidence on Hand

Cloned jev-ultrafast, firecrawl/web-agent and citrolabs/ego-lite, plus libraries.dev. Saved Claude and Jev connections have passed bounded live multi-turn tests. Selected actual-source control fixtures compare Jevry with upstream Jev. Firecrawl's real source graph has also been exercised with its public toolkit injection and a real Claude protocol bridge; this does not measure its proprietary cloud browser. Ego Lite's native browser source is not published; its signed public app has been acquired for isolated runtime evaluation.

## Product Principles

- Keep the browser warm and the action path short.
- Show real state and measured timing.
- Preserve user control and interruptibility.
- Keep keys in the native process and encrypted at rest.
