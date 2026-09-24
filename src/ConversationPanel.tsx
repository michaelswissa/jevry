import { BotAvatar } from "bot-avatars";
import { ThinkingOrb } from "thinking-orbs";
import { BorderBeam } from "border-beam";
import {
  Fragment,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  History,
  Link as LinkIcon,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { AppState, AgentEvent, ResearchResult } from "./types";
import type {
  ChatMessage,
  ConversationMode,
  ConversationSnapshot,
} from "./conversation-types";
import "./conversation.css";

type Source = ResearchResult["sources"][number];
// Keep unsent drafts when the panel is hidden, without writing plaintext to disk.
const sessionDrafts = new Map<string, string>();
const sessionScopes = new Map<string, string[] | undefined>();
const sessionModes = new Map<string, ConversationMode>();
const providerNames = {
  codex: "Codex",
  claude: "Claude Code",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

function webUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function OpenLink({
  url,
  children,
  className,
  onError,
}: {
  url: string;
  children: ReactNode;
  className?: string;
  onError: (message: string) => void;
}) {
  const safe = webUrl(url);
  if (!safe) return <span>{children}</span>;
  return (
    <a
      href={safe}
      title={safe}
      className={className}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!window.jevry) return;
        event.preventDefault();
        void window.jevry.newTab(safe).catch((error) => onError(String(error)));
      }}
    >
      {children}
    </a>
  );
}

// Render model text as React elements. No model-provided HTML is executed.
function inlineText(
  text: string,
  sources: Source[],
  onError: (message: string) => void,
): ReactNode[] {
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\[(?:\d+|[sS]\d+)\]|https?:\/\/[^\s<>]+)/g;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > offset) parts.push(text.slice(offset, index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={index}>{token.slice(1, -1)}</code>);
    } else {
      const markdownLink = token.match(/^\[([^\]]+)\]\((.+)\)$/);
      const source = sources.find((item, i) =>
        item.id === token.slice(1, -1) || String(i + 1) === token.slice(1, -1),
      );
      if (markdownLink) {
        parts.push(
          <OpenLink key={index} url={markdownLink[2]} onError={onError}>
            {markdownLink[1]}
          </OpenLink>,
        );
      } else if (source && token.startsWith("[")) {
        parts.push(
          <OpenLink key={index} url={source.url} onError={onError} className="chat-inline-citation">
            {token.slice(1, -1)}
          </OpenLink>,
        );
      } else if (token.startsWith("http")) {
        const url = token.replace(/[.,;:!?]+$/, "");
        parts.push(
          <Fragment key={index}>
            <OpenLink url={url} onError={onError}>{url}</OpenLink>
            {token.slice(url.length)}
          </Fragment>,
        );
      } else parts.push(token);
    }
    offset = index + token.length;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

