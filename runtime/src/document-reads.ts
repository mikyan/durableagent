import {defineDocFamily,type Harness,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {FileError} from '@earendil-works/pi-durable/env';
import type {Context} from '@earendil-works/chord/context';
import {createHash,randomUUID} from 'node:crypto';
import {ExecutionChannelError,type ExecutionChannel} from './execution-channel.js';
import type {SendAuthority} from './submission-protocol.js';
import type {AdoptedBinding} from './project-bindings.js';

type Fixed={operationId:string;resourceId:string;owner:{productId:string;controlGeneration:number;sdkConversationId:number;taskId:number;callId:string;bindingId:string}};
const Observation=defineDocFamily({kind:'app.document-observation',version:1,scope:'session',family:true,initial:(_:null)=>({fixed:null as Fixed|null}),checkpointWhen:()=>false});
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unknown=()=>new FileError('unknown','原文件观察身份或固定内容尚未核验');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
/** One public SDK tool call owns one native observation, including after safe replay. */
export class DocumentReads {
 private harness?:Harness;
 constructor(private readonly channel:ExecutionChannel,private readonly authority:SendAuthority,private readonly closed:(bindingId:string,sdkConversationId:number)=>boolean){}
 attach(harness:Harness){this.harness=harness;}
 async read(binding:AdoptedBinding,api:ToolExecutionApi|undefined,resourceId:string,context:Context){
  if(!this.harness||!api||!digest(resourceId))throw unknown();const harness=this.harness,key=`${api.taskId}:${api.callId}`;
  const check=async(fixed:Fixed)=>{context.abortSignal?.throwIfAborted();const control=await this.authority.readControl(fixed.owner.productId);if(this.closed(binding.id,api.conversationId)||control.pendingAbort||control.generation!==fixed.owner.controlGeneration||control.stoppedThrough>=fixed.owner.controlGeneration||(await api.getTask(api.taskId,context))?.abortRequested)throw new FileError('aborted','原文件观察所属工作已停止');};
  let record=await harness.snapshot(Observation,key,context);
  if(!record?.fixed){const control=await this.authority.readControl(binding.controlProductId);const candidate:Fixed={operationId:randomUUID(),resourceId,owner:{productId:binding.controlProductId,controlGeneration:control.generation,sdkConversationId:api.conversationId,taskId:api.taskId,callId:api.callId,bindingId:binding.id}};await check(candidate);
   await api.commit(async tx=>{const stored=await tx.doc(Observation,key,null);if(!stored.fixed)stored.fixed=copy(candidate);},context,{persistence:{kind:'immediate'}});record=await harness.snapshot(Observation,key,context);
  }
  if(!record?.fixed)throw unknown();const fixed=copy(record.fixed);if(fixed.resourceId!==resourceId||fixed.owner.productId!==binding.controlProductId||fixed.owner.bindingId!==binding.id||fixed.owner.sdkConversationId!==api.conversationId)throw unknown();
  let snapshot:Record<string,any>;
  for(;;){await check(fixed);try{const reply:Record<string,any>=await this.channel.request('observeRead',fixed);if(reply.observation?.executionId!==fixed.operationId)throw unknown();if(reply.snapshot){snapshot=reply.snapshot;break;}if(!['waiting','granted','allowed','result-unverified'].includes(reply.observation?.phase))throw unknown();}
   catch(error){if(!(error instanceof ExecutionChannelError)||!['DATA_SAVER_WAIT','DATA_SAVER_INTERRUPTED','DATA_SAVER_OPERATION_BUSY','DATA_SAVER_RESULT_UNVERIFIED','DATA_SAVER_BUSY','DATA_SAVER_STORAGE_BUSY','DOCUMENT_CHANNEL_BUSY','DOCUMENT_REQUEST_LOST','EXECUTION_WAIT_UNKNOWN'].includes(error.code))throw error;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  await check(fixed);const resource=snapshot.resource;if(snapshot.snapshotId!==fixed.operationId||resource?.resourceId!==resourceId||resource.namespace!=='saf:'+resourceId||resource.original!==true||typeof resource.uri!=='string'||!resource.uri.startsWith('content://')||!digest(snapshot.contentDigest)||!Number.isSafeInteger(snapshot.byteLength)||snapshot.byteLength<0||snapshot.byteLength>16777216)throw unknown();
  const bytes=Buffer.alloc(snapshot.byteLength);let offset=0;
  while(offset<bytes.length){
   await check(fixed);const maxBytes=Math.min(32768,bytes.length-offset);let page:Record<string,unknown>;
   try{page=await this.channel.request('readSnapshot',{operationId:fixed.operationId,offset,maxBytes});}
   catch(error){
    // This reads only the fixed local snapshot. A busy authority or lost page
    // response leaves the original tool and offset intact; it never reopens I/O.
    if(!(error instanceof ExecutionChannelError)||!['INPUT_STORAGE_BUSY','DATA_SAVER_BUSY','DATA_SAVER_STORAGE_BUSY','DOCUMENT_CHANNEL_BUSY','DOCUMENT_REQUEST_LOST','EXECUTION_WAIT_UNKNOWN'].includes(error.code))throw error;
    await new Promise(resolve=>setTimeout(resolve,100));continue;
   }
   if(page.offset!==offset||typeof page.base64!=='string'||!Number.isSafeInteger(page.bytesRead)||Number(page.bytesRead)<1||Number(page.bytesRead)>maxBytes)throw unknown();const part=Buffer.from(page.base64,'base64');if(part.length!==page.bytesRead||part.toString('base64')!==page.base64||page.eof!==(offset+part.length===bytes.length))throw unknown();bytes.set(part,offset);offset+=part.length;
  }
  if(createHash('sha256').update(bytes).digest('hex')!==snapshot.contentDigest)throw unknown();return {resource,bytes,contentDigest:snapshot.contentDigest,observedAt:snapshot.observedAt};
 }
}
