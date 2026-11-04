import {expect,it} from 'vitest';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import {createBrowserController,type BrowserHost} from '../src/browser';

it('routes object and JSON envelopes across the native boundary and rejects previous connections',async()=>{
  const requests:ApplicationRequest[]=[];
  const values=new Map<string,string>();
  const host:BrowserHost={
    localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}},
    DurableNative:{postMessage:json=>{
      const request:ApplicationRequest=JSON.parse(json);requests.push(request);
      const value=request.method==='status'?{phase:'ready',extensions:['conversation']}:{conversations:[]};
      queueMicrotask(()=>host.__durableReceive?.(JSON.stringify({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value})));
    }}
  };
  const controller=createBrowserController(host);await controller.connect();
  expect(controller.snapshot().status.phase).toBe('ready');
  const prior=requests[0];
  await controller.connect();
  expect(new Set(requests.map(request=>request.connectionId)).size).toBe(2);
  host.__durableReceive?.({type:'response',protocol:1,connectionId:prior.connectionId,requestId:prior.requestId,ok:true,value:{phase:'failed',reason:'过期状态',extensions:[]}});
  for(const malformed of ['not-json',null,{}, {type:'conversation'}])expect(()=>host.__durableReceive?.(malformed)).not.toThrow();
  expect(controller.snapshot().status.phase).toBe('ready');
  controller.dispose();
});

it('native browser callback validates and delivers observation errors without replacing conversation facts',async()=>{
 let subscription:ApplicationRequest|undefined;const failures:Error[]=[];let phase='';
 const host:BrowserHost={localStorage:{getItem:()=>null,setItem:()=>{}},DurableNative:{postMessage:json=>{const r=JSON.parse(json) as ApplicationRequest;if(r.method==='unsubscribe')return;let value:unknown={};
 if(r.method==='status')value={phase:'ready',extensions:['conversation']};else if(r.method==='list')value={conversations:[]};else if(r.method==='subscribe'){subscription=r;value={id:'target',revision:1,entries:[],phase:'running',conversation:{id:'target',phase:'running'}};}
 queueMicrotask(()=>host.__durableReceive?.({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:true,value}));}}};
 const controller=createBrowserController(host);await controller.connect();const lease=await controller.extensionClient!.subscribe('target',value=>{phase=value.phase;},error=>failures.push(error));
 const event={type:'subscription-error',protocol:1,connectionId:subscription!.connectionId,subscriptionId:subscription!.payload!.subscriptionId,error:{code:'OBSERVATION_UNAVAILABLE',message:'观察连接已断开'}};
 for(const malformed of [{...event,protocol:2},{...event,subscriptionId:1},{...event,connectionId:''},{...event,error:{}},{...event,error:{code:'x',message:2}},{...event,connectionId:'old'}])host.__durableReceive?.(malformed);
 expect(failures).toHaveLength(0);host.__durableReceive?.(JSON.stringify(event));expect(failures).toHaveLength(1);expect(failures[0].message).toBe('观察连接已断开');expect(phase).toBe('running');expect(controller.snapshot().status.phase).toBe('ready');lease.unsubscribe();controller.dispose();
});
