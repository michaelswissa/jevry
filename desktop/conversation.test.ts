import {describe,it,expect,vi} from 'vitest';
import {Conversations,conversationContext,type TurnContext} from './conversation';
import {planTurn,answerTurn,streamedReply,pageStatusAnswer,takePreparedField,reviewTask} from './chat-model';
import {ClaudeStreamMismatch} from './cli-worker';
import type {ChatMessage,Conversation,ConversationSnapshot} from '../src/conversation-types';
import type {AgentEvent} from '../src/types';
const blank=():ConversationSnapshot=>({conversations:[],activeConversationId:null});
const eventually=async(predicate:()=>boolean)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Timed out');};
describe('persistent multi-turn conversation',()=>{
 it('carries previous constraints and answers into the next message and survives reopening',async()=>{
   let persisted=blank();const seen:unknown[]=[];
   const service=new Conversations(blank(),async ctx=>{
     seen.push(conversationContext(ctx.conversation,ctx.message.id));
     ctx.conversation.lastGoal='Find Paris hotels for two people under 200';
     ctx.conversation.memory='Two people, budget 200';ctx.update('Three Paris options under 200.');
   },d=>{persisted=structuredClone(d);},()=>{});
   expect(service.send({text:'Paris for two under 200'}).ok).toBe(true);
   await eventually(()=>!service.running);
   const reopened=new Conversations(persisted,async ctx=>{seen.push(conversationContext(ctx.conversation,ctx.message.id));ctx.update('London for the same two people and budget.');},()=>{},()=>{});
   reopened.send({text:'Now London'});await eventually(()=>!reopened.running);
   expect(JSON.stringify(seen[1])).toContain('Paris for two under 200');
   expect(JSON.stringify(seen[1])).toContain('Three Paris options');
   expect(JSON.stringify(seen[1])).toContain('Now London');
   expect(reopened.active()?.messages).toHaveLength(4);
 });
 it('drains cancelled browser work before a redirect; ignores stale streamed text',async()=>{
   let release:()=>void=()=>{},active=0,max=0;const started:string[]=[];
   const service=new Conversations(blank(),async ctx=>{
     active++;max=Math.max(active,max);started.push(ctx.message.content);
     if(started.length===1){await new Promise<void>(r=>{release=r;});ctx.update('STALE');}
     else ctx.update('New answer');active--;
   },()=>{},()=>{});
   service.send({text:'first'});await eventually(()=>started.length===1);
   service.send({text:'second'});service.send({text:'third'});
   expect(started).toEqual(['first']);release();await eventually(()=>!service.running);
   expect(max).toBe(1);expect(started).toEqual(['first','third']);
   const messages=service.active()!.messages;
   expect(messages.filter(m=>m.role==='user').map(m=>m.content)).toEqual(['first','second','third']);
   expect(messages[1].status).toBe('stopped');expect(messages[3].status).toBe('stopped');
   expect(messages[5].content).toBe('New answer');expect(JSON.stringify(messages)).not.toContain('STALE');
 });
 it('isolates conversations and interrupts selected-away work',async()=>{
   const service=new Conversations(blank(),async ctx=>{await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));},()=>{},()=>{});
   service.send({text:'keep this'});const id=service.active()!.id;
   service.newConversation();await eventually(()=>!service.running);
   expect(service.active()!.messages).toHaveLength(0);service.select(id);
   expect(service.active()!.messages[0].content).toBe('keep this');expect(service.active()!.messages[1].status).toBe('stopped');
 });
 it('marks interrupted messages stopped when rehydrating, and rejects unsaved sends',()=>{
   const service=new Conversations(blank(),async()=>{},()=>{},()=>{});service.send({text:'hello'});
   const resumed=new Conversations(structuredClone(service.snapshot()),async()=>{},()=>{},()=>{});
   expect(resumed.active()!.messages.at(-1)?.status).toBe('stopped');
   const failed=new Conversations(resumed.snapshot(),async()=>{throw new Error('must not execute');},()=>{throw new Error('locked');},()=>{});
   expect(failed.send({text:'new'})).toMatchObject({ok:false,message:'locked'});
   expect(failed.active()!.messages).toHaveLength(2);
 });
});
describe('conversation lifecycle and source persistence',()=>{
 const conversation=(id:string,title=id):Conversation=>({id,title,messages:[],createdAt:1,updatedAt:1,memory:''});
 const seeded=():ConversationSnapshot=>({conversations:[conversation('first','Original name'),conversation('second','Other conversation')],activeConversationId:'first'});

 it('renames only the requested conversation, trims its title, and persists the result',()=>{
   let persisted=blank();
   const service=new Conversations(seeded(),async()=>{},data=>{persisted=structuredClone(data);},()=>{});
   expect(service.rename('first','  Paris plans  ')).toEqual({ok:true});
   expect(service.active()?.title).toBe('Paris plans');
   expect(persisted.conversations.map(item=>item.title)).toEqual(['Paris plans','Other conversation']);
   expect(service.rename('first','x'.repeat(120)).ok).toBe(true);
   expect(persisted.conversations[0].title).toHaveLength(120);
 });

 it('rejects invalid names and missing conversation IDs without writing or changing history',()=>{
   const save=vi.fn();const service=new Conversations(seeded(),async()=>{},save,()=>{});
   const before=structuredClone(service.snapshot());
   for(const title of ['', ' \n ', 'x'.repeat(121), null, 42]) {
     expect(service.rename('first',title as string).ok).toBe(false);
   }
   expect(service.rename('missing','Valid name').ok).toBe(false);
   expect(service.delete('missing').ok).toBe(false);
   expect(save).not.toHaveBeenCalled();
   expect(service.snapshot()).toEqual(before);
 });

 it('rolls back a rename if the saved history cannot be written',()=>{
   const service=new Conversations(seeded(),async()=>{},()=>{throw new Error('Credential store locked');},()=>{});
   const before=structuredClone(service.snapshot());
   expect(service.rename('first','Unsaved name')).toEqual({ok:false,message:'Credential store locked'});
   expect(service.snapshot()).toEqual(before);
 });

 it('deletes only the selected history, preserves the active conversation, and can empty the archive',()=>{
   let persisted=blank();
   const service=new Conversations(seeded(),async()=>{},data=>{persisted=structuredClone(data);},()=>{});
   expect(service.delete('second')).toEqual({ok:true});
   expect(service.active()?.id).toBe('first');
   expect(persisted.conversations.map(item=>item.id)).toEqual(['first']);
   expect(service.delete('first')).toEqual({ok:true});
   expect(service.active()).toBeUndefined();
   expect(service.snapshot()).toEqual(blank());
   expect(persisted).toEqual(blank());
 });

 it('rolls back a failed delete and leaves its executing turn able to finish',async()=>{
   let rejectSave=false, release:()=>void=()=>{};
   let executing:TurnContext|undefined;
   const service=new Conversations(seeded(),async ctx=>{
     executing=ctx;
     await new Promise<void>(resolve=>{release=resolve;});
     ctx.update('The original task can still finish.');
   },()=>{if(rejectSave)throw new Error('Disk write failed');},()=>{});
   service.send({text:'Keep this task'});
   await eventually(()=>!!executing);
   const before=structuredClone(service.snapshot());
   rejectSave=true;
   expect(service.delete('first')).toEqual({ok:false,message:'Disk write failed'});
   expect(service.snapshot()).toEqual(before);
   expect(executing!.signal.aborted).toBe(false);
   rejectSave=false;release();await eventually(()=>!service.running);
   expect(service.active()?.messages.at(-1)).toMatchObject({status:'complete',content:'The original task can still finish.'});
 });

 it('aborts deleted work, drains it before the next turn, and never resurrects late results',async()=>{
   const persisted:ConversationSnapshot[]=[];const started:string[]=[];
   let executing:TurnContext|undefined, release:()=>void=()=>{};
   const service=new Conversations(seeded(),async ctx=>{
     started.push(ctx.conversation.id);
     if(ctx.conversation.id==='first') {
       executing=ctx;ctx.update('Partial answer before deletion.');
       await new Promise<void>(resolve=>{release=resolve;});
       ctx.update('LATE DELETED ANSWER');
       ctx.event({type:'action',message:'LATE DELETED ACTION',timestamp:1,elapsedMs:1});
     } else ctx.update('The surviving conversation is ready.');
   },data=>persisted.push(structuredClone(data)),()=>{});
   service.send({text:'Delete this while it runs'});await eventually(()=>!!executing);
   const afterDelete=persisted.length;
   expect(service.delete('first')).toEqual({ok:true});
   expect(executing!.signal.aborted).toBe(true);
   expect(service.active()?.id).toBe('second');
   expect(service.send({text:'Continue in the surviving conversation'}).ok).toBe(true);
   expect(started).toEqual(['first']);
   release();await eventually(()=>!service.running);
   expect(started).toEqual(['first','second']);
   expect(service.snapshot().conversations.map(item=>item.id)).toEqual(['second']);
   expect(service.active()?.messages.at(-1)?.content).toBe('The surviving conversation is ready.');
   expect(persisted.slice(afterDelete).every(snapshot=>snapshot.conversations.every(item=>item.id!=='first'))).toBe(true);
   expect(JSON.stringify(persisted.slice(afterDelete))).not.toContain('LATE DELETED');
 });

 it('stores a defensive copy of selected source IDs and preserves web-only versus automatic scope',async()=>{
   let persisted=blank();const received:Array<string[]|undefined>=[];
   const service=new Conversations(seeded(),async ctx=>{received.push(ctx.message.sourceTabIds);ctx.update('Read the selected sources.');},data=>{persisted=structuredClone(data);},()=>{});
   const ids=Array.from({length:8},(_,index)=>`tab-${index}`);
   expect(service.send({text:'Read these eight',mode:'research',sourceTabIds:ids}).ok).toBe(true);
   ids[0]='CALLER MUTATION';ids.push('extra');await eventually(()=>!service.running);
   expect(received[0]).toEqual(Array.from({length:8},(_,index)=>`tab-${index}`));
   expect(service.send({text:'Find new web sources',mode:'research',sourceTabIds:[]}).ok).toBe(true);
   await eventually(()=>!service.running);
   expect(service.send({text:'Choose sources automatically',mode:'research'}).ok).toBe(true);
   await eventually(()=>!service.running);
   const reopened=new Conversations(persisted,async()=>{},()=>{},()=>{});
   const requests=reopened.active()!.messages.filter(item=>item.role==='user');
   expect(requests.map(item=>item.sourceTabIds)).toEqual([Array.from({length:8},(_,index)=>`tab-${index}`),[],undefined]);
 });

 it('rejects malformed, duplicated, or oversized source selections before execution or persistence',()=>{
   const execute=vi.fn(async()=>{}),save=vi.fn();
   const service=new Conversations(seeded(),execute,save,()=>{});
   const before=structuredClone(service.snapshot());
   for(const sourceTabIds of ['tab-1',null,[1],['same','same'],Array.from({length:9},(_,index)=>`tab-${index}`)]) {
     expect(service.send({text:'Research',mode:'research',sourceTabIds:sourceTabIds as string[]}).ok).toBe(false);
   }
   expect(execute).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
   expect(service.snapshot()).toEqual(before);
 });

 it('retains research findings and observed source URLs in a reopened follow-up context',async()=>{
   let persisted=blank();
   const research={summary:'Option A is less expensive. [S1]',findings:[{text:'Option A costs 40; Option B costs 60.',sourceIds:['S1','S2']}],sources:[{id:'S1',title:'Option A pricing',url:'https://a.example/pricing'},{id:'S2',title:'Option B pricing',url:'https://b.example/pricing'}]};
   const service=new Conversations(seeded(),async ctx=>{ctx.answer.research=research;ctx.update(research.summary);},data=>{persisted=structuredClone(data);},()=>{});
   service.send({text:'Compare the two sources',mode:'research',sourceTabIds:['tab-a','tab-b']});
   await eventually(()=>!service.running);
   let followup:ReturnType<typeof conversationContext>|undefined;
   const reopened=new Conversations(persisted,async ctx=>{followup=conversationContext(ctx.conversation,ctx.message.id);ctx.update('Opening the cheaper source.');},()=>{},()=>{});
   reopened.send({text:'Open the cheaper source'});await eventually(()=>!reopened.running);
   expect(followup!.messages.find(item=>item.role==='assistant')).toMatchObject({content:research.summary,sources:research.sources,findings:research.findings});
   expect(followup!.messages.at(-1)?.content).toBe('Open the cheaper source');
 });
 it('stops selecting older messages after research evidence exhausts the context budget',()=>{
   const history=conversation('large-research-history');
   const research={
     summary:'Source comparison',
     findings:Array.from({length:6},()=>({text:'Evidence '.repeat(100).slice(0,800),sourceIds:['S1']})),
     sources:Array.from({length:8},(_,index)=>({id:`S${index+1}`,title:`Observed source ${index+1}`,url:`https://source${index+1}.example/research`})),
   };
   for(let index=1;index<=6;index++) {
     history.messages.push({id:`request-${index}`,role:'user',content:`REQUEST_${index}: `.padEnd(8000,'u'),status:'complete',createdAt:index,events:[]});
     history.messages.push({id:`report-${index}`,role:'assistant',content:`REPORT_${index}: `.padEnd(8000,'r'),status:'complete',createdAt:index,events:[],research});
   }
   history.messages.push({id:'follow-up',role:'user',content:'Which source was cheapest?',status:'complete',createdAt:7,events:[]});
   const context=conversationContext(history,'follow-up');
   expect(context.messages.at(-1)?.content).toBe('Which source was cheapest?');
   expect(context.messages.some(message=>message.content.startsWith('REPORT_6:'))).toBe(true);
   expect(context.messages.some(message=>message.content.startsWith('REPORT_5:'))).toBe(true);
   expect(context.messages.some(message=>message.content.startsWith('REQUEST_5:'))).toBe(false);
   expect(context.messages.some(message=>/^(REQUEST|REPORT)_[1-4]:/.test(message.content))).toBe(false);
 });
});
describe('performed-action evidence in follow-up context',()=>{
 const event=(value:Partial<AgentEvent>):AgentEvent=>({type:'action',message:'Clicked Add traveler.',timestamp:1,elapsedMs:1,operation:'CLICK',url:'https://travel.example/preferences',...value});
 const history=(answer:Partial<ChatMessage>={}):Conversation=>({id:'trip',title:'Trip',createdAt:1,updatedAt:1,memory:'Paris, Business cabin',messages:[
   {id:'request',role:'user',content:'Prepare Paris and Business; wait for my traveler name.',status:'complete',createdAt:1,events:[]},
   {id:'answer',role:'assistant',content:'I’ll prepare the form.',status:'stopped',createdAt:2,events:[event({})],tabId:'travel-tab',...answer},
   {id:'resume',role:'user',content:'The traveler is Ada; continue from here.',status:'complete',createdAt:3,events:[]},
 ]});

 it('preserves performed inputs through stop and restart without promoting an unexecuted decision',async()=>{
   let persisted=blank(),started=false;
   const service=new Conversations(blank(),async ctx=>{
     ctx.answer.tabId='travel-tab';ctx.update('I’ll prepare Paris and Business.');
     ctx.event(event({type:'observation',message:'Preferences form.'}));
     ctx.event(event({operation:'TYPE_TEXT',message:'Typed into Destination.'}));
     ctx.event(event({operation:'SELECT',message:'Selected Cabin → Business.'}));
     ctx.event(event({}));
     ctx.event(event({type:'decision',message:'Review preferences'}));
     started=true;
     await new Promise<void>(resolve=>ctx.signal.addEventListener('abort',()=>resolve(),{once:true}));
     ctx.event(event({type:'decision',message:'LATE UNEXECUTED DECISION'}));
   },data=>{persisted=structuredClone(data);},()=>{});
   service.send({text:'Prepare Paris and Business; wait for my traveler name.'});
   await eventually(()=>started);service.stop();await eventually(()=>!service.running);
   let context:ReturnType<typeof conversationContext>|undefined;
   const reopened=new Conversations(persisted,async ctx=>{context=conversationContext(ctx.conversation,ctx.message.id);},()=>{},()=>{});
   reopened.send({text:'The traveler is Ada; continue from here.'});await eventually(()=>!reopened.running);
   const previous=context!.messages.find(message=>message.role==='assistant')!;
   expect(previous).toMatchObject({status:'stopped',execution:{tabId:'travel-tab',lastObservedUrl:'https://travel.example/preferences',recordedActionCount:3,omittedActionCount:0,reportedOutcome:{status:'stopped',verified:false}}});
   expect(previous.execution!.performedActions.map(action=>action.description)).toEqual(['Typed into Destination.','Selected Cabin → Business.','Clicked Add traveler.']);
   expect(JSON.stringify(context)).not.toContain('Review preferences');
   expect(JSON.stringify(context)).not.toContain('LATE UNEXECUTED DECISION');
   expect(context!.messages.at(-1)?.content).toContain('Ada');
 });

 it('retains action and stopped receipts during cancellation drainage and persists them for resume',async()=>{
   let executing:TurnContext|undefined,release:()=>void=()=>{},persisted=blank();
   const service=new Conversations(blank(),async ctx=>{
     executing=ctx;ctx.answer.tabId='travel-tab';ctx.update('Preparing the form.');
     await new Promise<void>(resolve=>{release=resolve;});
   },data=>{persisted=structuredClone(data);},()=>{});
   service.send({text:'Prepare the form'});await eventually(()=>!!executing);
   service.stop();expect(executing!.signal.aborted).toBe(true);
   executing!.event(event({message:'Clicked Add traveler after the dispatched input returned.'}));
   executing!.event(event({type:'decision',message:'UNEXECUTED DECISION'}));
   executing!.event(event({type:'observation',message:'LATE OBSERVATION',url:'https://unrelated.example/'}));
   executing!.event(event({type:'status',message:'LATE PROGRESS'}));
   executing!.update('LATE CONTENT','complete');
   executing!.event(event({type:'stopped',message:'Cancellation drained.'}));
   expect(service.active()!.messages[1].events.map(item=>item.type)).toEqual(['action','stopped']);
   expect(service.active()!.messages[1].content).toBe('Preparing the form.');
   release();await eventually(()=>!service.running);
   let context:ReturnType<typeof conversationContext>|undefined;
   const reopened=new Conversations(persisted,async ctx=>{context=conversationContext(ctx.conversation,ctx.message.id);},()=>{},()=>{});
   reopened.send({text:'Continue with Ada'});await eventually(()=>!reopened.running);
   expect(context!.messages[1]).toMatchObject({status:'stopped',execution:{recordedActionCount:1,reportedOutcome:{status:'stopped',verified:false,detail:'Cancellation drained.'}}});
   expect(context!.messages[1].execution!.performedActions[0].description).toContain('dispatched input returned');
   expect(JSON.stringify(context)).not.toMatch(/UNEXECUTED|LATE|unrelated/);
 });

 it('retains an executor error during cancellation without promoting it to successful completion',async()=>{
   let executing:TurnContext|undefined,release:()=>void=()=>{};
   const service=new Conversations(blank(),async ctx=>{executing=ctx;await new Promise<void>(resolve=>{release=resolve;});},()=>{},()=>{});
   service.send({text:'Prepare the form'});await eventually(()=>!!executing);service.stop();
   executing!.event(event({type:'error',message:'The browser rejected the dispatched input.'}));
   release();await eventually(()=>!service.running);
   const saved=service.active()!;saved.messages.push({id:'resume',role:'user',content:'What happened?',status:'complete',createdAt:3,events:[]});
   const answer=conversationContext(saved,'resume').messages[1];
   expect(answer).toMatchObject({status:'stopped',execution:{recordedActionCount:0,performedActions:[],reportedOutcome:{status:'error',verified:false,detail:'The browser rejected the dispatched input.'}}});
 });

 it.each([false,true])('rejects callbacks after settlement even when cancellation was %s',async cancelled=>{
   let executing:TurnContext|undefined,release:()=>void=()=>{};
   const service=new Conversations(blank(),async ctx=>{executing=ctx;ctx.update('Saved content.');await new Promise<void>(resolve=>{release=resolve;});},()=>{},()=>{});
   service.send({text:'Prepare the form'});await eventually(()=>!!executing);
   if(cancelled)service.stop();release();await eventually(()=>!service.running);
   const before=structuredClone(service.snapshot());
   executing!.event(event({message:'AFTER DRAIN ACTION'}));
   executing!.event(event({type:'complete',message:'AFTER DRAIN COMPLETION',verified:true}));
   executing!.update('AFTER DRAIN CONTENT','complete');
   expect(service.snapshot()).toEqual(before);
 });

 it('rejects draining callbacks for a deleted conversation without mutating the detached history',async()=>{
   let executing:TurnContext|undefined,release:()=>void=()=>{};
   const service=new Conversations(blank(),async ctx=>{executing=ctx;ctx.update('Before deletion.');await new Promise<void>(resolve=>{release=resolve;});},()=>{},()=>{});
   service.send({text:'Prepare the form'});await eventually(()=>!!executing);
   const detached=service.active()!,answer=detached.messages[1];
   expect(service.delete(detached.id).ok).toBe(true);
   const before=structuredClone(answer);
   executing!.event(event({message:'DELETED ACTION'}));
   executing!.event(event({type:'error',message:'DELETED ERROR'}));
   executing!.update('DELETED CONTENT','complete');
   expect(answer).toEqual(before);
   release();await eventually(()=>!service.running);
   expect(service.snapshot()).toEqual(blank());
   expect(answer.events).toEqual([]);expect(answer.content).toBe('Before deletion.');
 });

 it('carries failure details and prior performed input without claiming success',async()=>{
   const service=new Conversations(blank(),async ctx=>{
     if(ctx.message.content==='Resume')return;
     ctx.answer.tabId='travel-tab';ctx.event(event({}));throw new Error('Page became unavailable after adding the traveler.');
   },()=>{},()=>{});
   service.send({text:'Add the traveler'});await eventually(()=>!service.running);
   service.send({text:'Resume'});await eventually(()=>!service.running);
   const context=conversationContext(service.active()!,service.active()!.messages.at(-2)!.id);
   expect(context.messages.find(message=>message.role==='assistant')).toMatchObject({status:'error',execution:{recordedActionCount:1,error:'Page became unavailable after adding the traveler.',reportedOutcome:{status:'error',verified:false}}});
 });

 it.each([false,true])('keeps explicit executor verification %s separate from stopped message status',verified=>{
   const data=history({events:[event({}),event({type:'complete',message:'Executor reported completion.',verified})]});
   const context=conversationContext(data,'resume');
   expect(context.messages[1]).toMatchObject({status:'stopped',execution:{recordedActionCount:1,reportedOutcome:{status:'complete',verified}}});
 });

 it('retains a blocked outcome without treating a planned action as performed',()=>{
   const data=history({status:'complete',events:[event({type:'decision',verified:true}),event({type:'blocked',message:'The traveler name is required.'})]});
   const receipt=conversationContext(data,'resume').messages[1].execution!;
   expect(receipt).toMatchObject({recordedActionCount:0,performedActions:[],reportedOutcome:{status:'blocked',verified:false,detail:'The traveler name is required.'}});
 });

 it('keeps action-only receipts and omits unsafe or oversized URLs',()=>{
   const data=history({content:'',events:[event({url:'https://name:password@travel.example/'}),event({url:'javascript:alert(1)'}),event({url:`https://travel.example/${'x'.repeat(1100)}`})]});
   const context=conversationContext(data,'resume');
   expect(context.messages).toHaveLength(3);
   expect(context.messages[1].execution!.performedActions).toHaveLength(3);
   expect(context.messages[1].execution!.performedActions.every(action=>action.url===undefined)).toBe(true);
   expect(JSON.stringify(context)).not.toMatch(/password|javascript:|x{1100}/);
 });

 it('keeps receipts local to their originating conversation and observed page',()=>{
   const first=history();const second=history({tabId:'unrelated-tab',events:[event({url:'https://unrelated.example/private',message:'UNRELATED ACTION'})]});second.id='other';
   const service=new Conversations({conversations:[first,second],activeConversationId:'trip'},async()=>{},()=>{},()=>{});
   const context=conversationContext(service.active()!,'resume');
   expect(context.messages[1].execution!.tabId).toBe('travel-tab');
   expect(context.messages[1].execution!.lastObservedUrl).toBeUndefined();
   expect(context.messages[1].execution!.performedActions[0].url).toBe('https://travel.example/preferences');
   expect(JSON.stringify(context)).not.toMatch(/unrelated|UNRELATED/);
 });

 it('bounds escaped receipt data and the serialized transcript while keeping recent evidence',()=>{
   const data=history({error:'\u0000'.repeat(5000),events:Array.from({length:80},(_,index)=>event({operation:'CLICK',message:`Action ${index} `+'\\'.repeat(1000),url:`https://travel.example/${index}/${'u'.repeat(850)}`}))});
   data.messages.splice(0,0,...Array.from({length:8},(_,index):ChatMessage=>({id:`old-${index}`,role:'assistant',content:'OLD '.repeat(2000),status:'complete',createdAt:0,events:[]})));
   const context=conversationContext(data,'resume');
   const receipt=context.messages.find(message=>message.execution)!.execution!;
   expect(JSON.stringify(context.messages).length).toBeLessThanOrEqual(26000);
   expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(4000);
   expect(receipt.recordedActionCount).toBe(80);
   expect(receipt.performedActions.length).toBeGreaterThan(0);
   expect(receipt.performedActions.length).toBeLessThanOrEqual(6);
   expect(receipt.omittedActionCount).toBe(80-receipt.performedActions.length);
   expect(receipt.performedActions.at(-1)?.description).toContain('Action 79');
   expect(context.messages.at(-1)?.content).toContain('Ada');
 });

 it('preserves the full latest escaped request within the serialized context budget',()=>{
   const data=history();data.messages.at(-1)!.content='"'.repeat(11950)+' KEEP THIS FINAL CORRECTION';
   const context=conversationContext(data,'resume');
   expect(context.messages.at(-1)?.content).toBe(data.messages.at(-1)!.content);
   expect(JSON.stringify(context.messages).length).toBeLessThanOrEqual(26000);
 });

 it('supplies receipts to the real planner prompt with outcome semantics, without asserting model success',async()=>{
   const conversation=history({error:'Waiting for the traveler name.'});
   const message=conversation.messages.at(-1)!;
   const ctx:TurnContext={conversation,message,answer:{...message,id:'next-answer',role:'assistant'},signal:new AbortController().signal,update:vi.fn(),event:vi.fn()};
   const generate=vi.fn(async(_config,prompt)=>{
     const context=JSON.parse(prompt.split('CONVERSATION_JSON: ')[1].split('\nOPEN_TABS_JSON:')[0]);
     expect(context.messages[1].execution).toMatchObject({tabId:'travel-tab',recordedActionCount:1,reportedOutcome:{status:'stopped',verified:false},error:'Waiting for the traveler name.'});
     expect(prompt).toContain('not proof that the website accepted them');
     expect(prompt).toContain('only the remaining authorized work');
     return JSON.stringify({intent:'chat',reply:'Prompt capture only.'});
   });
   await planTurn({provider:'openai'},ctx,{title:'Preferences',url:'https://travel.example/preferences',text:'Traveler name is empty.'},[{id:'travel-tab',title:'Preferences',url:'https://travel.example/preferences'}],generate);
   expect(generate).toHaveBeenCalledOnce();
 });
});

