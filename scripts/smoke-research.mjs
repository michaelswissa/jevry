// Actual Electron source acquisition and cancellation with deterministic local models.
// Complements real-provider benchmark results; this is integration evidence only.
import {_electron as electron,expect} from '@playwright/test';
import electronPath from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.'),profile=await mkdtemp(join(tmpdir(),'jevry-research-smoke-'));
const routes=JSON.parse(await readFile('tests/benchmarks/firecrawl-task-protocol.json','utf8')).routes;
const pages=Object.fromEntries(await Promise.all(Object.entries(routes).map(async([route,file])=>[route,await readFile(join('tests/benchmarks',file),'utf8')])));
const syntheses=[],requests=[];let pendingRequested=false,imageRequested=false;
const server=createServer(async(req,res)=>{
 if(req.method==='GET') {
   requests.push(req.url);res.setHeader('content-type','text/html');
   if(req.url==='/pending'){pendingRequested=true;return;}
   if(req.url==='/hanging-image'){imageRequested=true;return;}
   if(req.url==='/slow'){res.setHeader('content-security-policy',"default-src 'self'; script-src 'none'");res.end('<title>Slow image source</title><h1>Readable before images finish</h1><p>Cancellation is free until 24 hours before check-in.</p><img src="/hanging-image">');return;}
   res.end(pages[req.url]||'<title>Empty fixture</title>Empty fixture');return;
 }
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);res.setHeader('content-type','application/json');
 if(req.url.includes('systemone')){res.end(JSON.stringify({model:'fixture',answers:Object.fromEntries(Object.entries(body.questions).map(([k,q])=>{const first=Object.keys(q.criteria)[0];return [k,{choice:first,confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(id=>[id,id===first?1:0]))}];}))}));return;}
 const prompt=body.messages.at(-1).content;let content='{"ok":true}';
 if(prompt.includes('JEVRY_CONVERSATION_PLAN')) {
   const context=JSON.parse(prompt.split('CONVERSATION_JSON: ')[1].split('\nOPEN_TABS_JSON:')[0]);const task=context.messages.at(-1).content;
   const path=task.includes('slow')?'/slow':task.includes('cancel')?'/pending':'/sources';
   content=JSON.stringify({reply:'I’ll read the requested sources.',intent:'research',goal:task,research:{urls:[base+path],queries:[],tabIds:[],followLinks:path==='/sources'}});
 } else if(prompt.includes('AUTHORITATIVE_SOURCE_IDS')) {
   const observations=JSON.parse(prompt.split('UNTRUSTED_PAGE_OBSERVATIONS_JSON: ')[1]);syntheses.push(observations);
   content=JSON.stringify({summary:`The observed policies are ready [${observations[0].id}].`,findings:observations.map(p=>({text:p.text.slice(0,200),sourceIds:[p.id]}))});
 } else if(prompt.includes('JEVRY_SOURCE_SELECTION'))throw new Error('Small supplied indexes should not require ranking');
 res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let app;