function stableStreamingInline(text: string) {
  // Only finish presentation delimiters; never delay, fabricate, or animate model text.
  let value = text.replace(/\[([^\]\n]*)\]\([^)]*$/, "$1");
  if (value === "**" || value === "`") return "";
  if ((value.match(/\*\*/g)?.length || 0) % 2) value += "**";
  if ((value.match(/`/g)?.length || 0) % 2) value += "`";
  return value;
}

const Answer = memo(function Answer({
  text,
  sources = [],
  streaming = false,
  onError,
}: {
  text: string;
  sources?: Source[];
  streaming?: boolean;
  onError: (message: string) => void;
}) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let index = 0;
  const inline = (value: string) => inlineText(streaming ? stableStreamingInline(value) : value, sources, onError);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      const start = index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={start}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      blocks.push(<h3 key={index++}>{inline(heading[1])}</h3>);
      continue;
    }
    if (/^\s*([-*+] |\d+[.)] )/.test(line)) {
      const ordered = /^\s*\d+[.)] /.test(line);
      const start = index;
      const items: ReactNode[] = [];
      const listPattern = ordered ? /^\s*\d+[.)] (.*)/ : /^\s*[-*+] (.*)/;
      while (index < lines.length) {
        const item = lines[index].match(listPattern);
        if (!item) break;
        items.push(<li key={index++}>{inline(item[1])}</li>);
      }
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={index++}>{inline(line.replace(/^>\s?/, ""))}</blockquote>);
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const start = index;
      const cells = (row: string) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
      const headers = cells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(
        <div className="chat-table" key={start}>
          <table><thead><tr>{headers.map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const start = index;
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^\s*(?:```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[index])) {
      if (lines[index].includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) break;
      paragraph.push(lines[index++]);
    }
    blocks.push(<p key={start}>{paragraph.map((value, i) => <Fragment key={i}>{i > 0 && <br />}{inline(value)}</Fragment>)}</p>);
  }
  return <div className="chat-answer" data-streaming={streaming || undefined}>{blocks}</div>;
}, (previous, next) => {
  if (previous.text !== next.text || previous.streaming !== next.streaming || previous.onError !== next.onError) return false;
  const left = previous.sources || [];
  const right = next.sources || [];
  return left.length === right.length && left.every((source, index) =>
    source.id === right[index].id && source.url === right[index].url && source.title === right[index].title,
  );
});

function Activity({ events, running, durationMs }: { events: AgentEvent[]; running: boolean; durationMs?: number }) {
  const visible = events.filter((event) => !["run-start", "observation", "decision", "token", "delta"].includes(event.type));
  const actions = events.filter((event) => event.type === "action").length;
  if (!visible.length) return null;
  const duration = durationMs ?? events.at(-1)?.elapsedMs;
  return (
    <details className="chat-activity">
      <summary>
        <ChevronRight className="activity-chevron" size={13} />
        <span>{running ? "Activity" : "View activity"}{actions > 0 ? ` · ${actions} ${actions === 1 ? "action" : "actions"}` : ""}</span>
        {duration !== undefined && <span>{(duration / 1000).toFixed(1)}s</span>}
      </summary>
      <ol>{visible.map((event, index) => (
        <li key={`${event.timestamp}-${index}`} className={["error", "blocked"].includes(event.type) ? "chat-error" : ""}>
          <p>{event.message}</p>
          {event.operation && <small>{event.operation.replaceAll("_", " ").toLowerCase()}{event.durationMs !== undefined ? ` · ${Math.round(event.durationMs)} ms` : ""}</small>}
        </li>
      ))}</ol>
    </details>
  );
}

function StoppedReceipt({ events, onError }: { events: AgentEvent[]; onError: (message: string) => void }) {
  const actions = events.filter((event) => event.type === "action");
  const lastAction = actions.at(-1);
  const page = [...events].reverse().find((event) => event.url && webUrl(event.url));
  return (
    <div className="chat-stopped-receipt">
      <div className="chat-status-note"><Square size={10} /><span>Stopped{actions.length ? ` · ${actions.length} ${actions.length === 1 ? "action" : "actions"} recorded` : ""}</span></div>
      {lastAction && <p>{lastAction.message}</p>}
      {page?.url && <OpenLink url={page.url} onError={onError}><Globe size={11} />{sourceHost(page.url)}<ArrowUpRight size={11} /></OpenLink>}
      <small>Continue with a follow-up.{actions.length > 0 ? " Previous page actions remain." : ""}</small>
    </div>
  );
}

function Message({
  message,
  reduced,
  onRetry,
  onContinue,
  onError,
}: {
  message: ChatMessage;
  reduced: boolean;
  onRetry: () => void;
  onContinue?: () => void;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (message.role === "user") return (
    <article className="chat-message user" aria-label="You">
      <div className="chat-user-content">{message.content}</div>
      {message.mode === "research" && message.sourceTabIds && <div className="chat-status-note"><Search size={11} />{message.sourceTabIds.length ? `${message.sourceTabIds.length} selected ${message.sourceTabIds.length === 1 ? "page" : "pages"}` : "Web sources"}</div>}
      {message.status === "queued" && <div className="chat-status-note">Waiting to start</div>}
    </article>
  );
  const running = ["queued", "running", "streaming"].includes(message.status);
  const sources = message.research?.sources || [];
  const content = message.content || message.research?.summary || "";
  const activity = [...(message.events || [])].reverse().find((event) => !["run-start", "observation", "decision", "token", "delta"].includes(event.type));
  const verificationHandoff = message.events?.some(event => event.operation === "CAPTCHA_HANDOFF");
  const copy = async () => {
    try {
      const findings = message.research?.findings.map((finding) =>
        `${finding.text}${finding.sourceIds.length ? ` [${finding.sourceIds.join(", ")}]` : ""}`,
      ) || [];
      const citations = sources.map((source) => `[${source.id}] ${source.title}: ${source.url}`);
      await navigator.clipboard.writeText([content, ...findings, ...(citations.length ? [citations.join("\n")] : [])].filter(Boolean).join("\n\n"));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      onError("Could not copy the answer. Select the text to copy it.");
    }
  };
  return (
    <article className={`chat-message assistant ${message.status}`} aria-label="Jevry">
      <div className="chat-message-header">
        <Zap size={14} /> <span>Jevry</span>
        {message.status === "streaming" && content && <span className="chat-writing">Writing</span>}
        {!running && message.durationMs !== undefined && <time title="Response duration">{(message.durationMs / 1000).toFixed(1)}s</time>}
      </div>
      {message.status === "stopped" && content && !/^(Stopped\.|Replaced by|Interrupted when)/.test(content) && <div className="chat-partial-label">Partial response</div>}
      {content && <Answer text={content} sources={sources} streaming={message.status === "streaming"} onError={onError} />}
      {message.research?.findings?.length ? (
        <div className="chat-research-findings">
          {message.research.findings.map((finding, index) => <div key={index}>
            <Answer text={finding.text} sources={sources} onError={onError} />
            <div className="chat-finding-citations">{finding.sourceIds.map((id) => {
              const source = sources.find((item) => item.id === id);
              return source ? <OpenLink key={id} url={source.url} onError={onError} className="chat-inline-citation">{id}</OpenLink> : null;
            })}</div>
          </div>)}
        </div>
      ) : null}
      {running && !(content && message.status === "streaming") && <div className={`chat-pending ${content ? "with-content" : ""}`} role="status">
        <ThinkingOrb size={20} state="working" theme="light" paused={reduced} aria-hidden="true" />
        <span>{message.status === "queued" ? "Redirecting to your follow-up…" : message.status === "streaming" ? "Writing…" : activity?.message || "Working on your request…"}</span>
      </div>}
      {message.status === "error" && <div className="chat-status-note chat-error" role="alert"><AlertCircle size={13} /><span>{message.error || (!content ? "The request failed. Try again." : "Request interrupted by an error.")}</span></div>}
      {message.status === "stopped" && <StoppedReceipt events={message.events || []} onError={onError} />}
      {sources.length > 0 && <details className="chat-sources">
        <summary><LinkIcon size={13} />{sources.length} {sources.length === 1 ? "source" : "sources"}<ChevronDown size={12} /></summary>
        <div className="chat-sources-list">{sources.map((source, index) => <OpenLink key={`${source.id}-${index}`} url={source.url} onError={onError}>
          <span>{source.id || index + 1}</span><div>{source.title || sourceHost(source.url)}<small>{sourceHost(source.url)}</small></div><ArrowUpRight size={12} />
        </OpenLink>)}</div>
      </details>}
      <Activity events={message.events || []} running={running} durationMs={message.durationMs} />
      {!running && <div className="chat-message-actions">
        {content && <button type="button" className="chat-icon-button" onClick={() => void copy()} title={copied ? "Copied" : "Copy answer"} aria-label={copied ? "Copied" : "Copy answer"}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>}
        {["error", "stopped"].includes(message.status) && <button type="button" className="chat-retry" onClick={onRetry}><RotateCcw size={12} />Try again</button>}
        {verificationHandoff && onContinue && <button type="button" className="chat-retry" onClick={onContinue} title="Continue after completing verification in the page"><ArrowUpRight size={12} />Continue task</button>}
      </div>}
    </article>
  );
}

export default function ConversationPanel({
  state,
  reduced,
  onSettings,
  onError,
}: {
  state: AppState & ConversationSnapshot;
  reduced: boolean;
  onSettings: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ConversationMode>("auto");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showNewest, setShowNewest] = useState(false);
  const [conversationAction, setConversationAction] = useState<"menu" | "rename" | "delete" | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [managing, setManaging] = useState(false);
  const [managementError, setManagementError] = useState("");
  const [sourceTabIds, setSourceTabIds] = useState<string[] | undefined>(undefined);
  const [scopeOpen, setScopeOpen] = useState(false);
  const composerHintId = useId();
  const composerErrorId = useId();
  const scopeId = useId();
  const actionRegionId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const managementRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const sendingRef = useRef(false);
  const drafts = useRef(sessionDrafts);
  const conversation = state.conversations?.find((item) => item.id === state.activeConversationId);
  const messages = conversation?.messages || [];
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  const hasPage = !!tab && /^https?:/.test(tab.url);
  const sourceTabs = state.tabs.filter((item) => !!webUrl(item.url));
  const unavailableSourceIds = sourceTabIds?.filter((id) => !sourceTabs.some((item) => item.id === id)) || [];
  const provider = providerNames[state.settings.text.provider || "codex"];
  const scrollToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    pinned.current = true;
    setShowNewest(false);
  };
  useLayoutEffect(() => {
    const key = state.activeConversationId || "new";
    const lastRequest = [...messages].reverse().find((message) => message.role === "user");
    setDraft(drafts.current.get(key) || "");
    setSubmitError("");
    setConversationAction(null);
    setManagementError("");
    setSourceTabIds(sessionScopes.has(key) ? sessionScopes.get(key) : lastRequest?.sourceTabIds);
    setMode(sessionModes.get(key) || lastRequest?.mode || "auto");
    setScopeOpen(false);
    pinned.current = true;
    scrollToLatest();
  }, [state.activeConversationId]);
  useEffect(() => {
    if (conversationAction === "rename") {
      titleRef.current?.focus();
      titleRef.current?.select();
    } else if (conversationAction) managementRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [conversationAction]);
  useEffect(() => {
    const content = contentRef.current;
    const viewport = scrollRef.current;
    if (!content || !viewport) return;
    const observer = new ResizeObserver((entries) => {
      if (pinned.current) scrollToLatest();
      else if (entries.some((entry) => entry.target === content)) setShowNewest(true);
    });
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const input = textRef.current;
    if (!input) return;
    const followLatest = pinned.current;
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 55), 155)}px`;
    if (followLatest) scrollToLatest();
  }, [draft]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        textRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const updateDraft = (value: string) => {
    setDraft(value);
    drafts.current.set(state.activeConversationId || "new", value);
  };
  const send = async (text = draft, requestedMode = mode, scope?: { sourceTabIds?: string[] }) => {
    const value = text.trim();
    if (!value || sendingRef.current) return;
    const requestedSources = scope ? scope.sourceTabIds : requestedMode === "research" ? sourceTabIds : undefined;
    if (requestedSources?.some((id) => !sourceTabs.some((item) => item.id === id))) {
      setSubmitError("A selected page was closed. Update the research sources before sending.");
      setSourceTabIds(requestedSources);
      sessionScopes.set(state.activeConversationId || "new", requestedSources);
      if (scope && !draft.trim()) updateDraft(text);
      setScopeOpen(true);
      setMode("research");
      sessionModes.set(state.activeConversationId || "new", "research");
      return;
    }
    if (!window.jevry) {
      setSubmitError("Open the Jevry desktop app to send a message.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setSubmitError("");
    try {
      const result = await window.jevry.sendMessage({ text: value, mode: requestedMode, sourceTabIds: requestedSources });
      if (!result.ok) {
        setSubmitError(result.message || "Your message could not be sent. Try again.");
        return;
      }
      setDraft((current) => current === text ? "" : current);
      if (drafts.current.get(state.activeConversationId || "new") === text) drafts.current.delete(state.activeConversationId || "new");
      scrollToLatest();
      textRef.current?.focus();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your message could not be sent. Try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const changeConversation = async (id?: string) => {
    if (!window.jevry) { onError("Conversation history is available in the Jevry desktop app."); return; }
    try {
      const result = id ? await window.jevry.selectConversation(id) : await window.jevry.newConversation();
      if (!result.ok) onError(result.message || "Could not open conversation.");
      else textRef.current?.focus();
    } catch (error) { onError(String(error)); }
  };
  const closeConversationAction = () => {
    setConversationAction(null);
    setManagementError("");
    actionsRef.current?.focus();
  };
  const manageConversation = async (action: "rename" | "delete") => {
    if (!window.jevry || !conversation || managing) return;
    if (action === "rename" && !titleDraft.trim()) {
      setManagementError("Enter a conversation name.");
      titleRef.current?.focus();
      return;
    }
    setManaging(true);
    setManagementError("");
    try {
      const result = action === "rename"
        ? await window.jevry.renameConversation(conversation.id, titleDraft.trim())
        : await window.jevry.deleteConversation(conversation.id);
      if (!result.ok) {
        setManagementError(result.message || `Could not ${action} this conversation. Try again.`);
        return;
      }
      if (action === "delete") {
        drafts.current.delete(conversation.id);
        sessionScopes.delete(conversation.id);
        sessionModes.delete(conversation.id);
      }
      setConversationAction(null);
      textRef.current?.focus();
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : `Could not ${action} this conversation. Try again.`);
    } finally {
      setManaging(false);
    }
  };
  const changeScope = (next: string[] | undefined) => {
    setSourceTabIds(next);
    sessionScopes.set(state.activeConversationId || "new", next);
    setSubmitError("");
  };
  const stop = async () => {
    if (!window.jevry || stopping) return;
    setStopping(true);
    try { await window.jevry.stop(); }
    catch (error) { onError(String(error)); }
    finally { setStopping(false); }
  };
  const suggest = (text: string) => { updateDraft(text); textRef.current?.focus(); };
  const retry = (message: ChatMessage) => {
    const index = messages.findIndex((item) => item.id === message.id);
    const user = messages.find((item) => item.id === message.replyTo)
      || messages.slice(0, index).reverse().find((item) => item.role === "user");
    if (user) void send(user.content, message.mode || user.mode || mode, { sourceTabIds: user.sourceTabIds ?? message.sourceTabIds });
  };
  const continueTask = async (message: ChatMessage) => {
    if (!window.jevry || state.running || sending) return;
    const request = messages.find(item => item.id === message.replyTo);
    try {
      if (message.tabId) {
        if (!state.tabs.some(tab => tab.id === message.tabId)) { onError("The verification page was closed. Open the page again before continuing."); return; }
        await window.jevry.selectTab(message.tabId);
      }
      await send("Continue the previous task from the current page, preserving completed actions and the original constraints.", message.mode || request?.mode || mode, {sourceTabIds: request?.sourceTabIds});
    } catch (error) { onError(error instanceof Error ? error.message : "Could not continue this task."); }
  };
  return (
    <aside className="conversation-panel" aria-label="Jevry conversation">
      <header className="conversation-heading">
        <label className="conversation-picker">
          <History size={15} />
          <select value={state.activeConversationId || ""} onChange={(event) => void changeConversation(event.target.value)} aria-label="Conversation history" disabled={managing}>
            {!conversation && <option value="">New conversation</option>}
            {(state.conversations || []).map((item) => <option key={item.id} value={item.id}>{item.title || "New conversation"}</option>)}
          </select>
          <ChevronDown size={12} />
        </label>
        <button ref={actionsRef} type="button" className="chat-icon-button" disabled={!conversation || managing} onClick={() => { setConversationAction(conversationAction ? null : "menu"); setManagementError(""); setScopeOpen(false); }} aria-label="Conversation actions" aria-expanded={!!conversationAction} aria-controls={actionRegionId} title="Conversation actions"><MoreHorizontal size={17} /></button>
        <button type="button" className="chat-icon-button" disabled={managing} onClick={() => void changeConversation()} aria-label="New conversation" title="New conversation"><Plus size={18} /></button>
      </header>
      {conversationAction && conversation && <section ref={managementRef} className="conversation-management" id={actionRegionId} aria-label="Manage conversation" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!managing) closeConversationAction(); }
      }}>
        {conversationAction === "menu" ? <div className="conversation-action-menu">
          <button type="button" onClick={() => { setTitleDraft(conversation.title); setConversationAction("rename"); }}><Pencil size={13} />Rename</button>
          <button type="button" className="conversation-delete-action" onClick={() => setConversationAction("delete")}><Trash2 size={13} />Delete</button>
          <button type="button" className="chat-icon-button" aria-label="Close conversation actions" onClick={closeConversationAction}><X size={13} /></button>
        </div> : conversationAction === "rename" ? <form onSubmit={(event) => { event.preventDefault(); void manageConversation("rename"); }}>
          <label htmlFor={`${actionRegionId}-title`}>Conversation name</label>
          <input id={`${actionRegionId}-title`} ref={titleRef} value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} maxLength={120} disabled={managing} autoComplete="off" />
          <div className="conversation-management-buttons"><button type="button" onClick={closeConversationAction} disabled={managing}>Cancel</button><button type="submit" className="conversation-save-action" disabled={managing || !titleDraft.trim()}>{managing ? "Saving…" : "Save name"}</button></div>
        </form> : <div className="conversation-delete-confirmation">
          <h3>Delete this conversation?</h3>
          <p>“{conversation.title}” and its saved messages will be removed.{state.running ? " Its current task will stop." : ""}</p>
          <div className="conversation-management-buttons"><button type="button" onClick={closeConversationAction} disabled={managing}>Cancel</button><button type="button" className="conversation-delete-action" onClick={() => void manageConversation("delete")} disabled={managing}>{managing ? "Deleting…" : "Delete conversation"}</button></div>
        </div>}
        {managementError && <p className="conversation-management-error" role="alert">{managementError}</p>}
      </section>}
      <div className="conversation-scroll" ref={scrollRef} role="region" aria-label="Conversation messages" tabIndex={0} onScroll={() => {
        const element = scrollRef.current!;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        if (pinned.current) setShowNewest(false);
      }}>
        <div ref={contentRef} className={messages.length ? "conversation-messages" : "conversation-empty"}>
          {!messages.length ? <>
            <div className="conversation-empty-mark"><BotAvatar type="pebble" size={56} color="#d6ef83" theme="light" paused={reduced} jumpEvery={0} interactive={false} /></div>
            <h2>What shall<br />we do?</h2>
            <p>Ask a question, explore the web, or hand over a task. Follow up as you go.</p>
            <div className="conversation-starters">
              <button onClick={() => suggest("Find and compare ")}><Search size={15} /><span>Find and compare something</span><ArrowUpRight size={13} /></button>
              <button onClick={() => suggest(hasPage ? "Summarize this page and explain what matters." : "Help me understand ")}><MessageSquare size={15} /><span>{hasPage ? "Make sense of this page" : "Help me understand something"}</span><ArrowUpRight size={13} /></button>
              <button onClick={() => suggest("Open ")}><Globe size={15} /><span>Go somewhere and take action</span><ArrowUpRight size={13} /></button>
            </div>
          </> : messages.map((message) => <Message key={message.id} message={message} reduced={reduced} onError={onError} onRetry={() => retry(message)} onContinue={!state.running && message.id === lastAssistant?.id ? () => void continueTask(message) : undefined} />)}
        </div>
      </div>
      {showNewest && <button type="button" className="chat-newest" onClick={scrollToLatest}><ArrowDown size={12} />Latest message</button>}
      <div className="conversation-compose-region">
        {mode === "research" ? <>
          <button type="button" className="conversation-context conversation-research-scope" aria-expanded={scopeOpen} aria-controls={scopeId} onClick={() => { setScopeOpen(!scopeOpen); setConversationAction(null); }}>
            <Search size={12} /><span>{sourceTabIds === undefined ? "Automatic sources" : sourceTabIds.length ? `Only ${sourceTabIds.length} selected ${sourceTabIds.length === 1 ? "page" : "pages"}` : "Find sources on the web"}</span><small>{unavailableSourceIds.length ? "Update sources" : "Choose"}</small><ChevronDown size={12} />
          </button>
          {scopeOpen && <div className="conversation-scope-picker" id={scopeId} role="group" aria-label="Research sources">
            <label className="conversation-scope-option"><input type="radio" name={scopeId} checked={sourceTabIds === undefined} onChange={() => changeScope(undefined)} /><span><strong>Automatic</strong><small>Use open pages and find sources as needed.</small></span></label>
            <label className="conversation-scope-option"><input type="radio" name={scopeId} checked={sourceTabIds?.length === 0} onChange={() => changeScope([])} /><span><strong>Find sources on the web</strong><small>Start a fresh search for this question.</small></span></label>
            {sourceTabs.length > 0 && <div className="conversation-scope-pages">
              <p>Or choose up to 8 open pages</p>
              {sourceTabs.map((sourceTab) => <label key={sourceTab.id} title={sourceTab.url}><input type="checkbox" checked={sourceTabIds?.includes(sourceTab.id) || false} disabled={!sourceTabIds?.includes(sourceTab.id) && (sourceTabIds?.length || 0) >= 8} onChange={(event) => changeScope(event.target.checked ? [...(sourceTabIds || []), sourceTab.id] : sourceTabIds?.filter((id) => id !== sourceTab.id) || [])} /><span><strong>{sourceTab.title || sourceHost(sourceTab.url)}</strong><small>{sourceHost(sourceTab.url)}</small></span></label>)}
            </div>}
            {unavailableSourceIds.length > 0 && <div className="conversation-scope-stale"><span>{unavailableSourceIds.length} selected {unavailableSourceIds.length === 1 ? "page is" : "pages are"} closed.</span><button type="button" onClick={() => changeScope(sourceTabIds?.filter((id) => !unavailableSourceIds.includes(id)))}>{unavailableSourceIds.length === sourceTabIds?.length ? "Use web search instead" : "Remove closed pages"}</button></div>}
          </div>}
        </> : <div className="conversation-context" title={hasPage ? tab.url : "Ask a question or name a website to get started"}>
          <Globe size={12} /><span>{hasPage ? tab.title || sourceHost(tab.url) : "Ready to explore the web"}</span>
          {hasPage && <small>Current page</small>}
        </div>}
        <BorderBeam active={state.running && !reduced} colorVariant="mono" theme="light" size="line"><form className="chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea ref={textRef} value={draft} onChange={(event) => updateDraft(event.target.value)} placeholder={state.running ? "Add a detail or change direction…" : messages.length ? "Ask a follow-up…" : "Ask Jevry anything…"} aria-label="Message Jevry" aria-describedby={`${composerHintId}${submitError ? ` ${composerErrorId}` : ""}`} rows={2} maxLength={12000} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }} />
          <div className="chat-compose-actions">
            <label className="conversation-mode">
              {mode === "research" ? <Search size={13} /> : mode === "act" ? <MousePointer2 size={13} /> : <Zap size={13} />}
              <select value={mode} onChange={(event) => { const next = event.target.value as ConversationMode; setMode(next); sessionModes.set(state.activeConversationId || "new", next); }} aria-label="Conversation mode" title="Auto chooses how to help. Act controls the browser. Research finds and compares sources.">
                <option value="auto">Auto</option><option value="act">Act</option><option value="research">Research</option>
              </select><ChevronDown size={11} />
            </label>
            {state.running && <button type="button" className="chat-stop" onClick={() => void stop()} disabled={stopping} aria-label="Stop current task"><Square size={11} fill="currentColor" />{stopping ? "Stopping" : "Stop"}</button>}
            <button type="submit" className="chat-send" disabled={!draft.trim() || sending} aria-label={state.running ? "Send and redirect" : "Send message"} title={state.running ? "Send and redirect the current task" : "Send message (Enter)"}>
              {sending ? <LoaderCircle size={15} className={reduced ? "" : "spin"} /> : <>{state.running && <span>Redirect</span>}<ArrowUp size={18} /></>}
            </button>
          </div>
        </form></BorderBeam>
        {submitError && <p className="chat-submit-error" id={composerErrorId} role="alert">{submitError}</p>}
        <div className="conversation-compose-note"><span id={composerHintId}>{state.running ? "Follow-ups redirect the current task." : "Enter to send · Shift + Enter for a new line"}</span><button type="button" onClick={onSettings} title="Model connection settings"><Settings2 size={11} /><span>{provider} + Jev</span></button></div>
      </div>
      <div className="chat-screen-reader-status" role="status" aria-live="polite" aria-atomic="true">
        {lastAssistant?.status === "complete" ? "Jevry has finished replying. The answer is available in Conversation messages." : ""}
      </div>
    </aside>
  );
}
