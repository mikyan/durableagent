import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Application} from '../dist/application.js';
import {validationConfiguration} from '../dist/application-validation.js';
import {SqliteSendAuthority} from './submission-authority.mjs';
import {ModelConnections} from '../dist/model-connections.js';
import {fixtureTransport} from '../dist/transport.js';
const cases=[];const test=(name,run)=>cases.push({name,run});let policyTempRoot;
export function registerExtensionPolicyChecks(register){for(const {name,run}of cases)register(name,{timeout:30000},run);}
export async function runExtensionPolicyChecks(onCase,{tempRoot}={}){policyTempRoot=tempRoot;try{for(const {name,run}of cases){try{await run();await onCase({name,passed:true});}catch(error){throw Object.assign(Error(`Extension policy check failed: ${name}`),{diagnostic:{name:error?.name,code:error?.code,operator:error?.operator,frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at\s/.test(line)).slice(0,8)}});}}}finally{policyTempRoot=undefined;}}
export const call=async(app,method,payload={})=>{const response=await app.request({protocol:1,connectionId:'extension-policy',requestId:crypto.randomUUID(),method,payload});if(!response.ok)throw Object.assign(Error(response.error.message),{code:response.error.code});return response.value;};
async function fixture(run,extra={}){const dir=await mkdtemp(join(policyTempRoot??tmpdir(),'extensions-')),native=new SqliteSendAuthority(join(dir,'input.sqlite'));const options={...validationConfiguration(),path:join(dir,'sdk.sqlite'),inputs:native,sends:native,routes:native,...extra};let app=new Application(options);try{await app.start();await run({app,native,options,reopen:async()=>{await app.close();app=new Application(options);await app.start();return app;}});}finally{await app.close();native.close();await rm(dir,{recursive:true,force:true});}}
test('explicit stable-target transfer preserves target drafts and replays one durable submission after reopen',()=>fixture(async({app,native,reopen})=>{
 await call(app,'create',{creationId:'source',title:'同名'});await call(app,'create',{creationId:'target',title:'同名'});
 const draft=native.save('target','目标尚未发送的草稿🌍');
 const source=await call(app,'routing.query',{id:'source'}),target=await call(app,'routing.query',{id:'target'});
 assert.equal(source.id,'source');assert.equal(target.id,'target');assert.equal(target.entries,undefined);
 const payload={actionId:'explicit-route',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'仅明确转交的正文',expectedContext:target.context,expectedControlVersion:target.control.version};
 const accepted=await call(app,'routing.send',payload);assert.equal(accepted.accepted,true);assert.equal(accepted.intent.source.id,'source');assert.deepEqual(native.draft('target'),draft);
 const again=await call(app,'routing.send',payload);assert.equal(again.receipt.submissionId,accepted.receipt.submissionId);assert.deepEqual(native.draft('target'),draft);
 await assert.rejects(call(app,'routing.send',{...payload,text:'其他正文'}),{code:'INPUT_OPERATION_CONFLICT'});
 app=await reopen();const recovered=await call(app,'routing.send',payload);assert.equal(recovered.receipt.submissionId,accepted.receipt.submissionId);assert.deepEqual(native.draft('target'),draft);
 assert.equal((await call(app,'history',{id:'target'})).items.filter(item=>item.role==='user').length,1);
 assert.equal((await call(app,'history',{id:'source'})).items.filter(item=>item.role==='user').length,0);
}));

