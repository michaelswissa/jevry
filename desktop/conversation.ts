import {randomUUID} from 'node:crypto';
import type {Conversation, ConversationMode, ConversationSnapshot, ChatMessage} from '../src/conversation-types';
import type {AgentEvent, Result} from '../src/types';

export interface TurnContext {
 conversation: Conversation;
 message: ChatMessage;
 answer: ChatMessage;
 signal: AbortSignal;
 update: (content: string, status?: ChatMessage['status']) => void;
 event: (event: AgentEvent) => void;
}
export type TurnExecutor = (context: TurnContext) => Promise<void>;
type Pending = {conversation: Conversation; message: ChatMessage; answer: ChatMessage};

/** One owner of browser mutations. A follow-up cancels and drains its predecessor. */
export class Conversations {
 private data: ConversationSnapshot;
 private controller?: AbortController;
 private pending?: Pending;
 private executing?: Pending;
 private pumping = false;
 private flushTimer?: ReturnType<typeof setTimeout>;
 constructor(snapshot: ConversationSnapshot, private execute: TurnExecutor,
   private save: (data: ConversationSnapshot) => void, private changed: () => void) {
   this.data = snapshot;
   for (const c of this.data.conversations) for (const m of c.messages) {
     if (['queued','streaming','running'].includes(m.status)) {
       m.status = 'stopped'; m.content ||= 'Interrupted when the browser closed. Send a message to continue.';
     }
   }
   if (!this.data.conversations.some(c => c.id === this.data.activeConversationId)) this.data.activeConversationId = this.data.conversations[0]?.id ?? null;
 }
 snapshot() { return this.data; }
 get running() { return this.pumping || !!this.pending; }
 active() { return this.data.conversations.find(c => c.id === this.data.activeConversationId); }
 private publish(persist = false) {
   if (persist) this.save(this.data);
   if (!this.flushTimer) this.flushTimer = setTimeout(() => {this.flushTimer=undefined; this.changed();}, 50);
 }
 newConversation(): Result {
   this.stop();
   const now=Date.now();
   const c:Conversation={id:randomUUID(),title:'New conversation',messages:[],createdAt:now,updatedAt:now,memory:''};
   this.data.conversations.unshift(c); this.data.activeConversationId=c.id;
   this.publish(true); return {ok:true,id:c.id};
 }
 select(id:string): Result {
   if (!this.data.conversations.some(c=>c.id===id)) return {ok:false,message:'This conversation was not found.'};
   this.stop(); this.data.activeConversationId=id; this.publish(true); return {ok:true};
 }
 rename(id:string,title:string): Result {
   const conversation=this.data.conversations.find(c=>c.id===id);
   if(!conversation)return {ok:false,message:'This conversation was not found.'};
   if(typeof title!=='string'||!title.trim()||title.trim().length>120)return {ok:false,message:'Use a title between 1 and 120 characters.'};
   const previous=conversation.title;conversation.title=title.trim();
   try{this.publish(true);}catch(error){conversation.title=previous;return {ok:false,message:error instanceof Error?error.message:'Could not rename the conversation.'};}
   return {ok:true};
 }
 delete(id:string): Result {
   if(!this.data.conversations.some(c=>c.id===id))return {ok:false,message:'This conversation was not found.'};
   const previous=this.data;
   this.data={conversations:this.data.conversations.filter(c=>c.id!==id),activeConversationId:this.data.activeConversationId};
   if(this.data.activeConversationId===id)this.data.activeConversationId=this.data.conversations[0]?.id??null;
   try{this.publish(true);}catch(error){this.data=previous;return {ok:false,message:error instanceof Error?error.message:'Could not delete the conversation.'};}
   if(this.executing?.conversation.id===id)this.controller?.abort();
   if(this.pending?.conversation.id===id)this.pending=undefined;
   return {ok:true};
 }
 send(input: {text:string;mode?:ConversationMode;sourceTabIds?:string[]}): Result {
   if (!input || typeof input.text!=='string' || !input.text.trim() || input.text.length>12000)
     return {ok:false,message:'Enter a message under 12,000 characters.'};
   if (input.mode && !['auto','act','research'].includes(input.mode)) return {ok:false,message:'Unknown conversation mode.'};
   if(input.sourceTabIds!==undefined&&(!Array.isArray(input.sourceTabIds)||input.sourceTabIds.length>8||input.sourceTabIds.some(id=>typeof id!=='string')||new Set(input.sourceTabIds).size!==input.sourceTabIds.length))return {ok:false,message:'Select up to eight distinct source pages.'};
   if (!this.active()) this.newConversation();
   const conversation=this.active()!, now=Date.now();
   const message:ChatMessage={id:randomUUID(),role:'user',content:input.text.trim(),status:'complete',createdAt:now,events:[],mode:input.mode||'auto',sourceTabIds:input.sourceTabIds?.slice()};
   const answer:ChatMessage={id:randomUUID(),role:'assistant',content:'',status:'queued',createdAt:now,events:[],replyTo:message.id,mode:message.mode};
   if (conversation.messages.length===0) conversation.title=message.content.slice(0,64);
   conversation.messages.push(message,answer); conversation.updatedAt=now;
   this.stop();
   this.pending={conversation,message,answer};
   try { this.publish(true); } catch (e) {
     this.pending=undefined; conversation.messages.splice(-2);
     return {ok:false,message:e instanceof Error?e.message:'Could not save your message.'};
   }
   void this.pump(); return {ok:true,id:message.id};
 }
 stop() {
   this.controller?.abort();
   if(this.pending) { this.pending.answer.status='stopped'; this.pending.answer.content='Replaced by your next message.'; this.pending=undefined; }
   this.publish();
 }
 private async pump() {
   if(this.pumping) return;
   this.pumping=true;
   try {
     while(this.pending) {
       const item=this.pending; this.pending=undefined;this.executing=item;
       const controller=this.controller=new AbortController(), start=Date.now();
       const current=()=>this.executing===item&&this.controller===controller&&this.data.conversations.includes(item.conversation);
       item.answer.status='streaming'; this.publish();
       try {
         await this.execute({...item,signal:controller.signal,
           update:(content,status='streaming')=>{if(current()&&!controller.signal.aborted){item.answer.content=content;item.answer.status=status;this.publish();}},
           event:event=>{
             // A dispatched input may finish reporting while cancellation drains.
             // Keep executor receipts only until this exact turn settles.
             if(!current()||(controller.signal.aborted&&!['action','complete','blocked','error','stopped'].includes(event.type)))return;
             item.answer.events.push(event);if(item.answer.events.length>300)item.answer.events.shift();this.publish();
           }
         });
         if(controller.signal.aborted) throw new DOMException('Stopped','AbortError');
         if(!['error','stopped'].includes(item.answer.status)) item.answer.status='complete';
       } catch(e) {
         if(controller.signal.aborted) {
           item.answer.status='stopped';
           // Partial plans are not answers or proof of completed work.
           item.answer.content ||= 'Stopped. Your next message continues this conversation.';
         } else {
           item.answer.status='error'; item.answer.error=e instanceof Error?e.message:'The request failed.';
           item.answer.content='I couldn’t finish this turn. You can retry or send a follow-up.';
         }
       } finally {
         item.answer.durationMs=Date.now()-start; item.conversation.updatedAt=Date.now();
         if(this.controller===controller)this.controller=undefined;
         if(this.executing===item)this.executing=undefined;
         try {this.publish(true);} catch(e) {item.answer.error='This conversation could not be saved. Keep the app open and unlock your system credential store.';item.answer.status='error';}
       }
     }
   } finally {this.pumping=false;this.publish();}
 }
}

