import {DEFAULT_QUEUE,type CreateSend,type NativeAdmissionAck,type NativeControl,type NativeSendIntent,type RequestStop,type SendIntentPage,type SendStatus,type SubmissionContext} from '../../runtime/src/submission-protocol';
import type {FrozenInput,NativeDraft} from '../../runtime/src/input-protocol';
import {ApplicationClient,ApplicationFailure} from './client';

export type SendView={intentId:string;id:string;createdAt:number;preview:{text:string;attachmentCount:number};durable:'saving'|'saved'|'unknown'|'failed';intent?:NativeSendIntent;status?:SendStatus;busy:boolean;error?:string};
type SendRecord={view:SendView;create?:CreateSend;editEpoch?:number;sdkSequence:number;draftReconciled?:boolean};
type StopView={pending:boolean;request?:RequestStop;error?:string;runtime?:'waiting'|'stopped'};
export class SubmissionCoordinator {
  private records=new Map<string,SendRecord>();
  private generation=0;
  private sequence=0;
  private alive=true;
  private pages=new Map<string,{next?:string;loading:boolean;error?:string}>();
  private refreshing=new Map<string,Promise<void>>();
  private controls=new Map<string,NativeControl>();
  private actionVersions=new Map<string,number>();
  private stops=new Map<string,StopView>();
  constructor(private readonly client:()=>ApplicationClient|undefined,private readonly ready:()=>boolean,private readonly changed:()=>void,private readonly acknowledged:(ack:NativeAdmissionAck,editEpoch?:number)=>Promise<void>){}
  view(id:string){return {items:[...this.records.values()].filter(record=>record.view.id===id).map(record=>({...record.view})).sort((a,b)=>b.createdAt-a.createdAt),...this.pages.get(id),control:this.controls.get(id),stopping:this.stops.get(id)?.pending??false,stopError:this.stops.get(id)?.error,stopRuntime:this.stops.get(id)?.runtime};}
  actionVersion(id:string){return this.actionVersions.get(id)??0;}
  private checkAction(id:string,version:number){if(version!==this.actionVersion(id))throw new ApplicationFailure('SEND_STOPPED','此次发送已被后来的停止操作拦下。需要继续时请明确新发送。');}
  private notify(){if(this.alive)this.changed();}
  private request<T>(method:Parameters<ApplicationClient['request']>[0],payload:Record<string,unknown>){const client=this.client();if(!client)throw new ApplicationFailure('HOST_UNAVAILABLE','原生发送入口不可用，请重新连接。');return client.request<T>(method,payload);}
  private adopt(intent:NativeSendIntent){
    let record=this.records.get(intent.intentId);
    if(record){
      const previous=record.view.intent,create=record.create;
      if(record.view.id!==intent.id||create&&(create.actionId!==intent.actionId||create.inputToken!==intent.inputToken||!sameContext(create.expectedContext,intent.context))||previous&&(previous.inputToken!==intent.inputToken||previous.inputDigest!==intent.inputDigest||previous.inputRevision!==intent.inputRevision))throw new ApplicationFailure('INTENT_MISMATCH','发送身份或固定内容不一致，已停止重试。');
      if(previous&&previous.stateVersion>intent.stateVersion)return record;
      record.view={...record.view,intent,preview:intent.preview,createdAt:intent.createdAt,durable:'saved'};
    }else{record={view:{intentId:intent.intentId,id:intent.id,createdAt:intent.createdAt,preview:intent.preview,durable:'saved',intent,busy:false},sdkSequence:0};this.records.set(intent.intentId,record);}
    this.notify();return record;
  }
  private async applyStatus(status:SendStatus,sequence:number){
    const record=this.adopt(status.intent);
    if(!(sequence<record.sdkSequence&&!(status.accepted&&!record.view.status?.accepted)||record.view.status?.accepted&&!status.accepted)){
      record.sdkSequence=Math.max(record.sdkSequence,sequence);record.view={...record.view,status,error:undefined};this.notify();
    }
    // An older status projection can still carry the only proven native draft clear.
    if(status.intent.source){record.draftReconciled=true;return;}
    if(status.accepted&&status.acknowledgement&&'draft' in status.acknowledgement){await this.acknowledged(status.acknowledgement,record.editEpoch);record.draftReconciled=true;}
    else if(status.accepted&&status.intent.delivery==='acknowledged'&&!record.draftReconciled){
      const epoch=this.generation,draft=await this.request<NativeDraft>('input.inspect',{id:status.intent.id});
      if(epoch!==this.generation)return;
      // A stored receipt proves acceptance, not which operation changed this draft.
      // Reconcile the current snapshot without inventing an ACK clear/rebase fact.
      await this.acknowledged({intent:status.intent,draftCleared:false,draft},record.editEpoch);record.draftReconciled=true;
    }
  }
  async create(frozen:FrozenInput,editEpoch:number,context:SubmissionContext,actionVersion=this.actionVersion(frozen.id)){
    const epoch=this.generation,intentId=crypto.randomUUID();
    const record:SendRecord={view:{intentId,id:frozen.id,createdAt:Date.now(),preview:{text:frozen.text.slice(0,160).replace(/[\uD800-\uDBFF]$/,''),attachmentCount:frozen.representations.length},durable:'saving',busy:true},editEpoch,sdkSequence:0};this.records.set(intentId,record);this.notify();
    try{
      this.checkAction(frozen.id,actionVersion);
      const control=await this.request<import('../../runtime/src/submission-protocol').NativeControl>('input.readControl',{id:frozen.id});
      if(epoch!==this.generation)return false;
      this.checkAction(frozen.id,actionVersion);
      record.create={actionId:intentId,id:frozen.id,inputToken:frozen.token,expectedContext:context,expectedControlVersion:control.version,queue:DEFAULT_QUEUE};
      const intent=await this.request<NativeSendIntent>('input.createSend',record.create);
      if(epoch!==this.generation)return false;this.adopt(intent);
      this.checkAction(frozen.id,actionVersion);
      if(!this.ready())return false;
      const sequence=++this.sequence,status=await this.request<SendStatus>('send',{intentId});
      if(epoch!==this.generation)return false;await this.applyStatus(status,sequence);return status.accepted;
    }catch(error){if(epoch===this.generation){record.view={...record.view,...(!record.view.intent?{durable:unknownResult(error)?'unknown' as const:'failed' as const}:{}),error:reason(error)};this.notify();}return false;}
    finally{if(epoch===this.generation){record.view={...record.view,busy:false};this.notify();}}
  }
  async retry(intentId:string){
    const record=this.records.get(intentId),epoch=this.generation;if(!record||record.view.busy)return false;
    const actionVersion=this.actionVersion(record.view.id);
    record.view={...record.view,busy:true,error:undefined};this.notify();
    try{
      if(!record.view.intent){if(!record.create)throw Error('此次发送尚未形成完整意图；请检查草稿后重新明确发送。');const intent=await this.request<NativeSendIntent>('input.createSend',record.create);if(epoch!==this.generation)return false;this.adopt(intent);}
      if(!this.ready())return false;
      let sequence=++this.sequence,status=await this.request<SendStatus>('sendStatus',{intentId});
      if(epoch!==this.generation)return false;await this.applyStatus(status,sequence);
      if(status.accepted&&status.intent.delivery==='acknowledged')return true;
      // Status is read-only. An existing SDK receipt still needs the same-intent
      // admission path to repair a lost native ACK, even after a stop fence.
      if(!status.accepted){
        if(status.intent.cancelled||status.intent.sourceCancelled||(this.controls.get(record.view.id)?.stoppedThrough??0)>=status.intent.controlGeneration)return false;
        this.checkAction(record.view.id,actionVersion);
      }
      sequence=++this.sequence;status=await this.request<SendStatus>('send',{intentId});
      if(epoch!==this.generation)return false;await this.applyStatus(status,sequence);return status.accepted;
    }catch(error){if(epoch===this.generation){record.view={...record.view,error:reason(error)};this.notify();}return false;}
    finally{if(epoch===this.generation){record.view={...record.view,busy:false};this.notify();}}
  }
  async refresh(id:string,cursor?:string){
    const key=`${id}:${cursor??''}`,existing=this.refreshing.get(key);if(existing)return existing;
    const epoch=this.generation,sequence=++this.sequence;this.pages.set(id,{...this.pages.get(id),loading:true,error:undefined});this.notify();
    const current=()=>this.alive&&epoch===this.generation;
    const pending=(async()=>{
      const reads:Promise<void>[]=[
        this.request<SendIntentPage>('input.listSends',{id,limit:30,...(cursor?{cursor}:{})}).then(page=>{if(!current())return;if(!Array.isArray(page?.intents))throw Error('原生发送目录不可用。');for(const intent of page.intents)this.adopt(intent);this.pages.set(id,{...this.pages.get(id),loading:true,next:page.next});this.notify();}),
        this.request<NativeControl>('input.readControl',{id}).then(control=>{if(current()&&control.version>=(this.controls.get(id)?.version??-1)){this.controls.set(id,control);this.notify();}})
      ];
      if(this.ready())reads.push(this.request<{items:SendStatus[];next?:string}>('sendList',{id,limit:30,...(cursor?{cursor}:{})}).then(async page=>{if(!current())return;if(!Array.isArray(page?.items))throw Error('SDK 接纳状态尚未取得。');for(const status of page.items){if(!current())return;await this.applyStatus(status,sequence);}}));
      const results=await Promise.allSettled(reads);
      if(current()){
        const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
        this.pages.set(id,{...this.pages.get(id),loading:false,...(failure?{error:reason(failure.reason)}:{})});this.notify();
      }
    })();this.refreshing.set(key,pending);
    try{await pending;}finally{if(this.refreshing.get(key)===pending)this.refreshing.delete(key);}
  }
  async stop(id:string){
    if(this.stops.get(id)?.pending)return false;
    const epoch=this.generation;this.actionVersions.set(id,this.actionVersion(id)+1);
    const state:StopView={...this.stops.get(id),pending:true,error:undefined};this.stops.set(id,state);this.notify();
    try{
      if(!state.request){const control=await this.request<NativeControl>('input.readControl',{id});if(epoch!==this.generation)return false;state.request={id,actionId:crypto.randomUUID(),expectedControlVersion:control.version};}
      const control=await this.request<NativeControl>('input.stop',state.request);
      if(epoch!==this.generation)return false;
      this.controls.set(id,control);state.request=undefined;state.runtime=control.pendingAbort?'waiting':'stopped';this.notify();
      if(this.ready()&&control.pendingAbort){
        void this.request<{control:NativeControl;status:'stopped'|'waiting'}>('stop',{id,stopId:control.pendingAbort.stopId}).then(result=>{
          if(epoch!==this.generation)return;
          if(result.control.version>=(this.controls.get(id)?.version??-1)){this.controls.set(id,result.control);state.runtime=result.status;this.notify();}
        }).catch(()=>{if(epoch===this.generation){state.error='停止请求已原生保存；运行宿主的中断确认尚未取得。';this.notify();}});
      }
      return true;
    }catch(error){if(epoch===this.generation){if(!unknownResult(error))state.request=undefined;state.error=reason(error);this.notify();}return false;}
    finally{if(epoch===this.generation){state.pending=false;this.notify();}}
  }
  disconnect(){this.generation++;this.refreshing.clear();for(const record of this.records.values())record.view={...record.view,busy:false};for(const stop of this.stops.values())stop.pending=false;}
  dispose(){this.alive=false;this.disconnect();}
}
const unknownResult=(error:unknown)=>error instanceof ApplicationFailure&&['RESPONSE_TIMEOUT','CONNECTION_CLOSED','HOST_UNAVAILABLE'].includes(error.code);
const reason=(error:unknown)=>error instanceof Error?error.message:'发送结果未确认，请核验此次发送。';
const sameContext=(a:SubmissionContext,b:SubmissionContext)=>a.sdkConversationId===b.sdkConversationId&&a.associationVersion===b.associationVersion&&a.location.workspaceId===b.location.workspaceId&&a.location.version===b.location.version&&a.location.identity===b.location.identity;
