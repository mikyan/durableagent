import {defineDoc,defineDocFamily,type Harness,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {FileError,type ExecutionError,type Result,type ShellExecResult} from '@earendil-works/pi-durable/env';
import {BACKGROUND_CONTEXT,type Context} from '@earendil-works/chord/context';
import {randomUUID,createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {AdoptedBinding} from './project-bindings.js';
import type {ExecutionChannel} from './execution-channel.js';
import type {FilePosition,WriteScope} from './workspace-coordination.js';
import type {FileEffectAuthority,FileEffectIdentity,FileEffectEvidence,FileExecutionIdentity} from './file-effect-protocol.js';

export type FileExecutionEffect={inheritEnv:boolean;scope:WriteScope;fileOperationId:string;remember:(execution:FileExecutionIdentity)=>Promise<void>;beforePrepare:(execution:FileExecutionIdentity)=>Promise<void>};
export type FileMutationMode='write'|'append'|'truncate'|'flush'|'rename';
export type FileMutationOptions={size?:number;destination?:string};
type Fixed={inheritEnv?:boolean;operationId:string;path:string;mode?:FileMutationMode;options?:FileMutationOptions;contentDigest?:string;totalBytes?:number;data?:string;namespace:string;bindingId:string;productId:string;sdkConversationId:number;argv:string[];position:FilePosition};
type Stored={fixed:Fixed|null;plan:Record<string,any>|null;result:Record<string,any>|null;executionId:string|null;executionDigest?:string;native?:FileEffectIdentity;proof?:FileEffectEvidence};
const Intent=defineDocFamily({kind:'app.managed-file-intent',version:1,scope:'session',family:true,initial:(_:null):Stored=>({fixed:null,plan:null,result:null,executionId:null}),checkpointWhen:()=>false});
const Index=defineDoc({kind:'app.managed-file-index',version:1,scope:'session',initial:()=>({items:{} as Record<string,{key:string;productId:string;bindingId:string}>}),checkpointWhen:()=>false});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left:unknown,right:unknown)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const unknown=(path:string)=>new FileError('unknown','原文件写入尚未取得匹配的完整回执；保留原身份等待核验',path);
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const contentIdentity=(fixed:Fixed)=>({digest:fixed.contentDigest??sha(Buffer.from(fixed.data??'','base64')),size:fixed.totalBytes??Buffer.from(fixed.data??'','base64').length});
const expectedIdentity=(fixed:Fixed,plan:Record<string,any>|null)=>{if((fixed.mode??'write')==='write')return contentIdentity(fixed);const value=plan?.expectedAfter;if(!value||!Number.isSafeInteger(value.size)||value.size<0||value.size>16777216||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw unknown(fixed.path);return {size:value.size,digest:value.sha256};};

/** Fixed file plans and their original-file evidence; command supervision stays in ManagedExecution. */
export class FileWrites{
 private harness?:Harness;
 private nativeRestored=false;
 constructor(private readonly channel:ExecutionChannel,private readonly effects?:FileEffectAuthority){}
 attach(harness:Harness){this.harness=harness;this.nativeRestored=false;}
 private owner(){if(!this.harness)throw Error('FILE_STORAGE_NOT_READY');return this.harness;}
 private async call(method:string,payload:Record<string,unknown>,path:string):Promise<any>{const response=await this.channel.request(method,payload);if(response.ok===true&&Object.hasOwn(response,'value'))return response.value;const code=(response.error as any)?.code;if(response.ok===false&&['aborted','not_found','permission_denied','not_directory','is_directory','invalid','not_supported','unknown'].includes(code))throw new FileError(code,`原文件操作未完成（${code}）`,path);throw unknown(path);}
 async write(binding:AdoptedBinding,api:ToolExecutionApi|undefined,path:string,content:string|Uint8Array,context:Context,ordinal:number,run:(argv:string[],effect:FileExecutionEffect)=>Promise<Result<ShellExecResult,ExecutionError>>,mode:FileMutationMode='write',options:FileMutationOptions={}):Promise<Result<void,FileError>>{
  const absolute=posix.resolve(binding.location.path,path),bytes=typeof content==='string'?Buffer.from(content):Buffer.from(content),data=bytes.toString('base64'),key=`${api?.taskId}:${api?.callId}:${ordinal}`;
  try{
   if(!api)throw unknown(absolute);context.abortSignal?.throwIfAborted();if(bytes.length>16*1024*1024)throw new FileError('not_supported','单次文件写入超过 16 MiB',absolute);
   let stored=await this.owner().snapshot(Intent,key,context);
   if(!stored?.fixed){
    const description=await this.call('file.describe',{},absolute),position=await this.call('file.resolveWrite',{path:absolute},absolute);
    if(description.protocol!==1||typeof description.namespace!=='string'||!Array.isArray(description.applyArgvPrefix)||description.applyArgvPrefix.length!==4||description.applyArgvPrefix.some((value:unknown)=>typeof value!=='string'||!value)||position.namespace!==description.namespace||typeof position.canonicalPath!=='string'||!posix.isAbsolute(position.canonicalPath)||!Array.isArray(position.ancestorObjectIds)||position.ancestorObjectIds.length>128)throw unknown(absolute);
    if(position.writeRoot!==undefined&&(typeof position.parentAnchor!=='string'||!posix.isAbsolute(position.parentAnchor)||!Array.isArray(position.missingParents)||position.missingParents.length<1||position.missingParents.length>64||position.missingParents.some((part:unknown)=>typeof part!=='string'||!part||part==='.'||part==='..'||part.includes('/'))||position.writeRoot!==posix.join(position.parentAnchor,position.missingParents[0])||!position.canonicalPath.startsWith(position.writeRoot+'/')||position.objectId!==null))throw unknown(absolute);
    if(bytes.length>32768&&(description.maxWriteBytes<bytes.length||description.chunkBytes!==32768))throw new FileError('not_supported','执行端尚未提供大内容分块能力',absolute);
    const operationId=randomUUID(),candidate:Fixed={inheritEnv:false,operationId,path:absolute,mode,options,contentDigest:sha(bytes),totalBytes:bytes.length,namespace:description.namespace,bindingId:binding.id,productId:binding.controlProductId,sdkConversationId:api.conversationId,argv:[...description.applyArgvPrefix,operationId],position};
    await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!intent.fixed){intent.fixed=copy(candidate);index.items[operationId]={key,productId:binding.controlProductId,bindingId:binding.id};}},context,{persistence:{kind:'immediate'}});
    stored=await this.owner().snapshot(Intent,key,context);
   }
   if(!stored?.fixed)throw unknown(absolute);const fixed=copy(stored.fixed);
   if(fixed.path!==absolute||(fixed.mode??'write')!==mode||!same(fixed.options??{},options)||contentIdentity(fixed).digest!==sha(bytes)||contentIdentity(fixed).size!==bytes.length||fixed.bindingId!==binding.id||fixed.productId!==binding.controlProductId||fixed.sdkConversationId!==api.conversationId)throw unknown(absolute);
   if(stored.result?.state==='completed'&&stored.proof?.scopeConfirmed&&stored.result.after?.sha256===expectedIdentity(fixed,stored.plan).digest&&stored.result.after?.size===expectedIdentity(fixed,stored.plan).size){if(this.effects&&stored.native){this.checkNative(await this.effects.adopt(copy(stored.native)),stored.native);this.checkNativeProof(await this.effects.record(stored.native.operationId,copy(stored.proof)),stored.native,stored.proof);}return {ok:true,value:undefined};}
   if(bytes.length>32768){let offset=0;while(offset<bytes.length){context.abortSignal?.throwIfAborted();const chunk=bytes.subarray(offset,offset+32768),reply=await this.call('file.stage',{digest:contentIdentity(fixed).digest,totalBytes:bytes.length,offset,data:chunk.toString('base64')},absolute);if(reply.namespace!==fixed.namespace||reply.digest!==contentIdentity(fixed).digest||reply.totalBytes!==bytes.length||!Number.isSafeInteger(reply.nextOffset)||reply.nextOffset<offset+chunk.length||reply.nextOffset>bytes.length||reply.sealed!==(reply.nextOffset===bytes.length))throw unknown(absolute);offset=reply.nextOffset;}}
   const outcome=await run(fixed.argv,{inheritEnv:fixed.inheritEnv??true,scope:mode==='rename'?{domain:'device-files',kind:'environment'}:{domain:'device-files',kind:'paths',positions:[fixed.position]},fileOperationId:fixed.operationId,remember:async execution=>{await this.remember(fixed.operationId,execution);},beforePrepare:async execution=>{
    const native=await this.remember(fixed.operationId,execution);
    if(this.effects){this.checkNative(await this.effects.register(native),native);this.checkNative(await this.effects.require(native.operationId),native);}
    const mutation=mode!=='write'&&mode!=='append';
    const plan=await this.call(mutation?'file.prepareMutation':bytes.length>32768?'file.prepareStagedWrite':'file.prepareWrite',{operationId:fixed.operationId,path:fixed.path,...(mutation?{kind:mode,options}:{mode,...(bytes.length>32768?{digest:contentIdentity(fixed).digest,totalBytes:bytes.length}:{data})})},absolute);
    if(plan.operationId!==fixed.operationId||plan.namespace!==fixed.namespace||typeof plan.requestDigest!=='string'||!/^[a-f0-9]{64}$/.test(plan.requestDigest)||!same(plan.argv,fixed.argv)||!same(plan.position,fixed.position))throw unknown(absolute);
    await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null);if(!same(intent.fixed,fixed)||intent.plan&&!same(intent.plan,plan))throw unknown(absolute);intent.plan=copy(plan);},context,{persistence:{kind:'immediate'}});
   }});
   const current=await this.owner().snapshot(Intent,key,BACKGROUND_CONTEXT);if(!current?.plan)throw unknown(absolute);
   const result=await this.call('file.writeResult',{operationId:fixed.operationId},absolute);
   this.checkResult(result,fixed,current.plan);
   const expected=expectedIdentity(fixed,current.plan);
   if(!outcome.ok||outcome.value.exitCode!==0||result.state!=='completed'||result.after?.sha256!==expected.digest||result.after?.size!==expected.size){await this.saveResult(key,fixed,result);throw unknown(absolute);}
   await this.saveResult(key,fixed,result);
   const execution=await this.channel.request('query',{executionId:current.executionId});
   if(execution.executionId!==current.executionId||execution.requestDigest!==current.executionDigest||execution.namespace!==fixed.namespace)throw unknown(absolute);
   if(!(await this.evidence(fixed.operationId,execution)).scopeConfirmed)throw unknown(absolute);
   return {ok:true,value:undefined};
  }catch(error){return {ok:false,error:context.abortSignal?.aborted?new FileError('aborted','文件写入等待已停止；已开始的效果仍按回执核验',absolute):error instanceof FileError?error:unknown(absolute)};}
 }
 async remember(operationId:string,execution:FileExecutionIdentity):Promise<FileEffectIdentity>{
  const entry=(await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items[operationId],stored=entry?await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT):undefined;if(!stored?.fixed)throw Error('FILE_STORAGE_INCONSISTENT');const fixed=copy(stored.fixed);
  if(execution.context.productId!==fixed.productId||execution.context.sdkConversationId!==fixed.sdkConversationId)throw unknown(fixed.path);
  const native:FileEffectIdentity={operationId,kind:'file',source:'termux',namespace:fixed.namespace,...execution.context,requestDigest:sha(Buffer.from(JSON.stringify(canonical({fixed,control:execution.context}))))};
  await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,entry!.key,null);if(!same(intent.fixed,fixed)||intent.native&&!same(intent.native,native)||intent.executionId&&intent.executionId!==execution.executionId||intent.executionDigest&&intent.executionDigest!==execution.requestDigest)throw unknown(fixed.path);intent.native=copy(native);intent.executionId=execution.executionId;intent.executionDigest=execution.requestDigest;},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});return native;
 }
 private checkResult(result:any,fixed:Fixed,plan:Record<string,any>){if(result?.operationId!==fixed.operationId||result.namespace!==fixed.namespace||result.requestDigest!==plan.requestDigest||!['prepared','applying','completed','not_started','unknown'].includes(result.state))throw unknown(fixed.path);if(fixed.mode==='rename'&&result.state==='completed'&&(typeof plan.destination!=='string'||result.destination!==plan.destination))throw unknown(fixed.path);if(result.diff?.available&&(typeof result.diff.text!=='string'||Buffer.byteLength(result.diff.text)>16384))throw unknown(fixed.path);}
 private async saveResult(key:string,fixed:Fixed,result:Record<string,any>){await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,key,null);if(!same(intent.fixed,fixed))throw unknown(fixed.path);if(['completed','not_started'].includes(intent.result?.state??''))return;intent.result=copy(result);},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}
 private checkNative(value:Record<string,any>,identity:FileEffectIdentity){if(!value||Object.entries(identity).some(([key,expected])=>value[key]!==expected))throw Error('FILE_NATIVE_IDENTITY_MISMATCH');}
 private checkNativeProof(value:Record<string,any>,identity:FileEffectIdentity,proof:FileEffectEvidence){this.checkNative(value,identity);if(value.state!==proof.state||value.scopeConfirmed!==proof.scopeConfirmed||!Number.isSafeInteger(value.sequence)||value.sequence<proof.sequence)throw Error('FILE_NATIVE_PROOF_UNCONFIRMED');}
 private async publishProof(key:string,stored:Stored,execution:Record<string,any>,facts:{state:string;scopeConfirmed:boolean}){
  if(!stored.native)return facts;const identity=copy(stored.native),sequence=Number(execution.sequence??0);if(!Number.isSafeInteger(sequence)||sequence<0)throw Error('FILE_EVIDENCE_SEQUENCE');
  const proof:FileEffectEvidence={operationId:identity.operationId,namespace:identity.namespace,requestDigest:identity.requestDigest,...facts,sequence};
  const durable=await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,key,null);if(!same(intent.native,identity))throw Error('FILE_NATIVE_IDENTITY_MISMATCH');if(!intent.proof?.scopeConfirmed)intent.proof=copy(proof);return copy(intent.proof);},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});
  if(this.effects){this.checkNative(await this.effects.adopt(identity),identity);this.checkNativeProof(await this.effects.record(identity.operationId,durable),identity,durable);}
  return {state:durable.state,scopeConfirmed:durable.scopeConfirmed};
 }
 async recoverNative(){if(this.nativeRestored)return;for(const entry of Object.values((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{})){const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.native)continue;if(this.effects){this.checkNative(await this.effects.adopt(copy(stored.native)),stored.native);if(stored.proof)this.checkNativeProof(await this.effects.record(stored.native.operationId,copy(stored.proof)),stored.native,stored.proof);}}this.nativeRestored=true;}
 async evidence(operationId:string,execution:Record<string,any>):Promise<{state:string;scopeConfirmed:boolean}>{
  const entry=(await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items[operationId],stored=entry?await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT):undefined;
  if(!stored?.fixed)throw Error('FILE_STORAGE_INCONSISTENT');
  if(['not_started','stopped'].includes(execution.state)&&execution.neverStarted===true&&execution.scopeConfirmed===true){await this.saveResult(entry!.key,stored.fixed,{state:'not_started',original:true,path:stored.fixed.path,diff:{available:false,reason:'not_started'}});return this.publishProof(entry!.key,stored,execution,{state:'not_started',scopeConfirmed:true});}
  if(!execution.scopeConfirmed||!['completed','stopped','not_started'].includes(execution.state))return this.publishProof(entry!.key,stored,execution,{state:execution.state,scopeConfirmed:false});
  if(!stored.plan)return this.publishProof(entry!.key,stored,execution,{state:'unknown',scopeConfirmed:false});const fixed=copy(stored.fixed);let result=await this.call('file.writeResult',{operationId},fixed.path);this.checkResult(result,fixed,stored.plan);
  const expected=expectedIdentity(fixed,stored.plan);
  if(result.state==='completed'&&(result.original!==true||result.after?.size!==expected.size||result.after?.sha256!==expected.digest))throw unknown(fixed.path);
  if(!['completed','not_started'].includes(result.state)){
   const observed=await this.call('file.verifyWrite',{operationId},fixed.path);
   if(observed.operationId!==operationId||observed.namespace!==fixed.namespace||observed.requestDigest!==stored.plan.requestDigest)throw unknown(fixed.path);
   if(observed.matchesExpected===true&&observed.observed?.sha256===expected.digest&&observed.observed?.size===expected.size)result={...result,state:'completed',original:true,path:fixed.path,canonicalPath:fixed.position.canonicalPath,after:observed.observed,verification:'content-and-execution-scope',diff:{available:false,reason:'before_image_unavailable_after_interruption'}};
  }
  await this.saveResult(entry!.key,fixed,result);
  return this.publishProof(entry!.key,stored,execution,{state:result.state==='completed'?'completed':result.state==='not_started'?'not_started':'unknown',scopeConfirmed:result.state==='completed'||result.state==='not_started'});
 }
 async list(productId:string,cursor?:unknown){const entries=Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{}).filter(([,entry])=>entry.productId===productId),changes=[];
  const start=cursor===undefined?0:entries.findIndex(([id])=>id===cursor)+1;if(cursor!==undefined&&(typeof cursor!=='string'||!start))throw Error('FILE_CURSOR_INVALID');const page=entries.slice(start,start+20);
  for(const [operationId,entry]of page){const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.fixed)throw Error('FILE_STORAGE_INCONSISTENT');changes.push({operationId,bindingId:entry.bindingId,executionId:stored.executionId,path:stored.fixed.path,...(stored.fixed.mode==='rename'?{destination:stored.result?.destination??stored.fixed.options?.destination}:{}),namespace:stored.fixed.namespace,original:true,state:stored.result?.state??'pending',scopeConfirmed:stored.proof?.scopeConfirmed===true,diff:stored.result?.diff??{available:false,reason:'unconfirmed'}});}
  return {changes,nextCursor:start+page.length<entries.length?page.at(-1)![0]:null};
 }
}
