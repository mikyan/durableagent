// Shared data-only public Interface. No SDK/native/storage objects cross this boundary.
export const APPLICATION_PROTOCOL=1;
// Data only. UI and Agent load their own implementation for this shared identity.
export const CONVERSATION_EXTENSION={id:'conversation',actions:['list','create','open','history','send','subscribe','unsubscribe']} as const;
export type ApplicationPhase='opening'|'configuring'|'ready'|'failed'|'closed';
export type ConversationPhase='idle'|'running'|'waiting'|'failed'|'done'|'stopped';
export type ModelSelection={provider:string;modelId:string;name:string};
export type ConversationSummary={id:string;title:string;model:ModelSelection;workspaceId:string;projectId:null;createdAt:number;phase:ConversationPhase};
export type HistoryAttachment={kind:'image';mimeType:string;sha256:string;byteLength:number};
export type HistoryMessage={id:string;role:'user'|'assistant'|'tool'|'system';text:string;persisted:true;attachments?:HistoryAttachment[]};
export type HistoryPage={items:HistoryMessage[];next?:string};
export type ConversationSnapshot={id:string;revision:number;conversation:ConversationSummary;entries:HistoryMessage[];progress?:{text:string;persisted:false};phase:ConversationPhase;storedSeq:number|null;reason?:string};
export type ApplicationStatus={phase:ApplicationPhase;reason?:string;extensions:string[]};
export type ApplicationMethod='status'|'list'|'create'|'open'|'history'|'send'|'stop'|'subscribe'|'unsubscribe'|import('./model-protocol.js').ModelConfigurationMethod|import('./input-protocol.js').InputMethod;
export type ApplicationRequest={protocol:number;connectionId:string;requestId:string;method:ApplicationMethod;payload?:Record<string,unknown>};
export type ApplicationError={code:string;message:string};
export type ApplicationResponse={type:'response';protocol:1;connectionId:string;requestId:string;ok:true;value:unknown}|{type:'response';protocol:1;connectionId:string;requestId:string;ok:false;error:ApplicationError};
export type ApplicationEvent={type:'conversation';protocol:1;connectionId:string;subscriptionId:string;snapshot:ConversationSnapshot};
export type ApplicationEnvelope=ApplicationResponse|ApplicationEvent;
/**
 * Native bridge: window.DurableNative.postMessage(JSON.stringify(request)).
 * Incoming envelope: window.__durableReceive(envelope). No polling/eval/SQL API.
 * Each new page/controller uses a fresh connectionId; discard other generations.
 * status -> ApplicationStatus; list -> {conversations:ConversationSummary[]};
 * create {creationId,title?} -> {conversation:ConversationSummary,storedSeq};
 * open {id} -> ConversationSnapshot; history {id,cursor?,limit?} -> HistoryPage;
 * send {id,text,actionId} -> {submissionId,storedSeq,status:'accepted'};
 * stop {id,actionId} -> {storedSeq,status:'stopped'};
 * subscribe {id,subscriptionId} -> ConversationSnapshot, then conversation events;
 * unsubscribe {subscriptionId} -> {}. It never aborts the Agent.
 */
