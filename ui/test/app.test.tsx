// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import type {ApplicationRequest,ConversationSnapshot,ConversationSummary} from '../../runtime/src/application-protocol';
import {InputPlatform} from './input-platform';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {App} from '../src/App';

afterEach(cleanup);

it('creates a real wire conversation and distinguishes progress from committed messages across reconnect',async()=>{
  const native=new InputPlatform();
  const requests:ApplicationRequest[]=[];
  let summary:ConversationSummary|undefined;
  let snapshot:ConversationSnapshot|undefined;
  let subscription:ApplicationRequest|undefined;
  let client:ApplicationClient;
  const controller=new ConversationController(()=>{
    client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      let value:unknown={};
      switch(request.method){
        case 'status':value={phase:'ready',extensions:['conversation']};break;
        case 'list':value={conversations:summary?[summary]:[]};break;
        case 'create':
          summary={id:'101',title:'新会话',model:{provider:'fixture',modelId:'fixture-1',name:'验证模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'idle'};
          snapshot={id:'101',revision:1,conversation:summary,entries:[],phase:'idle',storedSeq:1};
          native.rememberConversation(summary);value={conversation:summary,storedSeq:1};break;
        case 'open':value=snapshot;break;
        case 'history':value={items:snapshot?.entries??[]};break;
        case 'subscribe':subscription=request;value=snapshot;break;
        case 'send':
          snapshot={...snapshot!,revision:2,phase:'running',entries:[{id:'102',role:'user',text:native.frozen.get(native.intents.get(String(request.payload?.intentId))!.inputToken)!.text,persisted:true}],progress:{text:'这是一段进度',persisted:false},storedSeq:2};
          void native.fixtureAdmission(String(request.payload?.intentId)).then(value=>{client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});emit();});return;
        case 'sendList':
          void native.listSends(request.payload).then(async page=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{items:await Promise.all(page.intents.map(intent=>native.fixtureStatus(intent.intentId)))}}));return;
      }
      queueMicrotask(()=>{
        client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value});
      });
    }});
    return client;
  });
  function emit(){client.receive({type:'conversation',protocol:1,connectionId:subscription!.connectionId,subscriptionId:String(subscription!.payload!.subscriptionId),snapshot:snapshot!});}
  render(<App controller={controller}/>);
  fireEvent.click(await screen.findByRole('button',{name:'新建会话'}));
  const input=await screen.findByRole('textbox',{name:'消息'});
  fireEvent.change(input,{target:{value:'请回答一次'}});
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  expect(await screen.findByText('这是一段进度')).toBeTruthy();
  expect(screen.getByText('生成中 · 尚未保存')).toBeTruthy();
  expect(screen.getByRole('button',{name:'停止生成'})).toBeTruthy();
  await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe(''));
  snapshot={...snapshot!,revision:3,phase:'done',progress:undefined,entries:[...snapshot!.entries,{id:'104',role:'assistant',text:'已提交的完整回答',persisted:true}],storedSeq:3};
  emit();
  expect(await screen.findByText('已提交的完整回答')).toBeTruthy();
  expect(screen.queryByText('生成中 · 尚未保存')).toBeNull();
  expect(screen.getByText('回复已保存')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'会话详情'}));
  fireEvent.click(screen.getByRole('button',{name:'系统停止通知'}));
  await waitFor(()=>expect(requests.filter(request=>String(request.method)==='input.stopNotification')).toHaveLength(1));
  expect(requests.find(request=>String(request.method)==='input.stopNotification')?.payload?.id).toBe('101');
  fireEvent.click(screen.getByRole('button',{name:'重新连接'}));
  await waitFor(()=>expect(requests.filter(request=>request.method==='subscribe')).toHaveLength(2));
  expect(requests.filter(request=>request.method==='send')).toHaveLength(1);
  expect(requests.filter(request=>request.method==='stop')).toHaveLength(0);
  controller.dispose();
});

it('shows the missing native host without invented conversations or enabled send controls',async()=>{
  const native=new InputPlatform();
  const controller=new ConversationController(()=>new ApplicationClient(undefined));
  render(<App controller={controller}/>);
  expect(await screen.findByText('无法连接运行宿主，请在应用中打开此页面。')).toBeTruthy();
  expect(screen.queryByRole('textbox',{name:'消息'})).toBeNull();
  expect((screen.getByRole('button',{name:'新建会话'}) as HTMLButtonElement).disabled).toBe(true);
  controller.dispose();
});

it('folds long persisted messages explicitly and expands the exact original without changing short messages',async()=>{
  const native=new InputPlatform();
  const longUser='开头🌍'+ '\u0001'.repeat(90000)+'原文末尾';
  const longAssistant='完整回答'.repeat(22000)+'回答末尾';
  const summary:ConversationSummary={id:'long-history',title:'长历史',model:{provider:'fixture',modelId:'one',name:'验证模型'},workspaceId:'default',projectId:null,createdAt:1,phase:'done'};
  native.rememberConversation(summary);
  const snapshot:ConversationSnapshot={id:summary.id,conversation:summary,revision:1,phase:'done',storedSeq:1,entries:[{id:'1',role:'user',text:longUser,persisted:true},{id:'2',role:'assistant',text:longAssistant,persisted:true},{id:'3',role:'user',text:'短消息保持完整',persisted:true}]};
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      const value=request.method==='status'?{phase:'ready',extensions:['conversation']}:request.method==='list'?{conversations:[summary]}:request.method==='history'?{items:snapshot.entries}:snapshot;
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }});return client;
  },{get:key=>key==='selectedConversation'?summary.id:null,set:()=>{}});
  render(<App controller={controller}/>);
  const toggles=await screen.findAllByRole('button',{name:'展开完整消息'});
  expect(toggles).toHaveLength(2);
  const messages=screen.getAllByTestId('history-message');
  expect(messages[0].textContent!.length).toBeLessThan(2000);
  expect(messages[0].textContent).not.toContain('\u0001');
  expect(messages[0].textContent).not.toContain('原文末尾');
  expect(screen.getByText('短消息保持完整')).toBeTruthy();
  expect(within(messages[2]).queryByRole('button')).toBeNull();
  fireEvent.click(toggles[0]);
  expect(within(messages[0]).getByTestId('message-text').textContent).toBe(longUser);
  expect(within(messages[1]).queryByText('回答末尾')).toBeNull();
  expect(controller.snapshot().history[0].text).toBe(longUser);
  fireEvent.click(within(messages[0]).getByRole('button',{name:'收起长消息'}));
  expect(messages[0].textContent!.length).toBeLessThan(2000);
  expect(screen.getAllByRole('button',{name:'展开完整消息'})).toHaveLength(2);
  controller.dispose();
});
