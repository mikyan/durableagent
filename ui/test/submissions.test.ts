import {expect,it} from 'vitest';
import {ApplicationClient} from '../src/client';
import {SubmissionCoordinator} from '../src/submissions';
import {DraftCoordinator} from '../src/drafts';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';

it('reconciles the saved composer by read-only queries when the native ACK committed but its send response was lost',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
    const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    if(request.method==='send'){void native.fixtureAdmission(String(request.payload?.intentId));return;}
    if(request.method==='sendStatus')void native.fixtureStatus(String(request.payload?.intentId)).then(reply);
    if(request.method==='sendList')void native.listSends(request.payload).then(async page=>reply({items:await Promise.all(page.intents.map(intent=>native.fixtureStatus(intent.intentId)))}));
  }},30);
  const drafts=new DraftCoordinator(()=>client,()=>{});
  const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},(ack,epoch)=>drafts.confirmAdmission(ack,epoch));
  try{
    await drafts.read('one');drafts.edit('one','这次已接纳的输入');const captured=await drafts.freeze('one');
    expect(await submissions.create(captured.frozen,captured.editEpoch,native.read('one').submissionContext!)).toBe(false);
    const intentId=submissions.view('one').items[0].intentId;
    expect(native.read('one')).toMatchObject({text:'',revision:2});
    await submissions.refresh('one');
    expect(drafts.view('one')).toMatchObject({text:'',revision:2,status:'saved'});
    expect(await submissions.retry(intentId)).toBe(true);
    drafts.edit('one','后来新写的草稿');await drafts.flush('one');
    expect(native.read('one')).toMatchObject({text:'后来新写的草稿',revision:3});
    expect(requests.filter(request=>request.method==='send').map(request=>request.payload)).toEqual([{intentId}]);
    expect(requests.filter(request=>request.method==='input.createSend')).toHaveLength(1);
    expect(requests.some(request=>request.method==='input.clear')).toBe(false);
  }finally{submissions.dispose();drafts.dispose();client.dispose();}
});

it('uses a late proven ACK clear after a newer status read while preserving an ABA local edit',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  let release!:()=>void,committed!:()=>void;const acknowledgementCommitted=new Promise<void>(resolve=>{committed=resolve;});
  const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
    const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    if(request.method==='send')void native.fixtureAdmission(String(request.payload?.intentId)).then(value=>{release=()=>reply(value);committed();});
    if(request.method==='sendList')void native.listSends(request.payload).then(async page=>reply({items:await Promise.all(page.intents.map(intent=>native.fixtureStatus(intent.intentId)))}));
  }});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},(ack,epoch)=>drafts.confirmAdmission(ack,epoch));
  try{
    await drafts.read('one');drafts.edit('one','原文');const captured=await drafts.freeze('one');
    const sending=submissions.create(captured.frozen,captured.editEpoch,native.read('one').submissionContext!);await acknowledgementCommitted;
    drafts.edit('one','新的编辑');drafts.edit('one','原文');
    await submissions.refresh('one');
    expect(drafts.view('one')).toMatchObject({text:'原文',status:'conflict'});
    expect(native.read('one')).toMatchObject({text:'',revision:2});
    release();expect(await sending).toBe(true);
    expect(drafts.view('one')).toMatchObject({text:'原文',revision:3,status:'saved'});
    expect(native.read('one')).toMatchObject({text:'原文',revision:3});
    expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
  }finally{submissions.dispose();drafts.dispose();client.dispose();}
});

