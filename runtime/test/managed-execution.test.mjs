import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createModels,createProvider} from '@earendil-works/pi-ai/models';
import {openAICompletionsApi} from '@earendil-works/pi-ai/api/openai-completions.lazy';
import {Application} from '../dist/application.js';
import {ManagedExecution} from '../dist/managed-execution.js';
import {SqliteSendAuthority} from '../validation/submission-authority.mjs';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import {createRegistry,defineTool} from '@earendil-works/pi-durable';
import {obj} from '@earendil-works/pi-schema';
import {PersistentExecutionPeer,executionConfiguration} from '../validation/execution-peer.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const call=async(app,method,payload={})=>{const r=await app.request({protocol:1,connectionId:'test',requestId:crypto.randomUUID(),method,payload});if(!r.ok)throw Object.assign(Error(r.error.message),r.error);return r.value;};
const until=async fn=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end,'public application state did not settle');await new Promise(r=>setTimeout(r,10));}};

// Only the model HTTP and external execution service boundaries are controlled here.
// The public Application, SDK scheduler/tool wrapper, native-intent SQLite and SDK SQLite are real.
function configuration(toolName='bash',toolArgs={command:"printf 'hello-世界'"}){
 const models=createModels(),api=openAICompletionsApi();
 const fetch=async(_url,init)=>{const body=JSON.parse(init.body),tool=body.messages.at(-1).role==='user';const delta=tool?{tool_calls:[{index:0,id:'command-call',type:'function',function:{name:toolName,arguments:JSON.stringify(toolArgs)}}]}:{content:'已完成'};return new Response(`data: ${JSON.stringify({id:'execution-fixture',choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'execution-fixture',choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});};
 models.setProvider(createProvider({id:'execution-fixture',baseUrl:'https://fixture.invalid/v1',auth:{apiKey:{name:'fixture',resolve:async()=>({auth:{apiKey:'public-fixture-token'}})}},models:[{id:'model',name:'fixture',api:'openai-completions',provider:'execution-fixture',baseUrl:'https://fixture.invalid/v1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000}],api:{stream:(m,c,o)=>api.stream(m,c,{...o,maxRetries:0,fetch}),streamSimple:(m,c,o)=>api.streamSimple(m,c,{...o,maxRetries:0,fetch})}}));
 return {models,initialModel:{provider:'execution-fixture',modelId:'model',name:'fixture'},workspacePath:'/termux/default-workspace'};
}
class ExecutionPeer {
 records=new Map();starts=0;requests=[];identity={protocol:1,executorId:'fixture-executor',ledgerEpoch:'fixture-ledger',namespace:'termux:fixture-executor',defaultWorkspace:'/termux/default-workspace'};
 async request(method,payload){this.requests.push({method,payload:structuredClone(payload)});const id=payload.executionId;
  if(method==='ping')return {...this.identity,processEpoch:'process-one'};
  if(method==='inspectWorkspace')return {state:'available',identity:'directory:'+payload.path,namespace:this.identity.namespace};
  if(method==='query')return this.records.has(id)?structuredClone(this.records.get(id).receipt):{...this.identity,executionId:id,state:'unknown',reason:'NO_RECEIPT'};
  if(method==='prepare'){const old=this.records.get(id);if(old){assert.deepEqual(old.request,payload);return structuredClone(old.receipt);}const receipt={...this.identity,executionId:id,requestDigest:hash(payload),finalDigest:hash({...payload,final:true}),context:payload.context,state:'accepted_not_started',sequence:1,outputCursor:0,outputBytes:0,captureIncomplete:false,outputRef:'/termux/outputs/'+id+'.raw'};this.records.set(id,{request:structuredClone(payload),receipt});return structuredClone(receipt);}
  if(method==='start'){const record=this.records.get(id);assert.equal(payload.finalDigest,record.receipt.finalDigest);if(record.receipt.state==='accepted_not_started'){this.starts++;record.receipt={...record.receipt,state:'completed',sequence:3,exitCode:0,scopeConfirmed:true,outputCursor:1,outputBytes:Buffer.byteLength('hello-世界')};}return structuredClone(record.receipt);}
  if(method==='readOutput')return {...this.identity,executionId:id,cursor:payload.cursor,nextCursor:1,chunks:payload.cursor?[]:[{sequence:1,stream:'stdout',data:Buffer.from('hello-世界').toString('base64')}]};
  throw Error('Unexpected execution method '+method);
 }
}

test('a real SDK tool stores stable execution context and reaches one external command through the application',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new ExecutionPeer();
 let execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'conversation-one'});const intent=await native.create('conversation-one','执行测试','send-one');await call(app,'send',{intentId:intent.intentId});await until(async()=>(await call(app,'sendStatus',{intentId:intent.intentId})).submission?.status==='done');
  const list=await call(app,'execution.list',{id:'conversation-one'});assert.equal(list.executions.length,1);const record=list.executions[0];assert.equal(record.state,'completed');assert.equal(record.context.productId,'conversation-one');assert.equal(record.context.controlGeneration,1);assert.equal(record.context.callId,'command-call');assert.ok(record.context.taskId>0);assert.ok(record.context.bindingId);assert.equal(peer.starts,1);assert.equal(peer.requests.find(x=>x.method==='prepare').payload.command.script,"printf 'hello-世界'");
  const opened=await call(app,'open',{id:'conversation-one'});assert.match(JSON.stringify(opened),/hello-世界/);
  await app.close();execution=new ManagedExecution({channel:peer,authority:native});app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});await app.start();assert.equal((await call(app,'execution.list',{id:'conversation-one'})).executions[0].executionId,record.executionId);assert.equal(peer.starts,1);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('a fixed shell wrapper gives each exec ordinal its own stable request and preserves argv options',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-argv-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new ExecutionPeer(),execution=new ManagedExecution({channel:peer,authority:native}),registry=createRegistry();
 const argv=['/termux/bin/program',"it's $(touch pwned) `touch pwned` *; touch pwned",'a b'];
 registry.install({name:'fixed-contract',tools:[execution.wrapTool(defineTool({name:'contract',description:'Fixed shell contract',parameters:obj({}, {open:true}),execute:async(_args,api,context)=>{for(let n=0;n<2;n++){const result=await api.env.exec(argv,{cwd:'sub',env:{ONLY:'世界'},inheritEnv:false,timeout:0.125,onOutput:text=>api.output(text)},context);if(!result.ok)throw result.error;}return {output:[{type:'text',text:'argv-options-ok'}]};}}))]});
 const app=new Application({...configuration('contract'),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution,registry});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','contract','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');const requests=peer.requests.filter(value=>value.method==='prepare').map(value=>value.payload);assert.equal(requests.length,2);assert.notEqual(requests[0].executionId,requests[1].executionId);for(const request of requests){assert.deepEqual(request.command,{kind:'argv',argv});assert.equal(request.cwd,'/termux/default-workspace/sub');assert.deepEqual(request.env,{ONLY:'世界'});assert.equal(request.inheritEnv,false);assert.equal(request.timeoutMs,125);}assert.ok(JSON.stringify(await call(app,'open',{id:'one'})).includes('argv-options-ok'));
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('empty argv is a confirmed local spawn error with no external acceptance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-empty-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new ExecutionPeer(),execution=new ManagedExecution({channel:peer,authority:native}),registry=createRegistry();
 registry.install({name:'fixed-empty',tools:[execution.wrapTool(defineTool({name:'empty',description:'Empty argv conformance',parameters:obj({}, {open:true}),execute:async(_args,api,context)=>{const result=await api.env.exec([],undefined,context);return {output:[{type:'text',text:result.ok?'unexpected-success':result.error.code}]};}}))]});
 const app=new Application({...configuration('empty'),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution,registry});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','empty','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal((await call(app,'open',{id:'one'})).entries.find(entry=>entry.role==='tool').text,'spawn_error');assert.equal(peer.requests.filter(value=>value.method==='prepare'||value.method==='start').length,0);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('a pure application tool remains usable before Termux setup without providing executable file capabilities',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-unready-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),calls=[];
 const channel={request:async(method)=>{calls.push(method);throw Error('Termux unpaired');}},execution=new ManagedExecution({channel,authority:native}),registry=createRegistry();
 registry.install({name:'pure',tools:[defineTool({name:'pure',description:'Pure app operation',parameters:obj({}, {open:true}),execute:async()=>({output:[{type:'text',text:'pure-operation-ok'}]})})]});
 const app=new Application({...configuration('pure'),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution,registry});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','pure operation','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'open',{id:'one'})).phase==='done');assert.ok(JSON.stringify(await call(app,'open',{id:'one'})).includes('pure-operation-ok'));assert.equal(calls.includes('prepare'),false);assert.equal(calls.includes('start'),false);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('a lost start receipt persists uncertainty and blocks a later tool identity from bypassing it',async()=>{
 class UnknownPeer extends ExecutionPeer {async request(method,payload){const value=await super.request(method,payload);if(method==='start'){this.records.get(payload.executionId).receipt={...value,state:'unknown',reason:'SUPERVISOR_LOST',scopeConfirmed:false};throw Error('start response lost');}return value;}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-unknown-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new UnknownPeer();
 const execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','first','first');await call(app,'send',{intentId:'first'});await until(async()=>(await call(app,'sendStatus',{intentId:'first'})).submission?.status==='done');
  assert.equal((await call(app,'execution.list',{id:'one'})).executions[0].state,'unknown');
  await native.create('one','try another tool identity','second');await call(app,'send',{intentId:'second'});await until(async()=>(await call(app,'sendStatus',{intentId:'second'})).submission?.status==='done');
  assert.equal(peer.requests.filter(x=>x.method==='prepare').length,1);assert.equal(peer.starts,1);
  const catalog=await call(app,'projects.get');await assert.rejects(call(app,'workspaces.update',{operationId:'move',expectedVersion:catalog.version,id:'default',path:'/new'}),{code:'LOCATION_UNKNOWN'});
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('public verification in the same host resolves a lost ACK before a later explicit execution',async()=>{
 class LostAckPeer extends ExecutionPeer {unreachable=false;lost=false;async request(method,payload){if(method==='query'&&this.unreachable)throw Error('Disconnected');const result=await super.request(method,payload);if(method==='start'&&!this.lost){this.lost=true;this.unreachable=true;throw Error('Start ACK lost');}return result;}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-resolved-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new LostAckPeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','first','first');await call(app,'send',{intentId:'first'});await until(async()=>(await call(app,'sendStatus',{intentId:'first'})).submission?.status==='done');assert.equal((await call(app,'execution.list',{id:'one'})).executions[0].state,'unknown');peer.unreachable=false;assert.equal((await call(app,'execution.list',{id:'one'})).executions[0].state,'completed');await native.create('one','second explicit execution','second');await call(app,'send',{intentId:'second'});await until(async()=>(await call(app,'sendStatus',{intentId:'second'})).submission?.status==='done');assert.equal(peer.starts,2);assert.equal((await call(app,'execution.list',{id:'one'})).executions.length,2);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('an initially unverified binding pins its first real directory identity before acceptance',async()=>{
 class ReplacedPeer extends ExecutionPeer {available=false;directory='original';async request(method,payload){if(method==='ping')this.available=true;if(method==='inspectWorkspace')return this.available?{state:'available',identity:this.directory,namespace:this.identity.namespace}:{state:'unavailable'};if(method==='cancel'){const record=this.records.get(payload.executionId);record.receipt={...record.receipt,state:'not_started',scopeConfirmed:true,neverStarted:true,sequence:4};return structuredClone(record.receipt);}return super.request(method,payload);}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-location-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new ReplacedPeer();
 const execution=new ManagedExecution({channel:peer,authority:native,boundary:stage=>{if(stage==='accepted')peer.directory='replacement';}}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','run after setup','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(peer.starts,0,'replaced adopted directory must not start a command');assert.equal((await call(app,'execution.list',{id:'one'})).executions[0].state,'not_started');
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('a confirmed pre-acceptance cancellation settles without requesting nonexistent output',async()=>{
 class CancelledPeer extends ExecutionPeer {async request(method,payload){if(method==='query')return {...this.identity,executionId:payload.executionId,state:'not_started',neverStarted:true,scopeConfirmed:true,reason:'CANCELLED_BEFORE_ACCEPTANCE'};return super.request(method,payload);}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-tombstone-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new CancelledPeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','cancelled before accept','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');assert.equal(peer.requests.some(item=>item.method==='readOutput'),false);assert.equal(peer.starts,0);assert.equal((await call(app,'execution.list',{id:'one'})).executions[0].state,'not_started');
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('aborting the real SDK invocation sends cancellation for only its durable execution identity',async()=>{
 class RunningPeer extends ExecutionPeer {async request(method,payload){if(method==='cancel'){this.requests.push({method,payload});const record=this.records.get(payload.executionId);record.receipt={...record.receipt,state:'stopped',cancelReason:'user',scopeConfirmed:true,sequence:4};return structuredClone(record.receipt);}const result=await super.request(method,payload);if(method==='start'){this.records.get(payload.executionId).receipt={...result,state:'running',scopeConfirmed:false};return structuredClone(this.records.get(payload.executionId).receipt);}return result;}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-abort-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new RunningPeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','run','send');await call(app,'send',{intentId:'send'});await until(()=>peer.starts===1);const id=[...peer.records.keys()][0];await execution.withSnapshot(async snapshot=>{assert.equal(snapshot.known,true);assert.deepEqual(snapshot.pendingControlProductIds,['one']);assert.deepEqual(snapshot.pendingBindingIds,[peer.records.get(id).request.context.bindingId]);});const stopped=await native.stop('one','user-stop');await call(app,'stop',{id:'one',stopId:stopped.pendingAbort.stopId});assert.deepEqual(peer.requests.filter(value=>value.method==='cancel').map(value=>value.payload),[{executionId:id,reason:'user'}]);const list=await call(app,'execution.list',{id:'one'});assert.equal(list.executions[0].state,'stopped');assert.equal(list.executions[0].scopeConfirmed,true);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('environment cleanup stops only commands owned by its bound SDK conversation and confirms their scope',async()=>{
 class RunningPeer extends ExecutionPeer {async request(method,payload){if(method==='cancel'){this.requests.push({method,payload});const record=this.records.get(payload.executionId);record.receipt={...record.receipt,state:'stopped',cancelReason:'user',scopeConfirmed:true,sequence:4};return structuredClone(record.receipt);}const value=await super.request(method,payload);if(method==='start'){this.records.get(payload.executionId).receipt={...value,state:'running',scopeConfirmed:false};return structuredClone(this.records.get(payload.executionId).receipt);}return value;}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-cleanup-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new RunningPeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();for(const id of ['one','two']){await call(app,'create',{creationId:id});await native.create(id,'run',id);await call(app,'send',{intentId:id});}await until(()=>peer.starts===1);const first=[...peer.records.values()].find(value=>value.request.context.productId==='one').receipt;
  const env=await execution.locations.environment({id:first.context.bindingId,location:{id:'default',name:'default',version:1,path:configuration().workspacePath,environment:'termux'},projectId:null,sourceProductId:'one',controlProductId:'one',sdkConversationId:first.context.sdkConversationId});await env.cleanup(BACKGROUND_CONTEXT);await until(()=>peer.starts===2);const second=[...peer.records.values()].find(value=>value.request.context.productId==='two').receipt;assert.equal((await peer.request('query',{executionId:first.executionId})).state,'stopped');assert.equal((await peer.request('query',{executionId:second.executionId})).state,'running');assert.deepEqual(peer.requests.filter(value=>value.method==='cancel').map(value=>value.payload.executionId),[first.executionId]);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('a pending control owner keeps project association occupied even after its live SDK pointers retire',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-control-')),native=new SqliteSendAuthority(join(dir,'native.sqlite'));let pending=true;
 const app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,locationEdits:native,locations:{inspect:async w=>({state:'available',identity:'directory:'+w.path})},effects:{withSnapshot:async fn=>fn({known:true,pendingBindingIds:[],pendingControlProductIds:pending?['one']:[]})}});
 try{await app.start();await call(app,'create',{creationId:'one'});let catalog=await call(app,'projects.get');catalog=await call(app,'workspaces.create',{operationId:'workspace',expectedVersion:catalog.version,id:'other',name:'other',path:'/other'});catalog=await call(app,'projects.create',{operationId:'project',expectedVersion:catalog.version,id:'other',name:'other',workspaceId:'other'});await assert.rejects(call(app,'projects.select',{operationId:'blocked',expectedVersion:catalog.version,id:'one',projectId:'other'}),{code:'LOCATION_BUSY'});pending=false;const moved=await call(app,'projects.select',{operationId:'released',expectedVersion:catalog.version,id:'one',projectId:'other'});assert.equal(moved.selection.projectId,'other');
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

test('large split UTF-8 output has a complete raw reference readable through the same execution namespace',async()=>{
 const raw=Buffer.from('世界\n'.repeat(20000));
 class LargePeer extends ExecutionPeer {async request(method,payload){if(method==='readOutput'){const cursor=payload.cursor,offset=cursor*4093,data=raw.subarray(offset,offset+4093);return {...this.identity,executionId:payload.executionId,cursor,nextCursor:cursor+(data.length?1:0),chunks:data.length?[{sequence:cursor+1,stream:'stdout',data:data.toString('base64')}]:[]};}if(method==='readRawOutput')return {...this.identity,executionId:payload.executionId,offset:payload.offset,totalBytes:raw.length,captureIncomplete:false,data:raw.subarray(payload.offset,payload.offset+payload.length).toString('base64')};const result=await super.request(method,payload);if(method==='start'){const record=this.records.get(payload.executionId);record.receipt={...result,outputBytes:raw.length,outputCursor:Math.ceil(raw.length/4093),rawSha256:createHash('sha256').update(raw).digest('hex')};return structuredClone(record.receipt);}return result;}}
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-output-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new LargePeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','large output','send');await call(app,'send',{intentId:'send'});await until(async()=>(await call(app,'sendStatus',{intentId:'send'})).submission?.status==='done');const record=(await call(app,'execution.list',{id:'one'})).executions[0];const opened=await call(app,'open',{id:'one'});assert.ok(JSON.stringify(opened).includes('Full output:'),'public tool history must include its full output reference');assert.ok(JSON.stringify(opened).includes(record.outputRef));assert.ok(!JSON.stringify(opened).includes('�'));
  const page=await call(app,'execution.readOutput',{id:'one',executionId:record.executionId,cursor:0});assert.equal(page.executionId,record.executionId);assert.deepEqual(Buffer.from(page.chunks[0].data,'base64'),raw.subarray(0,4093));await assert.rejects(call(app,'execution.readOutput',{id:'unrelated',executionId:record.executionId,cursor:0}),{code:'EXECUTION_NOT_FOUND'});
  const env=await execution.locations.environment({id:record.context.bindingId,location:{id:'default',name:'default',version:1,path:configuration().workspacePath,environment:'termux'},projectId:null,sourceProductId:'one',controlProductId:'one',sdkConversationId:record.context.sdkConversationId});assert.equal(env.id,peer.identity.namespace);const result=await env.readBinaryFile(record.outputRef,BACKGROUND_CONTEXT);assert.equal(result.ok,true);assert.deepEqual(Buffer.from(result.value),raw);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});

for(const stage of ['intent-persisted','accepted','output-checkpoint','before-result'])test(`hard death at ${stage} reconnects the same execution without repeating its effect`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-kill-'));let native,peer,app;
 try{const child=spawn(process.execPath,['validation/execution-crash-child.mjs',dir,stage],{stdio:'ignore'});const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Child fault boundary timeout'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});assert.notEqual(code,0);assert.equal(await readFile(join(dir,'cut.txt'),'utf8'),stage);
  native=new SqliteSendAuthority(join(dir,'native.sqlite'));peer=new PersistentExecutionPeer(dir);const execution=new ManagedExecution({channel:peer,authority:native});app=new Application({...executionConfiguration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});await app.start();await until(async()=>(await call(app,'sendStatus',{intentId:'crash-send'})).submission?.status==='done');const list=await call(app,'execution.list',{id:'crash-conversation'});assert.equal(list.executions.length,1);assert.equal(await readFile(join(dir,'effects.txt'),'utf8'),list.executions[0].executionId+'\n');const history=await call(app,'open',{id:'crash-conversation'});assert.equal(history.entries.filter(entry=>entry.role==='tool').length,1);assert.equal(history.entries.find(entry=>entry.role==='tool').text,'durable-世界');
 }finally{await app?.close();native?.close();peer?.close();await rm(dir,{recursive:true,force:true});}
});

test('startup verifies pending external evidence before publishing ready or allowing recovered progress',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-execution-startup-'));let native,peer,app,release;
 try{const child=spawn(process.execPath,['validation/execution-crash-child.mjs',dir,'accepted'],{stdio:'ignore'});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Child timeout'));},15000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});assert.equal(await readFile(join(dir,'cut.txt'),'utf8'),'accepted');
  native=new SqliteSendAuthority(join(dir,'native.sqlite'));peer=new PersistentExecutionPeer(dir);const id=(await peer.request('list',{})).executions[0].executionId;peer.loseSupervision(id);
  let reached;const observed=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{release=resolve;});let intercepted=false;
  const channel={request:async(method,payload)=>{if(method==='query'&&!intercepted){intercepted=true;reached();await gate;}return peer.request(method,payload);}};
  const execution=new ManagedExecution({channel,authority:native});app=new Application({...executionConfiguration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});const starting=app.start();await Promise.race([observed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Recovery did not query existing execution')),5000))]);assert.equal(app.status().phase,'configuring');release();await starting;assert.equal((await call(app,'execution.list',{id:'crash-conversation'})).executions[0].state,'unknown');
 }finally{release?.();await app?.close();native?.close();peer?.close();await rm(dir,{recursive:true,force:true});}
});


test('the installed SDK read tool reads the adopted Termux namespace without starting a shell',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'managed-file-read-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),bytes=Buffer.from('first\n世界\nlast\n');
 class FilePeer extends ExecutionPeer {async request(method,payload){
  const path='/termux/default-workspace/source.txt',info={name:'source.txt',path,kind:'file',size:bytes.length,mtimeMs:1};
  if(method==='file.stat')return payload.path===path?{ok:true,value:info}:{ok:false,error:{code:'not_found'}};
  if(method==='file.open')return {ok:true,value:{handle:'reader',epoch:'one',namespace:this.identity.namespace,info}};
  if(method==='file.info')return {ok:true,value:info};
  if(method==='file.close')return {ok:true,value:null};
  if(method==='file.read')return {ok:true,value:{handle:'reader',epoch:'one',namespace:this.identity.namespace,offset:payload.offset,data:bytes.subarray(payload.offset,payload.offset+payload.length).toString('base64')}};
  return super.request(method,payload);
 }}
 const peer=new FilePeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration('read',{path:'source.txt',offset:2,limit:1}),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','read the real location','read');await call(app,'send',{intentId:'read'});await until(async()=>(await call(app,'sendStatus',{intentId:'read'})).submission?.status==='done');
 const opened=await call(app,'open',{id:'one'});assert.equal(opened.entries.find(entry=>entry.role==='tool')?.text,'世界<harness>\n[info] 2 more lines in file. Use offset=3 to continue.\n</harness>');assert.equal(peer.starts,0);assert.equal((await call(app,'execution.list',{id:'one'})).executions.length,0);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});


test('arbitrary shell commands from two conversations share a durable environment writer queue',async()=>{
 class HeldPeer extends ExecutionPeer {
  allowFinish=false;
  async request(method,payload){
   if(method==='query'&&this.allowFinish){const record=this.records.get(payload.executionId);if(record?.receipt.state==='running')record.receipt={...record.receipt,state:'completed',scopeConfirmed:true,sequence:4};}
   const value=await super.request(method,payload);
   if(method==='start'&&!this.allowFinish){const record=this.records.get(payload.executionId);record.receipt={...value,state:'running',scopeConfirmed:false};return structuredClone(record.receipt);}
   return value;
  }
 }
 const dir=await mkdtemp(join(tmpdir(),'managed-writer-queue-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new HeldPeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution});
 try{await app.start();for(const id of ['first','second']){await call(app,'create',{creationId:id});await native.create(id,'run',id);await call(app,'send',{intentId:id});if(id==='first')await until(()=>peer.starts===1);}
  await until(async()=>(await call(app,'execution.list',{id:'second'})).executions.length===1);
  assert.equal(peer.starts,1,'the second unknown-effect command must not start while the first occupies the environment');
  peer.allowFinish=true;await until(async()=>(await call(app,'sendStatus',{intentId:'second'})).submission?.status==='done');assert.equal(peer.starts,2);
 }finally{peer.allowFinish=true;await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});


test('the real SDK write tool persists one file plan and exposes its verified original-file change',async()=>{
 class FilePeer extends ExecutionPeer {
  plans=new Map();data=Buffer.from('before\n');
  position={namespace:this.identity.namespace,canonicalPath:'/termux/default-workspace/source.txt',objectId:'1:9',ancestorObjectIds:['1:2']};
  async request(method,payload){
   if(method==='file.describe')return {ok:true,value:{protocol:1,namespace:this.identity.namespace,applyArgvPrefix:['/termux/python','/termux/file_service.py','apply','/termux/records']}};
   if(method==='file.resolveWrite')return {ok:true,value:this.position};
   if(method==='file.prepareWrite'){const plan={...payload,requestDigest:hash(payload),position:this.position,namespace:this.identity.namespace,argv:['/termux/python','/termux/file_service.py','apply','/termux/records',payload.operationId]};this.plans.set(payload.operationId,plan);return {ok:true,value:plan};}
   if(method==='file.writeResult'){const plan=this.plans.get(payload.operationId);return {ok:true,value:{protocol:1,operationId:payload.operationId,namespace:this.identity.namespace,requestDigest:plan.requestDigest,state:'completed',original:true,path:plan.path,canonicalPath:plan.path,after:{size:this.data.length,sha256:createHash('sha256').update(this.data).digest('hex')},diff:{available:true,text:'--- before\n+++ after\n-before\n+after-世界\n'}}};}
   const value=await super.request(method,payload);if(method==='start'){const plan=this.plans.get(this.records.get(payload.executionId).request.command.argv.at(-1));this.data=Buffer.from(plan.data,'base64');}return value;
  }
 }
 const dir=await mkdtemp(join(tmpdir(),'managed-file-write-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new FilePeer(),execution=new ManagedExecution({channel:peer,authority:native}),options={...configuration('write',{path:'source.txt',content:'after-世界\n'}),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,execution};let app=new Application(options);
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','write the original','write');await call(app,'send',{intentId:'write'});await until(async()=>(await call(app,'sendStatus',{intentId:'write'})).submission?.status==='done');
  assert.equal((await call(app,'open',{id:'one'})).entries.find(entry=>entry.role==='tool')?.text,'Successfully wrote to source.txt');assert.equal(peer.starts,1);assert.equal(peer.data.toString(),'after-世界\n');
  const changes=await call(app,'files.list',{id:'one'});assert.equal(changes.changes.length,1);assert.equal(changes.changes[0].original,true);assert.equal(changes.changes[0].state,'completed');assert.ok(changes.changes[0].bindingId);assert.equal(changes.changes[0].path,'/termux/default-workspace/source.txt');assert.match(changes.changes[0].diff.text,/-before\n\+after-世界/);
  await app.close();app=new Application({...options,execution:new ManagedExecution({channel:peer,authority:native})});await app.start();assert.equal((await call(app,'files.list',{id:'one'})).changes[0].operationId,changes.changes[0].operationId);assert.equal(peer.starts,1);
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});


test('an ended helper with unconfirmed original-file effects still occupies its project and writer domain',async()=>{
 class UncertainFilePeer extends ExecutionPeer {
  plan;verified=false;
  position={namespace:this.identity.namespace,canonicalPath:'/termux/default-workspace/source.txt',objectId:'1:9',ancestorObjectIds:['1:2']};
  async request(method,payload){
   const prefix=['/termux/python','/termux/file_service.py','apply','/termux/records'];
   if(method==='file.describe')return {ok:true,value:{protocol:1,namespace:this.identity.namespace,applyArgvPrefix:prefix}};
   if(method==='file.resolveWrite')return {ok:true,value:this.position};
   if(method==='file.prepareWrite'){this.plan={...payload,requestDigest:hash(payload),position:this.position,namespace:this.identity.namespace,argv:[...prefix,payload.operationId]};return {ok:true,value:this.plan};}
   if(method==='file.writeResult')return {ok:true,value:{operationId:payload.operationId,namespace:this.identity.namespace,requestDigest:this.plan.requestDigest,state:'applying'}};
   if(method==='file.verifyWrite')return {ok:true,value:{operationId:payload.operationId,namespace:this.identity.namespace,requestDigest:this.plan.requestDigest,matchesExpected:this.verified,observed:{size:5,sha256:createHash('sha256').update('after').digest('hex')},scopeConfirmed:false}};
   return super.request(method,payload);
  }
 }
 const dir=await mkdtemp(join(tmpdir(),'managed-file-uncertain-')),native=new SqliteSendAuthority(join(dir,'native.sqlite')),peer=new UncertainFilePeer(),execution=new ManagedExecution({channel:peer,authority:native}),app=new Application({...configuration('write',{path:'source.txt',content:'after'}),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,locationEdits:native,execution});
 try{await app.start();await call(app,'create',{creationId:'one'});await native.create('one','write','write');await call(app,'send',{intentId:'write'});await until(async()=>(await call(app,'sendStatus',{intentId:'write'})).submission?.status==='done');assert.equal(peer.starts,1);
  await execution.withSnapshot(async snapshot=>{assert.equal(snapshot.known,false);assert.deepEqual(snapshot.pendingControlProductIds,['one']);assert.equal(snapshot.pendingBindingIds.length,1);});
  const catalog=await call(app,'projects.get');await assert.rejects(call(app,'workspaces.update',{operationId:'do-not-rebind',expectedVersion:catalog.version,id:'default',path:'/different'}),{code:'LOCATION_UNKNOWN'});
  peer.verified=true;await execution.withSnapshot(async snapshot=>{assert.equal(snapshot.known,true);assert.deepEqual(snapshot.pendingBindingIds,[]);});const verified=await call(app,'files.list',{id:'one'});assert.equal(verified.changes[0].state,'completed');assert.equal(verified.changes[0].diff.available,false);assert.equal(peer.starts,1,'verification must not re-execute the write');
 }finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}
});
