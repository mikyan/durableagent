// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import {MODELS_EXTENSION,type ModelConfiguration,type CredentialWriteRequest} from '../../runtime/src/model-protocol';
import {App} from '../src/App';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
afterEach(cleanup);

it('keeps empty settings usable, adds a connection, saves a key narrowly and explicitly chooses a future default',async()=>{
  let config:ModelConfiguration={version:0,defaultModel:null,connections:[]};
  const ordinary:ApplicationRequest[]=[],credentials:CredentialWriteRequest[]=[];
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);ordinary.push(request);let value:unknown=config;
      if(request.method==='status')value={phase:'ready',extensions:['conversation',MODELS_EXTENSION.id]};
      if(request.method==='list')value={conversations:[]};
      if(request.method==='models.create'){
        config={version:1,defaultModel:null,connections:[{id:'destination-a',name:String(request.payload!.name),protocol:'openai-compatible',endpoint:String(request.payload!.endpoint),models:[{id:'text-model',name:'text-model',contextWindow:8192,maxTokens:1024}],enabled:true,createdAt:1,credential:{connectionId:'destination-a',state:'absent',generation:0,configured:false}}]};value=config;
      }
      if(request.method==='models.setDefault'){config={...config,version:2,defaultModel:{provider:'destination-a',modelId:'text-model',name:'text-model'}};value=config;}
      if(request.method==='models.setEnabled'){config={...config,version:3,connections:config.connections.map(connection=>({...connection,enabled:false}))};value=config;}
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    },writeCredential:json=>{
      const request:CredentialWriteRequest=JSON.parse(json);credentials.push(request);
      const credential={connectionId:'destination-a',state:request.operation==='save'?'configured' as const:'absent' as const,generation:request.expectedGeneration+1,configured:request.operation==='save'};
      config={...config,connections:config.connections.map(connection=>({...connection,credential}))};
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:credential}));
    }});return client;
  });
  render(<App controller={controller}/>);
  fireEvent.click(await screen.findByRole('button',{name:'模型'}));
  expect(await screen.findByText('聊天、附件和工具结果会发送给你选择的模型服务。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/OpenAI 兼容 API/}));
  fireEvent.change(screen.getByRole('textbox',{name:'账号名称'}),{target:{value:'我的服务'}});
  fireEvent.change(screen.getByRole('textbox',{name:'服务地址'}),{target:{value:'https://models.example/v1'}});
  fireEvent.change(screen.getByRole('textbox',{name:'模型 ID'}),{target:{value:'text-model'}});
  fireEvent.click(screen.getByRole('button',{name:'添加连接'}));
  let card=await screen.findByTestId('connection-card');
  expect(within(card).getByText('我的服务')).toBeTruthy();
  expect(controller.snapshot().models?.defaultModel).toBeNull();
  const password=within(card).getByLabelText('API Key') as HTMLInputElement;
  expect(password.type).toBe('password');
  fireEvent.change(password,{target:{value:'synthetic-password-never-echo'}});
  fireEvent.click(within(card).getByRole('button',{name:'保存 API Key'}));
  await waitFor(()=>expect(password.value).toBe(''));
  expect(credentials[0]).toMatchObject({operation:'save',target:'destination-a',expectedGeneration:0,key:'synthetic-password-never-echo'});
  expect(JSON.stringify(ordinary)).not.toContain('synthetic-password-never-echo');
  expect(document.body.textContent).not.toContain('synthetic-password-never-echo');
  expect(await screen.findByText('已配置')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'返回模型列表'}));
  fireEvent.click(screen.getByText(/^切换模型/));
  fireEvent.change(screen.getByRole('combobox',{name:'新会话默认模型'}),{target:{value:JSON.stringify(['destination-a','text-model'])}});
  fireEvent.click(screen.getByRole('button',{name:'设为默认'}));
  expect(await screen.findByText('默认模型已更新，仅影响以后新建的会话。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/OpenAI 兼容 API/}));
  card=await screen.findByTestId('connection-card');
  fireEvent.click(within(card).getByRole('button',{name:'停用连接'}));
  expect(await within(card).findByRole('button',{name:'启用连接'})).toBeTruthy();
  expect(screen.getAllByTestId('connection-card')).toHaveLength(1);
  fireEvent.click(within(card).getByRole('button',{name:'移除凭据'}));
  expect(await within(card).findByText('未配置')).toBeTruthy();
  expect(credentials[1]).toMatchObject({operation:'remove',expectedGeneration:1});
  expect(credentials[1]).not.toHaveProperty('key');
  controller.dispose();
});

it('clears a rejected credential input without echoing reflected secrets or pretending the stored generation changed',async()=>{
  const marker='synthetic-reflected-password';let attempt:CredentialWriteRequest|undefined;
  const config:ModelConfiguration={version:4,defaultModel:null,providers:[{id:'xiaomi-token-plan-cn',name:'MiMo',models:[],authMethods:[{type:'api_key',label:'API Key'}]}],connections:[{id:'broken',name:'需要重配',protocol:'mimo-cn',endpoint:'https://token-plan-cn.xiaomimimo.com/v1',models:[],enabled:true,createdAt:1,credential:{connectionId:'broken',state:'corrupt',generation:7,configured:false}}]};
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);
      const value=request.method==='status'?{phase:'ready',extensions:['conversation',MODELS_EXTENSION.id]}:request.method==='list'?{conversations:[]}:config;
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    },writeCredential:json=>{
      attempt=JSON.parse(json);const request=attempt!;
      queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:'CREDENTIAL_CONFLICT',message:`Unsafe external reflection: ${marker}`}}));
    }});return client;
  });
  render(<App controller={controller}/>);fireEvent.click(await screen.findByRole('button',{name:'模型'}));
  fireEvent.click(await screen.findByRole('button',{name:/MiMo/}));
  expect(await screen.findByText('凭据密文损坏')).toBeTruthy();
  expect(screen.getByText(/若保存仍被拒绝.*添加新账号/)).toBeTruthy();
  const password=screen.getByLabelText('API Key') as HTMLInputElement;
  fireEvent.change(password,{target:{value:marker}});fireEvent.click(screen.getByRole('button',{name:'保存 API Key'}));
  expect(await screen.findByText('凭据状态已变更，请刷新后重新输入。')).toBeTruthy();
  expect(password.value).toBe('');expect(document.body.textContent).not.toContain(marker);
  expect(attempt?.expectedGeneration).toBe(7);
  expect(controller.snapshot().models?.connections[0].credential).toMatchObject({state:'corrupt',generation:7});
  expect(JSON.stringify(controller.snapshot())).not.toContain(marker);controller.dispose();
});
