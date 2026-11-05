// Shared data-only public Interface. No SDK/native/storage objects cross this boundary.
export const APPLICATION_PROTOCOL=1;
// Data only. UI and Agent load their own implementation for this shared identity.
export const CONVERSATION_EXTENSION={id:'conversation',actions:['list','create','open','history','context.get','send','subscribe','unsubscribe']} as const;
export type ApplicationPhase='opening'|'configuring'|'ready'|'failed'|'closed';
export type ConversationPhase='idle'|'running'|'waiting'|'failed'|'done'|'stopped';
export type ModelSelection={provider:string;modelId:string;name:string};
export type ConversationSummary={id:string;title:string;model:ModelSelection;workspaceId:string;projectId:string|null;createdAt:number;phase:ConversationPhase;submissionContext?:import('./submission-protocol.js').SubmissionContext};
export type HistoryAttachment={kind:'image';mimeType:string;sha256:string;byteLength:number};
export type HistoryMessage={id:string;role:'user'|'assistant'|'tool'|'system';text:string;persisted:true;attachments?:HistoryAttachment[]};
export type HistoryPage={items:HistoryMessage[];next?:string};
export type ConversationContext={id:string;state:'estimated'|'unavailable';tokens?:number;modelLimit?:number;messages:number;scope:'committed-messages';note:string};
export type ConversationActivity={kind:'thinking'|'tool'|'model';label?:string};
export type ConversationSnapshot={id:string;revision:number;conversation:ConversationSummary;entries:HistoryMessage[];progress?:{text:string;persisted:false};activity?:ConversationActivity;phase:ConversationPhase;storedSeq:number|null;reason?:string;recovery?:import('./recovery.js').RecoveryStatus};
export type ApplicationStatus={phase:ApplicationPhase;reason?:string;extensions:string[];failure?:import('./storage-failure.js').StorageFailure;readOnly?:boolean};
export type ApplicationMethod=import('./data-saver-protocol.js').DataSaverMethod|import('./document-protocol.js').DocumentMethod|import('./extension-protocol.js').ExtensionMethod|import('./routing-protocol.js').RoutingMethod|'host.reconnect'|'execution.connect'|'execution.copySetup'|'execution.openDownload'|'execution.query'|'execution.cancel'|'execution.list'|'execution.readOutput'|'files.list'|'status'|'list'|'create'|'open'|'history'|'context.get'|'send'|'stop'|'subscribe'|'unsubscribe'|import('./project-protocol.js').ProjectMethod|import('./model-protocol.js').ModelConfigurationMethod|import('./input-protocol.js').InputMethod|import('./submission-protocol.js').SendMethod;
export type ApplicationRequest={protocol:number;connectionId:string;requestId:string;method:ApplicationMethod;payload?:Record<string,unknown>};
export type ApplicationError={code:string;message:string};
export type ApplicationResponse={type:'response';protocol:1;connectionId:string;requestId:string;ok:true;value:unknown}|{type:'response';protocol:1;connectionId:string;requestId:string;ok:false;error:ApplicationError};
export type ApplicationEvent={type:'subscription-error';protocol:1;connectionId:string;subscriptionId:string;error:ApplicationError}|{type:'conversation';protocol:1;connectionId:string;subscriptionId:string;snapshot:ConversationSnapshot};
export type ApplicationEnvelope=ApplicationResponse|ApplicationEvent;
/**
 * Native bridge: window.DurableNative.postMessage(JSON.stringify(request)).
 * Incoming envelope: window.__durableReceive(envelope). No polling/eval/SQL API.
 * Each new page/controller uses a fresh connectionId; discard other generations.
 * host.reconnect {} -> native owner retry acknowledgement before status refresh;
 * native-selected domain only; an existing owner is preserved and no input is replayed.
 * status -> ApplicationStatus; list -> {conversations:ConversationSummary[]};
 * create {creationId,title?} -> {conversation:ConversationSummary,storedSeq};
 * open {id} -> ConversationSnapshot; history {id,cursor?,limit?} -> HistoryPage;
 * send {intentId} -> SendStatus (see submission-protocol); direct text is not an admission identity.
 * stop {id,stopId} -> {control,status:'stopped'} after the native stop fact is committed;
 * subscribe {id,subscriptionId} -> ConversationSnapshot, then conversation events;
 * unsubscribe {subscriptionId} -> {}. It never aborts the Agent.
 */
