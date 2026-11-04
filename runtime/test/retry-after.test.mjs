import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../validation/application-fixture.mjs';
import {ModelConnections} from '../dist/model-connections.js';
import {openOwnedStorage} from '../dist/storage.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async fn=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end,'Public recovery state timed out');await sleep(10);}};
const answer=()=>new Response('data: '+JSON.stringify({id:'rate-limit',choices:[{index:0,delta:{content:'same input completed'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'rate-limit',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
async function fixture(header,hooks={}){
 const directory=await mkdtemp(join(tmpdir(),'retry-after-'));let app,timer,closed=false,deadline=0;const requests=[];
 const call=async(method,payload={})=>{const r=await app.request({protocol:1,connectionId:'test',requestId:crypto.randomUUID(),method,payload});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 const open=async()=>{closed=false;const connections=new ModelConnections({credentials:{metadata:async id=>({connectionId:id,state:'configured',configured:true,generation:1}),resolve:async()=>{await hooks.credential?.();return {key:'synthetic-retry-after-secret',generation:1};}},fetch:async request=>{
  const now=Date.now();requests.push({at:now,url:request.url,body:await request.json()});await hooks.beforeResponse?.(requests.length);
  const overridden=hooks.response?.(requests.length);if(overridden)return overridden;
  if(requests.length===(hooks.rateAt??1)||hooks.repeated){const value=header(now);deadline=value.deadline;return new Response(JSON.stringify({error:{message:'Rate limit exceeded',type:'rate_limit_error'}}),{status:429,headers:{'content-type':'application/json','retry-after':value.header}});}return answer();
 }});
 app=new Application({path:join(directory,'sdk.sqlite'),...(hooks.settings?{bootstrapSettings:()=>hooks.settings}:{}),...(hooks.beforeCommit?{storageFactory:async()=>{const {storage}=await openOwnedStorage(join(directory,'sdk.sqlite'));return new Proxy(storage,{get(target,key){if(key==='commit')return async(...args)=>{await hooks.beforeCommit(args[0]);return target.commit(...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}}:{}),models:connections.models,connections,workspacePath:'/retry-after',recovery:{conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async wake=>{clearTimeout(timer);if(wake.at!==undefined&&!closed)timer=setTimeout(()=>{if(!closed)void app.wake();},Math.max(1,Math.min(2147483647,wake.at-Date.now())));}}});await app.start();};
 const close=async()=>{closed=true;clearTimeout(timer);await app.close();};
 await open();await call('models.create',{creationId:'rate-provider',expectedVersion:0,name:'rate',protocol:'openai-compatible',endpoint:'https://synthetic.invalid/v1',modelId:'test'});await call('models.setDefault',{expectedVersion:1,selection:{provider:'rate-provider',modelId:'test'}});await call('create',{creationId:'chat'});
 return {call,requests,get deadline(){return deadline;},async reopen(){await close();await open();},async clean(){await close();await rm(directory,{recursive:true,force:true});}};
}
for(const kind of ['seconds','http-date'])test(`Retry-After ${kind} survives owner reopen and preserves the original SDK work`,async()=>{
 const f=await fixture(now=>kind==='seconds'?{header:'3',deadline:now+3000}:{header:new Date(Math.ceil((now+3000)/1000)*1000).toUTCString(),deadline:Math.ceil((now+3000)/1000)*1000});
 try{
  const original=await f.call('send',{id:'chat',actionId:'one-input',text:'one original input'});
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');
  const waiting=await f.call('open',{id:'chat'});assert.ok(waiting.recovery.nextAt>=f.deadline,'Visible wait must respect the server deadline');assert.equal(waiting.recovery.used,1);
  await f.reopen();
  while(Date.now()<f.deadline-80){assert.equal(f.requests.length,1);await sleep(25);}
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='done');
  assert.equal(f.requests.length,2);assert.ok(f.requests[1].at>=f.deadline,'No early retry');
  assert.deepEqual((await f.call('sendStatus',{intentId:'one-input'})).receipt,original.receipt);
  assert.equal((await f.call('history',{id:'chat'})).items.filter(x=>x.role==='user').length,1);
 }finally{await f.clean();}
});
test('Stop cancels an active Retry-After wait and expiry never revives the original input',async()=>{
 const f=await fixture(now=>({header:'3',deadline:now+3000}));try{
  await f.call('send',{id:'chat',actionId:'stop-input',text:'stop the held input'});
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');await sleep(1200);
  assert.equal(f.requests.length,1,'Provider wait must remain behind Retry-After');
  await f.call('stop',{id:'chat',actionId:'stop-action'});await f.reopen();await sleep(Math.max(0,f.deadline-Date.now()+100));
  assert.equal(f.requests.length,1);assert.equal((await f.call('open',{id:'chat'})).phase,'stopped');
 }finally{await f.clean();}
});

test('a concurrent response extending the deadline during credential resolution cannot leak an early HTTP request',async()=>{
 let resolved=0,releaseCredential,releaseResponse;
 const credentialBarrier=new Promise(resolve=>releaseCredential=resolve),responseBarrier=new Promise(resolve=>releaseResponse=resolve);
 const f=await fixture(now=>({header:'3',deadline:now+3000}),{credential:async()=>{if(++resolved===2)await credentialBarrier;},beforeResponse:async count=>{if(count===1)await responseBarrier;}});
 try{
  await f.call('send',{id:'chat',actionId:'first',text:'first concurrent input'});await until(()=>f.requests.length===1);
  await f.call('create',{creationId:'second'});await f.call('send',{id:'second',actionId:'second',text:'second concurrent input'});await until(()=>resolved===2);
  releaseResponse();await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');releaseCredential();
  while(Date.now()<f.deadline-80){assert.equal(f.requests.length,1);await sleep(25);}
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='done'&&(await f.call('open',{id:'second'})).phase==='done');
  assert.equal(f.requests.length,3);assert.ok(f.requests.slice(1).every(item=>item.at>=f.deadline));
  const history=(await f.call('history',{id:'second'})).items;assert.equal(history.filter(item=>item.role==='user').length,1);assert.equal(history.filter(item=>item.role==='assistant').length,1,'A pre-dispatch wait is not a model error or retry');
 }finally{releaseResponse();releaseCredential();await f.clean();}
});
test('a normal SDK retry can select an independent connection while the old connection remains limited',async()=>{
 const f=await fixture(now=>({header:'120',deadline:now+120000}));try{
  const original=await f.call('send',{id:'chat',actionId:'original-route',text:'one original input'});await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');
  await f.call('models.create',{creationId:'other-provider',expectedVersion:2,name:'other',protocol:'openai-compatible',endpoint:'https://other.invalid/v1',modelId:'test'});
  await f.call('models.select',{id:'chat',selection:{provider:'other-provider',modelId:'test'}});
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='done');assert.equal(f.requests.length,2);assert.ok(f.requests[1].at<f.deadline);assert.equal(f.requests[1].url,'https://other.invalid/v1/chat/completions');
  assert.deepEqual((await f.call('sendStatus',{intentId:'original-route'})).receipt,original.receipt);
 }finally{await f.clean();}
});

test('repeated rate limits keep the original durable SDK retry budget across owner reopen',async()=>{
 const f=await fixture(now=>({header:'1',deadline:now+1000}),{repeated:true});try{
  const original=await f.call('send',{id:'chat',actionId:'bounded-input',text:'bounded original input'});await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');await f.reopen();
  await until(async()=>(await f.call('open',{id:'chat'})).phase==='failed');assert.equal(f.requests.length,4,'One initial request and the existing three SDK retries');
  assert.deepEqual((await f.call('sendStatus',{intentId:'bounded-input'})).receipt,original.receipt);
  await f.reopen();await sleep(1100);assert.equal(f.requests.length,4,'Reopen must not replenish the exhausted SDK budget');
  assert.equal((await f.call('history',{id:'chat'})).items.filter(item=>item.role==='user').length,1);
 }finally{await f.clean();}
});

test('an observed deadline fences concurrent dispatch before its SQLite commit finishes',async()=>{
 let resolved=0,commitHeld=false,releaseCredential,releaseResponse,releaseCommit;
 const credentialBarrier=new Promise(resolve=>releaseCredential=resolve),responseBarrier=new Promise(resolve=>releaseResponse=resolve),commitBarrier=new Promise(resolve=>releaseCommit=resolve);
 const f=await fixture(now=>({header:'3',deadline:now+3000}),{credential:async()=>{if(++resolved===2)await credentialBarrier;},beforeResponse:async n=>{if(n===1)await responseBarrier;},beforeCommit:async batches=>{if(JSON.stringify(batches).includes('app.model-retry-after')){commitHeld=true;await commitBarrier;}}});
 try{
  await f.call('send',{id:'chat',actionId:'first',text:'first concurrent input'});await until(()=>f.requests.length===1);
  await f.call('create',{creationId:'second'});await f.call('send',{id:'second',actionId:'second',text:'second concurrent input'});await until(()=>resolved===2);releaseResponse();await until(()=>commitHeld);releaseCredential();await sleep(150);
  assert.equal(f.requests.length,1,'Observed Retry-After must fence dispatch while its durable commit is in flight');
 }finally{releaseCommit();releaseResponse();releaseCredential();await f.clean();}
});
test('selection changes cannot hide the deadline of an already-prepared request on the original connection',async()=>{
 const f=await fixture(now=>({header:'120',deadline:now+120000}));try{
  await f.call('send',{id:'chat',actionId:'prepared-route',text:'one prepared input'});await until(async()=>(await f.call('open',{id:'chat'})).phase==='waiting');await sleep(1200);
  await f.call('models.create',{creationId:'other-provider',expectedVersion:2,name:'other',protocol:'openai-compatible',endpoint:'https://other.invalid/v1',modelId:'test'});await f.call('models.select',{id:'chat',selection:{provider:'other-provider',modelId:'test'}});
  const waiting=await f.call('open',{id:'chat'});assert.equal(waiting.phase,'waiting');assert.ok(waiting.recovery.nextAt>=f.deadline);assert.equal(f.requests.length,1);
  await f.call('stop',{id:'chat',actionId:'stop-prepared'});
 }finally{await f.clean();}
});

test('overflow compaction keeps its actual Retry-After wait visible without a generation projection',async()=>{
 const f=await fixture(now=>({header:'120',deadline:now+120000}),{rateAt:3,settings:{retry:{enabled:true,maxRetries:3,baseDelayMs:1000},stream:{maxRetries:0},compaction:{enabled:true,keepRecentTokens:1,reserveTokens:1024,backgroundTokens:0}},response:n=>n===2?new Response(JSON.stringify({error:{message:'context_length_exceeded'}}),{status:400,headers:{'content-type':'application/json'}}):undefined});
 try{
  await f.call('send',{id:'chat',actionId:'seed',text:'seed previous context'});await until(async()=>(await f.call('open',{id:'chat'})).phase==='done');
  await f.call('send',{id:'chat',actionId:'overflow',text:'the next context now needs compaction'});await until(()=>f.requests.length>=3);await sleep(1200);
  assert.ok(f.requests[2].body.messages.some(item=>typeof item.content==='string'&&item.content.includes('You are a context summarization assistant.')),'The limited request is the actual SDK compaction');
  const waiting=await f.call('open',{id:'chat'});assert.equal(waiting.phase,'waiting');assert.ok(waiting.recovery.nextAt>=f.deadline);assert.equal(waiting.recovery.used,2);assert.equal(f.requests.length,3);
  await f.call('stop',{id:'chat',actionId:'stop-compaction'});
 }finally{await f.clean();}
});
