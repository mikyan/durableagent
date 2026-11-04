import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {ExecutionChannelError} from '../dist/execution-channel.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {PersistentExecutionPeer,executionConfiguration} from '../validation/execution-peer.mjs';
const call=async(app,method,payload={})=>{const reply=await app.request({protocol:1,connectionId:'document-policy',requestId:crypto.randomUUID(),method,payload});assert.ok(reply.ok,JSON.stringify(reply));return reply.value;};
const until=async check=>{const deadline=Date.now()+10000;while(!await check()){assert.ok(Date.now()<deadline,'Document policy behavior did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};

for(const snapshotBusyCode of [null,'DATA_SAVER_BUSY'])test(`an unknown Provider read waits in its original SDK tool and safe reopen reuses the fixed observation (${snapshotBusyCode??'available snapshot'})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-tool-policy-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='a'.repeat(64),bytes=Buffer.from('fixed original 世界\n'),contentDigest=createHash('sha256').update(bytes).digest('hex');let granted=false,reads=0,modelRequests=0,rawOpens=0,snapshotBusy=false;const requests=[],observations=new Map();
 const resource={resourceId,namespace:'saf:'+resourceId,original:true,uri:'content://synthetic/document/original',displayName:'original.txt',freshness:'observed'};
 const documents={request:async(method,payload)=>{requests.push({method,payload});if(method==='describe')return resource;if(method==='open'){rawOpens++;throw new ExecutionChannelError('DATA_SAVER_WAIT');}
  if(method==='observeRead'){
   const old=observations.get(payload.operationId);if(old)assert.deepEqual(old,payload);else observations.set(payload.operationId,structuredClone(payload));
   if(!granted)return {observation:{executionId:payload.operationId,phase:'waiting'}};
   if(!reads)reads++;return {observation:{executionId:payload.operationId,phase:'terminal'},snapshot:{snapshotId:payload.operationId,resource,contentDigest,byteLength:bytes.length,observedAt:100}};
  }
  if(method==='readSnapshot'){if(snapshotBusyCode&&!snapshotBusy){snapshotBusy=true;throw new ExecutionChannelError(snapshotBusyCode);}assert.ok(observations.has(payload.operationId));return {offset:payload.offset,base64:bytes.subarray(payload.offset,payload.offset+payload.maxBytes).toString('base64'),bytesRead:Math.min(payload.maxBytes,bytes.length-payload.offset),eof:true};}
  throw Error('Unexpected document method '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const make=()=>new Application({...executionConfiguration(()=>modelRequests++,'document_read',{resourceId}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});let app=make();
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','read original','send');await call(app,'send',{intentId:'send'});await until(()=>requests.length>0);await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(modelRequests,1,'Policy waiting must not become a tool error/model followup');assert.equal(rawOpens,0);assert.equal(reads,0);assert.equal(observations.size,1);const fixed=[...observations.values()][0];assert.equal(fixed.owner.productId,'chat');assert.equal(fixed.owner.controlGeneration,1);
  await app.close();app=make();await app.start();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(observations.size,1);assert.equal(modelRequests,1);
  granted=true;await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(modelRequests,2);assert.equal(reads,1);assert.equal(observations.size,1);assert.deepEqual([...observations.values()][0],fixed);
  const output=(await call(app,'open',{id:'chat'})).entries.find(e=>e.role==='tool').text;assert.match(output,/fixed original 世界/);assert.ok(output.includes(contentDigest));
 }finally{granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});


for(const busyCode of ['INPUT_STORAGE_BUSY','DATA_SAVER_BUSY'])test(`an original write waits before occupying the shared writer and exact grant resumes the same native plan (${busyCode})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-write-policy-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='c'.repeat(64),content='explicit new original',expectedDigest='d'.repeat(64);let granted=false,modelRequests=0,starts=0,plan,policyCalls=0;
 const documents={request:async(method,payload)=>{
  if(method==='prepare')return plan??={...payload,protocol:1,namespace:'saf:'+resourceId,uri:'content://synthetic/document/original',original:true,requestDigest:'e'.repeat(64),state:'accepted_not_started',scopeConfirmed:false,sequence:1,diff:{available:false,reason:'not_completed'}};
  if(method==='stage')return {operationId:payload.operationId,nextOffset:Buffer.byteLength(content),sealed:true};
  if(method==='writePolicy'){policyCalls++;if(policyCalls===2)throw new ExecutionChannelError(busyCode);return {executionId:plan.operationId,documentRequestDigest:plan.requestDigest,phase:granted?'granted':'waiting',dispatched:false};}
  if(method==='start'){if(!granted)throw new ExecutionChannelError('DATA_SAVER_WAIT');starts++;return plan={...plan,state:'completed',scopeConfirmed:true,sequence:2};}
  if(method==='query')return plan;
  throw Error('Unexpected native document request '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const app=new Application({...executionConfiguration(()=>modelRequests++,'document_write',{resourceId,expectedDigest,content}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','write original','send');await call(app,'send',{intentId:'send'});await until(()=>Boolean(plan));await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(modelRequests,1,'A pre-start policy wait cannot fail the tool and generate a model continuation');assert.equal(starts,0);assert.ok(policyCalls>0);const fixedId=plan.operationId;
  granted=true;await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(starts,1);assert.equal(plan.operationId,fixedId);assert.equal(modelRequests,2);
 }finally{granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

for(const busyCode of ['DOCUMENT_CHANNEL_BUSY','DATA_SAVER_BUSY'])test(`a native refusal before start admission retries only the same fixed original write (${busyCode})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-before-admission-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='1'.repeat(64),content='one native admission',expectedDigest='2'.repeat(64);let modelRequests=0,attempts=0,starts=0,plan;
 const documents={request:async(method,payload)=>{
  if(method==='prepare')return plan??={...payload,protocol:1,namespace:'saf:'+resourceId,uri:'content://synthetic/document/original',original:true,requestDigest:'3'.repeat(64),state:'accepted_not_started',scopeConfirmed:false,sequence:1,diff:{available:false,reason:'not_completed'}};
  if(method==='stage')return {operationId:payload.operationId,nextOffset:Buffer.byteLength(content),sealed:true};
  if(method==='writePolicy')return {executionId:plan.operationId,documentRequestDigest:plan.requestDigest,phase:'granted',dispatched:false};
  if(method==='start'){assert.equal(payload.operationId,plan.operationId);attempts++;if(attempts===1)throw new ExecutionChannelError(busyCode);starts++;return plan={...plan,state:'completed',scopeConfirmed:true,sequence:2};}
  if(method==='query')return plan;
  throw Error('Unexpected native document request '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const app=new Application({...executionConfiguration(()=>modelRequests++,'document_write',{resourceId,expectedDigest,content}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','write original','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(attempts,2);assert.equal(starts,1);assert.equal(modelRequests,2);
 }finally{await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('policy storage busy after dispatch waits for the same original result without repeating a write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-after-dispatch-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='1'.repeat(64),content='one dispatched write',expectedDigest='2'.repeat(64);let modelRequests=0,starts=0,dispatched=false,plan;
 const documents={request:async(method,payload)=>{
  if(method==='prepare')return plan??={...payload,protocol:1,namespace:'saf:'+resourceId,uri:'content://synthetic/document/original',original:true,requestDigest:'3'.repeat(64),state:'accepted_not_started',scopeConfirmed:false,sequence:1,diff:{available:false,reason:'not_completed'}};
  if(method==='stage')return {operationId:payload.operationId,nextOffset:Buffer.byteLength(content),sealed:true};
  if(method==='writePolicy')return {executionId:plan.operationId,documentRequestDigest:plan.requestDigest,phase:'granted',dispatched};
  if(method==='start'){assert.equal(payload.operationId,plan.operationId);starts++;dispatched=true;throw new ExecutionChannelError('DATA_SAVER_BUSY');}
  if(method==='query')return plan;
  throw Error('Unexpected native document request '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const app=new Application({...executionConfiguration(()=>modelRequests++,'document_write',{resourceId,expectedDigest,content}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','write original','send');await call(app,'send',{intentId:'send'});await until(()=>starts===1);await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(starts,1);assert.equal(modelRequests,1,'Dispatched policy uncertainty must retain the original SDK tool');
  plan={...plan,state:'completed',scopeConfirmed:true,sequence:2};await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(starts,1);assert.equal(modelRequests,2);
  assert.match((await call(app,'open',{id:'chat'})).entries.find(e=>e.role==='tool').text,/原件写入已核验/);
 }finally{if(plan)plan={...plan,state:'completed',scopeConfirmed:true,sequence:2};await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

for(const lostResponse of [true,false])test(`a confirmed original write survives policy receipt loss (${lostResponse?'start response lost':'pending SDK receipt'}) without another write`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-write-receipt-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='7'.repeat(64),content='completed exactly once',expectedDigest='8'.repeat(64);let modelRequests=0,starts=0,queries=0,plan;
 const documents={request:async(method,payload)=>{
  if(method==='prepare')return plan??={...payload,protocol:1,namespace:'saf:'+resourceId,uri:'content://synthetic/document/original',original:true,requestDigest:'9'.repeat(64),state:'accepted_not_started',scopeConfirmed:false,sequence:1,diff:{available:false,reason:'not_completed'}};
  if(method==='stage')return {operationId:payload.operationId,nextOffset:Buffer.byteLength(content),sealed:true};
  if(method==='writePolicy')return {executionId:plan.operationId,documentRequestDigest:plan.requestDigest,phase:starts?'result-unverified':'granted',dispatched:starts>0};
  if(method==='start'){starts++;const pending={...plan,state:'running',sequence:2};plan={...plan,state:'completed',scopeConfirmed:true,sequence:3};if(lostResponse)throw new ExecutionChannelError('DATA_SAVER_STORAGE_BUSY');return pending;}
  if(method==='query'){queries++;return plan;}
  throw Error('Unexpected native document request '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const app=new Application({...executionConfiguration(()=>modelRequests++,'document_write',{resourceId,expectedDigest,content}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','write original','send');await call(app,'send',{intentId:'send'});await until(()=>starts===1);await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');
  const tool=(await call(app,'open',{id:'chat'})).entries.find(e=>e.role==='tool');assert.match(tool.text,/原件写入已核验/);assert.equal(starts,1);assert.ok(queries>0,'Lost receipt must query the same native operation');assert.equal(modelRequests,2);
 }finally{await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});

test('public file observation during policy waiting preserves the staged receipt sequence and original SDK tool',async()=>{
 const root=await mkdtemp(join(tmpdir(),'provider-write-sequence-')),native=new SqliteSendAuthority(join(root,'native.sqlite')),peer=new PersistentExecutionPeer(root);
 const resourceId='4'.repeat(64),content='staged while waiting',expectedDigest='5'.repeat(64);let modelRequests=0,starts=0,policyCalls=0,granted=false,plan;
 const documents={request:async(method,payload)=>{
  if(method==='prepare')return plan??={...payload,protocol:1,namespace:'saf:'+resourceId,uri:'content://synthetic/document/original',original:true,requestDigest:'6'.repeat(64),state:'accepted_not_started',scopeConfirmed:false,sequence:0,diff:{available:false,reason:'not_completed'}};
  if(method==='stage'){plan={...plan,sequence:1};return {operationId:payload.operationId,nextOffset:Buffer.byteLength(content),sealed:true};}
  if(method==='writePolicy'){policyCalls++;return {executionId:plan.operationId,documentRequestDigest:plan.requestDigest,phase:granted?'granted':'waiting',dispatched:false};}
  if(method==='start'){assert.ok(granted);starts++;return plan={...plan,state:'completed',scopeConfirmed:true,sequence:2};}
  if(method==='query')return plan;
  throw Error('Unexpected native document request '+method);
 }};
 const policy={get:async()=>({enabled:true,version:1,restricted:true,period:1,reason:'metered',network:{identity:'fixture',known:true,metered:true,blocked:false}})};
 const app=new Application({...executionConfiguration(()=>modelRequests++,'document_write',{resourceId,expectedDigest,content}),path:join(root,'sdk.sqlite'),inputs:native,sends:native,dataSaver:policy,execution:new ManagedExecution({channel:peer,authority:native,documents,dataSaver:policy})});
 try{await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','write original','send');await call(app,'send',{intentId:'send'});await until(()=>policyCalls>0);
  const current=await call(app,'files.list',{id:'chat'});assert.equal(current.documents.changes[0].sequence,1);await new Promise(resolve=>setTimeout(resolve,180));assert.equal(modelRequests,1,'An observer must not turn a safe policy wait into a failed tool');assert.equal(starts,0);
  granted=true;await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(starts,1);assert.equal(modelRequests,2);
 }finally{granted=true;await app.close();native.close();peer.close();await rm(root,{recursive:true,force:true});}
});
