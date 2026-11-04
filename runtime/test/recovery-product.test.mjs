import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Application} from '../dist/application.js';
import {ModelConnections} from '../dist/model-connections.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {PersistentExecutionPeer} from '../validation/execution-peer.mjs';
const until=async condition=>{const end=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<end,'Product input did not settle');await new Promise(resolve=>setTimeout(resolve,10));}};
const call=async(app,method,payload={})=>{const response=await app.request({protocol:1,connectionId:'product-tools',requestId:crypto.randomUUID(),method,payload});assert.ok(response.ok,JSON.stringify(response));return response.value;};

test('product ModelConnections offers real registered tool schemas and reports only safe request structure',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recovery-product-tools-')),native=new SqliteSendAuthority(join(directory,'native.sqlite')),peer=new PersistentExecutionPeer(directory),receipts=[],bodies=[];let app;
 try{
  const connections=new ModelConnections({credentials:{metadata:async id=>({connectionId:id,state:'configured',configured:true,generation:1}),resolve:async()=>({key:'synthetic-provider-secret',generation:1})},onRequest:value=>receipts.push(value),fetch:async request=>{
   assert.equal(request.headers.get('api-key'),'synthetic-provider-secret');const body=await request.json();bodies.push(body);
   const first=bodies.length===1,delta=first?{tool_calls:[{index:0,id:'product-tool-call',type:'function',function:{name:'bash',arguments:JSON.stringify({command:"printf 'durable-世界'"})}}]}:{content:'verified product tool result'};
   return new Response(`data: ${JSON.stringify({id:'product',choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'product',choices:[{index:0,delta:{},finish_reason:first?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  }});
  app=new Application({path:join(directory,'sdk.sqlite'),models:connections.models,connections,inputs:native,sends:native,workspacePath:'/termux/default-workspace',execution:new ManagedExecution({channel:peer,authority:native}),recovery:{conditions:async()=>({network:'available',userUnlocked:true}),subscribe:()=>()=>{},publishWake:async()=>{}}});
  await app.start();await call(app,'models.create',{creationId:'mimo',expectedVersion:0,name:'MiMo',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});await call(app,'models.setDefault',{expectedVersion:1,selection:{provider:'mimo',modelId:'mimo-v2.6-flash'}});
  await call(app,'create',{creationId:'chat'});await native.create('chat','prompt-private: actually execute the requested tool','original');await call(app,'send',{intentId:'original'});await until(async()=>(await call(app,'sendStatus',{intentId:'original'})).submission?.status==='done');
  assert.equal(bodies.length,2);const names=bodies[0].tools.map(tool=>tool.function.name);for(const name of ['bash','read','write'])assert.ok(names.includes(name),name+' must be exposed in the final product HTTP request');assert.equal(bodies[0].tools.find(tool=>tool.function.name==='bash').function.parameters.properties.command.type,'string');assert.equal(bodies[0].tool_choice,undefined,'Product tool choice is not forced by the fixture');
  assert.deepEqual(receipts[0].requestTools,{names,choice:'default'});assert.ok(!JSON.stringify(receipts).includes('prompt-private'));assert.ok(!JSON.stringify(receipts).includes('synthetic-provider-secret'));assert.equal((await call(app,'execution.list',{id:'chat'})).executions.length,1);
 }finally{await app?.close();peer.close();native.close();await rm(directory,{recursive:true,force:true});}
});
