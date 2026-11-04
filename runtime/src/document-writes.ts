import {defineDoc,defineDocFamily,type Harness,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {FileError} from '@earendil-works/pi-durable/env';
import {BACKGROUND_CONTEXT,type Context} from '@earendil-works/chord/context';
import {createHash,randomUUID} from 'node:crypto';
import type {ExecutionChannel} from './execution-channel.js';
import type {SendAuthority} from './submission-protocol.js';
import type {AdoptedBinding} from './project-bindings.js';
import type {WorkspaceCoordinator,WriteClaim,WriteEvidence} from './workspace-coordination.js';

export type DocumentWriteArguments={resourceId:string;expectedDigest:string;content:string};
type Fixed={operationId:string;resourceId:string;productId:string;controlGeneration:number;sdkConversationId:number;bindingId:string;taskId:number;callId:string;expectedDigest:string;contentDigest:string;byteLength:number};
type Stored={fixed:Fixed|null;requestDigest:string|null;receipt:Record<string,any>|null};
const Intent=defineDocFamily({kind:'app.managed-document-intent',version:1,scope:'session',family:true,initial:(_:null):Stored=>({fixed:null,requestDigest:null,receipt:null}),checkpointWhen:()=>false});
const Index=defineDoc({kind:'app.managed-document-index',version:1,scope:'session',initial:()=>({items:{} as Record<string,{key:string;productId:string;bindingId:string;state:string}>}),checkpointWhen:()=>false});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const terminal=(value:any)=>value?.scopeConfirmed===true&&['completed','not_started','stopped'].includes(value.state);
const unknown=()=>new FileError('unknown','原件写入结果尚未核验；保留原操作身份，不自动重写');
const request=(fixed:Fixed)=>{const {bindingId,taskId,callId,...value}=fixed;return value;};
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
// Early native v2 receipts used state instead of available. Project retained facts only;
// newly received receipts still pass the strict protocol check below.
const publicDiff=(value:any)=>{
 if(value&&(value.available===true||value.available===undefined&&value.state==='available')&&typeof value.text==='string'&&Buffer.byteLength(value.text)<=16384)return {available:true,text:value.text};
 if(value&&(value.available===false||value.available===undefined&&value.state==='unavailable')&&typeof value.reason==='string'&&value.reason.length<=160)return {available:false,reason:value.reason};
 return {available:false,reason:'unconfirmed'};
};

/** Durable SAF intents use the same app-wide writer coordinator as Termux commands. */
export class DocumentWrites {
 private harness?:Harness;
 private coordinator?:()=>WorkspaceCoordinator;
 constructor(private readonly channel:ExecutionChannel,private readonly authority:SendAuthority,private readonly ownerClosed:(bindingId:string,sdkConversationId:number)=>boolean){}
 attach(harness:Harness,coordinator:()=>WorkspaceCoordinator){this.harness=harness;this.coordinator=coordinator;}
 private owner(){if(!this.harness)throw unknown();return this.harness;}
 private writes(){if(!this.coordinator)throw unknown();return this.coordinator();}
 private requireOpen(bindingId:string,sdkConversationId:number){if(this.ownerClosed(bindingId,sdkConversationId))throw new FileError('aborted','原件操作所属执行环境已经关闭');}
 private checked(value:Record<string,any>,fixed:Fixed,expectedDigest?:string|null){
  if(!value||value.protocol!==1||value.namespace!=='saf:'+fixed.resourceId||!digest(value.requestDigest)||expectedDigest&&value.requestDigest!==expectedDigest||Object.entries(request(fixed)).some(([key,expected])=>value[key]!==expected)||value.original!==true||typeof value.uri!=='string'||!value.uri.startsWith('content://')||!Number.isSafeInteger(value.sequence)||value.sequence<0||typeof value.scopeConfirmed!=='boolean'||!['accepted_not_started','running','stop_requested','completed','not_started','stopped','unknown'].includes(value.state))throw unknown();
  if(value.diff!==undefined&&(!value.diff||typeof value.diff.available!=='boolean'||value.diff.available===true&&(typeof value.diff.text!=='string'||Buffer.byteLength(value.diff.text)>16384)||value.diff.available===false&&(typeof value.diff.reason!=='string'||value.diff.reason.length>160)))throw unknown();return copy(value);
 }
 private claim(fixed:Fixed,requestDigest:string):WriteClaim{return {operationId:fixed.operationId,requestDigest,namespace:'saf:'+fixed.resourceId,source:'saf',bindingId:fixed.bindingId,productId:fixed.productId,scope:{domain:'device-files',kind:'environment'}};}
 private async save(key:string,fixed:Fixed,value:Record<string,any>){await this.owner().commit(async tx=>{const stored=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!same(stored.fixed,fixed))throw unknown();if(stored.requestDigest&&stored.requestDigest!==value.requestDigest)throw unknown();stored.requestDigest=value.requestDigest;if(stored.receipt&&Number(stored.receipt.sequence)>value.sequence||terminal(stored.receipt)&&!terminal(value))return;stored.receipt=copy(value);index.items[fixed.operationId].state=terminal(value)?value.state:value.state==='completed'?'unknown':value.state;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}
 private async markUnknown(key:string,fixed:Fixed){await this.owner().commit(async tx=>{const stored=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!same(stored.fixed,fixed)||terminal(stored.receipt))return;stored.receipt={...stored.receipt,operationId:fixed.operationId,namespace:'saf:'+fixed.resourceId,state:'unknown',scopeConfirmed:false,reason:'NATIVE_CONFIRMATION_LOST'};index.items[fixed.operationId].state='unknown';},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}
 private async policy(fixed:Fixed,api:ToolExecutionApi,context:Context){context.abortSignal?.throwIfAborted();this.requireOpen(fixed.bindingId,fixed.sdkConversationId);const control=await this.authority.readControl(fixed.productId);if(control.pendingAbort||control.generation!==fixed.controlGeneration||control.stoppedThrough>=fixed.controlGeneration||(await api.getTask(api.taskId,context))?.abortRequested)throw new FileError('aborted','原件操作所属控制代次已停止');this.requireOpen(fixed.bindingId,fixed.sdkConversationId);}
 async write(binding:AdoptedBinding,api:ToolExecutionApi|undefined,args:DocumentWriteArguments,context:Context){
  this.requireOpen(binding.id,binding.sdkConversationId);
  if(!api||!digest(args.resourceId)||!digest(args.expectedDigest)||typeof args.content!=='string')throw new FileError('invalid','原件写入参数无效');const data=Buffer.from(args.content);if(data.length>16777216)throw new FileError('not_supported','单次原件写入超过 16 MiB');
  const key=`${api.taskId}:${api.callId}`,harness=this.owner();let fixed:Fixed|undefined,plan:Record<string,any>|undefined,cancelling:Promise<void>|undefined;
  const cancel=()=>{if(fixed&&plan&&!cancelling)cancelling=(async()=>{const value=this.checked(await this.channel.request('cancel',{operationId:fixed!.operationId,requestDigest:plan!.requestDigest}),fixed!,plan!.requestDigest);await this.save(key,fixed!,value);if(value.state==='not_started'&&value.scopeConfirmed)await this.writes().cancelQueued(fixed!.operationId);})();void cancelling?.catch(()=>{});};
  try{
   context.abortSignal?.throwIfAborted();let stored=await harness.snapshot(Intent,key,context);
   if(!stored?.fixed){const control=await this.authority.readControl(binding.controlProductId);if(control.pendingAbort||control.generation<=control.stoppedThrough)throw new FileError('aborted','原件操作所属控制代次已停止');const candidate:Fixed={operationId:randomUUID(),resourceId:args.resourceId,productId:binding.controlProductId,controlGeneration:control.generation,sdkConversationId:api.conversationId,bindingId:binding.id,taskId:api.taskId,callId:api.callId,expectedDigest:args.expectedDigest,contentDigest:sha(data),byteLength:data.length};await api.commit(async tx=>{const current=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!current.fixed){current.fixed=copy(candidate);index.items[candidate.operationId]={key,productId:candidate.productId,bindingId:candidate.bindingId,state:'intent'};}},context,{persistence:{kind:'immediate'}});stored=await harness.snapshot(Intent,key,context);}
   if(!stored?.fixed)throw unknown();fixed=copy(stored.fixed);if(fixed.resourceId!==args.resourceId||fixed.expectedDigest!==args.expectedDigest||fixed.contentDigest!==sha(data)||fixed.byteLength!==data.length||fixed.bindingId!==binding.id||fixed.productId!==binding.controlProductId||fixed.sdkConversationId!==api.conversationId)throw unknown();
   if(terminal(stored.receipt)){if(stored.receipt!.state==='completed')return stored.receipt!;throw new FileError('aborted','原件写入已确认未完成，不更换身份重试');}
   await this.policy(fixed,api,context);
   this.requireOpen(fixed.bindingId,fixed.sdkConversationId);
   plan=this.checked(await this.channel.request(stored.requestDigest?'query':'prepare',stored.requestDigest?{operationId:fixed.operationId}:request(fixed)),fixed,stored.requestDigest);await this.save(key,fixed,plan);
   context.abortSignal?.addEventListener('abort',cancel,{once:true});if(context.abortSignal?.aborted)cancel();
   if(plan.state==='accepted_not_started'){
    let offset=0;while(offset<data.length){await this.policy(fixed,api,context);const chunk=data.subarray(offset,offset+32768),reply=await this.channel.request('stage',{operationId:fixed.operationId,offset,base64:chunk.toString('base64')});if(reply.operationId!==fixed.operationId||!Number.isSafeInteger(reply.nextOffset)||Number(reply.nextOffset)<offset+chunk.length||Number(reply.nextOffset)>data.length||reply.sealed!==(reply.nextOffset===data.length))throw unknown();offset=Number(reply.nextOffset);}
    for(;;){await this.policy(fixed,api,context);const reservation=await this.writes().reserve(this.claim(fixed,plan.requestDigest));if(reservation.state==='cancelled')throw new FileError('aborted','等待中的原件写入已取消');if(reservation.state!=='queued')break;await this.writes().refresh();await new Promise(resolve=>setTimeout(resolve,20));}
    await this.policy(fixed,api,context);this.requireOpen(fixed.bindingId,fixed.sdkConversationId);plan=this.checked(await this.channel.request('start',{operationId:fixed.operationId,requestDigest:plan.requestDigest}),fixed,plan.requestDigest);await this.save(key,fixed,plan);
   }
   for(;;){if(terminal(plan)){await this.writes().refresh();if(plan.state==='completed')return plan;throw new FileError('aborted','原件写入未开始或未完成');}if(plan.state==='unknown')throw unknown();await this.policy(fixed,api,context);await new Promise(resolve=>setTimeout(resolve,40));plan=this.checked(await this.channel.request('query',{operationId:fixed.operationId}),fixed,plan.requestDigest);await this.save(key,fixed,plan);}
  }catch(error){if(context.abortSignal?.aborted||error instanceof FileError&&error.code==='aborted')cancel();if(cancelling)await cancelling.catch(()=>{});if(fixed)await this.markUnknown(key,fixed);throw error instanceof FileError?error:unknown();}
  finally{context.abortSignal?.removeEventListener('abort',cancel);}
 }
 async evidence(claim:Readonly<WriteClaim>):Promise<WriteEvidence>{const entry=(await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items[claim.operationId],stored=entry?await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT):undefined;if(!stored?.fixed||stored.requestDigest!==claim.requestDigest)throw unknown();const fixed=copy(stored.fixed),receipt=this.checked(await this.channel.request('query',{operationId:fixed.operationId}),fixed,stored.requestDigest);await this.save(entry!.key,fixed,receipt);return {operationId:fixed.operationId,requestDigest:receipt.requestDigest,namespace:receipt.namespace,state:receipt.state,scopeConfirmed:receipt.scopeConfirmed,sequence:receipt.sequence};}
 async cleanup(binding:AdoptedBinding,context:Context){
  let unconfirmed=false;
  for(const entry of Object.values((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{})){
   if(entry.bindingId!==binding.id)continue;
   const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.fixed){unconfirmed=true;continue;}
   const fixed=copy(stored.fixed);if(fixed.sdkConversationId!==binding.sdkConversationId||terminal(stored.receipt))continue;
   try{
    context.abortSignal?.throwIfAborted();let receipt=this.checked(await this.channel.request('query',{operationId:fixed.operationId}),fixed,stored.requestDigest);await this.save(entry.key,fixed,receipt);
    if(!terminal(receipt)){receipt=this.checked(await this.channel.request('cancel',{operationId:fixed.operationId,requestDigest:receipt.requestDigest}),fixed,receipt.requestDigest);await this.save(entry.key,fixed,receipt);}
    const deadline=performance.now()+5000;
    while(!terminal(receipt)){
     context.abortSignal?.throwIfAborted();if(receipt.state==='unknown'||performance.now()>=deadline)throw unknown();
     await new Promise(resolve=>setTimeout(resolve,25));receipt=this.checked(await this.channel.request('query',{operationId:fixed.operationId}),fixed,receipt.requestDigest);await this.save(entry.key,fixed,receipt);
    }
    if(receipt.state==='not_started')await this.writes().cancelQueued(fixed.operationId);
   }catch{await this.markUnknown(entry.key,fixed);unconfirmed=true;}
  }
  await this.writes().refresh();if(unconfirmed)throw unknown();
 }
 async recover(){for(const [operationId,entry] of Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{})){if(['completed','not_started','stopped'].includes(entry.state))continue;const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.fixed)throw unknown();const fixed=copy(stored.fixed);try{const receipt=this.checked(await this.channel.request('query',{operationId}),fixed,stored.requestDigest);await this.save(entry.key,fixed,receipt);if(stored.requestDigest){const claim=this.claim(fixed,stored.requestDigest);if(!terminal(receipt))await this.writes().reserve(claim);else if(receipt.state==='not_started')await this.writes().cancelQueued(operationId);}}catch{await this.markUnknown(entry.key,fixed);}}}
 async pending(){return Object.values((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{}).filter(entry=>!['completed','not_started','stopped'].includes(entry.state));}
 async list(productId:string){const all=Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{}).filter(([,entry])=>entry.productId===productId),changes=[],queued=new Set((await this.writes().list()).filter(row=>row.source==='saf'&&row.state==='queued').map(row=>row.operationId));for(const [operationId,entry] of all.slice(-20)){const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.fixed)throw unknown();changes.push({operationId,requestDigest:stored.requestDigest,sequence:stored.receipt?.sequence??null,bindingId:stored.fixed.bindingId,executionId:null,resourceId:stored.fixed.resourceId,path:stored.receipt?.uri??'',namespace:'saf:'+stored.fixed.resourceId,original:true,state:queued.has(operationId)?'queued':stored.receipt?.state??'pending',scopeConfirmed:stored.receipt?.scopeConfirmed===true,diff:publicDiff(stored.receipt?.diff)});}return {changes,limited:all.length>20};}
}
