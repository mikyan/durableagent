import {INPUT_BUDGETS,type FrozenInput,type InputSelection,type NativeDraft} from '../../runtime/src/input-protocol';
import {ApplicationClient,ApplicationFailure} from './client';
import type {NativeAdmissionAck} from '../../runtime/src/submission-protocol';

export type DraftView={id:string;text:string;selections:InputSelection[];revision:number;stateVersion:number;status:'saved'|'pending'|'failed'|'conflict';error?:string;busy:boolean;preparingIds:string[];observingIds:string[];preparationErrors:Record<string,string>;submissionContext?:NativeDraft['submissionContext']};
type Save={operationId:string;expectedRevision:number;text:string;selectionIds:string[];editEpoch:number};
type Edit=Pick<Save,'text'|'selectionIds'|'editEpoch'>;
type RecordState={saved:NativeDraft;text:string;selections:InputSelection[];editEpoch:number;savedEpoch:number;status:DraftView['status'];error?:string;preparationErrors:Record<string,string>;writer?:Promise<void>;freezeBarrier?:Promise<void>;retry?:Save;admissionClear?:{fromRevision:number;toRevision:number;throughEpoch:number};selectionRetry?:{operationId:string;expectedRevision:number;kind:'image'|'file';editEpoch:number};debounce?:ReturnType<typeof setTimeout>;maximum?:ReturnType<typeof setTimeout>;busy:boolean};
type Observation={timer?:ReturnType<typeof setTimeout>;attempts:number;failures:number;deadline:number;selectionIds:Set<string>};

