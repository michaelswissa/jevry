/** Test-only instrumentation. Records actual CDP events; never creates browser actions. */
export async function recordBrowser({app, webContents, session}, {origins, authHeaders}) {
  const allowed = new Set(origins);
  const browserSession = session.fromPartition('persist:jevry-browser');
  browserSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, done) => {
    done({cancel: !allowed.has(new URL(details.url).origin)});
  });
  browserSession.webRequest.onBeforeSendHeaders((details, done) => {
    const headers = authHeaders[new URL(details.url).origin] || {};
    done({requestHeaders:{...details.requestHeaders,...headers}});
  });
  const entries = [], active = new Map(), chains = new Map(), pending = new Set(), observers = new Map();
  const headerList = value => Object.entries(value || {}).flatMap(([name,value]) => String(value).split('\n').map(value=>({name,value})));
  const cookies = headers => headers.filter(h=>h.name.toLowerCase()==='set-cookie').map(h=>{
    const pair=h.value.split(';')[0], index=pair.indexOf('=');
    return {name:pair.slice(0,index),value:pair.slice(index+1)};
  });
  const response = (entry, r) => {
    const headers=headerList(r.headers);
    entry.response={status:r.status,statusText:r.statusText||'',httpVersion:r.protocol||'HTTP/1.1',headers,cookies:cookies(headers),content:{size:r.encodedDataLength||0,mimeType:r.mimeType||''},redirectURL:headers.find(h=>h.name.toLowerCase()==='location')?.value||'',headersSize:-1,bodySize:-1};
  };
  // Chromium reuses requestId through redirects. ExtraInfo can arrive before or
  // after the corresponding response, so associate it with ordered redirect hops.
  const applyExtraInfo = chain => {
    for (const kind of ['request','response']) {
      let index=chain[`${kind}Index`];
      while(index<chain.hops.length) {
        const hop=chain.hops[index];
        if(hop.hasExtraInfo===undefined)break;
        if(!hop.hasExtraInfo){index++;continue;}
        const extra=chain[`${kind}Extras`].shift();
        if(!extra)break;
        const headers=headerList(extra.headers),entry=hop.entry;
        entry[kind].headers=headers;
        if(kind==='response') {
          entry.response.cookies=cookies(headers);
          entry.response.redirectURL=headers.find(h=>h.name.toLowerCase()==='location')?.value||'';
        } else if(entry.request.postData) {
          entry.request.postData.mimeType=headers.find(h=>h.name.toLowerCase()==='content-type')?.value||entry.request.postData.mimeType;
        }
        index++;
      }
      chain[`${kind}Index`]=index;
    }
  };
  const attach = async wc => {
    if (wc.session!==browserSession || observers.has(wc.id)) return;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const listener = (_event, method, p, sessionId) => {
      const key=`${wc.id}:${sessionId||''}:${p.requestId}`;
      if(!chains.has(key))chains.set(key,{hops:[],requestExtras:[],responseExtras:[],requestIndex:0,responseIndex:0});
      const chain=chains.get(key);
      if(method==='Network.requestWillBeSent') {
        if(p.redirectResponse && active.has(key)) {
          const previous=active.get(key);response(previous,p.redirectResponse);
          previous.time=Math.max(0,(p.timestamp-previous._timestamp)*1000);previous.timings.wait=previous.time;
          chain.hops.at(-1).hasExtraInfo=p.redirectHasExtraInfo===true;applyExtraInfo(chain);
        }
        if(!allowed.has(new URL(p.request.url).origin)) {active.delete(key);return;}
        const headers=headerList(p.request.headers);
        const entry={startedDateTime:new Date(p.wallTime*1000).toISOString(),time:0,request:{method:p.request.method,url:p.request.url,httpVersion:'HTTP/1.1',headers,cookies:[],queryString:[...new URL(p.request.url).searchParams].map(([name,value])=>({name,value})),headersSize:-1,bodySize:-1},response:{status:0,statusText:'',httpVersion:'',headers:[],cookies:[],content:{size:0,mimeType:''},redirectURL:'',headersSize:-1,bodySize:-1},cache:{},timings:{send:0,wait:0,receive:0},_timestamp:p.timestamp,_requestId:key,_resourceType:p.type};
        if(p.request.postData!==undefined)entry.request.postData={mimeType:headers.find(h=>h.name.toLowerCase()==='content-type')?.value||'',text:p.request.postData};
        entries.push(entry);active.set(key,entry);chain.hops.push({entry});
      } else if(method==='Network.requestWillBeSentExtraInfo') {
        chain.requestExtras.push(p);applyExtraInfo(chain);
      } else if(method==='Network.responseReceived' && active.has(key)) {
        response(active.get(key),p.response);
        chain.hops.at(-1).hasExtraInfo=p.hasExtraInfo===true;applyExtraInfo(chain);
      } else if(method==='Network.responseReceivedExtraInfo') {
        chain.responseExtras.push(p);applyExtraInfo(chain);
      } else if(method==='Network.loadingFinished' && active.has(key)) {
        const entry=active.get(key);entry.time=Math.max(0,(p.timestamp-entry._timestamp)*1000);
        entry.timings.wait=entry.time;entry.response.bodySize=p.encodedDataLength;
        if(/json|html|xml|text|x-www-form-urlencoded/i.test(entry.response.content.mimeType)) {
          const command=sessionId?wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId},sessionId):wc.debugger.sendCommand('Network.getResponseBody',{requestId:p.requestId});
          const work=command.then(body=>{
            entry.response.content.text=body.body;if(body.base64Encoded)entry.response.content.encoding='base64';
          }).catch(error=>{entry._bodyCaptureError=error.message;}).finally(()=>pending.delete(work));
          pending.add(work);
        }
      } else if(method==='Network.loadingFailed' && active.has(key)) active.get(key)._error=p.errorText;
    };
    observers.set(wc.id,{wc,listener});wc.debugger.on('message',listener);
    await wc.debugger.sendCommand('Network.enable',{maxTotalBufferSize:100_000_000,maxResourceBufferSize:10_000_000});
  };
  for(const wc of webContents.getAllWebContents()) await attach(wc);
  app.on('web-contents-created',(_event,wc)=>{void attach(wc).catch(error=>{globalThis.__benchmarkCaptureError=error.message;});});
  const originalFetch=globalThis.fetch, decisions=[];
  globalThis.fetch=async(url,init)=>{
    let recorded;
    if(String(url).startsWith('https://api.typesafe.ai/') && typeof init?.body==='string') {
      recorded={startedAt:new Date().toISOString(),request:JSON.parse(init.body)};
      decisions.push(recorded);
    }
    const recordError=error=>{
      if(!recorded)return;
      recorded.error=error.message;recorded.errorAt=new Date().toISOString();
      if(init?.signal?.aborted)recorded.abortSource={name:init.signal.reason?.name||'AbortError',message:String(init.signal.reason?.message||'').slice(0,200)};
    };
    try {
      const result=await originalFetch(url,init);
      if(recorded){
        recorded.httpStatus=result.status;recorded.headersAt=new Date().toISOString();
        // Observe a clone without making the actor's fetch wait for JSON bytes.
        const work=result.clone().json().then(value=>{recorded.response=value;recorded.finishedAt=new Date().toISOString();})
          .catch(recordError).finally(()=>pending.delete(work));
        pending.add(work);
      }
      return result;
    } catch(error){recordError(error);throw error;}
  };
  globalThis.__benchmarkDump=async()=>{
    await Promise.allSettled([...pending]);
    return {har:{log:{version:'1.2',creator:{name:'Jevry CDP recorder',version:'1'},entries}},decisions,captureError:globalThis.__benchmarkCaptureError};
  };
}