it('commits an immutable native intent before SDK admission and retry cannot substitute a later draft',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'原输入'});
  const frozen=native.apply({protocol:1,connectionId:'test',requestId:'freeze',method:'input.freeze',payload:{id:'one',expectedRevision:1,operationId:'freeze-one'}}) as Awaited<ReturnType<InputPlatform['readFrozen']>>;
  const requests:ApplicationRequest[]=[];let loseAdmission=true;
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
    const respond=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    if(request.method==='send'){expect(native.intents.has(String(request.payload?.intentId))).toBe(true);void native.fixtureAdmission(String(request.payload?.intentId)).then(value=>{if(loseAdmission){loseAdmission=false;return;}respond(value);});}
    if(request.method==='sendStatus')void native.fixtureStatus(String(request.payload?.intentId)).then(respond);
  }},30);
  const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},async()=>{});
  try{
    await submissions.create(frozen,1,native.read('one').submissionContext!);
    const first=submissions.view('one').items[0];expect(first.durable).toBe('saved');expect(first.error).toContain('尚未收到确认');
    native.drafts.set('one',{...native.read('one'),revision:3,stateVersion:3,text:'后来的另一份草稿'});
    await submissions.retry(first.intentId);
    expect(submissions.view('one').items[0].status?.accepted).toBe(true);
    expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
    expect(requests.find(request=>request.method==='send')?.payload).toEqual({intentId:first.intentId});
    expect(native.intents.size).toBe(1);expect((await native.readFrozen(native.intents.get(first.intentId)!.inputToken)).text).toBe('原输入');
  }finally{submissions.dispose();client.dispose();}
});

it('recovers offline durable intents by queries only and an explicit new send of identical text has a distinct identity',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'相同正文'});
  const freeze=(operationId:string)=>native.apply({protocol:1,connectionId:'test',requestId:operationId,method:'input.freeze',payload:{id:'one',expectedRevision:native.read('one').revision,operationId}}) as Awaited<ReturnType<InputPlatform['readFrozen']>>;
  const requests:ApplicationRequest[]=[];let ready=false;
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
    const respond=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    if(request.method==='send')void native.fixtureAdmission(String(request.payload?.intentId)).then(respond);
    if(request.method==='sendStatus')void native.fixtureStatus(String(request.payload?.intentId)).then(respond);
    if(request.method==='sendList')void native.listSends(request.payload).then(async page=>respond({items:await Promise.all(page.intents.map(intent=>native.fixtureStatus(intent.intentId))),next:page.next}));
  }});
  let submissions=new SubmissionCoordinator(()=>client,()=>ready,()=>{},async()=>{});
  try{
    await submissions.create(freeze('first'),1,native.read('one').submissionContext!);const first=submissions.view('one').items[0].intentId;
    expect(native.intents.size).toBe(1);expect(requests.some(request=>request.method==='send')).toBe(false);
    submissions.dispose();submissions=new SubmissionCoordinator(()=>client,()=>ready,()=>{},async()=>{});await submissions.refresh('one');
    expect(submissions.view('one').items[0].intentId).toBe(first);ready=true;await submissions.refresh('one');
    expect(requests.some(request=>request.method==='send')).toBe(false);
    await submissions.retry(first);expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
    native.drafts.set('one',{...native.read('one'),revision:3,stateVersion:3,text:'相同正文'});
    await submissions.create(freeze('second'),2,native.read('one').submissionContext!);
    const identities=submissions.view('one').items.map(item=>item.intentId);expect(new Set(identities).size).toBe(2);
    expect([...native.intents.values()].map(intent=>intent.preview.text)).toEqual(['相同正文','相同正文']);
  }finally{submissions.dispose();client.dispose();}
});

it('persists stop without waiting for Agent JS and prevents a send waiting on control from overtaking that stop',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'停止前点击发送'});
  const frozen=native.apply({protocol:1,connectionId:'test',requestId:'freeze',method:'input.freeze',payload:{id:'one',expectedRevision:1,operationId:'freeze'}}) as Awaited<ReturnType<InputPlatform['readFrozen']>>;
  const requests:ApplicationRequest[]=[];let firstControl=true,release!:()=>void;
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    const response=()=>void native.handle(request).then(value=>client.receive(value));
    if(request.method==='input.readControl'&&firstControl){firstControl=false;release=response;return;}
    if(request.method.startsWith('input.'))response();
  }});
  const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},async()=>{});
  try{
    const creating=submissions.create(frozen,1,native.read('one').submissionContext!);
    expect(await submissions.stop('one')).toBe(true);
    expect((await native.readControl('one')).stoppedThrough).toBe(1);
    expect(submissions.view('one').control?.pendingAbort).toBeTruthy();
    release();await creating;
    expect(native.intents.size).toBe(0);expect(requests.some(request=>request.method==='send')).toBe(false);
    expect(requests.findIndex(request=>request.method==='input.stop')).toBeLessThan(requests.findIndex(request=>request.method==='stop'));
    expect(submissions.view('one').stopping).toBe(false);
  }finally{submissions.dispose();client.dispose();}
});

