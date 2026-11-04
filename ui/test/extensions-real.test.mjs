// @vitest-environment jsdom
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Application} from '../../runtime/dist/application.js';
import {validationConfiguration} from '../../runtime/dist/application-validation.js';
import {SqliteSendAuthority} from '../../runtime/validation/submission-authority.mjs';
import {ApplicationClient} from '../src/client';
import {ExtensionPage} from '../src/extension-host';
import {SendStates} from '../src/extensions/submissions';
import {createBrowserController} from '../src/browser';
import Timeline from '../src/extensions/timeline';

it('real SDK catalog reaches the actual React UI-only mount and history subscription without a placeholder Agent',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'extension-ui-')),native=new SqliteSendAuthority(join(directory,'native.sqlite'));let requests=0;
 const app=new Application({path:join(directory,'sdk.sqlite'),inputs:native,sends:native,routes:native,...validationConfiguration({requested:()=>requests++})});
 const methods=[];const client=new ApplicationClient({postMessage:json=>{const request=JSON.parse(json);methods.push(request.method);void app.request(request,event=>client.receive(event)).then(response=>client.receive(response));}});
 try{await app.start();await client.request('create',{creationId:'timeline'});const intent=await native.create('timeline','真实核心的时间线记录','one');await client.request('send',{intentId:intent.intentId});
 await waitFor(async()=>expect((await client.request('open',{id:'timeline'})).phase).toBe('done'),{timeout:10000});
 render(createElement(ExtensionPage,{client,conversationId:'timeline'}));
 expect(await screen.findByText('SDK 已安装：app.routing')).toBeTruthy();expect(screen.getByText('SDK 已安装：app.models')).toBeTruthy();
 fireEvent.click(screen.getByTestId('toggle-timeline'));expect(await screen.findByText('真实核心的时间线记录')).toBeTruthy();expect(await screen.findByText('本页已挂载')).toBeTruthy();
 fireEvent.click(screen.getByTestId('toggle-timeline'));await waitFor(()=>expect(methods.filter(x=>x==='unsubscribe')).toHaveLength(1));expect(requests).toBe(1);expect(methods.includes('stop')).toBe(false);expect((await client.request('open',{id:'timeline'})).phase).toBe('done');
 }finally{cleanup();client.dispose();await app.close();native.close();await rm(directory,{recursive:true,force:true});}
},20000);

it('actual source stop after target acceptance never labels the independent target stopped, but target control remains authoritative',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'extension-stop-ui-')),native=new SqliteSendAuthority(join(directory,'native.sqlite'));let injected=false;
 const app=new Application({path:join(directory,'sdk.sqlite'),inputs:native,sends:native,routes:native,...validationConfiguration({hang:true}),submissionBoundary:async(stage,intent)=>{if(stage==='before-native-ack'&&intent.source&&!injected){injected=true;await native.stop('source','source-stop');}}});
 const call=async(method,payload={})=>{const r=await app.request({protocol:1,connectionId:'test',requestId:crypto.randomUUID(),method,payload});if(!r.ok)throw Error(r.error.message);return r.value;};
 try{await app.start();await call('create',{creationId:'source'});await call('create',{creationId:'target'});const source=await call('routing.query',{id:'source'}),target=await call('routing.query',{id:'target'});
 const routed=await call('routing.send',{actionId:'explicit',source:{id:'source',sdkConversationId:source.context.sdkConversationId,controlGeneration:source.control.generation},id:'target',text:'已接纳的目标工作',expectedContext:target.context,expectedControlVersion:target.control.version});
 expect(routed.accepted).toBe(true);expect(routed.intent.sourceCancelled).toBe(true);expect(routed.intent.cancelled).toBe(false);
 const ui=(status,control)=>createElement(SendStates,{controller:{},state:{submissions:{items:[{intentId:status.intent.intentId,id:'target',createdAt:1,preview:status.intent.preview,durable:'saved',intent:status.intent,status,busy:false}],control}}});
 const page=render(ui(routed,await native.readControl('target')));expect(screen.queryByText('已接纳 · 已请求停止')).toBeNull();expect(screen.queryByText('已接纳 · 会话中断已确认')).toBeNull();
 await native.stop('target','target-stop');const stopped=await call('sendStatus',{intentId:'explicit'});expect(stopped.receipt).toEqual(routed.receipt);page.rerender(ui(stopped,await native.readControl('target')));expect(screen.getByText('已接纳 · 已请求停止')).toBeTruthy();
 }finally{cleanup();await app.close();native.close();await rm(directory,{recursive:true,force:true});}
},15000);

it('real browser callback reaches the mounted Timeline observation diagnostic',async()=>{
 let sub;const host={localStorage:{getItem:()=>null,setItem:()=>{}},DurableNative:{postMessage:json=>{const r=JSON.parse(json);if(r.method==='unsubscribe')return;let value={};if(r.method==='status')value={phase:'ready',extensions:['conversation']};if(r.method==='list')value={conversations:[]};if(r.method==='history')value={items:[]};if(r.method==='subscribe'){sub=r;value={id:'target',revision:1,entries:[],phase:'running',storedSeq:1,conversation:{id:'target',phase:'running'}};}queueMicrotask(()=>host.__durableReceive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:true,value}));}}};
 const controller=createBrowserController(host);try{await controller.connect();render(createElement(Timeline,{client:controller.extensionClient,conversationId:'target'}));await waitFor(()=>expect(sub).toBeTruthy());host.__durableReceive({type:'subscription-error',protocol:1,connectionId:sub.connectionId,subscriptionId:sub.payload.subscriptionId,error:{code:'OBSERVATION_UNAVAILABLE',message:'真实浏览器入口断开诊断'}});expect((await screen.findByRole('alert')).textContent).toContain('这不表示会话已完成');expect(screen.getByText(/当前会话状态：running/)).toBeTruthy();}finally{cleanup();controller.dispose();}
});
