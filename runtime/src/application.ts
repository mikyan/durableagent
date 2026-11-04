import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {Models} from '@earendil-works/pi-ai/models';
import {Harness,createRegistry,defineDoc,type ConversationId,type ConversationView,type HarnessSettings,type Storage,type EntryRecord,type ConversationWatch} from '@earendil-works/pi-durable';
import {openOwnedStorage,auditStorageSecret} from './storage.js';
import type {ApplicationRequest,ApplicationResponse,ApplicationEnvelope,ApplicationStatus,ConversationSummary,ConversationSnapshot,HistoryMessage,ModelSelection} from './application-protocol.js';
import {installConversationAgent} from './extensions/conversation-agent.js';
import {MODELS_EXTENSION} from './model-protocol.js';
import {ModelConnections,ModelConfigurationError,type StoredModels} from './model-connections.js';
import {createHash} from 'node:crypto';
import {InputError,inputCapability,materializeFrozenInput} from './input.js';
import {INPUT_EXTENSION,type FrozenInputAccess,type InputCapability,type InputConversation} from './input-protocol.js';
import {SUBMISSION_EXTENSION,type SendAuthority,type SubmissionContext} from './submission-protocol.js';
import {Submissions,SubmissionError,type SubmissionBoundary} from './submission.js';
import {DispatchGate} from './dispatch-gate.js';

