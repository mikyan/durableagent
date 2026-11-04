import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Application} from '../validation/application-fixture.mjs';
import {validationConfiguration} from '../dist/application-validation.js';
import {deferredConfiguration} from './fixtures/recovery-deferred-provider.mjs';
const call=async(app,method,payload={})=>{const value=await app.request({protocol:1,connectionId:'recovery-parent',requestId:crypto.randomUUID(),method,payload});if(!value.ok)throw Error(value.error.message);return value.value;};
const until=async condition=>{const end=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<end,'Recovered SDK input did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};
const host={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{}};
async function child(directory,mode,restartLimit,maxRetries){
 const processChild=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/recovery-crash-host.mjs',import.meta.url)),directory,mode,String(restartLimit),String(maxRetries)],{stdio:['ignore','ignore','pipe']});let diagnostic='';processChild.stderr.on('data',value=>{diagnostic+=value;});
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{processChild.kill();reject(Error('Child recovery boundary timed out: '+diagnostic));},15000);processChild.once('error',error=>{clearTimeout(timer);reject(error);});processChild.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});});
 if(mode==='close')assert.equal(result.code,0,diagnostic);else assert.notEqual(result.code,0,diagnostic);
}
test('actual request crashes spend the same SDK retry budget across process generations and end interrupted',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-budget-'));let requests=0,app;
 try{
  await child(directory,'crash',5,1);await child(directory,'crash',5,1);
  assert.equal((await readFile(join(directory,'requests.txt'),'utf8')).trim().split('\n').length,2);
  app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>requests++}),recovery:host,bootstrapSettings:()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:10},restartLimit:5})});
  await app.start();await until(async()=>(await call(app,'open',{id:'chat'})).phase==='failed');
  assert.equal((await call(app,'sendStatus',{intentId:'original'})).submission.reason,'interrupted');assert.equal(requests,0);
  await app.wake();await app.wake();assert.equal(requests,0);assert.equal((await call(app,'history',{id:'chat'})).items.filter(value=>value.role==='user').length,1);
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});
test('SDK restart_limit wins before another request while normal close does not spend that limit',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-restart-'));let requests=0,app;
 try{
  await child(directory,'crash',1,3);
  app=new Application({path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>requests++}),recovery:host,bootstrapSettings:()=>({retry:{enabled:true,maxRetries:3,baseDelayMs:10},restartLimit:1})});
  await app.start();await until(async()=>(await call(app,'open',{id:'chat'})).phase==='failed');assert.equal((await call(app,'sendStatus',{intentId:'original'})).submission.reason,'restart_limit');assert.equal(requests,0);
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
 const closed=await mkdtemp(join(tmpdir(),'recovery-normal-close-'));app=undefined;
 try{
  await child(closed,'close',1,0);await child(closed,'close',1,0);assert.equal(await readFile(join(closed,'closed.txt'),'utf8'),'closed');
  app=new Application({path:join(closed,'app.sqlite'),...validationConfiguration({requested:()=>requests++}),recovery:host,bootstrapSettings:()=>({retry:{enabled:false,maxRetries:0},restartLimit:1})});
  await app.start();await until(async()=>(await call(app,'sendStatus',{intentId:'original'})).submission?.status==='done');assert.equal(requests,1);assert.equal((await call(app,'history',{id:'chat'})).items.filter(value=>value.role==='user').length,1);
 }finally{await app?.close();await rm(closed,{recursive:true,force:true});}
});

test('actual deferred poll crashes retain the original handle and spend one shared SDK retry budget',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-poll-crash-'));let starts=0,polls=0,cancels=0,app;
 try{
  await child(directory,'poll-crash',5,1);await child(directory,'poll-crash',5,1);
  assert.equal(await readFile(join(directory,'deferred-starts.txt'),'utf8'),'request\n');assert.equal(await readFile(join(directory,'polls.txt'),'utf8'),'poll\npoll\n');
  app=new Application({path:join(directory,'app.sqlite'),workspacePath:directory,...deferredConfiguration({started:()=>starts++,polled:()=>polls++,cancelled:()=>cancels++}),recovery:host,bootstrapSettings:()=>({retry:{enabled:true,maxRetries:1,baseDelayMs:10},restartLimit:5,stream:{deferred:true}})});
  await app.start();await until(async()=>(await call(app,'open',{id:'chat'})).phase==='failed');
  assert.equal((await call(app,'sendStatus',{intentId:'original'})).submission.reason,'interrupted');assert.equal(starts,0);assert.equal(polls,0);assert.equal(cancels,1);
  await app.wake();await app.wake();assert.equal(starts,0);assert.equal(polls,0);assert.equal((await call(app,'history',{id:'chat'})).items.filter(value=>value.role==='user').length,1);
 }finally{await app?.close();await rm(directory,{recursive:true,force:true});}
});
