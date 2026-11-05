import {createRegistry,defineExtension,defineTool} from '@earendil-works/pi-durable';
import {obj} from '@earendil-works/pi-schema';
import type {ExecutionEnv} from '@earendil-works/pi-durable/env';
import type {AdoptedBinding,LocationAdapter} from './project-bindings.js';
/** Explicit debug fixture only: observes SDK environment adoption; never accesses files/Termux. */
export function projectWitness(metrics:Record<string,unknown>){
 const state={enabled:false},bound=new WeakMap<object,AdoptedBinding>();
 const record=(b:AdoptedBinding)=>({bindingId:b.id,workspaceId:b.location.id,version:b.location.version,path:b.location.path,projectId:b.projectId,actualIdentity:b.actualIdentity,sourceProductId:b.sourceProductId,controlProductId:b.controlProductId});
 const locations:LocationAdapter={inspect:async w=>state.enabled?{state:'available',identity:'validation-directory:'+w.path}:{state:'unverified',reason:'受控位置验证尚未启用'},environment:async binding=>{if(!state.enabled)throw Error('受控位置验证尚未启用');const env=new Proxy({id:'validation-no-files',cwd:binding.location.path},{get:(target,key)=>key==='then'?undefined:key in target?Reflect.get(target,key):()=>{throw Error('This validation environment performs no filesystem or shell operation');}}) as ExecutionEnv;bound.set(env,binding);((metrics.projectEnvironments??=[]) as unknown[]).push(record(binding));return env;}};
 const registry=createRegistry();registry.install(defineExtension({name:'validation.project-position',tools:[defineTool({name:'location_witness',description:'Report the adopted workspace location for this validation request. Does not read or write files.',parameters:obj({}),execute:async(_args,api)=>{const b=api.env&&bound.get(api.env);if(!b||api.env!.cwd!==b.location.path)throw Error('Adopted validation environment missing');const result={...record(b),sdkConversationId:api.conversationId,toolTaskId:api.taskId};((metrics.projectToolWitnesses??=[]) as unknown[]).push(result);return {output:[{type:'text',text:JSON.stringify(result)}]};}})]}));
 return {registry,locations,get enabled(){return state.enabled;},enable(){state.enabled=true;metrics.projectWitnessEnabled=true;metrics.projectEnvironments=[];metrics.projectToolWitnesses=[];}};
}
