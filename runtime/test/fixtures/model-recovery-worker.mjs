// Real SDK/SQLite worker. The controlled external Provider makes transport entry and release
// observable across actual process death; it does not replace the scheduler or persistence.
import {Application} from '../../validation/application-fixture.mjs';
import {ModelConnections} from '../../dist/model-connections.js';
import {createProvider} from '@earendil-works/pi-ai/models';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Harness,createRegistry} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from '../../dist/storage.js';

let app,harness,conversation,keys,connections,releaseConfiguration,sequence=0;
const usage={input:5,output:5,cacheRead:0,cacheWrite:0,totalTokens:10,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function controlledProvider(definition,deferred){
  const model={id:'probe-model',name:'Controlled recovery model',api:'openai-completions',provider:definition.id,baseUrl:definition.endpoint,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:4096};
  const stream=(selected,transcript,options,handle)=>{
    const output=new AssistantMessageEventStream();
    void(async()=>{
      const message=(stopReason,extra={})=>({role:'assistant',content:[],api:selected.api,provider:selected.provider,model:selected.id,usage,timestamp:Date.now(),stopReason,...extra});
      try{
        const phase=handle?'poll':JSON.stringify(transcript).includes('T05_COMPACTION_PROBE')?'compaction':'generation';
        const response=await options.fetch(new Request(`${selected.baseUrl}/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase,provider:selected.provider,model:selected.id,handle:handle?.id??null,transcript}),signal:options.signal}));
        const value=await response.json();
        if(!response.ok){output.push({type:'error',reason:'error',error:message('error',{errorMessage:value.message??`${response.status} service unavailable`})});return;}
        if(value.deferred||(deferred&&!handle&&phase!=='compaction')){
          output.push({type:'done',reason:'deferred',message:message('deferred',{deferred:{provider:selected.provider,modelId:selected.id,api:selected.api,id:value.id??'response-H',pollAfterMs:value.pollAfterMs??150,data:{opaque:'controlled-handle'}}})});return;
        }
        output.push({type:'done',reason:'stop',message:message('stop',{content:[{type:'text',text:value.text??`reply-${selected.provider}`}]})});
      }catch{
        const reason=options.signal?.aborted?'aborted':'error';
        output.push({type:'error',reason,error:message(reason,{errorMessage:reason==='aborted'?'aborted':'controlled transport unavailable'})});
      }
    })();return output;
  };
  return createProvider({id:definition.id,models:[model],auth:{apiKey:{name:'Controlled credential',resolve:async()=>({auth:{apiKey:'fixture-marker'}})}},api:{stream:(m,c,o)=>stream(m,c,o),streamSimple:(m,c,o)=>stream(m,c,o),fetchDeferred:(m,h,o)=>stream(m,{},o,h)}});
}
async function command(op,payload){
  switch(op){
    case 'open':{
      keys=new Map(Object.entries(payload.keys));
      const credentials={metadata:async id=>({connectionId:id,state:keys.has(id)?'configured':'absent',configured:keys.has(id),generation:keys.get(id)?.generation??0}),resolve:async id=>{const value=keys.get(id);if(!value)throw Error('controlled credential absent');return value;}};
      connections=new ModelConnections({credentials,allowLoopbackHttp:true,providerFactory:definition=>controlledProvider(definition,payload.deferred)});
      const settings=()=>({retry:{enabled:true,maxRetries:2,baseDelayMs:1200},stream:{deferred:payload.deferred},compaction:{enabled:false,keepRecentTokens:1,reserveTokens:1024}});
      if(payload.mode==='harness'){
        const definitions=['connection-a','connection-b'].map((id,index)=>connections.definition({creationId:id,name:id,protocol:'openai-compatible',endpoint:`${payload.endpoint}/${index?'b':'a'}`,modelId:'probe-model'}));
        connections.publish({version:1,defaultModel:{provider:'connection-a',modelId:'probe-model'},connections:definitions});
        const {storage}=await openOwnedStorage(payload.path);
        harness=await Harness.open(storage,{models:()=>connections.models,settings,registry:createRegistry()},context);
        conversation=await harness.root(context,{agent:{model:{provider:'connection-a',modelId:'probe-model'},maxTurns:3}});
        harness.resume();return {pid:process.pid,conversationId:conversation.id};
      }
      app=new Application({path:payload.path,models:connections.models,connections,workspacePath:payload.path+'.workspace',bootstrapSettings:settings,
        loadConfiguration:payload.gated?()=>new Promise(resolve=>{releaseConfiguration=resolve;}):undefined});
      await app.start();return {pid:process.pid,status:app.status()};
    }
    case 'request':{
      const response=await app.request({protocol:1,connectionId:'recovery-worker',requestId:String(++sequence),method:payload.method,payload:payload.payload});
      if(!response.ok)throw Object.assign(Error(response.error.message),{code:response.error.code});return response.value;
    }
    case 'rotate':keys.set(payload.id,{key:payload.key,generation:(keys.get(payload.id)?.generation??0)+1});return {};
    case 'status':return app?.status()??null;
    case 'releaseConfiguration':releaseConfiguration?.();return {};
    case 'h.submit':await conversation.submit({type:'input',content:payload.text,requestId:payload.id},context);await conversation.waitForIdle(context);return {};
    case 'h.entries':return conversation.entries({order:'ascending'},100,undefined,context);
    case 'h.compact':return {taskId:await conversation.compact('T05_COMPACTION_PROBE',context)};
    case 'h.select':await conversation.configure({model:{provider:payload.provider,modelId:'probe-model'}},context);return {};
    case 'h.agent':return conversation.agent(context);
    case 'h.wait':return harness.waitForTask(payload.taskId,context);
    case 'close':await app?.close();await harness?.close(context);return {closed:true};
    default:throw Error('Unknown fixture operation');
  }
}
process.on('message',async({id,op,payload})=>{try{const value=await command(op,payload);process.send({id,ok:true,value},()=>{if(op==='close')process.exit(0);});}catch(error){process.send({id,ok:false,error:{code:error.code??'FIXTURE_FAILED',message:error.message}});}});
