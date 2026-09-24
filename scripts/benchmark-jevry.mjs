/** Real Jevry desktop + saved real models on the shared source-graph protocol.
 * Requires --run-live; uses a disposable encrypted-settings copy, never raw keys.
 */
import {_electron as electron} from '@playwright/test';
import electronPath from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,copyFile,chmod,readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateSharedTask,citedUrlsFromResearch} from '../tests/benchmarks/firecrawl-evaluate.mjs';
const root=resolve('.');
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const repeat=Number(arg('repeat')||1),selection=arg('tasks')||'all';
if(!process.argv.includes('--run-live'))throw new Error('Pass --run-live to use the saved model connections for bounded real inference.');
if(!Number.isInteger(repeat)||repeat<1||repeat>5)throw new Error('Repeat must be 1–5.');
const output=resolve(arg('output')||'artifacts/jevry-shared-live.json');
const protocol=JSON.parse(await readFile(join(root,'tests/benchmarks/firecrawl-task-protocol.json'),'utf8'));
const fixtures=Object.fromEntries(await Promise.all(Object.entries(protocol.routes).map(async([route,file])=>[route,await readFile(join(root,'tests/benchmarks',file))])));
const server=createServer((req,res)=>{const body=fixtures[new URL(req.url,'http://fixture').pathname];res.writeHead(body?200:404,{'content-type':'text/html'});res.end(body||'Fixture unavailable');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'jevry-shared-'));
const report={generatedAt:new Date().toISOString(),scope:'Actual Jevry Electron runtime and saved real Claude/Jev providers on the shared local fixture protocol. Initial browser launch/navigation excluded; all turn planning, inference, actions and answer generation included.',repetitions:repeat,provider:{},environment:{},sourceHashes:{},buildHashes:{},turns:[],passed:false};
for(const file of ['desktop/main.ts','desktop/chat-model.ts','desktop/conversation.ts','desktop/engine.ts','desktop/snapshot.ts','desktop/providers.ts','desktop/cli-worker.ts','desktop/source-discovery.ts','desktop/research.ts','desktop/page-evidence.ts','desktop/navigation.ts','desktop/native-evaluator.ts'])report.sourceHashes[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
for(const file of ['dist-desktop/main.cjs','dist-desktop/preload.cjs','dist/index.html',...(await readdir('dist/assets')).map(f=>'dist/assets/'+f)])report.buildHashes[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const bounded=async(work,ms)=>{let timer;try{return await Promise.race([work.then(()=>true,()=>false),new Promise(r=>{timer=setTimeout(()=>r(false),ms);})]);}finally{clearTimeout(timer);}};
const safe=text=>String(text||'').replace(/\bsk-[\w-]{8,}/g,'[redacted]').replace(/\bBearer\s+\S+/gi,'Bearer [redacted]');
let app,page;
async function outcome(){return app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);return wc?wc.executeJavaScript('({result:document.querySelector("#results")?.textContent,destination:document.querySelector("#destination")?.value,guests:document.querySelector("#guests")?.value,receipts:window.receipts})'):{};},base+'/fixture');}
try {
 await copyFile(process.env.JEVRY_CONNECTION_SOURCE||join(homedir(), 'Library', 'Application Support', 'Jevry', 'connections.enc'),join(profile,'connections.enc'));await chmod(join(profile,'connections.enc'),0o600);
 const env={...process.env,JEVRY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.JEVRY_DEV_URL;
 app=await electron.launch({args:[root],executablePath:electronPath,env,timeout:30000});page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 report.environment=await app.evaluate(()=>({platform:process.platform,arch:process.arch,versions:{electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}}));
 const status=await page.evaluate(()=>window.jevry.state());report.provider={text:status.settings.text.provider,configuredModel:status.settings.text.model||'CLI default',jev:status.settings.jev.model,effort:'low',claudeMode:'conversation-scoped worker'};
 if(!status.settings.text.connected||!status.settings.jev.connected)throw new Error('Both real model connections must already be saved.');
 await page.evaluate(()=>window.jevry.finishSetup());
 // Browser pages are confined to the shared corpus. Main-process model fetches are unaffected.
 await app.evaluate(({session},origin)=>{session.fromPartition('persist:jevry-browser').webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,done)=>done({cancel:!details.url.startsWith(origin+'/')}));},base);
 for(let trial=1;trial<=repeat;trial++) {
   // Each repetition starts with one page and no sources retained from prior trials.
   await page.evaluate(async()=>{const state=await window.jevry.state();for(const tab of state.tabs.slice(1))await window.jevry.closeTab(tab.id);const remaining=await window.jevry.state();if(remaining.tabs[0])await window.jevry.selectTab(remaining.tabs[0].id);});
   await page.evaluate(url=>window.jevry.navigate(url),base+'/fixture');
   report.environment.viewport=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).executeJavaScript('({width:innerWidth,height:innerHeight,devicePixelRatio})'),base+'/fixture');
   for(const sequence of protocol.sequences) {
     if(selection==='form'&&sequence.id!=='conversation-form'||selection==='research'&&sequence.id!=='source-research')continue;
     await page.evaluate(()=>window.jevry.newConversation());
     let failedDependency;
     for(const task of sequence.turns) {
       if(failedDependency){report.turns.push({repeat:trial,id:task.id,passed:false,status:'skipped-dependent-on-failed-turn',error:failedDependency});continue;}
       const text=task.text.replaceAll('{BASE}',base),started=performance.now();
       const accepted=await page.evaluate(text=>window.jevry.sendMessage({text,mode:'auto'}),text);
       if(!accepted.ok)throw new Error(safe(accepted.message));
       let answer,firstVisibleMs,firstActionMs;
       while(performance.now()-started<150000) {
         const state=await page.evaluate(()=>window.jevry.state());
         const conversation=state.conversations.find(c=>c.id===state.activeConversationId);
         const message=conversation?.messages.find(m=>m.replyTo===accepted.id);
         if(message?.content&&firstVisibleMs===undefined)firstVisibleMs=Math.round(performance.now()-started);
         if(message?.events.some(e=>e.type==='action')&&firstActionMs===undefined)firstActionMs=Math.round(performance.now()-started);
         if(message&&!state.running&&['complete','error','stopped'].includes(message.status)){answer=message;break;}
         await pause(100);
       }
       const browserState=await outcome();
       if(!answer){await page.evaluate(()=>window.jevry.stop());failedDependency='Turn exceeded150seconds';report.turns.push({repeat:trial,id:task.id,passed:false,status:'timeout',durationMs:Math.round(performance.now()-started)});continue;}
       const facts=[answer.content,...answer.research?.findings.map(f=>f.text)||[]].join('\n');
       const actualModel=answer.events.find(e=>e.operation==='PLAN'&&e.model)?.model;if(actualModel)report.provider.resolvedModel=actualModel;
       const actions=answer.events.filter(e=>e.type==='action');const citations=citedUrlsFromResearch(answer.research,answer.content);
       const readUrls=answer.events.filter(e=>e.type==='observation'&&e.operation==='RESEARCH_READ').map(e=>e.url);
       const evaluation=evaluateSharedTask({id:task.id,answer:facts,status:answer.status,browserState,atomicActions:actions,citedUrls:citations,readUrls,base});
       const passed=evaluation.passed;
       const row={repeat:trial,id:task.id,prompt:text,...evaluation,status:answer.status,answer:safe(facts),citations,readUrls,durationMs:Math.round(performance.now()-started),firstVisibleMs,firstActionMs,atomicActions:actions.length,jevCalls:answer.events.filter(e=>e.type==='decision').length,textCalls:answer.events.filter(e=>['PLAN','FIELD_TEXT','ANSWER','SOURCE_SELECT'].includes(e.operation)||e.operation==='RESEARCH_SYNTHESIS'&&e.durationMs!==undefined).length,phases:answer.events.map(e=>({type:e.type,operation:e.operation,message:safe(e.message),elapsedMs:e.elapsedMs,durationMs:e.durationMs,url:e.url})),browserState,error:safe(answer.error)};
       report.turns.push(row);console.log(JSON.stringify({repeat:trial,id:task.id,passed,durationMs:row.durationMs,textCalls:row.textCalls,answer:row.answer,citations}));
       if(answer.status!=='complete')failedDependency=answer.error||'Prior turn failed';
     }
   }
 }
 report.passed=report.turns.length>0&&report.turns.every(t=>t.passed);if(!report.passed)process.exitCode=1;
} catch(error){report.error=safe(error.message);process.exitCode=1;console.log(JSON.stringify({error:report.error}));}
finally {
 // Persist completed observations before native shutdown; failures must survive
 // an app crash or a modal main-process exception during cleanup.
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 const stopped=!page||await bounded(page.evaluate(()=>window.jevry.stop()),5000);
 const closed=!app||await bounded(app.close(),20000);
 report.cleanup={ok:stopped&&closed,stopCompleted:stopped,appClosed:closed};
 if(!closed&&app)app.process().kill('SIGKILL');
 if(!stopped||!closed){report.passed=false;process.exitCode=1;}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(profile,{recursive:true,force:true});
}
