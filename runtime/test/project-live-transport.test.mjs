import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {liveModels} from '../dist/live-model.js';
import {projectWitness} from '../dist/project-validation.js';
import {fixtureTransport} from '../dist/transport.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
test('opt-in live provider forces witness after SDK transcript system/tool declarations and releases choice after its result',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'project-live-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),metrics={},witness=projectWitness(metrics);witness.enable();const bodies=[],original=globalThis.fetch,transport=fixtureTransport({toolName:()=> 'location_witness',requested:()=>{},aborted:()=>{}});
 globalThis.fetch=async(input,init)=>{const request=new Request(input,init);bodies.push(JSON.parse(await request.clone().text()));return transport(request,init);};
 const live=liveModels('synthetic-validation-placeholder',()=>{},{forceEcho:false,forceTool:()=> 'location_witness'}),app=new Application({path:join(dir,'sdk.sqlite'),models:live.models,initialModel:{provider:live.provider,modelId:live.model,name:'Live policy fixture'},workspacePath:'/synthetic/default',inputs:native,sends:native,locationEdits:native,registry:witness.registry,locations:witness.locations});
 const call=async(method,payload={})=>{const response=await app.request({protocol:1,connectionId:'live-policy',requestId:crypto.randomUUID(),method,payload});assert.equal(response.ok,true,JSON.stringify(response));return response.value;};
 try{await app.start();await call('create',{creationId:'one'});await native.create('one','call witness','intent');await call('send',{intentId:'intent'});const end=Date.now()+10000;while((await call('sendStatus',{intentId:'intent'})).submission?.status!=='done'){assert.ok(Date.now()<end);await new Promise(r=>setTimeout(r,5));}assert.equal(bodies.length,2);assert.deepEqual(bodies[0].tool_choice,{type:'function',function:{name:'location_witness'}});assert.equal(bodies[1].tool_choice,'none');assert.equal(metrics.projectToolWitnesses.length,1);
 }finally{await app.close();globalThis.fetch=original;native.close();await rm(dir,{recursive:true,force:true});}
});
