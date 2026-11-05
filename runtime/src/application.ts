import {ModelRetryAfter} from './model-retry-after.js';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {Models} from '@earendil-works/pi-ai/models';
import {Harness,createRegistry,defineDoc,type ConversationId,type ConversationView,type HarnessSettings,type Storage,type EntryRecord,type ConversationWatch} from '@earendil-works/pi-durable';
import {openOwnedStorage,auditStorageSecret} from './storage.js';
import type {ApplicationRequest,ApplicationResponse,ApplicationEnvelope,ApplicationStatus,ConversationSummary,ConversationSnapshot,HistoryMessage,ModelSelection} from './application-protocol.js';
import {BUNDLED_EXTENSIONS,type ExtensionDescriptor,type ExtensionCatalog} from './extension-protocol.js';
import {assembleAgentExtensions,type AgentFactories} from './extensions/assembly.js';
import {routingAgent} from './extensions/routing-agent.js';
import {modelsAgent} from './extensions/models-agent.js';
import {Routing} from './routing.js';
import type {RouteAuthority,RouteRequest,RouteSource} from './routing-protocol.js';
import {installConversationAgent} from './extensions/conversation-agent.js';
import {MODELS_EXTENSION} from './model-protocol.js';
import {ModelConnections,ModelConfigurationError,type StoredModels} from './model-connections.js';
import {createHash} from 'node:crypto';
import {InputError,inputCapability,materializeFrozenInput} from './input.js';
import {INPUT_EXTENSION,type FrozenInputAccess,type InputCapability,type InputConversation} from './input-protocol.js';
import {SUBMISSION_EXTENSION,type SendAuthority,type SubmissionContext} from './submission-protocol.js';
import {Submissions,SubmissionError,type SubmissionBoundary} from './submission.js';
import {inheritBinding,bindingEnvironment} from './project-bindings.js';
import {Projects,ProjectError,type LocationAdapter,type EffectAuthority,type ProjectBoundary} from './projects.js';
import {PROJECTS_EXTENSION,type LocationEditAuthority} from './project-protocol.js';
import {DispatchGate} from './dispatch-gate.js';
import {ManagedExecution,ManagedExecutionError,EXECUTION_EXTENSION} from './managed-execution.js';
import {DATA_SAVER_EXTENSION,type DataSaverAuthority} from './data-saver-protocol.js';
import {storageFailure} from './storage-failure.js';
import {verifyApplicationStorage} from './storage-format.js';
import {RetainedHistory} from './retained-history.js';
import {Recovery,recoveryPreflight,type RecoveryHost} from './recovery.js';

