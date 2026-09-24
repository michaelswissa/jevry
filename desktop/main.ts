import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  dialog,
  session,
} from "electron";
import { join } from "node:path";
import {randomUUID} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Store } from "./store";
import { READ_STATE } from "./snapshot";
import {READ_RESEARCH_PAGE,READ_SOURCE_LINKS} from "./page-evidence";
import { Conversations, type TurnContext } from "./conversation";
import { planTurn, answerTurn, pageStatusAnswer, takePreparedField, reviewTask, type PageEvidence } from "./chat-model";
import {tryJevNavigationPlan} from './jev-navigation-plan';
import {tryJevDirectPlan} from './jev-direct-plan';
import {discoverSources,type DiscoveredPage,type SourceCandidate} from "./source-discovery";
import {navigateReady} from "./navigation";
import {createNativeTransport} from "./native-evaluator";
import {solveChallenge} from "./challenges";
import {OwnedTurnWork} from "./turn-work";
import {OwnedPageNavigation} from './owned-navigation';
import {GameStrategy} from "./game-strategy";
import {numericOcr} from "./numeric-ocr";
import {lookupTaskHelp,type TaskHelpSource} from "./task-help";
import { researchTabs, type ResearchResult } from "./research";
import {
  getProviderStatus,
  installProvider,
  loginProvider,
  stopProviderProcesses,
  validateTextConnection,
  generateFieldText,
  clearProviderSession,
  getProviderDiagnostics,
} from "./providers";
import {
  AgentEngine,
  validateJevConnection,
  type BrowserAdapter,
  type PageState,
} from "./engine";
import type { Tab, AppState, AgentEvent } from "../src/types";

app.setName("Jevry");
if (process.env.JEVRY_TEST_PROFILE)
  app.setPath("userData", process.env.JEVRY_TEST_PROFILE);
