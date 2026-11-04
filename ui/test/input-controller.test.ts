import {expect,it} from 'vitest';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest,ConversationSummary} from '../../runtime/src/application-protocol';

it('restores known native drafts while Agent JS failed and switches only after native commit, without sending',async()=>{
  const native=new InputPlatform(),requests:ApplicationRequest[]=[];
  const conversations=['one','two'].map(id=>({id,title:id,model:{provider:'fixture',modelId:'one',name:'模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'idle'} as ConversationSummary));
  for(const conversation of conversations)native.rememberConversation(conversation);
  let hold:undefined|(()=>Promise<void>);
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      if(request.method==='input.save'){hold=async()=>client.receive(await native.handle(request));return;}
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{phase:'failed',extensions:[],reason:'Agent unavailable'}}));
    }});return client;
  });
  try{
    await controller.connect();await controller.open('one');controller.editDraft('仅原生保存');
    const switching=controller.open('two');await Promise.resolve();expect(controller.snapshot().activeId).toBe('one');
    expect(controller.snapshot().draft?.status).toBe('pending');await hold!();await switching;
    expect(controller.snapshot().activeId).toBe('two');expect(native.read('one').text).toBe('仅原生保存');
    await controller.open('one');expect(controller.snapshot().draft?.text).toBe('仅原生保存');
    controller.editDraft('快速切换前的编辑');const staleNavigation=controller.open('two');await Promise.resolve();
    await controller.open('one');await hold!();await staleNavigation;
    expect(controller.snapshot().activeId).toBe('one');
    await controller.open('unknown');expect(controller.snapshot().activeId).toBe('one');
    expect(requests.filter(request=>request.method==='send'||request.method==='create'||request.method==='open')).toHaveLength(0);
  }finally{controller.dispose();}
});

it('blocks send on a failed flush and retains the pinned input and editable draft after an unknown SDK admission',async()=>{
  const native=new InputPlatform();const summary:ConversationSummary={id:'one',title:'发送确认',model:{provider:'fixture',modelId:'one',name:'模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'idle'};native.rememberConversation(summary);
  const requests:ApplicationRequest[]=[];let failSave=true;
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      if(request.method==='input.save'&&failSave){queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:'INPUT_STORAGE_FULL',message:'存储空间不足，草稿尚未保存'}}));return;}
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      if(request.method==='send')return;
      const value=request.method==='status'?{phase:'ready',extensions:['conversation']}:request.method==='list'?{conversations:[summary]}:request.method==='history'?{items:[]}:{id:'one',revision:1,conversation:summary,entries:[],phase:'idle',storedSeq:1};
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }},30);return client;
  });
  try{
    await controller.connect();await controller.open('one');controller.editDraft('保留这份内容');
    expect(await controller.send()).toBe(false);expect(requests.some(request=>request.method==='send'||request.method==='input.freeze')).toBe(false);
    expect(controller.snapshot().draft).toMatchObject({text:'保留这份内容',status:'failed'});
    failSave=false;await controller.retryDraft();expect(await controller.send()).toBe(false);
    expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
    const send=requests.find(request=>request.method==='send')!,intent=await native.readSend(String(send.payload?.intentId));expect(send.payload).toEqual({intentId:intent.intentId});expect(native.frozen.has(intent.inputToken)).toBe(true);
    expect(native.read('one').text).toBe('保留这份内容');expect(requests.some(request=>request.method==='input.clear'||request.method==='input.discard')).toBe(false);
    await controller.connect();expect(controller.snapshot().draft?.text).toBe('保留这份内容');expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
  }finally{controller.dispose();}
});
