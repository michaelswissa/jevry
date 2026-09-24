# Conversations

Follow-ups receive recent messages, the previous browser goal, compact memory, current page evidence, and bounded execution receipts. Saved research findings retain observed source addresses, so “open the cheaper source” can refer to previous evidence. Conversations have separate history and context.

## Controls and continuity

- **Enter** sends; **Shift + Enter** adds a line. **Command/Ctrl + J** focuses the composer while the application interface has keyboard focus.
- **Auto** chooses conversation, action, or research. **Act** uses the browser. **Research** offers automatic sources, web-only discovery, or only the selected open pages. Selected scope is authoritative; see [Research](RESEARCH.md).
- The history menu restores a conversation; plus creates one. Switching stops the active task. Mode/source selections stay with each conversation and default to its last saved request after reopening.
- **Conversation actions** provides **Rename** (1–120 characters) and **Delete** with confirmation. Deletion removes saved messages, stops that conversation's work, and clears its provider session. Other conversations and browser tabs remain. Failed rename/delete saves roll back.
- Accepted sends clear the composer; rejected sends preserve the draft and show the error. Drafts survive switching/hiding the panel within the renderer session, but not application restart.
- **Stop** preserves partial text with stopped status and recorded action receipts. **Try again** resends the original request, mode, and source selection; closed selected pages require updated scope.
- Answers support selectable text, basic Markdown, copying, and citations. Research copies include findings and URLs. Expandable activity belongs to its answer. Validated citation IDs point to observed addresses; they do not establish factual correctness.

**Redirect** records a follow-up during execution and cancels the current turn. New work waits for cancellation to drain, preventing overlapping browser mutations. Several rapid follow-ups remain in history while the latest pending request takes over. Completed page actions are not undone.

Provider text appears as received, without artificial typing delay. Unfinished Markdown is stabilized and incomplete destinations stay unclickable. Research findings appear after structured-result validation, with acquisition/read progress in activity. Scrolling upward preserves position; **Latest message** returns to the answer. The composer stays outside the scroll region. Keyboard scrolling, error announcements, and completion status support assistive technology.

## Persistence and model context

The desktop process stores transcripts, metadata, compact memory, activity, and research results in `conversations.enc`, encrypted with Electron `safeStorage` and saved by atomic replacement. Connections use `connections.enc`; tab IDs/addresses use `workspace.enc`. Restored websites reload rather than restoring transient form state. An unreadable archive is preserved and blocks writes.

History is saved on accepted messages, completed turns, and conversation create/select/rename/delete operations. Interrupted turns reopen as stopped and are not replayed automatically. A force quit can lose unsaved streaming text. Late results cannot resurrect a deleted conversation.

Saved history remains visible, but model context is bounded. Serialized recent messages and attached evidence share a 26,000-character budget, including JSON escaping; the current message allows 12,000 characters and older messages 8,000 each. Research evidence includes up to eight source records and six findings of 800 characters when it fits. Execution receipts include up to six performed actions, the originating tab and observed/action URLs, omitted counts, terminal outcome, error and verification status. Each receipt is bounded to 4,000 characters. Performed input is not proof of accepted business results. The original request, previous goal, and compact memory are supplied separately. Older details can remain in the panel after leaving a later model request.

Action and terminal receipts arriving after Stop but before the current executor finishes draining are retained. Late text, unrelated events and callbacks after settlement or deletion are rejected. An input interrupted before its engine receipt was emitted remains uncertain; the transcript is not an exhaustive transaction ledger. Research verification work is owned by the turn and drains before a redirected turn may start, even when a read-only research wrapper has already reacted to cancellation.

## Authentication and privacy

Text providers receive conversation context and relevant page evidence. Jev receives observations for action selection; research uses the text provider and native browser. Local encryption does not make inference local.

API keys remain in the desktop process/encrypted settings and are excluded from public renderer state. CLI connections use provider-owned authentication. Scoped Claude requests can reuse a serial worker within one conversation, retaining previous internal requests in memory alongside Jevry's explicit transcript. Workers are isolated by conversation/model, retired at bounded limits, and discarded on cancellation or disposal. Codex and unscoped CLI requests remain ephemeral. Unrelated CLI history is not imported or resumed. Details: [Text connections](PROVIDERS.md).

## Verification and limits

The conversation/planner suite has **50 passing tests**, covering restart continuity, serialized redirects, cancellation-drain receipts, late callbacks, lifecycle rollback, source scope, evidence follow-ups, and context bounds. Five owned-work tests include the actual conversation/research cancellation integration. Renderer checks cover submission/recovery, keyboard input, scrolling, rename/delete, scopes, stopped receipts, and streamed Markdown. The native Electron workflows separately validate UI/preload/main wiring; exact candidate totals belong in its release manifest. [Research](RESEARCH.md) identifies the live-provider samples and their limits.

Messages allow 12,000 characters; the archive loader accepts up to 50 MB. Conversation search and archiving are not implemented. Markdown is a safe subset of CommonMark. Provider streaming, inference, navigation, and CLI startup remain variable; these checks establish tested behavior, not a general speed advantage.
