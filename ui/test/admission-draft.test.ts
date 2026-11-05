import {expect,it} from 'vitest';
import {ApplicationClient} from '../src/client';
import {DraftCoordinator} from '../src/drafts';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import type {FrozenInput,NativeDraft} from '../../runtime/src/input-protocol';
import type {NativeAdmissionAck} from '../../runtime/src/submission-protocol';

const context={sdkConversationId:1,associationVersion:1,location:{workspaceId:'default',version:1,identity:'workspace-fixture'}};
function acknowledgement(frozen:FrozenInput,draft:NativeDraft):NativeAdmissionAck {
  const receipt={protocol:1 as const,intentId:'intent-original',id:frozen.id,inputToken:frozen.token,inputRevision:frozen.revision,inputDigest:frozen.digest,context,queue:{whenBusy:'followUp' as const,whenIdle:'start' as const},controlGeneration:1,bindingId:'binding-one',submissionId:7};
  return {draftCleared:true,draft,intent:{...receipt,actionId:'intent-original',createdAt:1,preview:{text:frozen.text,attachmentCount:0},stateVersion:2,delivery:'acknowledged',cancelled:false,receipt}};
}

it('adopts the native acknowledgement clear without clearing newer local edits or issuing another clear',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  const client=new ApplicationClient({postMessage:json=>{void native.handle(JSON.parse(json)).then(response=>client.receive(response));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','这次发送的旧内容');const captured=await drafts.freeze('one');
    drafts.edit('one','接纳期间的新编辑');
    const cleared=native.apply({protocol:1,connectionId:'native-ack',requestId:'native-clear',method:'input.clear',payload:{id:'one',expectedRevision:captured.frozen.revision,operationId:'native-clear'}}) as NativeDraft;
    await drafts.confirmAdmission(acknowledgement(captured.frozen,cleared),captured.editEpoch);
    expect(drafts.view('one')?.text).toBe('接纳期间的新编辑');await drafts.flush('one');
    expect(native.read('one')).toMatchObject({text:'接纳期间的新编辑',revision:3});
    expect(native.requests.some(request=>request.method==='input.clear')).toBe(false);
  }finally{drafts.dispose();client.dispose();}
});

it('rebases a newer in-flight save only after a verified native admission clear caused its CAS conflict',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  let holding=false,release!:()=>void;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json),reply=()=>void native.handle(request).then(response=>client.receive(response));if(holding&&request.method==='input.save'){holding=false;release=reply;}else reply();}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','旧发送');const captured=await drafts.freeze('one');
    holding=true;drafts.edit('one','正在保存的新草稿');const saving=drafts.flush('one');
    const cleared=native.apply({protocol:1,connectionId:'native-ack',requestId:'native-clear',method:'input.clear',payload:{id:'one',expectedRevision:captured.frozen.revision,operationId:'native-clear'}}) as NativeDraft;
    await drafts.confirmAdmission(acknowledgement(captured.frozen,cleared),captured.editEpoch);release();
    await expect(saving).resolves.toMatchObject({draft:{text:'正在保存的新草稿',revision:3}});
    expect(drafts.view('one')).toMatchObject({text:'正在保存的新草稿',status:'saved'});
    expect(native.requests.filter(request=>request.method==='input.clear')).toHaveLength(0);
  }finally{drafts.dispose();client.dispose();}
});

it('keeps an ACK received during initial draft loading when an older native read returns afterward',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{...native.read('one'),revision:1,stateVersion:1,text:'已接纳的旧草稿'});
  const original=native.read('one'),frozen={token:'frozen-original',id:'one',revision:1,text:original.text,representations:[],digest:'a'.repeat(64)};
  let release!:()=>void;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);release=()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:original});}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    const loading=drafts.read('one');
    await drafts.confirmAdmission(acknowledgement(frozen,{...original,text:'',revision:2,stateVersion:2}));release();await loading;
    expect(drafts.view('one')).toMatchObject({text:'',revision:2,stateVersion:2,status:'saved'});
  }finally{drafts.dispose();client.dispose();}
});

it.each(['新草稿','原文'])('preserves a later local edit (%s) as an explicit conflict when recovered ACK clear provenance is unavailable',async text=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'会话',model:{provider:'fixture',modelId:'one',name:'模型'}});
  const client=new ApplicationClient({postMessage:json=>{void native.handle(JSON.parse(json)).then(response=>client.receive(response));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','原文');const captured=await drafts.freeze('one');
    drafts.edit('one','中间编辑');drafts.edit('one',text);
    const cleared=native.apply({protocol:1,connectionId:'native-ack',requestId:'native-clear',method:'input.clear',payload:{id:'one',expectedRevision:captured.frozen.revision,operationId:'native-clear'}}) as NativeDraft;
    // This shape can come from an ACK replay or another author's clear: neither proves provenance.
    await drafts.confirmAdmission({...acknowledgement(captured.frozen,cleared),draftCleared:false},captured.editEpoch);
    expect(drafts.view('one')).toMatchObject({text,revision:1,status:'conflict'});
    await expect(drafts.flush('one')).rejects.toThrow('本地编辑已保留');
    expect(native.read('one')).toMatchObject({text:'',revision:2});
    await drafts.recover('one',true);
    expect(native.read('one')).toMatchObject({text,revision:3});
  }finally{drafts.dispose();client.dispose();}
});
