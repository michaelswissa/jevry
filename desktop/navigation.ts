import type {WebContents} from 'electron';
/** DOM readiness is enough to inspect. Slow images/ads must not block the agent. */
export function navigateReady(contents:WebContents,url:string,signal:AbortSignal,timeoutMs=25000,options?:Electron.LoadURLOptions):Promise<void> {
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>{clearTimeout(timer);contents.removeListener('dom-ready',ready);contents.removeListener('did-fail-load',failed);contents.removeListener('destroyed',destroyed);signal.removeEventListener('abort',aborted);};
   const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
   const ready=()=>{if(contents.getURL()!=='about:blank')finish();};
   const failed=(_event:unknown,code:number,description:string,_url:string,main:boolean)=>{if(main&&code!==-3)finish(new Error(`Page navigation failed: ${description}`));};
   const destroyed=()=>finish(new Error('The source tab was closed.'));
   const aborted=()=>{contents.stop();finish(new DOMException('Stopped','AbortError'));};
   const timer=setTimeout(()=>{contents.stop();finish(new Error('The page did not become readable within 25 seconds.'));},timeoutMs);
   contents.on('dom-ready',ready);contents.on('did-fail-load',failed);contents.once('destroyed',destroyed);signal.addEventListener('abort',aborted,{once:true});
   void contents.loadURL(url,options).then(()=>finish(),error=>finish(error instanceof Error?error:new Error('Page navigation failed.')));
 });
}
