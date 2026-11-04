import type {NativeDraft} from './input-protocol.js';

/** Data only. Native owns explicit intent/control facts; SDK owns accepted input progress. */
export const SUBMISSION_EXTENSION={id:'submission',actions:['send','sendStatus','sendList']} as const;
export type SendMethod='sendStatus'|'sendList';
export type NativeSendMethod='input.createSend'|'input.readSend'|'input.listSends'|'input.readControl'|'input.stop';
export type LocationExpectation={workspaceId:string;version:number;identity:string};
export type SubmissionContext={sdkConversationId:number;associationVersion:number;location:LocationExpectation};
export type QueuePolicy={whenBusy:'followUp';whenIdle:'start'};
export const DEFAULT_QUEUE:QueuePolicy={whenBusy:'followUp',whenIdle:'start'};
export type StopBarrier={stopId:string;throughGeneration:number;context:SubmissionContext};
export type NativeControl={id:string;version:number;generation:number;stoppedThrough:number;pendingAbort?:StopBarrier};
export type AdmissionReceipt={protocol:1;intentId:string;id:string;inputToken:string;inputRevision:number;inputDigest:string;context:SubmissionContext;queue:QueuePolicy;controlGeneration:number;bindingId:string;submissionId:number};
export type NativeSendIntent={
  protocol:1;intentId:string;actionId:string;id:string;
  inputToken:string;inputRevision:number;inputDigest:string;
  context:SubmissionContext;queue:QueuePolicy;controlGeneration:number;createdAt:number;
  preview:{text:string;attachmentCount:number};
  stateVersion:number;delivery:'pending'|'uncertain'|'acknowledged';cancelled:boolean;
  receipt?:AdmissionReceipt;
};
export type CreateSend={actionId:string;id:string;inputToken:string;expectedContext:SubmissionContext;expectedControlVersion:number;queue:QueuePolicy};
export type RequestStop={id:string;actionId:string;expectedControlVersion:number};
export type NativeAdmissionAck={intent:NativeSendIntent;draftCleared:boolean;draft:NativeDraft};
export type SendIntentPage={intents:NativeSendIntent[];next?:string};
export type SubmissionProgress={status:'queued'|'placed'|'done'|'unanswered';entryId?:string;answerEntryId?:string;reason?:string};
export type SendStatus={intent:NativeSendIntent;accepted:boolean;receipt?:AdmissionReceipt;submission?:SubmissionProgress;waiting?:{code:string;message:string};acknowledgement?:NativeAdmissionAck};
/** Trusted runtime/native adapter. No draft read or source I/O can reconstruct an existing intent. */
export type SendAuthority={
  readSend(intentId:string):Promise<NativeSendIntent>;
  listSends(options?:{id?:string;cursor?:string;limit?:number}):Promise<SendIntentPage>;
  markDeliveryUnknown(intentId:string):Promise<NativeSendIntent>;
  confirmAdmission(intentId:string,receipt:AdmissionReceipt):Promise<NativeAdmissionAck>;
  readControl(id:string):Promise<NativeControl>;
  pendingStops():Promise<{id:string;control:NativeControl}[]>;
  confirmAbort(id:string,barrier:StopBarrier):Promise<NativeControl>;
};
/** Public client.request() values (the native adapter still uses the standard ok/value envelope):
 * input.createSend CreateSend -> NativeSendIntent. intentId === actionId; explicit new action gets a new UUID.
 * input.readSend {intentId} -> NativeSendIntent.
 * input.listSends {id?,cursor?,limit?} -> SendIntentPage; latest first, default/max limit 30/50, opaque cursor.
 * input.readControl {id} -> NativeControl. Missing control for a KNOWN product is generation1/version0/stoppedThrough0.
 * input.stop RequestStop -> NativeControl. No JS dependency; records/cancels old intents before requesting SDK abort.
 * send {intentId} -> SendStatus (only this durable intent is admitted/reconciled; no legacy text/token bypass).
 * sendStatus {intentId} -> SendStatus, read-only; no submit/wait/resume side effect.
 * sendList {id,cursor?,limit?} -> {items:SendStatus[],next?}, read-only.
 * stop {id,stopId} -> {control:NativeControl,status:'stopped'|'waiting'} after reconciling the exact native barrier.
 * submissionContext is trusted core-published in both ConversationSummary and native InputConversation/NativeDraft.
 * An offline known native draft/context can createSend; actual SDK admission still requires all readiness gates.
 * ACK atomically stores receipt + CAS-clears only the still-matching frozen author/version/object identities.
 * A late valid receipt may be recorded after stop; it cannot clear a fence or restore dispatch eligibility.
 */
