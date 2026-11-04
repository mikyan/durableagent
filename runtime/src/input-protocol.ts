// Shared data only. Native input storage stays usable without the Agent JS owner.
export const INPUT_PROTOCOL=1;
export const INPUT_EXTENSION={id:'input',actions:['input.list','input.read','input.inspect','input.save','input.clear','input.select','input.prepare','input.freeze','input.discard','input.maintain']} as const;
export type InputMethod=typeof INPUT_EXTENSION.actions[number]|import('./submission-protocol.js').NativeSendMethod;
/** Conservative application budgets, not advertised device/Provider maxima. */
export const INPUT_BUDGETS={draftCharacters:100000,attachments:4,sourceImageBytes:16*1024*1024,sourcePixels:24*1024*1024,textBytes:256*1024,imageWidth:1024,imageHeight:1024,imageBytes:1536*1024,totalBase64Bytes:8*1024*1024,requestBytes:10*1024*1024} as const;
export type InputCapability={version:string;provider:string;modelId:string;input:('text'|'image')[];source:'sdk-catalog'|'connection-text-only'|'validation';limits:{maxRequestBytes?:number;maxImages?:number;maxWidth?:number;maxHeight?:number;maxBase64Bytes?:number};applicationPolicy:typeof INPUT_BUDGETS};
export type InputRepresentation={objectId:string;sha256:string;byteLength:number;kind:'image'|'text';mimeType:string;range:'full';width?:number;height?:number;sourceWidth?:number;sourceHeight?:number;transformation?:string;capabilityVersion:string};
export type InputSelection={id:string;operationId?:string;source:{name:string;mimeType:string;byteLength?:number;access:'available'|'unavailable'|'unknown'};preparation:{state:'selected'|'preparing'|'ready'|'source-unavailable'|'unsupported'|'budget-exceeded'|'failed';reason?:string;representation?:InputRepresentation}};
export type NativeDraft={id:string;revision:number;stateVersion:number;text:string;selections:InputSelection[];committed:true;capability?:InputCapability;submissionContext?:import('./submission-protocol.js').SubmissionContext};
export type InputConversation={id:string;title:string;model:{provider:string;modelId:string;name:string};submissionContext?:import('./submission-protocol.js').SubmissionContext};
export type FrozenInput={token:string;id:string;revision:number;text:string;representations:InputRepresentation[];digest:string};
/** Trusted host-only adapter; never exported to the WebView. Bytes remain native until explicit send. */
export interface FrozenInputAccess {readFrozen(token:string):Promise<FrozenInput>;readObject(token:string,objectId:string):Promise<Uint8Array>;retainFrozen?(ownerId:string,token:string):Promise<void>}
/**
 * Same ApplicationRequest/Response envelope, routed before the Node queue.
 * list {} -> {conversations:InputConversation[]}; read {id} -> NativeDraft (revalidates source access).
 * inspect {id} -> NativeDraft (fast durable preparation state; does not claim fresh source access).
 * save {id,expectedRevision,operationId,text,selectionIds:string[]} -> NativeDraft, after COMMIT.
 * clear {id,expectedRevision,operationId} -> NativeDraft; revisions never reset (ABA safe).
 * select {id,expectedRevision,operationId,kind:'image'|'file'} -> NativeDraft via native SAF chooser.
 * prepare {id,selectionId,operationId} -> NativeDraft. No network; only supported, bounded formats.
 * freeze {id,expectedRevision,operationId} -> FrozenInput. Exact bytes are pinned; not SDK admission.
 * discard {token,operationId} -> {}. Explicit release only; never delete a user source.
 * maintain {} -> {reclaimed,protected}. Conditional native cleanup; history/intents/unknown effects stay retained.
 * Conflicts/errors leave the existing confirmed draft intact. UI flush is a barrier over save receipts.
 */
