// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {App} from '../src/App';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';

it('shows a preparation request separately from committed preparation state and keeps editing and removal available',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'slow',title:'慢附件',model:{provider:'fixture',modelId:'one',name:'模型'}});
  const selection={id:'slow-file',source:{name:'慢文本.txt',mimeType:'text/plain',access:'unknown' as const},preparation:{state:'selected' as const}};
  native.drafts.set('slow',{id:'slow',revision:1,stateVersion:1,text:'',committed:true,selections:[selection]});
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);
      if(request.method==='input.prepare'){native.drafts.set('slow',{...native.read('slow'),stateVersion:2,selections:[{...selection,preparation:{state:'preparing'}}]});return;}
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{phase:'failed',extensions:[],reason:'Agent 暂不可用'}}));
    }});return client;
  },{get:key=>key==='selectedConversation'?'slow':null,set:()=>{}});
  try{
    render(<App controller={controller}/>);const prepare=await screen.findByRole('button',{name:'本地准备'});vi.useFakeTimers();
    fireEvent.click(prepare);
    expect(screen.getByText('正在请求本地准备…')).toBeTruthy();expect((prepare as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('attachment-preparation').dataset.state).toBe('selected');
    expect((screen.getByRole('textbox',{name:'消息'}) as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByRole('button',{name:'移除 慢文本.txt'}) as HTMLButtonElement).disabled).toBe(false);
    await act(async()=>vi.advanceTimersByTimeAsync(500));
    expect(screen.getByTestId('attachment-preparation').dataset.state).toBe('preparing');expect(screen.getByTestId('attachment-source').dataset.state).toBe('unknown');
    expect(screen.getByText('正在本地准备')).toBeTruthy();expect(screen.getByRole('button',{name:'刷新附件状态'})).toBeTruthy();
  }finally{cleanup();controller.dispose();vi.useRealTimers();}
});

it('edits a native draft while Agent is unavailable and shows separate source and prepared-material states',async()=>{
  const native=new InputPlatform();native.rememberConversation({id:'one',title:'可恢复的草稿',model:{provider:'fixture',modelId:'one',name:'模型'}});
  native.drafts.set('one',{id:'one',revision:2,stateVersion:4,text:'已保存文字',committed:true,selections:[{id:'image',source:{name:'原图.png',mimeType:'image/png',access:'unavailable'},preparation:{state:'ready',representation:{objectId:'private',kind:'image',mimeType:'image/png',sha256:'a'.repeat(64),byteLength:1024,width:200,height:100,sourceWidth:400,sourceHeight:200,range:'full',transformation:'缩放为200×100',capabilityVersion:'v1'}}}]});
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);if(request.method.startsWith('input.'))void native.handle(request).then(response=>client.receive(response));else queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{phase:'failed',extensions:[],reason:'Agent 暂不可用'}}));}});return client;
  },{get:key=>key==='selectedConversation'?'one':null,set:()=>{}});
  try{
    render(<App controller={controller}/>);const input=await screen.findByRole('textbox',{name:'消息'});
    await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe('已保存文字'));expect((input as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText('原件不可用')).toBeTruthy();expect(screen.getByText('本地材料已准备')).toBeTruthy();expect(screen.getByText(/缩放为200×100/)).toBeTruthy();
    fireEvent.change(input,{target:{value:'Agent 离线时仍可保存'}});
    expect(screen.getByTestId('draft-status').textContent).toContain('待保存');
    await waitFor(()=>expect(screen.getByTestId('draft-status').textContent).toContain('草稿已保存'));
    expect(native.read('one').text).toBe('Agent 离线时仍可保存');expect((screen.getByRole('button',{name:'发送消息'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(native.intents.size).toBe(1));expect(await screen.findByText('待投递')).toBeTruthy();
    expect(native.read('one').text).toBe('Agent 离线时仍可保存');
    fireEvent.click(screen.getByRole('button',{name:'添加附件'}));expect(screen.getByRole('menuitem',{name:'选择图片'})).toBeTruthy();expect(screen.getByRole('menuitem',{name:'选择文件'})).toBeTruthy();
    expect(native.requests.some(request=>request.method==='send'||request.method==='create')).toBe(false);
  }finally{cleanup();controller.dispose();}
});

it('displays image-only persisted history and refuses to treat an unsupported attachment reference as sendable content',async()=>{
  const native=new InputPlatform();const summary={id:'image-only',title:'图片历史',model:{provider:'fixture',modelId:'image',name:'图片模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'done'};
  native.rememberConversation(summary);native.drafts.set(summary.id,{id:summary.id,revision:1,stateVersion:2,text:'',committed:true,selections:[{id:'pdf',source:{name:'材料.pdf',mimeType:'application/pdf',access:'available'},preparation:{state:'unsupported',reason:'当前仅支持 UTF-8 文本；请主动转换或重新选择。'}}]});
  const snapshot={id:summary.id,revision:2,conversation:summary,entries:[{id:'image-message',role:'user',text:'',persisted:true,attachments:[{kind:'image',mimeType:'image/png',sha256:'b'.repeat(64),byteLength:1024}]}],phase:'done',storedSeq:3};
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}const value=request.method==='status'?{phase:'ready',extensions:['conversation']}:request.method==='list'?{conversations:[summary]}:request.method==='history'?{items:snapshot.entries}:snapshot;queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));}});return client;
  },{get:key=>key==='selectedConversation'?summary.id:null,set:()=>{}});
  try{
    render(<App controller={controller}/>);expect(await screen.findByTestId('history-attachment')).toBeTruthy();expect(screen.getByText('图片附件')).toBeTruthy();
    expect(await screen.findByText('不支持此格式')).toBeTruthy();expect(screen.getByText(/尚无可发送正文/)).toBeTruthy();
    expect((screen.getByRole('button',{name:'发送消息'}) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toContain('data:');expect(document.body.textContent).not.toContain('content://');
  }finally{cleanup();controller.dispose();}
});
