import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../validation/application-fixture.mjs';
import {validationConfiguration} from '../dist/application-validation.js';
import {createModels,createProvider} from '@earendil-works/pi-ai/models';
import {AssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';

const until=async(condition,label)=>{const end=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<end,label);await new Promise(resolve=>setTimeout(resolve,10));}};
let sequence=0;
async function call(app,method,payload={}){const result=await app.request({protocol:1,connectionId:'recovery-test',requestId:String(++sequence),method,payload});if(!result.ok)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.value;}
function platform(initial={network:'available',userUnlocked:true}){
 let current={...initial};const listeners=new Set();const wakes=[];
 return {conditions:async()=>({...current}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},publishWake:async wake=>{wakes.push({...wake});},change:patch=>{current={...current,...patch};for(const listener of listeners)listener();},wakes};
}
test('offline model work waits visibly and continues the same saved input when conditions return',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'durable-recovery-'));let requests=0;const host=platform({network:'offline',userUnlocked:true});
 const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>requests++}),recovery:host});
 try{
  await app.start();await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'one saved input',actionId:'original'});
  await until(async()=>requests>0||(await call(app,'open',{id:'chat'})).recovery?.reason==='network-offline','Waiting projection');
  assert.equal(requests,0,'No model transport while Android reports offline');
  const waiting=await call(app,'open',{id:'chat'});assert.equal(waiting.phase,'waiting');assert.equal(waiting.recovery.reason,'network-offline');
  host.change({network:'available'});await until(async()=>(await call(app,'open',{id:'chat'})).phase==='done','Same work resumes');
  assert.equal(requests,1);assert.deepEqual((await call(app,'history',{id:'chat'})).items.filter(entry=>entry.role==='user').map(entry=>entry.text),['one saved input']);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('a durable SDK retry uses the same epoch after close and repeated early host wake cannot duplicate it',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'durable-wake-')),path=join(directory,'app.sqlite');let clock=Date.now(),requests=0;
 const host=platform();host.now=()=>clock;const options={path,...validationConfiguration({failFirst:1,requested:()=>requests++}),recovery:host,bootstrapSettings:()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:1000}})};
 let app=new Application(options);
 try{
  await app.start();await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'one sleeping input',actionId:'one'});
  await until(async()=>(await call(app,'open',{id:'chat'})).phase==='waiting','SDK persists retry');
  assert.equal(requests,1);await until(()=>host.wakes.some(wake=>Number.isFinite(wake.at)),'Native wake hint');
  const deadline=host.wakes.findLast(wake=>Number.isFinite(wake.at)).at;assert.ok(deadline>clock);
  await app.close();clock-=2000;app=new Application(options);await app.start();
  await app.wake();await app.wake();assert.equal(requests,1);
  clock=deadline-1;await app.wake();assert.equal(requests,1);
  clock=deadline+1;await app.wake();await app.wake();await until(async()=>(await call(app,'open',{id:'chat'})).phase==='done','Due retry resumes');
  assert.equal(requests,2);assert.equal((await call(app,'history',{id:'chat'})).items.filter(entry=>entry.role==='user').length,1);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('first unlock is checked before SDK bootstrap and a saved stop stays stopped after network recovery',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'durable-unlock-'));let getters=0,requests=0;const host=platform({network:'offline',userUnlocked:false});
 const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>requests++}),recovery:host,bootstrapSettings:()=>{getters++;return {retry:{enabled:false,maxRetries:0}};}});
 try{
  await assert.rejects(app.start(),{code:'HOST_LOCKED'});assert.equal(getters,0);assert.equal(requests,0);
  host.change({userUnlocked:true});await app.start();await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'stop before reconnect',actionId:'old'});
  await until(async()=>(await call(app,'open',{id:'chat'})).recovery?.reason==='network-offline','Offline wait');
  await call(app,'stop',{id:'chat',actionId:'stop'});await app.close();host.change({network:'available'});await app.start();await app.wake();
  assert.equal((await call(app,'open',{id:'chat'})).phase,'stopped');assert.equal(requests,0);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('native completion projection comes from settled input and survives reopen without creating another run',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'durable-completion-')),path=join(directory,'app.sqlite');let requests=0;const projections=[];
 const host=platform();host.publishProjection=async value=>{projections.push(structuredClone(value));};
 const options={path,...validationConfiguration({requested:()=>requests++}),recovery:host};let app=new Application(options);
 try{
  await app.start();await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'complete without an attached UI',actionId:'original'});
  await until(()=>projections.some(value=>value.completions?.length),'Native settled completion');
  const first=projections.findLast(value=>value.completions.length).completions[0];assert.equal(first.conversationId,'chat');assert.ok(first.identity);
  await call(app,'send',{id:'chat',text:'the next saved input',actionId:'second'});
  await until(()=>projections.some(value=>value.completions?.some(item=>item.identity!==first.identity)),'Latest completion wins when native lists newest first');
  const completion=projections.findLast(value=>value.completions.length).completions[0];assert.notEqual(completion.identity,first.identity);
  await app.close();projections.length=0;app=new Application(options);await app.start();await app.wake();
  await until(()=>projections.some(value=>value.completions?.length),'Completion can be reconciled after host loss');
  assert.deepEqual(projections.findLast(value=>value.completions.length).completions[0],completion);assert.equal(requests,2);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('a reopened deferred response waits for connectivity and polls the original handle without a replacement request',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'durable-deferred-recovery-')),path=join(directory,'app.sqlite');let now=Date.now(),starts=0,polls=0;
 const host=platform();host.now=()=>now;
 const model={id:'deferred',name:'Deferred validation',api:'openai-completions',provider:'deferred',baseUrl:'https://deferred.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1024};
 const message=(stopReason,extra={})=>({role:'assistant',content:[],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:now,stopReason,...extra});
 const stream=value=>{const events=new AssistantMessageEventStream();queueMicrotask(()=>events.push({type:'done',reason:value.stopReason,message:value}));return events;};
 const start=()=>{starts++;return stream(message('deferred',{deferred:{provider:'deferred',modelId:'deferred',api:model.api,id:'original-response',pollAfterMs:1000,data:{opaque:'retained'}}}));};
 const models=createModels();models.setProvider(createProvider({id:'deferred',models:[model],auth:{apiKey:{name:'controlled provider',resolve:async()=>({auth:{apiKey:'synthetic'}})}},api:{stream:start,streamSimple:start,fetchDeferred:(_model,handle)=>{assert.equal(handle.id,'original-response');polls++;return stream(message('stop',{content:[{type:'text',text:'original response complete'}]}));}}}));
 const options={path,models,workspacePath:directory,initialModel:{provider:'deferred',modelId:'deferred',name:'Deferred'},recovery:host,bootstrapSettings:()=>({retry:{enabled:false,maxRetries:0},stream:{deferred:true}})};let app=new Application(options);
 try{
  await app.start();await call(app,'create',{creationId:'chat'});await call(app,'send',{id:'chat',text:'one deferred input',actionId:'one'});
  await until(async()=>(await call(app,'open',{id:'chat'})).recovery?.reason==='deferred-poll','Durable deferred poll');
  const at=(await call(app,'open',{id:'chat'})).recovery.nextAt;await app.close();host.change({network:'offline'});now=at+1;
  app=new Application(options);await app.start();await app.wake();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(starts,1);assert.equal(polls,0);
  host.change({network:'available'});await until(async()=>(await call(app,'open',{id:'chat'})).phase==='done','Original poll resumes');assert.equal(starts,1);assert.equal(polls,1);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
