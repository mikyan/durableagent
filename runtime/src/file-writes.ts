import {defineDoc,defineDocFamily,type Harness,type ToolExecutionApi} from '@earendil-works/pi-durable';
import {FileError,type ExecutionError,type Result,type ShellExecResult} from '@earendil-works/pi-durable/env';
import {BACKGROUND_CONTEXT,type Context} from '@earendil-works/chord/context';
import {randomUUID,createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {AdoptedBinding} from './project-bindings.js';
import type {ExecutionChannel} from './execution-channel.js';
import type {FilePosition,WriteScope} from './workspace-coordination.js';

export type FileExecutionEffect={scope:WriteScope;fileOperationId:string;beforePrepare:(executionId:string)=>Promise<void>};
type Fixed={operationId:string;path:string;data:string;namespace:string;bindingId:string;productId:string;sdkConversationId:number;argv:string[];position:FilePosition};
type Stored={fixed:Fixed|null;plan:Record<string,any>|null;result:Record<string,any>|null;executionId:string|null};
const Intent=defineDocFamily({kind:'app.managed-file-intent',version:1,scope:'session',family:true,initial:(_:null):Stored=>({fixed:null,plan:null,result:null,executionId:null}),checkpointWhen:()=>false});
const Index=defineDoc({kind:'app.managed-file-index',version:1,scope:'session',initial:()=>({items:{} as Record<string,{key:string;productId:string;bindingId:string}>}),checkpointWhen:()=>false});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left:unknown,right:unknown)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const unknown=(path:string)=>new FileError('unknown','原文件写入尚未取得匹配的完整回执；保留原身份等待核验',path);
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');

