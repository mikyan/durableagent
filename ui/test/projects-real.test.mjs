// @vitest-environment jsdom
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createElement} from 'react';
import {expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Application} from '../../runtime/dist/application.js';
import {validationConfiguration} from '../../runtime/dist/application-validation.js';
import {App} from '../src/App';
import {InputPlatform} from './input-platform';
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';

it('real project selection updates the trusted input context, keeps shared names and reopens the adopted SDK binding',async()=>{
  const root=resolve(tmpdir()),directory=await mkdtemp(join(root,'durable-ui-projects-')),native=new InputPlatform();let requests=0;
  const options={inputs:native,sends:native,locationEdits:native,path:join(directory,'app.sqlite'),...validationConfiguration({requested:()=>requests++})};
  let app=new Application(options),controller;const preferences=new Map();
  const connect=()=>new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:encoded=>{const request=JSON.parse(encoded);if(request.method.startsWith('input.'))void native.handle(request).then(value=>client.receive(value));else void app.request(request,event=>client.receive(event)).then(value=>client.receive(value));}});return client;
  },{get:key=>preferences.get(key)??null,set:(key,value)=>preferences.set(key,value)});
  try{
    await app.start();controller=connect();render(createElement(App,{controller}));fireEvent.click(await screen.findByRole('button',{name:'新建会话'}));
    const input=await screen.findByRole('textbox',{name:'消息'});await waitFor(()=>expect(input.disabled).toBe(false));
    const productId=controller.snapshot().activeId;
    fireEvent.click(screen.getByRole('button',{name:'会话详情'}));fireEvent.click(screen.getByRole('button',{name:'选择项目与工作区'}));
    const name=await screen.findByRole('textbox',{name:'新项目名称'});await waitFor(()=>expect(name.disabled).toBe(false));fireEvent.change(name,{target:{value:'真实共享项目'}});fireEvent.click(screen.getByRole('button',{name:'添加项目'}));
    await waitFor(()=>expect(controller.snapshot().projects.projects).toHaveLength(1));const project=controller.snapshot().projects.projects[0];
    // A previously explicit native intent is a real admission blocker, even while the UI is idle.
    const nativeAction=(method,payload)=>native.apply({protocol:1,connectionId:'native-fixture',requestId:crypto.randomUUID(),method,payload});
    let draft=native.read(productId);draft=nativeAction('input.save',{id:productId,expectedRevision:draft.revision,operationId:'pending-save',text:'原位置的待投递输入',selectionIds:[]});
    const frozen=nativeAction('input.freeze',{id:productId,expectedRevision:draft.revision,operationId:'pending-freeze'});
    const pending=nativeAction('input.createSend',{id:productId,actionId:'pending-intent',inputToken:frozen.token,expectedContext:draft.submissionContext,expectedControlVersion:0,queue:{whenBusy:'followUp',whenIdle:'start'}});
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'当前会话项目'}).disabled).toBe(false));fireEvent.change(screen.getByRole('combobox',{name:'当前会话项目'}),{target:{value:project.id}});fireEvent.click(screen.getByRole('button',{name:'应用到当前会话'}));
    await waitFor(()=>expect(controller.snapshot().projectsError).toContain('发送意图'));expect(controller.snapshot().projects.selection.projectId).toBeNull();
    const admission=await app.request({protocol:1,connectionId:'public-fixture',requestId:crypto.randomUUID(),method:'send',payload:{intentId:pending.intentId}});expect(admission.ok).toBe(true);
    await waitFor(async()=>{const response=await app.request({protocol:1,connectionId:'public-fixture',requestId:crypto.randomUUID(),method:'sendStatus',payload:{intentId:pending.intentId}});expect(response.value.submission.status).toBe('done');},{timeout:10000});
    await controller.loadProjects();expect(controller.snapshot().projects.selection.projectId).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'应用到当前会话'}));
    await waitFor(()=>expect(controller.snapshot().projects.selection.projectId).toBe(project.id));await waitFor(()=>expect(controller.snapshot().projectsPending).toBe(false));
    expect(controller.snapshot().draft.submissionContext.associationVersion).toBe(2);expect(native.read(productId).submissionContext.associationVersion).toBe(2);
    fireEvent.click(screen.getByRole('button',{name:'返回会话'}));const activeInput=screen.getByRole('textbox',{name:'消息'});fireEvent.change(activeInput,{target:{value:'项目绑定真实SDK输入🌍'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(controller.snapshot().history.filter(item=>item.role==='assistant')).toHaveLength(2),{timeout:10000});expect(requests).toBe(2);const accepted=[...native.intents.values()][1].receipt;expect(accepted.context.associationVersion).toBe(2);expect(accepted.bindingId).not.toBe(admission.value.receipt.bindingId);
    await controller.openProjects();expect(await controller.renameProject(project.id,'共享项目当前名称')).toBe(true);expect(controller.snapshot().draft.submissionContext).toEqual(accepted.context);
    cleanup();controller.dispose();await app.close();app=new Application(options);await app.start();controller=connect();render(createElement(App,{controller}));
    expect((await screen.findAllByText('你好🌍')).length).toBe(2);await controller.openProjects();expect(await screen.findByTestId('current-project')).toHaveProperty('textContent','项目：共享项目当前名称');
    expect(controller.snapshot().projects.selection.projectId).toBe(project.id);expect(requests).toBe(2);expect((await native.readSend(accepted.intentId)).receipt).toEqual(accepted);expect((await native.readSend(pending.intentId)).receipt).toEqual(admission.value.receipt);
  }finally{cleanup();controller?.dispose();await app.close();if(!resolve(directory).startsWith(root+sep)||!directory.includes('durable-ui-projects-'))throw Error('Unsafe temporary directory');await rm(directory,{recursive:true,force:true});}
},20000);
