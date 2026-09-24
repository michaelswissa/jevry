import {describe,it,expect,vi} from 'vitest';
import type {BrowserAdapter,AgentEvent} from './engine';
import {solveChallenge} from './challenges';

const config={provider:'openai' as const,apiKey:'fixture'};
const noWait=async()=>{};
function png(width=200,height=120,revision=0){const bytes=Buffer.alloc(25);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);bytes[24]=revision;return bytes.toString('base64');}
function fake(){
  const state:any={region:{id:1,provider:'recaptcha',kind:'image',signature:'doc-frame-rect',sourceUrl:'https://www.google.com/recaptcha/api2/bframe',rect:{x:20,y:30,width:200,height:120},captureRect:{x:20,y:30,width:200,height:120},standardCheckbox:false,opaqueBackdrop:true},completion:{recaptcha:{key:'same-widget',present:false}},hit:true};
  const commands:Array<{method:string;params?:Record<string,unknown>}>=[],events:AgentEvent[]=[];
  let captures=0;
  const hooks:{capture?:(n:number)=>string;release?:()=>void;press?:()=>void}={};
  const browser:BrowserAdapter={
    evaluate:async<T>(expression:string)=>expression.startsWith('/* jev:challenge-backdrop */')?true as T:structuredClone(state) as T,
    cdp:async(method,params)=>{commands.push({method,params});if(method==='DOM.getNodeForLocation')return {frameId:'provider-frame'};if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'provider-frame',url:state.region?.sourceUrl}}};if(method==='Page.captureScreenshot')return {data:hooks.capture?.(++captures)||png()};if(params?.type==='mousePressed')hooks.press?.();if(params?.type==='mouseReleased')hooks.release?.();return {};},
    url:()=> 'https://fixture.test/',navigate:async()=>{},
  };
  const infer=vi.fn(async()=>JSON.stringify({action:'click',x:50,y:60}));
  const run=(signal=new AbortController().signal)=>solveChallenge(browser,config,signal,e=>events.push(e),{infer,wait:noWait});
  return {state,commands,events,hooks,browser,infer,run,input:()=>commands.filter(c=>c.method==='Input.dispatchMouseEvent')};
}
function checkbox(){const f=fake();f.state.region.kind='checkbox';f.state.region.standardCheckbox=true;f.state.region.rect={x:20,y:30,width:304,height:78};f.state.region.captureRect={...f.state.region.rect};f.hooks.capture=()=>png(304,78);return f;}