let win: BrowserWindow;
let store: Store;
let activeTabId: string | null = null;
let conversations: Conversations;
const tabs = new Map<string, { view: WebContentsView; state: Tab; game?:{key:string;strategy:GameStrategy} }>();
const ownedNavigations = new WeakMap<Electron.WebContents, OwnedPageNavigation>();
let researchResult: ResearchResult | null = null;
let events: AgentEvent[] = [];
let restoringWorkspace = true;
let workspaceTimer: ReturnType<typeof setTimeout> | undefined;
function saveWorkspace() {
  if(workspaceTimer){clearTimeout(workspaceTimer);workspaceTimer=undefined;}
  if(restoringWorkspace||!store||!tabs.size)return;
  const hadFailure=!!store.workspaceError;
  try {
    store.saveWorkspace({tabs:[...tabs.values()].map(t=>({id:t.state.id,url:t.state.url})),activeTabId});
    if(hadFailure)push();
  } catch {push();}
}
function scheduleWorkspaceSave() {
  if(restoringWorkspace||workspaceTimer)return;
  workspaceTimer=setTimeout(saveWorkspace,300);
}
let authBusy = false;
let bounds = { x: 288, y: 100, width: 900, height: 650, visible: false };
function appState(): AppState {
  return {
    historyError: store.historyError,
    connectionError: store.connectionError,
    workspaceError: store.workspaceError,
    ...conversations?.snapshot() ?? {conversations: [], activeConversationId: null},
    research: researchResult,
    settings: store.public(),
    tabs: [...tabs.values()].map((t) => t.state),
    activeTabId,
    running: conversations?.running ?? false,
    events,
    platform: process.platform,
  };
}
function push() {
  if (win && !win.isDestroyed())
    win.webContents.send("jevry:state", appState());
}
function emit(event: any) {
  events = [...events, event].slice(-300);
  if (!win.isDestroyed()) win.webContents.send("jevry:event", event);
}
function safeUrl(input: string) {
  const value = input.trim();
  if (value === "about:blank") return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    try {
      url = new URL(`https://${value}`);
    } catch {
      throw new Error("Enter a valid web address.");
    }
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Only http and https pages can open in browser tabs.");
  return url.href;
}
function address(input: string) {
  const s = input.trim();
  if (!s) return "about:blank";
  if (
    /^https?:\/\//i.test(s) ||
    s === "about:blank" ||
    /^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(s) ||
    /^localhost[:/]/.test(s)
  )
    return safeUrl(s);
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}
function active() {
  const tab = activeTabId && tabs.get(activeTabId);
  if (!tab) throw new Error("Open a tab first.");
  return tab;
}
function layout() {
  for (const [id, t] of tabs) {
    const visible =
      id === activeTabId && bounds.visible && t.state.url !== "about:blank";
    t.view.setVisible(visible);
    t.view.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
  }
}
function refresh(id: string) {
  const tab = tabs.get(id);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const wc = tab.view.webContents;
  Object.assign(tab.state, {
    url: wc.getURL() || tab.state.url,
    title:
      wc.getURL() === "about:blank" ? "New tab" : wc.getTitle() || "New tab",
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  });
  layout();
  push();
  scheduleWorkspaceSave();
}
function newTab(url = "about:blank", restoredId?: string, options:{active?:boolean;load?:boolean;readOnly?:boolean}={}) {
  const id = restoredId || `tab-${randomUUID()}`;
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:jevry-browser",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor("#ffffff");
  const state: Tab = {
    id,
    url: safeUrl(url),
    title: "New tab",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  tabs.set(id, { view, state });
  win.contentView.addChildView(view);
  if(options.active!==false)activeTabId = id;
  const wc = view.webContents;
  if(options.readOnly)wc.audioMuted=true;
  wc.setWindowOpenHandler(details => {
    if(options.readOnly)return {action:"deny"};
    const owner=ownedNavigations.get(wc);
    if(owner)return owner.popup(details);
    try {
      conversations?.stop();
      newTab(safeUrl(details.url));
    } catch {}
    return { action: "deny" };
  });
  const guardNavigation = (event: Electron.Event, target: string) => {
    try {
      safeUrl(target);
    } catch {
      event.preventDefault();
    }
  };
  wc.on("will-navigate", guardNavigation);
  wc.on("will-redirect", guardNavigation);
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const command = process.platform === "darwin" ? input.meta : input.control;
    if (key === "escape") {
      conversations?.stop();
      return;
    }
    if (command && ["l", "t", "w", "r"].includes(key)) {
      event.preventDefault();
      if (key === "l") {
        win.webContents.focus();
        win.webContents.send("jevry:shortcut", "address");
      }
      if (key === "t") {
        newTab();
        win.webContents.focus();
        win.webContents.send("jevry:shortcut", "address");
      }
      if (key === "w") closeTab(id);
      if (key === "r") {
        conversations?.stop();
        wc.reload();
      }
    }
  });
  wc.on("did-start-loading", () => refresh(id));
  wc.on("did-stop-loading", () => refresh(id));
  wc.on("did-navigate", () => refresh(id));
  wc.on("did-navigate-in-page", () => refresh(id));
  wc.on("page-title-updated", () => refresh(id));
  wc.on("did-fail-load", (_e, code, description, _url, main) => {
    if (code !== -3 && main)
      emit({
        type: "error",
        message: `Page could not load: ${description}`,
        timestamp: Date.now(),
        elapsedMs: 0,
      });
  });
  wc.on("render-process-gone", () =>
    emit({
      type: "error",
      message: "This tab stopped responding. Reload it to continue.",
      timestamp: Date.now(),
      elapsedMs: 0,
    }),
  );
  if(options.load!==false)void wc.loadURL(state.url).catch(() => {});
  layout();
  push();
  scheduleWorkspaceSave();
  return id;
}
function closeTab(id: string, stopRun=true) {
  const tab = tabs.get(id);
  if (!tab) return;
  if(stopRun)conversations?.stop();
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  tabs.delete(id);
  if (activeTabId === id) activeTabId = [...tabs.keys()].at(-1) ?? null;
  if (!tabs.size) newTab();
  layout();
  push();
  scheduleWorkspaceSave();
}
const adapters=new WeakMap<WebContentsView,BrowserAdapter>();
function adapter(view: WebContentsView): BrowserAdapter {
  const existing=adapters.get(view);if(existing)return existing;
  const wc = view.webContents;
  const transport=createNativeTransport(wc);
  const result:BrowserAdapter={
    ...transport,
    captureImage:async rect=>({data:(await wc.capturePage(rect)).toPNG().toString('base64')}),
    url: () => wc.getURL(),
    navigate: async (url: string) => {
      await wc.loadURL(safeUrl(url));
    },
  };
  adapters.set(view,result);return result;
}
async function pageEvidence(tab = active(), signal?: AbortSignal): Promise<PageEvidence> {
  signal?.throwIfAborted();
  if(tab.state.url==='about:blank') return {url:'about:blank',title:'New tab',text:''};
  const read=adapter(tab.view).evaluate<PageState & {statuses:string[]}>(`(()=>{const page=${READ_STATE};if(!page)return null;page.statuses=(window.__jevFast?.query('[role="status"],output,[aria-live="polite"],[aria-live="assertive"]')||[]).filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})).map(e=>(e.innerText||'').trim()).filter(s=>s&&s.length<=800).slice(0,8);return page})()`).then(page=> {
    if(!page)throw new Error('The page is still loading. Try again when it is ready.');
    return {title:page.title,url:page.url,text:page.text.slice(0,16000),links:[...new Set(page.actions.flatMap(a=>a.href?[a.href]:[]))],navigationLinks:page.actions.flatMap(a=>a.kind==='click'&&a.href?[{url:a.href,label:a.label}]:[]),tables:page.tables,collections:page.collections,statuses:page.statuses,fields:page.actions.filter(a=>a.kind==='fill').map(a=>({label:a.label,value:a.value}))};
  });
  if(!signal)return read;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Stopped','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    read.then(value=>signal.aborted?abort():resolve(value),reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
function sourcePage(tab:ReturnType<typeof active>,signal:AbortSignal,beforeRead?:()=>Promise<unknown>):DiscoveredPage {
  const read=async<T>(script:string)=>{
    signal.throwIfAborted();
    await beforeRead?.();
    signal.throwIfAborted();
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>reject(new DOMException('Stopped','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      adapter(tab.view).evaluate<T>(script).then(value=>signal.aborted?abort():resolve(value),reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  };
  return {...tab.state,read:()=>read<{title:string;url:string;text:string}>(READ_RESEARCH_PAGE),links:()=>read<SourceCandidate[]>(READ_SOURCE_LINKS)};
}

async function executeTurn(ctx: TurnContext) {
  const verificationWork=new OwnedTurnWork(ctx.signal);
  const navigationWork=new Map<Electron.WebContents,OwnedPageNavigation>();
  try { await executeBrowserTurn(ctx,verificationWork,navigationWork); }
  catch(error) {
    if(ctx.signal.aborted)throw error;
    const handoff=[...ctx.answer.events].reverse().find(item=>item.operation==='CAPTCHA_HANDOFF');
    if(handoff)ctx.update(handoff.message,'complete');
    else throw error;
  } finally {
    await verificationWork.closeAndDrain();
    for(const [contents,owner] of navigationWork) {
      await owner.closeAndDrain();
      if(ownedNavigations.get(contents)===owner)ownedNavigations.delete(contents);
    }
  }
}
async function executeBrowserTurn(ctx: TurnContext,verificationWork:OwnedTurnWork,navigationWork:Map<Electron.WebContents,OwnedPageNavigation>) {
  const textConfig={...store.text!,sessionScope:ctx.conversation.id}, jevConfig=store.jev!, started=Date.now();
  events=[]; researchResult=null;
  const event=(item:AgentEvent)=>{const current={...item,elapsedMs:Date.now()-started};ctx.event(current);if(!ctx.signal.aborted)emit(current);};
  // Source reading can be concurrent, but verification owns one native tab at a time.
  let verificationHandoff:string|undefined;
  let verificationInspectionError:string|undefined;
  let verificationTabId:string|undefined;
  let solvedChallenges=0;
  const verifyPage=(target:ReturnType<typeof active>):Promise<boolean>=>{
    return verificationWork.run(async()=>{
      ctx.signal.throwIfAborted();
      if(verificationHandoff)throw new Error(verificationHandoff);
      const outcome=await solveChallenge(adapter(target.view),textConfig,ctx.signal,event);
      ctx.signal.throwIfAborted();
      if(!outcome.detected){if(outcome.reason){verificationInspectionError=outcome.reason;throw new Error(outcome.reason);}return false;}
      if(outcome.solved) {
        solvedChallenges++;
        if(solvedChallenges<=3)return true;
      }
      verificationHandoff=outcome.reason||'Verification keeps returning. Complete it in the page, then continue the task.';
      verificationTabId=target.state.id;
      activeTabId=target.state.id;
      ctx.answer.tabId=target.state.id;ctx.conversation.tabId=target.state.id;
      layout();push();
      event({type:'blocked',operation:'CAPTCHA_HANDOFF',message:verificationHandoff,url:target.view.webContents.getURL(),timestamp:Date.now(),elapsedMs:0,verified:false});
      throw new Error(verificationHandoff);
    });
  };
  event({type:'run-start',message:ctx.message.content,timestamp:started,elapsedMs:0});
  let tab=active();
  const page=await pageEvidence(tab,ctx.signal);
  ctx.signal.throwIfAborted();
  const planStarted=Date.now();
  const firstOrdinaryTurn=ctx.message.mode!=='research'&&!ctx.conversation.memory&&!ctx.conversation.gameContext&&ctx.conversation.messages.filter(m=>m.role==='user').length===1;
  const fastPlan=firstOrdinaryTurn?await(async()=>{
    const fastSignal=AbortSignal.any([ctx.signal,AbortSignal.timeout(3000)]);
    const input={goal:ctx.message.content,page,jevConfig,signal:fastSignal};
    try{return await tryJevNavigationPlan(input)||await tryJevDirectPlan(input);}
    catch{ctx.signal.throwIfAborted();return undefined;}
  })():undefined;
  const plan=fastPlan||await planTurn(textConfig,ctx,page,[...tabs.values()].map(t=>t.state));
  ctx.signal.throwIfAborted();
  event({type:'status',operation:'PLAN',message:plan.reusedGameContext?'Continuing the current game.':'Understood your request.',model:plan.reusedGameContext?undefined:fastPlan?(jevConfig.model||'jev-latest'):getProviderDiagnostics()?.model,durationMs:Date.now()-planStarted,timestamp:Date.now(),elapsedMs:0});
  ctx.conversation.memory=plan.memory;
  ctx.update(plan.reply,plan.intent==='chat'?'complete':'running');
  if(plan.intent==='chat') return;
  if(!plan.gameMode)ctx.conversation.gameContext=undefined;
  ctx.conversation.lastGoal=plan.goal;
  if(plan.tabId) {activeTabId=plan.tabId;tab=active();layout();push();}
  ctx.answer.tabId=tab.state.id;ctx.conversation.tabId=tab.state.id;
  if(plan.intent==='research') {
    const open=async(url:string,signal:AbortSignal):Promise<DiscoveredPage>=>{
      signal.throwIfAborted();
      const id=newTab(safeUrl(url),undefined,{active:false,load:false,readOnly:true});
      const source=tabs.get(id)!;
      try{await navigateReady(source.view.webContents,safeUrl(url),signal);}catch(error){closeTab(id,false);throw error;}
      signal.throwIfAborted();refresh(id);
      return sourcePage(source,signal,()=>verifyPage(source));
    };
    const existing=[...tabs.values()].filter(t=>/^https?:/.test(t.state.url)).map(t=>sourcePage(t,ctx.signal,()=>verifyPage(t)));
    const sources=await discoverSources({goal:plan.goal,request:plan.research||{queries:[],urls:[],tabIds:[]},existing,sourceTabIds:ctx.message.sourceTabIds,textConfig,signal:ctx.signal,emit:event,open,closeSearch:id=>{if(id!==verificationTabId)closeTab(id,false);}});
    if(verificationHandoff)throw new Error(verificationHandoff);
    const result=await researchTabs({goal:plan.goal,tabs:sources,textConfig,signal:ctx.signal,emit:event});
    if(verificationHandoff)throw new Error(verificationHandoff);
    ctx.signal.throwIfAborted();
    researchResult=result;ctx.answer.research=result;ctx.update(result.summary,'complete');return;
  }
  const navigationOwner=!plan.gameMode?new OwnedPageNavigation(tab.view.webContents,{signal:ctx.signal,allowedOrigins:plan.contract?.allowedOrigins,
    followed:url=>event({type:'status',operation:'NAVIGATION',message:'Following the opened page.',url,timestamp:Date.now(),elapsedMs:0}),
    rejected:()=>event({type:'status',operation:'NAVIGATION_REJECTED',message:'A destination outside the allowed sites was blocked.',timestamp:Date.now(),elapsedMs:0})}):undefined;
  if(navigationOwner){ownedNavigations.set(tab.view.webContents,navigationOwner);navigationWork.set(tab.view.webContents,navigationOwner);}
  const navigation=plan.startUrl || (tab.state.url==='about:blank' ? (plan.goal.match(/https?:\/\/[^\s<>]+/)?.[0] || `https://www.google.com/search?q=${encodeURIComponent(plan.goal)}`) : undefined);
  if(navigation && navigation!==tab.state.url) {
    event({type:'status',message:'Opening the page…',timestamp:Date.now(),elapsedMs:0});
    await navigateReady(tab.view.webContents,navigationOwner?.assertAllowed(safeUrl(navigation))||safeUrl(navigation),ctx.signal);
    ctx.signal.throwIfAborted();
  }
  const preparedFieldsUsed=new Set<string>();
  const helpCache=new Map<string,Promise<TaskHelpSource[]>>();
  const findHelp=(query:string,signal:AbortSignal):Promise<TaskHelpSource[]>=>{
    const cached=helpCache.get(query);if(cached)return cached;
    if(helpCache.size>=2)return Promise.resolve([]);
    const work=(async()=>{
      const owned=new Set<string>();
      event({type:'status',operation:'TASK_HELP',message:'Looking up a guide in the background.',timestamp:Date.now(),elapsedMs:0});
      try {
        return await lookupTaskHelp({query,jevConfig,textConfig,signal,emit:event,
          open:async(url,activeSignal)=>{
            activeSignal.throwIfAborted();
            const id=newTab(safeUrl(url),undefined,{active:false,load:false,readOnly:true});owned.add(id);
            const source=tabs.get(id)!;
            await navigateReady(source.view.webContents,safeUrl(url),activeSignal);activeSignal.throwIfAborted();refresh(id);
            return sourcePage(source,activeSignal);
          },close:id=>{if(owned.delete(id))closeTab(id,false);}});
      } catch(error) {
        signal.throwIfAborted();
        event({type:'status',operation:'TASK_HELP',message:'The guide was unavailable; continuing with the observed page.',timestamp:Date.now(),elapsedMs:0});
        return [];
      } finally {for(const id of owned)closeTab(id,false);}
    })();
    helpCache.set(query,work);return work;
  };
  const gameKey=JSON.stringify([ctx.conversation.id,plan.gameMode,plan.goal,plan.contract,textConfig.provider,textConfig.model]);
  if(plan.gameMode&&tab.game?.key!==gameKey)tab.game={key:gameKey,strategy:new GameStrategy()};
  if(!plan.gameMode)tab.game=undefined;
  tab.game?.strategy.setHelpLookup(findHelp);
  const engineBrowser=adapter(tab.view);
  const engine=new AgentEngine(navigationOwner?.wrap(engineBrowser)||engineBrowser,(e)=>{
    if(e.type!=='run-start')event(e);
    if(e.operation==='GOAL_PROGRESS')ctx.update(e.message,'running');
  },{
    gameStrategy:tab.game?.strategy,
    recoverTask:async(context,signal)=>{
      const activeSignal=signal||ctx.signal;
      const review=await reviewTask(textConfig,context,activeSignal);
      if(!review.helpQuery)return review;
      const externalHelp=await findHelp(review.helpQuery,activeSignal);
      return reviewTask(textConfig,{...context,externalHelp},activeSignal);
    },
    beforeStep:async()=>{
      try{
        const navigated=await navigationOwner?.flush();
        if(navigationOwner?.blockedReason)return {handled:false,blocked:navigationOwner.blockedReason};
        return {handled:await verifyPage(tab)||!!navigated};
      }
      catch(error){if(ctx.signal.aborted)throw error;if(verificationHandoff)return {handled:false,blocked:verificationHandoff};throw error;}
    },
    fieldText:async(config,context,signal)=>{
      const prepared=takePreparedField(plan,page,tab.view.webContents.getURL(),context.field.label,preparedFieldsUsed);
      if(prepared) {
        event({type:'status',operation:'PREPARED_TEXT',message:`Using the requested value for ${context.field.label}.`,timestamp:Date.now(),elapsedMs:0});
        return prepared;
      }
      const began=Date.now();const value=await generateFieldText(config,context,signal);
      event({type:'status',operation:'FIELD_TEXT',message:'Prepared the field value.',durationMs:Date.now()-began,timestamp:Date.now(),elapsedMs:0});
      return value;
    }
  });
  if(plan.gameMode)ctx.conversation.gameContext={mode:plan.gameMode,goal:plan.goal,contract:plan.contract,url:tab.view.webContents.getURL()};
  const result=await engine.run({goal:plan.goal,literalSource:ctx.message.content,contract:plan.contract,gameMode:plan.gameMode,textConfig,jevConfig,signal:ctx.signal});
  ctx.signal.throwIfAborted();
  if(verificationInspectionError){ctx.update(verificationInspectionError,'error');refresh(tab.state.id);return;}
  if(verificationHandoff){ctx.update(verificationHandoff,'complete');refresh(tab.state.id);return;}
  const finalPage=await pageEvidence(tab,ctx.signal).catch(()=>({url:tab.state.url,title:tab.state.title,text:result.page?.text || 'Final page could not be read.'}));
  const directAnswer=pageStatusAnswer(plan,page,finalPage,result);
  if(directAnswer) {
    event({type:'status',operation:'PAGE_STATUS',message:'Read the changed page result.',timestamp:Date.now(),elapsedMs:0});
    ctx.update(directAnswer,'complete');refresh(tab.state.id);return;
  }
  const answerStarted=Date.now();
  const reply=await answerTurn(textConfig,ctx,plan.goal,{...result,page:finalPage,
    timing:{elapsedBeforeAnswerMs:Date.now()-started,executorMs:result.elapsedMs,firstGameInputMs:ctx.answer.events.find(e=>e.type==='action'&&(/^(?:KEY_|POINT$)/.test(e.operation||'')))?.elapsedMs},
    gameReasoning:ctx.answer.events.filter(e=>e.operation==='GAME_REASONING').slice(-4).map(e=>e.message),
    actions:ctx.answer.events.filter(e=>e.type==='action').map(e=>({operation:e.operation,target:e.target,message:e.message}))},undefined,plan.responseFormat);
  event({type:'status',operation:'ANSWER',message:'Answer ready.',durationMs:Date.now()-answerStarted,timestamp:Date.now(),elapsedMs:0});
  ctx.update(reply,result.status==='error'?'error':'complete');
  refresh(tab.state.id);
}
function handle(name: string, fn: (...args: any[]) => any) {
  ipcMain.handle(`jevry:${name}`, async (event, ...args) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted application request.");
    return fn(...args);
  });
}
function installHandlers() {
  handle("state", () => appState());
  handle("status", async (provider) => {
    if (!["codex", "claude"].includes(provider))
      throw new Error("Unknown provider.");
    return getProviderStatus(provider);
  });
  handle("connectText", async (config) => {
    if(store.connectionError)return {ok:false,message:store.connectionError};
    if (authBusy)
      return { ok: false, message: "A connection is already in progress." };
    if (
      !config ||
      !["codex", "claude", "openai", "anthropic"].includes(config.provider)
    )
      return { ok: false, message: "Choose a text provider." };
    authBusy = true;
    try {
      if (config.provider === "codex" || config.provider === "claude") {
        const status = await getProviderStatus(config.provider);
        if (!status.installed)
          await installProvider(config.provider, (message) =>
            win.webContents.send("jevry:authProgress", message),
          );
        if (!status.authenticated)
          await loginProvider(config.provider, (message) =>
            win.webContents.send("jevry:authProgress", message),
          );
        const check = await getProviderStatus(config.provider);
        if (!check.authenticated)
          throw new Error(
            "Sign-in is not complete. Finish in your browser, then reconnect.",
          );
      } else {
        if (typeof config.apiKey !== "string" || !config.apiKey.trim())
          throw new Error("Enter your API key.");
        const check = await validateTextConnection(config);
        if (!check.ok) throw new Error(check.message);
      }
      conversations?.stop();
      await clearProviderSession();
      store.set({
        text: {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model || undefined,
          baseUrl: config.baseUrl || undefined,
        },
      });
      push();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Connection failed. Try again.",
      };
    } finally {
      authBusy = false;
    }
  });
  handle("connectJev", async (config) => {
    if(store.connectionError)return {ok:false,message:store.connectionError};
    try {
      if (!config || typeof config.apiKey !== "string" || !config.apiKey.trim())
        throw new Error("Enter your TypeSafe API key.");
      const next = {
        apiKey: config.apiKey.trim(),
        model: config.model || "jev-latest",
        baseUrl: config.baseUrl || "https://api.typesafe.ai/v1/systemone",
      };
      const result = await validateJevConnection(next);
      store.set({ jev: next });
      push();
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Jev connection failed.",
      };
    }
  });
  handle("finishSetup", () => {
    if (!store.text || !store.jev)
      return { ok: false, message: "Connect both models first." };
    store.set({ onboardingComplete: true });
    if (!tabs.size) newTab();
    push();
    return { ok: true };
  });
  handle("disconnect", async (which) => {
    if (!["text", "jev"].includes(which))
      throw new Error("Unknown connection.");
    conversations?.stop();
    await clearProviderSession();
    store.disconnect(which);
    bounds.visible = false;
    layout();
    push();
    return { ok: true };
  });
  handle("setEffects", (reduced) => {
    store.set({ reducedEffects: !!reduced });
    push();
  });
  handle("newTab", (url) => newTab(url ? address(String(url)) : "about:blank"));
  handle("selectTab", (id) => {
    if (!tabs.has(id)) throw new Error("Tab is closed.");
    activeTabId = id;
    layout();
    push();
    scheduleWorkspaceSave();
  });
  handle("closeTab", (id)=>closeTab(id));
  handle("navigate", async (input) => {
    conversations?.stop();
    const tab = active();
    tab.state.url = address(String(input));
    layout();
    await tab.view.webContents.loadURL(tab.state.url).catch(() => {});
  });
  handle("browserAction", (action) => {
    conversations?.stop();
    const wc = active().view.webContents;
    if (action === "back" && wc.navigationHistory.canGoBack())
      wc.navigationHistory.goBack();
    else if (action === "forward" && wc.navigationHistory.canGoForward())
      wc.navigationHistory.goForward();
    else if (action === "reload") wc.reload();
    else if (action === "stop") wc.stop();
  });
  handle("setBounds", (next) => {
    if (
      !next ||
      !["x", "y", "width", "height"].every((key) => Number.isFinite(next[key]))
    )
      return;
    const [w, h] = win.getContentSize();
    bounds = {
      x: Math.max(0, Math.min(w, Math.round(next.x))),
      y: Math.max(0, Math.min(h, Math.round(next.y))),
      width: Math.max(1, Math.min(w, Math.round(next.width))),
      height: Math.max(1, Math.min(h, Math.round(next.height))),
      visible: !!next.visible,
    };
    layout();
  });
  const sendMessage = (input: {text: string; mode?: 'auto'|'act'|'research';sourceTabIds?:string[]}) => {
    if (!store.text || !store.jev) return {ok:false,message:'Connect both models in Settings first.'};
    if(Array.isArray(input?.sourceTabIds)&&input.sourceTabIds.some(id=>!tabs.has(id)))return {ok:false,message:'A selected source tab has closed.'};
    return conversations.send(input);
  };
  handle('sendMessage', sendMessage);
  handle('newConversation', () => conversations.newConversation());
  handle('renameConversation',(id,title)=>conversations.rename(id,title));
  handle('deleteConversation',async id=>{const result=conversations.delete(id);if(result.ok)await clearProviderSession(id);return result;});
  handle('selectConversation', (id) => {
    const result=conversations.select(String(id));
    const tabId=conversations.active()?.tabId;
    if(result.ok&&tabId&&tabs.has(tabId)){activeTabId=tabId;layout();push();}
    return result;
  });
  handle('run', (text) => sendMessage({text,mode:'act'}));
  handle('research', (text) => sendMessage({text,mode:'research'}));
  handle('stop', () => conversations.stop());
  handle("screenshot", async () => {
    const image = await active().view.webContents.capturePage();
    return image.toDataURL();
  });
  handle("exportTrace", async () => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `jevry-run-${Date.now()}.json`,
      filters: [{ name: "JSON trace", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await writeFile(
      result.filePath,
      JSON.stringify(
        {
          app: "Jevry",
          version: app.getVersion(),
          events,
          research: researchResult,
          conversation: conversations.active(),
        },
        null,
        2,
      ),
    );
    return { ok: true };
  });
  handle("openExternal", async (url) => {
    const parsed = new URL(url);
    const hosts = [
      "developers.openai.com",
      "learn.chatgpt.com",
      "code.claude.com",
      "docs.typesafe.ai",
      "typesafe.ai",
      "app.typesafe.ai",
      "libraries.dev",
    ];
    if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname))
      throw new Error("Unsupported external link.");
    await shell.openExternal(parsed.href);
  });
  handle("windowAction", (action) => {
    if (action === "minimize") win.minimize();
    else if (action === "maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
  });
}
async function createWindow() {
  process.env.JEVRY_TOOLS_DIR = join(app.getPath("userData"), "tools");
  store = new Store();
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 950,
    minHeight: 660,
    title: "Jevry",
    backgroundColor: "#171918",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 20 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  session
    .fromPartition("persist:jevry-browser")
    .setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
  session
    .fromPartition("persist:jevry-browser")
    .setPermissionCheckHandler(() => false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  conversations = new Conversations(store.loadConversations(), executeTurn, data=>store.saveConversations(data), push);
  installHandlers();
  if (process.env.JEVRY_DEV_URL) await win.loadURL(process.env.JEVRY_DEV_URL);
  else await win.loadFile(join(__dirname, "../dist/index.html"));
  const workspace=store.loadWorkspace();
  for(const tab of workspace.tabs)newTab(tab.url,tab.id);
  if(!tabs.size)newTab();
  if(workspace.activeTabId&&tabs.has(workspace.activeTabId))activeTabId=workspace.activeTabId;
  restoringWorkspace=false;layout();push();
  win.on('close',saveWorkspace);
  win.on("resize", layout);
  win.on("closed", () => {
    conversations?.stop();
    for (const t of tabs.values())
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    tabs.clear();
  });
}
app.whenReady().then(createWindow);
app.on("before-quit", () => {
  void numericOcr.close();
  saveWorkspace();
  conversations?.stop();
  stopProviderProcesses();
});
app.on("window-all-closed", () => app.quit());
