// Native Electron integration using owned local fixtures and intercepted provider
// frame URLs. No external CAPTCHA service or live model is contacted.
import {_electron as electron,expect} from '@playwright/test';
import electronPath from 'electron';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const profile=await mkdtemp(join(tmpdir(),'jevry-challenge-smoke-'));
let visionCalls=0,jevCalls=0,expectOpaqueBackdrop=false;
const observations=[];
const fixture=(kind)=>{
const hcaptcha=kind==='hcaptcha';
const transparent=kind==='transparent',width=kind==='vision'||transparent?280:304;
const source=kind==='manual'?'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/fixture':hcaptcha?'https://newassets.hcaptcha.com/captcha/v1/local/static/hcaptcha.html#frame=checkbox&size=normal':`https://www.google.com/recaptcha/api2/anchor?k=jevry-local-fixture${transparent?'&transparent=1':''}`;
return `<!doctype html><title>Verification fixture</title><style>body{font:16px sans-serif;margin:28px}iframe{border:0;display:block}textarea{display:none}</style>
<h1>Local verification test</h1><form onsubmit="event.preventDefault();window.submits++;document.querySelector('output').textContent='Task finished exactly '+window.submits+' time(s)'">
${transparent?'<div style="position:relative;width:280px;height:78px"><div style="position:absolute;inset:0;background:rgb(255,0,255)">PRIVATE underlying host content</div>':''}
<iframe title="${kind==='manual'?'Security verification':hcaptcha?'hCaptcha':'reCAPTCHA'}" width="${width}" height="78" src="${source}" ${transparent?'style="position:relative;z-index:1"':''}></iframe>
${transparent?'</div>':''}
<textarea name="${hcaptcha?'h-captcha-response':'g-recaptcha-response'}"></textarea><button>Complete task</button><output role="status">Verification required</output></form>
<script>window.submits=0;window.fixtureMessages=[];window.addEventListener('message',event=>{window.fixtureMessages.push({origin:event.origin,data:event.data});if(event.origin==='${hcaptcha?'https://newassets.hcaptcha.com':'https://www.google.com'}'&&event.data==='fixture-verified')setTimeout(()=>{document.querySelector('textarea').value='local-fixture-only';document.querySelector('output').textContent='Verification accepted';},${kind==='delayed'?2000:0});});</script>`;
};
const server=createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('content-type','text/html');res.end(fixture(req.url==='/manual-source'?'manual':req.url==='/visual-source'?'vision':req.url.slice(1)));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  res.setHeader('content-type','application/json');
  if(req.url.includes('systemone')) {
    jevCalls++;
    const done=body.state?.page?.text?.includes('Task finished');
    const operation=done?'DONE':'CLICK';
    const answers={};
    for(const [key,question] of Object.entries(body.questions)) {
      const ids=Object.keys(question.criteria);
      const selected=key==='web_action'?ids.find(id=>{
        const choice=question.criteria[id];
        return choice.operation===operation&&(operation==='DONE'||choice.element?.includes('Complete task'));
      }):key==='operation'?operation:key==='click_target'?ids.find(id=>JSON.stringify(question.criteria[id]).includes('Complete task'))||ids[0]:ids[0];
      assert(selected&&ids.includes(selected),'Fixture must select a currently offered complete action');
      answers[key]={choice:selected,confidence:1,probabilities:Object.fromEntries(ids.map(id=>[id,id===selected?1:0]))};
    }
    res.end(JSON.stringify({model:'fixture',answers}));return;
  }
  const content=body.messages.at(-1).content;
  const prompt=Array.isArray(content)?content.filter(part=>part.type==='text').map(part=>part.text).join('\n'):content;
  let answer='{"ok":true}';
  if(Array.isArray(content)) {
    visionCalls++;
    const image=content.find(part=>part.type==='image_url');
    assert(image?.image_url?.url.startsWith('data:image/png;base64,'));
    const png=Buffer.from(image.image_url.url.split(',')[1],'base64');
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
    observations.push({width,height,bytes:png.length});
    if(expectOpaqueBackdrop){
      const sample=await app.evaluate(({nativeImage},url)=>{const img=nativeImage.createFromDataURL(url),size=img.getSize(),bitmap=img.getBitmap();const offset=(Math.floor(size.height*.8)*size.width+Math.floor(size.width*.85))*4;return [...bitmap.subarray(offset,offset+4)];},image.image_url.url);
      assert.deepEqual(sample,[255,255,255,255],'Transparent child must show the owned white background, never underlying private host pixels');
      observations.at(-1).opaqueBackdropSample=sample;
    }
    answer=JSON.stringify({action:'click',x:Math.round(width*28/280),y:Math.round(height*37/78)});
  } else if(prompt.includes('JEVRY_CONVERSATION_PLAN')) {
    answer=prompt.includes('Research visual verification fixture')?JSON.stringify({intent:'research',reply:'I’ll read the local visual source.',goal:'Read the visual verification fixture.',research:{urls:[base+'/visual-source'],queries:[],tabIds:[],followLinks:false}}):prompt.includes('Research verification fixture')?JSON.stringify({intent:'research',reply:'I’ll read the local source.',goal:'Read the verification fixture.',research:{urls:[base+'/manual-source'],queries:[],tabIds:[],followLinks:false}}):JSON.stringify({intent:'act',reply:'I’ll complete the local task.',goal:'Complete verification, then click Complete task once.',replyFromPageStatus:true});
  } else if(prompt.includes('AUTHORITATIVE_SOURCE_IDS')) {
    const pages=JSON.parse(prompt.split('UNTRUSTED_PAGE_OBSERVATIONS_JSON: ')[1]);
    answer=JSON.stringify({summary:`The local source was read [${pages[0].id}].`,findings:pages.map(page=>({text:page.text.slice(0,200),sourceIds:[page.id]}))});
  } else if(prompt.includes('JEVRY_CONVERSATION_ANSWER'))answer=JSON.stringify({reply:'The local task is finished.'});
  res.end(JSON.stringify({choices:[{message:{content:answer},finish_reason:'stop'}]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let app;let mainStderr='';
try {
  const env={...process.env,JEVRY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.JEVRY_DEV_URL;
  app=await electron.launch({args:process.env.JEVRY_PACKAGED_EXECUTABLE?[]:[resolve('.')],executablePath:process.env.JEVRY_PACKAGED_EXECUTABLE||electronPath,env});
  app.process().stderr.on('data',chunk=>{mainStderr+=chunk.toString();});
  await app.evaluate(()=>process.on('uncaughtExceptionMonitor',error=>process.stderr.write('JEVRY_UNCAUGHT '+error.stack+'\n')));
  const ui=await app.firstWindow();await ui.waitForLoadState('domcontentloaded');
  await ui.waitForFunction(()=>typeof window.jevry?.state==='function');
  await app.evaluate(({session})=>{
    session.fromPartition('persist:jevry-browser').protocol.handle('https',request=>{
      const url=new URL(request.url);
      if(url.hostname==='www.google.com'&&url.pathname==='/recaptcha/api2/anchor'||url.hostname==='newassets.hcaptcha.com')return new Response(`<!doctype html><style>html{background:transparent}body{margin:0;background:${url.searchParams.has('transparent')?'transparent':'#fafafa'};font:14px sans-serif}button{position:absolute;left:15px;top:24px;width:26px;height:26px}span{position:absolute;left:53px;top:30px}</style><button aria-label="Verify" onclick="parent.postMessage('fixture-verified','*');this.style.background='#a6dfab'"></button><span>I am a local fixture</span>`,{headers:{'content-type':'text/html'}});
      if(url.hostname==='challenges.cloudflare.com')return new Response('<!doctype html><p>Manual verification fixture</p>',{headers:{'content-type':'text/html'}});
      return new Response('External network disabled in this test',{status:403});
    });
  });
  assert((await ui.evaluate(base=>window.jevry.connectText({provider:'openai',apiKey:'fixture',baseUrl:base+'/v1'}),base)).ok);
  assert((await ui.evaluate(base=>window.jevry.connectJev({apiKey:'fixture',baseUrl:base+'/v1/systemone'}),base)).ok);
  assert((await ui.evaluate(()=>window.jevry.finishSetup())).ok);
  const state=()=>ui.evaluate(()=>window.jevry.state());
  const last=async()=>{const s=await state();return s.conversations.find(c=>c.id===s.activeConversationId).messages.at(-1);};
  const finish=async()=>{await expect.poll(()=>state().then(s=>s.running),{timeout:15000}).toBe(false);return last();};
  const send=async()=>{assert((await ui.evaluate(()=>window.jevry.sendMessage({text:'Complete the local task',mode:'act'}))).ok);return finish();};
  const native=async(path,expression)=>app.evaluate(async({webContents},{url,expression})=>{
    const page=webContents.getAllWebContents().find(w=>w.getURL()===url);
    if(!page)throw new Error('Fixture page is missing');return page.executeJavaScript(expression);
  },{url:base+path,expression});

  await ui.evaluate(url=>window.jevry.navigate(url),base+'/checkbox');
  await app.evaluate(({webContents},url)=>{
    globalThis.__challengeProtocolErrors=[];
    const debug=webContents.getAllWebContents().find(w=>w.getURL()===url).debugger;
    const original=debug.sendCommand.bind(debug);
    debug.sendCommand=async(method,params,...rest)=>{
      try{return await original(method,params,...rest);}
      catch(error){globalThis.__challengeProtocolErrors.push({method,params:method==='DOM.getNodeForLocation'?params:undefined,error:error.message});throw error;}
    };
  },base+'/checkbox');
  let result=await send();
  assert.equal(result.status,'complete',JSON.stringify(result));
  assert(result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify({result,protocolErrors:await app.evaluate(()=>globalThis.__challengeProtocolErrors)}));
  assert.equal(await native('/checkbox','window.submits'),1);
  assert.equal(visionCalls,0,'Recognized standard checkbox should not require visual inference');

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/delayed');
  await app.evaluate(({webContents},url)=>{
    const debug=webContents.getAllWebContents().find(w=>w.getURL()===url).debugger,original=debug.sendCommand.bind(debug);
    globalThis.__delayedChallenge={captures:0,checkboxPresses:0};
    globalThis.__restoreDelayedChallenge=()=>{debug.sendCommand=original;};
    debug.sendCommand=(method,params,...rest)=>{
      if(method==='Page.captureScreenshot')globalThis.__delayedChallenge.captures++;
      if(method==='Input.dispatchMouseEvent'&&params?.type==='mousePressed'&&rest[0])globalThis.__delayedChallenge.checkboxPresses++;
      return original(method,params,...rest);
    };
  },base+'/delayed');
  const delayedStarted=performance.now();
  try{
    result=await send();
    assert.equal(result.status,'complete',result.error);
    assert(result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify(result));
    assert(!result.events.some(event=>event.operation==='CAPTCHA_HANDOFF'),JSON.stringify(result));
    assert(performance.now()-delayedStarted>=1900,'Fixture must delay completion past the previous early-handoff window');
    assert.equal(await native('/delayed','window.fixtureMessages.filter(message=>message.data==="fixture-verified").length'),1);
    assert.equal(await native('/delayed','window.submits'),1);
    assert.equal(visionCalls,0,'Waiting for the provider must not call vision');
    assert.deepEqual(await app.evaluate(()=>globalThis.__delayedChallenge),{captures:2,checkboxPresses:1});
    assert.deepEqual(await native('/delayed',"[document.querySelector('iframe').style.getPropertyValue('background-color'),document.querySelector('iframe').style.getPropertyValue('background-clip')]"),['','']);
  }finally{await app.evaluate(()=>globalThis.__restoreDelayedChallenge());}

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/hcaptcha');
  result=await send();
  assert(result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify(result));
  assert.equal(await native('/hcaptcha','window.submits'),1);
  assert.equal(visionCalls,0,'Native hCaptcha checkbox should not require visual inference');

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/vision');
  result=await send();
  assert.equal(result.status,'complete',result.error);
  assert(result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify(result));
  assert.equal(await native('/vision','window.submits'),1);
  assert.equal(visionCalls,1,'Nonstandard checkbox uses one cropped image request');
  assert(observations[0].width<=1120&&observations[0].height<=312,'Image is cropped to widget, including supported DPR scaling');

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/transparent');
  const sampleUnderlying=()=>app.evaluate(async({webContents,nativeImage},url)=>{
    const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);
    const rect=await wc.executeJavaScript('document.querySelector("iframe").getBoundingClientRect().toJSON()');
    const capture=await wc.capturePage({x:Math.floor(rect.x),y:Math.floor(rect.y),width:rect.width,height:rect.height});
    const img=nativeImage.createFromBuffer(capture.toPNG()),size=img.getSize(),bitmap=img.getBitmap();
    const offset=(Math.floor(size.height*.8)*size.width+Math.floor(size.width*.85))*4;return [...bitmap.subarray(offset,offset+4)];
  },base+'/transparent');
  const originalHostSample=await sampleUnderlying();
  assert(originalHostSample[0]>=250&&originalHostSample[1]<=5&&originalHostSample[2]>=250&&originalHostSample[3]===255,'Fixture must actually expose the private host background through the transparent child');
  expectOpaqueBackdrop=true;
  try{result=await send();}finally{expectOpaqueBackdrop=false;}
  assert(result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify(result));
  assert.equal(await native('/transparent','window.submits'),1);
  assert.deepEqual(await native('/transparent',"[document.querySelector('iframe').style.getPropertyValue('background-color'),document.querySelector('iframe').style.getPropertyValue('background-clip')]"),['','']);
  assert.deepEqual(await sampleUnderlying(),originalHostSample,'Host background must be restored after the solve');

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/redirected-frame');
  await app.evaluate(async({webContents},url)=>{
    const page=webContents.getAllWebContents().find(w=>w.getURL()===url);
    await page.mainFrame.frames[0].executeJavaScript("location.replace('https://untrusted.fixture/private')");
  },base+'/redirected-frame');
  await expect.poll(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(w=>w.getURL()===url).mainFrame.frames[0]?.url,base+'/redirected-frame')).toBe('https://untrusted.fixture/private');
  assert.match(await native('/redirected-frame',"document.querySelector('iframe').src"),/www\.google\.com/);
  await app.evaluate(({webContents},url)=>{
    const debug=webContents.getAllWebContents().find(w=>w.getURL()===url).debugger,original=debug.sendCommand.bind(debug);
    globalThis.__redirectedCaptureCount=0;
    globalThis.__restoreRedirectInstrumentation=()=>{debug.sendCommand=original;};
    debug.sendCommand=(method,params,...rest)=>{if(method==='Page.captureScreenshot')globalThis.__redirectedCaptureCount++;return original(method,params,...rest);};
  },base+'/redirected-frame');
  const beforeRedirect={visionCalls,jevCalls};
  try{
    result=await send();assert(result.events.some(event=>event.operation==='CAPTCHA_HANDOFF'));
    assert.deepEqual({visionCalls,jevCalls},beforeRedirect);
    assert.equal(await app.evaluate(()=>globalThis.__redirectedCaptureCount),0,'Internally redirected frame must not be captured');
    assert.equal(await native('/redirected-frame','window.submits'),0);
  }finally{await app.evaluate(()=>globalThis.__restoreRedirectInstrumentation());}

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/manual');
  const before={visionCalls,jevCalls};
  result=await send();
  assert(result.events.some(event=>event.operation==='CAPTCHA_HANDOFF'));
  assert.equal(await native('/manual','window.submits'),0);
  assert.deepEqual({visionCalls,jevCalls},before,'Unsupported verification must block normal inference and mutation');
  await expect(ui.getByRole('button',{name:'Continue task',exact:true})).toBeVisible();
  // Simulate completion on our owned fixture, never a real provider response.
  await native('/manual',"document.querySelector('iframe').remove();document.querySelector('output').textContent='Manual fixture verification completed'");
  await ui.getByRole('button',{name:'Continue task',exact:true}).click();
  result=await finish();
  assert.equal(result.status,'complete',result.error);
  assert.equal(await native('/manual','window.submits'),1);

  await ui.evaluate(()=>window.jevry.newConversation());
  const beforeResearch={visionCalls,jevCalls};
  assert((await ui.evaluate(()=>window.jevry.sendMessage({text:'Research verification fixture',mode:'research'}))).ok);
  result=await finish();
  assert(result.events.some(event=>event.operation==='CAPTCHA_HANDOFF'));
  const researchState=await state(),source=researchState.tabs.find(tab=>tab.url===base+'/manual-source');
  assert(source,'Blocked research source remains available');
  assert.equal(researchState.activeTabId,source.id,'Blocked source is brought forward for manual verification');
  assert.equal(result.tabId,source.id);
  assert.deepEqual({visionCalls,jevCalls},beforeResearch);

  await ui.evaluate(()=>window.jevry.newConversation());
  const beforeVisualResearch={visionCalls,jevCalls,activeTabId:(await state()).activeTabId};
  await app.evaluate(({app,BrowserWindow},url)=>{
    globalThis.__backgroundChallenge={inspections:[],captures:0,inputs:0};
    const created=(_event,wc)=>{
      const debug=wc.debugger,original=debug.sendCommand.bind(debug);
      debug.sendCommand=(method,params,...rest)=>{
        if(!wc.isDestroyed()&&wc.getURL()===url){
          if(method==='Page.captureScreenshot')globalThis.__backgroundChallenge.captures++;
          if(method.startsWith('Input.'))globalThis.__backgroundChallenge.inputs++;
          if(method==='Runtime.evaluate'&&params?.expression?.includes('/* jev:challenge */')){
            const view=BrowserWindow.getAllWindows().flatMap(w=>w.contentView.children).find(v=>v.webContents===wc);
            globalThis.__backgroundChallenge.inspections.push({visible:view?.getVisible()});
          }
        }
        return original(method,params,...rest);
      };
    };
    app.on('web-contents-created',created);globalThis.__restoreBackgroundChallenge=()=>app.removeListener('web-contents-created',created);
  },base+'/visual-source');
  try{
    assert((await ui.evaluate(()=>window.jevry.sendMessage({text:'Research visual verification fixture',mode:'research'}))).ok);
    result=await finish();
  }finally{await app.evaluate(()=>globalThis.__restoreBackgroundChallenge());}
  const visualResearchState=await state(),visualSource=visualResearchState.tabs.find(tab=>tab.url===base+'/visual-source');
  assert(visualSource,'Visual research source remains available');
  assert.equal(await native('/visual-source','window.submits'),0,'Research must not submit the task form');
  assert.equal(jevCalls,beforeVisualResearch.jevCalls,'Reading a source must not invoke ordinary action planning');
  assert(!result.events.some(event=>event.operation==='CHALLENGE_ACCEPTED'),JSON.stringify(result));
  assert(result.events.some(event=>event.operation==='CAPTCHA_HANDOFF'),JSON.stringify(result));
  assert.match(result.content,/entire verification challenge into view/);
  assert.equal(visionCalls,beforeVisualResearch.visionCalls,'Hidden source with insufficient viewport must not send image data');
  const background=await app.evaluate(()=>globalThis.__backgroundChallenge);
  assert(background.inspections.length>0&&background.inspections.every(item=>item.visible===false),'The verification inspector must run in an actually hidden native view');
  assert.equal(background.captures,0,'Unsafe hidden viewport must not be captured');
  assert.equal(background.inputs,0,'Unresolved hidden challenge must not receive input');
  assert.notEqual(visualSource.id,beforeVisualResearch.activeTabId);
  assert.equal(visualResearchState.activeTabId,visualSource.id,'Unresolved hidden source is brought forward for manual verification');
  assert.equal(result.status,'complete',result.error);
  assert.equal(result.research,undefined,'A handoff must not fabricate completed source research');
  assert.equal(await native('/visual-source',"Boolean(document.querySelector('textarea').value)"),false);

  await ui.evaluate(()=>window.jevry.newConversation());
  await ui.evaluate(url=>window.jevry.navigate(url),base+'/inspection-error');
  await app.evaluate(({webContents},url)=>{
    const debug=webContents.getAllWebContents().find(w=>w.getURL()===url).debugger,original=debug.sendCommand.bind(debug);
    globalThis.__restoreChallengeInspection=()=>{debug.sendCommand=original;};
    debug.sendCommand=(method,params,...rest)=>method==='Runtime.evaluate'&&params?.expression?.includes('/* jev:challenge */')?Promise.reject(new Error('Fixture challenge inspection failure')):original(method,params,...rest);
  },base+'/inspection-error');
  const beforeInspectionError={visionCalls,jevCalls};
  try{
    result=await send();assert.equal(result.status,'error');assert.match(result.content,/inspect this page|verification challenges/i);
    assert.equal(await native('/inspection-error','window.submits'),0);
    assert.deepEqual({visionCalls,jevCalls},beforeInspectionError,'Failed inspection must not fall through into normal action execution');
  }finally{await app.evaluate(()=>globalThis.__restoreChallengeInspection());}
  for(const tab of (await state()).tabs)await ui.evaluate(id=>window.jevry.closeTab(id),tab.id);
  await ui.evaluate(()=>window.jevry.state());
  assert(!/JEVRY_UNCAUGHT|Object has been destroyed|Uncaught Exception/.test(mainStderr),mainStderr);
  console.log(JSON.stringify({ok:true,checks:['native reCAPTCHA and hCaptcha checkbox through attested OOPIF sessions','two-second delayed provider response uses one checkbox click and zero vision calls','native cropped vision with coordinate scaling','transparent OOPIF hides underlying host pixels and restores background','verified widget acceptance before task action','internally redirected iframe is never captured or acted on','unsupported challenge blocks inference and input','visible continuation preserves one task submission','blocked research tab is retained and shown','hidden research challenge safely hands off without capture, input, or false completion','failed inspection blocks ordinary actions','observed tabs close without uncaught errors'],visionCalls,observations,scope:'Owned local fixtures, intercepted provider URLs, deterministic models; no real CAPTCHA success claim'},null,2));
}finally {
  if(app)await app.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}
