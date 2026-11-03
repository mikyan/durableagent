// Validation-only shared cases. Desktop node:test and Android Node run identical callbacks.
const policyCases=[];
const test=(name,run)=>policyCases.push({name,run});
let policyRunning=false;
let policyTempRoot;

export function registerModelPolicyChecks(register) {
  for(const {name,run} of policyCases)register(name,run);
}

export async function runModelPolicyChecks(onCase,{tempRoot}={}) {
  if(policyRunning)throw Object.assign(new Error('Model policy checks are already running'),{code:'MODEL_POLICY_BUSY'});
  policyRunning=true;
  policyTempRoot=tempRoot;
  const results=[];
  try {
    for(const {name,run} of policyCases) {
      try {
        await run();
        const result={name,passed:true};
        results.push(result);
        await onCase?.(result);
      } catch (error) {
        // Assertion diffs and native causes can contain synthetic credentials or paths.
        // The case name identifies the exact desktop reproduction without exposing either.
        throw Object.assign(new Error(`Model policy check failed: ${name}`),{code:'MODEL_POLICY_FAILED',caseName:name,diagnostic:{name:error?.name,code:error?.code,operator:error?.operator,frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at\s/.test(line)).slice(0,8)}});
      }
    }
    return results;
  } finally {policyTempRoot=undefined;policyRunning=false;}
}

