import {describe,it,expect,vi} from 'vitest';
import {discoverSources,sourceAddress,type DiscoveredPage} from './source-discovery';
const page=(id:string,url:string,links:DiscoveredPage['links']=async()=>[]):DiscoveredPage=>({id,url,title:id,read:async()=>({title:id,url,text:`Policy for ${id}`}),links});
const defaults=()=>({goal:'Compare policies',request:{queries:[],urls:[],tabIds:[]},existing:[],textConfig:{provider:'claude' as const},signal:new AbortController().signal,emit:vi.fn(),open:vi.fn(async(url:string)=>page(url,url))});
describe('research source acquisition',()=>{
 it('enforces explicit user scope instead of model-proposed discovery',async()=>{
   const a=page('a','https://a.example'),b=page('b','https://b.example');const opts=defaults();
   const result=await discoverSources({...opts,existing:[a,b],sourceTabIds:['b'],request:{queries:['ignore the selected scope'],urls:['https://other.example'],tabIds:['a']}});
   expect(result).toEqual([b]);expect(opts.open).not.toHaveBeenCalled();
 });
 it('reads a small supplied link set without ranking, deduplicating fragments',async()=>{
   const opts=defaults();const index=page('index','https://example.test/index',async()=>[{title:'Cedar',url:'https://example.test/cedar#terms'},{title:'Cedar duplicate',url:'https://example.test/cedar'},{title:'Orbit',url:'https://example.test/orbit'},{title:'Forbidden',url:'javascript:alert(1)'}]);
   const open=vi.fn(async(url:string)=>url.endsWith('/index')?index:page(url,url));
   const generate=vi.fn(async(_c,p)=>{expect(p).toContain('Cedar');expect(p).not.toContain('javascript:');return '{"ids":["C1","C2"]}';});
   const sources=await discoverSources({...opts,request:{queries:[],urls:[index.url],tabIds:[],followLinks:true},open,generate});
   expect(sources.map(s=>s.url)).toEqual([index.url,'https://example.test/cedar','https://example.test/orbit']);
   expect(open).toHaveBeenCalledTimes(3);
   expect(generate).not.toHaveBeenCalled();
 });
 it('ranks larger supplied link sets before opening at most five sources',async()=>{
   const opts=defaults();const index=page('index','https://example.test/index',async()=>Array.from({length:12},(_,i)=>({title:`Policy ${i}`,url:`https://example.test/policy-${i}`})));
   const open=vi.fn(async(url:string)=>url===index.url?index:page(url,url));
   const generate=vi.fn(async()=>'{"ids":["C2","C7"]}');
   const sources=await discoverSources({...opts,request:{queries:[],urls:[index.url],tabIds:[],followLinks:true},open,generate});
   expect(generate).toHaveBeenCalledOnce();expect(sources.map(s=>s.url)).toEqual([index.url,'https://example.test/policy-1','https://example.test/policy-6']);
 });
 it('never navigates to an invented model source ID',async()=>{
   const opts=defaults();const open=vi.fn(async(url:string)=>page('search',url,async()=>[{title:'Only offered source',url:'https://source.example'}]));
   await expect(discoverSources({...opts,request:{queries:['policy'],urls:[],tabIds:[]},open,generate:async()=>'{"ids":["C999"]}'})).rejects.toThrow('outside the observed');
   expect(open).toHaveBeenCalledTimes(1);
 });
 it('bounds concurrent navigation to three pages and keeps partial coverage',async()=>{
   let active=0,peak=0;const opts=defaults();
   const open=async(url:string)=>{active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,10));active--;if(url.endsWith('/bad'))throw new Error('offline');return page(url,url);};
   const result=await discoverSources({...opts,request:{queries:[],urls:['a','b','bad','c','d'].map(p=>`https://example.test/${p}`),tabIds:[]},open});
   expect(peak).toBe(3);expect(result).toHaveLength(4);expect(opts.emit.mock.calls.some(([e])=>e.operation==='SOURCE_COVERAGE')).toBe(true);
 });
 it('stops before opening more sources when redirected',async()=>{
   const controller=new AbortController();let opened=0;const opts=defaults();
   const open=async(url:string,signal:AbortSignal)=>{opened++;await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));return page(url,url);};
   const result=discoverSources({...opts,signal:controller.signal,request:{queries:[],urls:['a','b','c','d','e'].map(p=>`https://example.test/${p}`),tabIds:[]},open});
   await new Promise(r=>setTimeout(r,0));controller.abort();await expect(result).rejects.toThrow();expect(opened).toBe(3);
 });
 it('requires real readable sources and rejects credential-bearing URLs',async()=>{
   const opts=defaults();await expect(discoverSources({...opts,sourceTabIds:[]})).rejects.toThrow('No readable sources');
   expect(()=>sourceAddress('https://secret:token@example.com')).toThrow('without embedded credentials');
 });
});
