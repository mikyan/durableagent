import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {defineDocFamily,type Harness,type ConversationId,type SubmissionId,type Tx} from '@earendil-works/pi-durable';
import type {Models} from '@earendil-works/pi-ai/models';
import {randomUUID,createHash} from 'node:crypto';
import {checkRouteSource} from './routing.js';
import {InputError,materializeFrozenInput} from './input.js';
import {abortControlScope} from './stop.js';
import type {FrozenInputAccess} from './input-protocol.js';
import type {AdmissionReceipt,NativeSendIntent,SendAuthority,SendStatus,SubmissionContext} from './submission-protocol.js';

export class SubmissionError extends Error {constructor(readonly code:string,message:string){super(message);}}
export const Admission=defineDocFamily({kind:'app.admission',version:1,scope:'session',family:true,initial:(_:null)=>({receipt:null as AdmissionReceipt|null}),checkpointWhen:()=>false});
export const Binding=defineDocFamily({kind:'app.submission-binding',version:1,scope:'session',family:true,initial:(_:null)=>({id:null as string|null,context:null as SubmissionContext|null,location:null as import('./project-protocol.js').WorkspaceRecord|null,projectId:null as string|null,sourceProductId:null as string|null,actualIdentity:null as string|null}),checkpointWhen:()=>false});
export const CurrentBinding=defineDocFamily({kind:'app.current-submission-binding',version:1,scope:'session',family:true,initial:(_:null)=>({id:null as string|null}),checkpointWhen:()=>false});
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function receiptMatchesIntent(intent:NativeSendIntent,receipt:AdmissionReceipt){
 const expected={protocol:1,intentId:intent.intentId,id:intent.id,inputToken:intent.inputToken,inputRevision:intent.inputRevision,inputDigest:intent.inputDigest,context:intent.context,queue:intent.queue,controlGeneration:intent.controlGeneration,...(intent.source?{source:intent.source}:{})};
 return equal(expected,{protocol:receipt.protocol,intentId:receipt.intentId,id:receipt.id,inputToken:receipt.inputToken,inputRevision:receipt.inputRevision,inputDigest:receipt.inputDigest,context:receipt.context,queue:receipt.queue,controlGeneration:receipt.controlGeneration,...(receipt.source?{source:receipt.source}:{})});
}
export type SubmissionBoundary='before-sdk-commit'|'after-sdk-submit'|'after-sdk-commit'|'before-native-ack'|'after-native-ack';
type Options={harness:Harness;authority:SendAuthority;inputs:FrozenInputAccess;models:Models;available?:(provider:string,modelId:string)=>Promise<boolean>;resolve:(tx:Tx,id:string)=>Promise<SubmissionContext>;adopt?:(tx:Tx,id:string,bindingId:string)=>Promise<void>;reconcileEffects?:()=>Promise<void>;ready:()=>void;pause:()=>()=>void;boundary?:(stage:SubmissionBoundary,intent:NativeSendIntent)=>void|Promise<void>};
/** One application admission seam. SDK remains the sole submission/inbox/scheduling authority. */
export class Submissions {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly options:Options){}
  coordinate<T>(run:()=>Promise<T>):Promise<T>{const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;}
  private checkReceipt(intent:NativeSendIntent,receipt:AdmissionReceipt){
    if(!receiptMatchesIntent(intent,receipt))throw new SubmissionError('INTENT_MISMATCH','发送身份、内容或位置与已接纳记录不一致');
  }
  async status(intentId:string):Promise<SendStatus>{
    const {harness,authority}=this.options,intent=await authority.readSend(intentId),receipt=(await harness.snapshot(Admission,intentId,context))?.receipt??undefined;
    if(!receipt){if(intent.receipt||intent.delivery==='acknowledged')throw new SubmissionError('ADMISSION_INCONSISTENT','原生记录已确认，但 SDK 接纳映射缺失；保留记录，不自动重发');return {intent,accepted:false,...(intent.cancelled?{waiting:{code:'SEND_STOPPED',message:'这次发送已停止；如需发送请明确发起新的动作'}}:{})};}
    this.checkReceipt(intent,receipt);
    const binding=await harness.snapshot(Binding,receipt.bindingId,context);
    if(intent.receipt&&!equal(intent.receipt,receipt)||!binding||binding.id!==receipt.bindingId||!equal(binding.context,receipt.context))throw new SubmissionError('ADMISSION_INCONSISTENT','接纳映射、原生确认或位置绑定不一致；保留记录，不自动重发');
    const record=await (await harness.submission(receipt.submissionId as SubmissionId,context))?.status(context);
    if(!record||record.type!=='input'||record.conversationId!==receipt.context.sdkConversationId||record.requestId!==intent.intentId)throw new SubmissionError('ADMISSION_INCONSISTENT','接纳关联无法核验，请保留原发送记录');
    return {intent,accepted:true,receipt,submission:{status:record.status,...(record.entry?{entryId:String(record.entry)}:{}),...(record.answer?{answerEntryId:String(record.answer)}:{}),...(record.reason?{reason:record.reason}:{})}};
  }
  async list(options:{id:string;cursor?:string;limit?:number}){const page=await this.options.authority.listSends(options);return {items:await Promise.all(page.intents.map(item=>this.status(item.intentId))),...(page.next?{next:page.next}:{})};}
  send(intentId:string){return this.coordinate(()=>this.admit(intentId));}
  private async acknowledge(status:SendStatus):Promise<SendStatus>{
    if(!status.receipt)return status;
    try {await this.options.boundary?.('before-native-ack',status.intent);const acknowledgement=await this.options.authority.confirmAdmission(status.intent.intentId,status.receipt);await this.options.boundary?.('after-native-ack',status.intent);return {...status,intent:acknowledgement.intent,acknowledgement};}
    catch{return {...status,waiting:{code:'ACK_UNCONFIRMED',message:'SDK 已接纳，原生确认尚未完成；将核验同一次发送'}};}
  }
  private async admit(intentId:string):Promise<SendStatus>{
    const {harness,authority,inputs,models}=this.options;this.options.ready();
    const found=await this.status(intentId);if(found.accepted)return this.acknowledge(found);
    const intent=found.intent;
    if(intent.source)await checkRouteSource(authority,intent.source);
    if(intent.protocol!==1||intent.intentId!==intent.actionId||intent.queue.whenBusy!=='followUp'||intent.queue.whenIdle!=='start')throw new SubmissionError('INTENT_INVALID','发送记录格式无效');
    await this.stops();this.options.ready();
    const control=await authority.readControl(intent.id);
    if(intent.cancelled||intent.controlGeneration<=control.stoppedThrough||intent.controlGeneration!==control.generation)throw new SubmissionError('SEND_STOPPED','这次发送已停止；请明确发起新的发送');
    if(control.pendingAbort)throw new SubmissionError('STOP_PENDING','正在完成上一代停止，请稍后核验');
    const conversation=await harness.conversation(intent.context.sdkConversationId as ConversationId,context);
    if(!conversation)throw new SubmissionError('LOCATION_MISMATCH','发送目标关联已改变，请保留原发送');
    const selected=(await conversation.agent(context)).model,model=selected&&models.getModel(selected.provider,selected.modelId);
    if(!model||this.options.available&&!await this.options.available(model.provider,model.id))throw new SubmissionError('MODEL_UNAVAILABLE','模型或凭据尚不可用，发送已保存，请检查模型设置后核验');
    const fixed=await inputs.readFrozen(intent.inputToken);
    if(fixed.id!==intent.id||fixed.revision!==intent.inputRevision||fixed.digest!==intent.inputDigest)throw new SubmissionError('INTENT_MISMATCH','固定输入与发送记录不一致');
    const content=await materializeFrozenInput(inputs,intent.inputToken,intent.id,model);
    const release=this.options.pause();
    try {
      // The original native intent remains a holder even if this cross-owner handoff is interrupted.
      await inputs.retainFrozen?.(`sdk-admission:${createHash('sha256').update(intentId).digest('hex')}`,intent.inputToken);
      await authority.markDeliveryUnknown(intentId);
      await this.options.boundary?.('before-sdk-commit',intent);
      await harness.commit(async tx=>{
        const actual=await this.options.resolve(tx,intent.id),admission=await tx.doc(Admission,intentId,null),current=await tx.doc(CurrentBinding,intent.id,null);
        if(admission.receipt){this.checkReceipt(intent,admission.receipt);return;}
        const bindingId=current.id??randomUUID(),binding=await tx.doc(Binding,bindingId,null);
        if(!equal(actual,intent.context))throw new SubmissionError('LOCATION_MISMATCH','发送位置或会话关联已改变，请保留原发送');
        if(binding.context&&!equal(binding.context,actual))throw new SubmissionError('LOCATION_MISMATCH','当前使用位置与已有绑定不一致');
        if(await tx.submissionByRequest(actual.sdkConversationId as ConversationId,intentId))throw new SubmissionError('ADMISSION_INCONSISTENT','SDK 已有同身份记录但缺少可核验接纳映射');
        const latest=await authority.readControl(intent.id);this.options.ready();
        if(latest.pendingAbort||latest.generation!==intent.controlGeneration||latest.stoppedThrough>=intent.controlGeneration)throw new SubmissionError('SEND_STOPPED','停止事实已改变，本次输入未接纳');
        if(intent.source){const source=await this.options.resolve(tx,intent.source.id);if(source.sdkConversationId!==intent.source.sdkConversationId)throw new SubmissionError('SOURCE_MISMATCH','来源会话身份已改变');await checkRouteSource(authority,intent.source);}
        await this.options.adopt?.(tx,intent.id,bindingId);
        // submit must precede all table writes. All app documents/table reads are above it.
        const submissionId=await conversation.submit(tx,{type:'input',requestId:intentId,content,whenBusy:'followUp'});
        current.id=bindingId;binding.id=bindingId;binding.context=actual;
        admission.receipt={protocol:1,intentId,id:intent.id,inputToken:intent.inputToken,inputRevision:intent.inputRevision,inputDigest:intent.inputDigest,context:actual,queue:intent.queue,controlGeneration:intent.controlGeneration,bindingId,submissionId,...(intent.source?{source:intent.source}:{})};
        await this.options.boundary?.('after-sdk-submit',intent);
        if(intent.source)await checkRouteSource(authority,intent.source);
      },context);
      await this.options.boundary?.('after-sdk-commit',intent);
      // Stop can commit in the independent native DB while the SDK commit is in flight.
      // Keep fresh model dispatch held until its abort has settled; acceptance remains a fact.
      await this.stops();
      return await this.acknowledge(await this.status(intentId));
    }finally{release();}
  }
  private async stops(){
    for(const {id,control} of await this.options.authority.pendingStops()){
      const barrier=control.pendingAbort;if(!barrier)continue;
      const actual=await this.options.harness.commit(tx=>this.options.resolve(tx,id),context);
      if(actual.sdkConversationId!==barrier.context.sdkConversationId)throw new SubmissionError('STOP_ASSOCIATION_MISMATCH','待停止范围关联无法核验，运行保持关闭');
      await abortControlScope(this.options.harness,id,actual.sdkConversationId as ConversationId);
      await this.options.reconcileEffects?.();
      await this.options.authority.confirmAbort(id,barrier);
    }
  }
  stop(id:string,stopId:string){return this.coordinate(async()=>{this.options.ready();const control=await this.options.authority.readControl(id);if(control.pendingAbort?.stopId!==stopId)throw new SubmissionError('STOP_MISMATCH','停止记录已改变，请重新读取');const release=this.options.pause();try{await this.stops();return {control:await this.options.authority.readControl(id),status:'stopped' as const};}finally{release();}});}
  /** Native controls must be readable and old abort scopes settled before public readiness. */
  prepare(){return this.coordinate(()=>this.stops());}
  /** Reached by every actual model invocation, including SDK retry/deferred/compaction paths. */
  checkDispatch(){return this.coordinate(async()=>{this.options.ready();if(!(await this.options.authority.pendingStops()).length)return;const release=this.options.pause();try{await this.stops();}finally{release();}});}
  /** Startup: only persisted explicit intents, never draft text. Read-only projection does not call this. */
  recover(){return this.coordinate(async()=>{const release=this.options.pause();try{await this.stops();}finally{release();}let cursor:string|undefined;do{const page=await this.options.authority.listSends({cursor,limit:50});for(const intent of page.intents){if(intent.delivery==='acknowledged'||intent.cancelled)continue;try{await this.admit(intent.intentId);}catch(error){if(!(error instanceof SubmissionError)&&!(error instanceof InputError))throw error;}}cursor=page.next;}while(cursor);});}
}
