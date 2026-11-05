import {createModels,createProvider} from '@earendil-works/pi-ai/models';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import assert from 'node:assert/strict';

/** Controlled external provider; actual SDK owns the persisted handle and attempt count. */
export function deferredConfiguration({started=()=>{},polled=()=>{},cancelled=()=>{}}={}){
 const model={id:'deferred',name:'Deferred',api:'openai-completions',provider:'deferred',baseUrl:'https://deferred.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1024};
 const message=(stopReason,extra={})=>({role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now(),stopReason,...extra});
 const stream=value=>{const events=new AssistantMessageEventStream();queueMicrotask(()=>events.push({type:'done',reason:value.stopReason,message:value}));return events;};
 const start=()=>{started();return stream(message('deferred',{deferred:{provider:model.provider,modelId:model.id,api:model.api,id:'one-original-response',pollAfterMs:10,data:{opaque:'retained'}}}));};
 const models=createModels();models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'controlled',resolve:async()=>({auth:{apiKey:'synthetic'}})}},api:{stream:start,streamSimple:start,fetchDeferred:(_model,handle)=>{assert.equal(handle.id,'one-original-response');assert.deepEqual(handle.data,{opaque:'retained'});polled();return stream(message('stop',{content:[{type:'text',text:'original deferred response'}]}));},cancelDeferred:async(_model,handle)=>{assert.equal(handle.id,'one-original-response');cancelled();}}}));
 return {models,initialModel:{provider:model.provider,modelId:model.id,name:'Deferred'}};
}
