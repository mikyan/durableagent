// @vitest-environment jsdom
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {Application} from '../../runtime/dist/application.js';
import {ModelConnections} from '../../runtime/dist/model-connections.js';
import {fixtureTransport} from '../../runtime/dist/transport.js';
import {App} from '../src/App';
import {InputPlatform} from './input-platform';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';

it('real model settings start empty, configure by DOM, resolve credentials only at send and retain defaults on SQLite reopen',async()=>{
  const temporaryRoot=resolve(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'durable-ui-models-'));
  const native=new InputPlatform();
  const vault=new Map(),preferences=new Map(),ordinary=[];let reads=0,requests=0;
  const metadata=async id=>({connectionId:id,state:vault.has(id)?'configured':'absent',generation:vault.get(id)?.generation??0,configured:vault.has(id)});
  const credentials={metadata,resolve:async id=>{reads++;const value=vault.get(id);if(!value)throw Error('No credential');return value;}};
  const create=()=>{const connections=new ModelConnections({credentials,fetch:fixtureTransport({requested:()=>requests++,aborted:()=>{}})});return new Application({inputs:native,sends:native,path:join(directory,'application.sqlite'),models:connections.models,connections,workspacePath:directory});};
  let app=create(),controller;
  const connect=()=>new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      ordinary.push(json);const request=JSON.parse(json);if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      void app.request(request,event=>client.receive(event)).then(response=>client.receive(response));
    },writeCredential:json=>{
      const request=JSON.parse(json),prior=vault.get(request.target);
      if((prior?.generation??0)!==request.expectedGeneration)throw Error('Synthetic generation conflict');
      vault.set(request.target,{key:request.key,generation:request.expectedGeneration+1});
      void metadata(request.target).then(value=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value}));
    }});return client;
  },{get:key=>preferences.get(key)??null,set:(key,value)=>preferences.set(key,value)});
  try{
    await app.start();controller=connect();render(createElement(App,{controller}));
    fireEvent.click(await screen.findByRole('button',{name:'模型'}));
    fireEvent.click(await screen.findByRole('button',{name:/OpenAI 兼容 API/}));
    const name=await screen.findByRole('textbox',{name:'账号名称'});await waitFor(()=>expect(name.disabled).toBe(false));
    fireEvent.change(name,{target:{value:'设备上的测试连接'}});
    fireEvent.change(screen.getByRole('textbox',{name:'服务地址'}),{target:{value:'https://models.example/v1'}});
    fireEvent.change(screen.getByRole('textbox',{name:'模型 ID'}),{target:{value:'mimo-v2.6-flash'}});
    fireEvent.click(screen.getByRole('button',{name:'添加连接'}));
    const card=await screen.findByTestId('connection-card'),id=card.dataset.connectionId;
    expect(controller.snapshot().models.defaultModel).toBeNull();expect(reads).toBe(0);
    const password=within(card).getByLabelText('API Key');fireEvent.change(password,{target:{value:'synthetic-real-ui-key'}});fireEvent.click(within(card).getByRole('button',{name:'保存 API Key'}));
    expect(await within(card).findByText('已配置')).toBeTruthy();expect(password.value).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'返回模型列表'}));
    fireEvent.click(screen.getByText(/^切换模型/));
    fireEvent.change(screen.getByRole('combobox',{name:'新会话默认模型'}),{target:{value:JSON.stringify([id,'mimo-v2.6-flash'])}});fireEvent.click(screen.getByRole('button',{name:'设为默认'}));
    expect(await screen.findByText('默认模型已更新，仅影响以后新建的会话。')).toBeTruthy();expect(reads).toBe(0);
    fireEvent.click(screen.getByRole('button',{name:'返回会话'}));fireEvent.click(screen.getByRole('button',{name:'新建会话'}));
    const input=await screen.findByRole('textbox',{name:'消息'});await waitFor(()=>expect(input.disabled).toBe(false));
    fireEvent.change(input,{target:{value:'用配置的模型回复'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    expect(await screen.findByText('回复已保存',{}, {timeout:10000})).toBeTruthy();expect(requests).toBe(1);expect(reads).toBe(1);
    expect(controller.snapshot().history.map(message=>message.text)).toEqual(['用配置的模型回复','你好🌍']);
    expect(ordinary.join('')).not.toContain('synthetic-real-ui-key');expect(JSON.stringify(controller.snapshot())).not.toContain('synthetic-real-ui-key');
    cleanup();controller.dispose();await app.close();app=create();await app.start();controller=connect();render(createElement(App,{controller}));
    expect(await screen.findByText('你好🌍')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'模型'}));
    fireEvent.click(await screen.findByText(/^切换模型/));
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'新会话默认模型'}).value).toBe(JSON.stringify([id,'mimo-v2.6-flash'])));
    expect(requests).toBe(1);expect(reads).toBe(1);
  }finally{
    cleanup();controller?.dispose();await app.close();
    if(!resolve(directory).startsWith(temporaryRoot+sep)||!directory.includes('durable-ui-models-'))throw Error('Unsafe temporary cleanup target');
    await rm(directory,{recursive:true,force:true});
  }
},20000);
