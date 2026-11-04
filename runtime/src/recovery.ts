import type {Registry,HookApi,Wake} from '@earendil-works/pi-durable';
import type {Context} from '@earendil-works/chord/context';
import {ExecutionBinding} from './project-bindings.js';

export type RecoveryConditions={network:'available'|'offline'|'unknown';userUnlocked:boolean};
export type RecoveryStatus={phase:'waiting';reason:'network-offline'|'network-unknown'|'first-unlock'|'model-retry'|'deferred-poll'|'external-unconfirmed';message:string;nextAt?:number;used?:number;limit?:number};
export type RecoveryProjection={conversations:{id:string;phase:string;recovery?:RecoveryStatus}[];completions:{identity:string;conversationId:string}[]};
export type RecoveryHost={conditions():Promise<RecoveryConditions>;subscribe(listener:()=>void):()=>void;publishWake(wake:Wake):Promise<void>;publishProjection?:(value:RecoveryProjection)=>Promise<void>;probe?:(workId:string)=>Promise<{allowed:boolean;used:number;at?:number;exhausted?:boolean}>;now?:()=>number};
export class RecoveryError extends Error {constructor(readonly code:string,message:string){super(message);}}
export async function recoveryPreflight(host:RecoveryHost){const facts=await host.conditions();if(!facts.userUnlocked)throw new RecoveryError('HOST_LOCKED','等待设备首次解锁，尚未打开会话运行存储');}

/** Eligibility only. The SDK owns task identity, scheduling, retries and cancellation. */
export class Recovery {
 private version=0;
 private closed=false;
 private readonly listeners=new Set<()=>void>();
 private readonly waiting=new Map<string,RecoveryStatus>();
 private readonly unsubscribe:()=>void;
 private wakeTail:Promise<void>=Promise.resolve();
 private wakeFailure:unknown;
 constructor(private readonly host:RecoveryHost,private readonly publish:()=>void){this.unsubscribe=host.subscribe(()=>{this.changedConditions();this.publish();});}
 changedConditions(){this.version++;for(const wake of [...this.listeners])wake();}
 status(productId:string){const state=this.waiting.get(productId);return state?{...state}:undefined;}
 schedule(wake:Wake){if(this.closed)return;const fixed={...wake};this.wakeTail=this.wakeTail.then(()=>this.host.publishWake(fixed)).catch(error=>{this.wakeFailure=error;this.publish();});}
 async flushWake(){await this.wakeTail;if(this.wakeFailure)throw this.wakeFailure;}
 install(registry:Registry,continuation?:(productId:string,context:Context)=>Promise<void>){registry.install({name:'application-recovery',hooks:[{task:'pi.generation',handlers:{beforeRequest:async(_request:unknown,api:HookApi,context:Context)=>{
  const binding=await api.snapshot(ExecutionBinding,api.conversationId,context);
  if(binding?.controlProductId)await continuation?.(binding.controlProductId,context);
  await this.model(binding?.controlProductId??undefined,context.abortSignal);
 }}}]});}
 async model(productId?:string,signal?:AbortSignal):Promise<void>{
  try{for(;;){
   if(this.closed||signal?.aborted)throw Error('恢复等待已结束');
   const version=this.version,conditions=await this.host.conditions();
   const status:RecoveryStatus|undefined=!conditions.userUnlocked?{phase:'waiting',reason:'first-unlock',message:'等待设备首次解锁'}:conditions.network==='available'?undefined:{phase:'waiting',reason:conditions.network==='offline'?'network-offline':'network-unknown',message:conditions.network==='offline'?'网络不可用，等待恢复后继续':'网络状态尚未确认，等待核验'};
   if(!status)return;
   if(productId){const prior=this.waiting.get(productId);this.waiting.set(productId,status);if(prior?.reason!==status.reason)this.publish();}
   await this.changed(version,signal);
  }}finally{if(productId&&this.waiting.delete(productId))this.publish();}
 }
 /** The caller remains in its SDK task. These bounded probes inspect the same effect;
  * they never prepare/start an execution or create a replacement submission. */
 async external(workId:string,productId:string,verified:()=>Promise<boolean>,probe:()=>Promise<void>,signal?:AbortSignal){
  try{for(;;){
   if(this.closed||signal?.aborted)throw Error('恢复等待已结束');
   const version=this.version;if(await verified())return;
   const budget=await this.host.probe?.(workId)??{allowed:false,used:0,exhausted:true};
   const status:RecoveryStatus={phase:'waiting',reason:'external-unconfirmed',message:budget.exhausted?'外部结果仍未确认，自动核验额度已用完；保留原工作等待人工核验':'外部结果尚未确认，保留原执行身份等待核验',used:budget.used,limit:5,...(!budget.exhausted&&budget.at!==undefined?{nextAt:budget.at}:{})};
   const old=this.waiting.get(productId);this.waiting.set(productId,status);if(JSON.stringify(old)!==JSON.stringify(status))this.publish();
   if(budget.allowed){try{await probe();}catch(error){if(signal?.aborted)throw error;}if(await verified())return;}
   await this.changed(version,signal,budget.exhausted?undefined:budget.at);
  }}finally{if(this.waiting.delete(productId))this.publish();}
 }
 private changed(version:number,signal?:AbortSignal,at?:number):Promise<void>{return new Promise((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const clean=()=>{this.listeners.delete(wake);signal?.removeEventListener('abort',abort);if(timer!==undefined)clearTimeout(timer);};
  const wake=()=>{clean();this.closed?reject(Error('恢复等待已结束')):resolve();};
  const abort=()=>{clean();reject(Error('运行已停止'));};
  this.listeners.add(wake);signal?.addEventListener('abort',abort,{once:true});
  if(at!==undefined)timer=setTimeout(wake,Math.max(1,Math.min(2147483647,at-(this.host.now?.()??Date.now()))));
  if(signal?.aborted)abort();else if(this.closed||this.version!==version)wake();
 });}
 close(){this.closed=true;this.unsubscribe();for(const wake of [...this.listeners])wake();this.waiting.clear();}
}
