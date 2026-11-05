import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {Harness,createRegistry,defineTask} from '@earendil-works/pi-durable';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {openOwnedStorage} from '../dist/storage.js';
import {inheritBinding} from '../dist/project-bindings.js';
let seq=0;
async function call(app,method,payload={}){const r=await app.request({protocol:1,connectionId:'stop-policy',requestId:String(++seq),method,payload});if(!r.ok)throw Object.assign(Error(r.error.message),{code:r.error.code});return r.value;}
async function until(fn){const deadline=Date.now()+5000;while(!await fn()){assert.ok(Date.now()<deadline,'Public stop state timed out');await new Promise(r=>setTimeout(r,5));}}
export const stopPolicyCases=[false,true].map(fork=>({name:`a surviving background ${fork?'inherited fork':'owned descendant'} must finish abort before a new explicit generation is admitted`,async run({tempRoot=tmpdir()}={}){
 const dir=await mkdtemp(join(tempRoot,'stop-policy-')),native=new SqliteSendAuthority(join(dir,'input.sqlite'));
 let entered=false,release;const barrier=new Promise(r=>release=r);
 const owner=defineTask({name:'stop.owner',version:1,initial:()=>({phase:'finish'}),phases:{finish:async(t,r,c)=>r.commit(()=>({status:'terminal',outcome:{status:'completed',result:null}}),c)},abort:async(t,r,c)=>r.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),c)});
 const child=defineTask({name:'stop.descendant',version:1,initial:()=>({phase:'sleep'}),phases:{sleep:async(t,r,c)=>r.sleepUntil(Date.now()+60000,{phase:'sleep'},c)},abort:async(t,r,c)=>{entered=true;await barrier;await r.commit(()=>({status:'terminal',outcome:{status:'aborted'}}),c);}});
 const registry=createRegistry();registry.install({name:'stop.fixture',tasks:[owner,child]});let requests=0;
 const options={...validationConfiguration({requested:()=>requests++}),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,registry};let app=new Application(options),h;
 try{
  await app.start();await call(app,'create',{creationId:'chat'});await native.create('chat','original','original');await call(app,'send',{intentId:'original'});await until(async()=>(await call(app,'sendStatus',{intentId:'original'})).submission?.status==='done');
  const sdkId=(await call(app,'open',{id:'chat'})).conversation.submissionContext.sdkConversationId,entryId=Number((await call(app,'history',{id:'chat'})).items[0].id);await app.close();
  h=await Harness.open((await openOwnedStorage(options.path)).storage,{models:options.models,registry,conversationCreated:inheritBinding},context);let work;
  await h.commit(async tx=>{let conversation;if(fork)conversation=await tx.forkConversation(sdkId,entryId,{ownership:{kind:'ownerless'}});else{const parent=await tx.createTask(owner,{}, {conversationId:sdkId,ownership:{kind:'conversation'}});conversation=await tx.createConversation({ownership:{kind:'task',taskId:parent}});}work=await tx.createTask(child,{}, {conversationId:conversation.id,ownership:{kind:'conversation'},background:true});},context);
  h.resume();await until(async()=>(await h.getTask(work,context)).state.status==='sleeping');await h.close(context);h=undefined;
  app=new Application(options);await app.start();const control=await native.stop('chat','stop-old'),newIntent=await native.create('chat','new explicit input','fresh');let accepted=false,stopDone=false;
  const stopping=call(app,'stop',{id:'chat',stopId:control.pendingAbort.stopId}).then(()=>{stopDone=true;});const sending=call(app,'send',{intentId:newIntent.intentId}).then(result=>{accepted=result.accepted;});
  await new Promise(r=>setTimeout(r,60));assert.equal(accepted,false,'new generation must not overtake surviving old descendant abort');assert.equal(stopDone,false);assert.equal(entered,true,'inherited background descendant is included even after its owner settled');assert.equal(requests,1);
  release();await stopping;await sending;await until(async()=>(await call(app,'sendStatus',{intentId:'fresh'})).submission?.status==='done');assert.equal(requests,2);assert.equal((await native.readControl('chat')).pendingAbort,undefined);
 }finally{release();await app.close();await h?.close(context);native.close();await rm(dir,{recursive:true,force:true});}
}}));
export async function runStopPolicyChecks(receive=()=>{},options={}){for(const entry of stopPolicyCases){await entry.run(options);receive({name:entry.name,passed:true});}}
