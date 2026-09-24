import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Globe,
  Plus,
  X,
  Minus,
  Square,
  Settings2,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  LockKeyhole,
  KeyRound,
  Terminal,
  ExternalLink,
  ShieldCheck,
  Zap,
  Command,
  Orbit,
  LoaderCircle,
  Camera,
  Download,
  Mic,
  StopCircle,
  MousePointer2,
  Type,
  ChevronDown,
  Link,
  Clock3,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
  Keyboard,
  FileJson,
} from "lucide-react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";
import { MetalFx } from "metal-fx";
import { Liquid } from "liquid-gooey";
import { VoiceBeam } from "voice-glow";
import type { AppState, Provider, AgentEvent } from "./types";
import { Mark, DisplayMark, useReducedMotion } from "./brand";
import ConversationPanel from "./ConversationPanel";
const BrandBook = lazy(() => import("./BrandBook"));
const Snapshot = lazy(() => import("./Snapshot"));
const bridge = window.jevry;
const initial: AppState = {
  conversations: [],
  activeConversationId: null,
  settings: {
    text: { connected: false },
    jev: { connected: false },
    onboardingComplete: false,
    reducedEffects: false,
  },
  tabs: [],
  activeTabId: null,
  running: false,
  events: [],
  platform: navigator.platform.toLowerCase().includes("mac")
    ? "darwin"
    : "win32",
};
const names: Record<Provider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  openai: "API key",
  anthropic: "Anthropic",
};
function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`icon-button ${className}`}
    >
      {children}
    </button>
  );
}
function App() {
  const [state, setState] = useState(initial);
  const [brandOpen, setBrandOpen] = useState(new URLSearchParams(location.search).get("view") === "brand");
  useEffect(()=>{
    const message=[state.connectionError,state.workspaceError,state.historyError].filter(Boolean).join(' ');
    if(message)setError(message);
  },[state.connectionError,state.workspaceError,state.historyError]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [snapshot, setSnapshot] = useState("");
  const [capturing, setCapturing] = useState(false);
  const previewWorkspace =
    !bridge && new URLSearchParams(location.search).get("view") === "browser";
  const setup =
    (!state.settings.onboardingComplete && !previewWorkspace) || settingsOpen;
  const prefersReduced = useReducedMotion();
  const reduced = state.settings.reducedEffects || prefersReduced;
  useEffect(() => {
    if (!bridge) return;
    bridge
      .state()
      .then(setState)
      .catch((e) => setError(e.message));
    const off = bridge.onState(setState);
    const offEvent = bridge.onEvent((event) =>
      setState((s) => ({ ...s, events: [...s.events, event].slice(-300) })),
    );
    return () => {
      off();
      offEvent();
    };
  }, []);
  const invoke = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    }
  };
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 7000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "t" && !setup) {
        e.preventDefault();
        void bridge?.newTab();
      }
      if (e.key === "Escape") {
        if (snapshot) setSnapshot("");
        else if (settingsOpen) setSettingsOpen(false);
        else void bridge?.stop();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [setup, snapshot, settingsOpen]);
  const capture = async () => {
    if (!bridge) return;
    setCapturing(true);
    try {
      setSnapshot(await bridge.screenshot());
    } catch (e) {
      setError(String(e));
    } finally {
      setCapturing(false);
    }
  };
  if (brandOpen) return <Suspense fallback={<div className="loading-snapshot">Opening the brand book…</div>}><BrandBook reducedEffects={reduced} onClose={() => setBrandOpen(false)} /></Suspense>;
  return (
    <div
      className={`app ${setup ? "setup-mode" : ""} ${reduced ? "reduced-effects" : ""}`}
    >
      <div className="titlebar">
        <div className="window-left">
          {state.platform !== "darwin" && (
            <span className="mini-brand">
              <Mark size={18} /> Jevry
            </span>
          )}
        </div>
        <div className="titlebar-center">
          <button disabled={state.running} onClick={() => { if (!state.running) setBrandOpen(true); }} title={state.running ? "Brand book available when the current task stops" : "Open the Jevry brand book"}>{setup ? "Jevry · Intent, in motion" : "Jevry · Brand book"}</button>
        </div>
        {state.platform === "win32" ? (
          <div className="window-controls">
            <IconButton
              label="Minimize"
              onClick={() => void bridge?.windowAction("minimize")}
            >
              <Minus />
            </IconButton>
            <IconButton
              label="Maximize"
              onClick={() => void bridge?.windowAction("maximize")}
            >
              <Square size={12} />
            </IconButton>
            <IconButton
              label="Close"
              onClick={() => void bridge?.windowAction("close")}
            >
              <X />
            </IconButton>
          </div>
        ) : (
          <div className="titlebar-meta">
            <span className="status-dot" /> Local workspace
          </div>
        )}
      </div>
      {setup ? (
        <Setup
          state={state}
          reduced={reduced}
          onClose={settingsOpen ? () => setSettingsOpen(false) : undefined}
          onFinished={() => setSettingsOpen(false)}
        />
      ) : (
        <>
          <div className="workspace-top">
            <div className="workspace-name">
              <span className="logo-small">
                <Mark size={25} />
              </span>
              <strong>jevry</strong>
              <span className="workspace-tag">Personal</span>
              <IconButton
                label={sidebar ? "Hide agent panel" : "Show agent panel"}
                onClick={() => setSidebar(!sidebar)}
              >
                {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
              </IconButton>
            </div>
            <div className="tab-strip" role="tablist" aria-label="Browser tabs">
              {(state.tabs.length
                ? state.tabs
                : [{ id: "preview", title: "New tab", url: "about:blank" }]
              ).map((tab) => (
                <div
                  key={tab.id}
                  className={`tab ${tab.id === state.activeTabId || tab.id === "preview" ? "selected" : ""}`}
                >
                  <button
                    role="tab"
                    aria-selected={tab.id === state.activeTabId}
                    onClick={() => void bridge?.selectTab(tab.id)}
                  >
                    <Globe size={14} />
                    <span>{tab.title || "New tab"}</span>
                  </button>
                  <IconButton
                    label={`Close ${tab.title}`}
                    onClick={() => void bridge?.closeTab(tab.id)}
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              ))}
              <IconButton
                label="New tab (⌘T / Ctrl+T)"
                onClick={() => void bridge?.newTab()}
              >
                <Plus />
              </IconButton>
            </div>
            <IconButton
              label="Connection settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SlidersHorizontal />
            </IconButton>
          </div>
          <div className={`workspace ${!sidebar ? "collapsed" : ""}`}>
            {sidebar && (
              <ConversationPanel
                state={state}
                reduced={reduced}
                onSettings={() => setSettingsOpen(true)}
                onError={setError}
              />
            )}
            <div className="browser-column">
              <Toolbar
                state={state}
                onCapture={capture}
                capturing={capturing}
                onError={setError}
              />
              <BrowserPane
                state={state}
                hidden={!!snapshot}
                onError={setError}
              />
              <div className="browser-status">
                <span>
                  <span className="status-dot" />{" "}
                  {state.running ? "Agent is working" : "Ready when you are"}
                </span>
                <span>
                  <ShieldCheck size={12} /> Isolated browser session{" "}
                  <span className="status-divider">/</span> Chromium
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={17} />
          {error}
          <IconButton label="Dismiss message" onClick={() => setError("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {snapshot && (
        <div className="dialog-backdrop" onClick={() => setSnapshot("")}>
          <section
            className="snapshot-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Page snapshot"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading">
              <div>
                <h2>Page snapshot</h2>
                <p>Captured from your current tab.</p>
              </div>
              <div className="inline-actions">
                <a
                  className="button secondary"
                  href={snapshot}
                  download={`jevry-snapshot-${Date.now()}.png`}
                >
                  <Download size={15} /> Save image
                </a>
                <IconButton
                  label="Close snapshot"
                  onClick={() => setSnapshot("")}
                >
                  <X />
                </IconButton>
              </div>
            </div>
            <Suspense
              fallback={
                <div className="loading-snapshot">Preparing snapshot…</div>
              }
            >
              <Snapshot src={snapshot} reduced={reduced} />
            </Suspense>
          </section>
        </div>
      )}
    </div>
  );
}
function Setup({
  state,
  reduced,
  onClose,
  onFinished,
}: {
  state: AppState;
  reduced: boolean;
  onClose?: () => void;
  onFinished: () => void;
}) {
  const [step, setStep] = useState(state.settings.text.connected ? 2 : 1);
  const [provider, setProvider] = useState<Provider>(
    state.settings.text.provider || "codex",
  );
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKind, setApiKind] = useState<"openai" | "anthropic">("openai");
  const [jevKey, setJevKey] = useState("");
  const [jevModel, setJevModel] = useState("jev-latest");
  const [jevBaseUrl, setJevBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [auth, setAuth] = useState("");
  const [status, setStatus] = useState<
    Record<string, { installed: boolean; authenticated: boolean }>
  >({});
  const both = state.settings.text.connected && state.settings.jev.connected;
  useEffect(() => {
    if (!bridge) return;
    Promise.all(
      ["codex", "claude"].map(
        async (p) => [p, await bridge.status(p as "codex" | "claude")] as const,
      ),
    )
      .then((results) => setStatus(Object.fromEntries(results)))
      .catch(() => {});
    return bridge.onAuthProgress(setAuth);
  }, []);
  useEffect(() => {
    setStep(state.settings.text.connected ? 2 : 1);
  }, [state.settings.text.connected]);
  const connect = async () => {
    setMessage("");
    setAuth("");
    if (!bridge) {
      setMessage(
        "Open the Jevry desktop app to connect your models. Run npm run dev from the project.",
      );
      return;
    }
    setBusy(true);
    try {
      const result =
        step === 1
          ? await bridge.connectText({
              provider: provider === "openai" ? apiKind : provider,
              apiKey: key,
              model,
              baseUrl,
            })
          : await bridge.connectJev({
              apiKey: jevKey,
              model: jevModel,
              baseUrl: jevBaseUrl,
            });
      if (!result.ok)
        setMessage(result.message || "Connection failed. Try again.");
      else {
        setKey("");
        setJevKey("");
        if (step === 1) setStep(2);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };
  const launch = async () => {
    if (!bridge) return;
    try {
      const result = await bridge.finishSetup();
      if (result.ok) onFinished();
      else setMessage(result.message || "Connect both models.");
    } catch (e) {
      setMessage(String(e));
    }
  };
  return (
    <main className="setup-shell">
      <aside className="setup-story">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <MetalFx
            variant="circle"
            preset="silver"
            theme="dark"
            paused={reduced || !busy}
          >
            <span className="brand-icon">
              <Mark size={31} />
            </span>
          </MetalFx>
          <span>
            jevry<span className="brand-period">.</span>
          </span>
        </a>
        <div className="story-content">
          <div className="speed-art" aria-hidden="true"><DisplayMark size={240} /></div>
          <h1>
            A little intent.
            <br />
            A lot of <span>possibility.</span>
          </h1>
          <p>
            A browser that turns your intent into action. Connect your models
            and put the web to work.
          </p>
        </div>
        <div className="story-bottom">
          <div className="story-note">
            <ShieldCheck size={16} />
            <span>Your browser. Your models. Your keys.</span>
          </div>
          <div className="story-credit">
            Intent, in motion. <ArrowRight size={16} />
          </div>
        </div>
      </aside>
      <section className="setup-panel">
        <div className="setup-panel-top">
          <span className="setup-label">Welcome to Jevry</span>
          {onClose ? (
            <IconButton label="Back to browser" onClick={onClose}>
              <X />
            </IconButton>
          ) : (
            <span className="setup-count">
              {both ? "Ready to go" : `Step ${step} of 2`}
            </span>
          )}
        </div>
        <nav className="setup-progress" aria-label="Connection setup">
          <button
            className={step === 1 ? "current" : ""}
            onClick={() => {
              setStep(1);
              setMessage("");
            }}
          >
            <span className={state.settings.text.connected ? "done" : ""}>
              {state.settings.text.connected ? <Check size={13} /> : "1"}
            </span>{" "}
            Text model
          </button>
          <div />
          <button
            className={step === 2 ? "current" : ""}
            onClick={() => {
              if (state.settings.text.connected) {
                setStep(2);
                setMessage("");
              }
            }}
            disabled={!state.settings.text.connected}
          >
            <span className={state.settings.jev.connected ? "done" : ""}>
              {state.settings.jev.connected ? <Check size={13} /> : "2"}
            </span>{" "}
            Browser model
          </button>
        </nav>
        <div className="setup-form">
          {both ? (
            <>
              <div className="ready-mark">
                <Check size={32} />
              </div>
              <h2>All systems, ready.</h2>
              <p className="setup-description">
                Your models are connected. Give Jevry a destination and a task.
                It’ll take it from there.
              </p>
              <div className="connection-summary">
                <div>
                  <Terminal size={20} />
                  <span>
                    <strong>
                      {names[state.settings.text.provider || "codex"]}
                    </strong>
                    <small>Text and reasoning</small>
                  </span>
                  <button
                    className="text-button connection-change"
                    onClick={() => void bridge?.disconnect("text")}
                  >
                    Change
                  </button>
                  <span className="connected-chip">
                    <Check size={12} /> Connected
                  </span>
                </div>
                <div>
                  <Zap size={20} />
                  <span>
                    <strong>{state.settings.jev.model || "Jev"}</strong>
                    <small>Browser actions</small>
                  </span>
                  <button
                    className="text-button connection-change"
                    onClick={() => void bridge?.disconnect("jev")}
                  >
                    Change
                  </button>
                  <span className="connected-chip">
                    <Check size={12} /> Connected
                  </span>
                </div>
              </div>
              <button className="button primary launch-button" onClick={launch}>
                Enter your browser <ArrowRight size={18} />
              </button>
              <button
                className="text-button reset-connection"
                onClick={() => void bridge?.disconnect("text")}
              >
                Change connections
              </button>
            </>
          ) : (
            <>
              <div className="form-icon">
                {step === 1 ? <Terminal size={24} /> : <Zap size={24} />}
              </div>
              <h2>
                {step === 1
                  ? "Make yourself at home."
                  : "Give your browser reflexes."}
              </h2>
              <p className="setup-description">
                {step === 1
                  ? "Bring the model you already use. Connect your account in a click, or use an API key."
                  : "Jev reads the page and picks the next move. One fast request. No screenshot round trips."}
              </p>
              {step === 1 ? (
                <>
                  <div
                    className="provider-options"
                    role="radiogroup"
                    aria-label="Text model provider"
                  >
                    {(["codex", "claude", "openai"] as Provider[]).map((p) => (
                      <button
                        key={p}
                        role="radio"
                        aria-checked={provider === p}
                        className={`provider-option ${provider === p ? "active" : ""}`}
                        onClick={() => {
                          setProvider(p);
                          setMessage("");
                          setModel("");
                          setBaseUrl("");
                        }}
                      >
                        {p === "codex" ? (
                          <Command size={23} />
                        ) : p === "claude" ? (
                          <span className="claude-symbol" aria-hidden="true">
                            <Orbit size={24} />
                          </span>
                        ) : (
                          <KeyRound size={22} />
                        )}
                        <strong>{names[p]}</strong>
                        <small>
                          {p === "openai"
                            ? "Your own provider"
                            : "Use your account"}
                        </small>
                        <span className="radio-dot">
                          {provider === p && <span />}
                        </span>
                      </button>
                    ))}
                  </div>
                  {provider === "openai" ? (
                    <div className="api-fields">
                      <label>
                        Provider
                        <select
                          value={apiKind}
                          onChange={(e) =>
                            setApiKind(e.target.value as "openai" | "anthropic")
                          }
                        >
                          <option value="openai">
                            OpenAI / OpenAI-compatible
                          </option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </label>
                      <label>
                        API key
                        <input
                          type="password"
                          value={key}
                          onChange={(e) => setKey(e.target.value)}
                          placeholder="Paste your API key"
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      <details>
                        <summary>
                          Model and endpoint <ChevronDown size={13} />
                        </summary>
                        <label>
                          Model
                          <input
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder={
                              apiKind === "anthropic"
                                ? "claude-sonnet-4-6"
                                : "gpt-4.1-mini"
                            }
                          />
                        </label>
                        <label>
                          API base URL
                          <input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={
                              apiKind === "anthropic"
                                ? "https://api.anthropic.com"
                                : "https://api.openai.com/v1"
                            }
                          />
                        </label>
                      </details>
                    </div>
                  ) : (
                    <div className="account-info">
                      <span
                        className={`connection-indicator ${status[provider]?.installed ? "found" : ""}`}
                      >
                        <Terminal size={18} />
                      </span>
                      <div>
                        <strong>
                          {status[provider]?.authenticated
                            ? "Your account is ready to connect"
                            : status[provider]?.installed
                              ? `${names[provider]} is installed`
                              : "One account. A familiar sign-in."}
                        </strong>
                        <p>
                          {status[provider]?.authenticated
                            ? "Use your existing local sign-in. No API key needed."
                            : "We’ll open the sign-in flow and handle the connection in the background."}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="jev-provider">
                    <div className="jev-badge">
                      <Mark size={28} />
                    </div>
                    <div>
                      <strong>Jev by TypeSafe</strong>
                      <span>Purpose-built for fast browser actions</span>
                    </div>
                    <span className="fast-badge">
                      <Zap size={12} /> Fast path
                    </span>
                  </div>
                  <label className="key-label">
                    TypeSafe API key
                    <input
                      type="password"
                      value={jevKey}
                      onChange={(e) => setJevKey(e.target.value)}
                      placeholder="Paste your TypeSafe API key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <div className="field-help">
                    <span>Stored encrypted on this device.</span>
                    <button
                      className="text-button"
                      onClick={() =>
                        void bridge?.openExternal(
                          "https://docs.typesafe.ai/introduction",
                        )
                      }
                    >
                      Get a key <ExternalLink size={12} />
                    </button>
                  </div>
                  <details>
                    <summary>
                      Model settings <ChevronDown size={13} />
                    </summary>
                    <label>
                      Jev model
                      <input
                        value={jevModel}
                        onChange={(e) => setJevModel(e.target.value)}
                        placeholder="jev-latest"
                      />
                    </label>
                    <label>
                      Jev endpoint
                      <input
                        value={jevBaseUrl}
                        onChange={(e) => setJevBaseUrl(e.target.value)}
                        placeholder="https://api.typesafe.ai/v1/systemone"
                      />
                    </label>
                  </details>
                  <div className="speed-explainer">
                    <div>
                      <MousePointer2 size={16} />
                      <span>Read the page</span>
                    </div>
                    <ChevronRight size={14} />
                    <div>
                      <Zap size={16} />
                      <span>Choose an action</span>
                    </div>
                    <ChevronRight size={14} />
                    <div>
                      <Check size={16} />
                      <span>Execute</span>
                    </div>
                  </div>
                </>
              )}
              {message && (
                <div className="form-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{message}</span>
                </div>
              )}
              {auth && busy && (
                <div className="auth-progress" role="status">
                  {auth.slice(-700)}
                </div>
              )}
              <BorderBeam
                active={busy && !reduced}
                colorVariant="mono"
                theme="light"
                size="line"
              >
                <button
                  className="button primary connect-button"
                  onClick={connect}
                  disabled={
                    busy ||
                    (step === 2 && !jevKey.trim()) ||
                    (step === 1 && provider === "openai" && !key.trim())
                  }
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="spin" size={18} />
                      {step === 1
                        ? "Connecting your account…"
                        : "Testing Jev connection…"}
                    </>
                  ) : (
                    <>
                      {step === 1
                        ? provider === "openai"
                          ? "Connect text model"
                          : status[provider]?.installed === false
                            ? `Install & connect ${names[provider]}`
                            : `Connect with ${names[provider]}`
                        : "Connect Jev"}
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </BorderBeam>
              {step === 1 && provider !== "openai" && (
                <div className="install-help">
                  Missing CLI? We can install it privately with npm.{" "}
                  <button
                    className="text-button"
                    onClick={() =>
                      void bridge?.openExternal(
                        provider === "codex"
                          ? "https://developers.openai.com/codex/cli/"
                          : "https://code.claude.com/docs/en/quickstart",
                      )
                    }
                  >
                    Install guide <ExternalLink size={11} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="setup-footer">
          <LockKeyhole size={14} />
          <span>
            Keys stay encrypted on your device. Page context goes to your
            models.
          </span>
        </div>
      </section>
    </main>
  );
}
function Toolbar({
  state,
  onCapture,
  capturing,
  onError,
}: {
  state: AppState;
  onCapture: () => void;
  capturing: boolean;
  onError: (s: string) => void;
}) {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  const [address, setAddress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      bridge?.onShortcut((shortcut) => {
        if (shortcut === "address") {
          input.current?.focus();
          input.current?.select();
        }
      }),
    [],
  );
  useEffect(
    () => setAddress(tab?.url === "about:blank" ? "" : tab?.url || ""),
    [tab?.url, tab?.id],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!bridge) {
      onError("Browsing is available in the Jevry desktop app.");
      return;
    }
    try {
      await bridge.navigate(address);
      input.current?.blur();
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <div className="browser-toolbar">
      <div className="navigation-buttons">
        <IconButton
          label="Go back"
          disabled={!tab?.canGoBack}
          onClick={() => void bridge?.browserAction("back")}
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Go forward"
          disabled={!tab?.canGoForward}
          onClick={() => void bridge?.browserAction("forward")}
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label={tab?.loading ? "Stop loading" : "Reload page"}
          onClick={() =>
            void bridge?.browserAction(tab?.loading ? "stop" : "reload")
          }
        >
          {tab?.loading ? <X /> : <RefreshCw size={15} />}
        </IconButton>
      </div>
      <form className="address-bar" onSubmit={go}>
        <LockKeyhole size={13} />
        <input
          ref={input}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Search or enter a URL"
          aria-label="Search or enter a URL"
          spellCheck={false}
        />
        <kbd>{state.platform === "darwin" ? "⌘" : "Ctrl"} L</kbd>
      </form>
      <IconButton
        label="Capture page snapshot"
        onClick={onCapture}
        disabled={capturing || !tab || tab.url === "about:blank"}
      >
        {capturing ? <LoaderCircle className="spin" /> : <Camera size={17} />}
      </IconButton>
    </div>
  );
}
function BrowserPane({
  state,
  hidden,
  onError,
}: {
  state: AppState;
  hidden: boolean;
  onError: (s: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  const blank = !tab || tab.url === "about:blank";
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bridge) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      void bridge.setBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible: !hidden && !blank,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      void bridge.setBounds({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        visible: false,
      });
    };
  }, [hidden, blank]);
  const navigate = async (url: string) => {
    if (!bridge) {
      onError("Open Jevry desktop to browse websites.");
      return;
    }
    try {
      await bridge.navigate(url);
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <div className="browser-pane" ref={ref}>
      {blank && (
        <div className="new-tab-page">
          <div className="new-tab-top">
            <span className="new-tab-wordmark"><Mark size={20} /> jevry</span>
            <span>
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="new-tab-center">
            <div className="new-tab-mark">
              <DisplayMark size={270} />
            </div>
            <h1>Room to explore.</h1>
            <p>Follow your curiosity. Jevry can handle the steps.</p>
            <form
              className="new-tab-search"
              onSubmit={(e) => {
                e.preventDefault();
                void navigate(query);
              }}
            >
              <Search size={19} />
              <input
                aria-label="Search the web"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anything or paste a link…"
              />
              <button aria-label="Go to website" disabled={!query.trim()}>
                <ArrowRight size={20} />
              </button>
            </form>
            <div className="quick-links">
              {[
                { name: "Google", url: "https://www.google.com", letter: "G" },
                {
                  name: "Wikipedia",
                  url: "https://en.wikipedia.org",
                  letter: "W",
                },
                { name: "GitHub", url: "https://github.com", letter: "gh" },
                {
                  name: "Hacker News",
                  url: "https://news.ycombinator.com",
                  letter: "Y",
                },
              ].map((site) => (
                <button key={site.name} onClick={() => void navigate(site.url)}>
                  <span
                    className={`shortcut-icon ${site.letter === "Y" ? "orange" : ""}`}
                  >
                    {site.letter}
                  </span>
                  {site.name}
                  <ArrowRight size={12} />
                </button>
              ))}
            </div>
          </div>
          <div className="new-tab-bottom">
            <span>
              <MousePointer2 size={14} /> Browse yourself. Or let Jevry take the
              wheel.
            </span>
            <span>
              <Keyboard size={14} />{" "}
              {state.platform === "darwin" ? "⌘" : "Ctrl"} L to navigate
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
