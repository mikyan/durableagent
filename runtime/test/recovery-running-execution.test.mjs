import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {RunningExecutionPeer} from './fixtures/running-execution-peer.mjs';
import {runningModels} from './fixtures/running-model-connections.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=async(app,method,payload)=>{const result=await app.request({protocol:1,connectionId:'recovery-parent',requestId:crypto.randomUUID(),method,payload});assert.ok(result.ok,JSON.stringify(result));return result.value;};

for(const stage of ['native-start','partial-read','query-before-output-save','output-save-before-commit','output-save-after-commit','output-checkpoint'])test(`owner death at ${stage} resumes the original running tool and collects its later completion`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-running-'));let native,peer,app,requests=0,probes=0;const projections=[];
 try{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/running-execution-crash-host.mjs',import.meta.url)),directory,stage],{stdio:['ignore','ignore','pipe']});let diagnostic='';child.stderr.on('data',value=>diagnostic+=value);
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Crash boundary timed out: '+diagnostic));},8000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.notEqual(code,0,diagnostic);assert.equal(await readFile(join(directory,'cut.txt'),'utf8'),stage);assert.equal(await readFile(join(directory,'original.txt'),'utf8'),'part-one\n');
  native=new SqliteSendAuthority(join(directory,'native.sqlite'));peer=new RunningExecutionPeer(directory);
  const recovery={conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{},publishProjection:async value=>{projections.push(structuredClone(value));},probe:async()=>{probes++;return {allowed:true,used:probes,at:Date.now()+5};}};
  const connections=runningModels(()=>requests++);
  app=new Application({models:connections.models,connections,workspacePath:peer.identity.defaultWorkspace,path:join(directory,'sdk.sqlite'),inputs:native,sends:native,recovery,execution:new ManagedExecution({channel:peer,authority:native})});
  await app.start();await pause(30);const id=peer.complete();
  const deadline=Date.now()+1500;
  while(!projections.some(value=>value.completions.some(item=>item.conversationId==='chat'))&&Date.now()<deadline)await pause(10);
  assert.ok(projections.some(value=>value.completions.some(item=>item.conversationId==='chat')),'Completion must be published before any client reopens the conversation');
  const status=await call(app,'sendStatus',{intentId:'original'});
  assert.equal(status.submission?.status,'done','The surviving external execution must finish the original SDK tool/input');
  assert.equal(status.receipt.intentId,'original');assert.equal(requests,1,'Only the follow-up model request is new');assert.equal(probes,0);
  const history=await call(app,'history',{id:'chat'});assert.equal(history.items.filter(row=>row.role==='user').length,1);assert.equal(history.items.find(row=>row.role==='tool')?.text,'T12_PART_ONE\npart-one\npart-two\n');
  assert.equal(await readFile(join(directory,'effects.txt'),'utf8'),id+'\n');assert.equal(await readFile(join(directory,'original.txt'),'utf8'),'part-one\npart-two\n');assert.equal(await readFile(join(directory,'requests.txt'),'utf8'),'request\n');
 }finally{await app?.close();native?.close();peer?.close();await rm(directory,{recursive:true,force:true});}
});