function receiptText(value:string|undefined,limit:number) {
 if(!value)return undefined;
 let text=value.slice(0,limit);
 // Count escaped characters too: receipts must not consume the transcript budget.
 while(JSON.stringify(text).length>limit+2)text=text.slice(0,Math.max(0,text.length-(JSON.stringify(text).length-limit-2)));
 return text;
}
function receiptUrl(value:string|undefined) {
 if(!value)return undefined;
 try {
   const url=new URL(value);
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>1024)return undefined;
   return url.href;
 } catch {return undefined;}
}
function executionReceipt(message:ChatMessage) {
 if(message.role!=='assistant')return undefined;
 const actions=message.events.filter(event=>event.type==='action');
 const terminal=[...message.events].reverse().find(event=>['complete','blocked','error','stopped'].includes(event.type));
 if(!actions.length&&!message.error&&!['error','stopped'].includes(message.status)&&!['blocked','error','stopped'].includes(terminal?.type||''))return undefined;
 const observation=[...message.events].reverse().find(event=>event.type==='observation'&&receiptUrl(event.url));
 const receipt={
   tabId:receiptText(message.tabId,120),
   lastObservedUrl:receiptUrl(observation?.url),
   recordedActionCount:actions.length,
   omittedActionCount:Math.max(0,actions.length-6),
   performedActions:actions.slice(-6).map(event=>({operation:receiptText(event.operation,40),description:receiptText(event.message,240),url:receiptUrl(event.url)})),
   reportedOutcome:{status:terminal?.type||(['error','stopped'].includes(message.status)?message.status:'unknown'),verified:terminal?.type==='complete'&&terminal.verified===true,detail:receiptText(terminal?.message,240)},
   error:receiptText(message.error,400),
 };
 while(JSON.stringify(receipt).length>4000&&receipt.performedActions.length) {
   receipt.performedActions.shift();receipt.omittedActionCount++;
 }
 return receipt;
}

/** The serialized recent transcript, including receipts and research, fits 26k characters. */
export function conversationContext(conversation:Conversation, currentId:string) {
 const index=conversation.messages.findIndex(m=>m.id===currentId);
 const messages=conversation.messages.slice(0,index+1);
 let budget=26000-2; // JSON array brackets; commas are deducted for each later entry.
 const recent:Array<{role:string;content:string;status:string;execution?:ReturnType<typeof executionReceipt>;sources?:unknown;findings?:unknown}>=[];
 for(const m of [...messages].reverse()) {
   if(budget<=0)break;
   const execution=executionReceipt(m);
   if(!m.content&&!execution)continue;
   const available=budget-(recent.length?1:0);
   const entry={role:m.role,content:'',status:m.status,...(execution?{execution}:{})};
   const overhead=JSON.stringify(entry).length;
   if(overhead>available)break;
   entry.content=m.content.slice(0,Math.min(m.id===currentId?12000:8000,available-overhead));
   while(JSON.stringify(entry).length>available)entry.content=entry.content.slice(0,Math.max(0,entry.content.length-(JSON.stringify(entry).length-available)));
   if(!entry.content&&!execution)break;
   const evidence=m.research ? {sources:m.research.sources.slice(0,8),findings:m.research.findings.slice(0,6).map(f=>({...f,text:f.text.slice(0,800)}))}:{};
   const withEvidence={...entry,...evidence};
   const selected=JSON.stringify(withEvidence).length<=available?withEvidence:entry;
   budget-=JSON.stringify(selected).length+(recent.length?1:0);recent.unshift(selected);
 }
 const first=messages.find(m=>m.role==='user');
 return {memory:conversation.memory.slice(0,5000),previousGoal:conversation.lastGoal||'',initialRequest:first?.content.slice(0,5000),messages:recent};
}
