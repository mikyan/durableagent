// @vitest-environment jsdom
// The wire is the platform boundary; Application, SDK, SQLite and UI implementations are real.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Application} from '../../runtime/dist/application.js';
import {validationConfiguration} from '../../runtime/dist/application-validation.js';
import {App} from '../src/App';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';

it('the registered real application enables React create/send and reopens the same SQLite history without another model request',async()=>{
  const temporaryRoot=resolve(tmpdir());
  const directory=await mkdtemp(join(temporaryRoot,'durable-ui-contract-'));
  let modelRequests=0;
  const options={path:join(directory,'application.sqlite'),...validationConfiguration({requested:()=>modelRequests++})};
  let app=new Application(options);
  const preferences=new Map();
  const connect=()=>new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:json=>{
      void app.request(JSON.parse(json),event=>client.receive(event)).then(response=>client.receive(response));
    }});return client;
  },{get:key=>preferences.get(key)??null,set:(key,value)=>preferences.set(key,value)});
  let controller;
  try{
    await app.start();controller=connect();render(createElement(App,{controller}));
    const create=await screen.findByRole('button',{name:'新建会话'});
    await waitFor(()=>expect(create.disabled).toBe(false));
    fireEvent.click(create);
    const input=await screen.findByRole('textbox',{name:'消息'});
    await waitFor(()=>expect(input.disabled).toBe(false));
    fireEvent.change(input,{target:{value:'只接受一次的真实核心输入'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    expect(await screen.findByText('回复已保存',{}, {timeout:10000})).toBeTruthy();
    expect(screen.getByText('你好🌍')).toBeTruthy();
    const originalId=controller.snapshot().activeId;
    expect(modelRequests).toBe(1);
    cleanup();controller.dispose();await app.close();
    app=new Application(options);await app.start();controller=connect();render(createElement(App,{controller}));
    expect(await screen.findByText('只接受一次的真实核心输入')).toBeTruthy();
    expect(await screen.findByText('你好🌍')).toBeTruthy();
    expect(controller.snapshot().activeId).toBe(originalId);
    expect(controller.snapshot().conversations).toHaveLength(1);
    expect(controller.snapshot().history).toHaveLength(2);
    expect(modelRequests).toBe(1);
  }finally{
    cleanup();controller?.dispose();await app.close();
    if(!resolve(directory).startsWith(temporaryRoot+sep)||!directory.includes('durable-ui-contract-'))throw new Error('Unsafe temporary cleanup target');
    await rm(directory,{recursive:true,force:true});
  }
},20000);