describe('grounded conversational planner',()=>{
 const ctx=():TurnContext=>{
   const c={id:'c',title:'Trip',createdAt:0,updatedAt:0,memory:'Two people',lastGoal:'Paris under 200',messages:[{id:'a',role:'user' as const,content:'Find Paris for two under 200',status:'complete' as const,createdAt:0,events:[]},{id:'b',role:'user' as const,content:'Now London',status:'complete' as const,createdAt:0,events:[]}]};
   return {conversation:c,message:c.messages[1],answer:{...c.messages[1],role:'assistant'},signal:new AbortController().signal,update:vi.fn(),event:vi.fn()};
 };
 it('retries one discarded, drained text response before planning any browser work',async()=>{
   const context=ctx(),generate=vi.fn().mockRejectedValueOnce(new ClaudeStreamMismatch()).mockResolvedValue('{"intent":"chat","reply":"Observed result"}');
   expect(await planTurn({provider:'claude'},context,{title:'Results',url:'https://example.test',text:'Observed result'},[],generate)).toMatchObject({intent:'chat',reply:'Observed result'});
   expect(generate).toHaveBeenCalledTimes(2);expect(generate.mock.calls[0][1]).toBe(generate.mock.calls[1][1]);
   expect(context.event).toHaveBeenCalledWith(expect.objectContaining({operation:'PLAN_RETRY'}));
 });
 it('bounds the planning retry and never retries cancellation, tool attempts, or post-execution answers',async()=>{
   for(const error of [new Error('The text provider attempted a tool action.'),Object.assign(new Error('Stopped'),{name:'AbortError'}),new Error('Claude returned an ambiguous response.')]){
     const generate=vi.fn().mockRejectedValue(error);await expect(planTurn({provider:'claude'},ctx(),{title:'',url:'about:blank',text:''},[],generate)).rejects.toBe(error);expect(generate).toHaveBeenCalledOnce();
   }
   const mismatch=new ClaudeStreamMismatch(),generate=vi.fn().mockRejectedValue(mismatch);
   await expect(planTurn({provider:'claude'},ctx(),{title:'',url:'about:blank',text:''},[],generate)).rejects.toBe(mismatch);expect(generate).toHaveBeenCalledTimes(2);
   generate.mockClear();await expect(answerTurn({provider:'claude'},ctx(),'Read results',{status:'complete'},generate)).rejects.toBe(mismatch);expect(generate).toHaveBeenCalledOnce();
   const context=ctx(),controller=new AbortController();context.signal=controller.signal;
   const cancelled=vi.fn(async()=>{controller.abort(new Error('User stopped'));throw mismatch;});
   await expect(planTurn({provider:'claude'},context,{title:'',url:'about:blank',text:''},[],cancelled)).rejects.toThrow('User stopped');expect(cancelled).toHaveBeenCalledOnce();
 });
 it('repairs one incomplete plan with field-level feedback and no raw invalid content in events',async()=>{
   const context=ctx();context.message.content='Win this game.';
   const contract={success:['The current game shows its victory state.'],constraints:['Do not spend premium currency.'],progressOnly:[]};
   const generate=vi.fn().mockResolvedValueOnce(JSON.stringify({intent:'PRIVATE_INVALID_ENUM',reply:'I will play.'}))
     .mockResolvedValueOnce(JSON.stringify({intent:'act',reply:'I will play toward victory.',goal:'Win the current game without spending premium currency.',gameMode:'win',contract}));
   const result=await planTurn({provider:'claude'},context,{title:'Game',url:'https://game.example/',text:'Map'},[],generate);
   expect(result).toMatchObject({intent:'act',gameMode:'win',contract});
   expect(generate).toHaveBeenCalledTimes(2);
   expect(generate.mock.calls[1][1]).toContain('PLAN_SCHEMA_REPAIR');
   expect(generate.mock.calls[1][1]).toContain('intent: Use exactly chat, act or research');
   expect(generate.mock.calls[1][1]).toContain('goal: For act/research');
   expect(context.event).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({operation:'PLAN_RETRY',message:'Repairing invalid plan fields: intent, goal.'}));
   expect(JSON.stringify((context.event as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('PRIVATE_INVALID_ENUM');
 });
 it('bounds repeated schema failures and shares the retry limit with stream mismatch recovery',async()=>{
   const page={title:'Game',url:'https://game.example/',text:'Map'};
   for(const first of ['schema','stream'] as const) {
     const context=ctx(),generate=vi.fn().mockResolvedValue('{}');
     if(first==='stream')generate.mockRejectedValueOnce(new ClaudeStreamMismatch());
     await expect(planTurn({provider:'claude'},context,page,[],generate)).rejects.toThrow('incomplete plan');
     expect(generate).toHaveBeenCalledTimes(2);
     expect(context.event).toHaveBeenCalledTimes(1);
   }
   const malformed=vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce('{"intent":"chat","reply":"Ready."}');
   expect(await planTurn({provider:'claude'},ctx(),page,[],malformed)).toMatchObject({intent:'chat',reply:'Ready.'});
   expect(malformed).toHaveBeenCalledTimes(2);
 });
 it('does not deliver a repaired plan after cancellation or start a repair when already stopped',async()=>{
   const context=ctx(),controller=new AbortController();context.signal=controller.signal;
   let release:(text:string)=>void=()=>{};
   const generate=vi.fn().mockResolvedValueOnce('{}').mockImplementationOnce(()=>new Promise<string>(resolve=>{release=resolve;}));
   const execute=vi.fn(),planning=planTurn({provider:'claude'},context,{title:'Game',url:'https://game.example/',text:'Map'},[],generate).then(plan=>{execute(plan);return plan;});
   await eventually(()=>generate.mock.calls.length===2);
   controller.abort(new Error('User stopped'));
   release(JSON.stringify({intent:'act',reply:'Playing',goal:'Win the game',gameMode:'win'}));
   await expect(planning).rejects.toThrow('User stopped');
   expect(execute).not.toHaveBeenCalled();expect(generate).toHaveBeenCalledTimes(2);
   const stoppedContext=ctx(),stopped=new AbortController();stoppedContext.signal=stopped.signal;
   const abortBeforeRepair=vi.fn(async()=>{stopped.abort(new Error('User stopped'));return '{}';});
   await expect(planTurn({provider:'claude'},stoppedContext,{title:'Game',url:'https://game.example/',text:'Map'},[],abortBeforeRepair)).rejects.toThrow('User stopped');
   expect(abortBeforeRepair).toHaveBeenCalledOnce();expect(stoppedContext.event).not.toHaveBeenCalled();
 });
 it('preserves metric-specific success conditions through a Hebrew follow-up without replanning',async()=>{
   const context=ctx(),contract={success:['The board contains a tile valued 2048.'],constraints:[],progressOnly:['A cumulative score above 2048.']};
   const generate=vi.fn(async()=>JSON.stringify({intent:'act',reply:'I will pursue the target tile.',goal:'Reach the 2048 tile',gameMode:'win',contract}));
   const planned=await planTurn({provider:'openai'},context,{title:'Game',url:'https://game.example/',text:'Score 5000'},[],generate);
   expect(planned.contract).toEqual(contract);
   context.conversation.gameContext={mode:'win',url:'https://game.example/',goal:planned.goal,contract:planned.contract};context.message.content='המשך';
   const resumed=await planTurn({provider:'openai'},context,{title:'Game',url:'https://game.example/',text:'Score 6000'},[],generate);
   expect(resumed.contract).toEqual(contract);expect(generate).toHaveBeenCalledOnce();
 });
 it('rejects malformed conditions and task-review responses before they can affect execution',async()=>{
   await expect(planTurn({provider:'openai'},ctx(),{title:'',url:'about:blank',text:''},[],async()=>JSON.stringify({intent:'act',reply:'Search',goal:'Find two items',contract:{success:[],constraints:[],progressOnly:[]}}))).rejects.toThrow('success conditions');
   await expect(reviewTask({provider:'openai'},{goal:'Find two items'},new AbortController().signal,async()=>JSON.stringify({canProgress:'yes',strategy:'Search'}))).rejects.toThrow('invalid strategy');
 });
 it('accepts an omitted or null optional help query without discarding useful recovery advice',async()=>{
   for(const helpQuery of [undefined,null,''])expect(await reviewTask({provider:'openai'},{goal:'Read the table'},new AbortController().signal,async()=>JSON.stringify({canProgress:true,strategy:'Scroll to the table below the filters.',helpQuery}))).toEqual({canProgress:true,strategy:'Scroll to the table below the filters.'});
   await expect(reviewTask({provider:'openai'},{},new AbortController().signal,async()=>JSON.stringify({canProgress:true,strategy:'Read the table',helpQuery:42}))).rejects.toThrow('invalid help query');
 });
 it('keeps final response requirements separate from observable page conditions',async()=>{
   const contract={success:['The requested count is visible.'],constraints:[],progressOnly:[],responseRequirements:['Return a JSON object containing a numeric count.']};
   const plan=await planTurn({provider:'openai'},ctx(),{title:'Results',url:'https://example.test',text:'3 results'},[],async(_config,prompt)=>{
     expect(prompt).toContain('must never be included in success');
     return JSON.stringify({intent:'act',reply:'Checking the count',goal:'Read the count',contract});
   });
   expect(plan.contract).toEqual(contract);
 });
 it('accepts a bounded game task with the requested objective and restrictions intact',async()=>{
   const context=ctx();context.message.content='Inspect owned territory, queue one ordinary-resource construction, and verify it is queued. Do not spend premium currency.';
   const contract={success:['An ordinary-resource construction is observed in the queue.'],constraints:['Inspect only owned territory.','Do not spend premium currency.'],progressOnly:['A province is selected.']};
   const generate=vi.fn(async(_config,prompt)=>{
     expect(prompt).toContain('gameMode="task"');
     expect(prompt).toContain('same observed map/canvas and DOM controls');
     expect(prompt).toContain('A game mode is not additional authority');
     expect(prompt).toContain('Previous assistant claims of inability are not current evidence');
     const schema=prompt.split('For act/research return JSON: ')[1].split('\nSet responseFormat=')[0];
     expect(schema).toContain('"intent":"act|research", "gameMode":"win|task|demo"');
     return JSON.stringify({intent:'act',reply:'I will inspect the map and verify the requested queue.',goal:context.message.content,gameMode:'task',contract});
   });
   const result=await planTurn({provider:'claude'},context,{title:'Strategy map',url:'https://game.example/',text:'Owned territory and resources'},[],generate);
   expect(result).toMatchObject({intent:'act',gameMode:'task',goal:context.message.content,contract});
   expect(result.contract?.allowFormSubmission).toBeUndefined();
   context.conversation.gameContext={mode:'task',goal:result.goal,url:'https://game.example/',contract:result.contract};context.message.content='continue';
   const resumed=await planTurn({provider:'claude'},context,{title:'Strategy map',url:'https://game.example/',text:'Construction queue'},[],generate);
   expect(resumed).toMatchObject({gameMode:'task',goal:result.goal,contract:result.contract,reusedGameContext:true});
   expect(generate).toHaveBeenCalledOnce();
 });
 it('keeps a non-game website request ordinary even on a game-related page',async()=>{
   const context=ctx();context.message.content='Read the support article about construction queues.';
   const result=await planTurn({provider:'claude'},context,{title:'Game support',url:'https://game.example/help',text:'Construction queue article'},[],async()=>JSON.stringify({intent:'act',reply:'I will read the article.',goal:context.message.content,contract:{success:['The article content is observed.'],constraints:[],progressOnly:[]}}));
   expect(result.intent).toBe('act');expect(result.gameMode).toBeUndefined();
 });
 it.each(['solve','match','',null,3])('rejects unsupported game mode %s after one bounded schema repair',async gameMode=>{
   const generate=vi.fn(async()=>JSON.stringify({intent:'act',reply:'Playing',goal:'Play the game',gameMode}));
   await expect(planTurn({provider:'claude'},ctx(),{title:'Game',url:'https://game.example/',text:'Map'},[],generate)).rejects.toThrow('unsupported game objective');
   expect(generate).toHaveBeenCalledTimes(2);
 });
 it.each(['chat','research'])('rejects task game mode for %s intent',async intent=>{
   const generate=vi.fn(async()=>JSON.stringify({intent,reply:'Ready',goal:'Read game rules',gameMode:'task'}));
   await expect(planTurn({provider:'claude'},ctx(),{title:'Game',url:'https://game.example/',text:'Rules'},[],generate)).rejects.toThrow('unsupported game objective');
   expect(generate).toHaveBeenCalledTimes(2);
 });
 it.each(['demo','win','task'] as const)('resumes a %s game without replanning or changing its objective',async mode=>{
   const context=ctx();context.message.content='play';context.conversation.gameContext={mode,url:'https://game.example/',goal:'Continue the authorized game objective.'};
   const generate=vi.fn();
   const result=await planTurn({provider:'openai'},context,{title:'Game',url:'https://game.example/',text:'Score 12'},[],generate);
   expect(generate).not.toHaveBeenCalled();expect(result).toMatchObject({gameMode:mode,goal:context.conversation.gameContext.goal,reusedGameContext:true});expect(result.startUrl).toBeUndefined();
 });
 it('replans game follow-ups when the page or requested objective changes',async()=>{
   const context=ctx();context.message.content='play';context.conversation.gameContext={mode:'demo',url:'https://game.example/',goal:'Play a quick demonstration.'};
   const generate=vi.fn(async()=>JSON.stringify({intent:'chat',reply:'New context'}));
   await planTurn({provider:'openai'},context,{title:'Different page',url:'https://different.example/',text:''},[],generate);
   context.message.content='play until you win';
   await planTurn({provider:'openai'},context,{title:'Game',url:'https://game.example/',text:''},[],generate);
   expect(generate).toHaveBeenCalledTimes(2);
 });
 it('uses full context and streams readable answer text without JSON syntax',async()=>{
   const context=ctx();const generate=vi.fn(async(_c,p,_s,delta)=>{expect(p).toContain('Paris for two');expect(p).toContain('Now London');expect(p).toContain('Page says Paris');const raw=JSON.stringify({reply:'I’ll search London.',intent:'act',goal:'Find London for two under 200',memory:'Two people under 200'});for(const char of raw)delta?.(char);return raw;});
   const plan=await planTurn({provider:'openai'},context,{title:'Search',url:'https://example.com',text:'Page says Paris'},[],generate);
   expect(plan.goal).toBe('Find London for two under 200');expect(context.update).toHaveBeenLastCalledWith('I’ll search London.');
 });
 it('accepts a minimal chat answer without requiring or replacing durable memory',async()=>{
   const context=ctx();
   const result=await planTurn({provider:'openai'},context,{title:'',url:'about:blank',text:''},[],async()=>JSON.stringify({reply:'  The same two-person budget still applies.  ',intent:'chat'}));
   expect(result).toMatchObject({intent:'chat',reply:'The same two-person budget still applies.',goal:'',memory:'Two people'});
   expect(result.research).toBeUndefined();
   expect(context.conversation.memory).toBe('Two people');
 });
 it('normalizes bounded research requests and preserves observed existing tab references',async()=>{
   const tabs=[{id:'tab-a',title:'A',url:'https://a.example/'}];
   const generate=async()=>JSON.stringify({intent:'research',reply:'I’ll compare the sources.',goal:'Compare current prices',research:{queries:[' prices ','prices'],urls:[' https://a.example/pricing#plan '],tabIds:['tab-a','tab-a'],followLinks:true}});
   const plan=await planTurn({provider:'openai'},ctx(),{title:'',url:'about:blank',text:''},tabs,generate);
   expect(plan.research).toEqual({queries:['prices'],urls:['https://a.example/pricing'],tabIds:['tab-a'],followLinks:true});
 });
 it.each([
   ['non-array queries',{queries:'prices'}],
   ['non-string queries',{queries:[42]}],
   ['empty queries',{queries:['  ']}],
   ['oversized query text',{queries:['x'.repeat(501)]}],
   ['too many queries',{queries:['one','two','three','four']}],
   ['too many source URLs',{urls:Array.from({length:9},(_,index)=>`https://example.com/${index}`)}],
   ['executable source URLs',{urls:['javascript:alert(1)']}],
   ['credential-bearing source URLs',{urls:['https://user:secret@example.com']}],
   ['unknown source tabs',{tabIds:['missing']}],
   ['non-string source tabs',{tabIds:[null]}],
 ])('rejects %s in a research source request',async(_label,research)=>{
   const generate=async()=>JSON.stringify({intent:'research',reply:'I’ll read the sources.',goal:'Compare prices',research});
   await expect(planTurn({provider:'openai'},ctx(),{title:'',url:'about:blank',text:''},[],generate)).rejects.toThrow();
 });
 it('makes the user’s selected pages authoritative over model-proposed discovery',async()=>{
   const context=ctx();context.message.sourceTabIds=['tab-b'];context.message.mode='research';
   const tabs=[{id:'tab-a',title:'A',url:'https://a.example/'},{id:'tab-b',title:'B',url:'https://b.example/'}];
   const generate=vi.fn(async(_config,prompt)=>{
     expect(prompt).toContain('EXPLICIT_SOURCE_TAB_IDS: ["tab-b"]');
     return JSON.stringify({intent:'research',reply:'I’ll compare the pages.',goal:'Compare prices',research:{queries:['additional prices'],urls:['https://extra.example/'],tabIds:['tab-a'],followLinks:true}});
   });
   const plan=await planTurn({provider:'openai'},context,{title:'',url:'about:blank',text:''},tabs,generate);
   expect(plan.research).toMatchObject({queries:[],urls:[],tabIds:['tab-b']});
   expect(plan.research?.followLinks).not.toBe(true);
 });
 it('makes empty user scope web-only even when the model proposes existing tabs',async()=>{
   const context=ctx();context.message.sourceTabIds=[];context.message.mode='research';
   const tabs=[{id:'tab-a',title:'Unselected page',url:'https://a.example/'}];
   const generate=async()=>JSON.stringify({intent:'research',reply:'I’ll find new sources.',goal:'Current train prices',research:{queries:[],urls:[],tabIds:['tab-a']}});
   const plan=await planTurn({provider:'openai'},context,{title:'',url:'about:blank',text:''},tabs,generate);
   expect(plan.research).toMatchObject({queries:['Current train prices'],urls:[],tabIds:[]});
 });
 it('rejects model-generated executable URLs and unknown tabs',async()=>{
   for(const extra of [{startUrl:'javascript:alert(1)'},{startUrl:'https://user:password@example.com'},{tabId:'invented'}]) {
     const generate=async()=>JSON.stringify({reply:'Opening',intent:'act',goal:'Search',memory:'',...extra});
     await expect(planTurn({provider:'openai'},ctx(),{title:'',url:'about:blank',text:''},[],generate)).rejects.toThrow();
   }
 });
 it('uses observed controls instead of a guessed internal route, while accepting user and observed URLs',async()=>{
   const context=ctx(),url='https://example.test/project/issues?order=recent';
   const generate=async()=>JSON.stringify({reply:'Opening issues',intent:'act',goal:'Show recent issues',startUrl:url});
   const page={title:'Project',url:'https://example.test/project',text:'Issues'};
   expect((await planTurn({provider:'openai'},context,page,[],generate)).startUrl).toBeUndefined();
   expect((await planTurn({provider:'openai'},context,{...page,links:[url]},[],generate)).startUrl).toBe(url);
   context.message.content='Open '+url;
   expect((await planTurn({provider:'openai'},context,page,[],generate)).startUrl).toBe(url);
 });
 it('includes observed result and verification limits when producing the actual answer',async()=>{
   const generate=vi.fn(async(_c,p)=>{expect(p).toContain('London Hotel 180');expect(p).toContain('not independent verification');return '{"reply":"London Hotel is 180 for two guests."}';});
   expect(await answerTurn({provider:'openai'},ctx(),'London under 200',{status:'complete',verified:false,page:{text:'London Hotel 180'}},generate)).toContain('180');
 });
 it('serializes a requested JSON value without a Markdown or prose suffix',async()=>{
   const generate=vi.fn(async()=>JSON.stringify({reply:{count:6,complete:true}}));
   expect(JSON.parse(await answerTurn({provider:'openai'},ctx(),'Return the count as JSON',{page:{text:'6 results'}},generate,'json'))).toEqual({count:6,complete:true});
   expect(generate).toHaveBeenCalledOnce();
 });
 it('retries malformed structured output once using observed evidence, without repairing answer values',async()=>{
   const generate=vi.fn().mockResolvedValueOnce(JSON.stringify({reply:'{"count":6}\nNote: additional prose'})).mockResolvedValueOnce(JSON.stringify({reply:{count:6}}));
   expect(await answerTurn({provider:'openai'},ctx(),'Return JSON',{page:{text:'6 results'}},generate,'json')).toBe('{"count":6}');
   expect(generate).toHaveBeenCalledTimes(2);expect(generate.mock.calls[1][1]).toContain('FORMAT_VALIDATION');expect(generate.mock.calls[1][1]).toContain('6 results');
 });
 it('reports a repeated JSON formatting failure instead of silently stripping arbitrary text',async()=>{
   const generate=vi.fn(async()=>JSON.stringify({reply:'Not valid JSON'}));
   await expect(answerTurn({provider:'openai'},ctx(),'Return JSON',{},generate,'json')).rejects.toThrow('valid JSON');expect(generate).toHaveBeenCalledTimes(2);
 });
 it('prepares only unique observed fields, preserving the full latest message',async()=>{
   const context=ctx();context.message.content='x'.repeat(11500)+' KEEP THIS FINAL CORRECTION';
   expect(conversationContext(context.conversation,context.message.id).messages.at(-1)?.content).toContain('KEEP THIS FINAL CORRECTION');
   const generate=async()=>JSON.stringify({reply:'Searching',intent:'act',goal:'Search London',memory:'',fieldValues:[{label:'Destination',value:'London'},{label:'Absent field',value:'invented'},{label:'Duplicate',value:'bad'}]});
   const result=await planTurn({provider:'openai'},context,{title:'',url:'https://example.com',text:'',fields:[{label:'Destination'},{label:'Duplicate'},{label:'Duplicate'}]},[],generate);
   expect(result.fieldValues).toEqual([{label:'Destination',value:'London'}]);
 });
 it('does not reuse a prepared value in a later same-URL form stage',()=>{
   const plan={intent:'act' as const,reply:'',goal:'Two legs',memory:'',fieldValues:[{label:'Destination',value:'Paris'}]};
   const page={url:'https://example.com',title:'',text:''};const used=new Set<string>();
   expect(takePreparedField(plan,page,'https://other.example','Destination',used)).toBeUndefined();
   expect(takePreparedField(plan,page,page.url,'Destination',used)).toBe('Paris');
   expect(takePreparedField(plan,page,page.url,'Destination',used)).toBeUndefined();
 });
 it('quotes a newly observed page result only for completed simple tasks',()=>{
   const plan={reply:'Searching',intent:'act' as const,goal:'London for two',memory:'',replyFromPageStatus:true};
   const before={title:'Form',url:'https://example.com',text:'',statuses:['Awaiting search']};
   const after={...before,statuses:['London for two guests']};
   expect(pageStatusAnswer(plan,before,after,{status:'complete',steps:2})).toBe('The page reports:\n\n> London for two guests');
   expect(pageStatusAnswer(plan,before,before,{status:'complete',steps:2})).toBeUndefined();
   expect(pageStatusAnswer(plan,before,after,{status:'blocked',steps:2})).toBeUndefined();
   expect(pageStatusAnswer(plan,before,after,{status:'complete',steps:0})).toBeUndefined();
   expect(pageStatusAnswer({...plan,replyFromPageStatus:false},before,after,{status:'complete',steps:2})).toBeUndefined();
   expect(pageStatusAnswer(plan,before,{...after,statuses:['London','Another result']},{status:'complete',steps:2})).toBeUndefined();
 });
 it('decodes split escaped strings and unicode safely',()=>{
   expect(streamedReply('{"reply":"Hello\\nworld\\u')).toBe('Hello\nworld');
   expect(streamedReply('{"reply":"Hello\\nworld\\u0021"}')).toBe('Hello\nworld!');
   expect(streamedReply('{"intent":"chat"')).toBe('');
 });
});