type ProductRecord={id:string;sdkId:number;title:string;workspaceId:string;createdAt:number};
const Configuration=defineDoc({kind:'app.configuration',version:1,scope:'session',initial:()=>({initialized:false as boolean,defaultModel:null as ModelSelection|null,workspace:{id:'default',path:''}}),checkpointWhen:()=>false});
const Products=defineDoc({kind:'app.product-conversations',version:1,scope:'session',initial:()=>({items:{} as Record<string,ProductRecord>}),checkpointWhen:()=>false});
const ModelConfiguration=defineDoc({kind:'app.model-configuration',version:1,scope:'session',initial:():StoredModels=>({version:0,defaultModel:null,connections:[]}),checkpointWhen:()=>false});
class DuplicateCreation extends Error {constructor(readonly productId:string){super('Creation already committed');}}
class ActionError extends Error {constructor(readonly code:string,message:string){super(message);}}
const settings:HarnessSettings={progress:{partialIntervalMs:1,outputIntervalMs:1,persistWithinMs:1000},retry:{enabled:false,maxRetries:0,baseDelayMs:1}};
export type ApplicationInputs=FrozenInputAccess&{rememberConversation(conversation:InputConversation,capability?:InputCapability):void};
export type ApplicationOptions={path:string;models:Models;connections?:ModelConnections;inputs?:ApplicationInputs;sends?:SendAuthority;submissionBoundary?:(stage:SubmissionBoundary,intent:import('./submission-protocol.js').NativeSendIntent)=>void|Promise<void>;initialModel?:ModelSelection;workspacePath:string;secret?:string;bootstrapSettings?:()=>HarnessSettings;loadConfiguration?:()=>Promise<void>;storageFactory?:()=>Promise<Storage>};
export class Application {
  private harness?:Harness;
  private starting?:Promise<void>;
  private closing?:Promise<void>;
  private state:ApplicationStatus={phase:'opening',extensions:[]};
  private actions=new Set<string>();
  private storedSeq:number|null=null;
  private revision=0;
  private subscriptions=new Map<string,{connectionId:string;watch:ConversationWatch}>();
  private attachments=new Map<string,object>();
  private connectionEpochs=new Map<string,number>();
  private defaultModel:ModelSelection|null=null;
  private configurationTail:Promise<unknown>=Promise.resolve();
  private rememberedInputs=new Map<string,string>();
  private submissions?:Submissions;
  private dispatch=new DispatchGate();
  private workspace={id:'default',path:''};
  constructor(private readonly options:ApplicationOptions) {installConversationAgent(extension=>{this.state.extensions.push(extension.id);for(const action of extension.actions)this.actions.add(action);});if(options.connections){this.state.extensions.push(MODELS_EXTENSION.id);for(const action of MODELS_EXTENSION.actions)this.actions.add(action);}if(options.inputs)this.state.extensions.push(INPUT_EXTENSION.id);if(options.sends){this.state.extensions.push(SUBMISSION_EXTENSION.id);for(const action of SUBMISSION_EXTENSION.actions)this.actions.add(action);}}
  status(){return {...this.state};}
  start():Promise<void> {
    if(this.closing)return this.closing.then(()=>this.start());
    if(this.starting)return this.starting;
    if(this.harness)return Promise.resolve();
    this.state={...this.state,phase:'opening',reason:undefined};
    this.starting=this.open().catch(async error=>{this.state={...this.state,phase:'failed',reason:this.safeError(error)};await this.harness?.close(context);this.harness=undefined;throw error;}).finally(()=>{this.starting=undefined;});
    return this.starting;
  }
  private async open() {
    this.dispatch=new DispatchGate();
    this.runtimeSettings(); // Fail before open: SDK catches some settings getter errors during reconciliation.
    if(!this.options.inputs||!this.options.sends)throw new ActionError('INPUT_UNAVAILABLE','原生输入与停止存储尚不可用，运行保持关闭');
    const storage=this.options.storageFactory?await this.options.storageFactory():(await openOwnedStorage(this.options.path,this.options.secret)).storage;
    try {
      this.harness=await Harness.open(storage,{models:()=>this.dispatch.models(this.options.models),settings:()=>this.runtimeSettings(),registry:createRegistry()},context);
    }catch(error){await storage.close(context);throw error;}
    void this.harness.closed.then(result=>{if(result.kind==='failed')this.state={...this.state,phase:'failed',reason:this.safeError(result.error)};});
    this.harness.observeCommits({advance:publication=>{this.storedSeq=publication.seq;},end:()=>{}});
    this.state={...this.state,phase:'configuring'};
    await this.options.loadConfiguration?.();
    this.defaultModel=await this.harness.commit(async tx=>{
      const configuration=await tx.doc(Configuration);
      if(!configuration.initialized){configuration.defaultModel=this.options.initialModel??null;configuration.workspace={id:'default',path:this.options.workspacePath};configuration.initialized=true;}
      this.workspace={...configuration.workspace};
      return configuration.defaultModel?{...configuration.defaultModel}:null;
    },context);
    if(this.options.connections){const configuration=await this.harness.commit(async tx=>JSON.parse(JSON.stringify(await tx.doc(ModelConfiguration))) as StoredModels,context);this.options.connections.publish(configuration);this.defaultModel=configuration.defaultModel;}
    if(this.options.sends&&this.options.inputs)this.submissions=new Submissions({harness:this.harness,authority:this.options.sends,inputs:this.options.inputs,models:this.options.models,available:this.options.connections?async(provider,modelId)=>{const connections=this.options.connections!;return !!connections.capability(provider,modelId)&&(await connections.publicConfiguration()).connections.some(item=>item.id===provider&&item.credential.configured);}:undefined,ready:()=>{this.ready();},pause:()=>this.dispatch.pause(),boundary:this.options.submissionBoundary,resolve:async(tx,id)=>{const products=await tx.doc(Products),configuration=await tx.doc(Configuration);if(!Object.hasOwn(products.items,id))throw new SubmissionError('NOT_FOUND','会话不存在');return this.submissionContext(products.items[id],configuration.workspace);}});
    await this.submissions?.prepare();
    if(this.submissions)this.dispatch.check=()=>this.submissions!.checkDispatch();
    this.state={...this.state,phase:'ready'};
    if(this.options.inputs)for(const product of Object.values((await this.harness.snapshot(Products,context))?.items??{}))await this.snapshot(product.id,product);
    await this.submissions?.recover();
    this.dispatch.release();
    this.harness.resume();
  }
  private ready() {
    if(this.state.phase!=='ready'||!this.harness)throw new ActionError(this.state.phase==='configuring'?'CONFIG_LOADING':this.state.phase==='failed'?'STORAGE_UNAVAILABLE':'HOST_NOT_READY',this.state.reason??(this.state.phase==='configuring'?'正在装载配置':'运行宿主尚未就绪'));
    return this.harness;
  }
  private runtimeSettings() {
    const value=this.options.bootstrapSettings?.()??settings;
    if(value.stream){
      const allowed=new Set(['transport','timeoutMs','maxRetries','maxRetryDelayMs','cacheRetention','deferred']);
      if(Object.keys(value.stream).some(key=>!allowed.has(key)))throw new ActionError('INVALID_STREAM_OPTIONS','模型请求选项只能包含允许的非秘密字段');
      const deferred=value.stream.deferred;
      if(deferred&&typeof deferred==='object'&&(Object.keys(deferred).some(key=>key!=='window')||!['15m','1h','24h'].includes(deferred.window??'')))throw new ActionError('INVALID_STREAM_OPTIONS','模型请求选项无效');
      for(const [key,item]of Object.entries(value.stream))if(key!=='deferred'&&typeof item==='object')throw new ActionError('INVALID_STREAM_OPTIONS','模型请求选项无效');
      for(const [key,item]of Object.entries(value.stream)){
        const invalid=['timeoutMs','maxRetries','maxRetryDelayMs'].includes(key)?typeof item!=='number'||!Number.isFinite(item)||item<0:key==='transport'?!['sse','websocket','websocket-cached','auto'].includes(String(item)):key==='cacheRetention'?!['none','short','long'].includes(String(item)):key==='deferred'&&typeof item!=='object'&&typeof item!=='boolean';
        if(invalid)throw new ActionError('INVALID_STREAM_OPTIONS','模型请求选项无效');
      }
    }
    return value;
  }
  private safeError(error:unknown) {const message=error instanceof Error?error.message:String(error);return this.options.secret?message.replaceAll(this.options.secret,'[REDACTED]'):message;}
  private text(payload:Record<string,unknown>,key:string,max=100000) {const value=payload[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new ActionError('INVALID_ARGUMENT',`${key} 无效`);return value;}
  async request(request:ApplicationRequest,emit:(event:ApplicationEnvelope)=>void=()=>{}):Promise<ApplicationResponse> {
    const base={type:'response' as const,protocol:1 as const,connectionId:request.connectionId,requestId:request.requestId};
    try {
      if(request.protocol!==1)throw new ActionError('PROTOCOL_MISMATCH','界面与运行宿主版本不兼容');
      if(request.method==='status')return {...base,ok:true,value:this.status()};
      const harness=this.ready(),payload=request.payload??{};
      if(request.method!=='stop'&&!this.actions.has(request.method))throw new ActionError('UNKNOWN_ACTION','未登记的应用操作');
      let value:unknown;
      switch(request.method) {
        case 'models.get':value=await this.options.connections!.publicConfiguration();break;
        case 'models.create':case 'models.setDefault':case 'models.setEnabled':value=await this.changeModels(request.method,payload);break;
        case 'models.select': {
          const model=this.options.connections!.selection(payload.selection),product=await this.product(this.text(payload,'id',128));
          await (await harness.conversation(product.sdkId as ConversationId,context))!.configure({model:{provider:model.provider,modelId:model.modelId}},context);
          value=await this.snapshot(product.id,product);break;
        }
        case 'list': {
          const products=await harness.snapshot(Products,context);
          value={conversations:await Promise.all(Object.values(products?.items??{}).map(product=>this.summary(product)))};break;
        }
        case 'create':value=await this.create(this.text(payload,'creationId',128),typeof payload.title==='string'?payload.title.slice(0,120):'新会话');break;
        case 'open':value=await this.snapshot(this.text(payload,'id',128));break;
        case 'history':value=await this.history(this.text(payload,'id',128),payload.cursor,payload.limit);break;
        case 'send': {
          if(!this.submissions)throw new ActionError('INPUT_UNAVAILABLE','原生发送意图存储尚不可用');
          if(Object.keys(payload).some(key=>key!=='intentId'))throw new ActionError('INVALID_ARGUMENT','发送仅接受已保存的意图身份');
          value=await this.submissions.send(this.text(payload,'intentId',128));break;
        }
        case 'sendStatus':value=await this.submissions!.status(this.text(payload,'intentId',128));break;
        case 'sendList':value=await this.submissions!.list({id:this.text(payload,'id',128),cursor:typeof payload.cursor==='string'?payload.cursor:undefined,limit:typeof payload.limit==='number'?payload.limit:undefined});break;
        case 'stop': {
          const stopId=this.text(payload,'stopId',128),id=this.text(payload,'id',128);
          if(!this.submissions)throw new ActionError('INPUT_UNAVAILABLE','原生停止存储尚不可用');
          value=await this.submissions.stop(id,stopId);break;
        }
        case 'subscribe': {
          const id=this.text(payload,'id',128),subscriptionId=this.text(payload,'subscriptionId',128);
          const key=JSON.stringify([request.connectionId,subscriptionId]),token={},epoch=this.connectionEpochs.get(request.connectionId)??0;
          this.attachments.set(key,token);
          const current=()=>this.attachments.get(key)===token&&(this.connectionEpochs.get(request.connectionId)??0)===epoch;
          const product=await this.product(id);
          await this.subscriptions.get(key)?.watch.stop();
          const conversation=(await harness.conversation(product.sdkId as ConversationId,context))!;
          const watch=await conversation.watch(context);const subscription={connectionId:request.connectionId,watch};
          if(!current()){await watch.stop();throw new ActionError('CONNECTION_CLOSED','订阅连接已更换');}
          this.subscriptions.set(key,subscription);
          value=this.project(product,watch.value);
          const publish=(snapshot:ConversationSnapshot)=>{if(current()&&this.subscriptions.get(key)===subscription)emit({type:'conversation',protocol:1,connectionId:request.connectionId,subscriptionId,snapshot});};
          const failed=(error:unknown)=>{const snapshot=this.project(product,watch.value);publish({...snapshot,phase:'failed',progress:undefined,conversation:{...snapshot.conversation,phase:'failed'},reason:this.safeError(error)});};
          watch.start(async call=>{if(call.kind==='value')publish(this.project(product,call.value));else failed(call.error);});
          void watch.closed.then(end=>{if(end.kind==='failed')failed(end.error);});break;
        }
        case 'unsubscribe': {
          const key=JSON.stringify([request.connectionId,this.text(payload,'subscriptionId',128)]),subscription=this.subscriptions.get(key);
          this.attachments.delete(key);
          this.subscriptions.delete(key);await subscription?.watch.stop();value={};break;
        }
        default:throw new ActionError('UNKNOWN_ACTION','不支持的应用操作');
      }
      return {...base,ok:true,value};
    }catch(error){return {...base,ok:false,error:{code:error instanceof ActionError||error instanceof ModelConfigurationError||error instanceof InputError||error instanceof SubmissionError?error.code:'ACTION_FAILED',message:this.safeError(error)}};}
  }
  credentialTarget(id:string){return this.state.phase==='ready'&&!!this.options.connections?.contains(id);}
  private changeModels(method:string,payload:Record<string,unknown>) {
    const run=async()=>{
      const harness=this.ready(),connections=this.options.connections!;
      const definition=method==='models.create'?connections.definition(payload):undefined;
      const configuration=await harness.commit(async tx=>{
        const doc=await tx.doc(ModelConfiguration);
        if(definition){const previous=doc.connections.find(item=>item.id===definition.id);if(previous){if(previous.endpoint!==definition.endpoint||previous.protocol!==definition.protocol||JSON.stringify(previous.models)!==JSON.stringify(definition.models)||previous.name!==definition.name)throw new ModelConfigurationError('IMMUTABLE_CONNECTION','连接定义已固定；请新建连接');return JSON.parse(JSON.stringify(doc)) as StoredModels;}}
        if(!Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion!==doc.version)throw new ModelConfigurationError('CONFIG_CONFLICT','模型设置已更新，请刷新后重试');
        if(definition)doc.connections.push(definition);
        else if(method==='models.setDefault')doc.defaultModel=connections.selection(payload.selection,doc);
        else {const item=doc.connections.find(item=>item.id===payload.id);if(!item||typeof payload.enabled!=='boolean')throw new ModelConfigurationError('INVALID_ARGUMENT','连接状态无效');item.enabled=payload.enabled;}
        doc.version++;return JSON.parse(JSON.stringify(doc)) as StoredModels;
      },context);
      try{connections.publish(configuration);this.defaultModel=configuration.defaultModel;}
      catch{connections.block();this.state={...this.state,phase:'failed',reason:'模型配置已保存，但运行配置未发布。请重启应用重新装载。'};throw new ModelConfigurationError('CONFIG_PUBLICATION_FAILED',this.state.reason!);}
      if(this.options.inputs)for(const product of Object.values((await harness.snapshot(Products,context))?.items??{}))await this.snapshot(product.id,product);
      return connections.publicConfiguration();
    };
    const result=this.configurationTail.then(run,run);this.configurationTail=result.catch(()=>{});return result;
  }
  private async product(id:string) {const items=(await this.ready().snapshot(Products,context))?.items??{};if(!Object.hasOwn(items,id))throw new ActionError('NOT_FOUND','会话不存在');return items[id];}
  private async create(id:string,title:string) {
    const harness=this.ready();const model=this.defaultModel;
    if(!model)throw new ActionError('MODEL_UNAVAILABLE','请先配置新会话默认模型');
    try {
      await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:model.provider,modelId:model.modelId},maxTurns:3},init:async(tx,sdkId)=>{
        const products=await tx.doc(Products);if(Object.hasOwn(products.items,id))throw new DuplicateCreation(id);
        products.items[id]={id,sdkId,title:title.trim()||'新会话',workspaceId:'default',createdAt:Date.now()};
      }},context);
    }catch(error){if(!(error instanceof DuplicateCreation))throw error;}
    return {conversation:await this.summary(await this.product(id)),storedSeq:this.storedSeq};
  }
  private async summary(product:ProductRecord):Promise<ConversationSummary> {return (await this.snapshot(product.id,product)).conversation;}
  private submissionContext(product:ProductRecord,workspace=this.workspace):SubmissionContext{return {sdkConversationId:product.sdkId,associationVersion:1,location:{workspaceId:product.workspaceId,version:1,identity:createHash('sha256').update(JSON.stringify({id:workspace.id,path:workspace.path})).digest('hex')}};}
  private async snapshot(id:string,known?:ProductRecord) {
    const product=known??await this.product(id),harness=this.ready();
    const watch=await (await harness.conversation(product.sdkId as ConversationId,context))!.watch(context);
    try{return this.project(product,watch.value);}finally{await watch.stop();}
  }
  private project(product:ProductRecord,view:ConversationView):ConversationSnapshot {
    const live=view.docs['pi.live'] as any,agent=view.docs['pi.agent'] as any;
    const ref=agent?.model??{},model=this.options.models.getModel(ref.provider,ref.modelId);
    const entries=view.entries.flatMap(entry=>this.message(entry));
    const phase=live?.run?(live.generation?.retry||live.generation?.deferred?'waiting':'running'):live?.runFailure?(live.runFailure.reason==='aborted'?'stopped':'failed'):entries.some(entry=>entry.role==='assistant')?'done':'idle';
    const text=live?.run?this.content(live.generation?.message?.content):'';
    const selected={provider:ref.provider??'',modelId:ref.modelId??'',name:model?.name??ref.modelId??'未配置模型'};
    if(this.options.inputs){
      const conversation={id:product.id,title:product.title,model:selected,submissionContext:this.submissionContext(product)};
      const capability=this.options.connections?this.options.connections.capability(ref.provider,ref.modelId):model?inputCapability(model,'validation'):undefined;
      const key=JSON.stringify({conversation,capability});
      if(this.rememberedInputs.get(product.id)!==key){this.options.inputs.rememberConversation(conversation,capability);this.rememberedInputs.set(product.id,key);}
    }
    return {id:product.id,revision:++this.revision,conversation:{id:product.id,title:product.title,model:selected,workspaceId:product.workspaceId,projectId:null,createdAt:product.createdAt,phase,submissionContext:this.submissionContext(product)},entries,progress:text?{text,persisted:false}:undefined,phase,storedSeq:this.storedSeq,reason:live?.runFailure?.detail??live?.generation?.retry?.error};
  }
  private content(value:any):string {return typeof value==='string'?value:Array.isArray(value)?value.filter(x=>x.type==='text').map(x=>x.text).join(''):'';}
  private message(entry:EntryRecord):HistoryMessage[] {return (entry.model??[]).flatMap((message:any,index:number)=>{
    const text=this.content(message.content);
    const attachments=Array.isArray(message.content)?message.content.filter((item:any)=>item.type==='image').map((item:any)=>{const bytes=Buffer.from(item.data,'base64');return {kind:'image' as const,mimeType:item.mimeType,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}):[];
    return text||attachments.length?[{id:String(entry.id)+(index?':'+index:''),role:message.role==='toolResult'?'tool':message.role,text,persisted:true as const,...(attachments.length?{attachments}:{})}]:[];
  });}
  private async history(id:string,cursor:unknown,limit:unknown) {
    const product=await this.product(id),conversation=(await this.ready().conversation(product.sdkId as ConversationId,context))!;
    let sdkCursor:any;
    if(cursor!==undefined){try{const decoded=JSON.parse(Buffer.from(String(cursor),'base64url').toString());if(decoded.id!==id||decoded.version!==1)throw Error();sdkCursor=decoded.cursor;}catch{throw new ActionError('INVALID_CURSOR','历史位置不属于此会话');}}
    const size=typeof limit==='number'?Math.max(1,Math.min(50,Math.floor(limit))):25;
    const page=await conversation.entries({order:'descending'},size,sdkCursor,context);
    return {items:[...page.items].reverse().flatMap(entry=>this.message(entry)),next:page.next?Buffer.from(JSON.stringify({version:1,id,cursor:page.next})).toString('base64url'):undefined};
  }
  async disconnect(connectionId:string) {this.connectionEpochs.set(connectionId,(this.connectionEpochs.get(connectionId)??0)+1);const matches=[...this.subscriptions].filter(([,s])=>s.connectionId===connectionId);for(const [key,s]of matches){this.attachments.delete(key);this.subscriptions.delete(key);await s.watch.stop();}}
  close():Promise<void> {
    return this.closing??=(async()=>{
      await this.starting?.catch(()=>{});this.state={...this.state,phase:'closed'};
      this.attachments.clear();
      const watches=[...this.subscriptions.values()];this.subscriptions.clear();for(const entry of watches)await entry.watch.stop();
      let auditError:unknown;try{if(this.options.secret)await auditStorageSecret(this.options.path,this.options.secret);}catch(error){auditError=error;}
      await this.harness?.close(context);this.harness=undefined;
      if(this.options.secret)await auditStorageSecret(this.options.path,this.options.secret);if(auditError)throw auditError;
    })().finally(()=>{this.closing=undefined;});
  }
}
