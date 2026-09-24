import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Settings, Provider } from "../src/types";
import type { ConversationSnapshot } from '../src/conversation-types';
export type PrivateConfig = {
  provider: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};
type Stored = {
  text?: PrivateConfig;
  jev?: { apiKey: string; model: string; baseUrl: string };
  onboardingComplete?: boolean;
  reducedEffects?: boolean;
};
export type Workspace = {tabs:Array<{id:string;url:string}>;activeTabId:string|null};
function archiveError(label:string,file:string) {
  return `Saved ${label} could not be opened. The original ${file} has been preserved and replacement saves are blocked. Unlock your system credential store, check file permissions, and restart Jevry. If the archive is damaged, restore a backup or back it up and move it aside before restarting to start fresh.`;
}
function validConnections(value:any): value is Stored {
  const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value))return false;
  if(value.text!==undefined&&(!object(value.text)||!['codex','claude','openai','anthropic'].includes(value.text.provider)||
    ['apiKey','model','baseUrl'].some(key=>value.text[key]!==undefined&&typeof value.text[key]!=='string')))return false;
  if(value.jev!==undefined&&(!object(value.jev)||['apiKey','model','baseUrl'].some(key=>typeof value.jev[key]!=='string')))return false;
  return ['onboardingComplete','reducedEffects'].every(key=>value[key]===undefined||typeof value[key]==='boolean');
}
function workspaceRecord(raw:any):Workspace {
  if(!raw||!Array.isArray(raw.tabs)||
    (raw.activeTabId!==undefined&&raw.activeTabId!==null&&typeof raw.activeTabId!=='string'))throw new Error('The workspace contains invalid tab records.');
  if(raw.tabs.length>64)throw new Error('The workspace supports up to 64 saved tabs. Close some tabs before saving.');
  const ids=new Set<string>();
  const tabs=raw.tabs.map((tab:any)=>{
    if(typeof tab?.id!=='string'||!tab.id||typeof tab.url!=='string'||ids.has(tab.id))throw new Error('The workspace contains invalid or duplicate tab records.');
    const url=new URL(tab.url);
    if(!['http:','https:'].includes(url.protocol)&&tab.url!=='about:blank')throw new Error('The workspace contains an unsupported tab URL.');
    ids.add(tab.id);return {id:tab.id,url:tab.url};
  });
  return {tabs,activeTabId:ids.has(raw.activeTabId)?raw.activeTabId:null};
}
export class Store {
  private data: Stored = {};
  private file: string;
  private conversationLoadFailure?: string;
  private connectionLoadFailure?: string;
  private workspaceLoadFailure?: string;
  private workspaceSaveFailure?: string;
  private workspaceLoaded = false;
  constructor() {
    this.file = join(app.getPath("userData"), "connections.enc");
    let archiveRead=false;
    try {
      const raw = readFileSync(this.file);
      archiveRead=true;
      if (!safeStorage.isEncryptionAvailable())throw new Error('System credential store unavailable.');
      const parsed=JSON.parse(safeStorage.decryptString(raw));
      if(!validConnections(parsed))throw new Error('Invalid connection archive.');
      this.data=parsed;
    } catch (error) {
      if(archiveRead||(error as NodeJS.ErrnoException).code!=='ENOENT')this.connectionLoadFailure=archiveError('model connections','connections.enc');
    }
  }
  get text() {
    return this.data.text;
  }
  get jev() {
    return this.data.jev;
  }
  loadConversations(): ConversationSnapshot {
    try {
      const raw = readFileSync(join(app.getPath('userData'), 'conversations.enc'));
      if (raw.length > 50_000_000) throw new Error('Conversation archive is too large.');
      const parsed = JSON.parse(safeStorage.decryptString(raw));
      if (!Array.isArray(parsed.conversations) || parsed.conversations.some((c:any)=>
        typeof c?.id!=='string'||typeof c.title!=='string'||typeof c.memory!=='string'||!Array.isArray(c.messages)||
        c.messages.some((m:any)=>typeof m?.id!=='string'||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!Array.isArray(m.events))
      )) throw new Error('Invalid conversation archive.');
      return parsed;
    } catch (error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT') this.conversationLoadFailure='Saved conversations could not be opened. The original archive has been preserved. Unlock your system credential store and restart Jevry.';
      return {conversations: [], activeConversationId: null};
    }
  }
  get historyError() {return this.conversationLoadFailure;}
  get connectionError() {return this.connectionLoadFailure;}
  get workspaceError() {return this.workspaceLoadFailure||this.workspaceSaveFailure;}
  saveConversations(snapshot: ConversationSnapshot) {
    if(this.conversationLoadFailure)throw new Error(this.conversationLoadFailure);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock your system credential store to save conversations.');
    const file = join(app.getPath('userData'), 'conversations.enc');
    mkdirSync(app.getPath('userData'), {recursive: true});
    writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(snapshot)), {mode: 0o600});
    renameSync(file + '.tmp', file);
  }
  loadWorkspace(): Workspace {
    this.workspaceLoaded=true;
    let archiveRead=false;
    try {
      const encrypted=readFileSync(join(app.getPath('userData'),'workspace.enc'));
      archiveRead=true;
      if(!safeStorage.isEncryptionAvailable())throw new Error('System credential store unavailable.');
      const raw=JSON.parse(safeStorage.decryptString(encrypted));
      return workspaceRecord(raw);
    } catch(error){
      if(archiveRead||(error as NodeJS.ErrnoException).code!=='ENOENT')this.workspaceLoadFailure=archiveError('workspace tabs','workspace.enc');
      return {tabs:[],activeTabId:null};
    }
  }
  saveWorkspace(workspace: Workspace) {
    if(!this.workspaceLoaded)this.loadWorkspace();
    if(this.workspaceLoadFailure)throw new Error(this.workspaceLoadFailure);
    try {
      if(!safeStorage.isEncryptionAvailable())throw new Error('Unlock your system credential store to save workspace tabs.');
      const next=workspaceRecord(workspace);
      const file=join(app.getPath('userData'),'workspace.enc');
      mkdirSync(app.getPath('userData'),{recursive:true});
      writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(next)),{mode:0o600});
      renameSync(file+'.tmp',file);
      this.workspaceSaveFailure=undefined;
    } catch(error) {
      const reason=error instanceof Error?error.message:'Check available disk space and file permissions.';
      this.workspaceSaveFailure=`Workspace tabs could not be saved. ${reason} Your open tabs remain available; retry after resolving the error.`;
      throw new Error(this.workspaceSaveFailure);
    }
  }
  public(): Settings {
    return {
      text: {
        connected: !!this.data.text,
        provider: this.data.text?.provider,
        model: this.data.text?.model,
        baseUrl: this.data.text?.baseUrl,
      },
      jev: {
        connected: !!this.data.jev,
        model: this.data.jev?.model,
        baseUrl: this.data.jev?.baseUrl,
      },
      onboardingComplete: !!this.data.onboardingComplete,
      reducedEffects: !!this.data.reducedEffects,
    };
  }
  set(patch: Partial<Stored>) {
    if(this.connectionLoadFailure)throw new Error(this.connectionLoadFailure);
    if (!safeStorage.isEncryptionAvailable())
      throw new Error(
        "Your system credential store is unavailable. Unlock it and try again.",
      );
    const next = { ...this.data, ...patch };
    if(!validConnections(next))throw new Error('The connection settings are invalid. Reconnect the affected model and try again.');
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(
      this.file + ".tmp",
      safeStorage.encryptString(JSON.stringify(next)),
      { mode: 0o600 },
    );
    renameSync(this.file + ".tmp", this.file);
    this.data = next;
  }
  disconnect(which: "text" | "jev") {
    this.set({ [which]: undefined, onboardingComplete: false });
  }
}
