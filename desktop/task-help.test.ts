import {it,expect,vi} from 'vitest';
import {lookupTaskHelp} from './task-help';
import type {JevRequest} from './engine';
import type {DiscoveredPage} from './source-discovery';
function fixture(selected='C1') {
 const opened:string[]=[],closed:string[]=[];
 const open=vi.fn(async(url:string):Promise<DiscoveredPage>=>{
   opened.push(url);return {id:url,url,title:'Guide',read:async()=>({title:'Game guide',url,text:'Use the visible Hint control to reveal a legal move.'}),links:async()=>[{title:'Official guide',url:'https://guide.example/instructions'},{title:'Unrelated page',url:'https://other.example/'}]};
 });
 const infer=vi.fn(async(_config,body:JevRequest)=>({answers:{source:{choice:selected,confidence:1,probabilities:Object.fromEntries(Object.keys(body.questions.source.criteria).map(id=>[id,id===selected?1:0]))}}}));
 return {opened,closed,options:{query:'Example puzzle hints',jevConfig:{apiKey:'test'},textConfig:{provider:'openai' as const},signal:new AbortController().signal,emit:vi.fn(),open,close:(id:string)=>{closed.push(id);},searchUrl:()=> 'https://search.example/?q=puzzle',infer}};
}
it('uses one Jev decision to read one offered guide without a synthesis call',async()=>{
 const f=fixture();const result=await lookupTaskHelp(f.options);
 expect(f.opened).toEqual(['https://search.example/?q=puzzle','https://guide.example/instructions']);
 expect(result).toEqual([{title:'Game guide',url:'https://guide.example/instructions',text:'Use the visible Hint control to reveal a legal move.'}]);
 expect(f.closed).toEqual(['https://search.example/?q=puzzle']);expect(f.options.infer).toHaveBeenCalledOnce();
});
it('rejects invented links and cancelled lookups before opening a guide',async()=>{
 const invalid=fixture('C999');await expect(lookupTaskHelp(invalid.options)).rejects.toThrow('Invalid Jev choice');expect(invalid.opened).toHaveLength(1);
 const cancelled=fixture(),controller=new AbortController();
 const original=cancelled.options.infer;
 await expect(lookupTaskHelp({...cancelled.options,signal:controller.signal,infer:async(...args)=>{const result=await original(...args);controller.abort();return result;}})).rejects.toThrow();
 expect(cancelled.opened).toHaveLength(1);
});
