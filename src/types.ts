import type { Conversation, ConversationMode } from './conversation-types';
export type Provider = "codex" | "claude" | "openai" | "anthropic";
export type Connection = {
  connected: boolean;
  provider?: Provider;
  model?: string;
  baseUrl?: string;
};
export type Settings = {
  text: Connection;
  jev: Connection;
  onboardingComplete: boolean;
  reducedEffects: boolean;
};
export type Tab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};
export type AgentEvent = {
  type: string;
  message: string;
  timestamp: number;
  elapsedMs: number;
  step?: number;
  durationMs?: number;
  operation?: string;
  target?: string;
  confidence?: number;
  model?: string;
  url?: string;
  verified?: boolean;
};
export type ResearchResult = {
  summary: string;
  findings: Array<{ text: string; sourceIds: string[] }>;
  sources: Array<{ id: string; title: string; url: string }>;
};
export type AppState = {
  historyError?: string;
  connectionError?: string;
  workspaceError?: string;
  conversations: Conversation[];
  activeConversationId: string | null;
  research?: ResearchResult | null;
  settings: Settings;
  tabs: Tab[];
  activeTabId: string | null;
  running: boolean;
  events: AgentEvent[];
  platform: string;
};
export type Result = { ok: boolean; message?: string; [key: string]: unknown };
export interface JevryBridge {
  sendMessage(input: {text: string; mode: ConversationMode; sourceTabIds?:string[]}): Promise<Result>;
  renameConversation(id:string,title:string): Promise<Result>;
  deleteConversation(id:string): Promise<Result>;
  newConversation(): Promise<Result>;
  selectConversation(id: string): Promise<Result>;
  state(): Promise<AppState>;
  status(
    provider: "codex" | "claude",
  ): Promise<{ installed: boolean; authenticated: boolean; message?: string }>;
  connectText(config: {
    provider: Provider;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }): Promise<Result>;
  connectJev(config: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }): Promise<Result>;
  finishSetup(): Promise<Result>;
  disconnect(which: "text" | "jev"): Promise<Result>;
  setEffects(reduced: boolean): Promise<void>;
  newTab(url?: string): Promise<string>;
  closeTab(id: string): Promise<void>;
  selectTab(id: string): Promise<void>;
  navigate(url: string): Promise<void>;
  browserAction(action: "back" | "forward" | "reload" | "stop"): Promise<void>;
  setBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  }): Promise<void>;
  run(goal: string): Promise<Result>;
  research(goal: string): Promise<Result>;
  stop(): Promise<void>;
  screenshot(): Promise<string>;
  exportTrace(): Promise<Result>;
  openExternal(url: string): Promise<void>;
  windowAction(action: "minimize" | "maximize" | "close"): Promise<void>;
  onState(callback: (state: AppState) => void): () => void;
  onEvent(callback: (event: AgentEvent) => void): () => void;
  onShortcut(callback: (shortcut: string) => void): () => void;
  onAuthProgress(callback: (message: string) => void): () => void;
}
declare global {
  interface Window {
    jevry?: JevryBridge;
  }
}
