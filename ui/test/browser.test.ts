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
