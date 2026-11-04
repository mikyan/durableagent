import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createSession,defineDoc,defineDocFamily,Harness,createRegistry} from '@earendil-works/pi-durable';
import {openOwnedStorage} from '../dist/storage.js';
import {Configuration} from '../dist/application-records.js';
import {Application} from '../validation/application-fixture.mjs';
import {validationConfiguration} from '../dist/application-validation.js';
import {faultDatabase} from '../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';

// Shared policy runs on desktop Node and Android Javet with the same actual SDK/SQLite Interfaces.
export function retentionChecks(tempRoot=tmpdir()) {
const cases=[];const test=(name,run)=>cases.push({name,run});
// A fixed previous app document written through the SDK, never its private SQLite schema.
const LegacyConfiguration=defineDoc({kind:'app.configuration',version:1,scope:'session',initial:()=>({initialized:true,defaultModel:{provider:'retained-provider',modelId:'retained-model',name:'Existing choice'},workspace:{id:'default',path:'/retained/workspace'}}),checkpointWhen:()=>false});
test('a typed old configuration read does not publish migration; a failed migration commit leaves old values and history readable',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-retention-'));let session;
  try {
    let owned=await openOwnedStorage(join(directory,'app.sqlite'));session=createSession(owned.storage);
    const entry=await session.commit(async tx=>{await tx.doc(LegacyConfiguration);const conversation=await tx.createConversation({ownership:{kind:'ownerless'}});return tx.appendEntry(conversation.id,{kind:'retention-fixture',data:{text:'original formal history'}});},context);
    await session.close(context);
    owned=await openOwnedStorage(join(directory,'app.sqlite'));session=createSession(owned.storage);
    const migrated=await session.snapshot(Configuration,context);
    assert.equal(migrated.dataPolicy,'local-required-v1');
    assert.equal(migrated.workspace.path,'/retained/workspace');
    assert.equal((await session.snapshot(LegacyConfiguration,context)).defaultModel.provider,'retained-provider');
    await assert.rejects(session.commit(async tx=>{await tx.doc(Configuration);throw new Error('injected interrupted upgrade');},context),/interrupted upgrade/);
    await session.close(context);
    owned=await openOwnedStorage(join(directory,'app.sqlite'));session=createSession(owned.storage);
    assert.equal((await session.snapshot(LegacyConfiguration,context)).workspace.path,'/retained/workspace');
    assert.equal((await owned.storage.entry(entry.id,context)).entry.data.text,'original formal history');
    await session.commit(async tx=>{await tx.doc(Configuration);},context);
    await session.close(context);
    owned=await openOwnedStorage(join(directory,'app.sqlite'));session=createSession(owned.storage);
    assert.equal((await session.snapshot(Configuration,context)).defaultModel.modelId,'retained-model');
    await assert.rejects(session.snapshot(LegacyConfiguration,context),/version|migrat/i);
    assert.equal((await owned.storage.entry(entry.id,context)).entry.data.text,'original formal history');
  }finally{await session?.close(context);await rm(directory,{recursive:true,force:true});}
});

test('actual SDK compaction and a fork retain original history through SQLite reopen',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-history-retention-'));const path=join(directory,'app.sqlite');const config=validationConfiguration();let harness;
  try {
    let owned=await openOwnedStorage(path);harness=await Harness.open(owned.storage,{models:config.models,registry:createRegistry()},context);
    const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'fixture',modelId:'conversation'}}},context);
    await (await conversation.submit({type:'input',requestId:'retained-once',content:'Original history must survive compaction'},context)).wait(context);
    const before=await conversation.entries({order:'ascending'},50,undefined,context);assert.ok(before.items.length>=2);
    const task=await conversation.compact('Summarize briefly; retain the original transcript.',context);await harness.waitForTask(task,context);await conversation.waitForIdle(context);
    const after=await conversation.entries({order:'ascending'},50,undefined,context);for(const entry of before.items)assert.ok(after.items.some(value=>value.id===entry.id));
    const fork=await conversation.fork(before.items.at(-1).id,{ownership:{kind:'ownerless'}},context);const parentId=conversation.id,childId=fork.id;
    await harness.close(context);owned=await openOwnedStorage(path);harness=await Harness.open(owned.storage,{models:config.models,registry:createRegistry()},context);
    for(const id of [parentId,childId]){const reopened=await harness.conversation(id,context);const history=await reopened.entries({order:'ascending'},50,undefined,context);for(const entry of before.items)assert.ok(history.items.some(value=>value.id===entry.id));}
  }finally{await harness?.close(context);await rm(directory,{recursive:true,force:true});}
});

