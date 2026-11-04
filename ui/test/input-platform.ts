import {createHash} from 'node:crypto';
import type {ApplicationRequest,ApplicationResponse} from '../../runtime/src/application-protocol';
import type {FrozenInput,InputConversation,NativeDraft} from '../../runtime/src/input-protocol';
import {DEFAULT_QUEUE,type AdmissionReceipt,type CreateSend,type NativeAdmissionAck,type NativeControl,type NativeSendIntent,type SendStatus,type StopBarrier} from '../../runtime/src/submission-protocol';
import type {SubmissionContext} from '../../runtime/src/submission-protocol';

// The Android storage/SAF boundary only. Product UI, client and controller are real.
export class InputPlatform {
  conversations=new Map<string,InputConversation>();
  drafts=new Map<string,NativeDraft>();
  frozen=new Map<string,FrozenInput>();
  operations=new Map<string,unknown>();
  requests:ApplicationRequest[]=[];
  intents=new Map<string,NativeSendIntent>();
  controls=new Map<string,NativeControl>();
  private locationEdit:{operationId:string}|null=null;
  rememberConversation=(conversation:InputConversation)=>{
    const value={...conversation,submissionContext:conversation.submissionContext??this.conversations.get(conversation.id)?.submissionContext??{sdkConversationId:this.conversations.size+1,associationVersion:1,location:{workspaceId:'default',version:1,identity:'fixture-workspace'}}};
    this.conversations.set(conversation.id,value);const draft=this.drafts.get(conversation.id);
    if(draft&&JSON.stringify(draft.submissionContext)!==JSON.stringify(value.submissionContext))this.drafts.set(conversation.id,{...draft,submissionContext:value.submissionContext,stateVersion:draft.stateVersion+1});
  };
  beginLocationEdit=async(operationId:string)=>{if(this.locationEdit&&this.locationEdit.operationId!==operationId)throw Object.assign(Error('位置修改尚未完成'),{code:'LOCATION_EDIT_PENDING'});this.locationEdit={operationId};return {...this.locationEdit};};
  readLocationEdit=async()=>this.locationEdit?{...this.locationEdit}:null;
  finishLocationEdit=async(operationId:string,contexts:{id:string;context:SubmissionContext}[])=>{if(this.locationEdit?.operationId!==operationId)throw Error('位置修改身份不匹配');for(const item of contexts){const conversation=this.conversations.get(item.id);if(!conversation)throw Error('Unknown conversation');this.rememberConversation({...conversation,submissionContext:item.context});}this.locationEdit=null;};
  readControl=async(id:string)=>structuredClone(this.control(id));
  private control(id:string){this.read(id);return this.controls.get(id)??{id,version:0,generation:1,stoppedThrough:0};}
  readSend=async(intentId:string)=>{const intent=this.intents.get(intentId);if(!intent)throw Object.assign(Error('发送意图不存在'),{code:'SEND_NOT_FOUND'});return structuredClone(intent);};
  listSends=async(options:{id?:string;cursor?:string;limit?:number}={})=>{
    const all=[...this.intents.values()].filter(item=>!options.id||item.id===options.id).reverse(),offset=Number(options.cursor??0),limit=options.limit??30;
    return {intents:structuredClone(all.slice(offset,offset+limit)),...(all.length>offset+limit?{next:String(offset+limit)}:{})};
  };
  markDeliveryUnknown=async(intentId:string)=>{const intent=await this.readSend(intentId);if(intent.delivery!=='acknowledged'){intent.delivery='uncertain';intent.stateVersion++;this.intents.set(intentId,intent);}return intent;};
  confirmAdmission=async(intentId:string,receipt:AdmissionReceipt):Promise<NativeAdmissionAck>=>{
    const intent=await this.readSend(intentId);if(intent.receipt)return {intent,draftCleared:false,draft:this.read(intent.id)};
    intent.receipt=receipt;intent.delivery='acknowledged';intent.stateVersion++;this.intents.set(intentId,intent);
    const current=this.read(intent.id),draftCleared=current.revision===intent.inputRevision;
    const draft=draftCleared?{...current,revision:current.revision+1,stateVersion:current.stateVersion+1,text:'',selections:[]}:current;
    this.drafts.set(intent.id,draft);return {intent:structuredClone(intent),draftCleared,draft:structuredClone(draft)};
  };
  pendingStops=async()=>[...this.controls].filter(([,control])=>control.pendingAbort).map(([id,control])=>({id,control:structuredClone(control)}));
  confirmAbort=async(id:string,barrier:StopBarrier)=>{const control=this.control(id);if(control.pendingAbort?.stopId===barrier.stopId){const next={...control,version:control.version+1};delete next.pendingAbort;this.controls.set(id,next);return structuredClone(next);}return structuredClone(control);};
  fixtureStatus=async(intentId:string):Promise<SendStatus>=>{const intent=await this.readSend(intentId);return {intent,accepted:!!intent.receipt,...(intent.receipt?{receipt:intent.receipt,submission:{status:'done' as const}}:{})};};
  fixtureAdmission=async(intentId:string):Promise<SendStatus>=>{
    const intent=await this.readSend(intentId);if(intent.receipt)return this.fixtureStatus(intentId);
    const receipt:AdmissionReceipt={protocol:1,intentId,id:intent.id,inputToken:intent.inputToken,inputRevision:intent.inputRevision,inputDigest:intent.inputDigest,context:intent.context,queue:intent.queue,controlGeneration:intent.controlGeneration,bindingId:`binding-${intentId}`,submissionId:this.intents.size};
    const acknowledgement=await this.confirmAdmission(intentId,receipt);return {...await this.fixtureStatus(intentId),acknowledgement};
  };
  readFrozen=async(token:string)=>{const value=this.frozen.get(token);if(!value)throw Error('Unknown token');return structuredClone(value);};
  readObject=async()=>new Uint8Array();
  read(id:string):NativeDraft {
    if(!this.conversations.has(id))throw Object.assign(Error('Unknown conversation'),{code:'INPUT_UNKNOWN_CONVERSATION'});
    return structuredClone(this.drafts.get(id)??{id,revision:0,stateVersion:0,text:'',selections:[],committed:true,submissionContext:this.conversations.get(id)?.submissionContext});
  }
  async handle(request:ApplicationRequest):Promise<ApplicationResponse> {
    this.requests.push(request);
    try{
      const value=request.method==='input.readSend'?await this.readSend(String(request.payload?.intentId)):request.method==='input.listSends'?await this.listSends(request.payload):request.method==='input.readControl'?await this.readControl(String(request.payload?.id)):request.method==='input.stopStatus'?await this.readControl(String(request.payload?.id)).then(control=>({control,externalPending:0,externalUnknown:0,phase:control.pendingAbort?'waiting':control.stoppedThrough>0?'stopped':'not-requested'})):this.apply(request);
      return {type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value};
    }
    catch(error){return {type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:(error as {code?:string}).code??'INPUT_FAILED',message:(error as Error).message}};}
  }
  apply(request:ApplicationRequest):unknown {
    if(request.method==='input.stopNotification'){this.read(String(request.payload?.id));return {enabled:true,requested:false};}
    const p=request.payload??{},id=String(p.id);
    if(request.method==='input.list')return {conversations:[...this.conversations.values()]};
    const previous=this.read(id);
    if(request.method==='input.read'||request.method==='input.inspect')return previous;
    if(request.method==='input.createSend'){
      const value=p as CreateSend,existing=this.intents.get(value.actionId);if(existing)return structuredClone(existing);
      if(this.locationEdit)throw Object.assign(Error('位置修改尚未完成'),{code:'LOCATION_EDIT_PENDING'});
      const frozen=this.frozen.get(value.inputToken),control=this.control(id);if(!frozen||frozen.id!==id)throw Error('固定输入关联错误');
      if(control.version!==value.expectedControlVersion)throw Object.assign(Error('控制状态已变更'),{code:'CONTROL_CONFLICT'});
      const generation=Math.max(control.generation,control.stoppedThrough+1);this.controls.set(id,{...control,generation,version:control.version+1});
      const intent:NativeSendIntent={protocol:1,intentId:value.actionId,actionId:value.actionId,id,inputToken:frozen.token,inputRevision:frozen.revision,inputDigest:frozen.digest,context:value.expectedContext,queue:value.queue??DEFAULT_QUEUE,controlGeneration:generation,createdAt:Date.now(),preview:{text:frozen.text.slice(0,160),attachmentCount:frozen.representations.length},stateVersion:1,delivery:'pending',cancelled:false};
      this.intents.set(intent.intentId,intent);return structuredClone(intent);
    }
    if(request.method==='input.stop'){
      const operation=String(p.actionId);if(this.operations.has(operation))return structuredClone(this.operations.get(operation));
      const current=this.control(id);if(p.expectedControlVersion!==current.version)throw Object.assign(Error('控制状态已变更'),{code:'CONTROL_CONFLICT'});
      const control:NativeControl={...current,version:current.version+1,stoppedThrough:current.generation,pendingAbort:{stopId:operation,throughGeneration:current.generation,context:this.conversations.get(id)!.submissionContext!}};
      this.controls.set(id,control);for(const intent of this.intents.values())if(intent.id===id&&intent.controlGeneration<=control.stoppedThrough){intent.cancelled=true;intent.stateVersion++;}
      this.operations.set(operation,control);return structuredClone(control);
    }
    const operation=String(p.operationId);
    if(this.operations.has(operation))return structuredClone(this.operations.get(operation));
    if(p.expectedRevision!==undefined&&p.expectedRevision!==previous.revision)throw Object.assign(Error('保存版本已变化'),{code:'INPUT_CONFLICT'});
    let next:unknown;
    if(request.method==='input.save'||request.method==='input.clear'){
      const selectionIds=request.method==='input.clear'?[]:p.selectionIds as string[];
      next={...previous,revision:previous.revision+1,stateVersion:previous.stateVersion+1,text:request.method==='input.clear'?'':String(p.text),selections:selectionIds.map(id=>previous.selections.find(item=>item.id===id)!)};
      this.drafts.set(id,next as NativeDraft);
    }else if(request.method==='input.freeze'){
      const token=crypto.randomUUID(),representations=previous.selections.map(item=>item.preparation.representation!);
      if(previous.selections.some(item=>item.preparation.state!=='ready'))throw Object.assign(Error('附件尚未准备完成'),{code:'INPUT_NOT_READY'});
      const hash=createHash('sha256').update('input-v1\n');
      for(const field of [previous.text,String(representations.length),...representations.flatMap(item=>[item.kind,item.mimeType,item.sha256,String(item.byteLength),item.range])]){const bytes=Buffer.from(field);hash.update(String(bytes.length)+':').update(bytes);}
      next={token,id,revision:previous.revision,text:previous.text,representations,digest:hash.digest('hex')};this.frozen.set(token,next as FrozenInput);
    }else throw Error('Unsupported fixture operation');
    this.operations.set(operation,next);return structuredClone(next);
  }
}