import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {ModelConnections} from '../dist/model-connections.js';
import {fixtureTransport} from '../dist/transport.js';
import {auditStorageSecret} from '../dist/storage.js';
import {createServer} from 'node:http';
import {createProvider} from '@earendil-works/pi-ai/models';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai';
import {faultDatabase} from '../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
let seq=0;
export const call=async(app,method,payload={})=>{const r=await app.request({protocol:1,connectionId:'models-test',requestId:String(++seq),method,payload});if(!r.ok)throw Object.assign(Error(r.error.message),{code:r.error.code});return r.value;};
export const until=async(fn)=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end,'Public state timeout');await new Promise(r=>setTimeout(r,5));}};
export function vault(){const values=new Map();let reads=0;return {values,get reads(){return reads;},metadata:async id=>({connectionId:id,state:values.has(id)?'configured':'absent',configured:values.has(id),generation:values.get(id)?.generation??0}),resolve:async id=>{reads++;if(!values.has(id))throw Error('credential absent');return values.get(id);},save(id,key){values.set(id,{key,generation:(values.get(id)?.generation??0)+1});}};}
test('public configuration is durable; defaults and current models are separate; queries never decrypt',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-config-')),credentials=vault(),seen=[];
 const create=()=>{const connections=new ModelConnections({credentials,fetch:async(input,init)=>{const req=new Request(input,init);seen.push({url:req.url,key:req.headers.get('api-key')});return fixtureTransport({requested:()=>{},aborted:()=>{}})(req);}});return new Application({path:join(dir,'app.sqlite'),models:connections.models,connections,workspacePath:dir});};
 let app=create();try{await app.start();let config=await call(app,'models.get');assert.equal(config.version,0);assert.equal(config.defaultModel,null);
 config=await call(app,'models.create',{creationId:'conn-a',expectedVersion:0,name:'A',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
 assert.equal(config.version,1);assert.equal(config.connections[0].credential.state,'absent');credentials.save('conn-a','synthetic-secret-A');
 config=await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'conn-a',modelId:'mimo-v2.6-flash'}});
 await call(app,'create',{creationId:'first'});
 config=await call(app,'models.create',{creationId:'conn-b',expectedVersion:config.version,name:'B',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
 assert.equal(config.connections[1].credential.configured,false);credentials.save('conn-b','synthetic-secret-B');
 config=await call(app,'models.setDefault',{expectedVersion:config.version,selection:{provider:'conn-b',modelId:'mimo-v2.6-flash'}});
 await call(app,'create',{creationId:'second'});
 assert.equal((await call(app,'open',{id:'first'})).conversation.model.provider,'conn-a');assert.equal((await call(app,'open',{id:'second'})).conversation.model.provider,'conn-b');
 await call(app,'models.select',{id:'first',selection:{provider:'conn-b',modelId:'mimo-v2.6-flash'}});
 assert.equal(credentials.reads,0);assert.equal((await call(app,'models.get')).defaultModel.provider,'conn-b');
 await call(app,'send',{id:'first',text:'测试',actionId:'one'});await until(async()=>(await call(app,'open',{id:'first'})).phase==='done');assert.equal(seen.length,1);assert.equal(seen[0].key,'synthetic-secret-B');assert.deepEqual((await call(app,'history',{id:'first'})).items.map(item=>item.text),['测试','你好🌍']);
 await app.close();app=create();await app.start();assert.equal((await call(app,'models.get')).version,config.version);assert.equal((await call(app,'list')).conversations.length,2);
 await assert.rejects(call(app,'models.create',{creationId:'conn-b',expectedVersion:config.version,name:'B',protocol:'mimo-cn',endpoint:'https://other.invalid/v1'}),{code:'IMMUTABLE_CONNECTION'});
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('configuration COMMIT failure preserves old durable version and blocks scheduling until reopen',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-commit-')),path=join(dir,'app.sqlite'),credentials=vault(),{db,control}=await faultDatabase(path),storage=await SqliteStorage.open(db);
 const connections=new ModelConnections({credentials});let app=new Application({path,models:connections.models,connections,workspacePath:dir,storageFactory:async()=>storage});
 try{await app.start();control.before=sql=>{if(sql==='COMMIT')throw Error('synthetic configuration commit fault');};await assert.rejects(call(app,'models.create',{creationId:'not-saved',expectedVersion:0,name:'Not saved',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'}),/configuration commit fault/);await until(()=>app.status().phase==='failed');await assert.rejects(call(app,'create',{creationId:'blocked'}),{code:'STORAGE_UNAVAILABLE'});await app.close();control.before=()=>{};const reopened=new ModelConnections({credentials});app=new Application({path,models:reopened.models,connections:reopened,workspacePath:dir});await app.start();assert.equal((await call(app,'models.get')).version,0);assert.deepEqual((await call(app,'models.get')).connections,[]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('rotation or disable before final admission sends nothing; disabling after send does not cancel it',async()=>{
 for(const kind of ['rotation','disable','after-send']){
  const credentials=vault();credentials.save('admission','synthetic-admission-one');let entered=false,release,requests=0;
  const hold=new Promise(r=>release=r),resolve=credentials.resolve;credentials.resolve=async id=>{const result=await resolve(id);if(kind!=='after-send'){entered=true;await hold;}return result;};
  const transport=fixtureTransport({requested:()=>{},aborted:()=>{}}),connections=new ModelConnections({credentials,fetch:async(input,init)=>{requests++;if(kind==='after-send'){entered=true;await hold;}return transport(input,init);}});
  const definition=connections.definition({creationId:'admission',name:'Admission',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});connections.publish({version:1,defaultModel:null,connections:[definition]});
  const result=connections.models.completeSimple(connections.models.getModel('admission','mimo-v2.6-flash'),{messages:[{role:'user',content:'Ordinary prompt',timestamp:Date.now()}]});await until(()=>entered);
  if(kind==='rotation')credentials.save('admission','synthetic-admission-two');else connections.publish({version:2,defaultModel:null,connections:[{...definition,enabled:false}]});release();const message=await result;
  assert.equal(requests,kind==='after-send'?1:0);assert.equal(message.stopReason,kind==='after-send'?'stop':'error');assert.ok(!JSON.stringify(message).includes('synthetic-admission'));
 }
});
test('an old deferred response never becomes a replacement request after credential rotation',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-deferred-')),credentials=vault();let starts=0,polls=0;
 const model={id:'deferred',name:'Deferred validation',api:'openai-completions',provider:'deferred',baseUrl:'https://deferred.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1024};
 const message=(stopReason,extra={})=>({role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now(),stopReason,...extra});
 const stream=value=>{const events=new AssistantMessageEventStream();queueMicrotask(()=>events.push(value.stopReason==='error'?{type:'error',reason:'error',error:value}:{type:'done',reason:value.stopReason,message:value}));return events;};
 const start=()=>{starts++;return stream(message('deferred',{deferred:{provider:'deferred',modelId:'deferred',api:model.api,id:'old-response',pollAfterMs:80,data:{opaque:'retained'}}}));};
 const connections=new ModelConnections({credentials,providerFactory:()=>createProvider({id:'deferred',models:[model],auth:{apiKey:{name:'fixture',resolve:async()=>({auth:{apiKey:'marker'}})}},api:{stream:start,streamSimple:start,fetchDeferred:()=>{polls++;return stream(message('error',{errorMessage:'503 service unavailable'}));}}})});
 const app=new Application({path:join(dir,'app.sqlite'),models:connections.models,connections,workspacePath:dir,bootstrapSettings:()=>({retry:{enabled:true,maxRetries:2,baseDelayMs:5},stream:{deferred:true}})});
 try{await app.start();await call(app,'models.create',{creationId:'deferred',expectedVersion:0,name:'Deferred',protocol:'openai-compatible',endpoint:model.baseUrl,modelId:'deferred'});credentials.save('deferred','synthetic-original');await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'deferred',modelId:'deferred'}});await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'One logical input',actionId:'one'});await until(async()=>(await call(app,'open',{id:'chat'})).phase==='waiting');credentials.save('deferred','synthetic-rotated');await until(async()=>(await call(app,'open',{id:'chat'})).phase==='failed');assert.equal(starts,1);assert.equal(polls,0);assert.match((await call(app,'open',{id:'chat'})).reason,/旧响应凭据兼容性未确认/);assert.equal((await call(app,'history',{id:'chat'})).items.filter(x=>x.role==='user').length,1);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('actual HTTP redirects cannot forward credentials or prompt body to another destination',async()=>{
 let arrivals=0,source=0;const foreign=createServer((_req,res)=>{arrivals++;res.end('unexpected');});await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
 let location=`http://127.0.0.1:${foreign.address().port}/stolen`,status=307;
 const origin=createServer((req,res)=>{source++;assert.equal(req.headers['api-key'],'synthetic-redirect-key');res.writeHead(status,{location});res.end();});await new Promise(r=>origin.listen(0,'127.0.0.1',r));
 const credentials=vault();credentials.save('redirect','synthetic-redirect-key');const connections=new ModelConnections({credentials,allowLoopbackHttp:true});const endpoint=`http://127.0.0.1:${origin.address().port}/v1`;
 const definition=connections.definition({creationId:'redirect',name:'Redirect validation',protocol:'mimo-cn',endpoint});connections.publish({version:1,defaultModel:null,connections:[definition]});
 try{for(const item of [307,308]){status=item;const result=await connections.models.completeSimple(connections.models.getModel('redirect','mimo-v2.6-flash'),{messages:[{role:'user',content:'synthetic private body',timestamp:Date.now()}]});assert.equal(result.stopReason,'error');assert.ok(!JSON.stringify(result).includes('synthetic-redirect-key'));}location=`${endpoint}/wrong-route`;await connections.models.completeSimple(connections.models.getModel('redirect','mimo-v2.6-flash'),{messages:[]});assert.equal(source,3);assert.equal(arrivals,0);
 }finally{origin.closeAllConnections();foreign.closeAllConnections();await Promise.all([new Promise(r=>origin.close(r)),new Promise(r=>foreign.close(r))]);}
});
test('credential/options overrides are rejected; revoke never uses ambient environment credentials',async()=>{
 const credentials=vault();credentials.save('options','synthetic-store-key');let requests=0;const connections=new ModelConnections({credentials,fetch:async()=>{requests++;return new Response('{}');}});connections.publish({version:1,defaultModel:null,connections:[connections.definition({creationId:'options',name:'Options',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'})]});
 const model=connections.models.getModel('options','mimo-v2.6-flash');
 for(const options of [{apiKey:'synthetic-override'},{headers:{authorization:'Bearer synthetic-override'}},{env:{XIAOMI_TOKEN_PLAN_CN_API_KEY:'synthetic-override'}}]){const result=await connections.models.completeSimple(model,{messages:[]},options);assert.equal(result.stopReason,'error');assert.ok(!JSON.stringify(result).includes('synthetic-override'));}assert.equal(requests,0);
 credentials.values.delete('options');process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY='synthetic-ambient';try{const result=await connections.models.completeSimple(model,{messages:[]});assert.equal(result.stopReason,'error');assert.equal(requests,0);}finally{delete process.env.XIAOMI_TOKEN_PLAN_CN_API_KEY;}
});
test('a post-commit publication failure gates dispatch and reopen loads the durable generation',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-publish-')),credentials=vault();let fail=false;
 const create=()=>{const connections=new ModelConnections({credentials,beforePublish:()=>{if(fail)throw Error('synthetic publication fault');}});return new Application({path:join(dir,'app.sqlite'),models:connections.models,connections,workspacePath:dir});};
 let app=create();try{await app.start();fail=true;await assert.rejects(call(app,'models.create',{creationId:'saved',expectedVersion:0,name:'Saved',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'}),{code:'CONFIG_PUBLICATION_FAILED'});assert.equal(app.status().phase,'failed');await assert.rejects(call(app,'create',{creationId:'blocked'}),{code:'STORAGE_UNAVAILABLE'});await app.close();fail=false;app=create();await app.start();const config=await call(app,'models.get');assert.equal(config.version,1);assert.equal(config.connections[0].id,'saved');
 await Promise.all([call(app,'models.setEnabled',{expectedVersion:1,id:'saved',enabled:false}),assert.rejects(call(app,'models.setEnabled',{expectedVersion:1,id:'saved',enabled:true}),{code:'CONFIG_CONFLICT'})]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('an in-flight reflected old credential is sanitized even after rotation, including live WAL and events',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-redact-')),path=join(dir,'app.sqlite'),credentials=vault(),old='synthetic-K1-abc123-secret',next='synthetic-K2-xyz456-secret';let release,entered=false;
 const hold=new Promise(r=>release=r),connections=new ModelConnections({credentials,fetch:async input=>{const req=new Request(input);assert.equal(req.headers.get('api-key'),old);entered=true;await hold;const bytes=new TextEncoder().encode(JSON.stringify({error:{message:`Rejected api-key ${old}`,nested:{Authorization:`Bearer ${old}`}}}));return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{status:401,headers:{'content-type':'application/json'}});}});
 const app=new Application({path,models:connections.models,connections,workspacePath:dir});const events=[];
 try{await app.start();await call(app,'models.create',{creationId:'secret',expectedVersion:0,name:'Secret',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});credentials.save('secret',old);await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'secret',modelId:'mimo-v2.6-flash'}});await call(app,'create',{creationId:'chat'});await app.request({protocol:1,connectionId:'models-test',requestId:'watch',method:'subscribe',payload:{id:'chat',subscriptionId:'watch'}},e=>events.push(e));await call(app,'send',{id:'chat',text:'Only ordinary text',actionId:'one'});await until(()=>entered);credentials.save('secret',next);release();await until(async()=>(await call(app,'open',{id:'chat'})).phase==='failed');
 const publicState=JSON.stringify([await call(app,'open',{id:'chat'}),await call(app,'models.get'),events]);assert.ok(!publicState.includes(old));assert.ok(!publicState.includes(next));assert.ok(publicState.includes('[REDACTED]'));assert.ok((await auditStorageSecret(path,old)).includes('wal'));await auditStorageSecret(path,next);await app.close();await auditStorageSecret(path,old);
 }finally{release();await app.close();await rm(dir,{recursive:true,force:true});}
});
test('serialized SDK stream settings reject credentials and arbitrary nested options before opening storage',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-options-'));
 try{for(const stream of [{apiKey:'synthetic-option-key'},{headers:{AuThOrIzAtIoN:'Bearer synthetic-option-key'}},{metadata:{nested:{key:'synthetic-option-key'}}},{timeoutMs:'synthetic-option-key'},{transport:'synthetic-option-key'}]){const app=new Application({path:join(dir,`${++seq}.sqlite`),models:new ModelConnections({credentials:vault()}).models,workspacePath:dir,bootstrapSettings:()=>({stream})});try{await assert.rejects(app.start(),/模型请求选项/);}finally{await app.close();}}}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('JSON escaped credential reflection is removed after decoding, before SDK progress and persistence',async()=>{
 for(const streaming of [false,true]){
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-escaped-')),path=join(dir,'app.sqlite'),credentials=vault(),key='SYNTHETIC-ESCAPED-CREDENTIAL-001';credentials.save('escaped',key);
 const escaped=[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const connections=new ModelConnections({credentials,fetch:async()=>{const chunk=content=>`data: ${JSON.stringify({id:'escaped',object:'chat.completion.chunk',created:1,model:'mimo-v2.6-flash',choices:[{index:0,delta:{content},finish_reason:null}]}).replaceAll(key,escaped)}\n\n`;const body=streaming?chunk('Reflected '+key)+chunk(' safe ending')+'data: [DONE]\n\n':JSON.stringify({error:{message:'Rejected '+key}}).replace(key,escaped);return new Response(body,{status:streaming?200:401,headers:{'content-type':streaming?'text/event-stream':'application/json'}});}});
 const app=new Application({path,models:connections.models,connections,workspacePath:dir});const events=[];
 try{await app.start();await call(app,'models.create',{creationId:'escaped',expectedVersion:0,name:'Escaped',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'escaped',modelId:'mimo-v2.6-flash'}});await call(app,'create',{creationId:'chat'});await app.request({protocol:1,connectionId:'events',requestId:'watch',method:'subscribe',payload:{id:'chat',subscriptionId:'watch'}},e=>events.push(e));await call(app,'send',{id:'chat',text:'Ordinary prompt',actionId:'once'});await until(async()=>['done','failed'].includes((await call(app,'open',{id:'chat'})).phase));const result=JSON.stringify([await call(app,'open',{id:'chat'}),events]);assert.ok(!result.includes(key),'Decoded secret leaked to public projection');assert.ok(result.includes('[REDACTED]'));await auditStorageSecret(path,key);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
 }
});
test('a credential rotated after deferred compatibility check is rejected again at final fetch admission',async()=>{
 const credentials=vault();credentials.save('race','synthetic-race-old');let entered=false,release,requests=0;const hold=new Promise(r=>release=r),resolve=credentials.resolve;
 credentials.resolve=async id=>{entered=true;await hold;return resolve(id);};
 const connections=new ModelConnections({credentials,fetch:async()=>{requests++;return new Response('{}');},providerFactory:definition=>createProvider({id:definition.id,models:[],auth:{apiKey:{name:'fixture',resolve:async()=>({auth:{apiKey:'marker'}})}},api:{stream:()=>{throw Error('no start');},streamSimple:()=>{throw Error('no start');},fetchDeferred:(model,_handle,options)=>{const stream=new AssistantMessageEventStream();void(async()=>{let errorMessage='unexpected admitted request';try{await options.fetch(`${definition.endpoint}/chat/completions`,{method:'POST'});}catch(error){errorMessage=error.message;}stream.push({type:'error',reason:'error',error:{role:'assistant',api:model.api,provider:model.provider,model:model.id,content:[],timestamp:Date.now(),stopReason:'error',errorMessage,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}});})();return stream;}}})});
 const definition=connections.definition({creationId:'race',name:'Race',protocol:'openai-compatible',endpoint:'https://race.invalid/v1',modelId:'race'});connections.publish({version:1,defaultModel:null,connections:[definition]});
 const result=connections.models.fetchDeferred(connections.models.getModel('race','race'),{provider:'race',modelId:'race',api:'openai-completions',id:'old-handle',data:{appCredential:{version:1,connectionId:'race',generation:1},providerData:null}});await until(()=>entered);credentials.save('race','synthetic-race-new');release();const message=await result;assert.equal(requests,0);assert.match(message.errorMessage,/旧响应凭据兼容性未确认/);
});
test('escaped credential property names in parsed tool arguments never enter SDK results or SQLite',async()=>{
 const key='SYNTHETIC-PROPERTY-CREDENTIAL',credentials=vault();credentials.save('property',key);const escaped=[...key].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const args='{'+JSON.stringify(escaped).replaceAll('\\\\u','\\u')+':"ordinary","metadata":{"keep":"ordinary metadata tool argument","role":"assistant","metadata":{"keep":"nested tool metadata"}}}';
 const event={id:'tool',object:'chat.completion.chunk',choices:[{index:0,delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'echo',arguments:args}}]},finish_reason:null}]};const body='data: '+JSON.stringify(event)+'\n\ndata: '+JSON.stringify({id:'tool',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n';assert.ok(!body.includes(key));
 const connections=new ModelConnections({credentials,fetch:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})}),definition=connections.definition({creationId:'property',name:'Property',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});connections.publish({version:1,defaultModel:null,connections:[definition]});
 const result=await connections.models.completeSimple(connections.models.getModel('property','mimo-v2.6-flash'),{messages:[],tools:[{name:'echo',description:'Synthetic',parameters:{type:'object',additionalProperties:true}}]});assert.ok(!JSON.stringify(result).includes(key));assert.ok(JSON.stringify(result).includes('ordinary metadata tool argument'));assert.ok(JSON.stringify(result).includes('nested tool metadata'));
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'models-property-')),path=join(dir,'app.sqlite'),app=new Application({path,models:connections.models,connections,workspacePath:dir});try{await app.start();await call(app,'models.create',{creationId:'property',expectedVersion:0,name:'Property',protocol:'mimo-cn',endpoint:definition.endpoint});await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'property',modelId:'mimo-v2.6-flash'}});await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'ordinary input',actionId:'one'});await until(async()=>['done','failed'].includes((await call(app,'open',{id:'chat'})).phase));await auditStorageSecret(path,key);}finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
test('disable published during final metadata wait blocks dispatch at the final synchronous boundary',async()=>{
 const credentials=vault();credentials.save('disable','synthetic-disable-key');let armed=false,entered=false,release,requests=0;const hold=new Promise(r=>release=r),metadata=credentials.metadata,resolve=credentials.resolve;
 credentials.resolve=async id=>{const value=await resolve(id);armed=true;return value;};credentials.metadata=async id=>{const value=await metadata(id);if(armed){entered=true;await hold;}return value;};
 const connections=new ModelConnections({credentials,fetch:async()=>{requests++;return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}}),definition=connections.definition({creationId:'disable',name:'Disable',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});connections.publish({version:1,defaultModel:null,connections:[definition]});const result=connections.models.completeSimple(connections.models.getModel('disable','mimo-v2.6-flash'),{messages:[]});await until(()=>entered);connections.publish({version:2,defaultModel:null,connections:[{...definition,enabled:false}]});release();await result;assert.equal(requests,0);
});
