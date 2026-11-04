import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import type {Models} from '@earendil-works/pi-ai/models';

/** A host readiness barrier, not a scheduler. SDK owns every task/retry/abort. */
export class DispatchGate {
  private holds=1;
  private changed=new Set<()=>void>();
  check?:()=>Promise<void>;
  private checking?:Promise<void>;
  private verify(signal?:AbortSignal){if(!this.check)return Promise.resolve();const check=this.checking??=(this.check().finally(()=>{this.checking=undefined;}));return abortable(check,signal);}
  pause(){this.holds++;let active=true;return()=>{if(active){active=false;this.release();}};}
  release(){if(this.holds>0)this.holds--;for(const callback of [...this.changed])callback();}
  async wait(signal?:AbortSignal){
    while(this.holds){await new Promise<void>((resolve,reject)=>{const done=()=>{clean();resolve();},aborted=()=>{clean();reject(Error('运行已停止'));},clean=()=>{this.changed.delete(done);signal?.removeEventListener('abort',aborted);};this.changed.add(done);signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});}
    if(signal?.aborted)throw Error('运行已停止');
  }
  models(models:Models):Models {
    const methods=new Set(['stream','streamSimple','streamDeferred']);
    const completed:Record<string,string>={complete:'stream',completeSimple:'streamSimple',fetchDeferred:'streamDeferred'};
    const stream=(method:string,args:any[])=>{
      const output=createAssistantMessageEventStream(),[model,,options]=args;
      void(async()=>{try{do{await this.wait(options?.signal);await this.verify(options?.signal);}while(this.holds);if(options?.signal?.aborted)throw Error('运行已停止');for await(const event of (models as any)[method](...args))output.push(event);}catch{output.push({type:'error',reason:'aborted',error:{role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,stopReason:'aborted',errorMessage:'运行已停止',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});}})();return output;
    };
    return new Proxy(models,{get:(target,key)=>{if(typeof key==='string'&&methods.has(key))return(...args:any[])=>stream(key,args);if(typeof key==='string'&&completed[key])return(...args:any[])=>stream(completed[key],args).result();const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
}
// A stop check may abort this very SDK invocation. It must not wait on its own stream.
function abortable<T>(operation:Promise<T>,signal?:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{const aborted=()=>{clean();reject(Error('运行已停止'));},clean=()=>signal?.removeEventListener('abort',aborted);signal?.addEventListener('abort',aborted,{once:true});operation.then(value=>{clean();resolve(value);},error=>{clean();reject(error);});if(signal?.aborted)aborted();});}
