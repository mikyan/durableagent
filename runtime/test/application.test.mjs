import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {faultDatabase} from '../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {Harness,createRegistry,defineDoc} from '@earendil-works/pi-durable';
import {openOwnedStorage} from '../dist/storage.js';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';

let sequence=0;
const call=async(app,method,payload={},connectionId='test')=>{
  const response=await app.request({protocol:1,connectionId,requestId:String(++sequence),method,payload});
  if(!response.ok)throw Object.assign(new Error(response.error.message),{code:response.error.code});
  return response.value;
};
const until=async(predicate)=>{const deadline=Date.now()+10000;while(!await predicate()){assert.ok(Date.now()<deadline,'Timed out at public Interface');await new Promise(r=>setTimeout(r,10));}};
test('two product conversations have independent durable history and stable retried creation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-app-'));
  let app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});
  try {
    await app.start();
    const first=await call(app,'create',{creationId:'first'});
    const same=await call(app,'create',{creationId:'first'});
    assert.equal(first.conversation.id,same.conversation.id);assert.equal(first.conversation.workspaceId,'default');
    const second=await call(app,'create',{creationId:'second',title:'第二个会话'});
    assert.equal((await call(app,'list')).conversations.length,2);
    assert.equal((await call(app,'history',{id:first.conversation.id})).items.length,0);
    await call(app,'send',{id:first.conversation.id,text:'甲的输入',actionId:'send-first'});
    await call(app,'send',{id:second.conversation.id,text:'乙的输入',actionId:'send-second'});
    for(const id of [first.conversation.id,second.conversation.id]) {
      const deadline=Date.now()+8000;
      while((await call(app,'open',{id})).phase!=='done') {assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
    }
    await app.close();app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});await app.start();
    const a=await call(app,'history',{id:first.conversation.id}),b=await call(app,'history',{id:second.conversation.id});
    assert.deepEqual(a.items.map(x=>x.text),['甲的输入','你好🌍']);
    assert.deepEqual(b.items.map(x=>x.text),['乙的输入','你好🌍']);
    assert.ok([...a.items,...b.items].every(x=>x.persisted));
    assert.equal((await call(app,'open',{id:second.conversation.id})).conversation.title,'第二个会话');
    assert.deepEqual((await call(app,'open',{id:first.conversation.id})).conversation.model,first.conversation.model);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('configuration gates every scheduling entry while real SDK open uses valid synchronous bootstrap settings',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-gate-'));
  let release;const loaded=new Promise(resolve=>release=resolve);let modelRequests=0;const getterPhases=[];
  const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>modelRequests++}),loadConfiguration:()=>loaded,bootstrapSettings:()=>{getterPhases.push(app.status().phase);return {retry:{enabled:false,maxRetries:0,baseDelayMs:1}};}});
  try {
    await assert.rejects(call(app,'create',{creationId:'too-early'}),{code:'HOST_NOT_READY'});
    const starting=app.start();await until(()=>app.status().phase==='configuring');
    assert.ok(getterPhases.includes('opening'),'Actual Harness.open must read bootstrap settings before returning');
    for(const method of ['create','send','stop'])await assert.rejects(call(app,method,{id:'anything',creationId:'unready',text:'unready',actionId:'unready'}),{code:'CONFIG_LOADING'});
    const mismatch=await app.request({protocol:99,connectionId:'test',requestId:'version',method:'send',payload:{id:'x',text:'x',actionId:'x'}});
    assert.equal(mismatch.ok,false);assert.equal(mismatch.error.code,'PROTOCOL_MISMATCH');assert.equal(modelRequests,0);
    release();await starting;assert.equal(app.status().phase,'ready');
    assert.ok((await call(app,'create',{creationId:'allowed'})).conversation.id);
  }finally{release();await app.close();await rm(directory,{recursive:true,force:true});}
});
test('unsubscribe detaches UI only; full snapshot reconnect restores completed durable history',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-watch-'));const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});
  try {
    await app.start();const {conversation}=await call(app,'create',{creationId:'observed'});const events=[];
    const request={protocol:1,connectionId:'page-one',requestId:'watch',method:'subscribe',payload:{id:conversation.id,subscriptionId:'active'}};
    const initial=await app.request(request,event=>events.push(event));assert.equal(initial.ok,true);assert.equal(initial.value.entries.length,0);
    await call(app,'send',{id:conversation.id,text:'观察后离开',actionId:'observation-input'});
    await until(()=>events.some(event=>event.snapshot.progress?.text));
    assert.equal(events.find(event=>event.snapshot.progress).snapshot.progress.persisted,false);
    await app.disconnect('page-one');const count=events.length;
    await until(async()=>(await call(app,'open',{id:conversation.id})).phase==='done');
    assert.equal(events.length,count);
    const reconnected=await app.request({...request,connectionId:'page-two'},()=>{});
    assert.equal(reconnected.ok,true);assert.deepEqual(reconnected.value.entries.map(x=>x.text),['观察后离开','你好🌍']);
    assert.equal(reconnected.value.progress,undefined);
    assert.equal((await call(app,'list')).conversations.length,1);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('history paging recovers entries older than the live window without mixing conversations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-history-'));const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});
  try {
    await app.start();const {conversation}=await call(app,'create',{creationId:'long'});
    for(let i=0;i<30;i++){await call(app,'send',{id:conversation.id,text:`输入${i}`,actionId:`input-${i}`});await until(async()=>(await call(app,'open',{id:conversation.id})).phase==='done');}
    const other=(await call(app,'create',{creationId:'other'})).conversation;
    let cursor,firstCursor;const messages=[];
    do {const page=await call(app,'history',{id:conversation.id,cursor,limit:7});messages.unshift(...page.items);cursor=page.next;firstCursor??=cursor;}while(cursor);
    assert.equal(messages.length,60);assert.equal(new Set(messages.map(x=>x.id)).size,60);
    assert.deepEqual(messages.filter(x=>x.role==='user').map(x=>x.text),Array.from({length:30},(_,i)=>`输入${i}`));
    await assert.rejects(call(app,'history',{id:other.id,cursor:firstCursor}),{code:'INVALID_CURSOR'});
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('explicit stop aborts the active model while retaining accepted input',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-stop-'));let requested=false,aborted=false;
  const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({hang:true,requested:()=>requested=true,aborted:()=>aborted=true})});
  try {
    await app.start();const {conversation}=await call(app,'create',{creationId:'stop'});
    await call(app,'send',{id:conversation.id,text:'等待停止',actionId:'hang'});await until(()=>requested);
    await assert.rejects(call(app,'stop',{id:conversation.id}),{code:'INVALID_ARGUMENT'});assert.equal(aborted,false);
    const stopped=await call(app,'stop',{id:conversation.id,actionId:'stop-action'});assert.equal(stopped.status,'stopped');assert.ok(aborted);
    assert.equal((await call(app,'open',{id:conversation.id})).phase,'stopped');
    assert.ok((await call(app,'history',{id:conversation.id})).items.some(x=>x.text==='等待停止'));
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('start during close waits for the prior writable Session to release ownership',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-cycle-'));const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});
  try {await app.start();await call(app,'create',{creationId:'cycle'});const closing=app.close();const opening=app.start();await Promise.all([closing,opening]);assert.equal(app.status().phase,'ready');assert.equal((await call(app,'list')).conversations.length,1);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('failed atomic creation closes the application gate and retry after reopen finds no half conversation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-create-fault-')),path=join(directory,'app.sqlite');
  const {db,control}=await faultDatabase(path);const storage=await SqliteStorage.open(db);
  let app=new Application({path,...validationConfiguration(),storageFactory:async()=>storage});
  try {
    await app.start();control.before=sql=>{if(sql==='COMMIT')throw new Error('Injected failed creation COMMIT');};
    await assert.rejects(call(app,'create',{creationId:'atomic'}),/Injected failed creation/);
    await until(()=>app.status().phase==='failed');
    await assert.rejects(call(app,'send',{id:'atomic',text:'must not schedule',actionId:'blocked'}),{code:'STORAGE_UNAVAILABLE'});
    await app.close();control.before=()=>{};
    app=new Application({path,...validationConfiguration()});await app.start();
    assert.deepEqual((await call(app,'list')).conversations,[]);
    const results=await Promise.all(Array.from({length:5},()=>call(app,'create',{creationId:'atomic'})));
    assert.equal(new Set(results.map(x=>x.conversation.id)).size,1);
    assert.equal((await call(app,'list')).conversations.length,1);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('SDK conversations without explicit product registration never enter the product list',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-internal-')),path=join(directory,'app.sqlite');const config=validationConfiguration();
  const owned=await openOwnedStorage(path);const seed=await Harness.open(owned.storage,{models:config.models,registry:createRegistry()},context);
  await seed.createConversation({ownership:{kind:'ownerless'},agent:{model:config.initialModel}},context);await seed.close(context);
  const app=new Application({path,...config});
  try {await app.start();assert.deepEqual((await call(app,'list')).conversations,[]);await call(app,'create',{creationId:'product'});assert.equal((await call(app,'list')).conversations.length,1);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('actual SDK retry and terminal provider error project waiting and failed states',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-status-'));
  const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({failFirst:10}),bootstrapSettings:()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:300}})});
  try {
    await app.start();await call(app,'create',{creationId:'retry'});const phases=[];
    await app.request({protocol:1,connectionId:'retry-ui',requestId:'subscribe',method:'subscribe',payload:{id:'retry',subscriptionId:'retry'}},event=>phases.push(event.snapshot.phase));
    await call(app,'send',{id:'retry',text:'失败可见',actionId:'retry-input'});
    await until(async()=>(await call(app,'open',{id:'retry'})).phase==='failed');
    assert.ok(phases.includes('waiting'),JSON.stringify(phases));assert.ok(phases.includes('running'));assert.ok(phases.includes('failed'));
    assert.match((await call(app,'open',{id:'retry'})).reason,/Injected provider unavailable/);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('disconnect and unsubscribe invalidate a subscription whose attachment is still pending',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-pending-watch-'));const app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration()});
  try {
    await app.start();await call(app,'create',{creationId:'pending'});const events=[];
    const req={protocol:1,connectionId:'departed',requestId:'watch',method:'subscribe',payload:{id:'pending',subscriptionId:'s'}};
    const pending=app.request(req,event=>events.push(event));await app.disconnect('departed');await pending;
    const pending2=app.request({...req,connectionId:'unsubscribed'},event=>events.push(event));await call(app,'unsubscribe',{subscriptionId:'s'},'unsubscribed');await pending2;
    await call(app,'send',{id:'pending',text:'无旧订阅',actionId:'pending-input'});await until(async()=>(await call(app,'open',{id:'pending'})).phase==='done');assert.deepEqual(events,[]);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('a fatal SQLite error tells attached UI the run failed instead of leaving a stale status',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-ui-failure-')),path=join(directory,'app.sqlite');const {db,control}=await faultDatabase(path);const storage=await SqliteStorage.open(db);
  const app=new Application({path,...validationConfiguration(),storageFactory:async()=>storage});
  try {
    await app.start();await call(app,'create',{creationId:'existing'});const events=[];
    await app.request({protocol:1,connectionId:'ui',requestId:'watch',method:'subscribe',payload:{id:'existing',subscriptionId:'s'}},event=>events.push(event));
    control.before=sql=>{if(sql==='COMMIT')throw new Error('Injected disk unavailable');};await assert.rejects(call(app,'create',{creationId:'failure'}));
    await until(()=>events.some(event=>event.snapshot.phase==='failed'));assert.match(events.at(-1).snapshot.reason,/Injected disk unavailable/);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('newer persisted configuration refuses startup and preserves its original data',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-config-version-')),path=join(directory,'app.sqlite'),config=validationConfiguration();
  const NewConfiguration=defineDoc({kind:'app.configuration',version:2,scope:'session',initial:()=>({marker:'newer-version-data'}),checkpointWhen:()=>false});
  let owner=await openOwnedStorage(path);let seed=await Harness.open(owner.storage,{models:config.models,registry:createRegistry()},context);await seed.commit(async tx=>{await tx.doc(NewConfiguration);},context);await seed.close(context);
  const app=new Application({path,...config});
  try {await assert.rejects(app.start());assert.equal(app.status().phase,'failed');assert.ok(app.status().reason);await app.close();owner=await openOwnedStorage(path);seed=await Harness.open(owner.storage,{models:config.models,registry:createRegistry()},context);assert.equal((await seed.snapshot(NewConfiguration,context)).marker,'newer-version-data');await seed.close(context);}finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
test('a due persisted retry stays dormant until reopened configuration is ready',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'durable-retry-gate-')),path=join(directory,'app.sqlite');
  let app=new Application({path,...validationConfiguration({failFirst:1}),bootstrapSettings:()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:300}})});
  let release;const loaded=new Promise(resolve=>release=resolve);let requests=0;
  try {
    await app.start();await call(app,'create',{creationId:'sleeping'});await call(app,'send',{id:'sleeping',text:'重开后继续',actionId:'sleep-input'});await until(async()=>(await call(app,'open',{id:'sleeping'})).phase==='waiting');await app.close();
    app=new Application({path,...validationConfiguration({requested:()=>requests++}),loadConfiguration:()=>loaded});const starting=app.start();await until(()=>app.status().phase==='configuring');await new Promise(resolve=>setTimeout(resolve,400));assert.equal(requests,0);
    await assert.rejects(call(app,'send',{id:'sleeping',text:'不得提前唤醒',actionId:'sleep-input'}),{code:'CONFIG_LOADING'});release();await starting;await until(async()=>(await call(app,'open',{id:'sleeping'})).phase==='done');assert.equal(requests,1);assert.equal((await call(app,'history',{id:'sleeping'})).items.filter(x=>x.role==='user').length,1);
  }finally{release();await app.close();await rm(directory,{recursive:true,force:true});}
});
