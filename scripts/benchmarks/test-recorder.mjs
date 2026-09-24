import {_electron as electron} from '@playwright/test';
import electronPath from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {recordBrowser} from './record-browser.mjs';
const root=resolve(import.meta.dirname,'../..'),requests=[];
const server=createServer((req,res)=>{
  requests.push({method:req.method,url:req.url});
  if(req.method==='POST'){res.writeHead(303,{location:'/done','set-cookie':'result=actual; Path=/'});res.end();}
  else {res.writeHead(200,{'content-type':'text/html'});res.end(req.url==='/done'?'<p>Actually submitted</p>':'<form action="/submit" method="post"><input name="quantity" value="3"><button>Submit local fixture</button></form>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,profile=await mkdtemp(join(tmpdir(),'jevry-har-check-'));
let app;
try {
 const env={...process.env,JEVRY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.JEVRY_DEV_URL;
 app=await electron.launch({executablePath:electronPath,args:[root],env});const page=await app.firstWindow();
 await page.waitForFunction(()=>typeof window.jevry?.state==='function');await page.evaluate(()=>window.jevry.finishSetup());
 await app.evaluate(recordBrowser,{origins:[origin],authHeaders:{}});
 await page.evaluate(url=>window.jevry.navigate(url),origin+'/');
 await app.evaluate(async({webContents},origin)=>{
   const wc=webContents.getAllWebContents().find(w=>w.getURL()===origin+'/');
   // This checks network recording only, independently of agent choices and UI setup.
   await wc.debugger.sendCommand('Runtime.evaluate',{expression:'document.querySelector("form").requestSubmit()'});
 },origin);
 const deadline=Date.now()+10000;let trace;
 do {trace=await app.evaluate(()=>globalThis.__benchmarkDump());if(trace.har.log.entries.some(e=>e.request.url===origin+'/done'&&e.response.content.text?.includes('Actually submitted')))break;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);
 const entries=trace.har.log.entries,post=entries.find(e=>e.request.method==='POST');
 assert.equal(post.request.postData.text,'quantity=3');assert.equal(post.response.status,303);assert.equal(post.response.redirectURL,'/done');
 assert.ok(post.response.cookies.some(c=>c.name==='result'&&c.value==='actual'));
 assert.ok(entries.some(e=>e.request.url===origin+'/done'&&e.response.status===200&&e.response.content.text.includes('Actually submitted')));
 assert.ok(entries.every(e=>requests.some(r=>r.method===e.request.method&&origin+r.url===e.request.url)),'Every recorded entry must be an actual server request.');
 assert.equal(entries.filter(e=>e._bodyCaptureError).length,0);
 await mkdir(join(root,'artifacts/webarena'),{recursive:true});await writeFile(join(root,'artifacts/webarena/recorder-check.har'),JSON.stringify(trace.har));
 console.log(JSON.stringify({passed:true,checks:['actual POST payload','redirect status and location','response cookie','response body','no invented requests'],entries:entries.length}));
}finally{if(app)await app.close();await rm(profile,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));}