/** Owns only UI edits and commit barriers. The native store owns durable input and bytes. */
export class DraftCoordinator {
  private records=new Map<string,RecordState>();
  private alive=true;
  private polls=new Map<string,Observation>();
  private preparations=new Set<string>();
  private automaticPreparations=new Set<string>();
  constructor(private readonly client:()=>ApplicationClient|undefined,private readonly changed:()=>void){}
  view(id:string):DraftView|undefined {const r=this.records.get(id);return r?{id,text:r.text,selections:r.selections,revision:r.saved.revision,stateVersion:r.saved.stateVersion,status:r.status,error:r.error,busy:r.busy,preparingIds:r.selections.filter(item=>this.preparations.has(`${id}:${item.id}`)).map(item=>item.id),observingIds:r.selections.filter(item=>this.polls.get(id)?.selectionIds.has(item.id)).map(item=>item.id),preparationErrors:{...r.preparationErrors},submissionContext:r.saved.submissionContext}:undefined;}
  private notify(){if(this.alive)this.changed();}
  private request<T>(method:Parameters<ApplicationClient['request']>[0],payload:Record<string,unknown>,timeout?:number){const client=this.client();if(!client)throw new ApplicationFailure('HOST_UNAVAILABLE','草稿宿主不可用，请重新连接。');return client.request<T>(method,payload,timeout);}
  async read(id:string,timeout?:number){
    const value=await this.request<NativeDraft>('input.read',{id},timeout);
    this.adoptRead(id,value);
    this.poll(id,value.selections.filter(item=>item.preparation.state==='preparing').map(item=>item.id));
    return this.view(id)!;
  }
  private adoptRead(id:string,value:NativeDraft){
    if(!value||value.id!==id||!value.committed||!Number.isSafeInteger(value.stateVersion))throw Error('原生草稿回执无效，请更新应用。');
    const r=this.records.get(id);
    if(r?.selectionRetry&&value.selections.some(item=>item.operationId===r.selectionRetry?.operationId))r.selectionRetry=undefined;
    if(!r)this.records.set(id,{saved:value,text:value.text,selections:value.selections,editEpoch:0,savedEpoch:0,status:'saved',busy:false,preparationErrors:{}});
    else if(value.stateVersion>=r.saved.stateVersion){
      if(r.editEpoch===r.savedEpoch&&!r.writer){r.saved=value;r.text=value.text;r.selections=value.selections;r.status='saved';r.error=undefined;}
      else if(value.revision===r.saved.revision){this.metadata(r,value);}
      else if(!r.writer){r.status='conflict';r.error='已保存的草稿有新版本，本地编辑已保留。请明确选择恢复方式。';}
    }
    const current=this.records.get(id)!;
    for(const item of current.selections)if(item.preparation.state!=='selected'&&item.preparation.state!=='preparing')delete current.preparationErrors[item.id];
    this.notify();
  }
  edit(id:string,text:string){
    const r=this.records.get(id);if(!r)return;
    const wasOver=r.text.length>INPUT_BUDGETS.draftCharacters;r.text=text;r.editEpoch++;
    if(text.length>INPUT_BUDGETS.draftCharacters){this.clearTimers(r);r.status='failed';r.error=`文字超过 ${INPUT_BUDGETS.draftCharacters} 个字符的应用预算；完整输入已留在此界面，请主动缩短后保存。`;this.notify();return;}
    if(wasOver&&r.status==='failed'){r.status='pending';r.error=undefined;}
    this.edited(id,r);
  }
  remove(id:string,selectionId:string){const r=this.records.get(id);if(!r)return;this.automaticPreparations.delete(`${id}:${selectionId}`);r.selections=r.selections.filter(item=>item.id!==selectionId);r.editEpoch++;this.edited(id,r);}
  private edited(id:string,r:RecordState){
    if(r.status!=='conflict'&&r.status!=='failed')r.status='pending';
    if(r.status==='pending'){
      clearTimeout(r.debounce);r.debounce=setTimeout(()=>{this.clearTimers(r);void this.flush(id).catch(()=>{});},250);
      r.maximum??=setTimeout(()=>{this.clearTimers(r);void this.flush(id).catch(()=>{});},1000);
    }
    this.notify();
  }
  private clearTimers(r:RecordState){clearTimeout(r.debounce);clearTimeout(r.maximum);r.debounce=undefined;r.maximum=undefined;}
  private metadata(r:RecordState,value:NativeDraft){
    if(value.stateVersion<r.saved.stateVersion)return;
    r.saved=value;const byId=new Map(value.selections.map(item=>[item.id,item]));r.selections=r.selections.map(item=>byId.get(item.id)??item);
  }
  private fail(r:RecordState,error:unknown){r.status=error instanceof ApplicationFailure&&error.code.includes('CONFLICT')?'conflict':'failed';r.error=r.status==='conflict'?'已保存的草稿有新版本，本地编辑已保留。请明确选择恢复方式。':error instanceof Error?error.message:'草稿保存未确认，本地编辑已保留。';this.notify();}
  private capture(r:RecordState):Edit{return {text:r.text,selectionIds:r.selections.map(item=>item.id),editEpoch:r.editEpoch};}
  async flush(id:string):Promise<{draft:NativeDraft;editEpoch:number}>{
    const r=this.records.get(id);if(!r)throw Error('草稿尚未读取，请重新打开会话。');
    return this.flushCaptured(id,r,this.capture(r));
  }
  private async flushCaptured(id:string,r:RecordState,target:Edit,ownsFreeze=false):Promise<{draft:NativeDraft;editEpoch:number}>{
    this.clearTimers(r);
    if(target.text.length>INPUT_BUDGETS.draftCharacters){const error=Error(`文字超过 ${INPUT_BUDGETS.draftCharacters} 个字符的应用预算，请主动缩短后保存。`);this.fail(r,error);throw error;}
    while(r.writer||!ownsFreeze&&r.freezeBarrier){if(!ownsFreeze&&r.freezeBarrier)await r.freezeBarrier;if(r.writer)await r.writer;}
    if(r.status==='conflict')throw Error(r.error);
    while(r.savedEpoch<target.editEpoch||r.retry){
      if(!ownsFreeze&&r.freezeBarrier)await r.freezeBarrier;
      if(r.savedEpoch>=target.editEpoch&&!r.retry)break;
      const save=r.retry??{operationId:crypto.randomUUID(),expectedRevision:r.saved.revision,...target};
      r.retry=save;r.status='pending';r.error=undefined;this.notify();
      const writer=(async()=>{
        try{
          const value=await this.request<NativeDraft>('input.save',{id,expectedRevision:save.expectedRevision,operationId:save.operationId,text:save.text,selectionIds:save.selectionIds});
          this.metadata(r,value);r.savedEpoch=save.editEpoch;r.retry=undefined;
          if(r.editEpoch===save.editEpoch){r.text=value.text;r.selections=value.selections;r.status='saved';}else r.status='pending';
        }catch(error){
          const clear=r.admissionClear;
          if(error instanceof ApplicationFailure&&error.code==='INPUT_CONFLICT'&&clear?.fromRevision===save.expectedRevision&&clear.toRevision===r.saved.revision&&save.editEpoch>clear.throughEpoch){
            r.retry=undefined;r.admissionClear=undefined;r.status='pending';r.error=undefined;
          }else{this.fail(r,error);throw error;}
        }
      })();r.writer=writer;
      try{await writer;}finally{if(r.writer===writer)r.writer=undefined;this.notify();}
    }
    return {draft:r.saved,editEpoch:target.editEpoch};
  }
  async recover(id:string,keepLocal:boolean){
    const r=this.records.get(id);if(!r||r.writer||r.freezeBarrier)return;
    const editEpoch=r.editEpoch;r.busy=true;this.clearTimers(r);this.notify();
    let saveLocal=false;
    const writer=(async()=>{
      const value=await this.request<NativeDraft>('input.read',{id});
      if(value.stateVersion<r.saved.stateVersion)throw Error('草稿状态已有更新，请重新选择恢复方式。');
      r.saved=value;r.retry=undefined;r.error=undefined;
      if(keepLocal||r.editEpoch!==editEpoch){const byId=new Map(value.selections.map(item=>[item.id,item]));r.selections=r.selections.map(item=>byId.get(item.id)??item);r.editEpoch++;r.status='pending';saveLocal=true;}
      else {r.text=value.text;r.selections=value.selections;r.editEpoch++;r.savedEpoch=r.editEpoch;r.status='saved';}
    })();r.writer=writer;
    try{await writer;}catch(error){this.fail(r,error);throw error;}finally{r.busy=false;if(r.writer===writer)r.writer=undefined;this.notify();}
    if(saveLocal)await this.flush(id);
  }
  async select(id:string,kind:'image'|'file'){
    const r=this.records.get(id);if(!r||r.busy)return;
    r.busy=true;this.notify();
    try{if(!r.selectionRetry)await this.flush(id);}catch(error){r.busy=false;this.notify();throw error;}
    const selection=r.selectionRetry??{operationId:crypto.randomUUID(),expectedRevision:r.saved.revision,kind,editEpoch:r.editEpoch};
    r.selectionRetry=selection;
    const before=new Set(r.selections.map(item=>item.id));
    const writer=(async()=>{
      try{
        const value=await this.request<NativeDraft>('input.select',{id,kind:selection.kind,expectedRevision:selection.expectedRevision,operationId:selection.operationId},180000);
        r.selectionRetry=undefined;r.error=undefined;
        if(value.stateVersion>=r.saved.stateVersion){r.saved=value;r.selections=value.selections;r.savedEpoch=selection.editEpoch;if(r.editEpoch===selection.editEpoch){r.text=value.text;r.status='saved';}else r.status='pending';}
      }catch(error){if(error instanceof ApplicationFailure&&error.code==='INPUT_PICKER_CANCELLED')r.selectionRetry=undefined;this.fail(r,error);throw error;}
    })();r.writer=writer;
    try{await writer;}finally{r.busy=false;if(r.writer===writer)r.writer=undefined;this.notify();}
    for(const selection of r.selections)if(!before.has(selection.id)){
      if(selection.preparation.state==='selected')void this.prepare(id,selection.id).catch(()=>{});
      else if(selection.preparation.state==='preparing'){this.automaticPreparations.add(`${id}:${selection.id}`);this.poll(id,[selection.id]);}
    }
    if(r.status==='pending')void this.flush(id).catch(()=>{});
  }
  async prepare(id:string,selectionId:string){
    const r=this.records.get(id),key=`${id}:${selectionId}`;
    if(!r||this.preparations.has(key))return;
    if(!r.selections.some(item=>item.id===selectionId))return;
    this.automaticPreparations.delete(key);
    this.preparations.add(key);delete r.preparationErrors[selectionId];this.poll(id,[selectionId]);this.notify();
    try{
      const value=await this.request<NativeDraft>('input.prepare',{id,selectionId,operationId:crypto.randomUUID()});
      if(value.revision===r.saved.revision)this.metadata(r,value);
      const current=r.selections.find(item=>item.id===selectionId);
      if(current&&current.preparation.state!=='selected'&&current.preparation.state!=='preparing')delete r.preparationErrors[selectionId];
      this.notify();
    }catch(error){
      const current=r.selections.find(item=>item.id===selectionId);
      if(current&&(current.preparation.state==='selected'||current.preparation.state==='preparing'))r.preparationErrors[selectionId]=error instanceof ApplicationFailure&&error.code==='RESPONSE_TIMEOUT'?'准备请求尚未收到确认。原生工作可能仍在继续，可查看本地状态或手动刷新。':error instanceof Error?error.message:'附件本地准备未确认，请刷新。';
    }finally{this.preparations.delete(key);this.notify();}
  }
  private poll(id:string,selectionIds:string[]){
    if(!this.alive||!selectionIds.length)return;
    const existing=this.polls.get(id);if(existing){for(const selectionId of selectionIds)existing.selectionIds.add(selectionId);return;}
    const state:Observation={attempts:0,failures:0,deadline:Date.now()+90000,selectionIds:new Set(selectionIds)};this.polls.set(id,state);
    const stop=(notice?:string)=>{
      if(this.polls.get(id)!==state)return;
      this.polls.delete(id);const r=this.records.get(id);
      for(const selectionId of state.selectionIds)this.automaticPreparations.delete(`${id}:${selectionId}`);
      if(notice&&r)for(const selectionId of state.selectionIds)r.preparationErrors[selectionId]=notice;
      this.notify();
    };
    const next=()=>{state.timer=setTimeout(async()=>{
      if(!this.alive||this.polls.get(id)!==state)return;
      if(Date.now()>=state.deadline||state.attempts>=180){stop('本轮自动状态检查已结束；准备工作可能仍在继续，请手动刷新。');return;}
      state.attempts++;
      try{const value=await this.request<NativeDraft>('input.inspect',{id},1500);this.adoptRead(id,value);state.failures=0;}
      catch{if(++state.failures>=3){stop('本地状态检查未成功，请手动刷新；未将准备工作视为完成。');return;}}
      const selections=this.records.get(id)?.selections??[];
      for(const selectionId of state.selectionIds){
        const item=selections.find(item=>item.id===selectionId),key=`${id}:${selectionId}`;
        if(!item||item.preparation.state!=='selected'&&item.preparation.state!=='preparing'){state.selectionIds.delete(selectionId);this.automaticPreparations.delete(key);}
        else if(item.preparation.state==='selected'&&this.automaticPreparations.has(key)){this.automaticPreparations.delete(key);void this.prepare(id,selectionId).catch(()=>{});}
      }
      if(this.alive&&state.selectionIds.size)next();else stop();
    },500);};next();
  }
  async freeze(id:string){
    const r=this.records.get(id);if(!r||r.busy||r.freezeBarrier)throw Error('草稿操作尚未完成，请稍候。');
    const target=this.capture(r);let release!:()=>void;r.freezeBarrier=new Promise<void>(resolve=>{release=resolve;});
    try{
      const captured=await this.flushCaptured(id,r,target,true);
      const frozen=await this.request<FrozenInput>('input.freeze',{id,expectedRevision:captured.draft.revision,operationId:crypto.randomUUID()});
      return {frozen,editEpoch:target.editEpoch};
    }finally{r.freezeBarrier=undefined;release();if(r.status==='pending')void this.flush(id).catch(()=>{});}
  }
  async confirmAdmission(ack:NativeAdmissionAck,editEpoch?:number){
    const id=ack.intent.id,r=this.records.get(id);
    if(ack.draft.id!==id||ack.intent.delivery!=='acknowledged'||ack.intent.receipt?.intentId!==ack.intent.intentId)throw Error('发送确认与草稿关联不匹配。');
    if(!r){this.adoptRead(id,ack.draft);return;}
    if(ack.draft.stateVersion<r.saved.stateVersion)return;
    if(!ack.draftCleared||ack.draft.revision!==ack.intent.inputRevision+1||r.saved.revision!==ack.intent.inputRevision){this.adoptRead(id,ack.draft);return;}
    this.clearTimers(r);const throughEpoch=editEpoch??r.savedEpoch,sameEdit=r.editEpoch===throughEpoch;r.saved=ack.draft;
    if(!sameEdit)r.admissionClear={fromRevision:ack.intent.inputRevision,toRevision:ack.draft.revision,throughEpoch};
    if(sameEdit&&!r.writer){r.text=ack.draft.text;r.selections=ack.draft.selections;r.savedEpoch=r.editEpoch;r.status='saved';r.error=undefined;}
    else if(!r.writer){r.retry=undefined;r.status='pending';r.error=undefined;}
    this.notify();
    if(r.status==='pending'&&!r.writer)await this.flush(id);
  }
  async accepted(id:string,revision:number,editEpoch:number){
    const r=this.records.get(id);if(!r||r.editEpoch!==editEpoch||r.saved.revision!==revision||r.writer)return;
    this.clearTimers(r);r.status='pending';this.notify();
    const writer=(async()=>{
      try{
        const value=await this.request<NativeDraft>('input.clear',{id,expectedRevision:revision,operationId:crypto.randomUUID()});
        this.metadata(r,value);
        if(r.editEpoch===editEpoch){r.text=value.text;r.selections=value.selections;r.savedEpoch=r.editEpoch;r.status='saved';}else r.status='pending';
      }catch(error){this.fail(r,error);}
    })();r.writer=writer;
    try{await writer;}finally{if(r.writer===writer)r.writer=undefined;this.notify();}
    if(r.status==='pending')void this.flush(id).catch(()=>{});
  }
  dispose(){this.alive=false;for(const r of this.records.values())this.clearTimers(r);for(const poll of this.polls.values())clearTimeout(poll.timer);this.polls.clear();this.automaticPreparations.clear();}
}
