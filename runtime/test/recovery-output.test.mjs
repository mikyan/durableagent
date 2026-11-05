import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {PersistentExecutionPeer,executionConfiguration} from '../validation/execution-peer.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read){const deadline=Date.now()+8000;while(Date.now()<deadline){if(await read())return;await pause(5);}throw Error('Public recovery observation timed out');}
async function call(app,method,payload){const result=await app.request({protocol:1,connectionId:'output-test',requestId:crypto.randomUUID(),method,payload});if(!result.ok)throw Object.assign(Error(result.error.message),result.error);return result.value;}

test('completed output failure keeps one durable retry budget across host reopen and remains stoppable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-output-budget-'));
 const native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new PersistentExecutionPeer(directory);
 let ledger,app,requests=0,reads=0,blockedExecutionId;const budgetIds=[],listeners=new Set();
 function openLedger(){ledger=new DatabaseSync(join(directory,'budget.sqlite'));ledger.exec('CREATE TABLE IF NOT EXISTS budgets(id TEXT PRIMARY KEY,used INTEGER NOT NULL,next_at INTEGER NOT NULL)');}
 openLedger();
 const recovery={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},publishWake:async()=>{},probe:async id=>{
  budgetIds.push(id);const prior=ledger.prepare('SELECT used,next_at FROM budgets WHERE id=?').get(id)??{used:0,next_at:0};const now=Date.now(),allowed=prior.used<5&&now>=prior.next_at;
  const used=prior.used+(allowed?1:0),at=allowed?now+120:prior.next_at;
  ledger.prepare('INSERT INTO budgets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET used=excluded.used,next_at=excluded.next_at').run(id,used,at);
  return {allowed,used,at,exhausted:used===5};
 }};
 const channel={request:async(method,payload)=>{
  if(method==='readOutput'){reads++;blockedExecutionId??=payload.executionId;if(payload.executionId===blockedExecutionId){await new Promise(setImmediate);throw Error('Completed execution output is temporarily unavailable');}}
  return peer.request(method,payload);
 }};
 const options={...executionConfiguration(()=>requests++),path:join(directory,'sdk.sqlite'),inputs:native,sends:native,recovery};
 const open=async()=>{app=new Application({...options,execution:new ManagedExecution({channel,authority:native})});await app.start();};
 try{
  await open();await call(app,'create',{creationId:'chat'});await native.create('chat','Run exactly one effect','original');const admitted=await call(app,'send',{intentId:'original'});
  await until(async()=>reads>=12||reads>=4&&(await call(app,'open',{id:'chat'})).recovery?.used===3);
  assert.equal((await call(app,'open',{id:'chat'})).recovery?.used,3,'Output retrieval must enter the visible bounded recovery wait');
  assert.equal(reads,4,'One initial read and three budgeted retries');assert.equal(requests,1,'No tool error may ask the model for a replacement effect');
  const id=(await call(app,'execution.list',{id:'chat'})).executions[0].executionId;
  assert.equal(await readFile(join(directory,'effects.txt'),'utf8'),id+'\n');
  await app.close();ledger.close();openLedger();await open();
  await until(async()=>reads>=12||(await call(app,'open',{id:'chat'})).recovery?.used===5);
  await pause(30);const waiting=await call(app,'open',{id:'chat'});
  assert.equal(waiting.recovery?.reason,'external-unconfirmed');assert.equal(waiting.recovery?.used,5);assert.equal(reads,6,'Reopen must not insert a fresh unbudgeted result read');
  assert.equal(new Set(budgetIds).size,1);assert.equal(budgetIds[0],id);assert.equal(requests,1);
  for(const listener of listeners)listener();await pause(40);assert.equal(reads,6,'An ordinary wake cannot replenish an exhausted work budget');
  assert.deepEqual((await call(app,'sendStatus',{intentId:'original'})).receipt,admitted.receipt);
  assert.equal((await call(app,'history',{id:'chat'})).items.filter(row=>row.role==='user').length,1);
  const stopped=await native.stop('chat','stop-original');await call(app,'stop',{id:'chat',stopId:stopped.pendingAbort.stopId});
  await app.close();await open();assert.equal((await call(app,'open',{id:'chat'})).phase,'stopped');assert.equal(reads,6);assert.equal(requests,1);
  assert.equal(await readFile(join(directory,'effects.txt'),'utf8'),id+'\n','The completed command is never executed again');
  const next=await native.create('chat','Explicit new work after stop','next');assert.equal(next.controlGeneration,2);await call(app,'send',{intentId:'next'});
  await until(async()=>['done','failed'].includes((await call(app,'open',{id:'chat'})).phase));
  assert.equal((await call(app,'sendStatus',{intentId:'next'})).submission?.status,'done','A stopped confirmed old effect must not block a new explicit control generation');
  assert.equal(requests,3);assert.equal(reads,7);const effects=(await readFile(join(directory,'effects.txt'),'utf8')).trim().split('\n');assert.equal(effects.length,2);assert.equal(effects[0],id);assert.notEqual(effects[1],id);
 }finally{await app?.close();ledger.close();native.close();peer.close();await rm(directory,{recursive:true,force:true});}
});

test('a budgeted output retry returns the original completed result and permits the next model turn',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-output-available-'));
 const native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new PersistentExecutionPeer(directory);let requests=0,reads=0,probes=0,app;
 const channel={request:async(method,payload)=>{if(method==='readOutput'&&++reads===1)throw Error('One lost output response');return peer.request(method,payload);}};
 const recovery={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{},probe:async()=>({allowed:++probes<=5,used:probes,at:Date.now()+5,exhausted:probes===5})};
 const options={...executionConfiguration(()=>requests++),path:join(directory,'sdk.sqlite'),inputs:native,sends:native,recovery};
 try{
  app=new Application({...options,execution:new ManagedExecution({channel,authority:native})});await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','One completed effect','original');await call(app,'send',{intentId:'original'});
  await until(async()=>(await call(app,'sendStatus',{intentId:'original'})).submission?.status==='done');
  const record=(await call(app,'execution.list',{id:'chat'})).executions[0];assert.equal(probes,1);assert.equal(requests,2);assert.equal(reads,2);
  assert.equal(await readFile(join(directory,'effects.txt'),'utf8'),record.executionId+'\n');
  assert.equal((await call(app,'history',{id:'chat'})).items.find(row=>row.role==='tool')?.text,'durable-世界');
  await app.close();app=new Application({...options,execution:new ManagedExecution({channel,authority:native})});await app.start();
  assert.equal((await call(app,'sendStatus',{intentId:'original'})).submission.status,'done');assert.equal(probes,1);assert.equal(requests,2);assert.equal(reads,2);
 }finally{await app?.close();native.close();peer.close();await rm(directory,{recursive:true,force:true});}
});
