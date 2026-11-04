// Same callbacks run against real SDK/SQLite on desktop and Android. Explicit Android private temp root.
const cases=[];const test=(name,run)=>cases.push({name,run});let policyTempRoot;let running=false;
export function registerSubmissionPolicyChecks(register){for(const {name,run}of cases)register(name,run);}
export async function runSubmissionPolicyChecks(onCase,{tempRoot}={}){if(running)throw Error('Submission validation already running');running=true;policyTempRoot=tempRoot;try{for(const {name,run}of cases){try{await run();onCase({name,passed:true});}catch(error){const failure=Error(`Submission policy failed: ${name}`);failure.diagnostic={code:error.code??error.name,message:error.message,stack:error.stack};throw failure;}}}finally{running=false;policyTempRoot=undefined;}}

import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {SqliteSendAuthority} from './submission-authority.mjs';
import {Harness,createRegistry,defineDocFamily,defineDoc,GenerationTask,hook} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from '../dist/storage.js';
import {Submissions} from '../dist/submission.js';
import {faultDatabase} from '../dist/sqlite-checks.js';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
let sequence=0;
const call=async(app,method,payload={})=>{const reply=await app.request({protocol:1,connectionId:'submission-test',requestId:String(++sequence),method,payload});if(!reply.ok)throw Object.assign(Error(reply.error.message),{code:reply.error.code});return reply.value;};
const until=async(fn)=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end,'Public state timed out');await new Promise(r=>setTimeout(r,5));}};
async function fixture(options={}){const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'admission-')),native=new SqliteSendAuthority(join(dir,'input.sqlite'));let requests=0;const config=validationConfiguration({requested:()=>requests++,...options});const settings={path:join(dir,'sdk.sqlite'),...config,inputs:native,sends:native,submissionBoundary:(...args)=>settings.boundary?.(...args)};const make=()=>new Application(settings);let app=make();await app.start();return {native,settings,get app(){return app;},get requests(){return requests;},async reopen(){await app.close();app=make();await app.start();},async close(){await app.close();native.close();await rm(dir,{recursive:true,force:true});}};}
test('explicit native intent alone drives atomic SDK admission; lost ACK reconciles the same identity and preserves later draft',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'one'});f.native.save('one','unsent draft');await f.reopen();assert.equal((await f.native.listSends()).intents.length,0);assert.equal(f.requests,0);
 const intent=await f.native.create('one','fixed input','intent-one');f.native.beforeAck=()=>{throw Error('lost native ACK');};const accepted=await call(f.app,'send',{intentId:intent.intentId});assert.equal(accepted.accepted,true);assert.equal(accepted.intent.delivery,'uncertain');await until(async()=>(await call(f.app,'open',{id:'one'})).phase==='done');f.native.save('one','later draft');const before=f.requests;f.native.beforeAck=undefined;
 const same=await call(f.app,'send',{intentId:intent.intentId});assert.equal(same.receipt.submissionId,accepted.receipt.submissionId);assert.equal(same.receipt.bindingId,accepted.receipt.bindingId);assert.equal(same.acknowledgement.draftCleared,false);assert.equal(f.native.draft('one').text,'later draft');assert.equal(f.requests,before);assert.equal((await call(f.app,'history',{id:'one'})).items.filter(x=>x.role==='user').length,1);
 await f.reopen();const read=await call(f.app,'sendStatus',{intentId:intent.intentId});assert.equal(read.receipt.submissionId,same.receipt.submissionId);assert.equal(f.requests,before);
 }finally{await f.close();}
});
test('same content is a new user action; accepted identity mismatch cannot reuse its SDK request or binding',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'one'});const a=await f.native.create('one','identical','a');const first=await call(f.app,'send',{intentId:a.intentId});await until(async()=>(await call(f.app,'sendStatus',{intentId:a.intentId})).submission?.status==='done');
 const b=await f.native.create('one','identical','b');const second=await call(f.app,'send',{intentId:b.intentId});assert.notEqual(first.receipt.submissionId,second.receipt.submissionId);assert.equal(first.receipt.bindingId,second.receipt.bindingId);await until(async()=>(await call(f.app,'sendStatus',{intentId:b.intentId})).submission?.status==='done');
 assert.equal((await call(f.app,'history',{id:'one'})).items.filter(x=>x.role==='user').length,2);const changed=await f.native.readSend('a');changed.inputDigest='different';f.native.write('intent','a',changed);await assert.rejects(call(f.app,'send',{intentId:'a'}),{code:'INTENT_MISMATCH'});assert.equal(f.requests,2);
 await assert.rejects(call(f.app,'send',{id:'one',text:'bypass',actionId:'bypass'}),{code:'INVALID_ARGUMENT'});
 }finally{await f.close();}
});
test('failure after submit rolls back submission map and binding; durable commit response loss recovers only original acceptance',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'atomic'});const intent=await f.native.create('atomic','atomic input','atomic');let fault='after-sdk-submit';f.settings.boundary=stage=>{if(stage===fault)throw Error('injected boundary');};
 await assert.rejects(call(f.app,'send',{intentId:intent.intentId}),/injected boundary/);assert.equal((await call(f.app,'sendStatus',{intentId:intent.intentId})).accepted,false);assert.equal((await call(f.app,'history',{id:'atomic'})).items.length,0);assert.equal(f.requests,0);
 fault='after-sdk-commit';await assert.rejects(call(f.app,'send',{intentId:intent.intentId}),/injected boundary/);const accepted=await call(f.app,'sendStatus',{intentId:intent.intentId});assert.equal(accepted.accepted,true);assert.equal(accepted.intent.delivery,'uncertain');fault=undefined;await until(async()=>(await call(f.app,'open',{id:'atomic'})).phase==='done');const before=f.requests;
 await f.reopen();const same=await call(f.app,'sendStatus',{intentId:intent.intentId});assert.deepEqual(same.receipt,accepted.receipt);assert.equal(same.intent.delivery,'acknowledged');assert.equal(f.requests,before);assert.equal((await call(f.app,'history',{id:'atomic'})).items.filter(x=>x.role==='user').length,1);
 }finally{await f.close();}
});
test('a native stop committed during SDK admission prevents dispatch, survives reopen, and only a new explicit generation may proceed',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'stopped'});const old=await f.native.create('stopped','old','old');let stopped=false;f.settings.boundary=async stage=>{if(stage==='after-sdk-submit'&&!stopped){stopped=true;await f.native.stop('stopped','native-stop');}};
 const accepted=await call(f.app,'send',{intentId:old.intentId});assert.equal(accepted.accepted,true);assert.equal(accepted.submission.status,'unanswered');assert.equal(f.requests,0);assert.equal((await f.native.readControl('stopped')).pendingAbort,undefined);await f.reopen();assert.equal(f.requests,0);
 const replay=await call(f.app,'send',{intentId:old.intentId});assert.equal(replay.receipt.submissionId,accepted.receipt.submissionId);assert.equal(replay.intent.cancelled,true);assert.equal(f.requests,0);
 const next=await f.native.create('stopped','new explicit action','new');assert.ok(next.controlGeneration>old.controlGeneration);await call(f.app,'send',{intentId:next.intentId});await until(async()=>(await call(f.app,'open',{id:'stopped'})).phase==='done');assert.equal(f.requests,1);
 }finally{await f.close();}
});
test('a conflicting native receipt is a visible inconsistency, never a fresh or silently acknowledged submission',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'receipt'});const intent=await f.native.create('receipt','receipt integrity','receipt');await call(f.app,'send',{intentId:intent.intentId});await until(async()=>(await call(f.app,'open',{id:'receipt'})).phase==='done');const changed=await f.native.readSend(intent.intentId);changed.receipt.bindingId='different-binding';f.native.write('intent',intent.intentId,changed);await assert.rejects(call(f.app,'sendStatus',{intentId:intent.intentId}),{code:'ADMISSION_INCONSISTENT'});await assert.rejects(call(f.app,'send',{intentId:intent.intentId}),{code:'ADMISSION_INCONSISTENT'});assert.equal(f.requests,1);
 }finally{await f.close();}
});
test('missing SDK map or binding is reported without repair or redelivery of a native acknowledged intent',async()=>{
 for(const kind of ['app.admission','app.submission-binding']){const f=await fixture();try{await call(f.app,'create',{creationId:'missing'});const intent=await f.native.create('missing','original','original');const accepted=await call(f.app,'send',{intentId:intent.intentId});await until(async()=>(await call(f.app,'open',{id:'missing'})).phase==='done');await f.app.close();
 const token=defineDocFamily({kind,version:1,scope:'session',family:true,initial:()=>({}),checkpointWhen:()=>false});const h=await Harness.open((await openOwnedStorage(f.settings.path)).storage,{models:()=>f.settings.models,registry:createRegistry()},context);await h.commit(tx=>tx.retireDoc(token,kind==='app.admission'?intent.intentId:accepted.receipt.bindingId),context);await h.close(context);await f.reopen();await assert.rejects(call(f.app,'send',{intentId:intent.intentId}),{code:'ADMISSION_INCONSISTENT'});assert.equal(f.requests,1);assert.equal((await call(f.app,'history',{id:'missing'})).items.filter(x=>x.role==='user').length,1);
 }finally{await f.close();}}
});
test('unaccepted changed location refuses; accepted replay keeps original binding after the current location changes',async()=>{
 const f=await fixture();try{await call(f.app,'create',{creationId:'location'});const intent=await f.native.create('location','original','original');const changed=structuredClone(intent);changed.context.location.identity='different';f.native.write('intent',intent.intentId,changed);await assert.rejects(call(f.app,'send',{intentId:intent.intentId}),{code:'LOCATION_MISMATCH'});assert.equal(f.requests,0);f.native.write('intent',intent.intentId,intent);const accepted=await call(f.app,'send',{intentId:intent.intentId});await until(async()=>(await call(f.app,'open',{id:'location'})).phase==='done');const catalog=await call(f.app,'projects.get');await call(f.app,'workspaces.update',{operationId:'change-location',expectedVersion:catalog.version,id:'default',path:f.settings.workspacePath+'/changed-position'});await f.reopen();assert.notDeepEqual((await call(f.app,'open',{id:'location'})).conversation.submissionContext,accepted.receipt.context);const replay=await call(f.app,'send',{intentId:intent.intentId});assert.deepEqual(replay.receipt,accepted.receipt);assert.equal(f.requests,1);
 }finally{await f.close();}
});
test('persisted due work and old stop stay behind the native control startup barrier, including abort implicit resume',async()=>{
 const f=await fixture({failFirst:1});let release;try{f.settings.bootstrapSettings=()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:350}});await call(f.app,'create',{creationId:'retry'});await call(f.app,'create',{creationId:'old-stop'});const retry=await f.native.create('retry','due work','due');await call(f.app,'send',{intentId:retry.intentId});await until(async()=>(await call(f.app,'open',{id:'retry'})).phase==='waiting');await f.native.stop('old-stop','stop');await f.app.close();const original=f.native.pendingStops.bind(f.native),barrier=new Promise(resolve=>release=resolve);f.native.pendingStops=async()=>{await barrier;return original();};const opening=f.reopen();await until(()=>f.app.status().phase==='configuring');await new Promise(resolve=>setTimeout(resolve,450));assert.equal(f.requests,1);await assert.rejects(call(f.app,'send',{intentId:retry.intentId}),{code:'CONFIG_LOADING'});release();await opening;await until(async()=>(await call(f.app,'open',{id:'retry'})).phase==='done');assert.equal(f.requests,2);assert.equal((await f.native.readControl('old-stop')).pendingAbort,undefined);
 }finally{release?.();await f.close();}
});
test('native stops at either ACK edge are checked by actual dispatch, not only by the earlier admission snapshot',async()=>{
 for(const boundary of ['before-native-ack','after-native-ack']){const f=await fixture();try{await call(f.app,'create',{creationId:'ack-stop'});const intent=await f.native.create('ack-stop','must not dispatch','ack-stop');f.settings.boundary=async stage=>{if(stage===boundary)await f.native.stop('ack-stop','late-stop');};await call(f.app,'send',{intentId:intent.intentId});await until(async()=>!(await f.native.readControl('ack-stop')).pendingAbort);assert.equal(f.requests,0);assert.equal((await call(f.app,'sendStatus',{intentId:intent.intentId})).submission.status,'unanswered');
 }finally{await f.close();}}
});
test('two durable conversations dispatch concurrently without control-check starvation or mixed history',async()=>{
 const f=await fixture();try{for(const id of ['parallel-a','parallel-b'])await call(f.app,'create',{creationId:id});const intents=await Promise.all(['parallel-a','parallel-b'].map(id=>f.native.create(id,id,id)));await Promise.all(intents.map(intent=>call(f.app,'send',{intentId:intent.intentId})));await until(async()=>(await Promise.all(intents.map(intent=>call(f.app,'sendStatus',{intentId:intent.intentId})))).every(value=>value.submission?.status==='done'));assert.equal(f.requests,2);for(const intent of intents)assert.deepEqual((await call(f.app,'history',{id:intent.id})).items.filter(x=>x.role==='user').map(x=>x.text),[intent.id]);
 }finally{await f.close();}
});
test('actual SQL COMMIT failures retain an uncertain native intent; reopen inspects a whole accepted or absent transaction',async()=>{
 for(const point of ['before','after']){const f=await fixture();let armed=false;try{await call(f.app,'create',{creationId:'sql-fault'});await f.app.close();f.settings.storageFactory=async()=>{const {db,control}=await faultDatabase(f.settings.path);control[point]=sql=>{if(armed&&sql==='COMMIT')throw Error('synthetic SQL COMMIT failure');};return SqliteStorage.open(db);};await f.reopen();const intent=await f.native.create('sql-fault','persist once','sql-fault');f.settings.boundary=stage=>{if(stage==='after-sdk-submit')armed=true;};await assert.rejects(call(f.app,'send',{intentId:intent.intentId}));await until(()=>f.app.status().phase==='failed');assert.equal((await f.native.readSend(intent.intentId)).delivery,'uncertain');assert.equal(f.requests,0);await f.app.close();armed=false;delete f.settings.boundary;
 const h=await Harness.open((await openOwnedStorage(f.settings.path)).storage,{models:()=>f.settings.models,registry:createRegistry()},context);const record=await h.commit(tx=>tx.submissionByRequest(intent.context.sdkConversationId,intent.intentId),context);const token=defineDocFamily({kind:'app.admission',version:1,scope:'session',family:true,initial:()=>({}),checkpointWhen:()=>false});const admission=await h.snapshot(token,intent.intentId,context);assert.equal(!!record,point==='after');assert.equal(!!admission?.receipt,point==='after');if(record)assert.equal(record.id,admission.receipt.submissionId);await h.close(context);delete f.settings.storageFactory;await f.reopen();await until(async()=>(await call(f.app,'sendStatus',{intentId:intent.intentId})).submission?.status==='done');assert.equal(f.requests,1);assert.equal((await call(f.app,'history',{id:'sql-fault'})).items.filter(x=>x.role==='user').length,1);
 }finally{armed=false;await f.close();}}
});
test('real SDK queued, placed and settled input remain distinct while afterRun keeps the conversation active',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'submission-progress-')),native=new SqliteSendAuthority(join(dir,'input.sqlite')),config=validationConfiguration();let release,entered=false;const barrier=new Promise(resolve=>release=resolve);const registry=createRegistry();registry.install({name:'validation.after-run',hooks:[hook(GenerationTask,{afterRun:async()=>{if(!entered){entered=true;await barrier;}}})]});const harness=await Harness.open((await openOwnedStorage(join(dir,'sdk.sqlite'))).storage,{models:()=>config.models,registry},context);
 try{const conversation=await harness.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'fixture',modelId:'conversation'}}},context);const location={sdkConversationId:conversation.id,associationVersion:1,location:{workspaceId:'default',version:1,identity:'synthetic-fixed-workspace'}};native.rememberConversation({id:'progress',submissionContext:location});const admissions=new Submissions({harness,authority:native,inputs:native,models:config.models,resolve:async()=>location,ready:()=>{},pause:()=>()=>{}});const first=await native.create('progress','first','first'),second=await native.create('progress','second','second');assert.equal((await admissions.send(first.intentId)).submission.status,'placed');assert.equal((await admissions.send(second.intentId)).submission.status,'queued');await until(()=>entered);assert.equal((await admissions.status(first.intentId)).submission.status,'done');assert.equal((await admissions.status(second.intentId)).submission.status,'queued');const watch=await conversation.watch(context);assert.ok(watch.value.docs['pi.live'].run,'input settlement must not imply whole conversation idle');await watch.stop();release();await until(async()=>(await admissions.status(second.intentId)).submission.status==='done');
 }finally{release();await harness.close(context);native.close();await rm(dir,{recursive:true,force:true});}
});
test('a missing native authority never opens a writable SDK runtime or dispatches legacy stored work',async()=>{
 const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'submission-unavailable-'));let requests=0;const app=new Application({path:join(dir,'sdk.sqlite'),...validationConfiguration({requested:()=>requests++})});try{await assert.rejects(app.start(),{code:'INPUT_UNAVAILABLE'});assert.equal(app.status().phase,'failed');assert.equal(requests,0);}finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

