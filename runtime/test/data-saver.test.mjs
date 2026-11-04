import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {InputError} from '../dist/input.js';
import {ExecutionChannelError} from '../dist/execution-channel.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {PersistentExecutionPeer,executionConfiguration} from '../validation/execution-peer.mjs';
import {createRegistry,defineTool,hook,ToolTask} from '@earendil-works/pi-durable';
import {createBashTool} from '@earendil-works/pi-durable/tools';
import {obj} from '@earendil-works/pi-schema';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const call=async(app,method,payload={})=>{const result=await app.request({protocol:1,connectionId:'data-saver-test',requestId:crypto.randomUUID(),method,payload});if(!result.ok)throw Object.assign(Error(result.error.message),result.error);return result.value;};
const until=async read=>{const end=Date.now()+10000;while(!await read()){assert.ok(Date.now()<end,'Data saver public behavior did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};

// Only native platform/policy and the external executor/model are boundary fixtures.
// The production policy integration, actual SDK scheduling, application and two SQLite stores run.
class PlatformPolicy{
 records=new Map();granted=false;interrupted=false;
 settings={enabled:false,version:0,period:1,restricted:false,reason:'disabled',network:{identity:null,known:false,metered:true,blocked:false}};
 async get(){return structuredClone(this.settings);}
 async configure(enabled,expectedVersion){assert.equal(expectedVersion,this.settings.version);this.settings={...this.settings,enabled,version:expectedVersion+1,restricted:enabled,reason:enabled?'network-unknown':'disabled'};return this.get();}
 async register(request){const old=this.records.get(request.executionId);if(old){assert.equal(old.requestDigest,digest(request));return structuredClone(old);}
  const value={executionId:request.executionId,requestDigest:digest(request),productId:request.context.productId,controlGeneration:request.context.controlGeneration,namespace:request.context.namespace,classification:'unknown',summary:request.command.script,period:1,phase:'waiting',reason:'metered',grantPeriod:null};this.records.set(value.executionId,value);return structuredClone(value);
 }
 async prepared(id,requestDigest,finalDigest){const record=this.records.get(id);assert.equal(record.requestDigest,requestDigest);if(record.finalDigest)assert.equal(record.finalDigest,finalDigest);record.finalDigest=finalDigest;return this.decision(id);}
 async decision(id){return {...structuredClone(this.records.get(id)),phase:this.interrupted?'result-unverified':this.granted?'granted':'waiting',policyInterrupted:this.interrupted};}
 async grant(request){const record=this.records.get(request.executionId);assert.equal(record.requestDigest,request.requestDigest);assert.equal(record.finalDigest,request.finalDigest);assert.equal(record.period,request.period);this.granted=true;return this.decision(request.executionId);}
 async operations(productId){return {operations:await Promise.all([...this.records.values()].filter(value=>value.productId===productId).map(value=>this.decision(value.executionId))),nextCursor:null};}
}

for(const nested of [false,true])test(`the policy binds final beforeTool and prepare mutations for ${nested?'nested':'direct'} SDK calls`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-final-input-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy(),peer=new PersistentExecutionPeer(root);
 const execution=new ManagedExecution({channel:peer,authority:native,dataSaver:policy}),registry=createRegistry();let prepares=0,hookParents=[],modelRequests=0;
 const prepared=execution.wrapTool({...createBashTool({prepare:value=>{prepares++;assert.equal(value.command,'hook-mutated-command');value.command='final-unknown-command --network';value.cwd='/termux/default-workspace/final';value.env={BASH_ENV:'/untrusted/startup',FINAL:'世界'};value.inheritEnv=false;}}),name:'prepared_bash'});
 registry.install({name:'final-policy-fixture',tools:[prepared,defineTool({name:'outer',description:'Nested final-argument fixture',parameters:obj({},{open:true}),execute:async(_args,api,context)=>{const result=await api.executeTool('prepared_bash',{command:'nested-initial-command'},context,{key:'fixed-nested'});return {output:[{type:'text',text:JSON.stringify(result.structuredOutput)}]};}})],hooks:[hook(ToolTask,{beforeTool:call=>{if(call.name==='prepared_bash'){hookParents.push(Boolean(call.parent));return {arguments:{command:'hook-mutated-command'}};}}})]});
 const app=new Application({...executionConfiguration(()=>modelRequests++,nested?'outer':'prepared_bash'),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution,registry});
 try{await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','run final inputs','send');await call(app,'send',{intentId:'send'});
  await until(()=>[...policy.records.values()][0]?.finalDigest);const record=[...policy.records.values()][0],fixed=peer.read(record.executionId).request;
  assert.deepEqual(fixed.command,{kind:'shell',script:'final-unknown-command --network'});assert.equal(fixed.cwd,'/termux/default-workspace/final');assert.deepEqual(fixed.env,{BASH_ENV:'/untrusted/startup',FINAL:'世界'});assert.equal(fixed.inheritEnv,false);
  assert.equal(record.requestDigest,digest(fixed));assert.equal(record.classification,'unknown');assert.equal((await peer.request('query',{executionId:record.executionId})).state,'accepted_not_started');assert.equal(prepares,1);assert.deepEqual(hookParents,[nested]);assert.equal(modelRequests,1);
  await call(app,'dataSaver.grant',{id:'conversation',executionId:record.executionId,requestDigest:record.requestDigest,finalDigest:record.finalDigest,period:record.period});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');
  assert.equal(modelRequests,2);assert.equal((await peer.request('list',{})).executions.length,1);assert.equal(await readFile(join(root,'effects.txt'),'utf8'),record.executionId+'\n');
 }finally{policy.granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('an actual SDK command waits before start with one prepared identity while its model communication remains usable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-sdk-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy();
 const peer=new PersistentExecutionPeer(root);let starts=0;const original=peer.request.bind(peer);peer.request=async(method,payload)=>{if(method==='start')starts++;return original(method,payload);};
 const app=new Application({...executionConfiguration(),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});
 try{
  await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','run fixed command','send');await call(app,'send',{intentId:'send'});
  await until(()=>policy.records.size>0||starts>0);assert.equal(starts,0,'restricted unknown command must not start');
  await until(()=>[...policy.records.values()][0]?.finalDigest);
  const record=[...policy.records.values()][0],before=await call(app,'execution.list',{id:'conversation'});
  assert.equal(before.executions.length,1);assert.equal(before.executions[0].executionId,record.executionId);assert.equal(before.executions[0].state,'accepted_not_started');
  const waiting=(await call(app,'dataSaver.operations',{id:'conversation'})).operations;assert.equal(waiting.length,1);assert.equal(waiting[0].phase,'waiting');
  await call(app,'dataSaver.grant',{id:'conversation',executionId:record.executionId,requestDigest:record.requestDigest,finalDigest:record.finalDigest,period:record.period});
  await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');
  assert.equal(starts,1);assert.equal((await peer.request('query',{executionId:record.executionId})).state,'completed');assert.equal((await peer.request('list',{})).executions.length,1);
  assert.equal((await call(app,'open',{id:'conversation'})).entries.filter(entry=>entry.role==='tool').length,1);
 }finally{policy.granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('the shared application configuration exposes current native network facts without submitting work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-configuration-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy();
 const app=new Application({...executionConfiguration(),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy});
 try{await app.start();assert.ok(app.status().extensions.includes('data-saver'));
  assert.equal((await call(app,'dataSaver.get')).enabled,false);
  const configured=await call(app,'dataSaver.configure',{enabled:true,expectedVersion:0});assert.equal(configured.enabled,true);assert.equal(configured.reason,'network-unknown');
  await assert.rejects(call(app,'dataSaver.configure',{enabled:'true',expectedVersion:1}),{code:'INVALID_ARGUMENT'});
  assert.equal((await call(app,'list')).conversations.length,0);
 }finally{await app.close();native.close();await rm(root,{recursive:true,force:true});}
});

test('network-interrupted effects keep the same pending SDK tool instead of prompting another model action; user stop still settles it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-interrupted-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy();policy.granted=true;
 const peer=new PersistentExecutionPeer(root);let starts=0,modelRequests=0;const original=peer.request.bind(peer);
 peer.request=async(method,payload)=>{
  if(method==='start'){starts++;policy.interrupted=true;const record=peer.read(payload.executionId);record.receipt={...record.receipt,state:'stopped',cancelReason:'network_policy',scopeConfirmed:true,sequence:3};peer.db.prepare('UPDATE executions SET receipt=? WHERE id=?').run(JSON.stringify(record.receipt),payload.executionId);return record.receipt;}
  if(method==='cancel')return original('query',payload);
  return original(method,payload);
 };
 const app=new Application({...executionConfiguration(()=>modelRequests++),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','run network-sensitive work','send');await call(app,'send',{intentId:'send'});
  await until(()=>starts===1);
  // Observe across multiple public reconciliation turns; no synthetic model continuation is allowed.
  for(let index=0;index<12;index++){await call(app,'execution.list',{id:'conversation'});await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(modelRequests,1,'a policy stop must not become a tool error that launches another model request');assert.equal(starts,1);
  const control=await native.stop('conversation','explicit-stop');await call(app,'stop',{id:'conversation',stopId:control.pendingAbort.stopId});
  await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='unanswered');
  assert.equal(modelRequests,1);assert.equal(starts,1);assert.equal((await peer.request('list',{})).executions.length,1);
 }finally{await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('temporary native policy unavailability holds the original invocation without starting or asking the model again',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-busy-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy(),peer=new PersistentExecutionPeer(root);
 let unavailable=true,reads=0,modelRequests=0;const decision=policy.decision.bind(policy);policy.decision=async id=>{reads++;if(unavailable)throw new InputError('DATA_SAVER_BUSY','Native policy is temporarily committing');return decision(id);};
 const app=new Application({...executionConfiguration(()=>modelRequests++),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','run after native facts recover','send');await call(app,'send',{intentId:'send'});await until(()=>reads>0);
  for(let index=0;index<12;index++){await call(app,'open',{id:'conversation'});await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(modelRequests,1,'unverified native policy must not become a tool error and another model request');
  const rows=(await peer.request('list',{})).executions;assert.equal(rows.length,1);assert.equal(rows[0].state,'accepted_not_started');
  unavailable=false;const record=policy.records.get(rows[0].executionId);await call(app,'dataSaver.grant',{id:'conversation',executionId:record.executionId,requestDigest:record.requestDigest,finalDigest:record.finalDigest,period:record.period});
  await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(modelRequests,2);assert.equal((await peer.request('list',{})).executions.length,1);
 }finally{unavailable=false;policy.granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('a final native network refusal returns the same prepared execution to policy waiting, without a new model turn',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-last-fence-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy(),peer=new PersistentExecutionPeer(root);policy.granted=true;
 let startAttempts=0,starts=0,modelRequests=0;const transport=peer.request.bind(peer);
 peer.request=async(method,payload)=>{if(method==='start'){startAttempts++;if(startAttempts===1){policy.granted=false;throw new ExecutionChannelError('DATA_SAVER_WAIT');}starts++;}return transport(method,payload);};
 const app=new Application({...executionConfiguration(()=>modelRequests++),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','run once after final fence','send');await call(app,'send',{intentId:'send'});await until(()=>startAttempts>0);
  for(let index=0;index<12;index++){await call(app,'open',{id:'conversation'});await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(modelRequests,1);assert.equal(starts,0);assert.equal(startAttempts,1);
  const record=[...policy.records.values()][0];await call(app,'dataSaver.grant',{id:'conversation',executionId:record.executionId,requestDigest:record.requestDigest,finalDigest:record.finalDigest,period:record.period});
  await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(modelRequests,2);assert.equal(startAttempts,2);assert.equal(starts,1);assert.equal((await peer.request('list',{})).executions.length,1);
 }finally{policy.granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('real SDK host death after prepared policy restores the same waiting identity and only the explicit grant starts it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-kill-'));let app,native,peer;const policy=new PlatformPolicy();
 try{
  const child=spawn(process.execPath,['validation/data-saver-crash-child.mjs',root],{stdio:'ignore'});
  const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Policy child did not reach prepared boundary'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});assert.notEqual(exit,0);
  const record=JSON.parse(await readFile(join(root,'prepared-policy.json'),'utf8'));policy.records.set(record.executionId,record);
  assert.equal(await readFile(join(root,'model-requests.txt'),'utf8'),'request\n');await assert.rejects(readFile(join(root,'effects.txt')),{code:'ENOENT'});
  native=new SqliteSendAuthority(join(root,'native.sqlite'));peer=new PersistentExecutionPeer(root);let modelRequests=0,preparedAgain=0;const prepare=policy.prepared.bind(policy);policy.prepared=async(...args)=>{preparedAgain++;return prepare(...args);};
  app=new Application({...executionConfiguration(()=>modelRequests++),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});await app.start();await until(()=>preparedAgain>0);
  assert.equal(modelRequests,0);assert.equal((await call(app,'execution.list',{id:'conversation'})).executions[0].executionId,record.executionId);await assert.rejects(readFile(join(root,'effects.txt')),{code:'ENOENT'});
  await call(app,'dataSaver.grant',{id:'conversation',executionId:record.executionId,requestDigest:record.requestDigest,finalDigest:record.finalDigest,period:record.period});
  await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(modelRequests,1);assert.equal(await readFile(join(root,'effects.txt'),'utf8'),record.executionId+'\n');assert.equal((await peer.request('list',{})).executions.length,1);
 }finally{policy.granted=true;await app?.close();native?.close();peer?.close();await rm(root,{recursive:true,force:true});}
});


test('the fixed product Bash capability makes exact pwd -P local with a clean environment and no script analyzer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'data-saver-local-pwd-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),policy=new PlatformPolicy(),peer=new PersistentExecutionPeer(root);
 const app=new Application({...executionConfiguration(()=>{},'bash',{command:'pwd -P'}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'conversation'});await native.create('conversation','show physical directory','send');await call(app,'send',{intentId:'send'});await until(()=>[...policy.records.values()][0]?.finalDigest);
  const request=peer.read([...policy.records.keys()][0]).request;assert.equal(request.command.script,'builtin pwd -P');assert.deepEqual(request.env,{});assert.equal(request.inheritEnv,false);
 }finally{policy.granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});