import {Configuration,Products,validateConfiguration,type ProductRecord} from './application-records.js';
const ModelConfiguration=defineDoc({kind:'app.model-configuration',version:1,scope:'session',initial:():StoredModels=>({version:0,defaultModel:null,connections:[]}),checkpointWhen:()=>false});
class DuplicateCreation extends Error {constructor(readonly productId:string){super('Creation already committed');}}
class ActionError extends Error {constructor(readonly code:string,message:string){super(message);}}
const settings:HarnessSettings={progress:{partialIntervalMs:1,outputIntervalMs:1,persistWithinMs:1000},retry:{enabled:false,maxRetries:0,baseDelayMs:1}};
const recoverySettings:HarnessSettings={...settings,retry:{enabled:true,maxRetries:3,baseDelayMs:1000},restartLimit:5,stream:{maxRetries:0}};
export type ApplicationInputs=FrozenInputAccess&{rememberConversation(conversation:InputConversation,capability?:InputCapability):void};
export type ApplicationOptions={recovery?:RecoveryHost;dataSaver?:DataSaverAuthority;storageFormats?:Readonly<Record<string,import('./storage-format.js').ApplicationRecordFormat>>;execution?:ManagedExecution;routes?:RouteAuthority;extensions?:readonly ExtensionDescriptor[];agentFactories?:AgentFactories;path:string;models:Models;connections?:ModelConnections;inputs?:ApplicationInputs;sends?:SendAuthority;submissionBoundary?:(stage:SubmissionBoundary,intent:import('./submission-protocol.js').NativeSendIntent)=>void|Promise<void>;initialModel?:ModelSelection;workspacePath:string;secret?:string;bootstrapSettings?:()=>HarnessSettings;loadConfiguration?:()=>Promise<void>;projectBoundary?:(stage:ProjectBoundary)=>void|Promise<void>;registry?:ReturnType<typeof createRegistry>;effects?:EffectAuthority;locationEdits?:LocationEditAuthority;locations?:LocationAdapter;storageFactory?:()=>Promise<Storage>};
export class Application {
  private harness?:Harness;
  private retained?:RetainedHistory;
  private registry=createRegistry();
  private installedExtensions=new Map<string,string>();
  private routing?:Routing;
  private starting?:Promise<void>;
  private closing?:Promise<void>;
  private state:ApplicationStatus={phase:'opening',extensions:[]};
  private actions=new Set<string>();
  private storedSeq:number|null=null;
  private revision=0;
  private subscriptions=new Map<string,{connectionId:string;watch:ConversationWatch;refresh?:()=>void}>();
  private attachments=new Map<string,object>();
  private connectionEpochs=new Map<string,number>();
  private defaultModel:ModelSelection|null=null;
  private configurationTail:Promise<unknown>=Promise.resolve();
  private rememberedInputs=new Map<string,string>();
  private submissions?:Submissions;
  private projects?:Projects;
  private productsCache=new Map<string,ProductRecord>();
  private dispatch=new DispatchGate();
  private recovery?:Recovery;
  private modelRetryAfter?:ModelRetryAfter;
  private waking?:Promise<void>;
  private projecting?:Promise<void>;
  private projectAgain=false;
  private publicationFailure?:string;
  private workspace={id:'default',path:''};
  constructor(private readonly options:ApplicationOptions) {if(options.dataSaver){this.state.extensions.push(DATA_SAVER_EXTENSION.id);for(const action of DATA_SAVER_EXTENSION.actions)this.actions.add(action);}for(const action of ['extensions.get','routing.list','routing.query','routing.create','routing.send'])this.actions.add(action);if(options.execution){options.locations=options.execution.locations;options.effects=options.execution;this.state.extensions.push(EXECUTION_EXTENSION.id);for(const action of EXECUTION_EXTENSION.actions)this.actions.add(action);}this.state.extensions.push(PROJECTS_EXTENSION.id);for(const action of PROJECTS_EXTENSION.actions)this.actions.add(action);installConversationAgent(extension=>{this.state.extensions.push(extension.id);for(const action of extension.actions)this.actions.add(action);});if(options.connections){this.state.extensions.push(MODELS_EXTENSION.id);for(const action of MODELS_EXTENSION.actions)this.actions.add(action);}if(options.inputs)this.state.extensions.push(INPUT_EXTENSION.id);if(options.sends){this.state.extensions.push(SUBMISSION_EXTENSION.id);for(const action of SUBMISSION_EXTENSION.actions)this.actions.add(action);}}
  status(){return {...this.state,...(this.publicationFailure&&!this.state.reason?{reason:this.publicationFailure}:{})};}
  start():Promise<void> {
    if(this.closing)return this.closing.then(()=>this.start());
    if(this.starting)return this.starting;
    if(this.harness)return Promise.resolve();
    this.state={...this.state,phase:'opening',reason:undefined,failure:undefined,readOnly:undefined};
    this.starting=this.open().catch(async error=>{this.state={...this.state,phase:'failed',reason:this.safeError(error),failure:storageFailure(error),readOnly:!!this.retained};await this.harness?.close(context);this.harness=undefined;this.recovery?.close();throw error;}).finally(()=>{this.starting=undefined;});
    return this.starting;
  }
  private async open() {
    if(this.options.recovery)await recoveryPreflight(this.options.recovery);
    await this.retained?.close();this.retained=undefined;
    this.dispatch=new DispatchGate();
    this.registry=createRegistry();for(const contribution of this.options.registry?.snapshot().installed()??[])this.registry.install(contribution);
    this.recovery?.close();this.recovery=this.options.recovery?new Recovery(this.options.recovery,()=>{for(const subscription of this.subscriptions.values())subscription.refresh?.();this.queueHostProjection();}):undefined;
    this.options.execution?.setRecovery(this.recovery);
    this.recovery?.install(this.registry,this.options.execution?(id,context)=>this.options.execution!.awaitContinuation(id,context):undefined);
    this.options.execution?.install(this.registry);
    const getRouting=()=>{this.ready();if(!this.routing)throw new ActionError('ROUTING_UNAVAILABLE','转交能力尚未就绪');return this.routing;};
    this.installedExtensions=assembleAgentExtensions(this.options.extensions??BUNDLED_EXTENSIONS,{routing:()=>routingAgent(getRouting),models:()=>modelsAgent(async(method,payload)=>{const r=await this.request({protocol:1,connectionId:'agent-extensions',requestId:crypto.randomUUID(),method:method as any,payload});if(!r.ok)throw new ActionError(r.error.code,r.error.message);return r.value;},getRouting),...this.options.agentFactories},this.registry);
    if(!this.options.inputs||!this.options.sends)throw new ActionError('INPUT_UNAVAILABLE','原生输入与停止存储尚不可用，运行保持关闭');
    if(this.options.recovery)await this.options.sends.pendingStops();
    this.runtimeSettings(); // Fail before open: SDK catches some settings getter errors during reconciliation.
    const storage=this.options.storageFactory?await this.options.storageFactory():(await openOwnedStorage(this.options.path,this.options.secret)).storage;
    try {
      await verifyApplicationStorage(storage,this.options.storageFormats);
      this.harness=await Harness.open(storage,{models:()=>this.dispatch.models(this.options.models),settings:()=>this.runtimeSettings(),registry:this.registry,conversationCreated:inheritBinding,...(this.recovery?{onWake:wake=>this.recovery!.schedule(wake),now:this.options.recovery!.now}:{}),...(this.options.locations?{env:target=>bindingEnvironment(target,this.options.locations)}:{})},context);
    }catch(error){if(storageFailure(error)?.code==='STORAGE_VERSION_UNSUPPORTED')this.retained=await RetainedHistory.open(storage);if(!this.retained)await storage.close(context);throw error;}
    if(this.options.connections){this.modelRetryAfter=new ModelRetryAfter(this.harness,this.options.recovery?.now??Date.now,at=>{this.recovery?.setModelDeadline(at);for(const subscription of this.subscriptions.values())subscription.refresh?.();this.queueHostProjection();});await this.modelRetryAfter.initialize();this.options.connections.attachRetryAfter(this.modelRetryAfter);}
    this.options.execution?.attach(this.harness);
    void this.harness.closed.then(result=>{if(result.kind==='failed')this.state={...this.state,phase:'failed',reason:this.safeError(result.error),failure:storageFailure(result.error)};});
    this.harness.observeCommits({advance:publication=>{this.storedSeq=publication.seq;this.recovery?.changedConditions();this.queueHostProjection();},end:()=>{}});
    this.state={...this.state,phase:'configuring'};
    await this.options.loadConfiguration?.();
    this.defaultModel=await this.harness.commit(async tx=>{
      const configuration=await tx.doc(Configuration);
      validateConfiguration(configuration);
      if(!configuration.initialized){configuration.defaultModel=this.options.initialModel??null;configuration.workspace={id:'default',path:this.options.workspacePath};configuration.initialized=true;}
      this.workspace={...configuration.workspace};
      return configuration.defaultModel?{...configuration.defaultModel}:null;
    },context);
    if(this.options.connections){const configuration=await this.harness.commit(async tx=>JSON.parse(JSON.stringify(await tx.doc(ModelConfiguration))) as StoredModels,context);this.options.connections.publish(configuration);this.defaultModel=configuration.defaultModel;}
    this.projects=new Projects({harness:this.harness,sends:this.options.sends!,authority:this.options.locationEdits??(('beginLocationEdit' in this.options.sends!)?this.options.sends as unknown as LocationEditAuthority:undefined),adapter:this.options.locations,boundary:this.options.projectBoundary,effects:this.options.effects,publish:async()=>{await this.refreshProducts();}});
    await this.projects.initialize();await this.refreshProducts();await this.projects.recover();
    if(this.options.sends&&this.options.inputs)this.submissions=new Submissions({harness:this.harness,authority:this.options.sends,inputs:this.options.inputs,models:this.options.models,available:this.options.connections?async(provider,modelId)=>{const connections=this.options.connections!;return !!connections.capability(provider,modelId)&&(await connections.publicConfiguration()).connections.some(item=>item.id===provider&&item.credential.configured);}:undefined,ready:()=>{this.ready();},pause:()=>this.dispatch.pause(),boundary:this.options.submissionBoundary,reconcileEffects:this.options.execution?()=>this.options.execution!.recover():undefined,resolve:(tx,id)=>this.projects!.resolve(tx,id),adopt:(tx,id,bindingId)=>this.projects!.adopt(tx,id,bindingId)});
    this.routing=new Routing({harness:this.harness,authority:this.options.sends!,routes:this.options.routes??(('createRoute' in this.options.sends!)?this.options.sends as unknown as RouteAuthority:undefined),submissions:this.submissions!,ids:async()=>Object.keys((await this.harness!.snapshot(Products,context))?.items??{}),summary:async id=>this.summary(await this.product(id)),create:(id,title)=>this.create(id,title),ready:()=>{this.ready();}});
    await this.options.execution?.recover();
    await this.submissions?.prepare();
    if(this.submissions)this.dispatch.check=async()=>{await this.submissions!.checkDispatch();await this.recovery?.model();};
    this.state={...this.state,phase:'ready'};
    this.queueHostProjection();
    if(this.options.inputs)for(const product of Object.values((await this.harness.snapshot(Products,context))?.items??{}))await this.snapshot(product.id,product);
    await this.submissions?.recover();
    await this.recovery?.flushWake();
    this.dispatch.release();
    this.harness.resume();
  }
  /** A host wake observes and continues existing SDK work; it never creates an input. */
  wake():Promise<void>{return this.waking??=(async()=>{
    if(this.state.phase!=='ready'||!this.harness||this.closing)return;
    await this.submissions?.prepare();await this.options.execution?.recover();
    await this.recovery?.flushWake();
    this.queueHostProjection();
    if(this.state.phase==='ready'&&!this.closing)this.harness?.resume();
  })().finally(()=>{this.waking=undefined;});}
  /** Read-only native publication, independent of UI subscriptions. Settled SDK input receipts
   * provide the completion identity; an assistant/tool message alone never means work is done. */
  private queueHostProjection(){
    if(this.state.phase!=='ready'||this.closing||!this.options.recovery?.publishProjection)return;
    this.projectAgain=true;if(this.projecting)return;
    this.projecting=(async()=>{while(this.projectAgain&&this.state.phase==='ready'&&!this.closing){
      this.projectAgain=false;
      const conversations:import('./recovery.js').RecoveryProjection['conversations']=[],completions:import('./recovery.js').RecoveryProjection['completions']=[];
      for(const product of this.productsCache.values()){
        const view=await this.snapshot(product.id,product);conversations.push({id:product.id,phase:view.phase,...(view.recovery?{recovery:view.recovery}:{})});
        if(view.phase!=='done')continue;
        let cursor:string|undefined,latest:string|undefined;
        do{const page=await this.submissions!.list({id:product.id,cursor,limit:50});for(const send of page.items){const answer=send.submission?.answerEntryId;if(send.submission?.status==='done'&&answer&&/^\d+$/.test(answer)&&(!latest||BigInt(answer)>BigInt(latest)))latest=answer;}cursor=page.next;}while(cursor);
        if(latest)completions.push({identity:`answer:${product.sdkId}:${latest}`,conversationId:product.id});
      }
      await this.options.recovery!.publishProjection!({conversations,completions});
      this.publicationFailure=undefined;
    }})().catch(()=>{this.publicationFailure='运行状态暂未同步到系统；已保存的结果仍可在会话查看。';}).finally(()=>{this.projecting=undefined;});
  }
  private ready() {
    if(this.state.phase!=='ready'||!this.harness)throw new ActionError(this.state.phase==='configuring'?'CONFIG_LOADING':this.state.phase==='failed'?'STORAGE_UNAVAILABLE':'HOST_NOT_READY',this.state.reason??(this.state.phase==='configuring'?'正在装载配置':'运行宿主尚未就绪'));
    return this.harness;
  }
  private runtimeSettings() {
    const value=this.options.bootstrapSettings?.()??(this.options.recovery?recoverySettings:settings);
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
  private safeError(error:unknown) {const storage=storageFailure(error);if(storage)return storage.message;const message=error instanceof Error?error.message:String(error);return this.options.secret?message.replaceAll(this.options.secret,'[REDACTED]'):message;}
  private text(payload:Record<string,unknown>,key:string,max=100000) {const value=payload[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw new ActionError('INVALID_ARGUMENT',`${key} 无效`);return value;}
  async request(request:ApplicationRequest,emit:(event:ApplicationEnvelope)=>void=()=>{}):Promise<ApplicationResponse> {
    const base={type:'response' as const,protocol:1 as const,connectionId:request.connectionId,requestId:request.requestId};
    try {
      if(request.protocol!==1)throw new ActionError('PROTOCOL_MISMATCH','界面与运行宿主版本不兼容');
      if(request.method==='status')return {...base,ok:true,value:this.status()};
      if(this.retained){const payload=request.payload??{};if(request.method==='list')return {...base,ok:true,value:this.retained.list()};if(request.method==='history')return {...base,ok:true,value:await this.retained.history(this.text(payload,'id'),payload.cursor,payload.limit)};if(request.method==='open')return {...base,ok:true,value:await this.retained.snapshot(this.text(payload,'id'))};}
      const harness=this.ready(),payload=request.payload??{};
      if(request.method!=='stop'&&!this.actions.has(request.method))throw new ActionError('UNKNOWN_ACTION','未登记的应用操作');
      let value:unknown;
      if(PROJECTS_EXTENSION.actions.includes(request.method as any))return {...base,ok:true,value:request.method==='projects.get'?await this.projects!.view(typeof payload.id==='string'?payload.id:undefined):await this.submissions!.coordinate(()=>this.projects!.change(request.method,payload))};
      switch(request.method) {
        case 'dataSaver.get':value=await this.options.dataSaver!.get();break;
        case 'dataSaver.configure':
          if(typeof payload.enabled!=='boolean'||!Number.isSafeInteger(payload.expectedVersion)||Number(payload.expectedVersion)<0)throw new ActionError('INVALID_ARGUMENT','省流设置参数无效');
          value=await this.options.dataSaver!.configure(payload.enabled,Number(payload.expectedVersion));break;
        case 'dataSaver.operations':{
          const product=await this.product(this.text(payload,'id',128));
          value=await this.options.dataSaver!.operations(product.id,typeof payload.cursor==='string'?payload.cursor:undefined);break;
        }
        case 'dataSaver.grant':{
          const product=await this.product(this.text(payload,'id',128)),executionId=this.text(payload,'executionId',128);
          const requestDigest=this.text(payload,'requestDigest',64),finalDigest=this.text(payload,'finalDigest',64),period=Number(payload.period);
          if(!/^[a-f0-9]{64}$/.test(requestDigest)||!/^[a-f0-9]{64}$/.test(finalDigest)||!Number.isSafeInteger(payload.period)||period<1)throw new ActionError('INVALID_ARGUMENT','临时放行必须指向固定执行及当前网络期间');
          const operation=await this.options.dataSaver!.decision(executionId);
          if(operation.productId!==product.id||operation.requestDigest!==requestDigest||operation.finalDigest!==finalDigest)throw new ActionError('DATA_SAVER_IDENTITY_CONFLICT','临时放行目标或固定内容已改变');
          if(!this.options.sends)throw new ActionError('EXECUTION_STOPPED','当前无法核验控制资格');
          const control=await this.options.sends.readControl(product.id);
          if(control.pendingAbort||control.generation!==operation.controlGeneration||control.stoppedThrough>=operation.controlGeneration)throw new ActionError('EXECUTION_STOPPED','该执行所属控制代次已停止，不能恢复许可');
          value=await this.options.dataSaver!.grant({executionId,requestDigest,finalDigest,period});break;
        }
        case 'files.list':value=await this.options.execution!.fileChanges(this.text(payload,'id'),payload.cursor);break;
        case 'execution.list':value=await this.options.execution!.list(this.text(payload,'id'),payload.cursor);break;
        case 'execution.readOutput':value=await this.options.execution!.readOutput(this.text(payload,'id'),this.text(payload,'executionId'),payload.cursor);break;
        case 'extensions.get':value=await this.extensionCatalog(typeof payload.id==='string'?payload.id:undefined);break;
        case 'routing.list':value=await this.routing!.list(typeof payload.cursor==='string'?payload.cursor:undefined);break;
        case 'routing.query':value=await this.routing!.query(this.text(payload,'id',128));break;
        case 'routing.create':value=await this.routing!.create({source:payload.source as RouteSource,creationId:this.text(payload,'creationId',128),title:typeof payload.title==='string'?payload.title.slice(0,120):undefined});break;
        case 'routing.send':value=await this.routing!.send(payload as RouteRequest);break;
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
        case 'create':value=await this.submissions!.coordinate(()=>this.create(this.text(payload,'creationId',128),typeof payload.title==='string'?payload.title.slice(0,120):'新会话'));break;
        case 'open':value=await this.snapshot(this.text(payload,'id',128));break;
        case 'context.get':value=await this.contextView(this.text(payload,'id',128));break;
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
          const watch=await conversation.watch(context);const subscription:{connectionId:string;watch:ConversationWatch;refresh?:()=>void}={connectionId:request.connectionId,watch};
          if(!current()){await watch.stop();throw new ActionError('CONNECTION_CLOSED','订阅连接已更换');}
          this.subscriptions.set(key,subscription);
          value=await this.project(product,watch.value);
          const publish=(snapshot:ConversationSnapshot)=>{if(current()&&this.subscriptions.get(key)===subscription)emit({type:'conversation',protocol:1,connectionId:request.connectionId,subscriptionId,snapshot});};
          const failed=(error:unknown)=>{if(current()&&this.subscriptions.get(key)===subscription)emit({type:'subscription-error',protocol:1,connectionId:request.connectionId,subscriptionId,error:{code:'OBSERVATION_UNAVAILABLE',message:this.safeError(error)}});};
          subscription.refresh=()=>{void this.project(product,watch.value).then(publish,failed);};
          watch.start(async call=>{if(call.kind==='value')publish(await this.project(product,call.value));else failed(call.error);});
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
    }catch(error){return {...base,ok:false,error:{code:error instanceof ActionError||error instanceof ModelConfigurationError||error instanceof InputError||error instanceof SubmissionError||error instanceof ProjectError||error instanceof ManagedExecutionError?error.code:storageFailure(error)?.code??'ACTION_FAILED',message:this.safeError(error)}};}
  }
  private async extensionCatalog(id?:string):Promise<ExtensionCatalog>{
    const selected=id?(await (await this.ready().conversation((await this.product(id)).sdkId as ConversationId,context))!.agent(context)).extensions.map(item=>item.name):undefined;
    const snapshot=this.registry.snapshot();
    return {items:(this.options.extensions??BUNDLED_EXTENSIONS).map(descriptor=>{const name=this.installedExtensions.get(descriptor.id);return {descriptor,packaged:true,agent:!descriptor.agent?{state:'not-provided'}:name&&snapshot.extension(name)?{state:'installed',name,...(selected?{selected:selected.includes(name)}:{})}:{state:'unavailable',...(name?{name}:{})},ui:{state:descriptor.ui?'packaged':'not-provided'}};}),...(id?{conversationId:id}:{})};
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
      await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:model.provider,modelId:model.modelId},maxTurns:8},init:async(tx,sdkId)=>{
        const products=await tx.doc(Products);if(Object.hasOwn(products.items,id))throw new DuplicateCreation(id);
        products.items[id]={id,sdkId,title:title.trim()||'新会话',workspaceId:'default',createdAt:Date.now()};
      }},context);
    }catch(error){if(!(error instanceof DuplicateCreation))throw error;}
    await this.refreshProducts();return {conversation:await this.summary(await this.product(id)),storedSeq:this.storedSeq};
  }
  private async summary(product:ProductRecord):Promise<ConversationSummary> {return (await this.snapshot(product.id,product)).conversation;}
  private submissionContext(product:ProductRecord):SubmissionContext{return this.projects!.expectation(product);}
  private async refreshProducts(){if(!this.harness)return;const products=(await this.harness.snapshot(Products,context))?.items??{};for(const product of Object.values(products)){this.productsCache.set(product.id,{...product});if(this.state.phase==='ready')await this.snapshot(product.id,product);}for(const subscription of this.subscriptions.values())subscription.refresh?.();}

  private async snapshot(id:string,known?:ProductRecord) {
    const product=known??await this.product(id),harness=this.ready();
    const watch=await (await harness.conversation(product.sdkId as ConversationId,context))!.watch(context);
    try{return await this.project(product,watch.value);}finally{await watch.stop();}
  }
  private async project(product:ProductRecord,view:ConversationView):Promise<ConversationSnapshot> {
    product=this.productsCache.get(product.id)??product;
    const live=view.docs['pi.live'] as any,agent=view.docs['pi.agent'] as any;
    const ref=agent?.model??{},model=this.options.models.getModel(ref.provider,ref.modelId);
    const entries=view.entries.flatMap(entry=>this.message(entry));
    const retry=live?.generation?.retry,deferred=live?.generation?.deferred;
    // Read the public task checkpoint: a selected model is for later prepare,
    // while an already-prepared request, deferred poll or compaction stays pinned.
    const task=live?.run?await this.harness?.getTask(live.run.taskId,context):undefined;
    let blockingCompaction=false;
    let checkpoint=task?.state.status!=='terminal'?(task?.state as any)?.checkpoint:undefined;
    if(checkpoint?.compacted){const child=await this.harness?.getTask(checkpoint.compacted,context);if(child?.state.status!=='terminal'&&(child?.state as any)?.checkpoint?.model){checkpoint=(child!.state as any).checkpoint;blockingCompaction=true;}}
    const rateProvider=checkpoint?.model?.provider??checkpoint?.poll?.model?.provider??ref.provider;
    const rateAt=this.modelRetryAfter?.until(rateProvider);
    const rateWait=rateAt!==undefined&&(live?.generation||blockingCompaction)?{phase:'waiting' as const,reason:'model-retry' as const,message:'等待模型服务指定的重试时间',nextAt:Math.max(rateAt,retry?.at??0,blockingCompaction?checkpoint.until??0:0),used:blockingCompaction?checkpoint.attempt:live.generation.attempt,limit:this.runtimeSettings().retry?.maxRetries??3}:undefined;
    const recovery=live?.run?(this.recovery?.status(product.id)??rateWait??(retry?{phase:'waiting' as const,reason:'model-retry' as const,message:retry.error,nextAt:retry.at,used:live.generation.attempt,limit:this.runtimeSettings().retry?.maxRetries??3}:deferred?{phase:'waiting' as const,reason:'deferred-poll' as const,message:'等待原模型响应的下一次查询；不会创建新请求',nextAt:deferred.pollAt}:undefined)):undefined;
    const phase=live?.run?(recovery||live.generation?.retry||live.generation?.deferred?'waiting':'running'):live?.runFailure?(live.runFailure.reason==='aborted'?'stopped':'failed'):entries.some(entry=>entry.role==='assistant')?'done':'idle';
    const text=live?.run?this.content(live.generation?.message?.content):'';
    const selected={provider:ref.provider??'',modelId:ref.modelId??'',name:model?.name??ref.modelId??'未配置模型'};
    if(this.options.inputs){
      const conversation={id:product.id,title:product.title,model:selected,submissionContext:this.submissionContext(product)};
      const capability=this.options.connections?this.options.connections.capability(ref.provider,ref.modelId):model?inputCapability(model,'validation'):undefined;
      const key=JSON.stringify({conversation,capability});
      if(this.rememberedInputs.get(product.id)!==key){this.options.inputs.rememberConversation(conversation,capability);this.rememberedInputs.set(product.id,key);}
    }
    return {id:product.id,revision:++this.revision,conversation:{id:product.id,title:product.title,model:selected,workspaceId:product.workspaceId,projectId:product.projectId??null,createdAt:product.createdAt,phase,submissionContext:this.submissionContext(product)},entries,progress:text?{text,persisted:false}:undefined,phase,storedSeq:this.storedSeq,reason:recovery?.message??live?.runFailure?.detail??live?.generation?.retry?.error,...(recovery?{recovery}:{})};
  }
  private async contextView(id:string):Promise<import('./application-protocol.js').ConversationContext> {
    const product=await this.product(id),conversation=(await this.ready().conversation(product.sdkId as ConversationId,context))!;
    const [view,agent]=await Promise.all([conversation.context(context),conversation.agent(context)]);
    const model=agent.model?this.options.models.getModel(agent.model.provider,agent.model.modelId):undefined;
    const modelLimit=model&&Number.isFinite(model.contextWindow)&&model.contextWindow>0?model.contextWindow:undefined;
    // Read the SDK-derived active context, after reset/compaction/edit semantics. Do not count
    // the visible history window, provider cumulative spend, or base64 image bytes as tokens.
    let characters=0,images=false;
    for(const message of view.messages){
      if(typeof message.content==='string')characters+=Buffer.byteLength(message.content,'utf8');
      else for(const part of message.content){
        if(part.type==='image'){images=true;continue;}
        if(part.type==='text')characters+=Buffer.byteLength(part.text,'utf8');
        else if(part.type==='toolCall')characters+=Buffer.byteLength(part.name+JSON.stringify(part.arguments),'utf8');
        else if(part.type==='thinking')characters+=Buffer.byteLength(part.thinking,'utf8');
      }
    }
    return {id,state:images?'unavailable':'estimated',...(images?{}:{tokens:Math.ceil(characters/3)}),modelLimit,messages:view.messages.length,scope:'committed-messages',
      note:images?'当前上下文含图片，无法可靠估算 token 占用。':'按 SDK 当前已提交消息的 UTF-8 字节数 / 3 粗估；不含动态系统指令、工具定义、协议开销、未提交生成与草稿，不是服务商精确计数。'};
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
        await this.projecting;
      this.attachments.clear();
      const watches=[...this.subscriptions.values()];this.subscriptions.clear();for(const entry of watches)await entry.watch.stop();
      let auditError:unknown;try{if(this.options.secret)await auditStorageSecret(this.options.path,this.options.secret);}catch(error){auditError=error;}
      await this.harness?.close(context);this.harness=undefined;
      this.recovery?.close();
      await this.options.execution?.closeReads();
      await this.retained?.close();this.retained=undefined;
      if(this.options.secret)await auditStorageSecret(this.options.path,this.options.secret);if(auditError)throw auditError;
    })().finally(()=>{this.closing=undefined;});
  }
}
