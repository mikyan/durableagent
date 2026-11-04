import {defineDoc,defineDocFamily,type Harness,type Registry,type ToolExecutionApi,type ToolRegistration} from '@earendil-works/pi-durable';
import {createBashTool,createReadTool,createWriteTool} from '@earendil-works/pi-durable/tools';
import {ExecutionError,FileError,StreamDecoder,type ExecutionEnv,type FileSystem,type ShellExecOptions,type Result,type ShellExecResult,type FileWatcher,type WatchTarget,type FileChange} from '@earendil-works/pi-durable/env';
import {BACKGROUND_CONTEXT,type Context} from '@earendil-works/chord/context';
import {randomUUID,createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {AdoptedBinding,LocationAdapter} from './project-bindings.js';
import type {EffectAuthority,EffectSnapshot} from './projects.js';
import type {SendAuthority} from './submission-protocol.js';
import {ExecutionChannelError,type ExecutionChannel} from './execution-channel.js';
import type {DataSaverAuthority} from './data-saver-protocol.js';
import {ManagedFiles} from './managed-files.js';
import {ManagedDocuments} from './managed-documents.js';
import {DocumentWrites,type DocumentWriteArguments} from './document-writes.js';
import {FileWrites,type FileExecutionEffect,type FileMutationMode,type FileMutationOptions} from './file-writes.js';
import type {FileEffectAuthority} from './file-effect-protocol.js';
import {WorkspaceCoordinator,type WriteClaim,type WriteScope} from './workspace-coordination.js';

export const EXECUTION_EXTENSION={id:'managed-execution',actions:['execution.list','execution.readOutput','files.list']} as const;
type Command={kind:'shell';script:string}|{kind:'argv';argv:string[]};
type ExecutionContext={productId:string;sdkConversationId:number;taskId:number;callId:string;bindingId:string;locationVersion:number;controlGeneration:number;namespace:string};
type Request={executionId:string;context:ExecutionContext;command:Command;cwd:string;env:Record<string,string>;inheritEnv:boolean;timeoutMs:number|null};
type Receipt=Record<string,any>&{executionId:string;state:string};
type StoredIntent={request:Request|null;receipt:Receipt|null;cursor:number;workspaceIdentity:string|null;writeScope?:WriteScope;fileOperationId?:string};
type IndexEntry={key:string;productId:string;bindingId:string;namespace:string;state:string};
const Intent=defineDocFamily({kind:'app.managed-execution-intent',version:1,scope:'session',family:true,initial:(_:null):StoredIntent=>({request:null,receipt:null,cursor:0,workspaceIdentity:null}),checkpointWhen:()=>false});
const Index=defineDoc({kind:'app.managed-execution-index',version:1,scope:'session',initial:()=>({items:{} as Record<string,IndexEntry>}),checkpointWhen:()=>false});
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const terminal=new Set(['completed','stopped','not_started']);
const states=new Set(['accepted_not_started','starting','running','stop_requested','completed','stopped','not_started','unknown']);
export class ManagedExecutionError extends Error {constructor(readonly code:string,message:string){super(message);}}
const failure=(code:string,message:string):never=>{throw new ManagedExecutionError(code,message);};

/** Fixed core: app-owned invocation identity, final policy and external receipts; SDK owns scheduling. */
export class ManagedExecution implements EffectAuthority {
 private harness?:Harness;
 private namespace='unverified:termux';
 private tail:Promise<unknown>=Promise.resolve();
 private closedOwners=new Set<string>();
 // Only this live invocation owns the pre-acceptance handoff. Never persisted as proof or used to release a writer.
 private readonly dispatching=new Set<string>();
 private writes?:WorkspaceCoordinator;
 private readonly fileWrites:FileWrites;
 private readonly documents?:ManagedDocuments;
 private readonly documentWrites?:DocumentWrites;
 private readonly watchers=new Map<string,Set<FileWatcher>>();
 private readsClosed=false;
 readonly locations:LocationAdapter;
 constructor(private readonly options:{channel:ExecutionChannel;authority:SendAuthority;dataSaver?:DataSaverAuthority;fileEffects?:FileEffectAuthority;documents?:ExecutionChannel;boundary?:(stage:string,request:Readonly<Request>)=>void|Promise<void>}){
  this.fileWrites=new FileWrites(options.channel,options.fileEffects);
  if(options.documents){this.documents=new ManagedDocuments(options.documents);this.documentWrites=new DocumentWrites(options.documents,options.authority,(bindingId,sdkConversationId)=>this.closedOwners.has(bindingId+':'+sdkConversationId));}
  this.locations={deferInspection:true,inspect:async workspace=>{
   if(workspace.environment!=='termux')return {state:'environment-changed',reason:'此位置不属于当前 Termux 执行环境'};
   try{const value=await options.channel.request('inspectWorkspace',{path:workspace.path});if(value.state!=='available'||typeof value.identity!=='string'||typeof value.namespace!=='string')return {state:'missing',reason:'Termux 中的位置不可用，保留原位置'};this.namespace=value.namespace;return {state:'available',identity:value.identity};}
   catch{return {state:'unverified',reason:'执行连接尚不可用，尚未核验原位置'};}
  },environment:async binding=>new ManagedEnvironment(this,binding)};
 }
 private serial<T>(action:()=>Promise<T>):Promise<T>{const result=this.tail.then(action,action);this.tail=result.catch(()=>{});return result;}
 attach(harness:Harness){this.harness=harness;this.readsClosed=false;this.fileWrites.attach(harness);this.documentWrites?.attach(harness,()=>this.writes!);this.writes=new WorkspaceCoordinator(harness,async claim=>{
  if(claim.source==='saf'){if(!this.documentWrites)return failure('DOCUMENT_UNAVAILABLE','原件能力尚未就绪，保留写入占用');return this.documentWrites.evidence(claim);}
  const index=await harness.snapshot(Index,BACKGROUND_CONTEXT),entry=index?.items[claim.operationId];
  if(!entry)return failure('EXECUTION_STORAGE_INCONSISTENT','写入占用缺少执行索引');
  const saved=await harness.snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!saved?.request||hash(saved.request)!==claim.requestDigest)return failure('EXECUTION_STORAGE_INCONSISTENT','写入占用与持久执行不一致');
  const receipt=this.receipt(await this.options.channel.request('query',{executionId:claim.operationId}),copy(saved.request));
  const proof=saved.fileOperationId?await this.fileWrites.evidence(saved.fileOperationId,receipt):{state:receipt.state,scopeConfirmed:receipt.scopeConfirmed===true};
  return {operationId:claim.operationId,requestDigest:claim.requestDigest,namespace:claim.namespace,...proof,sequence:Number(receipt.sequence??0)};
 });}
 private writeClaim(request:Request,scope:WriteScope={domain:'device-files',kind:'environment'}):WriteClaim{return {operationId:request.executionId,requestDigest:hash(request),namespace:request.context.namespace,source:'termux',bindingId:request.context.bindingId,productId:request.context.productId,scope};}
 environmentNamespace(){return this.namespace;}
 /** Fixed-core tools whose effects all use this environment. Never an extension-exposed replay switch. */
 wrapTool<T extends ToolRegistration<any,any>>(tool:T):T{
  return {...tool,replay:'safe',execute:async(args:any,api:ToolExecutionApi,context:Context)=>{
   if(!(api.env instanceof ManagedEnvironment))return failure('EXECUTION_UNAVAILABLE','工具没有已绑定的受管执行环境');
   return tool.execute(args,{...api,env:api.env.forCall(api)},context);
  }} as T;
 }
 install(registry:Registry){registry.install({name:EXECUTION_EXTENSION.id,tools:[this.wrapTool(createBashTool()),this.wrapTool(createReadTool()),this.wrapTool(createWriteTool()),...(this.documents?[this.wrapTool(this.documents.listTool()),this.wrapTool(this.documents.readTool()),this.wrapTool(this.documents.writeTool((args,api,context)=>(api.env as ManagedEnvironment).writeDocument(args,context)))]:[])]});}
 async files(binding:AdoptedBinding,context:Context):Promise<Result<ManagedFiles,FileError>>{
  try{context.abortSignal?.throwIfAborted();const position=await this.locations.inspect(binding.location);
   if(position.state!=='available'||binding.actualIdentity&&position.identity!==binding.actualIdentity)return {ok:false,error:new FileError('unknown','原文件位置尚未核验或已经改变',binding.location.path)};
   return {ok:true,value:new ManagedFiles({channel:this.options.channel,cwd:binding.location.path,namespace:this.namespace})};
  }catch{return {ok:false,error:new FileError(context.abortSignal?.aborted?'aborted':'unknown','文件环境尚未就绪',binding.location.path)};}
 }
 async watch(binding:AdoptedBinding,targets:readonly WatchTarget[],onChange:(change:FileChange)=>void,context:Context):Promise<Result<FileWatcher,FileError>>{
  const owner=binding.id+':'+binding.sdkConversationId,closed=()=>this.readsClosed||this.closedOwners.has(owner);
  if(closed())return {ok:false,error:new FileError('aborted','文件监听所属环境已关闭')};const files=await this.files(binding,context);if(!files.ok)return files;
  const opened=await files.value.watch(targets,onChange,context);if(!opened.ok)return opened;
  if(closed()){await opened.value.stop(BACKGROUND_CONTEXT);return {ok:false,error:new FileError('aborted','文件监听所属环境已关闭')};}
  const watchers=this.watchers.get(owner)??new Set<FileWatcher>();this.watchers.set(owner,watchers);
  const watcher:FileWatcher={mode:opened.value.mode,stop:async current=>{watchers.delete(watcher);if(!watchers.size)this.watchers.delete(owner);await opened.value.stop(current);}};watchers.add(watcher);return {ok:true,value:watcher};
 }
 async closeReads(){this.readsClosed=true;for(const readers of [...this.watchers.values()])for(const reader of [...readers])await reader.stop(BACKGROUND_CONTEXT);}
 private owner(){if(!this.harness)return failure('EXECUTION_NOT_READY','执行记录尚未打开');return this.harness;}
 private async identity(){const value=await this.options.channel.request('ping',{});if(value.protocol!==1||typeof value.executorId!=='string'||typeof value.ledgerEpoch!=='string'||value.namespace!=='termux:'+value.executorId)return failure('EXECUTOR_IDENTITY','执行实例身份无法核验');return value as {protocol:1;executorId:string;ledgerEpoch:string;namespace:string};}
 private async policy(request:Request,api?:ToolExecutionApi,context:Context=BACKGROUND_CONTEXT){
  context.abortSignal?.throwIfAborted();
  const control=await this.options.authority.readControl(request.context.productId);
  if(control.pendingAbort||control.generation!==request.context.controlGeneration||control.stoppedThrough>=request.context.controlGeneration)return failure('EXECUTION_STOPPED','原控制代次已停止，不能启动命令');
  if(api&&(await api.getTask(api.taskId,context))?.abortRequested)return failure('EXECUTION_STOPPED','此工具调用已停止');
 }
 private async awaitNetwork(request:Request,receipt:Receipt,api:ToolExecutionApi,context:Context){
  const authority=this.options.dataSaver;if(!authority)return;
  let decision=await this.policyRead(request,api,context,()=>authority.prepared(request.executionId,hash(request),String(receipt.finalDigest)));
  for(;;){
   await this.policyRead(request,api,context,async()=>undefined);
   if(decision.executionId!==request.executionId||decision.requestDigest!==hash(request)||decision.finalDigest!==receipt.finalDigest)return failure('DATA_SAVER_IDENTITY_CONFLICT','省流许可与最终执行内容不一致');
   if(decision.policyInterrupted)await this.holdPolicyInterrupted(request,api,context);
   if(decision.phase==='allowed'||decision.phase==='granted')return;
   if(decision.phase!=='waiting')return failure('DATA_SAVER_RESULT_UNVERIFIED','网络变化后的原执行需要核验，不能自动重跑');
   // This is one pending SDK invocation, not a second task scheduler or a new execution ID.
   await new Promise(resolve=>setTimeout(resolve,100));
   decision=await this.policyRead(request,api,context,()=>authority.decision(request.executionId));
  }
 }
 private async policyRead<T>(request:Request,api:ToolExecutionApi,context:Context,read:()=>Promise<T>):Promise<T>{
  for(;;){
   context.abortSignal?.throwIfAborted();
   try{await this.policy(request,api,context);return await read();}
   catch(error){
    const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
    if(!['DATA_SAVER_BUSY','DATA_SAVER_UNAVAILABLE','DATA_SAVER_STORAGE_LOST','DATA_SAVER_STORAGE_FAILED','DATA_SAVER_STORAGE_CORRUPT','DATA_SAVER_WAITING_UNLOCK','INPUT_STORAGE_BUSY','INPUT_STORAGE_FAILED','INPUT_WAITING_UNLOCK'].includes(code))throw error;
   }
   // A readiness failure has not authorized transport. It also must not become
   // a tool error that asks the model to invent another execution identity.
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 private async holdPolicyInterrupted(request:Request,api:ToolExecutionApi,context:Context):Promise<never>{
  // A confirmed process stop is not proof that arbitrary earlier side effects can
  // be repeated. Keep this SDK invocation pending, even after Wi-Fi returns. An
  // explicit user stop still crosses the existing control/task abort barrier.
  for(;;){await this.policyRead(request,api,context,async()=>undefined);await new Promise(resolve=>setTimeout(resolve,100));}
 }
 private receipt(value:Record<string,unknown>,request:Request):Receipt{
  if(value.protocol!==1||value.executionId!==request.executionId||value.namespace!==request.context.namespace||!states.has(String(value.state)))return failure('EXECUTION_RECEIPT_MISMATCH','执行回执不属于当前执行');
  if(value.state==='unknown'&&value.reason==='NO_RECEIPT')return value as Receipt;
  if(value.state==='not_started'&&value.neverStarted===true&&value.scopeConfirmed===true&&value.reason==='CANCELLED_BEFORE_ACCEPTANCE')return value as Receipt;
  if(!same(value.context,request.context)||value.requestDigest!==hash(request)||typeof value.finalDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.finalDigest))return failure('EXECUTION_RECEIPT_MISMATCH','执行身份、固定内容或上下文与回执不一致');
  return value as Receipt;
 }
 private async save(api:ToolExecutionApi,key:string,request:Request,receipt:Receipt,cursor?:number){
  await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!intent.request||!same(intent.request,request))return failure('EXECUTION_INTENT_MISMATCH','持久执行意图不一致');if(intent.receipt&&Number(receipt.sequence??0)<Number(intent.receipt.sequence??0))return;intent.receipt=copy(receipt);if(cursor!==undefined)intent.cursor=cursor;index.items[request.executionId].state=receipt.state;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
 }
 private async cancelRecorded(key:string,request:Request){
  await this.options.channel.rememberIntent?.(request);
  const receipt=this.receipt(await this.options.channel.request('cancel',{executionId:request.executionId,reason:'user'}),request);
  // A native/SDK stop can retire the invocation. Execution facts outlive that task.
  await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!intent.request||!same(intent.request,request))return failure('EXECUTION_INTENT_MISMATCH','停止身份不一致');if(intent.receipt&&Number(receipt.sequence??0)<Number(intent.receipt.sequence??0))return;intent.receipt=copy(receipt);index.items[request.executionId].state=receipt.state;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
  if(['not_started','stopped'].includes(receipt.state)&&receipt.neverStarted===true&&receipt.scopeConfirmed===true){const stored=await this.owner().snapshot(Intent,key,BACKGROUND_CONTEXT);if(stored?.fileOperationId){await this.fileWrites.remember(stored.fileOperationId,{executionId:request.executionId,requestDigest:hash(request),context:{productId:request.context.productId,controlGeneration:request.context.controlGeneration,sdkConversationId:request.context.sdkConversationId}});await this.fileWrites.evidence(stored.fileOperationId,receipt);}await this.writes?.cancelQueued(request.executionId);}
 }
 private async reconcile(){
  await this.fileWrites.recoverNative();
  await this.documentWrites?.recover();
  const entries=Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{});
  const reservations=new Map((await this.writes?.list()??[]).map(value=>[value.operationId,value]));
  for(const [executionId,entry] of entries){
   if(terminal.has(entry.state))continue;
   const saved=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);
   if(!saved?.request)return failure('EXECUTION_STORAGE_INCONSISTENT','执行索引缺少持久意图，运行保持关闭');
   const request=copy(saved.request);await this.options.channel.rememberIntent?.(request);await this.options.dataSaver?.register(request);let receipt:Receipt;
   if(reservations.get(executionId)?.state==='queued'||this.dispatching.has(executionId))continue;
   try{receipt=this.receipt(await this.options.channel.request('query',{executionId}),request);if(receipt.reason==='NO_RECEIPT')throw Error('Acceptance not yet confirmed');}
   catch{receipt={...saved.receipt,protocol:1,executionId,namespace:request.context.namespace,context:request.context,state:'unknown',reason:'CLIENT_CONFIRMATION_LOST',source:'application'};}
   await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,entry.key,null),index=await tx.doc(Index);if(!intent.request||!same(intent.request,request))return failure('EXECUTION_STORAGE_INCONSISTENT','执行意图在核验时改变');if(terminal.has(intent.receipt?.state??''))return;if(receipt.source!=='application'&&intent.receipt&&Number(receipt.sequence??0)<Number(intent.receipt.sequence??0))return;intent.receipt=copy(receipt);index.items[executionId].state=receipt.state;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
   if(!terminal.has(receipt.state))await this.writes!.reserve(this.writeClaim(request,saved.writeScope));
  }
  await this.writes?.refresh();
 }
 recover(){return this.serial(async()=>{await this.reconcile();await this.options.channel.recoveryComplete?.();});}
 async run(binding:AdoptedBinding,api:ToolExecutionApi|undefined,command:string|readonly string[],options:ShellExecOptions|undefined,context:Context,ordinal=1,fileEffect?:FileExecutionEffect):Promise<Result<ShellExecResult,ExecutionError>>{
  if(!api)return {ok:false,error:new ExecutionError('unknown','命令缺少持久工具调用身份')};
  if(Array.isArray(command)&&(!command.length||!command[0]))return {ok:false,error:new ExecutionError('spawn_error','命令参数列表为空，未下发执行')};
  const key=`${api.taskId}:${api.callId}:${ordinal}`;
  let fixedRequest:Request|undefined;
  let cancelWait:Promise<void>|undefined,onAbort:(()=>void)|undefined;
  try{
   const identity=await this.identity();
   const fixed={command:typeof command==='string'?{kind:'shell' as const,script:command}:{kind:'argv' as const,argv:[...command]},cwd:posix.resolve(binding.location.path,options?.cwd??'.'),env:{...options?.env},inheritEnv:options?.inheritEnv??true,timeoutMs:options?.timeout===undefined?null:Math.ceil(options.timeout*1000)};
   let workspaceIdentity:string|null=null;let writeScope:WriteScope=fileEffect?.scope??{domain:'device-files',kind:'environment'};
   const request=await this.serial(async()=>{if(this.closedOwners.has(binding.id+':'+binding.sdkConversationId))return failure('EXECUTION_STOPPED','此执行环境的所有者已经关闭');await this.reconcile();const saved=await this.owner().snapshot(Intent,key,context);let initialIdentity:string|null=null;if(!saved?.request){const position=await this.locations.inspect(binding.location);if(position.state!=='available'||!position.identity||binding.actualIdentity&&position.identity!==binding.actualIdentity)return failure('EXECUTION_LOCATION_CHANGED','原执行位置无法核验，未启动命令');initialIdentity=position.identity;}return api.commit(async tx=>{
    const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);
    if(intent.request){if(!same(fixed,{command:intent.request.command,cwd:intent.request.cwd,env:intent.request.env,inheritEnv:intent.request.inheritEnv,timeoutMs:intent.request.timeoutMs})||intent.request.context.bindingId!==binding.id||intent.request.context.namespace!==identity.namespace)return failure('EXECUTION_INTENT_MISMATCH','同一工具调用的最终参数或位置已改变');if(!same(intent.writeScope??{domain:'device-files',kind:'environment'},writeScope)||intent.fileOperationId!==fileEffect?.fileOperationId)return failure('EXECUTION_INTENT_MISMATCH','同一工具调用的写入范围已经改变');workspaceIdentity=intent.workspaceIdentity;return copy(intent.request);}
    if(Object.values(index.items).some(value=>value.state==='unknown'))return failure('UNRESOLVED_EXECUTION','存在结果不明的执行，不能换一个命令身份绕过核验');
    const control=await this.options.authority.readControl(binding.controlProductId);
    if(control.pendingAbort||control.generation<=control.stoppedThrough||context.abortSignal?.aborted)return failure('EXECUTION_STOPPED','控制代次已停止');
    const request:Request={executionId:randomUUID(),context:{productId:binding.controlProductId,sdkConversationId:api.conversationId,taskId:api.taskId,callId:api.callId,bindingId:binding.id,locationVersion:binding.location.version,controlGeneration:control.generation,namespace:identity.namespace},...fixed};
    intent.request=copy(request);intent.writeScope=copy(writeScope);if(fileEffect)intent.fileOperationId=fileEffect.fileOperationId;intent.workspaceIdentity=initialIdentity;workspaceIdentity=initialIdentity;index.items[request.executionId]={key,productId:binding.controlProductId,bindingId:binding.id,namespace:identity.namespace,state:'intent'};return request;
   },context,{persistence:{kind:'immediate'}}).then(request=>{if(!saved?.request)this.dispatching.add(request.executionId);return request;});});
   fixedRequest=request;
   await fileEffect?.remember({executionId:request.executionId,requestDigest:hash(request),context:{productId:request.context.productId,controlGeneration:request.context.controlGeneration,sdkConversationId:request.context.sdkConversationId}});
   onAbort=()=>{cancelWait??=this.cancelRecorded(key,request);void cancelWait.catch(()=>{});};
   context.abortSignal?.addEventListener('abort',onAbort,{once:true});
   if(context.abortSignal?.aborted)onAbort();
   await this.options.boundary?.('intent-persisted',copy(request));
   await this.policy(request,api,context);
   if(this.options.dataSaver)await this.policyRead(request,api,context,()=>this.options.dataSaver!.register(request));
   for(;;){const reservation=await this.writes!.reserve(this.writeClaim(request,writeScope));if(reservation.state==='cancelled')return failure('EXECUTION_STOPPED','排队的写入已取消');if(reservation.state!=='queued')break;await this.policy(request,api,context);await this.writes!.refresh();await new Promise(resolve=>setTimeout(resolve,20));}
   if(fileEffect)await this.options.boundary?.('file-reserved',copy(request));
   let receipt=this.receipt(await this.options.channel.request('query',{executionId:request.executionId}),request);
   if(receipt.state==='unknown'&&receipt.reason==='NO_RECEIPT'){try{await fileEffect?.beforePrepare({executionId:request.executionId,requestDigest:hash(request),context:{productId:request.context.productId,controlGeneration:request.context.controlGeneration,sdkConversationId:request.context.sdkConversationId}});}catch(error){await this.cancelRecorded(key,request);throw error;}receipt=this.receipt(await this.options.channel.request('prepare',request),request);}
   await this.save(api,key,request,receipt);
   this.dispatching.delete(request.executionId);
   await this.options.boundary?.('accepted',copy(request));
   while(receipt.state==='accepted_not_started'){
    await this.awaitNetwork(request,receipt,api,context);
    if(this.options.dataSaver)await this.policyRead(request,api,context,async()=>undefined);else await this.policy(request,api,context);
    const position=await this.locations.inspect(binding.location);
    if(position.state!=='available'||!workspaceIdentity||position.identity!==workspaceIdentity)return failure('EXECUTION_LOCATION_CHANGED','执行位置已经改变，未启动命令');
    try{receipt=this.receipt(await this.options.channel.request('start',{executionId:request.executionId,finalDigest:receipt.finalDigest}),request);}
    catch(error){
     // Only these explicit *pre-transport* native refusals prove start was not
     // sent. A timeout, lost response or storage failure never enters this path.
     if(this.options.dataSaver&&error instanceof ExecutionChannelError&&['DATA_SAVER_WAIT','DATA_SAVER_INTERRUPTED'].includes(error.code)){await new Promise(resolve=>setTimeout(resolve,100));continue;}
     throw error;
    }
    await this.save(api,key,request,receipt);
   }
   if(receipt.state==='not_started'&&receipt.neverStarted===true&&receipt.reason==='CANCELLED_BEFORE_ACCEPTANCE')return {ok:false,error:new ExecutionError('aborted','命令在接纳前已取消，执行端确认未开始')};
   const decoders={stdout:new StreamDecoder(),stderr:new StreamDecoder()};let cursor=0,decodedBytes=0,newlines=0,endsWithNewline=true;
   const emit=(text:string,stream:'stdout'|'stderr')=>{if(!text)return;decodedBytes+=Buffer.byteLength(text);newlines+=text.split('\n').length-1;endsWithNewline=text.endsWith('\n');options?.onOutput?.(text,context,{stream});};
   while(true){
    const page=await this.options.channel.request('readOutput',{executionId:request.executionId,cursor});
    if(page.executionId!==request.executionId||page.namespace!==request.context.namespace||page.cursor!==cursor||!Array.isArray(page.chunks))return failure('OUTPUT_IDENTITY_MISMATCH','输出不属于当前执行或位置');
    for(const chunk of page.chunks){if(chunk.sequence!==cursor+1||!['stdout','stderr'].includes(chunk.stream)||typeof chunk.data!=='string')return failure('OUTPUT_GAP','执行输出位置不连续');const stream=chunk.stream as 'stdout'|'stderr';emit(decoders[stream].decode(Buffer.from(chunk.data,'base64')),stream);cursor=chunk.sequence;}
    if(page.nextCursor!==cursor)return failure('OUTPUT_GAP','执行输出位置不连续');
    receipt=this.receipt(await this.options.channel.request('query',{executionId:request.executionId}),request);
    await this.save(api,key,request,receipt,cursor);
    await this.options.boundary?.('output-checkpoint',copy(request));
    if(receipt.cancelReason==='network_policy')await this.holdPolicyInterrupted(request,api,context);
    if(receipt.state==='unknown')return {ok:false,error:new ExecutionError('unknown','执行结果不明，保留原执行身份；不能自动重跑')};
    if(terminal.has(receipt.state)&&cursor===receipt.outputCursor){
     for(const stream of ['stdout','stderr'] as const)emit(decoders[stream].decode(),stream);
     const spillPath=options?.spill&&!receipt.captureIncomplete&&(decodedBytes>options.spill.afterBytes||newlines+(endsWithNewline?0:1)>options.spill.afterLines)?receipt.outputRef as string:undefined;
     await this.options.boundary?.('before-result',copy(request));
     if(receipt.state==='completed'&&!receipt.captureIncomplete)return {ok:true,value:{exitCode:receipt.exitCode,...(spillPath?{spillPath}:{})}};
     const error=new ExecutionError(receipt.captureIncomplete?'unknown':receipt.cancelReason==='timeout'?'timeout':receipt.state==='not_started'?'spawn_error':'aborted','命令未完成执行或输出不完整');error.spillPath=spillPath;return {ok:false,error};
    }
    if(context.abortSignal?.aborted){onAbort();await cancelWait;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }catch(error){
   if(error instanceof ManagedExecutionError&&['EXECUTION_STOPPED','EXECUTION_LOCATION_CHANGED'].includes(error.code))onAbort?.();
   if(cancelWait)try{await cancelWait;}catch{}
   if(fixedRequest){const request=fixedRequest;try{await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(intent.request&&same(intent.request,request)&&!terminal.has(intent.receipt?.state??'')){intent.receipt={...intent.receipt,protocol:1,executionId:request.executionId,namespace:request.context.namespace,context:request.context,state:'unknown',reason:'CLIENT_CONFIRMATION_LOST',source:'application'};index.items[request.executionId].state='unknown';}},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}catch{/* A killed invocation cannot commit. Its durable intent remains pending for startup reconciliation. */}}
   return {ok:false,error:new ExecutionError('unknown',error instanceof ManagedExecutionError?error.message:'执行连接未确认结果，保留原身份等待核验')};
  }finally{if(fixedRequest)this.dispatching.delete(fixedRequest.executionId);if(onAbort)context.abortSignal?.removeEventListener('abort',onAbort);}
 }
 async cleanup(binding:AdoptedBinding,context:Context){return this.serial(async()=>{
  context.abortSignal?.throwIfAborted();this.closedOwners.add(binding.id+':'+binding.sdkConversationId);
  for(const watcher of [...this.watchers.get(binding.id+':'+binding.sdkConversationId)??[]])await watcher.stop(BACKGROUND_CONTEXT);
  const entries=Object.values((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{});
  let unconfirmed:unknown;
  for(const entry of entries){try{if(entry.bindingId!==binding.id||terminal.has(entry.state))continue;const saved=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!saved?.request)return failure('EXECUTION_STORAGE_INCONSISTENT','执行记录缺失，停止范围未确认');const request=copy(saved.request);if(request.context.sdkConversationId!==binding.sdkConversationId)continue;
   await this.cancelRecorded(entry.key,request);const deadline=performance.now()+5000;
   for(;;){context.abortSignal?.throwIfAborted();const receipt=this.receipt(await this.options.channel.request('query',{executionId:request.executionId}),request);await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,entry.key,null),index=await tx.doc(Index);if(!intent.request||!same(intent.request,request))return failure('EXECUTION_STORAGE_INCONSISTENT','停止身份已改变');if(Number(receipt.sequence??0)<Number(intent.receipt?.sequence??0))return;intent.receipt=copy(receipt);index.items[request.executionId].state=receipt.state;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
    if(terminal.has(receipt.state)&&receipt.scopeConfirmed===true)break;
    if(receipt.state==='unknown'||performance.now()>=deadline)return failure('EXECUTION_STOP_UNCONFIRMED','执行范围尚未确认停止，保留未决占用');await new Promise(resolve=>setTimeout(resolve,25));
   }
  }catch(error){unconfirmed??=error;}}
  try{await this.documentWrites?.cleanup(binding,context);}catch(error){unconfirmed??=error;}
  if(unconfirmed)throw unconfirmed;
 });}
 async list(productId:string,cursor?:unknown){await this.recover();const index=await this.owner().snapshot(Index,BACKGROUND_CONTEXT),entries=Object.entries(index?.items??{}).filter(([,entry])=>entry.productId===productId),executions:Receipt[]=[];const start=cursor===undefined?0:entries.findIndex(([id])=>id===cursor)+1;if(cursor!==undefined&&(!start||typeof cursor!=='string'))return failure('INVALID_ARGUMENT','执行列表位置已失效，请重新读取');const queued=new Set((await this.writes!.list()).filter(value=>value.state==='queued').map(value=>value.operationId));const page=entries.slice(start,start+20);for(const [id,entry] of page){const intent=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(intent?.request&&queued.has(id))executions.push({executionId:id,state:'queued',source:'application',reason:'WRITER_QUEUED',context:copy(intent.request.context),namespace:intent.request.context.namespace,sequence:0});else if(intent?.receipt)executions.push(copy(intent.receipt));}return {executions,nextCursor:start+page.length<entries.length?page.at(-1)![0]:null};}
 async fileChanges(productId:string,cursor?:unknown){await this.recover();const files=await this.fileWrites.list(productId,cursor),untrackedExecutions=[];for(const [executionId,entry]of Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{})){if(entry.productId!==productId)continue;const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(stored?.fileOperationId)continue;untrackedExecutions.push({executionId,state:entry.state,diff:{available:false,reason:'unknown_command_scope'}});}return {...files,documents:await this.documentWrites?.list(productId)??{changes:[],limited:false},untrackedExecutions:untrackedExecutions.slice(-20),untrackedLimited:untrackedExecutions.length>20};}
 async writeDocument(binding:AdoptedBinding,api:ToolExecutionApi|undefined,args:DocumentWriteArguments,context:Context){if(!this.documentWrites)return failure('DOCUMENT_UNAVAILABLE','原件能力尚未就绪');return this.documentWrites.write(binding,api,args,context);}
 async writeFile(binding:AdoptedBinding,api:ToolExecutionApi|undefined,path:string,content:string|Uint8Array,context:Context,ordinal:number,mode:FileMutationMode='write',options:FileMutationOptions={}){const available=await this.files(binding,context);if(!available.ok)return available;return this.fileWrites.write(binding,api,path,content,context,ordinal,(argv,effect)=>this.run(binding,api,argv,undefined,context,ordinal,effect),mode,options);}
 async readOutput(productId:string,executionId:string,cursor:unknown){
  if(!Number.isSafeInteger(cursor)||Number(cursor)<0)return failure('INVALID_ARGUMENT','输出位置无效');
  const entry=(await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items[executionId];if(!entry||entry.productId!==productId)return failure('EXECUTION_NOT_FOUND','此会话没有这次受管执行');
  const page=await this.options.channel.request('readOutput',{executionId,cursor,limit:16384});
  if(page.namespace!==entry.namespace||page.executionId!==executionId||page.cursor!==cursor||!Array.isArray(page.chunks)||page.chunks.length>16384)return failure('OUTPUT_IDENTITY_MISMATCH','输出身份或位置不一致');
  let sequence=Number(cursor),bytes=0;for(const chunk of page.chunks){if(chunk.sequence!==++sequence||!['stdout','stderr'].includes(chunk.stream)||typeof chunk.data!=='string')return failure('OUTPUT_GAP','执行输出位置不连续');bytes+=Buffer.from(chunk.data,'base64').length;if(bytes>16384)return failure('OUTPUT_LIMIT','输出帧超过有界读取限制');}
  if(page.nextCursor!==sequence)return failure('OUTPUT_GAP','执行输出位置不连续');return page;
 }
 async readBinary(path:string,namespace:string,context:Context):Promise<Result<Uint8Array,FileError>>{
  try{
   context.abortSignal?.throwIfAborted();const identity=await this.identity();if(identity.namespace!==namespace)return {ok:false,error:new FileError('unknown','执行命名空间已改变',path)};
   const index=await this.owner().snapshot(Index,context);let receipt:Receipt|undefined;
   for(const entry of Object.values(index?.items??{})){if(entry.namespace!==namespace)continue;const intent=await this.owner().snapshot(Intent,entry.key,context);if(intent?.receipt?.outputRef===path){receipt=copy(intent.receipt);break;}}
   if(!receipt)return {ok:false,error:new FileError('not_supported','此票仅提供同一执行环境的原始输出引用',path)};
   if(!terminal.has(receipt.state)||receipt.captureIncomplete||!Number.isSafeInteger(receipt.outputBytes)||receipt.outputBytes<0||receipt.outputBytes>16*1024*1024||typeof receipt.rawSha256!=='string')return {ok:false,error:new FileError('unknown','完整原始输出尚未核验',path)};
   const result=Buffer.alloc(receipt.outputBytes);let offset=0;
   while(offset<result.length){context.abortSignal?.throwIfAborted();const page=await this.options.channel.request('readRawOutput',{executionId:receipt.executionId,offset,length:Math.min(32768,result.length-offset)});if(page.namespace!==namespace||page.executionId!==receipt.executionId||page.offset!==offset||page.totalBytes!==result.length||page.captureIncomplete!==false||typeof page.data!=='string')return {ok:false,error:new FileError('unknown','原始输出位置或身份不一致',path)};const data=Buffer.from(page.data,'base64');if(!data.length||data.length>Math.min(32768,result.length-offset))return {ok:false,error:new FileError('unknown','原始输出出现缺口',path)};result.set(data,offset);offset+=data.length;}
   if(createHash('sha256').update(result).digest('hex')!==receipt.rawSha256)return {ok:false,error:new FileError('unknown','原始输出摘要不一致',path)};
   return {ok:true,value:result};
  }catch{return {ok:false,error:new FileError(context.abortSignal?.aborted?'aborted':'unknown','读取原始输出未完成',path)};}
 }
 async withSnapshot<T>(action:(snapshot:EffectSnapshot)=>Promise<T>):Promise<T>{return this.serial(async()=>{await this.reconcile();const items=Object.values((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{}),pending=[...items.filter(value=>!terminal.has(value.state)),...await this.documentWrites?.pending()??[]],writers=(await this.writes!.list()).filter(value=>!['released','cancelled'].includes(value.state));return action({known:![...pending,...writers].some(value=>value.state==='unknown'),pendingBindingIds:[...new Set([...pending,...writers].map(value=>value.bindingId))],pendingControlProductIds:[...new Set([...pending,...writers].map(value=>value.productId))]});});}
}

/** Files and shell share the adopted location and its owning Termux UID. */
class ManagedEnvironment implements ExecutionEnv {
 private ordinal=0;
 get id(){return this.owner.environmentNamespace();}cwd:string;
 constructor(private readonly owner:ManagedExecution,private readonly binding:AdoptedBinding,private readonly api?:ToolExecutionApi){this.cwd=binding.location.path;}
 forCall(api:ToolExecutionApi){return new ManagedEnvironment(this.owner,this.binding,api);}
 writeDocument(args:DocumentWriteArguments,context:Context){return this.owner.writeDocument(this.binding,this.api,args,context);}
 exec(command:string|readonly string[],options:ShellExecOptions|undefined,context:Context){return this.owner.run(this.binding,this.api,command,options,context,++this.ordinal);}
 absolutePath:FileSystem['absolutePath']=async path=>({ok:true,value:posix.resolve(this.cwd,path)});
 joinPath:FileSystem['joinPath']=async parts=>({ok:true,value:posix.join(...parts)});
 private unsupported=async():Promise<any>=>({ok:false,error:new FileError('not_supported','文件能力尚未就绪')});
 readBinaryFile:FileSystem['readBinaryFile']=async(path,context)=>{const files=await this.owner.files(this.binding,context);if(!files.ok)return files;const raw=await this.owner.readBinary(posix.resolve(this.cwd,path),this.id,context);return !raw.ok&&raw.error.code==='not_supported'?files.value.readBinaryFile(path,context):raw;};
 readTextFile:FileSystem['readTextFile']=async(path,context)=>{const result=await this.readBinaryFile(path,context);return result.ok?{ok:true,value:Buffer.from(result.value).toString('utf8')}:result;};
 openTextLineReader:FileSystem['openTextLineReader']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.openTextLineReader(path,context):files;};
 readTextLines:FileSystem['readTextLines']=async(path,options,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.readTextLines(path,options,context):files;};
 openBinaryReader:FileSystem['openBinaryReader']=async(path,options,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.openBinaryReader(path,options,context):files;};
 fileInfo:FileSystem['fileInfo']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.fileInfo(path,context):files;};
 exists:FileSystem['exists']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.exists(path,context):files;};
 writeFile:FileSystem['writeFile']=(path,content,context)=>this.owner.writeFile(this.binding,this.api,path,content,context,++this.ordinal);
 appendFile:FileSystem['appendFile']=(path,content,context)=>this.owner.writeFile(this.binding,this.api,path,content,context,++this.ordinal,'append');
 truncateFile:FileSystem['truncateFile']=async(path,size,context)=>{if(!Number.isSafeInteger(size)||size<0)return {ok:false,error:new FileError('invalid','截断大小必须为非负整数',path)};if(size>16777216)return {ok:false,error:new FileError('not_supported','单次截断超过 16 MiB',path)};return this.owner.writeFile(this.binding,this.api,path,'',context,++this.ordinal,'truncate',{size});};
 flushFile:FileSystem['flushFile']=(path,context)=>this.owner.writeFile(this.binding,this.api,path,'',context,++this.ordinal,'flush');
 renameFile:FileSystem['renameFile']=(source,destination,context)=>this.owner.writeFile(this.binding,this.api,source,'',context,++this.ordinal,'rename',{destination:posix.resolve(this.cwd,destination)});
 listDir:FileSystem['listDir']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.listDir(path,context):files;};
 openDirReader:FileSystem['openDirReader']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.openDirReader(path,context):files;};
 canonicalPath:FileSystem['canonicalPath']=async(path,context)=>{const files=await this.owner.files(this.binding,context);return files.ok?files.value.canonicalPath(path,context):files;};
 watch:FileSystem['watch']=(targets,onChange,context)=>this.owner.watch(this.binding,targets,onChange,context);
 createDir=this.unsupported;
 remove=this.unsupported;createTempDir=this.unsupported;createTempFile=this.unsupported;
 cleanup(context:Context){return this.owner.cleanup(this.binding,context);}
}