test('source stop before target commit rolls back, while stop after commit preserves the accepted independent target and original receipt',async()=>{
 for(const stage of ['after-sdk-submit','before-native-ack']){
  let injected=false,nativeRef;
  await fixture(async({app,native,reopen})=>{nativeRef=native;
   await call(app,'create',{creationId:'source'});await call(app,'create',{creationId:'target'});
   const source=await call(app,'routing.query',{id:'source'}),target=await call(app,'routing.query',{id:'target'}),draft=native.save('target','新的未发送草稿');
   const payload={actionId:'stop-race',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'不会因来源恢复而换代重发',expectedContext:target.context,expectedControlVersion:target.control.version};
   if(stage==='after-sdk-submit'){
    await assert.rejects(call(app,'routing.send',payload),{code:'SOURCE_STOPPED'});
    assert.equal((await call(app,'sendStatus',{intentId:payload.actionId})).accepted,false);
    app=await reopen();assert.equal((await call(app,'sendStatus',{intentId:payload.actionId})).accepted,false);
    assert.equal((await call(app,'history',{id:'target'})).items.length,0);
   }else{
    const result=await call(app,'routing.send',payload);assert.equal(result.accepted,true);
    app=await reopen();const same=await call(app,'routing.send',payload);assert.deepEqual(same.receipt,result.receipt);
    assert.equal((await call(app,'history',{id:'target'})).items.filter(x=>x.role==='user').length,1);
   }
   assert.deepEqual(native.draft('target'),draft);
  },{submissionBoundary:async(at,intent)=>{if(at===stage&&intent.source&&!injected){injected=true;await nativeRef.stop('source','stop-source');}}});
 }
});
test('actual SDK routing tool derives its source, submits explicit content once and leaves ordinary input in its own conversation',async()=>{
 let requests=0,toolChosen=false;const encoded=[];
 await fixture(async({app,native,reopen})=>{
  await call(app,'create',{creationId:'source'});await call(app,'create',{creationId:'target'});
  const targetDraft=native.save('target','目标草稿不能被工具覆盖');
  const originalDraft=native.draft.bind(native);native.draft=id=>{if(id==='target')throw Error('Route must not read the target author draft');return originalDraft(id);};
  const original=await native.create('source','请把明确正文交给目标','source-input');await call(app,'send',{intentId:original.intentId});
  const deadline=Date.now()+8000;let target;
  do{target=(await call(app,'sendList',{id:'target'})).items[0];if(target?.submission?.status==='done'&&(await call(app,'open',{id:'source'})).phase==='done')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<deadline);
  assert.equal(target?.accepted,true,JSON.stringify(await call(app,'history',{id:'source'})));
  assert.equal(target.intent.source.id,'source');assert.ok(target.intent.source.taskId>0);assert.equal(target.intent.preview.text,'只有这份明确正文');
  native.draft=originalDraft;assert.equal(requests,3);assert.deepEqual(native.draft('target'),targetDraft);
  assert.equal(JSON.stringify(await call(app,'history',{id:'source'})).includes(targetDraft.text),false);assert.equal(encoded.some(body=>body.includes(targetDraft.text)),false);
  assert.equal((await call(app,'history',{id:'source'})).items.filter(x=>x.role==='user').length,1);
  assert.equal((await call(app,'history',{id:'target'})).items.filter(x=>x.role==='user').length,1);
  app=await reopen();assert.equal(requests,3);assert.equal((await call(app,'sendStatus',{intentId:target.intent.intentId})).receipt.submissionId,target.receipt.submissionId);
 },validationConfiguration({observeRequest:body=>encoded.push(body),requested:()=>requests++,toolName:()=>{if(toolChosen)return;toolChosen=true;return 'conversation_transfer';},toolArguments:()=>({id:'target',text:'只有这份明确正文'})}));
});
test('catalog distinguishes UI-only, Agent-only and both-sided contributions; initialization failure remains diagnosable',async()=>{
 await fixture(async({app})=>{await call(app,'create',{creationId:'selected'});const catalog=await call(app,'extensions.get',{id:'selected'}),item=id=>catalog.items.find(x=>x.descriptor.id===id);
 assert.equal(item('timeline').agent.state,'not-provided');assert.equal(item('timeline').ui.state,'packaged');assert.equal(item('routing').ui.state,'not-provided');assert.equal(item('routing').agent.selected,true);assert.equal(item('models').agent.state,'installed');assert.equal(item('models').ui.state,'packaged');assert.equal(JSON.stringify(catalog).includes('mounted'),false);
 });
 const app=new Application({...validationConfiguration(),path:'unused',extensions:[{id:'broken',title:'故障',agent:'broken'}],agentFactories:{broken:()=>{throw Error('Synthetic initialization failure');}}});
 await assert.rejects(app.start(),/broken.*初始化失败/);assert.equal(app.status().phase,'failed');assert.match(app.status().reason,/broken/);await app.close();
});
test('stable target discovery, creation idempotency, missing target, stopped controls and stale location fail through public routing',()=>fixture(async({app,native})=>{
 await call(app,'create',{creationId:'source',title:'重复标题'});await call(app,'create',{creationId:'target',title:'重复标题'});
 const visible=await call(app,'routing.list');assert.deepEqual(visible.items.map(x=>x.id),['source','target']);assert.ok(visible.items.every(x=>!('entries'in x)));
 const a=await call(app,'routing.query',{id:'source'}),b=await call(app,'routing.query',{id:'target'}),source={id:a.id,sdkConversationId:a.context.sdkConversationId,controlGeneration:a.control.generation};
 const made=await call(app,'routing.create',{source,creationId:'made',title:'新目标'}),same=await call(app,'routing.create',{source,creationId:'made',title:'新目标'});assert.equal(made.id,same.id);assert.equal((await call(app,'list')).conversations.length,3);
 await assert.rejects(call(app,'routing.query',{id:'重复标题'}),{code:'NOT_FOUND'});
 const payload={actionId:'invalid',source,id:b.id,text:'明确输入',expectedContext:b.context,expectedControlVersion:b.control.version};
 await assert.rejects(call(app,'routing.send',{...payload,id:'absent'}));
 await assert.rejects(call(app,'routing.send',{...payload,expectedContext:{...b.context,associationVersion:b.context.associationVersion+1}}),{code:'SUBMISSION_CONTEXT_CONFLICT'});
 await native.stop('target','stop-target');await assert.rejects(call(app,'routing.send',payload),{code:'TARGET_STOPPED'});
 await native.stop('source','stop-source');await assert.rejects(call(app,'routing.create',{source,creationId:'blocked'}),{code:'SOURCE_STOPPED'});
 assert.equal((await native.listSends()).intents.length,0);
}));
test('lost native route ACK reconciles the same SDK input while preserving a newer target draft',async()=>{
 let lose=true;
 await fixture(async({app,native,reopen})=>{
 await call(app,'create',{creationId:'source'});await call(app,'create',{creationId:'target'});const source=await call(app,'routing.query',{id:'source'}),target=await call(app,'routing.query',{id:'target'});
 const payload={actionId:'lost-ack',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'固定转交',expectedContext:target.context,expectedControlVersion:target.control.version};
 const original=native.confirmAdmission.bind(native);native.confirmAdmission=async(...args)=>{if(lose){lose=false;throw Error('Synthetic lost ACK');}return original(...args);};
 const first=await call(app,'routing.send',payload);assert.equal(first.accepted,true);assert.equal(first.intent.delivery==='acknowledged',false);const newer=native.save('target','ACK之前保存的新草稿');
 app=await reopen();const repaired=await call(app,'routing.send',payload);assert.equal(repaired.receipt.submissionId,first.receipt.submissionId);assert.equal(repaired.intent.delivery,'acknowledged');assert.deepEqual(native.draft('target'),newer);assert.equal((await call(app,'history',{id:'target'})).items.filter(x=>x.role==='user').length,1);
 });
});
test('actual model Agent tools reuse public configuration and current-model selection without decrypting query credentials',async()=>{
 let reads=0,requests=0,tool=false;const key='synthetic-only-extension-secret',credentials={metadata:async id=>({connectionId:id,state:'configured',configured:true,generation:1}),resolve:async()=>{reads++;return {key,generation:1};}};
 const connections=new ModelConnections({credentials,fetch:fixtureTransport({requested:()=>requests++,aborted:()=>{},toolName:()=>{if(tool)return;tool=true;return 'model_select_current';},toolArguments:()=>({provider:'conn-b',modelId:'mimo-v2.6-flash'})})});
 await fixture(async({app,native})=>{
 await call(app,'models.create',{creationId:'conn-a',expectedVersion:0,name:'A',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
 await call(app,'models.create',{creationId:'conn-b',expectedVersion:1,name:'B',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1'});
 await call(app,'models.setDefault',{expectedVersion:2,selection:{provider:'conn-a',modelId:'mimo-v2.6-flash'}});await call(app,'create',{creationId:'source'});
 assert.equal(reads,0);assert.ok(!JSON.stringify(await call(app,'models.get')).includes(key));assert.equal(reads,0);
 const input=await native.create('source','明确将当前模型切换为 B','model-action');await call(app,'send',{intentId:input.intentId});const deadline=Date.now()+8000;
 while((await call(app,'open',{id:'source'})).phase!=='done'){assert.ok(Date.now()<deadline,JSON.stringify(await call(app,'history',{id:'source'})));await new Promise(r=>setTimeout(r,10));}
 assert.equal((await call(app,'open',{id:'source'})).conversation.model.provider,'conn-b');assert.equal((await call(app,'models.get')).defaultModel.provider,'conn-a');assert.equal(requests,2);assert.ok(!JSON.stringify(await call(app,'history',{id:'source'})).includes(key));
 },{connections,models:connections.models,initialModel:undefined});
});

test('never-accepted source-cancelled route releases location only after coherent absence and a verified source fence, including reopen',async()=>{
 let nativeRef,stop;
 await fixture(async({app,native,reopen})=>{
  nativeRef=native;await call(app,'create',{creationId:'source'});await call(app,'create',{creationId:'target'});
  const source=await call(app,'routing.query',{id:'source'}),target=await call(app,'routing.query',{id:'target'}),request={actionId:'unaccepted-route',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'原代次不得复活',expectedContext:target.context,expectedControlVersion:target.control.version};
  await assert.rejects(call(app,'routing.send',request),{code:'SOURCE_STOPPED'});await call(app,'stop',{id:'source',stopId:stop.pendingAbort.stopId});
  let status=await call(app,'sendStatus',{intentId:request.actionId});assert.equal(status.accepted,false);assert.equal(status.intent.sourceCancelled,true);assert.equal(status.intent.cancelled,false);
  const catalog=await call(app,'projects.get'),edit=operationId=>({operationId,expectedVersion:catalog.version,id:'default',path:'/explicit-after-source-cancel'});
  const list=native.listSends.bind(native);native.listSends=async options=>{const page=await list(options);return {...page,intents:page.intents.map(value=>({...value,delivery:'acknowledged'}))};};
  await assert.rejects(call(app,'workspaces.update',edit('inconsistent-native-ack')),{code:'ADMISSION_INCONSISTENT'});native.listSends=list;
  const control=native.readControl.bind(native);native.readControl=async id=>{if(id==='source')throw Error('Synthetic source authority unavailable');return control(id);};
  await assert.rejects(call(app,'workspaces.update',edit('unknown-control')),/Synthetic source authority unavailable/);assert.ok(await native.readLocationEdit());native.readControl=control;
  app=await reopen();assert.equal(await native.readLocationEdit(),null);const changed=await call(app,'workspaces.update',edit('explicit-after-reopen'));assert.equal(changed.workspaces.find(x=>x.id==='default').path,'/explicit-after-source-cancel');
  status=await call(app,'sendStatus',{intentId:request.actionId});assert.equal(status.accepted,false);assert.equal((await call(app,'history',{id:'target'})).items.length,0);await assert.rejects(call(app,'routing.send',request),{code:'SOURCE_STOPPED'});
 },{submissionBoundary:async(stage,intent)=>{if(stage==='after-sdk-submit'&&intent.source&&!stop)stop=await nativeRef.stop('source','source-stop');}});
});

test('accepted source-cancelled target retains location protection through lost ACK, reopen, active work and unresolved effects',async()=>{
 let nativeRef,stopped=false;const effects={known:true,pendingBindingIds:[]};
 await fixture(async({app,native,reopen})=>{
  nativeRef=native;await call(app,'create',{creationId:'source'});await call(app,'create',{creationId:'target'});const source=await call(app,'routing.query',{id:'source'}),target=await call(app,'routing.query',{id:'target'});
  const request={actionId:'accepted-route',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'独立目标继续运行',expectedContext:target.context,expectedControlVersion:target.control.version};
  const accepted=await call(app,'routing.send',request);assert.equal(accepted.accepted,true);assert.equal(accepted.acknowledged,false);
  const sourceControl=await native.readControl('source');if(sourceControl.pendingAbort)await call(app,'stop',{id:'source',stopId:sourceControl.pendingAbort.stopId});
  const before=await call(app,'projects.get'),edit=operationId=>({operationId,expectedVersion:before.version,id:'default',path:'/explicit-after-work'});
  const current=await call(app,'sendStatus',{intentId:request.actionId});assert.equal(current.intent.sourceCancelled,true);assert.equal(current.intent.cancelled,false);assert.deepEqual(current.receipt,accepted.receipt);
  await assert.rejects(call(app,'workspaces.update',edit('while-target-active')),{code:'LOCATION_BUSY'});
  app=await reopen();assert.deepEqual((await call(app,'sendStatus',{intentId:request.actionId})).receipt,accepted.receipt);await assert.rejects(call(app,'workspaces.update',edit('after-reopen-active')),{code:'LOCATION_BUSY'});
  const targetStop=await native.stop('target','explicit-target-stop');await call(app,'stop',{id:'target',stopId:targetStop.pendingAbort.stopId});
  effects.pendingBindingIds=[accepted.receipt.bindingId];await assert.rejects(call(app,'workspaces.update',edit('unresolved-effect')),{code:'LOCATION_BUSY'});effects.pendingBindingIds=[];
  const changed=await call(app,'workspaces.update',edit('new-explicit-edit'));assert.equal(changed.workspaces.find(x=>x.id==='default').path,'/explicit-after-work');assert.deepEqual((await call(app,'sendStatus',{intentId:request.actionId})).receipt,accepted.receipt);
 },{...validationConfiguration({hang:true}),effects:{withSnapshot:action=>action(structuredClone(effects))},submissionBoundary:async(stage,intent)=>{if(stage==='before-native-ack'&&intent.source&&!stopped){stopped=true;await nativeRef.stop('source','source-stop');throw Error('Synthetic route ACK lost');}}});
});