test('an unvisited future admission record blocks startup before dispatch and remains readable by its owner',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-dormant-version-'));const path=join(directory,'app.sqlite');let requests=0;
  const FutureAdmission=defineDocFamily({kind:'app.admission',version:2,scope:'session',family:true,initial:()=>({receipt:null,unknownEvidence:'must-retain'}),checkpointWhen:()=>false});
  const owned=await openOwnedStorage(path);let session=createSession(owned.storage);await session.commit(async tx=>{await tx.doc(FutureAdmission,'old-unvisited-send',null);},context);await session.close(context);
  const app=new Application({path,...validationConfiguration({requested:()=>requests++})});
  try {
    await assert.rejects(app.start());assert.equal(app.status().failure?.code,'STORAGE_VERSION_UNSUPPORTED');assert.equal(requests,0);
    await app.close();const reopened=await openOwnedStorage(path);session=createSession(reopened.storage);
    assert.equal((await session.snapshot(FutureAdmission,'old-unvisited-send',context)).unknownEvidence,'must-retain');await session.close(context);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('compatible retained history stays readable while an unrelated future record keeps every execution action closed',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-readonly-'));const path=join(directory,'app.sqlite');let app=new Application({path,...validationConfiguration()});let seq=0;
  const call=(method,payload={})=>app.request({protocol:1,connectionId:'read-only',requestId:String(++seq),method,payload});
  try {
    await app.start();const created=await call('create',{creationId:'kept',title:'My retained history'});const id=created.value.conversation.id;
    await call('send',{id,actionId:'already-sent',text:'Original retained input'});
    const deadline=Date.now()+5000;while((await call('open',{id})).value.phase!=='done'){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
    await app.close();
    const owned=await openOwnedStorage(path);const session=createSession(owned.storage);
    const unknown=defineDoc({kind:'app.future-effect-ledger',version:1,scope:'session',initial:()=>({unknownEffect:'retain-blocker'}),checkpointWhen:()=>false});
    await session.commit(async tx=>{await tx.doc(unknown);},context);await session.close(context);
    app=new Application({path,...validationConfiguration({requested:()=>assert.fail('Read-only history must never dispatch a model')})});
    await assert.rejects(app.start());assert.equal(app.status().readOnly,true);
    assert.equal((await call('list')).value.conversations[0].title,'My retained history');
    assert.deepEqual((await call('history',{id})).value.items.map(item=>item.text),['Original retained input','你好🌍']);
    assert.equal((await call('send',{id,actionId:'never-send',text:'must stay local'})).ok,false);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('a malformed current record is not mistaken for an uninitialized installation',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-invalid-format-'));const path=join(directory,'app.sqlite');
  const malformed=defineDoc({kind:'app.configuration',version:2,scope:'session',initial:()=>({unknownOriginal:'preserve-me'}),checkpointWhen:()=>false});
  const owned=await openOwnedStorage(path);let session=createSession(owned.storage);await session.commit(async tx=>{await tx.doc(malformed);},context);await session.close(context);
  const app=new Application({path,...validationConfiguration()});
  try{await assert.rejects(app.start());assert.equal(app.status().failure?.code,'STORAGE_MIGRATION_FAILED');await app.close();const reader=await openOwnedStorage(path);session=createSession(reader.storage);assert.deepEqual(await session.snapshot(malformed,context),{unknownOriginal:'preserve-me'});await session.close(context);}
  finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('actual SDK SQLite capacity failure leaves a saved intent and existing conversation readable on reopen',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-full-'));const path=join(directory,'app.sqlite');
  const {db}=await faultDatabase(path);let app=new Application({path,...validationConfiguration(),storageFactory:()=>SqliteStorage.open(db)});let sequence=0;
  const call=(method,payload)=>app.request({protocol:1,connectionId:'capacity',requestId:String(++sequence),method,payload});
  try {
    await app.start();const created=await call('create',{creationId:'retained-conversation',title:'Keep this conversation'});assert.equal(created.ok,true);const id=created.value.conversation.id;
    const pages=await db.get('PRAGMA page_count');await db.exec(`PRAGMA max_page_count=${pages.page_count}`);
    const failed=await call('send',{id,actionId:'capacity-send-once',text:'capacity evidence '.repeat(5000)});
    assert.equal(failed.ok,false);assert.equal(failed.error.code,'STORAGE_CAPACITY',JSON.stringify(failed));
    assert.match(failed.error.message,/保留/);
    await app.close();app=new Application({path,...validationConfiguration()});
    // Stop the retained intent before reopening: migration/recovery must not resurrect it.
    app.native.reopen();await app.native.stop(id,'explicit-stop-after-full');
    await app.start();const list=await call('list',{});assert.equal(list.ok,true);assert.equal(list.value.conversations[0].title,'Keep this conversation');
    const sends=await app.native.listSends({id});assert.equal(sends.intents.length,1);assert.equal(sends.intents[0].intentId,'capacity-send-once');assert.equal(sends.intents[0].cancelled,true);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

test('a newer application record closes dispatch without resetting its data and exposes an actionable storage status',async()=>{
  const directory=await mkdtemp(join(tempRoot,'durable-future-'));const path=join(directory,'app.sqlite');let requests=0;
  const FutureConfiguration=defineDoc({kind:'app.configuration',version:3,scope:'session',initial:()=>({initialized:true,defaultModel:null,workspace:{id:'future-workspace',path:'/future/retained'},futureMarker:'unique-new-version-data'}),checkpointWhen:()=>false});
  const owned=await openOwnedStorage(path);const session=createSession(owned.storage);
  await session.commit(async tx=>{await tx.doc(FutureConfiguration);},context);await session.close(context);
  const app=new Application({path,...validationConfiguration({requested:()=>requests++})});
  try {
    await assert.rejects(app.start());
    assert.equal(app.status().failure?.code,'STORAGE_VERSION_UNSUPPORTED');
    assert.match(app.status().reason,/版本.*保留|保留.*版本/);
    const response=await app.request({protocol:1,connectionId:'retention',requestId:'send',method:'send',payload:{intentId:'old-intent'}});
    assert.equal(response.ok,false);assert.equal(requests,0);
    await app.close();
    const reopened=await openOwnedStorage(path);const reader=createSession(reopened.storage);
    try{assert.equal((await reader.snapshot(FutureConfiguration,context)).futureMarker,'unique-new-version-data');}finally{await reader.close(context);}
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});

return cases;
}
export async function runRetentionPolicyChecks(report,{tempRoot}={}) {
 for(const check of retentionChecks(tempRoot)) {
  const started=performance.now();
  try{await check.run();report({name:check.name,passed:true,durationMs:Math.round(performance.now()-started)});}
  catch(error){report({name:check.name,passed:false,error:String(error.message??error)});throw error;}
 }
}