it('retries the same accepted SDK intent to repair a missing native ACK because status queries are read-only',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'固定输入'});
  const frozen=native.apply({protocol:1,connectionId:'test',requestId:'freeze',method:'input.freeze',payload:{id:'one',expectedRevision:1,operationId:'freeze'}}) as Awaited<ReturnType<InputPlatform['readFrozen']>>;
  const requests:ApplicationRequest[]=[];let receipt:import('../../runtime/src/submission-protocol').AdmissionReceipt|undefined,admissions=0;
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
    const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    void (async()=>{
      const intent=await native.readSend(String(request.payload?.intentId));
      if(request.method==='send'){
        if(!receipt){admissions++;receipt={protocol:1,intentId:intent.intentId,id:intent.id,inputToken:intent.inputToken,inputRevision:intent.inputRevision,inputDigest:intent.inputDigest,context:intent.context,queue:intent.queue,controlGeneration:intent.controlGeneration,bindingId:'binding-stable',submissionId:19};await native.markDeliveryUnknown(intent.intentId);reply({intent:await native.readSend(intent.intentId),accepted:true,receipt,submission:{status:'queued'},waiting:{code:'ACK_UNCONFIRMED',message:'SDK已接纳，本机回执尚未确认'}});}
        else{const acknowledgement=await native.confirmAdmission(intent.intentId,receipt);reply({intent:acknowledgement.intent,accepted:true,receipt,submission:{status:'queued'},acknowledgement});}
      }else if(request.method==='sendStatus')reply({intent,accepted:true,receipt,submission:{status:'queued'}});
    })();
  }});
  const acks:unknown[]=[];const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},async ack=>{acks.push(ack);});
  try{
    await submissions.create(frozen,1,native.read('one').submissionContext!);const intentId=submissions.view('one').items[0].intentId;
    expect((await native.readSend(intentId)).delivery).toBe('uncertain');expect(native.read('one').text).toBe('固定输入');expect(acks).toHaveLength(0);
    await submissions.retry(intentId);
    expect((await native.readSend(intentId)).delivery).toBe('acknowledged');expect(acks).toHaveLength(1);expect(native.read('one').text).toBe('');
    expect(admissions).toBe(1);expect(requests.filter(request=>request.method==='send').map(request=>request.payload)).toEqual([{intentId},{intentId}]);expect(native.intents.size).toBe(1);
  }finally{submissions.dispose();client.dispose();}
});

it('retries an unknown native intent commit using its original action and frozen payload before any SDK call',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'原生提交前固定的输入'});
  const frozen=native.apply({protocol:1,connectionId:'test',requestId:'freeze',method:'input.freeze',payload:{id:'one',expectedRevision:1,operationId:'freeze'}}) as Awaited<ReturnType<InputPlatform['readFrozen']>>;
  const requests:ApplicationRequest[]=[];let loseCreate=true;
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method.startsWith('input.')){void native.handle(request).then(response=>{if(request.method==='input.createSend'&&loseCreate){loseCreate=false;return;}client.receive(response);});return;}
    const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
    if(request.method==='sendStatus')void native.fixtureStatus(String(request.payload?.intentId)).then(reply);
    if(request.method==='send')void native.fixtureAdmission(String(request.payload?.intentId)).then(reply);
  }},30);
  const submissions=new SubmissionCoordinator(()=>client,()=>true,()=>{},async()=>{});
  try{
    expect(await submissions.create(frozen,1,native.read('one').submissionContext!)).toBe(false);
    expect(submissions.view('one').items[0].durable).toBe('unknown');expect(requests.some(request=>request.method==='send')).toBe(false);
    native.drafts.set('one',{...native.read('one'),text:'后来改成另一份正文',revision:2,stateVersion:2});
    expect(await submissions.retry(submissions.view('one').items[0].intentId)).toBe(true);
    const creates=requests.filter(request=>request.method==='input.createSend');expect(creates).toHaveLength(2);expect(creates[1].payload).toEqual(creates[0].payload);
    expect(native.intents.size).toBe(1);expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
    expect((await native.readFrozen([...native.intents.values()][0].inputToken)).text).toBe('原生提交前固定的输入');expect(native.read('one').text).toBe('后来改成另一份正文');
  }finally{submissions.dispose();client.dispose();}
});
