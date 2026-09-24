import type {WebContents} from 'electron';

const WORLD_NAME='jevry-page-evidence';
const CONTEXT_WAIT_MS=1000;
type Context={id:number;uniqueId:string;name:string;auxData?:{frameId?:string;isDefault?:boolean;type?:string}};
type World={frame:string;loader:string;context:Context};

/** App-owned scripts only. Never retry an evaluation: it may have changed the page. */
export function createNativeTransport(wc:WebContents) {
  // Native WebContents getters throw once its destroyed event fires. Retain the
  // emitter while it is alive so teardown never reads wc.debugger again.
  const debuggerSession=wc.debugger;
  const contexts=new Map<number,Context>();
  const pending=new Set<{id:number;resolve:(context:Context)=>void;reject:(error:Error)=>void}>();
  let world:World|undefined;
  let ready=false;
  let generation=0;
  let preparing:Promise<void>|undefined;
  let destroyed=false;
  function invalidate(message:string) {
    generation++;
    world=undefined;
    contexts.clear();
    for(const waiter of [...pending])waiter.reject(new Error(message));
  }
  const detach=()=>{ready=false;invalidate('Browser debugger detached.');};
  const message=(_event:unknown,method:string,params:Record<string,any>,sessionId?:string)=>{
    if(sessionId)return;
    if(method==='Runtime.executionContextCreated') {
      const context=params.context as Context;
      // Only our named isolated worlds are useful; do not retain page metadata.
      if(context?.name!==WORLD_NAME||!context.uniqueId)return;
      contexts.set(context.id,context);
      for(const waiter of [...pending])if(waiter.id===context.id)waiter.resolve(context);
    } else if(method==='Runtime.executionContextDestroyed') {
      const id=params.executionContextId as number;
      const unique=params.executionContextUniqueId as string|undefined;
      const context=contexts.get(id);
      if(context&&(!unique||context.uniqueId===unique))contexts.delete(id);
      if(world&&(world.context.uniqueId===unique||(!unique&&world.context.id===id)))world=undefined;
      for(const waiter of [...pending])if(waiter.id===id)waiter.reject(new Error('Page context was destroyed.'));
    } else if(method==='Runtime.executionContextsCleared')invalidate('Page contexts changed.');
  };
  debuggerSession.on('message',message);
  debuggerSession.on('detach',detach);
  wc.once('destroyed',()=>{
    destroyed=true;
    ready=false;
    invalidate('Browser tab was closed.');
    debuggerSession.removeListener('message',message);
    debuggerSession.removeListener('detach',detach);
  });
  async function prepare() {
    if(destroyed||wc.isDestroyed())throw new Error('Browser tab was closed.');
    if(ready&&debuggerSession.isAttached())return;
    if(preparing)return preparing;
    const setup=(async()=>{
      if(!debuggerSession.isAttached()) {
        invalidate('Browser debugger reattached.');
        debuggerSession.attach('1.3');
      }
      const expected=generation;
      // Subscribe before creating worlds; the unique ID is only in this event.
      await debuggerSession.sendCommand('Runtime.enable');
      await debuggerSession.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      if(destroyed||!debuggerSession.isAttached()||generation!==expected)throw new Error('Page context changed during browser setup.');
      ready=true;
    })();
    preparing=setup;
    try{await setup;}finally{if(preparing===setup)preparing=undefined;}
  }
  async function cdp(method:string,params:Record<string,unknown>={},sessionId?:string) {
    await prepare();
    return sessionId ? debuggerSession.sendCommand(method,params,sessionId) : debuggerSession.sendCommand(method,params);
  }
  function contextFor(id:number):Promise<Context> {
    const existing=contexts.get(id);
    if(existing)return Promise.resolve(existing);
    return new Promise((resolve,reject)=>{
      const finish=(error?:Error,context?:Context)=>{
        clearTimeout(timer);
        pending.delete(waiter);
        if(error)reject(error);else resolve(context!);
      };
      const waiter={id,resolve:(context:Context)=>finish(undefined,context),reject:(error:Error)=>finish(error)};
      const timer=setTimeout(()=>finish(new Error('The browser did not report an isolated page context.')),CONTEXT_WAIT_MS);
      pending.add(waiter);
    });
  }
  async function evaluate<T>(expression:string):Promise<T> {
    // Electron executeJavaScript waits for load; CDP also works at DOM-ready.
    const {frameTree}=await cdp('Page.getFrameTree');
    const frame=frameTree.frame;
    let current=world;
    if(!current||current.frame!==frame.id||current.loader!==frame.loaderId) {
      const expected=generation;
      const {executionContextId}=await cdp('Page.createIsolatedWorld',{frameId:frame.id,worldName:WORLD_NAME});
      const context=await contextFor(executionContextId);
      if(generation!==expected||context.name!==WORLD_NAME||context.auxData?.frameId!==frame.id||context.auxData?.isDefault!==false||context.auxData?.type!=='isolated')throw new Error('The browser returned a different page context.');
      const latest=(await cdp('Page.getFrameTree')).frameTree.frame;
      if(latest.id!==frame.id||latest.loaderId!==frame.loaderId)throw new Error('The page navigated before evaluation.');
      current={frame:frame.id,loader:frame.loaderId,context};
      world=current;
    }
    // Numeric context IDs can be reused after a renderer process swap. A unique
    // ID makes that race fail instead of running the expression in another world.
    const response=await cdp('Runtime.evaluate',{
      expression,uniqueContextId:current.context.uniqueId,returnByValue:true,awaitPromise:true,
      includeCommandLineAPI:false,userGesture:false,allowUnsafeEvalBlockedByCSP:false,
    });
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text||'Page evaluation failed.');
    if(!response.result||response.result.objectId)throw new Error('The page returned a value that could not be copied.');
    return response.result.value as T;
  }
  return {evaluate,cdp};
}