try {
 const env={...process.env,JEVRY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.JEVRY_DEV_URL;
 app=await electron.launch({args:process.env.JEVRY_PACKAGED_EXECUTABLE?[]:[root],executablePath:process.env.JEVRY_PACKAGED_EXECUTABLE||electronPath,env});const ui=await app.firstWindow();await ui.waitForLoadState('domcontentloaded');
 await ui.waitForFunction(()=>typeof window.jevry?.state==='function');
 let mainStderr='';app.process().stderr.on('data',chunk=>{mainStderr=(mainStderr+chunk.toString()).slice(-50000);});
 await app.evaluate(()=>{globalThis.__jevrySmokeErrors=[];process.on('uncaughtExceptionMonitor',error=>globalThis.__jevrySmokeErrors.push(String(error)));});
 const errors=[];ui.on('pageerror',e=>errors.push(e.message));
 assert((await ui.evaluate(base=>window.jevry.connectText({provider:'openai',apiKey:'fixture-key',baseUrl:base+'/v1'}),base)).ok);
 assert((await ui.evaluate(base=>window.jevry.connectJev({apiKey:'fixture-key',baseUrl:base+'/v1/systemone'}),base)).ok);
 assert((await ui.evaluate(()=>window.jevry.finishSetup())).ok);
 await ui.evaluate(url=>window.jevry.navigate(url),base+'/fixture');
 const original=await ui.evaluate(()=>window.jevry.state().then(s=>s.activeTabId));
 const send=async(text,sourceTabIds)=>{
   const accepted=await ui.evaluate(input=>window.jevry.sendMessage(input),{text,mode:'research',sourceTabIds});assert(accepted.ok,accepted.message);
   await expect.poll(()=>ui.evaluate(()=>window.jevry.state().then(s=>s.running)),{timeout:12000}).toBe(false);
   const state=await ui.evaluate(()=>window.jevry.state());const answer=state.conversations.find(c=>c.id===state.activeConversationId).messages.at(-1);assert.equal(answer.status,'complete',answer.error);return {state,answer};
 };
 const discovered=await send('Compare linked policies');
 assert.equal(discovered.state.activeTabId,original,'Background reading should retain the current page');
 assert.deepEqual(discovered.answer.research.sources.map(s=>new URL(s.url).pathname).sort(),['/cedar','/orbit','/sources']);
 assert(syntheses.at(-1).some(s=>s.text.includes('120')));assert(syntheses.at(-1).some(s=>s.text.includes('95')));
 const cedar=discovered.state.tabs.find(t=>t.url===base+'/cedar'),beforeScope=requests.length;
 const scoped=await send('Compare only the selected policy',[cedar.id]);
 assert.deepEqual(scoped.answer.research.sources.map(s=>s.url),[base+'/cedar']);assert.equal(requests.length,beforeScope,'Explicit source scope forbids model-proposed discovery');
 await ui.evaluate(id=>window.jevry.closeTab(id),cedar.id);
 const closed=await ui.evaluate(sourceTabIds=>window.jevry.sendMessage({text:'Read closed source',mode:'research',sourceTabIds}),[cedar.id]);assert.equal(closed.ok,false);assert.match(closed.message,/closed/);
 const slowStarted=performance.now();const slow=await send('Read the slow source');
 assert(imageRequested);assert(performance.now()-slowStarted<10000,'DOM readiness must not wait for a stalled image');
 assert(slow.answer.research.findings[0].text.includes('Readable before images finish'));
 const slowNative=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url)?.isLoading(),base+'/slow');assert.equal(slowNative,true,'Stalled subresource should still be pending when answer completes');
 const beforeCancel=syntheses.length;const accepted=await ui.evaluate(()=>window.jevry.sendMessage({text:'Read cancel source',mode:'research'}));assert(accepted.ok);
 await expect.poll(()=>pendingRequested).toBe(true);
 await ui.evaluate(()=>window.jevry.stop());
 await expect.poll(()=>ui.evaluate(()=>window.jevry.state().then(s=>s.running)),{timeout:3000}).toBe(false);
 const stopped=await ui.evaluate(()=>window.jevry.state());assert.equal(stopped.conversations.find(c=>c.id===stopped.activeConversationId)?.messages.at(-1)?.status,'stopped');
 assert.equal(syntheses.length,beforeCancel,'Canceled navigation must not reach synthesis');
 assert(!stopped.tabs.some(t=>t.url===base+'/pending'),'Canceled owned source tab must close');
 const id=stopped.activeConversationId;assert((await ui.evaluate(id=>window.jevry.renameConversation(id,'Policy research'),id)).ok);
 assert((await ui.evaluate(id=>window.jevry.deleteConversation(id),id)).ok);
 assert(!(await ui.evaluate(()=>window.jevry.state())).conversations.some(c=>c.id===id));
 const observedTabs=(await ui.evaluate(()=>window.jevry.state())).tabs;
 for(const tab of observedTabs)await ui.evaluate(id=>window.jevry.closeTab(id),tab.id);
 assert.equal((await ui.evaluate(()=>window.jevry.state())).tabs.length,1,'Closing all observed tabs must leave a usable replacement');
 assert.deepEqual(await app.evaluate(()=>globalThis.__jevrySmokeErrors),[]);
 assert(!/Object has been destroyed|Uncaught (?:Exception|Error)/i.test(mainStderr),mainStderr);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['observed-link discovery in native background tabs','source texts and citations','authoritative source scope','closed source rejection','DOM-ready reading despite stalled image','cancel drains native navigation and removes owned tab','rename and delete through IPC','multiple observed tabs close without native exceptions'],provider:'deterministic local models; no live quality claim'},null,2));
}finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
