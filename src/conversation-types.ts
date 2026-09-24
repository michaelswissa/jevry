import type {AgentEvent,ResearchResult} from './types';
import type {TaskContract} from './task-contract';
export type ConversationMode='auto'|'act'|'research';
export type MessageStatus='queued'|'streaming'|'running'|'complete'|'error'|'stopped';
export interface ChatMessage {
 id:string; role:'user'|'assistant'; content:string; status:MessageStatus;
 createdAt:number; events:AgentEvent[]; research?:ResearchResult; error?:string;
 mode?:ConversationMode; replyTo?:string; durationMs?:number; tabId?:string;
 sourceTabIds?:string[];
}
export interface Conversation {
 id:string; title:string; messages:ChatMessage[]; createdAt:number; updatedAt:number;
 memory:string; lastGoal?:string; tabId?:string;
 gameContext?:{mode:'win'|'task'|'demo';url:string;goal:string;contract?:TaskContract};
}
export interface ConversationSnapshot {
 conversations:Conversation[]; activeConversationId:string|null;
}