/** Fixed file plans and their original-file evidence; command supervision stays in ManagedExecution. */
export class FileWrites{
 private harness?:Harness;
 constructor(private readonly channel:ExecutionChannel){}
 attach(harness:Harness){this.harness=harness;}
 private owner(){if(!this.harness)throw Error('FILE_STORAGE_NOT_READY');return this.harness;}
 private async call(method:string,payload:Record<string,unknown>,path:string):Promise<any>{const response=await this.channel.request(method,payload);if(response.ok===true&&Object.hasOwn(response,'value'))return response.value;const code=(response.error as any)?.code;if(response.ok===false&&['aborted','not_found','permission_denied','not_directory','is_directory','invalid','not_supported','unknown'].includes(code))throw new FileError(code,`原文件操作未完成（${code}）`,path);throw unknown(path);}
 async write(binding:AdoptedBinding,api:ToolExecutionApi|undefined,path:string,content:string|Uint8Array,context:Context,ordinal:number,run:(argv:string[],effect:FileExecutionEffect)=>Promise<Result<ShellExecResult,ExecutionError>>):Promise<Result<void,FileError>>{
  const absolute=posix.resolve(binding.location.path,path),bytes=typeof content==='string'?Buffer.from(content):Buffer.from(content),data=bytes.toString('base64'),key=`${api?.taskId}:${api?.callId}:${ordinal}`;
  try{
   if(!api)throw unknown(absolute);context.abortSignal?.throwIfAborted();if(bytes.length>32768)throw new FileError('not_supported','单次文件写入超过当前有界传输能力',absolute);
   let stored=await this.owner().snapshot(Intent,key,context);
   if(!stored?.fixed){
    const description=await this.call('file.describe',{},absolute),position=await this.call('file.resolveWrite',{path:absolute},absolute);
    if(description.protocol!==1||typeof description.namespace!=='string'||!Array.isArray(description.applyArgvPrefix)||description.applyArgvPrefix.length!==4||description.applyArgvPrefix.some((value:unknown)=>typeof value!=='string'||!value)||position.namespace!==description.namespace||typeof position.canonicalPath!=='string'||!posix.isAbsolute(position.canonicalPath)||!Array.isArray(position.ancestorObjectIds)||position.ancestorObjectIds.length>128)throw unknown(absolute);
    const operationId=randomUUID(),candidate:Fixed={operationId,path:absolute,data,namespace:description.namespace,bindingId:binding.id,productId:binding.controlProductId,sdkConversationId:api.conversationId,argv:[...description.applyArgvPrefix,operationId],position};
    await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null),index=await tx.doc(Index);if(!intent.fixed){intent.fixed=copy(candidate);index.items[operationId]={key,productId:binding.controlProductId,bindingId:binding.id};}},context,{persistence:{kind:'immediate'}});
    stored=await this.owner().snapshot(Intent,key,context);
   }
   if(!stored?.fixed)throw unknown(absolute);const fixed=copy(stored.fixed);
   if(fixed.path!==absolute||fixed.data!==data||fixed.bindingId!==binding.id||fixed.productId!==binding.controlProductId||fixed.sdkConversationId!==api.conversationId)throw unknown(absolute);
   if(stored.result?.state==='completed'&&stored.result.after?.sha256===sha(bytes)&&stored.result.after?.size===bytes.length)return {ok:true,value:undefined};
   const outcome=await run(fixed.argv,{scope:{domain:'device-files',kind:'paths',positions:[fixed.position]},fileOperationId:fixed.operationId,beforePrepare:async executionId=>{
    const plan=await this.call('file.prepareWrite',{operationId:fixed.operationId,path:fixed.path,mode:'write',data:fixed.data},absolute);
    if(plan.operationId!==fixed.operationId||plan.namespace!==fixed.namespace||typeof plan.requestDigest!=='string'||!/^[a-f0-9]{64}$/.test(plan.requestDigest)||!same(plan.argv,fixed.argv)||!same(plan.position,fixed.position))throw unknown(absolute);
    await api.commit(async tx=>{const intent=await tx.doc(Intent,key,null);if(!same(intent.fixed,fixed)||intent.plan&&!same(intent.plan,plan))throw unknown(absolute);intent.plan=copy(plan);intent.executionId=executionId;},context,{persistence:{kind:'immediate'}});
   }});
   const current=await this.owner().snapshot(Intent,key,BACKGROUND_CONTEXT);if(!current?.plan)throw unknown(absolute);
   const result=await this.call('file.writeResult',{operationId:fixed.operationId},absolute);
   this.checkResult(result,fixed,current.plan);
   if(!outcome.ok||outcome.value.exitCode!==0||result.state!=='completed'||result.after?.sha256!==sha(bytes)||result.after?.size!==bytes.length){await this.saveResult(key,fixed,result);throw unknown(absolute);}
   await this.saveResult(key,fixed,result);return {ok:true,value:undefined};
  }catch(error){return {ok:false,error:context.abortSignal?.aborted?new FileError('aborted','文件写入等待已停止；已开始的效果仍按回执核验',absolute):error instanceof FileError?error:unknown(absolute)};}
 }
 private checkResult(result:any,fixed:Fixed,plan:Record<string,any>){if(result?.operationId!==fixed.operationId||result.namespace!==fixed.namespace||result.requestDigest!==plan.requestDigest||!['prepared','applying','completed','not_started','unknown'].includes(result.state))throw unknown(fixed.path);if(result.diff?.available&&(typeof result.diff.text!=='string'||Buffer.byteLength(result.diff.text)>16384))throw unknown(fixed.path);}
 private async saveResult(key:string,fixed:Fixed,result:Record<string,any>){await this.owner().commit(async tx=>{const intent=await tx.doc(Intent,key,null);if(!same(intent.fixed,fixed))throw unknown(fixed.path);if(intent.result?.state==='completed')return;intent.result=copy(result);},BACKGROUND_CONTEXT,{persistence:{kind:'immediate'}});}
 async evidence(operationId:string,execution:Record<string,any>):Promise<{state:string;scopeConfirmed:boolean}>{
  const entry=(await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items[operationId],stored=entry?await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT):undefined;
  if(!stored?.fixed)throw Error('FILE_STORAGE_INCONSISTENT');
  if(execution.state==='not_started'&&execution.neverStarted===true&&execution.scopeConfirmed===true)return {state:'not_started',scopeConfirmed:true};
  if(!execution.scopeConfirmed||!['completed','stopped','not_started'].includes(execution.state))return {state:execution.state,scopeConfirmed:false};
  if(!stored.plan)return {state:'unknown',scopeConfirmed:false};const fixed=copy(stored.fixed);let result=await this.call('file.writeResult',{operationId},fixed.path);this.checkResult(result,fixed,stored.plan);
  const expected=Buffer.from(fixed.data,'base64');
  if(result.state==='completed'&&(result.original!==true||result.after?.size!==expected.length||result.after?.sha256!==sha(expected)))throw unknown(fixed.path);
  if(!['completed','not_started'].includes(result.state)){
   const observed=await this.call('file.verifyWrite',{operationId},fixed.path);
   if(observed.operationId!==operationId||observed.namespace!==fixed.namespace||observed.requestDigest!==stored.plan.requestDigest)throw unknown(fixed.path);
   if(observed.matchesExpected===true&&observed.observed?.sha256===sha(expected)&&observed.observed?.size===expected.length)result={...result,state:'completed',original:true,path:fixed.path,canonicalPath:fixed.position.canonicalPath,after:observed.observed,verification:'content-and-execution-scope',diff:{available:false,reason:'before_image_unavailable_after_interruption'}};
  }
  await this.saveResult(entry!.key,fixed,result);
  return {state:result.state==='completed'?'completed':result.state==='not_started'?'not_started':'unknown',scopeConfirmed:result.state==='completed'||result.state==='not_started'};
 }
 async list(productId:string){const entries=Object.entries((await this.owner().snapshot(Index,BACKGROUND_CONTEXT))?.items??{}).filter(([,entry])=>entry.productId===productId).slice(-100),changes=[];
  for(const [operationId,entry]of entries){const stored=await this.owner().snapshot(Intent,entry.key,BACKGROUND_CONTEXT);if(!stored?.fixed)throw Error('FILE_STORAGE_INCONSISTENT');changes.push({operationId,bindingId:entry.bindingId,executionId:stored.executionId,path:stored.fixed.path,namespace:stored.fixed.namespace,original:true,state:stored.result?.state??'pending',diff:stored.result?.diff??{available:false,reason:'unconfirmed'}});}
  return {changes};
 }
}