describe('bounded verification assistance',()=>{
  it('leaves ordinary pages alone',async()=>{const f=fake();delete f.state.region;expect(await f.run()).toEqual({detected:false,solved:false});expect(f.infer).not.toHaveBeenCalled();});
  it('retries read-only inspection through a navigation race without dispatching input',async()=>{
    const f=fake();let calls=0;f.browser.evaluate=async<T>()=>{if(++calls<3)throw new Error('Page contexts changed.');return {completion:{}} as T;};
    expect(await f.run()).toEqual({detected:false,solved:false});expect(calls).toBe(3);expect(f.input()).toEqual([]);expect(f.infer).not.toHaveBeenCalled();
  });
  it('does not re-solve an existing completed checkbox or claim new success',async()=>{const f=fake();f.state.region.kind='checkbox';f.state.completion.recaptcha.present=true;expect(await f.run()).toEqual({detected:false,solved:false});expect(f.commands).toEqual([]);expect(f.events).toEqual([]);});
  it('requires an initially false response on the same widget for success',async()=>{const f=fake();f.hooks.release=()=>f.state.completion.recaptcha.present=true;expect(await f.run()).toEqual({detected:true,solved:true});expect(f.input()).toHaveLength(3);expect(f.events.at(-1)).toMatchObject({operation:'CHALLENGE_ACCEPTED',verified:true});});
  it('does not accept an unrelated or replacement response field',async()=>{const f=fake();f.hooks.release=()=>f.state.completion.recaptcha={key:'different-widget',present:true};expect(await f.run()).toMatchObject({detected:true,solved:false});expect(f.events.some(e=>e.verified)).toBe(false);});
  it('does not accept disappearance without a response',async()=>{const f=fake();f.hooks.release=()=>delete f.state.region;expect(await f.run()).toMatchObject({detected:true,solved:false,reason:expect.stringContaining('without a confirmed')});});
  it('rejects out-of-region coordinates and multiple points',async()=>{
    for(const value of [{action:'click',x:200,y:40},{action:'click',x:-1,y:40},{action:'click',x:20,y:40,points:[{x:20,y:40}]}]){const f=fake();f.infer.mockResolvedValue(JSON.stringify(value));expect(await f.run()).toMatchObject({solved:false});expect(f.input()).toEqual([]);}
  });
  it('does not click stale screenshots and bounds model attempts to three',async()=>{const f=fake();f.hooks.capture=n=>png(200,120,n);const result=await f.run();expect(result).toMatchObject({solved:false,reason:expect.stringContaining('Larger or changing image grids')});expect(f.infer).toHaveBeenCalledTimes(3);expect(f.input()).toEqual([]);});
  it('revalidates the region after inference',async()=>{const f=fake();f.infer.mockImplementation(async()=>{f.state.region.signature+='changed';return '{"action":"click","x":50,"y":60}';});expect(await f.run()).toMatchObject({solved:false});expect(f.input()).toEqual([]);});
  it('never sends a captured image if the crop is covered during capture',async()=>{const f=fake();f.hooks.capture=()=>{delete f.state.region;f.state.blocking='covered';return png();};expect(await f.run()).toMatchObject({solved:false,reason:'covered'});expect(f.infer).not.toHaveBeenCalled();});
  it('maps high-density screenshot pixels back to viewport input coordinates',async()=>{const f=fake();f.hooks.capture=()=>png(400,240);f.infer.mockResolvedValue('{"action":"click","x":100,"y":120}');f.hooks.release=()=>f.state.completion.recaptcha.present=true;await f.run();expect(f.input()[0].params).toMatchObject({x:70,y:90});});
  it('uses a standard checkbox without a model request',async()=>{const f=fake();f.state.region.kind='checkbox';f.state.region.standardCheckbox=true;f.state.region.rect={x:20,y:30,width:304,height:78};f.state.region.captureRect={...f.state.region.rect};f.hooks.capture=()=>png(304,78);f.hooks.release=()=>f.state.completion.recaptcha.present=true;expect(await f.run()).toMatchObject({solved:true});expect(f.infer).not.toHaveBeenCalled();expect(f.input()[0].params).toMatchObject({x:48,y:67});});
  it('waits at most ten seconds for a pending checkbox without more captures, input, or inference',async()=>{
    vi.useFakeTimers();try{
      const f=checkbox(),pending=solveChallenge(f.browser,config,new AbortController().signal,e=>f.events.push(e),{infer:f.infer});
      await vi.advanceTimersByTimeAsync(10001);
      expect(await pending).toMatchObject({solved:false,reason:expect.stringContaining('after 10 seconds')});
      expect(f.input().filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
      expect(f.commands.filter(c=>c.method==='Page.captureScreenshot')).toHaveLength(2);
      expect(f.infer).not.toHaveBeenCalled();expect(f.events.some(e=>e.verified)).toBe(false);
    }finally{vi.useRealTimers();}
  });
  it('rejects a replaced response field or shifted checkbox during passive waiting',async()=>{
    for(const change of [(f:ReturnType<typeof fake>)=>f.state.completion.recaptcha={key:'replacement',present:true},(f:ReturnType<typeof fake>)=>f.state.region.signature+='shifted']){
      const f=checkbox();
      expect(await solveChallenge(f.browser,config,new AbortController().signal,e=>f.events.push(e),{infer:f.infer,wait:async()=>{change(f);}})).toMatchObject({solved:false,reason:expect.stringContaining('changed')});
      expect(f.events.some(e=>e.verified)).toBe(false);expect(f.infer).not.toHaveBeenCalled();
      expect(f.input().filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
    }
  });
  it('hands off if the pending checkbox document navigates internally',async()=>{
    const f=checkbox();let navigated=false;const original=f.browser.cdp;
    f.browser.cdp=async(method,params)=>method==='Page.getFrameTree'&&navigated?{frameTree:{frame:{id:'provider-frame',url:'https://untrusted.test/'}}}:original(method,params);
    expect(await solveChallenge(f.browser,config,new AbortController().signal,()=>{},{infer:f.infer,wait:async()=>{navigated=true;}})).toMatchObject({solved:false});
    expect(f.infer).not.toHaveBeenCalled();expect(f.commands.filter(c=>c.method==='Page.captureScreenshot')).toHaveLength(2);
    expect(f.input().filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
  });
  it('cancels a pending vision answer before any click',async()=>{const f=fake(),controller=new AbortController();f.infer.mockImplementation(async()=>{controller.abort();return '{"action":"click","x":50,"y":60}';});await expect(f.run(controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(f.input()).toEqual([]);});
  it('releases the pointer if cancellation arrives after mouse-down',async()=>{const f=fake(),controller=new AbortController();f.hooks.press=()=>controller.abort();await expect(f.run(controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(f.input().map(c=>c.params?.type)).toEqual(['mouseMoved','mousePressed','mouseReleased']);});
  it('stops waiting for an unresponsive provider at the thirty-second deadline',async()=>{vi.useFakeTimers();try{const f=fake();f.infer.mockImplementation((_config:any,_prompt:any,_image:any,signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));const pending=f.run();await vi.advanceTimersByTimeAsync(30001);expect(await pending).toMatchObject({solved:false,reason:expect.stringContaining('30-second')});expect(f.input()).toEqual([]);}finally{vi.useRealTimers();}});
  it('routes an attested out-of-process frame locally and detaches its owned session',async()=>{
    const f=fake();f.state.region.localCoordinates=true;
    const original=f.browser.cdp,routed:Array<any>=[];
    f.browser.cdp=async(method,params,sessionId)=>{
      routed.push({method,params,sessionId});
      if(method==='DOM.getNodeForLocation')return {frameId:'root',backendNodeId:99};
      if(method==='DOM.describeNode')return {node:{nodeName:'IFRAME',frameId:'child',attributes:['src',f.state.region.sourceUrl]}};
      if(method==='Target.getTargets')return {targetInfos:[{type:'iframe',targetId:'child',parentFrameId:'root',url:f.state.region.sourceUrl}]};
      if(method==='Target.attachToTarget')return {sessionId:'owned-child-session'};
      if(method==='Page.getFrameTree')return {frameTree:{frame:sessionId?{id:'child',loaderId:'child-document',url:f.state.region.sourceUrl}:{id:'root',loaderId:'root-document',url:'https://fixture.test/'}}};
      return original(method,params,sessionId);
    };
    f.hooks.release=()=>f.state.completion.recaptcha.present=true;
    expect(await f.run()).toMatchObject({solved:true});
    expect(routed.filter(c=>c.method==='Input.dispatchMouseEvent')).toEqual(expect.arrayContaining([expect.objectContaining({sessionId:'owned-child-session',params:expect.objectContaining({x:50,y:60})})]));
    expect(routed.at(-1)).toMatchObject({method:'Target.detachFromTarget',params:{sessionId:'owned-child-session'}});
  });
});

// All pages and provider URLs are intercepted locally. No external CAPTCHA or
// model request is executed; these fixtures exercise Chromium isolation/input.
async function fixture(options:{kind?:'recaptcha'|'hcaptcha';overlay?:boolean;translucent?:boolean;transparentChild?:boolean;sameOrigin?:boolean;invisible?:boolean;completed?:boolean;scroll?:boolean;image?:boolean;reject?:boolean;responseDelayMs?:number;imageDelayMs?:number;replaceResponse?:boolean},check:(browser:BrowserAdapter,page:any,calls:Array<any>)=>Promise<void>){
  const {chromium}=await import('@playwright/test');
  const browser=await chromium.launch({headless:true,executablePath:process.env.JEVRY_BROWSER_EXECUTABLE||undefined});
  try{
    const context=await browser.newContext({viewport:{width:900,height:650},deviceScaleFactor:2});
    const provider=options.kind||'recaptcha';
    const frameUrl=provider==='recaptcha'?`https://www.google.com/recaptcha/api2/anchor?size=${options.invisible?'invisible':'normal'}`:`https://newassets.hcaptcha.com/captcha/v1/test/static/hcaptcha.html#frame=checkbox&size=${options.invisible?'invisible':'normal'}`;
    const imageUrl=provider==='recaptcha'?'https://www.google.com/recaptcha/api2/bframe?x=1':'https://newassets.hcaptcha.com/captcha/v1/test/static/hcaptcha.html#frame=challenge';
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='fixture.test'||options.sameOrigin&&url.hostname==='www.google.com'&&url.pathname==='/local-fixture'){
        const top=options.scroll?500:40;
        await route.fulfill({contentType:'text/html',body:`<!doctype html><title>Local verification fixture</title><body style="margin:0;height:1800px;background:rgb(240,0,0)"><form>
          ${options.translucent||options.transparentChild?`<div style="position:absolute;top:${top}px;left:40px;width:304px;height:340px;background:rgb(255,0,255)">PRIVATE underlying page text</div>`:''}
          <iframe id="anchor" src="${frameUrl}" style="position:absolute;top:${top}px;left:40px;width:304px;height:78px;border:0;opacity:${options.translucent?0.5:1}"></iframe>
          ${options.image?`<iframe id="challenge" src="${imageUrl}" style="position:absolute;top:${top+100}px;left:40px;width:304px;height:240px;border:0"></iframe>`:''}
          <textarea hidden name="${provider==='recaptcha'?'g-recaptcha-response':'h-captcha-response'}">${options.completed?'already-present-fixture-value':''}</textarea>
          </form>${options.overlay?`<div style="position:absolute;top:${top}px;left:40px;width:304px;height:78px;background:white;z-index:3">Unrelated private overlay</div>`:''}
          <script>window.fixtureClicks=0;addEventListener('message',e=>{
            if(e.data!=='fixture-accepted')return;window.fixtureClicks++;
            if(${Boolean(options.imageDelayMs)}&&e.source===document.querySelector('#anchor').contentWindow){
              setTimeout(()=>{const image=document.createElement('iframe');image.id='challenge';image.src='${imageUrl}';image.style.cssText='position:absolute;top:${top+100}px;left:40px;width:304px;height:240px;border:0';document.querySelector('form').appendChild(image);},${options.imageDelayMs||0});return;
            }
            if(!${Boolean(options.reject)})setTimeout(()=>{let field=document.querySelector('textarea');if(${Boolean(options.replaceResponse)}){const next=field.cloneNode();field.replaceWith(next);field=next;}field.value='fixture-completion-value';},${options.responseDelayMs||0});
          });</script>`});
      }else if(['www.google.com','newassets.hcaptcha.com'].includes(url.hostname))await route.fulfill({contentType:'text/html',body:`<!doctype html>${options.transparentChild?'<style>html,body{background:transparent!important}</style>':''}<body style="margin:0;background:rgb(0,180,0)"><button style="position:absolute;left:16px;top:22px;width:24px;height:30px" onclick="parent.postMessage('fixture-accepted','*')">✓</button></body>`});
      else await route.abort();
    });
    const page=await context.newPage();await page.goto(options.sameOrigin?'https://www.google.com/local-fixture':'https://fixture.test/');
    if(options.scroll)await page.evaluate(()=>scrollTo(0,400));
    const session=await context.newCDPSession(page);
    const {frameTree}=await session.send('Page.getFrameTree');
    const {executionContextId}=await session.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'jevry-challenge-fixture'});
    const calls:Array<any>=[];
    // BrowserAdapter routes flattened child-session commands in Electron. The
    // Playwright CDPSession API does not accept that third argument, so retain
    // equivalent owned sessions bound to the actual requested iframe target.
    const childSessions=new Map<string,{session:typeof session;frame:ReturnType<typeof page.mainFrame>}>();
    let nextSession=0;
    const adapter:BrowserAdapter={
      evaluate:async<T>(expression:string)=>{const result=await session.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value as T;},
      cdp:async(method,params,sessionId)=>{
        let result:unknown,viewportPoint:{x:number;y:number}|undefined;
        if(method==='Target.attachToTarget'){
          for(const frame of page.frames().filter(frame=>frame.parentFrame())){
            const child=await context.newCDPSession(frame);
            const {targetInfo}=await child.send('Target.getTargetInfo');
            if(targetInfo.targetId!==params?.targetId){await child.detach();continue;}
            const id=`fixture-child-${++nextSession}`;childSessions.set(id,{session:child,frame});result={sessionId:id};break;
          }
          if(!result)throw Error('Requested child target is not an observed fixture frame.');
        }else if(method==='Target.detachFromTarget'){
          const id=String(params?.sessionId),child=childSessions.get(id);
          if(!child)throw Error('Unknown owned child session.');
          await child.session.detach();childSessions.delete(id);result={};
        }else{
          const child=sessionId?childSessions.get(sessionId):undefined;
          if(sessionId&&!child)throw Error('Unknown routed child session.');
          if(method==='Input.dispatchMouseEvent'){
            const box=child?await (await child.frame.frameElement()).boundingBox():{x:0,y:0};
            if(!box)throw Error('Routed frame has no viewport geometry.');
            viewportPoint={x:Number(params?.x)+box.x,y:Number(params?.y)+box.y};
          }
          result=await (child?.session||session).send(method as any,params);
        }
        calls.push({method,params,sessionId,result,viewportPoint});return result;
      },
      url:()=>page.url(),navigate:async url=>{await page.goto(url);},
    };
    await check(adapter,page,calls);
  }finally{await browser.close();}
}

describe.runIf(process.env.JEVRY_BROWSER_TEST==='1')('verification in actual Chromium',()=>{
  it('clicks a locally intercepted reCAPTCHA checkbox and verifies only a new response',async()=>{
    await fixture({},async(browser,page,calls)=>{const infer=vi.fn();const result=await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer});expect(result).toEqual({detected:true,solved:true});expect(infer).not.toHaveBeenCalled();expect(calls.filter(c=>c.method==='Input.dispatchMouseEvent')).toHaveLength(3);expect(await page.locator('textarea').inputValue()).toBe('fixture-completion-value');});
  });
  it('accepts a response delayed by two seconds after one click without additional screenshots or vision',async()=>{
    await fixture({responseDelayMs:2000},async(browser,page,calls)=>{
      const infer=vi.fn(),started=Date.now();
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toEqual({detected:true,solved:true});
      expect(Date.now()-started).toBeGreaterThanOrEqual(1900);
      expect(await page.evaluate(()=>(window as any).fixtureClicks)).toBe(1);
      expect(infer).not.toHaveBeenCalled();
      expect(calls.filter(c=>c.method==='Page.captureScreenshot')).toHaveLength(2);
      expect(calls.filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
      expect(await page.locator('#anchor').evaluate((e:HTMLElement)=>[e.style.getPropertyValue('background-color'),e.style.getPropertyValue('background-clip')])).toEqual(['','']);
    });
  });
  it('waits for a delayed visible image challenge before requesting one visual answer',async()=>{
    await fixture({imageDelayMs:1500},async(browser,page,calls)=>{
      const infer=vi.fn(async(_config:any,_prompt:string,image:{data:string})=>{
        expect(await page.evaluate(()=>(window as any).fixtureClicks)).toBe(1);
        expect(calls.filter(c=>c.method==='Page.captureScreenshot')).toHaveLength(3);
        const png=Buffer.from(image.data,'base64');return JSON.stringify({action:'click',x:Math.round(28*png.readUInt32BE(16)/304),y:Math.round(37*png.readUInt32BE(20)/240)});
      });
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toEqual({detected:true,solved:true});
      expect(infer).toHaveBeenCalledOnce();expect(await page.evaluate(()=>(window as any).fixtureClicks)).toBe(2);
      expect(calls.filter(c=>c.params?.type==='mousePressed')).toHaveLength(2);
    });
  });
  it('cancels the pending checkbox wait and restores its temporary background',async()=>{
    await fixture({responseDelayMs:2000},async(browser,page,calls)=>{
      const infer=vi.fn(),controller=new AbortController();
      const wait=async()=>{
        expect(await page.locator('#anchor').evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
        controller.abort();throw controller.signal.reason;
      };
      await expect(solveChallenge(browser,config,controller.signal,()=>{},{infer,wait})).rejects.toMatchObject({name:'AbortError'});
      expect(infer).not.toHaveBeenCalled();expect(calls.filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
      expect(calls.filter(c=>c.method==='Page.captureScreenshot')).toHaveLength(2);
      expect(await page.locator('#anchor').evaluate((e:HTMLElement)=>[e.style.getPropertyValue('background-color'),e.style.getPropertyValue('background-clip')])).toEqual(['','']);
    });
  });
  it('does not accept a delayed response from a replacement field',async()=>{
    await fixture({responseDelayMs:200,replaceResponse:true},async(browser,_page,calls)=>{
      const infer=vi.fn(),events:AgentEvent[]=[];
      expect(await solveChallenge(browser,config,new AbortController().signal,e=>events.push(e),{infer})).toMatchObject({solved:false,reason:expect.stringContaining('widget changed')});
      expect(infer).not.toHaveBeenCalled();expect(events.some(e=>e.verified)).toBe(false);
      expect(calls.filter(c=>c.params?.type==='mousePressed')).toHaveLength(1);
    });
  });
  it('handles hCaptcha checkbox geometry on a scrolled page at Retina density',async()=>{
    await fixture({kind:'hcaptcha',scroll:true},async(browser,page,calls)=>{
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{})).toMatchObject({solved:true});
      const capture=calls.find(c=>c.method==='Page.captureScreenshot');expect(capture.params.clip).toMatchObject({x:40,y:500,width:304,height:78});
      const press=calls.find(c=>c.params?.type==='mousePressed');expect(press.viewportPoint).toEqual({x:68,y:137});
      const color=await page.evaluate(async(data:string)=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(image.width-10,10,1,1).data];},capture.result.data);
      expect(color).toEqual([0,180,0,255]);
    });
  });
  it('never captures or sends an occluded frame',async()=>{
    await fixture({overlay:true},async(browser,_page,calls)=>{const infer=vi.fn();expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toMatchObject({detected:true,solved:false,reason:expect.stringContaining('covered')});expect(infer).not.toHaveBeenCalled();expect(calls).toEqual([]);});
  });
  it('never captures underlying page text through a translucent recognized frame',async()=>{
    await fixture({translucent:true},async(browser,_page,calls)=>{const infer=vi.fn();expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toMatchObject({detected:true,solved:false,reason:expect.stringContaining('visual effects')});expect(infer).not.toHaveBeenCalled();expect(calls).toEqual([]);});
  });
  it('ignores invisible badges and existing completed widgets',async()=>{
    for(const options of [{invisible:true},{completed:true}])await fixture(options,async(browser,_page,calls)=>{const infer=vi.fn();expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toEqual({detected:false,solved:false});expect(calls).toEqual([]);expect(infer).not.toHaveBeenCalled();});
  });
  it('does not confuse a CAPTCHA article or a counterfeit provider host with a widget',async()=>{
    await fixture({},async(browser,page,calls)=>{await page.evaluate(()=>{document.body.innerHTML='<h1>How CAPTCHA works</h1><p>Verify you are human is a common message.</p><iframe src="https://www.google.com.evil.test/recaptcha/api2/anchor"></iframe>';});expect(await solveChallenge(browser,config,new AbortController().signal,()=>{})).toEqual({detected:false,solved:false});expect(calls).toEqual([]);});
  });
  it('does not click a frame covered after visual inference',async()=>{
    await fixture({image:true},async(browser,page,calls)=>{const infer=vi.fn(async()=>{await page.evaluate(()=>{const div=document.createElement('div');div.style.cssText='position:fixed;inset:0;z-index:999;background:white';document.body.appendChild(div);});return '{"action":"click","x":28,"y":37}';});expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer,wait:noWait})).toMatchObject({solved:false});expect(calls.filter(c=>c.method==='Input.dispatchMouseEvent')).toEqual([]);});
  });
  it('verifies a fresh visual answer using actual screenshot dimensions',async()=>{
    await fixture({image:true},async(browser,_page,calls)=>{
      const infer=vi.fn(async(_config:any,_prompt:string,image:{data:string})=>{const png=Buffer.from(image.data,'base64');return JSON.stringify({action:'click',x:Math.round(28*png.readUInt32BE(16)/304),y:Math.round(37*png.readUInt32BE(20)/240)});});
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toEqual({detected:true,solved:true});
      expect(infer).toHaveBeenCalledOnce();expect(calls.filter(c=>c.params?.type==='mousePressed')[0].viewportPoint).toEqual({x:68,y:177});
    });
  });
  it('rejects changed image pixels before clicking and hands off after three decisions',async()=>{
    await fixture({image:true},async(browser,page,calls)=>{
      let round=0;const infer=vi.fn(async()=>{const frame=page.frames().find((f:any)=>f.url().includes('/bframe'))!;await frame.evaluate((color:string)=>document.body.style.background=color,++round%2?'blue':'yellow');return '{"action":"click","x":28,"y":37}';});
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer,wait:noWait})).toMatchObject({solved:false,reason:expect.stringContaining('limit')});
      expect(infer).toHaveBeenCalledTimes(3);expect(calls.filter(c=>c.method==='Input.dispatchMouseEvent')).toEqual([]);
    });
  });
  it('attests the current child-frame origin instead of trusting its unchanged src',async()=>{
    await fixture({},async(browser,page,calls)=>{
      await page.context().route('https://untrusted.test/**',(route:any)=>route.fulfill({contentType:'text/html',body:'<body>Unrelated private content</body>'}));
      await page.frames().find((f:any)=>f.url().includes('/anchor'))!.goto('https://untrusted.test/');
      expect(await page.locator('#anchor').getAttribute('src')).toContain('www.google.com/recaptcha/');
      const infer=vi.fn();expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toMatchObject({detected:true,solved:false});
      expect(infer).not.toHaveBeenCalled();expect(calls.filter(c=>['Page.captureScreenshot','Input.dispatchMouseEvent'].includes(c.method))).toEqual([]);
    });
  });
  it('hides host pixels under a transparent same-origin challenge and restores background styles',async()=>{
    await fixture({image:true,transparentChild:true,sameOrigin:true},async(browser,page,calls)=>{
      const sample=async(data:string)=>page.evaluate(async(encoded:string)=>{const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return [...ctx.getImageData(Math.floor(img.width*.8),Math.floor(img.height*.5),1,1).data];},data);
      const original=await browser.cdp('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:40,y:140,width:304,height:240,scale:1}}) as {data:string};
      expect(await sample(original.data)).toEqual([255,0,255,255]);
      const infer=vi.fn(async(_config:any,_prompt:string,image:{data:string})=>{expect(await sample(image.data)).toEqual([255,255,255,255]);expect(await page.locator('#challenge').evaluate((e:HTMLElement)=>e.style.getPropertyPriority('background-color'))).toBe('important');return '{"action":"handoff"}';});
      expect(await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer})).toMatchObject({solved:false});
      expect(infer).toHaveBeenCalledOnce();
      expect(await page.locator('#challenge').evaluate((e:HTMLElement)=>[e.style.getPropertyValue('background-color'),e.style.getPropertyValue('background-clip')])).toEqual(['','']);
      expect(calls.filter(c=>c.method==='Input.dispatchMouseEvent')).toEqual([]);
    });
  });
  it('restores the opaque background after cancellation and provider errors',async()=>{
    for(const fail of ['cancel','error'])await fixture({image:true,transparentChild:true},async(browser,page)=>{
      const controller=new AbortController();const infer=vi.fn(async()=>{expect(await page.locator('#challenge').evaluate((e:HTMLElement)=>getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');if(fail==='cancel')controller.abort();throw Error('Fixture provider failure');});
      const work=solveChallenge(browser,config,controller.signal,()=>{},{infer});
      if(fail==='cancel')await expect(work).rejects.toMatchObject({name:'AbortError'});else expect(await work).toMatchObject({solved:false});
      expect(await page.locator('#challenge').evaluate((e:HTMLElement)=>[e.style.getPropertyValue('background-color'),e.style.getPropertyValue('background-clip')])).toEqual(['','']);
    });
  });
  it('preserves a concurrent page background edit while restoring unchanged owned properties',async()=>{
    await fixture({image:true,transparentChild:true},async(browser,page)=>{
      const infer=vi.fn(async()=>{await page.locator('#challenge').evaluate((e:HTMLElement)=>e.style.setProperty('background-color','blue','important'));return '{"action":"handoff"}';});
      await solveChallenge(browser,config,new AbortController().signal,()=>{},{infer});
      expect(await page.locator('#challenge').evaluate((e:HTMLElement)=>[e.style.getPropertyValue('background-color'),e.style.getPropertyPriority('background-color'),e.style.getPropertyValue('background-clip')])).toEqual(['blue','important','']);
    });
  });
});