for(const count of [2,52])test(`startup preserves the original explicit send order across ${count} pending intents`,async()=>{
 const f=await fixture();try{
  await call(f.app,'create',{creationId:'ordered'});
  const original=[];
  original.push(await f.native.create('ordered','ordered input 0','ordered-0'));
  if(count>2){
   await call(f.app,'create',{creationId:'cancelled-padding'});
   for(let index=0;index<count-2;index++)await f.native.create('cancelled-padding',`cancelled input ${index}`,`cancelled-${index}`);
   await f.native.stop('cancelled-padding','cancel-padding');
  }
  original.push(await f.native.create('ordered','ordered input 1','ordered-1'));
  // The UI listing remains latest-first; chronological recovery spans pages.
  assert.equal((await f.native.listSends({limit:50})).intents[0].intentId,original.at(-1).intentId);
  await f.reopen();
  await until(async()=>(await call(f.app,'sendStatus',{intentId:original.at(-1).intentId})).submission?.status==='done');
  assert.deepEqual((await call(f.app,'history',{id:'ordered'})).items.filter(item=>item.role==='user').map(item=>item.text),original.map(item=>item.preview.text));
  const receipts=await Promise.all(original.map(item=>call(f.app,'sendStatus',{intentId:item.intentId})));
  assert.equal(new Set(receipts.map(item=>item.receipt.submissionId)).size,2);
  await f.reopen();
  assert.deepEqual((await Promise.all(original.map(item=>call(f.app,'sendStatus',{intentId:item.intentId})))).map(item=>item.receipt),receipts.map(item=>item.receipt));
  assert.equal((await call(f.app,'history',{id:'ordered'})).items.filter(item=>item.role==='user').length,2);
  if(count>2)assert.equal((await call(f.app,'history',{id:'cancelled-padding'})).items.length,0);
 }finally{await f.close();}
});
